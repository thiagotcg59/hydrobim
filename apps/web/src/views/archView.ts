import {
  archPlanPoints,
  archTypeOf,
  archVerticalRange,
  hostedTypeOf,
  hostWallOf,
  layersThickness,
  roofFrame,
  roofRidgeLine,
  roofTypeOf,
  planArchCutOf,
  planRangeOf,
  ringCentroid,
  spaceQuantities,
  toViewPoint,
  vec3,
  viewArchClipPlanesOf,
  viewDepthOf,
  viewFrameOf,
  wallAxes,
  wallFaceOffsets,
  wallTypeOf,
  type ArchElement,
  type ArchHatch,
  type ArchType,
  type Architecture,
  type Level,
  type Point2,
  type Project,
  type ProjectView2d,
  type Space,
  type Vec3,
  type ViewClipPlane,
  type ViewFrame,
} from '@hydrobim/core';
import {
  buildArchGeometry,
  doorSwings,
  sectionLoops,
  viewOutline,
  type DoorSwing,
  type ElementGeometry,
  type PartRole,
} from '@hydrobim/geometry';
import { outlineEntry, type CachedOutline } from '../plan/planDrawing';
import { viewKeyOf, type Bounds2 } from './viewGeometry';

/**
 * Arquitetura nas vistas 2D de projeto. Nada é gravado na vista: de cada elemento saem, a
 * partir da malha real, a parte PROJETADA (abaixo ou atrás do plano de corte), a parte CORTADA
 * (seção pelo plano de corte, com a hachura do tipo) e, em planta, o que fica acima do corte
 * (tracejado). Os símbolos — folha e arco das portas, rótulo dos ambientes — são derivados do
 * mesmo modelo.
 */

type Project3 = Pick<Project, 'levels' | 'architecture'>;

// ---------------------------------------------------------------------------
// Camadas e hachura
// ---------------------------------------------------------------------------

/**
 * Camadas do desenho. `Parede_Externa`, `Parede_Interna`, `Esquadrias`, `Projeção_2`,
 * `Hachura`, `Vidro` e `Texto` são os sistemas do caderno de referência (Apêndice I,
 * disciplina Arquitetura). `Parede` (sem sufixo: parede cuja posição não foi informada),
 * `Piso`, `Telhado` e `Ambientes` são nomes do HydroBIM para o que o trecho consultado não
 * nomeia.
 */
export const ARCH_LAYERS = {
  externalWall: 'Parede_Externa',
  internalWall: 'Parede_Interna',
  wall: 'Parede',
  joinery: 'Esquadrias',
  floor: 'Piso',
  roof: 'Telhado',
  spaces: 'Ambientes',
  above: 'Projeção_2',
  hatch: 'Hachura',
  glass: 'Vidro',
  text: 'Texto',
} as const;

/** Propriedade IFC da ocorrência que diz se a parede é externa. */
export const WALL_EXTERNAL_KEY = 'Pset_WallCommon.IsExternal';

/**
 * Camada do elemento. A parede só é externa ou interna quando o usuário informou
 * `Pset_WallCommon.IsExternal`; sem o valor, fica em `Parede` — a posição não é presumida.
 */
export function archLayerOf(element: ArchElement): string {
  switch (element.kind) {
    case 'wall': {
      const external = element.ifc?.[WALL_EXTERNAL_KEY];
      if (external === true) return ARCH_LAYERS.externalWall;
      if (external === false) return ARCH_LAYERS.internalWall;
      return ARCH_LAYERS.wall;
    }
    case 'door':
    case 'window':
      return ARCH_LAYERS.joinery;
    case 'slab':
    case 'flooring':
      return ARCH_LAYERS.floor;
    case 'roof':
      return ARCH_LAYERS.roof;
    case 'space':
      return ARCH_LAYERS.spaces;
  }
}

/**
 * Hachura da seção de um tipo: a da camada estrutural (a mais espessa delas) ou, sem camada
 * estrutural, a da camada mais espessa. Revestimentos de piso e esquadrias não são hachurados.
 */
export function sectionHatchOf(type: ArchType | undefined): ArchHatch {
  if (!type || (type.category !== 'wall' && type.category !== 'slab')) return 'none';
  const structural = type.layers.filter((layer) => layer.function === 'structure');
  const pool = structural.length > 0 ? structural : type.layers;
  let chosen = pool[0];
  for (const layer of pool) {
    if (chosen && layer.thickness > chosen.thickness) chosen = layer;
  }
  return chosen?.hatch ?? 'none';
}

// ---------------------------------------------------------------------------
// Projeção da vista
// ---------------------------------------------------------------------------

export interface ArchProjection {
  readonly key: string;
  readonly kind: ProjectView2d['kind'];
  readonly frame: ViewFrame;
  /** Planos de corte da arquitetura (o primeiro é o da seção). */
  readonly clip: readonly ViewClipPlane[];
  /** Plano da seção hachurada; `null` na elevação, que não corta. */
  readonly cut: ViewClipPlane | null;
  /** Plantas: cotas do fundo da faixa, do corte da arquitetura e do topo da faixa. */
  readonly band: { readonly bottom: number; readonly cut: number; readonly top: number } | null;
  /** Cortes: trecho da linha de corte, no eixo horizontal da vista (m). */
  readonly span: { readonly from: number; readonly to: number } | null;
}

const n = (value: number): string => (Math.round(value * 1e6) / 1e6).toString();

export function archProjectionOf(
  project: Pick<Project, 'levels'>,
  view: ProjectView2d,
): ArchProjection {
  const clip = viewArchClipPlanesOf(project, view);
  const base = viewKeyOf(project, view);
  if (view.kind === 'plan') {
    const { top, bottom } = planRangeOf(project, view);
    const cut = planArchCutOf(project, view);
    return {
      key: `${base}|a${n(cut)}`,
      kind: 'plan',
      frame: viewFrameOf(view),
      clip,
      cut: clip[0] ?? null,
      band: { bottom, cut, top },
      span: null,
    };
  }
  return {
    key: base,
    kind: view.kind,
    frame: viewFrameOf(view),
    clip,
    cut: view.kind === 'section' ? (clip[0] ?? null) : null,
    band: null,
    span:
      view.kind === 'section'
        ? { from: 0, to: Math.hypot(view.b.x - view.a.x, view.b.y - view.a.y) }
        : null,
  };
}

// ---------------------------------------------------------------------------
// Símbolo de abertura das portas
// ---------------------------------------------------------------------------

/** Folha aberta e arco de uma porta, nas coordenadas da vista (m, Y para cima). */
export interface ViewSwing {
  readonly leaf: readonly [Point2, Point2];
  /** Arco anti-horário de `from` a `to`; `large` = mais de meia volta. */
  readonly arc: {
    readonly from: Point2;
    readonly to: Point2;
    readonly radius: number;
    readonly large: boolean;
  } | null;
}

/**
 * Leva o símbolo da porta (coordenadas do projeto) ao referencial de uma planta. O giro da
 * vista é uma rotação: o sentido anti-horário do arco se mantém.
 */
export function swingToView(swing: DoorSwing, frame: ViewFrame): ViewSwing {
  const map = (p: Point2): Point2 => toViewPoint(frame, vec3(p.x, p.y, 0));
  const { arc } = swing;
  const on = (angle: number): Point2 =>
    arc
      ? map({
          x: arc.center.x + arc.radius * Math.cos(angle),
          y: arc.center.y + arc.radius * Math.sin(angle),
        })
      : { x: 0, y: 0 };
  return {
    leaf: [map(swing.leaf[0]), map(swing.leaf[1])],
    arc: arc
      ? {
          from: on(arc.from),
          to: on(arc.to),
          radius: arc.radius,
          large: arc.to - arc.from > Math.PI,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Desenho de cada elemento
// ---------------------------------------------------------------------------

export interface ArchCutPart {
  readonly role: PartRole;
  /** Anéis fechados da seção (caminho SVG relativo a `cutAnchor`), para preenchimento par-ímpar. */
  readonly path: string;
}

export interface ArchViewEntry {
  readonly element: ArchElement;
  readonly layer: string;
  readonly hatch: ArchHatch;
  /** Parte projetada: o que fica abaixo (planta) ou atrás (corte) do plano de corte. */
  readonly projected: CachedOutline | null;
  /** Parte cortada pelo plano, por papel da parte. */
  readonly cut: readonly ArchCutPart[];
  readonly cutAnchor: Point2;
  /** Elemento inteiro acima do corte da planta: contorno para o traço tracejado. */
  readonly above: CachedOutline | null;
  /** Portas cortadas pela planta: folha aberta e arco. */
  readonly swings: readonly ViewSwing[];
  /** Posição mais próxima do observador (ordem de desenho). */
  readonly depth: number;
  readonly bounds: Bounds2;
}

const f = (value: number): string => (Math.round(value * 1e4) / 1e4).toString();

function loopsPath(loops: readonly Float64Array[], anchor: Point2): string {
  const path: string[] = [];
  for (const loop of loops) {
    for (let i = 0; i + 1 < loop.length; i += 2) {
      path.push(
        `${i === 0 ? 'M' : 'L'}${f((loop[i] ?? 0) - anchor.x)} ${f(-((loop[i + 1] ?? 0) - anchor.y))}`,
      );
    }
    path.push('Z');
  }
  return path.join('');
}

class Extent {
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;

  add(x: number, y: number): void {
    this.minX = Math.min(this.minX, x);
    this.minY = Math.min(this.minY, y);
    this.maxX = Math.max(this.maxX, x);
    this.maxY = Math.max(this.maxY, y);
  }

  get empty(): boolean {
    return !Number.isFinite(this.minX);
  }

  bounds(): Bounds2 {
    return { min: { x: this.minX, y: this.minY }, max: { x: this.maxX, y: this.maxY } };
  }
}

const EPS = 1e-6;

/**
 * Desenho de um elemento na vista, a partir da malha dele; `null` quando nada dele aparece
 * (ambientes não têm malha: ver `spaceLabelsOf`).
 */
export function buildArchViewEntry(
  project: Project3,
  element: ArchElement,
  geometry: ElementGeometry | null,
  projection: ArchProjection,
): ArchViewEntry | null {
  if (!geometry || element.kind === 'space') return null;
  const { frame, clip, cut, band } = projection;
  const range = archVerticalRange(project, element);
  const extent = new Extent();
  const base = {
    element,
    layer: archLayerOf(element),
    hatch: sectionHatchOf(archTypeOf(project.architecture, element)),
  };

  // Planta: o que está inteiro acima do plano de corte (janela alta, laje de cima) não é
  // cortado nem projetado para baixo — aparece só em projeção, tracejado.
  if (band && range && range.base >= band.cut - EPS) {
    if (range.base >= band.top - EPS) return null;
    const outline = viewOutline(geometry, frame, [
      { point: vec3(0, 0, band.cut), normal: vec3(0, 0, 1) },
      { point: vec3(0, 0, band.top), normal: vec3(0, 0, -1) },
    ]);
    if (!outline) return null;
    return {
      ...base,
      projected: null,
      cut: [],
      cutAnchor: { x: 0, y: 0 },
      above: outlineEntry(outline),
      swings: [],
      depth: outline.maxZ,
      bounds: {
        min: { x: outline.minX, y: outline.minY },
        max: { x: outline.maxX, y: outline.maxY },
      },
    };
  }

  // Em planta a folha da porta é representada aberta, pelo símbolo: a folha fechada da malha
  // não é desenhada (nem cortada, nem projetada).
  const crossed = Boolean(band && range && range.base < band.cut && range.top > band.cut);
  const symbol = element.kind === 'door' && band !== null;
  const drawn: ElementGeometry = symbol
    ? { ...geometry, parts: geometry.parts.filter((part) => part.role !== 'joinery') }
    : geometry;

  const outline = viewOutline(drawn, frame, clip);
  if (outline) {
    extent.add(outline.minX, outline.minY);
    extent.add(outline.maxX, outline.maxY);
  }

  const sections = cut ? sectionLoops(drawn, frame, cut) : [];
  for (const section of sections) {
    for (const loop of section.loops) {
      for (let i = 0; i + 1 < loop.length; i += 2) extent.add(loop[i] ?? 0, loop[i + 1] ?? 0);
    }
  }

  const swings =
    element.kind === 'door' && crossed
      ? doorSwings(project, element).map((swing) => swingToView(swing, frame))
      : [];
  for (const swing of swings) {
    for (const p of swing.leaf) extent.add(p.x, p.y);
    if (swing.arc) {
      extent.add(swing.arc.from.x, swing.arc.from.y);
      extent.add(swing.arc.to.x, swing.arc.to.y);
    }
  }

  if (extent.empty || (!outline && sections.length === 0 && swings.length === 0)) return null;
  const cutAnchor = { x: Math.round(extent.minX), y: Math.round(extent.minY) };
  // A seção fica no plano de corte: é o que está mais perto do observador.
  const cutDepth = cut && sections.length > 0 ? viewDepthOf(frame, cut.point) : -Infinity;
  return {
    ...base,
    projected: outline ? outlineEntry(outline) : null,
    cut: sections.map((section) => ({
      role: section.role,
      path: loopsPath(section.loops, cutAnchor),
    })),
    cutAnchor,
    above: null,
    swings,
    depth: Math.max(outline?.maxZ ?? -Infinity, cutDepth),
    bounds: extent.bounds(),
  };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * A malha de uma parede depende das vizinhas (encontros) e das portas e janelas hospedadas;
 * por isso o cache vale para o objeto `project.architecture` inteiro, não por elemento. O
 * projeto é imutável: qualquer alteração na arquitetura troca o objeto e descarta tudo. Uma
 * alteração só na rede (ou nas vistas) mantém a arquitetura — e o cache.
 */
interface ArchCache {
  readonly levels: readonly Level[];
  readonly geometry: Map<string, ElementGeometry | null>;
  readonly entries: Map<string, ArchViewEntry | null>;
}

const caches = new WeakMap<Architecture, ArchCache>();
/** Projeções guardadas por elemento: uma por vista aberta recentemente. */
const MAX_VIEWS = 6;

function cacheOf(project: Project3): ArchCache {
  let cache = caches.get(project.architecture);
  // A cota da base vem dos níveis: outro conjunto de níveis invalida as malhas.
  if (!cache || cache.levels !== project.levels) {
    cache = { levels: project.levels, geometry: new Map(), entries: new Map() };
    caches.set(project.architecture, cache);
  }
  return cache;
}

/** Malha do elemento arquitetônico (referencial local), guardada enquanto a arquitetura não muda. */
export function archGeometryOf(project: Project3, element: ArchElement): ElementGeometry | null {
  const cache = cacheOf(project);
  const hit = cache.geometry.get(element.id);
  if (hit !== undefined) return hit;
  const geometry = buildArchGeometry(project, element);
  cache.geometry.set(element.id, geometry);
  return geometry;
}

/** Desenho do elemento na vista; `null` quando o corte não deixa nada dele à mostra. */
export function archViewEntryOf(
  project: Project3,
  element: ArchElement,
  projection: ArchProjection,
): ArchViewEntry | null {
  const cache = cacheOf(project);
  const key = `${element.id}|${projection.key}`;
  const hit = cache.entries.get(key);
  if (hit !== undefined) return hit;
  const entry = buildArchViewEntry(project, element, archGeometryOf(project, element), projection);
  if (cache.entries.size >= MAX_VIEWS * Math.max(1, project.architecture.elements.length)) {
    cache.entries.clear();
  }
  cache.entries.set(key, entry);
  return entry;
}

// ---------------------------------------------------------------------------
// Ambientes
// ---------------------------------------------------------------------------

export interface SpaceLabel {
  readonly element: Space;
  /** Contorno do ambiente, nas coordenadas da vista. */
  readonly ring: readonly Point2[];
  readonly center: Point2;
  /** Linhas do rótulo: número e nome; área. */
  readonly lines: readonly string[];
}

/** Área de ambiente como vai ao desenho: m², duas casas. */
export const formatSpaceArea = (area: number): string =>
  `${area.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;

/**
 * Rótulos dos ambientes de uma planta: os que têm o piso dentro da faixa, do fundo até o
 * plano de corte da arquitetura. Cortes e elevações não rotulam ambientes.
 */
export function spaceLabelsOf(
  project: Project3,
  elements: readonly ArchElement[],
  projection: ArchProjection,
): SpaceLabel[] {
  const { band, frame } = projection;
  if (!band) return [];
  const labels: SpaceLabel[] = [];
  for (const element of elements) {
    if (element.kind !== 'space') continue;
    const range = archVerticalRange(project, element);
    if (!range || range.base < band.bottom - EPS || range.base > band.cut + EPS) continue;
    const map = (p: Point2): Point2 => toViewPoint(frame, vec3(p.x, p.y, 0));
    const title = [element.number, element.name.trim()].filter(Boolean).join(' ');
    labels.push({
      element,
      ring: element.boundary.map(map),
      center: map(ringCentroid(element.boundary)),
      lines: [...(title ? [title] : []), formatSpaceArea(spaceQuantities(element).area)],
    });
  }
  return labels;
}

// ---------------------------------------------------------------------------
// Pontos de captura
// ---------------------------------------------------------------------------

/** Pontos notáveis do elemento em planta: cantos e extremidades (coordenadas do projeto). */
export function archNotablePoints(architecture: Architecture, element: ArchElement): Point2[] {
  switch (element.kind) {
    case 'wall':
      // Cantos do contorno (com os encontros resolvidos) e as pontas da linha de referência.
      return [...archPlanPoints(architecture, element), element.start, element.end];
    case 'slab':
    case 'flooring':
      return [...element.boundary, ...element.openings.flatMap((opening) => opening.boundary)];
    case 'space':
      return element.boundary;
    case 'roof': {
      // Cantos do contorno de referência, da projeção com os beirais e as pontas da cumeeira.
      const type = roofTypeOf(architecture, element);
      const frame = type ? roofFrame(element, type) : null;
      return [
        ...element.boundary,
        ...archPlanPoints(architecture, element),
        ...((frame && roofRidgeLine(frame)) ?? []),
      ];
    }
    case 'door':
    case 'window': {
      // Cantos do vão: as duas ombreiras, nas duas faces da parede.
      const host = hostWallOf(architecture, element);
      const type = hostedTypeOf(architecture, element);
      const wallType = host ? wallTypeOf(architecture, host) : undefined;
      if (!host || !type || !wallType) return [];
      const { dir, left } = wallAxes(host);
      const { lo, hi } = wallFaceOffsets(host, layersThickness(wallType));
      const points: Point2[] = [];
      for (const s of [element.offset - type.width / 2, element.offset + type.width / 2]) {
        for (const side of [lo, hi]) {
          points.push({
            x: host.start.x + dir.x * s + left.x * side,
            y: host.start.y + dir.y * s + left.y * side,
          });
        }
      }
      return points;
    }
  }
}

const inside = (point: Vec3, clip: readonly ViewClipPlane[]): boolean =>
  clip.every(
    (plane) =>
      (point.x - plane.point.x) * plane.normal.x +
        (point.y - plane.point.y) * plane.normal.y +
        (point.z - plane.point.z) * plane.normal.z >=
      -1e-9,
  );

/**
 * Pontos de captura da arquitetura à mostra na vista: em planta, os pontos notáveis dos
 * elementos que alcançam a faixa; em corte e elevação, os mesmos pontos na base e no topo de
 * cada elemento, dentro dos planos de corte.
 */
export function archSnapPoints(
  project: Project3,
  elements: readonly ArchElement[],
  projection: ArchProjection,
): Point2[] {
  const { band, frame, clip } = projection;
  const points: Point2[] = [];
  for (const element of elements) {
    const range = archVerticalRange(project, element);
    if (!range) continue;
    const notable = archNotablePoints(project.architecture, element);
    if (band) {
      if (range.top < band.bottom - EPS || range.base > band.top + EPS) continue;
      for (const p of notable) points.push(toViewPoint(frame, vec3(p.x, p.y, 0)));
      continue;
    }
    const heights = range.top - range.base > EPS ? [range.base, range.top] : [range.base];
    for (const p of notable) {
      for (const z of heights) {
        const point = vec3(p.x, p.y, z);
        if (inside(point, clip)) points.push(toViewPoint(frame, point));
      }
    }
  }
  return points;
}

/** Envoltória da arquitetura desenhada na vista (elementos e contornos dos ambientes). */
export function archBoundsOf(
  entries: readonly ArchViewEntry[],
  spaces: readonly SpaceLabel[],
): Bounds2 | null {
  const extent = new Extent();
  for (const entry of entries) {
    extent.add(entry.bounds.min.x, entry.bounds.min.y);
    extent.add(entry.bounds.max.x, entry.bounds.max.y);
  }
  for (const space of spaces) {
    for (const p of space.ring) extent.add(p.x, p.y);
  }
  return extent.empty ? null : extent.bounds();
}
