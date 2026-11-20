import { findProjectedCrs } from '../geo/crs';
import { geographicToProjected, projectedToGeographic } from '../geo/projection';
import type { GeoreferenceStatus } from '../geo/transform';
import type { Vec3 } from '../math';
import { fail, ok, type Result } from '../result';
import type { Point2 } from '../schema';
import { pointInPolygon, type Ring } from './polygon';
import { MAX_TERRAIN_VERTICES } from './surface';

/**
 * Modelo digital de elevação (DEM) em raster e a sua passagem para pontos cotados do projeto.
 *
 * Regras que este módulo garante:
 *  - os vértices da superfície são os próprios nós do raster (ou um a cada `stride` nós): nada
 *    é interpolado para "aumentar" a resolução;
 *  - onde o raster não tem dado (NaN) não há vértice nem triângulo;
 *  - a única interpolação é a bilinear dentro de uma célula, usada para cotar os vértices do
 *    limite, e ela exige os quatro nós da célula.
 */

export interface ElevationRaster {
  readonly width: number;
  readonly height: number;
  /** Cotas por linha, de cima para baixo; `NaN` = sem dado. */
  readonly data: Float32Array;
}

/** Posição dos nós no sistema de origem: centro do nó (coluna 0, linha 0) e passo por nó. */
export interface RasterGeoreference {
  readonly originX: number;
  readonly originY: number;
  readonly stepX: number;
  /** Negativo quando as linhas avançam para o sul (o caso comum). */
  readonly stepY: number;
}

export type RasterCrs =
  /** Longitude e latitude em graus (WGS 84 ou SIRGAS 2000). */
  | { readonly kind: 'geographic' }
  /** Web Mercator (EPSG:3857), em metros: o referencial dos ladrilhos. */
  | { readonly kind: 'webMercator' }
  /** Sistema projetado do registro do HydroBIM. */
  | { readonly kind: 'projected'; readonly epsg: number };

/** Conversão entre nós do raster (coluna, linha) e coordenadas locais do projeto. */
export interface RasterFrame {
  toLocal(col: number, row: number): Point2;
  fromLocal(x: number, y: number): { col: number; row: number };
}

const EARTH_RADIUS = 6378137;
const DEG = 180 / Math.PI;

/**
 * Monta a conversão raster ⇄ local pela cadeia de referenciais do projeto. Exige o projeto
 * georreferenciado: sem isso não há como posicionar o raster, e nenhuma posição é presumida.
 */
export function rasterFrame(
  georeference: RasterGeoreference,
  crs: RasterCrs,
  status: GeoreferenceStatus,
): Result<RasterFrame> {
  if (status.state !== 'ready') {
    return fail(
      'GEOREFERENCE_REQUIRED',
      `O projeto precisa estar georreferenciado para posicionar dados de elevação. ${status.message}`,
    );
  }
  const { transform } = status;
  const { originX, originY, stepX, stepY } = georeference;
  if (!(Math.abs(stepX) > 0) || !(Math.abs(stepY) > 0)) {
    return fail('RASTER_GEOREFERENCE', 'O raster não informa o tamanho da célula.');
  }
  let toLocalXY: (x: number, y: number) => Point2;
  let fromLocalXY: (p: Point2) => { x: number; y: number };
  if (crs.kind === 'geographic') {
    toLocalXY = (x, y) => transform.geographicToLocal({ lon: x, lat: y });
    fromLocalXY = (p) => {
      const g = transform.localToGeographic(p);
      return { x: g.lon, y: g.lat };
    };
  } else if (crs.kind === 'webMercator') {
    toLocalXY = (x, y) =>
      transform.geographicToLocal({
        lon: (x / EARTH_RADIUS) * DEG,
        lat: Math.atan(Math.sinh(y / EARTH_RADIUS)) * DEG,
      });
    fromLocalXY = (p) => {
      const g = transform.localToGeographic(p);
      return {
        x: (g.lon / DEG) * EARTH_RADIUS,
        y: Math.asinh(Math.tan(g.lat / DEG)) * EARTH_RADIUS,
      };
    };
  } else if (crs.epsg === transform.crs.epsg) {
    // Mesmo sistema do projeto: só a translação e a rotação da georreferência.
    toLocalXY = (x, y) => transform.projectedToLocal({ e: x, n: y });
    fromLocalXY = (p) => {
      const projected = transform.localToProjected(p);
      return { x: projected.e, y: projected.n };
    };
  } else {
    const source = findProjectedCrs(crs.epsg);
    if (!source) {
      return fail(
        'RASTER_CRS_UNSUPPORTED',
        `O raster está em EPSG:${crs.epsg}, sistema sem transformação implementada. Reprojete-o para o sistema do projeto (EPSG:${transform.crs.epsg}) ou para WGS 84 (EPSG:4326).`,
      );
    }
    toLocalXY = (x, y) =>
      transform.geographicToLocal(projectedToGeographic(source, { e: x, n: y }));
    fromLocalXY = (p) => {
      const projected = geographicToProjected(source, transform.localToGeographic(p));
      return { x: projected.e, y: projected.n };
    };
  }
  return ok({
    toLocal: (col, row) => toLocalXY(originX + col * stepX, originY + row * stepY),
    fromLocal: (x, y) => {
      const source = fromLocalXY({ x, y });
      return { col: (source.x - originX) / stepX, row: (source.y - originY) / stepY };
    },
  });
}

/**
 * Cota em uma posição fracionária do raster, por interpolação bilinear dentro da célula.
 * `null` fora do raster ou quando algum dos nós necessários não tem dado.
 */
export function sampleRaster(raster: ElevationRaster, col: number, row: number): number | null {
  const { width, height, data } = raster;
  const epsilon = 1e-9;
  if (col < -epsilon || row < -epsilon || col > width - 1 + epsilon || row > height - 1 + epsilon) {
    return null;
  }
  const c = Math.min(width - 1, Math.max(0, col));
  const r = Math.min(height - 1, Math.max(0, row));
  const c0 = Math.min(width - 1, Math.floor(c));
  const r0 = Math.min(height - 1, Math.floor(r));
  const fc = c - c0;
  const fr = r - r0;
  const c1 = fc > epsilon ? c0 + 1 : c0;
  const r1 = fr > epsilon ? r0 + 1 : r0;
  if (c1 > width - 1 || r1 > height - 1) return null;
  const z00 = data[r0 * width + c0] as number;
  const z10 = data[r0 * width + c1] as number;
  const z01 = data[r1 * width + c0] as number;
  const z11 = data[r1 * width + c1] as number;
  if (Number.isNaN(z00) || Number.isNaN(z10) || Number.isNaN(z01) || Number.isNaN(z11)) return null;
  return (z00 * (1 - fc) + z10 * fc) * (1 - fr) + (z01 * (1 - fc) + z11 * fc) * fr;
}

export interface DemSurfaceOptions {
  readonly raster: ElevationRaster;
  readonly frame: RasterFrame;
  /** Polígono de recorte já validado (contorno externo e furos), em coordenadas locais. */
  readonly rings: readonly Ring[];
  /** Usa um nó a cada `stride` (1 = todos). Reduz a densidade sem inventar valores. */
  readonly stride: number;
  /**
   * Altitude do ponto de cota local Z = 0 (`georeference.orthogonalHeight`): a cota local é a
   * altitude do raster menos este valor.
   */
  readonly heightOffset: number;
  readonly maxVertices?: number;
}

export interface DemSurfacePoints {
  readonly points: Vec3[];
  /** Anéis do limite, adensados no espaçamento das amostras e cotados pelo raster. */
  readonly boundary: Vec3[][];
  /** Espaçamento médio (m) entre as amostras usadas. */
  readonly spacing: number;
  /** Nós dentro da área que não têm dado de elevação. */
  readonly noDataNodes: number;
  /** `false` onde o raster não tem dado: o triângulo sobre a lacuna é removido. */
  readonly hasData: (x: number, y: number) => boolean;
}

/** Espaçamento (m, no referencial local) entre nós vizinhos junto a uma posição do raster. */
export function rasterSpacingAt(frame: RasterFrame, col: number, row: number, stride = 1): number {
  const here = frame.toLocal(col, row);
  const east = frame.toLocal(col + stride, row);
  const south = frame.toLocal(col, row + stride);
  return (
    (Math.hypot(east.x - here.x, east.y - here.y) +
      Math.hypot(south.x - here.x, south.y - here.y)) /
    2
  );
}

/** Pontos cotados e limite 3D para triangular a área `rings` com os nós do raster. */
export function demSurfacePoints(options: DemSurfaceOptions): Result<DemSurfacePoints> {
  const { raster, frame, rings, heightOffset } = options;
  const stride = Math.max(1, Math.round(options.stride));
  const maxVertices = options.maxVertices ?? MAX_TERRAIN_VERTICES;
  const outer = rings[0];
  if (!outer || outer.length < 3) return fail('POLYGON_EMPTY', 'A área não tem contorno.');

  let minCol = Infinity;
  let minRow = Infinity;
  let maxCol = -Infinity;
  let maxRow = -Infinity;
  for (const p of outer) {
    const { col, row } = frame.fromLocal(p.x, p.y);
    minCol = Math.min(minCol, col);
    maxCol = Math.max(maxCol, col);
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row);
  }
  if (maxCol < 0 || maxRow < 0 || minCol > raster.width - 1 || minRow > raster.height - 1) {
    return fail('DEM_OUTSIDE', 'A área escolhida fica fora da cobertura dos dados de elevação.');
  }
  const c0 = Math.max(0, Math.ceil(minCol / stride) * stride);
  const c1 = Math.min(raster.width - 1, Math.floor(maxCol));
  const r0 = Math.max(0, Math.ceil(minRow / stride) * stride);
  const r1 = Math.min(raster.height - 1, Math.floor(maxRow));
  const spacing = rasterSpacingAt(
    frame,
    Math.min(raster.width - 1, Math.max(0, (minCol + maxCol) / 2)),
    Math.min(raster.height - 1, Math.max(0, (minRow + maxRow) / 2)),
    stride,
  );
  if (!(spacing > 0)) return fail('RASTER_GEOREFERENCE', 'Tamanho de célula inválido.');

  const tooMany = (count: number): Result<never> => {
    const suggested = Math.ceil(stride * Math.sqrt(count / maxVertices) * 1.05);
    return fail(
      'TERRAIN_TOO_MANY',
      `A área tem cerca de ${count.toLocaleString('pt-BR')} amostras nesta resolução; o limite é ${maxVertices.toLocaleString('pt-BR')} vértices. Reduza a área ou use uma amostra a cada ${suggested} (≈ ${((spacing / stride) * suggested).toFixed(1)} m).`,
    );
  };
  const candidates = (Math.floor((c1 - c0) / stride) + 1) * (Math.floor((r1 - r0) / stride) + 1);
  if (candidates > maxVertices * 40) return tooMany(candidates);

  const points: Vec3[] = [];
  let noDataNodes = 0;
  for (let row = r0; row <= r1; row += stride) {
    for (let col = c0; col <= c1; col += stride) {
      const local = frame.toLocal(col, row);
      if (!pointInPolygon(rings, local.x, local.y)) continue;
      const z = raster.data[row * raster.width + col] as number;
      if (Number.isNaN(z)) {
        noDataNodes += 1;
        continue;
      }
      points.push({ x: local.x, y: local.y, z: z - heightOffset });
    }
    if (points.length > maxVertices)
      return tooMany(Math.round(points.length * ((r1 - r0) / Math.max(row - r0, stride))));
  }

  // Limite adensado no espaçamento das amostras: o contorno acompanha o relevo do raster em
  // vez de ligar vértices distantes por uma reta em 3D.
  const boundary: Vec3[][] = [];
  for (const ring of rings) {
    const out: Vec3[] = [];
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i] as Point2;
      const b = ring[(i + 1) % ring.length] as Point2;
      const parts = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / spacing));
      for (let k = 0; k < parts; k += 1) {
        const x = a.x + ((b.x - a.x) * k) / parts;
        const y = a.y + ((b.y - a.y) * k) / parts;
        const node = frame.fromLocal(x, y);
        const z = sampleRaster(raster, node.col, node.row);
        if (z === null) {
          return fail(
            'DEM_NO_DATA_AT_BOUNDARY',
            `A fonte não tem dado de elevação em um ponto do limite da área (X ${x.toFixed(2)}; Y ${y.toFixed(2)}). Ajuste a área para dentro da cobertura dos dados: nenhuma cota é presumida.`,
          );
        }
        out.push({ x, y, z: z - heightOffset });
      }
    }
    boundary.push(out);
  }
  const total = points.length + boundary.reduce((sum, ring) => sum + ring.length, 0);
  if (total > maxVertices) return tooMany(total);
  if (points.length === 0 && noDataNodes > 0) {
    return fail('DEM_NO_DATA', 'A fonte não tem dado de elevação dentro da área escolhida.');
  }

  return ok({
    points,
    boundary,
    spacing,
    noDataNodes,
    hasData: (x, y) => {
      const node = frame.fromLocal(x, y);
      return sampleRaster(raster, node.col, node.row) !== null;
    },
  });
}
