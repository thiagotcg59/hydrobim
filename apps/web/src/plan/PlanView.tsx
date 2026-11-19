import {
  angleBetween,
  dimensionOffsetAt,
  distance,
  DRAWING_SCALES,
  formatDegrees,
  formatMeters,
  getAnnotation,
  getElement,
  ok,
  planSnapPoints,
  resolvePort,
  sub,
  updateAnnotation,
  vec3,
  type Annotation,
  type AnnotationPatch,
  type DimensionMode,
  type Point2,
  type Project,
  type Result,
  type Vec3,
} from '@hydrobim/core';
import { encodeDxf, exportPlanDxf } from '@hydrobim/dxf';
import { FileDown, Minus } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { SNAP_PX, type SnapKind } from '../editor/picking';
import { describeSnap } from '../editor/snapLabel';
import { visibleElementsOf, visibleFreePortsOf } from '../editor/visibility';
import { pickPlanPoint, planPipeHit, type PlanPick } from '../editor/planPicking';
import { downloadText, projectFileBase } from '../persistence/fileIO';
import {
  deflectionConstraintOf,
  drawElevationOf,
  isAnnotationTool,
  pipeCrossingOf,
  pipeSnapOf,
  useEditorStore,
  type PlanTheme,
} from '../state/editorStore';
import { TOOL_HINTS } from '../ui/labels';
import { AnnotationInspector, DIMENSION_MODE_LABELS } from './AnnotationInspector';
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
  readonly mode: 'pan' | 'annotation' | 'click';
  readonly annotationId: string | null;
  readonly elementId: string | null;
  readonly origin: Point2;
  readonly view: View;
  moved: boolean;
}

const CLICK_TOLERANCE_PX = 4;
const DEFAULT_TEXT = 'TEXTO';

/** Envoltória do desenho: elementos visíveis e anotações. */
function planBounds(project: Project): Bounds | null {
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const include = (x: number, y: number): void => {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxY = Math.max(bounds.maxY, y);
  };
  for (const element of visibleElementsOf(project)) {
    const { outline } = outlineOf(element);
    include(outline.minX, outline.minY);
    include(outline.maxX, outline.maxY);
  }
  for (const annotation of project.annotations) {
    for (const p of annotationPoints(project, annotation)) include(p.x, p.y);
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
  const drawZ = useEditorStore(drawElevationOf);
  const workPlaneZ = useEditorStore((s) => s.workPlaneZ);
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

  /** Milímetro de papel em metros do modelo, na escala do desenho. */
  const unit = project.drawingScale / 1000;

  const fit = useCallback((width: number, height: number): void => {
    const bounds = planBounds(useEditorStore.getState().project);
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
        fit(rect.width, rect.height);
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
        const mpp = Math.min(10, Math.max(1e-5, v.mpp * factor));
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
    const picked = pickPlanPoint({
      point: raw,
      tolerance: SNAP_PX * view.mpp,
      freePorts,
      drawZ: drawElevationOf(state),
      gridStep: state.snapToGrid ? state.gridStep : 0,
      anchor:
        state.tool === 'pipe' && state.anchor
          ? { point: state.anchor.point, lockAxis: state.anchor.lockAxis }
          : null,
      constraint: deflectionConstraintOf(state),
      cycle: stackCycle.current,
    });
    if (picked.ok && picked.value.port) return picked;
    // Junto a um tubo existente, o cursor mostra onde o tê automático ficará.
    const onPipe = pipeSnapOf(
      state,
      planHit(state.project, elementId, raw),
      picked.ok ? picked.value.point : null,
    );
    return onPipe ? ok({ point: onPipe, snap: 'pipe', port: null, stacked: 1 }) : picked;
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
    store.handleViewportClick({
      point: pick.point,
      port: pick.port?.ref ?? null,
      hit,
      additive,
    });
  };

  const click = (d: Drag, raw: Point2, additive: boolean): void => {
    const store = useEditorStore.getState();
    if (modeling) {
      modelClick(d, raw, additive);
      return;
    }
    const point = snap(raw).point;
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

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const annotationId = idOf(event.target, 'data-annotation-id');
    const mode =
      event.button !== 0 ? 'pan' : tool === 'select' && annotationId ? 'annotation' : 'click';
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
          elementId: pick.port?.ref.elementId ?? (pick.snap === 'pipe' ? elementId : null),
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
    const snapped = snap(raw);
    setPointer(snapped);
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
      const { project: current } = useEditorStore.getState();
      const mm = current.drawingScale / 1000;
      const margin = 10 * mm;
      const caption = 8 * mm;
      const width = bounds.maxX - bounds.minX + 2 * margin;
      const height = bounds.maxY - bounds.minY + 2 * margin + caption;
      const left = bounds.minX - margin;
      const top = -bounds.maxY - margin;

      const copy = source.cloneNode(true) as SVGSVGElement;
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

      const label = document.createElementNS(ns, 'text');
      label.setAttribute(
        'transform',
        `translate(${left + margin} ${top + height - margin * 0.6}) scale(${(PAPER.text * mm) / 10})`,
      );
      label.setAttribute('font-size', '10');
      label.setAttribute('font-family', 'Arial, Helvetica, sans-serif');
      label.setAttribute('fill', INK);
      label.textContent = `${current.name.toUpperCase()} — PLANTA BAIXA — ESC. 1:${current.drawingScale}`;
      copy.appendChild(label);

      const text = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(copy)}\n`;
      downloadText(`${projectFileBase(current)}-planta.svg`, text, 'image/svg+xml');
      store.notify('success', `Planta exportada em SVG na escala 1:${current.drawingScale}.`);
    });
  };

  const exportDxf = (): void => {
    const store = useEditorStore.getState();
    const current = store.project;
    if (!planBounds(current)) {
      store.notify('error', 'A planta está vazia: não há o que exportar.');
      return;
    }
    try {
      // Mesmas dimensões de papel e mesma projeção (em cache) da planta na tela.
      const text = exportPlanDxf(current, {
        paper: PAPER,
        outline: (element) => outlineOf(element).outline,
      });
      downloadText(`${projectFileBase(current)}-planta.dxf`, encodeDxf(text), 'application/dxf');
      store.notify(
        'success',
        `Planta exportada em DXF (R2000): desenho em metros, camadas REDE_*, anotações para plotagem em 1:${current.drawingScale}.`,
      );
    } catch (error) {
      console.error('[HydroBIM] Falha na exportação DXF da planta.', error);
      store.notify('error', 'Não foi possível exportar a planta em DXF.');
    }
  };

  const { elements, systems: systemList } = project;
  const systems = useMemo(() => new Map(systemList.map((s) => [s.id, s])), [systemList]);
  // Algoritmo do pintor: os elementos mais altos são desenhados por último.
  const ordered = useMemo(
    () =>
      visibleElementsOf({ elements, systems: systemList })
        .map((element) => ({ element, z: outlineOf(element).outline.maxZ }))
        .sort((a, b) => a.z - b.z)
        .map((entry) => entry.element),
    [elements, systemList],
  );

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
  const scales = (DRAWING_SCALES as readonly number[]).includes(project.drawingScale)
    ? DRAWING_SCALES
    : [...DRAWING_SCALES, project.drawingScale].sort((a, b) => a - b);

  // Prévia elástica do trecho: da âncora ao ponto resolvido, com comprimento real e deflexão.
  const modelPoint = modeling ? (pointer?.pick?.point ?? null) : null;
  const pipePreview =
    tool === 'pipe' && anchor && modelPoint && distance(anchor.point, modelPoint) > 1e-6
      ? { from: anchor.point, to: modelPoint }
      : null;
  const previewOrigin = pipePreview && anchor?.port ? resolvePort(project, anchor.port) : undefined;
  const previewLabel = pipePreview
    ? [
        formatMeters(distance(pipePreview.from, pipePreview.to), 2),
        previewOrigin
          ? formatDegrees(
              angleBetween(previewOrigin.direction, sub(pipePreview.to, pipePreview.from)),
            )
          : '',
        Math.abs(pipePreview.to.z - pipePreview.from.z) > 1e-6
          ? `ΔZ ${formatMeters(pipePreview.to.z - pipePreview.from.z, 2)}`
          : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const measureEnd = tool === 'measure' && measure.a ? (measure.b ?? modelPoint) : null;
  const capturedPort = modeling ? (pointer?.pick?.port ?? null) : null;
  const level = project.levels.find((l) => Math.abs(l.elevation - workPlaneZ) < 1e-9);
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
      data-theme={theme}
    >
      <svg
        ref={svgRef}
        data-testid="plan-svg"
        width={size.width}
        height={size.height}
        viewBox={`${view.cx - (size.width / 2) * view.mpp} ${-view.cy - (size.height / 2) * view.mpp} ${Math.max(size.width, 1) * view.mpp} ${Math.max(size.height, 1) * view.mpp}`}
        style={{ cursor: drafting ? 'crosshair' : 'default' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onContextMenu={(event) => event.preventDefault()}
      >
        <g data-layer="elements">
          {ordered.map((element) => (
            <PlanElement
              key={element.id}
              element={element}
              systemColor={systems.get(element.systemId)?.color}
              selected={selection.includes(element.id) || draft.elementId === element.id}
              monochrome={theme === 'mono'}
              unit={unit}
            />
          ))}
        </g>
        {/* Fora da seleção, as anotações não interceptam o clique sobre os elementos. */}
        <g data-layer="annotations" pointerEvents={tool === 'select' ? undefined : 'none'}>
          {shown.annotations.map((annotation) => (
            <AnnotationShape
              key={annotation.id}
              annotation={annotation}
              project={shown}
              unit={unit}
              hit={hit}
              color={annotation.id === annotationSelection ? HIGHLIGHT : INK}
            />
          ))}
        </g>
        <g data-ui="draft" pointerEvents="none">
          {tool === 'dimension' && first && !second && cursorPoint && (
            <line
              x1={first.x}
              y1={-first.y}
              x2={cursorPoint.x}
              y2={-cursorPoint.y}
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
            />
          )}
          {draft.points.map((p, i) => (
            <circle key={i} cx={p.x} cy={-p.y} r={marker * 0.7} fill={HIGHLIGHT} />
          ))}
          {tool === 'pipe' && anchor && (
            <circle
              data-testid="plan-anchor"
              cx={anchor.point.x}
              cy={-anchor.point.y}
              r={marker * 0.7}
              fill={HIGHLIGHT}
            />
          )}
          {pipePreview && (
            <>
              <line
                data-testid="plan-pipe-preview"
                x1={pipePreview.from.x}
                y1={-pipePreview.from.y}
                x2={pipePreview.to.x}
                y2={-pipePreview.to.y}
                stroke={HIGHLIGHT}
                strokeWidth={2 * view.mpp}
                strokeDasharray={`${6 * view.mpp} ${4 * view.mpp}`}
              />
              <text
                data-testid="plan-pipe-preview-label"
                x={(pipePreview.from.x + pipePreview.to.x) / 2 + 8 * view.mpp}
                y={-(pipePreview.from.y + pipePreview.to.y) / 2 - 8 * view.mpp}
                {...label}
              >
                {previewLabel}
              </text>
            </>
          )}
          {measure.a && measureEnd && (
            <>
              <line
                data-testid="plan-measure"
                x1={measure.a.x}
                y1={-measure.a.y}
                x2={measureEnd.x}
                y2={-measureEnd.y}
                stroke={HIGHLIGHT}
                strokeWidth={1.5 * view.mpp}
              />
              <text
                x={(measure.a.x + measureEnd.x) / 2 + 8 * view.mpp}
                y={-(measure.a.y + measureEnd.y) / 2 - 8 * view.mpp}
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
              x={pointer.point.x + 10 * view.mpp}
              y={-pointer.point.y + 16 * view.mpp}
              {...label}
            >
              {pointer.info}
            </text>
          )}
          {drafting && pointer && (
            <circle
              cx={pointer.point.x}
              cy={-pointer.point.y}
              r={marker}
              fill={pointer.snap === 'port' ? HIGHLIGHT : 'none'}
              fillOpacity={0.35}
              stroke={HIGHLIGHT}
              strokeWidth={1.5 * view.mpp}
            />
          )}
        </g>
      </svg>

      <div className="plan__bar" data-testid="plan-bar">
        <label className="plan__field">
          <span>Escala</span>
          <select
            data-testid="plan-scale"
            value={project.drawingScale}
            onChange={(event) =>
              useEditorStore.getState().changeDrawingScale(Number(event.target.value))
            }
            title="Escala do desenho: define o tamanho de textos e cotas em relação ao modelo"
          >
            {scales.map((scale) => (
              <option key={scale} value={scale}>
                1:{scale}
              </option>
            ))}
          </select>
        </label>
        <label className="plan__field">
          <span>Tema</span>
          <select
            data-testid="plan-theme"
            value={theme}
            onChange={(event) =>
              useEditorStore.getState().setPlanTheme(event.target.value as PlanTheme)
            }
            title="Tema do desenho: colorido (as cores do modelo 3D: material, partes e sistema) ou preto e branco. Vale também para a exportação em SVG"
          >
            <option value="color">Colorido</option>
            <option value="mono">Preto e branco</option>
          </select>
        </label>
        <button
          type="button"
          className={thinLines ? 'btn btn--compact is-active' : 'btn btn--compact'}
          data-testid="plan-thin-lines"
          aria-pressed={thinLines}
          onClick={() => useEditorStore.getState().setPlanThinLines(!thinLines)}
          title="Linhas finas: todo traço com 1 px na tela, em qualquer zoom, para enxergar a geometria das peças. Desligue para ver as espessuras de plotagem na escala do desenho. Não altera a exportação"
        >
          <Minus size={14} /> Linhas finas
        </button>
        {tool === 'dimension' && (
          <label className="plan__field">
            <span>Tipo de cota</span>
            <select
              data-testid="plan-dimension-mode"
              value={dimensionMode}
              onChange={(event) =>
                useEditorStore.getState().setDimensionMode(event.target.value as DimensionMode)
              }
            >
              {(Object.keys(DIMENSION_MODE_LABELS) as DimensionMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {DIMENSION_MODE_LABELS[mode]}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          className="btn btn--compact"
          data-testid="plan-export-svg"
          onClick={exportSvg}
          title="Exportar a planta em SVG, no tamanho físico da escala escolhida"
        >
          <FileDown size={14} /> Exportar SVG
        </button>
        <button
          type="button"
          className="btn btn--compact"
          data-testid="plan-export-dxf"
          onClick={exportDxf}
          title="Exportar a planta em DXF (CAD, R2000): desenho em metros nas coordenadas do projeto, camadas REDE_* por categoria, cotas como DIMENSION e conexões como blocos"
        >
          <FileDown size={14} /> Exportar DXF
        </button>
        <span className="muted plan__hint" data-testid="plan-hint">
          {tool === 'select'
            ? 'Clique para selecionar. Arraste o fundo para mover a vista e uma anotação para reposicioná-la. Roda do mouse: zoom.'
            : modeling
              ? `Nível: ${level ? level.name : 'cota livre'} (${formatMeters(workPlaneZ, 2)}) · ${
                  tool === 'pipe' ? 'eixo dos tubos' : 'pontos'
                } na cota Z ${formatMeters(drawZ, 2)}. Ajuste no painel da ferramenta.`
              : TOOL_HINTS[tool]}
        </span>
      </div>

      <AnnotationInspector focusId={focusId} />
    </div>
  );
}
