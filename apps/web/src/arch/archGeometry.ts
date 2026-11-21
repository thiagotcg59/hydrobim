import {
  archPlanPoints,
  getArchElement,
  getArchType,
  offsetAlongWall,
  openingOf,
  openingProblem,
  pointInRing,
  wallFootprint,
  type ArchCategory,
  type Architecture,
  type Point2,
  type Project,
  type Wall,
} from '@hydrobim/core';

/**
 * Funções puras de apoio às ferramentas de arquitetura na planta: captura de pontos em paredes
 * existentes, parede sob o cursor, posição de portas e janelas, entrada numérica do comprimento
 * e escolha do nível e do tipo ativos. Não criam nem alteram elementos — isso é das operações
 * de `@hydrobim/core`.
 */

export type ArchSnapKind = 'endpoint' | 'face' | 'grid' | 'free';

export interface ArchSnap {
  readonly point: Point2;
  readonly kind: ArchSnapKind;
}

const walls = (architecture: Architecture): Wall[] =>
  architecture.elements.filter((element): element is Wall => element.kind === 'wall');

/** Ponto do segmento `a`–`b` mais próximo de `p`. */
export function closestOnSegment(p: Point2, a: Point2, b: Point2): Point2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const size2 = dx * dx + dy * dy;
  if (size2 < 1e-18) return a;
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / size2));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

const gap = (a: Point2, b: Point2): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Captura de um ponto da planta para as ferramentas de arquitetura, nesta ordem: extremidades
 * (da linha de referência e do contorno) das paredes existentes, faces e eixo delas, a grade
 * (se `gridStep` > 0) e, por fim, o ponto livre.
 */
export function snapArchPoint(
  architecture: Architecture,
  raw: Point2,
  options: { tolerance: number; gridStep: number },
): ArchSnap {
  let best: Point2 | null = null;
  let bestDistance = options.tolerance;
  const footprints: { wall: Wall; polygon: readonly Point2[] }[] = [];
  for (const wall of walls(architecture)) {
    const polygon = wallFootprint(architecture, wall)?.polygon ?? [];
    footprints.push({ wall, polygon });
    for (const candidate of [wall.start, wall.end, ...polygon]) {
      const d = gap(candidate, raw);
      if (d <= bestDistance) {
        best = candidate;
        bestDistance = d;
      }
    }
  }
  if (best) return { point: best, kind: 'endpoint' };
  bestDistance = options.tolerance;
  for (const { wall, polygon } of footprints) {
    const edges: [Point2, Point2][] = [[wall.start, wall.end]];
    for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      if (a && b) edges.push([a, b]);
    }
    for (const [a, b] of edges) {
      const candidate = closestOnSegment(raw, a, b);
      const d = gap(candidate, raw);
      if (d <= bestDistance) {
        best = candidate;
        bestDistance = d;
      }
    }
  }
  if (best) return { point: best, kind: 'face' };
  if (options.gridStep > 0) {
    return {
      point: {
        x: Math.round(raw.x / options.gridStep) * options.gridStep,
        y: Math.round(raw.y / options.gridStep) * options.gridStep,
      },
      kind: 'grid',
    };
  }
  return { point: raw, kind: 'free' };
}

/** Parede sob o ponto (dentro do contorno) ou a mais próxima dele dentro da tolerância. */
export function wallAt(architecture: Architecture, point: Point2, tolerance: number): Wall | null {
  let best: Wall | null = null;
  let bestDistance = tolerance;
  for (const wall of walls(architecture)) {
    const polygon = wallFootprint(architecture, wall)?.polygon;
    if (!polygon || polygon.length < 3) continue;
    if (pointInRing(polygon, point.x, point.y)) return wall;
    for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      if (!a || !b) continue;
      const d = gap(closestOnSegment(point, a, b), point);
      if (d <= bestDistance) {
        best = wall;
        bestDistance = d;
      }
    }
  }
  return best;
}

export interface HostedPlacement {
  readonly wall: Wall;
  /** Distância do início da parede ao centro do vão (m). */
  readonly offset: number;
  readonly width: number;
  /** Por que o vão não cabe (mensagem do núcleo) ou `null` se cabe. */
  readonly problem: string | null;
}

/**
 * Onde uma porta ou janela do tipo dado ficaria ao clicar em `point`: a parede sob o cursor e
 * a posição ao longo dela (no passo da grade, quando ligado). O cabimento do vão é conferido
 * pela regra do núcleo (`openingProblem`) — a mesma que a criação aplica.
 */
export function hostedPlacementAt(
  project: Pick<Project, 'architecture'>,
  kind: 'door' | 'window',
  typeId: string,
  point: Point2,
  options: { tolerance: number; gridStep: number; sillHeight?: number | null },
): HostedPlacement | null {
  const { architecture } = project;
  const wall = wallAt(architecture, point, options.tolerance);
  const type = getArchType(architecture, typeId);
  if (!wall || !type || type.category !== kind) return null;
  const along = offsetAlongWall(wall, point);
  const offset =
    options.gridStep > 0 ? Math.round(along / options.gridStep) * options.gridStep : along;
  const sillHeight = options.sillHeight ?? (type.category === 'window' ? type.sillHeight : 0);
  const problem = openingProblem(
    architecture,
    wall,
    openingOf({ id: '', kind, offset, sillHeight }, type),
  );
  return { wall, offset, width: type.width, problem };
}

/** Ponto a `length` metros de `from`, na direção de `toward`; `null` sem direção definida. */
export function pointAtLength(from: Point2, toward: Point2, length: number): Point2 | null {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const size = Math.hypot(dx, dy);
  if (size < 1e-9 || !Number.isFinite(length) || length <= 0) return null;
  return { x: from.x + (dx / size) * length, y: from.y + (dy / size) * length };
}

/** Comprimento digitado (vírgula ou ponto decimal), em metros; `null` se não for positivo. */
export function parseLength(text: string): number | null {
  const normalized = text.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Nível do plano de trabalho: o de mesma cota ou, sem coincidência, o mais próximo abaixo. */
export function workLevelIdOf(project: Pick<Project, 'levels'>, workPlaneZ: number): string | null {
  const exact = project.levels.find((level) => Math.abs(level.elevation - workPlaneZ) < 1e-9);
  if (exact) return exact.id;
  const below = project.levels
    .filter((level) => level.elevation <= workPlaneZ)
    .sort((a, b) => b.elevation - a.elevation)[0];
  return below?.id ?? project.levels[0]?.id ?? null;
}

/** Tipo em uso de uma categoria: o escolhido, se ainda existe; senão o primeiro do projeto. */
export function activeTypeIdOf(
  project: Pick<Project, 'architecture'>,
  active: Partial<Record<ArchCategory, string>>,
  category: ArchCategory,
): string | null {
  const chosen = active[category];
  const types = project.architecture.types.filter((type) => type.category === category);
  if (chosen && types.some((type) => type.id === chosen)) return chosen;
  return types[0]?.id ?? null;
}

/** Centro, em planta, da envoltória dos elementos (centro de giro sugerido). */
export function planCenterOf(architecture: Architecture, ids: readonly string[]): Point2 | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const element = getArchElement(architecture, id);
    if (!element) continue;
    for (const p of archPlanPoints(architecture, element)) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** Quantas portas e janelas uma exclusão de paredes leva junto (além das já escolhidas). */
export function hostedCarriedBy(architecture: Architecture, ids: readonly string[]): number {
  const chosen = new Set(ids);
  return architecture.elements.filter(
    (element) =>
      (element.kind === 'door' || element.kind === 'window') &&
      !chosen.has(element.id) &&
      chosen.has(element.hostId),
  ).length;
}
