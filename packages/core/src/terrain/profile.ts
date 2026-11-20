import { fail, ok, type Result } from '../result';
import type { Point2, Terrain } from '../schema';
import { terrainTrianglesIn } from './surface';

/**
 * Corte longitudinal do terreno ao longo de uma poligonal em planta. O perfil é exato para o
 * TIN: há uma estaca em cada aresta da malha atravessada, com a cota interpolada nessa aresta.
 * Fora da superfície (ou dentro de um furo) o perfil é interrompido — nenhuma cota é
 * extrapolada.
 */

export interface TerrainProfileStation {
  /** Distância acumulada em planta (m). */
  readonly chainage: number;
  readonly x: number;
  readonly y: number;
  /** Cota do terreno (m); `null` = sem superfície neste ponto. */
  readonly elevation: number | null;
}

export interface TerrainProfile {
  readonly stations: TerrainProfileStation[];
  /** Comprimento da poligonal em planta (m). */
  readonly length: number;
  /** Parte do comprimento que está sobre a superfície (m). */
  readonly coveredLength: number;
  /** Comprimento medido sobre o terreno, somando os desníveis (m). */
  readonly surfaceLength: number;
  readonly minElevation: number | null;
  readonly maxElevation: number | null;
}

interface Piece {
  t0: number;
  t1: number;
  z0: number;
  z1: number;
}

export function terrainProfile(terrain: Terrain, path: readonly Point2[]): Result<TerrainProfile> {
  if (path.length < 2) {
    return fail('PROFILE_PATH', 'O corte precisa de ao menos dois pontos.');
  }
  const { points, triangles } = terrain;
  const stations: TerrainProfileStation[] = [];
  const stamp = new Int32Array(Math.floor(triangles.length / 3)).fill(-1);
  let offset = 0;
  let covered = 0;
  let surfaceLength = 0;
  let minElevation = Infinity;
  let maxElevation = -Infinity;
  const push = (chainage: number, x: number, y: number, elevation: number | null): void => {
    const previous = stations[stations.length - 1];
    if (
      previous &&
      Math.abs(previous.chainage - chainage) < 1e-7 &&
      (previous.elevation === null) === (elevation === null)
    ) {
      return;
    }
    stations.push({ chainage, x, y, elevation });
    if (elevation !== null) {
      minElevation = Math.min(minElevation, elevation);
      maxElevation = Math.max(maxElevation, elevation);
    }
  };

  for (let s = 0; s + 1 < path.length; s += 1) {
    const p = path[s] as Point2;
    const q = path[s + 1] as Point2;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) continue;
    const pieces: Piece[] = [];
    terrainTrianglesIn(
      terrain,
      Math.min(p.x, q.x),
      Math.min(p.y, q.y),
      Math.max(p.x, q.x),
      Math.max(p.y, q.y),
      (t) => {
        if (stamp[t] === s) return;
        stamp[t] = s;
        const a = points[triangles[3 * t] as number];
        const b = points[triangles[3 * t + 1] as number];
        const c = points[triangles[3 * t + 2] as number];
        if (!a || !b || !c) return;
        // Recorte do segmento pelos três lados do triângulo (anti-horário).
        let t0 = 0;
        let t1 = 1;
        const sides = [a, b, c, a];
        for (let i = 0; i < 3; i += 1) {
          const u = sides[i] as typeof a;
          const v = sides[i + 1] as typeof a;
          const o0 = (v.x - u.x) * (p.y - u.y) - (v.y - u.y) * (p.x - u.x);
          const o1 = (v.x - u.x) * (q.y - u.y) - (v.y - u.y) * (q.x - u.x);
          if (o0 < 0 && o1 < 0) return;
          if (o0 < 0) t0 = Math.max(t0, o0 / (o0 - o1));
          else if (o1 < 0) t1 = Math.min(t1, o0 / (o0 - o1));
        }
        if (t1 - t0 <= 1e-12) return;
        // Plano do triângulo: z = a.z + gx (x − a.x) + gy (y − a.y).
        const d = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        if (Math.abs(d) < 1e-14) return;
        const gx = ((b.z - a.z) * (c.y - a.y) - (c.z - a.z) * (b.y - a.y)) / d;
        const gy = ((c.z - a.z) * (b.x - a.x) - (b.z - a.z) * (c.x - a.x)) / d;
        const z = (t: number): number =>
          a.z + gx * (p.x + t * dx - a.x) + gy * (p.y + t * dy - a.y);
        pieces.push({ t0, t1, z0: z(t0), z1: z(t1) });
      },
    );
    pieces.sort((m, n) => m.t0 - n.t0 || m.t1 - n.t1);

    const at = (t: number, elevation: number | null): void =>
      push(offset + t * length, p.x + t * dx, p.y + t * dy, elevation);
    const epsilon = 1e-9;
    let cursor = 0;
    for (const piece of pieces) {
      if (piece.t1 <= cursor + epsilon) continue;
      let { t0, z0 } = piece;
      if (t0 > cursor + epsilon) {
        // Lacuna: trecho sem superfície entre `cursor` e o início deste pedaço.
        at(cursor, null);
        at(t0, null);
      } else if (t0 < cursor) {
        // Sobreposição (segmento sobre uma aresta comum a dois triângulos).
        z0 += ((cursor - t0) / (piece.t1 - t0)) * (piece.z1 - z0);
        t0 = cursor;
      }
      at(t0, z0);
      at(piece.t1, piece.z1);
      const run = (piece.t1 - t0) * length;
      covered += run;
      surfaceLength += Math.hypot(run, piece.z1 - z0);
      cursor = piece.t1;
    }
    if (cursor < 1 - epsilon) {
      at(cursor, null);
      at(1, null);
    }
    offset += length;
  }

  if (offset < 1e-9) return fail('PROFILE_PATH', 'Os pontos do corte coincidem.');
  if (covered <= 0) {
    return fail('PROFILE_OUTSIDE', 'O corte não passa sobre a superfície do terreno.');
  }
  return ok({
    stations,
    length: offset,
    coveredLength: covered,
    surfaceLength,
    minElevation: Number.isFinite(minElevation) ? minElevation : null,
    maxElevation: Number.isFinite(maxElevation) ? maxElevation : null,
  });
}
