import { describe, expect, it } from 'vitest';
import { checkCustomSource, CUSTOM_BASEMAP_ID, customProvider } from './customSource';
import { basemapProviders, findBasemapProvider, tileUrl } from './providers';

const valid = {
  urlTemplate: 'https://ortofotos.exemplo.test/camada/{z}/{y}/{x}.jpg?key=MINHA-CHAVE',
  attribution: '© Prefeitura de Exemplo, 2025',
  maxZoom: 20,
};

describe('fonte de mapa personalizada', () => {
  it('aceita um endereço https com {z}, {x} e {y}, atribuição e nível máximo', () => {
    const checked = checkCustomSource(valid);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const provider = customProvider(checked.value);
    expect(provider.id).toBe(CUSTOM_BASEMAP_ID);
    expect(provider.maxZoom).toBe(20);
    expect(provider.attribution).toBe('© Prefeitura de Exemplo, 2025');
    // A linha e a coluna vão para onde o usuário indicou.
    expect(tileUrl(provider, 18, 7, 9)).toBe(
      'https://ortofotos.exemplo.test/camada/18/9/7.jpg?key=MINHA-CHAVE',
    );
    // O nome mostrado e os vínculos não expõem a chave.
    expect(provider.name).toBe('Personalizada — ortofotos.exemplo.test');
    expect(provider.attributionUrl).not.toContain('MINHA-CHAVE');
    // Licença desconhecida para o editor: a imagem não entra em exportações.
    expect(provider.permissions.export).toBe(false);
  });

  it.each([
    [{ ...valid, urlTemplate: 'ortofotos/{z}/{x}/{y}' }, 'Endereço inválido'],
    [{ ...valid, urlTemplate: 'http://ortofotos.exemplo.test/{z}/{x}/{y}.png' }, 'https'],
    [{ ...valid, urlTemplate: 'https://ortofotos.exemplo.test/{z}/{x}.png' }, '{y}'],
    [{ ...valid, attribution: '  ' }, 'atribuição'],
    [{ ...valid, maxZoom: 30 }, 'nível máximo'],
    [{ ...valid, maxZoom: 14.5 }, 'nível máximo'],
  ])('recusa entradas inválidas com a razão (%#)', (input, reason) => {
    const checked = checkCustomSource(input);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.message).toContain(reason);
  });

  it('entra na lista de fontes só quando configurada', () => {
    const checked = checkCustomSource(valid);
    if (!checked.ok) throw new Error(checked.message);
    expect(basemapProviders(null).map((p) => p.id)).toEqual([
      'eox-s2cloudless-2016',
      'osm-standard',
    ]);
    expect(basemapProviders(checked.value).map((p) => p.id)).toEqual([
      'eox-s2cloudless-2016',
      'osm-standard',
      'custom',
    ]);
    expect(findBasemapProvider('custom', null)).toBeNull();
    expect(findBasemapProvider('custom', checked.value)?.maxZoom).toBe(20);
    expect(findBasemapProvider('osm-standard', checked.value)?.id).toBe('osm-standard');
  });
});
