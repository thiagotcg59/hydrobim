import {
  archVerticalRange,
  getArchType,
  hostedTypeOf,
  hostWallOf,
  layersThickness,
  rectangleFromThreePoints,
  ringCentroid,
  roofFootprint,
  roofFrame,
  roofPlanPoint,
  roofRidgeLine,
  roofTypeOf,
  slopeToPercent,
  spaceQuantities,
  wallAxes,
  wallFaceOffsets,
  wallFootprint,
  wallTypeOf,
  type ArchElement,
  type Point2,
  type Project,
} from '@hydrobim/core';
import { doorSwings, type DoorSwing } from '@hydrobim/geometry';
import { memo, useMemo } from 'react';
import { useEditorStore } from '../state/editorStore';
import { useSnapStore } from '../state/snapStore';
import { formatDecimal } from '../ui/fields';
import { activeTypeIdOf, archOnLevel, hostedPlacementAt, workLevelIdOf } from './archGeometry';
import { useArchStore } from './archStore';

/**
 * Arquitetura na planta de trabalho: contorno das paredes (com os encontros resolvidos pelo
 * núcleo), lajes e revestimentos com as aberturas, vãos e símbolos de portas e janelas, e os
 * ambientes com nome e área. Tudo é derivado do projeto a cada alteração — a camada não guarda
 * geometria nem regras.
 */

const INK = '#111111';
const HIGHLIGHT = '#00a6c0';
const REFUSED = '#c92a2a';

const COLORS = {
  color: {
    wall: '#d9d4c7',
    slab: '#f1f0ec',
    flooring: '#efe6d6',
    roof: '#b5654a',
    space: '#2f7d4f',
    glass: '#9cc9df',
  },
  mono: {
    wall: '#e4e4e4',
    slab: '#f6f6f6',
    flooring: '#fbfbfb',
    roof: '#555555',
    space: '#333333',
    glass: '#ffffff',
  },
} as const;

/** Símbolo do telhado em planta: referência, cumeeira e o sentido de queda de cada água. */
export interface RoofSymbol {
  /** Contorno de referência (a projeção com os beirais é o anel principal). */
  readonly reference: readonly Point2[];
  readonly ridge: readonly [Point2, Point2] | null;
  /** Setas de queda, do ponto alto para o baixo. */
  readonly falls: readonly (readonly [Point2, Point2])[];
  readonly label: { readonly at: Point2; readonly text: string };
}

export interface Shape {
  readonly element: ArchElement;
  /** Cota da base: ordem de desenho (os mais baixos primeiro). */
  readonly base: number;
  readonly rings: readonly (readonly Point2[])[];
  /** Vão na parede (porta ou janela): os quatro cantos, em planta. */
  readonly quad?: readonly Point2[];
  /** Linhas internas do símbolo (vidro da janela). */
  readonly lines?: readonly (readonly [Point2, Point2])[];
  readonly swings?: readonly DoorSwing[];
  readonly label?: { readonly at: Point2; readonly lines: readonly string[] };
  readonly roof?: RoofSymbol;
}

const ORDER: Record<ArchElement['kind'], number> = {
  slab: 0,
  flooring: 1,
  space: 2,
  wall: 3,
  window: 4,
  door: 5,
  // Por cima de tudo, só em traço: o telhado não esconde o que cobre.
  roof: 6,
};

/** Forma de um elemento na planta de trabalho (também desenha as prévias, como fantasma). */
export function shapeOf(
  project: Pick<Project, 'levels' | 'architecture'>,
  element: ArchElement,
): Shape {
  const { architecture } = project;
  const base = archVerticalRange(project, element)?.base ?? 0;
  switch (element.kind) {
    case 'wall':
      return {
        element,
        base,
        rings: [wallFootprint(architecture, element)?.polygon ?? [element.start, element.end]],
      };
    case 'slab':
    case 'flooring':
      return {
        element,
        base,
        rings: [element.boundary, ...element.openings.map((opening) => opening.boundary)],
      };
    case 'roof': {
      const type = roofTypeOf(architecture, element);
      const frame = type ? roofFrame(element, type) : null;
      if (!frame) return { element, base, rings: [element.boundary] };
      const middle = frame.length / 2;
      // A queda vai do ponto alto ao beiral: uma seta por água, no meio do comprimento.
      const falls: [Point2, Point2][] =
        frame.ridge === null
          ? [
              [
                roofPlanPoint(frame, middle, frame.span * 0.8),
                roofPlanPoint(frame, middle, frame.span * 0.2),
              ],
            ]
          : [
              [
                roofPlanPoint(frame, middle, frame.ridge * 0.85),
                roofPlanPoint(frame, middle, frame.ridge * 0.25),
              ],
              [
                roofPlanPoint(frame, middle, frame.span - frame.ridge * 0.85),
                roofPlanPoint(frame, middle, frame.span - frame.ridge * 0.25),
              ],
            ];
      return {
        element,
        base,
        rings: [roofFootprint(frame)],
        roof: {
          reference: element.boundary,
          ridge: roofRidgeLine(frame),
          falls,
          label: {
            at: roofPlanPoint(
              frame,
              frame.length * 0.25,
              frame.span * (frame.ridge === null ? 0.5 : 0.25),
            ),
            text: `i = ${formatDecimal(slopeToPercent(element.slope), 1)} %`,
          },
        },
      };
    }
    case 'space': {
      const area = spaceQuantities(element).area;
      return {
        element,
        base,
        rings: [element.boundary],
        label: {
          at: ringCentroid(element.boundary),
          lines: [
            element.number ? `${element.number} · ${element.name}` : element.name,
            `${formatDecimal(area, 2)} m²`,
          ],
        },
      };
    }
    case 'door':
    case 'window': {
      const host = hostWallOf(architecture, element);
      const type = hostedTypeOf(architecture, element);
      const wallType = host ? wallTypeOf(architecture, host) : undefined;
      if (!host || !type || !wallType) return { element, base, rings: [] };
      const { dir, left } = wallAxes(host);
      const { lo, hi } = wallFaceOffsets(host, layersThickness(wallType));
      const at = (s: number, n: number): Point2 => ({
        x: host.start.x + dir.x * (element.offset + s) + left.x * n,
        y: host.start.y + dir.y * (element.offset + s) + left.y * n,
      });
      const half = type.width / 2;
      const quad = [at(-half, lo), at(half, lo), at(half, hi), at(-half, hi)];
      if (element.kind === 'door') {
        return { element, base, rings: [], quad, swings: doorSwings(project, element) };
      }
      const third = (hi - lo) / 3;
      return {
        element,
        base,
        rings: [],
        quad,
        lines: [
          [at(-half, lo + third), at(half, lo + third)],
          [at(-half, hi - third), at(half, hi - third)],
        ],
      };
    }
  }
}

interface LayerProps {
  origin: Point2;
  /** Metros do modelo por pixel de tela. */
  mpp: number;
  /** Milímetro de papel em metros do modelo (altura dos textos). */
  unit: number;
  monochrome: boolean;
  /** Os elementos recebem o clique de seleção. */
  interactive: boolean;
}

/** Elementos arquitetônicos do projeto, na planta de trabalho. */
export const ArchPlanLayer = memo(function ArchPlanLayer({
  origin,
  mpp,
  unit,
  monochrome,
  interactive,
}: LayerProps) {
  const levels = useEditorStore((s) => s.project.levels);
  const architecture = useEditorStore((s) => s.project.architecture);
  const workPlaneZ = useEditorStore((s) => s.workPlaneZ);
  const activeLevelOnly = useSnapStore((s) => s.activeLevelOnly);
  const selection = useArchStore((s) => s.selection);
  // Só o nível do plano de trabalho, salvo com o filtro desligado (todos sobrepostos).
  const levelId = activeLevelOnly ? workLevelIdOf({ levels }, workPlaneZ) : null;
  const shapes = useMemo(
    () =>
      architecture.elements
        .filter((element) => archOnLevel(architecture, element, levelId))
        .map((element) => shapeOf({ levels, architecture }, element))
        .sort((a, b) => ORDER[a.element.kind] - ORDER[b.element.kind] || a.base - b.base),
    [levels, architecture, levelId],
  );
  if (shapes.length === 0) return null;
  const palette = monochrome ? COLORS.mono : COLORS.color;
  const X = (x: number): number => x - origin.x;
  const Y = (y: number): number => -(y - origin.y);
  const points = (ring: readonly Point2[]): string =>
    ring.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ');
  const path = (rings: readonly (readonly Point2[])[]): string =>
    rings.map((ring) => `M${ring.map((p) => `${X(p.x)} ${Y(p.y)}`).join('L')}Z`).join(' ');
  const thin = 1.2 * mpp;

  return (
    <g
      data-layer="architecture"
      data-level={levelId ?? 'all'}
      pointerEvents={interactive ? undefined : 'none'}
    >
      {shapes.map(({ element, rings, quad, lines, swings, label, roof }) => {
        const selected = selection.includes(element.id);
        const stroke = selected ? HIGHLIGHT : INK;
        const width = selected ? 2.4 * mpp : thin;
        const common = {
          'data-testid': 'arch-plan-element',
          'data-arch-id': element.id,
          'data-arch-kind': element.kind,
          'data-selected': selected,
        } as const;
        if (element.kind === 'wall') {
          const [ring] = rings;
          return (
            <g key={element.id} {...common}>
              <title>{element.name}</title>
              <polygon
                points={points(ring ?? [])}
                fill={selected ? '#bfeaf2' : palette.wall}
                stroke={stroke}
                strokeWidth={width}
                strokeLinejoin="round"
              />
            </g>
          );
        }
        if (element.kind === 'slab' || element.kind === 'flooring') {
          const [, ...openings] = rings;
          return (
            <g key={element.id} {...common}>
              <title>{element.name}</title>
              {/* O interior não intercepta o clique: só o contorno seleciona o piso. */}
              <path
                d={path(rings)}
                fillRule="evenodd"
                fill={element.kind === 'slab' ? palette.slab : palette.flooring}
                fillOpacity={0.7}
                stroke={stroke}
                strokeWidth={width}
                strokeDasharray={element.kind === 'slab' ? `${8 * mpp} ${4 * mpp}` : undefined}
                pointerEvents="none"
              />
              {openings.map((ring, index) => {
                const [a, b, c, d] = ring;
                // Abertura retangular: o X que indica o vão (shaft).
                return a && b && c && d && ring.length === 4 ? (
                  <path
                    key={index}
                    d={`M${X(a.x)} ${Y(a.y)}L${X(c.x)} ${Y(c.y)}M${X(b.x)} ${Y(b.y)}L${X(d.x)} ${Y(d.y)}`}
                    stroke={stroke}
                    strokeWidth={thin}
                    pointerEvents="none"
                  />
                ) : null;
              })}
              <path d={path(rings)} fill="none" stroke="transparent" strokeWidth={8 * mpp} />
            </g>
          );
        }
        if (element.kind === 'roof') {
          const color = selected ? HIGHLIGHT : palette.roof;
          const size = 2.2 * unit;
          const head = 7 * mpp;
          return (
            <g key={element.id} {...common}>
              <title>{element.name}</title>
              {/* Projeção com os beirais: só o traço seleciona; o interior deixa ver o que cobre. */}
              <polygon
                points={points(rings[0] ?? [])}
                fill={color}
                fillOpacity={selected ? 0.1 : 0.04}
                stroke={color}
                strokeWidth={width}
                strokeDasharray={`${10 * mpp} ${3 * mpp} ${2 * mpp} ${3 * mpp}`}
                pointerEvents="none"
              />
              {roof && (
                <g pointerEvents="none" stroke={color} fill="none">
                  <polygon
                    data-testid="arch-roof-reference"
                    points={points(roof.reference)}
                    strokeWidth={thin * 0.8}
                    strokeDasharray={`${3 * mpp} ${3 * mpp}`}
                  />
                  {roof.ridge && (
                    <line
                      data-testid="arch-roof-ridge"
                      x1={X(roof.ridge[0].x)}
                      y1={Y(roof.ridge[0].y)}
                      x2={X(roof.ridge[1].x)}
                      y2={Y(roof.ridge[1].y)}
                      strokeWidth={width}
                    />
                  )}
                  {roof.falls.map(([from, to], index) => {
                    const dx = to.x - from.x;
                    const dy = to.y - from.y;
                    const span = Math.hypot(dx, dy) || 1;
                    const ux = dx / span;
                    const uy = dy / span;
                    // Ponta da seta: dois traços a 25° da direção de queda.
                    const wing = (sign: 1 | -1): string => {
                      const cos = Math.cos(0.44);
                      const sin = Math.sin(0.44) * sign;
                      const wx = -(ux * cos - uy * sin);
                      const wy = -(ux * sin + uy * cos);
                      return `M${X(to.x)} ${Y(to.y)}L${X(to.x + wx * head)} ${Y(to.y + wy * head)}`;
                    };
                    return (
                      <path
                        key={index}
                        data-testid="arch-roof-fall"
                        d={`M${X(from.x)} ${Y(from.y)}L${X(to.x)} ${Y(to.y)}${wing(1)}${wing(-1)}`}
                        strokeWidth={thin}
                      />
                    );
                  })}
                  <text
                    data-testid="arch-roof-label"
                    x={X(roof.label.at.x)}
                    y={Y(roof.label.at.y)}
                    fontSize={size}
                    fontFamily="Arial, Helvetica, sans-serif"
                    textAnchor="middle"
                    fill={color}
                    stroke="none"
                  >
                    {roof.label.text}
                  </text>
                </g>
              )}
              <polygon
                points={points(rings[0] ?? [])}
                fill="none"
                stroke="transparent"
                strokeWidth={8 * mpp}
              />
            </g>
          );
        }
        if (element.kind === 'space') {
          const size = 2.5 * unit;
          return (
            <g key={element.id} {...common}>
              <title>{element.name}</title>
              <polygon
                points={points(rings[0] ?? [])}
                fill={selected ? HIGHLIGHT : 'none'}
                fillOpacity={0.08}
                stroke={selected ? HIGHLIGHT : palette.space}
                strokeWidth={width}
                strokeDasharray={`${3 * mpp} ${3 * mpp}`}
                pointerEvents="none"
              />
              <polygon
                points={points(rings[0] ?? [])}
                fill="none"
                stroke="transparent"
                strokeWidth={8 * mpp}
              />
              {label && (
                <text
                  data-testid="arch-space-label"
                  x={X(label.at.x)}
                  y={Y(label.at.y)}
                  fontSize={size}
                  fontFamily="Arial, Helvetica, sans-serif"
                  textAnchor="middle"
                  fill={selected ? HIGHLIGHT : palette.space}
                >
                  {label.lines.map((line, index) => (
                    <tspan key={index} x={X(label.at.x)} dy={index === 0 ? 0 : size * 1.25}>
                      {line}
                    </tspan>
                  ))}
                </text>
              )}
            </g>
          );
        }
        if (!quad) return null;
        return (
          <g key={element.id} {...common}>
            <title>{element.name}</title>
            <polygon
              points={points(quad)}
              fill={element.kind === 'window' ? palette.glass : '#ffffff'}
              stroke={stroke}
              strokeWidth={width}
            />
            {lines?.map(([a, b], index) => (
              <line
                key={index}
                x1={X(a.x)}
                y1={Y(a.y)}
                x2={X(b.x)}
                y2={Y(b.y)}
                stroke={stroke}
                strokeWidth={thin}
              />
            ))}
            {swings?.map((swing, index) => {
              const [hinge, tip] = swing.leaf;
              const { arc } = swing;
              const on = (angle: number): Point2 =>
                arc
                  ? {
                      x: arc.center.x + arc.radius * Math.cos(angle),
                      y: arc.center.y + arc.radius * Math.sin(angle),
                    }
                  : hinge;
              const from = arc ? on(arc.from) : hinge;
              const to = arc ? on(arc.to) : hinge;
              return (
                <g key={index} fill="none" stroke={stroke}>
                  <line
                    x1={X(hinge.x)}
                    y1={Y(hinge.y)}
                    x2={X(tip.x)}
                    y2={Y(tip.y)}
                    strokeWidth={width}
                  />
                  {arc && (
                    // Anti-horário no modelo (Y para cima) é anti-horário na tela: varredura 0.
                    <path
                      d={`M${X(from.x)} ${Y(from.y)}A${arc.radius} ${arc.radius} 0 0 0 ${X(to.x)} ${Y(to.y)}`}
                      strokeWidth={thin * 0.8}
                    />
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
});

interface DraftProps {
  origin: Point2;
  mpp: number;
  /** Raio de captura da parede sob o cursor (m). */
  tolerance: number;
}

/** Prévia da operação de arquitetura em andamento: traçado, contorno ou vão na parede. */
export function ArchDraftLayer({ origin, mpp, tolerance }: DraftProps) {
  const tool = useArchStore((s) => s.tool);
  const draft = useArchStore((s) => s.points);
  const cursor = useArchStore((s) => s.cursor);
  const options = useArchStore((s) => s.options);
  const activeTypes = useArchStore((s) => s.activeTypes);
  const project = useEditorStore((s) => s.project);
  const snapToGrid = useEditorStore((s) => s.snapToGrid);
  const gridStep = useEditorStore((s) => s.gridStep);
  if (!tool) return null;
  const X = (x: number): number => x - origin.x;
  const Y = (y: number): number => -(y - origin.y);
  const dash = `${6 * mpp} ${4 * mpp}`;
  const label = {
    fontSize: 11 * mpp,
    fontFamily: 'Arial, Helvetica, sans-serif',
    stroke: '#ffffff',
    strokeWidth: 3 * mpp,
    paintOrder: 'stroke',
  } as const;

  if (tool === 'door' || tool === 'window') {
    const typeId = activeTypeIdOf(project, activeTypes, tool);
    const placement =
      cursor && typeId
        ? hostedPlacementAt(project, tool, typeId, cursor, {
            tolerance,
            gridStep: snapToGrid ? gridStep : 0,
            sillHeight: tool === 'window' ? options.sillHeight : null,
          })
        : null;
    const wallType = placement ? wallTypeOf(project.architecture, placement.wall) : undefined;
    if (!placement || !wallType) return null;
    const { wall, offset, width, problem } = placement;
    const { dir, left } = wallAxes(wall);
    const { lo, hi } = wallFaceOffsets(wall, layersThickness(wallType));
    const at = (s: number, n: number): Point2 => ({
      x: wall.start.x + dir.x * (offset + s) + left.x * n,
      y: wall.start.y + dir.y * (offset + s) + left.y * n,
    });
    const quad = [at(-width / 2, lo), at(width / 2, lo), at(width / 2, hi), at(-width / 2, hi)];
    const color = problem ? REFUSED : HIGHLIGHT;
    const anchor = at(0, hi);
    return (
      <g data-testid="arch-hosted-preview" data-valid={problem === null} data-host={wall.id}>
        <polygon
          points={quad.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')}
          fill={color}
          fillOpacity={0.25}
          stroke={color}
          strokeWidth={2 * mpp}
        />
        <text x={X(anchor.x) + 8 * mpp} y={Y(anchor.y) - 8 * mpp} fill={color} {...label}>
          {problem
            ? `Não cabe: ${problem}`
            : `${wall.name} · a ${formatDecimal(offset, 2)} m do início`}
        </text>
      </g>
    );
  }

  if (tool === 'roof') {
    // Lado do beiral (dois pontos) e largura: o retângulo é o mesmo que o clique cria.
    const [a, b] = draft;
    const end = b ?? cursor;
    const rectangle = a && b && cursor ? rectangleFromThreePoints(a, b, cursor) : null;
    if (!a) return null;
    const side = end ? Math.hypot(end.x - a.x, end.y - a.y) : 0;
    const far = rectangle?.[2];
    const width = b && far ? Math.hypot(far.x - b.x, far.y - b.y) : 0;
    return (
      <g data-testid="arch-draft" data-points={draft.length} data-arch-draft="roof">
        {rectangle && (
          <polygon
            data-testid="arch-roof-draft"
            points={rectangle.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')}
            fill={HIGHLIGHT}
            fillOpacity={0.12}
            stroke={HIGHLIGHT}
            strokeWidth={1.5 * mpp}
            strokeDasharray={dash}
          />
        )}
        {end && (
          // O primeiro lado é o beiral: traço cheio, para distingui-lo dos demais.
          <line
            x1={X(a.x)}
            y1={Y(a.y)}
            x2={X(end.x)}
            y2={Y(end.y)}
            stroke={HIGHLIGHT}
            strokeWidth={2.5 * mpp}
          />
        )}
        {draft.map((p, index) => (
          <circle key={index} cx={X(p.x)} cy={Y(p.y)} r={3.5 * mpp} fill={HIGHLIGHT} />
        ))}
        {end && side > 1e-6 && (
          <text
            data-testid="arch-draft-length"
            x={X((a.x + end.x) / 2) + 8 * mpp}
            y={Y((a.y + end.y) / 2) - 8 * mpp}
            fill={HIGHLIGHT}
            {...label}
          >
            beiral · {formatDecimal(side, 3)} m
          </text>
        )}
        {b && far && width > 1e-6 && (
          <text
            data-testid="arch-draft-width"
            x={X((b.x + far.x) / 2) + 8 * mpp}
            y={Y((b.y + far.y) / 2) - 8 * mpp}
            fill={HIGHLIGHT}
            {...label}
          >
            largura · {formatDecimal(width, 3)} m
          </text>
        )}
      </g>
    );
  }

  const chain = cursor ? [...draft, cursor] : draft;
  if (chain.length === 0) return null;
  const last = draft[draft.length - 1];
  const first = draft[0];
  const contour = tool !== 'wall';
  // Paredes: as duas faces de cada trecho, pela espessura do tipo ativo e pela linha de referência.
  const wallTypeId = tool === 'wall' ? activeTypeIdOf(project, activeTypes, 'wall') : null;
  const wallType = wallTypeId ? getArchType(project.architecture, wallTypeId) : undefined;
  const faces =
    wallType?.category === 'wall'
      ? wallFaceOffsets({ locationLine: options.locationLine }, layersThickness(wallType))
      : null;
  const segments: [Point2, Point2][] = [];
  for (let i = 0; i + 1 < chain.length; i += 1) {
    const a = chain[i];
    const b = chain[i + 1];
    if (a && b) segments.push([a, b]);
  }
  const length = last && cursor ? Math.hypot(cursor.x - last.x, cursor.y - last.y) : 0;
  // Cota angular temporária: em relação ao trecho anterior ou, no primeiro trecho, ao eixo X.
  const before = draft[draft.length - 2];
  const turned = (() => {
    if (!last || !cursor || length < 1e-6) return null;
    const dir = { x: cursor.x - last.x, y: cursor.y - last.y };
    const from = before ? { x: last.x - before.x, y: last.y - before.y } : { x: 1, y: 0 };
    const angle = Math.atan2(from.x * dir.y - from.y * dir.x, from.x * dir.x + from.y * dir.y);
    return {
      degrees: Math.abs((angle * 180) / Math.PI),
      reference: before ? 'do trecho anterior' : 'do eixo X',
    };
  })();
  return (
    <g data-testid="arch-draft" data-points={draft.length}>
      {faces &&
        segments.map(([a, b], index) => {
          if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) return null;
          const { left } = wallAxes({ start: a, end: b });
          const corner = (p: Point2, n: number): string =>
            `${X(p.x + left.x * n)},${Y(p.y + left.y * n)}`;
          return (
            <polygon
              key={index}
              points={[
                corner(a, faces.lo),
                corner(b, faces.lo),
                corner(b, faces.hi),
                corner(a, faces.hi),
              ].join(' ')}
              fill={HIGHLIGHT}
              fillOpacity={0.15}
              stroke={HIGHLIGHT}
              strokeWidth={mpp}
            />
          );
        })}
      <polyline
        points={chain.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')}
        fill={contour && chain.length >= 3 ? HIGHLIGHT : 'none'}
        fillOpacity={0.1}
        stroke={HIGHLIGHT}
        strokeWidth={1.5 * mpp}
        strokeDasharray={dash}
      />
      {(contour || options.closed) && first && chain.length >= 3 && (
        <line
          x1={X(chain[chain.length - 1]?.x ?? first.x)}
          y1={Y(chain[chain.length - 1]?.y ?? first.y)}
          x2={X(first.x)}
          y2={Y(first.y)}
          stroke={HIGHLIGHT}
          strokeWidth={mpp}
          strokeDasharray={`${2 * mpp} ${4 * mpp}`}
        />
      )}
      {draft.map((p, index) => (
        <circle key={index} cx={X(p.x)} cy={Y(p.y)} r={3.5 * mpp} fill={HIGHLIGHT} />
      ))}
      {last && cursor && length > 1e-6 && (
        <text
          data-testid="arch-draft-length"
          x={X((last.x + cursor.x) / 2) + 8 * mpp}
          y={Y((last.y + cursor.y) / 2) - 8 * mpp}
          fill={HIGHLIGHT}
          {...label}
        >
          {formatDecimal(length, 3)} m
        </text>
      )}
      {last && cursor && turned && (
        <text
          data-testid="arch-draft-angle"
          data-degrees={turned.degrees}
          x={X((last.x + cursor.x) / 2) + 8 * mpp}
          y={Y((last.y + cursor.y) / 2) + 8 * mpp}
          fill={HIGHLIGHT}
          {...label}
        >
          {formatDecimal(turned.degrees, 1)}° {turned.reference}
        </text>
      )}
    </g>
  );
}
