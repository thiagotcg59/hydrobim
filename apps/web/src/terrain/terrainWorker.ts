import { readGeoTiffDem } from './geotiff';
import { runTerrainJob, type WorkerRequest, type WorkerResponse } from './terrainJob';

/**
 * Web Worker do terreno: lê GeoTIFF e gera a superfície fora do fluxo da interface, informando
 * as etapas. O raster lido volta por transferência (sem cópia).
 */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
};

scope.onmessage = (event) => {
  const request = event.data;
  if ('tiff' in request) {
    void readGeoTiffDem(request.tiff).then((result) => {
      scope.postMessage(
        { type: 'tiff', result },
        result.ok ? [result.value.raster.data.buffer as ArrayBuffer] : [],
      );
    });
    return;
  }
  const result = runTerrainJob(request.job, (stage) => scope.postMessage({ type: 'stage', stage }));
  scope.postMessage({ type: 'done', result });
};
