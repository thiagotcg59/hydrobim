import {
  add,
  formatMeters,
  getElement,
  inlineAxisOf,
  inlineClearancesOf,
  scale,
  vec3,
  type InlineClearance,
  type Point2,
  type Vec3,
} from '@hydrobim/core';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { referenceClearance } from '../editor/inlineSlide';
import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { HIGHLIGHT } from './planDrawing';

/** Afastamento da linha de cota em relação ao eixo do tubo, em pixels de tela. */
const OFFSET_PX = 22;
/** Menor projeção em planta (m) para desenhar a cota; abaixo disso o trecho é vertical. */
const MIN_PLAN = 1e-4;

interface Props {
  readonly origin: Point2;
  /** Metros por pixel da vista. */
  readonly mpp: number;
}

/**
 * Cotas e alça das peças na linha, na planta: com uma válvula, tê, cruzeta ou outra peça
 * selecionada, mostra o tubo de cada extremidade até o próximo elemento (porta a porta) e,
 * pela alça, desliza a peça entre os tubos. A regra (cota, espaço, quem compensa) é do núcleo.
 */
export function InlineClearanceLayer({ origin, mpp }: Props) {
  const project = useEditorStore((s) => s.project);
  const selection = useEditorStore((s) => s.selection);
  const tool = useEditorStore((s) => s.tool);
  const sliding = useEditorStore((s) => s.inlineSlide?.elementId ?? null);
  const shown = useUiStore((s) => s.inlineClearances);
  const X = (x: number): number => x - origin.x;
  const Y = (y: number): number => -(y - origin.y);

  const ids = selection.filter((id) => getElement(project, id)?.kind !== 'pipe');
  if (ids.length === 0) return null;
  const single = selection.length === 1 ? (ids[0] ?? null) : null;
  const element = single ? getElement(project, single) : undefined;
  const axis = single ? inlineAxisOf(project, single) : null;
  const gripAxis =
    tool === 'select' &&
    element &&
    element.kind !== 'pipe' &&
    axis &&
    Math.hypot(axis.x, axis.y) > 0.1 &&
    referenceClearance(project, element.id)
      ? axis
      : null;

  const dimension = (clearance: InlineClearance, elementId: string) => {
    const dx = clearance.to.x - clearance.from.x;
    const dy = clearance.to.y - clearance.from.y;
    const span = Math.hypot(dx, dy);
    if (clearance.pipeIds.length === 0 || span < MIN_PLAN) return null;
    const u = { x: dx / span, y: dy / span };
    // Normal canônica (sempre do mesmo lado da linha): as cotas dos dois lados da peça alinham.
    let n = { x: -u.y, y: u.x };
    if (n.y < -1e-9 || (Math.abs(n.y) <= 1e-9 && n.x < 0)) n = { x: -n.x, y: -n.y };
    const at = (p: Vec3, px: number) => ({
      x: X(p.x + n.x * px * mpp),
      y: Y(p.y + n.y * px * mpp),
    });
    const a = at(clearance.from, OFFSET_PX);
    const b = at(clearance.to, OFFSET_PX);
    // Linhas de chamada partem um pouco afastadas do eixo, para não encobrir o tubo.
    const fromFoot = at(clearance.from, 3);
    const toFoot = at(clearance.to, 3);
    const tick = (p: { x: number; y: number }) => {
      // Traço oblíquo a 45° da linha de cota (convenção de desenho técnico).
      const t = { x: (u.x + n.x) * 4 * mpp, y: -(u.y + n.y) * 4 * mpp };
      return <line x1={p.x - t.x} y1={p.y - t.y} x2={p.x + t.x} y2={p.y + t.y} />;
    };
    let angle = (Math.atan2(-u.y, u.x) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    const mid = at(
      {
        x: (clearance.from.x + clearance.to.x) / 2,
        y: (clearance.from.y + clearance.to.y) / 2,
        z: 0,
      },
      OFFSET_PX + 5,
    );
    const text = `${formatMeters(clearance.length, 3)}${clearance.straight ? '' : ' (percurso)'}`;
    return (
      <g
        key={`${elementId}-${clearance.portId}`}
        data-testid={`inline-clearance-${clearance.portId}`}
        data-clearance-of={elementId}
        pointerEvents="none"
        data-length={clearance.length.toFixed(4)}
        stroke={HIGHLIGHT}
        strokeWidth={1.2 * mpp}
      >
        <line x1={fromFoot.x} y1={fromFoot.y} x2={a.x} y2={a.y} />
        <line x1={toFoot.x} y1={toFoot.y} x2={b.x} y2={b.y} />
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        {tick(a)}
        {tick(b)}
        <text
          x={mid.x}
          y={mid.y}
          transform={`rotate(${angle} ${mid.x} ${mid.y})`}
          textAnchor="middle"
          fontSize={11 * mpp}
          fontFamily="Arial, Helvetica, sans-serif"
          fill={HIGHLIGHT}
          stroke="#ffffff"
          strokeWidth={3 * mpp}
          paintOrder="stroke"
        >
          {text}
        </text>
      </g>
    );
  };

  const beginDrag = (event: ReactPointerEvent<SVGElement>): void => {
    if (!gripAxis || !element || element.kind === 'pipe' || event.button !== 0) return;
    // O arrasto da alça não chega à janela de seleção nem ao deslocamento da vista.
    event.stopPropagation();
    event.preventDefault();
    const svg = event.currentTarget.ownerSVGElement;
    const matrix = svg?.getScreenCTM()?.inverse();
    if (!svg || !matrix) return;
    const toModel = (clientX: number, clientY: number): Point2 => {
      const p = new DOMPoint(clientX, clientY).matrixTransform(matrix);
      return { x: p.x + origin.x, y: origin.y - p.y };
    };
    const grab = element.placement.position;
    const planAxis2 = gripAxis.x * gripAxis.x + gripAxis.y * gripAxis.y;
    useEditorStore.getState().beginInlineSlide(element.id, grab);
    const onMove = (move: PointerEvent): void => {
      const raw = toModel(move.clientX, move.clientY);
      // Ponto do eixo 3D da peça cuja projeção em planta é a mais próxima do cursor.
      const s = ((raw.x - grab.x) * gripAxis.x + (raw.y - grab.y) * gripAxis.y) / planAxis2;
      if (Number.isFinite(s))
        useEditorStore.getState().inlineSlideTo(add(grab, scale(gripAxis, s)));
    };
    const finish = (apply: boolean): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      useEditorStore.getState().endInlineSlide(apply);
    };
    function onUp(): void {
      finish(true);
    }
    function onCancel(): void {
      finish(false);
    }
    function onKey(key: KeyboardEvent): void {
      if (key.key === 'Escape') finish(false);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
  };

  const center = element && element.kind !== 'pipe' ? element.placement.position : vec3(0, 0, 0);
  return (
    <g data-ui="inline-clearances">
      {(shown || sliding) &&
        ids.flatMap((id) => inlineClearancesOf(project, id).map((c) => dimension(c, id)))}
      {gripAxis && (
        <rect
          data-testid="inline-grip"
          x={X(center.x) - 5 * mpp}
          y={Y(center.y) - 5 * mpp}
          width={10 * mpp}
          height={10 * mpp}
          transform={`rotate(45 ${X(center.x)} ${Y(center.y)})`}
          fill={sliding ? '#ffffff' : HIGHLIGHT}
          stroke={sliding ? HIGHLIGHT : '#ffffff'}
          strokeWidth={1.5 * mpp}
          style={{ cursor: 'grab' }}
          onPointerDown={beginDrag}
        >
          <title>Arraste para deslizar a peça entre os tubos (Esc cancela)</title>
        </rect>
      )}
    </g>
  );
}
