import {
  buildTerrainSurface,
  createProject,
  elementElevation,
  setTerrain,
  surveySource,
  validateProject,
  vec3,
  type Terrain,
  type Vec3,
} from '@hydrobim/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { pickPoint } from '../editor/picking';
import { equipmentGroundElevation, useEditorStore } from './editorStore';

const state = () => useEditorStore.getState();

/** Plano inclinado de 100 m × 100 m: z = 700 + 0,02 x + 0,01 y. */
const ground = (x: number, y: number): number => 700 + 0.02 * x + 0.01 * y;

function planeTerrain(): Terrain {
  const points: Vec3[] = [];
  for (let x = 0; x <= 100; x += 10) {
    for (let y = 0; y <= 100; y += 10) points.push(vec3(x, y, ground(x, y)));
  }
  const built = buildTerrainSurface({
    name: 'Plano',
    points,
    boundary: null,
    breaklines: [],
    source: surveySource('teste.xyz', '2026-11-19T00:00:00.000Z'),
  });
  if (!built.ok) throw new Error(built.error.message);
  return built.value.terrain;
}

beforeEach(() => {
  state().loadProject(setTerrain(createProject('Teste', 'infra'), planeTerrain()));
  state().setToolOptions({ terrainPlacement: { enabled: true, offset: 0 } });
});

const last = () => {
  const element = state().project.elements.at(-1);
  if (!element) throw new Error('Nenhum elemento criado.');
  return element;
};

describe('equipamentos sobre o terreno', () => {
  it('posiciona reservatório e bomba na cota do terreno do ponto clicado', () => {
    state().setTool('tank');
    // O ponto chega na cota do plano de trabalho (0): a cota vem do terreno.
    state().commitPoint(vec3(40, 30, 0));
    expect(last().kind).toBe('tank');
    expect(elementElevation(last())).toBeCloseTo(ground(40, 30), 6);
    expect(state().message?.text).toContain('sobre o terreno');

    state().setTool('pump');
    state().setToolOptions({ terrainPlacement: { enabled: true, offset: 0.35 } });
    state().commitPoint(vec3(70, 20, 0));
    expect(last().kind).toBe('pump');
    expect(elementElevation(last())).toBeCloseTo(ground(70, 20) + 0.35, 6);
    expect(validateProject(state().project)).toEqual([]);
  });

  it('fora da superfície ou com a opção desligada, usa a cota do plano de trabalho', () => {
    state().setTool('tank');
    state().commitPoint(vec3(150, 30, 2));
    expect(elementElevation(last())).toBe(2);
    expect(state().message?.text).toContain('fora da superfície');

    state().setToolOptions({ terrainPlacement: { enabled: false, offset: 0 } });
    state().commitPoint(vec3(40, 30, 3));
    expect(elementElevation(last())).toBe(3);
  });

  it('a elevação do equipamento continua editável depois de assentado', () => {
    state().setTool('tank');
    state().commitPoint(vec3(40, 30, 0));
    const id = last().id;
    state().changeElevation(id, 712.5);
    expect(elementElevation(last())).toBe(712.5);
    // Reassentar: volta à cota do terreno sob a origem.
    state().changeElevation(id, Math.round(ground(40, 30) * 1000) / 1000);
    expect(elementElevation(last())).toBeCloseTo(ground(40, 30), 3);
  });

  it('no 3D, o cursor captura o ponto onde o raio atinge o terreno', () => {
    state().setTool('tank');
    const terrain = state().project.terrain;
    if (!terrain) throw new Error('Sem terreno.');
    const target = vec3(40, 30, ground(40, 30));
    const origin = vec3(-60, -90, 900);
    const pick = pickPoint({
      ray: {
        origin,
        direction: vec3(target.x - origin.x, target.y - origin.y, target.z - origin.z),
      },
      freePorts: [],
      pixelScale: { constant: 0.005, perDistance: 0 },
      workPlaneZ: 0,
      gridStep: 0.1,
      anchor: null,
      vertical: false,
      ground: {
        hit: (ray) => {
          // Raio sobre o plano inclinado, resolvido analiticamente para conferência.
          const { origin: o, direction: d } = ray;
          const t = (ground(o.x, o.y) - o.z) / (d.z - 0.02 * d.x - 0.01 * d.y);
          return { x: o.x + d.x * t, y: o.y + d.y * t };
        },
        elevationAt: (x, y) => equipmentGroundElevation(state(), x, y),
      },
    });
    expect(pick?.snap).toBe('terrain');
    expect(pick?.point.x).toBeCloseTo(40, 6);
    expect(pick?.point.y).toBeCloseTo(30, 6);
    expect(pick?.point.z).toBeCloseTo(ground(40, 30), 3);
  });
});
