import type { Geographic } from './projection';

/**
 * Esquema de ladrilhos "GoogleMapsCompatible" (EPSG:3857, Web Mercator): no nível `z` o mundo
 * tem 2^z ladrilhos por lado; a coluna cresce para leste e a linha, para sul. É só o
 * referencial em que os serviços de mapa entregam imagens — nenhuma medida de engenharia é
 * feita nele.
 */

/** Latitude limite do Web Mercator (graus). */
export const WEB_MERCATOR_MAX_LATITUDE = 85.0511287798066;

export interface TilePoint {
  /** Coluna fracionária (0 no antimeridiano oeste). */
  readonly x: number;
  /** Linha fracionária (0 no limite norte). */
  readonly y: number;
}

const RAD = Math.PI / 180;

export function geographicToTile(point: Geographic, zoom: number): TilePoint {
  const size = 2 ** zoom;
  const lat = Math.max(-WEB_MERCATOR_MAX_LATITUDE, Math.min(WEB_MERCATOR_MAX_LATITUDE, point.lat));
  return {
    x: ((point.lon + 180) / 360) * size,
    y: ((1 - Math.asinh(Math.tan(lat * RAD)) / Math.PI) / 2) * size,
  };
}

export function tileToGeographic(point: TilePoint, zoom: number): Geographic {
  const size = 2 ** zoom;
  return {
    lon: (point.x / size) * 360 - 180,
    lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * point.y) / size))) / RAD,
  };
}

/** Metros no terreno por pixel de um ladrilho de `tileSize` px, na latitude dada. */
export function tileGroundResolution(latitude: number, zoom: number, tileSize = 256): number {
  return (Math.cos(latitude * RAD) * 2 * Math.PI * 6378137) / (tileSize * 2 ** zoom);
}
