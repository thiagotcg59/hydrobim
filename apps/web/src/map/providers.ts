/**
 * Registro das fontes de mapa de fundo. É a única parte do editor que conhece serviços de
 * mapa: o domínio hidráulico guarda apenas o identificador da fonte escolhida
 * (`project.infra.basemap.sourceId`) e nada mede sobre a imagem.
 *
 * Só entram aqui serviços públicos, documentados, sem chave e sem custo, com licença que
 * permita o uso em um editor de engenharia. Cada entrada cita onde a licença e o endereço foram
 * conferidos (ver `docs/INFRA.md` e ADR-021). Uma ortofoto georreferenciada fornecida pelo
 * usuário entrará como outro tipo de fonte, sem alterar o restante.
 */

import { customProvider, type CustomBasemapSource } from './customSource';

export interface BasemapProvider {
  readonly id: string;
  readonly name: string;
  /** Endereço dos ladrilhos, com `{z}` (nível), `{x}` (coluna) e `{y}` (linha). */
  readonly urlTemplate: string;
  /** Lado do ladrilho (px). */
  readonly tileSize: number;
  /**
   * Menor nível usado. Abaixo dele um ladrilho cobre dezenas de quilômetros e a sua colocação
   * sobre a quadrícula do projeto (uma transformação afim por ladrilho) deixaria de ser exata.
   */
  readonly minZoom: number;
  /** Maior nível com imagem própria; além dele a imagem é só ampliada na tela. */
  readonly maxZoom: number;
  /** Resolução no terreno da imagem de origem (m), quando conhecida. */
  readonly resolution: number | null;
  /** Época das imagens, quando conhecida. */
  readonly imageryDate: string | null;
  /** Atribuição exigida pela licença, exibida sempre que a imagem está visível. */
  readonly attribution: string;
  readonly attributionUrl: string;
  readonly license: string;
  readonly licenseUrl: string;
  /** Onde a licença, a atribuição e o endereço foram conferidos. */
  readonly termsSource: string;
  readonly permissions: {
    /** A licença permite reproduzir a imagem em pranchas impressas e arquivos exportados? */
    readonly export: boolean;
    /** O serviço permite guardar ladrilhos para uso sem conexão? */
    readonly offlineCache: boolean;
    readonly notes: string;
  };
}

/**
 * Sentinel-2 cloudless 2016, da EOX. Conferido em 2026-11-18 no documento de capacidades do
 * serviço WMTS (`https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml`): camada
 * `s2cloudless_3857`, conjunto `GoogleMapsCompatible`, formato JPEG, resumo "EOxCloudless
 * https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data
 * 2016) released under Creative Commons Attribution 4.0 International License". As camadas de
 * 2018 em diante são CC BY-NC-SA e NÃO podem ser usadas aqui. Ladrilhos reais conferidos por
 * requisição até o nível 14 (a partir do 15 o serviço apenas amplia a imagem); a camada de 2017
 * respondeu ladrilhos vazios sobre o Brasil e por isso não foi adotada.
 */
const EOX_S2_2016: BasemapProvider = {
  id: 'eox-s2cloudless-2016',
  name: 'Satélite — Sentinel-2 cloudless 2016 (EOX)',
  urlTemplate:
    'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
  tileSize: 256,
  minZoom: 10,
  maxZoom: 14,
  // Bandas visíveis do Sentinel-2 (ESA): 10 m.
  resolution: 10,
  imageryDate: '2016',
  attribution:
    'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)',
  attributionUrl: 'https://maps.eox.at/',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  termsSource:
    'https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml (licença e atribuição da camada) e https://maps.eox.at/ (condições do serviço), conferidos em 2026-11-18',
  permissions: {
    export: true,
    offlineCache: false,
    notes:
      'A licença CC BY 4.0 permite reproduzir a imagem com a atribuição. O serviço é de demonstração, sem garantia de disponibilidade e com limite de requisições: nada é pré-carregado nem guardado para uso sem conexão.',
  },
};

/**
 * Mapa de ruas do OpenStreetMap (ladrilhos padrão da OpenStreetMap Foundation). Conferido em
 * 2026-11-18 na política de uso dos ladrilhos (https://operations.osmfoundation.org/policies/tiles/):
 * endereço `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, atribuição visível obrigatória,
 * respeito aos cabeçalhos de cache, proibidos o download em massa, o pré-carregamento e o uso
 * sem conexão; serviço sem garantia de disponibilidade. Dados sob ODbL.
 */
const OSM_STREETS: BasemapProvider = {
  id: 'osm-standard',
  name: 'Ruas — OpenStreetMap',
  urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileSize: 256,
  minZoom: 10,
  maxZoom: 19,
  resolution: null,
  imageryDate: null,
  attribution: '© colaboradores do OpenStreetMap',
  attributionUrl: 'https://www.openstreetmap.org/copyright',
  license: 'ODbL',
  licenseUrl: 'https://opendatacommons.org/licenses/odbl/',
  termsSource:
    'https://operations.osmfoundation.org/policies/tiles/ e https://www.openstreetmap.org/copyright, conferidos em 2026-11-18',
  permissions: {
    // A política trata só da exibição na tela; a reprodução em pranchas não é incluída aqui.
    export: false,
    offlineCache: false,
    notes:
      'Uso para exibição na tela, com atribuição visível. A política do serviço proíbe download em massa, pré-carregamento e uso sem conexão; o acesso pode ser bloqueado sem aviso em caso de uso intenso.',
  },
};

export const BASEMAP_PROVIDERS: readonly BasemapProvider[] = [EOX_S2_2016, OSM_STREETS];

/** Fontes disponíveis: as embutidas e, se configurada neste navegador, a personalizada. */
export function basemapProviders(custom: CustomBasemapSource | null): BasemapProvider[] {
  return custom ? [...BASEMAP_PROVIDERS, customProvider(custom)] : [...BASEMAP_PROVIDERS];
}

/**
 * Fonte de mapa pelo identificador; `null` = fundo técnico limpo, fonte desconhecida ou fonte
 * personalizada ainda não configurada neste navegador.
 */
export function findBasemapProvider(
  id: string | null,
  custom: CustomBasemapSource | null = null,
): BasemapProvider | null {
  if (id === null) return null;
  return basemapProviders(custom).find((provider) => provider.id === id) ?? null;
}

export function tileUrl(provider: BasemapProvider, zoom: number, x: number, y: number): string {
  return provider.urlTemplate
    .replace('{z}', String(zoom))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}
