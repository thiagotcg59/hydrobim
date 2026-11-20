import {
  findProjectedCrs,
  geographicToProjected,
  geographicToTile,
  projectedToGeographic,
  tileGroundResolution,
  tileToGeographic,
  type Geographic,
  type Georeference,
} from '@hydrobim/core';
import { MapPin, X } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { basemapProviders, tileUrl } from '../map/providers';
import { useEditorStore } from '../state/editorStore';
import { CustomSourceForm } from './CustomSourceForm';
import { formatCoordinate, parseCoordinatePair } from './infraPlan';

/**
 * Fusos UTM oferecidos (SIRGAS 2000, hemisfério sul — os do território brasileiro). O fuso
 * inicial é o 21S, por decisão do responsável pelo projeto; o usuário pode trocá-lo, e a
 * georreferência só é gravada quando ele confirma um ponto no mapa.
 */
export const PICKER_ZONES = [18, 19, 20, 21, 22, 23, 24, 25] as const;
export const DEFAULT_PICKER_ZONE = 21;
const epsgOfZone = (zone: number): number => 31960 + zone;

const TILE = 256;
const MIN_ZOOM = 4;
const MAX_ZOOM = 19;
const CLICK_TOLERANCE_PX = 4;
/** Além de 3,5° do meridiano central o ponto já pertence a outro fuso. */
const ZONE_HALF_WIDTH = 3.5;

interface Props {
  /** Aplicado ao confirmar: metros do modelo por pixel para a planta abrir na mesma região. */
  onDone: (metersPerPixel: number) => void;
}

/**
 * Definição da georreferência pelo mapa: o usuário navega (arraste e roda do mouse), escolhe o
 * tema (satélite ou ruas) e clica no ponto que será a origem local (0; 0) do modelo. As
 * coordenadas E/N desse ponto são calculadas no fuso escolhido e gravadas como georreferência.
 * O mapa aqui é desenhado no próprio referencial dos ladrilhos — ainda não há projeto a
 * posicionar.
 */
export function GeoPicker({ onDone }: Props) {
  const current = useEditorStore((s) => s.project.georeference);
  const basemapId = useEditorStore((s) => s.project.infra.basemap.sourceId);
  const hasElements = useEditorStore((s) => s.project.elements.length > 0);
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const customBasemap = useEditorStore((s) => s.customBasemap);
  const providers = basemapProviders(customBasemap);
  const [themeId, setThemeId] = useState(basemapId ?? providers[0]?.id ?? '');
  const provider = providers.find((source) => source.id === themeId) ?? providers[0] ?? null;

  const initialCrs = current?.epsg ? findProjectedCrs(current.epsg) : null;
  const [zone, setZone] = useState<number>(
    initialCrs && initialCrs.hemisphere === 'S' && initialCrs.datum === 'SIRGAS 2000'
      ? initialCrs.zone
      : DEFAULT_PICKER_ZONE,
  );
  const crs = findProjectedCrs(epsgOfZone(zone));

  // Vista inicial: a origem já georreferenciada ou, sem ela, o fuso inteiro para o usuário
  // localizar a área — não é uma posição do projeto.
  const [view, setView] = useState<{ center: Geographic; zoom: number }>(() => {
    if (current && initialCrs) {
      return {
        center: projectedToGeographic(initialCrs, { e: current.eastings, n: current.northings }),
        zoom: 15,
      };
    }
    return { center: { lon: DEFAULT_PICKER_ZONE * 6 - 183, lat: -15 }, zoom: 5 };
  });
  /** A vista pede mais detalhe do que a fonte tem: a imagem aparece ampliada (borrada). */
  const overzoom = provider !== null && view.zoom > provider.maxZoom;
  const [picked, setPicked] = useState<Geographic | null>(null);
  const [search, setSearch] = useState('');
  const drag = useRef<{ x: number; y: number; center: Geographic; moved: boolean } | null>(null);

  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /** Posição geográfica de um ponto da tela (px a partir do canto do mapa). */
  const toGeographic = (px: number, py: number, at = view): Geographic => {
    const c = geographicToTile(at.center, at.zoom);
    return tileToGeographic(
      { x: c.x + (px - size.width / 2) / TILE, y: c.y + (py - size.height / 2) / TILE },
      at.zoom,
    );
  };
  /** Posição na tela de um ponto geográfico. */
  const toScreen = (point: Geographic): { x: number; y: number } => {
    const c = geographicToTile(view.center, view.zoom);
    const p = geographicToTile(point, view.zoom);
    return { x: size.width / 2 + (p.x - c.x) * TILE, y: size.height / 2 + (p.y - c.y) * TILE };
  };

  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setView((v) => {
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom + (event.deltaY < 0 ? 1 : -1)));
        if (zoom === v.zoom) return v;
        // O ponto sob o cursor permanece no lugar.
        const c = geographicToTile(v.center, v.zoom);
        const under = {
          x: c.x + (px - rect.width / 2) / TILE,
          y: c.y + (py - rect.height / 2) / TILE,
        };
        const k = 2 ** (zoom - v.zoom);
        const center = tileToGeographic(
          {
            x: under.x * k - (px - rect.width / 2) / TILE,
            y: under.y * k - (py - rect.height / 2) / TILE,
          },
          zoom,
        );
        return { center, zoom };
      });
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    drag.current = { x: event.clientX, y: event.clientY, center: view.center, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > CLICK_TOLERANCE_PX) d.moved = true;
    if (!d.moved) return;
    const c = geographicToTile(d.center, view.zoom);
    setView((v) => ({
      zoom: v.zoom,
      center: tileToGeographic({ x: c.x - dx / TILE, y: c.y - dy / TILE }, v.zoom),
    }));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!d || d.moved || event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setPicked(toGeographic(event.clientX - rect.left, event.clientY - rect.top));
  };

  // Ladrilhos visíveis. Além do maior nível da fonte, a imagem é ampliada na tela.
  const tiles = useMemo(() => {
    if (!provider || size.width <= 0) return [];
    const level = Math.min(view.zoom, provider.maxZoom);
    const scale = 2 ** (view.zoom - level);
    const side = TILE * scale;
    const c = geographicToTile(view.center, level);
    const last = 2 ** level - 1;
    const x0 = Math.floor(c.x - size.width / 2 / side);
    const x1 = Math.floor(c.x + size.width / 2 / side);
    const y0 = Math.max(0, Math.floor(c.y - size.height / 2 / side));
    const y1 = Math.min(last, Math.floor(c.y + size.height / 2 / side));
    const list: { key: string; url: string; left: number; top: number; side: number }[] = [];
    for (let y = y0; y <= y1; y += 1) {
      for (let x = Math.max(0, x0); x <= Math.min(last, x1); x += 1) {
        list.push({
          key: `${provider.id}/${level}/${x}/${y}`,
          url: tileUrl(provider, level, x, y),
          left: size.width / 2 + (x - c.x) * side,
          top: size.height / 2 + (y - c.y) * side,
          side,
        });
      }
    }
    return list;
  }, [provider, view, size]);

  const projected = picked && crs ? geographicToProjected(crs, picked) : null;
  const offZone =
    picked && crs ? Math.abs(picked.lon - crs.centralMeridian) > ZONE_HALF_WIDTH : false;
  const suggested = picked ? Math.floor((picked.lon + 180) / 6) + 1 : null;
  const marker = picked ? toScreen(picked) : null;

  const goToSearch = (): void => {
    const pair = parseCoordinatePair(search);
    if (!pair || Math.abs(pair.a) > 85 || Math.abs(pair.b) > 180) {
      useEditorStore
        .getState()
        .notify('error', 'Informe latitude e longitude em graus decimais (ex.: -15,60; -56,10).');
      return;
    }
    setView((v) => ({ center: { lat: pair.a, lon: pair.b }, zoom: Math.max(v.zoom, 14) }));
  };

  const confirm = (): void => {
    if (!picked || !projected || !crs || offZone || !provider) return;
    const store = useEditorStore.getState();
    const round = (value: number): number => Math.round(value * 1000) / 1000;
    const georeference: Georeference = {
      crsName: crs.name,
      epsg: crs.epsg,
      eastings: round(projected.e),
      northings: round(projected.n),
      // A altitude e a referência altimétrica não vêm do mapa: ficam como estavam (ou não
      // informadas) até o usuário digitá-las.
      orthogonalHeight: current?.orthogonalHeight ?? 0,
      rotation: 0,
      verticalDatum: current?.verticalDatum ?? null,
    };
    store.setGeoreference(georeference);
    store.changeInfraSettings({ basemap: { sourceId: provider.id, visible: true } });
    store.setGeoPicker(false);
    onDone(tileGroundResolution(picked.lat, view.zoom, TILE));
  };

  return (
    <div className="geopicker" data-testid="geo-picker">
      <div
        ref={frame}
        className="geopicker__map"
        data-testid="geo-picker-map"
        data-zoom={view.zoom}
        data-center={`${view.center.lat.toFixed(6)};${view.center.lon.toFixed(6)}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(event) => event.preventDefault()}
      >
        {tiles.map((tile) => (
          <img
            key={tile.key}
            src={tile.url}
            alt=""
            draggable={false}
            style={{ left: tile.left, top: tile.top, width: tile.side, height: tile.side }}
          />
        ))}
        {marker && (
          <span
            className="geopicker__marker"
            data-testid="geo-picker-marker"
            style={{ left: marker.x, top: marker.y }}
          >
            <MapPin size={30} />
          </span>
        )}
      </div>

      <div className="geopicker__panel" onKeyDown={(event) => event.stopPropagation()}>
        <header>
          <strong>Georreferenciar pelo mapa</strong>
          <button
            type="button"
            className="btn btn--icon"
            data-testid="geo-picker-close"
            aria-label="Fechar"
            onClick={() => useEditorStore.getState().setGeoPicker(false)}
          >
            <X size={16} />
          </button>
        </header>
        <span className="muted">
          Navegue até a área do projeto e clique no ponto que será a origem (0; 0) do modelo.
          Depois, modele sobre o mapa na Planta Infra.
          {hasElements && ' Os elementos já modelados acompanham a origem.'}
        </span>
        <label className="plan__field">
          <span>Tema</span>
          <select
            data-testid="geo-picker-theme"
            value={provider?.id ?? ''}
            onChange={(event) => setThemeId(event.target.value)}
          >
            {providers.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>
        {overzoom && provider && (
          <span className="warn" data-testid="geo-picker-resolution">
            Ampliação além da resolução desta fonte
            {provider.resolution !== null ? ` (≈ ${provider.resolution} m por pixel)` : ''}: a
            imagem aparece borrada. Para localizar com precisão, use o tema Ruas ou cadastre uma
            fonte própria de alta resolução.
          </span>
        )}
        <details className="infra__custom-toggle">
          <summary data-testid="geo-picker-custom">Fonte de mapa própria (alta resolução)</summary>
          <CustomSourceForm />
        </details>
        <label className="plan__field">
          <span>Fuso UTM</span>
          <select
            data-testid="geo-picker-zone"
            value={zone}
            onChange={(event) => setZone(Number(event.target.value))}
            title="Sistema projetado do projeto: SIRGAS 2000 / UTM, hemisfério sul"
          >
            {PICKER_ZONES.map((z) => (
              <option key={z} value={z}>
                SIRGAS 2000 / UTM {z}S (EPSG:{epsgOfZone(z)})
              </option>
            ))}
          </select>
        </label>
        <label className="plan__field">
          <span>Ir para</span>
          <input
            className="infra__goto"
            data-testid="geo-picker-search"
            value={search}
            placeholder="latitude; longitude"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') goToSearch();
            }}
          />
        </label>
        <div className="geopicker__result" data-testid="geo-picker-result">
          {picked && projected ? (
            <>
              <span data-testid="geo-picker-geographic">
                Latitude {picked.lat.toFixed(6)}° · Longitude {picked.lon.toFixed(6)}°
              </span>
              <span data-testid="geo-picker-projected">
                E {formatCoordinate(projected.e, 3)} m · N {formatCoordinate(projected.n, 3)} m
              </span>
            </>
          ) : (
            <span className="muted">Nenhum ponto escolhido.</span>
          )}
        </div>
        {offZone && suggested !== null && (
          <span className="warn" data-testid="geo-picker-warning">
            O ponto está fora do fuso {zone}S (pertence ao fuso {suggested}). Escolha o fuso
            correspondente para continuar.
          </span>
        )}
        <div className="chips">
          <button
            type="button"
            className="btn btn--primary"
            data-testid="geo-picker-confirm"
            disabled={!picked || offZone}
            onClick={confirm}
          >
            Definir origem neste ponto
          </button>
          <button
            type="button"
            className="btn"
            data-testid="geo-picker-form"
            onClick={() => {
              const store = useEditorStore.getState();
              store.setGeoPicker(false);
              store.openProjectDialog('georeference');
            }}
            title="Informar o EPSG e as coordenadas E/N do levantamento, a rotação e a referência altimétrica"
          >
            Informar coordenadas…
          </button>
        </div>
        {provider && (
          <span className="geopicker__attribution" data-testid="geo-picker-attribution">
            <a href={provider.attributionUrl} target="_blank" rel="noreferrer noopener">
              {provider.attribution}
            </a>{' '}
            ·{' '}
            <a href={provider.licenseUrl} target="_blank" rel="noreferrer noopener">
              {provider.license}
            </a>
          </span>
        )}
      </div>
    </div>
  );
}
