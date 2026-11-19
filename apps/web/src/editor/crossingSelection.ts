/**
 * Seleção por janela nas duas vistas, em coordenadas de tela (qualquer unidade coerente).
 * Convenção de CAD: arrastar da esquerda para a direita seleciona o que está inteiramente
 * contido; da direita para a esquerda, tudo o que a janela toca (cruzamento). Funções puras.
 */

export interface Rect2 {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export type WindowMode = 'contain' | 'cross';

export const WINDOW_MODE_LABELS: Record<WindowMode, string> = {
  contain: 'Janela: elementos inteiramente contidos',
  cross: 'Cruzamento: elementos tocados pela janela',
};

/** Modo da janela pelo sentido do arrasto (X da tela cresce para a direita). */
export const windowModeOf = (startX: number, endX: number): WindowMode =>
  endX >= startX ? 'contain' : 'cross';

export function rectOf(a: { x: number; y: number }, b: { x: number; y: number }): Rect2 {
  return {
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxY: Math.max(a.y, b.y),
  };
}

const inside = (rect: Rect2, x: number, y: number): boolean =>
  x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY;

/** Recorte de Liang–Barsky: o segmento tem algum ponto dentro do retângulo? */
export function segmentTouchesRect(
  rect: Rect2,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const edges: readonly [number, number][] = [
    [-dx, x1 - rect.minX],
    [dx, rect.maxX - x1],
    [-dy, y1 - rect.minY],
    [dy, rect.maxY - y1],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}

/** O ponto está dentro do triângulo (ou sobre a borda)? */
function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

/**
 * Geometria já projetada na tela: pontos (x, y consecutivos) e, opcionalmente, triângulos
 * por índices. Sem índices, os pontos são tratados como uma nuvem (basta um dentro).
 */
export interface ScreenShape {
  readonly points: ArrayLike<number>;
  readonly triangles?: ArrayLike<number>;
  /** Segmentos (pares de índices de pontos), para desenhos de linha como a planta. */
  readonly segments?: ArrayLike<number>;
}

/** Todos os pontos da forma estão dentro do retângulo (forma vazia não é selecionada). */
export function shapeInsideRect(shape: ScreenShape, rect: Rect2): boolean {
  const { points } = shape;
  if (points.length < 2) return false;
  for (let i = 0; i + 1 < points.length; i += 2) {
    if (!inside(rect, points[i] ?? Number.NaN, points[i + 1] ?? Number.NaN)) return false;
  }
  return true;
}

/** A janela toca a forma: um ponto dentro, uma aresta cruzando ou a janela dentro de uma face. */
export function shapeTouchesRect(shape: ScreenShape, rect: Rect2): boolean {
  const { points } = shape;
  const x = (i: number): number => points[i * 2] ?? Number.NaN;
  const y = (i: number): number => points[i * 2 + 1] ?? Number.NaN;
  for (let i = 0; i < points.length / 2; i += 1) {
    if (inside(rect, x(i), y(i))) return true;
  }
  const segments = shape.segments;
  if (segments) {
    for (let i = 0; i + 1 < segments.length; i += 2) {
      const a = segments[i] ?? 0;
      const b = segments[i + 1] ?? 0;
      if (segmentTouchesRect(rect, x(a), y(a), x(b), y(b))) return true;
    }
  }
  const triangles = shape.triangles;
  if (triangles) {
    const cx = (rect.minX + rect.maxX) / 2;
    const cy = (rect.minY + rect.maxY) / 2;
    for (let i = 0; i + 2 < triangles.length; i += 3) {
      const a = triangles[i] ?? 0;
      const b = triangles[i + 1] ?? 0;
      const c = triangles[i + 2] ?? 0;
      if (
        segmentTouchesRect(rect, x(a), y(a), x(b), y(b)) ||
        segmentTouchesRect(rect, x(b), y(b), x(c), y(c)) ||
        segmentTouchesRect(rect, x(c), y(c), x(a), y(a)) ||
        // Janela pequena inteiramente dentro de uma face do elemento.
        pointInTriangle(cx, cy, x(a), y(a), x(b), y(b), x(c), y(c))
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Aplica o modo da janela a uma forma. */
export const shapeSelected = (shape: ScreenShape, rect: Rect2, mode: WindowMode): boolean =>
  mode === 'contain' ? shapeInsideRect(shape, rect) : shapeTouchesRect(shape, rect);

/** Filtros da seleção por janela: categorias (tipos de elemento) e sistemas aceitos. */
export interface SelectionFilter {
  /** `null` = todas as categorias. */
  readonly kinds: ReadonlySet<string> | null;
  /** `null` = todos os sistemas. */
  readonly systemIds: ReadonlySet<string> | null;
}

export const NO_FILTER: SelectionFilter = { kinds: null, systemIds: null };

export function passesFilter(
  element: { kind: string; systemId: string },
  filter: SelectionFilter,
): boolean {
  return (
    (filter.kinds === null || filter.kinds.has(element.kind)) &&
    (filter.systemIds === null || filter.systemIds.has(element.systemId))
  );
}
