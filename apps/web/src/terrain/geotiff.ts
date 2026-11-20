import {
  fail,
  ok,
  type ElevationRaster,
  type RasterCrs,
  type RasterGeoreference,
  type Result,
} from '@hydrobim/core';

/**
 * Leitor de GeoTIFF para modelos de elevação de uma banda. Escrito sem dependências (ver
 * ADR-040): cobre o que os DEM distribuídos publicamente usam — TIFF clássico, faixas ou
 * blocos, sem compressão, Deflate ou LZW, preditor horizontal ou de ponto flutuante, amostras
 * inteiras de 8/16/32 bits ou reais de 32/64 bits — e recusa o resto com o motivo. O sistema
 * de referência vem das chaves GeoTIFF do arquivo; se elas faltam, o arquivo é recusado: a
 * posição de um raster nunca é presumida.
 */

export interface GeoTiffDem {
  readonly raster: ElevationRaster;
  readonly georeference: RasterGeoreference;
  readonly crs: RasterCrs;
  /** Código EPSG do sistema horizontal declarado no arquivo. */
  readonly epsg: number;
  /** Referência altimétrica declarada (chaves verticais do GeoTIFF); `null` = não declarada. */
  readonly verticalDatum: string | null;
  /** Tamanho da célula nas unidades do sistema do arquivo (graus ou metros). */
  readonly cellSize: { readonly x: number; readonly y: number };
  /** Nós sem dado (valor `NODATA` do arquivo ou não finitos). */
  readonly noDataCount: number;
}

/** Limite de nós de um raster lido por inteiro na memória (36 milhões ≈ 144 MB). */
export const MAX_RASTER_NODES = 36_000_000;

const TAG = {
  width: 256,
  height: 257,
  bitsPerSample: 258,
  compression: 259,
  stripOffsets: 273,
  samplesPerPixel: 277,
  rowsPerStrip: 278,
  stripByteCounts: 279,
  planarConfiguration: 284,
  predictor: 317,
  tileWidth: 322,
  tileLength: 323,
  tileOffsets: 324,
  tileByteCounts: 325,
  sampleFormat: 339,
  modelPixelScale: 33550,
  modelTiepoint: 33922,
  modelTransformation: 34264,
  geoKeyDirectory: 34735,
  geoDoubleParams: 34736,
  geoAsciiParams: 34737,
  gdalNoData: 42113,
} as const;

/** Sistemas geográficos aceitos: WGS 84 e SIRGAS 2000 (tratados como equivalentes, 1 m). */
const GEOGRAPHIC_EPSG = new Set([4326, 4674]);

type TagValue = number[] | string;

const TYPE_SIZE: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
};

function readTags(view: DataView, little: boolean, offset: number): Map<number, TagValue> | null {
  if (offset + 2 > view.byteLength) return null;
  const count = view.getUint16(offset, little);
  const tags = new Map<number, TagValue>();
  for (let i = 0; i < count; i += 1) {
    const entry = offset + 2 + i * 12;
    if (entry + 12 > view.byteLength) return null;
    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    const n = view.getUint32(entry + 4, little);
    const size = TYPE_SIZE[type];
    if (!size) continue;
    const at = size * n <= 4 ? entry + 8 : view.getUint32(entry + 8, little);
    if (at + size * n > view.byteLength) return null;
    if (type === 2) {
      let text = '';
      for (let k = 0; k < n; k += 1) {
        const code = view.getUint8(at + k);
        if (code !== 0) text += String.fromCharCode(code);
      }
      tags.set(tag, text);
      continue;
    }
    const values: number[] = new Array<number>(n);
    for (let k = 0; k < n; k += 1) {
      const p = at + k * size;
      switch (type) {
        case 1:
        case 7:
          values[k] = view.getUint8(p);
          break;
        case 6:
          values[k] = view.getInt8(p);
          break;
        case 3:
          values[k] = view.getUint16(p, little);
          break;
        case 8:
          values[k] = view.getInt16(p, little);
          break;
        case 4:
          values[k] = view.getUint32(p, little);
          break;
        case 9:
          values[k] = view.getInt32(p, little);
          break;
        case 5:
          values[k] = view.getUint32(p, little) / view.getUint32(p + 4, little);
          break;
        case 10:
          values[k] = view.getInt32(p, little) / view.getInt32(p + 4, little);
          break;
        case 11:
          values[k] = view.getFloat32(p, little);
          break;
        default:
          values[k] = view.getFloat64(p, little);
      }
    }
    tags.set(tag, values);
  }
  return tags;
}

/** Descompressão LZW do TIFF (códigos de 9 a 12 bits, bit mais significativo primeiro). */
export function decodeLzw(input: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let outLength = 0;
  // Dicionário: cada código aponta para o anterior e acrescenta um byte.
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const lengths = new Uint16Array(4096);
  for (let i = 0; i < 256; i += 1) {
    prefix[i] = -1;
    suffix[i] = i;
    lengths[i] = 1;
  }
  let next = 258;
  let bits = 9;
  let buffer = 0;
  let available = 0;
  let position = 0;
  let previous = -1;
  const emit = (code: number): number => {
    // Escreve a sequência do código de trás para a frente; devolve o primeiro byte dela.
    const length = lengths[code] as number;
    let at = outLength + length - 1;
    let current = code;
    let first = 0;
    while (current >= 0) {
      first = suffix[current] as number;
      if (at < expected) out[at] = first;
      at -= 1;
      current = prefix[current] as number;
    }
    outLength += length;
    return first;
  };
  while (outLength < expected) {
    while (available < bits && position < input.length) {
      buffer = ((buffer << 8) | (input[position] as number)) >>> 0;
      position += 1;
      available += 8;
    }
    if (available < bits) break;
    const code = (buffer >>> (available - bits)) & ((1 << bits) - 1);
    available -= bits;
    buffer &= available > 0 ? (1 << available) - 1 : 0;
    if (code === 257) break;
    if (code === 256) {
      next = 258;
      bits = 9;
      previous = -1;
      continue;
    }
    if (previous < 0) {
      if (code >= 256) throw new Error('fluxo LZW inválido');
      emit(code);
      previous = code;
      continue;
    }
    if (code < next) {
      const first = emit(code);
      if (next < 4096) {
        prefix[next] = previous;
        suffix[next] = first;
        lengths[next] = (lengths[previous] as number) + 1;
        next += 1;
      }
    } else if (code === next && next < 4096) {
      // Código ainda não definido: é a sequência anterior mais o primeiro byte dela.
      let root = previous;
      while ((prefix[root] as number) >= 0) root = prefix[root] as number;
      prefix[next] = previous;
      suffix[next] = suffix[root] as number;
      lengths[next] = (lengths[previous] as number) + 1;
      next += 1;
      emit(code);
    } else {
      throw new Error('fluxo LZW inválido');
    }
    previous = code;
    // "Mudança antecipada" do TIFF: o código cresce um bit uma posição antes do limite.
    if (next >= (1 << bits) - 1 && bits < 12) bits += 1;
  }
  return out;
}

async function inflate(input: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('este navegador não descomprime Deflate');
  }
  const stream = new Blob([input as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const first = (value: TagValue | undefined): number | undefined =>
  Array.isArray(value) ? value[0] : undefined;
const list = (value: TagValue | undefined): number[] => (Array.isArray(value) ? value : []);

/** Lê o primeiro diretório de um GeoTIFF como modelo de elevação. */
export async function readGeoTiffDem(buffer: ArrayBuffer): Promise<Result<GeoTiffDem>> {
  const view = new DataView(buffer);
  if (view.byteLength < 8) return fail('GEOTIFF_INVALID', 'O arquivo não é um TIFF.');
  const order = view.getUint16(0, false);
  if (order !== 0x4949 && order !== 0x4d4d) {
    return fail('GEOTIFF_INVALID', 'O arquivo não é um TIFF.');
  }
  const little = order === 0x4949;
  const magic = view.getUint16(2, little);
  if (magic === 43) {
    return fail(
      'GEOTIFF_BIGTIFF',
      'BigTIFF não é suportado. Recorte a área de interesse e exporte como GeoTIFF clássico.',
    );
  }
  if (magic !== 42) return fail('GEOTIFF_INVALID', 'O arquivo não é um TIFF.');
  const tags = readTags(view, little, view.getUint32(4, little));
  if (!tags) return fail('GEOTIFF_INVALID', 'O arquivo TIFF está truncado ou corrompido.');

  const width = first(tags.get(TAG.width)) ?? 0;
  const height = first(tags.get(TAG.height)) ?? 0;
  if (width < 2 || height < 2) {
    return fail('GEOTIFF_INVALID', 'O raster precisa de ao menos 2 × 2 células.');
  }
  if (width * height > MAX_RASTER_NODES) {
    return fail(
      'GEOTIFF_TOO_LARGE',
      `O raster tem ${(width * height).toLocaleString('pt-BR')} células; o limite é ${MAX_RASTER_NODES.toLocaleString('pt-BR')}. Recorte a área de interesse antes de importar.`,
    );
  }
  if ((first(tags.get(TAG.samplesPerPixel)) ?? 1) !== 1) {
    return fail(
      'GEOTIFF_BANDS',
      'O arquivo tem mais de uma banda: parece uma imagem, não um modelo de elevação.',
    );
  }
  const bits = first(tags.get(TAG.bitsPerSample)) ?? 1;
  const format = first(tags.get(TAG.sampleFormat)) ?? 1;
  const supported =
    (format === 3 && (bits === 32 || bits === 64)) ||
    ((format === 1 || format === 2) && (bits === 8 || bits === 16 || bits === 32));
  if (!supported) {
    return fail(
      'GEOTIFF_SAMPLE',
      `Formato de amostra não suportado (${bits} bits, tipo ${format}).`,
    );
  }
  const compression = first(tags.get(TAG.compression)) ?? 1;
  if (![1, 5, 8, 32946].includes(compression)) {
    return fail(
      'GEOTIFF_COMPRESSION',
      `Compressão não suportada (código ${compression}). Exporte o raster sem compressão, com Deflate ou com LZW.`,
    );
  }
  const predictor = first(tags.get(TAG.predictor)) ?? 1;
  if (![1, 2, 3].includes(predictor) || (predictor === 3 && format !== 3)) {
    return fail('GEOTIFF_PREDICTOR', `Preditor não suportado (código ${predictor}).`);
  }

  // ----- Georreferência: escala e ponto de amarração, sem rotação -----
  const scale = list(tags.get(TAG.modelPixelScale));
  const tie = list(tags.get(TAG.modelTiepoint));
  const matrix = list(tags.get(TAG.modelTransformation));
  let stepX: number;
  let stepY: number;
  let cornerX: number;
  let cornerY: number;
  if (scale.length >= 2 && tie.length >= 6) {
    stepX = scale[0] as number;
    stepY = -(scale[1] as number);
    cornerX = (tie[3] as number) - (tie[0] as number) * stepX;
    cornerY = (tie[4] as number) - (tie[1] as number) * stepY;
  } else if (matrix.length >= 16) {
    if (Math.abs(matrix[1] as number) > 1e-12 || Math.abs(matrix[4] as number) > 1e-12) {
      return fail(
        'GEOTIFF_ROTATED',
        'O raster está girado em relação ao seu sistema de referência. Reamostre-o alinhado aos eixos.',
      );
    }
    stepX = matrix[0] as number;
    stepY = matrix[5] as number;
    cornerX = matrix[3] as number;
    cornerY = matrix[7] as number;
  } else {
    return fail(
      'GEOTIFF_NO_GEOREFERENCE',
      'O arquivo não traz georreferência (escala e ponto de amarração). Sem ela o raster não pode ser posicionado.',
    );
  }
  if (!(Math.abs(stepX) > 0) || !(Math.abs(stepY) > 0)) {
    return fail('GEOTIFF_NO_GEOREFERENCE', 'Tamanho de célula inválido no arquivo.');
  }

  // ----- Chaves GeoTIFF: sistema horizontal e vertical -----
  const directory = list(tags.get(TAG.geoKeyDirectory));
  const ascii = tags.get(TAG.geoAsciiParams);
  const keys = new Map<number, number>();
  const texts = new Map<number, string>();
  for (let i = 4; i + 3 < directory.length; i += 4) {
    const key = directory[i] as number;
    const location = directory[i + 1] as number;
    const count = directory[i + 2] as number;
    const value = directory[i + 3] as number;
    if (location === 0) keys.set(key, value);
    else if (location === TAG.geoAsciiParams && typeof ascii === 'string') {
      texts.set(key, ascii.slice(value, value + count).replace(/\|$/, ''));
    }
  }
  const modelType = keys.get(1024);
  const projected = keys.get(3072);
  const geographic = keys.get(2048);
  let crs: RasterCrs;
  let epsg: number;
  if (modelType === 1 && projected && projected !== 32767) {
    epsg = projected;
    crs = projected === 3857 ? { kind: 'webMercator' } : { kind: 'projected', epsg: projected };
  } else if (modelType === 2 && geographic && GEOGRAPHIC_EPSG.has(geographic)) {
    epsg = geographic;
    crs = { kind: 'geographic' };
  } else if (modelType === 2 && geographic) {
    return fail(
      'GEOTIFF_CRS',
      `O raster está no sistema geográfico EPSG:${geographic}, sem transformação implementada. Reprojete-o para WGS 84 (EPSG:4326) ou SIRGAS 2000 (EPSG:4674).`,
    );
  } else {
    return fail(
      'GEOTIFF_CRS',
      'O arquivo não declara o sistema de referência por um código EPSG. Sem ele o raster não pode ser posicionado — nenhum sistema é presumido.',
    );
  }
  // PixelIsArea (padrão): o ponto de amarração é o canto da célula; o nó fica no centro.
  const pixelIsPoint = keys.get(1025) === 2;
  const originX = cornerX + (pixelIsPoint ? 0 : stepX / 2);
  const originY = cornerY + (pixelIsPoint ? 0 : stepY / 2);
  const verticalCode = keys.get(4096);
  const verticalText = texts.get(4097);
  const verticalDatum =
    verticalText && verticalText.length > 0
      ? verticalText
      : verticalCode && verticalCode !== 32767
        ? `EPSG:${verticalCode}`
        : null;
  const verticalUnits = keys.get(4099);
  if (verticalUnits !== undefined && verticalUnits !== 9001) {
    return fail(
      'GEOTIFF_VERTICAL_UNITS',
      `As cotas do arquivo não estão em metros (unidade EPSG:${verticalUnits}). Converta-as antes de importar.`,
    );
  }

  // ----- Dados -----
  const tiled = tags.has(TAG.tileOffsets);
  const blockWidth = tiled ? (first(tags.get(TAG.tileWidth)) ?? 0) : width;
  const blockHeight = tiled
    ? (first(tags.get(TAG.tileLength)) ?? 0)
    : Math.min(first(tags.get(TAG.rowsPerStrip)) ?? height, height);
  const offsets = list(tags.get(tiled ? TAG.tileOffsets : TAG.stripOffsets));
  const counts = list(tags.get(tiled ? TAG.tileByteCounts : TAG.stripByteCounts));
  if (
    blockWidth <= 0 ||
    blockHeight <= 0 ||
    offsets.length === 0 ||
    counts.length < offsets.length
  ) {
    return fail('GEOTIFF_INVALID', 'O arquivo não informa onde estão os dados do raster.');
  }
  const bytes = bits / 8;
  const noDataText = tags.get(TAG.gdalNoData);
  const noData = typeof noDataText === 'string' ? Number(noDataText.trim()) : Number.NaN;
  const data = new Float32Array(width * height);
  const across = Math.ceil(width / blockWidth);
  let noDataCount = 0;

  try {
    for (let block = 0; block < offsets.length; block += 1) {
      const bx = tiled ? (block % across) * blockWidth : 0;
      const by = tiled ? Math.floor(block / across) * blockHeight : block * blockHeight;
      if (by >= height) break;
      // Faixas: a última pode ter menos linhas. Blocos: sempre inteiros, com sobra.
      const rows = tiled ? blockHeight : Math.min(blockHeight, height - by);
      const expected = blockWidth * rows * bytes;
      const start = offsets[block] as number;
      const length = counts[block] as number;
      if (start + length > view.byteLength) {
        return fail('GEOTIFF_INVALID', 'O arquivo TIFF está truncado.');
      }
      let raw: Uint8Array = new Uint8Array(buffer, start, length);
      if (compression === 5) raw = decodeLzw(raw, expected);
      else if (compression !== 1) raw = await inflate(raw);
      if (raw.length < expected) {
        return fail('GEOTIFF_INVALID', 'Um bloco do raster tem menos dados do que o esperado.');
      }
      // Trabalha em cópia: os preditores alteram os bytes.
      const chunk = raw.slice(0, expected);
      if (predictor === 2) {
        for (let row = 0; row < rows; row += 1) {
          const base = row * blockWidth * bytes;
          if (bytes === 1) {
            for (let i = 1; i < blockWidth; i += 1) {
              chunk[base + i] =
                ((chunk[base + i] as number) + (chunk[base + i - 1] as number)) & 255;
            }
          } else {
            const line = new DataView(chunk.buffer, chunk.byteOffset + base, blockWidth * bytes);
            for (let i = 1; i < blockWidth; i += 1) {
              if (bytes === 2) {
                line.setUint16(
                  i * 2,
                  (line.getUint16(i * 2, little) + line.getUint16((i - 1) * 2, little)) & 0xffff,
                  little,
                );
              } else {
                line.setUint32(
                  i * 4,
                  (line.getUint32(i * 4, little) + line.getUint32((i - 1) * 4, little)) >>> 0,
                  little,
                );
              }
            }
          }
        }
      }
      let values = chunk;
      let valuesLittle = little;
      if (predictor === 3) {
        // Preditor de ponto flutuante: diferenças byte a byte sobre os planos de bytes da
        // linha, do mais significativo para o menos.
        values = new Uint8Array(expected);
        valuesLittle = false;
        const rowBytes = blockWidth * bytes;
        for (let row = 0; row < rows; row += 1) {
          const base = row * rowBytes;
          for (let i = 1; i < rowBytes; i += 1) {
            chunk[base + i] = ((chunk[base + i] as number) + (chunk[base + i - 1] as number)) & 255;
          }
          for (let i = 0; i < blockWidth; i += 1) {
            for (let b = 0; b < bytes; b += 1) {
              values[base + i * bytes + b] = chunk[base + b * blockWidth + i] as number;
            }
          }
        }
      }
      const samples = new DataView(values.buffer, values.byteOffset, values.byteLength);
      for (let row = 0; row < rows; row += 1) {
        const y = by + row;
        if (y >= height) break;
        for (let col = 0; col < blockWidth; col += 1) {
          const x = bx + col;
          if (x >= width) break;
          const p = (row * blockWidth + col) * bytes;
          let value: number;
          if (format === 3) {
            value =
              bits === 32
                ? samples.getFloat32(p, valuesLittle)
                : samples.getFloat64(p, valuesLittle);
          } else if (format === 2) {
            value =
              bits === 8
                ? samples.getInt8(p)
                : bits === 16
                  ? samples.getInt16(p, valuesLittle)
                  : samples.getInt32(p, valuesLittle);
          } else {
            value =
              bits === 8
                ? samples.getUint8(p)
                : bits === 16
                  ? samples.getUint16(p, valuesLittle)
                  : samples.getUint32(p, valuesLittle);
          }
          // O valor NODATA é comparado na precisão do tipo do raster.
          const missing =
            !Number.isFinite(value) ||
            (!Number.isNaN(noData) &&
              (value === noData || (format === 3 && bits === 32 && value === Math.fround(noData))));
          if (missing) {
            noDataCount += 1;
            data[y * width + x] = Number.NaN;
          } else {
            data[y * width + x] = value;
          }
        }
      }
    }
  } catch (error) {
    return fail(
      'GEOTIFF_DECODE',
      `Não foi possível ler os dados do raster (${error instanceof Error ? error.message : 'erro de leitura'}).`,
    );
  }

  return ok({
    raster: { width, height, data },
    georeference: { originX, originY, stepX, stepY },
    crs,
    epsg,
    verticalDatum,
    cellSize: { x: Math.abs(stepX), y: Math.abs(stepY) },
    noDataCount,
  });
}
