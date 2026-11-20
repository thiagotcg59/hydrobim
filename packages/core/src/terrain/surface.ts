import type { Vec3 } from '../math';
import { fail, ok, type Result } from '../result';
import type { Point2, Terrain, TerrainSource } from '../schema';
import {
  constrainedDelaunay,
  EDGE_BOUNDARY,
  EDGE_BREAKLINE,
  type ConstraintEdge,
} from './delaunay';
import { distanceToRings, pointInPolygon } from './polygon';

/**
 * Construção da superfície do terreno (TIN) a partir de pontos cotados, de um limite
 * (contorno e furos) e de linhas de quebra. A triangulação é restrita: nenhum triângulo fica
 * fora do contorno ou dentro de um furo, e nenhum atravessa uma linha de quebra.
 *
 * As cotas dos vértices são sempre dados de entrada. Este módulo não interpola, não suaviza e
 * não cria pontos: quem chama fornece as cotas do limite (ver `dem.ts` e `clipSurvey`).
 */

/**
 * Limite de vértices de uma superfície. O projeto é gravado em JSON (inclusive no
 * armazenamento do navegador, com cota de poucos megabytes): 25 mil vértices ocupam cerca de
 * 2 MB.
 */
export const MAX_TERRAIN_VERTICES = 25_000;

export interface SurfaceInput {
  readonly name: string;
  readonly points: readonly Vec3[];
  /** Anéis 3D do limite (contorno externo e furos), já cotados; `null` = envoltória convexa. */
  readonly boundary: readonly (readonly Vec3[])[] | null;
  readonly breaklines: readonly (readonly Vec3[])[];
  readonly source: TerrainSource;
  /**
   * Distância mínima (m) entre um ponto e o limite: pontos mais próximos são descartados para
   * não gerar triângulos-agulha junto ao contorno. 0 = nenhum descarte.
   */
  readonly clearance?: number;
  /** Devolve `false` para triângulos sobre região sem dado (lacunas do DEM): são removidos. */
  readonly keepTriangle?: (x: number, y: number) => boolean;
  readonly maxVertices?: number;
}

export interface SurfaceReport {
  /** Pontos fundidos por coincidirem em planta (tolerância de 0,1 mm). */
  readonly duplicates: number;
  /** Pontos fora do limite ou junto demais dele. */
  readonly outside: number;
  /** Trechos de linhas de quebra descartados por saírem do limite. */
  readonly breaklineSegmentsDropped: number;
  /** Triângulos removidos por estarem sobre região sem dado. */
  readonly trianglesWithoutData: number;
}

export interface BuiltSurface {
  readonly terrain: Terrain;
  readonly report: SurfaceReport;
}

/** Arredondamento das coordenadas gravadas: 0,1 mm. */
const round = (value: number): number => Math.round(value * 1e4) / 1e4;

export function buildTerrainSurface(input: SurfaceInput): Result<BuiltSurface> {
  const maxVertices = input.maxVertices ?? MAX_TERRAIN_VERTICES;
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const byKey = new Map<string, number>();
  let duplicates = 0;
  /** Índice do vértice em (x, y); o primeiro a chegar define a cota. */
  const vertex = (p: Vec3, countDuplicate: boolean): number => {
    const x = round(p.x);
    const y = round(p.y);
    const key = `${x}|${y}`;
    const existing = byKey.get(key);
    if (existing !== undefined) {
      if (countDuplicate) duplicates += 1;
      return existing;
    }
    const index = xs.length;
    byKey.set(key, index);
    xs.push(x);
    ys.push(y);
    zs.push(round(p.z));
    return index;
  };

  const rings2d: Point2[][] | null =
    input.boundary?.map((ring) => ring.map((p) => ({ x: round(p.x), y: round(p.y) }))) ?? null;
  const constraints: ConstraintEdge[] = [];

  // Limite: os vértices dos anéis são vértices da superfície, com as cotas fornecidas.
  const boundary: Vec3[][] = [];
  if (input.boundary) {
    for (const ring of input.boundary) {
      if (ring.length < 3) {
        return fail('TERRAIN_BOUNDARY_INVALID', 'Cada anel do limite precisa de três vértices.');
      }
      const ids = ring.map((p) => vertex(p, false));
      for (let i = 0; i < ids.length; i += 1) {
        const a = ids[i] as number;
        const b = ids[(i + 1) % ids.length] as number;
        if (a !== b) constraints.push({ a, b, kind: EDGE_BOUNDARY });
      }
      boundary.push(ring.map((p) => ({ x: round(p.x), y: round(p.y), z: round(p.z) })));
    }
  }

  const inside = (p: Vec3): boolean =>
    rings2d === null ||
    byKey.has(`${round(p.x)}|${round(p.y)}`) ||
    pointInPolygon(rings2d, p.x, p.y);

  // Linhas de quebra: só os trechos com as duas pontas dentro do limite.
  const breaklines: Vec3[][] = [];
  let breaklineSegmentsDropped = 0;
  for (const line of input.breaklines) {
    let current: Vec3[] = [];
    const flush = (): void => {
      if (current.length >= 2) breaklines.push(current);
      current = [];
    };
    let previousIndex = -1;
    let previousInside = true;
    for (let i = 0; i < line.length; i += 1) {
      const p = line[i] as Vec3;
      if (!inside(p)) {
        // O trecho que chega a este ponto e o que sai dele ficam fora da superfície.
        if (i > 0 && previousInside) breaklineSegmentsDropped += 1;
        previousInside = false;
        previousIndex = -1;
        flush();
        continue;
      }
      if (i > 0 && !previousInside) breaklineSegmentsDropped += 1;
      previousInside = true;
      const index = vertex(p, false);
      if (index === previousIndex) continue;
      if (previousIndex >= 0) {
        constraints.push({ a: previousIndex, b: index, kind: EDGE_BREAKLINE });
      }
      previousIndex = index;
      current.push({ x: round(p.x), y: round(p.y), z: zs[index] as number });
    }
    flush();
  }

  // Pontos cotados.
  const clearance = input.clearance ?? 0;
  let outside = 0;
  for (const p of input.points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
    if (rings2d) {
      const known = byKey.has(`${round(p.x)}|${round(p.y)}`);
      if (!known) {
        if (!pointInPolygon(rings2d, p.x, p.y)) {
          outside += 1;
          continue;
        }
        if (clearance > 0 && distanceToRings(rings2d, p.x, p.y) < clearance) {
          outside += 1;
          continue;
        }
      }
    }
    vertex(p, true);
  }

  if (xs.length < 3) {
    return fail(
      'TERRAIN_TOO_FEW',
      'São necessários ao menos três pontos cotados distintos dentro da área.',
    );
  }
  if (xs.length > maxVertices) {
    return fail(
      'TERRAIN_TOO_MANY',
      `A superfície teria ${xs.length.toLocaleString('pt-BR')} vértices; o limite é ${maxVertices.toLocaleString('pt-BR')}. Reduza a área ou a densidade dos dados.`,
    );
  }

  const cdt = constrainedDelaunay(xs, ys, constraints);
  const clash = cdt.conflicts[0];
  if (clash) {
    const where = `X ${clash.x.toFixed(2)}; Y ${clash.y.toFixed(2)}`;
    if (clash.kind === EDGE_BREAKLINE && (clash.crossedKind & EDGE_BOUNDARY) !== 0) {
      return fail(
        'TERRAIN_BREAKLINE_OUTSIDE',
        `Uma linha de quebra atravessa o limite da área perto de ${where}. Corte-a no limite.`,
      );
    }
    if (clash.kind === EDGE_BREAKLINE) {
      return fail(
        'TERRAIN_BREAKLINE_CROSSING',
        `Duas linhas de quebra se cruzam perto de ${where} sem um vértice comum. Divida-as no cruzamento, com a mesma cota: a cota do ponto de cruzamento não pode ser presumida.`,
      );
    }
    return fail(
      'TERRAIN_BOUNDARY_INVALID',
      `O limite da área não pôde ser respeitado perto de ${where} (lados que se cruzam ou se tocam).`,
    );
  }

  // Triângulos sobre região sem dado saem; os vértices que ficarem sem uso também.
  const kept: number[] = [];
  let trianglesWithoutData = 0;
  for (let i = 0; i + 2 < cdt.triangles.length; i += 3) {
    const a = cdt.triangles[i] as number;
    const b = cdt.triangles[i + 1] as number;
    const c = cdt.triangles[i + 2] as number;
    if (input.keepTriangle) {
      const x = ((xs[a] as number) + (xs[b] as number) + (xs[c] as number)) / 3;
      const y = ((ys[a] as number) + (ys[b] as number) + (ys[c] as number)) / 3;
      if (!input.keepTriangle(x, y)) {
        trianglesWithoutData += 1;
        continue;
      }
    }
    kept.push(a, b, c);
  }
  if (kept.length === 0) {
    return fail(
      'TERRAIN_DEGENERATE',
      trianglesWithoutData > 0
        ? 'A fonte não tem dado de elevação dentro da área escolhida.'
        : 'Não foi possível triangular os pontos (são colineares?).',
    );
  }
  const remap = new Int32Array(xs.length).fill(-1);
  const points: Vec3[] = [];
  const triangles: number[] = [];
  for (const index of kept) {
    let mapped = remap[index] as number;
    if (mapped < 0) {
      mapped = points.length;
      remap[index] = mapped;
      points.push({ x: xs[index] as number, y: ys[index] as number, z: zs[index] as number });
    }
    triangles.push(mapped);
  }

  return ok({
    terrain: {
      name: input.name,
      points,
      triangles,
      boundary: input.boundary ? boundary : null,
      breaklines,
      source: input.source,
    },
    report: { duplicates, outside, breaklineSegmentsDropped, trianglesWithoutData },
  });
}

// ---------------------------------------------------------------------------
// Consulta: cota, declividade e estatísticas
// ---------------------------------------------------------------------------

interface TerrainIndex {
  readonly minX: number;
  readonly minY: number;
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  /** Lista de triângulos por célula, em formato compacto (início de cada célula e itens). */
  readonly starts: Int32Array;
  readonly items: Int32Array;
}

// O projeto é imutável: o índice vale enquanto o objeto do terreno for o mesmo.
const indexCache = new WeakMap<Terrain, TerrainIndex>();

function indexOf(terrain: Terrain): TerrainIndex {
  const cached = indexCache.get(terrain);
  if (cached) return cached;
  const { points, triangles } = terrain;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const count = Math.floor(triangles.length / 3);
  const width = Math.max(maxX - minX, 1e-9);
  const height = Math.max(maxY - minY, 1e-9);
  // Cerca de dois triângulos por célula.
  const cell = Math.max(Math.sqrt((width * height) / Math.max(count / 2, 1)), 1e-9);
  const cols = Math.max(1, Math.min(2048, Math.ceil(width / cell)));
  const rows = Math.max(1, Math.min(2048, Math.ceil(height / cell)));
  const size = Math.max(width / cols, height / rows);
  const col = (x: number): number => Math.min(cols - 1, Math.max(0, Math.floor((x - minX) / size)));
  const row = (y: number): number => Math.min(rows - 1, Math.max(0, Math.floor((y - minY) / size)));
  const counts = new Int32Array(cols * rows + 1);
  const span = (t: number): [number, number, number, number] | null => {
    const a = points[triangles[3 * t] as number];
    const b = points[triangles[3 * t + 1] as number];
    const c = points[triangles[3 * t + 2] as number];
    if (!a || !b || !c) return null;
    return [
      col(Math.min(a.x, b.x, c.x)),
      col(Math.max(a.x, b.x, c.x)),
      row(Math.min(a.y, b.y, c.y)),
      row(Math.max(a.y, b.y, c.y)),
    ];
  };
  for (let t = 0; t < count; t += 1) {
    const box = span(t);
    if (!box) continue;
    for (let r = box[2]; r <= box[3]; r += 1) {
      for (let c = box[0]; c <= box[1]; c += 1)
        counts[r * cols + c + 1] = (counts[r * cols + c + 1] as number) + 1;
    }
  }
  for (let i = 1; i < counts.length; i += 1)
    counts[i] = (counts[i] as number) + (counts[i - 1] as number);
  const items = new Int32Array(counts[counts.length - 1] as number);
  const cursor = counts.slice(0, cols * rows);
  for (let t = 0; t < count; t += 1) {
    const box = span(t);
    if (!box) continue;
    for (let r = box[2]; r <= box[3]; r += 1) {
      for (let c = box[0]; c <= box[1]; c += 1) {
        const k = r * cols + c;
        items[cursor[k] as number] = t;
        cursor[k] = (cursor[k] as number) + 1;
      }
    }
  }
  const index: TerrainIndex = { minX, minY, cell: size, cols, rows, starts: counts, items };
  indexCache.set(terrain, index);
  return index;
}

/** Triângulos cujas caixas tocam a janela dada (pode repetir índices). */
export function terrainTrianglesIn(
  terrain: Terrain,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  visit: (triangle: number) => void,
): void {
  const index = indexOf(terrain);
  const c0 = Math.max(0, Math.floor((minX - index.minX) / index.cell));
  const c1 = Math.min(index.cols - 1, Math.floor((maxX - index.minX) / index.cell));
  const r0 = Math.max(0, Math.floor((minY - index.minY) / index.cell));
  const r1 = Math.min(index.rows - 1, Math.floor((maxY - index.minY) / index.cell));
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) {
      const k = r * index.cols + c;
      for (let i = index.starts[k] as number; i < (index.starts[k + 1] as number); i += 1) {
        visit(index.items[i] as number);
      }
    }
  }
}

export interface TerrainHit {
  /** Índice do triângulo (posição em `triangles` ÷ 3). */
  readonly triangle: number;
  readonly elevation: number;
  /** Declividade do triângulo (m/m): módulo do gradiente. */
  readonly slope: number;
  /**
   * Direção de maior descida, em radianos a partir do eixo Y local, sentido horário; `null` em
   * triângulo horizontal.
   */
  readonly downslope: number | null;
}

/** Triângulo sob (x, y), com a cota interpolada no plano dele; `null` fora da superfície. */
export function terrainHitAt(terrain: Terrain, x: number, y: number): TerrainHit | null {
  const { points, triangles } = terrain;
  const index = indexOf(terrain);
  const tolerance = 1e-9;
  if (
    x < index.minX - tolerance ||
    y < index.minY - tolerance ||
    x > index.minX + index.cols * index.cell + tolerance ||
    y > index.minY + index.rows * index.cell + tolerance
  ) {
    return null;
  }
  const c = Math.min(index.cols - 1, Math.max(0, Math.floor((x - index.minX) / index.cell)));
  const r = Math.min(index.rows - 1, Math.max(0, Math.floor((y - index.minY) / index.cell)));
  const k = r * index.cols + c;
  for (let i = index.starts[k] as number; i < (index.starts[k + 1] as number); i += 1) {
    const t = index.items[i] as number;
    const a = points[triangles[3 * t] as number];
    const b = points[triangles[3 * t + 1] as number];
    const q = points[triangles[3 * t + 2] as number];
    if (!a || !b || !q) continue;
    const d = (b.y - q.y) * (a.x - q.x) + (q.x - b.x) * (a.y - q.y);
    if (Math.abs(d) < 1e-14) continue;
    const u = ((b.y - q.y) * (x - q.x) + (q.x - b.x) * (y - q.y)) / d;
    const v = ((q.y - a.y) * (x - q.x) + (a.x - q.x) * (y - q.y)) / d;
    const w = 1 - u - v;
    if (u < -1e-9 || v < -1e-9 || w < -1e-9) continue;
    // Gradiente do plano do triângulo.
    const gx = ((b.y - q.y) * (a.z - q.z) + (q.y - a.y) * (b.z - q.z)) / d;
    const gy = ((q.x - b.x) * (a.z - q.z) + (a.x - q.x) * (b.z - q.z)) / d;
    const slope = Math.hypot(gx, gy);
    return {
      triangle: t,
      elevation: u * a.z + v * b.z + w * q.z,
      slope,
      downslope: slope > 1e-12 ? (Math.atan2(-gx, -gy) + 2 * Math.PI) % (2 * Math.PI) : null,
    };
  }
  return null;
}

/** Cota do terreno em (x, y); `null` fora da superfície (nenhuma cota é extrapolada). */
export function terrainElevationAt(terrain: Terrain, x: number, y: number): number | null {
  return terrainHitAt(terrain, x, y)?.elevation ?? null;
}

export interface TerrainStats {
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Área em planta (m²). */
  readonly planArea: number;
  /** Área da superfície inclinada (m²). */
  readonly surfaceArea: number;
  /** Declividade média ponderada pela área em planta (m/m). */
  readonly meanSlope: number;
  readonly maxSlope: number;
}

const statsCache = new WeakMap<Terrain, TerrainStats>();

export function terrainStats(terrain: Terrain): TerrainStats {
  const cached = statsCache.get(terrain);
  if (cached) return cached;
  const { points, triangles } = terrain;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  let planArea = 0;
  let surfaceArea = 0;
  let weighted = 0;
  let maxSlope = 0;
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const a = points[triangles[i] as number];
    const b = points[triangles[i + 1] as number];
    const c = points[triangles[i + 2] as number];
    if (!a || !b || !c) continue;
    // Normal não unitária: metade do módulo é a área; a componente Z, a área em planta.
    const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const plan = Math.abs(nz) / 2;
    if (plan < 1e-12) continue;
    const slope = Math.hypot(nx, ny) / Math.abs(nz);
    planArea += plan;
    surfaceArea += Math.hypot(nx, ny, nz) / 2;
    weighted += slope * plan;
    if (slope > maxSlope) maxSlope = slope;
  }
  const stats: TerrainStats = {
    vertexCount: points.length,
    triangleCount: Math.floor(triangles.length / 3),
    minX,
    minY,
    maxX,
    maxY,
    minZ,
    maxZ,
    planArea,
    surfaceArea,
    meanSlope: planArea > 0 ? weighted / planArea : 0,
    maxSlope,
  };
  statsCache.set(terrain, stats);
  return stats;
}
