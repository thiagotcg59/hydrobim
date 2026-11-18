/** Retângulo em coordenadas normalizadas do dispositivo (NDC: −1 a 1, Y para cima). */
export interface NdcRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Point2 {
  x: number;
  y: number;
}

/** Retângulo NDC delimitado por dois cantos em pixels, relativos ao canto superior esquerdo. */
export function ndcRectFromPixels(a: Point2, b: Point2, width: number, height: number): NdcRect {
  const toX = (x: number): number => (x / width) * 2 - 1;
  const toY = (y: number): number => -(y / height) * 2 + 1;
  return {
    minX: toX(Math.min(a.x, b.x)),
    maxX: toX(Math.max(a.x, b.x)),
    minY: toY(Math.max(a.y, b.y)),
    maxY: toY(Math.min(a.y, b.y)),
  };
}

/**
 * Indica se todos os vértices (x, y, z consecutivos) caem dentro do retângulo depois de
 * projetados pela matriz modelo-vista-projeção (16 valores, ordem por colunas).
 *
 * A seleção por janela só aceita o que está inteiramente contido: um vértice fora do
 * retângulo, atrás da câmera ou além dos planos de corte reprova a malha.
 */
export function verticesInsideRect(
  positions: ArrayLike<number>,
  mvp: ArrayLike<number>,
  rect: NdcRect,
): boolean {
  if (positions.length < 3 || mvp.length < 16) return false;
  const m = (i: number): number => mvp[i] ?? 0;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i] ?? 0;
    const y = positions[i + 1] ?? 0;
    const z = positions[i + 2] ?? 0;
    const w = m(3) * x + m(7) * y + m(11) * z + m(15);
    if (w <= 0) return false;
    const cz = m(2) * x + m(6) * y + m(10) * z + m(14);
    if (cz < -w || cz > w) return false;
    const nx = (m(0) * x + m(4) * y + m(8) * z + m(12)) / w;
    const ny = (m(1) * x + m(5) * y + m(9) * z + m(13)) / w;
    if (nx < rect.minX || nx > rect.maxX || ny < rect.minY || ny > rect.maxY) return false;
  }
  return true;
}
