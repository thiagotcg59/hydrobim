import { createProject, vec3 } from '@hydrobim/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { selectIsDirty, useEditorStore } from './editorStore';
import { DEFAULT_LAYOUT, PANEL_LIMITS, parseLayout, TASKS, useUiStore } from './uiStore';

const editor = () => useEditorStore.getState();
const ui = () => useUiStore.getState();

beforeEach(() => {
  editor().loadProject(createProject('Teste', 'mep'), { saved: true });
  if (editor().viewMode !== '3d') editor().setViewMode('3d');
  editor().setTool('select');
  ui().setTask('model');
  ui().resetLayout();
  useUiStore.setState({ maximizedView: null });
  useUiStore.setState({ dialog: null, validationOpen: false, planRequest: null, reveal: null });
});

describe('preferências de layout', () => {
  it('descarta o que não for válido e limita as larguras', () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('{não é json')).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('[1, 2]')).toEqual({ ...DEFAULT_LAYOUT });
    const parsed = parseLayout(
      JSON.stringify({ navOpen: false, navWidth: 9999, panelWidth: 'larga', ribbonCollapsed: 1 }),
    );
    expect(parsed.navOpen).toBe(false);
    expect(parsed.navWidth).toBe(PANEL_LIMITS.nav.max);
    expect(parsed.panelWidth).toBe(DEFAULT_LAYOUT.panelWidth);
    expect(parsed.ribbonCollapsed).toBe(false);
  });

  it('recolher, redimensionar e restaurar não alteram o projeto nem o histórico', () => {
    const { project } = editor();
    const history = editor().past.length;
    ui().setNavOpen(false);
    ui().setPanelOpen(false);
    ui().setRibbonCollapsed(true);
    ui().setPanelWidth('nav', 50);
    ui().setPanelWidth('panel', 5000);
    expect(ui().navWidth).toBe(PANEL_LIMITS.nav.min);
    expect(ui().panelWidth).toBe(PANEL_LIMITS.panel.max);
    expect(editor().project).toBe(project);
    expect(editor().past).toHaveLength(history);
    expect(selectIsDirty(editor())).toBe(false);

    ui().resetLayout();
    expect({
      ribbonCollapsed: ui().ribbonCollapsed,
      navOpen: ui().navOpen,
      panelOpen: ui().panelOpen,
      navWidth: ui().navWidth,
      panelWidth: ui().panelWidth,
      workspaceLayout: ui().workspaceLayout,
      splitRatio: ui().splitRatio,
    }).toEqual(DEFAULT_LAYOUT);
  });

  it('escolher uma aba mostra a faixa recolhida', () => {
    ui().setRibbonCollapsed(true);
    ui().setTask('view');
    expect(ui().ribbonCollapsed).toBe(false);
  });
});

describe('vistas lado a lado', () => {
  it('a disposição padrão é planta e modelo 3D lado a lado; o que for inválido volta a ela', () => {
    expect(DEFAULT_LAYOUT.workspaceLayout).toBe('split');
    expect(parseLayout(JSON.stringify({ workspaceLayout: 'single' })).workspaceLayout).toBe(
      'single',
    );
    expect(parseLayout(JSON.stringify({ workspaceLayout: 'grade' })).workspaceLayout).toBe('split');
    expect(parseLayout(JSON.stringify({ splitRatio: 5 })).splitRatio).toBe(0.75);
    expect(parseLayout(JSON.stringify({ splitRatio: 'meio' })).splitRatio).toBe(0.5);
  });

  it('dividir, redimensionar e maximizar não alteram o projeto, a seleção nem o histórico', () => {
    editor().setTool('pipe');
    editor().commitPoint(vec3(0, 0, 0));
    editor().commitPoint(vec3(2, 0, 0));
    editor().setTool('select');
    const { project, selection } = editor();
    const history = editor().past.length;

    ui().setWorkspaceLayout('single');
    ui().setWorkspaceLayout('split');
    ui().setSplitRatio(0.1);
    expect(ui().splitRatio).toBe(0.25);
    ui().setSplitRatio(0.6);
    expect(ui().splitRatio).toBe(0.6);
    ui().maximizeView('plan');
    ui().maximizeView('plan');

    expect(editor().project).toBe(project);
    expect(editor().selection).toEqual(selection);
    expect(editor().past).toHaveLength(history);
  });

  it('maximizar ativa a vista, e escolher a outra vista troca a que ocupa a área', () => {
    ui().maximizeView('plan');
    expect(ui().maximizedView).toBe('plan');
    expect(editor().viewMode).toBe('plan');

    editor().setViewMode('3d');
    expect(ui().maximizedView).toBe('3d');

    // O mesmo botão restaura as duas vistas; a ativa continua a mesma.
    ui().maximizeView('3d');
    expect(ui().maximizedView).toBeNull();
    expect(editor().viewMode).toBe('3d');
  });

  it('apontar outra vista mantém a ferramenta e o trecho em andamento', () => {
    editor().setTool('pipe');
    editor().commitPoint(vec3(0, 0, 0));
    editor().commitPoint(vec3(2, 0, 0));
    const anchor = editor().anchor;
    ui().activateWorkspaceView('plan');
    expect(editor().viewMode).toBe('plan');
    expect(editor().tool).toBe('pipe');
    expect(editor().anchor).toBe(anchor);
  });

  it('a consulta BIM / IFC não muda a disposição das vistas', () => {
    ui().setTask('bim');
    ui().setWorkspaceLayout('single');
    expect(ui().workspaceLayout).toBe('split');
    ui().activateWorkspaceView('plan');
    expect(editor().viewMode).toBe('bim');
  });
});

describe('abas de tarefa', () => {
  it('trocar de aba não muda o ambiente, o modelo, a vista nem a operação em andamento', () => {
    editor().setTool('pipe');
    editor().commitPoint(vec3(0, 0, 0));
    editor().commitPoint(vec3(2, 0, 0));
    editor().setViewMode('plan');
    const before = editor();
    const anchor = before.anchor;
    expect(anchor).not.toBeNull();

    for (const task of TASKS.filter((id) => id !== 'bim')) {
      ui().setTask(task);
      const now = editor();
      expect(now.project).toBe(before.project);
      expect(now.project.discipline).toBe('mep');
      expect(now.viewMode).toBe('plan');
      expect(now.tool).toBe('pipe');
      expect(now.anchor).toBe(anchor);
      expect(now.past).toHaveLength(before.past.length);
    }
  });

  it('a consulta BIM / IFC suspende a modelagem e a retoma ao sair por outra aba', () => {
    editor().setTool('pipe');
    editor().commitPoint(vec3(0, 0, 0));
    editor().commitPoint(vec3(2, 0, 0));
    const anchor = editor().anchor;
    const { project } = editor();

    ui().setTask('bim');
    expect(editor().viewMode).toBe('bim');
    expect(editor().tool).toBe('select');
    expect(editor().anchor).toBeNull();
    expect(editor().project).toBe(project);
    expect(editor().message?.text).toContain('suspensa');

    ui().setTask('model');
    expect(editor().viewMode).toBe('3d');
    expect(editor().tool).toBe('pipe');
    expect(editor().anchor).toEqual(anchor);
  });

  it('trocar de vista encerra a consulta e volta à aba e à vista anteriores', () => {
    editor().setViewMode('plan');
    ui().setTask('document');
    ui().setTask('bim');
    expect(editor().viewMode).toBe('bim');

    // Pelas abas de vista: a consulta termina e a aba de tarefa anterior volta.
    editor().setViewMode('3d');
    expect(ui().task).toBe('document');
    expect(ui().suspended).toBeNull();

    // Por outra aba de tarefa: a vista de antes da consulta é retomada.
    editor().setViewMode('plan');
    ui().setTask('bim');
    ui().setTask('export');
    expect(editor().viewMode).toBe('plan');
    expect(ui().task).toBe('export');
  });

  it('não retoma o trecho se o ponto de partida deixou de existir', () => {
    editor().setTool('pipe');
    editor().commitPoint(vec3(0, 0, 0));
    editor().commitPoint(vec3(2, 0, 0));
    expect(editor().anchor?.port).not.toBeNull();
    ui().setTask('bim');
    editor().undo();
    ui().setTask('model');
    expect(editor().tool).toBe('pipe');
    expect(editor().anchor).toBeNull();
  });
});

describe('painel direito e diálogos', () => {
  it('mostra as opções ao criar e as propriedades ao selecionar', () => {
    expect(ui().panelTab).toBe('properties');
    editor().setTool('pipe');
    expect(ui().panelTab).toBe('tool');
    ui().setPanelTab('properties');
    editor().setTool('valve');
    expect(ui().panelTab).toBe('tool');
    editor().setTool('select');
    expect(ui().panelTab).toBe('properties');
    // As ferramentas de documentação não têm painel de opções.
    editor().setTool('dimension');
    expect(ui().panelTab).toBe('properties');
  });

  it('um diálogo que se fecha não derruba o que abriu em seguida', () => {
    ui().openDialog('commands');
    ui().openDialog('families');
    ui().closeDialog('commands');
    expect(ui().dialog).toBe('families');
    ui().closeDialog('families');
    expect(ui().dialog).toBeNull();
  });

  it('revelar um campo abre o painel de propriedades', () => {
    ui().setPanelOpen(false);
    editor().setTool('pipe');
    ui().revealProperty('prop-length');
    expect(ui().panelOpen).toBe(true);
    expect(ui().panelTab).toBe('properties');
    expect(ui().reveal?.target).toBe('prop-length');
  });
});
