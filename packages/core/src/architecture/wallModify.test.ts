import { describe, expect, it } from 'vitest';
import { createProject } from '../operations';
import { addLevel } from '../projectOps';
import type { HostedElement, Point2, Project, Wall } from '../schema';
import { validateProject } from '../validation';
import {
  addArchType,
  addFloor,
  addHosted,
  addWalls,
  alignArchElement,
  getArchElement,
  hostedPoint,
  splitWall,
  trimWallsToCorner,
  trimWallToWall,
  wallFootprint,
  type ArchTypeInput,
  type PlanLine,
} from './index';

const p = (x: number, y: number): Point2 => ({ x, y });
const line = (ax: number, ay: number, bx: number, by: number): PlanLine => ({
  a: p(ax, ay),
  b: p(bx, by),
});

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
    { id: 'a', material: 'Bloco', thickness: 0.2, function: 'structure', hatch: 'diagonal' },
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

interface Setup {
  project: Project;
  levelId: string;
  wallType: string;
  slabType: string;
  doorType: string;
}

function setup(): Setup {
  let project = createProject('Teste', 'architecture');
  const ids: string[] = [];
  for (const type of [WALL_TYPE, SLAB_TYPE, DOOR_TYPE]) {
    const added = addArchType(project, type);
    if (!added.ok) throw new Error(added.error.message);
    project = added.value.project;
    ids.push(added.value.typeId);
  }
  const [wallType, slabType, doorType] = ids as [string, string, string];
  return { project, levelId: project.levels[0]?.id ?? '', wallType, slabType, doorType };
}

/** Acrescenta um traçado de paredes e devolve os identificadores, na ordem dos trechos. */
function draw(
  s: Setup,
  project: Project,
  points: Point2[],
  options: { closed?: boolean; levelId?: string } = {},
): { project: Project; ids: string[] } {
  const created = addWalls(project, {
    typeId: s.wallType,
    levelId: options.levelId ?? s.levelId,
    points,
    height: 2.8,
    closed: options.closed ?? false,
  });
  if (!created.ok) throw new Error(created.error.message);
  return { project: created.value.project, ids: created.value.elementIds };
}

function door(
  s: Setup,
  project: Project,
  hostId: string,
  at: number,
): { project: Project; id: string } {
  const added = addHosted(project, { kind: 'door', typeId: s.doorType, hostId, at });
  if (!added.ok) throw new Error(added.error.message);
  return { project: added.value.project, id: added.value.elementIds[0] ?? '' };
}

const wall = (project: Project, id: string): Wall => {
  const element = getArchElement(project.architecture, id);
  if (element?.kind !== 'wall') throw new Error('parede esperada');
  return element;
};
const hosted = (project: Project, id: string): HostedElement => {
  const element = getArchElement(project.architecture, id);
  if (element?.kind !== 'door' && element?.kind !== 'window') throw new Error('vão esperado');
  return element;
};
const near = (actual: Point2, x: number, y: number): void => {
  expect(actual.x).toBeCloseTo(x, 9);
  expect(actual.y).toBeCloseTo(y, 9);
};
/** Posição do vão em planta (centro, na linha de referência da hospedeira). */
const hostedAt = (project: Project, id: string): Point2 => {
  const element = hosted(project, id);
  return hostedPoint(wall(project, element.hostId), element.offset);
};

describe('aparar/estender para canto', () => {
  it('estende duas paredes afastadas até o canto: bisel derivado, ids mantidos, projeto íntegro', () => {
    const s = setup();
    const left = draw(s, s.project, [p(0, 0), p(0, 3.5)]);
    const top = draw(s, left.project, [p(1, 4), p(5, 4)]);
    const [a = ''] = left.ids;
    const [b = ''] = top.ids;
    const before = top.project;
    const result = trimWallsToCorner(
      before,
      { wallId: a, point: p(0, 2) },
      { wallId: b, point: p(3, 4) },
    );
    if (!result.ok) throw new Error(result.error.message);
    near(wall(result.value, a).start, 0, 0);
    near(wall(result.value, a).end, 0, 4);
    near(wall(result.value, b).start, 0, 4);
    near(wall(result.value, b).end, 5, 4);
    expect(wallFootprint(result.value.architecture, wall(result.value, a))?.endJoin).toBe('corner');
    expect(wallFootprint(result.value.architecture, wall(result.value, b))?.startJoin).toBe(
      'corner',
    );
    expect(validateProject(result.value)).toEqual([]);
    // O projeto recebido não é mutado.
    near(wall(before, a).end, 0, 3.5);
    near(wall(before, b).start, 1, 4);
  });

  it('paredes que se cruzam: fica o lado clicado de cada uma e os vãos não saem do lugar', () => {
    const s = setup();
    const first = draw(s, s.project, [p(0, 0), p(6, 0)]);
    const second = draw(s, first.project, [p(3, -2), p(3, 3)]);
    const [a = ''] = first.ids;
    const [b = ''] = second.ids;
    const withDoor = door(s, second.project, a, 5);
    // Mantém o lado direito de A (onde está a porta) e o lado de cima de B.
    const result = trimWallsToCorner(
      withDoor.project,
      { wallId: a, point: p(5, 0) },
      { wallId: b, point: p(3, 2) },
    );
    if (!result.ok) throw new Error(result.error.message);
    near(wall(result.value, a).start, 3, 0);
    near(wall(result.value, a).end, 6, 0);
    near(wall(result.value, b).start, 3, 0);
    near(wall(result.value, b).end, 3, 3);
    // O início de A mudou: a distância gravada é corrigida e a porta continua em x = 5.
    expect(hosted(result.value, withDoor.id).offset).toBeCloseTo(2, 9);
    near(hostedAt(result.value, withDoor.id), 5, 0);
    expect(validateProject(result.value)).toEqual([]);

    // Manter o lado esquerdo apararia o trecho da porta: recusado por inteiro.
    const refused = trimWallsToCorner(
      withDoor.project,
      { wallId: a, point: p(1, 0) },
      { wallId: b, point: p(3, 2) },
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('OPENING_DOES_NOT_FIT');
  });

  it('recusa paredes paralelas, a mesma parede e níveis diferentes', () => {
    const s = setup();
    const first = draw(s, s.project, [p(0, 0), p(4, 0)]);
    const second = draw(s, first.project, [p(0, 2), p(4, 2)]);
    const [a = ''] = first.ids;
    const [b = ''] = second.ids;
    const parallel = trimWallsToCorner(
      second.project,
      { wallId: a, point: p(1, 0) },
      { wallId: b, point: p(1, 2) },
    );
    expect(!parallel.ok && parallel.error.code).toBe('WALLS_PARALLEL');
    const same = trimWallsToCorner(
      second.project,
      { wallId: a, point: p(1, 0) },
      { wallId: a, point: p(2, 0) },
    );
    expect(!same.ok && same.error.code).toBe('TRIM_SAME_WALL');
    const missing = trimWallsToCorner(
      second.project,
      { wallId: a, point: p(1, 0) },
      { wallId: 'nada', point: p(2, 0) },
    );
    expect(!missing.ok && missing.error.code).toBe('WALL_NOT_FOUND');

    const upper = addLevel(second.project, 'Superior', 3);
    if (!upper.ok) throw new Error(upper.error.message);
    const upperId = upper.value.levels.find((level) => level.name === 'Superior')?.id ?? '';
    const third = draw(s, upper.value, [p(2, -1), p(2, 3)], { levelId: upperId });
    const levels = trimWallsToCorner(
      third.project,
      { wallId: a, point: p(1, 0) },
      { wallId: third.ids[0] ?? '', point: p(2, 2) },
    );
    expect(!levels.ok && levels.error.code).toBe('WALLS_DIFFERENT_LEVELS');
  });
});

describe('aparar/estender até uma parede', () => {
  it('estende até a parede-limite (encontro em T) e apara a que passa dela; o limite não muda', () => {
    const s = setup();
    const limit = draw(s, s.project, [p(0, 0), p(0, 4)]);
    const short = draw(s, limit.project, [p(1, 2), p(4, 2)]);
    const long = draw(s, short.project, [p(-2, 1), p(3, 1)]);
    const [boundary = ''] = limit.ids;
    const [b = ''] = short.ids;
    const [c = ''] = long.ids;

    const extended = trimWallToWall(long.project, boundary, { wallId: b, point: p(3, 2) });
    if (!extended.ok) throw new Error(extended.error.message);
    near(wall(extended.value, b).start, 0, 2);
    near(wall(extended.value, b).end, 4, 2);
    expect(wallFootprint(extended.value.architecture, wall(extended.value, b))?.startJoin).toBe(
      'tee',
    );
    expect(wall(extended.value, boundary)).toBe(wall(long.project, boundary));

    // A que cruza o limite: fica o lado clicado (direito) e o resto é aparado.
    const trimmed = trimWallToWall(extended.value, boundary, { wallId: c, point: p(2, 1) });
    if (!trimmed.ok) throw new Error(trimmed.error.message);
    near(wall(trimmed.value, c).start, 0, 1);
    near(wall(trimmed.value, c).end, 3, 1);
    expect(validateProject(trimmed.value)).toEqual([]);

    const parallel = trimWallToWall(trimmed.value, b, { wallId: c, point: p(2, 1) });
    expect(!parallel.ok && parallel.error.code).toBe('WALLS_PARALLEL');
  });
});

describe('dividir parede', () => {
  it('a original mantém o id e o trecho do início; os vãos passam para o trecho em que estão', () => {
    const s = setup();
    const drawn = draw(s, s.project, [p(0, 0), p(6, 0)]);
    const [id = ''] = drawn.ids;
    const first = door(s, drawn.project, id, 1);
    const second = door(s, first.project, id, 4.5);
    const result = splitWall(second.project, id, p(3, 0.7));
    if (!result.ok) throw new Error(result.error.message);
    const { project } = result.value;
    const [tailId = ''] = result.value.elementIds;
    near(wall(project, id).start, 0, 0);
    near(wall(project, id).end, 3, 0);
    near(wall(project, tailId).start, 3, 0);
    near(wall(project, tailId).end, 6, 0);
    expect(wall(project, tailId).name).toBe('Parede 2');
    expect(wall(project, tailId).typeId).toBe(s.wallType);
    expect(wall(project, tailId).height).toBe(2.8);
    expect(hosted(project, first.id).hostId).toBe(id);
    expect(hosted(project, first.id).offset).toBeCloseTo(1, 9);
    expect(hosted(project, second.id).hostId).toBe(tailId);
    expect(hosted(project, second.id).offset).toBeCloseTo(1.5, 9);
    near(hostedAt(project, second.id), 4.5, 0);
    expect(validateProject(project)).toEqual([]);
    expect(second.project.architecture.elements).toHaveLength(3);
  });

  it('recusa dividir dentro de um vão ou junto das extremidades', () => {
    const s = setup();
    const drawn = draw(s, s.project, [p(0, 0), p(6, 0)]);
    const [id = ''] = drawn.ids;
    const withDoor = door(s, drawn.project, id, 1);
    const through = splitWall(withDoor.project, id, p(1.2, 0));
    expect(!through.ok && through.error.code).toBe('SPLIT_THROUGH_OPENING');
    const edge = splitWall(withDoor.project, id, p(0.01, 0));
    expect(!edge.ok && edge.error.code).toBe('SPLIT_OUTSIDE_WALL');
    const beyond = splitWall(withDoor.project, id, p(7, 0));
    expect(!beyond.ok && beyond.error.code).toBe('SPLIT_OUTSIDE_WALL');
    const missing = splitWall(withDoor.project, 'nada', p(3, 0));
    expect(!missing.ok && missing.error.code).toBe('WALL_NOT_FOUND');
  });
});

describe('alinhar', () => {
  /** Retângulo de 5 × 4 m: base, direita, topo e esquerda. */
  const room = (s: Setup) =>
    draw(s, s.project, [p(0, 0), p(5, 0), p(5, 4), p(0, 4)], { closed: true });

  it('parede do retângulo: desloca-se e leva os cantos; os vãos das vizinhas ficam no lugar', () => {
    const s = setup();
    const drawn = room(s);
    const [bottom = '', right = '', top = '', left = ''] = drawn.ids;
    // Topo vai de (5;4) a (0;4): a porta a 1 m do início está em x = 4.
    const topDoor = door(s, drawn.project, top, 1);
    const bottomDoor = door(s, topDoor.project, bottom, 1);
    const before = bottomDoor.project;
    const edge = { a: wall(before, right).start, b: wall(before, right).end };
    const result = alignArchElement(before, right, line(6, -1, 6, 1), edge);
    if (!result.ok) throw new Error(result.error.message);
    const after = result.value;
    near(wall(after, right).start, 6, 0);
    near(wall(after, right).end, 6, 4);
    near(wall(after, bottom).end, 6, 0);
    near(wall(after, top).start, 6, 4);
    expect(wall(after, left)).toBe(wall(before, left));
    for (const id of [bottom, right, top, left]) {
      const footprint = wallFootprint(after.architecture, wall(after, id));
      expect(footprint?.startJoin).toBe('corner');
      expect(footprint?.endJoin).toBe('corner');
    }
    near(hostedAt(after, topDoor.id), 4, 4);
    expect(hosted(after, topDoor.id).offset).toBeCloseTo(2, 9);
    expect(hosted(after, bottomDoor.id).offset).toBeCloseTo(1, 9);
    expect(validateProject(after)).toEqual([]);
    near(wall(before, right).start, 5, 0);
  });

  it('alinha pela face indicada, não pelo eixo', () => {
    const s = setup();
    const drawn = room(s);
    const right = drawn.ids[1] ?? '';
    // Face externa da parede direita (espessura 0,20 m, eixo no centro): x = 5,10.
    const result = alignArchElement(drawn.project, right, line(6, 0, 6, 1), line(5.1, 0, 5.1, 4));
    if (!result.ok) throw new Error(result.error.message);
    near(wall(result.value, right).start, 5.9, 0);
    near(wall(result.value, right).end, 5.9, 4);
  });

  it('leva a parede apoiada em T e mantém sobre o apoio a extremidade que se apoia', () => {
    const s = setup();
    const drawn = room(s);
    const [bottom = '', right = '', , left = ''] = drawn.ids;
    const inner = draw(s, drawn.project, [p(2, 0), p(2, 2.5)]);
    const [tee = ''] = inner.ids;
    const result = alignArchElement(inner.project, bottom, line(0, -1, 1, -1), line(0, 0, 5, 0));
    if (!result.ok) throw new Error(result.error.message);
    near(wall(result.value, bottom).start, 0, -1);
    near(wall(result.value, bottom).end, 5, -1);
    near(wall(result.value, tee).start, 2, -1);
    near(wall(result.value, tee).end, 2, 2.5);
    near(wall(result.value, right).start, 5, -1);
    near(wall(result.value, left).end, 0, -1);
    expect(validateProject(result.value)).toEqual([]);

    // A parede em T deslocada continua apoiada na base: a extremidade segue sobre ela.
    const shifted = alignArchElement(result.value, tee, line(3, 0, 3, 1), line(2, -1, 2, 2.5));
    if (!shifted.ok) throw new Error(shifted.error.message);
    near(wall(shifted.value, tee).start, 3, -1);
    near(wall(shifted.value, tee).end, 3, 2.5);
    expect(wallFootprint(shifted.value.architecture, wall(shifted.value, tee))?.startJoin).toBe(
      'tee',
    );
  });

  it('aresta de topo: só a extremidade vai até a referência', () => {
    const s = setup();
    const drawn = draw(s, s.project, [p(0, 0), p(3, 0)]);
    const [id = ''] = drawn.ids;
    const withDoor = door(s, drawn.project, id, 1);
    const result = alignArchElement(withDoor.project, id, line(4, -5, 4, 5), line(3, -0.1, 3, 0.1));
    if (!result.ok) throw new Error(result.error.message);
    near(wall(result.value, id).start, 0, 0);
    near(wall(result.value, id).end, 4, 0);
    const back = alignArchElement(result.value, id, line(-1, -5, -1, 5), line(0, 0.1, 0, -0.1));
    if (!back.ok) throw new Error(back.error.message);
    near(wall(back.value, id).start, -1, 0);
    near(hostedAt(back.value, withDoor.id), 1, 0);
    // Encurtar além da outra extremidade deixaria a parede sem comprimento.
    const gone = alignArchElement(back.value, id, line(9, -5, 9, 5), line(-1, 0.1, -1, -0.1));
    expect(!gone.ok && gone.error.code).toBe('WALL_TOO_SHORT');
  });

  it('laje: o contorno inteiro se desloca na perpendicular à referência', () => {
    const s = setup();
    const added = addFloor(s.project, {
      kind: 'slab',
      typeId: s.slabType,
      levelId: s.levelId,
      boundary: [p(0, 0), p(4, 0), p(4, 3), p(0, 3)],
    });
    if (!added.ok) throw new Error(added.error.message);
    const [id = ''] = added.value.elementIds;
    const result = alignArchElement(added.value.project, id, line(-1, 0, -1, 9), line(0, 3, 0, 0));
    if (!result.ok) throw new Error(result.error.message);
    const slab = getArchElement(result.value.architecture, id);
    if (slab?.kind !== 'slab') throw new Error('laje esperada');
    expect(slab.boundary.map((q) => q.x)).toEqual([-1, 3, 3, -1]);
    expect(slab.boundary.map((q) => q.y)).toEqual([0, 0, 3, 3]);
    expect(validateProject(result.value)).toEqual([]);
  });

  it('recusa aresta não paralela, elemento já alinhado e porta ou janela', () => {
    const s = setup();
    const drawn = room(s);
    const [bottom = '', right = ''] = drawn.ids;
    const withDoor = door(s, drawn.project, bottom, 2);
    const edge = line(5, 0, 5, 4);
    const oblique = alignArchElement(withDoor.project, right, line(6, 0, 7, 4), edge);
    expect(!oblique.ok && oblique.error.code).toBe('ALIGN_NOT_PARALLEL');
    const already = alignArchElement(withDoor.project, right, line(5, -3, 5, -2), edge);
    expect(!already.ok && already.error.code).toBe('ALIGN_NO_CHANGE');
    const hostedOnly = alignArchElement(withDoor.project, withDoor.id, line(6, 0, 6, 1), edge);
    expect(!hostedOnly.ok && hostedOnly.error.code).toBe('ALIGN_HOSTED');
    const degenerate = alignArchElement(withDoor.project, right, line(6, 0, 6, 0), edge);
    expect(!degenerate.ok && degenerate.error.code).toBe('INVALID_VALUE');
    // Uma porta na base, junto do canto, impede que a parede direita avance sobre ela.
    const tight = door(s, drawn.project, bottom, 4.3);
    const refused = alignArchElement(tight.project, right, line(4.5, 0, 4.5, 1), edge);
    expect(!refused.ok && refused.error.code).toBe('OPENING_DOES_NOT_FIT');
  });
});
