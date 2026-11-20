import { fail, type Result } from '@hydrobim/core';
import { readGeoTiffDem, type GeoTiffDem } from './geotiff';
import {
  runTerrainJob,
  type TerrainJob,
  type TerrainJobResult,
  type TerrainStage,
  type WorkerRequest,
  type WorkerResponse,
} from './terrainJob';

/**
 * Executa a geração da superfície em um Web Worker: a triangulação de dezenas de milhares de
 * pontos não trava a interface. Sem suporte a workers (ou em teste), roda no próprio fluxo,
 * cedendo a vez à interface antes de começar.
 */
export function executeTerrainJob(
  job: TerrainJob,
  onStage: (stage: TerrainStage) => void,
  signal?: AbortSignal,
): Promise<Result<TerrainJobResult>> {
  const aborted = (): Result<never> => fail('TERRAIN_ABORTED', 'Geração da superfície cancelada.');
  if (signal?.aborted) return Promise.resolve(aborted());
  if (typeof Worker === 'undefined') {
    return new Promise((resolve) => {
      setTimeout(() => resolve(signal?.aborted ? aborted() : runTerrainJob(job, onStage)), 0);
    });
  }
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
    const finish = (result: Result<TerrainJobResult>): void => {
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      resolve(result);
    };
    const onAbort = (): void => finish(aborted());
    signal?.addEventListener('abort', onAbort);
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.type === 'stage') onStage(event.data.stage);
      else if (event.data.type === 'done') finish(event.data.result);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish(
        fail(
          'TERRAIN_WORKER',
          `O processamento da superfície falhou (${event.message || 'erro interno'}).`,
        ),
      );
    };
    worker.postMessage({ job } satisfies WorkerRequest);
  });
}

/** Lê um GeoTIFF fora do fluxo da interface (a descompressão de um raster grande leva segundos). */
export function decodeGeoTiff(buffer: ArrayBuffer): Promise<Result<GeoTiffDem>> {
  if (typeof Worker === 'undefined') return readGeoTiffDem(buffer);
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
    const finish = (result: Result<GeoTiffDem>): void => {
      worker.terminate();
      resolve(result);
    };
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.type === 'tiff') finish(event.data.result);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish(
        fail('GEOTIFF_DECODE', `A leitura do GeoTIFF falhou (${event.message || 'erro interno'}).`),
      );
    };
    worker.postMessage({ tiff: buffer } satisfies WorkerRequest, [buffer]);
  });
}
