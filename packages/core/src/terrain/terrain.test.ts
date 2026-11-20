import { describe, expect, it } from 'vitest';
import { createTerrain } from '../analysis';
import { georeferenceStatus } from '../geo/transform';
import { geographicToTile } from '../geo/webMercator';
import { vec3, type Vec3 } from '../math';
import { createProject } from '../operations';
import { setTerrain } from '../projectOps';
import type { Result } from '../result';
import { surveySource, type Georeference, type Point2, type Terrain } from '../schema';
import { parseProject, serializeProject } from '../serialization';
import { validateProject } from '../validation';
import { suggestContourInterval, terrainContours } from './contours';
import { axisElevationForCover, coverAlongSegment } from './cover';
import {
  constrainedDelaunay,
  EDGE_BOUNDARY,
  EDGE_BREAKLINE,
  type ConstraintEdge,
} from './delaunay';
import { demSurfacePoints, rasterFrame, sampleRaster, type RasterFrame } from './dem';
import {
  parseGeoJsonPolygons,
  pointInPolygon,
  polygonArea,
  polygonToGeoJson,
  validatePolygon,
} from './polygon';
import { terrainProfile } from './profile';
import { buildSurveySurface, parseBreaklines, terrainExchange } from './survey';
import { buildTerrainSurface, terrainElevationAt, terrainHitAt, terrainStats } from './surface';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
const codeOf = (result: Result<unknown>): string => (result.ok ? 'ok' : result.error.code);

/** Gerador determinístico (os testes não dependem de `Math.random`). */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function areaOf(xs: number[], ys: number[], triangles: number[]): number {
  let area = 0;
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, b, c] = [triangles[i]!, triangles[i + 1]!, triangles[i + 2]!];
    const signed =
      ((xs[b]! - xs[a]!) * (ys[c]! - ys[a]!) - (ys[b]! - ys[a]!) * (xs[c]! - xs[a]!)) / 2;
    // Todos os triângulos saem em sentido anti-horário.
    expect(signed).toBeGreaterThan(0);
    area += signed;
  }
  return area;
}

function hasEdge(triangles: number[], a: number, b: number): boolean {
  for (let i = 0; i < triangles.length; i += 3) {
    const t = [triangles[i], triangles[i + 1], triangles[i + 2]];
    if (t.includes(a) && t.includes(b)) return true;
  }
  return false;
}

const SOURCE = surveySource('teste.xyz', '2026-11-19T00:00:00.000Z');

/** Plano inclinado z = 100 + 0,02 x + 0,01 y sobre uma malha regular. */
function planePoints(size: number, step: number): Vec3[] {
  const points: Vec3[] = [];
  for (let y = 0; y <= size; y += step) {
    for (let x = 0; x <= size; x += step) points.push(vec3(x, y, 100 + 0.02 * x + 0.01 * y));
  }
  return points;
}

describe('triangulação de Delaunay com restrições', () => {
  it('respeita o círculo vazio em pontos quaisquer e cobre a envoltória convexa', () => {
    const next = random(7);
    const xs: number[] = [];
    const ys: number[] = [];
    // Coordenadas na ordem de grandeza de UTM: a conta não pode perder precisão.
    for (let i = 0; i < 400; i += 1) {
      xs.push(333000 + next() * 800);
      ys.push(7394000 + next() * 600);
    }
    const { triangles, conflicts } = constrainedDelaunay(xs, ys);
    expect(conflicts).toEqual([]);
    // Euler: 2n − 2 − h triângulos; com h ≥ 3 vértices na envoltória.
    expect(triangles.length / 3).toBeLessThanOrEqual(2 * 400 - 5);
    expect(triangles.length / 3).toBeGreaterThan(700);
    let violations = 0;
    for (let i = 0; i < triangles.length; i += 3) {
      const [a, b, c] = [triangles[i]!, triangles[i + 1]!, triangles[i + 2]!];
      const ax = xs[a]!;
      const ay = ys[a]!;
      const bx = xs[b]! - ax;
      const by = ys[b]! - ay;
      const cx = xs[c]! - ax;
      const cy = ys[c]! - ay;
      const d = 2 * (bx * cy - by * cx);
      const ux = (cy * (bx * bx + by * by) - by * (cx * cx + cy * cy)) / d;
      const uy = (bx * (cx * cx + cy * cy) - cx * (bx * bx + by * by)) / d;
      const r = Math.hypot(ux, uy);
      for (let p = 0; p < xs.length; p += 1) {
        if (p === a || p === b || p === c) continue;
        if (Math.hypot(xs[p]! - ax - ux, ys[p]! - ay - uy) <= r * (1 - 1e-9)) violations += 1;
      }
    }
    // Nenhum ponto dentro do círculo circunscrito de nenhum triângulo.
    expect(violations).toBe(0);
    areaOf(xs, ys, triangles);
  });

  it('triangula uma malha regular (pontos cocirculares e colineares) sem falhas', () => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let r = 0; r < 30; r += 1) {
      for (let c = 0; c < 30; c += 1) {
        xs.push(c * 10);
        ys.push(r * 10);
      }
    }
    const { triangles } = constrainedDelaunay(xs, ys);
    expect(triangles.length / 3).toBe(2 * 29 * 29);
    expect(areaOf(xs, ys, triangles)).toBeCloseTo(290 * 290, 6);
  });

  it('não deixa triângulos fora de um contorno côncavo nem dentro de um furo', () => {
    // "L": quadrado de 100 m sem o canto superior direito; furo quadrado no braço de baixo.
    const outer: Point2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 40, y: 40 },
      { x: 40, y: 100 },
      { x: 0, y: 100 },
    ];
    const hole: Point2[] = [
      { x: 60, y: 10 },
      { x: 60, y: 30 },
      { x: 80, y: 30 },
      { x: 80, y: 10 },
    ];
    const xs: number[] = [];
    const ys: number[] = [];
    const constraints: ConstraintEdge[] = [];
    for (const ring of [outer, hole]) {
      const base = xs.length;
      ring.forEach((p, i) => {
        xs.push(p.x);
        ys.push(p.y);
        constraints.push({ a: base + i, b: base + ((i + 1) % ring.length), kind: EDGE_BOUNDARY });
      });
    }
    const next = random(3);
    for (let i = 0; i < 300; i += 1) {
      xs.push(next() * 100);
      ys.push(next() * 100);
    }
    const { triangles, conflicts } = constrainedDelaunay(xs, ys, constraints);
    expect(conflicts).toEqual([]);
    for (let i = 0; i < triangles.length; i += 3) {
      const cx = (xs[triangles[i]!]! + xs[triangles[i + 1]!]! + xs[triangles[i + 2]!]!) / 3;
      const cy = (ys[triangles[i]!]! + ys[triangles[i + 1]!]! + ys[triangles[i + 2]!]!) / 3;
      expect(pointInPolygon([outer, hole], cx, cy)).toBe(true);
    }
    // 100² − 60² (canto) − 20² (furo).
    expect(areaOf(xs, ys, triangles)).toBeCloseTo(10000 - 3600 - 400, 6);
    expect(polygonArea([outer, hole])).toBeCloseTo(6000, 9);
  });

  it('mantém as linhas de quebra como arestas e acusa cruzamento entre elas', () => {
    const xs = [0, 100, 100, 0];
    const ys = [0, 0, 100, 100];
    const next = random(11);
    for (let i = 0; i < 200; i += 1) {
      xs.push(5 + next() * 90);
      ys.push(5 + next() * 90);
    }
    // Linha de quebra diagonal entre dois cantos: cruza dezenas de arestas de Delaunay.
    const { triangles, conflicts } = constrainedDelaunay(xs, ys, [
      { a: 0, b: 2, kind: EDGE_BREAKLINE },
    ]);
    expect(conflicts).toEqual([]);
    expect(areaOf(xs, ys, triangles)).toBeCloseTo(10000, 6);
    // Nenhum triângulo atravessa a diagonal: cada um fica de um só lado dela.
    for (let i = 0; i < triangles.length; i += 3) {
      const sides = [0, 1, 2].map((k) => {
        const v = triangles[i + k]!;
        return Math.sign(Math.round((xs[v]! - ys[v]!) * 1e9));
      });
      expect(sides.includes(1) && sides.includes(-1)).toBe(false);
    }
    const crossing = constrainedDelaunay(xs, ys, [
      { a: 0, b: 2, kind: EDGE_BREAKLINE },
      { a: 1, b: 3, kind: EDGE_BREAKLINE },
    ]);
    expect(crossing.conflicts).toHaveLength(1);
    expect(crossing.conflicts[0]!.crossedKind).toBe(EDGE_BREAKLINE);
  });

  it('funde pontos coincidentes e mantém a aresta obrigatória dividida por um ponto sobre ela', () => {
    const xs = [0, 10, 10, 0, 5, 5, 10];
    const ys = [0, 0, 10, 10, 0, 5, 10];
    const { triangles, alias } = constrainedDelaunay(xs, ys, [
      { a: 0, b: 1, kind: EDGE_BREAKLINE },
    ]);
    expect(alias[6]).toBe(2);
    expect(hasEdge(triangles, 0, 4)).toBe(true);
    expect(hasEdge(triangles, 4, 1)).toBe(true);
    expect(areaOf(xs, ys, triangles)).toBeCloseTo(100, 9);
  });
});

describe('polígonos e GeoJSON', () => {
  const square: Point2[] = [
    { x: 0, y: 0 },
    { x: 0, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 0 },
  ];

  it('normaliza o sentido dos anéis e recusa polígonos inválidos', () => {
    const hole: Point2[] = [
      { x: 2, y: 2 },
      { x: 4, y: 2 },
      { x: 4, y: 4 },
      { x: 2, y: 4 },
    ];
    // Contorno dado em sentido horário e fechado com o primeiro ponto repetido.
    const rings = unwrap(validatePolygon([[...square, square[0]!], hole]));
    expect(rings[0]).toHaveLength(4);
    expect(polygonArea(rings)).toBeCloseTo(96, 9);
    expect(pointInPolygon(rings, 1, 1)).toBe(true);
    expect(pointInPolygon(rings, 3, 3)).toBe(false);
    expect(pointInPolygon(rings, 11, 3)).toBe(false);

    const bow: Point2[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(codeOf(validatePolygon([bow]))).toBe('POLYGON_SELF_INTERSECTION');
    expect(codeOf(validatePolygon([square.slice(0, 2)]))).toBe('POLYGON_TOO_FEW');
    expect(
      codeOf(
        validatePolygon([
          square,
          [
            { x: 8, y: 8 },
            { x: 12, y: 8 },
            { x: 12, y: 12 },
          ],
        ]),
      ),
    ).toBe('POLYGON_HOLE_OUTSIDE');
  });

  it('lê polígonos GeoJSON em graus e recusa coordenadas projetadas', () => {
    const feature = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Gleba A' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-46.64, -23.56],
                [-46.63, -23.56],
                [-46.63, -23.55],
                [-46.64, -23.55],
                [-46.64, -23.56],
              ],
            ],
          },
        },
      ],
    };
    const polygons = unwrap(parseGeoJsonPolygons(JSON.stringify(feature)));
    expect(polygons).toHaveLength(1);
    expect(polygons[0]!.name).toBe('Gleba A');
    expect(polygons[0]!.rings[0]![0]).toEqual({ lon: -46.64, lat: -23.56 });

    const text = polygonToGeoJson(
      polygons[0]!.rings.map((ring) => ring.slice(0, -1)),
      { name: 'Gleba A' },
    );
    expect(unwrap(parseGeoJsonPolygons(text))[0]!.rings[0]).toHaveLength(5);

    const projected = {
      type: 'Polygon',
      coordinates: [
        [
          [333287, 7394586],
          [333387, 7394586],
          [333387, 7394686],
        ],
      ],
    };
    expect(codeOf(parseGeoJsonPolygons(JSON.stringify(projected)))).toBe('GEOJSON_COORDINATES');
    expect(codeOf(parseGeoJsonPolygons('{ nada'))).toBe('GEOJSON_INVALID');
    expect(codeOf(parseGeoJsonPolygons('{"type":"Point","coordinates":[0,0]}'))).toBe(
      'GEOJSON_NO_POLYGON',
    );
  });
});

describe('superfície do terreno', () => {
  it('interpola cotas, declividade e estatísticas sobre um plano', () => {
    const { terrain, report } = unwrap(
      buildTerrainSurface({
        name: 'Plano',
        points: [...planePoints(100, 10), vec3(50, 50, 101.5)],
        boundary: null,
        breaklines: [],
        source: SOURCE,
      }),
    );
    expect(report.duplicates).toBe(1);
    expect(terrain.points).toHaveLength(121);
    expect(terrainElevationAt(terrain, 37.5, 62.5)).toBeCloseTo(100 + 0.75 + 0.625, 9);
    expect(terrainElevationAt(terrain, 100, 100)).toBeCloseTo(103, 9);
    expect(terrainElevationAt(terrain, 100.01, 50)).toBeNull();
    const hit = terrainHitAt(terrain, 33, 71)!;
    expect(hit.slope).toBeCloseTo(Math.hypot(0.02, 0.01), 9);
    // Desce para −X e −Y: azimute (a partir de +Y, horário) no terceiro quadrante.
    expect(hit.downslope).toBeCloseTo(Math.PI + Math.atan2(0.02, 0.01), 9);
    const stats = terrainStats(terrain);
    expect(stats.planArea).toBeCloseTo(10000, 6);
    expect(stats.surfaceArea).toBeCloseTo(10000 * Math.sqrt(1 + 0.0005), 6);
    expect(stats.meanSlope).toBeCloseTo(Math.hypot(0.02, 0.01), 9);
    expect(stats.minZ).toBe(100);
    expect(stats.maxZ).toBe(103);
  });

  it('recorta pelo limite com furo e mantém a descontinuidade da linha de quebra', () => {
    const z = (x: number, y: number): number => 100 + 0.02 * x + 0.01 * y;
    const ring = (points: [number, number][]): Vec3[] =>
      points.map(([x, y]) => vec3(x, y, z(x, y)));
    // Crista: uma linha de quebra 5 m acima do plano, entre pontos da malha.
    const crest = [vec3(15, 55, z(15, 55) + 5), vec3(85, 55, z(85, 55) + 5)];
    const { terrain, report } = unwrap(
      buildTerrainSurface({
        name: 'Recorte',
        points: planePoints(100, 10),
        boundary: [
          ring([
            [5, 5],
            [95, 5],
            [95, 95],
            [5, 95],
          ]),
          ring([
            [42, 12],
            [42, 28],
            [58, 28],
            [58, 12],
          ]),
        ],
        breaklines: [crest],
        source: SOURCE,
      }),
    );
    // Os pontos da borda da malha (x ou y = 0 ou 100) e os de dentro do furo ficam fora.
    expect(report.outside).toBe(40 + 1);
    expect(terrainStats(terrain).planArea).toBeCloseTo(90 * 90 - 16 * 16, 6);
    expect(terrainElevationAt(terrain, 50, 20)).toBeNull(); // dentro do furo
    expect(terrainElevationAt(terrain, 2, 50)).toBeNull(); // fora do contorno
    expect(terrainElevationAt(terrain, 20, 20)).toBeCloseTo(z(20, 20), 9);
    // Sobre a crista a cota é a da linha de quebra, em toda a extensão dela.
    expect(terrainElevationAt(terrain, 50, 55)).toBeCloseTo(z(50, 55) + 5, 9);
    expect(terrainElevationAt(terrain, 33.3, 55)).toBeCloseTo(z(33.3, 55) + 5, 9);
    expect(terrain.breaklines).toHaveLength(1);
    expect(terrain.boundary).toHaveLength(2);
  });

  it('recusa linhas de quebra que se cruzam e superfícies acima do limite de vértices', () => {
    const cross = buildTerrainSurface({
      name: 'X',
      points: planePoints(100, 10),
      boundary: null,
      breaklines: [
        [vec3(15, 15, 110), vec3(85, 85, 110)],
        [vec3(15, 82, 120), vec3(85, 24, 120)],
      ],
      source: SOURCE,
    });
    expect(codeOf(cross)).toBe('TERRAIN_BREAKLINE_CROSSING');
    const many = buildTerrainSurface({
      name: 'X',
      points: planePoints(100, 10),
      boundary: null,
      breaklines: [],
      source: SOURCE,
      maxVertices: 50,
    });
    expect(codeOf(many)).toBe('TERRAIN_TOO_MANY');
    expect(codeOf(createTerrain('X', [vec3(0, 0, 0), vec3(1, 1, 1), vec3(2, 2, 2)]))).toBe(
      'TERRAIN_DEGENERATE',
    );
  });

  it('triangula 20 mil pontos em tempo de uso interativo', () => {
    const next = random(5);
    const points: Vec3[] = [];
    for (let i = 0; i < 20000; i += 1) points.push(vec3(next() * 2000, next() * 2000, next() * 30));
    const started = performance.now();
    const { terrain } = unwrap(
      buildTerrainSurface({
        name: 'Grande',
        points,
        boundary: null,
        breaklines: [],
        source: SOURCE,
      }),
    );
    const elapsed = performance.now() - started;
    expect(terrain.triangles.length / 3).toBeGreaterThan(39000);
    // Meta: 1 s; o limite do teste é folgado para máquinas ocupadas.
    expect(elapsed).toBeLessThan(8000);
    const query = performance.now();
    for (let i = 0; i < 2000; i += 1) terrainElevationAt(terrain, next() * 2000, next() * 2000);
    expect(performance.now() - query).toBeLessThan(1000);
  });
});

describe('curvas de nível', () => {
  it('são retas no plano e ficam na posição exata da cota', () => {
    const terrain = unwrap(createTerrain('Plano', planePoints(100, 10)));
    const contours = unwrap(terrainContours(terrain, 0.5, 2));
    // De 100,0 a 103,0 a cada 0,5 m; a curva de 100,0 e a de 103,0 tocam só os cantos.
    expect(contours.map((c) => c.elevation)).toEqual([100.5, 101, 101.5, 102, 102.5]);
    expect(contours.find((c) => c.elevation === 101)!.major).toBe(true);
    expect(contours.find((c) => c.elevation === 101.5)!.major).toBe(false);
    for (const contour of contours) {
      expect(contour.lines).toHaveLength(1);
      for (const p of contour.lines[0]!) {
        expect(100 + 0.02 * p.x + 0.01 * p.y).toBeCloseTo(contour.elevation, 9);
      }
    }
    expect(suggestContourInterval(terrain)).toBe(0.2);
    expect(codeOf(terrainContours(terrain, 0.001))).toBe('CONTOUR_TOO_DENSE');
    expect(codeOf(terrainContours(terrain, 0))).toBe('CONTOUR_INTERVAL');
  });

  it('fecham-se em torno de um morro', () => {
    const points: Vec3[] = [];
    for (let y = -50; y <= 50; y += 5) {
      for (let x = -50; x <= 50; x += 5) points.push(vec3(x, y, 20 - Math.hypot(x, y) * 0.3));
    }
    const terrain = unwrap(createTerrain('Morro', points));
    const contours = unwrap(terrainContours(terrain, 5));
    const ring = contours.find((c) => c.elevation === 15)!;
    expect(ring.lines).toHaveLength(1);
    const line = ring.lines[0]!;
    expect(line[0]).toEqual(line[line.length - 1]);
    // Cone de 0,3 m/m: a curva de 15 m fica a 16,67 m do cume (a malha a aproxima por dentro).
    for (const p of line) {
      expect(Math.hypot(p.x, p.y)).toBeGreaterThan(15);
      expect(Math.hypot(p.x, p.y)).toBeLessThan(16.7);
    }
  });
});

describe('corte longitudinal', () => {
  it('segue o TIN exatamente e interrompe o perfil fora da superfície', () => {
    const z = (x: number, y: number): number => 100 + 0.02 * x + 0.01 * y;
    const { terrain } = unwrap(
      buildTerrainSurface({
        name: 'Furo',
        points: planePoints(100, 10),
        boundary: [
          [
            [0, 0],
            [100, 0],
            [100, 100],
            [0, 100],
          ].map(([x, y]) => vec3(x!, y!, z(x!, y!))),
          [
            [40, 40],
            [40, 60],
            [60, 60],
            [60, 40],
          ].map(([x, y]) => vec3(x!, y!, z(x!, y!))),
        ],
        breaklines: [],
        source: SOURCE,
      }),
    );
    // Do lado de fora, atravessando o furo, até o outro lado de fora.
    const profile = unwrap(
      terrainProfile(terrain, [
        { x: -10, y: 50 },
        { x: 110, y: 50 },
      ]),
    );
    expect(profile.length).toBeCloseTo(120, 9);
    expect(profile.coveredLength).toBeCloseTo(80, 6);
    expect(profile.minElevation).toBeCloseTo(z(0, 50), 9);
    expect(profile.maxElevation).toBeCloseTo(z(100, 50), 9);
    expect(profile.surfaceLength).toBeCloseTo(80 * Math.sqrt(1 + 0.0004), 6);
    for (const station of profile.stations) {
      if (station.elevation !== null) {
        expect(station.elevation).toBeCloseTo(z(station.x, station.y), 9);
      }
    }
    const gaps = profile.stations.filter((s) => s.elevation === null).map((s) => s.chainage);
    // Lacunas: antes da borda (0–10), no furo (50–70) e depois da borda (110–120).
    expect(gaps).toHaveLength(6);
    [0, 10, 50, 70, 110, 120].forEach((expected, i) => expect(gaps[i]).toBeCloseTo(expected, 6));

    // Poligonal com mudança de direção: a distância acumulada continua no segundo trecho.
    const bent = unwrap(
      terrainProfile(terrain, [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 30 },
      ]),
    );
    expect(bent.length).toBeCloseTo(40, 9);
    expect(bent.stations[bent.stations.length - 1]!.elevation).toBeCloseTo(z(30, 30), 9);
    expect(
      codeOf(
        terrainProfile(terrain, [
          { x: 200, y: 0 },
          { x: 300, y: 0 },
        ]),
      ),
    ).toBe('PROFILE_OUTSIDE');
  });
});

describe('DEM em raster', () => {
  /** Raster de 21 × 21 nós a cada 10 m, linhas para o sul, com o nó (0, 0) em (0; 200). */
  const frame: RasterFrame = {
    toLocal: (col, row) => ({ x: col * 10, y: 200 - row * 10 }),
    fromLocal: (x, y) => ({ col: x / 10, row: (200 - y) / 10 }),
  };
  const altitude = (x: number, y: number): number => 800 + 0.05 * x - 0.03 * y;
  const raster = (holes: [number, number][] = []) => {
    const data = new Float32Array(21 * 21);
    for (let row = 0; row < 21; row += 1) {
      for (let col = 0; col < 21; col += 1) {
        const p = frame.toLocal(col, row);
        data[row * 21 + col] = altitude(p.x, p.y);
      }
    }
    for (const [col, row] of holes) data[row * 21 + col] = Number.NaN;
    return { width: 21, height: 21, data };
  };
  const rings: Point2[][] = [
    [
      { x: 25, y: 25 },
      { x: 175, y: 25 },
      { x: 175, y: 175 },
      { x: 25, y: 175 },
    ],
  ];

  it('usa os nós do raster como vértices, sem criar valores entre eles', () => {
    const dem = unwrap(
      demSurfacePoints({ raster: raster(), frame, rings, stride: 1, heightOffset: 760 }),
    );
    expect(dem.spacing).toBeCloseTo(10, 9);
    // Nós de 30 a 170 m nos dois eixos: 15 × 15.
    expect(dem.points).toHaveLength(225);
    for (const p of dem.points) {
      expect(p.x % 10).toBe(0);
      expect(p.z).toBeCloseTo(altitude(p.x, p.y) - 760, 3);
    }
    // O limite é adensado no espaçamento das amostras e cotado pelo raster.
    expect(dem.boundary[0]).toHaveLength(60);
    const built = unwrap(
      buildTerrainSurface({
        name: 'DEM',
        points: dem.points,
        boundary: dem.boundary,
        breaklines: [],
        source: { ...SOURCE, kind: 'dem', resolution: dem.spacing },
        clearance: dem.spacing * 0.25,
        keepTriangle: dem.hasData,
      }),
    );
    expect(terrainStats(built.terrain).planArea).toBeCloseTo(150 * 150, 6);
    expect(terrainElevationAt(built.terrain, 101, 99)).toBeCloseTo(altitude(101, 99) - 760, 3);

    const coarse = unwrap(
      demSurfacePoints({ raster: raster(), frame, rings, stride: 2, heightOffset: 0 }),
    );
    expect(coarse.spacing).toBeCloseTo(20, 9);
    expect(coarse.points).toHaveLength(49);
    expect(coarse.points.every((p) => p.x % 20 === 0 && p.y % 20 === 0)).toBe(true);
  });

  it('não cria superfície onde o raster não tem dado', () => {
    const withGap = raster([[10, 10]]);
    expect(sampleRaster(withGap, 9.5, 9.5)).toBeNull();
    expect(sampleRaster(withGap, 8.5, 8.5)).not.toBeNull();
    expect(sampleRaster(withGap, 3, 4)).toBeCloseTo(altitude(30, 160), 3);
    expect(sampleRaster(withGap, 20.5, 4)).toBeNull();
    const dem = unwrap(
      demSurfacePoints({ raster: withGap, frame, rings, stride: 1, heightOffset: 0 }),
    );
    expect(dem.noDataNodes).toBe(1);
    expect(dem.points).toHaveLength(224);
    const { terrain, report } = unwrap(
      buildTerrainSurface({
        name: 'DEM',
        points: dem.points,
        boundary: dem.boundary,
        breaklines: [],
        source: SOURCE,
        keepTriangle: dem.hasData,
      }),
    );
    expect(report.trianglesWithoutData).toBeGreaterThan(0);
    // Em torno do nó sem dado (100; 100) não há cota — nada é interpolado sobre a lacuna.
    expect(terrainElevationAt(terrain, 100, 100)).toBeNull();
    expect(terrainElevationAt(terrain, 96, 103)).toBeNull();
    expect(terrainElevationAt(terrain, 60, 60)).not.toBeNull();

    // Sem dado em um ponto do limite: recusado, nenhuma cota é presumida.
    const atBoundary = demSurfacePoints({
      raster: raster([[2, 3]]),
      frame,
      rings,
      stride: 1,
      heightOffset: 0,
    });
    expect(codeOf(atBoundary)).toBe('DEM_NO_DATA_AT_BOUNDARY');
    const far = demSurfacePoints({
      raster: raster(),
      frame,
      rings: [rings[0]!.map((p) => ({ x: p.x + 5000, y: p.y }))],
      stride: 1,
      heightOffset: 0,
    });
    expect(codeOf(far)).toBe('DEM_OUTSIDE');
    const tooMany = demSurfacePoints({
      raster: raster(),
      frame,
      rings,
      stride: 1,
      heightOffset: 0,
      maxVertices: 100,
    });
    expect(codeOf(tooMany)).toBe('TERRAIN_TOO_MANY');
  });

  it('posiciona o raster pela georreferência do projeto', () => {
    const georeference: Georeference = {
      crsName: 'SIRGAS 2000 / UTM zone 23S',
      epsg: 31983,
      eastings: 333287.0215,
      northings: 7394586.0934,
      orthogonalHeight: 760,
      rotation: 0,
      verticalDatum: 'Imbituba',
    };
    const status = georeferenceStatus(georeference);
    expect(
      codeOf(
        rasterFrame(
          { originX: 0, originY: 0, stepX: 1, stepY: -1 },
          { kind: 'geographic' },
          georeferenceStatus(null),
        ),
      ),
    ).toBe('GEOREFERENCE_REQUIRED');
    // Raster geográfico com o nó (0, 0) sobre o ponto de controle (origem do projeto).
    const geographic = unwrap(
      rasterFrame(
        { originX: -46.633309, originY: -23.55052, stepX: 1 / 3600, stepY: -1 / 3600 },
        { kind: 'geographic' },
        status,
      ),
    );
    const origin = geographic.toLocal(0, 0);
    expect(Math.hypot(origin.x, origin.y)).toBeLessThan(0.01);
    // Um segundo de arco: cerca de 28 m em longitude e 31 m em latitude nesta latitude.
    expect(geographic.toLocal(1, 0).x).toBeCloseTo(28.4, 0);
    expect(geographic.toLocal(0, 1).y).toBeCloseTo(-30.8, 0);
    const back = geographic.fromLocal(geographic.toLocal(7, 3).x, geographic.toLocal(7, 3).y);
    expect(back.col).toBeCloseTo(7, 6);
    expect(back.row).toBeCloseTo(3, 6);

    // Mesmo sistema do projeto: nó (0, 0) em E/N da origem, passo de 5 m.
    const projected = unwrap(
      rasterFrame(
        { originX: 333287.0215, originY: 7394586.0934, stepX: 5, stepY: -5 },
        { kind: 'projected', epsg: 31983 },
        status,
      ),
    );
    expect(projected.toLocal(2, 4)).toEqual({ x: 10, y: -20 });
    expect(
      codeOf(
        rasterFrame(
          { originX: 0, originY: 0, stepX: 5, stepY: -5 },
          { kind: 'projected', epsg: 29193 },
          status,
        ),
      ),
    ).toBe('RASTER_CRS_UNSUPPORTED');

    // Web Mercator: o nó posto sobre o ponto de controle (pelas fórmulas dos ladrilhos) cai na origem.
    const tile = geographicToTile({ lon: -46.633309, lat: -23.55052 }, 0);
    const world = 2 * Math.PI * 6378137;
    const mercator = unwrap(
      rasterFrame(
        { originX: (tile.x - 0.5) * world, originY: (0.5 - tile.y) * world, stepX: 30, stepY: -30 },
        { kind: 'webMercator' },
        status,
      ),
    );
    const at = mercator.toLocal(0, 0);
    expect(Math.hypot(at.x, at.y)).toBeLessThan(0.01);
    // 30 m em Web Mercator valem 30 · cos(latitude) m no terreno.
    expect(mercator.toLocal(1, 0).x).toBeCloseTo(30 * Math.cos((23.55052 * Math.PI) / 180), 1);
  });
});

describe('levantamento topográfico', () => {
  it('lê linhas de quebra em blocos e recorta o levantamento pela área', () => {
    const breaklines = unwrap(
      parseBreaklines(
        '# crista\n15 55 106\n85;55;107,1\n\nL2\n20 20 100\n20 20 100\n30 20 100\n40 20 100\n',
      ),
    );
    expect(breaklines).toHaveLength(2);
    expect(breaklines[0]![1]).toEqual(vec3(85, 55, 107.1));
    expect(breaklines[1]).toHaveLength(3);
    expect(codeOf(parseBreaklines('1 2 3\n\nfim'))).toBe('BREAKLINES_EMPTY');

    const z = (x: number, y: number): number => 100 + 0.02 * x + 0.01 * y;
    const rings: Point2[][] = [
      [
        { x: 12, y: 13 },
        { x: 88, y: 17 },
        { x: 71, y: 86 },
        { x: 9, y: 77 },
      ],
    ];
    const { terrain } = unwrap(
      buildSurveySurface({
        name: 'Levantamento',
        points: planePoints(100, 10),
        breaklines: [],
        rings,
        source: SOURCE,
      }),
    );
    // As coordenadas gravadas são arredondadas a 0,1 mm.
    expect(terrainStats(terrain).planArea).toBeCloseTo(polygonArea(rings), 1);
    // O limite recebe as cotas da própria triangulação do levantamento.
    for (const p of terrain.boundary![0]!) expect(p.z).toBeCloseTo(z(p.x, p.y), 3);
    expect(terrainElevationAt(terrain, 50, 50)).toBeCloseTo(z(50, 50), 9);
    expect(terrainElevationAt(terrain, 5, 5)).toBeNull();

    const beyond = buildSurveySurface({
      name: 'Levantamento',
      points: planePoints(100, 10),
      breaklines: [],
      rings: [
        [
          { x: 50, y: 50 },
          { x: 150, y: 50 },
          { x: 150, y: 90 },
        ],
      ],
      source: SOURCE,
    });
    expect(codeOf(beyond)).toBe('SURVEY_BOUNDARY_OUTSIDE');
  });

  it('entrega a estrutura de intercâmbio no sistema projetado', () => {
    const terrain = unwrap(createTerrain('T', planePoints(20, 10)));
    const local = terrainExchange(terrain, null);
    expect(local.crs).toBeNull();
    expect(local.points[0]).toEqual(terrain.points[0]);
    expect(local.faces).toHaveLength(terrain.triangles.length / 3);
    const projected = terrainExchange(terrain, {
      crsName: 'SIRGAS 2000 / UTM zone 23S',
      epsg: 31983,
      eastings: 333000,
      northings: 7394000,
      orthogonalHeight: 700,
      rotation: Math.PI / 2,
      verticalDatum: 'Imbituba',
    });
    expect(projected.crs).toEqual({ name: 'SIRGAS 2000 / UTM zone 23S', epsg: 31983 });
    expect(projected.verticalDatum).toBe('Imbituba');
    const index = terrain.points.findIndex((p) => p.x === 10 && p.y === 0);
    // Eixo X local girado 90° (anti-horário): 10 m em X viram 10 m para o norte.
    expect(projected.points[index]!.x).toBeCloseTo(333000, 6);
    expect(projected.points[index]!.y).toBeCloseTo(7394010, 6);
    expect(projected.points[index]!.z).toBeCloseTo(800.2, 6);
  });
});

describe('persistência do terreno', () => {
  it('salva e reabre a superfície com limite, linhas de quebra e procedência', () => {
    const z = (x: number, y: number): number => 100 + 0.02 * x + 0.01 * y;
    const { terrain } = unwrap(
      buildTerrainSurface({
        name: 'Gleba',
        points: planePoints(40, 10),
        boundary: [
          [
            [5, 5],
            [35, 5],
            [35, 35],
            [5, 35],
          ].map(([x, y]) => vec3(x!, y!, z(x!, y!))),
        ],
        breaklines: [[vec3(10, 20, 101), vec3(30, 20, 101)]],
        source: {
          kind: 'dem',
          provider: 'GeoTIFF',
          dataset: 'gleba.tif',
          horizontalCrs: 'EPSG:31983',
          verticalDatum: null,
          resolution: 10,
          verticalAccuracy: null,
          acquiredAt: '2026-11-19T12:00:00.000Z',
          attribution: null,
          notes: 'Datum vertical não declarado no arquivo.',
        },
      }),
    );
    const project = setTerrain(createProject('Infra', 'infra'), terrain);
    expect(validateProject(project)).toEqual([]);
    const reopened = unwrap(parseProject(serializeProject(project)));
    expect(reopened.terrain).toEqual(terrain);
  });

  it('migra um terreno do esquema 11 como levantamento sem dados presumidos', () => {
    const legacy: Terrain = unwrap(createTerrain('Antigo', planePoints(20, 10)));
    const { boundary: _b, breaklines: _l, source: _s, ...old } = legacy;
    const document = { ...createProject('Infra', 'infra'), schemaVersion: 11, terrain: old };
    const migrated = unwrap(parseProject(JSON.stringify(document)));
    expect(migrated.terrain?.points).toEqual(legacy.points);
    expect(migrated.terrain?.boundary).toBeNull();
    expect(migrated.terrain?.breaklines).toEqual([]);
    expect(migrated.terrain?.source).toEqual(surveySource(null, null));
    expect(migrated.terrain?.source.verticalDatum).toBeNull();
    expect(migrated.terrain?.source.acquiredAt).toBeNull();
  });
});

describe('assentamento por recobrimento', () => {
  it('põe a geratriz superior o recobrimento abaixo do terreno e confere o trecho', () => {
    const terrain = unwrap(createTerrain('Plano', planePoints(100, 10)));
    const od = 0.222;
    const z = (x: number, y: number): number => 100 + 0.02 * x + 0.01 * y;
    // Eixo = terreno − recobrimento − meio diâmetro externo.
    const a = vec3(10, 20, axisElevationForCover(terrain, 10, 20, 0.8, od)!);
    const b = vec3(90, 70, axisElevationForCover(terrain, 90, 70, 0.8, od)!);
    expect(a.z).toBeCloseTo(z(10, 20) - 0.8 - 0.111, 9);
    expect(axisElevationForCover(terrain, 500, 20, 0.8, od)).toBeNull();
    // Em terreno plano o tubo reto acompanha a superfície: recobrimento constante.
    const even = coverAlongSegment(terrain, a, b, od)!;
    expect(even.min).toBeCloseTo(0.8, 9);
    expect(even.max).toBeCloseTo(0.8, 9);
    expect(even.length).toBeCloseTo(Math.hypot(80, 50), 9);
    expect(even.coveredLength).toBeCloseTo(even.length, 6);
  });

  it('acusa o recobrimento menor onde o terreno afunda entre os pontos', () => {
    // Vala de 1,5 m de profundidade em x = 50, entre dois platôs na cota 100.
    const points: Vec3[] = [];
    for (let y = 0; y <= 40; y += 10) {
      for (let x = 0; x <= 100; x += 10) points.push(vec3(x, y, x === 50 ? 98.5 : 100));
    }
    const terrain = unwrap(createTerrain('Vala', points));
    const od = 0.2;
    const a = vec3(10, 20, axisElevationForCover(terrain, 10, 20, 1, od)!);
    const b = vec3(90, 20, axisElevationForCover(terrain, 90, 20, 1, od)!);
    const cover = coverAlongSegment(terrain, a, b, od)!;
    // Nos extremos, 1,00 m; no fundo da vala o tubo fica 0,50 m acima do terreno.
    expect(cover.max).toBeCloseTo(1, 9);
    expect(cover.min).toBeCloseTo(-0.5, 9);
    expect(cover.minAt).toBeCloseTo(40, 6);
    // Trecho que sai da superfície: só a parte sob ela é conferida.
    const partial = coverAlongSegment(terrain, a, vec3(150, 20, a.z), od)!;
    expect(partial.coveredLength).toBeCloseTo(90, 6);
    expect(partial.length).toBeCloseTo(140, 9);
    expect(coverAlongSegment(terrain, vec3(200, 0, 0), vec3(300, 0, 0), od)).toBeNull();
  });
});
