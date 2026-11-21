import { describe, expect, it } from 'vitest';
import { createProject } from '../operations';
import { removeLevel, addLevel } from '../projectOps';
import type { ArchElement, Point2, Project, Wall } from '../schema';
import { parseProject, serializeProject } from '../serialization';
import { ringArea } from '../terrain/polygon';
import { validateProject } from '../validation';
import { viewArchElementsOf, addView } from '../views';
import {
  addArchType,
  addFloor,
  addFloorOpening,
  addHosted,
  addSpace,
  addWalls,
  archTypeUsage,
  archVerticalRange,
  computeArchQuantities,
  computeSpaceSchedule,
  copyArchElements,
  deleteArchElements,
  duplicateArchType,
  floorQuantities,
  getArchElement,
  mirrorArchElements,
  moveArchElements,
  removeArchType,
  removeFloorOpening,
  rotateArchElements,
  spaceQuantities,
  triangulatePolygon,
  triangulatedArea,
  updateArchElement,
  updateArchType,
  wallFootprint,
  wallOpenings,
  wallQuantities,
  type ArchTypeInput,
} from './index';

const p = (x: number, y: number): Point2 => ({ x, y });

const base = {
  familyId: null,
  generic: true,
  source: null,
  manufacturing: {},
  classifications: [],
  ifc: {},
};

const WALL_TYPE: ArchTypeInput = {
  ...base,
  category: 'wall',
  name: 'Parede 20',
  ifcPredefinedType: 'SOLIDWALL',
  layers: [
    { id: 'a', material: 'Reboco', thickness: 0.025, function: 'finish', hatch: 'none' },
    { id: 'b', material: 'Bloco', thickness: 0.15, function: 'structure', hatch: 'diagonal' },
    { id: 'c', material: 'Reboco', thickness: 0.025, function: 'finish', hatch: 'none' },
  ],
};
const SLAB_TYPE: ArchTypeInput = {
  ...base,
  category: 'slab',
  name: 'Laje 12',
  ifcPredefinedType: 'FLOOR',
  layers: [
    { id: 'a', material: 'Concreto', thickness: 0.12, function: 'structure', hatch: 'dotted' },
  ],
};
const FLOORING_TYPE: ArchTypeInput = {
  ...base,
  category: 'flooring',
  name: 'Porcelanato',
  ifcPredefinedType: 'FLOORING',
  layers: [
    { id: 'a', material: 'Porcelanato', thickness: 0.01, function: 'finish', hatch: 'none' },
    { id: 'b', material: 'Contrapiso', thickness: 0.04, function: 'substrate', hatch: 'none' },
  ],
};
const DOOR_TYPE: ArchTypeInput = {
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
const WINDOW_TYPE: ArchTypeInput = {
  ...base,
  category: 'window',
  name: 'Janela 120',
  ifcPredefinedType: 'WINDOW',
  operation: 'sliding',
  width: 1.2,
  height: 1.0,
  sillHeight: 1.1,
  panels: 2,
  frameWidth: 0.05,
  materials: {},
};

interface Setup {
  project: Project;
  levelId: string;
  wallType: string;
  slabType: string;
  flooringType: string;
  doorType: string;
  windowType: string;
}

function setup(): Setup {
  let project = createProject('Teste', 'architecture');
  const ids: string[] = [];
  for (const type of [WALL_TYPE, SLAB_TYPE, FLOORING_TYPE, DOOR_TYPE, WINDOW_TYPE]) {
    const added = addArchType(project, type);
    if (!added.ok) throw new Error(added.error.message);
    project = added.value.project;
    ids.push(added.value.typeId);
  }
  const [wallType, slabType, flooringType, doorType, windowType] = ids as [
    string,
    string,
    string,
    string,
    string,
  ];
  const levelId = project.levels[0]?.id ?? '';
  return { project, levelId, wallType, slabType, flooringType, doorType, windowType };
}

/** Quatro paredes fechando um retângulo de 5 × 4 m (eixos), altura 2,80 m. */
function room(s: Setup): { project: Project; walls: string[] } {
  const created = addWalls(s.project, {
    typeId: s.wallType,
    levelId: s.levelId,
    points: [p(0, 0), p(5, 0), p(5, 4), p(0, 4)],
    height: 2.8,
    closed: true,
  });
  if (!created.ok) throw new Error(created.error.message);
  return { project: created.value.project, walls: created.value.elementIds };
}

const wall = (project: Project, id: string): Wall => {
  const element = getArchElement(project.architecture, id);
  if (element?.kind !== 'wall') throw new Error('parede esperada');
  return element;
};

describe('arquitetura: paredes e encontros', () => {
  it('traçado contínuo cria uma parede por trecho, sem DN, especificação nem portas', () => {
    const { project, walls } = room(setup());
    expect(walls).toHaveLength(4);
    const first = wall(project, walls[0] ?? '');
    expect(first.name).toBe('Parede 1');
    expect('spec' in first).toBe(false);
    expect('systemId' in first).toBe(false);
    expect(project.elements).toHaveLength(0);
    expect(project.connections).toHaveLength(0);
    expect(validateProject(project)).toEqual([]);
  });

  it('encontro em L: bisel nas duas paredes e áreas que somam o contorno externo menos o interno', () => {
    const { project, walls } = room(setup());
    const footprint = wallFootprint(project.architecture, wall(project, walls[0] ?? ''));
    expect(footprint?.startJoin).toBe('corner');
    expect(footprint?.endJoin).toBe('corner');
    // Anel entre o retângulo externo (5,2 × 4,2) e o interno (4,8 × 3,8).
    const total = walls.reduce(
      (sum, id) =>
        sum + (wallQuantities(project.architecture, wall(project, id))?.grossFootprintArea ?? 0),
      0,
    );
    expect(total).toBeCloseTo(5.2 * 4.2 - 4.8 * 3.8, 9);
    for (const id of walls) {
      const polygon = wallFootprint(project.architecture, wall(project, id))?.polygon ?? [];
      expect(ringArea(polygon)).toBeGreaterThan(0);
    }
  });

  it('encontro em T: a parede apoiada termina na face da parede que passa', () => {
    const s = setup();
    const { project: withRoom, walls } = room(s);
    const tee = addWalls(withRoom, {
      typeId: s.wallType,
      levelId: s.levelId,
      points: [p(2, 0), p(2, 2)],
      height: 2.8,
    });
    expect(tee.ok).toBe(true);
    if (!tee.ok) return;
    const project = tee.value.project;
    const footprint = wallFootprint(
      project.architecture,
      wall(project, tee.value.elementIds[0] ?? ''),
    );
    expect(footprint?.startJoin).toBe('tee');
    expect(footprint?.endJoin).toBe('free');
    // Começa na face interna (y = 0,10) da parede inferior e vai até y = 2.
    expect(Math.min(...(footprint?.polygon.map((q) => q.y) ?? []))).toBeCloseTo(0.1, 9);
    expect(footprint?.clear.from).toBeCloseTo(0.1, 9);
    // A parede que passa não muda.
    expect(wallFootprint(withRoom.architecture, wall(withRoom, walls[0] ?? ''))?.polygon).toEqual(
      wallFootprint(project.architecture, wall(project, walls[0] ?? ''))?.polygon,
    );
  });

  it('linha de referência na face desloca o corpo, não a linha', () => {
    const s = setup();
    const created = addWalls(s.project, {
      typeId: s.wallType,
      levelId: s.levelId,
      points: [p(0, 0), p(4, 0)],
      height: 2.8,
      locationLine: 'faceLeft',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const w = wall(created.value.project, created.value.elementIds[0] ?? '');
    const ys = wallFootprint(created.value.project.architecture, w)?.polygon.map((q) => q.y) ?? [];
    expect(Math.max(...ys)).toBeCloseTo(0, 9);
    expect(Math.min(...ys)).toBeCloseTo(-0.2, 9);
  });

  it('recusa trecho sem comprimento, tipo de outra categoria e nível inexistente', () => {
    const s = setup();
    const input = { typeId: s.wallType, levelId: s.levelId, height: 2.8 };
    const short = addWalls(s.project, { ...input, points: [p(0, 0), p(0.01, 0)] });
    expect(short.ok ? '' : short.error.code).toBe('WALL_TOO_SHORT');
    const wrong = addWalls(s.project, { ...input, typeId: s.doorType, points: [p(0, 0), p(3, 0)] });
    expect(wrong.ok ? '' : wrong.error.code).toBe('ARCH_TYPE_MISMATCH');
    const level = addWalls(s.project, { ...input, levelId: 'x', points: [p(0, 0), p(3, 0)] });
    expect(level.ok ? '' : level.error.code).toBe('LEVEL_NOT_FOUND');
  });
});

describe('arquitetura: portas e janelas hospedadas', () => {
  function withOpenings(): Setup & { walls: string[]; door: string; window: string } {
    const s = setup();
    const r = room(s);
    const door = addHosted(r.project, {
      kind: 'door',
      typeId: s.doorType,
      hostId: r.walls[0] ?? '',
      at: 1.5,
    });
    if (!door.ok) throw new Error(door.error.message);
    const window = addHosted(door.value.project, {
      kind: 'window',
      typeId: s.windowType,
      hostId: r.walls[0] ?? '',
      at: p(3.5, 0.4),
    });
    if (!window.ok) throw new Error(window.error.message);
    return {
      ...s,
      project: window.value.project,
      walls: r.walls,
      door: door.value.elementIds[0] ?? '',
      window: window.value.elementIds[0] ?? '',
    };
  }

  it('produzem vãos reais na parede e descontam área e volume líquidos', () => {
    const s = withOpenings();
    const host = wall(s.project, s.walls[0] ?? '');
    const openings = wallOpenings(s.project.architecture, host);
    expect(openings.map((o) => [o.kind, o.from, o.to, o.bottom, o.top])).toEqual([
      ['door', 1.1, 1.9, 0, 2.1],
      ['window', 2.9, 4.1, 1.1, 2.1],
    ]);
    const q = wallQuantities(s.project.architecture, host);
    expect(q?.length).toBeCloseTo(5, 9);
    expect(q?.grossSideArea).toBeCloseTo(5 * 2.8, 9);
    expect(q?.netSideArea).toBeCloseTo(5 * 2.8 - 0.8 * 2.1 - 1.2 * 1.0, 9);
    expect(q?.grossVolume).toBeCloseTo(5 * 0.2 * 2.8, 9);
    expect(q?.netVolume).toBeCloseTo(5 * 0.2 * 2.8 - (0.8 * 2.1 + 1.2 * 1.0) * 0.2, 9);
    // Só a porta (vão até a base) reduz a área de apoio.
    expect(q?.netFootprintArea).toBeCloseTo(5 * 0.2 - 0.8 * 0.2, 9);
    expect(validateProject(s.project)).toEqual([]);
  });

  it('acompanham a parede movida e mantêm o identificador', () => {
    const s = withOpenings();
    const before = getArchElement(s.project.architecture, s.door);
    const moved = moveArchElements(s.project, s.walls, p(10, 0), 0.5);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const after = getArchElement(moved.value.architecture, s.door);
    expect(after?.id).toBe(before?.id);
    // A posição é relativa à hospedeira: nada no vão precisa mudar.
    expect(after?.kind === 'door' && after.offset).toBe(1.5);
    expect(wall(moved.value, s.walls[0] ?? '').start).toEqual(p(10, 0));
    expect(archVerticalRange(moved.value, after as ArchElement)).toEqual({ base: 0.5, top: 2.6 });
  });

  it('recusam vão fora do trecho livre, acima da parede ou sobreposto, sem alterar nada', () => {
    const s = withOpenings();
    const host = s.walls[0] ?? '';
    const input = { kind: 'door' as const, typeId: s.doorType, hostId: host };
    const corner = addHosted(s.project, { ...input, at: 0.3 });
    expect(corner.ok ? '' : corner.error.code).toBe('OPENING_DOES_NOT_FIT');
    const overlap = addHosted(s.project, { ...input, at: 2.0 });
    expect(overlap.ok ? '' : overlap.error.code).toBe('OPENING_DOES_NOT_FIT');
    const high = addHosted(s.project, { ...input, at: 2.4, sillHeight: 1 });
    expect(high.ok ? '' : high.error.code).toBe('OPENING_DOES_NOT_FIT');
    const noHost = addHosted(s.project, { ...input, hostId: s.door, at: 1 });
    expect(noHost.ok ? '' : noHost.error.code).toBe('HOST_NOT_FOUND');
  });

  it('encurtar ou rebaixar a parede além dos vãos é recusado por inteiro', () => {
    const s = withOpenings();
    const host = s.walls[0] ?? '';
    const lower = updateArchElement(s.project, host, { height: 2.0 });
    expect(lower.ok ? '' : lower.error.code).toBe('OPENING_DOES_NOT_FIT');
    const shorter = updateArchElement(s.project, host, { end: p(3.5, 0) });
    expect(shorter.ok ? '' : shorter.error.code).toBe('OPENING_DOES_NOT_FIT');
    const longer = updateArchElement(s.project, host, { height: 3.2 });
    expect(longer.ok).toBe(true);
  });

  it('porta movida sozinha desliza ao longo da parede; fora dela é recusada', () => {
    const s = withOpenings();
    const slid = moveArchElements(s.project, [s.door], p(0.5, 3));
    expect(slid.ok).toBe(true);
    if (!slid.ok) return;
    const door = getArchElement(slid.value.architecture, s.door);
    expect(door?.kind === 'door' && door.offset).toBeCloseTo(2.0, 9);
    const out = moveArchElements(s.project, [s.door], p(-3, 0));
    expect(out.ok ? '' : out.error.code).toBe('OPENING_DOES_NOT_FIT');
    const turned = rotateArchElements(s.project, [s.door], p(0, 0), Math.PI / 2);
    expect(turned.ok ? '' : turned.error.code).toBe('HOSTED_NEEDS_HOST');
  });

  it('alterar o tipo vale para todas as ocorrências e é recusado se alguma deixar de caber', () => {
    const s = withOpenings();
    expect(archTypeUsage(s.project.architecture, s.doorType).map((e) => e.id)).toEqual([s.door]);
    const wider = updateArchType(s.project, s.doorType, { width: 0.9 });
    expect(wider.ok && wider.value.affected).toEqual([s.door]);
    const tooWide = updateArchType(s.project, s.doorType, { width: 3 });
    expect(tooWide.ok ? '' : tooWide.error.code).toBe('OPENING_DOES_NOT_FIT');
    const category = updateArchType(s.project, s.doorType, { category: 'window' } as never);
    expect(category.ok ? '' : category.error.code).toBe('ARCH_TYPE_CATEGORY');
  });

  it('duplicar o tipo não afeta as ocorrências; tipo em uso não é excluído', () => {
    const s = withOpenings();
    const copy = duplicateArchType(s.project, s.doorType);
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    expect(archTypeUsage(copy.value.project.architecture, copy.value.typeId)).toHaveLength(0);
    const inUse = removeArchType(copy.value.project, s.doorType);
    expect(inUse.ok ? '' : inUse.error.code).toBe('ARCH_TYPE_IN_USE');
    expect(removeArchType(copy.value.project, copy.value.typeId).ok).toBe(true);
    const retyped = updateArchElement(copy.value.project, s.door, { typeId: copy.value.typeId });
    expect(retyped.ok).toBe(true);
  });

  it('excluir a parede exclui os elementos hospedados; excluir a porta fecha o vão', () => {
    const s = withOpenings();
    const noDoor = deleteArchElements(s.project, [s.door]);
    expect(noDoor.removed).toEqual([s.door]);
    expect(
      wallOpenings(noDoor.project.architecture, wall(noDoor.project, s.walls[0] ?? '')),
    ).toHaveLength(1);
    const noWall = deleteArchElements(s.project, [s.walls[0] ?? '']);
    expect(new Set(noWall.removed)).toEqual(new Set([s.walls[0], s.door, s.window]));
    expect(validateProject(noWall.project)).toEqual([]);
  });

  it('copiar, girar e espelhar a parede levam os hospedados, com novos identificadores na cópia', () => {
    const s = withOpenings();
    const host = s.walls[0] ?? '';
    const copy = copyArchElements(s.project, [host], p(0, 10));
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    expect(copy.value.elementIds).toHaveLength(3);
    expect(copy.value.elementIds).not.toContain(host);
    const copiedDoor = copy.value.project.architecture.elements.find(
      (e) => e.kind === 'door' && e.id !== s.door,
    );
    expect(copiedDoor?.kind === 'door' && copy.value.elementIds.includes(copiedDoor.hostId)).toBe(
      true,
    );

    const rotated = rotateArchElements(s.project, s.walls, p(0, 0), Math.PI / 2);
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    const turned = wall(rotated.value.project, host);
    expect(turned.end.x).toBeCloseTo(0, 9);
    expect(turned.end.y).toBeCloseTo(5, 9);

    // Espelho no eixo Y: a parede 0→5 vira −5→0 (sentido invertido), a porta a 1,5 m do
    // início fica a 3,5 m do novo início, no mesmo lugar físico espelhado (x = −1,5).
    const mirrored = mirrorArchElements(s.project, s.walls, p(0, 0), p(0, 1));
    expect(mirrored.ok).toBe(true);
    if (!mirrored.ok) return;
    const flipped = wall(mirrored.value.project, host);
    expect(flipped.start).toEqual(p(-5, 0));
    expect(flipped.end.x).toBeCloseTo(0, 9);
    const door = getArchElement(mirrored.value.project.architecture, s.door);
    expect(door?.kind === 'door' && [door.offset, door.hand, door.facing]).toEqual([
      3.5,
      'right',
      1,
    ]);
    expect(validateProject(mirrored.value.project)).toEqual([]);
  });
});

describe('arquitetura: pisos, aberturas e ambientes', () => {
  const outline = [p(0, 0), p(5, 0), p(5, 4), p(0, 4)];
  const hole = [p(1, 1), p(2, 1), p(2, 2), p(1, 2)];

  it('laje com abertura: bruto pelo contorno, líquido descontada a abertura', () => {
    const s = setup();
    const slab = addFloor(s.project, {
      kind: 'slab',
      typeId: s.slabType,
      levelId: s.levelId,
      boundary: outline,
    });
    expect(slab.ok).toBe(true);
    if (!slab.ok) return;
    const id = slab.value.elementIds[0] ?? '';
    const opened = addFloorOpening(slab.value.project, id, hole);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const element = getArchElement(opened.value.project.architecture, id);
    if (element?.kind !== 'slab') throw new Error('laje esperada');
    const q = floorQuantities(opened.value.project.architecture, element);
    expect(q).toMatchObject({ depth: 0.12, perimeter: 18, grossArea: 20, netArea: 19 });
    expect(q?.netVolume).toBeCloseTo(19 * 0.12, 9);
    // O topo fica na cota do nível; a laje desce a espessura.
    expect(archVerticalRange(opened.value.project, element)).toEqual({ base: -0.12, top: 0 });
    const closed = removeFloorOpening(opened.value.project, id, opened.value.openingId);
    expect(closed.ok).toBe(true);
    expect(validateProject(opened.value.project)).toEqual([]);
  });

  it('recusa abertura fora do contorno, cruzando-o ou sobre outra abertura', () => {
    const s = setup();
    const slab = addFloor(s.project, {
      kind: 'slab',
      typeId: s.slabType,
      levelId: s.levelId,
      boundary: outline,
    });
    if (!slab.ok) throw new Error(slab.error.message);
    const id = slab.value.elementIds[0] ?? '';
    const outside = addFloorOpening(slab.value.project, id, [p(6, 1), p(7, 1), p(7, 2), p(6, 2)]);
    expect(outside.ok ? '' : outside.error.code).toBe('OPENING_OUTSIDE');
    const crossing = addFloorOpening(slab.value.project, id, [p(4, 1), p(6, 1), p(6, 2), p(4, 2)]);
    expect(crossing.ok).toBe(false);
    const first = addFloorOpening(slab.value.project, id, hole);
    if (!first.ok) throw new Error(first.error.message);
    const overlap = addFloorOpening(first.value.project, id, [
      p(1.5, 1.5),
      p(3, 1.5),
      p(3, 3),
      p(1.5, 3),
    ]);
    expect(overlap.ok).toBe(false);
    const bowtie = addFloor(s.project, {
      kind: 'slab',
      typeId: s.slabType,
      levelId: s.levelId,
      boundary: [p(0, 0), p(2, 2), p(2, 0), p(0, 2)],
    });
    expect(bowtie.ok ? '' : bowtie.error.code).toBe('POLYGON_SELF_INTERSECTION');
  });

  it('revestimento de piso é elemento distinto da laje, apoiado sobre ela', () => {
    const s = setup();
    const slab = addFloor(s.project, {
      kind: 'slab',
      typeId: s.slabType,
      levelId: s.levelId,
      boundary: outline,
    });
    if (!slab.ok) throw new Error(slab.error.message);
    const finish = addFloor(slab.value.project, {
      kind: 'flooring',
      typeId: s.flooringType,
      levelId: s.levelId,
      boundary: outline,
    });
    expect(finish.ok).toBe(true);
    if (!finish.ok) return;
    const element = getArchElement(
      finish.value.project.architecture,
      finish.value.elementIds[0] ?? '',
    );
    expect(element?.kind).toBe('flooring');
    expect(archVerticalRange(finish.value.project, element as ArchElement)).toEqual({
      base: 0,
      top: 0.05,
    });
    const wrong = addFloor(s.project, {
      kind: 'flooring',
      typeId: s.slabType,
      levelId: s.levelId,
      boundary: outline,
    });
    expect(wrong.ok ? '' : wrong.error.code).toBe('ARCH_TYPE_MISMATCH');
  });

  it('ambiente: área e perímetro do contorno; pé-direito e volume pendentes até informados', () => {
    const s = setup();
    const inner = [p(0.1, 0.1), p(4.9, 0.1), p(4.9, 3.9), p(0.1, 3.9)];
    const created = addSpace(s.project, {
      levelId: s.levelId,
      boundary: inner,
      name: 'Sala',
      number: '01',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.elementIds[0] ?? '';
    const space = getArchElement(created.value.project.architecture, id);
    if (space?.kind !== 'space') throw new Error('ambiente esperado');
    const q = spaceQuantities(space);
    expect(q.area).toBeCloseTo(4.8 * 3.8, 9);
    expect(q.perimeter).toBeCloseTo(2 * (4.8 + 3.8), 9);
    expect(q.height).toBeNull();
    expect(q.volume).toBeNull();
    const informed = updateArchElement(created.value.project, id, { height: 2.7 });
    expect(informed.ok).toBe(true);
    if (!informed.ok) return;
    expect(computeSpaceSchedule(informed.value)[0]).toMatchObject({
      name: 'Sala',
      number: '01',
      height: 2.7,
    });
  });

  it('quantitativo: cada elemento entra uma vez, por pavimento e tipo, com "NC" sem classificação', () => {
    const s = setup();
    const r = room(s);
    const slab = addFloor(r.project, {
      kind: 'slab',
      typeId: s.slabType,
      levelId: s.levelId,
      boundary: outline,
    });
    if (!slab.ok) throw new Error(slab.error.message);
    const finish = addFloor(slab.value.project, {
      kind: 'flooring',
      typeId: s.flooringType,
      levelId: s.levelId,
      boundary: outline,
    });
    if (!finish.ok) throw new Error(finish.error.message);
    const space = addSpace(finish.value.project, { levelId: s.levelId, boundary: outline });
    if (!space.ok) throw new Error(space.error.message);
    const classified = updateArchType(space.value.project, s.wallType, {
      classifications: [{ system: 'nbr15965', table: '3E', code: '04 20 10' }],
    });
    if (!classified.ok) throw new Error(classified.error.message);
    const rows = computeArchQuantities(classified.value.project);
    expect(rows.map((row) => [row.category, row.count])).toEqual([
      ['Paredes', 4],
      ['Lajes de piso', 1],
      ['Revestimentos de piso', 1],
    ]);
    expect(rows[0]).toMatchObject({ nbr15965: '3E 04 20 10', sinapi: 'NC', size: '20 cm' });
    expect(rows[1]?.grossArea).toBeCloseTo(20, 9);
    expect(rows[2]?.grossArea).toBeCloseTo(20, 9);
  });

  it('triangulação de polígono com furo preserva a área', () => {
    const { points, triangles } = triangulatePolygon(outline, [[...hole].reverse()]);
    expect(triangulatedArea(points, triangles)).toBeCloseTo(19, 9);
    const concave = [p(0, 0), p(4, 0), p(4, 1), p(1, 1), p(1, 3), p(0, 3)];
    const l = triangulatePolygon(concave);
    expect(triangulatedArea(l.points, l.triangles)).toBeCloseTo(6, 9);
  });
});

describe('arquitetura: projeto, persistência e vistas', () => {
  it('produto de fabricante exige fonte; genérico não', () => {
    const s = setup();
    const product = addArchType(s.project, { ...DOOR_TYPE, name: 'Porta X', generic: false });
    expect(product.ok ? '' : product.error.code).toBe('ARCH_SOURCE_REQUIRED');
    const sourced = addArchType(s.project, {
      ...DOOR_TYPE,
      name: 'Porta X',
      generic: false,
      source: 'Fabricante X, catálogo 2026, p. 12, https://exemplo.invalid/catalogo.pdf',
    });
    expect(sourced.ok).toBe(true);
    const repeated = addArchType(s.project, { ...DOOR_TYPE });
    expect(repeated.ok ? '' : repeated.error.code).toBe('ARCH_TYPE_NAME_TAKEN');
  });

  it('salvar e reabrir preserva tipos, ocorrências e identificadores', () => {
    const { project } = room(setup());
    const reopened = parseProject(serializeProject(project));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.value.architecture).toEqual(project.architecture);
  });

  it('documento v15 migra com a arquitetura vazia; arquitetura corrompida é recusada', () => {
    const empty = createProject('Antigo');
    const { architecture: _architecture, ...legacy } = empty;
    const migrated = parseProject(JSON.stringify({ ...legacy, schemaVersion: 15 }));
    expect(migrated.ok && migrated.value.architecture).toEqual({ types: [], elements: [] });

    const { project, walls } = room(setup());
    const broken = {
      ...project,
      architecture: {
        ...project.architecture,
        elements: project.architecture.elements.map((e) =>
          e.id === walls[0] ? { ...e, typeId: 'inexistente' } : e,
        ),
      },
    };
    const parsed = parseProject(JSON.stringify(broken));
    expect(parsed.ok ? '' : parsed.error.code).toBe('ARCH_TYPE_NOT_FOUND');
  });

  it('nível com arquitetura não é excluído; a vista oculta categorias de arquitetura', () => {
    const s = setup();
    const { project } = room(s);
    const second = addLevel(project, 'Superior', 3);
    if (!second.ok) throw new Error(second.error.message);
    const blocked = removeLevel(second.value, s.levelId);
    expect(blocked.ok ? '' : blocked.error.code).toBe('LEVEL_IN_USE');

    const view = addView(project, { kind: 'plan', levelId: s.levelId });
    if (!view.ok) throw new Error(view.error.message);
    const plan = view.value.project.views[0];
    if (!plan) throw new Error('vista esperada');
    expect(viewArchElementsOf(view.value.project, plan)).toHaveLength(4);
    expect(
      viewArchElementsOf(view.value.project, {
        ...plan,
        visibility: { ...plan.visibility, hiddenCategories: ['walls'] },
      }),
    ).toHaveLength(0);
  });
});
