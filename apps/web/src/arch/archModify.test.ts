import { archTypeFromFamily, getArchFamily } from '@hydrobim/catalog';
import {
  addArchType,
  createProject,
  validateProject,
  type ArchElement,
  type Point2,
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
import { changedArchElements } from './archEdit';
import { ARCH_MODIFIES, modifyOutcome } from './archModify';
import { archBusy, useArchStore } from './archStore';

const editor = () => useEditorStore.getState();
const arch = () => useArchStore.getState();
const elements = (): ArchElement[] => editor().project.architecture.elements;
const walls = (): Wall[] => elements().filter((e): e is Wall => e.kind === 'wall');
const wall = (id: string): Wall => {
  const found = walls().find((item) => item.id === id);
  if (!found) throw new Error('parede esperada');
  return found;
};
const p = (x: number, y: number): Point2 => ({ x, y });
/** Raio de captura de 10 px a 1 cm por pixel. */
const TOLERANCE = 0.1;

const FAMILIES = {
  wall: 'arq-parede-alvenaria-ceramica',
  slab: 'arq-laje-concreto',
  door: 'arq-porta-giro-1',
} as const;

function load(): Record<keyof typeof FAMILIES, string> {
  let project = createProject('Modificar', 'architecture');
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

/** Traça paredes pela ferramenta e devolve os identificadores criados, na ordem. */
function drawWalls(points: Point2[], closed = false): string[] {
  const before = new Set(walls().map((item) => item.id));
  arch().setTool('wall');
  for (const point of points) arch().clickPoint(point);
  arch().finish(closed);
  arch().setTool(null);
  return walls()
    .filter((item) => !before.has(item.id))
    .map((item) => item.id);
}

/** Cursor e clique como a planta os faz: a sessão resolve o que está indicado. */
const hover = (raw: Point2): Point2 => arch().pointModify(raw, TOLERANCE);
function click(raw: Point2): void {
  arch().clickPoint(hover(raw), TOLERANCE);
}

const near = (actual: Point2, x: number, y: number): void => {
  expect(actual.x).toBeCloseTo(x, 6);
  expect(actual.y).toBeCloseTo(y, 6);
};

beforeEach(() => {
  editor().loadProject(createProject('Vazio', 'architecture'));
  editor().setSnapToGrid(false);
  setPolarLockHeld(false);
  useViewStore.setState({ open2d: null, open3d: null, tool: 'select', draft: [] });
  useUiStore.getState().setTask('model');
  useSnapStore.setState({ snaps: ALL_SNAPS_ON, activeLevelOnly: true });
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
    modify: null,
    modifyHover: null,
    modifyCycle: 0,
    modifyCycleAt: null,
  });
});

describe('aparar/estender para canto na planta', () => {
  it('dois cliques levam as paredes ao canto: prévia igual ao gravado, um passo, ferramenta ativa', () => {
    load();
    const [left = ''] = drawWalls([p(0, 0), p(0, 3.5)]);
    const [top = ''] = drawWalls([p(1, 4), p(5, 4)]);
    expect(commandState(getCommand('arch.trimCorner'), commandContext()).enabled).toBe(true);
    runCommand('arch.trimCorner');
    expect(arch().modify?.kind).toBe('trimCorner');
    expect(archBusy(arch())).toBe(true);
    expect(commandState(getCommand('arch.trimCorner'), commandContext()).active).toBe(true);
    expect(editor().viewMode).toBe('plan');

    const before = editor().project;
    const history = editor().past.length;
    // Clique fora de qualquer parede: nada é indicado.
    click(p(8, 8));
    expect(arch().modify?.picks).toHaveLength(0);

    hover(p(0, 2));
    expect(arch().modifyHover?.elementId).toBe(left);
    click(p(0, 2));
    expect(arch().modify?.picks.map((pick) => pick.elementId)).toEqual([left]);

    // Prévia: a mesma operação, sem tocar no projeto.
    hover(p(3, 4));
    const modify = arch().modify;
    const hovered = arch().modifyHover;
    if (!modify || !hovered) throw new Error('sem prévia');
    const preview = modifyOutcome(before, modify, hovered);
    if (!preview?.ok) throw new Error('prévia recusada');
    expect(editor().project).toBe(before);
    expect(editor().past.length).toBe(history);

    click(p(3, 4));
    expect(editor().past.length).toBe(history + 1);
    near(wall(left).end, 0, 4);
    near(wall(top).start, 0, 4);
    near(wall(top).end, 5, 4);
    expect(
      changedArchElements(before, editor().project)
        .map((element) => element.id)
        .sort(),
    ).toEqual(
      changedArchElements(before, preview.value.project)
        .map((element) => element.id)
        .sort(),
    );
    expect(editor().message?.text).toContain('levadas ao canto');
    expect(validateProject(editor().project)).toEqual([]);
    // Continua ativa, sem cliques pendentes; Esc encerra.
    expect(arch().modify).toEqual({ kind: 'trimCorner', picks: [] });
    expect(arch().cancel()).toBe(true);
    expect(arch().modify).toBeNull();

    editor().undo();
    near(wall(left).end, 0, 3.5);
    near(wall(top).start, 1, 4);
  });

  it('recusa do núcleo não grava e mantém o clique; Esc volta um clique', () => {
    load();
    const [first = ''] = drawWalls([p(0, 0), p(4, 0)]);
    drawWalls([p(0, 2), p(4, 2)]);
    arch().startModify('trimCorner');
    click(p(1, 0));
    const before = editor().project;
    click(p(1, 2));
    expect(editor().project).toBe(before);
    expect(editor().message?.level).toBe('error');
    expect(editor().message?.text).toContain('paralelas');
    expect(arch().modify?.picks.map((pick) => pick.elementId)).toEqual([first]);
    expect(arch().cancel()).toBe(true);
    expect(arch().modify?.picks).toHaveLength(0);
    expect(arch().cancel()).toBe(true);
    expect(arch().modify).toBeNull();
    expect(editor().project).toBe(before);
  });
});

describe('aparar/estender até parede, alinhar e dividir na planta', () => {
  it('estender até a parede-limite: só a segunda muda', () => {
    load();
    const [limit = ''] = drawWalls([p(0, 0), p(0, 4)]);
    const [target = ''] = drawWalls([p(1, 2), p(4, 2)]);
    const limitBefore = wall(limit);
    runCommand('arch.trimExtend');
    click(p(0, 1));
    click(p(3, 2));
    near(wall(target).start, 0, 2);
    near(wall(target).end, 4, 2);
    expect(wall(limit)).toBe(limitBefore);
    expect(editor().message?.text).toContain('levada até');
  });

  it('alinhar: aresta de referência de uma laje e eixo da parede, que leva os cantos', () => {
    const types = load();
    const [bottom = '', right = '', top = ''] = drawWalls(
      [p(0, 0), p(5, 0), p(5, 4), p(0, 4)],
      true,
    );
    arch().setActiveType('slab', types.slab);
    arch().setTool('slab');
    for (const point of [p(6, 0), p(9, 0), p(9, 4), p(6, 4)]) arch().clickPoint(point);
    arch().finish(true);
    arch().setTool(null);
    const slabId = elements().find((element) => element.kind === 'slab')?.id ?? '';

    runCommand('arch.align');
    hover(p(6, 2));
    expect(arch().modifyHover?.elementId).toBe(slabId);
    expect(arch().modifyHover?.segment?.role).toBe('edge');
    click(p(6, 2));
    // A segunda aresta é de outro elemento: a da própria referência não é indicada.
    hover(p(6, 2.5));
    expect(arch().modifyHover).toBeNull();
    hover(p(5, 2));
    expect(arch().modifyHover?.elementId).toBe(right);
    expect(arch().modifyHover?.segment?.role).toBe('axis');
    click(p(5, 2));
    near(wall(right).start, 6, 0);
    near(wall(right).end, 6, 4);
    near(wall(bottom).end, 6, 0);
    near(wall(top).start, 6, 4);
    expect(editor().message?.text).toContain('alinhada');
    expect(validateProject(editor().project)).toEqual([]);

    // Aresta não paralela à referência: recusada, com o motivo; a referência continua indicada.
    click(p(9, 2));
    const before = editor().project;
    click(p(3, 0));
    expect(editor().project).toBe(before);
    expect(editor().message?.text).toContain('não é paralela');
    expect(arch().modify?.picks).toHaveLength(1);
  });

  it('alinhar: aresta de laje sobre o eixo da parede — a parede vem primeiro e Tab alterna', () => {
    const types = load();
    const [, right = ''] = drawWalls([p(0, 0), p(5, 0), p(5, 4), p(0, 4)], true);
    arch().setActiveType('slab', types.slab);
    arch().setTool('slab');
    for (const point of [p(0, 0), p(5, 0), p(5, 4), p(0, 4)]) arch().clickPoint(point);
    arch().finish(true);
    arch().setTool(null);
    const slabId = elements().find((element) => element.kind === 'slab')?.id ?? '';

    arch().startModify('align');
    hover(p(5, 2));
    const first = arch().modifyHover;
    expect(first?.elementId).toBe(right);
    expect(first?.segment?.role).toBe('axis');
    expect(first?.index).toBe(0);
    expect(first?.count).toBeGreaterThan(1);
    arch().cycleModify(1);
    expect(arch().modifyHover?.elementId).toBe(slabId);
    expect(arch().modifyHover?.index).toBe(1);
    arch().cycleModify(-1);
    expect(arch().modifyHover?.elementId).toBe(right);
    // O clique confirma a aresta escolhida com Tab; mover o cursor desfaz a escolha.
    arch().cycleModify(1);
    click(p(5, 2));
    expect(arch().modify?.picks[0]?.elementId).toBe(slabId);
    arch().cancel();
    arch().cycleModify(1);
    hover(p(5, 3));
    expect(arch().modifyHover?.index).toBe(0);
  });

  it('dividir: um clique, o ponto vem das capturas e a porta fica no trecho em que está', () => {
    const types = load();
    const [id = ''] = drawWalls([p(0, 0), p(6, 0)]);
    arch().setActiveType('door', types.door);
    arch().setTool('door');
    arch().clickPoint(p(2, 0), TOLERANCE);
    arch().setTool(null);
    const doorId = elements().find((element) => element.kind === 'door')?.id ?? '';

    runCommand('arch.split');
    // Dentro do vão da porta: a prévia já recusa, e o clique não grava.
    const before = editor().project;
    click(p(2.1, 0));
    expect(editor().project).toBe(before);
    expect(editor().message?.text).toContain('dentro do vão');

    click(p(4, 0.02));
    expect(walls()).toHaveLength(2);
    const tail = walls().find((item) => item.id !== id);
    near(wall(id).end, 4, 0);
    near(tail?.start ?? p(NaN, NaN), 4, 0);
    near(tail?.end ?? p(NaN, NaN), 6, 0);
    const door = elements().find((element) => element.id === doorId);
    expect(door?.kind === 'door' && door.hostId).toBe(id);
    expect(validateProject(editor().project)).toEqual([]);
    expect(arch().modify).toEqual({ kind: 'split', picks: [] });
  });
});

describe('comandos das ferramentas de modificação', () => {
  it('ficam desabilitados, com o motivo, sem paredes; Selecionar e outra ferramenta encerram', () => {
    load();
    for (const kind of ARCH_MODIFIES) {
      const state = commandState(getCommand(`arch.${kind}`), commandContext());
      expect(state.enabled).toBe(false);
      expect(state.reason).toBeTruthy();
    }
    arch().startModify('split');
    expect(arch().modify).toBeNull();

    drawWalls([p(0, 0), p(4, 0)]);
    expect(commandState(getCommand('arch.split'), commandContext()).enabled).toBe(true);
    expect(commandState(getCommand('arch.trimCorner'), commandContext()).enabled).toBe(false);
    drawWalls([p(1, 1), p(1, 3)]);
    runCommand('arch.trimCorner');
    expect(arch().modify?.kind).toBe('trimCorner');
    // O mesmo comando de novo desliga a ferramenta.
    runCommand('arch.trimCorner');
    expect(arch().modify).toBeNull();
    runCommand('arch.align');
    runCommand('tool.select');
    expect(arch().modify).toBeNull();
    runCommand('arch.split');
    arch().setTool('wall');
    expect(arch().modify).toBeNull();
    expect(arch().tool).toBe('wall');
  });
});
