import {
  archLevelIdOf,
  archPlanPoints,
  getArchElement,
  getArchType,
  offsetAlongWall,
  openingOf,
  openingProblem,
  pointInRing,
  roofFootprint,
  roofFrame,
  roofRidgeLine,
  roofTypeOf,
  wallFootprint,
  type ArchCategory,
  type ArchElement,
  type Architecture,
  type Point2,
  type Project,
  type Wall,
} from '@hydrobim/core';
import { closestOnSegment, type SnapSegment } from '../editor/planSnaps';

export { closestOnSegment };

/**
 * Funções puras de apoio às ferramentas de arquitetura na planta: arestas de referência para as
 * capturas (resolvidas por `editor/planSnaps.ts`), parede sob o cursor, posição de portas e janelas e escolha do nível e do tipo
 * ativos. Não criam nem alteram elementos — isso é das operações
 * de `@hydrobim/core`.
 */

const walls = (architecture: Architecture): Wall[] =>
  architecture.elements.filter((element): element is Wall => element.kind === 'wall');

const gap = (a: Point2, b: Point2): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * O elemento aparece na planta de trabalho? Com `levelId`, só os do nível do plano de trabalho
 * (portas e janelas seguem a parede hospedeira); `null` = todos os níveis sobrepostos.
 */
export function archOnLevel(
  architecture: Architecture,
  element: ArchElement,
  levelId: string | null,
): boolean {
  return levelId === null || archLevelIdOf(architecture, element) === levelId;
}

const ring = (
  points: readonly Point2[],
  element: ArchElement,
  role: SnapSegment['role'],
): SnapSegment[] => {
  const segments: SnapSegment[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a && b && gap(a, b) > 1e-9) {
      segments.push({ a, b, sourceId: element.id, sourceName: element.name, role });
    }
  }
  return segments;
};

const segmentCache = new WeakMap<Architecture, Map<string, SnapSegment[]>>();

/**
 * Arestas de referência da arquitetura para as capturas da planta: eixo (linha de referência)
 * e faces das paredes, com os encontros resolvidos; lados dos contornos de lajes, pisos e
 * ambientes (e das aberturas); contorno, beirais e cumeeira dos telhados. Só entram os
 * elementos do nível pedido (`null` = todos) e fora de `exclude` — o elemento em edição não
 * captura a si mesmo. O resultado fica guardado enquanto a arquitetura (imutável) não muda.
 */
export function archSnapSegments(
  architecture: Architecture,
  options: { levelId: string | null; exclude?: readonly string[] } = { levelId: null },
): SnapSegment[] {
  const key = `${options.levelId ?? '*'}|${[...(options.exclude ?? [])].sort().join(',')}`;
  let cache = segmentCache.get(architecture);
  if (!cache) {
    cache = new Map();
    segmentCache.set(architecture, cache);
  }
  const hit = cache.get(key);
  if (hit) return hit;
  const excluded = new Set(options.exclude ?? []);
  const segments: SnapSegment[] = [];
  for (const element of architecture.elements) {
    if (excluded.has(element.id) || !archOnLevel(architecture, element, options.levelId)) continue;
    switch (element.kind) {
      case 'wall':
        segments.push({
          a: element.start,
          b: element.end,
          sourceId: element.id,
          sourceName: element.name,
          role: 'axis',
        });
        segments.push(
          ...ring(wallFootprint(architecture, element)?.polygon ?? [], element, 'face'),
        );
        break;
      case 'slab':
      case 'flooring':
        segments.push(...ring(element.boundary, element, 'edge'));
        for (const opening of element.openings) {
          segments.push(...ring(opening.boundary, element, 'edge'));
        }
        break;
      case 'space':
        segments.push(...ring(element.boundary, element, 'edge'));
        break;
      case 'roof': {
        segments.push(...ring(element.boundary, element, 'edge'));
        const type = roofTypeOf(architecture, element);
        const frame = type ? roofFrame(element, type) : null;
        if (frame) {
          if (frame.overhang > 1e-9) segments.push(...ring(roofFootprint(frame), element, 'edge'));
          const ridge = roofRidgeLine(frame);
          if (ridge) {
            segments.push({
              a: ridge[0],
              b: ridge[1],
              sourceId: element.id,
              sourceName: element.name,
              role: 'ridge',
            });
          }
        }
        break;
      }
      default:
        // Portas e janelas: a parede hospedeira já dá as arestas.
        break;
    }
  }
  cache.set(key, segments);
  return segments;
}

/**
 * Parede sob o ponto (dentro do contorno) ou a mais próxima dele dentro da tolerância. Com
 * `levelId`, só as paredes desse nível.
 */
export function wallAt(
  architecture: Architecture,
  point: Point2,
  tolerance: number,
  levelId: string | null = null,
): Wall | null {
  let best: Wall | null = null;
  let bestDistance = tolerance;
  for (const wall of walls(architecture)) {
    if (levelId !== null && wall.levelId !== levelId) continue;
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
