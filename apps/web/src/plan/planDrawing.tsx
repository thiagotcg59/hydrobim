import {
  dimensionGeometry,
  formatDimension,
  getElement,
  tagAnchor,
  tagText,
  type Annotation,
  type HydroElement,
  type Point2,
  type Project,
} from '@hydrobim/core';
import { buildElementGeometry, planOutline, type PlanOutline } from '@hydrobim/geometry';
import { memo, type ReactNode } from 'react';

/**
 * Desenho da planta baixa em SVG. Coordenadas do SVG = metros do modelo, com Y invertido
 * (o SVG cresce para baixo). Espessuras e alturas de texto são dadas em milímetros de papel
 * e convertidas pela escala do desenho, como em uma prancha.
 */

/** Dimensões de papel (mm). */
export const PAPER = {
  text: 2.5,
  outline: 0.25,
  thin: 0.18,
  tick: 1.8,
  extensionGap: 1,
  overshoot: 1.5,
  textGap: 0.8,
  arrow: 2.6,
} as const;

export const INK = '#111111';
export const HIGHLIGHT = '#1f6fe0';
const FILL = '#e4e7eb';
const TANK_FILL = '#cfe8f7';
const FONT = 'Arial, Helvetica, sans-serif';

const f = (value: number): string => (Math.round(value * 1e4) / 1e4).toString();

interface CachedOutline {
  readonly outline: PlanOutline;
  readonly fillPath: string;
  readonly linePath: string;
}
// O projeto é imutável: a projeção de um elemento vale enquanto o objeto for o mesmo.
const cache = new WeakMap<HydroElement, CachedOutline>();

export function outlineOf(element: HydroElement): CachedOutline {
  const hit = cache.get(element);
  if (hit) return hit;
  const outline = planOutline(buildElementGeometry(element));
  const fill: string[] = [];
  for (let i = 0; i + 5 < outline.fill.length; i += 6) {
    fill.push(
      `M${f(outline.fill[i] ?? 0)} ${f(-(outline.fill[i + 1] ?? 0))}L${f(outline.fill[i + 2] ?? 0)} ${f(-(outline.fill[i + 3] ?? 0))}L${f(outline.fill[i + 4] ?? 0)} ${f(-(outline.fill[i + 5] ?? 0))}Z`,
    );
  }
  const lines: string[] = [];
  for (let i = 0; i + 3 < outline.lines.length; i += 4) {
    lines.push(
      `M${f(outline.lines[i] ?? 0)} ${f(-(outline.lines[i + 1] ?? 0))}L${f(outline.lines[i + 2] ?? 0)} ${f(-(outline.lines[i + 3] ?? 0))}`,
    );
  }
  const entry = { outline, fillPath: fill.join(''), linePath: lines.join('') };
  cache.set(element, entry);
  return entry;
}

/** Clareia a cor do sistema para o preenchimento (as linhas continuam pretas). */
function tint(hex: string): string {
  const channel = (i: number): number => {
    const value = Number.parseInt(hex.slice(i, i + 2), 16);
    return Math.round(value + (255 - value) * 0.78);
  };
  return `rgb(${channel(1)}, ${channel(3)}, ${channel(5)})`;
}

interface PlanElementProps {
  element: HydroElement;
  systemColor: string | undefined;
  selected: boolean;
  /** Milímetro de papel em metros do modelo. */
  unit: number;
}

export const PlanElement = memo(function PlanElement({
  element,
  systemColor,
  selected,
  unit,
}: PlanElementProps) {
  const { fillPath, linePath } = outlineOf(element);
  const fill = systemColor ? tint(systemColor) : element.kind === 'tank' ? TANK_FILL : FILL;
  const width = PAPER.outline * unit;
  return (
    <g data-element-id={element.id} data-element-kind={element.kind}>
      {/* O traço fino na cor do preenchimento fecha as frestas entre os triângulos. */}
      <path d={fillPath} fill={fill} stroke={fill} strokeWidth={width * 0.4} />
      <path
        d={linePath}
        fill="none"
        stroke={selected ? HIGHLIGHT : INK}
        strokeWidth={selected ? width * 1.8 : width}
        strokeLinecap="round"
      />
    </g>
  );
});

/** Ângulo de texto legível: entre −90° (exclusive) e +90°. */
export function readableAngle(angle: number): number {
  let a = angle;
  if (a > Math.PI / 2 + 1e-9) a -= Math.PI;
  if (a <= -Math.PI / 2 + 1e-9) a += Math.PI;
  return a;
}

interface PlanTextProps {
  x: number;
  y: number;
  angle: number;
  text: string;
  /** Altura do texto em metros do modelo. */
  height: number;
  anchor: 'start' | 'middle' | 'end';
  vAlign: 'bottom' | 'middle';
  color: string;
  /** Deslocamento ao longo da linha do texto (m). */
  dx?: number;
}

export function PlanText({
  x,
  y,
  angle,
  text,
  height,
  anchor,
  vAlign,
  color,
  dx = 0,
}: PlanTextProps) {
  const lines = text.split('\n');
  // A fonte é desenhada com 10 unidades e reduzida por escala: evita os limites de tamanho
  // mínimo de fonte dos navegadores com unidades em metros.
  const k = height / 10;
  const first =
    vAlign === 'middle' ? 3.5 - ((lines.length - 1) * 12) / 2 : -1.5 - (lines.length - 1) * 12;
  return (
    <text
      transform={`translate(${f(x)} ${f(-y)}) rotate(${f((-angle * 180) / Math.PI)}) scale(${k})`}
      fontSize={10}
      fontFamily={FONT}
      textAnchor={anchor}
      fill={color}
      stroke="#ffffff"
      strokeWidth={2.4}
      strokeLinejoin="round"
      paintOrder="stroke"
    >
      {lines.map((line, i) => (
        <tspan key={i} x={dx / k} y={first + i * 12}>
          {line.length > 0 ? line : ' '}
        </tspan>
      ))}
    </text>
  );
}

/** Pontos que delimitam uma anotação (enquadramento e exportação). */
export function annotationPoints(project: Project, annotation: Annotation): Point2[] {
  if (annotation.kind === 'dimension') {
    const g = dimensionGeometry(annotation);
    return g ? [annotation.a, annotation.b, g.start, g.end] : [annotation.a, annotation.b];
  }
  if (annotation.kind === 'text') {
    return annotation.leader ? [annotation.position, annotation.leader] : [annotation.position];
  }
  const element = getElement(project, annotation.elementId);
  return element ? [annotation.position, tagAnchor(element)] : [annotation.position];
}

interface ShapeProps {
  annotation: Annotation;
  project: Project;
  unit: number;
  color: string;
  /** Largura da área de clique das linhas (m); 0 = anotação não selecionável. */
  hit: number;
}

/** Desenho de uma anotação. As áreas de clique (`data-ui`) não vão para a exportação. */
export function AnnotationShape({ annotation, project, unit, color, hit }: ShapeProps) {
  const thin = PAPER.thin * unit;
  const height = PAPER.text * unit;
  const shapes: ReactNode[] = [];
  const segment = (key: string, p: Point2, q: Point2): void => {
    shapes.push(
      <line
        key={key}
        x1={f(p.x)}
        y1={f(-p.y)}
        x2={f(q.x)}
        y2={f(-q.y)}
        stroke={color}
        strokeWidth={thin}
        strokeLinecap="round"
      />,
    );
    // Área de clique alargada: só existe quando as anotações são selecionáveis.
    if (hit <= 0) return;
    shapes.push(
      <line
        key={`${key}-hit`}
        data-ui="hit"
        x1={f(p.x)}
        y1={f(-p.y)}
        x2={f(q.x)}
        y2={f(-q.y)}
        stroke="transparent"
        strokeWidth={hit}
        pointerEvents="stroke"
      />,
    );
  };
  const arrow = (key: string, tip: Point2, from: Point2): void => {
    const dx = tip.x - from.x;
    const dy = tip.y - from.y;
    const size = Math.hypot(dx, dy);
    if (size < 1e-9) return;
    const ux = dx / size;
    const uy = dy / size;
    const length = Math.min(PAPER.arrow * unit, size);
    const half = length * 0.18;
    const bx = tip.x - ux * length;
    const by = tip.y - uy * length;
    shapes.push(
      <polygon
        key={key}
        points={`${f(tip.x)},${f(-tip.y)} ${f(bx - uy * half)},${f(-(by + ux * half))} ${f(bx + uy * half)},${f(-(by - ux * half))}`}
        fill={color}
      />,
    );
  };
  const sideText = (key: string, at: Point2, from: Point2, text: string, angle: number): void => {
    const right = at.x >= from.x;
    shapes.push(
      <PlanText
        key={key}
        x={at.x}
        y={at.y}
        angle={angle}
        text={text}
        height={height}
        anchor={right ? 'start' : 'end'}
        vAlign="middle"
        color={color}
        dx={(right ? 1 : -1) * unit}
      />,
    );
  };

  if (annotation.kind === 'dimension') {
    const g = dimensionGeometry(annotation);
    if (!g) return null;
    const extension = (key: string, from: Point2, to: Point2): void => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const size = Math.hypot(dx, dy);
      if (size < 1e-9) return;
      const ux = dx / size;
      const uy = dy / size;
      const gap = Math.min(PAPER.extensionGap * unit, size / 2);
      const over = PAPER.overshoot * unit;
      segment(
        key,
        { x: from.x + ux * gap, y: from.y + uy * gap },
        { x: to.x + ux * over, y: to.y + uy * over },
      );
    };
    extension('ext-a', annotation.a, g.start);
    extension('ext-b', annotation.b, g.end);
    const { direction: d, normal: n } = g;
    const over = PAPER.extensionGap * unit;
    segment(
      'line',
      { x: g.start.x - d.x * over, y: g.start.y - d.y * over },
      { x: g.end.x + d.x * over, y: g.end.y + d.y * over },
    );
    const tick = (PAPER.tick * unit) / 2 / Math.SQRT2;
    for (const [key, p] of [
      ['tick-a', g.start],
      ['tick-b', g.end],
    ] as const) {
      shapes.push(
        <line
          key={key}
          x1={f(p.x - (d.x + n.x) * tick)}
          y1={f(-(p.y - (d.y + n.y) * tick))}
          x2={f(p.x + (d.x + n.x) * tick)}
          y2={f(-(p.y + (d.y + n.y) * tick))}
          stroke={color}
          strokeWidth={thin * 2}
          strokeLinecap="round"
        />,
      );
    }
    const angle = readableAngle(Math.atan2(d.y, d.x));
    const gap = PAPER.textGap * unit;
    shapes.push(
      <PlanText
        key="text"
        x={(g.start.x + g.end.x) / 2 - Math.sin(angle) * gap}
        y={(g.start.y + g.end.y) / 2 + Math.cos(angle) * gap}
        angle={angle}
        text={formatDimension(g.value)}
        height={height}
        anchor="middle"
        vAlign="bottom"
        color={color}
      />,
    );
  } else if (annotation.kind === 'text') {
    if (annotation.leader) {
      segment('leader', annotation.leader, annotation.position);
      arrow('arrow', annotation.leader, annotation.position);
      sideText(
        'text',
        annotation.position,
        annotation.leader,
        annotation.text,
        annotation.rotation,
      );
    } else {
      shapes.push(
        <PlanText
          key="text"
          x={annotation.position.x}
          y={annotation.position.y}
          angle={annotation.rotation}
          text={annotation.text}
          height={height}
          anchor="start"
          vAlign="middle"
          color={color}
        />,
      );
    }
  } else {
    const element = getElement(project, annotation.elementId);
    if (!element) return null;
    const text = tagText(element);
    const dx = element.kind === 'pipe' ? element.end.x - element.start.x : 0;
    const dy = element.kind === 'pipe' ? element.end.y - element.start.y : 0;
    if (element.kind === 'pipe' && Math.hypot(dx, dy) > 1e-6) {
      // Tubos: texto paralelo ao trecho, como nas plantas de instalações.
      shapes.push(
        <PlanText
          key="text"
          x={annotation.position.x}
          y={annotation.position.y}
          angle={readableAngle(Math.atan2(dy, dx))}
          text={text}
          height={height}
          anchor="middle"
          vAlign="bottom"
          color={color}
        />,
      );
    } else {
      const anchor = tagAnchor(element);
      segment('leader', anchor, annotation.position);
      shapes.push(
        <circle key="dot" cx={f(anchor.x)} cy={f(-anchor.y)} r={0.5 * unit} fill={color} />,
      );
      sideText('text', annotation.position, anchor, text, 0);
    }
  }

  return (
    <g data-annotation-id={annotation.id} data-annotation-kind={annotation.kind}>
      {shapes}
    </g>
  );
}
