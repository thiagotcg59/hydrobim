import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../math';
import type { Result } from '../result';
import { surveySource, type Terrain } from '../schema';
import {
  addTerrainPoint,
  moveTerrainPoint,
  nearestTerrainPoint,
  originalTerrainOf,
  removeTerrainPoint,
  restoreOriginalTerrain,
  retriangulateTerrain,
  setTerrainBoundary,
  setTerrainPointElevation,
  setTerrainProperties,
} from './edit';
import { buildTerrainSurface, terrainElevationAt, terrainStats } from './surface';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
const codeOf = (result: Result<unknown>): string => (result.ok ? 'ok' : result.error.code);

const SOURCE = surveySource('teste.xyz', '2026-11-21T00:00:00.000Z');

function plane(size = 40, step = 10, boundary = false): Terrain {
  const points: Vec3[] = [];
  for (let x = 0; x <= size; x += step) {
    for (let y = 0; y <= size; y += step) points.push({ x, y, z: 100 + 0.1 * x });
  }
  const ring: Vec3[] = [
    { x: 0, y: 0, z: 100 },
    { x: size, y: 0, z: 100 + 0.1 * size },
    { x: size, y: size, z: 100 + 0.1 * size },
    { x: 0, y: size, z: 100 },
  ];
  return unwrap(
    buildTerrainSurface({
      name: 'Levantamento',
      points,
      boundary: boundary ? [ring] : null,
      breaklines: [],
      source: SOURCE,
    }),
  ).terrain;
}

describe('edição da superfície do terreno', () => {
  it('acrescenta um ponto cotado e refaz a triangulação', () => {
    const terrain = plane();
    const edited = unwrap(addTerrainPoint(terrain, { x: 15, y: 15, z: 110 }));
    expect(edited.points).toHaveLength(terrain.points.length + 1);
    expect(terrainElevationAt(edited, 15, 15)).toBeCloseTo(110, 9);
    expect(terrainStats(edited).planArea).toBeCloseTo(1600, 6);
    // Identidade preservada; a original fica guardada para comparação.
    expect(edited.id).toBe(terrain.id);
    expect(edited.source).toEqual(terrain.source);
    expect(terrain.original).toBeNull();
    expect(edited.original?.points).toHaveLength(terrain.points.length);
    expect(terrainElevationAt(originalTerrainOf(edited) as Terrain, 15, 15)).toBeCloseTo(101.5, 9);
    // A superfície recebida não foi alterada.
    expect(terrainElevationAt(terrain, 15, 15)).toBeCloseTo(101.5, 9);
  });

  it('recusa ponto repetido, inválido ou fora do limite', () => {
    expect(codeOf(addTerrainPoint(plane(), { x: 10, y: 10, z: 5 }))).toBe(
      'TERRAIN_POINT_DUPLICATE',
    );
    expect(codeOf(addTerrainPoint(plane(), { x: 10, y: Number.NaN, z: 5 }))).toBe(
      'TERRAIN_POINT_INVALID',
    );
    expect(codeOf(addTerrainPoint(plane(40, 10, true), { x: 60, y: 10, z: 5 }))).toBe(
      'TERRAIN_POINT_OUTSIDE',
    );
    // Sem limite informado, um ponto de fora amplia a superfície.
    const grown = unwrap(addTerrainPoint(plane(), { x: 60, y: 20, z: 106 }));
    expect(terrainStats(grown).planArea).toBeCloseTo(1600 + 400, 6);
  });

  it('troca a cota de um ponto sem refazer a triangulação', () => {
    const terrain = plane(40, 10, true);
    const index = nearestTerrainPoint(terrain, 0, 0, 0.01) as number;
    const edited = unwrap(setTerrainPointElevation(terrain, index, 95));
    expect(edited.triangles).toBe(terrain.triangles);
    expect(terrainElevationAt(edited, 0, 0)).toBeCloseTo(95, 9);
    // O vértice do limite que coincide com o ponto acompanha a cota.
    expect(edited.boundary?.[0]?.find((p) => p.x === 0 && p.y === 0)?.z).toBe(95);
    expect(edited.original?.points[index]?.z).toBe(100);
    expect(codeOf(setTerrainPointElevation(terrain, 999, 1))).toBe('TERRAIN_POINT_UNKNOWN');
    expect(codeOf(setTerrainPointElevation(terrain, index, Number.NaN))).toBe(
      'TERRAIN_POINT_INVALID',
    );
  });

  it('move e exclui pontos', () => {
    const terrain = plane();
    const index = nearestTerrainPoint(terrain, 20, 20, 0.01) as number;
    const moved = unwrap(moveTerrainPoint(terrain, index, { x: 23, y: 18, z: 120 }));
    expect(moved.points).toHaveLength(terrain.points.length);
    expect(terrainElevationAt(moved, 23, 18)).toBeCloseTo(120, 9);
    expect(nearestTerrainPoint(moved, 20, 20, 0.01)).toBeNull();
    expect(codeOf(moveTerrainPoint(terrain, index, { x: 10, y: 10 }))).toBe(
      'TERRAIN_POINT_DUPLICATE',
    );

    const removed = unwrap(removeTerrainPoint(terrain, index));
    expect(removed.points).toHaveLength(terrain.points.length - 1);
    expect(terrainStats(removed).planArea).toBeCloseTo(1600, 6);
    expect(terrainElevationAt(removed, 20, 20)).toBeCloseTo(102, 9);
    expect(codeOf(removeTerrainPoint(terrain, -1))).toBe('TERRAIN_POINT_UNKNOWN');
  });

  it('redefine o limite dentro da superfície, cotando-o pela triangulação', () => {
    const terrain = plane();
    const edited = unwrap(
      setTerrainBoundary(terrain, [
        [
          { x: 5, y: 5 },
          { x: 35, y: 5 },
          { x: 35, y: 35 },
          { x: 5, y: 35 },
        ],
      ]),
    );
    expect(terrainStats(edited).planArea).toBeCloseTo(900, 6);
    expect(terrainElevationAt(edited, 5, 20)).toBeCloseTo(100.5, 9);
    expect(terrainElevationAt(edited, 2, 20)).toBeNull();
    expect(edited.boundary).not.toBeNull();
    expect(
      codeOf(
        setTerrainBoundary(terrain, [
          [
            { x: 5, y: 5 },
            { x: 60, y: 5 },
            { x: 35, y: 35 },
          ],
        ]),
      ),
    ).toBe('TERRAIN_BOUNDARY_OUTSIDE');
    expect(
      codeOf(
        setTerrainBoundary(terrain, [
          [
            { x: 5, y: 5 },
            { x: 35, y: 35 },
            { x: 35, y: 5 },
            { x: 5, y: 35 },
          ],
        ]),
      ),
    ).toBe('POLYGON_SELF_INTERSECTION');
  });

  it('restaura a superfície original e regenera a triangulação', () => {
    const terrain = plane();
    const once = unwrap(addTerrainPoint(terrain, { x: 15, y: 15, z: 110 }));
    const twice = unwrap(addTerrainPoint(once, { x: 25, y: 25, z: 90 }));
    // A original é a da primeira edição, não a da última.
    expect(twice.original?.points).toHaveLength(terrain.points.length);
    const restored = unwrap(restoreOriginalTerrain(twice));
    expect(restored.points).toEqual(terrain.points);
    expect(restored.triangles).toEqual(terrain.triangles);
    expect(restored.original).toBeNull();
    expect(codeOf(restoreOriginalTerrain(terrain))).toBe('TERRAIN_NOT_EDITED');

    const again = unwrap(retriangulateTerrain(twice));
    expect(terrainStats(again).planArea).toBeCloseTo(1600, 6);
    expect(again.original).toBe(twice.original);
    expect(unwrap(retriangulateTerrain(terrain)).original).toBeNull();
  });

  it('nome e identificação', () => {
    const terrain = plane();
    const named = unwrap(
      setTerrainProperties(terrain, { name: ' Terreno natural ', tag: 'TN-01' }),
    );
    expect(named.name).toBe('Terreno natural');
    expect(named.tag).toBe('TN-01');
    expect(named.points).toBe(terrain.points);
    expect(codeOf(setTerrainProperties(terrain, { name: '  ' }))).toBe('TERRAIN_NAME');
  });

  it('exatidão altimétrica declarada: informada, limpa e recusada quando não é positiva', () => {
    const terrain = plane();
    expect(terrain.source.verticalAccuracy).toBeNull();
    const declared = unwrap(setTerrainProperties(terrain, { verticalAccuracy: 0.05 }));
    expect(declared.source.verticalAccuracy).toBe(0.05);
    // Só a procedência muda: nome, malha e a superfície recebida ficam como estavam.
    expect(declared.name).toBe(terrain.name);
    expect(declared.points).toBe(terrain.points);
    expect(terrain.source.verticalAccuracy).toBeNull();
    // Renomear não mexe na exatidão; `null` volta a deixá-la sem valor.
    expect(unwrap(setTerrainProperties(declared, { name: 'TN' })).source.verticalAccuracy).toBe(
      0.05,
    );
    expect(
      unwrap(setTerrainProperties(declared, { verticalAccuracy: null })).source.verticalAccuracy,
    ).toBeNull();
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(codeOf(setTerrainProperties(terrain, { verticalAccuracy: invalid }))).toBe(
        'TERRAIN_ACCURACY',
      );
    }
  });

  it('lacunas do DEM continuam abertas depois de uma edição', () => {
    // Malha com um quadrado central sem dado (triângulos removidos na construção).
    const points: Vec3[] = [];
    for (let x = 0; x <= 40; x += 10) {
      for (let y = 0; y <= 40; y += 10) points.push({ x, y, z: 50 });
    }
    const ring: Vec3[] = [
      { x: 0, y: 0, z: 50 },
      { x: 40, y: 0, z: 50 },
      { x: 40, y: 40, z: 50 },
      { x: 0, y: 40, z: 50 },
    ];
    const withGap = unwrap(
      buildTerrainSurface({
        name: 'DEM',
        points,
        boundary: [ring],
        breaklines: [],
        source: SOURCE,
        keepTriangle: (x, y) => !(x > 10 && x < 20 && y > 10 && y < 20),
      }),
    ).terrain;
    expect(terrainStats(withGap).planArea).toBeCloseTo(1500, 6);
    const edited = unwrap(addTerrainPoint(withGap, { x: 33, y: 33, z: 55 }));
    expect(terrainStats(edited).planArea).toBeCloseTo(1500, 6);
    expect(terrainElevationAt(edited, 15, 15)).toBeNull();
    expect(terrainElevationAt(edited, 33, 33)).toBeCloseTo(55, 9);
  });
});
