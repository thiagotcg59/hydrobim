import type { BasemapProvider } from './providers';

/**
 * Fonte de mapa informada pelo usuário: um serviço de ladrilhos ao qual ELE tem direito
 * (ortofotos de alta resolução, serviço contratado, servidor da própria empresa). O endereço
 * pode conter a chave do usuário; por isso fica guardado só neste navegador (`localStorage`) e
 * nunca entra no arquivo do projeto, no repositório ou em uma exportação — o projeto registra
 * apenas que a fonte escolhida é a personalizada.
 */

export const CUSTOM_BASEMAP_ID = 'custom';
const STORAGE_KEY = 'hydrobim.basemap.custom';

export interface CustomBasemapSource {
  /** Endereço dos ladrilhos em Web Mercator, com `{z}`, `{x}` e `{y}`. */
  readonly urlTemplate: string;
  /** Atribuição exigida pelo serviço, mostrada sempre com a imagem. */
  readonly attribution: string;
  /** Maior nível de zoom com imagem própria. */
  readonly maxZoom: number;
}

export type CustomSourceCheck =
  | { readonly ok: true; readonly value: CustomBasemapSource }
  | { readonly ok: false; readonly message: string };

/** Confere o que o usuário digitou; nada é corrigido em silêncio. */
export function checkCustomSource(input: {
  urlTemplate: string;
  attribution: string;
  maxZoom: number;
}): CustomSourceCheck {
  const urlTemplate = input.urlTemplate.trim();
  const attribution = input.attribution.trim();
  let url: URL;
  try {
    url = new URL(urlTemplate.replace(/\{[zxy]\}/g, '0'));
  } catch {
    return { ok: false, message: 'Endereço inválido: informe a URL completa dos ladrilhos.' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, message: 'O endereço dos ladrilhos precisa usar https.' };
  }
  for (const key of ['{z}', '{x}', '{y}']) {
    if (!urlTemplate.includes(key)) {
      return {
        ok: false,
        message: `O endereço precisa conter ${key} (nível, coluna e linha do ladrilho: {z}, {x} e {y}).`,
      };
    }
  }
  if (attribution.length === 0) {
    return {
      ok: false,
      message: 'Informe a atribuição exigida pelo serviço (ela é mostrada com a imagem).',
    };
  }
  if (!Number.isInteger(input.maxZoom) || input.maxZoom < 10 || input.maxZoom > 22) {
    return { ok: false, message: 'O nível máximo de zoom deve ser um inteiro entre 10 e 22.' };
  }
  return { ok: true, value: { urlTemplate, attribution, maxZoom: input.maxZoom } };
}

/** A fonte personalizada como provedor de mapa (sem expor a chave na interface). */
export function customProvider(source: CustomBasemapSource): BasemapProvider {
  const origin = new URL(source.urlTemplate.replace(/\{[zxy]\}/g, '0')).origin;
  return {
    id: CUSTOM_BASEMAP_ID,
    name: `Personalizada — ${new URL(origin).host}`,
    urlTemplate: source.urlTemplate,
    tileSize: 256,
    minZoom: 10,
    maxZoom: source.maxZoom,
    resolution: null,
    imageryDate: null,
    attribution: source.attribution,
    attributionUrl: origin,
    license: 'termos do serviço',
    licenseUrl: origin,
    termsSource: 'Fonte informada pelo usuário; os termos de uso são os do serviço contratado.',
    permissions: {
      // O HydroBIM não conhece a licença desta fonte: não a reproduz em exportações.
      export: false,
      offlineCache: false,
      notes: 'Fonte do usuário: exibição na tela conforme os termos do serviço informado.',
    },
  };
}

export function loadCustomSource(): CustomBasemapSource | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CustomBasemapSource>;
    const checked = checkCustomSource({
      urlTemplate: String(parsed.urlTemplate ?? ''),
      attribution: String(parsed.attribution ?? ''),
      maxZoom: Number(parsed.maxZoom),
    });
    return checked.ok ? checked.value : null;
  } catch {
    return null;
  }
}

export function storeCustomSource(source: CustomBasemapSource | null): void {
  try {
    if (source) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(source));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Armazenamento indisponível (modo privado): a fonte vale só para esta sessão.
  }
}
