import type { Point2 } from '@hydrobim/core';
import { polarLockPlan } from './polarLock';

/**
 * Capturas de desenho em planta: pontos notáveis de arestas existentes e restrições de DIREÇÃO
 * do trecho que sai do último ponto. Tudo é calculado no plano de trabalho, em metros — a
 * aparência na tela não entra na conta —, e nada aqui cria vínculo: o resultado é só o ponto
 * a usar, com o que desenhar para explicá-lo (guias, aresta realçada, símbolo de ângulo reto).
 *
 * Relações distinguidas:
 *  - `ortho`: trecho paralelo a um eixo do plano de trabalho (X ou Y);
 *  - `parallelPrevious` / `perpendicularPrevious`: em relação ao trecho anterior do traçado;
 *  - `parallelReference` / `perpendicularReference`: em relação a uma aresta de referência
 *    escolhida (qualquer orientação: uma parede a 23° dá a perpendicular a 113°);
 *  - `perpendicular`: PÉ da perpendicular — a projeção do último ponto sobre uma aresta;
 *  - `endpoint`, `midpoint`, `intersection`, `nearest` (sobre a aresta) e `alignment`.
 *
 * O raio de captura chega em metros, convertido de pixels por quem chama: é o mesmo na tela
 * em qualquer ampliação.
 */

export const SNAP_TOGGLES = [
  'endpoint',
  'midpoint',
  'intersection',
  'perpendicular',
  'direction',
  'ortho',
  'alignment',
  'nearest',
] as const;
export type SnapToggle = (typeof SNAP_TOGGLES)[number];
export type SnapSettings = Readonly<Record<SnapToggle, boolean>>;

export const ALL_SNAPS_ON: SnapSettings = {
  endpoint: true,
  midpoint: true,
  intersection: true,
  perpendicular: true,
  direction: true,
  ortho: true,
  alignment: true,
  nearest: true,
};

export const SNAP_TOGGLE_LABELS: Record<SnapToggle, { label: string; title: string }> = {
  endpoint: {
    label: 'Extremidade',
    title: 'Extremidades e cantos das paredes e dos contornos.',
  },
  midpoint: { label: 'Meio', title: 'Ponto médio das arestas.' },
  intersection: { label: 'Interseção', title: 'Cruzamento de duas arestas.' },
  perpendicular: {
    label: 'Pé da perpendicular',
    title: 'Projeção do último ponto sobre uma aresta: o trecho chega a ela em ângulo reto.',
  },
  direction: {
    label: 'Paralela / perpendicular',
    title:
      'Direção do trecho paralela ou perpendicular ao trecho anterior e à aresta de referência (a última aresta apontada; R fixa ou solta).',
  },
  ortho: {
    label: 'Ortogonal',
    title: 'Direção do trecho paralela aos eixos X e Y do plano de trabalho.',
  },
  alignment: {
    label: 'Alinhamento',
    title: 'Mesmo X ou mesmo Y de uma extremidade existente.',
  },
  nearest: { label: 'Sobre a aresta', title: 'Ponto sobre a face, o eixo ou o contorno.' },
};

export type SnapKind =
  | 'endpoint'
  | 'intersection'
  | 'midpoint'
  | 'perpendicular'
  | 'perpendicularPrevious'
  | 'perpendicularReference'
  | 'parallelPrevious'
  | 'parallelReference'
  | 'ortho'
  | 'alignment'
  | 'nearest'
  | 'polar'
  | 'grid'
  | 'free';

/** Aresta que serve de referência à captura. */
export interface SnapSegment {
  readonly a: Point2;
  readonly b: Point2;
  /** Elemento de origem e o nome dele, para o rótulo. */
  readonly sourceId: string;
  readonly sourceName: string;
  /** `axis` = linha de referência da parede; `face` = face; `edge` = lado de contorno. */
  readonly role: 'axis' | 'face' | 'edge' | 'ridge';
}

export interface SnapGuide {
  readonly from: Point2;
  readonly to: Point2;
}

export interface SnapResult {
  readonly point: Point2;
  readonly kind: SnapKind;
  /** Texto junto ao cursor, ex.: "Perpendicular ao trecho anterior · 90°". */
  readonly label: string;
  /** Linhas tracejadas que explicam a captura. */
  readonly guides: readonly SnapGuide[];
  /** Aresta de referência a realçar. */
  readonly segment: SnapSegment | null;
  /** Símbolo de ângulo reto: vértice e os dois versores dos lados. */
  readonly rightAngle: { readonly at: Point2; readonly u: Point2; readonly v: Point2 } | null;
  /** Direção travada do trecho (versor); `null` quando a captura é só de ponto. */
  readonly direction: Point2 | null;
  /** Candidatos sob o cursor e o escolhido (Tab alterna). */
  readonly count: number;
  readonly index: number;
}

export interface SnapContext {
  /** Cursor em planta (m). */
  readonly raw: Point2;
  /** Raio de captura (m), já convertido do raio em pixels. */
  readonly tolerance: number;
  readonly segments: readonly SnapSegment[];
  /** Pontos notáveis avulsos (vértices já indicados do traçado). */
  readonly points?: readonly Point2[];
  /** Último ponto indicado: origem do trecho em desenho. */
  readonly anchor: Point2 | null;
  /** Ponto anterior ao último: `previous`→`anchor` é o trecho anterior. */
  readonly previous: Point2 | null;
  /** Aresta de referência escolhida. */
  readonly reference: SnapSegment | null;
  readonly settings: SnapSettings;
  /** Passo da grade (m); 0 = desligada. */
  readonly gridStep: number;
  /** Trava de ângulo (Shift): 45° em 45° em relação aos eixos do plano de trabalho. */
  readonly polar: boolean;
  /** Escolha entre candidatos sobrepostos (Tab): índice na ordem de prioridade. */
  readonly cycle: number;
}

const sub = (a: Point2, b: Point2): Point2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point2, b: Point2): Point2 => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Point2, s: number): Point2 => ({ x: a.x * s, y: a.y * s });
const dot = (a: Point2, b: Point2): number => a.x * b.x + a.y * b.y;
const cross = (a: Point2, b: Point2): number => a.x * b.y - a.y * b.x;
const size = (a: Point2): number => Math.hypot(a.x, a.y);
const gap = (a: Point2, b: Point2): number => Math.hypot(a.x - b.x, a.y - b.y);
/** Normal à esquerda: exatamente perpendicular (o produto escalar com `d` é zero). */
const leftOf = (d: Point2): Point2 => ({ x: -d.y, y: d.x });

function unit(v: Point2): Point2 | null {
  const length = size(v);
  return length < 1e-12 ? null : { x: v.x / length, y: v.y / length };
}

/** Ponto do segmento mais próximo de `p`. */
export function closestOnSegment(p: Point2, a: Point2, b: Point2): Point2 {
  const d = sub(b, a);
  const squared = dot(d, d);
  if (squared < 1e-18) return a;
  const t = Math.min(1, Math.max(0, dot(sub(p, a), d) / squared));
  return add(a, mul(d, t));
}

/** Pé da perpendicular de `p` sobre o segmento, se cair dentro dele (pontas incluídas). */
export function perpendicularFoot(p: Point2, a: Point2, b: Point2): Point2 | null {
  const d = sub(b, a);
  const squared = dot(d, d);
  if (squared < 1e-18) return null;
  const t = dot(sub(p, a), d) / squared;
  if (t < -1e-9 || t > 1 + 1e-9) return null;
  return add(a, mul(d, t));
}

/** Cruzamento de dois segmentos (dentro dos dois); `null` se paralelos ou sem cruzamento. */
export function segmentIntersection(a: SnapSegment, b: SnapSegment): Point2 | null {
  const d = sub(a.b, a.a);
  const e = sub(b.b, b.a);
  const denominator = cross(d, e);
  if (Math.abs(denominator) < 1e-12 * Math.max(1, size(d) * size(e))) return null;
  const w = sub(b.a, a.a);
  const t = cross(w, e) / denominator;
  const s = cross(w, d) / denominator;
  const eps = 1e-9;
  if (t < -eps || t > 1 + eps || s < -eps || s > 1 + eps) return null;
  return add(a.a, mul(d, t));
}

/** Aresta mais próxima do cursor dentro da tolerância (escolha da aresta de referência). */
export function segmentNear(
  raw: Point2,
  segments: readonly SnapSegment[],
  tolerance: number,
): SnapSegment | null {
  let best: SnapSegment | null = null;
  let bestGap = tolerance;
  for (const segment of segments) {
    const d = gap(closestOnSegment(raw, segment.a, segment.b), raw);
    if (d <= bestGap) {
      best = segment;
      bestGap = d;
    }
  }
  return best;
}

const ROLE_LABELS: Record<SnapSegment['role'], string> = {
  axis: 'eixo',
  face: 'face',
  edge: 'contorno',
  ridge: 'cumeeira',
};

const describe = (segment: SnapSegment): string =>
  `${ROLE_LABELS[segment.role]} de ${segment.sourceName}`;

/** Ângulo entre dois versores, em graus inteiros quando exato (0, 45, 90…). */
function degreesBetween(u: Point2, v: Point2): string {
  const angle = (Math.acos(Math.min(1, Math.max(-1, dot(u, v)))) * 180) / Math.PI;
  const rounded = Math.round(angle * 10) / 10;
  return `${rounded.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}°`;
}

interface Candidate {
  readonly point: Point2;
  readonly kind: SnapKind;
  readonly label: string;
  readonly guides: readonly SnapGuide[];
  readonly segment: SnapSegment | null;
  readonly rightAngle: SnapResult['rightAngle'];
  readonly direction: Point2 | null;
  readonly priority: number;
  readonly distance: number;
}

const PRIORITY: Record<SnapKind, number> = {
  endpoint: 0,
  intersection: 1,
  midpoint: 2,
  perpendicular: 3,
  perpendicularPrevious: 4,
  perpendicularReference: 4.5,
  parallelPrevious: 5,
  parallelReference: 5.5,
  ortho: 6,
  // Sobre uma aresta, o ponto dela vale mais que o alinhamento com uma extremidade distante.
  nearest: 7,
  alignment: 8,
  polar: 9,
  grid: 10,
  free: 11,
};

const snapStep = (value: number, step: number): number =>
  step > 0 ? Math.round(value / step) * step : value;

/**
 * Candidatos de DIREÇÃO: retas que passam pelo último ponto. Vale a reta quando o cursor está
 * a até `tolerance` dela (medido na perpendicular, em metros = pixels constantes). O ponto fica
 * sobre a reta; o comprimento vem do cursor, de uma aresta cruzada ali perto ou da grade.
 */
function directionCandidates(context: SnapContext, anchor: Point2): Candidate[] {
  const { raw, tolerance, settings, previous, reference, segments, gridStep } = context;
  const lines: {
    kind: SnapKind;
    dir: Point2;
    label: (dir: Point2) => string;
    segment: SnapSegment | null;
    /** Versor da referência com que o trecho faz ângulo reto (para o símbolo). */
    square: Point2 | null;
  }[] = [];

  const back = previous ? unit(sub(previous, anchor)) : null;
  if (settings.direction && back) {
    lines.push({
      kind: 'perpendicularPrevious',
      dir: leftOf(back),
      label: () => 'Perpendicular ao trecho anterior · 90°',
      segment: null,
      square: back,
    });
    lines.push({
      kind: 'parallelPrevious',
      dir: back,
      // Deflexão em relação ao prolongamento do trecho anterior: 0° segue reto.
      label: (dir) =>
        `Alinhado ao trecho anterior · ${degreesBetween(dir, mul(back, -1))} de deflexão`,
      segment: null,
      square: null,
    });
  }
  const along = reference ? unit(sub(reference.b, reference.a)) : null;
  if (settings.direction && reference && along) {
    lines.push({
      kind: 'perpendicularReference',
      dir: leftOf(along),
      label: () => `Perpendicular · 90° (${describe(reference)})`,
      segment: reference,
      square: along,
    });
    lines.push({
      kind: 'parallelReference',
      dir: along,
      label: () => `Paralela · 0° (${describe(reference)})`,
      segment: reference,
      square: null,
    });
  }
  if (settings.ortho) {
    lines.push({
      kind: 'ortho',
      dir: { x: 1, y: 0 },
      label: () => 'Ortogonal · eixo X',
      segment: null,
      square: null,
    });
    lines.push({
      kind: 'ortho',
      dir: { x: 0, y: 1 },
      label: () => 'Ortogonal · eixo Y',
      segment: null,
      square: null,
    });
  }

  const rel = sub(raw, anchor);
  const candidates: Candidate[] = [];
  for (const line of lines) {
    const away = Math.abs(cross(line.dir, rel));
    let t = dot(rel, line.dir);
    if (away > tolerance || Math.abs(t) <= tolerance) continue;
    const dir = t >= 0 ? line.dir : mul(line.dir, -1);
    let label = line.label(dir);
    let onSegment: SnapSegment | null = null;
    // A reta cruza uma aresta junto ao cursor: o trecho termina nela.
    if (settings.nearest || settings.intersection) {
      let bestShift = tolerance;
      for (const segment of segments) {
        const e = sub(segment.b, segment.a);
        const denominator = cross(line.dir, e);
        if (Math.abs(denominator) < 1e-9 * Math.max(1, size(e))) continue;
        const w = sub(segment.a, anchor);
        const hitT = cross(w, e) / denominator;
        const s = cross(w, line.dir) / denominator;
        if (s < -1e-9 || s > 1 + 1e-9) continue;
        const shift = Math.abs(hitT - t);
        if (shift <= bestShift && Math.abs(hitT) > 1e-9) {
          bestShift = shift;
          onSegment = segment;
        }
      }
      if (onSegment) {
        const e = sub(onSegment.b, onSegment.a);
        t = cross(sub(onSegment.a, anchor), e) / cross(line.dir, e);
        label = `${label} · até ${describe(onSegment)}`;
      }
    }
    if (!onSegment) {
      const stepped = snapStep(t, gridStep);
      if (Math.abs(stepped) > 1e-9) t = stepped;
    }
    const point = add(anchor, mul(line.dir, t));
    const guides: SnapGuide[] = [{ from: anchor, to: point }];
    let rightAngle: SnapResult['rightAngle'] = null;
    if (line.square) {
      if (line.kind === 'perpendicularReference' && line.segment) {
        // O ângulo reto é marcado onde a reta do trecho encontra a reta da referência.
        const e = sub(line.segment.b, line.segment.a);
        const denominator = cross(line.dir, e);
        const meet = add(
          anchor,
          mul(line.dir, cross(sub(line.segment.a, anchor), e) / denominator),
        );
        guides.push({ from: anchor, to: meet });
        const toward = unit(sub(anchor, meet)) ?? dir;
        rightAngle = { at: meet, u: line.square, v: gap(meet, anchor) > 1e-9 ? toward : dir };
      } else {
        rightAngle = { at: anchor, u: line.square, v: dir };
      }
    }
    candidates.push({
      point,
      kind: line.kind,
      label,
      guides,
      segment: onSegment ?? line.segment,
      rightAngle,
      direction: dir,
      priority: PRIORITY[line.kind],
      distance: away,
    });
  }
  return candidates;
}

/**
 * Resolve a captura sob o cursor. A ordem é determinística: prioridade do tipo de captura,
 * depois a distância ao cursor e, no empate, a posição do ponto. `cycle` percorre essa lista
 * (Tab); o último candidato é sempre a grade ou o ponto livre.
 */
export function resolveSnap(context: SnapContext): SnapResult {
  const { raw, tolerance, segments, settings, anchor, gridStep } = context;
  const candidates: Candidate[] = [];
  const point = (
    at: Point2,
    kind: SnapKind,
    label: string,
    extra: Partial<Pick<Candidate, 'guides' | 'segment' | 'rightAngle'>> = {},
  ): void => {
    const distance = gap(at, raw);
    if (distance > tolerance) return;
    // O próprio ponto de partida não é destino do trecho.
    if (anchor && gap(at, anchor) < 1e-9) return;
    candidates.push({
      point: at,
      kind,
      label,
      guides: extra.guides ?? [],
      segment: extra.segment ?? null,
      rightAngle: extra.rightAngle ?? null,
      direction: null,
      priority: PRIORITY[kind],
      distance,
    });
  };

  // Só as arestas ao alcance do cursor entram nas capturas de ponto.
  const near = segments.filter(
    (segment) => gap(closestOnSegment(raw, segment.a, segment.b), raw) <= tolerance,
  );
  if (settings.endpoint) {
    for (const segment of near) {
      point(segment.a, 'endpoint', `Extremidade · ${segment.sourceName}`);
      point(segment.b, 'endpoint', `Extremidade · ${segment.sourceName}`);
    }
    for (const extra of context.points ?? []) point(extra, 'endpoint', 'Extremidade do traçado');
  }
  if (settings.intersection) {
    for (let i = 0; i < near.length; i += 1) {
      for (let j = i + 1; j < near.length; j += 1) {
        const hit = segmentIntersection(near[i] as SnapSegment, near[j] as SnapSegment);
        if (hit) point(hit, 'intersection', 'Interseção');
      }
    }
  }
  if (settings.midpoint) {
    for (const segment of near) {
      point(
        { x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2 },
        'midpoint',
        `Ponto médio · ${describe(segment)}`,
        { segment },
      );
    }
  }
  if (settings.perpendicular && anchor) {
    for (const segment of near) {
      const foot = perpendicularFoot(anchor, segment.a, segment.b);
      const along = unit(sub(segment.b, segment.a));
      const toward = foot ? unit(sub(anchor, foot)) : null;
      // O último ponto sobre a própria aresta não tem perpendicular útil.
      if (!foot || !along || !toward) continue;
      point(foot, 'perpendicular', `Perpendicular · 90° (pé em ${describe(segment)})`, {
        guides: [{ from: anchor, to: foot }],
        segment,
        rightAngle: { at: foot, u: along, v: toward },
      });
    }
  }

  if (context.polar && anchor) {
    // Trava de ângulo: um ponto notável ainda prevalece; fora dele vale a direção travada.
    const locked = polarLockPlan(anchor, raw, gridStep);
    const dir = unit(sub(locked, anchor));
    if (dir) {
      const angle = Math.round((Math.atan2(dir.y, dir.x) * 180) / Math.PI);
      candidates.push({
        point: locked,
        kind: 'polar',
        label: `Trava de ângulo · ${((angle % 360) + 360) % 360}°`,
        guides: [{ from: anchor, to: locked }],
        segment: null,
        rightAngle: null,
        direction: dir,
        priority: PRIORITY.polar,
        distance: gap(locked, raw),
      });
    }
  } else {
    if (anchor) candidates.push(...directionCandidates(context, anchor));
    if (settings.alignment) {
      // Mesmo X e/ou mesmo Y de uma extremidade existente (ou de um vértice do traçado).
      const sources: Point2[] = [...(context.points ?? [])];
      for (const segment of segments) sources.push(segment.a, segment.b);
      let alignedX: Point2 | null = null;
      let alignedY: Point2 | null = null;
      let gapX = tolerance;
      let gapY = tolerance;
      for (const source of sources) {
        const dx = Math.abs(raw.x - source.x);
        const dy = Math.abs(raw.y - source.y);
        // Uma extremidade sob o próprio cursor é captura de ponto, não alinhamento.
        if (gap(source, raw) <= tolerance) continue;
        if (dx <= gapX) {
          alignedX = source;
          gapX = dx;
        }
        if (dy <= gapY) {
          alignedY = source;
          gapY = dy;
        }
      }
      if (alignedX || alignedY) {
        const at = { x: alignedX?.x ?? raw.x, y: alignedY?.y ?? raw.y };
        const guides: SnapGuide[] = [];
        if (alignedX) guides.push({ from: alignedX, to: at });
        if (alignedY) guides.push({ from: alignedY, to: at });
        point(at, 'alignment', alignedX && alignedY ? 'Alinhamento · X e Y' : 'Alinhamento', {
          guides,
        });
      }
    }
    if (settings.nearest) {
      for (const segment of near) {
        point(
          closestOnSegment(raw, segment.a, segment.b),
          'nearest',
          `Sobre ${describe(segment)}`,
          {
            segment,
          },
        );
      }
    }
  }

  // Último recurso, sempre presente: a grade ou o ponto livre.
  const onGrid = gridStep > 0 && !(context.polar && anchor);
  candidates.push({
    point: onGrid ? { x: snapStep(raw.x, gridStep), y: snapStep(raw.y, gridStep) } : raw,
    kind: onGrid ? 'grid' : 'free',
    label: '',
    guides: [],
    segment: null,
    rightAngle: null,
    direction: null,
    priority: onGrid ? PRIORITY.grid : PRIORITY.free,
    distance: 0,
  });

  candidates.sort(
    (a, b) =>
      a.priority - b.priority ||
      a.distance - b.distance ||
      a.point.x - b.point.x ||
      a.point.y - b.point.y,
  );
  // Candidatos que dão o mesmo ponto contam uma vez (fica o de maior prioridade).
  const distinct: Candidate[] = [];
  for (const candidate of candidates) {
    if (!distinct.some((other) => gap(other.point, candidate.point) < 1e-9)) {
      distinct.push(candidate);
    }
  }
  const count = distinct.length;
  const index = ((context.cycle % count) + count) % count;
  const chosen = distinct[index] as Candidate;
  return {
    point: chosen.point,
    kind: chosen.kind,
    label: chosen.label,
    guides: chosen.guides,
    segment: chosen.segment,
    rightAngle: chosen.rightAngle,
    direction: chosen.direction,
    count,
    index,
  };
}
