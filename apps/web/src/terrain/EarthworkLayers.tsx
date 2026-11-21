import { projectEarthworks, type EarthworkSolid, type Point2, type Terrain } from '@hydrobim/core';
import { useMemo } from 'react';
import { HIGHLIGHT } from '../plan/planDrawing';
import { useEditorStore } from '../state/editorStore';
import { CUT_COLOR, FILL_COLOR } from './EarthworkPanel';
import { useEarthworkStore } from './earthworkStore';
import { useTerrainStore } from './terrainStore';

/**
 * Terraplenagem e edição do terreno na Planta Infra: perímetro dos platôs, linha de encontro
 * dos taludes com o terreno, regiões de corte e de aterro (na comparação) e, durante a edição,
 * os pontos cotados da superfície. Desenhado no SVG da planta (coordenadas do projeto menos a
 * origem de desenho, eixo Y invertido).
 */

const PLATFORM_INK = '#7c2d12';
const POINT_INK = '#365314';
const FONT = 'Arial, Helvetica, sans-serif';

const n = (value: number): string => (Math.round(value * 1e3) / 1e3).toString();

/** Projeção em planta das faces de cima de um sólido (as faces vêm em pares: tampa e fundo). */
function solidPath(solid: EarthworkSolid | null, origin: Point2): string {
  if (!solid) return '';
  const parts: string[] = [];
  const { points, triangles } = solid;
  for (let i = 0; i + 2 < triangles.length; i += 6) {
    const a = points[triangles[i] as number];
    const b = points[triangles[i + 1] as number];
    const c = points[triangles[i + 2] as number];
    if (!a || !b || !c) continue;
    parts.push(
      `M${n(a.x - origin.x)} ${n(-(a.y - origin.y))}L${n(b.x - origin.x)} ${n(-(b.y - origin.y))}L${n(c.x - origin.x)} ${n(-(c.y - origin.y))}Z`,
    );
  }
  return parts.join('');
}

interface Props {
  terrain: Terrain | null;
  origin: Point2;
  mpp: number;
}

export function EarthworkPlanLayer({ terrain, origin, mpp }: Props) {
  const project = useEditorStore((s) => s.project);
  const view = useEarthworkStore((s) => s.view);
  const selection = useEarthworkStore((s) => s.selection);
  const pointIndex = useEarthworkStore((s) => s.pointIndex);
  const pending = useEarthworkStore((s) => s.pending);
  const mode = useTerrainStore((s) => s.mode);
  const hasPlatforms = project.earthworks.platforms.length > 0;
  const summary = useMemo(
    () => (hasPlatforms ? projectEarthworks(project) : null),
    [project, hasPlatforms],
  );
  const showPoints = mode === 'point-add' || mode === 'point-edit' || mode === 'point-move';

  // Todos os pontos em um único caminho: traços de comprimento zero com ponta redonda.
  const pointsPath = useMemo(() => {
    if (!terrain || !showPoints) return '';
    return terrain.points.map((p) => `M${n(p.x - origin.x)} ${n(-(p.y - origin.y))}h0`).join('');
  }, [terrain, origin, showPoints]);

  const regions = useMemo(() => {
    if (!summary || view !== 'compare') return null;
    return {
      cut: summary.platforms.map((p) => solidPath(p.volumes?.cutSolid ?? null, origin)).join(''),
      fill: summary.platforms.map((p) => solidPath(p.volumes?.fillSolid ?? null, origin)).join(''),
    };
  }, [summary, view, origin]);

  const X = (x: number): number => x - origin.x;
  const Y = (y: number): number => -(y - origin.y);
  const ring = (points: readonly Point2[]): string =>
    `${points.map((p, i) => `${i === 0 ? 'M' : 'L'}${n(X(p.x))} ${n(Y(p.y))}`).join('')}Z`;
  const selected = pointIndex !== null ? terrain?.points[pointIndex] : undefined;
  const surfaceSelected = selection?.kind === 'surface';
  const showDesign = view === 'design' || view === 'compare';

  return (
    <g data-ui="earthwork" pointerEvents="none">
      {regions && (
        <g data-testid="earthwork-regions">
          <path
            data-testid="earthwork-region-cut"
            d={regions.cut}
            fill={CUT_COLOR}
            fillOpacity={0.45}
            stroke="none"
          />
          <path
            data-testid="earthwork-region-fill"
            d={regions.fill}
            fill={FILL_COLOR}
            fillOpacity={0.45}
            stroke="none"
          />
        </g>
      )}
      {surfaceSelected &&
        terrain?.boundary?.map((points, index) => (
          <path
            key={index}
            data-testid="earthwork-surface-selected"
            d={ring(points)}
            fill="none"
            stroke={HIGHLIGHT}
            strokeWidth={3}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      {summary?.platforms.map(({ platform, footprint, error }) => {
        const active = selection?.kind === 'platform' && selection.id === platform.id;
        const first = platform.outline[0];
        return (
          <g
            key={platform.id}
            data-testid="earthwork-platform"
            data-platform-id={platform.id}
            data-generated={error === null}
          >
            {footprint && showDesign && (
              <path
                data-testid="earthwork-daylight"
                d={ring(footprint.daylight)}
                fill="none"
                stroke={PLATFORM_INK}
                strokeWidth={1.2}
                strokeDasharray="6 3"
                vectorEffect="non-scaling-stroke"
              />
            )}
            <path
              data-testid="earthwork-outline"
              d={ring(platform.outline)}
              fill={error ? '#dc2626' : PLATFORM_INK}
              fillOpacity={active ? 0.16 : 0.06}
              stroke={active ? HIGHLIGHT : error ? '#dc2626' : PLATFORM_INK}
              strokeWidth={active ? 3 : 1.8}
              vectorEffect="non-scaling-stroke"
            />
            {first && (
              <text
                transform={`translate(${n(X(first.x) + 6 * mpp)} ${n(Y(first.y) - 6 * mpp)}) scale(${n(mpp)})`}
                fontSize={11}
                fontFamily={FONT}
                fill={PLATFORM_INK}
                stroke="#ffffff"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {platform.name} · Z{' '}
                {platform.elevation.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
              </text>
            )}
          </g>
        );
      })}
      {showPoints && (
        <path
          data-testid="earthwork-points"
          data-count={terrain?.points.length ?? 0}
          d={pointsPath}
          fill="none"
          stroke={POINT_INK}
          strokeWidth={5}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {selected && (
        <circle
          data-testid="earthwork-point-marker"
          cx={n(X(selected.x))}
          cy={n(Y(selected.y))}
          r={n(6 * mpp)}
          fill="#ffffff"
          stroke={HIGHLIGHT}
          strokeWidth={2.5}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {pending && (
        <path
          data-testid="earthwork-pending-marker"
          d={`M${n(X(pending.x) - 7 * mpp)} ${n(Y(pending.y))}H${n(X(pending.x) + 7 * mpp)}M${n(X(pending.x))} ${n(Y(pending.y) - 7 * mpp)}V${n(Y(pending.y) + 7 * mpp)}`}
          stroke={HIGHLIGHT}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  );
}
