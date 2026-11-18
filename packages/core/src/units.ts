/** Conversões explícitas entre unidades internas (SI) e unidades de apresentação. */

export const mmToM = (mm: number): number => mm / 1000;
export const mToMm = (m: number): number => m * 1000;
export const degToRad = (deg: number): number => (deg * Math.PI) / 180;
export const radToDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Formata um comprimento interno (m) em metros, com separador decimal pt-BR. */
export function formatMeters(m: number, digits = 3): string {
  return `${m.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} m`;
}

/** Formata um comprimento interno (m) em milímetros. */
export function formatMillimeters(m: number, digits = 1): string {
  return `${mToMm(m).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })} mm`;
}

export function formatDegrees(rad: number, digits = 1): string {
  return `${radToDeg(rad).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })}°`;
}
