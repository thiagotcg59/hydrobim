import type { Point2 } from '../schema';
import { constrainedDelaunay, EDGE_BOUNDARY, type ConstraintEdge } from '../terrain/delaunay';
import { ringArea, type Ring } from '../terrain/polygon';

/**
 * Geometria plana usada pela arquitetura: perímetro, interseção de retas e triangulação de
 * polígonos com furos (lajes, revestimentos e ambientes).
 */

export const sub2 = (a: Point2, b: Point2): Point2 => ({ x: a.x - b.x, y: a.y - b.y });
export const add2 = (a: Point2, b: Point2): Point2 => ({ x: a.x + b.x, y: a.y + b.y });
export const scale2 = (a: Point2, s: number): Point2 => ({ x: a.x * s, y: a.y * s });
export const dot2 = (a: Point2, b: Point2): number => a.x * b.x + a.y * b.y;
export const cross2 = (a: Point2, b: Point2): number => a.x * b.y - a.y * b.x;
export const length2 = (a: Point2): number => Math.hypot(a.x, a.y);
export const distance2 = (a: Point2, b: Point2): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Perímetro de um anel fechado (m). */
export function ringPerimeter(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    sum += distance2(ring[i] as Point2, ring[(i + 1) % ring.length] as Point2);
  }
  return sum;
}

/** Centro de área de um anel (para rótulos); a média dos vértices se a área for nula. */
export function ringCentroid(ring: Ring): Point2 {
  const area = ringArea(ring);
  if (Math.abs(area) < 1e-12) {
    const n = Math.max(1, ring.length);
    return ring.reduce<Point2>((acc, p) => ({ x: acc.x + p.x / n, y: acc.y + p.y / n }), {
      x: 0,
      y: 0,
    });
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i] as Point2;
    const q = ring[(i + 1) % ring.length] as Point2;
    const w = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * w;
    cy += (p.y + q.y) * w;
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/** Interseção das retas (p + t·d) e (q + s·e); `null` quando (quase) paralelas. */
export function intersectLines(p: Point2, d: Point2, q: Point2, e: Point2): Point2 | null {
  const denom = cross2(d, e);
  if (Math.abs(denom) < 1e-9 * Math.max(1, length2(d) * length2(e))) return null;
  const t = cross2(sub2(q, p), e) / denom;
  return add2(p, scale2(d, t));
}

/**
 * Triangula um polígono com furos pela triangulação de Delaunay com restrições do terreno
 * (`constrainedDelaunay`): os lados do contorno e dos furos são arestas obrigatórias e só
 * ficam os triângulos de dentro. Devolve os vértices (contorno e furos, na ordem recebida) e
 * os índices, três por triângulo, em sentido anti-horário.
 */
export function triangulatePolygon(
  outer: Ring,
  holes: readonly Ring[] = [],
): { points: Point2[]; triangles: number[] } {
  const points: Point2[] = [];
  const constraints: ConstraintEdge[] = [];
  for (const ring of [outer, ...holes]) {
    const first = points.length;
    for (let i = 0; i < ring.length; i += 1) {
      const p = ring[i] as Point2;
      points.push({ x: p.x, y: p.y });
      constraints.push({
        a: first + i,
        b: first + ((i + 1) % ring.length),
        kind: EDGE_BOUNDARY,
      });
    }
  }
  const { triangles } = constrainedDelaunay(
    points.map((p) => p.x),
    points.map((p) => p.y),
    constraints,
  );
  return { points, triangles };
}

/** Soma das áreas dos triângulos (conferência da triangulação). */
export function triangulatedArea(points: readonly Point2[], triangles: readonly number[]): number {
  let sum = 0;
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const a = points[triangles[t] as number] as Point2;
    const b = points[triangles[t + 1] as number] as Point2;
    const c = points[triangles[t + 2] as number] as Point2;
    sum += cross2(sub2(b, a), sub2(c, a)) / 2;
  }
  return sum;
}
