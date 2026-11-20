import {
  createGeoTransform,
  findProjectedCrs,
  geographicToTile,
  tileGroundResolution,
  tileToGeographic,
  type Georeference,
  type GeoTransform,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { BASEMAP_PROVIDERS, findBasemapProvider, tileUrl } from './providers';
import { MAX_TILES, placeTile, tileMatrix, tilePointToLocal, tilesForView } from './tiles';

const provider = BASEMAP_PROVIDERS[0]!;

function transformFor(patch: Partial<Georeference> = {}): GeoTransform {
  const geo: Georeference = {
    crsName: 'SIRGAS 2000 / UTM zone 23S',
    epsg: 31983,
    // Marco zero de São Paulo (ponto de controle conferido com o PROJ em geo.test.ts).
    eastings: 333287.02152768255,
    northings: 7394586.093402657,
    orthogonalHeight: 760,
    rotation: 0,
    verticalDatum: null,
    ...patch,
  };
  const crs = findProjectedCrs(geo.epsg ?? 0);
  if (!crs) throw new Error('CRS de teste não suportado.');
  return createGeoTransform(geo, crs);
}

describe('fontes de mapa', () => {
  it('toda fonte embutida declara licença, atribuição, origem dos termos e permissões', () => {
    expect(BASEMAP_PROVIDERS.length).toBeGreaterThan(0);
    for (const source of BASEMAP_PROVIDERS) {
      expect(source.attribution.length).toBeGreaterThan(10);
      expect(source.license.length).toBeGreaterThan(0);
      expect(source.licenseUrl).toMatch(/^https:\/\//);
      expect(source.termsSource).toMatch(/https:\/\//);
      expect(source.urlTemplate).toMatch(/^https:\/\//);
      // Sem chaves nem credenciais no endereço.
      expect(source.urlTemplate).not.toMatch(/key=|token=|apikey/i);
      expect(source.minZoom).toBeLessThanOrEqual(source.maxZoom);
      expect(findBasemapProvider(source.id)).toBe(source);
    }
    expect(findBasemapProvider(null)).toBeNull();
    expect(findBasemapProvider('inexistente')).toBeNull();
  });

  it('monta o endereço na ordem do serviço WMTS (nível / linha / coluna)', () => {
    expect(tileUrl(provider, 13, 3034, 4647)).toBe(
      'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/13/4647/3034.jpg',
    );
  });
});

describe('ladrilhos para a janela da planta', () => {
  it('o ponto de controle do modelo cai no ladrilho e na posição esperados', () => {
    const transform = transformFor();
    // Janela de 2 km em torno da origem local (o marco zero), a 2 m por pixel.
    const set = tilesForView(
      transform,
      provider,
      { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 },
      2,
    );
    expect(set.tooWide).toBe(false);
    // Posição do marco zero no esquema de ladrilhos, calculada sem passar pelo modelo.
    const expected = geographicToTile({ lon: -46.633309, lat: -23.55052 }, set.zoom);
    const tile = set.tiles.find(
      (t) => t.x === Math.floor(expected.x) && t.y === Math.floor(expected.y),
    );
    expect(tile).toBeDefined();
    if (!tile) return;
    const drawn = tilePointToLocal(tile, expected.x - tile.x, expected.y - tile.y);
    // Tolerância: um décimo de pixel da imagem de origem. A exatidão do conjunto é limitada
    // pela imagem (10 m por pixel) e pela passagem SIRGAS 2000 → WGS 84 (1 m), não pela conta.
    const tolerance = tileGroundResolution(-23.55, set.zoom, provider.tileSize) / 10;
    expect(Math.hypot(drawn.x, drawn.y)).toBeLessThan(tolerance);
  });

  it('a colocação afim de cada ladrilho erra menos de meio pixel em todos os níveis usados', () => {
    // Pior caso prático: borda do fuso (maior convergência) e quadrícula girada.
    const transform = transformFor({
      eastings: 189303.9156132344,
      northings: 8251045.076815761,
      rotation: 0.6,
    });
    for (let zoom = provider.minZoom; zoom <= provider.maxZoom; zoom += 1) {
      const origin = transform.localToGeographic({ x: 0, y: 0 });
      const at = geographicToTile(origin, zoom);
      const tile = placeTile(transform, provider, zoom, Math.floor(at.x), Math.floor(at.y));
      const pixel = tileGroundResolution(origin.lat, zoom, provider.tileSize);
      let worst = 0;
      // O canto sudeste e o centro não entram na definição da transformação afim.
      for (const [u, v] of [
        [1, 1],
        [0.5, 0.5],
        [0.5, 1],
        [1, 0.5],
      ] as const) {
        const exact = transform.geographicToLocal(
          tileToGeographic({ x: tile.x + u, y: tile.y + v }, zoom),
        );
        const drawn = tilePointToLocal(tile, u, v);
        worst = Math.max(worst, Math.hypot(drawn.x - exact.x, drawn.y - exact.y) / pixel);
      }
      expect(worst, `nível ${zoom}`).toBeLessThan(0.5);
    }
  });

  it('pede só a região visível, no nível adequado à ampliação', () => {
    const transform = transformFor();
    const near = tilesForView(
      transform,
      provider,
      { minX: -400, minY: -300, maxX: 400, maxY: 300 },
      0.5,
    );
    // Mais perto do que a fonte alcança: usa o maior nível e avisa que a imagem está ampliada.
    expect(near.zoom).toBe(provider.maxZoom);
    expect(near.overzoom).toBe(true);
    expect(near.tiles.length).toBeLessThanOrEqual(4);

    const far = tilesForView(
      transform,
      provider,
      { minX: -15000, minY: -9000, maxX: 15000, maxY: 9000 },
      20,
    );
    expect(far.zoom).toBeLessThan(provider.maxZoom);
    expect(far.overzoom).toBe(false);
    expect(far.tiles.length).toBeGreaterThan(0);
    expect(far.tiles.length).toBeLessThanOrEqual(MAX_TILES);
    // Todos os ladrilhos tocam a janela pedida (com a folga de um ladrilho).
    const size = tileGroundResolution(-23.55, far.zoom, provider.tileSize) * provider.tileSize;
    for (const tile of far.tiles) {
      expect(tile.northWest.x).toBeLessThan(15000 + size);
      expect(tile.northEast.x).toBeGreaterThan(-15000 - size);
      expect(tile.southWest.y).toBeLessThan(9000 + size);
      expect(tile.northWest.y).toBeGreaterThan(-9000 - size);
    }
    expect(new Set(far.tiles.map((t) => t.key)).size).toBe(far.tiles.length);
  });

  it('não pede nada para vistas amplas demais ou janelas inválidas', () => {
    const transform = transformFor();
    const wide = tilesForView(
      transform,
      provider,
      { minX: -400_000, minY: -400_000, maxX: 400_000, maxY: 400_000 },
      500,
    );
    expect(wide.tiles).toHaveLength(0);
    expect(wide.tooWide).toBe(true);
    const invalid = tilesForView(transform, provider, { minX: 0, minY: 0, maxX: 0, maxY: 0 }, 1);
    expect(invalid.tiles).toHaveLength(0);
    expect(invalid.tooWide).toBe(false);
    expect(
      tilesForView(transform, provider, { minX: 0, minY: 0, maxX: 10, maxY: 10 }, Number.NaN).tiles,
    ).toHaveLength(0);
  });

  it('a matriz do ladrilho acompanha a origem de desenho sem mudar a posição no modelo', () => {
    const transform = transformFor({ rotation: 0.3 });
    const set = tilesForView(
      transform,
      provider,
      { minX: -500, minY: -500, maxX: 500, maxY: 500 },
      2,
    );
    const tile = set.tiles[0]!;
    const atZero = tileMatrix(tile, { x: 0, y: 0 });
    const shifted = tileMatrix(tile, { x: 1000, y: -2000 });
    // Só a translação muda, exatamente pelo deslocamento da origem (Y invertido no SVG).
    expect(shifted.slice(0, 4)).toEqual(atZero.slice(0, 4));
    expect(shifted[4]).toBeCloseTo(atZero[4] - 1000, 9);
    expect(shifted[5]).toBeCloseTo(atZero[5] - 2000, 9);
    // O canto noroeste da imagem (0, 0) vai para o canto noroeste do ladrilho.
    expect(atZero[4]).toBeCloseTo(tile.northWest.x, 9);
    expect(atZero[5]).toBeCloseTo(-tile.northWest.y, 9);
  });
});
