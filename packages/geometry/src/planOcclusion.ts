import type { PlanOutline } from './plan';

/**
 * Ocultação ENTRE elementos na planta, para saídas vetoriais sem preenchimento (DXF).
 *
 * Na tela e no SVG a planta usa o algoritmo do pintor: cada elemento é uma máscara opaca
 * que cobre os desenhados antes dele. Um formato só de linhas não tem máscara; aqui o mesmo
 * resultado é obtido recortando as linhas de cada elemento pelas máscaras (`fill`) dos
 * elementos desenhados depois. O recorte é exato (segmento × triângulo), não amostrado.
 */

/** Trechos visíveis menores que isto (m) são restos numéricos entre triângulos vizinhos. */
const MIN_PIECE = 1e-5;
const EPS = 1e-9;

/**
 * `outlines` na ordem de desenho (os últimos cobrem os primeiros). Devolve, para cada um,
 * os segmentos (4 números por segmento) que continuam visíveis.
 */
export function occludedPlanLines(outlines: readonly PlanOutline[]): Float64Array[] {
  return outlines.map((outline, index) => {
    const occluders = outlines
      .slice(index + 1)
      .filter(
        (other) =>
          other.fill.length > 0 &&
          other.minX <= outline.maxX &&
          other.maxX >= outline.minX &&
          other.minY <= outline.maxY &&
          other.maxY >= outline.minY,
      );
    if (occluders.length === 0) return outline.lines;

    const visible: number[] = [];
    const { lines } = outline;
    for (let i = 0; i + 3 < lines.length; i += 4) {
      const x1 = lines[i] ?? 0;
      const y1 = lines[i + 1] ?? 0;
      const x2 = lines[i + 2] ?? 0;
      const y2 = lines[i + 3] ?? 0;
      const length = Math.hypot(x2 - x1, y2 - y1);
      if (length < EPS) continue;

      const covered: [number, number][] = [];
      const loX = Math.min(x1, x2);
      const hiX = Math.max(x1, x2);
      const loY = Math.min(y1, y2);
      const hiY = Math.max(y1, y2);
      for (const other of occluders) {
        if (other.minX > hiX || other.maxX < loX || other.minY > hiY || other.maxY < loY) continue;
        const { fill } = other;
        for (let t = 0; t + 5 < fill.length; t += 6) {
          const ax = fill[t] ?? 0;
          const ay = fill[t + 1] ?? 0;
          const bx = fill[t + 2] ?? 0;
          const by = fill[t + 3] ?? 0;
          const cx = fill[t + 4] ?? 0;
          const cy = fill[t + 5] ?? 0;
          if (
            Math.min(ax, bx, cx) > hiX ||
            Math.max(ax, bx, cx) < loX ||
            Math.min(ay, by, cy) > hiY ||
            Math.max(ay, by, cy) < loY
          ) {
            continue;
          }
          const interval = clipToTriangle(x1, y1, x2, y2, ax, ay, bx, by, cx, cy);
          if (interval) covered.push(interval);
        }
      }
      if (covered.length === 0) {
        visible.push(x1, y1, x2, y2);
        continue;
      }

      covered.sort((p, q) => p[0] - q[0]);
      const tolerance = MIN_PIECE / length;
      let cursor = 0;
      const emit = (from: number, to: number): void => {
        if (to - from <= tolerance) return;
        visible.push(
          x1 + (x2 - x1) * from,
          y1 + (y2 - y1) * from,
          x1 + (x2 - x1) * to,
          y1 + (y2 - y1) * to,
        );
      };
      for (const [from, to] of covered) {
        if (from > cursor) emit(cursor, from);
        cursor = Math.max(cursor, to);
      }
      emit(cursor, 1);
    }
    return new Float64Array(visible);
  });
}

/** Intervalo de parâmetro [t0, t1] do segmento que fica dentro do triângulo, ou `null`. */
function clipToTriangle(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): [number, number] | null {
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  if (Math.abs(area) < 1e-14) return null;
  const sign = area > 0 ? 1 : -1;
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  // Cada lado é um semiplano: f(t) = f0 + f1·t ≥ 0 do lado de dentro.
  const sides = [ax, ay, bx, by, bx, by, cx, cy, cx, cy, ax, ay];
  for (let s = 0; s < 12; s += 4) {
    const px = sides[s] ?? 0;
    const py = sides[s + 1] ?? 0;
    const ex = (sides[s + 2] ?? 0) - px;
    const ey = (sides[s + 3] ?? 0) - py;
    const f0 = sign * (ex * (y1 - py) - ey * (x1 - px));
    const f1 = sign * (ex * dy - ey * dx);
    if (Math.abs(f1) < 1e-18) {
      if (f0 < 0) return null;
      continue;
    }
    const t = -f0 / f1;
    if (f1 > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return null;
  }
  return [t0, t1];
}
