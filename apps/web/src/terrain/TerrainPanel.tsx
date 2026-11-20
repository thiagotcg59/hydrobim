import {
  georeferenceStatus,
  MAX_TERRAIN_VERTICES,
  polygonArea,
  terrainStats,
  type Point2,
  type Terrain,
} from '@hydrobim/core';
import { Download, Eraser, Mountain, PenLine, Square, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useEditorStore } from '../state/editorStore';
import {
  checkCredentials,
  ELEVATION_PROVIDERS,
  findElevationProvider,
  MAPBOX_DEFAULT_TILESET,
  storeCredentials,
} from './elevationProviders';
import { defaultZoom, zoomOptions } from './elevationTiles';
import {
  areaFromSurface,
  cancelTerrainJob,
  exportAreaGeoJson,
  generateFromGeoTiff,
  generateFromSurvey,
  generateFromTiles,
  geoTiffSampling,
  importAreaGeoJson,
  loadGeoTiff,
  loadSurveyBreaklines,
  loadSurveyPoints,
  useTerrainData,
} from './terrainActions';
import { elevationColor } from './terrainColors';
import { areaRings, useTerrainStore } from './terrainStore';

/**
 * Painel do terreno na Planta Infra: área de recorte, fonte de elevação, geração da superfície
 * e procedência do que está no projeto. Não contém regras: chama os casos de uso
 * (`terrainActions`) e mostra o que o domínio devolve.
 */

type SourceTab = 'tiles' | 'geotiff' | 'survey';

const nf = (value: number, digits = 0): string =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const formatArea = (m2: number): string =>
  m2 >= 10_000 ? `${nf(m2 / 10_000, 2)} ha` : `${nf(m2, 0)} m²`;

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="terrain__row">
      <span className="terrain__key">{label}</span>
      <span className="terrain__value" data-testid={testId}>
        {children}
      </span>
    </div>
  );
}

const NOT_DECLARED = <em className="terrain__missing">não declarada pela fonte</em>;

function AreaSection({ rings, surface }: { rings: Point2[][] | null; surface: Terrain | null }) {
  const mode = useTerrainStore((s) => s.mode);
  const draft = useTerrainStore((s) => s.draft);
  const holes = useTerrainStore((s) => s.holes);
  const { setMode, setArea, removeHole, finishDraft } = useTerrainStore.getState();
  const georeferenced = useEditorStore(
    (s) => georeferenceStatus(s.project.georeference).state === 'ready',
  );
  const drawing = mode === 'area' || mode === 'hole';
  return (
    <section className="terrain__section" data-testid="terrain-area-section">
      <h4>1. Área</h4>
      {rings ? (
        <Row label="Contorno" testId="terrain-area-info">
          {rings[0]?.length ?? 0} vértices · {formatArea(polygonArea(rings))}
          {holes.length > 0 ? ` · ${holes.length} furo${holes.length > 1 ? 's' : ''}` : ''}
        </Row>
      ) : (
        <p className="muted" data-testid="terrain-area-empty">
          Desenhe o contorno sobre a planta ou importe um polígono GeoJSON. A superfície é gerada só
          dentro dele.
        </p>
      )}
      <div className="terrain__actions">
        <button
          type="button"
          className={mode === 'area' ? 'btn btn--compact is-active' : 'btn btn--compact'}
          data-testid="terrain-area-draw"
          aria-pressed={mode === 'area'}
          onClick={() => setMode(mode === 'area' ? null : 'area')}
          title="Desenhar o contorno da área clicando os vértices na planta"
        >
          <PenLine size={14} /> {rings ? 'Redesenhar' : 'Desenhar contorno'}
        </button>
        <button
          type="button"
          className={mode === 'hole' ? 'btn btn--compact is-active' : 'btn btn--compact'}
          data-testid="terrain-hole-draw"
          aria-pressed={mode === 'hole'}
          disabled={!rings}
          onClick={() => setMode(mode === 'hole' ? null : 'hole')}
          title={
            rings
              ? 'Desenhar um furo: região dentro do contorno que fica sem superfície'
              : 'Defina primeiro o contorno'
          }
        >
          <Square size={14} /> Furo
        </button>
        {drawing && (
          <button
            type="button"
            className="btn btn--compact"
            data-testid="terrain-draft-finish"
            disabled={draft.length < 3}
            onClick={finishDraft}
          >
            Fechar ({draft.length})
          </button>
        )}
      </div>
      <div className="terrain__actions">
        <label
          className="btn btn--compact"
          title={
            georeferenced
              ? 'Importar a área de um arquivo GeoJSON (longitude e latitude, WGS 84)'
              : 'Um GeoJSON está em longitude e latitude: georreferencie o projeto para importá-lo'
          }
        >
          <Upload size={14} /> GeoJSON
          <input
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            data-testid="terrain-geojson-file"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importAreaGeoJson(file);
              event.target.value = '';
            }}
          />
        </label>
        <button
          type="button"
          className="btn btn--compact"
          data-testid="terrain-geojson-export"
          disabled={!rings || !georeferenced}
          onClick={exportAreaGeoJson}
          title="Baixar a área como GeoJSON (WGS 84)"
        >
          <Download size={14} />
        </button>
        {surface?.boundary && (
          <button
            type="button"
            className="btn btn--compact"
            data-testid="terrain-area-from-surface"
            onClick={() => areaFromSurface(surface)}
            title="Usar como área o limite da superfície que já está no projeto"
          >
            Do terreno atual
          </button>
        )}
        <button
          type="button"
          className="btn btn--compact"
          data-testid="terrain-area-clear"
          disabled={!rings}
          onClick={() => setArea(null)}
          title="Apagar a área em edição (a superfície do projeto não é alterada)"
        >
          <Eraser size={14} />
        </button>
      </div>
      {holes.length > 0 && (
        <div className="chips">
          {holes.map((hole, index) => (
            <button
              key={index}
              type="button"
              className="chip"
              data-testid={`terrain-hole-remove-${index}`}
              onClick={() => removeHole(index)}
              title="Remover este furo"
            >
              Furo {index + 1} ({hole.length} v.) <X size={11} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function TilesSource({ rings, busy }: { rings: Point2[][] | null; busy: boolean }) {
  const georeference = useEditorStore((s) => s.project.georeference);
  const geo = useMemo(() => georeferenceStatus(georeference), [georeference]);
  const credentials = useTerrainData((s) => s.credentials);
  const [providerId, setProviderId] = useState(ELEVATION_PROVIDERS[0]?.id ?? '');
  const provider = findElevationProvider(providerId);
  const [token, setToken] = useState('');
  const [tileset, setTileset] = useState(credentials?.tileset ?? MAPBOX_DEFAULT_TILESET);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const options = useMemo(
    () =>
      provider && rings && geo.state === 'ready'
        ? zoomOptions(provider, geo.transform, rings, MAX_TERRAIN_VERTICES)
        : [],
    [provider, rings, geo],
  );
  const suggested = provider ? defaultZoom(provider, options) : null;
  const [zoom, setZoom] = useState<number | null>(null);
  const chosen = options.find((o) => o.zoom === zoom && o.blocked === null)?.zoom ?? suggested;
  const option = options.find((o) => o.zoom === chosen);
  if (!provider) return null;
  const needsToken = provider.requiresToken && !credentials;
  return (
    <>
      <label className="plan__field plan__field--block">
        <span>Fonte</span>
        <select
          data-testid="terrain-provider"
          value={providerId}
          onChange={(event) => {
            setProviderId(event.target.value);
            setZoom(null);
          }}
        >
          {ELEVATION_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <p className="muted" data-testid="terrain-provider-notes">
        {provider.notes}
      </p>
      {provider.requiresToken && (
        <div className="terrain__token" data-testid="terrain-token-form">
          {credentials ? (
            <Row label="Chave">
              cadastrada neste navegador ({credentials.tileset}){' '}
              <button
                type="button"
                className="link"
                data-testid="terrain-token-remove"
                onClick={() => {
                  storeCredentials(null);
                  useTerrainData.setState({ credentials: null });
                }}
              >
                remover
              </button>
            </Row>
          ) : (
            <>
              <label className="plan__field plan__field--block">
                <span>Chave pública da sua conta (pk.…)</span>
                <input
                  data-testid="terrain-token"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                />
              </label>
              <label className="plan__field plan__field--block">
                <span>Conjunto de ladrilhos</span>
                <input
                  data-testid="terrain-tileset"
                  value={tileset}
                  onChange={(event) => setTileset(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                />
              </label>
              <button
                type="button"
                className="btn btn--compact"
                data-testid="terrain-token-save"
                onClick={() => {
                  const checked = checkCredentials({ token, tileset });
                  if (!checked.ok) {
                    setTokenError(checked.message);
                    return;
                  }
                  setTokenError(null);
                  storeCredentials(checked.value);
                  useTerrainData.setState({ credentials: checked.value });
                  setToken('');
                }}
              >
                Guardar neste navegador
              </button>
              {tokenError && (
                <p className="terrain__error" data-testid="terrain-token-error">
                  {tokenError}
                </p>
              )}
              <p className="muted">
                A chave fica só neste navegador: não entra no projeto, no arquivo nem em
                exportações.
              </p>
            </>
          )}
        </div>
      )}
      {geo.state !== 'ready' ? (
        <p className="terrain__error" data-testid="terrain-needs-georeference">
          Projeto sem georreferência utilizável: não há como saber onde a área fica no terreno.{' '}
          {geo.message}
        </p>
      ) : !rings ? (
        <p className="muted">Defina a área para ver as resoluções disponíveis.</p>
      ) : (
        <>
          <label className="plan__field plan__field--block">
            <span>Resolução do raster</span>
            <select
              data-testid="terrain-zoom"
              value={chosen ?? ''}
              onChange={(event) => setZoom(Number(event.target.value))}
            >
              {options.map((o) => (
                <option key={o.zoom} value={o.zoom} disabled={o.blocked !== null}>
                  ≈ {nf(o.resolution, 1)} m · {nf(o.samples)} amostras
                  {o.oversampled ? ' · sobreamostrado' : ''}
                  {o.blocked ? ` — ${o.blocked}` : ''}
                </option>
              ))}
            </select>
          </label>
          {option && (
            <p
              className={option.oversampled === false ? 'muted' : 'terrain__warning'}
              data-testid="terrain-resolution-note"
              data-oversampled={String(option.oversampled)}
            >
              {option.oversampled === true
                ? `Acima da resolução nominal do dado de origem (30 m fora das regiões com levantamento regional): o serviço entrega os mesmos valores reamostrados. Mais vértices, nenhum detalhe real a mais.`
                : option.oversampled === null
                  ? 'A fonte não informa a resolução do dado de origem em cada local: o tamanho do pixel pode ser mais fino que o dado.'
                  : 'Tamanho do pixel do ladrilho — resolução do raster, não exatidão das cotas.'}
            </p>
          )}
        </>
      )}
      <button
        type="button"
        className="btn btn--primary"
        data-testid="terrain-generate"
        disabled={busy || !rings || geo.state !== 'ready' || needsToken || chosen === null}
        onClick={() => {
          if (chosen !== null) void generateFromTiles(provider.id, chosen);
        }}
      >
        <Mountain size={14} /> Buscar elevação e gerar
      </button>
      <p className="terrain__attribution">
        <a href={provider.attributionUrl} target="_blank" rel="noreferrer noopener">
          {provider.attribution}
        </a>
      </p>
    </>
  );
}

function GeoTiffSource({ rings, busy }: { rings: Point2[][] | null; busy: boolean }) {
  const loaded = useTerrainData((s) => s.geotiff);
  const georeference = useEditorStore((s) => s.project.georeference);
  const sampling = useMemo(
    () => (loaded && rings ? geoTiffSampling(loaded.dem, rings) : null),
    // A georreferência do projeto muda a posição do raster em relação à área.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded, rings, georeference],
  );
  const [stride, setStride] = useState<number | null>(null);
  const suggested = sampling?.ok ? sampling.value.suggestedStride : 1;
  const used = Math.max(stride ?? suggested, 1);
  const strides = [...new Set([1, 2, 3, 4, 5, 8, 10, 15, 20, suggested])].sort((a, b) => a - b);
  return (
    <>
      <label className="btn btn--compact terrain__file">
        <Upload size={14} /> {loaded ? 'Trocar arquivo' : 'Escolher GeoTIFF'}
        <input
          type="file"
          accept=".tif,.tiff,image/tiff"
          data-testid="terrain-geotiff-file"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              setStride(null);
              void loadGeoTiff(file);
            }
            event.target.value = '';
          }}
        />
      </label>
      {loaded ? (
        <div data-testid="terrain-geotiff-info">
          <Row label="Arquivo">{loaded.name}</Row>
          <Row label="Raster">
            {nf(loaded.dem.raster.width)} × {nf(loaded.dem.raster.height)} células
          </Row>
          <Row label="Sistema" testId="terrain-geotiff-crs">
            EPSG:{loaded.dem.epsg}
          </Row>
          <Row label="Ref. altimétrica" testId="terrain-geotiff-vertical">
            {loaded.dem.verticalDatum ?? NOT_DECLARED}
          </Row>
          <Row label="Sem dado">{nf(loaded.dem.noDataCount)} células</Row>
        </div>
      ) : (
        <p className="muted">
          Modelo de elevação de uma banda, com sistema de referência declarado (código EPSG):
          sistema do projeto, outro fuso UTM do registro, WGS 84 ou SIRGAS 2000 geográficos.
        </p>
      )}
      {sampling && !sampling.ok && (
        <p className="terrain__error" data-testid="terrain-geotiff-error">
          {sampling.error.message}
        </p>
      )}
      {sampling?.ok && (
        <>
          <label className="plan__field plan__field--block">
            <span>Amostras usadas</span>
            <select
              data-testid="terrain-stride"
              value={used}
              onChange={(event) => setStride(Number(event.target.value))}
            >
              {strides.map((value) => {
                const count = Math.round(sampling.value.samples / (value * value));
                return (
                  <option key={value} value={value} disabled={count > MAX_TERRAIN_VERTICES}>
                    {value === 1 ? 'todas' : `1 a cada ${value}`} · ≈{' '}
                    {nf(sampling.value.spacing * value, 1)} m · {nf(count)} amostras
                    {count > MAX_TERRAIN_VERTICES ? ' — acima do limite' : ''}
                  </option>
                );
              })}
            </select>
          </label>
          <p className="muted">
            Reduzir usa menos células do raster; nenhuma cota é interpolada. Resolução do raster não
            é exatidão das cotas.
          </p>
        </>
      )}
      <button
        type="button"
        className="btn btn--primary"
        data-testid="terrain-generate"
        disabled={busy || !loaded || !rings || !sampling?.ok}
        onClick={() => void generateFromGeoTiff(used)}
      >
        <Mountain size={14} /> Gerar do GeoTIFF
      </button>
    </>
  );
}

function SurveySource({
  rings,
  busy,
  surface,
}: {
  rings: Point2[][] | null;
  busy: boolean;
  surface: Terrain | null;
}) {
  const points = useTerrainData((s) => s.surveyPoints);
  const breaklines = useTerrainData((s) => s.surveyBreaklines);
  const georeferenced = useEditorStore(
    (s) => georeferenceStatus(s.project.georeference).state === 'ready',
  );
  const [coordinates, setCoordinates] = useState<'local' | 'projected'>('local');
  const [clip, setClip] = useState(false);
  const [accuracy, setAccuracy] = useState('');
  const parsedAccuracy = Number(accuracy.replace(',', '.'));
  return (
    <>
      <p className="muted">
        Pontos cotados do levantamento ("X Y Z" por linha) e, se houver, linhas de quebra (blocos de
        "X Y Z" separados por uma linha em branco). A triangulação nunca atravessa uma linha de
        quebra.
      </p>
      <div className="terrain__actions">
        <label className="btn btn--compact">
          <Upload size={14} /> Pontos
          <input
            type="file"
            accept=".txt,.xyz,.csv,text/plain,text/csv"
            data-testid="terrain-survey-points"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadSurveyPoints(file);
              event.target.value = '';
            }}
          />
        </label>
        <label className="btn btn--compact">
          <Upload size={14} /> Linhas de quebra
          <input
            type="file"
            accept=".txt,.xyz,.csv,text/plain,text/csv"
            data-testid="terrain-survey-breaklines"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadSurveyBreaklines(file);
              event.target.value = '';
            }}
          />
        </label>
        {breaklines && (
          <button
            type="button"
            className="btn btn--compact"
            data-testid="terrain-survey-breaklines-clear"
            title="Descartar as linhas de quebra carregadas"
            onClick={() => useTerrainData.setState({ surveyBreaklines: null })}
          >
            <X size={14} />
          </button>
        )}
      </div>
      <Row label="Pontos" testId="terrain-survey-points-info">
        {points ? `${nf(points.points.length)} (${points.name})` : 'nenhum arquivo'}
      </Row>
      <Row label="Linhas de quebra" testId="terrain-survey-breaklines-info">
        {breaklines ? `${nf(breaklines.lines.length)} (${breaklines.name})` : 'nenhuma'}
      </Row>
      <label className="plan__field plan__field--block">
        <span>Coordenadas do arquivo</span>
        <select
          data-testid="terrain-survey-coordinates"
          value={coordinates}
          onChange={(event) => setCoordinates(event.target.value as 'local' | 'projected')}
        >
          <option value="local">X, Y, Z locais do modelo</option>
          <option value="projected" disabled={!georeferenced}>
            E, N e altitude do sistema do projeto{georeferenced ? '' : ' (exige georreferência)'}
          </option>
        </select>
      </label>
      <label className="check" title="Recorta o levantamento pela área desenhada">
        <input
          type="checkbox"
          data-testid="terrain-survey-clip"
          checked={clip && rings !== null}
          disabled={!rings}
          onChange={(event) => setClip(event.target.checked)}
        />
        Recortar pela área {rings ? '' : '(defina a área)'}
      </label>
      <label
        className="plan__field"
        title="Exatidão altimétrica informada pelo responsável pelo levantamento. Deixe em branco se não for conhecida."
      >
        <span>Exatidão altimétrica (m)</span>
        <input
          data-testid="terrain-survey-accuracy"
          value={accuracy}
          placeholder="não informada"
          inputMode="decimal"
          onChange={(event) => setAccuracy(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
        />
      </label>
      {surface?.source.kind === 'dem' && (
        <p className="terrain__warning" data-testid="terrain-survey-replaces">
          O levantamento substitui a superfície atual, vinda de DEM ({surface.source.provider}). A
          troca pode ser desfeita.
        </p>
      )}
      <button
        type="button"
        className="btn btn--primary"
        data-testid="terrain-generate"
        disabled={busy || !points}
        onClick={() =>
          void generateFromSurvey({
            coordinates,
            clip: clip && rings !== null,
            verticalAccuracy:
              accuracy.trim() !== '' && Number.isFinite(parsedAccuracy) && parsedAccuracy > 0
                ? parsedAccuracy
                : null,
          })
        }
      >
        <Mountain size={14} /> Gerar do levantamento
      </button>
    </>
  );
}

function JobStatus() {
  const job = useTerrainStore((s) => s.job);
  if (job.status === 'idle') return null;
  if (job.status === 'running') {
    return (
      <div
        className="terrain__job"
        data-testid="terrain-progress"
        data-state="running"
        role="status"
      >
        <span>{job.label}</span>
        <progress
          value={job.progress ?? undefined}
          max={1}
          aria-label="Andamento da geração da superfície"
        />
        <button
          type="button"
          className="btn btn--compact"
          data-testid="terrain-cancel"
          onClick={cancelTerrainJob}
        >
          Cancelar
        </button>
      </div>
    );
  }
  if (job.status === 'error') {
    return (
      <p className="terrain__error" data-testid="terrain-error" role="alert">
        {job.message}
      </p>
    );
  }
  return (
    <div className="terrain__job" data-testid="terrain-result" data-state="done">
      <span>{job.message}</span>
      {job.warnings.length > 0 && (
        <ul className="terrain__warnings" data-testid="terrain-warnings">
          {job.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SurfaceSection({ surface }: { surface: Terrain }) {
  const stats = useMemo(() => terrainStats(surface), [surface]);
  const { source } = surface;
  const gradient = useMemo(
    () =>
      `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1]
        .map((t) => {
          const [r, g, b] = elevationColor(t);
          return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
        })
        .join(', ')})`,
    [],
  );
  return (
    <section className="terrain__section" data-testid="terrain-surface-section">
      <h4>Superfície no projeto</h4>
      <Row label="Nome" testId="terrain-surface-name">
        {surface.name}
      </Row>
      <Row label="Fonte" testId="terrain-source-provider">
        {source.kind === 'dem' ? 'DEM' : 'Levantamento'} — {source.provider}
      </Row>
      {source.dataset && <Row label="Dados">{source.dataset}</Row>}
      <Row label="Sistema de origem" testId="terrain-source-crs">
        {source.horizontalCrs ?? 'coordenadas locais do modelo'}
      </Row>
      <Row label="Ref. altimétrica" testId="terrain-source-vertical">
        {source.verticalDatum ?? NOT_DECLARED}
      </Row>
      <Row label="Resolução do raster" testId="terrain-source-resolution">
        {source.resolution !== null ? `${nf(source.resolution, 1)} m` : 'não se aplica (pontos)'}
      </Row>
      <Row label="Exatidão altimétrica" testId="terrain-source-accuracy">
        {source.verticalAccuracy !== null ? `${nf(source.verticalAccuracy, 2)} m` : NOT_DECLARED}
      </Row>
      <Row label="Malha" testId="terrain-surface-mesh">
        {nf(stats.vertexCount)} vértices · {nf(stats.triangleCount)} triângulos
      </Row>
      <Row label="Linhas de quebra" testId="terrain-surface-breaklines">
        {surface.breaklines.length}
      </Row>
      <Row label="Cotas" testId="terrain-surface-range">
        {nf(stats.minZ, 2)} a {nf(stats.maxZ, 2)} m
      </Row>
      <Row label="Área em planta">{formatArea(stats.planArea)}</Row>
      <Row label="Declividade média" testId="terrain-surface-slope">
        {nf(stats.meanSlope * 100, 1)} % (máx. {nf(stats.maxSlope * 100, 0)} %)
      </Row>
      <div className="terrain__legend" data-testid="terrain-legend">
        <span>{nf(stats.minZ, 1)} m</span>
        <span className="terrain__ramp" style={{ background: gradient }} />
        <span>{nf(stats.maxZ, 1)} m</span>
      </div>
      {source.notes && <p className="muted">{source.notes}</p>}
      {source.attribution && <p className="terrain__attribution">{source.attribution}</p>}
      <button
        type="button"
        className="btn btn--compact"
        data-testid="terrain-remove-surface"
        onClick={() => useEditorStore.getState().setTerrain(null)}
      >
        <Trash2 size={14} /> Remover a superfície
      </button>
    </section>
  );
}

export function TerrainPanel() {
  const open = useTerrainStore((s) => s.panelOpen);
  const area = useTerrainStore((s) => s.area);
  const holes = useTerrainStore((s) => s.holes);
  const running = useTerrainStore((s) => s.job.status === 'running');
  const surface = useEditorStore((s) => s.project.terrain);
  const rings = useMemo(() => areaRings({ area, holes }), [area, holes]);
  const [tab, setTab] = useState<SourceTab>('tiles');
  // Trocar de fonte limpa o resultado da tentativa anterior.
  useEffect(() => {
    const { job, setJob } = useTerrainStore.getState();
    if (job.status === 'error') setJob({ status: 'idle' });
  }, [tab]);
  if (!open) return null;
  const TABS: [SourceTab, string][] = [
    ['tiles', 'DEM online'],
    ['geotiff', 'GeoTIFF'],
    ['survey', 'Levantamento'],
  ];
  return (
    <aside className="terrain" data-testid="terrain-panel" aria-label="Terreno">
      <header className="terrain__header">
        <strong>
          <Mountain size={15} /> Superfície do terreno
        </strong>
        <button
          type="button"
          className="btn btn--icon"
          data-testid="terrain-panel-close"
          aria-label="Fechar o painel do terreno"
          onClick={() => useTerrainStore.getState().setPanelOpen(false)}
        >
          <X size={14} />
        </button>
      </header>
      <div className="terrain__body">
        <AreaSection rings={rings} surface={surface} />
        <section className="terrain__section" data-testid="terrain-source-section">
          <h4>2. Fonte de elevação</h4>
          <div className="terrain__tabs" role="tablist">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                data-testid={`terrain-tab-${id}`}
                className={tab === id ? 'chip is-active' : 'chip'}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'tiles' && <TilesSource rings={rings} busy={running} />}
          {tab === 'geotiff' && <GeoTiffSource rings={rings} busy={running} />}
          {tab === 'survey' && <SurveySource rings={rings} busy={running} surface={surface} />}
          <JobStatus />
        </section>
        {surface && <SurfaceSection surface={surface} />}
      </div>
    </aside>
  );
}
