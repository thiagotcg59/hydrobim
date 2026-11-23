import { archTypeFromFamily, getArchFamily } from '@hydrobim/catalog';
import {
  addArchType,
  addLevel,
  createProject,
  getArchElement,
  parseProject,
  percentToSlope,
  roofQuantities,
  serializeProject,
  validateProject,
  type ArchElement,
  type Point2,
  type Roof,
  type Wall,
} from '@hydrobim/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { commandContext, commandState, getCommand, runCommand } from '../commands/commands';
import { setPolarLockHeld } from '../editor/polarLock';
import { ALL_SNAPS_ON } from '../editor/planSnaps';
import { useEditorStore } from '../state/editorStore';
import { useSnapStore } from '../state/snapStore';
import { useUiStore } from '../state/uiStore';
import { useViewStore } from '../views/viewStore';
import {
  changedArchElements,
  contourOf,
  gripKey,
  insertContourVertex,
  moveContourVertex,
  parseGripKey,
  removeContourVertex,
  sweepAngle,
  transformOutcome,
} from './archEdit';
import { useArchStore } from './archStore';

const editor = () => useEditorStore.getState();
const arch = () => useArchStore.getState();
const elements = (): ArchElement[] => editor().project.architecture.elements;
const walls = (): Wall[] => elements().filter((e): e is Wall => e.kind === 'wall');
const roofs = (): Roof[] => elements().filter((e): e is Roof => e.kind === 'roof');
const p = (x: number, y: number): Point2 => ({ x, y });
const deg = (value: number): number => (value * Math.PI) / 180;
/** Raio de captura de 10 px a 1 cm por pixel. */
const TOLERANCE = 0.1;

const FAMILIES = {
  wall: 'arq-parede-alvenaria-ceramica',
  slab: 'arq-laje-concreto',
  door: 'arq-porta-giro-1',
  shed: 'arq-telhado-uma-agua',
  gable: 'arq-telhado-duas-aguas',
} as const;

function load(): Record<keyof typeof FAMILIES, string> {
  let project = createProject('Edição', 'architecture');
  const ids = {} as Record<keyof typeof FAMILIES, string>;
  for (const key of Object.keys(FAMILIES) as (keyof typeof FAMILIES)[]) {
    const family = getArchFamily(FAMILIES[key]);
    if (!family) throw new Error(`família ausente: ${FAMILIES[key]}`);
    const added = addArchType(project, archTypeFromFamily(family, `Tipo ${key}`));
    if (!added.ok) throw new Error(added.error.message);
    project = added.value.project;
    ids[key] = added.value.typeId;
  }
  editor().loadProject(project);
  return ids;
}

/** Clique na planta como a vista o faz: resolve a captura e confirma o ponto resolvido. */
function click(raw: Point2): Point2 {
  const point = arch().resolvePointer(raw, TOLERANCE).point;
  arch().clickPoint(point, TOLERANCE);
  return point;
}

const angleBetween = (u: Point2, v: Point2): number =>
  Math.atan2(Math.abs(u.x * v.y - u.y * v.x), u.x * v.x + u.y * v.y);
const vectorOf = (wall: Wall): Point2 => p(wall.end.x - wall.start.x, wall.end.y - wall.start.y);

beforeEach(() => {
  editor().loadProject(createProject('Vazio', 'architecture'));
  editor().setSnapToGrid(false);
  setPolarLockHeld(false);
  useViewStore.setState({ open2d: null, open3d: null, tool: 'select', draft: [] });
  useUiStore.getState().setTask('model');
  useSnapStore.setState({ snaps: ALL_SNAPS_ON, activeLevelOnly: true });
  // Os testes desenham em traçado contínuo; a parede por dois cliques tem teste próprio.
  useArchStore.getState().setOptions({ chain: true, closed: false });
  useArchStore.setState({
    tool: null,
    points: [],
    cursor: null,
    selection: [],
    activeTypes: {},
    transform: null,
    contour: null,
    contourDrag: null,
    grip: null,
    snap: null,
    snapCycle: 0,
    reference: null,
  });
});

describe('capturas ao desenhar paredes', () => {
  it('parede a 23° e a seguinte a 90° dela: o modelo gravado é perpendicular', () => {
    load();
    arch().setTool('wall');
    const end = p(5 * Math.cos(deg(23)), 5 * Math.sin(deg(23)));
    click(p(0, 0));
    click(end);
    // Cursor a ~3 m na perpendicular, alguns centímetros fora dela.
    const normal = p(-Math.sin(deg(23)), Math.cos(deg(23)));
    const along = p(Math.cos(deg(23)), Math.sin(deg(23)));
    const raw = p(end.x + normal.x * 3 + along.x * 0.04, end.y + normal.y * 3 + along.y * 0.04);
    const preview = arch().resolvePointer(raw, TOLERANCE);
    expect(preview.kind).toBe('perpendicularPrevious');
    expect(preview.label).toBe('Perpendicular ao trecho anterior · 90°');
    // O clique usa o mesmo ponto da prévia.
    expect(click(raw)).toEqual(preview.point);
    expect(arch().finish()).toBe(true);
    const [first, second] = walls();
    if (!first || !second) throw new Error('paredes ausentes');
    expect(Math.abs(angleBetween(vectorOf(first), vectorOf(second)) - Math.PI / 2)).toBeLessThan(
      1e-9,
    );
    expect((Math.atan2(vectorOf(first).y, vectorOf(first).x) * 180) / Math.PI).toBeCloseTo(23, 9);
    expect(validateProject(editor().project).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('entrada numérica segue a direção capturada e mantém o valor digitado', () => {
    load();
    arch().setTool('wall');
    const end = p(5 * Math.cos(deg(23)), 5 * Math.sin(deg(23)));
    click(p(0, 0));
    click(end);
    const normal = p(-Math.sin(deg(23)), Math.cos(deg(23)));
    arch().resolvePointer(p(end.x + normal.x * 2 + 0.03, end.y + normal.y * 2), TOLERANCE);
    // Grade ligada: o valor digitado não é arredondado por ela.
    editor().setSnapToGrid(true);
    expect(arch().submitEntry('2,137')).toBe(true);
    arch().finish();
    const second = walls()[1];
    if (!second) throw new Error('parede ausente');
    expect(Math.hypot(vectorOf(second).x, vectorOf(second).y)).toBeCloseTo(2.137, 12);
    expect(Math.abs(angleBetween(vectorOf(second), p(end.x, end.y)) - Math.PI / 2)).toBeLessThan(
      1e-9,
    );
    // Entrada polar e relativa também são exatas.
    arch().setTool('wall');
    click(p(20, 0));
    expect(arch().submitEntry('4<30')).toBe(true);
    expect(arch().points[1]?.x).toBeCloseTo(20 + 4 * Math.cos(deg(30)), 12);
    expect(arch().submitEntry('@1;-2')).toBe(true);
    expect(arch().points[2]?.y).toBeCloseTo(4 * Math.sin(deg(30)) - 2, 12);
  });

  it('aresta de referência: apontar a parede oblíqua e sair perpendicular a ela de outro ponto', () => {
    load();
    arch().setTool('wall');
    const end = p(5 * Math.cos(deg(23)), 5 * Math.sin(deg(23)));
    click(p(0, 0));
    click(end);
    arch().finish();
    const oblique = walls()[0];
    if (!oblique) throw new Error('parede ausente');
    // Novo traçado longe da parede; o cursor passa sobre ela e a toma como referência.
    arch().clickPoint(p(10, 0));
    arch().resolvePointer(p(2.5 * Math.cos(deg(23)), 2.5 * Math.sin(deg(23)) + 0.01), TOLERANCE);
    expect(arch().reference?.segment.sourceId).toBe(oblique.id);
    arch().pinReference();
    expect(arch().reference?.pinned).toBe(true);
    const normal = p(-Math.sin(deg(23)), Math.cos(deg(23)));
    const snap = arch().resolvePointer(p(10 + normal.x * 2 + 0.02, normal.y * 2), TOLERANCE);
    expect(snap.kind).toBe('perpendicularReference');
    const drawn = p(snap.point.x - 10, snap.point.y);
    expect(Math.abs(angleBetween(drawn, vectorOf(oblique)) - Math.PI / 2)).toBeLessThan(1e-9);
    // R fora de qualquer aresta solta a referência fixada.
    arch().resolvePointer(p(30, 30), TOLERANCE);
    arch().pinReference();
    expect(arch().reference).toBeNull();
  });

  it('Shift trava de 45° em 45° e a captura acompanha a tecla com o cursor parado', () => {
    load();
    arch().setTool('wall');
    click(p(0, 0));
    const raw = p(3, 1.1);
    expect(arch().resolvePointer(raw, TOLERANCE).kind).toBe('free');
    setPolarLockHeld(true);
    // Mesma posição do cursor: só a tecla mudou.
    const locked = arch().refreshPointer();
    expect(locked?.kind).toBe('polar');
    expect(locked?.point.y).toBe(0);
    setPolarLockHeld(false);
    expect(arch().refreshPointer()?.kind).toBe('free');
  });

  it('Tab alterna entre capturas sobrepostas e o clique usa a escolhida', () => {
    load();
    arch().setTool('wall');
    click(p(0, 0));
    click(p(4, 0));
    arch().finish();
    arch().setTool('wall');
    arch().clickPoint(p(2, 3));
    // Junto à extremidade (4, 0): extremidades da face e do eixo a poucos centímetros.
    const raw = p(4.02, 0.02);
    const first = arch().resolvePointer(raw, TOLERANCE);
    expect(first.count).toBeGreaterThan(1);
    arch().cycleSnap(1);
    const second = arch().snap;
    expect(second?.index).toBe(1);
    expect(second?.point).not.toEqual(first.point);
    // A prévia e a confirmação dão o mesmo ponto.
    expect(arch().resolvePointer(raw, TOLERANCE).point).toEqual(second?.point);
    // Ao mover o cursor para longe, a escolha manual é esquecida.
    expect(arch().resolvePointer(p(9, 9), TOLERANCE).index).toBe(0);
  });

  it('respeita o nível do plano de trabalho e as capturas desligadas', () => {
    load();
    const upper = addLevel(editor().project, 'Superior', 3);
    if (!upper.ok) throw new Error(upper.error.message);
    editor().loadProject(upper.value);
    arch().setTool('wall');
    click(p(0, 0));
    click(p(4, 0));
    arch().finish();
    // No nível de cima, a parede do térreo não é capturada.
    editor().setWorkPlaneZ(3);
    arch().setTool('wall');
    expect(arch().resolvePointer(p(4.02, 0.02), TOLERANCE).kind).toBe('free');
    // Com todos os níveis sobrepostos, volta a ser.
    useSnapStore.getState().setActiveLevelOnly(false);
    expect(arch().resolvePointer(p(4.02, 0.02), TOLERANCE).kind).toBe('endpoint');
    useSnapStore.getState().setSnap('endpoint', false);
    expect(arch().resolvePointer(p(4.02, 0.02), TOLERANCE).kind).not.toBe('endpoint');
  });
});

describe('telhados pela ferramenta', () => {
  it('três cliques criam o telhado retangular, com o primeiro lado como beiral', () => {
    const types = load();
    expect(runCommand('arch.roof')).toBe(true);
    expect(arch().tool).toBe('roof');
    arch().setActiveType('roof', types.gable);
    arch().setOptions({ roofSlope: percentToSlope(40), roofOverhang: 0.6, roofOffset: 3 });
    const before = editor().past.length;
    click(p(0, 0));
    click(p(8, 0));
    expect(roofs()).toHaveLength(0);
    // O terceiro ponto só dá a largura: não precisa estar em esquadro.
    arch().clickPoint(p(5.3, 6));
    const roof = roofs()[0];
    if (!roof) throw new Error('telhado ausente');
    expect(editor().past.length).toBe(before + 1);
    expect(roof.boundary).toEqual([p(0, 0), p(8, 0), p(8, 6), p(0, 6)]);
    expect(roof.eaveEdge).toBe(0);
    expect(roof.offset).toBe(3);
    expect(roof.overhang).toBe(0.6);
    expect(roof.slope).toBeCloseTo(percentToSlope(40), 12);
    expect(arch().selection).toEqual([roof.id]);
    expect(arch().points).toEqual([]);
    expect(validateProject(editor().project).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('largura digitada vai para o lado do cursor; contorno oblíquo é aceito', () => {
    const types = load();
    arch().setTool('roof');
    arch().setActiveType('roof', types.shed);
    arch().setOptions({ roofOverhang: 0.5 });
    const end = p(6 * Math.cos(deg(23)), 6 * Math.sin(deg(23)));
    arch().clickPoint(p(0, 0));
    arch().clickPoint(end);
    arch().setCursor(p(end.x - 3, end.y + 3));
    expect(arch().submitEntry('4')).toBe(true);
    const roof = roofs()[0];
    if (!roof) throw new Error('telhado ausente');
    const q = roofQuantities(editor().project.architecture, roof);
    expect(q?.projectedArea).toBeCloseTo((6 + 1) * (4 + 1), 9);
    expect(q?.shape).toBe('shed');
  });

  it('terceiro ponto sobre a reta do beiral é recusado e o lado continua indicado', () => {
    load();
    arch().setTool('roof');
    arch().clickPoint(p(0, 0));
    arch().clickPoint(p(8, 0));
    arch().clickPoint(p(12, 0));
    expect(roofs()).toHaveLength(0);
    expect(arch().points).toHaveLength(2);
    expect(editor().message?.level).toBe('error');
  });

  it('edita inclinação, beiral e lado do beiral; salva, reabre, desfaz e refaz com o mesmo id', () => {
    load();
    arch().setTool('roof');
    arch().clickPoint(p(0, 0));
    arch().clickPoint(p(8, 0));
    arch().clickPoint(p(8, 6));
    arch().setTool(null);
    const id = roofs()[0]?.id ?? '';
    const area = (): number =>
      roofQuantities(editor().project.architecture, roofs()[0] as Roof)?.slopeArea ?? 0;
    const initial = area();
    expect(arch().update(id, { slope: percentToSlope(60), overhang: 1 })).toBe(true);
    expect(area()).toBeCloseTo((10 * 8) / Math.cos(percentToSlope(60)), 9);
    expect(arch().update(id, { eaveEdge: 1 })).toBe(true);
    expect(arch().update(id, { slope: 0 })).toBe(false);
    expect(roofs()[0]?.eaveEdge).toBe(1);
    const reopened = parseProject(serializeProject(editor().project));
    if (!reopened.ok) throw new Error(reopened.error.message);
    expect(getArchElement(reopened.value.architecture, id)).toEqual(roofs()[0]);
    editor().undo();
    editor().undo();
    expect(roofs()[0]?.id).toBe(id);
    expect(area()).toBeCloseTo(initial, 9);
    editor().redo();
    editor().redo();
    expect(roofs()[0]?.eaveEdge).toBe(1);
  });
});

function twoWallsWithDoor(): { wallId: string; doorId: string } {
  const types = load();
  arch().setTool('wall');
  arch().clickPoint(p(0, 0));
  arch().clickPoint(p(6, 0));
  arch().finish();
  arch().setActiveType('door', types.door);
  arch().setTool('door');
  arch().clickPoint(p(2, 0), 0.1);
  arch().setTool(null);
  const wallId = walls()[0]?.id ?? '';
  const doorId = elements().find((e) => e.kind === 'door')?.id ?? '';
  return { wallId, doorId };
}

describe('mover, copiar, girar e espelhar por pontos', () => {
  it('a prévia é o resultado da confirmação; um passo no histórico; Esc não altera o modelo', () => {
    const { wallId } = twoWallsWithDoor();
    arch().select(wallId);
    expect(commandState(getCommand('arch.move'), commandContext()).enabled).toBe(true);
    runCommand('arch.move');
    expect(arch().transform?.kind).toBe('move');
    const before = editor().project;
    const history = editor().past.length;
    click(p(0, 0));
    // Prévia: mesma operação, sem tocar no projeto.
    const cursor = arch().resolvePointer(p(1.5, 2.5), TOLERANCE).point;
    const transform = arch().transform;
    if (!transform) throw new Error('sem operação');
    const preview = transformOutcome(before, [wallId], transform, cursor);
    expect(preview?.ok).toBe(true);
    expect(editor().project).toBe(before);
    // Esc volta um ponto; outro Esc encerra — nada foi alterado.
    expect(arch().cancel()).toBe(true);
    expect(arch().transform?.points).toHaveLength(0);
    expect(arch().cancel()).toBe(true);
    expect(arch().transform).toBeNull();
    expect(editor().project).toBe(before);
    expect(editor().past.length).toBe(history);

    arch().startTransform('move');
    click(p(0, 0));
    click(p(1.5, 2.5));
    expect(arch().transform).toBeNull();
    expect(editor().past.length).toBe(history + 1);
    if (!preview?.ok) throw new Error('prévia recusada');
    // O que foi gravado é o que a prévia mostrou (parede e porta hospedada).
    const moved = changedArchElements(before, editor().project).map((e) => e.id);
    expect(moved.sort()).toEqual(
      changedArchElements(before, preview.value.project)
        .map((e) => e.id)
        .sort(),
    );
    expect(walls()[0]?.start).toEqual(p(1.5, 2.5));
    expect(walls()[0]?.id).toBe(wallId);
  });

  it('copiar cria novos elementos e os seleciona; girar pelo ângulo digitado; espelhar com cópia', () => {
    const { wallId } = twoWallsWithDoor();
    arch().select(wallId);
    arch().startTransform('copy');
    click(p(0, 0));
    click(p(0, 4));
    expect(walls()).toHaveLength(2);
    expect(arch().selection).not.toContain(wallId);
    expect(arch().selection).toHaveLength(2);

    arch().select(wallId);
    arch().startTransform('rotate');
    click(p(0, 0));
    expect(arch().submitEntry('90')).toBe(true);
    const rotated = getArchElement(editor().project.architecture, wallId);
    expect(rotated?.kind === 'wall' && rotated.end.x).toBeCloseTo(0, 9);
    expect(rotated?.kind === 'wall' && rotated.end.y).toBeCloseTo(6, 9);

    arch().startTransform('rotate');
    click(p(0, 0));
    click(p(0, 5));
    click(p(-5, 0));
    const again = getArchElement(editor().project.architecture, wallId);
    expect(again?.kind === 'wall' && again.end.x).toBeCloseTo(-6, 9);
    expect(sweepAngle(p(0, 0), p(0, 5), p(-5, 0))).toBeCloseTo(Math.PI / 2, 12);

    const count = walls().length;
    arch().startTransform('mirror', true);
    click(p(0, -1));
    click(p(0, 7));
    expect(walls()).toHaveLength(count + 1);
    expect(getArchElement(editor().project.architecture, wallId)).toBe(again);
  });

  it('operação recusada pelo núcleo não grava nada e a operação continua', () => {
    const { doorId } = twoWallsWithDoor();
    arch().select(doorId);
    arch().startTransform('move');
    const before = editor().project;
    click(p(2, 0));
    // A porta só desliza na parede: 10 m a tiraria do trecho livre.
    arch().clickPoint(p(12, 0));
    expect(editor().project).toBe(before);
    expect(editor().message?.level).toBe('error');
    expect(arch().transform?.points).toHaveLength(1);
  });
});

describe('alças', () => {
  it('extremidade de parede: prévia, um passo e a porta hospedada no lugar', () => {
    const { wallId, doorId } = twoWallsWithDoor();
    arch().select(wallId);
    const before = editor().project;
    const history = editor().past.length;
    const grip = parseGripKey(gripKey({ kind: 'wallEnd', elementId: wallId, end: 'start' }));
    if (!grip) throw new Error('alça inválida');
    arch().beginGrip(grip);
    // O arrasto segue o alinhamento original da parede (paralela ao trecho).
    const snap = arch().resolvePointer(p(-2.5, 0.03), TOLERANCE);
    expect(snap.point.y).toBe(0);
    arch().dragTo(snap.point);
    expect(editor().project).toBe(before);
    arch().endDrag(true);
    expect(editor().past.length).toBe(history + 1);
    const wall = walls()[0];
    const door = getArchElement(editor().project.architecture, doorId);
    if (!wall || door?.kind !== 'door') throw new Error('elementos ausentes');
    expect(wall.id).toBe(wallId);
    expect(wall.start).toEqual(p(-2.5, 0));
    // A porta estava em x = 2: continua lá (a distância ao início foi corrigida).
    expect(wall.start.x + door.offset).toBeCloseTo(2, 9);
    expect(door.id).toBe(doorId);
  });

  it('arrasto recusado (a porta não caberia) ou cancelado não altera o modelo', () => {
    const { wallId } = twoWallsWithDoor();
    const before = editor().project;
    arch().beginGrip({ kind: 'wallEnd', elementId: wallId, end: 'start' });
    arch().dragTo(p(2.2, 0));
    arch().endDrag(true);
    expect(editor().project).toBe(before);
    expect(editor().message?.level).toBe('error');
    arch().beginGrip({ kind: 'wallEnd', elementId: wallId, end: 'end' });
    arch().dragTo(p(9, 0));
    expect(arch().cancel()).toBe(true);
    expect(arch().grip).toBeNull();
    expect(editor().project).toBe(before);
  });

  it('canto de telhado: o oposto fica e o contorno continua retangular', () => {
    load();
    arch().setTool('roof');
    arch().clickPoint(p(0, 0));
    arch().clickPoint(p(8, 0));
    arch().clickPoint(p(8, 6));
    arch().setTool(null);
    const id = roofs()[0]?.id ?? '';
    arch().beginGrip({ kind: 'roofCorner', elementId: id, index: 2 });
    arch().dragTo(p(10, 7));
    arch().endDrag(true);
    expect(roofs()[0]?.boundary).toEqual([p(0, 0), p(10, 0), p(10, 7), p(0, 7)]);
    expect(roofs()[0]?.id).toBe(id);
  });
});

describe('editar contorno', () => {
  function withSlab(): string {
    load();
    arch().setTool('slab');
    for (const point of [p(0, 0), p(6, 0), p(6, 4), p(0, 4)]) arch().clickPoint(point);
    arch().finish();
    arch().setTool(null);
    return elements().find((e) => e.kind === 'slab')?.id ?? '';
  }
  const slab = (id: string) => {
    const element = getArchElement(editor().project.architecture, id);
    if (element?.kind !== 'slab') throw new Error('laje ausente');
    return element;
  };

  it('Concluir grava em um único passo; os estados intermediários não entram no histórico', () => {
    const id = withSlab();
    arch().select(id);
    expect(runCommand('arch.editContour')).toBe(true);
    expect(arch().contour?.ring).toHaveLength(4);
    const before = editor().project;
    const history = editor().past.length;
    // Novo vértice no meio do lado de baixo, arrastado para fora.
    arch().insertContourVertex(0);
    arch().beginContourDrag(1);
    arch().dragTo(p(3, -1.5));
    arch().endDrag(true);
    // Um vértice movido duas vezes: nada disso foi gravado ainda.
    arch().beginContourDrag(2);
    arch().dragTo(p(7, 0));
    arch().endDrag(true);
    expect(editor().project).toBe(before);
    expect(editor().past.length).toBe(history);
    expect(arch().finishContour()).toBe(true);
    expect(arch().contour).toBeNull();
    expect(editor().past.length).toBe(history + 1);
    expect(slab(id).boundary).toEqual([p(0, 0), p(3, -1.5), p(7, 0), p(6, 4), p(0, 4)]);
    editor().undo();
    expect(slab(id).boundary).toHaveLength(4);
    expect(slab(id).id).toBe(id);
  });

  it('Cancelar (ou Esc) não altera o modelo', () => {
    const id = withSlab();
    arch().beginContour(id);
    const before = editor().project;
    arch().beginContourDrag(0);
    arch().dragTo(p(-3, -3));
    arch().endDrag(true);
    expect(arch().cancel()).toBe(true);
    expect(arch().contour).toBeNull();
    expect(editor().project).toBe(before);
    arch().beginContour(id);
    arch().cancelContour();
    expect(editor().project).toBe(before);
  });

  it('contorno inválido não é gravado: a edição continua, com o motivo', () => {
    const id = withSlab();
    arch().beginContour(id);
    const before = editor().project;
    // Leva o canto (6, 4) para além do lado oposto: o contorno se cruza.
    arch().beginContourDrag(2);
    arch().dragTo(p(-2, 2));
    arch().endDrag(true);
    arch().beginContourDrag(3);
    arch().dragTo(p(8, 2));
    arch().endDrag(true);
    expect(arch().finishContour()).toBe(false);
    expect(arch().contour).not.toBeNull();
    expect(editor().project).toBe(before);
    expect(editor().message?.level).toBe('error');
    // Esc durante o arrasto devolve o vértice.
    const ring = arch().contour?.ring;
    arch().beginContourDrag(0);
    arch().dragTo(p(50, 50));
    arch().cancel();
    expect(arch().contour?.ring).toEqual(ring);
  });

  it('vértices: inserir, mover e remover; o telhado continua retangular', () => {
    const id = withSlab();
    const contour = contourOf(slab(id));
    if (!contour) throw new Error('sem contorno');
    const inserted = insertContourVertex(contour, 1);
    expect(inserted.ring).toHaveLength(5);
    expect(inserted.ring[2]).toEqual(p(6, 2));
    expect(removeContourVertex(inserted, 2).ring).toEqual(contour.ring);
    const triangle = removeContourVertex(contour, 0);
    expect(removeContourVertex(triangle, 0)).toBe(triangle);
    expect(moveContourVertex(contour, 0, p(-1, -1)).ring[0]).toEqual(p(-1, -1));

    arch().setTool('roof');
    arch().clickPoint(p(10, 0));
    arch().clickPoint(p(18, 0));
    arch().clickPoint(p(18, 6));
    arch().setTool(null);
    const roof = contourOf(roofs()[0]);
    if (!roof) throw new Error('sem contorno de telhado');
    expect(roof.rectangular).toBe(true);
    expect(insertContourVertex(roof, 0)).toBe(roof);
    expect(removeContourVertex(roof, 0)).toBe(roof);
    expect(moveContourVertex(roof, 2, p(20, 8)).ring).toEqual([
      p(10, 0),
      p(20, 0),
      p(20, 8),
      p(10, 8),
    ]);
    expect(contourOf(walls()[0])).toBeNull();
  });
});
