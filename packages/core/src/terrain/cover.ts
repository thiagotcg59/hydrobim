import type { Vec3 } from '../math';
import type { Terrain } from '../schema';
import { terrainProfile } from './profile';
import { terrainElevationAt } from './surface';

/**
 * Assentamento por recobrimento: cota do eixo de um tubo a partir do terreno e do recobrimento
 * definido pelo projetista, e conferência do recobrimento ao longo de um trecho.
 *
 * Recobrimento é a distância vertical do terreno à geratriz superior externa do tubo. O valor
 * é sempre uma decisão de projeto informada pelo usuário; este módulo não traz mínimos de
 * norma. Fora da superfície não há cota de terreno, e nenhuma é presumida.
 */

/**
 * Cota do eixo para que a geratriz superior fique `cover` metros abaixo do terreno em (x, y);
 * `null` fora da superfície.
 */
export function axisElevationForCover(
  terrain: Terrain,
  x: number,
  y: number,
  cover: number,
  outerDiameter: number,
): number | null {
  const ground = terrainElevationAt(terrain, x, y);
  return ground === null ? null : ground - cover - outerDiameter / 2;
}

export interface SegmentCover {
  /** Menor e maior recobrimento ao longo do trecho (m); negativo = tubo acima do terreno. */
  readonly min: number;
  readonly max: number;
  /** Distância em planta, a partir do início, do ponto de menor recobrimento (m). */
  readonly minAt: number;
  /** Comprimento em planta do trecho (m) e a parte dele que está sob a superfície. */
  readonly length: number;
  readonly coveredLength: number;
}

/**
 * Recobrimento de um trecho reto entre `start` e `end` (pontos do eixo). O tubo é uma reta e o
 * terreno não: o recobrimento é conferido em cada aresta da triangulação atravessada, que é
 * onde ele pode ter um extremo. `null` quando o trecho não passa sob a superfície ou é vertical.
 */
export function coverAlongSegment(
  terrain: Terrain,
  start: Vec3,
  end: Vec3,
  outerDiameter: number,
): SegmentCover | null {
  const profile = terrainProfile(terrain, [
    { x: start.x, y: start.y },
    { x: end.x, y: end.y },
  ]);
  if (!profile.ok) return null;
  const { length, stations, coveredLength } = profile.value;
  let min = Infinity;
  let max = -Infinity;
  let minAt = 0;
  for (const station of stations) {
    if (station.elevation === null) continue;
    const crown = start.z + ((end.z - start.z) * station.chainage) / length + outerDiameter / 2;
    const cover = station.elevation - crown;
    if (cover < min) {
      min = cover;
      minAt = station.chainage;
    }
    if (cover > max) max = cover;
  }
  if (!Number.isFinite(min)) return null;
  return { min, max, minAt, length, coveredLength };
}
