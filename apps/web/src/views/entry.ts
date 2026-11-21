import type { Point2 } from '@hydrobim/core';

/**
 * Entrada numérica das ferramentas de desenho 2D, no costume dos programas de CAD:
 *  - `2,5;1`     ponto absoluto (X;Y nas coordenadas da vista);
 *  - `@1,2;0`    deslocamento a partir do último ponto;
 *  - `3<45`      distância e ângulo (graus, anti-horário a partir de +X) do último ponto;
 *  - `2,75`      um só valor: distância na direção do cursor, raio ou afastamento, conforme
 *                o que a ferramenta estiver pedindo.
 * A vírgula é o separador decimal; o ponto também é aceito.
 */
export type Entry =
  | { readonly kind: 'absolute'; readonly point: Point2 }
  | { readonly kind: 'relative'; readonly delta: Point2 }
  | { readonly kind: 'polar'; readonly distance: number; readonly angle: number }
  | { readonly kind: 'value'; readonly value: number };

const number = (text: string): number => {
  const normalized = text.trim().replace(',', '.');
  return normalized.length === 0 ? Number.NaN : Number(normalized);
};

export function parseEntry(text: string): Entry | null {
  let body = text.trim();
  if (body.length === 0) return null;
  const relative = body.startsWith('@');
  if (relative) body = body.slice(1).trim();
  if (body.includes('<')) {
    const [distance, angle, ...rest] = body.split('<').map(number);
    if (rest.length > 0 || distance === undefined || angle === undefined) return null;
    if (!Number.isFinite(distance) || !Number.isFinite(angle)) return null;
    return { kind: 'polar', distance, angle: (angle * Math.PI) / 180 };
  }
  // Coordenadas separadas por ponto e vírgula ou por espaço (a vírgula é decimal).
  const parts = body.split(/[;\s]+/).filter((part) => part.length > 0);
  if (parts.length === 2) {
    const [x, y] = parts.map(number);
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return relative ? { kind: 'relative', delta: { x, y } } : { kind: 'absolute', point: { x, y } };
  }
  if (parts.length !== 1 || relative) return null;
  const value = number(parts[0] ?? '');
  return Number.isFinite(value) ? { kind: 'value', value } : null;
}

/**
 * Ponto indicado pela entrada. `last` é o último ponto informado e `cursor` dá a direção de
 * um valor único; `null` quando a entrada precisa de um deles e não há.
 */
export function entryPoint(
  entry: Entry,
  last: Point2 | null,
  cursor: Point2 | null,
): Point2 | null {
  if (entry.kind === 'absolute') return entry.point;
  if (!last) return null;
  if (entry.kind === 'relative') return { x: last.x + entry.delta.x, y: last.y + entry.delta.y };
  if (entry.kind === 'polar') {
    return {
      x: last.x + entry.distance * Math.cos(entry.angle),
      y: last.y + entry.distance * Math.sin(entry.angle),
    };
  }
  if (!cursor) return null;
  const dx = cursor.x - last.x;
  const dy = cursor.y - last.y;
  const size = Math.hypot(dx, dy);
  if (size < 1e-9) return null;
  return { x: last.x + (dx / size) * entry.value, y: last.y + (dy / size) * entry.value };
}

/** Captura de um ponto da vista: ponto notável dentro da tolerância, senão grade, senão livre. */
export function snapViewPoint(
  raw: Point2,
  candidates: readonly Point2[],
  tolerance: number,
  gridStep: number,
): { point: Point2; snap: 'point' | 'grid' | 'free' } {
  let best: Point2 | null = null;
  let bestDistance = tolerance;
  for (const candidate of candidates) {
    const d = Math.hypot(candidate.x - raw.x, candidate.y - raw.y);
    if (d <= bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  if (best) return { point: best, snap: 'point' };
  if (gridStep > 0) {
    return {
      point: {
        x: Math.round(raw.x / gridStep) * gridStep,
        y: Math.round(raw.y / gridStep) * gridStep,
      },
      snap: 'grid',
    };
  }
  return { point: raw, snap: 'free' };
}
