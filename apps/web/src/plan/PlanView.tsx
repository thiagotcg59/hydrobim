import {
  dimensionOffsetAt,
  DRAWING_SCALES,
  getAnnotation,
  planSnapPoints,
  updateAnnotation,
  vec3,
  type Annotation,
  type AnnotationPatch,
  type DimensionMode,
  type Point2,
  type Project,
} from '@hydrobim/core';
import { FileDown } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { SnapKind } from '../editor/picking';
import { downloadText, projectFileBase } from '../persistence/fileIO';
import { useEditorStore } from '../state/editorStore';
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

const SNAP_PX = 10;
const CLICK_TOLERANCE_PX = 4;
const DEFAULT_TEXT = 'TEXTO';

function visibleElements({ elements, systems }: Pick<Project, 'elements' | 'systems'>) {
  const hidden = new Set(systems.filter((s) => s.visible === false).map((s) => s.id));
  return elements.filter((e) => !hidden.has(e.systemId));
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
  for (const element of visibleElements(project)) {
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
 * Planta baixa: projeção horizontal do modelo em traço técnico, com cotas, textos, chamadas
 * e etiquetas. A vista não contém regras de modelagem: lê o projeto e chama a store.
 */
export function PlanView() {
  const project = useEditorStore((s) => s.project);
  const selection = useEditorStore((s) => s.selection);
  const annotationSelection = useEditorStore((s) => s.annotationSelection);
  const tool = useEditorStore((s) => s.tool);
  const draft = useEditorStore((s) => s.planDraft);
  const dimensionMode = useEditorStore((s) => s.dimensionMode);
  const snapToGrid = useEditorStore((s) => s.snapToGrid);
  const gridStep = useEditorStore((s) => s.gridStep);

  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ cx: 0, cy: 0, mpp: 0.01 });
  const [pointer, setPointer] = useState<{ point: Point2; snap: SnapKind } | null>(null);
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

  const snapPoints = useMemo(() => planSnapPoints(project), [project]);

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

  const click = (d: Drag, raw: Point2, additive: boolean): void => {
    const store = useEditorStore.getState();
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

  const { elements, systems: systemList } = project;
  const systems = useMemo(() => new Map(systemList.map((s) => [s.id, s])), [systemList]);
  // Algoritmo do pintor: os elementos mais altos são desenhados por último.
  const ordered = useMemo(
    () =>
      visibleElements({ elements, systems: systemList })
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
    <div className="plan" data-testid="plan-view" data-tool={tool}>
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
        <span className="muted plan__hint" data-testid="plan-hint">
          {tool === 'select'
            ? 'Clique para selecionar. Arraste o fundo para mover a vista e uma anotação para reposicioná-la. Roda do mouse: zoom.'
            : TOOL_HINTS[tool]}
        </span>
      </div>

      <AnnotationInspector focusId={focusId} />
    </div>
  );
}
