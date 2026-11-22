import {
  formatMeters,
  georeferenceStatus,
  INFRA_DRAWING_SCALES,
  radToDeg,
  terrainHitAt,
  designTerrainOf,
  hasDesignTerrain,
  type GeoreferenceStatus,
  type InfraSettings,
  type Point2,
} from '@hydrobim/core';
import { Layers, LocateFixed, MapPin, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CUSTOM_BASEMAP_ID } from '../map/customSource';
import { basemapProviders, type BasemapProvider } from '../map/providers';
import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import type { BasemapStatus } from './BasemapLayer';
import { CustomSourceForm } from './CustomSourceForm';
import { formatCoordinate, parseCoordinatePair, scaleBarFor, screenScaleOf } from './infraPlan';

const LAYER_LABELS: Record<keyof InfraSettings['layers'], string> = {
  network: 'Rede (tubos e conexões)',
  equipment: 'Equipamentos (válvulas, bombas, reservatórios)',
  terrain: 'Terreno (limite, curvas de nível, triangulação)',
  references: 'Referências (malha de coordenadas)',
  annotations: 'Anotações (cotas, textos, etiquetas)',
};

const LABEL_LABELS: Record<keyof InfraSettings['labels'], string> = {
  names: 'Identificação de nós e trechos',
  lengths: 'Comprimento dos trechos',
  elevations: 'Cotas (eixo, geratriz, terreno, recobrimento)',
};

const GEO_CHIP: Record<GeoreferenceStatus['state'], string> = {
  pending: 'Georreferenciamento pendente',
  unsupported: 'Georreferência sem transformação para o mapa',
  invalid: 'Georreferência inválida',
  ready: 'Georreferenciado',
};

interface ControlsProps {
  /**
   * Parte mostrada na faixa de comandos: a escala de documentação (aba Documentação), o mapa
   * de fundo com as camadas, ou a navegação por coordenadas e a georreferência (aba Visualizar).
   */
  part: 'scale' | 'map' | 'navigation';
}

/**
 * Controles próprios da Planta Infra, na faixa de comandos: escala de documentação, mapa de
 * fundo, camadas, rótulos, navegação por coordenadas e estado do georreferenciamento. Tudo o
 * que é persistido passa pela store (`changeInfraSettings`); a interface não guarda regras.
 */
export function InfraControls({ part }: ControlsProps) {
  const georeference = useEditorStore((s) => s.project.georeference);
  const geo = useMemo(() => georeferenceStatus(georeference), [georeference]);
  /** Centraliza a planta no ponto local indicado (abrindo-a, se preciso). */
  const onGoTo = (point: Point2): void => {
    const store = useEditorStore.getState();
    if (store.viewMode !== 'plan') store.setViewMode('plan');
    useUiStore.getState().requestPlan({ kind: 'goTo', point });
  };
  const infra = useEditorStore((s) => s.project.infra);
  const change = useEditorStore((s) => s.changeInfraSettings);
  const customBasemap = useEditorStore((s) => s.customBasemap);
  const providers = basemapProviders(customBasemap);
  const [opacity, setOpacity] = useState(infra.basemap.opacity);
  useEffect(() => setOpacity(infra.basemap.opacity), [infra.basemap.opacity]);
  const [target, setTarget] = useState('');
  const scales = (INFRA_DRAWING_SCALES as readonly number[]).includes(infra.drawingScale)
    ? INFRA_DRAWING_SCALES
    : [...INFRA_DRAWING_SCALES, infra.drawingScale].sort((a, b) => a - b);
  const projected = geo.state === 'ready';

  const goTo = (): void => {
    const pair = parseCoordinatePair(target);
    const store = useEditorStore.getState();
    if (!pair) {
      store.notify(
        'error',
        `Informe duas coordenadas separadas por ponto e vírgula (${projected ? 'E; N' : 'X; Y'}).`,
      );
      return;
    }
    onGoTo(
      geo.state === 'ready'
        ? geo.transform.projectedToLocal({ e: pair.a, n: pair.b })
        : { x: pair.a, y: pair.b },
    );
  };

  if (part === 'scale') {
    return (
      <label className="plan__field">
        <span>Escala</span>
        <select
          data-testid="infra-scale"
          value={infra.drawingScale}
          onChange={(event) => change({ drawingScale: Number(event.target.value) })}
          title="Escala de documentação da Planta Infra: define o tamanho de textos, cotas e traços na impressão e na exportação. Não é o zoom da tela nem a escala da planta do MEP"
        >
          {scales.map((scale) => (
            <option key={scale} value={scale}>
              1:{scale.toLocaleString('pt-BR')}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (part === 'navigation') {
    return (
      <>
        <label className="plan__field">
          <span>Ir para</span>
          <input
            className="infra__goto"
            data-testid="infra-goto"
            value={target}
            placeholder={projected ? 'E; N' : 'X; Y (locais)'}
            title={
              projected
                ? 'Coordenadas no sistema projetado do projeto (E; N), em metros'
                : 'Coordenadas locais do modelo (X; Y), em metros — o projeto não está georreferenciado'
            }
            onChange={(event) => setTarget(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') goTo();
            }}
          />
          <button
            type="button"
            className="btn btn--compact"
            data-testid="infra-goto-go"
            onClick={goTo}
            aria-label="Ir para as coordenadas"
          >
            <LocateFixed size={14} />
          </button>
        </label>
        <button
          type="button"
          className={`chip infra__geo infra__geo--${geo.state}`}
          data-testid="infra-georef"
          data-state={geo.state}
          onClick={() => useEditorStore.getState().setGeoPicker(true)}
          title={`${geo.message} Clique para definir ou ajustar pelo mapa.`}
        >
          <MapPin size={13} /> {GEO_CHIP[geo.state]}
        </button>
      </>
    );
  }

  return (
    <>
      <label className="plan__field">
        <span>Fundo</span>
        <select
          data-testid="infra-basemap"
          value={infra.basemap.sourceId ?? ''}
          onChange={(event) =>
            change({ basemap: { sourceId: event.target.value || null, visible: true } })
          }
          title="Fundo da planta: técnico (limpo) ou imagem de satélite georreferenciada. A imagem é só referência espacial — nenhuma medida é tomada sobre ela"
        >
          <option value="">Técnico (limpo)</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
          {infra.basemap.sourceId === CUSTOM_BASEMAP_ID && !customBasemap && (
            <option value={CUSTOM_BASEMAP_ID}>Personalizada (não cadastrada)</option>
          )}
        </select>
      </label>
      {infra.basemap.sourceId !== null && (
        <>
          <label className="check" title="Mostrar ou ocultar a imagem sem trocar a fonte">
            <input
              type="checkbox"
              data-testid="infra-basemap-visible"
              checked={infra.basemap.visible}
              onChange={(event) => change({ basemap: { visible: event.target.checked } })}
            />
            Imagem
          </label>
          <label className="plan__field" title="Opacidade da imagem de fundo">
            <span>Opacidade</span>
            <input
              type="range"
              className="infra__range"
              data-testid="infra-basemap-opacity"
              min={0.1}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(event) => setOpacity(Number(event.target.value))}
              // Um registro no histórico por ajuste, não um a cada passo do controle.
              onPointerUp={() => change({ basemap: { opacity } })}
              onKeyUp={() => change({ basemap: { opacity } })}
              onBlur={() => change({ basemap: { opacity } })}
            />
          </label>
        </>
      )}
      <details className="infra__menu">
        <summary className="btn btn--compact" data-testid="infra-layers">
          <Layers size={14} /> Camadas
        </summary>
        <div className="infra__popover" data-testid="infra-layers-menu">
          <strong>Camadas</strong>
          {(Object.keys(LAYER_LABELS) as (keyof InfraSettings['layers'])[]).map((key) => (
            <label key={key} className="check">
              <input
                type="checkbox"
                data-testid={`infra-layer-${key}`}
                checked={infra.layers[key]}
                onChange={(event) => change({ layers: { [key]: event.target.checked } })}
              />
              {LAYER_LABELS[key]}
            </label>
          ))}
          <strong>Rótulos</strong>
          {(Object.keys(LABEL_LABELS) as (keyof InfraSettings['labels'])[]).map((key) => (
            <label key={key} className="check">
              <input
                type="checkbox"
                data-testid={`infra-label-${key}`}
                checked={infra.labels[key]}
                onChange={(event) => change({ labels: { [key]: event.target.checked } })}
              />
              {LABEL_LABELS[key]}
            </label>
          ))}
          <span className="muted">
            Sistemas hidráulicos: visibilidade no navegador do projeto; cor em Gerenciar › Sistemas.
          </span>
          <details className="infra__custom-toggle">
            <summary data-testid="custom-source-toggle">
              Fonte de mapa própria (alta resolução)
            </summary>
            <CustomSourceForm />
          </details>
        </div>
      </details>
    </>
  );
}

const BASEMAP_TEXT: Record<BasemapStatus['state'], string> = {
  loading: 'Carregando o mapa…',
  ready: 'Mapa carregado',
  partial: 'Mapa incompleto: parte das imagens não pôde ser carregada',
  unavailable: 'Mapa indisponível: o serviço não respondeu. A edição continua normalmente',
  offline: 'Sem conexão: mapa indisponível. A edição continua normalmente',
  tooWide: 'Vista ampla demais para a imagem: aproxime para carregar o mapa',
};

interface OverlayProps {
  geo: GeoreferenceStatus;
  /** Metros do modelo por pixel de tela. */
  mpp: number;
  /** Ponto sob o cursor (coordenadas locais) e a sua cota, quando houver. */
  cursor: Point2 | null;
  provider: BasemapProvider | null;
  /** Estado do mapa; `null` = fundo técnico ou imagem oculta. */
  basemap: BasemapStatus | null;
  /** Motivo pelo qual a imagem escolhida não pode ser mostrada (ex.: sem georreferência). */
  basemapNote: string | null;
  onRetry: () => void;
  /** Há elementos desenhados como símbolo (fora de escala) nesta ampliação. */
  simplified: boolean;
}

/**
 * Informações de leitura da Planta Infra sobre o desenho: barra de escala, norte, coordenadas
 * do cursor, estado e atribuição do mapa. Não vai para a exportação.
 */
export function InfraOverlay({
  geo,
  mpp,
  cursor,
  provider,
  basemap,
  basemapNote,
  onRetry,
  simplified,
}: OverlayProps) {
  const rotation = useEditorStore((s) => s.project.georeference?.rotation ?? null);
  const verticalDatum = useEditorStore((s) => s.project.georeference?.verticalDatum ?? null);
  const drawingScale = useEditorStore((s) => s.project.infra.drawingScale);
  const project = useEditorStore((s) => s.project);
  // Terreno projetado (o natural, sem platôs) e, havendo platôs, também o natural.
  const terrain = useMemo(() => designTerrainOf(project), [project]);
  const natural = useMemo(() => (hasDesignTerrain(project) ? project.terrain : null), [project]);
  // Cota e declividade do terreno sob o cursor; fora da superfície não há valor a mostrar.
  const ground = cursor && terrain ? terrainHitAt(terrain, cursor.x, cursor.y) : null;
  const naturalGround = cursor && natural ? terrainHitAt(natural, cursor.x, cursor.y) : null;
  const bar = scaleBarFor(mpp);
  const transform = geo.state === 'ready' ? geo.transform : null;
  const projected = cursor && transform ? transform.localToProjected(cursor) : null;
  const geographic = cursor && transform ? transform.localToGeographic(cursor) : null;
  // Norte da quadrícula na tela: o eixo X local está a `rotation` (anti-horário) do leste.
  const gridNorth = rotation === null ? null : radToDeg(rotation);
  const convergence =
    transform && rotation !== null
      ? radToDeg(transform.factorsAt({ x: 0, y: 0 }).convergence)
      : null;

  return (
    <>
      <div
        className="infra__north"
        data-testid="infra-north"
        data-state={gridNorth === null ? 'undefined' : 'grid'}
        data-angle={gridNorth === null ? '' : gridNorth.toFixed(4)}
        title={
          gridNorth === null
            ? 'Norte não definido: o projeto ainda não está georreferenciado'
            : `Norte da quadrícula (NQ) do sistema projetado.${
                convergence === null
                  ? ''
                  : ` Convergência meridiana na origem: ${convergence.toFixed(3).replace('.', ',')}° (o norte verdadeiro fica a ${(-convergence).toFixed(3).replace('.', ',')}° do NQ, sentido horário positivo).`
              }`
        }
      >
        {gridNorth === null ? (
          <span className="infra__north-pending">N ?</span>
        ) : (
          <>
            <svg width={34} height={44} viewBox="-17 -24 34 44" aria-hidden>
              <g transform={`rotate(${gridNorth.toFixed(4)})`}>
                <path
                  d="M0 -20L7 12L0 6L-7 12Z"
                  fill="#0c1118"
                  stroke="#ffffff"
                  strokeWidth={1.2}
                />
              </g>
            </svg>
            <span>NQ</span>
          </>
        )}
      </div>

      <div className="infra__footer">
        <div
          className="infra__scalebar"
          data-testid="infra-scale-bar"
          data-meters={bar.meters}
          title="Barra de escala da vista (zoom de navegação). A escala de impressão é a de documentação"
        >
          <span className="infra__scalebar-rule" style={{ width: `${bar.pixels}px` }} />
          <span>{bar.label}</span>
          <span className="infra__dim" data-testid="infra-scale-info">
            vista ≈ 1:{Math.round(screenScaleOf(mpp)).toLocaleString('pt-BR')} · documentação 1:
            {drawingScale.toLocaleString('pt-BR')}
          </span>
        </div>
        <div className="infra__cursor" data-testid="infra-cursor">
          {cursor ? (
            <>
              <span data-testid="infra-cursor-local">
                X {formatMeters(cursor.x, 2)} · Y {formatMeters(cursor.y, 2)}
              </span>
              {projected && (
                <span data-testid="infra-cursor-projected">
                  E {formatCoordinate(projected.e, 2)} · N {formatCoordinate(projected.n, 2)}
                </span>
              )}
              {geographic && (
                <span data-testid="infra-cursor-geographic" className="infra__dim">
                  {geographic.lat.toFixed(6)}°; {geographic.lon.toFixed(6)}°
                </span>
              )}
              {terrain && (
                <span
                  data-testid="infra-cursor-terrain"
                  data-elevation={ground ? ground.elevation.toFixed(3) : ''}
                  title="Cota do terreno (referencial do projeto) e declividade do triângulo sob o cursor"
                >
                  {ground
                    ? `${natural ? 'Terreno projetado' : 'Terreno'} ${formatMeters(ground.elevation, 2)} · decliv. ${(ground.slope * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} %`
                    : `${natural ? 'Terreno projetado' : 'Terreno'}: sem dado`}
                </span>
              )}
              {natural && (
                <span
                  data-testid="infra-cursor-terrain-natural"
                  data-elevation={naturalGround ? naturalGround.elevation.toFixed(3) : ''}
                  className="infra__dim"
                  title="Cota do terreno natural (como levantado) sob o cursor"
                >
                  {naturalGround
                    ? `natural ${formatMeters(naturalGround.elevation, 2)}`
                    : 'natural: sem dado'}
                </span>
              )}
            </>
          ) : (
            <span className="infra__dim">Coordenadas do cursor</span>
          )}
          <span className="infra__dim" data-testid="infra-crs">
            {geo.state === 'ready'
              ? `${geo.crs.name} (EPSG:${geo.crs.epsg}) · altimetria: ${verticalDatum ?? 'referência não informada'}`
              : 'coordenadas locais — georreferenciamento pendente'}
          </span>
        </div>
        {simplified && (
          <div className="infra__note" data-testid="infra-lod-note">
            Vista geral: eixos e símbolos fora de escala. Aproxime para ver a geometria das peças.
          </div>
        )}
        {basemapNote && (
          <div className="infra__basemap" data-testid="basemap-status" data-state="blocked">
            <span>{basemapNote}</span>
          </div>
        )}
        {provider && basemap && (
          <div className="infra__basemap" data-testid="basemap-status" data-state={basemap.state}>
            <span>{BASEMAP_TEXT[basemap.state]}</span>
            {basemap.state === 'ready' && basemap.overzoom && (
              <span className="infra__dim">(imagem ampliada além da resolução da fonte)</span>
            )}
            {(basemap.state === 'unavailable' || basemap.state === 'partial') && (
              <button type="button" className="chip" data-testid="basemap-retry" onClick={onRetry}>
                <RefreshCw size={12} /> Tentar novamente
              </button>
            )}
          </div>
        )}
        {provider && basemap && (
          <div className="infra__attribution" data-testid="basemap-attribution">
            <a href={provider.attributionUrl} target="_blank" rel="noreferrer noopener">
              {provider.attribution}
            </a>
            {' · '}
            <a href={provider.licenseUrl} target="_blank" rel="noreferrer noopener">
              {provider.license}
            </a>
            {provider.imageryDate && ` · imagens de ${provider.imageryDate}`}
            {provider.resolution !== null && ` · resolução ≈ ${provider.resolution} m`}
          </div>
        )}
      </div>
    </>
  );
}
