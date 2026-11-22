import { archTypeFromFamily, getArchFamily } from '@hydrobim/catalog';
import {
  addArchType,
  addPlatform,
  archVerticalRange,
  buildTerrainSurface,
  createProject,
  parseProject,
  serializeProject,
  setTerrain,
  surveySource,
  validateProject,
  vec3,
  type ArchCategory,
  type ArchElement,
  type Wall,
} from '@hydrobim/core';
import { buildArchIfcModel } from '@hydrobim/ifc';
import { beforeEach, describe, expect, it } from 'vitest';
import { commandContext, commandState, getCommand, runCommand } from '../commands/commands';
import { createBuildingDemoProject } from '../demo/buildingDemo';
import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { useViewStore } from '../views/viewStore';
import { archNatureOf, archPanelRows } from './archPanelModel';
import { archToolBlocker, useArchStore } from './archStore';
import { archTreeCount, archTreeOf } from './archTree';

const editor = () => useEditorStore.getState();
const arch = () => useArchStore.getState();
const elements = (): ArchElement[] => editor().project.architecture.elements;
const walls = (): Wall[] => elements().filter((e): e is Wall => e.kind === 'wall');
const stateOf = (id: string) => commandState(getCommand(id), commandContext());

const FAMILIES: Record<ArchCategory, string> = {
  wall: 'arq-parede-alvenaria-ceramica',
  slab: 'arq-laje-concreto',
  flooring: 'arq-piso-ceramica-porcelanato',
  door: 'arq-porta-giro-1',
  window: 'arq-janela-correr',
};

/** Projeto vazio com um tipo de cada categoria (como o catálogo acrescentaria). */
function emptyWithTypes(): Record<ArchCategory, string> {
  let project = createProject('Arquitetura', 'architecture');
  const ids = {} as Record<ArchCategory, string>;
  for (const category of Object.keys(FAMILIES) as ArchCategory[]) {
    const family = getArchFamily(FAMILIES[category]);
    if (!family) throw new Error(`família ausente: ${FAMILIES[category]}`);
    const added = addArchType(project, archTypeFromFamily(family, `Tipo ${category}`));
    if (!added.ok) throw new Error(added.error.message);
    project = added.value.project;
    ids[category] = added.value.typeId;
  }
  editor().loadProject(project);
  return ids;
}

beforeEach(() => {
  editor().loadProject(createProject('Vazio', 'architecture'));
  useViewStore.setState({ open2d: null, open3d: null, tool: 'select', draft: [] });
  useUiStore.getState().setTask('model');
  useArchStore.setState({ tool: null, points: [], cursor: null, selection: [], activeTypes: {} });
  arch().setOptions({
    seat: 'level',
    wallBaseOffset: 0,
    floorOffset: 0,
    wallHeight: 2.8,
    closed: false,
  });
});

describe('ferramentas de criação', () => {
  it('sem tipo da categoria levam ao catálogo; portas e janelas exigem uma parede — com o motivo', () => {
    // Sem tipo, o comando fica disponível e abre o catálogo já na categoria.
    expect(stateOf('arch.wall').enabled).toBe(true);
    arch().setTool('wall');
    expect(arch().tool).toBeNull();
    expect(editor().message?.text).toContain('Catálogo de arquitetura');
    expect(useUiStore.getState().dialog).toBe('archCatalog');
    expect(arch().catalogCategory).toBe('wall');
    useUiStore.getState().closeDialog('archCatalog');
    // Porta sem parede continua indisponível, mesmo sem tipo.
    expect(stateOf('arch.door').enabled).toBe(false);
    expect(stateOf('arch.door').reason).toContain('paredes');

    emptyWithTypes();
    expect(stateOf('arch.wall').enabled).toBe(true);
    expect(stateOf('arch.door').enabled).toBe(false);
    expect(stateOf('arch.door').reason).toContain('paredes');
    expect(stateOf('arch.floorOpening').reason).toContain('Selecione uma laje');
    expect(archToolBlocker(editor().project, 'space', [])).toBeNull();
  });

  it('parede por traçado contínuo: um passo no histórico, com desfazer e refazer', () => {
    emptyWithTypes();
    expect(runCommand('arch.wall')).toBe(true);
    expect(arch().tool).toBe('wall');
    expect(editor().viewMode).toBe('plan');
    expect(useUiStore.getState().panelTab).toBe('tool');
    const before = editor().past.length;

    arch().clickPoint({ x: 0, y: 0 });
    arch().clickPoint({ x: 4, y: 0 });
    // O segundo clique de um duplo clique não vira vértice.
    arch().clickPoint({ x: 4, y: 0 });
    arch().clickPoint({ x: 4, y: 3 });
    expect(arch().points).toHaveLength(3);
    expect(editor().past.length).toBe(before);
    expect(arch().finish()).toBe(true);

    expect(walls()).toHaveLength(2);
    expect(editor().past.length).toBe(before + 1);
    expect(arch().points).toEqual([]);
    expect(arch().tool).toBe('wall');
    expect(arch().selection).toEqual(walls().map((wall) => wall.id));
    expect(walls()[0]?.height).toBe(2.8);
    expect(walls()[0]?.levelId).toBe(editor().project.levels[0]?.id);
    expect(validateProject(editor().project).filter((i) => i.severity === 'error')).toEqual([]);

    const ids = walls().map((wall) => wall.id);
    editor().undo();
    expect(walls()).toHaveLength(0);
    expect(arch().selection).toEqual([]);
    editor().redo();
    expect(walls().map((wall) => wall.id)).toEqual(ids);
  });

  it('comprimento digitado define o trecho na direção do cursor; traçado fechado liga as pontas', () => {
    emptyWithTypes();
    arch().setTool('wall');
    expect(arch().submitLength('3')).toBe(false);
    arch().clickPoint({ x: 0, y: 0 });
    arch().setCursor({ x: 1, y: 0 });
    expect(arch().submitLength('abc')).toBe(false);
    expect(arch().submitLength('3,5')).toBe(true);
    expect(arch().points[1]).toEqual({ x: 3.5, y: 0 });
    arch().clickPoint({ x: 3.5, y: 2 });
    arch().setOptions({ closed: true, wallHeight: 3 });
    expect(arch().finish()).toBe(true);
    expect(walls()).toHaveLength(3);
    expect(walls().every((wall) => wall.height === 3)).toBe(true);
  });

  it('Esc cancela por etapas: o traçado, a ferramenta e a seleção', () => {
    emptyWithTypes();
    arch().setTool('wall');
    arch().clickPoint({ x: 0, y: 0 });
    arch().clickPoint({ x: 2, y: 0 });
    expect(arch().cancel()).toBe(true);
    expect(arch().points).toEqual([]);
    expect(arch().tool).toBe('wall');
    expect(arch().cancel()).toBe(true);
    expect(arch().tool).toBeNull();
    expect(walls()).toHaveLength(0);
    expect(arch().cancel()).toBe(false);
  });

  it('porta e janela são inseridas na parede sob o clique; o que não cabe é recusado', () => {
    emptyWithTypes();
    arch().setTool('wall');
    arch().clickPoint({ x: 0, y: 0 });
    arch().clickPoint({ x: 5, y: 0 });
    arch().finish();
    arch().setTool('door');
    expect(arch().tool).toBe('door');
    const steps = editor().past.length;
    arch().clickPoint({ x: 3, y: 3 });
    expect(elements().filter((e) => e.kind === 'door')).toHaveLength(0);
    arch().clickPoint({ x: 2, y: 0.02 });
    const door = elements().find((e) => e.kind === 'door');
    expect(door && door.kind === 'door' ? door.hostId : null).toBe(walls()[0]?.id);
    expect(door && door.kind === 'door' ? door.offset : null).toBeCloseTo(2);
    expect(editor().past.length).toBe(steps + 1);
    // Sobre a porta existente: o vão se sobrepõe e nada muda.
    const project = editor().project;
    arch().clickPoint({ x: 2.1, y: 0 });
    expect(editor().project).toBe(project);
    expect(editor().message?.level).toBe('error');
    arch().setTool('window');
    arch().clickPoint({ x: 4, y: 0 });
    expect(elements().filter((e) => e.kind === 'window')).toHaveLength(1);
  });

  it('laje, piso, ambiente e abertura por contorno fechado', () => {
    emptyWithTypes();
    const square = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
    ];
    for (const tool of ['slab', 'flooring', 'space'] as const) {
      arch().setTool(tool);
      arch().clickPoint(square[0] ?? { x: 0, y: 0 });
      arch().clickPoint(square[1] ?? { x: 0, y: 0 });
      expect(arch().finish()).toBe(false);
      for (const point of square.slice(2)) arch().clickPoint(point);
      expect(arch().finish()).toBe(true);
    }
    expect(elements().map((e) => e.kind)).toEqual(['slab', 'flooring', 'space']);
    const space = elements().find((e) => e.kind === 'space');
    expect(space && space.kind === 'space' ? space.height : 0).toBeNull();

    const slab = elements().find((e) => e.kind === 'slab');
    arch().select(slab?.id ?? null);
    arch().setTool('floorOpening');
    expect(arch().openingTarget).toBe(slab?.id);
    for (const point of [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ]) {
      arch().clickPoint(point);
    }
    expect(arch().finish()).toBe(true);
    const cut = elements().find((e) => e.kind === 'slab');
    expect(cut && cut.kind === 'slab' ? cut.openings : []).toHaveLength(1);
    const opening = cut && cut.kind === 'slab' ? cut.openings[0] : undefined;
    expect(arch().removeOpening(cut?.id ?? '', opening?.id ?? '')).toBe(true);
  });
});

describe('seleção e edição', () => {
  beforeEach(() => editor().loadProject(createBuildingDemoProject()));

  it('a seleção da arquitetura e a da rede são mutuamente exclusivas', () => {
    const wall = walls()[0];
    const pipe = editor().project.elements[0];
    if (!wall || !pipe) throw new Error('demonstração incompleta');
    editor().select(pipe.id);
    arch().select(wall.id);
    expect(arch().selection).toEqual([wall.id]);
    expect(editor().selection).toEqual([]);
    editor().select(pipe.id);
    expect(arch().selection).toEqual([]);
    arch().select(wall.id);
    arch().select(walls()[1]?.id ?? null, true);
    expect(arch().selection).toHaveLength(2);
    expect(stateOf('arch.move').enabled).toBe(true);
    arch().select(null);
    expect(stateOf('arch.move').enabled).toBe(false);
  });

  it('uma ferramenta da rede encerra a de arquitetura, e vice-versa', () => {
    arch().setTool('wall');
    editor().setTool('pipe');
    expect(arch().tool).toBeNull();
    arch().setTool('wall');
    expect(editor().tool).toBe('select');
    expect(arch().tool).toBe('wall');
  });

  it('alterar a altura muda o quantitativo; a edição impossível é recusada sem alteração', () => {
    const wall = walls()[0];
    if (!wall) throw new Error('parede ausente');
    const side = (): number => {
      const info = buildArchIfcModel(editor().project).elements.find(
        (item) => item.elementId === wall.id,
      );
      const value = info?.psets
        .flatMap((set) => set.properties)
        .find((p) => p.key === 'Qto_WallBaseQuantities.GrossSideArea')?.value;
      return typeof value === 'number' ? value : Number.NaN;
    };
    const before = side();
    expect(arch().update(wall.id, { height: 3.2 })).toBe(true);
    expect(side()).toBeGreaterThan(before);
    // Menor que a porta hospedada (2,10 m): recusada por inteiro.
    const project = editor().project;
    const steps = editor().past.length;
    expect(arch().update(wall.id, { height: 1.5 })).toBe(false);
    expect(editor().project).toBe(project);
    expect(editor().past.length).toBe(steps);
    expect(editor().message?.level).toBe('error');
    editor().undo();
    expect(side()).toBeCloseTo(before);
    editor().redo();
    expect(walls()[0]?.height).toBe(3.2);
  });

  it('excluir a parede leva as portas e janelas, e o aviso diz quantas', () => {
    const host = walls().find((wall) =>
      elements().some((e) => 'hostId' in e && e.hostId === wall.id),
    );
    if (!host) throw new Error('hospedeira ausente');
    const hosted = elements().filter((e) => 'hostId' in e && e.hostId === host.id).length;
    const total = elements().length;
    arch().select(host.id);
    expect(stateOf('modify.delete').enabled).toBe(true);
    expect(runCommand('modify.delete')).toBe(true);
    expect(elements()).toHaveLength(total - 1 - hosted);
    expect(editor().message?.text).toContain('hospedada');
    expect(arch().selection).toEqual([]);
    editor().undo();
    expect(elements()).toHaveLength(total);
  });

  it('mover, copiar, girar e espelhar chamam o núcleo, um passo cada', () => {
    const wall = walls()[4] ?? walls()[0];
    if (!wall) throw new Error('parede ausente');
    arch().select(wall.id);
    const steps = editor().past.length;
    const total = elements().length;
    expect(arch().copy({ x: 10, y: 0 })).toBe(true);
    expect(elements().length).toBeGreaterThan(total);
    expect(arch().selection).not.toContain(wall.id);
    expect(arch().move({ x: 0, y: 1 })).toBe(true);
    expect(arch().rotate({ x: 14, y: 2 }, Math.PI / 2)).toBe(true);
    expect(arch().mirror({ x: 20, y: 0 }, { x: 20, y: 1 })).toBe(true);
    expect(editor().past.length).toBe(steps + 4);
    expect(arch().mirror({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(false);
    expect(editor().past.length).toBe(steps + 4);
  });

  it('valor IFC do tipo informa quantas ocorrências o compartilham; limpar volta a pendente', () => {
    const wall = walls()[0];
    if (!wall) throw new Error('parede ausente');
    const row = (key: string) => {
      const model = buildArchIfcModel(editor().project);
      const info = model.elements.find((item) => item.elementId === wall.id);
      const type = model.types.find((item) => item.key === info?.typeKey);
      if (!info) throw new Error('elemento fora do modelo IFC');
      return Object.values(archPanelRows(info, type))
        .flat()
        .find((item) => item.property.key === key);
    };
    const key = 'Pset_WallCommon.FireRating';
    const initial = row(key);
    expect(initial?.nature).toBe('pending');
    const scope = initial?.scope ?? 'type';
    expect(arch().setIfcValue(wall.id, scope, key, 'TRRF 120')).toBe(true);
    expect(row(key)?.nature).toBe(scope);
    if (scope === 'type') expect(editor().message?.text).toContain('ocorrências');
    expect(arch().setIfcValue(wall.id, scope, key, null)).toBe(true);
    expect(row(key)?.nature).toBe('pending');
    expect(row('Qto_WallBaseQuantities.Length')?.nature).toBe('calculated');
    expect(archNatureOf({ origin: 'user', value: 1 }, 'occurrence')).toBe('occurrence');
  });

  it('salvar e reabrir preserva identificadores e contagens; trocar de ambiente não perde nada', () => {
    const ids = elements().map((e) => e.id);
    const network = editor().project.elements.map((e) => e.id);
    editor().setDiscipline('mep');
    editor().setDiscipline('infra');
    editor().setDiscipline('architecture');
    expect(elements().map((e) => e.id)).toEqual(ids);
    expect(editor().project.elements.map((e) => e.id)).toEqual(network);
    const reopened = parseProject(serializeProject(editor().project));
    if (!reopened.ok) throw new Error(reopened.error.message);
    expect(reopened.value.architecture.elements.map((e) => e.id)).toEqual(ids);
  });

  it('árvore do navegador: pavimento › categoria, com as esquadrias no pavimento da hospedeira', () => {
    const tree = archTreeOf(editor().project);
    expect(archTreeCount(tree)).toBe(elements().length);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.categories.map((c) => c.label)).toEqual([
      'Paredes',
      'Lajes',
      'Pisos',
      'Portas',
      'Janelas',
      'Ambientes',
    ]);
    const found = archTreeOf(editor().project, 'banheiro');
    expect(archTreeCount(found)).toBe(1);
    expect(archTreeCount(archTreeOf(editor().project, 'inexistente'))).toBe(0);
  });

  it('abrir outro projeto zera a sessão', () => {
    arch().select(walls()[0]?.id ?? null);
    arch().setTool('wall');
    editor().loadProject(createProject('Outro', 'mep'));
    expect(arch().tool).toBeNull();
    expect(arch().selection).toEqual([]);
    // O ponto 3D da rede continua funcionando no mesmo editor.
    editor().setTool('pipe');
    editor().commitPoint(vec3(0, 0, 0));
    editor().commitPoint(vec3(2, 0, 0));
    expect(editor().project.elements).toHaveLength(1);
  });
});

describe('assentamento sobre o terreno', () => {
  /** Plano inclinado de 100 m × 100 m: z = 700 + 0,02 x + 0,01 y, com platô na cota 705. */
  const ground = (x: number, y: number): number => 700 + 0.02 * x + 0.01 * y;
  const rangeOf = (element: ArchElement | undefined) =>
    element ? archVerticalRange(editor().project, element) : null;

  function withTerrain(): void {
    emptyWithTypes();
    const points = [];
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
    const graded = addPlatform(setTerrain(editor().project, built.value.terrain), {
      outline: [
        { x: 30, y: 30 },
        { x: 60, y: 30 },
        { x: 60, y: 60 },
        { x: 30, y: 60 },
      ],
      elevation: 705,
      cutSlope: 1,
      fillSlope: 1.5,
    });
    if (!graded.ok) throw new Error(graded.error.message);
    editor().loadProject(graded.value.project);
  }

  it('parede no nível por padrão; no projetado ou no natural conforme a opção, com folga', () => {
    withTerrain();
    arch().setTool('wall');
    arch().clickPoint({ x: 40, y: 40 });
    arch().clickPoint({ x: 50, y: 40 });
    expect(arch().finish()).toBe(true);
    expect(rangeOf(walls().at(-1))?.base).toBe(0);

    arch().setOptions({ seat: 'design' });
    arch().clickPoint({ x: 40, y: 45 });
    arch().clickPoint({ x: 50, y: 45 });
    expect(arch().finish()).toBe(true);
    expect(rangeOf(walls().at(-1))).toEqual({ base: 705, top: 707.8 });
    expect(editor().message?.text).toContain(
      'Base assentada sobre o terreno projetado, na cota 705,000 m',
    );

    arch().setOptions({ seat: 'natural', wallBaseOffset: 0.3 });
    arch().clickPoint({ x: 40, y: 50 });
    arch().clickPoint({ x: 50, y: 50 });
    expect(arch().finish()).toBe(true);
    expect(rangeOf(walls().at(-1))?.base).toBeCloseTo(ground(40, 50) + 0.3, 3);
    expect(editor().message?.text).toContain('sobre o terreno natural');
    expect(validateProject(editor().project).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('laje com a base no terreno, ambiente no terreno e ponto fora da superfície no nível', () => {
    withTerrain();
    arch().setOptions({ seat: 'design' });
    arch().setTool('slab');
    for (const [x, y] of [
      [40, 40],
      [50, 40],
      [50, 50],
      [40, 50],
    ] as const) {
      arch().clickPoint({ x, y });
    }
    expect(arch().finish()).toBe(true);
    const slab = elements().find((e) => e.kind === 'slab');
    expect(rangeOf(slab)?.base).toBeCloseTo(705, 6);

    arch().setTool('space');
    for (const [x, y] of [
      [70, 70],
      [80, 70],
      [80, 80],
    ] as const) {
      arch().clickPoint({ x, y });
    }
    expect(arch().finish()).toBe(true);
    expect(rangeOf(elements().find((e) => e.kind === 'space'))?.base).toBeCloseTo(
      ground(70, 70),
      3,
    );

    arch().setTool('wall');
    arch().clickPoint({ x: 300, y: 300 });
    arch().clickPoint({ x: 310, y: 300 });
    expect(arch().finish()).toBe(true);
    expect(rangeOf(walls().at(-1))?.base).toBe(0);
    expect(editor().message?.text).toContain('fora da superfície');
  });

  it('assentar um elemento existente é um passo do histórico; sem terreno vale o nível', () => {
    withTerrain();
    arch().setTool('wall');
    arch().clickPoint({ x: 40, y: 40 });
    arch().clickPoint({ x: 50, y: 40 });
    arch().finish();
    const id = walls()[0]?.id ?? '';
    const before = editor().past.length;
    expect(arch().seat(id, 'natural')).toBe(true);
    expect(rangeOf(walls()[0])?.base).toBeCloseTo(ground(40, 40), 3);
    expect(arch().seat(id, 'design')).toBe(true);
    expect(rangeOf(walls()[0])?.base).toBe(705);
    expect(editor().past.length).toBe(before + 2);
    editor().undo();
    expect(rangeOf(walls()[0])?.base).toBeCloseTo(ground(40, 40), 3);

    // Sem superfície a opção guardada não vale: a parede fica no nível.
    editor().loadProject(setTerrain(editor().project, null));
    arch().setOptions({ seat: 'design' });
    arch().setTool('wall');
    arch().clickPoint({ x: 0, y: 10 });
    arch().clickPoint({ x: 5, y: 10 });
    expect(arch().finish()).toBe(true);
    expect(rangeOf(walls().at(-1))?.base).toBe(0);
    expect(arch().seat(id, 'design')).toBe(false);
  });
});
