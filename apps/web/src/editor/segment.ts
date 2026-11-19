import { distance, formatDegrees, formatMeters, type Vec3 } from '@hydrobim/core';

/**
 * Leitura de um trecho em criação: comprimento real, projeção horizontal e desnível são
 * grandezas diferentes e aparecem separadas, para que a cota digitada ou lida não seja
 * confundida (um trecho inclinado de 1,80 m tem 1,50 m em planta).
 */

export interface SegmentReadout {
  /** Comprimento real, medido no espaço (m). */
  readonly length: number;
  /** Projeção horizontal — o que a planta mostra (m). */
  readonly horizontal: number;
  /** Desnível: cota final menos cota inicial (m). */
  readonly rise: number;
}

/** Desnível abaixo do qual o trecho é tratado como horizontal na apresentação (m). */
const LEVEL = 1e-6;

export function segmentReadout(from: Vec3, to: Vec3): SegmentReadout {
  return {
    length: distance(from, to),
    horizontal: Math.hypot(to.x - from.x, to.y - from.y),
    rise: to.z - from.z,
  };
}

/**
 * Rótulo do trecho. Horizontal: só o comprimento. Com desnível: `L` (real), `proj.` (planta)
 * e `ΔZ`; na prumada a projeção é nula e é omitida. `deflection` (rad) é a mudança de direção
 * em relação à porta de partida.
 */
export function formatSegment(from: Vec3, to: Vec3, deflection?: number | null): string {
  const { length, horizontal, rise } = segmentReadout(from, to);
  const parts: string[] = [];
  if (Math.abs(rise) <= LEVEL) parts.push(formatMeters(length, 2));
  else {
    parts.push(`L ${formatMeters(length, 2)}`);
    if (horizontal > LEVEL) parts.push(`proj. ${formatMeters(horizontal, 2)}`);
    parts.push(`ΔZ ${formatMeters(rise, 2)}`);
  }
  if (deflection !== undefined && deflection !== null) parts.push(formatDegrees(deflection));
  return parts.join(' · ');
}
