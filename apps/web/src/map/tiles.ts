import {
  geographicToTile,
  tileGroundResolution,
  tileToGeographic,
  type GeoTransform,
  type LocalPoint,
} from '@hydrobim/core';
import { tileUrl, type BasemapProvider } from './providers';

/**
 * Ladrilhos do mapa de fundo para uma janela da planta. Funções puras: recebem a cadeia de
 * transformações do projeto e a janela visível (coordenadas locais, m) e devolvem que
 * ladrilhos pedir e onde cada um fica no modelo.
 *
 * O mapa é que se ajusta ao projeto, nunca o contrário: cada ladrilho (um quadrado em Web
 * Mercator) é colocado sobre a quadrícula do projeto por uma transformação afim definida pelos
 * seus cantos. Nenhuma coordenada de engenharia é lida da imagem.
 */

export interface ViewBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface PlacedTile {
  readonly key: string;
  readonly zoom: number;
  readonly x: number;
  readonly y: number;
  readonly url: string;
  /** Cantos do ladrilho em coordenadas locais do projeto (m). */
  readonly northWest: LocalPoint;
  readonly northEast: LocalPoint;
  readonly southWest: LocalPoint;
}

export interface TileSet {
  readonly zoom: number;
  readonly tiles: readonly PlacedTile[];
  /** A vista pede mais detalhe do que a fonte tem: a imagem aparece ampliada. */
  readonly overzoom: boolean;
  /**
   * A vista é ampla demais para a fonte: nada é pedido (um ladrilho cobriria dezenas de
   * quilômetros e a colocação afim deixaria de ser exata).
   */
  readonly tooWide: boolean;
}

/** Limite de ladrilhos por vista: carrega só a região visível, com folga para telas grandes. */
export const MAX_TILES = 64;

const EMPTY: TileSet = { zoom: 0, tiles: [], overzoom: false, tooWide: false };

function cornersOf(bounds: ViewBounds): LocalPoint[] {
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY) / 2;
  // Cantos e meios dos lados: com a quadrícula girada em relação ao mapa, os extremos em
  // ladrilhos podem estar em qualquer um deles.
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
    { x: midX, y: bounds.minY },
    { x: midX, y: bounds.maxY },
    { x: bounds.minX, y: midY },
    { x: bounds.maxX, y: midY },
  ];
}

export function placeTile(
  transform: GeoTransform,
  provider: BasemapProvider,
  zoom: number,
  x: number,
  y: number,
): PlacedTile {
  const corner = (cx: number, cy: number): LocalPoint =>
    transform.geographicToLocal(tileToGeographic({ x: cx, y: cy }, zoom));
  return {
    key: `${provider.id}/${zoom}/${x}/${y}`,
    zoom,
    x,
    y,
    url: tileUrl(provider, zoom, x, y),
    northWest: corner(x, y),
    northEast: corner(x + 1, y),
    southWest: corner(x, y + 1),
  };
}

/**
 * Ladrilhos que cobrem a janela `bounds` vista a `metersPerPixel` metros do modelo por pixel
 * de tela. O nível escolhido é o primeiro em que um pixel do ladrilho não fica maior que um
 * pixel de tela, limitado ao que a fonte oferece e a `MAX_TILES` ladrilhos.
 */
export function tilesForView(
  transform: GeoTransform,
  provider: BasemapProvider,
  bounds: ViewBounds,
  metersPerPixel: number,
  maxTiles = MAX_TILES,
): TileSet {
  const finite = [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, metersPerPixel].every(
    Number.isFinite,
  );
  if (!finite || metersPerPixel <= 0 || bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) {
    return EMPTY;
  }
  const center = transform.localToGeographic({
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  });
  const wanted = Math.ceil(
    Math.log2(tileGroundResolution(center.lat, 0, provider.tileSize) / metersPerPixel),
  );
  const geographic = cornersOf(bounds).map((point) => transform.localToGeographic(point));

  for (let zoom = Math.min(wanted, provider.maxZoom); zoom >= provider.minZoom; zoom -= 1) {
    const points = geographic.map((point) => geographicToTile(point, zoom));
    const last = 2 ** zoom - 1;
    const clamp = (value: number): number => Math.min(last, Math.max(0, Math.floor(value)));
    const minX = clamp(Math.min(...points.map((p) => p.x)));
    const maxX = clamp(Math.max(...points.map((p) => p.x)));
    const minY = clamp(Math.min(...points.map((p) => p.y)));
    const maxY = clamp(Math.max(...points.map((p) => p.y)));
    if ((maxX - minX + 1) * (maxY - minY + 1) > maxTiles) continue;
    const tiles: PlacedTile[] = [];
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) tiles.push(placeTile(transform, provider, zoom, x, y));
    }
    return { zoom, tiles, overzoom: wanted > provider.maxZoom, tooWide: false };
  }
  return { ...EMPTY, tooWide: true };
}

/**
 * Matriz SVG `matrix(a b c d e f)` que leva a imagem do ladrilho (quadrado unitário, canto
 * noroeste na origem) à sua posição no desenho. `origin` é a origem de desenho da planta: o
 * SVG mostra as coordenadas locais menos esse ponto, com o eixo Y invertido.
 */
export function tileMatrix(
  tile: PlacedTile,
  origin: LocalPoint,
): [number, number, number, number, number, number] {
  // A parte linear não depende da origem: só a translação acompanha o deslocamento.
  return [
    tile.northEast.x - tile.northWest.x,
    -(tile.northEast.y - tile.northWest.y),
    tile.southWest.x - tile.northWest.x,
    -(tile.southWest.y - tile.northWest.y),
    tile.northWest.x - origin.x,
    -(tile.northWest.y - origin.y),
  ];
}

/**
 * Ponto local onde a colocação afim do ladrilho desenha a posição fracionária (u, v) da
 * imagem (0 a 1, a partir do canto noroeste). Usado para medir o erro da colocação.
 */
export function tilePointToLocal(tile: PlacedTile, u: number, v: number): LocalPoint {
  return {
    x:
      tile.northWest.x +
      u * (tile.northEast.x - tile.northWest.x) +
      v * (tile.southWest.x - tile.northWest.x),
    y:
      tile.northWest.y +
      u * (tile.northEast.y - tile.northWest.y) +
      v * (tile.southWest.y - tile.northWest.y),
  };
}
