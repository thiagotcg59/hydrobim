import { rotate, vec3 } from '@hydrobim/core';
import type { ElementGeometry, PartRole } from './elements';

/**
 * Projeção em planta (vista de cima, direção −Z) de um elemento, para desenho técnico:
 *  - `fill`: triângulos voltados para cima, usados como máscara opaca (o elemento esconde o
 *    que está abaixo dele, pelo algoritmo do pintor);
 *  - `lines`: arestas visíveis — contorno aparente, bordas e quinas vivas —, já sem os
 *    trechos escondidos por partes mais altas do próprio elemento.
 *
 * Tudo é derivado da malha paramétrica do elemento; nada é desenhado à mão.
 */
export interface PlanOutline {
  /** Triângulos em planta: 6 números (x1, y1, x2, y2, x3, y3) por triângulo. */
  readonly fill: Float32Array;
  /** Segmentos visíveis: 4 números (x1, y1, x2, y2) por segmento. */
  readonly lines: Float32Array;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  /** Cota mais alta do elemento (ordem de desenho). */
  readonly maxZ: number;
  /**
   * A mesma máscara separada por papel da parte (corpo, acabamento, vedação…), para colorir a
   * planta como o modelo 3D. Está na ordem de desenho: de baixo para cima.
   */
  readonly shading: readonly PlanShade[];
  /** As linhas visíveis (`lines`) agrupadas pelo papel da parte a que pertencem. */
  readonly lineGroups: readonly PlanLineGroup[];
}

export interface PlanShade {
  readonly role: PartRole;
  /** Triângulos em planta: 6 números por triângulo. */
  readonly fill: Float32Array;
}

export interface PlanLineGroup {
  readonly role: PartRole;
  /** Segmentos: 4 números por segmento. */
  readonly lines: Float32Array;
}

/** Quinas com ângulo entre faces acima deste valor são desenhadas. */
const CREASE_COS = Math.cos((40 * Math.PI) / 180);
/** Faces com normal quase horizontal não contam como voltadas para cima. */
const FACING_EPS = 1e-6;
const WELD = 1e-5;

interface Face {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly up: boolean;
  /** Índice da parte (em `geometry.parts`) a que a face pertence. */
  readonly part: number;
}

export function planOutline(geometry: ElementGeometry): PlanOutline {
  const { position, rotation } = geometry.transform;
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const faces: Face[] = [];
  const edges = new Map<string, number[]>();

  for (const [partIndex, part] of geometry.parts.entries()) {
    const { positions, indices } = part.mesh;
    // Solda os vértices duplicados nas quinas (normais distintas) para achar as adjacências.
    const welded = new Map<string, number>();
    const remap = new Int32Array(positions.length / 3);
    for (let i = 0; i < remap.length; i += 1) {
      const p = rotate(
        rotation,
        vec3(positions[i * 3] ?? 0, positions[i * 3 + 1] ?? 0, positions[i * 3 + 2] ?? 0),
      );
      const x = p.x + position.x;
      const y = p.y + position.y;
      const z = p.z + position.z;
      const key = `${Math.round(x / WELD)},${Math.round(y / WELD)},${Math.round(z / WELD)}`;
      let index = welded.get(key);
      if (index === undefined) {
        index = xs.length;
        welded.set(key, index);
        xs.push(x);
        ys.push(y);
        zs.push(z);
      }
      remap[i] = index;
    }

    for (let t = 0; t + 2 < indices.length; t += 3) {
      const a = remap[indices[t] ?? 0] ?? 0;
      const b = remap[indices[t + 1] ?? 0] ?? 0;
      const c = remap[indices[t + 2] ?? 0] ?? 0;
      if (a === b || b === c || a === c) continue;
      const ux = (xs[b] ?? 0) - (xs[a] ?? 0);
      const uy = (ys[b] ?? 0) - (ys[a] ?? 0);
      const uz = (zs[b] ?? 0) - (zs[a] ?? 0);
      const vx = (xs[c] ?? 0) - (xs[a] ?? 0);
      const vy = (ys[c] ?? 0) - (ys[a] ?? 0);
      const vz = (zs[c] ?? 0) - (zs[a] ?? 0);
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const size = Math.hypot(nx, ny, nz);
      if (size < 1e-14) continue;
      nx /= size;
      ny /= size;
      nz /= size;
      const face = faces.length;
      faces.push({ a, b, c, nx, ny, nz, up: nz > FACING_EPS, part: partIndex });
      for (const [p, q] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const) {
        const key = p < q ? `${p}|${q}` : `${q}|${p}`;
        const list = edges.get(key);
        if (list) list.push(face);
        else edges.set(key, [face]);
      }
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < xs.length; i += 1) {
    minX = Math.min(minX, xs[i] ?? 0);
    maxX = Math.max(maxX, xs[i] ?? 0);
    minY = Math.min(minY, ys[i] ?? 0);
    maxY = Math.max(maxY, ys[i] ?? 0);
    maxZ = Math.max(maxZ, zs[i] ?? 0);
  }
  if (xs.length === 0) {
    return {
      fill: new Float32Array(0),
      lines: new Float32Array(0),
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      maxZ: 0,
      shading: [],
      lineGroups: [],
    };
  }

  // Máscara: faces voltadas para cima, indexadas em uma grade para o teste de ocultação.
  const upFaces = faces.filter((f) => f.up);
  const fill = new Float32Array(upFaces.length * 6);
  const cells = Math.min(96, Math.max(4, Math.round(Math.sqrt(upFaces.length))));
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);
  const grid: number[][] = Array.from({ length: cells * cells }, () => []);
  const cellOf = (value: number, min: number, span: number): number =>
    Math.min(cells - 1, Math.max(0, Math.floor(((value - min) / span) * cells)));
  upFaces.forEach((f, i) => {
    const ax = xs[f.a] ?? 0;
    const ay = ys[f.a] ?? 0;
    const bx = xs[f.b] ?? 0;
    const by = ys[f.b] ?? 0;
    const cx = xs[f.c] ?? 0;
    const cy = ys[f.c] ?? 0;
    fill.set([ax, ay, bx, by, cx, cy], i * 6);
    const x0 = cellOf(Math.min(ax, bx, cx), minX, spanX);
    const x1 = cellOf(Math.max(ax, bx, cx), minX, spanX);
    const y0 = cellOf(Math.min(ay, by, cy), minY, spanY);
    const y1 = cellOf(Math.max(ay, by, cy), minY, spanY);
    for (let gy = y0; gy <= y1; gy += 1) {
      for (let gx = x0; gx <= x1; gx += 1) grid[gy * cells + gx]?.push(i);
    }
  });

  const diagonal = Math.hypot(spanX, spanY);
  const zTolerance = Math.max(diagonal * 2e-4, 2e-5);
  /** Há uma face voltada para cima estritamente acima do ponto? */
  const hidden = (x: number, y: number, z: number): boolean => {
    const bucket = grid[cellOf(y, minY, spanY) * cells + cellOf(x, minX, spanX)];
    if (!bucket) return false;
    for (const i of bucket) {
      const f = upFaces[i];
      if (!f) continue;
      const ax = xs[f.a] ?? 0;
      const ay = ys[f.a] ?? 0;
      const bx = xs[f.b] ?? 0;
      const by = ys[f.b] ?? 0;
      const cx = xs[f.c] ?? 0;
      const cy = ys[f.c] ?? 0;
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(det) < 1e-18) continue;
      const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
      const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
      const w = 1 - u - v;
      // Estritamente dentro: a própria face vizinha da aresta não a esconde.
      if (u < 1e-4 || v < 1e-4 || w < 1e-4) continue;
      const zFace = u * (zs[f.a] ?? 0) + v * (zs[f.b] ?? 0) + w * (zs[f.c] ?? 0);
      if (zFace > z + zTolerance) return true;
    }
    return false;
  };

  const lines: number[] = [];
  const linesByRole = new Map<PartRole, number[]>();
  const step = Math.max(diagonal / 48, 1e-6);
  for (const [key, list] of edges) {
    const first = faces[list[0] ?? 0];
    const second = faces[list[1] ?? 0];
    if (!first) continue;
    let visible: boolean;
    if (list.length === 1) visible = true;
    else if (list.length === 2 && second) {
      if (first.up !== second.up) visible = true;
      else if (!first.up) visible = false;
      else {
        visible = first.nx * second.nx + first.ny * second.ny + first.nz * second.nz < CREASE_COS;
      }
    } else visible = list.some((i) => faces[i]?.up);
    if (!visible) continue;

    const [p, q] = key.split('|').map(Number);
    if (p === undefined || q === undefined) continue;
    const x1 = xs[p] ?? 0;
    const y1 = ys[p] ?? 0;
    const z1 = zs[p] ?? 0;
    const x2 = xs[q] ?? 0;
    const y2 = ys[q] ?? 0;
    const z2 = zs[q] ?? 0;
    const planLength = Math.hypot(x2 - x1, y2 - y1);
    if (planLength < 1e-7) continue; // aresta vertical: um ponto em planta
    // Os vértices são soldados por parte: toda aresta pertence a uma única parte.
    const role = geometry.parts[first.part]?.role ?? 'body';
    let group = linesByRole.get(role);
    if (!group) {
      group = [];
      linesByRole.set(role, group);
    }
    const shownAt = (t: number): boolean =>
      !hidden(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, z1 + (z2 - z1) * t);
    /**
     * Ponto em que a aresta passa de visível a oculta (ou o contrário), entre duas amostras:
     * a bisseção leva o corte ao lugar exato, sem a folga de meio passo da amostragem.
     */
    const boundary = (tShown: number, tHidden: number): number => {
      let a = tShown;
      let b = tHidden;
      for (let k = 0; k < 14; k += 1) {
        const mid = (a + b) / 2;
        if (shownAt(mid)) a = mid;
        else b = mid;
      }
      return (a + b) / 2;
    };
    const pieces = Math.min(32, Math.max(1, Math.ceil(planLength / step)));
    const sample = (i: number): number => (i + 0.5) / pieces;
    let runStart = -1;
    for (let i = 0; i <= pieces; i += 1) {
      const shown = i < pieces && shownAt(sample(i));
      if (shown && runStart < 0) {
        runStart = i === 0 ? 0 : boundary(sample(i), sample(i - 1));
      }
      if (!shown && runStart >= 0) {
        const runEnd = i === pieces ? 1 : boundary(sample(i - 1), sample(i));
        const segment = [
          x1 + (x2 - x1) * runStart,
          y1 + (y2 - y1) * runStart,
          x1 + (x2 - x1) * runEnd,
          y1 + (y2 - y1) * runEnd,
        ];
        lines.push(...segment);
        group.push(...segment);
        runStart = -1;
      }
    }
  }

  // Sombreamento por parte: os triângulos são desenhados de baixo para cima (algoritmo do
  // pintor, pela cota do centro), em sequências contíguas do mesmo papel. Nenhum é descartado:
  // decidir por amostragem que um triângulo está encoberto abre furos nos maiores.
  const shaded: { role: PartRole; z: number; index: number }[] = upFaces.map((f, index) => ({
    role: geometry.parts[f.part]?.role ?? 'body',
    z: ((zs[f.a] ?? 0) + (zs[f.b] ?? 0) + (zs[f.c] ?? 0)) / 3,
    index,
  }));
  shaded.sort((p, q) => p.z - q.z || p.index - q.index);
  const shading: PlanShade[] = [];
  let run: number[] = [];
  let runRole: PartRole | null = null;
  const flush = (): void => {
    if (runRole !== null && run.length > 0) {
      shading.push({ role: runRole, fill: new Float32Array(run) });
    }
    run = [];
  };
  for (const entry of shaded) {
    if (entry.role !== runRole) {
      flush();
      runRole = entry.role;
    }
    for (let k = 0; k < 6; k += 1) run.push(fill[entry.index * 6 + k] ?? 0);
  }
  flush();

  return {
    fill,
    lines: new Float32Array(lines),
    minX,
    minY,
    maxX,
    maxY,
    maxZ,
    shading,
    lineGroups: [...linesByRole].map(([role, group]) => ({ role, lines: new Float32Array(group) })),
  };
}
