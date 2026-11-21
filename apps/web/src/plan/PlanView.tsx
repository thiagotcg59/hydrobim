import {
  add,
  angleBetween,
  computeBounds,
  AXIS_X,
  AXIS_Y,
  AXIS_Z,
  scale,
  axisElevationForCover,
  coverAlongSegment,
  dimensionOffsetAt,
  fail,
  distance,
  formatMeters,
  getAnnotation,
  georeferenceStatus,
  getElement,
  getPorts,
  ok,
  planSnapPoints,
  resolvePort,
  sub,
  terrainStats,
  updateAnnotation,
  vec3,
  type Annotation,
  type AnnotationPatch,
  type HydroElement,
  type Point2,
  type Project,
  type Result,
  type Vec3,
} from '@hydrobim/core';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { SNAP_PX, type SnapKind } from '../editor/picking';
import { formatSegment } from '../editor/segment';
import { describeSnap } from '../editor/snapLabel';
import { getViewFocus, planScaleFor, setViewFocus } from '../editor/viewPresets';
import { visibleElementsOf, visibleFreePortsOf } from '../editor/visibility';
import { arrowPreferences, contextTargetOf, CONTEXT_PX, nudgeStep } from '../editor/directEdit';
import { isPolarLockHeld, polarLockedPoint } from '../editor/polarLock';
import { lengthStepOf, precisePipePoint } from '../editor/precision';
import { precision } from '../state/precisionStore';
import { pickPlanPoint, pickPlanPort, planPipeHit, type PlanPick } from '../editor/planPicking';
import { BasemapLayer, type BasemapStatus } from '../infra/BasemapLayer';
import { GeoPicker } from '../infra/GeoPicker';
import { CoordinateGrid, NetworkLabels, SimplifiedElement } from '../infra/InfraLayers';
import { InfraOverlay } from '../infra/InfraPanel';
import {
  infraLayerOf,
  intersects,
  isSimplified,
  labelOf,
  placeLabels,
  planBoxOf,
  type PlanLabel,
} from '../infra/infraPlan';
import { CUSTOM_BASEMAP_ID } from '../map/customSource';
import { findBasemapProvider } from '../map/providers';
import type { ViewBounds } from '../map/tiles';
import { downloadText, projectFileBase } from '../persistence/fileIO';
import {
  deflectionConstraintOf,
  drawElevationOf,
  equipmentGroundElevation,
  isAnnotationTool,
  pipeCrossingOf,
  pipeSnapOf,
  useEditorStore,
} from '../state/editorStore';
import { alignGuidesOf, pointGridStepOf } from '../state/alignTool';
import { useUiStore } from '../state/uiStore';
import { SectionDraft, SectionMarkers } from '../views/SectionMarkers';
import { useViewStore } from '../views/viewStore';
import { cursorElementOf } from '../state/viewPreview';
import { TerrainEditingLayer, TerrainSurfacePlan } from '../terrain/TerrainLayers';
import { planDrawOrder } from './drawOrder';
import { PlanPreviewLayer } from './PlanPreviewLayer';
import { InlineClearanceLayer } from './InlineClearanceLayer';
import { TerrainPanel } from '../terrain/TerrainPanel';
import { TerrainProfilePanel } from '../terrain/TerrainProfilePanel';
import { useTerrainStore } from '../terrain/terrainStore';
import { useTerrainKeys } from '../terrain/useTerrainKeys';
import { AnnotationInspector } from './AnnotationInspector';
import { rectOf, windowModeOf } from '../editor/crossingSelection';
import { axisShape, elementsInPlanWindow, outlineShape } from './planSelection';
import {
  AnnotationShape,
  annotationPoints,
  HIGHLIGHT,
  INK,
  outlineOf,
  PAPER,
  PlanElement,
} from './planDrawing';

interface View {
  /** Centro da vista (m) e metros do modelo por pixel de tela. */
  readonly cx: number;
  readonly cy: number;
  readonly mpp: number;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Drag {
  readonly x: number;
  readonly y: number;
  readonly button: number;
  readonly mode: 'pan' | 'annotation' | 'click' | 'grip' | 'window';
  readonly annotationId: string | null;
  readonly elementId: string | null;
  readonly origin: Point2;
  readonly view: View;
  moved: boolean;
}

const CLICK_TOLERANCE_PX = 4;
const DEFAULT_TEXT = 'TEXTO';

/** Maior ampliação de afastamento (m por pixel): no Infra a vista alcança dezenas de km. */
const MAX_MPP = { mep: 10, infra: 200 } as const;

// O projeto é imutável: a caixa de um elemento vale enquanto o objeto for o mesmo.
const boxCache = new WeakMap<HydroElement, ViewBounds>();
function boxOf(element: HydroElement): ViewBounds {
  let box = boxCache.get(element);
  if (!box) {
    box = planBoxOf(element);
    boxCache.set(element, box);
  }
  return box;
}

/** Cota mais alta do elemento, pelas portas: ordem de desenho sem gerar a malha. */
function topOf(element: HydroElement): number {
  let top = element.kind === 'pipe' ? -Infinity : element.placement.position.z;
  for (const port of getPorts(element)) top = Math.max(top, port.position.z);
  return top + element.spec.outerDiameter / 2;
}

/** Envoltória dos elementos selecionados visíveis em planta (nula se nenhum estiver visível). */
function selectionBounds(project: Project, selection: readonly string[]): Bounds | null {
  const chosen = visibleElementsOf(project).filter((element) => selection.includes(element.id));
  if (project.discipline === 'infra') {
    const box = computeBounds(chosen);
    return box ? { minX: box.min.x, minY: box.min.y, maxX: box.max.x, maxY: box.max.y } : null;
  }
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const element of chosen) {
    const { outline } = outlineOf(element);
    bounds.minX = Math.min(bounds.minX, outline.minX);
    bounds.minY = Math.min(bounds.minY, outline.minY);
    bounds.maxX = Math.max(bounds.maxX, outline.maxX);
    bounds.maxY = Math.max(bounds.maxY, outline.maxY);
  }
  return Number.isFinite(bounds.minX) ? bounds : null;
}

/** Envoltória do desenho: elementos visíveis e anotações. */
function planBounds(project: Project): Bounds | null {
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const include = (x: number, y: number): void => {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxY = Math.max(bounds.maxY, y);
  };
  if (project.discipline === 'infra') {
    // Redes extensas: a envoltória vem das portas, sem projetar a malha de cada elemento.
    const box = computeBounds(visibleElementsOf(project));
    if (box) {
      include(box.min.x, box.min.y);
      include(box.max.x, box.max.y);
    }
  } else {
    for (const element of visibleElementsOf(project)) {
      const { outline } = outlineOf(element);
      include(outline.minX, outline.minY);
      include(outline.maxX, outline.maxY);
    }
  }
  for (const annotation of project.annotations) {
    for (const p of annotationPoints(project, annotation)) include(p.x, p.y);
  }
  // No Infra, a superfície do terreno faz parte do desenho: enquadrar leva até ela.
  if (project.discipline === 'infra' && project.terrain && project.infra.layers.terrain) {
    const stats = terrainStats(project.terrain);
    include(stats.minX, stats.minY);
    include(stats.maxX, stats.maxY);
  }
  return Number.isFinite(bounds.minX) ? bounds : null;
}

function movePatch(annotation: Annotation, origin: Point2, to: Point2): AnnotationPatch {
  if (annotation.kind === 'dimension') return { offset: dimensionOffsetAt(annotation, to) };
  return {
    position: {
      x: annotation.position.x + to.x - origin.x,
      y: annotation.position.y + to.y - origin.y,
    },
  };
}

const idOf = (target: EventTarget, attribute: string): string | null =>
  target instanceof Element
    ? (target.closest(`[${attribute}]`)?.getAttribute(attribute) ?? null)
    : null;

/**
 * Elemento sob o cursor e o ponto correspondente sobre o eixo, quando ele é um tubo legível
 * em planta (em tubo vertical a posição ao longo do eixo é indefinida).
 */
function planHit(
  project: Project,
  elementId: string | null,
  raw: Point2,
): { elementId: string; point: Vec3 | null } | null {
  const element = elementId ? getElement(project, elementId) : undefined;
  if (!element) return null;
  const onAxis = element.kind === 'pipe' ? planPipeHit(element, raw) : null;
  return { elementId: element.id, point: onAxis?.ok ? onAxis.value : null };
}

/**
 * Planta baixa: projeção horizontal do modelo em traço técnico, com cotas, textos, chamadas
 * e etiquetas. As ferramentas de modelagem também atuam aqui: o clique é resolvido em ponto
 * 3D, porta e elemento (`planPicking`) e entregue à store, como no viewport 3D. A vista não
 * contém regras de modelagem: lê o projeto e chama a store.
 */
export function PlanView() {
  const project = useEditorStore((s) => s.project);
  const selection = useEditorStore((s) => s.selection);
  const annotationSelection = useEditorStore((s) => s.annotationSelection);
  const tool = useEditorStore((s) => s.tool);
  const draft = useEditorStore((s) => s.planDraft);
  const dimensionMode = useEditorStore((s) => s.dimensionMode);
  const thinLines = useEditorStore((s) => s.planThinLines);
  const theme = useEditorStore((s) => s.planTheme);
  const snapToGrid = useEditorStore((s) => s.snapToGrid);
  const gridStep = useEditorStore((s) => s.gridStep);
  const anchor = useEditorStore((s) => s.anchor);
  const measure = useEditorStore((s) => s.measure);
  const align = useEditorStore((s) => s.align);
  const workPlaneZ = useEditorStore((s) => s.workPlaneZ);
  /** Corte em criação (vistas de projeto): a linha é desenhada aqui, em planta. */
  const sectionTool = useViewStore((s) => s.tool === 'section');
  const sectionDraft = useViewStore((s) => s.draft);
  /** Ferramenta de modelagem ativa (tubo, conexões, equipamentos, medição). */
  const modeling = tool !== 'select' && !isAnnotationTool(tool);

  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ cx: 0, cy: 0, mpp: 0.01 });
  const [pointer, setPointer] = useState<{
    point: Point2;
    snap: SnapKind;
    /** Ponto 3D resolvido para as ferramentas de modelagem. */
    pick?: PlanPick;
    /** Identificação da captura (elemento, porta, cota) ou aviso de cruzamento. */
    info?: string | null;
  } | null>(null);
  const [preview, setPreview] = useState<{ id: string; patch: AnnotationPatch } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  /** Janela de seleção em andamento (cantos no modelo). */
  const [selectionWindow, setSelectionWindow] = useState<{ from: Point2; to: Point2 } | null>(null);

  /**
   * Ambiente Infra: a planta ganha mapa de fundo, malha de coordenadas, camadas, níveis de
   * detalhe e a sua própria escala de documentação. No MEP nada disso é montado.
   */
  const infra = project.discipline === 'infra';
  const settings = project.infra;
  const geo = useMemo(() => georeferenceStatus(project.georeference), [project.georeference]);
  /** Origem de desenho: o SVG mostra as coordenadas do projeto menos este ponto. */
  const renderOrigin = useEditorStore((s) => s.renderOrigin);
  const origin = useMemo<Point2>(
    () => ({ x: renderOrigin.x, y: renderOrigin.y }),
    [renderOrigin.x, renderOrigin.y],
  );
  const X = (x: number): number => x - origin.x;
  const Y = (y: number): number => -(y - origin.y);
  const [basemapStatus, setBasemapStatus] = useState<BasemapStatus | null>(null);
  const [basemapRetry, setBasemapRetry] = useState(0);
  const geoPicker = useEditorStore((s) => s.geoPicker);
  /** Operação do terreno em andamento (área, furo, corte ou consulta): ela recebe os cliques. */
  const terrainMode = useTerrainStore((s) => (infra ? s.mode : null));
  /**
   * Superfície do terreno à mostra na planta: no Infra é uma camada do ambiente (gravada no
   * projeto); no MEP é opção de exibição da sessão, desligada por padrão.
   */
  const mepTerrainPlan = useTerrainStore((s) => s.display.mepPlan);
  const showTerrainPlan = infra ? settings.layers.terrain : mepTerrainPlan;
  useTerrainKeys();

  /** Milímetro de papel em metros do modelo, na escala de documentação do ambiente. */
  const unit = (infra ? settings.drawingScale : project.drawingScale) / 1000;

  const fit = useCallback((width: number, height: number): void => {
    const { project, selection, viewRequest } = useEditorStore.getState();
    // Enquadrar a seleção cai no projeto inteiro se nada selecionado estiver visível.
    const bounds =
      (viewRequest?.selection ? selectionBounds(project, selection) : null) ?? planBounds(project);
    if (!bounds || width <= 0 || height <= 0) {
      setView({ cx: 0, cy: 0, mpp: 0.01 });
      return;
    }
    // Folga para as anotações e para a barra de opções, no alto da vista.
    const margin = 220;
    const mpp = Math.max(
      (bounds.maxX - bounds.minX) / Math.max(width - margin, 60),
      (bounds.maxY - bounds.minY) / Math.max(height - margin, 60),
      1e-5,
    );
    setView({
      cx: (bounds.minX + bounds.maxX) / 2,
      cy: (bounds.minY + bounds.maxY) / 2 + 28 * mpp,
      mpp,
    });
  }, []);

  /** A vista já foi posicionada (antes disso o estado inicial não é um ponto de interesse). */
  const framed = useRef(false);
  useEffect(() => {
    if (!framed.current || size.height <= 0) return;
    const previous = getViewFocus();
    setViewFocus({
      // A planta não tem cota própria: mantém a do ponto de interesse do modelo 3D.
      center: vec3(view.cx, view.cy, previous?.center.z ?? workPlaneZ),
      halfHeight: (size.height / 2) * view.mpp,
    });
    // Longe da origem de desenho o SVG perderia os milímetros: ela acompanha a vista. A cota
    // não interessa à planta e fica como está.
    const store = useEditorStore.getState();
    store.rebaseRenderOrigin(vec3(view.cx, view.cy, store.renderOrigin.z));
  }, [view, size.height, workPlaneZ]);

  useEffect(() => {
    const node = svgRef.current?.parentElement;
    if (!node) return;
    let first = true;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize({ width: rect.width, height: rect.height });
      if (first && rect.width > 0) {
        first = false;
        // Vindo do modelo 3D, a planta abre no mesmo trecho e na mesma ampliação.
        // Com a planta vazia não há trecho a acompanhar: vale a vista inicial.
        const focus = planBounds(useEditorStore.getState().project) ? getViewFocus() : null;
        if (focus) {
          setView({
            cx: focus.center.x,
            cy: focus.center.y,
            mpp: planScaleFor(focus.halfHeight, rect.height),
          });
        } else fit(rect.width, rect.height);
        framed.current = true;
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fit]);

  // "Enquadrar" e a abertura de um projeto reenquadram a planta.
  useEffect(
    () =>
      useEditorStore.subscribe((state, previous) => {
        const node = svgRef.current?.parentElement;
        if (node && state.viewRequest !== previous.viewRequest) {
          fit(node.clientWidth, node.clientHeight);
        }
      }),
    [fit],
  );

  useEffect(() => {
    const node = svgRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const px = event.clientX - rect.left - rect.width / 2;
      const py = event.clientY - rect.top - rect.height / 2;
      const factor = Math.exp(event.deltaY * 0.0015);
      setView((v) => {
        const limit = MAX_MPP[useEditorStore.getState().project.discipline];
        const mpp = Math.min(limit, Math.max(1e-5, v.mpp * factor));
        // O ponto sob o cursor permanece no lugar.
        return { mpp, cx: v.cx + px * (v.mpp - mpp), cy: v.cy - py * (v.mpp - mpp) };
      });
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  // Elementos de sistemas ocultos não são desenhados nem capturados.
  const snapPoints = useMemo(
    () => planSnapPoints({ ...project, elements: visibleElementsOf(project) }),
    [project],
  );
  const freePorts = useMemo(() => visibleFreePortsOf(project), [project]);

  const toModel = (event: { clientX: number; clientY: number }): Point2 => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: view.cx + (event.clientX - rect.left - rect.width / 2) * view.mpp,
      y: view.cy - (event.clientY - rect.top - rect.height / 2) * view.mpp,
    };
  };

  const snap = (raw: Point2): { point: Point2; snap: SnapKind } => {
    let best: Point2 | null = null;
    let bestDistance = SNAP_PX * view.mpp;
    for (const p of snapPoints) {
      const d = Math.hypot(p.x - raw.x, p.y - raw.y);
      if (d <= bestDistance) {
        best = p;
        bestDistance = d;
      }
    }
    if (best) return { point: best, snap: 'port' };
    if (snapToGrid && gridStep > 0) {
      return {
        point: {
          x: Math.round(raw.x / gridStep) * gridStep,
          y: Math.round(raw.y / gridStep) * gridStep,
        },
        snap: 'grid',
      };
    }
    return { point: raw, snap: 'plane' };
  };

  /** Escolha manual entre extremidades sobrepostas em planta (tecla Tab). */
  const stackCycle = useRef(0);
  const lastHover = useRef<{ raw: Point2; elementId: string | null } | null>(null);

  /** Ponto 3D, porta e captura indicados pelo cursor para as ferramentas de modelagem. */
  const pickModel = (raw: Point2, elementId: string | null): Result<PlanPick> => {
    const state = useEditorStore.getState();
    const settings = precision();
    const free = pickPlanPoint({
      point: raw,
      tolerance: SNAP_PX * view.mpp,
      freePorts,
      drawZ: drawElevationOf(state),
      // Com o trecho em andamento, o passo de comprimento da precisão substitui o da grade.
      gridStep:
        state.tool === 'pipe' && state.anchor
          ? lengthStepOf(state, settings)
          : pointGridStepOf(state),
      anchor:
        state.tool === 'pipe' && state.anchor
          ? { point: state.anchor.point, lockAxis: state.anchor.lockAxis }
          : null,
      constraint: deflectionConstraintOf(state),
      cycle: stackCycle.current,
    });
    if (free.ok && free.value.port) return free;
    // Shift: o trecho trava a 0°, 45° ou 90° (do tubo de partida ou dos eixos do projeto).
    const locked = free.ok && isPolarLockHeld() ? polarLockedPoint(state, free.value.point) : null;
    // Precisão de modelagem: em ponto livre, direção e comprimento andam pelos passos.
    const precise =
      free.ok && !locked && (free.value.snap === 'grid' || free.value.snap === 'plane')
        ? precisePipePoint(state, vec3(raw.x, raw.y, free.value.point.z), settings)
        : null;
    const picked: Result<PlanPick> =
      free.ok && (locked ?? precise)
        ? ok({ ...free.value, point: locked ?? precise ?? free.value.point, snap: 'angle' })
        : free;
    // Junto a um tubo existente, o cursor mostra onde o tê automático ficará.
    const onPipe = pipeSnapOf(
      state,
      planHit(state.project, elementId, raw),
      picked.ok ? picked.value.point : null,
    );
    if (onPipe) return ok({ point: onPipe, snap: 'pipe', port: null, stacked: 1 });
    // Assentamento por recobrimento: em ponto livre, a cota do eixo vem do terreno. Portas e
    // tubos existentes mantêm a própria cota — é neles que a rede se conecta.
    const cover = state.toolOptions.terrainCover;
    const { terrain } = state.project;
    if (picked.ok && infra && state.tool === 'pipe' && cover.enabled && terrain) {
      const { point } = picked.value;
      const z = axisElevationForCover(
        terrain,
        point.x,
        point.y,
        cover.cover,
        state.activeSpec.outerDiameter,
      );
      if (z === null) {
        return fail(
          'COVER_NO_TERRAIN',
          'Ponto fora da superfície do terreno: não há cota para aplicar o recobrimento. Clique sobre a superfície ou desligue "Seguir o terreno pelo recobrimento".',
        );
      }
      return ok({ ...picked.value, point: vec3(point.x, point.y, Math.round(z * 1000) / 1000) });
    }
    // Equipamento sobre o terreno: a prévia já mostra a cota do terreno no ponto.
    if (picked.ok) {
      const { point } = picked.value;
      const ground = equipmentGroundElevation(state, point.x, point.y);
      if (ground !== null) {
        return ok({ ...picked.value, point: vec3(point.x, point.y, ground), snap: 'terrain' });
      }
    }
    return picked;
  };

  /** Clique de modelagem: mesmo evento de domínio do viewport 3D. */
  const modelClick = (d: Drag, raw: Point2, additive: boolean): void => {
    const store = useEditorStore.getState();
    const picked = pickModel(raw, d.elementId);
    if (!picked.ok) {
      store.notify('info', picked.error.message);
      return;
    }
    const pick = picked.value;
    let hit: { elementId: string; point: Vec3 } | null = null;
    const target = d.elementId ? getElement(store.project, d.elementId) : undefined;
    if (target && pick.snap === 'pipe') {
      // Mesmo ponto sobre o eixo usado na prévia (início do trecho sobre o tubo).
      const onAxis = planHit(store.project, target.id, raw)?.point;
      hit = { elementId: target.id, point: onAxis ?? pick.point };
    } else if (
      target &&
      !pick.port &&
      tool === 'pipe' &&
      (target.kind === 'tee' || target.kind === 'cross')
    ) {
      // Tê ou cruzeta como início ou fim do ramal (a cota é conferida pela operação).
      hit = { elementId: target.id, point: target.placement.position };
    } else if (target && !pick.port && (tool === 'tee' || tool === 'valve')) {
      if (target.kind === 'pipe') {
        // A posição em linha é medida sobre o eixo real do tubo, não sobre a projeção.
        const onAxis = planPipeHit(target, raw);
        if (!onAxis.ok) {
          store.notify('error', onAxis.error.message);
          return;
        }
        hit = { elementId: target.id, point: onAxis.value };
      } else {
        hit = { elementId: target.id, point: pick.point };
      }
    }
    const before = store.project;
    store.handleViewportClick({
      point: pick.point,
      port: pick.port?.ref ?? null,
      hit,
      additive,
    });
    reportCover(before);
  };

  /**
   * Depois de criar um trecho com o assentamento por recobrimento ligado, informa o recobrimento
   * real ao longo dele: o tubo é reto entre os pontos e o terreno não.
   */
  const reportCover = (before: Project): void => {
    const state = useEditorStore.getState();
    const { enabled, cover } = state.toolOptions.terrainCover;
    const { terrain } = state.project;
    if (!infra || !enabled || !terrain || state.project === before) return;
    if (state.message?.level === 'error') return;
    const known = new Set(before.elements.map((element) => element.id));
    const created = state.project.elements.filter(
      (element) => element.kind === 'pipe' && !known.has(element.id),
    );
    const pipe = created[created.length - 1];
    if (!pipe || pipe.kind !== 'pipe') return;
    const result = coverAlongSegment(terrain, pipe.start, pipe.end, pipe.spec.outerDiameter);
    if (!result) return;
    const text = (value: number): string => formatMeters(value, 2);
    const outside = result.length - result.coveredLength;
    // Tolerância de 5 mm: as cotas dos pontos são arredondadas ao milímetro.
    const short = result.min < cover - 0.005;
    state.notify(
      short || outside > 1e-6 ? 'error' : 'success',
      `${pipe.name}: recobrimento de ${text(result.min)} a ${text(result.max)} ao longo do trecho` +
        (short
          ? ` — abaixo dos ${text(cover)} definidos a ${text(result.minAt)} do início (o terreno sobe entre os pontos). Acrescente um ponto intermediário ou aprofunde o trecho.`
          : '.') +
        (outside > 1e-6
          ? ` ${text(outside)} do trecho estão fora da superfície, sem conferência.`
          : ''),
    );
  };

  const click = (d: Drag, raw: Point2, additive: boolean): void => {
    const store = useEditorStore.getState();
    if (terrainMode) {
      // Vértices do contorno e do corte: o ponto clicado, sem captura de grade ou de portas.
      useTerrainStore.getState().click(raw, SNAP_PX * view.mpp);
      return;
    }
    if (modeling) {
      modelClick(d, raw, additive);
      return;
    }
    const point = snap(raw).point;
    if (useViewStore.getState().tool === 'section') {
      useViewStore.getState().clickPoint(point);
      return;
    }
    if (tool === 'select') {
      if (d.annotationId) store.selectAnnotation(d.annotationId);
      else store.select(d.elementId, additive);
      return;
    }
    if (tool === 'dimension') {
      const [a, b] = draft.points;
      if (!a) store.setPlanDraft({ points: [point], elementId: null });
      else if (!b) {
        if (Math.hypot(point.x - a.x, point.y - a.y) < 1e-6) {
          store.notify('info', 'Escolha um segundo ponto diferente do primeiro.');
          return;
        }
        store.setPlanDraft({ points: [a, point], elementId: null });
      } else {
        store.createAnnotation({
          kind: 'dimension',
          a,
          b,
          mode: dimensionMode,
          offset: dimensionOffsetAt({ a, b, mode: dimensionMode }, point),
        });
      }
      return;
    }
    if (tool === 'text') {
      setFocusId(
        store.createAnnotation({ kind: 'text', position: point, text: DEFAULT_TEXT, rotation: 0 }),
      );
      return;
    }
    if (tool === 'leader') {
      const [target] = draft.points;
      if (!target) store.setPlanDraft({ points: [point], elementId: null });
      else {
        setFocusId(
          store.createAnnotation({
            kind: 'text',
            position: point,
            text: DEFAULT_TEXT,
            rotation: 0,
            leader: target,
          }),
        );
      }
      return;
    }
    if (tool === 'tag') {
      if (draft.elementId) {
        store.createAnnotation({ kind: 'tag', elementId: draft.elementId, position: point });
      } else if (d.elementId) {
        store.setPlanDraft({ points: [], elementId: d.elementId });
      } else {
        store.notify('info', 'Clique sobre um elemento da planta para etiquetá-lo.');
      }
    }
  };

  // Alças do tubo selecionado: arrastar uma extremidade estica ou encolhe o tubo. Em tubo
  // vertical as duas extremidades coincidem em planta e o arrasto não tem como indicar o eixo.
  const single = selection.length === 1 && selection[0] ? getElement(project, selection[0]) : null;
  const gripPipe =
    tool === 'select' && single?.kind === 'pipe' && planPipeHit(single, { x: 0, y: 0 }).ok
      ? single
      : null;
  const stretching = useEditorStore((s) => s.stretch !== null);
  /**
   * Centro da alça em planta: recuado para dentro do tubo, para não cobrir a conexão ligada
   * àquela extremidade (que precisa continuar clicável). Em tubo curto o recuo é proporcional.
   */
  const gripPoint = (which: 'start' | 'end'): Point2 => {
    if (!gripPipe) return { x: 0, y: 0 };
    const from = gripPipe[which];
    const to = gripPipe[which === 'start' ? 'end' : 'start'];
    const span = Math.hypot(to.x - from.x, to.y - from.y);
    const inset = Math.min(10 * view.mpp, span / 4) / (span || 1);
    return { x: from.x + (to.x - from.x) * inset, y: from.y + (to.y - from.y) * inset };
  };

  /**
   * Botão direito sem arrasto (o arrasto move a vista): junto a uma extremidade de tubo ou a
   * uma conexão, abre o menu com "Criar tubo".
   */
  const openContextMenu = (
    event: { clientX: number; clientY: number },
    raw: Point2,
    elementId: string | null,
  ): void => {
    const store = useEditorStore.getState();
    const gap = (port: { position: Vec3 }): number =>
      Math.hypot(port.position.x - raw.x, port.position.y - raw.y);
    const target = contextTargetOf(
      store.project,
      elementId,
      (ports) =>
        pickPlanPort(raw, ports, CONTEXT_PX * view.mpp, drawElevationOf(store))?.port ?? null,
      gap,
    );
    if (target) store.openContextMenu({ x: event.clientX, y: event.clientY, ...target });
    else store.closeContextMenu();
  };

  // Setas: deslizam a seleção ao longo da linha (em planta, X para a direita e Y para cima).
  useEffect(() => {
    if (tool !== 'select') return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;
      if (target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.altKey) return;
      const preferences = arrowPreferences(event.key, AXIS_X, AXIS_Y, AXIS_Z);
      const store = useEditorStore.getState();
      // Com as vistas lado a lado, as setas valem para a vista ativa (a planta, aqui).
      if (store.viewMode !== 'plan') return;
      if (!preferences || store.selection.length === 0) return;
      event.preventDefault();
      store.nudgeSelection(preferences, nudgeStep(store.gridStep, event));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool]);

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const annotationId = idOf(event.target, 'data-annotation-id');
    const grip = idOf(event.target, 'data-grip');
    const mode =
      event.button !== 0
        ? 'pan'
        : terrainMode
          ? 'click'
          : gripPipe && (grip === 'start' || grip === 'end')
            ? 'grip'
            : tool === 'select' && annotationId
              ? 'annotation'
              : // Em Selecionar, o arrasto com o botão esquerdo abre a janela de seleção (como no
                // 3D); a vista se desloca com o botão direito ou o do meio.
                tool === 'select' && !sectionTool && event.pointerType !== 'touch'
                ? 'window'
                : 'click';
    if (mode === 'grip' && gripPipe && (grip === 'start' || grip === 'end')) {
      useEditorStore.getState().beginStretch(gripPipe.id, grip);
    }
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      button: event.button,
      mode,
      annotationId,
      elementId: idOf(event.target, 'data-element-id'),
      origin: toModel(event),
      view,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (mode === 'annotation') useEditorStore.getState().selectAnnotation(annotationId);
  };

  /** Atualiza o cursor de modelagem; fora de um empilhamento, a escolha manual é esquecida. */
  const hoverModel = (raw: Point2, elementId: string | null): void => {
    lastHover.current = { raw, elementId };
    let picked = pickModel(raw, elementId);
    if (stackCycle.current !== 0 && !(picked.ok && picked.value.stacked > 1)) {
      stackCycle.current = 0;
      picked = pickModel(raw, elementId);
    }
    const pick = picked.ok ? picked.value : null;
    const store = useEditorStore.getState();
    // Tubo em outra cota sob o cursor: só referência — o aviso evita a dúvida sobre a conexão.
    const note = pick && !pick.port ? pipeCrossingOf(store, elementId) : null;
    const captured = pick
      ? {
          point: pick.point,
          snap: pick.snap,
          port: pick.port?.ref ?? null,
          elementId: cursorElementOf(
            store.project,
            store.tool,
            pick.port?.ref.elementId ?? null,
            pick.snap,
            elementId,
          ),
          stacked: pick.stacked,
          note,
        }
      : null;
    setPointer(
      pick && captured
        ? {
            point: { x: pick.point.x, y: pick.point.y },
            snap: pick.snap,
            pick,
            info:
              note ??
              (pick.snap === 'port' || pick.snap === 'pipe'
                ? describeSnap(store.project, captured)
                : null),
          }
        : null,
    );
    store.setCursor(captured);
  };
  const hoverRef = useRef(hoverModel);
  hoverRef.current = hoverModel;
  const stackedUnderCursor = modeling && (pointer?.pick?.stacked ?? 1) > 1;

  // Tab alterna entre as extremidades sobrepostas sob o cursor.
  useEffect(() => {
    if (!stackedUnderCursor) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || !lastHover.current) return;
      event.preventDefault();
      stackCycle.current += event.shiftKey ? -1 : 1;
      hoverRef.current(lastHover.current.raw, lastHover.current.elementId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stackedUnderCursor]);

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const raw = toModel(event);
    const d = drag.current;
    if (d) {
      const dx = event.clientX - d.x;
      const dy = event.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) > CLICK_TOLERANCE_PX) d.moved = true;
      if (!d.moved) return;
      if (d.mode === 'grip') {
        // Ponto do eixo 3D do tubo cuja projeção em planta é a mais próxima do cursor.
        const store = useEditorStore.getState();
        const base = store.stretch ? getElement(store.stretch.base, store.stretch.pipeId) : null;
        if (base?.kind === 'pipe') {
          const axis = sub(base.end, base.start);
          const t =
            ((raw.x - base.start.x) * axis.x + (raw.y - base.start.y) * axis.y) /
            (axis.x * axis.x + axis.y * axis.y);
          if (Number.isFinite(t)) store.stretchTo(add(base.start, scale(axis, t)));
        }
        return;
      }
      if (d.mode === 'window') {
        setSelectionWindow({ from: d.origin, to: raw });
        return;
      }
      if (d.mode === 'annotation' && d.annotationId) {
        const annotation = getAnnotation(project, d.annotationId);
        if (annotation) {
          setPreview({ id: annotation.id, patch: movePatch(annotation, d.origin, raw) });
        }
      } else {
        setView({
          mpp: d.view.mpp,
          cx: d.view.cx - dx * d.view.mpp,
          cy: d.view.cy + dy * d.view.mpp,
        });
      }
      return;
    }
    if (modeling) {
      hoverModel(raw, idOf(event.target, 'data-element-id'));
      return;
    }
    const snapped = terrainMode ? { point: raw, snap: 'plane' as const } : snap(raw);
    setPointer(snapped);
    if (sectionTool) useViewStore.getState().setCursor(snapped.point);
    useEditorStore.getState().setCursor({
      point: vec3(snapped.point.x, snapped.point.y, 0),
      snap: snapped.snap,
      port: null,
    });
  };

  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!d) return;
    const raw = toModel(event);
    if (d.mode === 'grip') {
      useEditorStore.getState().endStretch(true);
      return;
    }
    if (d.button === 2 && !d.moved) {
      openContextMenu(event, raw, d.elementId);
      return;
    }
    if (d.mode === 'window') {
      setSelectionWindow(null);
      const additive = event.ctrlKey || event.metaKey || event.shiftKey;
      if (d.moved) selectInWindow(d.origin, raw, additive);
      else click(d, raw, additive);
      return;
    }
    if (d.moved) {
      setPreview(null);
      const annotation =
        d.mode === 'annotation' && d.annotationId ? getAnnotation(project, d.annotationId) : null;
      if (annotation) {
        useEditorStore
          .getState()
          .changeAnnotation(annotation.id, movePatch(annotation, d.origin, raw));
      }
      return;
    }
    if (d.button === 0) click(d, raw, event.ctrlKey || event.metaKey || event.shiftKey);
  };

  /**
   * Seleção por janela na planta: da esquerda para a direita, os elementos inteiramente
   * contidos; da direita para a esquerda, os tocados (cruzamento). Ctrl/Shift somam.
   */
  const selectInWindow = (from: Point2, to: Point2, additive: boolean): void => {
    const store = useEditorStore.getState();
    const ids = elementsInPlanWindow(
      visibleElementsOf(store.project),
      rectOf(from, to),
      windowModeOf(from.x, to.x),
      (element) => (infra ? axisShape(element) : outlineShape(outlineOf(element).outline)),
    );
    store.selectMany(additive ? [...store.selection, ...ids] : ids);
  };

  const onPointerLeave = (): void => {
    if (drag.current) return;
    setPointer(null);
    useEditorStore.getState().setCursor(null);
  };

  const exportSvg = (): void => {
    const store = useEditorStore.getState();
    const bounds = planBounds(store.project);
    if (!bounds) {
      store.notify('error', 'A planta está vazia: não há o que exportar.');
      return;
    }
    // Sem seleção, para que nada saia realçado no arquivo.
    store.select(null);
    requestAnimationFrame(() => {
      const source = svgRef.current;
      if (!source) return;
      const { project: current, renderOrigin: drawOrigin } = useEditorStore.getState();
      const infraPlan = current.discipline === 'infra';
      const scale = infraPlan ? current.infra.drawingScale : current.drawingScale;
      const mm = scale / 1000;
      const margin = 10 * mm;
      const caption = 8 * mm;
      // No Infra exporta-se a janela visível (a rede inteira não cabe em uma prancha, e fora da
      // janela os elementos nem são desenhados); no MEP, o desenho todo.
      const frame = infraPlan
        ? {
            minX: view.cx - (size.width / 2) * view.mpp,
            maxX: view.cx + (size.width / 2) * view.mpp,
            minY: view.cy - (size.height / 2) * view.mpp,
            maxY: view.cy + (size.height / 2) * view.mpp,
          }
        : bounds;
      const width = frame.maxX - frame.minX + 2 * margin;
      const height = frame.maxY - frame.minY + 2 * margin + caption;
      // O desenho está em coordenadas relativas à origem de desenho.
      const left = frame.minX - drawOrigin.x - margin;
      const top = -(frame.maxY - drawOrigin.y) - margin;

      const copy = source.cloneNode(true) as SVGSVGElement;
      // A imagem de fundo, as áreas de clique e os rascunhos (`data-ui`) não são exportados.
      copy.querySelectorAll('[data-ui]').forEach((node) => node.remove());
      for (const name of ['style', 'class', 'data-testid']) copy.removeAttribute(name);
      copy.setAttribute('viewBox', `${left} ${top} ${width} ${height}`);
      // Tamanho físico: a prancha sai na escala do desenho.
      copy.setAttribute('width', `${(width / mm).toFixed(2)}mm`);
      copy.setAttribute('height', `${(height / mm).toFixed(2)}mm`);

      const ns = 'http://www.w3.org/2000/svg';
      const paper = document.createElementNS(ns, 'rect');
      paper.setAttribute('x', String(left));
      paper.setAttribute('y', String(top));
      paper.setAttribute('width', String(width));
      paper.setAttribute('height', String(height));
      paper.setAttribute('fill', '#ffffff');
      copy.insertBefore(paper, copy.firstChild);

      const reference = georeferenceStatus(current.georeference);
      const label = document.createElementNS(ns, 'text');
      label.setAttribute(
        'transform',
        `translate(${left + margin} ${top + height - margin * 0.6}) scale(${(PAPER.text * mm) / 10})`,
      );
      label.setAttribute('font-size', '10');
      label.setAttribute('font-family', 'Arial, Helvetica, sans-serif');
      label.setAttribute('fill', INK);
      label.textContent = infraPlan
        ? `${current.name.toUpperCase()} — PLANTA INFRA — ESC. 1:${scale} — ${
            reference.state === 'ready'
              ? `${reference.crs.name} (EPSG:${reference.crs.epsg})`
              : 'COORDENADAS LOCAIS (SEM GEORREFERÊNCIA)'
          }`
        : `${current.name.toUpperCase()} — PLANTA BAIXA — ESC. 1:${scale}`;
      copy.appendChild(label);

      const text = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(copy)}\n`;
      downloadText(`${projectFileBase(current)}-planta.svg`, text, 'image/svg+xml');
      store.notify(
        'success',
        infraPlan
          ? `Vista exportada em SVG na escala 1:${scale}, sem a imagem de fundo.`
          : `Planta exportada em SVG na escala 1:${scale}.`,
      );
    });
  };

  const { elements, systems: systemList, connections } = project;
  const systems = useMemo(() => new Map(systemList.map((s) => [s.id, s])), [systemList]);
  // Algoritmo do pintor: os elementos mais altos por último; as peças sobre os seus tubos.
  const ordered = useMemo(
    () =>
      planDrawOrder(visibleElementsOf({ elements, systems: systemList }), connections, (element) =>
        infra ? topOf(element) : outlineOf(element).outline.maxZ,
      ),
    [elements, systemList, connections, infra],
  );

  /** Janela visível, em coordenadas do projeto (m). */
  const viewBounds = useMemo<ViewBounds>(
    () => ({
      minX: view.cx - (size.width / 2) * view.mpp,
      maxX: view.cx + (size.width / 2) * view.mpp,
      minY: view.cy - (size.height / 2) * view.mpp,
      maxY: view.cy + (size.height / 2) * view.mpp,
    }),
    [view, size],
  );
  /**
   * O que é desenhado. No Infra: só as camadas ligadas, só o que toca a janela e, em vistas
   * gerais, a representação simplificada (eixos e símbolos) no lugar da geometria das peças.
   */
  const drawn = useMemo(() => {
    if (!infra) return ordered.map((element) => ({ element, simplified: false }));
    return ordered
      .filter((element) => settings.layers[infraLayerOf(element)])
      .filter((element) => intersects(boxOf(element), viewBounds))
      .map((element) => ({ element, simplified: isSimplified(element, view.mpp) }));
  }, [infra, ordered, settings.layers, viewBounds, view.mpp]);
  const anySimplified = drawn.some((entry) => entry.simplified);
  const labels = useMemo<PlanLabel[]>(() => {
    const { names, lengths, elevations } = settings.labels;
    if (!infra || !(names || lengths || elevations)) return [];
    const candidates = drawn
      .map((entry) => labelOf(entry.element, settings.labels, project.terrain))
      .filter((label): label is PlanLabel => label !== null);
    return placeLabels(candidates, view.mpp);
  }, [infra, drawn, settings.labels, project.terrain, view.mpp]);

  const customBasemap = useEditorStore((s) => s.customBasemap);
  const provider = infra ? findBasemapProvider(settings.basemap.sourceId, customBasemap) : null;
  /** Fonte personalizada escolhida no projeto, mas não cadastrada neste navegador. */
  const customMissing =
    infra && settings.basemap.sourceId === CUSTOM_BASEMAP_ID && customBasemap === null;
  const imagery = provider !== null && settings.basemap.visible && geo.state === 'ready';
  useEffect(() => {
    if (!imagery) setBasemapStatus(null);
  }, [imagery]);
  const goTo = (point: Point2): void => {
    setView((v) => ({ ...v, cx: point.x, cy: point.y }));
    useEditorStore
      .getState()
      .notify(
        'info',
        `Vista centralizada em X ${formatMeters(point.x, 2)}; Y ${formatMeters(point.y, 2)}.`,
      );
  };

  const shown = useMemo(() => {
    if (!preview) return project;
    const result = updateAnnotation(project, preview.id, preview.patch);
    return result.ok ? result.value : project;
  }, [project, preview]);

  const hit = tool === 'select' ? 10 * view.mpp : 0;
  const marker = 5 * view.mpp;
  const cursorPoint = pointer?.point ?? null;
  const [first, second] = draft.points;
  const drafting = tool !== 'select';
  // Prévia elástica do trecho: da âncora ao ponto resolvido, com comprimento real e deflexão.
  const modelPoint = modeling ? (pointer?.pick?.point ?? null) : null;
  const pipePreview =
    tool === 'pipe' && anchor && modelPoint && distance(anchor.point, modelPoint) > 1e-6
      ? { from: anchor.point, to: modelPoint }
      : null;
  const previewOrigin = pipePreview && anchor?.port ? resolvePort(project, anchor.port) : undefined;
  const previewLabel = pipePreview
    ? formatSegment(
        pipePreview.from,
        pipePreview.to,
        previewOrigin
          ? angleBetween(previewOrigin.direction, sub(pipePreview.to, pipePreview.from))
          : null,
      )
    : '';
  const measureEnd = tool === 'measure' && measure.a ? (measure.b ?? modelPoint) : null;
  const alignGuides = tool === 'align' && align ? alignGuidesOf(align, modelPoint) : [];
  const capturedPort = modeling ? (pointer?.pick?.port ?? null) : null;

  // Pedidos da faixa de comandos que dependem da janela e do desenho desta vista. Só são
  // atendidos com a vista já posicionada (ao abrir a planta para exportar, por exemplo).
  const planRequest = useUiStore((s) => s.planRequest);
  const planHandlers = useRef({ exportSvg, goTo });
  planHandlers.current = { exportSvg, goTo };
  useEffect(() => {
    if (!planRequest || size.width <= 0 || !framed.current) return;
    useUiStore.getState().clearPlanRequest();
    const { command } = planRequest;
    if (command.kind === 'exportSvg') planHandlers.current.exportSvg();
    else planHandlers.current.goTo(command.point);
  }, [planRequest, size.width]);
  const label = {
    fontSize: 11 * view.mpp,
    fontFamily: 'Arial, Helvetica, sans-serif',
    fill: HIGHLIGHT,
    stroke: '#ffffff',
    strokeWidth: 3 * view.mpp,
    paintOrder: 'stroke',
  } as const;

  const draftAnnotation: Annotation | null = !cursorPoint
    ? null
    : tool === 'dimension' && first && second
      ? {
          id: 'draft',
          kind: 'dimension',
          a: first,
          b: second,
          mode: dimensionMode,
          offset: dimensionOffsetAt({ a: first, b: second, mode: dimensionMode }, cursorPoint),
        }
      : tool === 'leader' && first
        ? {
            id: 'draft',
            kind: 'text',
            position: cursorPoint,
            text: DEFAULT_TEXT,
            rotation: 0,
            leader: first,
          }
        : tool === 'tag' && draft.elementId
          ? { id: 'draft', kind: 'tag', elementId: draft.elementId, position: cursorPoint }
          : null;

  return (
    <div
      className={['plan', modeling ? 'plan--modeling' : '', thinLines ? 'plan--thin' : '']
        .filter(Boolean)
        .join(' ')}
      data-testid="plan-view"
      data-tool={tool}
      data-terrain-mode={terrainMode ?? ''}
      data-view-tool={sectionTool ? 'section' : ''}
      data-theme={theme}
      data-environment={project.discipline}
      data-origin={`${origin.x};${origin.y}`}
      data-mpp={view.mpp}
      data-center={`${view.cx};${view.cy}`}
    >
      <svg
        ref={svgRef}
        data-testid="plan-svg"
        width={size.width}
        height={size.height}
        viewBox={`${X(view.cx) - (size.width / 2) * view.mpp} ${Y(view.cy) - (size.height / 2) * view.mpp} ${Math.max(size.width, 1) * view.mpp} ${Math.max(size.height, 1) * view.mpp}`}
        style={{ cursor: drafting || terrainMode || sectionTool ? 'crosshair' : 'default' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onContextMenu={(event) => event.preventDefault()}
      >
        {/* Fundo: imagem de satélite georreferenciada (só com o georreferenciamento pronto). */}
        {imagery && provider && geo.state === 'ready' && (
          <BasemapLayer
            transform={geo.transform}
            provider={provider}
            bounds={viewBounds}
            metersPerPixel={view.mpp}
            origin={origin}
            opacity={settings.basemap.opacity}
            retry={basemapRetry}
            onStatus={setBasemapStatus}
          />
        )}
        {showTerrainPlan && project.terrain && (
          <TerrainSurfacePlan terrain={project.terrain} origin={origin} mpp={view.mpp} />
        )}
        {infra && settings.layers.references && size.width > 0 && (
          <CoordinateGrid
            bounds={viewBounds}
            mpp={view.mpp}
            origin={origin}
            transform={geo.state === 'ready' ? geo.transform : null}
            onImagery={imagery}
          />
        )}
        {/* Vista geral do Infra: eixos e símbolos de tamanho fixo na tela (fora de escala). */}
        <g data-layer-infra="network">
          {drawn
            .filter((entry) => entry.simplified)
            .map(({ element }) => (
              <SimplifiedElement
                key={element.id}
                element={element}
                systemColor={systems.get(element.systemId)?.color}
                selected={selection.includes(element.id) || draft.elementId === element.id}
                origin={origin}
                mpp={view.mpp}
                monochrome={theme === 'mono'}
              />
            ))}
        </g>
        <g data-layer="elements">
          {drawn
            .filter((entry) => !entry.simplified)
            .map(({ element }) => (
              <PlanElement
                key={element.id}
                element={element}
                systemColor={systems.get(element.systemId)?.color}
                selected={selection.includes(element.id) || draft.elementId === element.id}
                monochrome={theme === 'mono'}
                unit={unit}
                origin={origin}
              />
            ))}
        </g>
        <PlanPreviewLayer origin={origin} mpp={view.mpp} unit={unit} />

        {labels.length > 0 && <NetworkLabels labels={labels} origin={origin} mpp={view.mpp} />}
        {/* Fora da seleção, as anotações não interceptam o clique sobre os elementos. */}
        <g data-layer="annotations" pointerEvents={tool === 'select' ? undefined : 'none'}>
          {(!infra || settings.layers.annotations) &&
            shown.annotations.map((annotation) => (
              <AnnotationShape
                key={annotation.id}
                annotation={annotation}
                project={shown}
                unit={unit}
                hit={hit}
                color={annotation.id === annotationSelection ? HIGHLIGHT : INK}
                origin={origin}
              />
            ))}
        </g>
        {/* Cortes do projeto: o marcador seleciona a vista e o duplo clique a abre. */}
        <SectionMarkers
          project={project}
          interactive={tool === 'select' && !sectionTool && !terrainMode}
          map={(p) => ({ x: X(p.x), y: Y(p.y) })}
          mpp={view.mpp}
        />
        <InlineClearanceLayer origin={origin} mpp={view.mpp} />
        {gripPipe && (
          <g data-ui="grips">
            {(['start', 'end'] as const).map((which) => (
              <rect
                key={which}
                data-grip={which}
                data-testid={`pipe-grip-${which}`}
                x={X(gripPoint(which).x) - 5 * view.mpp}
                y={Y(gripPoint(which).y) - 5 * view.mpp}
                width={10 * view.mpp}
                height={10 * view.mpp}
                fill={HIGHLIGHT}
                stroke="#ffffff"
                strokeWidth={1.5 * view.mpp}
                style={{ cursor: 'move' }}
              >
                <title>Arraste para esticar ou encolher o tubo ao longo do eixo</title>
              </rect>
            ))}
            {stretching && (
              <text
                data-testid="pipe-stretch-label"
                pointerEvents="none"
                x={X((gripPipe.start.x + gripPipe.end.x) / 2) + 8 * view.mpp}
                y={Y((gripPipe.start.y + gripPipe.end.y) / 2) - 8 * view.mpp}
                {...label}
              >
                {formatMeters(distance(gripPipe.start, gripPipe.end), 3)}
              </text>
            )}
          </g>
        )}
        {selectionWindow && (
          <rect
            data-ui="window"
            data-testid="plan-selection-window"
            data-mode={windowModeOf(selectionWindow.from.x, selectionWindow.to.x)}
            className={`plan-selection-window plan-selection-window--${windowModeOf(selectionWindow.from.x, selectionWindow.to.x)}`}
            x={X(Math.min(selectionWindow.from.x, selectionWindow.to.x))}
            y={Y(Math.max(selectionWindow.from.y, selectionWindow.to.y))}
            width={Math.abs(selectionWindow.to.x - selectionWindow.from.x)}
            height={Math.abs(selectionWindow.to.y - selectionWindow.from.y)}
            strokeWidth={view.mpp}
            pointerEvents="none"
          />
        )}
        <g data-ui="draft" pointerEvents="none">
          {sectionTool && (
            <>
              <SectionDraft
                draft={sectionDraft}
                cursor={cursorPoint}
                map={(p) => ({ x: X(p.x), y: Y(p.y) })}
                mpp={view.mpp}
              />
              {pointer && (
                <circle
                  cx={X(pointer.point.x)}
                  cy={Y(pointer.point.y)}
                  r={marker}
                  fill="none"
                  stroke={HIGHLIGHT}
                  strokeWidth={1.5 * view.mpp}
                />
              )}
            </>
          )}
          {tool === 'dimension' && first && !second && cursorPoint && (
            <line
              x1={X(first.x)}
              y1={Y(first.y)}
              x2={X(cursorPoint.x)}
              y2={Y(cursorPoint.y)}
              stroke={HIGHLIGHT}
              strokeWidth={1.5 * view.mpp}
              strokeDasharray={`${6 * view.mpp} ${4 * view.mpp}`}
            />
          )}
          {draftAnnotation && (
            <AnnotationShape
              annotation={draftAnnotation}
              project={project}
              unit={unit}
              hit={0}
              color={HIGHLIGHT}
              origin={origin}
            />
          )}
          {draft.points.map((p, i) => (
            <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={marker * 0.7} fill={HIGHLIGHT} />
          ))}
          {tool === 'pipe' && anchor && (
            <circle
              data-testid="plan-anchor"
              cx={X(anchor.point.x)}
              cy={Y(anchor.point.y)}
              r={marker * 0.7}
              fill={HIGHLIGHT}
            />
          )}
          {pipePreview && (
            <>
              <line
                data-testid="plan-pipe-preview"
                x1={X(pipePreview.from.x)}
                y1={Y(pipePreview.from.y)}
                x2={X(pipePreview.to.x)}
                y2={Y(pipePreview.to.y)}
                stroke={HIGHLIGHT}
                strokeWidth={2 * view.mpp}
                strokeDasharray={`${6 * view.mpp} ${4 * view.mpp}`}
              />
              <text
                data-testid="plan-pipe-preview-label"
                x={X((pipePreview.from.x + pipePreview.to.x) / 2) + 8 * view.mpp}
                y={Y((pipePreview.from.y + pipePreview.to.y) / 2) - 8 * view.mpp}
                {...label}
              >
                {previewLabel}
              </text>
            </>
          )}
          {/* Alinhar por pontos: de cada ponto de origem ao seu destino, numeradas. */}
          {alignGuides.map((guide) => (
            <g key={guide.label} data-testid="plan-align-guide">
              <line
                x1={X(guide.from.x)}
                y1={Y(guide.from.y)}
                x2={X(guide.to.x)}
                y2={Y(guide.to.y)}
                stroke={HIGHLIGHT}
                strokeWidth={1.5 * view.mpp}
                strokeDasharray={`${6 * view.mpp} ${4 * view.mpp}`}
              />
              <circle
                cx={X(guide.from.x)}
                cy={Y(guide.from.y)}
                r={4 * view.mpp}
                fill="none"
                stroke={HIGHLIGHT}
                strokeWidth={1.5 * view.mpp}
              />
              <text
                x={X(guide.from.x) + 6 * view.mpp}
                y={Y(guide.from.y) - 6 * view.mpp}
                {...label}
              >
                {guide.label}
              </text>
            </g>
          ))}
          {measure.a && measureEnd && (
            <>
              <line
                data-testid="plan-measure"
                x1={X(measure.a.x)}
                y1={Y(measure.a.y)}
                x2={X(measureEnd.x)}
                y2={Y(measureEnd.y)}
                stroke={HIGHLIGHT}
                strokeWidth={1.5 * view.mpp}
              />
              <text
                x={X((measure.a.x + measureEnd.x) / 2) + 8 * view.mpp}
                y={Y((measure.a.y + measureEnd.y) / 2) - 8 * view.mpp}
                {...label}
              >
                {formatMeters(distance(measure.a, measureEnd))}
              </text>
            </>
          )}
          {/* Portas sobrepostas em planta: informa a cota da que foi capturada. */}
          {modeling && pointer?.pick && pointer.info && (
            <text
              data-testid={capturedPort ? 'plan-port-info' : 'plan-snap-info'}
              data-stacked={pointer.pick.stacked}
              x={X(pointer.point.x) + 10 * view.mpp}
              y={Y(pointer.point.y) + 16 * view.mpp}
              {...label}
            >
              {pointer.info}
            </text>
          )}
          {drafting && pointer && (
            <circle
              cx={X(pointer.point.x)}
              cy={Y(pointer.point.y)}
              r={marker}
              fill={pointer.snap === 'port' ? HIGHLIGHT : 'none'}
              fillOpacity={0.35}
              stroke={HIGHLIGHT}
              strokeWidth={1.5 * view.mpp}
            />
          )}
        </g>
        {infra && (
          <TerrainEditingLayer
            terrain={project.terrain}
            origin={origin}
            mpp={view.mpp}
            cursor={terrainMode ? (pointer?.point ?? null) : null}
          />
        )}
      </svg>

      {infra && <TerrainPanel />}
      {infra && <TerrainProfilePanel />}
      {infra && (
        <InfraOverlay
          geo={geo}
          mpp={view.mpp}
          cursor={pointer?.point ?? null}
          provider={provider}
          basemap={imagery ? basemapStatus : null}
          basemapNote={
            customMissing
              ? 'Mapa indisponível: o projeto usa uma fonte personalizada que não está cadastrada neste navegador (Camadas › Fonte de mapa própria).'
              : provider && settings.basemap.visible && geo.state !== 'ready'
                ? `Mapa indisponível: ${geo.message}`
                : null
          }
          onRetry={() => setBasemapRetry((n) => n + 1)}
          simplified={anySimplified}
        />
      )}
      {infra && geoPicker && (
        // Georreferência definida pelo mapa: a planta abre na origem escolhida, na mesma
        // ampliação, já com o mapa ao fundo.
        <GeoPicker onDone={(mpp) => setView({ cx: 0, cy: 0, mpp })} />
      )}
      <AnnotationInspector focusId={focusId} />
    </div>
  );
}
