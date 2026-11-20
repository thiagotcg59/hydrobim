/**
 * Sistemas de referência projetados que o HydroBIM sabe converter para coordenadas
 * geográficas. O registro é deliberadamente pequeno: só entram sistemas cuja projeção e cujo
 * datum estão implementados e conferidos contra o PROJ (ver `geo.test.ts`). Qualquer outro
 * código EPSG continua válido para a exportação IFC, mas não posiciona o mapa — nunca é
 * aproximado por um sistema "parecido".
 *
 * Parâmetros conferidos com o banco EPSG distribuído no PROJ 9.8.1 (pyproj 3.8.0).
 */

export interface Ellipsoid {
  readonly name: string;
  /** Semieixo maior (m). */
  readonly a: number;
  readonly inverseFlattening: number;
}

export const GRS80: Ellipsoid = { name: 'GRS 1980', a: 6378137, inverseFlattening: 298.257222101 };
export const WGS84: Ellipsoid = { name: 'WGS 84', a: 6378137, inverseFlattening: 298.257223563 };

export type GeodeticDatum = 'SIRGAS 2000' | 'WGS 84';

/** Sistema projetado UTM (Transversa de Mercator), eixos E (leste) e N (norte), em metros. */
export interface ProjectedCrs {
  readonly epsg: number;
  /** Nome do sistema no banco EPSG. */
  readonly name: string;
  readonly datum: GeodeticDatum;
  readonly ellipsoid: Ellipsoid;
  readonly zone: number;
  readonly hemisphere: 'N' | 'S';
  /** Meridiano central (graus). */
  readonly centralMeridian: number;
  readonly scaleFactor: number;
  readonly falseEasting: number;
  readonly falseNorthing: number;
  /**
   * Exatidão (m) da passagem do datum do sistema para o WGS 84 usado pelos mapas. SIRGAS 2000
   * → WGS 84 é a transformação nula EPSG:15485, com exatidão declarada de 1 m; para o próprio
   * WGS 84 não há transformação.
   */
  readonly datumToMapAccuracy: number;
}

const UTM_SCALE = 0.9996;
const UTM_FALSE_EASTING = 500_000;

function utm(
  epsg: number,
  datum: GeodeticDatum,
  zone: number,
  hemisphere: 'N' | 'S',
): ProjectedCrs {
  return {
    epsg,
    name: `${datum} / UTM zone ${zone}${hemisphere}`,
    datum,
    ellipsoid: datum === 'SIRGAS 2000' ? GRS80 : WGS84,
    zone,
    hemisphere,
    centralMeridian: zone * 6 - 183,
    scaleFactor: UTM_SCALE,
    falseEasting: UTM_FALSE_EASTING,
    falseNorthing: hemisphere === 'S' ? 10_000_000 : 0,
    datumToMapAccuracy: datum === 'SIRGAS 2000' ? 1 : 0,
  };
}

/** Sistema projetado suportado para o código EPSG; `null` = não suportado (nada é presumido). */
export function findProjectedCrs(epsg: number): ProjectedCrs | null {
  if (!Number.isInteger(epsg)) return null;
  // SIRGAS 2000 / UTM: fusos 11N a 22N, 17S a 25S e os códigos avulsos 23N, 24N e 26S.
  if (epsg >= 31965 && epsg <= 31976) return utm(epsg, 'SIRGAS 2000', epsg - 31954, 'N');
  if (epsg >= 31977 && epsg <= 31985) return utm(epsg, 'SIRGAS 2000', epsg - 31960, 'S');
  if (epsg === 6210) return utm(epsg, 'SIRGAS 2000', 23, 'N');
  if (epsg === 6211) return utm(epsg, 'SIRGAS 2000', 24, 'N');
  if (epsg === 5396) return utm(epsg, 'SIRGAS 2000', 26, 'S');
  // WGS 84 / UTM: fusos 1 a 60, norte e sul.
  if (epsg >= 32601 && epsg <= 32660) return utm(epsg, 'WGS 84', epsg - 32600, 'N');
  if (epsg >= 32701 && epsg <= 32760) return utm(epsg, 'WGS 84', epsg - 32700, 'S');
  return null;
}

/** Texto para a interface: quais sistemas posicionam o mapa. */
export const SUPPORTED_CRS_SUMMARY =
  'SIRGAS 2000 / UTM (EPSG 31965 a 31985, 5396, 6210 e 6211) e WGS 84 / UTM (EPSG 32601 a 32660 e 32701 a 32760)';
