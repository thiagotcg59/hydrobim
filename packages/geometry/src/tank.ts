import {
  cross,
  normalize,
  scale,
  sub,
  TANK_DISPLAY_THICKNESS,
  tankLayout,
  tankRadiusAt,
  vec3,
  type Tank,
  type TankLayout,
  type Vec3,
} from '@hydrobim/core';
import type { MeshPart, PartRole } from './elements';
import { box, loft, type ProfilePoint } from './loft';
import { cylinder, torus, X, Z } from './primitives';
import { mapMesh } from './skin';
import type { MeshData } from './sweep';

/**
 * Geometria dos reservatórios metálicos por forma construtiva (taça, tubular, australiano,
 * vertical apoiado, fundo cônico com pés, montado na obra e horizontal).
 *
 * Referencial local: base em z = 0, eixo vertical em Z; no horizontal o eixo do cilindro é X.
 *
 * VEM DOS PARÂMETROS (catálogo ou usuário): diâmetro, altura total, altura da coluna, altura
 * dos pés, comprimento. É REPRESENTAÇÃO, lida das imagens do fabricante: espessura das
 * chapas quando não informada, cobertura plana, anel de base, escada, gaiola, guarda-corpo,
 * boca de visita, perfil dos pés, berços, ondas da chapa corrugada e revestimento interno.
 * O topo do costado fica exatamente na altura total; guarda-corpo e escada passam dela.
 */

// Dimensões de representação dos acessórios (m).
const LADDER_WIDTH = 0.45;
const LADDER_STANDOFF = 0.2;
const RUNG_SPACING = 0.3;
const RUNG_RADIUS = 0.012;
const CAGE_RADIUS = 0.35;
const CAGE_START = 2.1;
const HOOP_SPACING = 0.9;
const BRACE_SPACING = 2;
const RAIL_TUBE = 0.02;
const POST_SPACING = 1.1;
const MANHOLE_RADIUS = 0.3;
/** Chapa corrugada: passo e meia profundidade da onda. */
const CORRUGATION_PITCH = 0.076;
const CORRUGATION_AMPLITUDE = 0.009;

/** Une várias malhas em uma só (uma única chamada de desenho e uma só entidade no IFC). */
export function mergeMeshes(meshes: readonly MeshData[]): MeshData {
  let vertexCount = 0;
  let indexCount = 0;
  for (const mesh of meshes) {
    vertexCount += mesh.positions.length;
    indexCount += mesh.indices.length;
  }
  const positions = new Float32Array(vertexCount);
  const normals = new Float32Array(vertexCount);
  const indices = new Uint32Array(indexCount);
  let v = 0;
  let i = 0;
  for (const mesh of meshes) {
    positions.set(mesh.positions, v);
    normals.set(mesh.normals, v);
    const base = v / 3;
    for (let k = 0; k < mesh.indices.length; k += 1) indices[i + k] = (mesh.indices[k] ?? 0) + base;
    v += mesh.positions.length;
    i += mesh.indices.length;
  }
  return { positions, normals, indices };
}

const rotateZ = (mesh: MeshData, angle: number): MeshData => {
  if (angle === 0) return mesh;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const turn = (p: Vec3): Vec3 => vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
  return mapMesh(mesh, turn, turn);
};

const translate = (mesh: MeshData, delta: Vec3): MeshData =>
  mapMesh(
    mesh,
    (p) => vec3(p.x + delta.x, p.y + delta.y, p.z + delta.z),
    (d) => d,
  );

/** Ponto de um perfil de revolução: [posição no eixo, raio, superfície suave?]. */
type Turn = readonly [number, number, boolean?];

/**
 * Casca de revolução fechada: o contorno externo é percorrido no sentido do eixo e as
 * cavidades, de volta — o mesmo percurso de perfil fechado usado nos condutos, que dá as
 * normais para fora do material nas duas faces da chapa.
 */
function revolve(
  loops: readonly (readonly Turn[])[],
  segments: number,
  axis: 'z' | 'x' = 'z',
  offset = 0,
): MeshData {
  const points: ProfilePoint[] = [];
  for (const loop of loops) {
    for (const [h, radius, smooth] of loop) {
      points.push({
        center: axis === 'z' ? vec3(0, 0, h) : vec3(h, 0, offset),
        tangent: axis === 'z' ? Z : X,
        radius,
        crease: !smooth,
      });
    }
  }
  return loft(points, { up: axis === 'z' ? X : Z, radialSegments: segments });
}

/** Tubo fino ao longo de uma poligonal (aros da gaiola, corrimãos). */
function tube(path: readonly Vec3[], radius: number, up: Vec3, segments = 6): MeshData {
  const points: ProfilePoint[] = [];
  path.forEach((center, index) => {
    const before = path[Math.max(index - 1, 0)] ?? center;
    const after = path[Math.min(index + 1, path.length - 1)] ?? center;
    const tangent = normalize(sub(after, before));
    const end = index === 0 || index === path.length - 1;
    if (index === 0) points.push({ center, tangent, radius: 0 });
    points.push({ center, tangent, radius, crease: end });
    if (index === path.length - 1) points.push({ center, tangent, radius: 0 });
  });
  return loft(points, { up, radialSegments: segments });
}

/**
 * Chapa plana: polígono convexo no plano radial (r, z) de azimute zero, com a espessura
 * dividida para os dois lados (direção Y). Faces planas, normais para fora.
 */
function plate(polygon: readonly (readonly [number, number])[], thickness: number): MeshData {
  const half = thickness / 2;
  const front = polygon.map(([r, z]) => vec3(r, half, z));
  const back = polygon.map(([r, z]) => vec3(r, -half, z));
  const count = polygon.length;
  const centroid = scale(
    polygon.reduce((sum, [r, z]) => vec3(sum.x + r, 0, sum.z + z), vec3(0, 0, 0)),
    1 / count,
  );
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const face = (corners: readonly Vec3[]): void => {
    const [a, b, c] = corners;
    if (!a || !b || !c) return;
    let normal = normalize(cross(sub(b, a), sub(c, a)));
    const middle = scale(
      corners.reduce((sum, p) => vec3(sum.x + p.x, sum.y + p.y, sum.z + p.z), vec3(0, 0, 0)),
      1 / corners.length,
    );
    const outward = sub(middle, centroid);
    const flip = normal.x * outward.x + normal.y * outward.y + normal.z * outward.z < 0;
    if (flip) normal = scale(normal, -1);
    const base = positions.length / 3;
    for (const p of corners) {
      positions.push(p.x, p.y, p.z);
      normals.push(normal.x, normal.y, normal.z);
    }
    for (let k = 1; k + 1 < corners.length; k += 1) {
      if (flip) indices.push(base, base + k + 1, base + k);
      else indices.push(base, base + k, base + k + 1);
    }
  };
  face(front);
  face(back);
  for (let k = 0; k < count; k += 1) {
    const next = (k + 1) % count;
    const [f0, f1, b0, b1] = [front[k], front[next], back[k], back[next]];
    if (f0 && f1 && b0 && b1) face([f0, f1, b1, b0]);
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

/** Repete uma malha em `count` posições igualmente espaçadas em torno do eixo Z. */
const around = (mesh: MeshData, count: number, start = 0): MeshData[] =>
  Array.from({ length: count }, (_, k) => rotateZ(mesh, start + (k * 2 * Math.PI) / count));

const shellSegments = (radius: number): number => (radius > 4 ? 96 : 64);

// ---------------------------------------------------------------------------
// Acessórios
// ---------------------------------------------------------------------------

interface LadderOptions {
  /** Distância do eixo do reservatório ao plano da escada. */
  readonly reach: number;
  readonly bottom: number;
  /** Topo do costado (último degrau) e topo dos montantes. */
  readonly shellTop: number;
  readonly top: number;
  readonly cage: boolean;
  /** Raio do costado na cota `z`, para os travamentos. */
  readonly wallAt: (z: number) => number;
}

/** Escada tipo marinheiro no azimute zero (plano x = `reach`, degraus ao longo de Y). */
function ladder(options: LadderOptions): MeshData[] {
  const { reach, bottom, shellTop, top } = options;
  const half = LADDER_WIDTH / 2;
  const meshes: MeshData[] = [];
  for (const side of [-1, 1]) {
    const y = side * half;
    meshes.push(box(vec3(reach - 0.03, y - 0.005, bottom), vec3(reach + 0.03, y + 0.005, top)));
  }
  for (let z = bottom + RUNG_SPACING; z <= shellTop + 1e-6; z += RUNG_SPACING) {
    meshes.push(cylinder(vec3(reach, -half, z), vec3(reach, half, z), RUNG_RADIUS, 0, 8));
  }
  // Travamentos horizontais até o costado (na taça, alcançam a coluna).
  const span = shellTop - bottom;
  const braces = Math.max(2, Math.round(span / BRACE_SPACING) + 1);
  for (let k = 0; k < braces; k += 1) {
    const z = bottom + 0.15 + ((span - 0.3) * k) / (braces - 1);
    const wall = options.wallAt(z) - 0.01;
    if (reach - wall < 0.02) continue;
    for (const side of [-1, 1]) {
      meshes.push(
        cylinder(vec3(wall, side * half, z), vec3(reach, side * half, z), RUNG_RADIUS, 0, 8),
      );
    }
  }
  if (options.cage && top - bottom > CAGE_START + HOOP_SPACING) {
    // O aro passa pelos dois montantes e contorna o usuário pelo lado de fora.
    const center = reach + Math.sqrt(CAGE_RADIUS ** 2 - half ** 2);
    const open = Math.atan2(half, reach - center);
    const at = (angle: number, z: number): Vec3 =>
      vec3(center + CAGE_RADIUS * Math.cos(angle), CAGE_RADIUS * Math.sin(angle), z);
    const start = bottom + CAGE_START;
    const hoops = Math.max(2, Math.round((top - start) / HOOP_SPACING) + 1);
    for (let k = 0; k < hoops; k += 1) {
      const z = start + ((top - start) * k) / (hoops - 1);
      const path = Array.from({ length: 25 }, (_, j) => at(open - (2 * open * j) / 24, z));
      meshes.push(tube(path, 0.011, Z));
    }
    for (const fraction of [-0.82, -0.42, 0, 0.42, 0.82]) {
      const angle = open * fraction;
      meshes.push(cylinder(at(angle, start), at(angle, top), 0.008, 0, 6));
    }
  }
  return meshes;
}

/** Guarda-corpo circular sobre a cobertura: montantes, corrimão e travessa intermediária. */
function guardrail(radius: number, base: number, height: number): MeshData[] {
  const posts = Math.max(8, Math.round((2 * Math.PI * radius) / POST_SPACING));
  const post = cylinder(vec3(radius, 0, base), vec3(radius, 0, base + height), RAIL_TUBE, 0, 8);
  return [
    ...around(post, posts, Math.PI / posts),
    torus(vec3(0, 0, base + height), radius, RAIL_TUBE),
    torus(vec3(0, 0, base + height / 2), radius, RAIL_TUBE * 0.8),
  ];
}

/** Boca de visita na cobertura: gola e tampa. */
function roofHatch(center: Vec3): MeshData[] {
  const top = vec3(center.x, center.y, center.z + 0.12);
  return [
    cylinder(center, top, MANHOLE_RADIUS, MANHOLE_RADIUS - 0.006, 32),
    cylinder(top, vec3(top.x, top.y, top.z + 0.012), MANHOLE_RADIUS + 0.03, 0, 32),
  ];
}

/** Boca de visita lateral (pescoço e tampa cega aparafusada), no azimute zero. */
function sideManhole(wallRadius: number, z: number): MeshData {
  return revolveAlongX(wallRadius - 0.03, z, [
    [0, MANHOLE_RADIUS],
    [0.16, MANHOLE_RADIUS],
    [0.16, MANHOLE_RADIUS + 0.06],
    [0.185, MANHOLE_RADIUS + 0.06],
  ]);
}

/** Sólido de revolução em torno de um eixo paralelo a X, a partir de `(x0, 0, z)`. */
function revolveAlongX(x0: number, z: number, profile: readonly Turn[]): MeshData {
  const first = profile[0];
  const last = profile[profile.length - 1];
  if (!first || !last) throw new Error('Perfil vazio.');
  const closed: Turn[] = [[first[0], 0], ...profile, [last[0], 0]];
  return translate(revolve([closed], 32, 'x', 0), vec3(x0, 0, z));
}

/** Anel de base com nervuras, como nas colunas e nos reservatórios tubulares. */
function baseRing(radius: number): MeshData[] {
  const rib = plate(
    [
      [radius, 0.02],
      [radius + 0.11, 0.02],
      [radius, 0.26],
    ],
    0.01,
  );
  return [
    cylinder(vec3(0, 0, 0), vec3(0, 0, 0.02), radius + 0.13, radius - 0.01, 48),
    ...around(rib, 8, Math.PI / 8),
  ];
}

// ---------------------------------------------------------------------------
// Corpos
// ---------------------------------------------------------------------------

/** Cilindro vertical fechado, de fundo plano e cobertura plana. */
function flatCylinder(radius: number, top: number, t: number): MeshData {
  return revolve(
    [
      [
        [0, 0],
        [0, radius],
        [top, radius],
        [top, 0],
      ],
      [
        [top - t, 0],
        [top - t, radius - t],
        [t, radius - t],
        [t, 0],
      ],
    ],
    shellSegments(radius),
  );
}

function gobletShell(l: TankLayout, t: number): MeshData {
  const { radius: R, columnRadius: r, columnHeight: hc, coneHeight: cone, top } = l;
  const outer: Turn[] = [
    [0, 0],
    [0, r],
    [hc, r],
    [hc + cone, R],
    [top, R],
    [top, 0],
  ];
  const bowlTop: Turn[] = [
    [top - t, 0],
    [top - t, R - t],
    [hc + cone, R - t],
  ];
  const cavities: Turn[][] =
    l.type === 'gobletWet'
      ? // Um único volume: taça, transição e coluna.
        [[...bowlTop, [hc, r - t], [t, r - t], [t, 0]]]
      : // Coluna seca: o fundo da taça fecha a transição; a coluna é oca e vazia.
        [
          [...bowlTop, [hc + t, r - t], [hc + t, 0]],
          [
            [hc - t, 0],
            [hc - t, r - t],
            [t, r - t],
            [t, 0],
          ],
        ];
  return revolve([outer, ...cavities], shellSegments(R));
}

function coneBottomShell(l: TankLayout, t: number): MeshData {
  const { radius: R, support: s, coneHeight: cone, top } = l;
  return revolve(
    [
      [
        [s - cone, 0],
        [s, R],
        [top, R],
        [top, 0],
      ],
      [
        [top - t, 0],
        [top - t, R - t],
        [s, R - t],
        [s - cone + t, 0],
      ],
    ],
    shellSegments(R),
  );
}

/** Pé de apoio: chapa vertical sob o costado e nervura que sobe pelo lado de fora. */
function legPlates(radius: number, support: number): MeshData[] {
  return [
    plate(
      [
        [radius - 0.12, 0],
        [radius, 0],
        [radius, support],
        [radius - 0.12, support - 0.02],
      ],
      0.012,
    ),
    plate(
      [
        [radius, 0],
        [radius + 0.05, 0],
        [radius + 0.05, support + 0.25],
        [radius, support + 0.32],
      ],
      0.012,
    ),
    box(vec3(radius - 0.14, -0.09, 0), vec3(radius + 0.08, 0.09, 0.012)),
  ];
}

const legCount = (radius: number, spacing: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round((2 * Math.PI * radius) / spacing)));

/** Costado corrugado aberto, com fundo cônico (uma só chapa, por dentro e por fora). */
function corrugatedShell(l: TankLayout, t: number): MeshData {
  const { radius: R, support: s, coneHeight: cone, top } = l;
  const steps = Math.max(8, Math.round(((top - s) / CORRUGATION_PITCH) * 4));
  const wave = (k: number): number =>
    CORRUGATION_AMPLITUDE * Math.sin((2 * Math.PI * (top - s) * (k / steps)) / CORRUGATION_PITCH);
  const outer: Turn[] = [
    [s - cone, 0],
    [s, R],
  ];
  const inner: Turn[] = [];
  for (let k = 1; k < steps; k += 1) {
    const z = s + ((top - s) * k) / steps;
    outer.push([z, R + wave(k), true]);
    inner.unshift([z, R - t + wave(k), true]);
  }
  return revolve(
    [[...outer, [top, R], [top, R - t], ...inner, [s, R - t], [s - cone + t, 0]]],
    shellSegments(R),
  );
}

/** Revestimento interno do australiano: uma cuba lisa encostada na chapa. */
function linerShell(l: TankLayout, t: number): MeshData {
  const { radius: R, support: s, coneHeight: cone, top } = l;
  const gap = t + CORRUGATION_AMPLITUDE + 0.002;
  const film = 0.003;
  const r = R - gap;
  const rim = top - 0.015;
  return revolve(
    [
      [
        [s - cone + gap, 0],
        [s, r],
        [rim, r],
        [rim, r - film],
        [s + film, r - film],
        [s - cone + gap + film, 0],
      ],
    ],
    shellSegments(R),
  );
}

/** Cilindro horizontal de tampos abaulados (semielipses), com a cavidade interna. */
function horizontalShell(l: TankLayout, t: number): MeshData {
  const { radius: R, length: L, headDepth: hd } = l;
  const axis = l.support + R;
  const head = (radius: number, depth: number, end: number, sign: 1 | -1): Turn[] => {
    // Do polo (sobre o eixo) até a junção com o corpo cilíndrico.
    const points: Turn[] = [];
    for (let k = 0; k <= 8; k += 1) {
      const phi = ((Math.PI / 2) * k) / 8;
      points.push([
        end + sign * depth * (1 - Math.cos(phi)),
        radius * Math.sin(phi),
        k > 0 && k < 8,
      ]);
    }
    return points;
  };
  const outer = [...head(R, hd, -L / 2, 1), ...head(R, hd, L / 2, -1).reverse()];
  const inner = [
    ...head(R - t, hd - t, L / 2 - t, -1),
    ...head(R - t, hd - t, -L / 2 + t, 1).reverse(),
  ];
  return revolve([outer, inner], shellSegments(R), 'x', axis);
}

// ---------------------------------------------------------------------------
// Montagem por forma construtiva
// ---------------------------------------------------------------------------

/** Papel (cor) do corpo: pintura clara, aço aparente ou chapa galvanizada. */
const SHELL_ROLE: Record<TankLayout['type'], PartRole> = {
  generic: 'body',
  gobletWet: 'paint',
  gobletDry: 'paint',
  tubular: 'paint',
  verticalGround: 'paint',
  verticalConeLegs: 'paint',
  fieldErected: 'steel',
  horizontal: 'steel',
  australian: 'galvanized',
};

function verticalAccessories(tank: Tank, l: TankLayout): MeshData[] {
  const accessories = tank.accessories;
  if (!accessories) return [];
  const meshes: MeshData[] = [];
  const railTop = l.top + (accessories.guardrail ? accessories.guardrailHeight : 0.9);
  if (accessories.ladder) {
    meshes.push(
      ...ladder({
        reach: l.radius + LADDER_STANDOFF,
        bottom: 0,
        shellTop: l.top,
        top: railTop,
        cage: accessories.cage,
        wallAt: (z) => (z < l.shellBottom ? l.radius : tankRadiusAt(l, z)),
      }).map((mesh) => rotateZ(mesh, accessories.ladderAzimuth)),
    );
  }
  if (accessories.guardrail) {
    meshes.push(...guardrail(l.radius - 0.05, l.top, accessories.guardrailHeight));
  }
  if (accessories.manhole) {
    // Na cobertura, junto à escada; na lateral, do lado oposto a ela.
    const offset = Math.max(l.radius - MANHOLE_RADIUS - 0.25, 0);
    meshes.push(
      ...roofHatch(vec3(offset, 0, l.top)).map((mesh) => rotateZ(mesh, accessories.ladderAzimuth)),
    );
    const side =
      l.type === 'gobletWet' || l.type === 'gobletDry'
        ? l.columnRadius
        : l.type === 'tubular' || l.type === 'fieldErected'
          ? l.radius
          : 0;
    if (side > MANHOLE_RADIUS + 0.08 && l.top > 2) {
      meshes.push(rotateZ(sideManhole(side, 0.8), accessories.ladderAzimuth + Math.PI));
    }
  }
  return meshes;
}

function horizontalParts(tank: Tank, l: TankLayout, t: number): MeshData[][] {
  const { radius: R, length: L, support: s, headDepth: hd } = l;
  const saddleX = (L / 2 - hd) * 0.62;
  const reachY = 0.6 * R;
  // O berço sobe até tocar o costado na sua borda (cos do ângulo de 0,6·R é 0,8).
  const saddleTop = s + R * 0.2 + 0.02;
  const supports: MeshData[] = [];
  for (const x of [-saddleX, saddleX]) {
    supports.push(
      box(vec3(x - 0.04, -reachY, Math.max(s - 0.02, 0)), vec3(x + 0.04, reachY, saddleTop)),
    );
  }
  if (s > 1e-6) {
    if (tank.supportType === 'legs') {
      for (const x of [-saddleX, saddleX]) {
        for (const y of [-reachY + 0.05, reachY - 0.05]) {
          supports.push(box(vec3(x - 0.04, y - 0.04, 0), vec3(x + 0.04, y + 0.04, s)));
          supports.push(box(vec3(x - 0.09, y - 0.09, 0), vec3(x + 0.09, y + 0.09, 0.012)));
        }
      }
    } else {
      // Longarina: duas vigas ao longo do reservatório, sob os berços.
      const half = Math.min(saddleX + 0.3, L / 2);
      for (const y of [-reachY + 0.06, reachY - 0.06]) {
        supports.push(box(vec3(-half, y - 0.06, 0), vec3(half, y + 0.06, s)));
      }
    }
  }
  const accessories = tank.accessories;
  const extras: MeshData[] = [];
  if (accessories?.manhole) {
    const x = -(L / 2 - hd) * 0.45;
    extras.push(...roofHatch(vec3(x, 0, l.top - 0.03)));
  }
  if (accessories?.ladder) {
    // Na lateral, junto a um dos tampos; os montantes viram corrimãos sobre o costado.
    const side = Math.sin(accessories.ladderAzimuth) >= 0 ? 1 : -1;
    const x = -(L / 2 - hd) + 0.35;
    const y = R + 0.12;
    const arc = 0.4;
    const flat: MeshData[] = [];
    for (const dx of [-LADDER_WIDTH / 2, LADDER_WIDTH / 2]) {
      flat.push(box(vec3(dx - 0.005, y - 0.03, 0), vec3(dx + 0.005, y + 0.03, l.top)));
      const path = Array.from({ length: 13 }, (_, k) => {
        const phi = ((Math.PI / 2) * k) / 12;
        return vec3(dx, y - arc + arc * Math.cos(phi), l.top + arc * Math.sin(phi));
      });
      flat.push(tube([...path, vec3(dx, y - arc - 0.25, l.top + arc)], 0.016, X, 8));
    }
    for (let z = RUNG_SPACING; z <= l.top - 0.1; z += RUNG_SPACING) {
      flat.push(
        cylinder(vec3(-LADDER_WIDTH / 2, y, z), vec3(LADDER_WIDTH / 2, y, z), RUNG_RADIUS, 0, 8),
      );
    }
    extras.push(
      ...flat.map((mesh) =>
        translate(
          side === 1
            ? mesh
            : mapMesh(
                mesh,
                (p) => vec3(p.x, -p.y, p.z),
                (d) => vec3(d.x, -d.y, d.z),
              ),
          vec3(x, 0, 0),
        ),
      ),
    );
  }
  return [[horizontalShell(l, t)], [...supports, ...extras]];
}

/**
 * Partes do reservatório de forma construtiva definida (sem os bocais, que dependem das
 * portas). Devolve `null` para o reservatório genérico.
 */
export function tankParts(tank: Tank): MeshPart[] | null {
  const l = tankLayout(tank);
  if (l.type === 'generic') return null;
  const t = Math.min(tank.shellThickness ?? TANK_DISPLAY_THICKNESS, l.radius * 0.2);
  const role = SHELL_ROLE[l.type];
  const part = (meshes: readonly MeshData[], partRole: PartRole = role): MeshPart[] =>
    meshes.length > 0 ? [{ role: partRole, mesh: mergeMeshes(meshes) }] : [];

  switch (l.type) {
    case 'gobletWet':
    case 'gobletDry':
      return [
        ...part([gobletShell(l, t)]),
        ...part([...baseRing(l.columnRadius), ...verticalAccessories(tank, l)]),
      ];
    case 'tubular':
      return [
        ...part([flatCylinder(l.radius, l.top, t)]),
        ...part([...baseRing(l.radius), ...verticalAccessories(tank, l)]),
      ];
    case 'verticalGround':
    case 'fieldErected':
      return [...part([flatCylinder(l.radius, l.top, t)]), ...part(verticalAccessories(tank, l))];
    case 'verticalConeLegs': {
      const count = legCount(l.radius, 1.6, 4, 12);
      const legs = legPlates(l.radius, l.support).flatMap((mesh) =>
        around(mesh, count, Math.PI / count),
      );
      return [
        ...part([coneBottomShell(l, t)]),
        ...part([...legs, ...verticalAccessories(tank, l)]),
      ];
    }
    case 'australian': {
      const count = legCount(l.radius, 1.5, 6, 48);
      const leg = plate(
        [
          [l.radius, 0],
          [l.radius + 0.09, 0],
          [l.radius + 0.03, l.support + 0.3],
          [l.radius, l.support + 0.3],
        ],
        0.05,
      );
      return [
        ...part([corrugatedShell(l, t), torus(vec3(0, 0, l.top - 0.009), l.radius, 0.009)]),
        ...part(around(leg, count, Math.PI / count)),
        ...part([linerShell(l, t)], 'liner'),
      ];
    }
    case 'horizontal': {
      const [shell, others] = horizontalParts(tank, l, t);
      return [...part(shell ?? []), ...part(others ?? [])];
    }
  }
}
