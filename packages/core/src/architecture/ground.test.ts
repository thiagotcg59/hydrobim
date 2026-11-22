import { describe, expect, it } from 'vitest';
import { createProject } from '../operations';
import { vec3, type Vec3 } from '../math';
import { setTerrain } from '../projectOps';
import { surveySource, type Point2, type Project } from '../schema';
import { addPlatform } from '../terrain/earthworks';
import { buildTerrainSurface } from '../terrain/surface';
import { validateProject } from '../validation';
import {
  addArchType,
  addFloor,
  addHosted,
  addSpace,
  addWalls,
  archSeatOffset,
  archSeatPoint,
  archVerticalRange,
  getArchElement,
  seatArchElement,
  type ArchTypeInput,
} from './index';

const p = (x: number, y: number): Point2 => ({ x, y });

/** Plano inclinado de 100 m × 100 m: z = 700 + 0,02 x + 0,01 y. */
const ground = (x: number, y: number): number => 700 + 0.02 * x + 0.01 * y;

const base = {
  familyId: null,
  generic: true,
  source: null,
  manufacturing: {},
  classifications: [],
  ifc: {},
};
const WALL: ArchTypeInput = {
  ...base,
  category: 'wall',
  name: 'Parede 15',
  ifcPredefinedType: 'SOLIDWALL',
  layers: [
    { id: 'a', material: 'Bloco', thickness: 0.15, function: 'structure', hatch: 'diagonal' },
  ],
};
const SLAB: ArchTypeInput = {
  ...base,
  category: 'slab',
  name: 'Laje 12',
  ifcPredefinedType: 'FLOOR',
  layers: [
    { id: 'a', material: 'Concreto', thickness: 0.12, function: 'structure', hatch: 'dotted' },
  ],
};
const DOOR: ArchTypeInput = {
  ...base,
  category: 'door',
  name: 'Porta 80',
  ifcPredefinedType: 'DOOR',
  operation: 'singleSwing',
  width: 0.8,
  height: 2.1,
  frameWidth: 0.05,
  panelThickness: 0.035,
  materials: {},
};

interface Setup {
  project: Project;
  levelId: string;
  wallType: string;
  slabType: string;
  doorType: string;
}

function setup(): Setup {
  const points: Vec3[] = [];
  for (let x = 0; x <= 100; x += 10) {
    for (let y = 0; y <= 100; y += 10) points.push(vec3(x, y, ground(x, y)));
  }
  const built = buildTerrainSurface({
    name: 'Plano',
    points,
    boundary: null,
    breaklines: [],
    source: surveySource('teste.xyz', '2026-11-22T00:00:00.000Z'),
  });
  if (!built.ok) throw new Error(built.error.message);
  let project = setTerrain(createProject('Teste', 'architecture'), built.value.terrain);
  // Platô de aterro na cota 705 (o natural ali fica em ~701).
  const graded = addPlatform(project, {
    outline: [p(30, 30), p(60, 30), p(60, 60), p(30, 60)],
    elevation: 705,
    cutSlope: 1,
    fillSlope: 1.5,
  });
  if (!graded.ok) throw new Error(graded.error.message);
  project = graded.value.project;
  const ids: string[] = [];
  for (const type of [WALL, SLAB, DOOR]) {
    const added = addArchType(project, type);
    if (!added.ok) throw new Error(added.error.message);
    project = added.value.project;
    ids.push(added.value.typeId);
  }
  const levelId = project.levels[0]?.id;
  const [wallType, slabType, doorType] = ids;
  if (!levelId || !wallType || !slabType || !doorType) throw new Error('preparo incompleto');
  return { project, levelId, wallType, slabType, doorType };
}

const unwrap = <T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const rangeOf = (project: Project, id: string) => {
  const element = getArchElement(project.architecture, id);
  if (!element) throw new Error('elemento esperado');
  return archVerticalRange(project, element);
};

describe('assentamento da arquitetura sobre o terreno', () => {
  it('calcula o deslocamento de um elemento novo no projetado e no natural, com folga', () => {
    const s = setup();
    const level = s.project.levels[0]?.elevation ?? 0;
    const wall = { kind: 'wall' as const, levelId: s.levelId, typeId: s.wallType };
    const design = archSeatOffset(s.project, 'design', wall, p(45, 45));
    expect(design).toEqual({ ground: 705, base: 705, offset: 705 - level });
    const natural = archSeatOffset(s.project, 'natural', wall, p(45, 45), 0.2);
    expect(natural?.ground).toBeCloseTo(ground(45, 45), 3);
    expect(natural?.base).toBeCloseTo(ground(45, 45) + 0.2, 3);
    // Laje: o parâmetro gravado é o topo — a base fica no terreno.
    const slab = archSeatOffset(
      s.project,
      'design',
      { kind: 'slab', levelId: s.levelId, typeId: s.slabType },
      p(45, 45),
    );
    expect(slab?.offset).toBeCloseTo(705 - level + 0.12, 6);
    // Fora da superfície não há cota.
    expect(archSeatOffset(s.project, 'design', wall, p(500, 500))).toBeNull();
  });

  it('assenta parede, laje e ambiente existentes; porta acompanha a parede', () => {
    const s = setup();
    const walls = unwrap(
      addWalls(s.project, {
        typeId: s.wallType,
        levelId: s.levelId,
        points: [p(40, 40), p(50, 40)],
        height: 2.8,
        baseOffset: 0,
        locationLine: 'center',
        closed: false,
      }),
    );
    const wallId = walls.elementIds[0] as string;
    const slab = unwrap(
      addFloor(walls.project, {
        kind: 'slab',
        typeId: s.slabType,
        levelId: s.levelId,
        boundary: [p(40, 40), p(50, 40), p(50, 50), p(40, 50)],
        offset: 0,
      }),
    );
    const space = unwrap(
      addSpace(slab.project, {
        levelId: s.levelId,
        boundary: [p(70, 70), p(80, 70), p(80, 80), p(70, 80)],
      }),
    );
    const door = unwrap(
      addHosted(space.project, { kind: 'door', typeId: s.doorType, hostId: wallId, at: 5 }),
    );
    let project = door.project;

    project = unwrap(seatArchElement(project, wallId, 'design'));
    expect(rangeOf(project, wallId)).toEqual({ base: 705, top: 707.8 });
    expect(rangeOf(project, door.elementIds[0] as string)?.base).toBeCloseTo(705, 6);

    project = unwrap(seatArchElement(project, slab.elementIds[0] as string, 'design'));
    const slabRange = rangeOf(project, slab.elementIds[0] as string);
    expect(slabRange?.base).toBeCloseTo(705, 6);
    expect(slabRange?.top).toBeCloseTo(705.12, 6);

    // Ambiente fora do platô: natural e projetado coincidem; referência = primeiro vértice.
    const spaceId = space.elementIds[0] as string;
    const spaceElement = getArchElement(project.architecture, spaceId);
    expect(spaceElement && archSeatPoint(spaceElement)).toEqual(p(70, 70));
    project = unwrap(seatArchElement(project, spaceId, 'natural'));
    expect(rangeOf(project, spaceId)?.base).toBeCloseTo(ground(70, 70), 3);

    project = unwrap(seatArchElement(project, wallId, 'natural', 0.5));
    expect(rangeOf(project, wallId)?.base).toBeCloseTo(ground(40, 40) + 0.5, 3);

    expect(validateProject(project)).toEqual([]);
    // O projeto recebido não é alterado.
    expect(rangeOf(door.project, wallId)?.base).toBe(s.project.levels[0]?.elevation ?? 0);
  });

  it('recusa com código estável: porta, sem terreno e fora da superfície', () => {
    const s = setup();
    const walls = unwrap(
      addWalls(s.project, {
        typeId: s.wallType,
        levelId: s.levelId,
        points: [p(200, 200), p(210, 200)],
        height: 2.8,
        baseOffset: 0,
        locationLine: 'center',
        closed: false,
      }),
    );
    const wallId = walls.elementIds[0] as string;
    const door = unwrap(
      addHosted(walls.project, { kind: 'door', typeId: s.doorType, hostId: wallId, at: 5 }),
    );
    const code = (result: ReturnType<typeof seatArchElement>) =>
      result.ok ? '' : result.error.code;
    expect(code(seatArchElement(door.project, wallId, 'design'))).toBe('OUTSIDE_TERRAIN');
    expect(code(seatArchElement(door.project, door.elementIds[0] as string, 'design'))).toBe(
      'ARCH_NOT_SEATABLE',
    );
    expect(code(seatArchElement(door.project, 'x', 'design'))).toBe('ARCH_ELEMENT_NOT_FOUND');
    expect(code(seatArchElement(setTerrain(door.project, null), wallId, 'natural'))).toBe(
      'NO_TERRAIN',
    );
  });
});
