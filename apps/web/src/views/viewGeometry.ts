import {
  detailPointsOf,
  getPorts,
  planRangeOf,
  toViewPoint,
  viewClipPlanesOf,
  viewFrameOf,
  type HydroElement,
  type Point2,
  type Project,
  type ProjectView2d,
  type Vec3,
  type ViewClipPlane,
  type ViewFrame,
} from '@hydrobim/core';
import { buildElementGeometry, viewOutline } from '@hydrobim/geometry';
import { outlineEntry, type CachedOutline } from '../plan/planDrawing';

/**
 * Projeção dos elementos nas vistas de projeto. Tudo é derivado do modelo: a vista só informa o
 * referencial e os planos de corte. O projeto é imutável, então a projeção de um elemento em
 * uma dada vista vale enquanto o objeto do elemento e os parâmetros da vista forem os mesmos.
 */

export interface Bounds2 {
  min: Point2;
  max: Point2;
}

const cache = new WeakMap<HydroElement, Map<string, CachedOutline | null>>();
/** Projeções guardadas por elemento: uma por vista aberta recentemente. */
const MAX_PER_ELEMENT = 6;

const n = (value: number): string => (Math.round(value * 1e6) / 1e6).toString();

/** Parâmetros da vista que mudam a projeção (referencial e planos de corte). */
export function viewKeyOf(project: Pick<Project, 'levels'>, view: ProjectView2d): string {
  if (view.kind === 'plan') {
    const { top, bottom } = planRangeOf(project, view);
    return `p|${n(view.rotation)}|${n(top)}|${n(bottom)}`;
  }
  if (view.kind === 'elevation') return `e|${view.direction}`;
  return `s|${n(view.a.x)}|${n(view.a.y)}|${n(view.b.x)}|${n(view.b.y)}|${view.side}|${n(view.depth)}`;
}

export interface ViewProjection {
  readonly key: string;
  readonly frame: ViewFrame;
  readonly clip: readonly ViewClipPlane[];
}

export function viewProjectionOf(
  project: Pick<Project, 'levels'>,
  view: ProjectView2d,
): ViewProjection {
  return {
    key: viewKeyOf(project, view),
    frame: viewFrameOf(view),
    clip: viewClipPlanesOf(project, view),
  };
}

/** Desenho do elemento na vista; `null` quando o corte não deixa nada dele à mostra. */
export function viewEntryOf(
  element: HydroElement,
  projection: ViewProjection,
): CachedOutline | null {
  let entries = cache.get(element);
  if (!entries) {
    entries = new Map();
    cache.set(element, entries);
  }
  const hit = entries.get(projection.key);
  if (hit !== undefined) return hit;
  const outline = viewOutline(buildElementGeometry(element), projection.frame, projection.clip);
  const entry = outline ? outlineEntry(outline) : null;
  if (entries.size >= MAX_PER_ELEMENT) entries.clear();
  entries.set(projection.key, entry);
  return entry;
}

const inside = (point: Vec3, clip: readonly ViewClipPlane[]): boolean =>
  clip.every(
    (plane) =>
      (point.x - plane.point.x) * plane.normal.x +
        (point.y - plane.point.y) * plane.normal.y +
        (point.z - plane.point.z) * plane.normal.z >=
      -1e-9,
  );

/** Pontos de captura dos elementos à mostra: portas e origens das peças, dentro do corte. */
export function elementSnapPoints(
  elements: readonly HydroElement[],
  projection: ViewProjection,
): Point2[] {
  const points: Point2[] = [];
  for (const element of elements) {
    const candidates = getPorts(element).map((port) => port.position);
    if (element.kind !== 'pipe') candidates.push(element.placement.position);
    for (const candidate of candidates) {
      if (inside(candidate, projection.clip)) points.push(toViewPoint(projection.frame, candidate));
    }
  }
  return points;
}

/** Envoltória do que a vista desenha: elementos projetados e detalhes. */
export function contentBoundsOf(
  entries: readonly CachedOutline[],
  view: Pick<ProjectView2d, 'details' | 'visibility'>,
): Bounds2 | null {
  const bounds: Bounds2 = {
    min: { x: Infinity, y: Infinity },
    max: { x: -Infinity, y: -Infinity },
  };
  const include = (x: number, y: number): void => {
    bounds.min = { x: Math.min(bounds.min.x, x), y: Math.min(bounds.min.y, y) };
    bounds.max = { x: Math.max(bounds.max.x, x), y: Math.max(bounds.max.y, y) };
  };
  for (const { outline } of entries) {
    include(outline.minX, outline.minY);
    include(outline.maxX, outline.maxY);
  }
  if (view.visibility.details) {
    for (const detail of view.details) {
      for (const point of detailPointsOf(detail)) include(point.x, point.y);
    }
  }
  return Number.isFinite(bounds.min.x) ? bounds : null;
}
