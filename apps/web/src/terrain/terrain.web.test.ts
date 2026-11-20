import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import {
  georeferenceStatus,
  polygonArea,
  rasterFrame,
  surveySource,
  terrainElevationAt,
  terrainProfile,
  terrainStats,
  tileToGeographic,
  vec3,
  type Georeference,
  type Point2,
  type Vec3,
} from '@hydrobim/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../state/editorStore';
import {
  checkCredentials,
  decodeElevation,
  ELEVATION_PROVIDERS,
  elevationTileUrl,
  encodeElevation,
  findElevationProvider,
} from './elevationProviders';
import {
  clearElevationCache,
  defaultZoom,
  fetchElevationRaster,
  MAX_ELEVATION_TILES,
  tileWindowFor,
  zoomOptions,
  type TileDecoder,
} from './elevationTiles';
import { decodeLzw, readGeoTiffDem } from './geotiff';
import {
  buildTerrainMesh,
  contourSegments,
  elevationColor,
  slopeColor,
  terrainEdges,
} from './terrainColors';
import { cropRaster, runTerrainJob, type TerrainStage } from './terrainJob';
import { profileCsv } from './TerrainProfilePanel';
import { areaRings, useTerrainStore } from './terrainStore';

/** Marco zero de São Paulo em SIRGAS 2000 / UTM 23S (o mesmo ponto de controle do Infra). */
const GEOREFERENCE: Georeference = {
  crsName: 'SIRGAS 2000 / UTM zone 23S',
  epsg: 31983,
  eastings: 333287.0215,
  northings: 7394586.0934,
  orthogonalHeight: 700,
  rotation: 0,
  verticalDatum: 'Imbituba',
};
const STATUS = georeferenceStatus(GEOREFERENCE);
if (STATUS.state !== 'ready') throw new Error('georreferência de teste inválida');
const TRANSFORM = STATUS.transform;

const AREA: Point2[][] = [
  [
    { x: -300, y: -250 },
    { x: 350, y: -280 },
    { x: 420, y: 260 },
    { x: -260, y: 300 },
  ],
];

/** Relevo de teste: altitude em função da posição local (plano inclinado). */
const altitude = (x: number, y: number): number => 760 + 0.04 * x - 0.025 * y;

const terrarium = findElevationProvider('aws-terrarium')!;
const mapbox = findElevationProvider('mapbox-terrain')!;

/** Serviço de ladrilhos de mentira: cada pixel traz a altitude do relevo de teste. */
function fakeService(encoding: 'terrarium' | 'mapbox', size = 256) {
  const requests: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    const match = /\/(\d+)\/(\d+)\/(\d+)\.png/.exec(url);
    if (!match) return new Response(null, { status: 404 });
    return new Response(new Blob([`${match[1]}/${match[2]}/${match[3]}`]), { status: 200 });
  }) as typeof fetch;
  const decoder: TileDecoder = async (blob) => {
    const [zoom, tx, ty] = (await blob.text()).split('/').map(Number) as [number, number, number];
    const rgba = new Uint8ClampedArray(size * size * 4);
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const local = TRANSFORM.geographicToLocal(
          tileToGeographic({ x: tx + (col + 0.5) / size, y: ty + (row + 0.5) / size }, zoom),
        );
        const [r, g, b] = encodeElevation(encoding, altitude(local.x, local.y));
        rgba.set([r, g, b, 255], (row * size + col) * 4);
      }
    }
    return rgba;
  };
  return { requests, fetcher, decoder };
}

describe('fontes de elevação', () => {
  it('codifica e decodifica cotas nas duas convenções', () => {
    for (const value of [-431.2, 0, 760.37, 8848.9]) {
      expect(decodeElevation('terrarium', ...encodeElevation('terrarium', value))).toBeCloseTo(
        value,
        2,
      );
      expect(decodeElevation('mapbox', ...encodeElevation('mapbox', value))).toBeCloseTo(value, 1);
    }
    // Valores de referência das documentações: Terrarium (128, 0, 0) = 0 m; Mapbox (1, 134, 160) = 0 m.
    expect(decodeElevation('terrarium', 128, 0, 0)).toBe(0);
    expect(decodeElevation('mapbox', 1, 134, 160)).toBeCloseTo(0, 9);
  });

  it('nenhuma fonte declara datum vertical ou exatidão, e a chave fica fora do registro', () => {
    for (const provider of ELEVATION_PROVIDERS) {
      expect(provider.verticalDatum).toBeNull();
      expect(provider.verticalAccuracy).toBeNull();
      expect(provider.termsSource).toMatch(/conferid/);
      expect(provider.urlTemplate.startsWith('https://')).toBe(true);
      expect(provider.urlTemplate).not.toMatch(/pk\./);
    }
    expect(terrarium.requiresToken).toBe(false);
    expect(mapbox.requiresToken).toBe(true);
    expect(elevationTileUrl(terrarium, 12, 1517, 2323, null)).toBe(
      'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/1517/2323.png',
    );
    expect(checkCredentials({ token: 'sk.abc.def', tileset: '' }).ok).toBe(false);
    const checked = checkCredentials({ token: ' pk.abc123.def-456 ', tileset: '' });
    expect(checked.ok && checked.value.tileset).toBe('mapbox.terrain-rgb');
    if (!checked.ok) return;
    expect(elevationTileUrl(mapbox, 12, 1, 2, checked.value)).toBe(
      'https://api.mapbox.com/v4/mapbox.terrain-rgb/12/1/2.pngraw?access_token=pk.abc123.def-456',
    );
  });

  it('oferece resoluções para a área e não usa por padrão níveis sobreamostrados', () => {
    const options = zoomOptions(terrarium, TRANSFORM, AREA, 25_000);
    expect(options[0]!.zoom).toBe(15);
    const z12 = options.find((o) => o.zoom === 12)!;
    // 156543 m · cos(23,55°) ÷ 2¹² ≈ 35 m por pixel nesta latitude.
    expect(z12.resolution).toBeCloseTo(35.04, 1);
    expect(z12.oversampled).toBe(false);
    expect(z12.blocked).toBeNull();
    expect(options.find((o) => o.zoom === 15)!.oversampled).toBe(true);
    // Com um limite menor de vértices, o nível mais fino deixa de caber na área.
    expect(zoomOptions(terrarium, TRANSFORM, AREA, 5_000)[0]!.blocked).toMatch(/amostras/);
    expect(defaultZoom(terrarium, options)).toBe(12);
    // A Mapbox não informa a resolução de origem: o editor não afirma nada sobre ela.
    expect(zoomOptions(mapbox, TRANSFORM, AREA, 25_000)[0]!.oversampled).toBeNull();
    const window = tileWindowFor(TRANSFORM, AREA[0]!, 12, 256);
    expect(window.tiles).toBeLessThanOrEqual(4);
    expect(window.tiles).toBeLessThanOrEqual(MAX_ELEVATION_TILES);
  });
});

describe('busca de elevação em ladrilhos', () => {
  beforeEach(() => clearElevationCache());

  it('monta o raster, posiciona-o pela georreferência e gera a superfície sem inventar cotas', async () => {
    const service = fakeService('terrarium');
    const window = tileWindowFor(TRANSFORM, AREA[0]!, 13, 256);
    const progress: [number, number][] = [];
    const fetched = await fetchElevationRaster({
      provider: terrarium,
      credentials: null,
      window,
      fetcher: service.fetcher,
      decoder: service.decoder,
      onProgress: (done, total) => progress.push([done, total]),
    });
    if (!fetched.ok) throw new Error(fetched.error.message);
    expect(service.requests).toHaveLength(window.tiles);
    expect(progress[progress.length - 1]).toEqual([window.tiles, window.tiles]);
    expect(fetched.value.requested).toBe(window.tiles);

    const frame = rasterFrame(fetched.value.georeference, { kind: 'webMercator' }, STATUS);
    if (!frame.ok) throw new Error(frame.error.message);
    const cropped = cropRaster(
      fetched.value.raster,
      fetched.value.georeference,
      frame.value,
      AREA[0]!,
    );
    if (!cropped.ok) throw new Error(cropped.error.message);
    expect(cropped.value.raster.width).toBeLessThan(fetched.value.raster.width);

    const stages: TerrainStage[] = [];
    const result = runTerrainJob(
      {
        kind: 'dem',
        name: 'Teste',
        ...cropped.value,
        crs: { kind: 'webMercator' },
        project: GEOREFERENCE,
        rings: AREA,
        stride: 1,
        source: { ...surveySource(null, null), kind: 'dem', provider: terrarium.name },
      },
      (stage) => stages.push(stage),
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(stages).toEqual(['sampling', 'triangulating', 'finishing']);
    const { terrain } = result.value;
    // Resolução gravada = espaçamento real das amostras (≈ 17,5 m no nível 13 desta latitude).
    expect(terrain.source.resolution).toBeCloseTo(17.5, 0);
    expect(terrain.source.verticalDatum).toBeNull();
    const stats = terrainStats(terrain);
    expect(stats.vertexCount).toBeGreaterThan(1000);
    // A área da superfície é a do polígono: nada fora do contorno.
    expect(stats.planArea).toBeCloseTo(polygonArea(AREA), 0);
    // Cota local = altitude − altitude da origem (700 m), na posição certa em planta. Um
    // deslocamento de um pixel (17,5 m) daria 0,7 m de erro; a codificação tem passo de 4 mm.
    for (const [x, y] of [
      [0, 0],
      [-200, 150],
      [300, -200],
      [111.1, 222.2],
    ] as const) {
      expect(terrainElevationAt(terrain, x, y)).toBeCloseTo(altitude(x, y) - 700, 1);
    }
    expect(terrainElevationAt(terrain, 500, 0)).toBeNull();

    // Segunda busca: os ladrilhos vêm do cache da sessão, sem novos pedidos.
    const again = await fetchElevationRaster({
      provider: terrarium,
      credentials: null,
      window,
      fetcher: service.fetcher,
      decoder: service.decoder,
    });
    expect(again.ok && again.value.fromCache).toBe(window.tiles);
    expect(service.requests).toHaveLength(window.tiles);
  });

  it('falha por inteiro, com mensagem, quando o serviço não responde', async () => {
    const window = tileWindowFor(TRANSFORM, AREA[0]!, 12, 256);
    const code = async (fetcher: typeof fetch, signal?: AbortSignal): Promise<string> => {
      const result = await fetchElevationRaster({
        provider: terrarium,
        credentials: null,
        window,
        fetcher,
        decoder: fakeService('terrarium').decoder,
        signal,
      });
      return result.ok ? 'ok' : result.error.code;
    };
    expect(await code((async () => new Response(null, { status: 503 })) as typeof fetch)).toBe(
      'ELEVATION_HTTP',
    );
    expect(
      await code((async () => {
        throw new TypeError('failed to fetch');
      }) as typeof fetch),
    ).toBe('ELEVATION_NETWORK');
    const controller = new AbortController();
    controller.abort();
    expect(
      await code(
        (async () => {
          throw new DOMException('aborted', 'AbortError');
        }) as typeof fetch,
        controller.signal,
      ),
    ).toBe('ELEVATION_ABORTED');
    const noToken = await fetchElevationRaster({ provider: mapbox, credentials: null, window });
    expect(noToken.ok ? 'ok' : noToken.error.code).toBe('ELEVATION_TOKEN');
    const denied = await fetchElevationRaster({
      provider: mapbox,
      credentials: { token: 'pk.a.b', tileset: 'mapbox.terrain-rgb' },
      window,
      fetcher: (async () => new Response(null, { status: 401 })) as typeof fetch,
    });
    expect(denied.ok ? '' : denied.error.message).toMatch(/recusou a chave/);
    const huge = await fetchElevationRaster({
      provider: terrarium,
      credentials: null,
      window: { ...window, maxX: window.minX + 20, tiles: 400 },
    });
    expect(huge.ok ? 'ok' : huge.error.code).toBe('ELEVATION_TOO_MANY_TILES');
  });
});

// ---------------------------------------------------------------------------
// GeoTIFF
// ---------------------------------------------------------------------------

const fixture = (name: string): ArrayBuffer => {
  const bytes = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

/** Mesma fórmula de `tests/tools/make_terrain_fixtures.py`. */
const fixtureElevation = (col: number, row: number): number =>
  700 + 0.5 * col + 0.25 * row + (((col * 7919) ^ (row * 104729)) % 1000) / 100;

interface TiffOptions {
  width: number;
  height: number;
  values: Float32Array;
  compression: 1 | 8;
  predictor: 1 | 3;
  tile: number | null;
  geoKeys: number[] | null;
  tiepoint?: number[];
  scale?: number[];
  bigEndian?: boolean;
  samplesPerPixel?: number;
}

/** Escritor mínimo de TIFF para os testes: real de 32 bits, em faixa única ou em blocos. */
function writeTiff(options: TiffOptions): ArrayBuffer {
  const { width, height, values, tile } = options;
  const little = !options.bigEndian;
  const blockWidth = tile ?? width;
  const blockHeight = tile ?? height;
  const across = Math.ceil(width / blockWidth);
  const down = Math.ceil(height / blockHeight);
  const blocks: Uint8Array[] = [];
  for (let by = 0; by < down; by += 1) {
    for (let bx = 0; bx < across; bx += 1) {
      const raw = new Uint8Array(blockWidth * blockHeight * 4);
      const view = new DataView(raw.buffer);
      for (let row = 0; row < blockHeight; row += 1) {
        for (let col = 0; col < blockWidth; col += 1) {
          const x = bx * blockWidth + col;
          const y = by * blockHeight + row;
          const value = x < width && y < height ? (values[y * width + x] as number) : 0;
          view.setFloat32(
            (row * blockWidth + col) * 4,
            value,
            options.predictor === 3 ? false : little,
          );
        }
      }
      let data = raw;
      if (options.predictor === 3) {
        // Planos de bytes (mais significativo primeiro) e diferenças byte a byte por linha.
        data = new Uint8Array(raw.length);
        const rowBytes = blockWidth * 4;
        for (let row = 0; row < blockHeight; row += 1) {
          const base = row * rowBytes;
          for (let col = 0; col < blockWidth; col += 1) {
            for (let b = 0; b < 4; b += 1)
              data[base + b * blockWidth + col] = raw[base + col * 4 + b]!;
          }
          for (let i = rowBytes - 1; i >= 1; i -= 1) {
            data[base + i] = (data[base + i]! - data[base + i - 1]! + 256) & 255;
          }
        }
      }
      blocks.push(options.compression === 8 ? new Uint8Array(deflateSync(data)) : data);
    }
  }
  type Entry = { tag: number; type: number; values: number[] | string };
  const entries: Entry[] = [
    { tag: 256, type: 4, values: [width] },
    { tag: 257, type: 4, values: [height] },
    { tag: 258, type: 3, values: [32] },
    { tag: 259, type: 3, values: [options.compression] },
    { tag: 262, type: 3, values: [1] },
    { tag: 277, type: 3, values: [options.samplesPerPixel ?? 1] },
    { tag: 317, type: 3, values: [options.predictor] },
    { tag: 339, type: 3, values: [3] },
    { tag: 42113, type: 2, values: '-9999\0' },
  ];
  if (options.scale ?? true) {
    entries.push({ tag: 33550, type: 12, values: options.scale ?? [10, 10, 0] });
    entries.push({
      tag: 33922,
      type: 12,
      values: options.tiepoint ?? [0, 0, 0, 333000, 7395000, 0],
    });
  }
  if (options.geoKeys) {
    entries.push({
      tag: 34735,
      type: 3,
      values: [1, 1, 0, options.geoKeys.length / 4, ...options.geoKeys],
    });
  }
  const sizes: Record<number, number> = { 2: 1, 3: 2, 4: 4, 12: 8 };
  const offsetsTag = tile ? 324 : 273;
  const countsTag = tile ? 325 : 279;
  if (tile) {
    entries.push({ tag: 322, type: 4, values: [tile] }, { tag: 323, type: 4, values: [tile] });
  } else {
    entries.push({ tag: 278, type: 4, values: [height] });
  }
  let cursor = 8;
  const blockOffsets = blocks.map((block) => {
    const at = cursor;
    cursor += block.length + (block.length % 2);
    return at;
  });
  entries.push({ tag: offsetsTag, type: 4, values: blockOffsets });
  entries.push({ tag: countsTag, type: 4, values: blocks.map((b) => b.length) });
  entries.sort((a, b) => a.tag - b.tag);
  const ifdOffset = cursor;
  let extra = ifdOffset + 2 + entries.length * 12 + 4;
  const placed = entries.map((entry) => {
    const count = entry.values.length;
    const bytes = count * sizes[entry.type]!;
    const at = bytes > 4 ? extra : -1;
    if (bytes > 4) extra += bytes + (bytes % 2);
    return { entry, count, at };
  });
  const out = new Uint8Array(extra);
  const view = new DataView(out.buffer);
  view.setUint16(0, little ? 0x4949 : 0x4d4d, false);
  view.setUint16(2, 42, little);
  view.setUint32(4, ifdOffset, little);
  blocks.forEach((block, i) => out.set(block, blockOffsets[i]));
  view.setUint16(ifdOffset, entries.length, little);
  const put = (at: number, type: number, list: number[] | string): void => {
    for (let k = 0; k < list.length; k += 1) {
      const p = at + k * sizes[type]!;
      if (typeof list === 'string') view.setUint8(p, list.charCodeAt(k));
      else if (type === 3) view.setUint16(p, list[k]!, little);
      else if (type === 4) view.setUint32(p, list[k]!, little);
      else view.setFloat64(p, list[k]!, little);
    }
  };
  placed.forEach(({ entry, count, at }, i) => {
    const p = ifdOffset + 2 + i * 12;
    view.setUint16(p, entry.tag, little);
    view.setUint16(p + 2, entry.type, little);
    view.setUint32(p + 4, count, little);
    if (at < 0) put(p + 8, entry.type, entry.values);
    else {
      view.setUint32(p + 8, at, little);
      put(at, entry.type, entry.values);
    }
  });
  return out.buffer;
}

const UTM_KEYS = [1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 31983];

function sampleValues(width: number, height: number): Float32Array {
  const values = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) values[row * width + col] = fixtureElevation(col, row);
  }
  return values;
}

describe('leitor de GeoTIFF', () => {
  it('lê um DEM real de 32 bits com LZW escrito pela libtiff', async () => {
    const result = await readGeoTiffDem(fixture('dem-utm23s-lzw-f32.tif'));
    if (!result.ok) throw new Error(result.error.message);
    const dem = result.value;
    expect([dem.raster.width, dem.raster.height]).toEqual([64, 48]);
    expect(dem.crs).toEqual({ kind: 'projected', epsg: 31983 });
    expect(dem.epsg).toBe(31983);
    expect(dem.verticalDatum).toBe('EPSG:5781');
    expect(dem.cellSize).toEqual({ x: 5, y: 5 });
    // PixelIsArea: o nó (0, 0) fica no centro da primeira célula, meia célula para dentro.
    expect(dem.georeference).toEqual({
      originX: 333002.5,
      originY: 7394997.5,
      stepX: 5,
      stepY: -5,
    });
    expect(dem.noDataCount).toBe(1);
    for (let row = 0; row < 48; row += 1) {
      for (let col = 0; col < 64; col += 1) {
        const value = dem.raster.data[row * 64 + col]!;
        if (row === 3 && col === 4) expect(Number.isNaN(value)).toBe(true);
        else expect(value).toBe(Math.fround(fixtureElevation(col, row)));
      }
    }
  });

  it('lê um DEM inteiro com Deflate em coordenadas geográficas', async () => {
    const result = await readGeoTiffDem(fixture('dem-wgs84-deflate-i16.tif'));
    if (!result.ok) throw new Error(result.error.message);
    const dem = result.value;
    expect(dem.crs).toEqual({ kind: 'geographic' });
    expect(dem.epsg).toBe(4326);
    expect(dem.verticalDatum).toBeNull();
    expect(dem.georeference.originX).toBeCloseTo(-46.64 + 0.5 / 3600, 12);
    expect(dem.georeference.originY).toBeCloseTo(-23.54 - 0.5 / 3600, 12);
    expect(dem.noDataCount).toBe(0);
    expect(dem.raster.data[10 * 64 + 20]).toBe(Math.round(fixtureElevation(20, 10)));
    expect(dem.raster.data[47 * 64 + 63]).toBe(Math.round(fixtureElevation(63, 47)));
  });

  it('lê blocos, preditor de ponto flutuante e ordem de bytes invertida', async () => {
    const values = sampleValues(40, 30);
    values[5 * 40 + 7] = -9999;
    const variants: Partial<TiffOptions>[] = [
      { compression: 1, predictor: 1, tile: null },
      { compression: 8, predictor: 1, tile: 16 },
      { compression: 8, predictor: 3, tile: 16 },
      { compression: 1, predictor: 3, tile: null },
      { compression: 1, predictor: 1, tile: null, bigEndian: true },
    ];
    for (const variant of variants) {
      const buffer = writeTiff({
        width: 40,
        height: 30,
        values,
        compression: 1,
        predictor: 1,
        tile: null,
        geoKeys: UTM_KEYS,
        ...variant,
      });
      const result = await readGeoTiffDem(buffer);
      if (!result.ok) throw new Error(`${JSON.stringify(variant)}: ${result.error.message}`);
      const { raster, noDataCount } = result.value;
      expect(noDataCount).toBe(1);
      expect(Number.isNaN(raster.data[5 * 40 + 7]!)).toBe(true);
      expect(raster.data[0]).toBe(values[0]);
      expect(raster.data[29 * 40 + 39]).toBe(values[29 * 40 + 39]);
      expect(raster.data[17 * 40 + 33]).toBe(values[17 * 40 + 33]);
    }
  });

  it('recusa arquivos que não permitem posicionar o raster, sem presumir nada', async () => {
    const base = {
      width: 8,
      height: 8,
      values: sampleValues(8, 8),
      compression: 1,
      predictor: 1,
      tile: null,
    } as const;
    const code = async (buffer: ArrayBuffer): Promise<string> => {
      const result = await readGeoTiffDem(buffer);
      return result.ok ? 'ok' : result.error.code;
    };
    expect(await code(writeTiff({ ...base, geoKeys: null }))).toBe('GEOTIFF_CRS');
    // Sistema geográfico fora do registro (SAD69): não é aproximado por WGS 84.
    expect(await code(writeTiff({ ...base, geoKeys: [1024, 0, 1, 2, 2048, 0, 1, 4618] }))).toBe(
      'GEOTIFF_CRS',
    );
    expect(await code(writeTiff({ ...base, geoKeys: UTM_KEYS, samplesPerPixel: 3 }))).toBe(
      'GEOTIFF_BANDS',
    );
    expect(await code(new TextEncoder().encode('não é um tiff').buffer as ArrayBuffer)).toBe(
      'GEOTIFF_INVALID',
    );
    const big = new Uint8Array(writeTiff({ ...base, geoKeys: UTM_KEYS }));
    big[2] = 43;
    expect(await code(big.buffer)).toBe('GEOTIFF_BIGTIFF');
    // Cotas em pés (unidade vertical 9002): recusado, não convertido em silêncio.
    expect(await code(writeTiff({ ...base, geoKeys: [...UTM_KEYS, 4099, 0, 1, 9002] }))).toBe(
      'GEOTIFF_VERTICAL_UNITS',
    );
    expect(() => decodeLzw(new Uint8Array([0xff, 0xff, 0xff]), 10)).toThrow();
  });

  it('gera a superfície de um GeoTIFF no sistema do projeto, com as cotas na posição certa', async () => {
    // Raster de 10 m com o canto superior esquerdo 200 m a oeste e 200 m ao norte da origem.
    const width = 41;
    const height = 41;
    const values = new Float32Array(width * height);
    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        // Centro da célula em coordenadas locais.
        values[row * width + col] = altitude(-200 + col * 10 + 5, 200 - row * 10 - 5);
      }
    }
    const dem = await readGeoTiffDem(
      writeTiff({
        width,
        height,
        values,
        compression: 8,
        predictor: 3,
        tile: 16,
        geoKeys: UTM_KEYS,
        tiepoint: [0, 0, 0, GEOREFERENCE.eastings - 200, GEOREFERENCE.northings + 200, 0],
      }),
    );
    if (!dem.ok) throw new Error(dem.error.message);
    const rings: Point2[][] = [
      [
        { x: -150, y: -150 },
        { x: 150, y: -150 },
        { x: 150, y: 150 },
        { x: -150, y: 150 },
      ],
    ];
    const run = (stride: number) =>
      runTerrainJob({
        kind: 'dem',
        name: 'gleba',
        raster: dem.value.raster,
        georeference: dem.value.georeference,
        crs: dem.value.crs,
        project: GEOREFERENCE,
        rings,
        stride,
        source: { ...surveySource('gleba.tif', null), kind: 'dem', provider: 'GeoTIFF' },
      });
    const full = run(1);
    if (!full.ok) throw new Error(full.error.message);
    expect(full.value.terrain.source.resolution).toBe(10);
    expect(terrainElevationAt(full.value.terrain, 37, -81)).toBeCloseTo(altitude(37, -81) - 700, 3);
    expect(terrainStats(full.value.terrain).planArea).toBeCloseTo(90_000, 3);
    // Menos amostras, mesma posição: só os nós existentes viram vértices.
    const coarse = run(3);
    if (!coarse.ok) throw new Error(coarse.error.message);
    expect(coarse.value.terrain.source.resolution).toBe(30);
    expect(coarse.value.terrain.points.length).toBeLessThan(full.value.terrain.points.length / 4);
    expect(terrainElevationAt(coarse.value.terrain, 37, -81)).toBeCloseTo(
      altitude(37, -81) - 700,
      3,
    );
  });
});

describe('desenho do terreno no 3D', () => {
  const points: Vec3[] = [];
  for (let y = 0; y <= 40; y += 10) {
    for (let x = 0; x <= 40; x += 10) points.push(vec3(7_394_000 + x, 333_000 + y, 500 + 0.5 * x));
  }

  it('usa origem local, a normal de cada face e cores por altitude ou declividade', async () => {
    const { createTerrain } = await import('@hydrobim/core');
    const built = createTerrain('Rampa', points);
    if (!built.ok) throw new Error(built.error.message);
    const terrain = built.value;
    const mesh = buildTerrainMesh(terrain, 'elevation');
    expect(mesh.triangleCount).toBe(32);
    expect(mesh.base).toEqual({ x: 7_394_020, y: 333_020, z: 500 });
    // Posições relativas à origem local: pequenas, exatas em precisão simples.
    expect(Math.max(...mesh.positions.map(Math.abs))).toBeLessThanOrEqual(20);
    // Rampa de 50 % em X: normal (−0,5; 0; 1) normalizada em todas as faces.
    const length = Math.hypot(0.5, 1);
    for (let i = 0; i < mesh.normals.length; i += 3) {
      expect(mesh.normals[i]).toBeCloseTo(-0.5 / length, 6);
      expect(mesh.normals[i + 1]).toBeCloseTo(0, 6);
      expect(mesh.normals[i + 2]).toBeCloseTo(1 / length, 6);
    }
    expect([...elevationColor(0)]).not.toEqual([...elevationColor(1)]);
    const bySlope = buildTerrainMesh(terrain, 'slope');
    const steep = slopeColor(0.5);
    expect(bySlope.colors[0]).toBeCloseTo(steep[0], 6);
    expect(slopeColor(0.01)).not.toEqual(steep);
    // 25 vértices, 32 triângulos: 56 arestas (Euler), dois pontos de três coordenadas cada.
    expect(terrainEdges(terrain, mesh.base)).toHaveLength(56 * 6);
    const contours = contourSegments(terrain, 5, mesh.base)!;
    expect(contours.minor.length + contours.major.length).toBeGreaterThan(0);
    // Cada segmento fica na cota da sua curva (múltipla de 5 m acima da cota mínima).
    for (const list of [contours.minor, contours.major]) {
      for (let i = 2; i < list.length; i += 3) expect(list[i]! % 5).toBeCloseTo(0, 6);
    }
  });

  it('exporta o perfil em CSV com as lacunas vazias', async () => {
    const { createTerrain } = await import('@hydrobim/core');
    const built = createTerrain('Rampa', points);
    if (!built.ok) throw new Error(built.error.message);
    const profile = terrainProfile(built.value, [
      { x: 7_393_990, y: 333_020 },
      { x: 7_394_020, y: 333_020 },
    ]);
    if (!profile.ok) throw new Error(profile.error.message);
    const lines = profileCsv(profile.value).trim().split('\n');
    expect(lines[0]).toBe('distancia_m;x_m;y_m;cota_m');
    expect(lines[1]).toBe('0.000;7393990.000;333020.000;');
    expect(lines[lines.length - 1]).toBe('30.000;7394020.000;333020.000;510.000');
  });
});

describe('operações do terreno na planta', () => {
  beforeEach(() => {
    useEditorStore.getState().newProject('infra');
    useEditorStore.getState().setViewMode('plan');
    useTerrainStore.getState().reset();
  });

  it('desenha a área clicando os vértices e fecha no primeiro ponto', () => {
    const terrain = useTerrainStore.getState();
    terrain.setMode('area');
    for (const [x, y] of [
      [0, 0],
      [100, 0],
      [100, 80],
      [0, 80],
    ] as const) {
      useTerrainStore.getState().click({ x, y }, 2);
    }
    expect(useTerrainStore.getState().draft).toHaveLength(4);
    // Clique junto ao primeiro vértice (dentro do raio de captura): fecha o contorno.
    useTerrainStore.getState().click({ x: 1, y: -1 }, 2);
    const state = useTerrainStore.getState();
    expect(state.mode).toBeNull();
    expect(state.area).toHaveLength(4);
    expect(state.draft).toEqual([]);

    // Furo dentro do contorno; um furo fora é recusado e o desenho continua em edição.
    state.setMode('hole');
    for (const [x, y] of [
      [20, 20],
      [40, 20],
      [40, 40],
    ] as const) {
      useTerrainStore.getState().click({ x, y }, 2);
    }
    useTerrainStore.getState().finishDraft();
    expect(areaRings(useTerrainStore.getState())).toHaveLength(2);
    useTerrainStore.getState().setMode('hole');
    for (const [x, y] of [
      [90, 70],
      [140, 70],
      [140, 120],
    ] as const) {
      useTerrainStore.getState().click({ x, y }, 2);
    }
    useTerrainStore.getState().finishDraft();
    expect(useTerrainStore.getState().holes).toHaveLength(1);
    expect(useTerrainStore.getState().mode).toBe('hole');
    expect(useEditorStore.getState().message?.level).toBe('error');
  });

  it('recusa contorno que se cruza e encerra a operação quando outra ferramenta é escolhida', () => {
    useTerrainStore.getState().setMode('area');
    for (const [x, y] of [
      [0, 0],
      [100, 100],
      [100, 0],
      [0, 100],
    ] as const) {
      useTerrainStore.getState().click({ x, y }, 2);
    }
    useTerrainStore.getState().finishDraft();
    expect(useTerrainStore.getState().area).toBeNull();
    expect(useEditorStore.getState().message?.text).toMatch(/cruza a si mesmo/);
    // Esc: primeiro descarta o desenho, depois encerra a operação.
    useTerrainStore.getState().cancel();
    expect(useTerrainStore.getState().draft).toEqual([]);
    expect(useTerrainStore.getState().mode).toBe('area');
    useEditorStore.getState().setTool('pipe');
    expect(useTerrainStore.getState().mode).toBeNull();
  });

  it('traça o corte por dois ou mais pontos e não altera o projeto', () => {
    const before = useEditorStore.getState().project;
    useTerrainStore.getState().setMode('profile');
    useTerrainStore.getState().click({ x: 0, y: 0 }, 2);
    useTerrainStore.getState().finishDraft();
    expect(useTerrainStore.getState().profilePath).toBeNull();
    useTerrainStore.getState().click({ x: 50, y: 10 }, 2);
    // Clique repetido no último ponto conclui.
    useTerrainStore.getState().click({ x: 50.5, y: 10 }, 2);
    expect(useTerrainStore.getState().profilePath).toHaveLength(2);
    expect(useEditorStore.getState().project).toBe(before);
    expect(useEditorStore.getState().past).toHaveLength(0);
  });
});
