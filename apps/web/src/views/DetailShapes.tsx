import {
  dimensionGeometry,
  dimensionOffsetAt,
  type DetailPatch,
  type Point2,
  type Project,
  type ViewDetail,
} from '@hydrobim/core';
import type { ReactNode } from 'react';
import { AnnotationShape, NO_ORIGIN, PAPER } from '../plan/planDrawing';

/**
 * Desenho dos detalhes 2D de uma vista (SVG, metros da vista com Y invertido). Textos e cotas
 * usam o mesmo traçado das anotações da planta de trabalho; as demais formas são primitivas do
 * SVG. As áreas de clique (`data-ui`) não vão para a exportação.
 */

const f = (value: number): string => (Math.round(value * 1e4) / 1e4).toString();

interface Props {
  detail: ViewDetail;
  project: Project;
  /** Milímetro de papel em metros do modelo. */
  unit: number;
  color: string;
  /** Largura da área de clique (m); 0 = não selecionável. */
  hit: number;
  origin?: Point2;
  selected?: boolean;
}

export function DetailShape({
  detail,
  project,
  unit,
  color,
  hit,
  origin = NO_ORIGIN,
  selected = false,
}: Props) {
  const x = (p: Point2): string => f(p.x - origin.x);
  const y = (p: Point2): string => f(-(p.y - origin.y));
  const stroke = { fill: 'none', stroke: color, strokeWidth: PAPER.outline * unit } as const;
  const hitStroke = {
    'data-ui': 'hit',
    fill: 'none',
    stroke: 'transparent',
    strokeWidth: hit,
    pointerEvents: 'stroke',
  } as const;
  const both = (shape: (props: object, key: string) => ReactNode): ReactNode => (
    <>
      {shape({ ...stroke, strokeLinecap: 'round', strokeLinejoin: 'round' }, 'shape')}
      {hit > 0 && shape(hitStroke, 'hit')}
    </>
  );

  let content: ReactNode;
  if (detail.kind === 'line') {
    content = both((props, key) => (
      <line
        key={key}
        x1={x(detail.a)}
        y1={y(detail.a)}
        x2={x(detail.b)}
        y2={y(detail.b)}
        {...props}
      />
    ));
  } else if (detail.kind === 'polyline') {
    const points = detail.points.map((p) => `${x(p)},${y(p)}`).join(' ');
    content = both((props, key) =>
      detail.closed ? (
        <polygon key={key} points={points} {...props} />
      ) : (
        <polyline key={key} points={points} {...props} />
      ),
    );
  } else if (detail.kind === 'rect') {
    const left = Math.min(detail.a.x, detail.b.x);
    const top = Math.max(detail.a.y, detail.b.y);
    content = both((props, key) => (
      <rect
        key={key}
        x={f(left - origin.x)}
        y={f(-(top - origin.y))}
        width={f(Math.abs(detail.b.x - detail.a.x))}
        height={f(Math.abs(detail.b.y - detail.a.y))}
        {...props}
      />
    ));
  } else if (detail.kind === 'circle') {
    content = both((props, key) => (
      <circle
        key={key}
        cx={x(detail.center)}
        cy={y(detail.center)}
        r={f(detail.radius)}
        {...props}
      />
    ));
  } else {
    content = (
      <AnnotationShape
        annotation={detail}
        project={project}
        unit={unit}
        color={color}
        hit={hit}
        origin={origin}
      />
    );
  }
  return (
    <g
      data-detail-id={detail.id}
      data-detail-kind={detail.kind}
      data-selected={selected || undefined}
    >
      {content}
    </g>
  );
}

/** Alça de edição de um detalhe: o ponto e a alteração que arrastá-la produz. */
export interface DetailGrip {
  readonly key: string;
  readonly point: Point2;
  readonly patch: (to: Point2) => DetailPatch;
}

/** Alças do detalhe selecionado: vértices, cantos, centro e raio, posição e afastamento. */
export function detailGripsOf(detail: ViewDetail): DetailGrip[] {
  switch (detail.kind) {
    case 'line':
      return [
        { key: 'a', point: detail.a, patch: (to) => ({ a: to }) },
        { key: 'b', point: detail.b, patch: (to) => ({ b: to }) },
      ];
    case 'rect':
      return [
        { key: 'a', point: detail.a, patch: (to) => ({ a: to }) },
        { key: 'b', point: detail.b, patch: (to) => ({ b: to }) },
      ];
    case 'polyline':
      return detail.points.map((point, index) => ({
        key: `p${index}`,
        point,
        patch: (to) => ({ points: detail.points.map((p, i) => (i === index ? to : p)) }),
      }));
    case 'circle':
      return [
        { key: 'center', point: detail.center, patch: (to) => ({ center: to }) },
        {
          key: 'radius',
          point: { x: detail.center.x + detail.radius, y: detail.center.y },
          patch: (to) => ({
            radius: Math.hypot(to.x - detail.center.x, to.y - detail.center.y),
          }),
        },
      ];
    case 'text':
      return [{ key: 'position', point: detail.position, patch: (to) => ({ position: to }) }];
    case 'dimension':
      return [
        { key: 'a', point: detail.a, patch: (to) => ({ a: to }) },
        { key: 'b', point: detail.b, patch: (to) => ({ b: to }) },
        {
          key: 'offset',
          point: offsetGripOf(detail),
          patch: (to) => ({ offset: dimensionOffsetAt(detail, to) }),
        },
      ];
  }
}

/** Meio da linha de cota: arrastá-lo muda o afastamento. */
function offsetGripOf(detail: Extract<ViewDetail, { kind: 'dimension' }>): Point2 {
  const g = dimensionGeometry(detail);
  return g
    ? { x: (g.start.x + g.end.x) / 2, y: (g.start.y + g.end.y) / 2 }
    : { x: (detail.a.x + detail.b.x) / 2, y: (detail.a.y + detail.b.y) / 2 };
}
