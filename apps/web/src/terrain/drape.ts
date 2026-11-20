import { geographicToTile, type GeoTransform, type TerrainStats } from '@hydrobim/core';
import type { BasemapProvider } from '../map/providers';
import { tilesForView, type PlacedTile } from '../map/tiles';

/**
 * Mapa sobre o terreno no modelo 3D: quais ladrilhos do mapa de fundo cobrem a superfície e
 * em que ponto da imagem cada vértice cai. A imagem é só referência espacial para o usuário se
 * localizar — nenhuma cota vem dela, e o relevo continua sendo o da superfície.
 *
 * Os ladrilhos formam um mosaico retangular em Web Mercator; a posição de cada vértice no
 * mosaico é calculada pela cadeia de referenciais do projeto (local → geográfico → ladrilho),
 * a mesma que posiciona o mapa na Planta Infra.
 */

/** Limite de ladrilhos do mosaico: só a área da superfície, sem download em massa. */
export const MAX_DRAPE_TILES = 36;

/** Largura-alvo do mosaico, em pixels: define o nível de zoom pedido. */
const TARGET_PIXELS = 2048;

export interface DrapeMosaic {
  readonly zoom: number;
  /** Primeiro ladrilho (coluna e linha) e quantidade em cada direção. */
  readonly minX: number;
  readonly minY: number;
  readonly cols: number;
  readonly rows: number;
  readonly tiles: readonly PlacedTile[];
  /** A superfície pede mais detalhe do que a fonte tem: a imagem aparece ampliada. */
  readonly overzoom: boolean;
}

/** Mosaico de ladrilhos que cobre a superfície; `null` quando ela é ampla demais para a fonte. */
export function drapeMosaic(
  transform: GeoTransform,
  provider: BasemapProvider,
  stats: Pick<TerrainStats, 'minX' | 'minY' | 'maxX' | 'maxY'>,
): DrapeMosaic | null {
  const span = Math.max(stats.maxX - stats.minX, stats.maxY - stats.minY);
  if (!(span > 0)) return null;
  const set = tilesForView(transform, provider, stats, span / TARGET_PIXELS, MAX_DRAPE_TILES);
  if (set.tooWide || set.tiles.length === 0) return null;
  const minX = Math.min(...set.tiles.map((tile) => tile.x));
  const maxX = Math.max(...set.tiles.map((tile) => tile.x));
  const minY = Math.min(...set.tiles.map((tile) => tile.y));
  const maxY = Math.max(...set.tiles.map((tile) => tile.y));
  return {
    zoom: set.zoom,
    minX,
    minY,
    cols: maxX - minX + 1,
    rows: maxY - minY + 1,
    tiles: set.tiles,
    overzoom: set.overzoom,
  };
}

/**
 * Coordenadas de textura (u para leste, v para norte, de 0 a 1 no mosaico) dos vértices da
 * malha. `positions` são as posições relativas a `base`, três valores por vértice.
 */
export function drapeUvs(
  transform: GeoTransform,
  mosaic: DrapeMosaic,
  positions: Float32Array,
  base: { readonly x: number; readonly y: number },
): Float32Array {
  const uvs = new Float32Array((positions.length / 3) * 2);
  for (let i = 0, k = 0; i < positions.length; i += 3, k += 2) {
    const tile = geographicToTile(
      transform.localToGeographic({
        x: (positions[i] as number) + base.x,
        y: (positions[i + 1] as number) + base.y,
      }),
      mosaic.zoom,
    );
    uvs[k] = (tile.x - mosaic.minX) / mosaic.cols;
    // A linha do ladrilho cresce para o sul; a textura tem a origem embaixo.
    uvs[k + 1] = 1 - (tile.y - mosaic.minY) / mosaic.rows;
  }
  return uvs;
}

export type DrapeState = 'loading' | 'ready' | 'partial' | 'unavailable';

/**
 * Carrega os ladrilhos e os compõe em uma única imagem. Os ladrilhos precisam vir com
 * permissão de uso entre origens (CORS): sem ela o navegador não deixa levá-los à placa de
 * vídeo. Ladrilho que falha fica em branco no mosaico e o estado passa a `partial`.
 */
export async function loadDrapeCanvas(
  mosaic: DrapeMosaic,
  tileSize: number,
  signal: AbortSignal,
): Promise<{ canvas: HTMLCanvasElement; state: DrapeState } | null> {
  const canvas = document.createElement('canvas');
  canvas.width = mosaic.cols * tileSize;
  canvas.height = mosaic.rows * tileSize;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#e9ecef';
  context.fillRect(0, 0, canvas.width, canvas.height);
  let loaded = 0;
  await Promise.all(
    mosaic.tiles.map(
      (tile) =>
        new Promise<void>((resolve) => {
          const image = new Image();
          image.crossOrigin = 'anonymous';
          image.onload = () => {
            if (!signal.aborted) {
              context.drawImage(
                image,
                (tile.x - mosaic.minX) * tileSize,
                (tile.y - mosaic.minY) * tileSize,
                tileSize,
                tileSize,
              );
              loaded += 1;
            }
            resolve();
          };
          image.onerror = () => resolve();
          signal.addEventListener('abort', () => {
            image.src = '';
            resolve();
          });
          image.src = tile.url;
        }),
    ),
  );
  if (signal.aborted) return null;
  return {
    canvas,
    state: loaded === mosaic.tiles.length ? 'ready' : loaded > 0 ? 'partial' : 'unavailable',
  };
}
