import type { GeoTransform, HydroElement, Point2 } from '@hydrobim/core';
import { memo, useMemo } from 'react';
import type { ViewBounds } from '../map/tiles';
import { HIGHLIGHT } from '../plan/planDrawing';
import { partFinish } from '../viewport/materials';
import { coordinateGrid, formatCoordinate, type PlanLabel } from './infraPlan';

/**
 * Camadas próprias da Planta Infra, desenhadas no SVG da planta. As coordenadas são as do
 * projeto menos a origem de desenho, com o eixo Y invertido.
 */

const FONT = 'Arial, Helvetica, sans-serif';
const GRID_INK = '#5b6b80';

const n = (value: number): string => (Math.round(value * 1e4) / 1e4).toString();

interface SimplifiedProps {
  element: HydroElement;
  systemColor: string | undefined;
  selected: boolean;
  origin: Point2;
  /** Metros do modelo por pixel de tela. */
  mpp: number;
  monochrome: boolean;
}

/**
 * Representação simplificada de um elemento em vistas gerais: o tubo vira o seu eixo, com
 * traço de espessura fixa na tela; conexões e equipamentos viram símbolos de tamanho fixo na
 * tela. São SÍMBOLOS (`data-lod="symbol"`), não a geometria do produto: as dimensões físicas
 * continuam no modelo e voltam a ser desenhadas em escala ao aproximar.
 */
export const SimplifiedElement = memo(function SimplifiedElement({
  element,
  systemColor,
  selected,
  origin,
  mpp,
  monochrome,
}: SimplifiedProps) {
  const color = selected
    ? HIGHLIGHT
    : monochrome
      ? '#111111'
      : partFinish('body', element.spec.material, systemColor).color;
  const common = {
    'data-element-id': element.id,
    'data-element-kind': element.kind,
    'data-lod': 'symbol',
  } as const;
  if (element.kind === 'pipe') {
    const x1 = n(element.start.x - origin.x);
    const y1 = n(-(element.start.y - origin.y));
    const x2 = n(element.end.x - origin.x);
    const y2 = n(-(element.end.y - origin.y));
    return (
      <g {...common}>
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={color}
          strokeWidth={selected ? 3.5 : 2.2}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* Área de clique alargada; não vai para a exportação. */}
        <line
          data-ui="hit"
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="transparent"
          strokeWidth={12}
          vectorEffect="non-scaling-stroke"
          pointerEvents="stroke"
        />
      </g>
    );
  }
  const { position } = element.placement;
  const cx = position.x - origin.x;
  const cy = -(position.y - origin.y);
  // Tamanho do símbolo em pixels de tela, convertido para metros do desenho.
  const r = (element.kind === 'valve' || element.kind === 'elbow' ? 4.5 : 5.5) * mpp;
  const stroke = { stroke: color, strokeWidth: 1.4, vectorEffect: 'non-scaling-stroke' } as const;
  let symbol;
  if (element.kind === 'valve') {
    // Dois triângulos opostos pelo vértice (símbolo convencional de registro).
    symbol = (
      <path
        d={`M${n(cx - r)} ${n(cy - r * 0.7)}L${n(cx + r)} ${n(cy + r * 0.7)}L${n(cx + r)} ${n(cy - r * 0.7)}L${n(cx - r)} ${n(cy + r * 0.7)}Z`}
        fill="#ffffff"
        {...stroke}
      />
    );
  } else if (element.kind === 'tank') {
    symbol = (
      <rect
        x={n(cx - r)}
        y={n(cy - r)}
        width={n(2 * r)}
        height={n(2 * r)}
        fill="#ffffff"
        {...stroke}
      />
    );
  } else if (element.kind === 'pump') {
    symbol = (
      <>
        <circle cx={n(cx)} cy={n(cy)} r={n(r)} fill="#ffffff" {...stroke} />
        <path
          d={`M${n(cx - r * 0.5)} ${n(cy + r * 0.55)}L${n(cx + r * 0.7)} ${n(cy)}L${n(cx - r * 0.5)} ${n(cy - r * 0.55)}Z`}
          fill={color}
        />
      </>
    );
  } else {
    symbol = <circle cx={n(cx)} cy={n(cy)} r={n(r * 0.6)} fill={color} />;
  }
  return (
    <g {...common}>
      {symbol}
      <circle data-ui="hit" cx={n(cx)} cy={n(cy)} r={n(8 * mpp)} fill="transparent" />
    </g>
  );
});

interface LabelsProps {
  labels: readonly PlanLabel[];
  origin: Point2;
  mpp: number;
}

/** Rótulos de nós e trechos, com tamanho fixo na tela. */
export function NetworkLabels({ labels, origin, mpp }: LabelsProps) {
  return (
    <g data-layer-infra="labels" pointerEvents="none">
      {labels.map((label) => (
        <text
          key={label.id}
          data-testid="infra-label"
          data-label-for={label.id}
          transform={`translate(${n(label.x - origin.x + 8 * mpp)} ${n(-(label.y - origin.y) - 5 * mpp)}) scale(${n(mpp)})`}
          fontSize={11}
          fontFamily={FONT}
          fill="#0c1118"
          stroke="#ffffff"
          strokeWidth={3}
          strokeLinejoin="round"
          paintOrder="stroke"
        >
          {label.text}
        </text>
      ))}
    </g>
  );
}

interface GridProps {
  bounds: ViewBounds;
  mpp: number;
  origin: Point2;
  /** `null` = projeto sem georreferência utilizável: malha das coordenadas locais. */
  transform: GeoTransform | null;
  /** Sobre a imagem de satélite a malha precisa de contraste. */
  onImagery: boolean;
}

/** Malha de coordenadas: E/N do sistema projetado ou X/Y locais, com os valores nas linhas. */
export function CoordinateGrid({ bounds, mpp, origin, transform, onImagery }: GridProps) {
  const { minX, minY, maxX, maxY } = bounds;
  const grid = useMemo(
    () => coordinateGrid({ minX, minY, maxX, maxY }, mpp, transform),
    [minX, minY, maxX, maxY, mpp, transform],
  );
  const ink = onImagery ? '#ffffff' : GRID_INK;
  const digits = grid.step < 1 ? 2 : 0;
  return (
    <g data-layer-infra="references" data-grid-step={grid.step} pointerEvents="none">
      {grid.lines.map((line) => {
        const x1 = line.from.x - origin.x;
        const y1 = -(line.from.y - origin.y);
        const x2 = line.to.x - origin.x;
        const y2 = -(line.to.y - origin.y);
        return (
          <g key={`${line.axis}${line.value}`}>
            <line
              x1={n(x1)}
              y1={n(y1)}
              x2={n(x2)}
              y2={n(y2)}
              stroke={ink}
              strokeOpacity={onImagery ? 0.55 : 0.4}
              strokeWidth={1}
              strokeDasharray="6 5"
              vectorEffect="non-scaling-stroke"
            />
            <text
              transform={`translate(${n(x1 + 5 * mpp)} ${n(y1 - 5 * mpp)}) scale(${n(mpp)})`}
              fontSize={10}
              fontFamily={FONT}
              fill={onImagery ? '#ffffff' : GRID_INK}
              stroke={onImagery ? '#0c1118' : '#ffffff'}
              strokeWidth={2.5}
              paintOrder="stroke"
            >
              {line.axis} {formatCoordinate(line.value, digits)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
