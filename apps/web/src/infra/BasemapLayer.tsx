import type { GeoTransform, Point2 } from '@hydrobim/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BasemapProvider } from '../map/providers';
import { tileMatrix, tilesForView, type TileSet, type ViewBounds } from '../map/tiles';

/**
 * Estado do mapa de fundo, para a interface:
 *  - `loading`: há ladrilhos a caminho;
 *  - `ready`: todos os ladrilhos da vista chegaram;
 *  - `partial`: parte dos ladrilhos falhou;
 *  - `unavailable`: nenhum ladrilho da vista pôde ser carregado;
 *  - `offline`: o navegador está sem conexão — nada é pedido;
 *  - `tooWide`: a vista é ampla demais para a fonte.
 */
export type BasemapState = 'loading' | 'ready' | 'partial' | 'unavailable' | 'offline' | 'tooWide';

export interface BasemapStatus {
  readonly state: BasemapState;
  readonly zoom: number;
  readonly overzoom: boolean;
  readonly total: number;
  readonly loaded: number;
  readonly failed: number;
}

interface Props {
  transform: GeoTransform;
  provider: BasemapProvider;
  /** Janela visível, em coordenadas locais (m). */
  bounds: ViewBounds;
  metersPerPixel: number;
  /** Origem de desenho da planta. */
  origin: Point2;
  opacity: number;
  /** Muda para tentar de novo os ladrilhos que falharam. */
  retry: number;
  onStatus: (status: BasemapStatus) => void;
  /** Identificação da camada nos testes (o mapa sobre o terreno usa a sua). */
  testId?: string;
}

/** Espera (ms) para a vista assentar antes de pedir ladrilhos: zoom e arrasto não geram rajadas. */
const SETTLE_MS = 140;

/**
 * Imagem de fundo da Planta Infra. Só apresentação: os ladrilhos são elementos `<image>` do
 * SVG posicionados pela cadeia de transformações do projeto. Ao sair da vista, o elemento é
 * removido e o navegador cancela a requisição em andamento. Uma falha (rede, limite do
 * serviço) apenas deixa o fundo sem imagem — a planta e a edição não dependem dela.
 */
export function BasemapLayer({
  transform,
  provider,
  bounds,
  metersPerPixel,
  origin,
  opacity,
  retry,
  onStatus,
  testId = 'basemap-layer',
}: Props) {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // A janela é arredondada antes de entrar nas dependências: arrastar poucos pixels não
  // recalcula o conjunto de ladrilhos.
  const [settled, setSettled] = useState<{ bounds: ViewBounds; mpp: number } | null>(null);
  const { minX, minY, maxX, maxY } = bounds;
  useEffect(() => {
    const timer = window.setTimeout(
      () => setSettled({ bounds: { minX, minY, maxX, maxY }, mpp: metersPerPixel }),
      SETTLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [minX, minY, maxX, maxY, metersPerPixel]);

  const set: TileSet | null = useMemo(
    () =>
      settled && online ? tilesForView(transform, provider, settled.bounds, settled.mpp) : null,
    [settled, online, transform, provider],
  );

  // Resultado por ladrilho. Sobrevive às mudanças de vista: um ladrilho que já chegou não volta
  // a contar como pendente.
  const results = useRef(new Map<string, 'loaded' | 'failed'>());
  const [version, setVersion] = useState(0);
  useEffect(() => {
    results.current.clear();
    setVersion((v) => v + 1);
  }, [provider, retry, online]);

  const mark = (key: string, result: 'loaded' | 'failed'): void => {
    if (results.current.get(key) === result) return;
    results.current.set(key, result);
    setVersion((v) => v + 1);
  };

  const status: BasemapStatus = useMemo(() => {
    const total = set?.tiles.length ?? 0;
    let loaded = 0;
    let failed = 0;
    for (const tile of set?.tiles ?? []) {
      const result = results.current.get(tile.key);
      if (result === 'loaded') loaded += 1;
      else if (result === 'failed') failed += 1;
    }
    const state: BasemapState = !online
      ? 'offline'
      : set?.tooWide
        ? 'tooWide'
        : total > 0 && failed === total
          ? 'unavailable'
          : loaded + failed < total || !set
            ? 'loading'
            : failed > 0
              ? 'partial'
              : 'ready';
    return { state, zoom: set?.zoom ?? 0, overzoom: set?.overzoom ?? false, total, loaded, failed };
    // `version` muda a cada ladrilho resolvido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set, online, version]);

  const { state, zoom, overzoom, total, loaded, failed } = status;
  useEffect(() => {
    onStatus({ state, zoom, overzoom, total, loaded, failed });
  }, [onStatus, state, zoom, overzoom, total, loaded, failed]);

  return (
    <g
      data-ui="basemap"
      data-testid={testId}
      data-zoom={zoom}
      data-state={state}
      opacity={opacity}
      pointerEvents="none"
    >
      {set?.tiles.map((tile) =>
        results.current.get(tile.key) === 'failed' ? null : (
          <image
            key={`${tile.key}#${retry}`}
            data-tile={`${tile.zoom}/${tile.x}/${tile.y}`}
            href={tile.url}
            width={1}
            height={1}
            preserveAspectRatio="none"
            transform={`matrix(${tileMatrix(tile, origin).join(' ')})`}
            onLoad={() => mark(tile.key, 'loaded')}
            onError={() => mark(tile.key, 'failed')}
          />
        ),
      )}
    </g>
  );
}
