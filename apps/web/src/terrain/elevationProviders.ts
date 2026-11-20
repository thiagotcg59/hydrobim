/**
 * Registro das fontes de elevação em ladrilhos (DEM). É a única parte do editor que conhece
 * serviços de elevação: o domínio recebe um raster e a procedência (`TerrainSource`).
 *
 * Cada fonte declara o que a documentação dela declara — e só isso. Resolução do ladrilho não
 * é exatidão altimétrica: nenhuma das fontes abaixo informa exatidão nem uma referência
 * altimétrica única, e por isso os dois campos ficam não informados na superfície gerada.
 * Chaves de acesso são do usuário e ficam só no navegador (como a fonte de mapa própria).
 */

export type ElevationEncoding = 'terrarium' | 'mapbox';

export interface ElevationTileProvider {
  readonly id: string;
  readonly name: string;
  /** Endereço dos ladrilhos, com `{z}`, `{x}`, `{y}` e, se for o caso, `{token}`. */
  readonly urlTemplate: string;
  readonly encoding: ElevationEncoding;
  readonly tileSize: number;
  readonly minZoom: number;
  /** Maior nível servido. */
  readonly maxZoom: number;
  /**
   * Maior nível em que o ladrilho ainda corresponde à resolução nominal do dado de origem
   * fora das regiões com levantamento regional, quando a fonte o documenta. Acima dele o
   * serviço entrega o mesmo dado sobreamostrado. `null` = a fonte não informa a resolução de
   * origem; o editor então avisa em todos os níveis.
   */
  readonly nativeZoom: number | null;
  readonly requiresToken: boolean;
  /** Referência altimétrica declarada pela fonte; `null` = não declarada. */
  readonly verticalDatum: string | null;
  /** Exatidão altimétrica declarada (m); `null` = não declarada. */
  readonly verticalAccuracy: number | null;
  readonly attribution: string;
  readonly attributionUrl: string;
  /** Ressalvas da fonte, gravadas com a superfície. */
  readonly notes: string;
  /** Onde o endereço, a codificação e as condições foram conferidos. */
  readonly termsSource: string;
}

/**
 * Terrain Tiles (Mapzen/Tilezen), conjunto de dados abertos hospedado pela AWS. Conferido em
 * 2026-11-19: registro de dados abertos da AWS (https://registry.opendata.aws/terrain-tiles/ —
 * bucket `elevation-tiles-prod`, "No AWS account required") e documentação do projeto
 * (https://github.com/tilezen/joerd/tree/master/docs): endereço
 * `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, ladrilhos de
 * 256 px, níveis 0 a 15, codificação Terrarium `(R × 256 + G + B ÷ 256) − 32768` em metros.
 * Fontes por região: em terra, fora das regiões com levantamento próprio (EUA, Canadá, México,
 * parte da Europa, Austrália, Nova Zelândia), o dado é o SRTM, de 30 m nominais; a
 * documentação afirma que no nível 15 a maior parte dos valores é SRTM do nível 12
 * sobreamostrado. A documentação não declara referência altimétrica nem exatidão.
 */
const AWS_TERRARIUM: ElevationTileProvider = {
  id: 'aws-terrarium',
  name: 'Terrain Tiles (Mapzen/Tilezen, dados abertos na AWS)',
  urlTemplate: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  encoding: 'terrarium',
  tileSize: 256,
  minZoom: 8,
  maxZoom: 15,
  nativeZoom: 12,
  requiresToken: false,
  verticalDatum: null,
  verticalAccuracy: null,
  attribution:
    'Terrain Tiles (Mapzen/Tilezen): SRTM, GMTED2010 e 3DEP (USGS), ETOPO1 (NOAA) e fontes regionais listadas em github.com/tilezen/joerd/blob/master/docs/attribution.md',
  attributionUrl: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
  notes:
    'Mosaico de várias fontes; no Brasil o dado em terra é o SRTM (30 m nominais). A fonte não declara referência altimétrica nem exatidão: as cotas servem a estudos preliminares, não a projeto executivo.',
  termsSource:
    'https://registry.opendata.aws/terrain-tiles/ e https://github.com/tilezen/joerd/tree/master/docs (use-service, formats, data-sources, attribution), conferidos em 2026-11-19',
};

/**
 * Mapbox Terrain-RGB v1, pela Raster Tiles API. Conferido em 2026-11-19 em
 * https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-rgb-v1/: endereço
 * `https://api.mapbox.com/v4/mapbox.terrain-rgb/{z}/{x}/{y}.pngraw?access_token=…`,
 * codificação `−10000 + (R × 256² + G × 256 + B) × 0,1` m, dado até o nível 15 em ladrilhos de
 * 256 px, sem atualizações desde 2021-12-01. A página declara que as fontes variam com o nível
 * e o local e usam referências altimétricas diferentes (NAVD 88, EGM 96, Ordnance Datum
 * Newlyn, entre outras) — ou seja, não há um datum vertical único.
 *
 * O sucessor, Mapbox Terrain-DEM v1 (`mapbox.mapbox-terrain-dem-v1`, mesma codificação, dado
 * até o nível 14), tem na documentação a ressalva de que só está disponível pelos SDKs da
 * Mapbox, não pela Raster Tiles API. Por isso o conjunto é um campo que o usuário pode trocar
 * se a conta dele der esse acesso; o padrão é o conjunto documentado para a API.
 */
const MAPBOX_TERRAIN: ElevationTileProvider = {
  id: 'mapbox-terrain',
  name: 'Mapbox Terrain (chave do usuário)',
  urlTemplate: 'https://api.mapbox.com/v4/{tileset}/{z}/{x}/{y}.pngraw?access_token={token}',
  encoding: 'mapbox',
  tileSize: 256,
  minZoom: 8,
  maxZoom: 15,
  nativeZoom: null,
  requiresToken: true,
  verticalDatum: null,
  verticalAccuracy: null,
  attribution: '© Mapbox',
  attributionUrl: 'https://www.mapbox.com/about/maps/',
  notes:
    'Fontes e referências altimétricas variam com o local (declarado pela Mapbox); valores em passos de 0,1 m, que são a codificação, não a exatidão. O uso segue os termos da conta Mapbox do usuário.',
  termsSource:
    'https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-rgb-v1/ e https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-dem-v1/, conferidos em 2026-11-19',
};

export const ELEVATION_PROVIDERS: readonly ElevationTileProvider[] = [
  AWS_TERRARIUM,
  MAPBOX_TERRAIN,
];

export const MAPBOX_DEFAULT_TILESET = 'mapbox.terrain-rgb';

export function findElevationProvider(id: string): ElevationTileProvider | null {
  return ELEVATION_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

/** Cota (m) codificada em um pixel do ladrilho. */
export function decodeElevation(
  encoding: ElevationEncoding,
  r: number,
  g: number,
  b: number,
): number {
  return encoding === 'terrarium'
    ? r * 256 + g + b / 256 - 32768
    : -10000 + (r * 65536 + g * 256 + b) * 0.1;
}

/** Codificação inversa, usada nos testes para montar ladrilhos sintéticos. */
export function encodeElevation(
  encoding: ElevationEncoding,
  elevation: number,
): [number, number, number] {
  if (encoding === 'terrarium') {
    const value = Math.round((elevation + 32768) * 256);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }
  const value = Math.round((elevation + 10000) * 10);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

// ---------------------------------------------------------------------------
// Chave de acesso do usuário (só neste navegador)
// ---------------------------------------------------------------------------

export interface ElevationCredentials {
  readonly token: string;
  /** Identificador do conjunto de ladrilhos da Mapbox. */
  readonly tileset: string;
}

const STORAGE_KEY = 'hydrobim.terrain.mapbox';

export type CredentialsCheck =
  | { readonly ok: true; readonly value: ElevationCredentials }
  | { readonly ok: false; readonly message: string };

export function checkCredentials(input: { token: string; tileset: string }): CredentialsCheck {
  const token = input.token.trim();
  const tileset = input.tileset.trim() || MAPBOX_DEFAULT_TILESET;
  if (!/^pk\.[\w-]+\.[\w-]+$/.test(token)) {
    return {
      ok: false,
      message:
        'Informe a chave pública da sua conta Mapbox (começa com "pk."). Chaves secretas ("sk.") não devem ser usadas no navegador.',
    };
  }
  if (!/^[\w-]+\.[\w-]+$/.test(tileset)) {
    return { ok: false, message: 'Conjunto de ladrilhos inválido (ex.: mapbox.terrain-rgb).' };
  }
  return { ok: true, value: { token, tileset } };
}

export function loadCredentials(): ElevationCredentials | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ElevationCredentials>;
    const checked = checkCredentials({
      token: String(parsed.token ?? ''),
      tileset: String(parsed.tileset ?? ''),
    });
    return checked.ok ? checked.value : null;
  } catch {
    return null;
  }
}

export function storeCredentials(credentials: ElevationCredentials | null): void {
  try {
    if (credentials) globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(credentials));
    else globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Armazenamento indisponível (modo privado): a chave vale só para esta sessão.
  }
}

export function elevationTileUrl(
  provider: ElevationTileProvider,
  zoom: number,
  x: number,
  y: number,
  credentials: ElevationCredentials | null,
): string {
  return provider.urlTemplate
    .replace('{z}', String(zoom))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{tileset}', credentials?.tileset ?? MAPBOX_DEFAULT_TILESET)
    .replace('{token}', encodeURIComponent(credentials?.token ?? ''));
}
