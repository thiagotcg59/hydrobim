import {
  hostWallOf,
  hostedTypeOf,
  layersThickness,
  getArchType,
  QUAT_IDENTITY,
  quatFromAxisAngle,
  ringArea,
  roofFrame,
  roofTypeOf,
  roofUndersideAt,
  roofVerticalRange,
  triangulatePolygon,
  vec3,
  wallAxes,
  wallFaceOffsets,
  wallFootprint,
  wallLength,
  wallOpenings,
  wallTypeOf,
  wallVerticalRange,
  AXIS_Z,
  type ArchElement,
  type DoorType,
  type FloorElement,
  type HostedElement,
  type Point2,
  type Project,
  type Roof,
  type Wall,
  type WindowType,
} from '@hydrobim/core';
import type { ElementGeometry, MeshPart, PartRole } from './elements';
import { box } from './loft';
import type { MeshData } from './sweep';
import { mergeMeshes } from './tank';

/**
 * Malhas dos elementos arquitetônicos, no referencial LOCAL de cada um (como as da rede):
 *  - parede: origem no início da linha de referência, na cota da base; X ao longo da parede,
 *    Y para a face esquerda, Z para cima. Os vãos de portas e janelas são REAIS: a malha é
 *    fechada em torno deles (ombreiras, verga e peitoril);
 *  - laje e revestimento: origem no primeiro vértice do contorno, na cota do topo (laje) ou
 *    da base (revestimento); as aberturas atravessam o elemento;
 *  - telhado: origem no início do lado do beiral, na cota de referência (face inferior sobre a
 *    linha do beiral do contorno); X ao longo do beiral, Y para dentro do contorno (subindo a
 *    água), Z para cima. Corpo fechado: águas planas com a espessura do tipo medida
 *    perpendicularmente e bordas cortadas a prumo;
 *  - porta e janela: referencial da parede hospedeira, com a origem no centro do vão, na
 *    soleira ou no peitoril.
 *
 * Do tipo vêm: espessura (camadas), dimensões do vão, largura do marco e espessura da folha.
 * É REPRESENTAÇÃO (o tipo não tabula): profundidade do marco da janela, espessura do vidro e
 * dos montantes, e a folha desenhada fechada. Ferragens e guarnições não são modeladas.
 */

type Project3 = Pick<Project, 'levels' | 'architecture'>;

/** Espessura do vidro e profundidade mínima do marco usadas na representação (m). */
const GLASS_THICKNESS = 0.006;

class Builder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly indices: number[] = [];

  /** Polígono plano convexo ou triangulado, com a normal dada (vértices anti-horários). */
  face(
    points: readonly (readonly [number, number, number])[],
    triangles?: readonly number[],
    /** Os triângulos estão no sentido contrário ao dos pontos: a normal é a oposta. */
    flipped = false,
  ): void {
    const [a, b, c] = points as [
      readonly [number, number, number],
      readonly [number, number, number],
      readonly [number, number, number],
    ];
    let nx = 0;
    let ny = 0;
    let nz = 0;
    // Normal de Newell: vale para qualquer polígono plano, mesmo com vértices colineares.
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i] as readonly [number, number, number];
      const q = points[(i + 1) % points.length] as readonly [number, number, number];
      nx += (p[1] - q[1]) * (p[2] + q[2]);
      ny += (p[2] - q[2]) * (p[0] + q[0]);
      nz += (p[0] - q[0]) * (p[1] + q[1]);
    }
    const size = (flipped ? -1 : 1) * Math.hypot(nx, ny, nz);
    if (Math.abs(size) < 1e-14 || !a || !b || !c) return;
    const base = this.positions.length / 3;
    for (const p of points) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(nx / size, ny / size, nz / size);
    }
    if (triangles) {
      for (const index of triangles) this.indices.push(base + index);
    } else {
      for (let i = 1; i + 1 < points.length; i += 1)
        this.indices.push(base, base + i, base + i + 1);
    }
  }

  mesh(): MeshData {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      indices: new Uint32Array(this.indices),
    };
  }

  get empty(): boolean {
    return this.indices.length === 0;
  }
}

const part = (role: PartRole, mesh: MeshData): MeshPart => ({ role, mesh });

/**
 * Prisma reto de base poligonal (contorno anti-horário e furos em sentido horário), entre as
 * cotas `z0` e `z1`: tampas trianguladas e uma face lateral por lado.
 */
function prism(
  builder: Builder,
  outer: readonly Point2[],
  holes: readonly (readonly Point2[])[],
  z0: number,
  z1: number,
): void {
  const { points, triangles } = triangulatePolygon(outer, holes);
  builder.face(
    points.map((p) => [p.x, p.y, z1] as const),
    triangles,
  );
  const flipped: number[] = [];
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    flipped.push(triangles[t] as number, triangles[t + 2] as number, triangles[t + 1] as number);
  }
  builder.face(
    points.map((p) => [p.x, p.y, z0] as const),
    flipped,
    true,
  );
  for (const ring of [outer, ...holes]) {
    for (let i = 0; i < ring.length; i += 1) {
      const p = ring[i] as Point2;
      const q = ring[(i + 1) % ring.length] as Point2;
      builder.face([
        [p.x, p.y, z0],
        [q.x, q.y, z0],
        [q.x, q.y, z1],
        [p.x, p.y, z1],
      ]);
    }
  }
}

// ---------------------------------------------------------------------------
// Parede
// ---------------------------------------------------------------------------

function wallGeometry(project: Project3, wall: Wall): ElementGeometry | null {
  const { architecture } = project;
  const type = wallTypeOf(architecture, wall);
  const footprint = wallFootprint(architecture, wall);
  if (!type || !footprint) return null;
  const thickness = layersThickness(type);
  const { lo, hi } = wallFaceOffsets(wall, thickness);
  const { dir, left } = wallAxes(wall);
  const length = wallLength(wall);
  const height = wall.height;
  const local = (p: Point2): Point2 => {
    const dx = p.x - wall.start.x;
    const dy = p.y - wall.start.y;
    return { x: dx * dir.x + dy * dir.y, y: dx * left.x + dy * left.y };
  };
  const polygon = footprint.polygon.map(local);
  const from = Math.min(Math.max(footprint.clear.from, 0), length);
  const to = Math.max(Math.min(footprint.clear.to, length), from);
  const openings = wallOpenings(architecture, wall)
    .map((opening) => ({
      from: Math.max(opening.from, from),
      to: Math.min(opening.to, to),
      bottom: Math.max(opening.bottom, 0),
      top: Math.min(opening.top, height),
    }))
    .filter((opening) => opening.to - opening.from > 1e-6 && opening.top - opening.bottom > 1e-6);

  const unique = (values: number[]): number[] =>
    [...values]
      .sort((a, b) => a - b)
      .filter((v, i, list) => i === 0 || v - (list[i - 1] ?? 0) > 1e-6);
  const xs = unique([from, to, ...openings.flatMap((o) => [o.from, o.to])]);
  const zs = unique([0, height, ...openings.flatMap((o) => [o.bottom, o.top])]);
  const columns = Math.max(0, xs.length - 1);
  const layers = zs.length - 1;
  // Célula (coluna, camada) do trecho de seção completa: maciça salvo dentro de um vão.
  const solid = (column: number, layer: number): boolean => {
    if (column < 0 || column >= columns) return true; // extremidades: sempre maciças
    if (layer < 0 || layer >= layers) return false;
    const x = ((xs[column] ?? 0) + (xs[column + 1] ?? 0)) / 2;
    const z = ((zs[layer] ?? 0) + (zs[layer + 1] ?? 0)) / 2;
    return !openings.some((o) => x > o.from && x < o.to && z > o.bottom && z < o.top);
  };

  const builder = new Builder();
  for (let column = 0; column < columns; column += 1) {
    const x0 = xs[column] ?? 0;
    const x1 = xs[column + 1] ?? 0;
    for (let layer = 0; layer < layers; layer += 1) {
      if (!solid(column, layer)) continue;
      const z0 = zs[layer] ?? 0;
      const z1 = zs[layer + 1] ?? 0;
      builder.face([
        [x0, lo, z0],
        [x1, lo, z0],
        [x1, lo, z1],
        [x0, lo, z1],
      ]);
      builder.face([
        [x1, hi, z0],
        [x0, hi, z0],
        [x0, hi, z1],
        [x1, hi, z1],
      ]);
      if (!solid(column, layer + 1))
        builder.face([
          [x0, lo, z1],
          [x1, lo, z1],
          [x1, hi, z1],
          [x0, hi, z1],
        ]);
      if (!solid(column, layer - 1))
        builder.face([
          [x0, hi, z0],
          [x1, hi, z0],
          [x1, lo, z0],
          [x0, lo, z0],
        ]);
      // Ombreiras dos vãos: só entre colunas do trecho livre (as pontas são sempre maciças).
      if (column > 0 && !solid(column - 1, layer))
        builder.face([
          [x0, hi, z0],
          [x0, lo, z0],
          [x0, lo, z1],
          [x0, hi, z1],
        ]);
      if (column < columns - 1 && !solid(column + 1, layer))
        builder.face([
          [x1, lo, z0],
          [x1, hi, z0],
          [x1, hi, z1],
          [x1, lo, z1],
        ]);
    }
  }

  // Extremidades (cantos em bisel, topo em T ou esquadro): o contorno de cada ponta entre a
  // face da extremidade e o trecho de seção completa.
  const cap = (points: Point2[], interfaceX: number): boolean => {
    if (Math.abs(ringArea(points)) < 1e-10) return false;
    const ring = ringArea(points) > 0 ? points : [...points].reverse();
    const { points: verts, triangles } = triangulatePolygon(ring);
    builder.face(
      verts.map((p) => [p.x, p.y, height] as const),
      triangles,
    );
    const flipped: number[] = [];
    for (let t = 0; t + 2 < triangles.length; t += 3) {
      flipped.push(triangles[t] as number, triangles[t + 2] as number, triangles[t + 1] as number);
    }
    builder.face(
      verts.map((p) => [p.x, p.y, 0] as const),
      flipped,
      true,
    );
    for (let i = 0; i < ring.length; i += 1) {
      const p = ring[i] as Point2;
      const q = ring[(i + 1) % ring.length] as Point2;
      // O lado que encosta no trecho de seção completa é interno: não vira face.
      if (Math.abs(p.x - interfaceX) < 1e-9 && Math.abs(q.x - interfaceX) < 1e-9) continue;
      for (let layer = 0; layer < layers; layer += 1) {
        const z0 = zs[layer] ?? 0;
        const z1 = zs[layer + 1] ?? 0;
        builder.face([
          [p.x, p.y, z0],
          [q.x, q.y, z0],
          [q.x, q.y, z1],
          [p.x, p.y, z1],
        ]);
      }
    }
    return true;
  };
  // Extremidade em esquadro, sem ponta além do trecho de seção completa: só o topo dela.
  const squareEnd = (x: number, column: number, sense: 1 | -1): void => {
    for (let layer = 0; layer < layers; layer += 1) {
      if (!solid(column, layer)) continue;
      const z0 = zs[layer] ?? 0;
      const z1 = zs[layer + 1] ?? 0;
      builder.face(
        sense === 1
          ? [
              [x, lo, z0],
              [x, hi, z0],
              [x, hi, z1],
              [x, lo, z1],
            ]
          : [
              [x, hi, z0],
              [x, lo, z0],
              [x, lo, z1],
              [x, hi, z1],
            ],
      );
    }
  };
  // Os vértices do contorno pertencem a uma ponta ou à outra: o meio da parede os separa.
  const middle = (from + to) / 2;
  const startPoints = polygon.filter((p) => p.x <= middle);
  const endPoints = polygon.filter((p) => p.x > middle);
  const byAngle = (points: Point2[], extra: Point2[]): Point2[] => {
    const all = [...points, ...extra];
    const cx = all.reduce((sum, p) => sum + p.x, 0) / all.length;
    const cy = all.reduce((sum, p) => sum + p.y, 0) / all.length;
    return all.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  };
  if (columns === 0) {
    // Parede sem trecho de seção completa (muito curta entre dois encontros): corpo único.
    const ring = ringArea(polygon) > 0 ? polygon : [...polygon].reverse();
    prism(builder, ring, [], 0, height);
  } else {
    const near = (p: Point2, x: number, y: number): boolean =>
      Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9;
    const corners = (x: number, points: Point2[]): Point2[] =>
      [
        { x, y: lo },
        { x, y: hi },
      ].filter((corner) => !points.some((p) => near(p, corner.x, corner.y)));
    if (!cap(byAngle(startPoints, corners(from, startPoints)), from)) squareEnd(from, 0, -1);
    if (!cap(byAngle(endPoints, corners(to, endPoints)), to)) squareEnd(to, columns - 1, 1);
  }
  if (builder.empty) return null;
  const { base } = wallVerticalRange(project.levels, wall);
  return {
    transform: {
      position: vec3(wall.start.x, wall.start.y, base),
      rotation: quatFromAxisAngle(AXIS_Z, Math.atan2(dir.y, dir.x)),
    },
    parts: [part('wall', builder.mesh())],
  };
}

// ---------------------------------------------------------------------------
// Laje e revestimento de piso
// ---------------------------------------------------------------------------

function floorGeometry(project: Project3, element: FloorElement): ElementGeometry | null {
  const type = getArchType(project.architecture, element.typeId);
  if (!type || (type.category !== 'slab' && type.category !== 'flooring')) return null;
  const origin = element.boundary[0];
  if (!origin) return null;
  const elevation = project.levels.find((level) => level.id === element.levelId)?.elevation ?? 0;
  const thickness = layersThickness(type);
  const local = (ring: readonly Point2[]): Point2[] =>
    ring.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y }));
  const outer = local(element.boundary);
  const holes = element.openings.map((opening) => {
    const ring = local(opening.boundary);
    return ringArea(ring) < 0 ? ring : ring.reverse();
  });
  const builder = new Builder();
  // Laje: do topo para baixo. Revestimento: da base para cima.
  if (element.kind === 'slab') prism(builder, outer, holes, -thickness, 0);
  else prism(builder, outer, holes, 0, thickness);
  if (builder.empty) return null;
  return {
    transform: {
      position: vec3(origin.x, origin.y, elevation + element.offset),
      rotation: QUAT_IDENTITY,
    },
    parts: [part(element.kind === 'slab' ? 'slab' : 'flooring', builder.mesh())],
  };
}

// ---------------------------------------------------------------------------
// Telhado
// ---------------------------------------------------------------------------

/**
 * Corpo do telhado. A seção transversal (perpendicular ao beiral) é uma faixa de espessura
 * vertical constante sobre a face inferior — um paralelogramo por água —, estendida ao longo
 * do beiral. Em duas águas as duas faixas se encontram no plano vertical da cumeeira.
 */
function roofGeometry(project: Project3, roof: Roof): ElementGeometry | null {
  const type = roofTypeOf(project.architecture, roof);
  const frame = type ? roofFrame(roof, type) : null;
  const range = type ? roofVerticalRange(project.levels, roof, type) : null;
  if (!type || !frame || !range) return null;
  const o = frame.overhang;
  const u0 = -o;
  const u1 = frame.length + o;
  // Posições ao longo do vão onde a face inferior muda de plano: beirais e cumeeira.
  const stations = frame.ridge === null ? [-o, frame.span + o] : [-o, frame.ridge, frame.span + o];
  const t = frame.verticalThickness;
  const builder = new Builder();
  for (let i = 0; i + 1 < stations.length; i += 1) {
    const va = stations[i] as number;
    const vb = stations[i + 1] as number;
    const za = roofUndersideAt(frame, va);
    const zb = roofUndersideAt(frame, vb);
    // Face superior (a das telhas) e face inferior da água.
    builder.face([
      [u0, va, za + t],
      [u1, va, za + t],
      [u1, vb, zb + t],
      [u0, vb, zb + t],
    ]);
    builder.face([
      [u0, vb, zb],
      [u1, vb, zb],
      [u1, va, za],
      [u0, va, za],
    ]);
    // Empenas (bordas laterais), a prumo.
    builder.face([
      [u0, va, za],
      [u0, va, za + t],
      [u0, vb, zb + t],
      [u0, vb, zb],
    ]);
    builder.face([
      [u1, vb, zb],
      [u1, vb, zb + t],
      [u1, va, za + t],
      [u1, va, za],
    ]);
  }
  // Bordas dos beirais (a primeira e a última estação), a prumo.
  const first = stations[0] as number;
  const last = stations[stations.length - 1] as number;
  const zFirst = roofUndersideAt(frame, first);
  const zLast = roofUndersideAt(frame, last);
  builder.face([
    [u0, first, zFirst],
    [u1, first, zFirst],
    [u1, first, zFirst + t],
    [u0, first, zFirst + t],
  ]);
  builder.face([
    [u1, last, zLast],
    [u0, last, zLast],
    [u0, last, zLast + t],
    [u1, last, zLast + t],
  ]);
  if (builder.empty) return null;
  return {
    transform: {
      position: vec3(frame.origin.x, frame.origin.y, range.reference),
      rotation: quatFromAxisAngle(AXIS_Z, Math.atan2(frame.along.y, frame.along.x)),
    },
    parts: [part('roof', builder.mesh())],
  };
}

// ---------------------------------------------------------------------------
// Porta e janela
// ---------------------------------------------------------------------------

const block = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): MeshData =>
  box(
    vec3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)),
    vec3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)),
  );

/** Retângulo na elevação da porta: `x` ao longo da parede (0 = centro do vão), `z` da soleira. */
export interface DoorRect {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

/** Porta fechada vista de frente: vão, marco, folhas e frisos (m). */
export interface DoorElevation {
  readonly width: number;
  readonly height: number;
  /** Largura aparente do marco efetivamente desenhada. */
  readonly frame: number;
  readonly leaves: readonly DoorRect[];
  readonly friezes: readonly DoorRect[];
}

/** Folga entre as duas folhas da porta de duas folhas (m), de cada lado do eixo. */
const LEAF_GAP = 0.001;

/**
 * Elevação da porta fechada, derivada do tipo: é a origem única da malha 3D e da prévia 2D.
 * `hand` diz de que lado ficam as dobradiças (os frisos verticais contam a partir delas); na
 * porta de duas folhas as dobradiças são as bordas externas.
 */
export function doorElevation(type: DoorType, hand: 'left' | 'right'): DoorElevation {
  const w = type.width / 2;
  const f = Math.min(type.frameWidth, type.width / 4, type.height / 4);
  const top = type.height - f;
  // Cada folha: borda das dobradiças e borda oposta.
  const spans: (readonly [number, number])[] =
    type.operation === 'doubleSwing'
      ? [
          [-w + f, -LEAF_GAP],
          [w - f, LEAF_GAP],
        ]
      : hand === 'left'
        ? [[-w + f, w - f]]
        : [[w - f, -w + f]];
  const leaves = spans.map(([hinge, lock]) => ({
    x0: Math.min(hinge, lock),
    x1: Math.max(hinge, lock),
    z0: 0,
    z1: top,
  }));
  const friezes: DoorRect[] = [];
  const design = type.leaf;
  if (design) {
    for (const [hinge, lock] of spans) {
      const x0 = Math.min(hinge, lock);
      const x1 = Math.max(hinge, lock);
      const half = Math.min(design.friezeWidth, x1 - x0, top) / 2;
      for (const frieze of design.friezes) {
        if (frieze.orientation === 'horizontal') {
          const z = Math.min(Math.max(frieze.position * top, half), top - half);
          friezes.push({ x0, x1, z0: z - half, z1: z + half });
        } else {
          const x = Math.min(
            Math.max(hinge + (lock - hinge) * frieze.position, x0 + half),
            x1 - half,
          );
          friezes.push({ x0: x - half, x1: x + half, z0: 0, z1: top });
        }
      }
    }
  }
  return { width: type.width, height: type.height, frame: f, leaves, friezes };
}

/**
 * Saliência com que o friso é desenhado sobre as faces da folha (m). É REPRESENTAÇÃO: marca
 * o friso com outro acabamento sem subtrair material da folha; a profundidade real do friso
 * não é dado do tipo.
 */
const FRIEZE_RELIEF = 0.001;

function doorParts(
  type: DoorType,
  lo: number,
  hi: number,
  facing: 1 | -1,
  hand: 'left' | 'right',
): MeshPart[] {
  const w = type.width / 2;
  const h = type.height;
  const elevation = doorElevation(type, hand);
  const f = elevation.frame;
  const frame = mergeMeshes([
    block(-w, -w + f, lo, hi, 0, h),
    block(w - f, w, lo, hi, 0, h),
    block(-w + f, w - f, lo, hi, h - f, h),
  ]);
  const t = Math.min(type.panelThickness, hi - lo);
  // Folha fechada: rente à face para a qual abre; correr e pivotante, no meio da espessura.
  const centred = type.operation === 'sliding' || type.operation === 'pivot';
  const y0 = centred ? (lo + hi - t) / 2 : facing === 1 ? hi - t : lo;
  const leaves = elevation.leaves.map((leaf) =>
    block(leaf.x0, leaf.x1, y0, y0 + t, leaf.z0, leaf.z1),
  );
  const parts = [part('frame', frame), part('joinery', mergeMeshes(leaves))];
  if (elevation.friezes.length > 0) {
    // Os frisos aparecem nas duas faces da folha.
    const strips = elevation.friezes.flatMap((r) => [
      block(r.x0, r.x1, y0 - FRIEZE_RELIEF, y0, r.z0, r.z1),
      block(r.x0, r.x1, y0 + t, y0 + t + FRIEZE_RELIEF, r.z0, r.z1),
    ]);
    parts.push(part('frieze', mergeMeshes(strips)));
  }
  return parts;
}

function windowParts(type: WindowType, lo: number, hi: number): MeshPart[] {
  const w = type.width / 2;
  const f = Math.min(type.frameWidth, type.width / 4, type.height / 4);
  const h = type.height;
  // Marco no meio da espessura da parede, com profundidade igual à largura aparente.
  const depth = Math.min(Math.max(f, GLASS_THICKNESS * 4), hi - lo);
  const y0 = (lo + hi - depth) / 2;
  const y1 = y0 + depth;
  const bars = [
    block(-w, -w + f, y0, y1, 0, h),
    block(w - f, w, y0, y1, 0, h),
    block(-w + f, w - f, y0, y1, 0, f),
    block(-w + f, w - f, y0, y1, h - f, h),
  ];
  const clear = type.width - 2 * f;
  const mullion = f / 2;
  for (let i = 1; i < type.panels; i += 1) {
    const x = -w + f + (clear * i) / type.panels;
    bars.push(block(x - mullion / 2, x + mullion / 2, y0, y1, f, h - f));
  }
  const yg = (lo + hi - GLASS_THICKNESS) / 2;
  const glass = block(-w + f, w - f, yg, yg + GLASS_THICKNESS, f, h - f);
  return [part('frame', mergeMeshes(bars)), part('glass', glass)];
}

function hostedGeometry(project: Project3, element: HostedElement): ElementGeometry | null {
  const { architecture } = project;
  const host = hostWallOf(architecture, element);
  const type = hostedTypeOf(architecture, element);
  const wallType = host ? wallTypeOf(architecture, host) : undefined;
  if (!host || !type || !wallType) return null;
  const { lo, hi } = wallFaceOffsets(host, layersThickness(wallType));
  const { dir } = wallAxes(host);
  const { base } = wallVerticalRange(project.levels, host);
  return {
    transform: {
      position: vec3(
        host.start.x + dir.x * element.offset,
        host.start.y + dir.y * element.offset,
        base + element.sillHeight,
      ),
      rotation: quatFromAxisAngle(AXIS_Z, Math.atan2(dir.y, dir.x)),
    },
    parts:
      type.category === 'door'
        ? doorParts(type, lo, hi, element.facing, element.hand)
        : windowParts(type, lo, hi),
  };
}

/**
 * Geometria 3D de um elemento arquitetônico; `null` para ambientes (não são elementos
 * físicos) e para elementos sem tipo ou hospedeira válidos.
 */
export function buildArchGeometry(project: Project3, element: ArchElement): ElementGeometry | null {
  switch (element.kind) {
    case 'wall':
      return wallGeometry(project, element);
    case 'slab':
    case 'flooring':
      return floorGeometry(project, element);
    case 'roof':
      return roofGeometry(project, element);
    case 'door':
    case 'window':
      return hostedGeometry(project, element);
    case 'space':
      return null;
  }
}

// ---------------------------------------------------------------------------
// Símbolos de planta
// ---------------------------------------------------------------------------

/** Folha aberta e arco de abertura de uma porta, em planta (coordenadas do projeto). */
export interface DoorSwing {
  /** Folha desenhada aberta: do eixo das dobradiças até a ponta. */
  readonly leaf: readonly [Point2, Point2];
  /** Arco percorrido pela ponta da folha; ausente em portas de correr. */
  readonly arc?: {
    readonly center: Point2;
    readonly radius: number;
    /** Ângulos inicial e final (rad), no sentido anti-horário a partir de +X. */
    readonly from: number;
    readonly to: number;
  };
}

/**
 * Símbolo de abertura da porta em planta: uma folha por `DoorSwing` (duas na porta de duas
 * folhas). Giro: folha a 90° e quarto de círculo; pivotante: eixo a um quarto da largura;
 * correr: folha recolhida ao lado do vão, sem arco. É símbolo — a geometria física é a malha.
 */
export function doorSwings(
  project: Project3,
  door: Extract<ArchElement, { kind: 'door' }>,
): DoorSwing[] {
  const { architecture } = project;
  const host = hostWallOf(architecture, door);
  const type = hostedTypeOf(architecture, door);
  const wallType = host ? wallTypeOf(architecture, host) : undefined;
  if (!host || !type || type.category !== 'door' || !wallType) return [];
  const { dir, left } = wallAxes(host);
  const { lo, hi } = wallFaceOffsets(host, layersThickness(wallType));
  const face = door.facing === 1 ? hi : lo;
  const at = (s: number, n: number): Point2 => ({
    x: host.start.x + dir.x * (door.offset + s) + left.x * n,
    y: host.start.y + dir.y * (door.offset + s) + left.y * n,
  });
  const half = type.width / 2 - Math.min(type.frameWidth, type.width / 4);
  const axisAngle = Math.atan2(dir.y, dir.x);
  // Folha com dobradiça em `hinge` (posição ao longo da parede), de comprimento `size`,
  // fechando no sentido `sense` (+1 = para o fim da parede).
  const swing = (hinge: number, size: number, sense: 1 | -1): DoorSwing => {
    const center = at(hinge, face);
    const tip = at(hinge, face + door.facing * size);
    const closed = axisAngle + (sense === 1 ? 0 : Math.PI);
    const open = axisAngle + (door.facing === 1 ? Math.PI / 2 : -Math.PI / 2);
    // O arco vai, no sentido anti-horário, do menor para o maior dos dois ângulos.
    const delta = Math.atan2(Math.sin(open - closed), Math.cos(open - closed));
    return {
      leaf: [center, tip],
      arc: {
        center,
        radius: size,
        from: delta > 0 ? closed : closed + delta,
        to: delta > 0 ? closed + delta : closed,
      },
    };
  };
  const hingeSide = door.hand === 'left' ? -1 : 1;
  switch (type.operation) {
    case 'singleSwing':
      return [swing(hingeSide * half, 2 * half, hingeSide === -1 ? 1 : -1)];
    case 'doubleSwing':
      return [swing(-half, half, 1), swing(half, half, -1)];
    case 'pivot': {
      // Eixo a um quarto da largura: a folha maior abre para a face; a menor, para a oposta.
      const pivot = hingeSide * half * 0.5;
      const long = swing(pivot, half * 1.5, hingeSide === -1 ? 1 : -1);
      return [long];
    }
    case 'sliding': {
      // Folha recolhida sobre a parede, do lado das "dobradiças".
      const middle = (lo + hi) / 2;
      return [{ leaf: [at(hingeSide * half, middle), at(hingeSide * 3 * half, middle)] }];
    }
  }
}
