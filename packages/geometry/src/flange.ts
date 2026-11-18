import { add, cross, dot, normalize, scale, sub, type Vec3 } from '@hydrobim/core';
import { upFor } from './primitives';
import type { MeshData } from './sweep';

/**
 * Disco de flange com a furação tabulada (círculo de furação, número e diâmetro dos furos).
 * Os furos ficam simétricos em relação aos eixos principais ("fora de centro"), como é
 * prática nos flanges de tubulação.
 */
export interface DrilledFlange {
  /** Centro da face de trás do disco e eixo (unitário) em direção à face de vedação. */
  readonly back: Vec3;
  readonly axis: Vec3;
  readonly thickness: number;
  readonly innerRadius: number;
  readonly outerRadius: number;
  readonly boltCircleRadius: number;
  readonly boltCount: number;
  readonly boltHoleRadius: number;
}

/**
 * Malha do disco furado; `null` quando a furação não cabe no disco (dado incoerente), caso
 * em que o chamador representa o flange sem furos.
 *
 * O disco é dividido em um setor por furo. Em cada setor, o contorno do furo é ligado ao
 * contorno do setor por raios que partem do centro do furo; os pontos das divisas entre
 * setores coincidem, de modo que a malha é fechada.
 */
export function drilledFlange(flange: DrilledFlange): MeshData | null {
  const {
    thickness,
    innerRadius: ri,
    outerRadius: ro,
    boltCircleRadius: rc,
    boltCount: count,
    boltHoleRadius: rh,
  } = flange;
  const margin = rh * 0.15;
  if (
    !Number.isInteger(count) ||
    count < 3 ||
    thickness <= 0 ||
    rh <= 0 ||
    rc - rh - margin <= ri ||
    rc + rh + margin >= ro ||
    // Furos vizinhos não podem se tocar.
    2 * rc * Math.sin(Math.PI / count) <= 2 * rh + margin
  ) {
    return null;
  }

  const axis = normalize(flange.axis);
  const up = upFor(axis);
  const e1 = normalize(sub(up, scale(axis, dot(up, axis))));
  const e2 = cross(axis, e1);
  const alpha = Math.PI / count;

  // Divisões por setor: arco externo (2·m), divisas radiais (p cada) e arco interno (q).
  const m = Math.max(2, Math.ceil(24 / count));
  const q = Math.max(2, Math.ceil(32 / count));
  const p = Math.max(2, Math.ceil((16 - 2 * m - q) / 2));
  const ring = 2 * m + 2 * p + q;

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const vertex = (x: number, y: number, z: number, normal: Vec3): number => {
    const point = add(flange.back, add(add(scale(e1, x), scale(e2, y)), scale(axis, z)));
    positions.push(point.x, point.y, point.z);
    normals.push(normal.x, normal.y, normal.z);
    return positions.length / 3 - 1;
  };
  const radial = (x: number, y: number, sign: number): Vec3 => {
    const size = Math.hypot(x, y) || 1;
    return add(scale(e1, (sign * x) / size), scale(e2, (sign * y) / size));
  };
  const quad = (a: number, b: number, c: number, d: number): void => {
    indices.push(a, b, c, a, c, d);
  };
  const minus = scale(axis, -1);

  for (let k = 0; k < count; k += 1) {
    const center = (2 * k + 1) * alpha;
    const polar = (r: number, relative: number): [number, number] => [
      r * Math.cos(center + relative),
      r * Math.sin(center + relative),
    ];
    // Contorno do setor, anti-horário a partir do ponto do arco externo em frente ao furo.
    const boundary: [number, number][] = [];
    for (let j = 0; j < m; j += 1) boundary.push(polar(ro, (alpha * j) / m));
    for (let j = 0; j < p; j += 1) boundary.push(polar(ro + ((ri - ro) * j) / p, alpha));
    for (let j = 0; j < q; j += 1) boundary.push(polar(ri, alpha - (2 * alpha * j) / q));
    for (let j = 0; j < p; j += 1) boundary.push(polar(ri + ((ro - ri) * j) / p, -alpha));
    for (let j = 0; j < m; j += 1) boundary.push(polar(ro, -alpha + (alpha * j) / m));

    const [hx, hy] = polar(rc, 0);
    // Cada ponto do furo fica no raio que vai do centro do furo ao ponto do contorno.
    const hole = boundary.map(([x, y]): [number, number] => {
      const size = Math.hypot(x - hx, y - hy) || 1;
      return [hx + ((x - hx) / size) * rh, hy + ((y - hy) / size) * rh];
    });

    // Faces planas (trás e frente).
    for (const [z, normal, front] of [
      [0, minus, false],
      [thickness, axis, true],
    ] as const) {
      const outer = boundary.map(([x, y]) => vertex(x, y, z, normal));
      const inner = hole.map(([x, y]) => vertex(x, y, z, normal));
      for (let i = 0; i < ring; i += 1) {
        const j = (i + 1) % ring;
        const [hi, hj, bi, bj] = [inner[i] ?? 0, inner[j] ?? 0, outer[i] ?? 0, outer[j] ?? 0];
        if (front) quad(hi, bi, bj, hj);
        else quad(hi, hj, bj, bi);
      }
    }

    // Parede do furo (normais voltadas para o vazio do furo).
    const holeBack = hole.map(([x, y]) => vertex(x, y, 0, radial(x - hx, y - hy, -1)));
    const holeFront = hole.map(([x, y]) => vertex(x, y, thickness, radial(x - hx, y - hy, -1)));
    for (let i = 0; i < ring; i += 1) {
      const j = (i + 1) % ring;
      quad(holeBack[j] ?? 0, holeBack[i] ?? 0, holeFront[i] ?? 0, holeFront[j] ?? 0);
    }

    // Borda externa e furo central: trechos do contorno sobre cada arco.
    const wall = (from: number, steps: number, sign: number): void => {
      for (let step = 0; step < steps; step += 1) {
        const [x1, y1] = boundary[(from + step) % ring] ?? [0, 0];
        const [x2, y2] = boundary[(from + step + 1) % ring] ?? [0, 0];
        const a = vertex(x1, y1, 0, radial(x1, y1, sign));
        const b = vertex(x2, y2, 0, radial(x2, y2, sign));
        const c = vertex(x2, y2, thickness, radial(x2, y2, sign));
        const d = vertex(x1, y1, thickness, radial(x1, y1, sign));
        quad(a, b, c, d);
      }
    };
    wall(0, m, 1);
    wall(ring - m, m, 1);
    wall(m + p, q, -1);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

/** Dimensões do flange usadas pela geometria (as de `EndTreatment`, em metros). */
export interface FlangeDimensions {
  /** Espessura total, da face de vedação para dentro da peça (inclui o ressalto). */
  readonly length: number;
  readonly outerDiameter: number;
  readonly boltCircle?: number | undefined;
  readonly boltCount?: number | undefined;
  readonly boltHoleDiameter?: number | undefined;
  readonly raisedFaceDiameter?: number | undefined;
  readonly raisedFaceHeight?: number | undefined;
}

/**
 * Raio externo do cubo do flange (reforço atrás do disco). O cubo NÃO é tabulado nos
 * catálogos usados: é representação, proporcional à espessura do flange e limitada pela
 * furação, para que as porcas tenham onde assentar.
 */
export function flangeHubRadius(flange: FlangeDimensions, pipeRadius: number): number {
  const wanted = pipeRadius + flange.length * 0.6;
  const limit =
    flange.boltCircle !== undefined && flange.boltHoleDiameter !== undefined
      ? flange.boltCircle / 2 - flange.boltHoleDiameter * 0.9
      : flange.outerDiameter / 2;
  return Math.max(pipeRadius, Math.min(wanted, limit, flange.outerDiameter / 2));
}

/** Anel cilíndrico fechado entre dois planos perpendiculares a `axis`. */
function ring(from: Vec3, axis: Vec3, height: number, inner: number, outer: number): MeshData {
  const up = upFor(axis);
  const e1 = normalize(sub(up, scale(axis, dot(up, axis))));
  const e2 = cross(axis, e1);
  const segments = 48;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const vertex = (radius: number, k: number, z: number, normal: Vec3 | 'out' | 'in'): number => {
    const phi = (2 * Math.PI * k) / segments;
    const radial = add(scale(e1, Math.cos(phi)), scale(e2, Math.sin(phi)));
    const point = add(from, add(scale(radial, radius), scale(axis, z)));
    const n = normal === 'out' ? radial : normal === 'in' ? scale(radial, -1) : normal;
    positions.push(point.x, point.y, point.z);
    normals.push(n.x, n.y, n.z);
    return positions.length / 3 - 1;
  };
  const minus = scale(axis, -1);
  for (let k = 0; k < segments; k += 1) {
    const quad = (a: number, b: number, c: number, d: number): void => {
      indices.push(a, b, c, a, c, d);
    };
    // Parede externa, parede do furo, face de trás e face da frente.
    quad(
      vertex(outer, k, 0, 'out'),
      vertex(outer, k + 1, 0, 'out'),
      vertex(outer, k + 1, height, 'out'),
      vertex(outer, k, height, 'out'),
    );
    quad(
      vertex(inner, k + 1, 0, 'in'),
      vertex(inner, k, 0, 'in'),
      vertex(inner, k, height, 'in'),
      vertex(inner, k + 1, height, 'in'),
    );
    quad(
      vertex(inner, k, 0, minus),
      vertex(inner, k + 1, 0, minus),
      vertex(outer, k + 1, 0, minus),
      vertex(outer, k, 0, minus),
    );
    quad(
      vertex(inner, k + 1, height, axis),
      vertex(inner, k, height, axis),
      vertex(outer, k, height, axis),
      vertex(outer, k + 1, height, axis),
    );
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

/**
 * Disco do flange, padronizado para todas as peças: da face de vedação (`face`) para dentro
 * da peça, com os furos dos parafusos (quando a furação é tabulada) e o ressalto da face
 * (quando tabulado). `axis` aponta para fora da peça. Devolve uma ou duas malhas fechadas:
 * o disco e o anel do ressalto.
 */
export function flangeDisc(
  face: Vec3,
  axis: Vec3,
  flange: FlangeDimensions,
  boreRadius: number,
): MeshData[] {
  const direction = normalize(axis);
  const outerRadius = flange.outerDiameter / 2;
  const raisedRadius = (flange.raisedFaceDiameter ?? 0) / 2;
  const raisedHeight = flange.raisedFaceHeight ?? 0;
  // O ressalto só é desenhado quando cabe: mais baixo que o flange, fora do furo e dentro
  // do disco. Caso contrário o disco ocupa toda a espessura.
  const raised =
    raisedHeight > 0 &&
    raisedHeight < flange.length &&
    raisedRadius > boreRadius &&
    raisedRadius < outerRadius;
  const thickness = raised ? flange.length - raisedHeight : flange.length;
  const back = add(face, scale(direction, -flange.length));
  const drilled =
    flange.boltCircle !== undefined &&
    flange.boltCount !== undefined &&
    flange.boltHoleDiameter !== undefined
      ? drilledFlange({
          back,
          axis: direction,
          thickness,
          innerRadius: boreRadius,
          outerRadius,
          boltCircleRadius: flange.boltCircle / 2,
          boltCount: flange.boltCount,
          boltHoleRadius: flange.boltHoleDiameter / 2,
        })
      : null;
  const meshes = [drilled ?? ring(back, direction, thickness, boreRadius, outerRadius)];
  if (raised) {
    meshes.push(
      ring(
        add(face, scale(direction, -raisedHeight)),
        direction,
        raisedHeight,
        boreRadius,
        raisedRadius,
      ),
    );
  }
  return meshes;
}

/**
 * Flange avulso (modelo da biblioteca): disco furado, ressalto e cubo cilíndrico com
 * concordância, como na peça fundida. O furo recebe o tubo (`boreRadius` = raio externo do
 * tubo). A face de vedação fica na origem, voltada para −X; o cubo se estende para +X.
 * Altura e diâmetro do cubo são representação (não tabulados).
 */
export function looseFlange(flange: FlangeDimensions, boreRadius: number): MeshData[] {
  const axis: Vec3 = { x: -1, y: 0, z: 0 };
  const origin: Vec3 = { x: 0, y: 0, z: 0 };
  const hub = flangeHubRadius(flange, boreRadius + flange.length * 0.35);
  // Cubo alto, como no flange avulso fundido (cerca de 1,6 × a espessura do disco).
  const height = flange.length * 1.6;
  const back: Vec3 = { x: flange.length, y: 0, z: 0 };
  const meshes = flangeDisc(origin, axis, flange, boreRadius);
  if (hub > boreRadius) meshes.push(ring(back, { x: 1, y: 0, z: 0 }, height, boreRadius, hub));
  return meshes;
}
