import {
  buildTerrainSurface,
  setTerrainBoundary,
  surveySource,
  terrainStats,
  type Terrain,
  type Vec3,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { elevationColor, PLAIN_COLOR, slopeColor } from './terrainColors';
import { rasterizeTerrain, terrainBoundaryLoops, terrainFootprintPath } from './terrainRaster';

/** Malha regular de 0 a 40 m, com a cota dada por `z(x, y)`. */
function surface(z: (x: number, y: number) => number): Terrain {
  const points: Vec3[] = [];
  for (let x = 0; x <= 40; x += 10) {
    for (let y = 0; y <= 40; y += 10) points.push({ x, y, z: z(x, y) });
  }
  const built = buildTerrainSurface({
    id: 'terreno',
    tag: '',
    name: 'Terreno',
    points,
    boundary: null,
    breaklines: [],
    source: surveySource(null, null),
  });
  if (!built.ok) throw new Error(built.error.message);
  return built.value.terrain;
}

/** Área de um anel de índices (positiva = anti-horário). */
function signedArea(terrain: Terrain, loop: readonly number[]): number {
  let area = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const p = terrain.points[loop[i] as number] as Vec3;
    const q = terrain.points[loop[(i + 1) % loop.length] as number] as Vec3;
    area += p.x * q.y - q.x * p.y;
  }
  return area / 2;
}

const pixel = (
  raster: NonNullable<ReturnType<typeof rasterizeTerrain>>,
  x: number,
  y: number,
): number[] => {
  const scale = raster.width / (raster.maxX - raster.minX);
  const i = Math.min(raster.width - 1, Math.floor((x - raster.minX) * scale));
  const j = Math.min(raster.height - 1, Math.floor((raster.maxY - y) * scale));
  return [...raster.data.slice((j * raster.width + i) * 4, (j * raster.width + i) * 4 + 4)];
};
const rgb = (color: readonly [number, number, number]): number[] =>
  color.map((value) => Math.round(value * 255));

describe('contorno da superfície em planta', () => {
  it('um só anel anti-horário, com a área em planta da superfície', () => {
    const terrain = surface(() => 5);
    const loops = terrainBoundaryLoops(terrain);
    expect(loops).toHaveLength(1);
    expect(signedArea(terrain, loops[0] as number[])).toBeCloseTo(1600, 6);
    expect(signedArea(terrain, loops[0] as number[])).toBeCloseTo(
      terrainStats(terrain).planArea,
      6,
    );
  });

  it('furo do limite vira um segundo anel, em sentido horário', () => {
    // O limite fica dentro da região com dado (não há cota fora dela).
    const outer = [
      { x: 2, y: 2 },
      { x: 38, y: 2 },
      { x: 38, y: 38 },
      { x: 2, y: 38 },
    ];
    const hole = [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
      { x: 10, y: 30 },
    ];
    const holed = setTerrainBoundary(
      surface(() => 5),
      [outer, hole],
    );
    if (!holed.ok) throw new Error(holed.error.message);
    const loops = terrainBoundaryLoops(holed.value);
    expect(loops).toHaveLength(2);
    const areas = loops.map((loop) => signedArea(holed.value, loop)).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(-400, 6);
    expect(areas[1]).toBeCloseTo(1296, 6);
    // O caminho da planta tem um subcaminho fechado por anel (par-ímpar deixa o furo vazado).
    const path = terrainFootprintPath(holed.value, { x: 0, y: 0 });
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path.match(/Z/g)).toHaveLength(2);
  });

  it('o caminho é relativo à origem de desenho, com o eixo Y invertido', () => {
    const path = terrainFootprintPath(
      surface(() => 5),
      { x: 100, y: 200 },
    );
    const numbers = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
    const xs = numbers.filter((_, index) => index % 2 === 0);
    const ys = numbers.filter((_, index) => index % 2 === 1);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([-100, -60]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([160, 200]);
  });
});

describe('imagem da superfície para a planta', () => {
  it('cobre a superfície inteira, na proporção dela, sem pixel vazio', () => {
    const raster = rasterizeTerrain(
      surface((x) => x),
      'plain',
      64,
    );
    expect(raster).not.toBeNull();
    if (!raster) return;
    expect([raster.width, raster.height]).toEqual([64, 64]);
    expect([raster.minX, raster.minY, raster.maxX, raster.maxY]).toEqual([0, 0, 40, 40]);
    let empty = 0;
    for (let o = 3; o < raster.data.length; o += 4) if (raster.data[o] !== 255) empty += 1;
    expect(empty).toBe(0);
    expect(pixel(raster, 20, 20)).toEqual([...rgb(PLAIN_COLOR), 255]);
  });

  it('por altitude, a cor de cada ponto é a da cota interpolada — como no 3D', () => {
    // Cota crescente para leste: de 0 a 40 m.
    const raster = rasterizeTerrain(
      surface((x) => x),
      'elevation',
      200,
    );
    if (!raster) throw new Error('sem imagem');
    for (const x of [1, 10, 25, 39]) {
      const [r, g, b, a] = pixel(raster, x, 17);
      const expected = rgb(elevationColor(x / 40));
      expect(a).toBe(255);
      // A imagem amostra a escala em 256 níveis e o centro do pixel não é o ponto exato.
      expect(Math.abs((r as number) - (expected[0] as number))).toBeLessThanOrEqual(4);
      expect(Math.abs((g as number) - (expected[1] as number))).toBeLessThanOrEqual(4);
      expect(Math.abs((b as number) - (expected[2] as number))).toBeLessThanOrEqual(4);
    }
    // A cor não depende do norte–sul nesta superfície.
    expect(pixel(raster, 25, 3)).toEqual(pixel(raster, 25, 37));
  });

  it('por declividade, a cor é a da classe da face', () => {
    const flat = rasterizeTerrain(
      surface(() => 5),
      'slope',
      64,
    );
    const steep = rasterizeTerrain(
      surface((x) => 0.5 * x),
      'slope',
      64,
    );
    if (!flat || !steep) throw new Error('sem imagem');
    expect(pixel(flat, 20, 20).slice(0, 3)).toEqual(rgb(slopeColor(0)));
    expect(pixel(steep, 20, 20).slice(0, 3)).toEqual(rgb(slopeColor(0.5)));
  });

  it('fica transparente dentro de um furo e respeita a proporção de áreas retangulares', () => {
    const holed = setTerrainBoundary(
      surface(() => 5),
      [
        [
          { x: 2, y: 2 },
          { x: 38, y: 2 },
          { x: 38, y: 18 },
          { x: 2, y: 18 },
        ],
        [
          { x: 10, y: 5 },
          { x: 30, y: 5 },
          { x: 30, y: 15 },
          { x: 10, y: 15 },
        ],
      ],
    );
    if (!holed.ok) throw new Error(holed.error.message);
    const raster = rasterizeTerrain(holed.value, 'plain', 80);
    if (!raster) throw new Error('sem imagem');
    expect([raster.width, raster.height]).toEqual([80, 36]);
    expect(pixel(raster, 20, 10)[3]).toBe(0);
    expect(pixel(raster, 5, 10)[3]).toBe(255);
  });

  it('superfície sem extensão não gera imagem', () => {
    const terrain = surface(() => 5);
    expect(rasterizeTerrain({ ...terrain, triangles: [] }, 'plain')).toBeNull();
  });
});
