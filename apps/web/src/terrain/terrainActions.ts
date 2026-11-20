import {
  georeferenceStatus,
  MAX_TERRAIN_VERTICES,
  parseBreaklines,
  parseGeoJsonPolygons,
  parseTerrainPoints,
  polygonToGeoJson,
  rasterFrame,
  rasterSpacingAt,
  surveySource,
  terrainStats,
  validatePolygon,
  type Point2,
  type Result,
  type Terrain,
  type TerrainSource,
  type Vec3,
} from '@hydrobim/core';
import { create } from 'zustand';
import { downloadText, projectFileBase, readFileAsText } from '../persistence/fileIO';
import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import {
  findElevationProvider,
  loadCredentials,
  type ElevationCredentials,
} from './elevationProviders';
import { fetchElevationRaster, tileWindowFor } from './elevationTiles';
import type { GeoTiffDem } from './geotiff';
import { cropRaster, STAGE_LABELS, type TerrainJob, type TerrainJobResult } from './terrainJob';
import { decodeGeoTiff, executeTerrainJob } from './terrainRunner';
import { areaRings, useTerrainStore } from './terrainStore';

/**
 * Casos de uso do terreno: da fonte de elevação à superfície no projeto. Cada um informa o
 * andamento, pode ser cancelado e termina de dois modos só — a superfície gravada no projeto
 * (com a procedência) ou uma mensagem de erro. Nunca fica uma superfície parcial.
 */

const editor = () => useEditorStore.getState();
const terrain = () => useTerrainStore.getState();

/** Dados carregados de arquivo, à espera da geração (ficam na memória desta sessão). */
interface LoadedData {
  geotiff: { name: string; dem: GeoTiffDem } | null;
  surveyPoints: { name: string; points: Vec3[] } | null;
  surveyBreaklines: { name: string; lines: Vec3[][] } | null;
  credentials: ElevationCredentials | null;
}

export const useTerrainData = create<LoadedData>()(() => ({
  geotiff: null,
  surveyPoints: null,
  surveyBreaklines: null,
  credentials: loadCredentials(),
}));

let controller: AbortController | null = null;

export function cancelTerrainJob(): void {
  controller?.abort();
}

const fileBase = (name: string): string => name.replace(/\.[^.]+$/, '');

function fail(message: string): false {
  terrain().setJob({ status: 'error', message });
  editor().notify('error', message);
  return false;
}

/** Ressalvas que acompanham a superfície gerada. */
function warningsOf(result: TerrainJobResult, extra: readonly string[]): string[] {
  const { report, noDataNodes } = result;
  const { source } = result.terrain;
  const project = editor().project.georeference;
  const warnings = [...extra];
  if (noDataNodes > 0 || report.trianglesWithoutData > 0) {
    warnings.push(
      `A fonte não tem dado em ${noDataNodes.toLocaleString('pt-BR')} amostras da área: a superfície fica aberta nessas regiões (nada foi interpolado).`,
    );
  }
  if (report.outside > 0 && source.kind === 'survey') {
    warnings.push(`${report.outside.toLocaleString('pt-BR')} pontos fora da área foram ignorados.`);
  }
  if (report.duplicates > 0) {
    warnings.push(
      `${report.duplicates.toLocaleString('pt-BR')} pontos coincidentes em planta foram fundidos (vale a cota do primeiro).`,
    );
  }
  if (report.breaklineSegmentsDropped > 0) {
    warnings.push(
      `${report.breaklineSegmentsDropped} trechos de linhas de quebra fora da área foram descartados.`,
    );
  }
  if (source.verticalDatum === null) {
    warnings.push(
      project?.verticalDatum
        ? `A fonte não declara referência altimétrica: as cotas entraram como estão, sem conversão para ${project.verticalDatum}.`
        : 'A fonte não declara referência altimétrica.',
    );
  } else if (project?.verticalDatum && project.verticalDatum !== source.verticalDatum) {
    warnings.push(
      `Referência altimétrica da fonte (${source.verticalDatum}) diferente da do projeto (${project.verticalDatum}): nenhuma conversão foi aplicada.`,
    );
  }
  if (source.kind === 'dem') {
    warnings.push(
      source.verticalAccuracy === null
        ? 'Resolução do raster não é exatidão: a fonte não declara a exatidão altimétrica.'
        : `Exatidão altimétrica declarada pela fonte: ${source.verticalAccuracy} m.`,
    );
  }
  return warnings;
}

async function run(job: TerrainJob, extraWarnings: readonly string[] = []): Promise<boolean> {
  const result = await executeTerrainJob(
    job,
    (stage) => terrain().setJob({ status: 'running', label: STAGE_LABELS[stage], progress: null }),
    controller?.signal,
  );
  if (!result.ok) return fail(result.error.message);
  const surface = result.value.terrain;
  const stats = terrainStats(surface);
  editor().setTerrain(surface);
  terrain().setJob({
    status: 'done',
    message: `Superfície "${surface.name}": ${stats.vertexCount.toLocaleString('pt-BR')} vértices e ${stats.triangleCount.toLocaleString('pt-BR')} triângulos.`,
    warnings: warningsOf(result.value, extraWarnings),
  });
  return true;
}

function start(label: string): AbortSignal {
  controller?.abort();
  controller = new AbortController();
  terrain().setJob({ status: 'running', label, progress: null });
  return controller.signal;
}

/** Área validada, ou a mensagem de por que não há área utilizável. */
function requireArea(): Point2[][] | null {
  const rings = areaRings(terrain());
  if (!rings) {
    fail(
      'Defina a área do terreno antes de gerar a superfície (desenhe o contorno ou importe um GeoJSON).',
    );
    return null;
  }
  const checked = validatePolygon(rings);
  if (!checked.ok) {
    fail(checked.error.message);
    return null;
  }
  return checked.value;
}

// ---------------------------------------------------------------------------
// DEM em ladrilhos
// ---------------------------------------------------------------------------

export async function generateFromTiles(providerId: string, zoom: number): Promise<boolean> {
  const provider = findElevationProvider(providerId);
  if (!provider) return fail('Fonte de elevação desconhecida.');
  const rings = requireArea();
  if (!rings) return false;
  const { project } = editor();
  const status = georeferenceStatus(project.georeference);
  if (status.state !== 'ready' || !project.georeference) {
    return fail(
      `O projeto precisa estar georreferenciado para buscar elevação: sem isso não há como saber onde a área fica. ${status.message}`,
    );
  }
  const credentials = provider.requiresToken ? useTerrainData.getState().credentials : null;
  if (provider.requiresToken && !credentials) {
    return fail('Informe a chave de acesso da sua conta para usar esta fonte.');
  }
  const signal = start('Buscando os dados de elevação…');
  const outer = rings[0] as Point2[];
  const fetched = await fetchElevationRaster({
    provider,
    credentials,
    window: tileWindowFor(status.transform, outer, zoom, provider.tileSize),
    signal,
    onProgress: (done, total) =>
      terrain().setJob({
        status: 'running',
        label: `Buscando os dados de elevação… ${done} de ${total} ladrilhos`,
        progress: total > 0 ? done / total : null,
      }),
  });
  if (!fetched.ok) return fail(fetched.error.message);
  const frame = rasterFrame(fetched.value.georeference, { kind: 'webMercator' }, status);
  if (!frame.ok) return fail(frame.error.message);
  const cropped = cropRaster(fetched.value.raster, fetched.value.georeference, frame.value, outer);
  if (!cropped.ok) return fail(cropped.error.message);
  const oversampled = provider.nativeZoom !== null && zoom > provider.nativeZoom;
  const source: TerrainSource = {
    kind: 'dem',
    provider: provider.name,
    dataset: `${credentials?.tileset ?? provider.id} — nível ${zoom}`,
    horizontalCrs: 'EPSG:3857',
    verticalDatum: provider.verticalDatum,
    resolution: null,
    verticalAccuracy: provider.verticalAccuracy,
    acquiredAt: new Date().toISOString(),
    attribution: provider.attribution,
    notes: oversampled
      ? `${provider.notes} Nível ${zoom} acima da resolução nominal do dado de origem: os valores são sobreamostrados pelo serviço e não acrescentam detalhe real.`
      : provider.notes,
  };
  return run(
    {
      kind: 'dem',
      name: `Terreno — ${provider.name.split('(')[0]?.trim() ?? provider.name}`,
      ...cropped.value,
      crs: { kind: 'webMercator' },
      project: project.georeference,
      rings,
      stride: 1,
      source,
    },
    [
      ...(oversampled
        ? [
            'Resolução acima da nominal do dado de origem: o serviço entrega valores sobreamostrados, sem detalhe real adicional.',
          ]
        : []),
      ...(fetched.value.fromCache > 0
        ? [`${fetched.value.fromCache} ladrilhos vieram do cache desta sessão.`]
        : []),
    ],
  );
}

// ---------------------------------------------------------------------------
// GeoTIFF
// ---------------------------------------------------------------------------

export async function loadGeoTiff(file: File): Promise<boolean> {
  start(`Lendo ${file.name}…`);
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    return fail('Não foi possível ler o arquivo selecionado.');
  }
  const dem = await decodeGeoTiff(buffer);
  if (!dem.ok) return fail(`${file.name}: ${dem.error.message}`);
  useTerrainData.setState({ geotiff: { name: file.name, dem: dem.value } });
  terrain().setJob({ status: 'idle' });
  editor().notify(
    'success',
    `${file.name}: raster de ${dem.value.raster.width} × ${dem.value.raster.height} células lido.`,
  );
  return true;
}

/** Espaçamento (m) e número estimado de amostras do GeoTIFF dentro da área, por `stride`. */
export function geoTiffSampling(
  dem: GeoTiffDem,
  rings: Point2[][],
): Result<{ spacing: number; samples: number; suggestedStride: number }> {
  const status = georeferenceStatus(editor().project.georeference);
  const frame = rasterFrame(dem.georeference, dem.crs, status);
  if (!frame.ok) return frame;
  const outer = rings[0] as Point2[];
  const cx = outer.reduce((sum, p) => sum + p.x, 0) / outer.length;
  const cy = outer.reduce((sum, p) => sum + p.y, 0) / outer.length;
  const node = frame.value.fromLocal(cx, cy);
  const spacing = rasterSpacingAt(frame.value, node.col, node.row);
  let area = 0;
  for (let i = 0; i < rings.length; i += 1) {
    const ring = rings[i] as Point2[];
    let sum = 0;
    for (let k = 0; k < ring.length; k += 1) {
      const p = ring[k] as Point2;
      const q = ring[(k + 1) % ring.length] as Point2;
      sum += p.x * q.y - q.x * p.y;
    }
    area += (i === 0 ? 1 : -1) * Math.abs(sum / 2);
  }
  const samples = Math.round(area / (spacing * spacing));
  return {
    ok: true,
    value: {
      spacing,
      samples,
      suggestedStride: Math.max(1, Math.ceil(Math.sqrt(samples / (MAX_TERRAIN_VERTICES * 0.9)))),
    },
  };
}

export async function generateFromGeoTiff(stride: number): Promise<boolean> {
  const loaded = useTerrainData.getState().geotiff;
  if (!loaded) return fail('Escolha primeiro o arquivo GeoTIFF.');
  const rings = requireArea();
  if (!rings) return false;
  const { project } = editor();
  const status = georeferenceStatus(project.georeference);
  const frame = rasterFrame(loaded.dem.georeference, loaded.dem.crs, status);
  if (!frame.ok || !project.georeference) {
    return fail(frame.ok ? 'O projeto precisa estar georreferenciado.' : frame.error.message);
  }
  start('Recortando o raster pela área…');
  const cropped = cropRaster(
    loaded.dem.raster,
    loaded.dem.georeference,
    frame.value,
    rings[0] as Point2[],
  );
  if (!cropped.ok) return fail(cropped.error.message);
  const source: TerrainSource = {
    kind: 'dem',
    provider: 'GeoTIFF',
    dataset: loaded.name,
    horizontalCrs: `EPSG:${loaded.dem.epsg}`,
    verticalDatum: loaded.dem.verticalDatum,
    resolution: null,
    verticalAccuracy: null,
    acquiredAt: new Date().toISOString(),
    attribution: null,
    notes:
      stride > 1
        ? `Usada uma amostra a cada ${stride} do raster (as demais não foram usadas; nenhuma foi interpolada).`
        : null,
  };
  return run({
    kind: 'dem',
    name: fileBase(loaded.name),
    ...cropped.value,
    crs: loaded.dem.crs,
    project: project.georeference,
    rings,
    stride,
    source,
  });
}

// ---------------------------------------------------------------------------
// Levantamento topográfico (pontos XYZ e linhas de quebra)
// ---------------------------------------------------------------------------

export async function loadSurveyPoints(file: File): Promise<boolean> {
  let text: string;
  try {
    text = await readFileAsText(file);
  } catch {
    return fail('Não foi possível ler o arquivo selecionado.');
  }
  const points = parseTerrainPoints(text);
  if (!points.ok) return fail(`${file.name}: ${points.error.message}`);
  useTerrainData.setState({ surveyPoints: { name: file.name, points: points.value } });
  terrain().setJob({ status: 'idle' });
  return true;
}

export async function loadSurveyBreaklines(file: File): Promise<boolean> {
  let text: string;
  try {
    text = await readFileAsText(file);
  } catch {
    return fail('Não foi possível ler o arquivo selecionado.');
  }
  const lines = parseBreaklines(text);
  if (!lines.ok) return fail(`${file.name}: ${lines.error.message}`);
  useTerrainData.setState({ surveyBreaklines: { name: file.name, lines: lines.value } });
  terrain().setJob({ status: 'idle' });
  return true;
}

export interface SurveyOptions {
  /** `projected` = arquivo em E, N e altitude do sistema do projeto; `local` = X, Y, Z locais. */
  readonly coordinates: 'local' | 'projected';
  /** Recorta o levantamento pela área desenhada. */
  readonly clip: boolean;
  /** Exatidão altimétrica informada pelo responsável pelo levantamento (m). */
  readonly verticalAccuracy: number | null;
}

export async function generateFromSurvey(options: SurveyOptions): Promise<boolean> {
  const { surveyPoints, surveyBreaklines } = useTerrainData.getState();
  if (!surveyPoints) return fail('Escolha primeiro o arquivo de pontos do levantamento.');
  const { project } = editor();
  let toLocal = (p: Vec3): Vec3 => p;
  let horizontalCrs: string | null = null;
  if (options.coordinates === 'projected') {
    const status = georeferenceStatus(project.georeference);
    const geo = project.georeference;
    if (status.state !== 'ready' || !geo) {
      return fail(
        `Para ler coordenadas E/N o projeto precisa estar georreferenciado. ${status.message}`,
      );
    }
    horizontalCrs = `EPSG:${status.crs.epsg}`;
    toLocal = (p) => {
      const local = status.transform.projectedToLocal({ e: p.x, n: p.y });
      return { x: local.x, y: local.y, z: p.z - geo.orthogonalHeight };
    };
  }
  let rings: Point2[][] | null = null;
  if (options.clip) {
    rings = requireArea();
    if (!rings) return false;
  }
  start('Triangulando o levantamento…');
  const source: TerrainSource = {
    ...surveySource(
      surveyBreaklines ? `${surveyPoints.name} + ${surveyBreaklines.name}` : surveyPoints.name,
      new Date().toISOString(),
    ),
    provider: surveyBreaklines ? 'Pontos XYZ e linhas de quebra' : 'Pontos XYZ',
    horizontalCrs,
    // O levantamento vem no referencial do projeto: vale a referência altimétrica dele.
    verticalDatum: project.georeference?.verticalDatum ?? null,
    verticalAccuracy: options.verticalAccuracy,
  };
  return run({
    kind: 'survey',
    name: fileBase(surveyPoints.name),
    points: surveyPoints.points.map(toLocal),
    breaklines: (surveyBreaklines?.lines ?? []).map((line) => line.map(toLocal)),
    rings,
    source,
  });
}

// ---------------------------------------------------------------------------
// Área de recorte: GeoJSON e limite da superfície atual
// ---------------------------------------------------------------------------

export async function importAreaGeoJson(file: File): Promise<boolean> {
  const status = georeferenceStatus(editor().project.georeference);
  if (status.state !== 'ready') {
    editor().notify(
      'error',
      `Um GeoJSON está em longitude e latitude: o projeto precisa estar georreferenciado para posicioná-lo. ${status.message}`,
    );
    return false;
  }
  let text: string;
  try {
    text = await readFileAsText(file);
  } catch {
    editor().notify('error', 'Não foi possível ler o arquivo selecionado.');
    return false;
  }
  const polygons = parseGeoJsonPolygons(text);
  if (!polygons.ok) {
    editor().notify('error', `${file.name}: ${polygons.error.message}`);
    return false;
  }
  const first = polygons.value[0];
  if (!first) return false;
  const rings = first.rings.map((ring) => ring.map((p) => status.transform.geographicToLocal(p)));
  const checked = validatePolygon(rings);
  if (!checked.ok) {
    editor().notify('error', `${file.name}: ${checked.error.message}`);
    return false;
  }
  terrain().setArea(checked.value);
  editor().notify(
    polygons.value.length > 1 ? 'info' : 'success',
    polygons.value.length > 1
      ? `${file.name}: o arquivo tem ${polygons.value.length} polígonos; foi usado o primeiro${first.name ? ` ("${first.name}")` : ''}.`
      : `Área importada de ${file.name}${first.name ? ` ("${first.name}")` : ''}.`,
  );
  const outer = checked.value[0] as Point2[];
  useEditorStore.getState().setViewMode('plan');
  // Leva a planta até a área importada.
  useUiStore.getState().requestPlan({
    kind: 'goTo',
    point: {
      x: outer.reduce((sum, p) => sum + p.x, 0) / outer.length,
      y: outer.reduce((sum, p) => sum + p.y, 0) / outer.length,
    },
  });
  return true;
}

export function exportAreaGeoJson(): void {
  const rings = areaRings(terrain());
  const { project } = editor();
  const status = georeferenceStatus(project.georeference);
  if (!rings || status.state !== 'ready') return;
  const text = polygonToGeoJson(
    rings.map((ring) => ring.map((p) => status.transform.localToGeographic(p))),
    { name: `${project.name} — área do terreno` },
  );
  downloadText(`${projectFileBase(project)}-area-terreno.geojson`, text, 'application/geo+json');
}

/** Retoma como área em edição o limite da superfície do projeto. */
export function areaFromSurface(surface: Terrain): void {
  if (!surface.boundary) return;
  terrain().setArea(surface.boundary.map((ring) => ring.map((p) => ({ x: p.x, y: p.y }))));
  editor().notify('info', 'O limite da superfície atual é agora a área em edição.');
}
