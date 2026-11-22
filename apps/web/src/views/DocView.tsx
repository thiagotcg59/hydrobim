import {
  detailPointsOf,
  ELEVATION_LABELS,
  formatMeters,
  fromViewPoint,
  planRangeOf,
  toViewPoint,
  translateDetail,
  vec3,
  VIEW_KIND_LABELS,
  viewArchElementsOf,
  viewElementsOf,
  type Point2,
  type ProjectView2d,
  type ViewDetail,
} from '@hydrobim/core';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { downloadText, projectFileBase } from '../persistence/fileIO';
import { HIGHLIGHT, INK, PAPER, PlanElement } from '../plan/planDrawing';
import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { selectEarthworkAt, useEarthworkStore } from '../terrain/earthworkStore';
import { TerrainSurfacePlan } from '../terrain/TerrainLayers';
import {
  TerrainPlanFill,
  TerrainPlanNotice,
  useTerrainPlanVisible,
} from '../terrain/TerrainPlanFill';
import { TOOL_LABELS } from '../ui/labels';
import '../styles/architecture.css';
import { selectArchElement, useArchSelection } from './archSelection';
import { ArchViewElement, HatchDefs, SpaceShape } from './ArchShapes';
import {
  archBoundsOf,
  archProjectionOf,
  archSnapPoints,
  archViewEntryOf,
  spaceLabelsOf,
} from './archView';
import { detailGripsOf, DetailShape } from './DetailShapes';
import { snapViewPoint } from './entry';
import { SectionDraft, SectionMarkers } from './SectionMarkers';
import {
  contentBoundsOf,
  elementSnapPoints,
  viewEntryOf,
  viewProjectionOf,
  type Bounds2,
} from './viewGeometry';
import { setLiveView, useViewStore, VIEW_TOOL_LABELS, type ViewTool } from './viewStore';

/**
 * Vista 2D de projeto (planta por nível, corte ou elevação): o MESMO modelo, projetado no
 * referencial da vista e cortado pela faixa, pelo alcance e pela região de recorte dela. Os
 * elementos podem ser selecionados (as propriedades e as alterações de engenharia valem para
 * todas as vistas); o que se desenha aqui — linhas, polilinhas, retângulos, círculos, textos e
 * cotas — são detalhes da vista, não elementos da rede.
 */

interface Camera {
  readonly cx: number;
  readonly cy: number;
  /** Metros da vista por pixel de tela. */
  readonly mpp: number;
}

interface Drag {
  readonly x: number;
  readonly y: number;
  readonly button: number;
  readonly mode: 'pan' | 'click' | 'detail' | 'grip' | 'crop';
  readonly elementId: string | null;
  /** Elemento arquitetônico sob o clique. */
  readonly archId: string | null;
  readonly detailId: string | null;
  readonly grip: string | null;
  /** Ponto de referência do arrasto, nas coordenadas da vista. */
  readonly origin: Point2;
  readonly camera: Camera;
  moved: boolean;
}

const CLICK_TOLERANCE_PX = 4;
const SNAP_PX = 10;
const FONT = 'Arial, Helvetica, sans-serif';
const MIN_CROP = 0.05;

/** Alças do recorte: cantos e meios das arestas (−1 = mínimo, +1 = máximo, 0 = não mexe). */
const CROP_GRIPS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

const idOf = (target: EventTarget, attribute: string): string | null =>
  target instanceof Element
    ? (target.closest(`[${attribute}]`)?.getAttribute(attribute) ?? null)
    : null;

const elevationText = (value: number): string =>
  `${value >= 0 ? '+' : '−'}${Math.abs(value).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** O que a ferramenta de desenho aguarda, conforme os pontos já informados. */
export function viewToolHint(tool: ViewTool, points: number): string {
  switch (tool) {
    case 'select':
      return 'Clique seleciona elementos e detalhes; arraste um detalhe para mover (Ctrl copia).';
    case 'line':
      return points === 0 ? 'Linha: primeiro ponto.' : 'Linha: próximo ponto (Esc encerra).';
    case 'polyline':
      return points < 2
        ? 'Polilinha: indique os pontos.'
        : 'Polilinha: próximo ponto — Enter conclui, C fecha.';
    case 'rect':
      return points === 0
        ? 'Retângulo: primeiro canto.'
        : 'Retângulo: canto oposto (ou @largura;altura).';
    case 'circle':
      return points === 0 ? 'Círculo: centro.' : 'Círculo: ponto da circunferência ou o raio.';
    case 'text':
      return 'Texto: ponto de inserção; o conteúdo é editado no painel "Vista".';
    case 'dimension':
      return points === 0
        ? 'Cota: primeiro ponto.'
        : points === 1
          ? 'Cota: segundo ponto.'
          : 'Cota: posição da linha de cota (ou o afastamento).';
    case 'section':
      return points === 0
        ? 'Corte: primeiro ponto da linha.'
        : points === 1
          ? 'Corte: segundo ponto da linha.'
          : 'Corte: lado para onde se olha — a distância é a profundidade (ou digite-a).';
  }
}

function viewSummary(view: ProjectView2d, range: { top: number; bottom: number } | null): string {
  if (view.kind === 'plan' && range) {
    return `faixa ${elevationText(range.bottom)} a ${elevationText(range.top)}`;
  }
  if (view.kind === 'section') {
    return `profundidade ${view.depth.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m`;
  }
  if (view.kind === 'elevation') return `fachada ${ELEVATION_LABELS[view.direction].toLowerCase()}`;
  return '';
}

export function DocView({ view }: { view: ProjectView2d }) {
  const project = useEditorStore((s) => s.project);
  const selection = useEditorStore((s) => s.selection);
  const gridStep = useEditorStore((s) => s.gridStep);
  const snapToGrid = useEditorStore((s) => s.snapToGrid);
  /** Ferramenta de modelagem ativa: ela atua na planta de trabalho e no Modelo 3D. */
  const modelTool = useEditorStore((s) => s.tool);
  const tool = useViewStore((s) => s.tool);
  const draft = useViewStore((s) => s.draft);
  const cursor = useViewStore((s) => s.cursor);
  const detailSelection = useViewStore((s) => s.detailSelection);
  const clipId = useId();
  /** Base dos identificadores dos padrões de hachura (só caracteres válidos em `url(#…)`). */
  const hatchBase = `hachura-${clipId.replace(/[^a-zA-Z0-9]/g, '')}`;

  const svgRef = useRef<SVGSVGElement>(null);
  const entryRef = useRef<HTMLInputElement>(null);
  const drag = useRef<Drag | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState<Camera>({ cx: 0, cy: 0, mpp: 0.01 });
  const [entry, setEntry] = useState('');
  /** Prévias dos arrastos: deslocamento dos detalhes, alça em edição e recorte. */
  const [movePreview, setMovePreview] = useState<Point2 | null>(null);
  const [gripPreview, setGripPreview] = useState<ViewDetail | null>(null);
  const [cropPreview, setCropPreview] = useState<Bounds2 | null>(null);

  const { levels } = project;
  const projection = useMemo(() => viewProjectionOf({ levels }, view), [levels, view]);
  const { frame } = projection;
  const elements = useMemo(() => viewElementsOf(project, view), [project, view]);
  // Algoritmo do pintor: o que está mais perto do observador é desenhado por último.
  const drawn = useMemo(
    () =>
      elements
        .flatMap((element) => {
          const outline = viewEntryOf(element, projection);
          return outline ? [{ element, entry: outline }] : [];
        })
        .sort((p, q) => p.entry.outline.maxZ - q.entry.outline.maxZ),
    [elements, projection],
  );
  // Arquitetura: derivada do modelo a cada alteração de `project.architecture` (com cache).
  const { architecture } = project;
  const archSelection = useArchSelection();
  const archProjection = useMemo(() => archProjectionOf({ levels }, view), [levels, view]);
  const archElements = useMemo(() => viewArchElementsOf(project, view), [project, view]);
  const archEntries = useMemo(
    () =>
      archElements.flatMap((element) => {
        const entry = archViewEntryOf({ levels, architecture }, element, archProjection);
        return entry ? [entry] : [];
      }),
    [archElements, levels, architecture, archProjection],
  );
  const spaces = useMemo(
    () => spaceLabelsOf({ levels, architecture }, archElements, archProjection),
    [archElements, levels, architecture, archProjection],
  );
  // Rede e arquitetura na mesma ordem de profundidade; no empate, a rede fica por cima.
  const painted = useMemo(
    () =>
      [
        ...archEntries.map((entry) => ({ kind: 'arch' as const, depth: entry.depth, entry })),
        ...drawn.map((item) => ({
          kind: 'network' as const,
          depth: item.entry.outline.maxZ,
          ...item,
        })),
      ].sort((p, q) => p.depth - q.depth),
    [archEntries, drawn],
  );
  const content = useMemo(() => {
    const network = contentBoundsOf(
      drawn.map((item) => item.entry),
      view,
    );
    const arch = archBoundsOf(archEntries, spaces);
    if (!network || !arch) return network ?? arch;
    return {
      min: { x: Math.min(network.min.x, arch.min.x), y: Math.min(network.min.y, arch.min.y) },
      max: { x: Math.max(network.max.x, arch.max.x), y: Math.max(network.max.y, arch.max.y) },
    };
  }, [drawn, view, archEntries, spaces]);
  const systems = useMemo(
    () => new Map(project.systems.map((system) => [system.id, system])),
    [project.systems],
  );
  const range = view.kind === 'plan' ? planRangeOf(project, view) : null;
  const unit = view.scale / 1000;
  const mono = view.style.theme === 'mono';
  const crop = cropPreview ?? (view.crop?.enabled ? view.crop : null);
  const plan = view.kind === 'plan';
  const drafting = tool !== 'select';
  /** Superfície do terreno à mostra nas plantas (a mesma opção da planta de trabalho). */
  const terrainVisible = useTerrainPlanVisible();

  // Origem de desenho: o SVG trabalha em precisão simples; perto dela os números são pequenos.
  const originX = Math.round(camera.cx / 200) * 200;
  const originY = Math.round(camera.cy / 200) * 200;
  const origin = useMemo<Point2>(() => ({ x: originX, y: originY }), [originX, originY]);
  const X = (x: number): number => x - origin.x;
  const Y = (y: number): number => -(y - origin.y);
  const toSvg = (p: Point2): Point2 => ({ x: X(p.x), y: Y(p.y) });
  /** Ponto do projeto em planta → desenho (só nas plantas, onde o plano da vista é o XY). */
  const mapPlan = (p: Point2): Point2 => toSvg(toViewPoint(frame, vec3(p.x, p.y, 0)));

  const fit = useCallback((width: number, height: number, bounds: Bounds2 | null): void => {
    if (!bounds || width <= 0 || height <= 0) {
      setCamera({ cx: 0, cy: 0, mpp: 0.01 });
      return;
    }
    const margin = 160;
    const mpp = Math.max(
      (bounds.max.x - bounds.min.x) / Math.max(width - margin, 60),
      (bounds.max.y - bounds.min.y) / Math.max(height - margin, 60),
      1e-5,
    );
    setCamera({
      cx: (bounds.min.x + bounds.max.x) / 2,
      cy: (bounds.min.y + bounds.max.y) / 2,
      mpp,
    });
  }, []);
  /** O que enquadrar: o recorte, quando ligado; senão, tudo o que a vista desenha. */
  const fitTarget = useRef<Bounds2 | null>(null);
  fitTarget.current = crop ?? content;

  // Abertura: o enquadramento salvo da vista ou, sem ele, o desenho inteiro.
  const framed = useRef(false);
  const savedFrame = useRef(view.frame);
  useEffect(() => {
    const node = svgRef.current?.parentElement;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize({ width: rect.width, height: rect.height });
      if (framed.current || rect.width <= 0 || rect.height <= 0) return;
      framed.current = true;
      const saved = savedFrame.current;
      if (saved) {
        setCamera({ cx: saved.center.x, cy: saved.center.y, mpp: saved.height / rect.height });
      } else fit(rect.width, rect.height, fitTarget.current);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fit]);

  // "Enquadrar" (comando) reenquadra também a vista salva.
  useEffect(
    () =>
      useEditorStore.subscribe((state, previous) => {
        const node = svgRef.current?.parentElement;
        if (node && state.viewRequest !== previous.viewRequest) {
          fit(node.clientWidth, node.clientHeight, fitTarget.current);
        }
      }),
    [fit],
  );

  // O que a vista mostra agora: base de "Salvar enquadramento" e do recorte inicial.
  useEffect(() => {
    if (!framed.current || size.height <= 0) return;
    setLiveView({
      viewId: view.id,
      center: { x: camera.cx, y: camera.cy },
      height: size.height * camera.mpp,
      width: size.width * camera.mpp,
      content,
    });
  }, [view.id, camera, size, content]);
  useEffect(
    () => () => {
      setLiveView(null);
      useViewStore.getState().setCursor(null);
    },
    [],
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
      setCamera((c) => {
        const mpp = Math.min(200, Math.max(1e-5, c.mpp * factor));
        return { mpp, cx: c.cx + px * (c.mpp - mpp), cy: c.cy - py * (c.mpp - mpp) };
      });
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  const toView = (event: { clientX: number; clientY: number }): Point2 => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: camera.cx + (event.clientX - rect.left - rect.width / 2) * camera.mpp,
      y: camera.cy - (event.clientY - rect.top - rect.height / 2) * camera.mpp,
    };
  };

  // Captura: portas e origens dos elementos à mostra e pontos notáveis dos detalhes.
  const modelPoints = useMemo(
    () => elementSnapPoints(elements, projection),
    [elements, projection],
  );
  // Arquitetura: extremidades e cantos de paredes, cantos de vãos, de pisos e de ambientes.
  const archPoints = useMemo(
    () => archSnapPoints({ levels, architecture }, archElements, archProjection),
    [levels, architecture, archElements, archProjection],
  );
  const snap = (raw: Point2, exclude: readonly string[] = []) => {
    const details = view.visibility.details
      ? view.details.filter((detail) => !exclude.includes(detail.id)).flatMap(detailPointsOf)
      : [];
    return snapViewPoint(
      raw,
      [...modelPoints, ...archPoints, ...details],
      SNAP_PX * camera.mpp,
      snapToGrid ? gridStep : 0,
    );
  };
  /** Vista → projeto, em planta (a ferramenta de corte trabalha nas coordenadas do projeto). */
  const toPlan = (p: Point2): Point2 => {
    const world = fromViewPoint(frame, p);
    return { x: world.x, y: world.y };
  };

  const shownDetails = useMemo(() => {
    if (!view.visibility.details) return [];
    return view.details.map((detail) => {
      if (gripPreview?.id === detail.id) return gripPreview;
      if (movePreview && detailSelection.includes(detail.id)) {
        return translateDetail(detail, movePreview);
      }
      return detail;
    });
  }, [view.details, view.visibility.details, gripPreview, movePreview, detailSelection]);
  const single =
    tool === 'select' && detailSelection.length === 1
      ? (shownDetails.find((detail) => detail.id === detailSelection[0]) ?? null)
      : null;
  const grips = single ? detailGripsOf(single) : [];

  const click = (d: Drag, raw: Point2, additive: boolean): void => {
    const views = useViewStore.getState();
    const editor = useEditorStore.getState();
    if (editor.tool !== 'select') {
      editor.notify(
        'info',
        `${TOOL_LABELS[editor.tool]} atua na planta de trabalho e no Modelo 3D; esta vista mostra o resultado. Feche a vista (×) para modelar em planta.`,
      );
      return;
    }
    if (tool === 'select') {
      if (d.detailId) return;
      views.selectDetail(null);
      views.selectMarker(null);
      // A seleção da arquitetura é da sessão dela; a da rede, da store do editor.
      if (d.archId && !d.elementId) {
        selectArchElement(d.archId, additive);
        return;
      }
      if (!additive) selectArchElement(null);
      // Clique fora dos elementos, em uma planta: a superfície do terreno sob o ponto.
      if (!d.elementId && !additive) {
        if (plan && terrainVisible && selectEarthworkAt(toPlan(raw), false)) return;
        useEarthworkStore.getState().select(null);
      }
      editor.select(d.elementId, additive);
      return;
    }
    const point = snap(raw).point;
    if (tool === 'section') {
      if (!plan) {
        editor.notify('info', 'A linha de corte é desenhada em uma planta.');
        return;
      }
      views.clickPoint(toPlan(point));
      return;
    }
    views.clickPoint(point);
  };

  const cropFrom = (base: Bounds2, grip: string, to: Point2): Bounds2 => {
    const [sx, sy] = grip.split(',').map(Number);
    const min = { ...base.min };
    const max = { ...base.max };
    if (sx === -1) min.x = Math.min(to.x, max.x - MIN_CROP);
    if (sx === 1) max.x = Math.max(to.x, min.x + MIN_CROP);
    if (sy === -1) min.y = Math.min(to.y, max.y - MIN_CROP);
    if (sy === 1) max.y = Math.max(to.y, min.y + MIN_CROP);
    return { min, max };
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const detailId = idOf(event.target, 'data-detail-id');
    const grip = idOf(event.target, 'data-detail-grip');
    const cropGrip = idOf(event.target, 'data-crop-grip');
    const raw = toView(event);
    const selecting = tool === 'select';
    const mode: Drag['mode'] =
      event.button !== 0
        ? 'pan'
        : selecting && cropGrip
          ? 'crop'
          : selecting && grip && single
            ? 'grip'
            : selecting && detailId
              ? 'detail'
              : 'click';
    let reference = raw;
    if (mode === 'detail' && detailId) {
      const views = useViewStore.getState();
      const additive = event.ctrlKey || event.metaKey || event.shiftKey;
      // Clicar em um detalhe já selecionado mantém o conjunto (para arrastá-lo inteiro).
      if (!views.detailSelection.includes(detailId)) views.selectDetail(detailId, additive);
      // O ponto notável mais próximo do clique é o que será levado até a captura.
      const pressed = view.details.find((detail) => detail.id === detailId);
      const near = pressed
        ? snapViewPoint(raw, detailPointsOf(pressed), SNAP_PX * camera.mpp, 0)
        : null;
      if (near?.snap === 'point') reference = near.point;
    }
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      button: event.button,
      mode,
      elementId: idOf(event.target, 'data-element-id'),
      archId: idOf(event.target, 'data-arch-id'),
      detailId,
      grip: grip ?? cropGrip,
      origin: reference,
      camera,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const raw = toView(event);
    const d = drag.current;
    if (d) {
      const dx = event.clientX - d.x;
      const dy = event.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) > CLICK_TOLERANCE_PX) d.moved = true;
      if (!d.moved) return;
      if (d.mode === 'pan') {
        setCamera({
          mpp: d.camera.mpp,
          cx: d.camera.cx - dx * d.camera.mpp,
          cy: d.camera.cy + dy * d.camera.mpp,
        });
      } else if (d.mode === 'detail') {
        const to = snap(raw, useViewStore.getState().detailSelection).point;
        setMovePreview({ x: to.x - d.origin.x, y: to.y - d.origin.y });
      } else if (d.mode === 'grip' && single && d.grip) {
        const source = view.details.find((detail) => detail.id === single.id);
        const handle = source ? detailGripsOf(source).find((g) => g.key === d.grip) : undefined;
        if (source && handle) {
          const patch = handle.patch(snap(raw, [source.id]).point);
          setGripPreview({ ...source, ...patch } as ViewDetail);
        }
      } else if (d.mode === 'crop' && view.crop && d.grip) {
        setCropPreview(cropFrom(view.crop, d.grip, snap(raw).point));
      }
      return;
    }
    const snapped = snap(raw);
    const point = tool === 'section' && plan ? toPlan(snapped.point) : snapped.point;
    useViewStore.getState().setCursor(point);
    // A barra de status mostra o ponto do modelo sob o cursor, no plano da vista.
    useEditorStore.getState().setCursor({
      point: fromViewPoint(frame, snapped.point),
      snap: snapped.snap === 'grid' ? 'grid' : 'plane',
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
    const raw = toView(event);
    const views = useViewStore.getState();
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    if (!d.moved) {
      // Botão direito sem arrasto: conclui a polilinha em andamento.
      if (d.button === 2 && tool === 'polyline') views.finishDraft(false);
      else if (d.button === 0 && d.mode === 'detail' && d.detailId && additive) {
        // Ctrl/Shift sobre um detalhe já selecionado o retira do conjunto.
        if (detailSelection.includes(d.detailId)) views.selectDetail(d.detailId, true);
      } else if (d.button === 0 && d.mode === 'detail' && d.detailId) {
        views.selectDetail(d.detailId);
      } else if (d.button === 0 && d.mode === 'click') {
        click(d, raw, additive);
      }
      return;
    }
    if (d.mode === 'detail') {
      const to = snap(raw, views.detailSelection).point;
      const delta = { x: to.x - d.origin.x, y: to.y - d.origin.y };
      setMovePreview(null);
      if (event.ctrlKey || event.metaKey) views.copyDetails(delta);
      else views.moveDetails(delta);
    } else if (d.mode === 'grip' && gripPreview) {
      const source = view.details.find((detail) => detail.id === gripPreview.id);
      const handle = source ? detailGripsOf(source).find((g) => g.key === d.grip) : undefined;
      setGripPreview(null);
      if (source && handle)
        views.changeDetail(source.id, handle.patch(snap(raw, [source.id]).point));
    } else if (d.mode === 'crop' && view.crop && d.grip) {
      const next = cropFrom(view.crop, d.grip, snap(raw).point);
      setCropPreview(null);
      views.change(view.id, { crop: { enabled: true, ...next } });
    }
  };

  const onPointerLeave = (): void => {
    if (drag.current) return;
    useViewStore.getState().setCursor(null);
    useEditorStore.getState().setCursor(null);
  };

  // Teclado da vista: Enter conclui e C fecha a polilinha; as setas deslocam os detalhes; um
  // número digitado vai para a entrada numérica.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;
      if (target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (useUiStore.getState().dialog !== null || event.altKey) return;
      if (useEditorStore.getState().viewMode !== 'plan') return;
      const views = useViewStore.getState();
      if (views.tool === 'polyline' && views.draft.length >= 2) {
        const close = event.key.toLowerCase() === 'c' && views.draft.length >= 3;
        if (event.key === 'Enter' || close) {
          event.preventDefault();
          event.stopImmediatePropagation();
          views.finishDraft(close);
          return;
        }
      }
      if (views.tool === 'select' && views.detailSelection.length > 0) {
        const step = useEditorStore.getState().gridStep * (event.shiftKey ? 10 : 1);
        const delta =
          event.key === 'ArrowLeft'
            ? { x: -step, y: 0 }
            : event.key === 'ArrowRight'
              ? { x: step, y: 0 }
              : event.key === 'ArrowUp'
                ? { x: 0, y: step }
                : event.key === 'ArrowDown'
                  ? { x: 0, y: -step }
                  : null;
        if (delta) {
          event.preventDefault();
          views.moveDetails(delta);
          return;
        }
      }
      if (views.tool !== 'select' && views.tool !== 'text' && /^[0-9@\-.,]$/.test(event.key)) {
        entryRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Exportação em SVG pedida pela faixa: sai a vista aberta, na escala dela.
  const planRequest = useUiStore((s) => s.planRequest);
  const exportRef = useRef<() => void>(() => undefined);
  exportRef.current = (): void => {
    const store = useEditorStore.getState();
    const bounds = crop ?? content;
    const source = svgRef.current;
    if (!bounds || !source) {
      store.notify('error', 'A vista está vazia: não há o que exportar.');
      return;
    }
    const margin = 10 * unit;
    const caption = 8 * unit;
    const width = bounds.max.x - bounds.min.x + 2 * margin;
    const height = bounds.max.y - bounds.min.y + 2 * margin + caption;
    const left = X(bounds.min.x) - margin;
    const top = Y(bounds.max.y) - margin;
    const copy = source.cloneNode(true) as SVGSVGElement;
    copy.querySelectorAll('[data-ui]').forEach((node) => node.remove());
    for (const name of ['style', 'class', 'data-testid']) copy.removeAttribute(name);
    copy.setAttribute('viewBox', `${left} ${top} ${width} ${height}`);
    copy.setAttribute('width', `${(width / unit).toFixed(2)}mm`);
    copy.setAttribute('height', `${(height / unit).toFixed(2)}mm`);
    const ns = 'http://www.w3.org/2000/svg';
    const paper = document.createElementNS(ns, 'rect');
    paper.setAttribute('x', String(left));
    paper.setAttribute('y', String(top));
    paper.setAttribute('width', String(width));
    paper.setAttribute('height', String(height));
    paper.setAttribute('fill', '#ffffff');
    copy.insertBefore(paper, copy.firstChild);
    const label = document.createElementNS(ns, 'text');
    label.setAttribute(
      'transform',
      `translate(${left + margin} ${top + height - margin * 0.6}) scale(${(PAPER.text * unit) / 10})`,
    );
    label.setAttribute('font-size', '10');
    label.setAttribute('font-family', FONT);
    label.setAttribute('fill', INK);
    label.textContent = `${store.project.name.toUpperCase()} — ${view.name.toUpperCase()} — ESC. 1:${view.scale}`;
    copy.appendChild(label);
    const text = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(copy)}\n`;
    const slug = view.name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    downloadText(`${projectFileBase(store.project)}-${slug || 'vista'}.svg`, text, 'image/svg+xml');
    store.notify('success', `"${view.name}" exportada em SVG na escala 1:${view.scale}.`);
  };
  useEffect(() => {
    if (!planRequest || size.width <= 0 || !framed.current) return;
    useUiStore.getState().clearPlanRequest();
    if (planRequest.command.kind === 'exportSvg') exportRef.current();
  }, [planRequest, size.width]);

  const hit = tool === 'select' ? 10 * camera.mpp : 0;
  const marker = 5 * camera.mpp;
  const label = {
    fontSize: 11 * camera.mpp,
    fontFamily: FONT,
    fill: HIGHLIGHT,
    stroke: '#ffffff',
    strokeWidth: 3 * camera.mpp,
    paintOrder: 'stroke',
  } as const;
  const viewBounds = {
    minX: camera.cx - (size.width / 2) * camera.mpp,
    maxX: camera.cx + (size.width / 2) * camera.mpp,
    minY: camera.cy - (size.height / 2) * camera.mpp,
    maxY: camera.cy + (size.height / 2) * camera.mpp,
  };
  // Terreno nas plantas: o ponto do projeto que cai na origem de desenho e a janela visível,
  // em coordenadas do projeto (a planta pode estar girada).
  const terrainOrigin = useMemo<Point2>(() => {
    const world = fromViewPoint(frame, origin);
    return { x: world.x, y: world.y };
  }, [frame, origin]);
  const terrainBounds = useMemo(() => {
    const corners = [
      { x: viewBounds.minX, y: viewBounds.minY },
      { x: viewBounds.maxX, y: viewBounds.minY },
      { x: viewBounds.maxX, y: viewBounds.maxY },
      { x: viewBounds.minX, y: viewBounds.maxY },
    ].map((corner) => fromViewPoint(frame, corner));
    return {
      minX: Math.min(...corners.map((p) => p.x)),
      maxX: Math.max(...corners.map((p) => p.x)),
      minY: Math.min(...corners.map((p) => p.y)),
      maxY: Math.max(...corners.map((p) => p.y)),
    };
  }, [frame, viewBounds.minX, viewBounds.maxX, viewBounds.minY, viewBounds.maxY]);
  const [first, second] = draft;
  const last = draft[draft.length - 1];
  const draftColor = { stroke: HIGHLIGHT, strokeWidth: 1.5 * camera.mpp, fill: 'none' } as const;
  const dashed = `${6 * camera.mpp} ${4 * camera.mpp}`;
  const sectionTool = tool === 'section';

  const submit = (): void => {
    if (useViewStore.getState().submitEntry(entry)) setEntry('');
  };

  return (
    <div
      className={['plan', 'docview', view.style.thinLines ? 'plan--thin' : '']
        .filter(Boolean)
        .join(' ')}
      data-testid="doc-view"
      data-view-id={view.id}
      data-view-kind={view.kind}
      data-view-tool={tool}
      data-theme={view.style.theme}
      data-scale={view.scale}
      data-mpp={camera.mpp}
      data-center={`${camera.cx};${camera.cy}`}
      data-elements={drawn.length}
      data-arch-elements={archEntries.length}
      data-arch-cut={archEntries.filter((entry) => entry.cut.length > 0).length}
      data-spaces={spaces.length}
      data-snap-points={modelPoints.length + archPoints.length}
      data-details={view.details.length}
      data-crop={view.crop?.enabled ? 'on' : 'off'}
    >
      <svg
        ref={svgRef}
        data-testid="doc-view-svg"
        width={size.width}
        height={size.height}
        viewBox={`${X(camera.cx) - (size.width / 2) * camera.mpp} ${Y(camera.cy) - (size.height / 2) * camera.mpp} ${Math.max(size.width, 1) * camera.mpp} ${Math.max(size.height, 1) * camera.mpp}`}
        style={{ cursor: drafting ? 'crosshair' : 'default' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={() => {
          if (tool === 'polyline') useViewStore.getState().finishDraft(false);
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <defs>
          {crop && (
            <clipPath id={clipId}>
              <rect
                x={X(crop.min.x)}
                y={Y(crop.max.y)}
                width={crop.max.x - crop.min.x}
                height={crop.max.y - crop.min.y}
              />
            </clipPath>
          )}
          {/* Corte: a seção só vale no trecho da linha de corte. */}
          {archProjection.span && (
            <clipPath id={`${hatchBase}-span`}>
              <rect
                x={X(archProjection.span.from)}
                y={-1e5}
                width={archProjection.span.to - archProjection.span.from}
                height={2e5}
              />
            </clipPath>
          )}
          <HatchDefs base={hatchBase} unit={unit} />
        </defs>
        {/* Cortes e elevações: as cotas dos níveis situam o desenho na altura. */}
        {!plan && (
          <g data-layer="levels" pointerEvents="none">
            {levels.map((level) => (
              <g key={level.id} data-testid="doc-view-level">
                <line
                  x1={viewBounds.minX - origin.x}
                  y1={Y(level.elevation)}
                  x2={viewBounds.maxX - origin.x}
                  y2={Y(level.elevation)}
                  stroke="#7a8794"
                  strokeWidth={PAPER.thin * unit}
                  strokeDasharray={`${12 * camera.mpp} ${4 * camera.mpp} ${2 * camera.mpp} ${4 * camera.mpp}`}
                />
                <text
                  x={viewBounds.minX - origin.x + 8 * camera.mpp}
                  y={Y(level.elevation) - 4 * camera.mpp}
                  fontSize={11 * camera.mpp}
                  fontFamily={FONT}
                  fill="#5b6875"
                >
                  {level.name} {elevationText(level.elevation)}
                </text>
              </g>
            ))}
          </g>
        )}
        {/* Plantas: a superfície do terreno ao fundo, como na planta de trabalho e no 3D. */}
        {plan && terrainVisible && project.terrain && size.width > 0 && (
          <g data-layer="terrain" clipPath={crop ? `url(#${clipId})` : undefined}>
            {/* As camadas do terreno desenham em coordenadas do projeto; a planta pode estar
                girada, e a matriz as leva ao referencial da vista. */}
            <g transform={`matrix(${frame.u.x} ${frame.u.y} ${-frame.u.y} ${frame.u.x} 0 0)`}>
              <TerrainPlanFill
                terrain={project.terrain}
                origin={terrainOrigin}
                mpp={camera.mpp}
                bounds={terrainBounds}
                basemapSourceId={null}
              />
              <TerrainSurfacePlan
                terrain={project.terrain}
                origin={terrainOrigin}
                mpp={camera.mpp}
              />
            </g>
          </g>
        )}
        <g data-layer="elements" clipPath={crop ? `url(#${clipId})` : undefined}>
          {painted.map((item) =>
            item.kind === 'arch' ? (
              <ArchViewElement
                key={item.entry.element.id}
                entry={item.entry}
                selected={archSelection.includes(item.entry.element.id)}
                monochrome={mono}
                unit={unit}
                origin={origin}
                hatchBase={hatchBase}
                cutClip={archProjection.span ? `url(#${hatchBase}-span)` : undefined}
              />
            ) : (
              <PlanElement
                key={item.element.id}
                element={item.element}
                entry={item.entry}
                systemColor={systems.get(item.element.systemId)?.color}
                selected={selection.includes(item.element.id)}
                monochrome={mono}
                unit={unit}
                origin={origin}
              />
            ),
          )}
          {spaces.map((label) => (
            <SpaceShape
              key={label.element.id}
              label={label}
              selected={archSelection.includes(label.element.id)}
              unit={unit}
              origin={origin}
            />
          ))}
        </g>
        {plan && view.visibility.details && (
          <SectionMarkers
            project={project}
            interactive={tool === 'select'}
            map={mapPlan}
            mpp={camera.mpp}
          />
        )}
        <g data-layer="details" pointerEvents={tool === 'select' ? undefined : 'none'}>
          {shownDetails.map((detail) => (
            <DetailShape
              key={detail.id}
              detail={detail}
              project={project}
              unit={unit}
              hit={hit}
              color={detailSelection.includes(detail.id) ? HIGHLIGHT : INK}
              selected={detailSelection.includes(detail.id)}
              origin={origin}
            />
          ))}
        </g>
        {crop && (
          <g data-ui="crop">
            <rect
              data-testid="doc-view-crop"
              x={X(crop.min.x)}
              y={Y(crop.max.y)}
              width={crop.max.x - crop.min.x}
              height={crop.max.y - crop.min.y}
              fill="none"
              stroke="#2f6fde"
              strokeWidth={1.5 * camera.mpp}
              pointerEvents="none"
            />
            {tool === 'select' &&
              CROP_GRIPS.map(([sx, sy]) => {
                const gx =
                  sx === -1 ? crop.min.x : sx === 1 ? crop.max.x : (crop.min.x + crop.max.x) / 2;
                const gy =
                  sy === -1 ? crop.min.y : sy === 1 ? crop.max.y : (crop.min.y + crop.max.y) / 2;
                return (
                  <rect
                    key={`${sx},${sy}`}
                    data-crop-grip={`${sx},${sy}`}
                    data-testid={`crop-grip-${sx}-${sy}`}
                    x={X(gx) - 5 * camera.mpp}
                    y={Y(gy) - 5 * camera.mpp}
                    width={10 * camera.mpp}
                    height={10 * camera.mpp}
                    fill="#ffffff"
                    stroke="#2f6fde"
                    strokeWidth={1.5 * camera.mpp}
                    style={{ cursor: 'move' }}
                  >
                    <title>Arraste para ajustar a região de recorte</title>
                  </rect>
                );
              })}
          </g>
        )}
        {grips.length > 0 && (
          <g data-ui="grips">
            {grips.map((grip) => (
              <rect
                key={grip.key}
                data-detail-grip={grip.key}
                data-testid={`detail-grip-${grip.key}`}
                x={X(grip.point.x) - 4.5 * camera.mpp}
                y={Y(grip.point.y) - 4.5 * camera.mpp}
                width={9 * camera.mpp}
                height={9 * camera.mpp}
                fill={HIGHLIGHT}
                stroke="#ffffff"
                strokeWidth={1.5 * camera.mpp}
                style={{ cursor: 'move' }}
              >
                <title>Arraste para editar o detalhe</title>
              </rect>
            ))}
          </g>
        )}
        <g data-ui="draft" pointerEvents="none">
          {sectionTool && plan && (
            <SectionDraft draft={draft} cursor={cursor} map={mapPlan} mpp={camera.mpp} />
          )}
          {!sectionTool && cursor && last && (tool === 'line' || tool === 'polyline') && (
            <line
              data-testid="detail-draft"
              x1={X(last.x)}
              y1={Y(last.y)}
              x2={X(cursor.x)}
              y2={Y(cursor.y)}
              {...draftColor}
              strokeDasharray={dashed}
            />
          )}
          {tool === 'polyline' && draft.length >= 2 && (
            <polyline points={draft.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')} {...draftColor} />
          )}
          {tool === 'rect' && first && cursor && (
            <rect
              data-testid="detail-draft"
              x={X(Math.min(first.x, cursor.x))}
              y={Y(Math.max(first.y, cursor.y))}
              width={Math.abs(cursor.x - first.x)}
              height={Math.abs(cursor.y - first.y)}
              {...draftColor}
              strokeDasharray={dashed}
            />
          )}
          {tool === 'circle' && first && cursor && (
            <circle
              data-testid="detail-draft"
              cx={X(first.x)}
              cy={Y(first.y)}
              r={Math.hypot(cursor.x - first.x, cursor.y - first.y)}
              {...draftColor}
              strokeDasharray={dashed}
            />
          )}
          {tool === 'dimension' && first && cursor && (
            <line
              data-testid="detail-draft"
              x1={X(first.x)}
              y1={Y(first.y)}
              x2={X((second ?? cursor).x)}
              y2={Y((second ?? cursor).y)}
              {...draftColor}
              strokeDasharray={dashed}
            />
          )}
          {!sectionTool &&
            draft.map((p, i) => (
              <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={marker * 0.7} fill={HIGHLIGHT} />
            ))}
          {!sectionTool && cursor && last && tool !== 'dimension' && (
            <text
              data-testid="detail-draft-label"
              x={X((last.x + cursor.x) / 2) + 8 * camera.mpp}
              y={Y((last.y + cursor.y) / 2) - 8 * camera.mpp}
              {...label}
            >
              {tool === 'rect'
                ? `${formatMeters(Math.abs(cursor.x - last.x), 2)} × ${formatMeters(Math.abs(cursor.y - last.y), 2)}`
                : `${tool === 'circle' ? 'R ' : ''}${formatMeters(Math.hypot(cursor.x - last.x, cursor.y - last.y), 3)}`}
            </text>
          )}
          {drafting && cursor && (
            <circle
              cx={sectionTool && plan ? mapPlan(cursor).x : X(cursor.x)}
              cy={sectionTool && plan ? mapPlan(cursor).y : Y(cursor.y)}
              r={marker}
              fill="none"
              stroke={HIGHLIGHT}
              strokeWidth={1.5 * camera.mpp}
            />
          )}
        </g>
      </svg>

      {plan && <TerrainPlanNotice basemapSourceId={null} />}
      <div className="docview__title" data-testid="doc-view-title">
        <strong>{view.name}</strong>
        <span>
          {VIEW_KIND_LABELS[view.kind]} · 1:{view.scale}
          {viewSummary(view, range) ? ` · ${viewSummary(view, range)}` : ''}
        </span>
      </div>
      {drawn.length === 0 && archEntries.length === 0 && spaces.length === 0 && (
        <div className="docview__empty" data-testid="doc-view-empty">
          Nenhum elemento do modelo nesta vista: confira a faixa de corte, o alcance, o recorte e a
          visibilidade no painel “Vista”.
        </div>
      )}
      {modelTool !== 'select' && (
        <div className="docview__entry docview__entry--notice" data-testid="doc-view-model-notice">
          <strong>{TOOL_LABELS[modelTool]}</strong>
          <span>
            A modelagem é feita na planta de trabalho e no Modelo 3D; esta vista acompanha o modelo.
          </span>
          <button
            type="button"
            className="btn btn--compact"
            data-testid="doc-view-to-work-plan"
            onClick={() => useViewStore.getState().closeView('2d')}
          >
            Ir para a planta de trabalho
          </button>
        </div>
      )}
      {drafting && (
        <div className="docview__entry" data-testid="doc-view-entry">
          <strong>{VIEW_TOOL_LABELS[tool]}</strong>
          <span data-testid="doc-view-hint">{viewToolHint(tool, draft.length)}</span>
          {tool !== 'text' && (
            <input
              ref={entryRef}
              data-testid="view-entry"
              type="text"
              value={entry}
              placeholder="X;Y · @ΔX;ΔY · dist<âng · valor"
              aria-label="Entrada numérica do ponto ou do valor"
              title={
                'Entrada numérica (Enter confirma):\nX;Y — ponto absoluto\n@ΔX;ΔY — a partir do último ponto\ndistância<ângulo — a partir do último ponto\num valor — distância na direção do cursor, raio, afastamento ou profundidade'
              }
              onChange={(event) => setEntry(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (entry.trim().length > 0) submit();
                  else useViewStore.getState().finishDraft(false);
                } else if (event.key === 'Escape') {
                  setEntry('');
                  event.currentTarget.blur();
                }
                event.stopPropagation();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
