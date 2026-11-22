import {
  formatMeters,
  smoothContourLine,
  suggestContourInterval,
  terrainContours,
  terrainHitAt,
  type Point2,
  type Terrain,
} from '@hydrobim/core';
import { memo, useMemo } from 'react';
import { HIGHLIGHT } from '../plan/planDrawing';
import { useEditorStore } from '../state/editorStore';
import { EarthworkPlanLayer } from './EarthworkLayers';
import { shownTerrain, useEarthworkStore } from './earthworkStore';
import { terrainFootprintPath } from './terrainRaster';
import { areaRings, useTerrainStore } from './terrainStore';

/**
 * Camadas do terreno na Planta Infra, desenhadas no SVG da planta (coordenadas do projeto
 * menos a origem de desenho, eixo Y invertido): limite, linhas de quebra, curvas de nível,
 * triangulação e, por cima, o que está em edição (área, furo, corte e ponto consultado).
 */

const FONT = 'Arial, Helvetica, sans-serif';
const TERRAIN_INK = '#6f8f5a';
const CONTOUR_INK = '#8a5a2b';
const BREAKLINE_INK = '#c2410c';
const AREA_INK = '#7c3aed';

const n = (value: number): string => (Math.round(value * 1e3) / 1e3).toString();

/** Intervalo das curvas em uso: o escolhido ou o sugerido pelo desnível. */
export function contourIntervalOf(terrain: Terrain, chosen: number | null): number {
  return chosen ?? suggestContourInterval(terrain);
}

interface SurfaceProps {
  terrain: Terrain;
  origin: Point2;
  /** Metros do modelo por pixel de tela. */
  mpp: number;
}

/** Superfície do projeto: limite, linhas de quebra, curvas de nível e triangulação. */
export const TerrainSurfacePlan = memo(function TerrainSurfacePlan({
  terrain: natural,
  origin,
  mpp,
}: SurfaceProps) {
  const display = useTerrainStore((s) => s.display);
  // Curvas e triangulação são as da superfície à mostra (natural, projetada ou original); o
  // limite e as linhas de quebra são sempre os dados da superfície do projeto.
  const view = useEarthworkStore((s) => s.view);
  const project = useEditorStore((s) => s.project);
  const terrain = useMemo(
    () => (project.terrain === natural ? (shownTerrain(project, view) ?? natural) : natural),
    [project, natural, view],
  );
  const path = (points: readonly { x: number; y: number }[], close: boolean): string =>
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${n(p.x - origin.x)} ${n(-(p.y - origin.y))}`)
      .join('') + (close ? 'Z' : '');

  const triangulation = useMemo(() => {
    if (!display.triangulation) return '';
    const { points, triangles } = terrain;
    const seen = new Set<number>();
    const parts: string[] = [];
    const edge = (a: number, b: number): void => {
      const key = a < b ? a * points.length + b : b * points.length + a;
      if (seen.has(key)) return;
      seen.add(key);
      const p = points[a];
      const q = points[b];
      if (!p || !q) return;
      parts.push(
        `M${n(p.x - origin.x)} ${n(-(p.y - origin.y))}L${n(q.x - origin.x)} ${n(-(q.y - origin.y))}`,
      );
    };
    for (let i = 0; i + 2 < triangles.length; i += 3) {
      const a = triangles[i] ?? 0;
      const b = triangles[i + 1] ?? 0;
      const c = triangles[i + 2] ?? 0;
      edge(a, b);
      edge(b, c);
      edge(c, a);
    }
    return parts.join('');
  }, [terrain, origin, display.triangulation]);

  // Selecionada, a superfície é realçada pelo contorno da área triangulada (o limite pode não
  // estar definido: sem ele, o contorno é o da própria malha).
  const selected = useEarthworkStore((s) => s.selection?.kind === 'surface');
  const outline = useMemo(
    () => (selected ? terrainFootprintPath(terrain, origin) : ''),
    [selected, terrain, origin],
  );

  const interval = contourIntervalOf(terrain, display.contourInterval);
  const contours = useMemo(() => {
    if (!display.contours) return null;
    const result = terrainContours(terrain, interval);
    if (!result.ok) return null;
    const minor: string[] = [];
    const major: string[] = [];
    const labels: { x: number; y: number; text: string }[] = [];
    for (const contour of result.value) {
      let longest: Point2[] | null = null;
      for (const raw of contour.lines) {
        const line = display.contourSmoothing ? smoothContourLine(raw) : raw;
        (contour.major ? major : minor).push(
          line
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${n(p.x - origin.x)} ${n(-(p.y - origin.y))}`)
            .join(''),
        );
        if (!longest || line.length > longest.length) longest = line;
      }
      const middle = contour.major && longest ? longest[Math.floor(longest.length / 2)] : null;
      if (middle) {
        labels.push({
          x: middle.x,
          y: middle.y,
          text: contour.elevation.toLocaleString('pt-BR', {
            maximumFractionDigits: interval < 1 ? 1 : 0,
          }),
        });
      }
    }
    return { minor: minor.join(''), major: major.join(''), labels, count: result.value.length };
  }, [terrain, origin, display.contours, display.contourSmoothing, interval]);

  return (
    <g
      data-layer-infra="terrain"
      data-testid="infra-terrain"
      data-triangles={terrain.triangles.length / 3}
      data-surface-view={view}
      data-selected={selected}
      pointerEvents="none"
    >
      {display.triangulation && (
        <path
          data-testid="terrain-triangulation"
          d={triangulation}
          fill="none"
          stroke={TERRAIN_INK}
          strokeOpacity={0.6}
          strokeWidth={0.8}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {contours && (
        <g
          data-testid="terrain-contours"
          data-interval={interval}
          data-count={contours.count}
          data-smoothed={display.contourSmoothing}
          fill="none"
          stroke={CONTOUR_INK}
          strokeLinejoin="round"
        >
          <path
            d={contours.minor}
            strokeWidth={0.8}
            strokeOpacity={0.75}
            vectorEffect="non-scaling-stroke"
          />
          <path d={contours.major} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
          {contours.labels.slice(0, 120).map((label, index) => (
            <text
              key={index}
              transform={`translate(${n(label.x - origin.x)} ${n(-(label.y - origin.y))}) scale(${n(mpp)})`}
              fontSize={10}
              fontFamily={FONT}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={CONTOUR_INK}
              stroke="#ffffff"
              strokeWidth={3}
              paintOrder="stroke"
            >
              {label.text}
            </text>
          ))}
        </g>
      )}
      {natural.breaklines.map((line, index) => (
        <path
          key={index}
          data-testid="terrain-breakline"
          d={path(line, false)}
          fill="none"
          stroke={BREAKLINE_INK}
          strokeWidth={1.4}
          strokeDasharray="7 3"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {natural.boundary?.map((ring, index) => (
        <path
          key={index}
          data-testid="terrain-boundary"
          d={path(ring, true)}
          fill="none"
          stroke={TERRAIN_INK}
          strokeWidth={1.8}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {selected && outline && (
        // Realce de seleção: é da tela, não do desenho exportado.
        <path
          data-ui="selection"
          data-testid="terrain-surface-selected"
          d={outline}
          fill={HIGHLIGHT}
          fillOpacity={0.08}
          fillRule="evenodd"
          stroke={HIGHLIGHT}
          strokeWidth={3}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  );
});

interface EditingProps {
  terrain: Terrain | null;
  origin: Point2;
  mpp: number;
  /** Ponto sob o cursor (coordenadas locais). */
  cursor: Point2 | null;
}

/** O que está em edição: área, furos, corte e ponto consultado. Não vai para a exportação. */
export function TerrainEditingLayer({ terrain, origin, mpp, cursor }: EditingProps) {
  const mode = useTerrainStore((s) => s.mode);
  const area = useTerrainStore((s) => s.area);
  const holes = useTerrainStore((s) => s.holes);
  const draft = useTerrainStore((s) => s.draft);
  const profilePath = useTerrainStore((s) => s.profilePath);
  const query = useTerrainStore((s) => s.query);
  const rings = areaRings({ area, holes });
  const X = (x: number): number => x - origin.x;
  const Y = (y: number): number => -(y - origin.y);
  const points = (list: readonly Point2[]): string =>
    list.map((p) => `${n(X(p.x))},${n(Y(p.y))}`).join(' ');
  const hit = query && terrain ? terrainHitAt(terrain, query.x, query.y) : null;
  const text = {
    fontSize: 11,
    fontFamily: FONT,
    stroke: '#ffffff',
    strokeWidth: 3,
    paintOrder: 'stroke',
  } as const;
  const rubber =
    mode && mode !== 'query' && cursor && draft.length > 0 ? [...draft, cursor] : draft;

  return (
    <g data-ui="terrain" pointerEvents="none">
      <EarthworkPlanLayer terrain={terrain} origin={origin} mpp={mpp} />
      {rings && (
        <path
          data-testid="terrain-area"
          data-vertices={rings[0]?.length ?? 0}
          data-holes={rings.length - 1}
          d={rings
            .map(
              (ring) =>
                `${ring.map((p, i) => `${i === 0 ? 'M' : 'L'}${n(X(p.x))} ${n(Y(p.y))}`).join('')}Z`,
            )
            .join('')}
          fill={AREA_INK}
          fillOpacity={0.1}
          fillRule="evenodd"
          stroke={AREA_INK}
          strokeWidth={1.6}
          strokeDasharray="8 4"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {rubber.length > 0 && (
        <>
          <polyline
            data-testid="terrain-draft"
            data-points={draft.length}
            points={points(rubber)}
            fill="none"
            stroke={mode === 'profile' ? HIGHLIGHT : AREA_INK}
            strokeWidth={1.8}
            vectorEffect="non-scaling-stroke"
          />
          {draft.map((p, i) => (
            <circle
              key={i}
              cx={n(X(p.x))}
              cy={n(Y(p.y))}
              r={n((i === 0 ? 5 : 3.5) * mpp)}
              fill={i === 0 ? '#ffffff' : mode === 'profile' ? HIGHLIGHT : AREA_INK}
              stroke={mode === 'profile' ? HIGHLIGHT : AREA_INK}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </>
      )}
      {profilePath && (
        <>
          <polyline
            data-testid="terrain-profile-line"
            points={points(profilePath)}
            fill="none"
            stroke={HIGHLIGHT}
            strokeWidth={2.2}
            strokeDasharray="10 3 2 3"
            vectorEffect="non-scaling-stroke"
          />
          {[profilePath[0], profilePath[profilePath.length - 1]].map((p, i) =>
            p ? (
              <text
                key={i}
                transform={`translate(${n(X(p.x) + 7 * mpp)} ${n(Y(p.y) - 7 * mpp)}) scale(${n(mpp)})`}
                fill={HIGHLIGHT}
                fontWeight={700}
                {...text}
              >
                {i === 0 ? 'A' : 'B'}
              </text>
            ) : null,
          )}
        </>
      )}
      {query && (
        <g data-testid="terrain-query-marker">
          <path
            d={`M${n(X(query.x) - 7 * mpp)} ${n(Y(query.y))}H${n(X(query.x) + 7 * mpp)}M${n(X(query.x))} ${n(Y(query.y) - 7 * mpp)}V${n(Y(query.y) + 7 * mpp)}`}
            stroke={HIGHLIGHT}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          <text
            transform={`translate(${n(X(query.x) + 9 * mpp)} ${n(Y(query.y) - 9 * mpp)}) scale(${n(mpp)})`}
            fill="#0c1118"
            {...text}
          >
            {hit
              ? `${formatMeters(hit.elevation, 2)} · ${(hit.slope * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} %`
              : 'sem dado de terreno'}
          </text>
        </g>
      )}
    </g>
  );
}
