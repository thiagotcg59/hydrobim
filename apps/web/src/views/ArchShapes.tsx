import type { ArchHatch, Point2 } from '@hydrobim/core';
import type { PartRole } from '@hydrobim/geometry';
import { memo } from 'react';
import { HIGHLIGHT, INK, NO_ORIGIN, PAPER } from '../plan/planDrawing';
import { partFinish } from '../viewport/materials';
import { ARCH_LAYERS, type ArchViewEntry, type SpaceLabel, type ViewSwing } from './archView';

/**
 * Desenho da arquitetura nas vistas 2D (SVG, metros da vista com Y invertido). Cada elemento é
 * um grupo com a camada do caderno de referência em `data-layer`; a seção cortada leva traço
 * forte e a hachura do material (`<pattern>`), com preenchimento par-ímpar para respeitar os
 * vãos. As espessuras são de papel (mm), convertidas pela escala da vista.
 */

const FONT = 'Arial, Helvetica, sans-serif';
const MONO_FILL = '#ffffff';
/** Traço da seção cortada (mm de papel): o dobro do contorno comum. */
const CUT_STROKE = 0.5;
/** Passo das hachuras (mm de papel). */
const HATCH_STEP = 1.6;

const f = (value: number): string => (Math.round(value * 1e5) / 1e5).toString();

/** Identificador do padrão de hachura dentro do SVG da vista. */
export const hatchId = (base: string, hatch: ArchHatch): string => `${base}-${hatch}`;

/** Preenchimento da hachura: cor sólida, padrão do SVG ou nenhum. */
export function hatchFill(hatch: ArchHatch, base: string): string | null {
  if (hatch === 'none') return null;
  if (hatch === 'solid') return INK;
  return `url(#${hatchId(base, hatch)})`;
}

/** Padrões de hachura da vista (`diagonal`, `crossed`, `dotted`), na escala do papel. */
export function HatchDefs({ base, unit }: { base: string; unit: number }) {
  const s = HATCH_STEP * unit;
  const stroke = { stroke: INK, strokeWidth: PAPER.thin * unit * 0.7, fill: 'none' } as const;
  // As pontas além do ladrilho fecham o traço nos cantos, sem falhas entre repetições.
  const rising = `M${f(-s / 4)} ${f(s / 4)}L${f(s / 4)} ${f(-s / 4)}M0 ${f(s)}L${f(s)} 0M${f((3 * s) / 4)} ${f((5 * s) / 4)}L${f((5 * s) / 4)} ${f((3 * s) / 4)}`;
  const falling = `M${f(-s / 4)} ${f((3 * s) / 4)}L${f(s / 4)} ${f((5 * s) / 4)}M0 0L${f(s)} ${f(s)}M${f((3 * s) / 4)} ${f(-s / 4)}L${f((5 * s) / 4)} ${f(s / 4)}`;
  const tile = { patternUnits: 'userSpaceOnUse', width: s, height: s } as const;
  return (
    <>
      <pattern id={hatchId(base, 'diagonal')} data-hatch="diagonal" {...tile}>
        <path d={rising} {...stroke} />
      </pattern>
      <pattern id={hatchId(base, 'crossed')} data-hatch="crossed" {...tile}>
        <path d={rising} {...stroke} />
        <path d={falling} {...stroke} />
      </pattern>
      <pattern id={hatchId(base, 'dotted')} data-hatch="dotted" {...tile}>
        <circle cx={s / 4} cy={s / 4} r={s * 0.07} fill={INK} />
        <circle cx={(3 * s) / 4} cy={(3 * s) / 4} r={s * 0.07} fill={INK} />
      </pattern>
    </>
  );
}

const colorOf = (role: PartRole): string => partFinish(role, 'pvc').color;

function swingPath(swing: ViewSwing, origin: Point2): string {
  const x = (p: Point2): string => f(p.x - origin.x);
  const y = (p: Point2): string => f(-(p.y - origin.y));
  const [a, b] = swing.leaf;
  const leaf = `M${x(a)} ${y(a)}L${x(b)} ${y(b)}`;
  const { arc } = swing;
  if (!arc) return leaf;
  // Anti-horário na vista (Y para cima) = sentido negativo no SVG (Y para baixo).
  return `${leaf}M${x(arc.from)} ${y(arc.from)}A${f(arc.radius)} ${f(arc.radius)} 0 ${arc.large ? 1 : 0} 0 ${x(arc.to)} ${y(arc.to)}`;
}

interface ArchElementProps {
  entry: ArchViewEntry;
  selected: boolean;
  monochrome: boolean;
  /** Milímetro de papel em metros do modelo. */
  unit: number;
  origin?: Point2;
  /** Base dos identificadores dos padrões de hachura da vista. */
  hatchBase: string;
  /** Recorte da parte cortada (cortes: o trecho da linha), `url(#…)`. */
  cutClip?: string;
}

export const ArchViewElement = memo(function ArchViewElement({
  entry,
  selected,
  monochrome,
  unit,
  origin = NO_ORIGIN,
  hatchBase,
  cutClip,
}: ArchElementProps) {
  const { element, projected, cut, cutAnchor, above, swings } = entry;
  const thin = PAPER.thin * unit;
  const ink = selected ? HIGHLIGHT : INK;
  const move = (anchor: Point2): string =>
    `translate(${f(anchor.x - origin.x)} ${f(-(anchor.y - origin.y))})`;
  const fillOf = (role: PartRole): string => (monochrome ? MONO_FILL : colorOf(role));
  const pattern = hatchFill(entry.hatch, hatchBase);
  return (
    <g
      data-arch-id={element.id}
      data-arch-kind={element.kind}
      data-layer={above ? ARCH_LAYERS.above : entry.layer}
      data-cut={cut.length > 0 || undefined}
      data-selected={selected || undefined}
    >
      {projected && (
        <g data-part="projected" transform={move(projected.anchor)}>
          {/* O traço fino na cor do preenchimento fecha as frestas entre os triângulos. */}
          {monochrome ? (
            <path
              d={projected.fillPath}
              fill={MONO_FILL}
              stroke={MONO_FILL}
              strokeWidth={thin * 0.4}
            />
          ) : (
            projected.shades.map((shade, index) => (
              <path
                key={index}
                d={shade.path}
                fill={colorOf(shade.role)}
                stroke={colorOf(shade.role)}
                strokeWidth={thin * 0.4}
              />
            ))
          )}
          <path
            d={projected.linePath}
            fill="none"
            stroke={ink}
            strokeWidth={thin}
            strokeLinecap="round"
          />
        </g>
      )}
      {cut.length > 0 && (
        <g data-part="cut" clipPath={cutClip}>
          <g transform={move(cutAnchor)}>
            {cut.map((part, index) => {
              const glass = part.role === 'glass';
              const shape = (
                <>
                  <path d={part.path} fill={fillOf(part.role)} fillRule="evenodd" stroke="none" />
                  {pattern && !glass && (
                    <g data-layer={ARCH_LAYERS.hatch}>
                      <path
                        d={part.path}
                        data-hatch={entry.hatch}
                        fill={pattern}
                        fillRule="evenodd"
                        stroke="none"
                      />
                    </g>
                  )}
                  <path
                    d={part.path}
                    data-stroke={glass ? undefined : 'cut'}
                    data-role={part.role}
                    fill="none"
                    stroke={ink}
                    strokeWidth={glass ? thin : CUT_STROKE * unit}
                    strokeLinejoin="round"
                  />
                </>
              );
              return glass ? (
                <g key={index} data-layer={ARCH_LAYERS.glass}>
                  {shape}
                </g>
              ) : (
                <g key={index}>{shape}</g>
              );
            })}
          </g>
        </g>
      )}
      {above && (
        <g data-part="above" transform={move(above.anchor)}>
          <path
            d={above.linePath}
            fill="none"
            stroke={ink}
            strokeWidth={thin}
            strokeDasharray={`${f(2 * unit)} ${f(1 * unit)}`}
          />
        </g>
      )}
      {swings.length > 0 && (
        <g data-symbol="door-swing">
          {swings.map((swing, index) => (
            <path
              key={index}
              d={swingPath(swing, origin)}
              fill="none"
              stroke={ink}
              strokeWidth={thin}
              strokeLinecap="round"
            />
          ))}
        </g>
      )}
    </g>
  );
});

interface SpaceProps {
  label: SpaceLabel;
  selected: boolean;
  unit: number;
  origin?: Point2;
}

/** Ambiente em planta: contorno fino tracejado e rótulo (número, nome e área) no centro. */
export const SpaceShape = memo(function SpaceShape({
  label,
  selected,
  unit,
  origin = NO_ORIGIN,
}: SpaceProps) {
  const x = (p: Point2): string => f(p.x - origin.x);
  const y = (p: Point2): string => f(-(p.y - origin.y));
  const ink = selected ? HIGHLIGHT : INK;
  const ring = `${label.ring.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p)} ${y(p)}`).join('')}Z`;
  // Texto em corpo 10 e escalado: corpos de fração de unidade são mal desenhados pelo SVG.
  const scale = (PAPER.text * unit) / 10;
  const first = -((label.lines.length - 1) * 12) / 2;
  return (
    <g
      data-arch-id={label.element.id}
      data-arch-kind="space"
      data-layer={ARCH_LAYERS.spaces}
      data-selected={selected || undefined}
    >
      <path
        d={ring}
        fill="none"
        stroke={ink}
        strokeWidth={PAPER.thin * unit}
        strokeDasharray={`${f(3 * unit)} ${f(1.5 * unit)}`}
      />
      <g data-layer={ARCH_LAYERS.text}>
        <text
          data-testid="space-label"
          transform={`translate(${x(label.center)} ${y(label.center)}) scale(${f(scale)})`}
          fontSize={10}
          fontFamily={FONT}
          fill={ink}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {label.lines.map((line, index) => (
            <tspan key={index} x={0} y={first + index * 12}>
              {line}
            </tspan>
          ))}
        </text>
      </g>
    </g>
  );
});
