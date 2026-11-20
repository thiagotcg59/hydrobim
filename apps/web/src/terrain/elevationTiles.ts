import {
  fail,
  geographicToTile,
  ok,
  polygonArea,
  tileGroundResolution,
  type ElevationRaster,
  type GeoTransform,
  type Point2,
  type RasterGeoreference,
  type Result,
} from '@hydrobim/core';
import {
  decodeElevation,
  elevationTileUrl,
  type ElevationCredentials,
  type ElevationTileProvider,
} from './elevationProviders';

/**
 * Busca de elevação em ladrilhos para a área escolhida: quais ladrilhos pedir em cada nível,
 * download com progresso e cancelamento, decodificação e montagem de um raster único em Web
 * Mercator. Os ladrilhos já decodificados ficam em memória durante a sessão, para que trocar a
 * resolução ou ajustar a área não refaça os pedidos; nada é gravado em disco nem
 * pré-carregado.
 */

/** Limite de ladrilhos por busca: só a área do polígono, nunca download em massa. */
export const MAX_ELEVATION_TILES = 36;

const WORLD = 2 * Math.PI * 6378137;

export interface TileWindow {
  readonly zoom: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly tiles: number;
}

/** Ladrilhos do nível `zoom` que cobrem o contorno, com um pixel de folga. */
export function tileWindowFor(
  transform: GeoTransform,
  outer: readonly Point2[],
  zoom: number,
  tileSize: number,
): TileWindow {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of outer) {
    const tile = geographicToTile(transform.localToGeographic(p), zoom);
    minX = Math.min(minX, tile.x);
    maxX = Math.max(maxX, tile.x);
    minY = Math.min(minY, tile.y);
    maxY = Math.max(maxY, tile.y);
  }
  // A interpolação bilinear no limite precisa do nó vizinho: um pixel e meio de folga.
  const margin = 1.5 / tileSize;
  const last = 2 ** zoom - 1;
  const clamp = (value: number): number => Math.min(last, Math.max(0, Math.floor(value)));
  const window = {
    zoom,
    minX: clamp(minX - margin),
    maxX: clamp(maxX + margin),
    minY: clamp(minY - margin),
    maxY: clamp(maxY + margin),
  };
  return {
    ...window,
    tiles: (window.maxX - window.minX + 1) * (window.maxY - window.minY + 1),
  };
}

export interface ZoomOption {
  readonly zoom: number;
  /** Tamanho do pixel do ladrilho no terreno (m) — resolução do raster, não exatidão. */
  readonly resolution: number;
  readonly tiles: number;
  /** Estimativa de amostras dentro da área. */
  readonly samples: number;
  /** Acima da resolução nominal do dado de origem (`null` = a fonte não informa). */
  readonly oversampled: boolean | null;
  /** Motivo pelo qual o nível não pode ser usado nesta área; `null` = disponível. */
  readonly blocked: string | null;
}

/** Resoluções disponíveis para a área, da mais fina para a mais grossa. */
export function zoomOptions(
  provider: ElevationTileProvider,
  transform: GeoTransform,
  rings: readonly (readonly Point2[])[],
  maxVertices: number,
): ZoomOption[] {
  const outer = rings[0];
  if (!outer || outer.length < 3) return [];
  const center = transform.localToGeographic({
    x: outer.reduce((sum, p) => sum + p.x, 0) / outer.length,
    y: outer.reduce((sum, p) => sum + p.y, 0) / outer.length,
  });
  const area = polygonArea(rings);
  const options: ZoomOption[] = [];
  for (let zoom = provider.maxZoom; zoom >= provider.minZoom; zoom -= 1) {
    const resolution = tileGroundResolution(center.lat, zoom, provider.tileSize);
    const { tiles } = tileWindowFor(transform, outer, zoom, provider.tileSize);
    const samples = Math.round(area / (resolution * resolution));
    options.push({
      zoom,
      resolution,
      tiles,
      samples,
      oversampled: provider.nativeZoom === null ? null : zoom > provider.nativeZoom,
      blocked:
        samples > maxVertices
          ? `cerca de ${samples.toLocaleString('pt-BR')} amostras; o limite é ${maxVertices.toLocaleString('pt-BR')}`
          : tiles > MAX_ELEVATION_TILES
            ? `${tiles} ladrilhos; o limite por busca é ${MAX_ELEVATION_TILES}`
            : samples < 4
              ? 'a área é menor que duas células desta resolução'
              : null,
    });
  }
  return options;
}

/** Nível sugerido: o mais fino disponível que não passa da resolução nominal da fonte. */
export function defaultZoom(
  provider: ElevationTileProvider,
  options: readonly ZoomOption[],
): number | null {
  const native = provider.nativeZoom ?? 12;
  const usable = options.filter((option) => option.blocked === null);
  return (
    (usable.find((option) => option.zoom <= native) ?? usable[usable.length - 1])?.zoom ?? null
  );
}

// ---------------------------------------------------------------------------
// Download, decodificação e mosaico
// ---------------------------------------------------------------------------

/** Pixels RGBA de um ladrilho. */
export type TileDecoder = (blob: Blob, tileSize: number) => Promise<Uint8ClampedArray>;

/**
 * Decodifica o PNG sem conversão de cores nem alfa pré-multiplicado: os bytes R, G e B são o
 * dado de elevação e não podem ser alterados pelo navegador.
 */
export const decodeTileImage: TileDecoder = async (blob, tileSize) => {
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  try {
    if (bitmap.width !== tileSize || bitmap.height !== tileSize) {
      throw new Error(`ladrilho de ${bitmap.width} × ${bitmap.height} px (esperado ${tileSize})`);
    }
    const canvas = new OffscreenCanvas(tileSize, tileSize);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('o navegador não permite ler os pixels da imagem');
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, tileSize, tileSize).data;
  } finally {
    bitmap.close();
  }
};

/** Ladrilhos decodificados nesta sessão (os mais antigos saem primeiro). */
const CACHE_LIMIT = 96;
const cache = new Map<string, Float32Array>();

export function clearElevationCache(): void {
  cache.clear();
}

export interface ElevationFetchOptions {
  readonly provider: ElevationTileProvider;
  readonly credentials: ElevationCredentials | null;
  readonly window: TileWindow;
  readonly signal?: AbortSignal;
  readonly onProgress?: (done: number, total: number) => void;
  readonly fetcher?: typeof fetch;
  readonly decoder?: TileDecoder;
}

export interface FetchedElevation {
  readonly raster: ElevationRaster;
  /** Posição dos nós em Web Mercator (EPSG:3857), em metros. */
  readonly georeference: RasterGeoreference;
  readonly fromCache: number;
  readonly requested: number;
}

function httpMessage(provider: ElevationTileProvider, status: number): string {
  if (status === 401 || (status === 403 && provider.requiresToken)) {
    return 'O serviço recusou a chave de acesso. Confira a chave e as permissões da conta.';
  }
  if (status === 404 || status === 403) {
    return 'O serviço não tem ladrilhos de elevação para esta área neste nível.';
  }
  if (status === 429) return 'O serviço limitou as requisições. Aguarde e tente de novo.';
  return `O serviço de elevação respondeu com erro (HTTP ${status}).`;
}

/**
 * Busca e monta o raster de elevação da janela de ladrilhos. Falha por inteiro se algum
 * ladrilho faltar: uma superfície com parte dos dados seria apresentada como completa.
 */
export async function fetchElevationRaster(
  options: ElevationFetchOptions,
): Promise<Result<FetchedElevation>> {
  const { provider, credentials, window: win, signal, onProgress } = options;
  const fetcher = options.fetcher ?? fetch;
  const decoder = options.decoder ?? decodeTileImage;
  if (provider.requiresToken && !credentials) {
    return fail('ELEVATION_TOKEN', 'Esta fonte exige a chave de acesso da sua conta.');
  }
  if (win.tiles > MAX_ELEVATION_TILES) {
    return fail(
      'ELEVATION_TOO_MANY_TILES',
      `A área pede ${win.tiles} ladrilhos nesta resolução; o limite é ${MAX_ELEVATION_TILES}. Use uma resolução mais grossa ou uma área menor.`,
    );
  }
  const size = provider.tileSize;
  const cols = win.maxX - win.minX + 1;
  const rows = win.maxY - win.minY + 1;
  const width = cols * size;
  const height = rows * size;
  const data = new Float32Array(width * height);
  const jobs: { x: number; y: number }[] = [];
  for (let y = win.minY; y <= win.maxY; y += 1) {
    for (let x = win.minX; x <= win.maxX; x += 1) jobs.push({ x, y });
  }
  // A chave do usuário não entra no identificador do cache.
  const keyOf = (x: number, y: number): string =>
    `${provider.id}/${credentials?.tileset ?? ''}/${win.zoom}/${x}/${y}`;
  let done = 0;
  let fromCache = 0;
  let failure: Result<never> | null = null;
  onProgress?.(0, jobs.length);

  const load = async (x: number, y: number): Promise<Float32Array | null> => {
    const key = keyOf(x, y);
    const cached = cache.get(key);
    if (cached) {
      fromCache += 1;
      // Reinsere: o mais recentemente usado fica por último.
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }
    let response: Response;
    try {
      response = await fetcher(elevationTileUrl(provider, win.zoom, x, y, credentials), {
        signal,
        mode: 'cors',
        credentials: 'omit',
      });
    } catch (error) {
      failure = signal?.aborted
        ? fail('ELEVATION_ABORTED', 'Busca de elevação cancelada.')
        : fail(
            'ELEVATION_NETWORK',
            `Não foi possível falar com o serviço de elevação (${globalThis.navigator?.onLine === false ? 'sem conexão' : 'falha de rede'}). Nenhuma cota foi criada.`,
          );
      void error;
      return null;
    }
    if (!response.ok) {
      failure = fail('ELEVATION_HTTP', httpMessage(provider, response.status));
      return null;
    }
    try {
      const rgba = await decoder(await response.blob(), size);
      const tile = new Float32Array(size * size);
      for (let i = 0; i < tile.length; i += 1) {
        tile[i] = decodeElevation(
          provider.encoding,
          rgba[4 * i] as number,
          rgba[4 * i + 1] as number,
          rgba[4 * i + 2] as number,
        );
      }
      cache.set(key, tile);
      if (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      return tile;
    } catch (error) {
      failure = fail(
        'ELEVATION_DECODE',
        `O ladrilho de elevação não pôde ser lido (${error instanceof Error ? error.message : 'formato inesperado'}).`,
      );
      return null;
    }
  };

  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length && !failure) {
      const job = jobs[next] as { x: number; y: number };
      next += 1;
      const tile = await load(job.x, job.y);
      if (!tile) return;
      const baseCol = (job.x - win.minX) * size;
      const baseRow = (job.y - win.minY) * size;
      for (let row = 0; row < size; row += 1) {
        data.set(tile.subarray(row * size, (row + 1) * size), (baseRow + row) * width + baseCol);
      }
      done += 1;
      onProgress?.(done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, worker));
  if (failure) return failure;

  const pixel = WORLD / (size * 2 ** win.zoom);
  return ok({
    raster: { width, height, data },
    georeference: {
      originX: -WORLD / 2 + (win.minX * size + 0.5) * pixel,
      originY: WORLD / 2 - (win.minY * size + 0.5) * pixel,
      stepX: pixel,
      stepY: -pixel,
    },
    fromCache,
    requested: jobs.length - fromCache,
  });
}
