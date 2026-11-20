import { createProject, createTerrain, vec3 } from '@hydrobim/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { useTerrainStore } from '../terrain/terrainStore';
import {
  commandContext,
  commandForKey,
  COMMANDS,
  commandState,
  commandTitle,
  getCommand,
  runCommand,
} from './commands';

const editor = () => useEditorStore.getState();
const stateOf = (id: string) => commandState(getCommand(id), commandContext());
const key = (
  value: string,
  modifiers: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {},
) => ({ key: value, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers });

/** Tubo, joelho e tubo, sem nada selecionado ao final. */
function drawBend(): void {
  editor().setToolOptions({ lockElbowAngles: false });
  editor().setTool('pipe');
  editor().commitPoint(vec3(0, 0, 0));
  editor().commitPoint(vec3(2, 0, 0));
  editor().commitPoint(vec3(2, 2, 0));
  editor().setTool('select');
  editor().select(null);
}

beforeEach(() => {
  editor().loadProject(createProject('Teste', 'mep'));
  if (editor().viewMode !== '3d') editor().setViewMode('3d');
  editor().setTool('select');
  useUiStore.getState().setTask('model');
});

describe('registro de comandos', () => {
  it('tem identificadores, data-testid e atalhos únicos, e toda entrada se explica', () => {
    const unique = (values: string[]): boolean => new Set(values).size === values.length;
    expect(unique(COMMANDS.map((command) => command.id))).toBe(true);
    expect(unique(COMMANDS.map((command) => command.testId))).toBe(true);
    expect(
      unique(COMMANDS.flatMap((command) => (command.shortcut ? [command.shortcut] : []))),
    ).toBe(true);
    for (const command of COMMANDS) {
      expect(command.label.length, command.id).toBeGreaterThan(0);
      expect(command.description.length, command.id).toBeGreaterThan(10);
    }
  });

  it('preserva os atalhos de teclado do editor', () => {
    const expected: Record<string, string> = {
      s: 'tool.select',
      t: 'tool.pipe',
      j: 'tool.elbow',
      e: 'tool.tee',
      r: 'tool.reducer',
      v: 'tool.valve',
      b: 'tool.pump',
      q: 'tool.tank',
      m: 'tool.measure',
      c: 'tool.dimension',
      x: 'tool.text',
      l: 'tool.leader',
      i: 'tool.tag',
      Delete: 'modify.delete',
    };
    for (const [value, id] of Object.entries(expected)) expect(commandForKey(key(value))).toBe(id);
    expect(commandForKey(key('T'))).toBe('tool.pipe');
    expect(commandForKey(key('s', { ctrlKey: true }))).toBe('file.save');
    expect(commandForKey(key('z', { ctrlKey: true }))).toBe('edit.undo');
    expect(commandForKey(key('y', { ctrlKey: true }))).toBe('edit.redo');
    expect(commandForKey(key('z', { ctrlKey: true, shiftKey: true }))).toBe('edit.redo');
    expect(commandForKey(key('k', { ctrlKey: true }))).toBe('help.commands');
    // Alt é da navegação do navegador e da órbita: não aciona ferramenta.
    expect(commandForKey(key('t', { altKey: true }))).toBeNull();
    expect(commandForKey(key('F5'))).toBeNull();
  });

  it('recursos futuros ficam indisponíveis, com a fase do roadmap', () => {
    const future = COMMANDS.filter((command) => command.phase);
    expect(future.length).toBeGreaterThan(0);
    for (const command of future) {
      const state = commandState(command, commandContext());
      expect(state.enabled).toBe(false);
      expect(state.reason).toContain(command.phase);
    }
  });

  it('as exportações declaram conteúdo, opções e requisitos', () => {
    const outputs = COMMANDS.filter((command) => command.details);
    expect(outputs.map((command) => command.id).sort()).toEqual(
      [
        'export.csv',
        'export.dxfModel',
        'export.dxfPlan',
        'export.epanet',
        'export.ids',
        'export.ifc',
        'export.svgPlan',
      ].sort(),
    );
    for (const command of outputs) {
      expect(command.details?.content.length).toBeGreaterThan(10);
      expect(command.details?.requirements.length).toBeGreaterThan(0);
    }
  });
});

describe('disponibilidade dos comandos', () => {
  it('modificar depende da seleção e explica o que falta', () => {
    drawBend();
    expect(stateOf('modify.move')).toMatchObject({ enabled: false });
    expect(stateOf('modify.move').reason).toContain('Selecione');
    expect(stateOf('modify.delete').enabled).toBe(false);
    expect(stateOf('view.fitSelection').enabled).toBe(false);

    const pipe = editor().project.elements.find((element) => element.kind === 'pipe');
    const elbow = editor().project.elements.find((element) => element.kind === 'elbow');
    if (!pipe || !elbow) throw new Error('Modelo de teste incompleto.');

    editor().select(pipe.id);
    expect(stateOf('modify.move').enabled).toBe(true);
    expect(stateOf('modify.length').enabled).toBe(true);
    expect(stateOf('modify.elevation').enabled).toBe(true);
    expect(stateOf('modify.rotate').enabled).toBe(false);
    expect(stateOf('modify.rotate').reason).toContain('Tubos');
    expect(stateOf('view.fitSelection').enabled).toBe(true);

    editor().select(elbow.id);
    expect(stateOf('modify.length').enabled).toBe(false);
    expect(stateOf('modify.rotate').enabled).toBe(true);
    // O joelho está entre dois tubos: sem extremidade livre, mas com portas a desconectar.
    expect(stateOf('connect.pipe').enabled).toBe(false);
    expect(stateOf('connect.pipe').reason).toContain('extremidade livre');
    expect(stateOf('connect.disconnect').enabled).toBe(true);

    editor().selectMany([pipe.id, elbow.id]);
    expect(stateOf('modify.length').enabled).toBe(false);
    expect(stateOf('connect.close').enabled).toBe(true);
  });

  it('"Tubo da extremidade" parte da porta livre, como o menu do botão direito', () => {
    drawBend();
    const pipe = editor().project.elements.find((element) => element.kind === 'pipe');
    if (!pipe) throw new Error('Modelo de teste incompleto.');
    editor().select(pipe.id);
    expect(stateOf('connect.pipe').enabled).toBe(true);
    expect(runCommand('connect.pipe')).toBe(true);
    expect(editor().tool).toBe('pipe');
    expect(editor().anchor?.port?.elementId).toBe(pipe.id);
  });

  it('a consulta BIM / IFC bloqueia a modelagem pelos mesmos comandos dos atalhos', () => {
    drawBend();
    const count = editor().project.elements.length;
    const first = editor().project.elements[0];
    if (!first) throw new Error('Modelo de teste incompleto.');
    useUiStore.getState().setTask('bim');
    editor().select(first.id);

    expect(stateOf('tool.select').enabled).toBe(true);
    expect(stateOf('tool.pipe')).toMatchObject({ enabled: false });
    expect(stateOf('tool.pipe').reason).toContain('BIM / IFC');
    expect(runCommand('tool.pipe')).toBe(false);
    expect(editor().tool).toBe('select');
    expect(editor().viewMode).toBe('bim');
    expect(runCommand('modify.delete')).toBe(false);
    expect(editor().project.elements).toHaveLength(count);
    // O motivo chega ao usuário.
    expect(editor().message?.text).toContain('BIM / IFC');
  });

  it('as vistas de câmera só valem no modelo 3D e as exportações pedem elementos', () => {
    expect(stateOf('export.ifc')).toMatchObject({ enabled: false });
    expect(stateOf('export.ids').enabled).toBe(true);
    expect(stateOf('view.top').enabled).toBe(true);
    // Lado a lado, o modelo 3D continua à mostra com a planta ativa: a câmera segue disponível.
    useUiStore.getState().setWorkspaceLayout('split');
    editor().setViewMode('plan');
    expect(stateOf('view.split').active).toBe(true);
    expect(stateOf('view.top').enabled).toBe(true);
    expect(stateOf('view.isometric').enabled).toBe(true);
    // Com a planta ocupando a área (maximizada ou uma vista por vez), não há câmera a mover.
    useUiStore.getState().maximizeView('plan');
    expect(stateOf('view.top').enabled).toBe(false);
    useUiStore.getState().maximizeView('plan');
    useUiStore.getState().setWorkspaceLayout('single');
    expect(stateOf('view.split').active).toBe(false);
    expect(stateOf('view.top').enabled).toBe(false);
    expect(stateOf('view.top').reason).toContain('Modelo 3D');
    expect(stateOf('view.isometric').enabled).toBe(false);
    expect(stateOf('view.fit').enabled).toBe(true);
    expect(stateOf('view.plan').active).toBe(true);
    drawBend();
    expect(stateOf('export.ifc').enabled).toBe(true);
  });

  it('a dica traz nome, atalho, finalidade e o motivo da indisponibilidade', () => {
    const undo = getCommand('edit.undo');
    const title = commandTitle(undo, commandState(undo, commandContext()));
    expect(title).toContain('Desfazer (Ctrl+Z)');
    expect(title).toContain('Indisponível: Não há alteração a desfazer.');
  });

  it('a isométrica informa o quadrante em uso', () => {
    expect(stateOf('view.isometric').data).toEqual({ quadrant: 'none' });
    runCommand('view.isometric');
    expect(stateOf('view.isometric')).toMatchObject({ active: true, data: { quadrant: 'isoSE' } });
  });
});

describe('comandos do terreno', () => {
  it('existem só no ambiente Infra e explicam o que falta', () => {
    // No MEP: indisponíveis, com o motivo.
    for (const id of ['terrain.panel', 'terrain.area', 'terrain.profile', 'terrain.query']) {
      expect(stateOf(id).enabled, id).toBe(false);
      expect(stateOf(id).reason, id).toMatch(/ambiente Infra/);
    }
    editor().loadProject(createProject('Rede', 'infra'));
    expect(stateOf('terrain.panel').enabled).toBe(true);
    expect(stateOf('terrain.area').enabled).toBe(true);
    // Corte e consulta dependem de haver superfície no projeto.
    expect(stateOf('terrain.profile').reason).toMatch(/superfície de terreno/);
    expect(stateOf('terrain.query').enabled).toBe(false);

    const terrain = createTerrain('T', [vec3(0, 0, 10), vec3(10, 0, 10), vec3(0, 10, 12)]);
    if (!terrain.ok) throw new Error(terrain.error.message);
    editor().setTerrain(terrain.value);
    expect(stateOf('terrain.profile').enabled).toBe(true);
    expect(stateOf('terrain.query').enabled).toBe(true);
  });

  it('abrem a Planta Infra e ficam marcados enquanto a operação está em andamento', () => {
    editor().loadProject(createProject('Rede', 'infra'));
    runCommand('terrain.area');
    expect(editor().viewMode).toBe('plan');
    expect(useTerrainStore.getState().mode).toBe('area');
    expect(useTerrainStore.getState().panelOpen).toBe(true);
    expect(stateOf('terrain.area').active).toBe(true);
    expect(stateOf('terrain.panel').active).toBe(true);
    // O mesmo comando encerra a operação; a modelagem não é afetada.
    runCommand('terrain.area');
    expect(useTerrainStore.getState().mode).toBeNull();
    expect(stateOf('terrain.area').active).toBe(false);
    expect(editor().past).toHaveLength(0);
    // Na consulta BIM / IFC as operações do terreno ficam indisponíveis.
    useUiStore.getState().setTask('bim');
    expect(stateOf('terrain.area').enabled).toBe(false);
    useTerrainStore.getState().setPanelOpen(false);
  });
});
