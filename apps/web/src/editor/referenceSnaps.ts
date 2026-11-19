import { getPorts, type HydroElement, type Point2, type Vec3 } from '@hydrobim/core';

/**
 * Capturas de REFERÊNCIA na planta: extremidade, ponto médio, perpendicular e alinhamento.
 * Servem para posicionar o ponto com precisão e nunca criam conexão — a conexão hidráulica
 * continua sendo só a captura de uma porta livre ou o tê explícito sobre um tubo. Por isso o
 * resultado traz apenas X e Y (a cota é a do traçado) e informa a cota da origem, para que a
 * interface mostre quando o ponto foi projetado de outra elevação.
 */

export type ReferenceKind = 'endpoint' | 'midpoint' | 'perpendicular' | 'alignment';

export const REFERENCE_LABELS: Record<ReferenceKind, string> = {
  endpoint: 'Extremidade (referência)',
  midpoint: 'Ponto médio (referência)',
  perpendicular: 'Perpendicular (referência)',
  alignment: 'Alinhamento (referência)',
};

export interface ReferenceSnap {
  readonly kind: ReferenceKind;
  /** Ponto capturado em planta. */
  readonly point: Point2;
  /** Elemento de origem (no alinhamento, o do primeiro guia). */
  readonly elementId: string | null;
  /** Cota do ponto de origem no modelo; `null` quando há mais de uma origem. */
  readonly sourceZ: number | null;
  /** Pontos de onde partem as linhas-guia a desenhar até o ponto capturado. */
  readonly guides: readonly Point2[];
}

export interface ReferenceContext {
  /** Cursor em planta (m). */
  readonly point: Point2;
  /** Raio de captura em planta (m), já convertido do raio em pixels. */
  readonly tolerance: number;
  /** Elementos visíveis. */
  readonly elements: readonly HydroElement[];
  /** Ponto de partida do trecho, para a perpendicular. */
  readonly anchor: Vec3 | null;
}

interface Notable {
  readonly point: Vec3;
  readonly elementId: string;
}

const gap = (a: Point2, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Extremidades (todas as portas, livres ou conectadas) e pontos médios dos tubos. */
function notablePoints(elements: readonly HydroElement[]): {
  endpoints: Notable[];
  midpoints: Notable[];
} {
  const endpoints: Notable[] = [];
  const midpoints: Notable[] = [];
  for (const element of elements) {
    for (const port of getPorts(element)) {
      endpoints.push({ point: port.position, elementId: element.id });
    }
    if (element.kind === 'pipe') {
      midpoints.push({
        elementId: element.id,
        point: {
          x: (element.start.x + element.end.x) / 2,
          y: (element.start.y + element.end.y) / 2,
          z: (element.start.z + element.end.z) / 2,
        },
      });
    }
  }
  return { endpoints, midpoints };
}

function nearest(point: Point2, candidates: readonly Notable[], tolerance: number): Notable | null {
  let best: Notable | null = null;
  let bestGap = tolerance;
  for (const candidate of candidates) {
    const d = gap(point, candidate.point);
    if (d <= bestGap) {
      best = candidate;
      bestGap = d;
    }
  }
  return best;
}

/** Pé da perpendicular de `from` sobre a projeção em planta do tubo, se cair dentro dele. */
function perpendicularFoot(element: HydroElement, from: Vec3): { point: Point2; z: number } | null {
  if (element.kind !== 'pipe') return null;
  const ax = element.end.x - element.start.x;
  const ay = element.end.y - element.start.y;
  const squared = ax * ax + ay * ay;
  // Tubo vertical: em planta é um ponto, sem perpendicular definida.
  if (squared < 1e-12) return null;
  const t = ((from.x - element.start.x) * ax + (from.y - element.start.y) * ay) / squared;
  if (t <= 0 || t >= 1) return null;
  return {
    point: { x: element.start.x + ax * t, y: element.start.y + ay * t },
    z: element.start.z + (element.end.z - element.start.z) * t,
  };
}

/**
 * Captura de referência sob o cursor, por prioridade: extremidade, ponto médio,
 * perpendicular a partir do ponto de partida e alinhamento (mesmo X ou mesmo Y de um ponto
 * notável; os dois ao mesmo tempo dão o cruzamento das guias). `null` = nada a capturar.
 */
export function pickReference(context: ReferenceContext): ReferenceSnap | null {
  const { point, tolerance, elements, anchor } = context;
  const { endpoints, midpoints } = notablePoints(elements);

  const endpoint = nearest(point, endpoints, tolerance);
  if (endpoint) {
    return {
      kind: 'endpoint',
      point: { x: endpoint.point.x, y: endpoint.point.y },
      elementId: endpoint.elementId,
      sourceZ: endpoint.point.z,
      guides: [],
    };
  }
  const midpoint = nearest(point, midpoints, tolerance);
  if (midpoint) {
    return {
      kind: 'midpoint',
      point: { x: midpoint.point.x, y: midpoint.point.y },
      elementId: midpoint.elementId,
      sourceZ: midpoint.point.z,
      guides: [],
    };
  }

  if (anchor) {
    let best: { foot: { point: Point2; z: number }; elementId: string } | null = null;
    let bestGap = tolerance;
    for (const element of elements) {
      const foot = perpendicularFoot(element, anchor);
      if (!foot) continue;
      const d = gap(point, foot.point);
      // O próprio ponto de partida sobre o tubo não é uma perpendicular útil.
      if (d <= bestGap && gap(anchor, foot.point) > tolerance) {
        best = { foot, elementId: element.id };
        bestGap = d;
      }
    }
    if (best) {
      return {
        kind: 'perpendicular',
        point: best.foot.point,
        elementId: best.elementId,
        sourceZ: best.foot.z,
        guides: [{ x: anchor.x, y: anchor.y }],
      };
    }
  }

  // Alinhamento: o cursor compartilha X e/ou Y com pontos notáveis.
  const sources = [...endpoints, ...midpoints];
  let alignedX: Notable | null = null;
  let alignedY: Notable | null = null;
  let gapX = tolerance;
  let gapY = tolerance;
  for (const source of sources) {
    const dx = Math.abs(point.x - source.point.x);
    const dy = Math.abs(point.y - source.point.y);
    if (dx <= gapX) {
      alignedX = source;
      gapX = dx;
    }
    if (dy <= gapY) {
      alignedY = source;
      gapY = dy;
    }
  }
  if (!alignedX && !alignedY) return null;
  const guides: Point2[] = [];
  if (alignedX) guides.push({ x: alignedX.point.x, y: alignedX.point.y });
  if (alignedY) guides.push({ x: alignedY.point.x, y: alignedY.point.y });
  const both = alignedX && alignedY;
  return {
    kind: 'alignment',
    point: { x: alignedX?.point.x ?? point.x, y: alignedY?.point.y ?? point.y },
    elementId: (alignedX ?? alignedY)?.elementId ?? null,
    sourceZ: both ? null : ((alignedX ?? alignedY)?.point.z ?? null),
    guides,
  };
}
