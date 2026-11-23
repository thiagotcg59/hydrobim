import {
  georeferenceStatus,
  terrainStats,
  type GeoTransform,
  type Point2,
  type Terrain,
} from '@hydrobim/core';
import { memo, useCallback, useEffect, useId, useMemo } from 'react';
import { BasemapLayer, type BasemapStatus } from '../infra/BasemapLayer';
import { findBasemapProvider, type BasemapProvider } from '../map/providers';
import type { ViewBounds } from '../map/tiles';
import { useEditorStore } from '../state/editorStore';
import { shownTerrain, useEarthworkStore } from './earthworkStore';
import { rasterizeTerrain, terrainFootprintPath, type TerrainRaster } from './terrainRaster';
import { useTerrainStore } from './terrainStore';

/**
 * Superfície do terreno preenchida na planta, como no modelo 3D: a cor por altitude, por
 * declividade ou lisa, ou o mapa de ruas ou de satélite escolhido para a superfície, com a
 * mesma transparência. É só apresentação — sai da tela, não do projeto — e não vai para a
 * exportação da planta (`data-ui`): o desenho técnico leva o limite e as curvas de nível, e as
 * imagens de mapa têm licença própria.
 */

/** A superfície está à mostra nas plantas deste ambiente? */
export function useTerrainPlanVisible(): boolean {
  const infra = useEditorStore((s) => s.project.discipline === 'infra');
  // No Infra é uma camada do ambiente (gravada no projeto); no MEP e na Arquitetura é opção de
  // exibição da sessão.
  const layer = useEditorStore((s) => s.project.infra.layers.terrain);
  const session = useTerrainStore((s) => s.display.mepPlan);
  return infra ? layer : session;
}

type PlanFillSource =
  /** Cor da superfície; `blocked` diz por que o mapa escolhido não pôde ser usado. */
  | { readonly kind: 'color'; readonly blocked: string | null }
  | {
      readonly kind: 'map';
      readonly provider: BasemapProvider;
      readonly transform: GeoTransform;
    }
  /** O mapa escolhido já é o fundo da Planta Infra: não é pedido de novo. */
  | { readonly kind: 'basemap' };

/**
 * O que preenche a superfície na planta. `basemapSourceId` é a fonte do mapa de fundo que a
 * planta já mostra (Planta Infra), ou `null`.
 */
function usePlanFillSource(basemapSourceId: string | null): PlanFillSource {
  const sourceId = useTerrainStore((s) => s.display.drapeSourceId);
  const customBasemap = useEditorStore((s) => s.customBasemap);
  const georeference = useEditorStore((s) => s.project.georeference);
  return useMemo<PlanFillSource>(() => {
    if (!sourceId) return { kind: 'color', blocked: null };
    const provider = findBasemapProvider(sourceId, customBasemap);
    if (!provider) {
      return {
        kind: 'color',
        blocked: 'A fonte de mapa escolhida não está cadastrada neste navegador.',
      };
    }
    const geo = georeferenceStatus(georeference);
    if (geo.state !== 'ready') {
      return { kind: 'color', blocked: `Mapa sobre o terreno indisponível: ${geo.message}` };
    }
    if (basemapSourceId === provider.id) return { kind: 'basemap' };
    return { kind: 'map', provider, transform: geo.transform };
  }, [sourceId, customBasemap, georeference, basemapSourceId]);
}

function rasterHref(raster: TerrainRaster | null): string | null {
  if (!raster) return null;
  const canvas = document.createElement('canvas');
  canvas.width = raster.width;
  canvas.height = raster.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(raster.width, raster.height);
  image.data.set(raster.data);
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

interface Props {
  /** Superfície do projeto (a natural); a que se desenha é a que está à mostra. */
  terrain: Terrain;
  /** Origem de desenho da planta. */
  origin: Point2;
  /** Metros do modelo por pixel de tela. */
  mpp: number;
  /** Janela visível, em coordenadas locais (m). */
  bounds: ViewBounds;
  /** Fonte do mapa de fundo que a planta já mostra (Planta Infra), ou `null`. */
  basemapSourceId: string | null;
}

export const TerrainPlanFill = memo(function TerrainPlanFill({
  terrain: natural,
  origin,
  mpp,
  bounds,
  basemapSourceId,
}: Props) {
  const enabled = useTerrainStore((s) => s.display.planFill);
  const colorMode = useTerrainStore((s) => s.display.colorMode);
  const opacity = useTerrainStore((s) => s.display.opacity);
  // A mesma superfície do 3D: projetada (com os platôs), natural ou original.
  const view = useEarthworkStore((s) => s.view);
  const project = useEditorStore((s) => s.project);
  const terrain = useMemo(
    () => (project.terrain === natural ? (shownTerrain(project, view) ?? natural) : natural),
    [project, natural, view],
  );
  const source = usePlanFillSource(basemapSourceId);
  const clipId = `terreno-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  const footprint = useMemo(
    () => (enabled ? terrainFootprintPath(terrain, origin) : ''),
    [enabled, terrain, origin],
  );
  const color = enabled && source.kind === 'color';
  const raster = useMemo(
    () => (color ? rasterizeTerrain(terrain, colorMode) : null),
    [color, terrain, colorMode],
  );
  const href = useMemo(() => rasterHref(raster), [raster]);

  // Só os ladrilhos sobre a superfície e dentro da janela.
  const stats = useMemo(() => terrainStats(terrain), [terrain]);
  const tileWindow = {
    minX: Math.max(bounds.minX, stats.minX),
    minY: Math.max(bounds.minY, stats.minY),
    maxX: Math.min(bounds.maxX, stats.maxX),
    maxY: Math.min(bounds.maxY, stats.maxY),
  };
  const inView = tileWindow.maxX > tileWindow.minX && tileWindow.maxY > tileWindow.minY;

  const mapped = enabled && source.kind === 'map';
  const onStatus = useCallback((status: BasemapStatus) => {
    useTerrainStore.setState({ planMap: status.state });
  }, []);
  useEffect(() => {
    if (!mapped) useTerrainStore.setState({ planMap: null });
  }, [mapped]);
  useEffect(() => () => useTerrainStore.setState({ planMap: null }), []);

  if (!enabled || !footprint) return null;
  return (
    <g
      data-ui="terrain-fill"
      data-testid="terrain-plan-fill"
      data-fill={source.kind === 'color' ? colorMode : source.kind}
      data-surface-view={view}
      pointerEvents="none"
    >
      <defs>
        <clipPath id={clipId}>
          <path d={footprint} clipRule="evenodd" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`} opacity={opacity}>
        {source.kind === 'map' && inView && (
          <BasemapLayer
            transform={source.transform}
            provider={source.provider}
            bounds={tileWindow}
            metersPerPixel={mpp}
            origin={origin}
            opacity={1}
            retry={0}
            onStatus={onStatus}
            testId="terrain-plan-map"
          />
        )}
        {source.kind === 'color' && raster && href && (
          <image
            data-testid="terrain-plan-colors"
            href={href}
            x={raster.minX - origin.x}
            y={-(raster.maxY - origin.y)}
            width={raster.maxX - raster.minX}
            height={raster.maxY - raster.minY}
            preserveAspectRatio="none"
          />
        )}
      </g>
    </g>
  );
});

/**
 * Aviso do mapa sobre o terreno na planta: a atribuição exigida pela licença da fonte, sempre
 * que a imagem está à mostra, e o motivo quando ela não pôde ser desenhada.
 */
export function TerrainPlanNotice({ basemapSourceId }: { basemapSourceId: string | null }) {
  const hasTerrain = useEditorStore((s) => s.project.terrain !== null);
  const visible = useTerrainPlanVisible();
  const enabled = useTerrainStore((s) => s.display.planFill);
  const chosen = useTerrainStore((s) => s.display.drapeSourceId !== null);
  const state = useTerrainStore((s) => s.planMap);
  const source = usePlanFillSource(basemapSourceId);
  if (!hasTerrain || !visible || !enabled || !chosen || source.kind === 'basemap') return null;
  if (source.kind === 'color') {
    return source.blocked ? (
      <div
        className="terrain-drape terrain-drape--plan"
        data-testid="terrain-plan-notice"
        data-state="blocked"
      >
        <span>{source.blocked} A superfície segue com a cor escolhida.</span>
      </div>
    ) : null;
  }
  const { provider } = source;
  const message =
    state === 'unavailable'
      ? 'Mapa indisponível: o serviço não respondeu.'
      : state === 'offline'
        ? 'Sem conexão: o mapa sobre o terreno não foi carregado.'
        : state === 'tooWide'
          ? 'Afaste menos a vista: a região é ampla demais para esta fonte de mapa.'
          : state === 'partial'
            ? 'Mapa incompleto: parte das imagens não pôde ser carregada.'
            : '';
  return (
    <div
      className="terrain-drape terrain-drape--plan"
      data-testid="terrain-plan-notice"
      data-state={state ?? 'loading'}
    >
      {message && <span>{message}</span>}
      <span className="terrain-drape__attribution" data-testid="terrain-plan-attribution">
        <a href={provider.attributionUrl} target="_blank" rel="noreferrer noopener">
          {provider.attribution}
        </a>
        {' · '}
        <a href={provider.licenseUrl} target="_blank" rel="noreferrer noopener">
          {provider.license}
        </a>
        {provider.resolution !== null && ` · resolução ≈ ${provider.resolution} m`}
        {' · imagem de referência: as cotas são as da superfície'}
      </span>
    </div>
  );
}
