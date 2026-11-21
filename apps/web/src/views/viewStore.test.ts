import {
  createProject,
  getView,
  isView2d,
  parseProject,
  serializeProject,
  validateProject,
  vec3,
  type Pipe,
  type ProjectView2d,
} from '@hydrobim/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { commandContext, commandState, getCommand, runCommand } from '../commands/commands';
import { setViewFocus } from '../editor/viewPresets';
import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { elementSnapPoints, viewEntryOf, viewProjectionOf } from './viewGeometry';
import { setLiveView, useViewStore } from './viewStore';

const editor = () => useEditorStore.getState();
const views = () => useViewStore.getState();
const project = () => editor().project;
const pipes = () => project().elements.filter((e): e is Pipe => e.kind === 'pipe');

function sheet(id: string | null): ProjectView2d {
  const view = getView(project(), id);
  if (!view || !isView2d(view)) throw new Error('vista 2D esperada');
  return view;
}

/** Tubo de 4 m em X na cota 1 m. */
function drawPipe(): string {
  editor().setTool('pipe');
  editor().commitPoint(vec3(0, 0, 1));
  editor().commitPoint(vec3(4, 0, 1));
  editor().setTool('select');
  const pipe = pipes()[0];
  if (!pipe) throw new Error('tubo ausente');
  return pipe.id;
}

beforeEach(() => {
  editor().loadProject(createProject('Vistas', 'mep'));
  editor().setToolOptions({ sizeMode: 'reducers', families: {}, lockElbowAngles: false });
  useViewStore.setState({
    open2d: null,
    open3d: null,
    tool: 'select',
    draft: [],
    cursor: null,
    detailSelection: [],
    marker: null,
  });
  useUiStore.setState({ task: 'model', panelTab: 'properties' });
});

describe('vistas salvas: criar, abrir e histórico', () => {
  it('cria a planta do nível, abre na área da planta e desfaz/refaz', () => {
    drawPipe();
    const id = views().createPlan();
    expect(id).not.toBeNull();
    expect(project().views.map((view) => view.name)).toEqual(['Planta — Térreo']);
    expect(views().open2d).toBe(id);
    expect(editor().viewMode).toBe('plan');
    expect(useUiStore.getState().panelTab).toBe('view');

    // Desfazer remove a vista do projeto e a área volta à planta de trabalho.
    editor().undo();
    expect(project().views).toHaveLength(0);
    expect(views().open2d).toBeNull();
    editor().redo();
    expect(project().views).toHaveLength(1);
    // O modelo não foi tocado em nenhum dos passos.
    expect(pipes()).toHaveLength(1);
    expect(validateProject(project())).toEqual([]);
  });

  it('o corte é definido por três cliques em planta e fica selecionado pelo marcador', () => {
    drawPipe();
    runCommand('views.newSection');
    expect(views().tool).toBe('section');
    views().clickPoint({ x: 0, y: -1 });
    views().clickPoint({ x: 4, y: -1 });
    views().clickPoint({ x: 2, y: 2 });
    const section = project().views[0];
    expect(section?.kind === 'section' && [section.side, section.depth]).toEqual([1, 3]);
    expect(views().tool).toBe('select');
    expect(views().marker).toBe(section?.id);
    // O marcador seleciona sem abrir; abrir é uma ação à parte (duplo clique ou navegador).
    expect(views().open2d).toBeNull();
    views().openView(section?.id ?? '');
    expect(views().open2d).toBe(section?.id);

    // Del com o marcador selecionado exclui a vista do corte — nunca um elemento.
    views().closeView('2d');
    views().selectMarker(section?.id ?? '');
    expect(commandState(getCommand('modify.delete'), commandContext()).enabled).toBe(true);
    runCommand('modify.delete');
    expect(project().views).toHaveLength(0);
    expect(pipes()).toHaveLength(1);
  });

  it('a profundidade do corte pode ser digitada depois da linha', () => {
    views().setTool('section');
    views().clickPoint({ x: 0, y: 0 });
    views().clickPoint({ x: 4, y: 0 });
    views().setCursor({ x: 1, y: -0.2 });
    expect(views().submitEntry('2,5')).toBe(true);
    const section = project().views[0];
    expect(section?.kind === 'section' && [section.side, section.depth]).toEqual([-1, 2.5]);
  });

  it('a vista 3D guarda a câmera atual e a caixa de corte entra no histórico', () => {
    drawPipe();
    setViewFocus({ center: vec3(2, 0, 1), halfHeight: 3 }, vec3(1, -1, 1));
    editor().setOrthographic(true);
    const id = views().create3d();
    const saved = getView(project(), id);
    expect(saved?.kind === '3d' && saved.camera).toEqual({
      target: vec3(2, 0, 1),
      direction: vec3(1, -1, 1),
      halfHeight: 3,
      projection: 'orthographic',
    });
    expect(views().open3d).toBe(id);
    // Criada com a câmera em uso: não há pedido para reposicionar o modelo.
    expect(views().cameraRequest).toBeNull();

    views().toggleSectionBox();
    const boxed = getView(project(), id);
    expect(boxed?.kind === '3d' && boxed.sectionBox?.enabled).toBe(true);
    expect(commandState(getCommand('views.sectionBox'), commandContext()).active).toBe(true);
    views().toggleSectionBox();
    const off = getView(project(), id);
    expect(off?.kind === '3d' && off.sectionBox?.enabled).toBe(false);
    editor().undo();
    const again = getView(project(), id);
    expect(again?.kind === '3d' && again.sectionBox?.enabled).toBe(true);

    // Reabrir a vista pede a câmera salva ao Modelo 3D.
    views().closeView('3d');
    views().openView(id ?? '');
    expect(views().cameraRequest?.camera).toEqual(saved?.kind === '3d' ? saved.camera : null);
  });

  it('sem vista 3D aberta, a caixa de corte cria a vista que a guarda', () => {
    drawPipe();
    runCommand('views.sectionBox');
    const view = project().views[0];
    expect(view?.kind === '3d' && view.sectionBox?.enabled).toBe(true);
    expect(views().open3d).toBe(view?.id);
  });

  it('duplicar, reordenar e excluir pelo navegador', () => {
    const first = views().createPlan();
    const second = views().createElevation('south');
    const copy = views().duplicate(first ?? '');
    const names = (): string[] => project().views.map((view) => view.name);
    expect(names()).toEqual(['Planta — Térreo', 'Planta — Térreo — cópia', 'Elevação Sul']);
    views().reorder(copy ?? '', -1);
    expect(names()[0]).toBe('Planta — Térreo — cópia');
    expect(views().rename(copy ?? '', 'Elevação Sul')).toBe(false);
    expect(editor().message?.text).toContain('Já existe');
    // Excluir a vista aberta fecha a área; as demais continuam.
    expect(views().open2d).toBe(second);
    views().remove(second ?? '');
    expect(views().open2d).toBeNull();
    expect(names()).toEqual(['Planta — Térreo — cópia', 'Planta — Térreo']);
  });
});

describe('detalhes 2D pela store', () => {
  it('linha em sequência, retângulo, círculo por raio, polilinha, texto e cota', () => {
    const id = views().createPlan();
    views().setTool('line');
    views().clickPoint({ x: 0, y: 0 });
    views().clickPoint({ x: 2, y: 0 });
    // A linha seguinte parte do último ponto.
    expect(views().draft).toEqual([{ x: 2, y: 0 }]);
    expect(views().submitEntry('@0;1')).toBe(true);
    views().setTool('rect');
    views().clickPoint({ x: 0, y: 2 });
    expect(views().submitEntry('@1,5;0,5')).toBe(true);
    views().setTool('circle');
    views().clickPoint({ x: 5, y: 5 });
    expect(views().submitEntry('0,25')).toBe(true);
    views().setTool('polyline');
    views().clickPoint({ x: 0, y: 4 });
    views().clickPoint({ x: 1, y: 5 });
    views().clickPoint({ x: 2, y: 4 });
    views().finishDraft(true);
    views().setTool('text');
    views().clickPoint({ x: 3, y: 3 });
    views().setTool('dimension');
    views().clickPoint({ x: 0, y: 0 });
    views().clickPoint({ x: 2, y: 0 });
    views().clickPoint({ x: 1, y: -0.5 });

    const kinds = sheet(id).details.map((detail) => detail.kind);
    expect(kinds).toEqual(['line', 'line', 'rect', 'circle', 'polyline', 'text', 'dimension']);
    const circle = sheet(id).details[3];
    expect(circle?.kind === 'circle' && circle.radius).toBe(0.25);
    const polyline = sheet(id).details[4];
    expect(polyline?.kind === 'polyline' && polyline.closed).toBe(true);
    // Nada disso é elemento da rede.
    expect(project().elements).toHaveLength(0);
  });

  it('seleciona, edita, move, copia e exclui, com desfazer', () => {
    const id = views().createPlan();
    views().setTool('circle');
    views().clickPoint({ x: 1, y: 1 });
    views().clickPoint({ x: 2, y: 1 });
    views().setTool('select');
    const circle = sheet(id).details[0];
    views().selectDetail(circle?.id ?? '');
    expect(useUiStore.getState().panelTab).toBe('view');

    expect(views().changeDetail(circle?.id ?? '', { radius: 0.5 })).toBe(true);
    expect(views().moveDetails({ x: 1, y: 0 })).toBe(true);
    expect(views().copyDetails({ x: 0, y: 3 })).toBe(true);
    const [original, copy] = sheet(id).details;
    expect(original?.kind === 'circle' && original.center).toEqual({ x: 2, y: 1 });
    expect(copy?.kind === 'circle' && [copy.center, copy.radius]).toEqual([{ x: 2, y: 4 }, 0.5]);
    // A cópia fica selecionada; Del exclui só ela.
    expect(views().detailSelection).toEqual([copy?.id]);
    runCommand('modify.delete');
    expect(sheet(id).details).toHaveLength(1);
    editor().undo();
    expect(sheet(id).details).toHaveLength(2);
    // Um valor recusado pelo núcleo não altera nada e informa o motivo.
    expect(views().changeDetail(circle?.id ?? '', { radius: -1 })).toBe(false);
    expect(editor().message?.level).toBe('error');
  });

  it('as ferramentas de detalhe exigem uma vista salva aberta; Esc desfaz por etapas', () => {
    expect(commandState(getCommand('detail.line'), commandContext()).enabled).toBe(false);
    views().createPlan();
    expect(commandState(getCommand('detail.line'), commandContext()).enabled).toBe(true);
    runCommand('detail.polyline');
    views().clickPoint({ x: 0, y: 0 });
    expect(views().cancel()).toBe(true);
    expect(views().draft).toEqual([]);
    expect(views().tool).toBe('polyline');
    expect(views().cancel()).toBe(true);
    expect(views().tool).toBe('select');
    expect(views().cancel()).toBe(false);
    // Uma ferramenta de modelagem encerra o desenho 2D.
    runCommand('detail.line');
    editor().setTool('pipe');
    expect(views().tool).toBe('select');
  });

  it('a região de recorte começa em torno do desenho e liga/desliga pelo comando', () => {
    const id = views().createPlan();
    setLiveView({
      viewId: id ?? '',
      center: { x: 2, y: 0 },
      height: 6,
      width: 8,
      content: { min: { x: 0, y: -1 }, max: { x: 4, y: 1 } },
    });
    runCommand('views.crop');
    const crop = sheet(id).crop;
    expect(crop?.enabled).toBe(true);
    expect(crop?.min.x).toBeLessThan(0);
    expect(crop?.max.x).toBeGreaterThan(4);
    runCommand('views.crop');
    expect(sheet(id).crop?.enabled).toBe(false);
    runCommand('views.saveFrame');
    expect(sheet(id).frame).toEqual({ center: { x: 2, y: 0 }, height: 6 });
    setLiveView(null);
  });
});

describe('sincronização e persistência', () => {
  it('uma alteração de engenharia muda a representação em todas as vistas', () => {
    const pipeId = drawPipe();
    const plan = views().createPlan();
    const elevation = views().createElevation('south');
    const widthIn = (viewId: string | null): number => {
      const view = sheet(viewId);
      const pipe = project().elements.find((element) => element.id === pipeId);
      const entry = pipe ? viewEntryOf(pipe, viewProjectionOf(project(), view)) : null;
      if (!entry) throw new Error('o tubo deveria aparecer na vista');
      return entry.outline.maxX - entry.outline.minX;
    };
    expect(widthIn(plan)).toBeCloseTo(4, 3);
    expect(widthIn(elevation)).toBeCloseTo(4, 3);
    // As vistas não guardam geometria: são as mesmas depois da alteração do tubo.
    const before = project().views;
    editor().changePipeLength(pipeId, 6.5);
    expect(project().views).toBe(before);
    expect(widthIn(plan)).toBeCloseTo(6.5, 3);
    expect(widthIn(elevation)).toBeCloseTo(6.5, 3);
    // A captura da vista acompanha: a extremidade do tubo está em x = 6,5.
    const snaps = elementSnapPoints(project().elements, viewProjectionOf(project(), sheet(plan)));
    expect(snaps.some((p) => Math.abs(p.x - 6.5) < 1e-6)).toBe(true);
    editor().undo();
    expect(widthIn(plan)).toBeCloseTo(4, 3);
  });

  it('a faixa de corte e a visibilidade só controlam a visualização', () => {
    const pipeId = drawPipe();
    const plan = views().createPlan();
    const shown = (): boolean => {
      const pipe = project().elements.find((element) => element.id === pipeId);
      return pipe ? viewEntryOf(pipe, viewProjectionOf(project(), sheet(plan))) !== null : false;
    };
    expect(shown()).toBe(true);
    // Plano de corte abaixo do tubo (que está a 1 m): ele sai da planta, não do modelo.
    views().change(plan ?? '', { cutHeight: 0.5, depth: 0.6 });
    expect(shown()).toBe(false);
    expect(pipes()).toHaveLength(1);
    expect(validateProject(project())).toEqual([]);
    editor().undo();
    expect(shown()).toBe(true);
  });

  it('vistas e detalhes são gravados no projeto e voltam ao reabrir', () => {
    drawPipe();
    const plan = views().createPlan();
    views().setTool('line');
    views().clickPoint({ x: 0, y: 0 });
    views().clickPoint({ x: 1, y: 1 });
    views().setTool('select');
    views().change(plan ?? '', { scale: 25, style: { theme: 'mono', thinLines: false } });
    setViewFocus({ center: vec3(2, 0, 1), halfHeight: 3 }, vec3(1, -1, 1));
    views().toggleSectionBox();

    const saved = serializeProject(project());
    const reopened = parseProject(saved);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    editor().loadProject(reopened.value, { saved: true });
    // Projeto reaberto: nenhuma vista aberta aponta para o projeto anterior.
    expect(project().views).toEqual(JSON.parse(saved).views);
    expect(project().views.map((view) => view.kind)).toEqual(['plan', '3d']);
    const view = sheet(project().views[0]?.id ?? null);
    expect(view.scale).toBe(25);
    expect(view.style.theme).toBe('mono');
    expect(view.details).toHaveLength(1);
    const model = project().views[1];
    expect(model?.kind === '3d' && model.sectionBox?.enabled).toBe(true);
    expect(editor().past).toHaveLength(0);
  });
});
