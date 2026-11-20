import {
  buildSurveySurface,
  buildTerrainSurface,
  demSurfacePoints,
  fail,
  georeferenceStatus,
  ok,
  rasterFrame,
  type ElevationRaster,
  type Georeference,
  type Point2,
  type RasterCrs,
  type RasterFrame,
  type RasterGeoreference,
  type Result,
  type SurfaceReport,
  type Terrain,
  type TerrainSource,
  type Vec3,
} from '@hydrobim/core';
import type { GeoTiffDem } from './geotiff';

/**
 * Geração da superfície do terreno como um trabalho isolado: recebe dados simples (que podem
 * ser enviados a um Web Worker) e devolve a superfície pronta ou o erro do domínio. Toda a
 * regra está em `@hydrobim/core`; aqui só se encadeiam os passos e se informa o andamento.
 */

export type TerrainJob =
  | {
      readonly kind: 'dem';
      readonly name: string;
      readonly raster: ElevationRaster;
      readonly georeference: RasterGeoreference;
      readonly crs: RasterCrs;
      readonly project: Georeference;
      readonly rings: Point2[][];
      /** Usa um nó do raster a cada `stride`. */
      readonly stride: number;
      /** Procedência; a resolução é preenchida com o espaçamento realmente usado. */
      readonly source: TerrainSource;
    }
  | {
      readonly kind: 'survey';
      readonly name: string;
      readonly points: Vec3[];
      readonly breaklines: Vec3[][];
      readonly rings: Point2[][] | null;
      readonly source: TerrainSource;
    };

export type TerrainStage = 'sampling' | 'triangulating' | 'finishing';

export const STAGE_LABELS: Record<TerrainStage, string> = {
  sampling: 'Lendo as cotas dentro da área…',
  triangulating: 'Triangulando a superfície…',
  finishing: 'Concluindo…',
};

export interface TerrainJobResult {
  readonly terrain: Terrain;
  readonly report: SurfaceReport;
  /** Nós do raster sem dado dentro da área (só em DEM). */
  readonly noDataNodes: number;
}

export function runTerrainJob(
  job: TerrainJob,
  onStage: (stage: TerrainStage) => void = () => undefined,
): Result<TerrainJobResult> {
  if (job.kind === 'survey') {
    onStage('triangulating');
    const built = buildSurveySurface(job);
    if (!built.ok) return built;
    onStage('finishing');
    return ok({ ...built.value, noDataNodes: 0 });
  }
  onStage('sampling');
  const status = georeferenceStatus(job.project);
  const frame = rasterFrame(job.georeference, job.crs, status);
  if (!frame.ok) return frame;
  const dem = demSurfacePoints({
    raster: job.raster,
    frame: frame.value,
    rings: job.rings,
    stride: job.stride,
    heightOffset: job.project.orthogonalHeight,
  });
  if (!dem.ok) return dem;
  onStage('triangulating');
  const built = buildTerrainSurface({
    name: job.name,
    points: dem.value.points,
    boundary: dem.value.boundary,
    breaklines: [],
    source: { ...job.source, resolution: Number(dem.value.spacing.toFixed(3)) },
    // Nós colados ao limite formariam triângulos-agulha: ficam os do limite.
    clearance: dem.value.spacing * 0.2,
    keepTriangle: dem.value.hasData,
  });
  if (!built.ok) return built;
  onStage('finishing');
  return ok({ ...built.value, noDataNodes: dem.value.noDataNodes });
}

/**
 * Recorta o raster à janela da área (com dois nós de folga): só essa parte segue para o
 * processamento, em vez do arquivo inteiro.
 */
export function cropRaster(
  raster: ElevationRaster,
  georeference: RasterGeoreference,
  frame: RasterFrame,
  outer: readonly Point2[],
): Result<{ raster: ElevationRaster; georeference: RasterGeoreference }> {
  let minCol = Infinity;
  let minRow = Infinity;
  let maxCol = -Infinity;
  let maxRow = -Infinity;
  for (const p of outer) {
    const node = frame.fromLocal(p.x, p.y);
    minCol = Math.min(minCol, node.col);
    maxCol = Math.max(maxCol, node.col);
    minRow = Math.min(minRow, node.row);
    maxRow = Math.max(maxRow, node.row);
  }
  const c0 = Math.max(0, Math.floor(minCol) - 2);
  const c1 = Math.min(raster.width - 1, Math.ceil(maxCol) + 2);
  const r0 = Math.max(0, Math.floor(minRow) - 2);
  const r1 = Math.min(raster.height - 1, Math.ceil(maxRow) + 2);
  if (c1 < c0 || r1 < r0) {
    return fail('DEM_OUTSIDE', 'A área escolhida fica fora da cobertura dos dados de elevação.');
  }
  const width = c1 - c0 + 1;
  const height = r1 - r0 + 1;
  const data = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) {
    const start = (r0 + row) * raster.width + c0;
    data.set(raster.data.subarray(start, start + width), row * width);
  }
  return ok({
    raster: { width, height, data },
    georeference: {
      ...georeference,
      originX: georeference.originX + c0 * georeference.stepX,
      originY: georeference.originY + r0 * georeference.stepY,
    },
  });
}

/** Mensagens trocadas com o Web Worker (`terrainWorker.ts`). */
export type WorkerRequest = { readonly job: TerrainJob } | { readonly tiff: ArrayBuffer };
export type WorkerResponse =
  | { readonly type: 'stage'; readonly stage: TerrainStage }
  | { readonly type: 'done'; readonly result: Result<TerrainJobResult> }
  | { readonly type: 'tiff'; readonly result: Result<GeoTiffDem> };
