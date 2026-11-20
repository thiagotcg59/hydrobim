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
import {
  buildElementGeometry,
  planOutline,
  type PartRole,
  type PlanOutline,
} from '@hydrobim/geometry';
import { memo, type ReactNode } from 'react';
import { partFinish } from '../viewport/materials';

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
const MONO_FILL = '#ffffff';
/** Traço sobre partes escuras (PEAD, ferro com betume, borracha), onde o preto não aparece. */
const LIGHT_INK = '#eef1f4';
const FONT = 'Arial, Helvetica, sans-serif';

const f = (value: number): string => (Math.round(value * 1e4) / 1e4).toString();

interface CachedOutline {
  readonly outline: PlanOutline;
  /**
   * Ponto de referência do desenho do elemento (m, coordenadas do projeto). Os caminhos SVG são
   * escritos em relação a ele: o SVG trabalha em precisão simples, e coordenadas de quilômetros
   * (redes georreferenciadas) perderiam os milímetros se fossem escritas por extenso.
   */
  readonly anchor: Point2;
  readonly fillPath: string;
  readonly linePath: string;
  /** Preenchimento por papel da parte, na ordem de desenho (tema colorido). */
  readonly shades: readonly { role: PartRole; path: string }[];
  /** Linhas por papel da parte (tema colorido: o traço contrasta com a cor da parte). */
  readonly lineGroups: readonly { role: PartRole; path: string }[];
}

function trianglesPath(fill: Float64Array, anchor: Point2): string {
  const x = (i: number): string => f((fill[i] ?? 0) - anchor.x);
  const y = (i: number): string => f(-((fill[i] ?? 0) - anchor.y));
  const path: string[] = [];
  for (let i = 0; i + 5 < fill.length; i += 6) {
    path.push(`M${x(i)} ${y(i + 1)}L${x(i + 2)} ${y(i + 3)}L${x(i + 4)} ${y(i + 5)}Z`);
  }
  return path.join('');
}

function segmentsPath(lines: Float64Array, anchor: Point2): string {
  const x = (i: number): string => f((lines[i] ?? 0) - anchor.x);
  const y = (i: number): string => f(-((lines[i] ?? 0) - anchor.y));
  const path: string[] = [];
  for (let i = 0; i + 3 < lines.length; i += 4) {
    path.push(`M${x(i)} ${y(i + 1)}L${x(i + 2)} ${y(i + 3)}`);
  }
  return path.join('');
}
// O projeto é imutável: a projeção de um elemento vale enquanto o objeto for o mesmo.
const cache = new WeakMap<HydroElement, CachedOutline>();

export function outlineOf(element: HydroElement): CachedOutline {
  const hit = cache.get(element);
  if (hit) return hit;
  const outline = planOutline(buildElementGeometry(element));
  // Metro inteiro mais próximo do canto do elemento: os caminhos ficam com números pequenos.
  const anchor = { x: Math.round(outline.minX), y: Math.round(outline.minY) };
  const entry = {
    outline,
    anchor,
    fillPath: trianglesPath(outline.fill, anchor),
    linePath: segmentsPath(outline.lines, anchor),
    shades: outline.shading.map((shade) => ({
      role: shade.role,
      path: trianglesPath(shade.fill, anchor),
    })),
    lineGroups: outline.lineGroups.map((group) => ({
      role: group.role,
      path: segmentsPath(group.lines, anchor),
    })),
  };
  cache.set(element, entry);
  return entry;
}

/** Origem de desenho nula: coordenadas do SVG iguais às do projeto. */
export const NO_ORIGIN: Point2 = { x: 0, y: 0 };

/** A cor (#rrggbb) é escura a ponto de esconder o traço preto? */
function isDark(hex: string): boolean {
  const channel = (i: number): number => Number.parseInt(hex.slice(i, i + 2), 16) / 255;
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5) < 0.16;
}

interface PlanElementProps {
  element: HydroElement;
  /** Cor do sistema hidráulico; ausente = cor do material, como no modelo 3D. */
  systemColor: string | undefined;
  selected: boolean;
  /** Preto e branco: preenchimento branco, que ainda encobre o que está por baixo. */
  monochrome: boolean;
  /** Milímetro de papel em metros do modelo. */
  unit: number;
  /** Origem de desenho (m): o SVG mostra as coordenadas do projeto menos este ponto. */
  origin?: Point2;
}

export const PlanElement = memo(function PlanElement({
  element,
  systemColor,
  selected,
  monochrome,
  unit,
  origin = NO_ORIGIN,
}: PlanElementProps) {
  const { anchor, fillPath, linePath, shades, lineGroups } = outlineOf(element);
  const width = PAPER.outline * unit;
  const lineWidth = selected ? width * 1.8 : width;
  // Mesma biblioteca de materiais do modelo 3D: papel da parte, material e cor do sistema.
  const colorOf = (role: PartRole): string =>
    partFinish(role, element.spec.material, systemColor).color;
  return (
    <g
      data-element-id={element.id}
      data-element-kind={element.kind}
      transform={`translate(${f(anchor.x - origin.x)} ${f(-(anchor.y - origin.y))})`}
    >
      {/* O traço fino na cor do preenchimento fecha as frestas entre os triângulos. */}
      {monochrome ? (
        <path d={fillPath} fill={MONO_FILL} stroke={MONO_FILL} strokeWidth={width * 0.4} />
      ) : (
        shades.map((shade, index) => {
          const color = colorOf(shade.role);
          return (
            <path
              key={index}
              data-role={shade.role}
              d={shade.path}
              fill={color}
              stroke={color}
              strokeWidth={width * 0.4}
            />
          );
        })
      )}
      {monochrome || selected ? (
        <path
          d={linePath}
          fill="none"
          stroke={selected ? HIGHLIGHT : INK}
          strokeWidth={lineWidth}
          strokeLinecap="round"
        />
      ) : (
        lineGroups.map((group) => (
          <path
            key={group.role}
            d={group.path}
            fill="none"
            stroke={isDark(colorOf(group.role)) ? LIGHT_INK : INK}
            strokeWidth={lineWidth}
            strokeLinecap="round"
          />
        ))
      )}
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
  /** Origem de desenho (m): o SVG mostra as coordenadas do projeto menos este ponto. */
  origin?: Point2;
}

const shifted = (p: Point2, origin: Point2): Point2 => ({ x: p.x - origin.x, y: p.y - origin.y });

/**
 * A anotação com os pontos relativos à origem de desenho. O desenho de uma anotação só depende
 * de diferenças entre pontos (o valor cotado não muda), então basta transladar as entradas.
 */
function shiftAnnotation(annotation: Annotation, origin: Point2): Annotation {
  if (origin.x === 0 && origin.y === 0) return annotation;
  if (annotation.kind === 'dimension') {
    return { ...annotation, a: shifted(annotation.a, origin), b: shifted(annotation.b, origin) };
  }
  if (annotation.kind === 'text') {
    return {
      ...annotation,
      position: shifted(annotation.position, origin),
      ...(annotation.leader ? { leader: shifted(annotation.leader, origin) } : {}),
    };
  }
  return { ...annotation, position: shifted(annotation.position, origin) };
}

/** Desenho de uma anotação. As áreas de clique (`data-ui`) não vão para a exportação. */
export function AnnotationShape({
  annotation: source,
  project,
  unit,
  color,
  hit,
  origin = NO_ORIGIN,
}: ShapeProps) {
  const annotation = shiftAnnotation(source, origin);
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
      const anchor = shifted(tagAnchor(element), origin);
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
