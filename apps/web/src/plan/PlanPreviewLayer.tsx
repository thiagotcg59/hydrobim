import { add, formatMeters, scale, type Point2, type Vec3 } from '@hydrobim/core';
import { useEditorStore } from '../state/editorStore';
import { guidesText, RELATION_LABELS, useViewPreview } from '../state/viewPreview';
import { outlineOf } from './planDrawing';

/** Cor dos fantasmas da prévia: distinta da seleção (ciano) e do traçado (laranja). */
export const PREVIEW_COLOR = '#2f9e44';
const GUIDE_COLOR = '#7048e8';
const ERROR_COLOR = '#c92a2a';

interface Props {
  /** Origem de desenho (m). */
  readonly origin: Point2;
  /** Metros por pixel. */
  readonly mpp: number;
  /** Milímetro de papel em metros do modelo. */
  readonly unit: number;
}

/**
 * Prévia na planta: elementos criados e alterados pela operação (fantasmas), símbolo da peça
 * de derivação, guias de alinhamento com a cota das portas e a recusa, quando houver. É a
 * mesma prévia do modelo 3D (`useViewPreview`).
 */
export function PlanPreviewLayer({ origin, mpp, unit }: Props) {
  const preview = useViewPreview();
  const cursor = useEditorStore((s) => s.cursor);
  if (!preview) return null;
  const X = (x: number): number => x - origin.x;
  const Y = (y: number): number => -(y - origin.y);
  const text = {
    fontSize: 11 * mpp,
    fontFamily: 'Arial, Helvetica, sans-serif',
    stroke: '#ffffff',
    strokeWidth: 3 * mpp,
    paintOrder: 'stroke',
  } as const;
  const { guides } = preview;
  const axisEnd = (from: Vec3, direction: Vec3, length: number): Vec3 =>
    add(from, scale(direction, length));
  const reach = guides ? Math.max(guides.distance * 1.2, 1) : 0;

  return (
    <g data-ui="preview" data-testid="plan-preview" pointerEvents="none">
      {preview.ghosts.map((element) => {
        const { anchor, fillPath, linePath } = outlineOf(element);
        return (
          <g
            key={element.id}
            data-testid="plan-preview-ghost"
            data-element-kind={element.kind}
            transform={`translate(${X(anchor.x)} ${Y(anchor.y)})`}
          >
            <path d={fillPath} fill={PREVIEW_COLOR} fillOpacity={0.35} stroke="none" />
            <path
              d={linePath}
              fill="none"
              stroke={PREVIEW_COLOR}
              strokeWidth={Math.max(1.5 * mpp, 0.2 * unit)}
              strokeDasharray={`${5 * mpp} ${3 * mpp}`}
            />
          </g>
        );
      })}
      {preview.junctions.map(({ element, label }) => {
        if (element.kind === 'pipe') return null;
        const c = element.placement.position;
        return (
          <g key={`j-${element.id}`} data-testid="plan-preview-junction" data-kind={element.kind}>
            <circle
              cx={X(c.x)}
              cy={Y(c.y)}
              r={7 * mpp}
              fill="none"
              stroke={PREVIEW_COLOR}
              strokeWidth={2 * mpp}
            />
            <text x={X(c.x) + 10 * mpp} y={Y(c.y) - 10 * mpp} fill={PREVIEW_COLOR} {...text}>
              {label}
            </text>
          </g>
        );
      })}
      {guides && (
        <g data-testid="plan-guides">
          {[guides.from, guides.to].map((port, index) => (
            <g key={index}>
              <line
                x1={X(port.position.x)}
                y1={Y(port.position.y)}
                x2={X(axisEnd(port.position, port.direction, reach).x)}
                y2={Y(axisEnd(port.position, port.direction, reach).y)}
                stroke={GUIDE_COLOR}
                strokeWidth={1.2 * mpp}
                strokeDasharray={`${8 * mpp} ${4 * mpp} ${2 * mpp} ${4 * mpp}`}
              />
              <circle
                cx={X(port.position.x)}
                cy={Y(port.position.y)}
                r={5 * mpp}
                fill={GUIDE_COLOR}
              />
              {/* A cota da porta evita ligar no nível errado: a planta não mostra Z. */}
              <text
                data-testid={index === 0 ? 'plan-guide-from' : 'plan-guide-to'}
                x={X(port.position.x) + 8 * mpp}
                y={Y(port.position.y) + 16 * mpp}
                fill={GUIDE_COLOR}
                {...text}
              >
                {`${index === 0 ? 'Partida' : 'Referência'} · cota ${formatMeters(port.position.z, 3)}`}
              </text>
            </g>
          ))}
          <line
            x1={X(guides.from.position.x)}
            y1={Y(guides.from.position.y)}
            x2={X(guides.footOnTarget.x)}
            y2={Y(guides.footOnTarget.y)}
            stroke={GUIDE_COLOR}
            strokeWidth={1 * mpp}
            strokeDasharray={`${3 * mpp} ${3 * mpp}`}
          />
          {guides.meet && (
            <circle
              data-testid="plan-guide-meet"
              cx={X(guides.meet.onTo.x)}
              cy={Y(guides.meet.onTo.y)}
              r={4 * mpp}
              fill="none"
              stroke={GUIDE_COLOR}
              strokeWidth={1.5 * mpp}
            />
          )}
          <text
            data-testid="plan-guides-text"
            x={X(guides.footOnTarget.x) + 8 * mpp}
            y={Y(guides.footOnTarget.y) - 8 * mpp}
            fill={GUIDE_COLOR}
            {...text}
          >
            {`${RELATION_LABELS[guides.relation]} — ${guidesText(guides)}`}
          </text>
        </g>
      )}
      {preview.error && cursor && (
        <text
          data-testid="plan-preview-error"
          x={X(cursor.point.x) + 10 * mpp}
          y={Y(cursor.point.y) + 32 * mpp}
          fill={ERROR_COLOR}
          {...text}
        >
          {preview.error}
        </text>
      )}
    </g>
  );
}
