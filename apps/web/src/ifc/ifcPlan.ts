import {
  IFC_IDENTITY,
  ifcObjectTransform,
  type IfcImportedModel,
  type IfcImportedObject,
  type IfcTransform,
  type Point2,
  type Project,
  type Vec3,
} from '@hydrobim/core';
import type { OutlineClipPlane, OutlineFrame } from '@hydrobim/geometry';
import type { SnapSegment } from '../editor/planSnaps';
import { registerReferenceSegments } from '../editor/referenceSegments';
import { useEditorStore } from '../state/editorStore';
import {
  ifcOutline,
  nearestEdgeVertex,
  objectEdges,
  segmentsPath,
  TOP_FRAME,
  type IfcOutline,
} from './ifcGeometry';
import { ifcSourceOf, placementTransform, useIfcStore, type IfcLoadedSource } from './ifcStore';

/**
 * Objetos importados nas vistas 2D: traços (arestas vivas e contorno de corte) e pontos de
 * captura. Tudo derivado da malha do arquivo e da transformação do projeto, com cache
 * enquanto o registro do objeto e o posicionamento do modelo forem os mesmos.
 */

/**
 * Limite de objetos importados desenhados em uma vista 2D (o SVG fica pesado além disso). O
 * que passa do limite é avisado na própria vista — nunca omitido em silêncio.
 */
export const IFC_2D_LIMIT = 4000;

export interface IfcDrawEntry {
  readonly anchor: Point2;
  readonly linePath: string;
  readonly cutPath: string;
  readonly min: Point2;
  readonly max: Point2;
}

function entryOf(outline: IfcOutline | null): IfcDrawEntry | null {
  if (!outline) return null;
  const anchor = { x: Math.round(outline.min.x), y: Math.round(outline.min.y) };
  return {
    anchor,
    linePath: segmentsPath(outline.lines, anchor),
    cutPath: segmentsPath(outline.cut, anchor),
    min: outline.min,
    max: outline.max,
  };
}

interface ObjectCache {
  placement: IfcTransform;
  source: IfcLoadedSource;
  edges: Float64Array | null;
  views: Map<string, IfcDrawEntry | null>;
}

const cache = new WeakMap<IfcImportedObject, ObjectCache>();
const MAX_VIEWS = 6;

function cacheOf(
  model: IfcImportedModel,
  object: IfcImportedObject,
  source: IfcLoadedSource,
): ObjectCache {
  let entry = cache.get(object);
  if (!entry || entry.placement !== model.placement || entry.source !== source) {
    entry = { placement: model.placement, source, edges: null, views: new Map() };
    cache.set(object, entry);
  }
  return entry;
}

/** Arestas vivas do objeto no projeto (6 números por aresta). */
export function ifcWorldEdges(
  model: IfcImportedModel,
  object: IfcImportedObject,
  source: IfcLoadedSource,
): Float64Array {
  const entry = cacheOf(model, object, source);
  entry.edges ??= objectEdges(source, object.expressId, ifcObjectTransform(model, object));
  return entry.edges;
}

/** Desenho do objeto em uma vista (`key` identifica referencial e planos de corte). */
export function ifcViewEntry(
  model: IfcImportedModel,
  object: IfcImportedObject,
  source: IfcLoadedSource,
  key: string,
  frame: OutlineFrame,
  clip: readonly OutlineClipPlane[],
): IfcDrawEntry | null {
  const entry = cacheOf(model, object, source);
  const hit = entry.views.get(key);
  if (hit !== undefined) return hit;
  const drawn = entryOf(
    ifcOutline(source, object.expressId, ifcObjectTransform(model, object), frame, clip),
  );
  if (entry.views.size >= MAX_VIEWS) entry.views.clear();
  entry.views.set(key, drawn);
  return drawn;
}

export const ifcPlanEntry = (
  model: IfcImportedModel,
  object: IfcImportedObject,
  source: IfcLoadedSource,
): IfcDrawEntry | null => ifcViewEntry(model, object, source, 'top', TOP_FRAME, []);

/** Desenho de um objeto da prévia do posicionamento (sem cache: a transformação muda a cada ajuste). */
export function ifcGhostEntry(
  source: IfcLoadedSource,
  expressId: number,
  transform: IfcTransform,
): IfcDrawEntry | null {
  return entryOf(ifcOutline(source, expressId, transform, TOP_FRAME, []));
}

export interface IfcShownObject {
  readonly model: IfcImportedModel;
  readonly object: IfcImportedObject;
  readonly source: IfcLoadedSource;
}

/** Objetos importados à mostra (modelo visível, fonte lida, objeto não oculto), com geometria. */
export function shownIfcObjects(project: Pick<Project, 'ifcModels'>): IfcShownObject[] {
  const hidden = new Set(useIfcStore.getState().hidden);
  const shown: IfcShownObject[] = [];
  for (const model of project.ifcModels) {
    if (!model.visible) continue;
    const source = ifcSourceOf(model.source.sha256);
    if (!source) continue;
    for (const object of model.objects) {
      if (hidden.has(object.id) || !source.objectMeshes.has(object.expressId)) continue;
      shown.push({ model, object, source });
    }
  }
  return shown;
}

/**
 * Vértice de objeto importado à mostra mais próximo do ponto, em planta. É só um ponto de
 * referência para a modelagem: nenhuma conexão nasce da captura.
 */
export function ifcPlanVertexNear(
  project: Pick<Project, 'ifcModels'>,
  point: Point2,
  tolerance: number,
): Vec3 | null {
  let best: Vec3 | null = null;
  let bestDistance = Infinity;
  for (const { model, object, source } of shownIfcObjects(project)) {
    const entry = ifcPlanEntry(model, object, source);
    if (
      !entry ||
      point.x < entry.min.x - tolerance ||
      point.x > entry.max.x + tolerance ||
      point.y < entry.min.y - tolerance ||
      point.y > entry.max.y + tolerance
    ) {
      continue;
    }
    const vertex = nearestEdgeVertex(ifcWorldEdges(model, object, source), point, tolerance);
    if (!vertex) continue;
    const distance = Math.hypot(vertex.x - point.x, vertex.y - point.y);
    if (distance < bestDistance) {
      best = vertex;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Arestas dos objetos importados perto do cursor, como fontes de captura do motor da planta
 * (extremidade, meio, interseção, perpendicular, sobre a aresta). Só entram os objetos cuja
 * projeção alcança o cursor — um modelo grande não pesa a cada movimento.
 */
export function ifcSnapSegments(
  project: Pick<Project, 'ifcModels'>,
  raw: Point2,
  tolerance: number,
): SnapSegment[] {
  const segments: SnapSegment[] = [];
  for (const { model, object, source } of shownIfcObjects(project)) {
    const entry = ifcPlanEntry(model, object, source);
    if (
      !entry ||
      raw.x < entry.min.x - tolerance ||
      raw.x > entry.max.x + tolerance ||
      raw.y < entry.min.y - tolerance ||
      raw.y > entry.max.y + tolerance
    ) {
      continue;
    }
    const edges = ifcWorldEdges(model, object, source);
    const name = source.objects.get(object.expressId)?.name ?? 'objeto IFC';
    for (let i = 0; i + 5 < edges.length; i += 6) {
      const a = { x: edges[i] ?? 0, y: edges[i + 1] ?? 0 };
      const b = { x: edges[i + 3] ?? 0, y: edges[i + 4] ?? 0 };
      // Aresta vertical: em planta é um ponto, não uma direção.
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
      segments.push({ a, b, sourceId: object.id, sourceName: name, role: 'edge' });
    }
  }
  return segments;
}

// As capturas da planta (arquitetura) passam a enxergar as arestas dos objetos importados.
registerReferenceSegments((raw, tolerance) =>
  ifcSnapSegments(useEditorStore.getState().project, raw, tolerance),
);

/** Transformação que a prévia do posicionamento mostra agora (identidade enquanto incompleta). */
export function ghostTransform(): IfcTransform | null {
  const wizard = useIfcStore.getState().wizard;
  if (wizard?.step !== 'placing') return null;
  const transform = placementTransform(wizard.placement);
  return transform.ok ? transform.value : IFC_IDENTITY;
}

/**
 * Ponto indicado na planta durante o posicionamento. Pontos do modelo importado saem dos
 * vértices da prévia; destinos, dos vértices de modelos já inseridos. Sem vértice por perto
 * vale `fallback` (o ponto do cursor já ajustado pela vista, na cota do plano de trabalho).
 */
export function ifcPlanPick(
  project: Pick<Project, 'ifcModels'>,
  raw: Point2,
  tolerance: number,
  fallback: Vec3,
): Vec3 {
  const wizard = useIfcStore.getState().wizard;
  const picking = wizard?.step === 'placing' ? wizard.picking : null;
  const fromModel = picking === 'base' || picking === 'source1' || picking === 'source2';
  if (!fromModel) return ifcPlanVertexNear(project, raw, tolerance) ?? fallback;
  const source = wizard?.sha256 ? ifcSourceOf(wizard.sha256) : null;
  const transform = ghostTransform();
  if (!wizard || !source || !transform) return fallback;
  let best: Vec3 | null = null;
  let bestDistance = Infinity;
  for (const expressId of wizard.selected) {
    const vertex = nearestEdgeVertex(objectEdges(source, expressId, transform), raw, tolerance);
    if (!vertex) continue;
    const distance = Math.hypot(vertex.x - raw.x, vertex.y - raw.y);
    if (distance < bestDistance) {
      best = vertex;
      bestDistance = distance;
    }
  }
  return best ?? fallback;
}
