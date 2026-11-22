import { describe, expect, it } from 'vitest';
import { createProject } from '../operations';
import type { Point2, Project, Roof, Wall } from '../schema';
import { SCHEMA_VERSION } from '../schema';
import { parseProject, parseProjectDocument, serializeProject } from '../serialization';
import { ringArea } from '../terrain/polygon';
import { validateProject } from '../validation';
import { viewArchElementsOf, addView } from '../views';
import {
  addArchType,
  addHosted,
  addRoof,
  addWalls,
  archVerticalRange,
  computeArchQuantities,
  copyArchElements,
  getArchElement,
  mirrorArchElements,
  moveArchElements,
  moveRectangleCorner,
  moveRectangleEdge,
  moveWallEndpoint,
  percentToSlope,
  rectangleFromThreePoints,
  roofBoundaryProblem,
  roofFootprint,
  roofFrame,
  roofQuantities,
  roofRidgeLine,
  rotateArchElements,
  seatArchElement,
  slopeToPercent,
  updateArchElement,
  updateArchType,
  wallOpenings,
  archQuantitiesToCsv,
  type ArchTypeInput,
} from './index';

const p = (x: number, y: number): Point2 => ({ x, y });
const deg = (value: number): number => (value * Math.PI) / 180;

const base = {
  familyId: null,
  generic: true,
  source: null,
  manufacturing: {},
  classifications: [],
  ifc: {},
};
const layers = [
  { id: 'a', material: 'Telha cerâmica', thickness: 0.02, function: 'finish', hatch: 'none' },
  { id: 'b', material: 'Estrutura', thickness: 0.08, function: 'structure', hatch: 'none' },
] as const;
const SHED: ArchTypeInput = {
  ...base,
  category: 'roof',
  name: 'Uma água 10',
  shape: 'shed',
  ifcPredefinedType: 'SHED_ROOF',
  layers: layers.map((layer) => ({ ...layer })),
};
const GABLE: ArchTypeInput = {
  ...base,
  category: 'roof',
  name: 'Duas águas 10',
  shape: 'gable',
  ifcPredefinedType: 'GABLE_ROOF',
  layers: layers.map((layer) => ({ ...layer })),
};
const WALL: ArchTypeInput = {
  ...base,
  category: 'wall',
  name: 'Parede 20',
  ifcPredefinedType: 'SOLIDWALL',
  layers: [{ id: 'a', material: 'Bloco', thickness: 0.2, function: 'structure', hatch: 'none' }],
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

function setup(): { project: Project; levelId: string; types: Record<string, string> } {
  let project = createProject('Telhados', 'architecture');
  const types: Record<string, string> = {};
  for (const [key, type] of Object.entries({ shed: SHED, gable: GABLE, wall: WALL, door: DOOR })) {
    const added = addArchType(project, type);
    if (!added.ok) throw new Error(added.error.message);
    project = added.value.project;
    types[key] = added.value.typeId;
  }
  const levelId = project.levels[0]?.id;
  if (!levelId) throw new Error('sem nível');
  return { project, levelId, types };
}

const RECT = [p(0, 0), p(8, 0), p(8, 6), p(0, 6)];

function roofOf(project: Project, id: string): Roof {
  const element = getArchElement(project.architecture, id);
  if (element?.kind !== 'roof') throw new Error('não é telhado');
  return element;
}

function create(
  kind: 'shed' | 'gable',
  input: Partial<Parameters<typeof addRoof>[1]> = {},
): { project: Project; id: string; levelId: string; types: Record<string, string> } {
  const s = setup();
  const created = addRoof(s.project, {
    typeId: s.types[kind] as string,
    levelId: s.levelId,
    boundary: RECT,
    slope: percentToSlope(30),
    overhang: 0.5,
    offset: 2.8,
    ...input,
  });
  if (!created.ok) throw new Error(created.error.message);
  return { ...s, project: created.value.project, id: created.value.elementIds[0] as string };
}

describe('telhados: geometria derivada', () => {
  it('converte inclinação entre percentual e ângulo sem perda', () => {
    expect(slopeToPercent(percentToSlope(30))).toBeCloseTo(30, 12);
    expect(slopeToPercent(deg(45))).toBeCloseTo(100, 10);
    expect(percentToSlope(100)).toBeCloseTo(deg(45), 12);
  });

  it('uma água: referência na face inferior sobre o beiral, espessura perpendicular à água', () => {
    const { project, id } = create('shed');
    const roof = roofOf(project, id);
    const frame = roofFrame(roof, SHED as never);
    expect(frame).not.toBeNull();
    expect(frame?.length).toBeCloseTo(8, 9);
    expect(frame?.span).toBeCloseTo(6, 9);
    expect(frame?.ridge).toBeNull();
    const slope = percentToSlope(30);
    // Espessura na vertical = espessura ÷ cos(inclinação).
    expect(frame?.verticalThickness).toBeCloseTo(0.1 / Math.cos(slope), 12);
    const range = archVerticalRange(project, roof);
    // Base: borda do beiral, 0,5 m para fora, 30 % abaixo da referência (2,80).
    expect(range?.base).toBeCloseTo(2.8 - 0.5 * 0.3, 9);
    // Topo: lado alto (vão + beiral) mais a espessura na vertical.
    expect(range?.top).toBeCloseTo(2.8 + 6.5 * 0.3 + 0.1 / Math.cos(slope), 9);
  });

  it('duas águas: cumeeira no meio do vão, paralela ao lado do beiral', () => {
    const { project, id } = create('gable');
    const roof = roofOf(project, id);
    const frame = roofFrame(roof, GABLE as never);
    expect(frame?.ridge).toBeCloseTo(3, 9);
    const ridge = frame ? roofRidgeLine(frame) : null;
    expect(ridge?.[0]).toEqual({ x: -0.5, y: 3 });
    expect(ridge?.[1]).toEqual({ x: 8.5, y: 3 });
    const range = archVerticalRange(project, roof);
    expect(range?.top).toBeCloseTo(2.8 + 3 * 0.3 + 0.1 / Math.cos(percentToSlope(30)), 9);
    expect(range?.base).toBeCloseTo(2.8 - 0.15, 9);
  });

  it('a projeção inclui o beiral nos quatro lados', () => {
    const { project, id } = create('gable');
    const frame = roofFrame(roofOf(project, id), GABLE as never);
    const footprint = frame ? roofFootprint(frame) : [];
    expect(Math.abs(ringArea(footprint))).toBeCloseTo(9 * 7, 9);
  });

  it('distingue área inclinada de projeção horizontal e calcula o volume sem dupla contagem', () => {
    const { project, id } = create('gable');
    const q = roofQuantities(project.architecture, roofOf(project, id));
    const slope = percentToSlope(30);
    expect(q?.projectedArea).toBeCloseTo(63, 9);
    expect(q?.slopeArea).toBeCloseTo(63 / Math.cos(slope), 9);
    expect(q?.slopeArea).toBeGreaterThan(q?.projectedArea ?? Infinity);
    expect(q?.volume).toBeCloseTo((63 / Math.cos(slope)) * 0.1, 9);
    expect(q?.ridgeLength).toBeCloseTo(9, 9);
    expect(q?.eaveLength).toBeCloseTo(18, 9);
    const shed = create('shed');
    const qs = roofQuantities(shed.project.architecture, roofOf(shed.project, shed.id));
    expect(qs?.ridgeLength).toBeNull();
    expect(qs?.eaveLength).toBeCloseTo(9, 9);
    // Mesma projeção e mesma inclinação: mesma área inclinada nas duas tipologias.
    expect(qs?.slopeArea).toBeCloseTo(q?.slopeArea ?? 0, 9);
  });

  it('funciona em contorno retangular oblíquo', () => {
    const angle = deg(23);
    const rot = (q: Point2): Point2 => ({
      x: q.x * Math.cos(angle) - q.y * Math.sin(angle),
      y: q.x * Math.sin(angle) + q.y * Math.cos(angle),
    });
    const { project, id } = create('gable', { boundary: RECT.map(rot) });
    const frame = roofFrame(roofOf(project, id), GABLE as never);
    expect(frame?.length).toBeCloseTo(8, 9);
    expect(frame?.span).toBeCloseTo(6, 9);
    expect(Math.atan2(frame?.along.y ?? 0, frame?.along.x ?? 1)).toBeCloseTo(angle, 9);
    expect(validateProject(project).filter((issue) => issue.severity === 'error')).toEqual([]);
  });
});

describe('telhados: operações', () => {
  it('cria com nome, tipo, nível e parâmetros, sem pendências', () => {
    const { project, id, levelId, types } = create('shed', { eaveEdge: 1 });
    const roof = roofOf(project, id);
    expect(roof.name).toBe('Telhado 1');
    expect(roof.typeId).toBe(types.shed);
    expect(roof.levelId).toBe(levelId);
    expect(roof.eaveEdge).toBe(1);
    expect(roof.overhang).toBe(0.5);
    expect(validateProject(project).filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('normaliza o contorno horário mantendo o mesmo lado físico de beiral', () => {
    const clockwise = [p(0, 0), p(0, 6), p(8, 6), p(8, 0)];
    // Lado 0 do anel horário: de (0,0) a (0,6), o lado x = 0.
    const { project, id } = create('shed', { boundary: clockwise, eaveEdge: 0 });
    const roof = roofOf(project, id);
    expect(ringArea(roof.boundary)).toBeGreaterThan(0);
    const a = roof.boundary[roof.eaveEdge] as Point2;
    const b = roof.boundary[(roof.eaveEdge + 1) % 4] as Point2;
    expect(a.x).toBeCloseTo(0, 12);
    expect(b.x).toBeCloseTo(0, 12);
  });

  it('recusa contornos inválidos, dimensões degeneradas e configurações não suportadas', () => {
    const s = setup();
    const make = (input: Partial<Parameters<typeof addRoof>[1]>) =>
      addRoof(s.project, {
        typeId: s.types.shed as string,
        levelId: s.levelId,
        boundary: RECT,
        slope: percentToSlope(30),
        ...input,
      });
    const code = (result: ReturnType<typeof make>): string | null =>
      result.ok ? null : result.error.code;
    expect(code(make({ boundary: [p(0, 0), p(8, 0), p(8, 6)] }))).toBe('ROOF_BOUNDARY_INVALID');
    // Trapézio: não é retângulo.
    expect(code(make({ boundary: [p(0, 0), p(8, 0), p(7, 6), p(0, 6)] }))).toBe(
      'ROOF_BOUNDARY_INVALID',
    );
    expect(code(make({ boundary: [p(0, 0), p(8, 0), p(8, 0.01), p(0, 0.01)] }))).toBe(
      'ROOF_BOUNDARY_INVALID',
    );
    expect(code(make({ slope: 0 }))).toBe('ROOF_SLOPE_INVALID');
    expect(code(make({ slope: deg(80) }))).toBe('ROOF_SLOPE_INVALID');
    expect(code(make({ overhang: -0.1 }))).toBe('INVALID_VALUE');
    expect(code(make({ typeId: s.types.wall as string }))).toBe('ARCH_TYPE_NOT_FOUND');
    expect(code(make({ levelId: 'inexistente' }))).toBe('LEVEL_NOT_FOUND');
    expect(roofBoundaryProblem([p(0, 0), p(8, 0), p(7, 6), p(0, 6)])).toMatch(/retangular/);
    // Nenhuma recusa altera o projeto.
    expect(s.project.architecture.elements).toHaveLength(0);
  });

  it('edita inclinação, beiral, lado do beiral e contorno preservando o id', () => {
    const { project, id } = create('gable');
    const before = roofQuantities(project.architecture, roofOf(project, id));
    const steeper = updateArchElement(project, id, { slope: deg(30), overhang: 0.8 });
    if (!steeper.ok) throw new Error(steeper.error.message);
    const after = roofQuantities(steeper.value.architecture, roofOf(steeper.value, id));
    expect(after?.projectedArea).toBeCloseTo(9.6 * 7.6, 9);
    expect(after?.slopeArea).toBeCloseTo((9.6 * 7.6) / Math.cos(deg(30)), 9);
    expect(after?.slopeArea).not.toBeCloseTo(before?.slopeArea ?? 0, 3);
    const turned = updateArchElement(steeper.value, id, { eaveEdge: 1 });
    if (!turned.ok) throw new Error(turned.error.message);
    const frame = roofFrame(roofOf(turned.value, id), GABLE as never);
    // A cumeeira passa a ser paralela ao lado de 6 m.
    expect(frame?.length).toBeCloseTo(6, 9);
    expect(frame?.span).toBeCloseTo(8, 9);
    const wider = updateArchElement(turned.value, id, {
      boundary: [p(0, 0), p(10, 0), p(10, 6), p(0, 6)],
    });
    if (!wider.ok) throw new Error(wider.error.message);
    expect(roofOf(wider.value, id).id).toBe(id);
    expect(
      roofQuantities(wider.value.architecture, roofOf(wider.value, id))?.projectedArea,
    ).toBeCloseTo(11.6 * 7.6, 9);
  });

  it('recusa edição inválida sem alteração parcial', () => {
    const { project, id } = create('shed');
    const bad = updateArchElement(project, id, {
      overhang: 1,
      boundary: [p(0, 0), p(8, 0), p(7, 6), p(0, 6)],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('ROOF_BOUNDARY_INVALID');
    expect(roofOf(project, id).overhang).toBe(0.5);
    const flat = updateArchElement(project, id, { slope: 0.0001 });
    expect(flat.ok).toBe(false);
    if (!flat.ok) expect(flat.error.code).toBe('ROOF_SLOPE_INVALID');
    const height = updateArchElement(project, id, { height: 3 });
    expect(height.ok).toBe(false);
    if (!height.ok) expect(height.error.code).toBe('INVALID_ARCH_PATCH');
  });

  it('trocar o tipo troca a tipologia; tipologia e tipo predefinido IFC não se contradizem', () => {
    const { project, id, types } = create('shed');
    const swapped = updateArchElement(project, id, { typeId: types.gable as string });
    if (!swapped.ok) throw new Error(swapped.error.message);
    expect(roofQuantities(swapped.value.architecture, roofOf(swapped.value, id))?.shape).toBe(
      'gable',
    );
    const wrong = updateArchType(project, types.shed as string, { shape: 'gable' } as never);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe('ROOF_TYPE_MISMATCH');
    const right = updateArchType(
      project,
      types.shed as string,
      {
        shape: 'gable',
        ifcPredefinedType: 'GABLE_ROOF',
      } as never,
    );
    expect(right.ok).toBe(true);
    if (right.ok) expect(right.value.affected).toEqual([id]);
  });

  it('move, copia, gira e espelha preservando parâmetros', () => {
    const { project, id } = create('shed', { eaveEdge: 0 });
    const moved = moveArchElements(project, [id], p(2, 1), 0.3);
    if (!moved.ok) throw new Error(moved.error.message);
    const m = roofOf(moved.value, id);
    expect(m.boundary[0]).toEqual({ x: 2, y: 1 });
    expect(m.offset).toBeCloseTo(3.1, 12);

    const copied = copyArchElements(project, [id], p(20, 0));
    if (!copied.ok) throw new Error(copied.error.message);
    const copyId = copied.value.elementIds[0] as string;
    expect(copyId).not.toBe(id);
    expect(roofOf(copied.value.project, copyId).slope).toBe(roofOf(project, id).slope);
    expect(roofOf(copied.value.project, copyId).name).toBe('Telhado 2');

    const rotated = rotateArchElements(project, [id], p(0, 0), Math.PI / 2);
    if (!rotated.ok) throw new Error(rotated.error.message);
    const r = roofOf(rotated.value.project, id);
    expect(roofBoundaryProblem(r.boundary)).toBeNull();
    expect(r.eaveEdge).toBe(0);
    // O lado do beiral (y = 0, de x = 0 a 8) foi para x = 0, de y = 0 a 8.
    expect(r.boundary[1]?.x).toBeCloseTo(0, 9);
    expect(r.boundary[1]?.y).toBeCloseTo(8, 9);

    // Espelho no eixo x = 0: o beiral continua sendo o lado sobre y = 0.
    const mirrored = mirrorArchElements(project, [id], p(0, 0), p(0, 1));
    if (!mirrored.ok) throw new Error(mirrored.error.message);
    const x = roofOf(mirrored.value.project, id);
    expect(ringArea(x.boundary)).toBeGreaterThan(0);
    const a = x.boundary[x.eaveEdge] as Point2;
    const b = x.boundary[(x.eaveEdge + 1) % 4] as Point2;
    expect(a.y).toBeCloseTo(0, 9);
    expect(b.y).toBeCloseTo(0, 9);
    expect(Math.min(a.x, b.x)).toBeCloseTo(-8, 9);
    const before = roofQuantities(project.architecture, roofOf(project, id));
    const after = roofQuantities(mirrored.value.project.architecture, x);
    expect(after?.slopeArea).toBeCloseTo(before?.slopeArea ?? 0, 9);
  });

  it('não assenta no terreno e entra no quantitativo com área inclinada e projeção', () => {
    const { project, id } = create('gable');
    const seated = seatArchElement(project, id, 'design');
    expect(seated.ok).toBe(false);
    if (!seated.ok) expect(seated.error.code).toBe('ARCH_NOT_SEATABLE');
    const rows = computeArchQuantities(project);
    const row = rows.find((item) => item.category === 'Telhados');
    expect(row?.count).toBe(1);
    expect(row?.projectedArea).toBeCloseTo(63, 9);
    expect(row?.grossArea).toBeCloseTo(63 / Math.cos(percentToSlope(30)), 9);
    expect(row?.grossVolume).toBeCloseTo((63 / Math.cos(percentToSlope(30))) * 0.1, 9);
    expect(archQuantitiesToCsv(rows)).toContain('Projeção horizontal (m²)');
  });

  it('salva e reabre preservando parâmetros e ids; migra documentos v17', () => {
    const { project, id } = create('gable', { eaveEdge: 1 });
    const reopened = parseProject(serializeProject(project));
    if (!reopened.ok) throw new Error(reopened.error.message);
    expect(roofOf(reopened.value, id)).toEqual(roofOf(project, id));
    expect(reopened.value.schemaVersion).toBe(SCHEMA_VERSION);
    // Documento da versão anterior, sem telhados: abre com a arquitetura como estava.
    const empty = setup().project;
    const legacy = { ...JSON.parse(serializeProject(empty)), schemaVersion: 17 } as Record<
      string,
      unknown
    >;
    legacy.architecture = { types: [], elements: [] };
    const migrated = parseProjectDocument(legacy);
    if (!migrated.ok) throw new Error(migrated.error.message);
    expect(migrated.value.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.value.architecture.elements).toEqual([]);
  });

  it('respeita a visibilidade da categoria Telhados nas vistas', () => {
    const { project, id, levelId } = create('shed');
    const withView = addView(project, { kind: 'plan', levelId });
    if (!withView.ok) throw new Error(withView.error.message);
    const view = withView.value.project.views[0];
    if (!view) throw new Error('sem vista');
    expect(viewArchElementsOf(withView.value.project, view).map((e) => e.id)).toContain(id);
    const hidden = {
      ...view,
      visibility: { ...view.visibility, hiddenCategories: ['roofs' as const] },
    };
    expect(viewArchElementsOf(withView.value.project, hidden).map((e) => e.id)).not.toContain(id);
  });
});

describe('retângulos: apoio à edição do contorno', () => {
  it('monta o retângulo por três pontos (o terceiro só dá a largura)', () => {
    const ring = rectangleFromThreePoints(p(0, 0), p(4, 0), p(9, 3));
    expect(ring).toEqual([p(0, 0), p(4, 0), p(4, 3), p(0, 3)]);
    expect(rectangleFromThreePoints(p(0, 0), p(0, 0), p(1, 1))).toBeNull();
    expect(rectangleFromThreePoints(p(0, 0), p(4, 0), p(2, 0))).toBeNull();
  });

  it('arrastar um canto mantém o oposto e os ângulos retos, também em retângulo oblíquo', () => {
    const moved = moveRectangleCorner(RECT, 2, p(10, 7));
    expect(moved).toEqual([p(0, 0), p(10, 0), p(10, 7), p(0, 7)]);
    const angle = deg(23);
    const rot = (q: Point2): Point2 => ({
      x: q.x * Math.cos(angle) - q.y * Math.sin(angle),
      y: q.x * Math.sin(angle) + q.y * Math.cos(angle),
    });
    const oblique = moveRectangleCorner(RECT.map(rot), 2, rot(p(9, 5)));
    expect(oblique && roofBoundaryProblem(oblique)).toBeNull();
    expect(oblique?.[2]?.x).toBeCloseTo(rot(p(9, 5)).x, 12);
  });

  it('deslocar um lado mantém o retângulo', () => {
    const moved = moveRectangleEdge(RECT, 2, p(3, 9));
    expect(moved).toEqual([p(0, 0), p(8, 0), p(8, 9), p(0, 9)]);
  });
});

describe('parede: mover a extremidade preserva as hospedagens', () => {
  function wallWithDoor(): { project: Project; wallId: string; doorId: string } {
    const s = setup();
    const walls = addWalls(s.project, {
      typeId: s.types.wall as string,
      levelId: s.levelId,
      points: [p(0, 0), p(6, 0)],
      height: 2.8,
    });
    if (!walls.ok) throw new Error(walls.error.message);
    const wallId = walls.value.elementIds[0] as string;
    const door = addHosted(walls.value.project, {
      kind: 'door',
      typeId: s.types.door as string,
      hostId: wallId,
      at: 2,
    });
    if (!door.ok) throw new Error(door.error.message);
    return { project: door.value.project, wallId, doorId: door.value.elementIds[0] as string };
  }
  const wallOf = (project: Project, id: string): Wall => {
    const wall = getArchElement(project.architecture, id);
    if (wall?.kind !== 'wall') throw new Error('não é parede');
    return wall;
  };
  const doorCentre = (project: Project, wallId: string, doorId: string): Point2 => {
    const wall = wallOf(project, wallId);
    const door = getArchElement(project.architecture, doorId);
    if (door?.kind !== 'door') throw new Error('não é porta');
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    return {
      x: wall.start.x + ((wall.end.x - wall.start.x) / length) * door.offset,
      y: wall.start.y + ((wall.end.y - wall.start.y) / length) * door.offset,
    };
  };

  it('mover o fim não desloca a porta', () => {
    const { project, wallId, doorId } = wallWithDoor();
    const moved = moveWallEndpoint(project, wallId, 'end', p(9, 0));
    if (!moved.ok) throw new Error(moved.error.message);
    expect(doorCentre(moved.value, wallId, doorId)).toEqual(p(2, 0));
    expect(wallOf(moved.value, wallId).id).toBe(wallId);
  });

  it('mover o início mantém a porta no lugar (a distância gravada é corrigida)', () => {
    const { project, wallId, doorId } = wallWithDoor();
    const moved = moveWallEndpoint(project, wallId, 'start', p(-3, 0));
    if (!moved.ok) throw new Error(moved.error.message);
    const centre = doorCentre(moved.value, wallId, doorId);
    expect(centre.x).toBeCloseTo(2, 9);
    expect(centre.y).toBeCloseTo(0, 9);
    expect(getArchElement(moved.value.architecture, doorId)?.id).toBe(doorId);
    expect(wallOpenings(moved.value.architecture, wallOf(moved.value, wallId))).toHaveLength(1);
    expect(validateProject(moved.value).filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('recusa por inteiro quando a porta deixaria de caber', () => {
    const { project, wallId } = wallWithDoor();
    const moved = moveWallEndpoint(project, wallId, 'start', p(2, 0));
    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.error.code).toBe('OPENING_DOES_NOT_FIT');
    const tooShort = moveWallEndpoint(project, wallId, 'end', p(0.01, 0));
    expect(tooShort.ok).toBe(false);
    expect(wallOf(project, wallId).end).toEqual(p(6, 0));
    expect(moveWallEndpoint(project, 'nada', 'end', p(1, 1)).ok).toBe(false);
  });
});
