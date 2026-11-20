import type { Georeference } from '../schema';
import { findProjectedCrs, SUPPORTED_CRS_SUMMARY, type ProjectedCrs } from './crs';
import {
  geographicToProjected,
  gridFactors,
  projectedToGeographic,
  type Geographic,
  type GridFactors,
  type Projected,
} from './projection';

/**
 * Cadeia de referenciais do projeto, explícita e testável:
 *
 *   local do modelo (x, y, z; m)
 *     ⇄ projetado do projeto (E, N; m)      — translação + rotação da georreferência,
 *                                              exatamente o `IfcMapConversion` exportado
 *     ⇄ geográfico no datum do sistema       — projeção Transversa de Mercator
 *     ⇄ geográfico do mapa (WGS 84)          — transformação de datum declarada no registro
 *
 * As medidas de engenharia (comprimentos, cotas, deflexões) são sempre tomadas no referencial
 * local. Esta cadeia serve para posicionar o mapa, informar coordenadas e exportar.
 */

/**
 * Tolerância (m) de ida e volta entre os referenciais. É cinco vezes menor que a tolerância de
 * acoplamento das portas (0,5 mm): converter um ponto e trazê-lo de volta nunca desfaz uma
 * conexão. O erro real das séries é da ordem de 1e-8 m (ver `geo.test.ts`).
 */
export const GEO_ROUNDTRIP_TOLERANCE = 1e-4;

export interface LocalPoint {
  readonly x: number;
  readonly y: number;
}

export interface GeoTransform {
  readonly crs: ProjectedCrs;
  localToProjected(point: LocalPoint): Projected;
  projectedToLocal(point: Projected): LocalPoint;
  localToGeographic(point: LocalPoint): Geographic;
  geographicToLocal(point: Geographic): LocalPoint;
  /** Altitude no referencial vertical do projeto para a cota local `z`. */
  localToHeight(z: number): number;
  /** Fator de escala e convergência da quadrícula no ponto local. */
  factorsAt(point: LocalPoint): GridFactors;
}

/** Local → projetado: a mesma conversão gravada no `IfcMapConversion` (escala 1). */
export function localToProjected(geo: Georeference, point: LocalPoint): Projected {
  const cos = Math.cos(geo.rotation);
  const sin = Math.sin(geo.rotation);
  return {
    e: geo.eastings + point.x * cos - point.y * sin,
    n: geo.northings + point.x * sin + point.y * cos,
  };
}

export function projectedToLocal(geo: Georeference, point: Projected): LocalPoint {
  const cos = Math.cos(geo.rotation);
  const sin = Math.sin(geo.rotation);
  const de = point.e - geo.eastings;
  const dn = point.n - geo.northings;
  return { x: de * cos + dn * sin, y: -de * sin + dn * cos };
}

export function createGeoTransform(geo: Georeference, crs: ProjectedCrs): GeoTransform {
  return {
    crs,
    localToProjected: (point) => localToProjected(geo, point),
    projectedToLocal: (point) => projectedToLocal(geo, point),
    localToGeographic: (point) => projectedToGeographic(crs, localToProjected(geo, point)),
    geographicToLocal: (point) => projectedToLocal(geo, geographicToProjected(crs, point)),
    localToHeight: (z) => z + geo.orthogonalHeight,
    factorsAt: (point) => gridFactors(crs, localToProjected(geo, point)),
  };
}

/**
 * Estado do georreferenciamento do projeto:
 *  - `pending`: nada informado — nenhuma posição geográfica é presumida;
 *  - `unsupported`: informado, mas sem EPSG ou em um sistema que o HydroBIM não converte: vale
 *    para a exportação IFC e para as coordenadas E/N, não para o mapa;
 *  - `invalid`: a origem informada não pertence ao domínio do fuso;
 *  - `ready`: a cadeia completa de transformações está disponível.
 */
export type GeoreferenceStatus =
  | { readonly state: 'pending'; readonly message: string }
  | { readonly state: 'unsupported'; readonly message: string }
  | { readonly state: 'invalid'; readonly message: string; readonly crs: ProjectedCrs }
  | {
      readonly state: 'ready';
      readonly message: string;
      readonly crs: ProjectedCrs;
      readonly transform: GeoTransform;
    };

/** Faixa de E aceita em um fuso UTM (m): cobre os 3° de cada lado do meridiano central. */
const EASTING_RANGE = [100_000, 900_000] as const;

export function georeferenceStatus(geo: Georeference | null): GeoreferenceStatus {
  if (!geo) {
    return {
      state: 'pending',
      message:
        'Georreferenciamento pendente: informe o sistema de referência (EPSG) e as coordenadas da origem.',
    };
  }
  if (geo.epsg === null) {
    return {
      state: 'unsupported',
      message: `Sem código EPSG não é possível posicionar o mapa. Sistemas aceitos: ${SUPPORTED_CRS_SUMMARY}.`,
    };
  }
  const crs = findProjectedCrs(geo.epsg);
  if (!crs) {
    return {
      state: 'unsupported',
      message: `O EPSG:${geo.epsg} não tem transformação implementada para o mapa (datum ou projeção fora do registro). A georreferência continua valendo para o IFC. Sistemas aceitos: ${SUPPORTED_CRS_SUMMARY}.`,
    };
  }
  const [minE, maxE] = EASTING_RANGE;
  const maxN = crs.hemisphere === 'S' ? 10_000_000 : 9_400_000;
  const minN = crs.hemisphere === 'S' ? 1_000_000 : 0;
  if (geo.eastings < minE || geo.eastings > maxE) {
    return {
      state: 'invalid',
      crs,
      message: `Este (E) da origem fora do fuso ${crs.zone}${crs.hemisphere}: o esperado fica entre ${minE} m e ${maxE} m.`,
    };
  }
  if (geo.northings < minN || geo.northings > maxN) {
    return {
      state: 'invalid',
      crs,
      message: `Norte (N) da origem fora do hemisfério ${crs.hemisphere === 'S' ? 'sul' : 'norte'} do sistema: o esperado fica entre ${minN} m e ${maxN} m.`,
    };
  }
  return {
    state: 'ready',
    crs,
    transform: createGeoTransform(geo, crs),
    message: `${crs.name} (EPSG:${crs.epsg})`,
  };
}
