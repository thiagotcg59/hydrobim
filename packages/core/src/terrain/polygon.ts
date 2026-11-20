import type { Geographic } from '../geo/projection';
import { fail, ok, type Result } from '../result';
import type { Point2 } from '../schema';

/**
 * Polígonos em planta: área de recorte do terreno (contorno externo e furos) e leitura e
 * escrita de GeoJSON. Um polígono é uma lista de anéis — o primeiro é o contorno externo, os
 * demais são furos —, sem repetir o primeiro vértice no fim.
 */

export type Ring = readonly Point2[];

/** Limite de vértices por polígono (a verificação de autointerseção é quadrática). */
export const MAX_POLYGON_VERTICES = 5000;

/** Área com sinal: positiva em sentido anti-horário. */
export function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i] as Point2;
    const q = ring[(i + 1) % ring.length] as Point2;
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

export function pointInRing(ring: Ring, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i] as Point2;
    const b = ring[j] as Point2;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Dentro do contorno externo e fora de todos os furos. */
export function pointInPolygon(rings: readonly Ring[], x: number, y: number): boolean {
  const outer = rings[0];
  if (!outer || !pointInRing(outer, x, y)) return false;
  for (let i = 1; i < rings.length; i += 1) {
    if (pointInRing(rings[i] as Ring, x, y)) return false;
  }
  return true;
}

/** Área do polígono (contorno menos furos), em m². */
export function polygonArea(rings: readonly Ring[]): number {
  return rings.reduce(
    (sum, ring, index) => sum + (index === 0 ? 1 : -1) * Math.abs(ringArea(ring)),
    0,
  );
}

/** Menor distância de (x, y) aos lados dos anéis. */
export function distanceToRings(rings: readonly Ring[], x: number, y: number): number {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i] as Point2;
      const b = ring[(i + 1) % ring.length] as Point2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
      const d = Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
      if (d < best) best = d;
    }
  }
  return best;
}

const cross = (o: Point2, a: Point2, b: Point2): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Os segmentos a–b e c–d se cruzam (inclui toque e sobreposição colinear)? */
function segmentsTouch(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  const within = (p: Point2, q: Point2, r: Point2): boolean =>
    Math.min(p.x, q.x) <= r.x &&
    r.x <= Math.max(p.x, q.x) &&
    Math.min(p.y, q.y) <= r.y &&
    r.y <= Math.max(p.y, q.y);
  return (
    (d1 === 0 && within(c, d, a)) ||
    (d2 === 0 && within(c, d, b)) ||
    (d3 === 0 && within(a, b, c)) ||
    (d4 === 0 && within(a, b, d))
  );
}

/** Remove o vértice de fechamento repetido e vértices consecutivos coincidentes. */
function cleanRing(ring: Ring, tolerance: number): Point2[] {
  const out: Point2[] = [];
  for (const p of ring) {
    const previous = out[out.length - 1];
    if (previous && Math.hypot(p.x - previous.x, p.y - previous.y) <= tolerance) continue;
    out.push({ x: p.x, y: p.y });
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (
    out.length > 1 &&
    first &&
    last &&
    Math.hypot(first.x - last.x, first.y - last.y) <= tolerance
  ) {
    out.pop();
  }
  return out;
}

/**
 * Confere e normaliza um polígono: contorno externo anti-horário, furos em sentido horário,
 * sem autointerseção, furos dentro do contorno e sem se tocar. Nada é corrigido em silêncio:
 * um polígono inválido é recusado com o motivo.
 */
export function validatePolygon(rings: readonly Ring[], tolerance = 1e-3): Result<Point2[][]> {
  if (rings.length === 0) return fail('POLYGON_EMPTY', 'A área não tem contorno.');
  const cleaned = rings.map((ring) => cleanRing(ring, tolerance));
  const total = cleaned.reduce((sum, ring) => sum + ring.length, 0);
  if (total > MAX_POLYGON_VERTICES) {
    return fail(
      'POLYGON_TOO_MANY',
      `O polígono tem ${total} vértices; o limite é ${MAX_POLYGON_VERTICES}. Simplifique o contorno.`,
    );
  }
  for (let r = 0; r < cleaned.length; r += 1) {
    const ring = cleaned[r] as Point2[];
    const label = r === 0 ? 'O contorno' : `O furo ${r}`;
    if (ring.length < 3) {
      return fail('POLYGON_TOO_FEW', `${label} precisa de ao menos três vértices distintos.`);
    }
    for (let i = 0; i < ring.length; i += 1) {
      for (let j = i + 1; j < ring.length; j += 1) {
        // Lados vizinhos compartilham um vértice: não contam como cruzamento.
        if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue;
        if (
          segmentsTouch(
            ring[i] as Point2,
            ring[(i + 1) % ring.length] as Point2,
            ring[j] as Point2,
            ring[(j + 1) % ring.length] as Point2,
          )
        ) {
          return fail(
            'POLYGON_SELF_INTERSECTION',
            `${label} cruza a si mesmo (lados ${i + 1} e ${j + 1}). Redesenhe sem cruzamentos.`,
          );
        }
      }
    }
    if (Math.abs(ringArea(ring)) < tolerance * tolerance) {
      return fail('POLYGON_DEGENERATE', `${label} não delimita área (vértices colineares).`);
    }
  }
  const outer = cleaned[0] as Point2[];
  for (let h = 1; h < cleaned.length; h += 1) {
    const hole = cleaned[h] as Point2[];
    if (!hole.every((p) => pointInRing(outer, p.x, p.y))) {
      return fail('POLYGON_HOLE_OUTSIDE', `O furo ${h} não está inteiro dentro do contorno.`);
    }
    for (let other = 0; other < h; other += 1) {
      const ring = cleaned[other] as Point2[];
      for (let i = 0; i < hole.length; i += 1) {
        for (let j = 0; j < ring.length; j += 1) {
          if (
            segmentsTouch(
              hole[i] as Point2,
              hole[(i + 1) % hole.length] as Point2,
              ring[j] as Point2,
              ring[(j + 1) % ring.length] as Point2,
            )
          ) {
            return fail(
              'POLYGON_HOLE_CROSSING',
              other === 0
                ? `O furo ${h} toca ou cruza o contorno.`
                : `Os furos ${other} e ${h} se tocam ou se cruzam.`,
            );
          }
        }
      }
      if (other > 0 && pointInRing(ring, (hole[0] as Point2).x, (hole[0] as Point2).y)) {
        return fail('POLYGON_HOLE_NESTED', `O furo ${h} está dentro do furo ${other}.`);
      }
    }
  }
  return ok(
    cleaned.map((ring, index) => {
      const ccw = ringArea(ring) > 0;
      return ccw === (index === 0) ? ring : [...ring].reverse();
    }),
  );
}

// ---------------------------------------------------------------------------
// GeoJSON (RFC 7946): longitude e latitude em graus, WGS 84
// ---------------------------------------------------------------------------

export interface GeoPolygon {
  /** Nome da feição (`properties.name`), quando houver. */
  readonly name: string | null;
  /** Anéis em coordenadas geográficas: contorno externo e furos. */
  readonly rings: Geographic[][];
}

function geoRing(value: unknown): Geographic[] | null {
  if (!Array.isArray(value)) return null;
  const ring: Geographic[] = [];
  for (const position of value) {
    if (!Array.isArray(position) || position.length < 2) return null;
    const [lon, lat] = position as unknown[];
    if (typeof lon !== 'number' || typeof lat !== 'number') return null;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
    ring.push({ lon, lat });
  }
  return ring;
}

/**
 * Polígonos de um documento GeoJSON (`Polygon`, `MultiPolygon`, `Feature`,
 * `FeatureCollection` ou `GeometryCollection`). As coordenadas têm de estar em graus
 * (WGS 84, como manda a RFC 7946): um arquivo em coordenadas projetadas é recusado, nunca
 * reinterpretado.
 */
export function parseGeoJsonPolygons(text: string): Result<GeoPolygon[]> {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return fail('GEOJSON_INVALID', 'O arquivo não é um JSON válido.');
  }
  if (typeof root === 'object' && root !== null && 'crs' in root) {
    const name = JSON.stringify((root as { crs: unknown }).crs);
    if (!/CRS84|4326/.test(name)) {
      return fail(
        'GEOJSON_CRS',
        'O GeoJSON declara um sistema de referência diferente do WGS 84. Exporte-o em longitude e latitude (EPSG:4326).',
      );
    }
  }
  const polygons: GeoPolygon[] = [];
  let invalid = false;
  const addPolygon = (coordinates: unknown, name: string | null): void => {
    if (!Array.isArray(coordinates) || coordinates.length === 0) {
      invalid = true;
      return;
    }
    const rings = coordinates.map(geoRing);
    if (rings.some((ring) => ring === null)) {
      invalid = true;
      return;
    }
    polygons.push({ name, rings: rings as Geographic[][] });
  };
  const visit = (node: unknown, name: string | null): void => {
    if (typeof node !== 'object' || node === null) return;
    const item = node as Record<string, unknown>;
    switch (item.type) {
      case 'FeatureCollection':
        if (Array.isArray(item.features)) item.features.forEach((f) => visit(f, null));
        break;
      case 'Feature': {
        const properties = item.properties as Record<string, unknown> | null | undefined;
        const label = typeof properties?.name === 'string' ? properties.name : null;
        visit(item.geometry, label);
        break;
      }
      case 'GeometryCollection':
        if (Array.isArray(item.geometries)) item.geometries.forEach((g) => visit(g, name));
        break;
      case 'Polygon':
        addPolygon(item.coordinates, name);
        break;
      case 'MultiPolygon':
        if (Array.isArray(item.coordinates)) item.coordinates.forEach((c) => addPolygon(c, name));
        break;
      default:
        break;
    }
  };
  visit(root, null);
  if (invalid) {
    return fail(
      'GEOJSON_COORDINATES',
      'Coordenadas inválidas: o GeoJSON precisa estar em longitude e latitude, em graus (WGS 84).',
    );
  }
  if (polygons.length === 0) {
    return fail('GEOJSON_NO_POLYGON', 'O arquivo não contém nenhum polígono.');
  }
  return ok(polygons);
}

/** Polígono como `Feature` GeoJSON (anéis fechados, contorno externo anti-horário). */
export function polygonToGeoJson(
  rings: readonly (readonly Geographic[])[],
  properties: Record<string, string | number | null> = {},
): string {
  const coordinates = rings.map((ring) => {
    const positions = ring.map((p) => [Number(p.lon.toFixed(8)), Number(p.lat.toFixed(8))]);
    const first = positions[0];
    if (first) positions.push([...first]);
    return positions;
  });
  return `${JSON.stringify(
    { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates } },
    null,
    2,
  )}\n`;
}
