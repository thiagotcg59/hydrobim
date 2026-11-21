import type { Vec3 } from '../math';
import { fail, ok, type DomainError, type Result } from '../result';
import type { Platform, Point2, Terrain } from '../schema';
import {
  constrainedDelaunay,
  EDGE_BOUNDARY,
  EDGE_BREAKLINE,
  type ConstraintEdge,
} from './delaunay';
import { distanceToRings, pointInRing, validatePolygon } from './polygon';
import { terrainHitAt, terrainStats, terrainTrianglesIn } from './surface';

/**
 * Terreno projetado: a superfície natural modificada pelos platôs.
 *
 * Cada platô é uma área plana na cota de implantação, ligada ao terreno existente por taludes
 * de inclinação constante. De cada ponto do perímetro sai, na direção normal ao lado, uma
 * linha de maior declive do talude (subindo no corte, descendo no aterro); ela termina onde
 * encontra o terreno — a interseção é exata, calculada trecho a trecho sobre os triângulos
 * atravessados. Nos cantos salientes as linhas abrem em leque (o talude é um trecho de cone,
 * a única forma de manter a inclinação constante em volta de um canto); nos cantos reentrantes
 * os dois taludes se encontram em uma aresta sobre a bissetriz. Onde o terreno cruza a cota do
 * platô ao longo do perímetro, o talude tem altura zero e muda de corte para aterro.
 *
 * A superfície é refeita só na região alcançada: os triângulos tocados saem e a região é
 * triangulada de novo (Delaunay com restrições) com o perímetro, as linhas de talude e a
 * linha de encontro com o terreno como arestas obrigatórias. Fora dela, a malha é idêntica à
 * do terreno recebido — a continuidade é exata, sem deslocar vértices.
 *
 * Os platôs são aplicados em sequência: o segundo encontra o terreno já modificado pelo
 * primeiro. A superfície natural nunca é alterada.
 */

/** Arredondamento das coordenadas dos vértices criados: 0,1 mm (o mesmo da superfície). */
const round = (value: number): number => Math.round(value * 1e4) / 1e4;
/** Desnível (m) abaixo do qual o perímetro está "no terreno": o talude tem altura zero. */
const LEVEL_TOLERANCE = 1e-6;
/** Linha de talude mais curta que isto (m) não é criada. */
const MIN_RAY = 1e-3;
/** Separação mínima (m) entre pontos do perímetro. */
const MIN_SPACING = 1e-3;
/** Abertura máxima entre duas linhas de talude no leque de um canto saliente. */
const FAN_STEP = Math.PI / 24;
/** Distância (m) até a qual um vértice do terreno é absorvido por uma aresta obrigatória. */
const ABSORB = 1e-3;
/** Folga (m) na contagem das distâncias ao longo de um segmento. */
const EPS = 1e-7;

interface Span {
  readonly d0: number;
  readonly z0: number;
  readonly d1: number;
  readonly z1: number;
}

/**
 * Perfil da superfície ao longo do segmento p → q: trechos contíguos (distância em metros
 * desde p e cota), um por triângulo atravessado, e a distância em que a superfície acaba
 * (`gapAt`; `null` = o segmento inteiro está sobre ela).
 */
function spansAlong(
  surface: Terrain,
  p: Point2,
  q: Point2,
): { spans: Span[]; gapAt: number | null; length: number } {
  const { points, triangles } = surface;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-12) return { spans: [], gapAt: null, length: 0 };
  const pieces: Span[] = [];
  const seen = new Set<number>();
  terrainTrianglesIn(
    surface,
    Math.min(p.x, q.x),
    Math.min(p.y, q.y),
    Math.max(p.x, q.x),
    Math.max(p.y, q.y),
    (t) => {
      if (seen.has(t)) return;
      seen.add(t);
      const a = points[triangles[3 * t] as number];
      const b = points[triangles[3 * t + 1] as number];
      const c = points[triangles[3 * t + 2] as number];
      if (!a || !b || !c) return;
      let t0 = 0;
      let t1 = 1;
      const sides = [a, b, c, a];
      for (let i = 0; i < 3; i += 1) {
        const u = sides[i] as Vec3;
        const v = sides[i + 1] as Vec3;
        const o0 = (v.x - u.x) * (p.y - u.y) - (v.y - u.y) * (p.x - u.x);
        const o1 = (v.x - u.x) * (q.y - u.y) - (v.y - u.y) * (q.x - u.x);
        if (o0 < 0 && o1 < 0) return;
        if (o0 < 0) t0 = Math.max(t0, o0 / (o0 - o1));
        else if (o1 < 0) t1 = Math.min(t1, o0 / (o0 - o1));
      }
      if (t1 - t0 <= 1e-12) return;
      const d = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(d) < 1e-14) return;
      const gx = ((b.z - a.z) * (c.y - a.y) - (c.z - a.z) * (b.y - a.y)) / d;
      const gy = ((c.z - a.z) * (b.x - a.x) - (b.z - a.z) * (c.x - a.x)) / d;
      const z = (t: number): number => a.z + gx * (p.x + t * dx - a.x) + gy * (p.y + t * dy - a.y);
      pieces.push({ d0: t0 * length, z0: z(t0), d1: t1 * length, z1: z(t1) });
    },
  );
  pieces.sort((m, n) => m.d0 - n.d0 || m.d1 - n.d1);
  const spans: Span[] = [];
  let cursor = 0;
  for (const piece of pieces) {
    if (piece.d1 <= cursor + EPS) continue;
    if (piece.d0 > cursor + EPS) break;
    let { d0, z0 } = piece;
    if (d0 < cursor) {
      z0 += ((cursor - d0) / (piece.d1 - d0)) * (piece.z1 - z0);
      d0 = cursor;
    }
    spans.push({ d0, z0, d1: piece.d1, z1: piece.z1 });
    cursor = piece.d1;
  }
  return { spans, gapAt: cursor < length - EPS ? cursor : null, length };
}

/**
 * Distância, a partir de `p` na direção `dir`, em que a linha de talude (cota `level` em p,
 * variando `rate` metros por metro) encontra a superfície; `null` quando a superfície acaba
 * antes. `sign` = +1 no corte (o terreno começa acima da linha) e −1 no aterro.
 */
function daylightDistance(
  surface: Terrain,
  p: Point2,
  dir: Point2,
  level: number,
  rate: number,
  sign: 1 | -1,
  firstReach: number,
  maxReach: number,
): number | null {
  let from = 0;
  let step = Math.max(firstReach, 0.05);
  while (from < maxReach) {
    const to = from + step;
    const { spans, gapAt } = spansAlong(
      surface,
      { x: p.x + dir.x * from, y: p.y + dir.y * from },
      { x: p.x + dir.x * to, y: p.y + dir.y * to },
    );
    for (const span of spans) {
      const g0 = sign * (span.z0 - (level + rate * (from + span.d0)));
      const g1 = sign * (span.z1 - (level + rate * (from + span.d1)));
      if (g1 > 0) continue;
      if (g0 <= 0) return from + span.d0;
      return from + span.d0 + (g0 / (g0 - g1)) * (span.d1 - span.d0);
    }
    if (gapAt !== null) return null;
    from = to;
    step *= 2;
  }
  return null;
}

function segmentPointDistance(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const cross = (o: Point2, a: Point2, b: Point2): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function segmentsDistance(a: Point2, b: Point2, c: Point2, d: Point2): number {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return 0;
  }
  return Math.min(
    segmentPointDistance(a, c, d),
    segmentPointDistance(b, c, d),
    segmentPointDistance(c, a, b),
    segmentPointDistance(d, a, b),
  );
}

/** O ponto está no triângulo a, b, c (anti-horário), com folga `tolerance` em metros? */
function pointInTriangle(p: Point2, a: Point2, b: Point2, c: Point2, tolerance: number): boolean {
  const edge = (u: Point2, v: Point2): boolean =>
    cross(u, v, p) >= -tolerance * Math.hypot(v.x - u.x, v.y - u.y);
  return edge(a, b) && edge(b, c) && edge(c, a);
}

function segmentTouchesTriangle(
  p: Point2,
  q: Point2,
  a: Point2,
  b: Point2,
  c: Point2,
  tolerance: number,
): boolean {
  return (
    pointInTriangle(p, a, b, c, tolerance) ||
    pointInTriangle(q, a, b, c, tolerance) ||
    segmentsDistance(p, q, a, b) <= tolerance ||
    segmentsDistance(p, q, b, c) <= tolerance ||
    segmentsDistance(p, q, c, a) <= tolerance
  );
}

/** Ponto do perímetro: cota do terreno existente nele e o lado em que está. */
interface Sample {
  readonly x: number;
  readonly y: number;
  /** Cota da superfície existente. */
  readonly ground: number;
  /** Índice do vértice do perímetro, ou −1 para um ponto no meio de um lado. */
  readonly corner: number;
  /** Lado que começa neste ponto (vértices) ou que o contém. */
  readonly edge: number;
}

/** O que um platô ocupa: perímetro e linha de encontro dos taludes com o terreno. */
export interface PlatformFootprint {
  readonly platformId: string;
  /** Perímetro do platô, na cota de implantação. */
  readonly outline: Vec3[];
  /**
   * Linha de encontro dos taludes com o terreno existente (crista do corte ou pé do aterro),
   * fechada, em volta do platô. Passa pelo próprio perímetro onde o talude tem altura zero.
   */
  readonly daylight: Vec3[];
}

interface Applied {
  readonly surface: Terrain;
  readonly tags: Int32Array;
  readonly footprint: PlatformFootprint;
}

const where = (p: Point2): string => `X ${p.x.toFixed(2)}; Y ${p.y.toFixed(2)}`;

/** Aplica um platô sobre a superfície existente (`tags` = platô de cada triângulo, −1 = natural). */
function applyPlatform(
  surface: Terrain,
  tags: Int32Array,
  platform: Platform,
  platformIndex: number,
): Result<Applied> {
  const checked = validatePolygon([platform.outline]);
  if (!checked.ok) return checked;
  const ring = checked.value[0] as Point2[];
  const level = platform.elevation;
  if (!(platform.cutSlope > 0) || !(platform.fillSlope > 0) || !Number.isFinite(level)) {
    return fail(
      'PLATFORM_PARAMETERS',
      'Informe a cota de implantação e taludes de corte e de aterro maiores que zero.',
    );
  }
  const count = ring.length;
  const stats = terrainStats(surface);
  const maxReach = Math.hypot(stats.maxX - stats.minX, stats.maxY - stats.minY) + 1;
  let perimeter = 0;
  for (let i = 0; i < count; i += 1) {
    const a = ring[i] as Point2;
    const b = ring[(i + 1) % count] as Point2;
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const maxStep = Math.max(perimeter / 96, 0.1);

  // ---- Perímetro: pontos onde ele cruza arestas do terreno, onde o terreno cruza a cota do
  // platô (o talude muda de corte para aterro) e pontos intermediários.
  const samples: Sample[] = [];
  const normals: Point2[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = ring[i] as Point2;
    const b = ring[(i + 1) % count] as Point2;
    const { spans, gapAt, length } = spansAlong(surface, a, b);
    if (gapAt !== null || spans.length === 0) {
      const at = gapAt ?? 0;
      return fail(
        'PLATFORM_OUTSIDE_TERRAIN',
        `O perímetro do platô sai da superfície do terreno perto de ${where({
          x: a.x + ((b.x - a.x) * at) / Math.max(length, 1e-9),
          y: a.y + ((b.y - a.y) * at) / Math.max(length, 1e-9),
        })}. Mantenha o platô sobre a região com dado.`,
      );
    }
    const ux = (b.x - a.x) / length;
    const uy = (b.y - a.y) / length;
    // Perímetro anti-horário: a normal para fora fica à direita do sentido do lado.
    normals.push({ x: uy, y: -ux });
    samples.push({ x: a.x, y: a.y, ground: (spans[0] as Span).z0, corner: i, edge: i });
    const inner: { d: number; z: number }[] = [];
    for (const span of spans) {
      const run = span.d1 - span.d0;
      const at = (d: number): number => span.z0 + ((d - span.d0) / run) * (span.z1 - span.z0);
      const h0 = span.z0 - level;
      const h1 = span.z1 - level;
      if (h0 * h1 < 0 && Math.abs(h0) > LEVEL_TOLERANCE && Math.abs(h1) > LEVEL_TOLERANCE) {
        inner.push({ d: span.d0 + (h0 / (h0 - h1)) * run, z: level });
      }
      const parts = Math.max(1, Math.ceil(run / maxStep));
      for (let k = 1; k <= parts; k += 1) {
        const d = span.d0 + (run * k) / parts;
        inner.push({ d, z: at(d) });
      }
    }
    inner.sort((m, n) => m.d - n.d);
    let last = 0;
    for (const item of inner) {
      if (item.d - last < MIN_SPACING || length - item.d < MIN_SPACING) continue;
      samples.push({
        x: a.x + ux * item.d,
        y: a.y + uy * item.d,
        ground: item.z,
        corner: -1,
        edge: i,
      });
      last = item.d;
    }
  }

  // ---- Vértices e arestas obrigatórias da região refeita.
  const vx: number[] = [];
  const vy: number[] = [];
  const vz: number[] = [];
  /** Índice do vértice do terreno existente que deu origem a cada vértice, ou −1. */
  const origin: number[] = [];
  const byKey = new Map<string, number>();
  const vertex = (x: number, y: number, z: number, from = -1): number => {
    const rx = round(x);
    const ry = round(y);
    const key = `${rx}|${ry}`;
    const existing = byKey.get(key);
    if (existing !== undefined) return existing;
    const index = vx.length;
    byKey.set(key, index);
    vx.push(rx);
    vy.push(ry);
    vz.push(round(z));
    origin.push(from);
    return index;
  };
  const edges: [number, number][] = [];
  const link = (a: number, b: number): void => {
    if (a !== b) edges.push([a, b]);
  };

  const outlineIds = samples.map((s) => vertex(s.x, s.y, level));
  for (let k = 0; k < outlineIds.length; k += 1) {
    link(outlineIds[k] as number, outlineIds[(k + 1) % outlineIds.length] as number);
  }

  const loop: number[] = [];
  const pushLoop = (id: number): void => {
    if (loop[loop.length - 1] !== id) loop.push(id);
  };
  const outlineRing = [ring];

  for (let k = 0; k < samples.length; k += 1) {
    const sample = samples[k] as Sample;
    const id = outlineIds[k] as number;
    const height = sample.ground - level;
    if (Math.abs(height) <= LEVEL_TOLERANCE) {
      pushLoop(id);
      continue;
    }
    const cut = height > 0;
    const slope = cut ? platform.cutSlope : platform.fillSlope;
    const sign: 1 | -1 = cut ? 1 : -1;
    const rate = (cut ? 1 : -1) / slope;
    const reach = Math.abs(height) * slope * 1.5;
    const leaves = (): Result<never> =>
      fail(
        'PLATFORM_SLOPE_OUTSIDE',
        `O talude de ${cut ? 'corte' : 'aterro'} que sai de ${where(sample)} não encontra o terreno dentro da superfície. Aumente a área do terreno, mude a cota ou use um talude mais íngreme.`,
      );

    const next = normals[sample.edge] as Point2;
    let directions: Point2[] = [next];
    if (sample.corner >= 0) {
      const previous = normals[(sample.corner + count - 1) % count] as Point2;
      const turn = previous.x * next.y - previous.y * next.x;
      const angle = Math.atan2(turn, previous.x * next.x + previous.y * next.y);
      if (angle > 1e-6) {
        // Canto saliente: leque de linhas de talude entre as normais dos dois lados (cone).
        const steps = Math.max(1, Math.ceil(angle / FAN_STEP));
        const start = Math.atan2(previous.y, previous.x);
        directions = [];
        for (let s = 0; s <= steps; s += 1) {
          const theta = start + (angle * s) / steps;
          directions.push(
            s === 0 ? previous : s === steps ? next : { x: Math.cos(theta), y: Math.sin(theta) },
          );
        }
      } else if (angle < -1e-6) {
        // Canto reentrante: os taludes dos dois lados se encontram em uma aresta sobre a
        // bissetriz; ao longo dela a distância ao perímetro cresce com o cosseno do meio-ângulo.
        const bx = previous.x + next.x;
        const by = previous.y + next.y;
        const norm = Math.hypot(bx, by);
        if (norm < 1e-6) {
          pushLoop(id);
          continue;
        }
        const bisector = { x: bx / norm, y: by / norm };
        const cosine = bisector.x * next.x + bisector.y * next.y;
        const t = daylightDistance(
          surface,
          sample,
          bisector,
          level,
          rate * cosine,
          sign,
          reach / Math.max(cosine, 0.05),
          maxReach,
        );
        if (t === null) return leaves();
        if (t < MIN_RAY) {
          pushLoop(id);
          continue;
        }
        const end = { x: sample.x + bisector.x * t, y: sample.y + bisector.y * t };
        const distance = t * cosine;
        if (distanceToRings(outlineRing, end.x, end.y) < distance - 1e-6 * (1 + distance)) {
          return fail(
            'PLATFORM_REENTRANT',
            `A reentrância do perímetro perto de ${where(sample)} é estreita demais para os taludes: os de lados opostos se encontram antes de chegar ao terreno. Simplifique o perímetro ou divida o platô em dois.`,
          );
        }
        const endId = vertex(end.x, end.y, level + rate * distance);
        link(id, endId);
        pushLoop(endId);
        continue;
      }
    }

    for (const dir of directions) {
      const d = daylightDistance(surface, sample, dir, level, rate, sign, reach, maxReach);
      if (d === null) return leaves();
      if (d < MIN_RAY) {
        pushLoop(id);
        continue;
      }
      const end = { x: sample.x + dir.x * d, y: sample.y + dir.y * d };
      // Perto de um canto reentrante a linha entraria na faixa do talude do outro lado: ali
      // quem define a superfície é a aresta da bissetriz, e a linha não é criada.
      if (distanceToRings(outlineRing, end.x, end.y) < d - 1e-6 * (1 + d)) continue;
      const endId = vertex(end.x, end.y, level + rate * d);
      link(id, endId);
      pushLoop(endId);
    }
  }
  if (loop.length > 1 && loop[0] === loop[loop.length - 1]) loop.pop();
  const point2 = (id: number): Point2 => ({ x: vx[id] as number, y: vy[id] as number });
  const daylightRing = loop.map(point2);
  const insideDesign = (x: number, y: number): boolean =>
    pointInRing(ring, x, y) || (daylightRing.length >= 3 && pointInRing(daylightRing, x, y));

  // Linha de encontro: entre duas linhas de talude vizinhas ela acompanha o terreno
  // existente, com um vértice (na cota do terreno) em cada aresta atravessada — assim o
  // terreno projetado e o existente coincidem exatamente ao longo dela. Tem de estar inteira
  // sobre a superfície.
  const daylight: number[] = [];
  for (let k = 0; k < loop.length && loop.length > 1; k += 1) {
    const from = loop[k] as number;
    const to = loop[(k + 1) % loop.length] as number;
    const a = point2(from);
    const b = point2(to);
    const { spans, gapAt, length } = spansAlong(surface, a, b);
    if (gapAt !== null && length > EPS) {
      return fail(
        'PLATFORM_SLOPE_OUTSIDE',
        `Os taludes do platô alcançam a borda da superfície do terreno perto de ${where(a)}. Aumente a área do terreno, mude a cota ou use taludes mais íngremes.`,
      );
    }
    daylight.push(from);
    let previous = from;
    let last = 0;
    for (const span of spans) {
      if (span.d1 - last < MIN_SPACING || length - span.d1 < MIN_SPACING) continue;
      const t = span.d1 / length;
      const id = vertex(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, span.z1);
      link(previous, id);
      if (id !== previous) daylight.push(id);
      previous = id;
      last = span.d1;
    }
    link(previous, to);
  }

  // ---- Triângulos existentes tocados pela região do platô e dos taludes.
  const { points, triangles } = surface;
  const triangleCount = Math.floor(triangles.length / 3);
  const marked = new Uint8Array(triangleCount);
  const corner = (t: number, i: number): Vec3 => points[triangles[3 * t + i] as number] as Vec3;
  const segments = edges.map(([a, b]) => [point2(a), point2(b)] as const);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [p, q] of segments) {
    minX = Math.min(minX, p.x, q.x);
    minY = Math.min(minY, p.y, q.y);
    maxX = Math.max(maxX, p.x, q.x);
    maxY = Math.max(maxY, p.y, q.y);
    terrainTrianglesIn(
      surface,
      Math.min(p.x, q.x) - 2 * ABSORB,
      Math.min(p.y, q.y) - 2 * ABSORB,
      Math.max(p.x, q.x) + 2 * ABSORB,
      Math.max(p.y, q.y) + 2 * ABSORB,
      (t) => {
        if (marked[t]) return;
        if (segmentTouchesTriangle(p, q, corner(t, 0), corner(t, 1), corner(t, 2), 2 * ABSORB)) {
          marked[t] = 1;
        }
      },
    );
  }
  terrainTrianglesIn(surface, minX, minY, maxX, maxY, (t) => {
    if (marked[t]) return;
    const a = corner(t, 0);
    const b = corner(t, 1);
    const c = corner(t, 2);
    if (insideDesign((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3)) marked[t] = 1;
  });

  // Borda da região removida: arestas de triângulos marcados sem outro triângulo marcado.
  const vertexCount = points.length;
  const edgeUse = new Map<number, number>();
  let removedArea = 0;
  const removed: number[] = [];
  for (let t = 0; t < triangleCount; t += 1) {
    if (!marked[t]) continue;
    removed.push(t);
    const a = corner(t, 0);
    const b = corner(t, 1);
    const c = corner(t, 2);
    removedArea += Math.abs(cross(a, b, c)) / 2;
    for (let i = 0; i < 3; i += 1) {
      const u = triangles[3 * t + i] as number;
      const v = triangles[3 * t + ((i + 1) % 3)] as number;
      const key = u < v ? u * vertexCount + v : v * vertexCount + u;
      edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
    }
  }
  if (removed.length === 0) {
    return fail('PLATFORM_OUTSIDE_TERRAIN', 'O platô não está sobre a superfície do terreno.');
  }
  const rim = new Set<number>();
  const rimEdges: [number, number][] = [];
  for (const [key, uses] of edgeUse) {
    if (uses !== 1) continue;
    const u = Math.floor(key / vertexCount);
    const v = key % vertexCount;
    rim.add(u);
    rim.add(v);
    rimEdges.push([u, v]);
  }

  // Vértices do terreno na região: os de dentro do platô e dos taludes saem (a superfície
  // ali é a projetada); os demais ficam, com a cota que têm.
  const absorbed = (p: Point2): boolean => {
    if (insideDesign(p.x, p.y)) return true;
    for (const [a, b] of segments) {
      if (segmentPointDistance(p, a, b) <= ABSORB) return true;
    }
    return false;
  };
  const naturalIds = new Map<number, number>();
  const seenVertex = new Set<number>();
  for (const t of removed) {
    for (let i = 0; i < 3; i += 1) {
      const v = triangles[3 * t + i] as number;
      if (seenVertex.has(v)) continue;
      seenVertex.add(v);
      const p = points[v] as Vec3;
      if (absorbed(p)) {
        if (rim.has(v)) {
          return fail(
            'PLATFORM_SLOPE_OUTSIDE',
            `O platô ou os taludes alcançam a borda da superfície do terreno (ou uma região sem dado) perto de ${where(p)}.`,
          );
        }
        continue;
      }
      naturalIds.set(v, vertex(p.x, p.y, p.z, v));
    }
  }

  const constraints: ConstraintEdge[] = [];
  for (const [u, v] of rimEdges) {
    constraints.push({
      a: naturalIds.get(u) as number,
      b: naturalIds.get(v) as number,
      kind: EDGE_BOUNDARY,
    });
  }
  for (const [a, b] of edges) constraints.push({ a, b, kind: EDGE_BREAKLINE });
  const cdt = constrainedDelaunay(vx, vy, constraints);
  const clash = cdt.conflicts[0];
  if (clash) {
    return fail(
      'PLATFORM_GEOMETRY',
      `Não foi possível gerar os taludes do platô perto de ${where(clash)}: as linhas de talude se cruzam. Simplifique o perímetro ou ajuste a cota e os taludes.`,
    );
  }
  let filledArea = 0;
  for (let i = 0; i + 2 < cdt.triangles.length; i += 3) {
    filledArea +=
      Math.abs(
        cross(
          point2(cdt.triangles[i] as number),
          point2(cdt.triangles[i + 1] as number),
          point2(cdt.triangles[i + 2] as number),
        ),
      ) / 2;
  }
  if (Math.abs(filledArea - removedArea) > 1e-6 * removedArea + 1e-6) {
    return fail(
      'PLATFORM_GEOMETRY',
      'A região do platô não pôde ser triangulada de forma consistente com o terreno em volta. Ajuste o perímetro, a cota ou os taludes.',
    );
  }

  // ---- Superfície resultante: triângulos não tocados + região refeita.
  const outPoints: Vec3[] = [];
  const outTriangles: number[] = [];
  const outTags: number[] = [];
  const oldMap = new Int32Array(vertexCount).fill(-1);
  const newMap = new Int32Array(vx.length).fill(-1);
  const fromOld = (v: number): number => {
    let mapped = oldMap[v] as number;
    if (mapped < 0) {
      mapped = outPoints.length;
      oldMap[v] = mapped;
      outPoints.push(points[v] as Vec3);
    }
    return mapped;
  };
  const fromNew = (v: number): number => {
    const source = origin[v] as number;
    if (source >= 0) return fromOld(source);
    let mapped = newMap[v] as number;
    if (mapped < 0) {
      mapped = outPoints.length;
      newMap[v] = mapped;
      outPoints.push({ x: vx[v] as number, y: vy[v] as number, z: vz[v] as number });
    }
    return mapped;
  };
  for (let t = 0; t < triangleCount; t += 1) {
    if (marked[t]) continue;
    outTriangles.push(
      fromOld(triangles[3 * t] as number),
      fromOld(triangles[3 * t + 1] as number),
      fromOld(triangles[3 * t + 2] as number),
    );
    outTags.push(tags[t] as number);
  }
  for (let i = 0; i + 2 < cdt.triangles.length; i += 3) {
    const a = cdt.triangles[i] as number;
    const b = cdt.triangles[i + 1] as number;
    const c = cdt.triangles[i + 2] as number;
    const pa = point2(a);
    const pb = point2(b);
    const pc = point2(c);
    if (Math.abs(cross(pa, pb, pc)) < 1e-12) continue;
    const cx = (pa.x + pb.x + pc.x) / 3;
    const cy = (pa.y + pb.y + pc.y) / 3;
    let tag = platformIndex;
    if (!insideDesign(cx, cy)) {
      // Faixa entre os taludes e a borda da região refeita: continua sendo o que era.
      const hit = terrainHitAt(surface, cx, cy);
      tag = hit ? (tags[hit.triangle] as number) : -1;
    }
    outTriangles.push(fromNew(a), fromNew(b), fromNew(c));
    outTags.push(tag);
  }

  return ok({
    surface: { ...surface, points: outPoints, triangles: outTriangles },
    tags: Int32Array.from(outTags),
    footprint: {
      platformId: platform.id,
      outline: outlineIds.map((id) => ({ x: vx[id] as number, y: vy[id] as number, z: level })),
      daylight: (daylight.length > 0 ? daylight : loop).map((id) => ({
        x: vx[id] as number,
        y: vy[id] as number,
        z: vz[id] as number,
      })),
    },
  });
}

export interface PlatformFailure {
  readonly platformId: string;
  readonly error: DomainError;
}

export interface DesignSurface {
  /**
   * Terreno projetado (malha derivada; a identificação é a da superfície natural). Sem platôs
   * aplicados, é a própria superfície natural.
   */
  readonly terrain: Terrain;
  /** Por triângulo do terreno projetado: índice do platô (em `platforms`) ou −1 = natural. */
  readonly tags: Int32Array;
  /** Platôs aplicados, na ordem; `index` é a posição em `platforms` (o valor em `tags`). */
  readonly footprints: readonly (PlatformFootprint & { readonly index: number })[];
  /** Platôs que não puderam ser aplicados, com o motivo. */
  readonly failures: readonly PlatformFailure[];
}

/**
 * Terreno projetado pelos platôs, aplicados em ordem sobre a superfície natural. Um platô que
 * não pode ser gerado (fora da superfície, talude que não encontra o terreno…) fica de fora,
 * com o motivo em `failures`; os demais são aplicados.
 */
export function buildDesignSurface(
  natural: Terrain,
  platforms: readonly Platform[],
): DesignSurface {
  let surface = natural;
  let tags: Int32Array = new Int32Array(Math.floor(natural.triangles.length / 3)).fill(-1);
  const footprints: (PlatformFootprint & { index: number })[] = [];
  const failures: PlatformFailure[] = [];
  platforms.forEach((platform, index) => {
    const applied = applyPlatform(surface, tags, platform, index);
    if (!applied.ok) {
      failures.push({ platformId: platform.id, error: applied.error });
      return;
    }
    surface = applied.value.surface;
    tags = applied.value.tags;
    footprints.push({ ...applied.value.footprint, index });
  });
  return { terrain: surface, tags, footprints, failures };
}

const designCache = new WeakMap<Terrain, WeakMap<readonly Platform[], DesignSurface>>();

/** `buildDesignSurface` com memória: o projeto é imutável, e a mesma entrada dá o mesmo objeto. */
export function designSurfaceFor(natural: Terrain, platforms: readonly Platform[]): DesignSurface {
  let byPlatforms = designCache.get(natural);
  if (!byPlatforms) {
    byPlatforms = new WeakMap();
    designCache.set(natural, byPlatforms);
  }
  let design = byPlatforms.get(platforms);
  if (!design) {
    design = buildDesignSurface(natural, platforms);
    byPlatforms.set(platforms, design);
  }
  return design;
}
