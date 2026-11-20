import {
  AXIS_X,
  AXIS_Y,
  AXIS_Z,
  createProject,
  distance,
  validateProject,
  vec3,
  type Pipe,
} from '@hydrobim/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { arrowPreferences } from '../editor/directEdit';
import { useEditorStore } from './editorStore';

const state = () => useEditorStore.getState();
const pipes = () => state().project.elements.filter((e): e is Pipe => e.kind === 'pipe');
const key = (name: string) => arrowPreferences(name, AXIS_X, AXIS_Y, AXIS_Z) ?? [];

/** Tubo de 4 m em X; devolve o seu id. */
function drawLine(): string {
  state().setTool('pipe');
  state().commitPoint(vec3(0, 0, 0));
  state().commitPoint(vec3(4, 0, 0));
  state().setTool('select');
  const pipe = pipes()[0];
  if (!pipe) throw new Error('tubo ausente');
  return pipe.id;
}

beforeEach(() => {
  state().loadProject(createProject('Teste', 'mep'));
  state().setToolOptions({ sizeMode: 'reducers', families: {}, lockElbowAngles: false });
  state().setSnapToGrid(true);
  state().setGridStep(0.1);
});

describe('alça de comprimento do tubo', () => {
  it('estica com prévia ao vivo e registra um único passo no histórico', () => {
    const id = drawLine();
    const history = state().past.length;
    state().beginStretch(id, 'end');
    state().stretchTo(vec3(4.6, 0.4, 0));
    state().stretchTo(vec3(5.52, 0.4, 0));
    // Prévia: o projeto já mostra o novo comprimento (ajustado à grade), sem histórico.
    expect(pipes()[0]?.end.x).toBeCloseTo(5.5);
    expect(state().past).toHaveLength(history);
    state().endStretch(true);
    expect(state().stretch).toBeNull();
    expect(state().past).toHaveLength(history + 1);
    expect(state().message?.text).toContain('5,500 m');
    expect(validateProject(state().project)).toEqual([]);

    state().undo();
    expect(pipes()[0]?.end.x).toBeCloseTo(4);
  });

  it('encolhe pela extremidade inicial e cancela com Esc', () => {
    const id = drawLine();
    state().beginStretch(id, 'start');
    state().stretchTo(vec3(1.5, 0, 0));
    expect(pipes()[0]?.start.x).toBeCloseTo(1.5);
    const history = state().past.length;
    state().cancelInteraction();
    expect(state().stretch).toBeNull();
    expect(pipes()[0]?.start.x).toBeCloseTo(0);
    expect(state().past).toHaveLength(history);
  });

  it('não deixa o arrasto passar da extremidade oposta nem do tubo vizinho', () => {
    const id = drawLine();
    state().setTool('valve');
    state().insertFittingInline('valve', id, 2);
    state().setTool('select');
    const before = pipes().map((p) => distance(p.start, p.end));

    state().beginStretch(id, 'end');
    state().stretchTo(vec3(-1, 0, 0)); // aquém do início: ignorado
    expect(
      distance(pipes()[0]?.start ?? vec3(0, 0, 0), pipes()[0]?.end ?? vec3(0, 0, 0)),
    ).toBeCloseTo(before[0] ?? 0);
    state().stretchTo(vec3(9, 0, 0)); // além do fim da linha: recusado
    expect(state().message?.level).toBe('error');
    expect(pipes().map((p) => distance(p.start, p.end))).toEqual(before);

    // Dentro do espaço disponível, a válvula desliza e o segundo trecho compensa.
    state().stretchTo(vec3(2.5, 0, 0));
    state().endStretch(true);
    const total = pipes().reduce((sum, p) => sum + distance(p.start, p.end), 0);
    expect(total).toBeCloseTo((before[0] ?? 0) + (before[1] ?? 0));
    expect(pipes()[0]?.end.x).toBeCloseTo(2.5);
    expect(validateProject(state().project)).toEqual([]);
  });
});

describe('setas do teclado', () => {
  it('deslizam a válvula ao longo do tubo, no sentido da seta', () => {
    const id = drawLine();
    state().setTool('valve');
    state().insertFittingInline('valve', id, 2);
    state().setTool('select');
    const valve = state().project.elements.find((e) => e.kind === 'valve');
    if (!valve || valve.kind !== 'valve') throw new Error('válvula ausente');
    const x0 = valve.placement.position.x;
    state().select(valve.id);

    const x = (): number => {
      const live = state().project.elements.find((e) => e.id === valve.id);
      return live && live.kind !== 'pipe' ? live.placement.position.x : Number.NaN;
    };
    state().nudgeSelection(key('ArrowRight'), 0.1);
    expect(x()).toBeCloseTo(x0 + 0.1);
    state().nudgeSelection(key('ArrowLeft'), 0.1);
    state().nudgeSelection(key('ArrowLeft'), 0.1);
    expect(x()).toBeCloseTo(x0 - 0.1);
    // Seta perpendicular ao tubo também desliza (cima = sentido positivo).
    state().nudgeSelection(key('ArrowUp'), 1);
    expect(x()).toBeCloseTo(x0 + 0.9);
    expect(state().message?.level).toBe('success');
    expect(validateProject(state().project)).toEqual([]);

    // Sem espaço: erro e nada muda.
    const project = state().project;
    state().nudgeSelection(key('ArrowRight'), 10);
    expect(state().message?.level).toBe('error');
    expect(state().project).toBe(project);
  });

  it('deslizam um tubo solto e não fazem nada sem seleção', () => {
    const id = drawLine();
    const project = state().project;
    state().select(null);
    state().nudgeSelection(key('ArrowRight'), 0.1);
    expect(state().project).toBe(project);

    state().select(id);
    state().nudgeSelection(key('ArrowLeft'), 0.5);
    expect(pipes()[0]?.start.x).toBeCloseTo(-0.5);
    expect(pipes()[0]?.end.x).toBeCloseTo(3.5);
  });
});

describe('menu de contexto: criar tubo', () => {
  it('aciona a ferramenta Tubo já partindo da extremidade livre', () => {
    const id = drawLine();
    state().openContextMenu({
      x: 10,
      y: 10,
      elementId: id,
      port: { elementId: id, portId: 'end' },
    });
    expect(state().contextMenu).not.toBeNull();
    state().startPipeFromPort({ elementId: id, portId: 'end' });
    expect(state().contextMenu).toBeNull();
    expect(state().tool).toBe('pipe');
    expect(state().anchor?.port).toEqual({ elementId: id, portId: 'end' });
    expect(state().anchor?.point).toEqual(vec3(4, 0, 0));

    // O próximo ponto cria o trecho conectado à extremidade.
    state().commitPoint(vec3(6, 0, 0));
    expect(pipes()).toHaveLength(2);
    expect(state().project.connections).toHaveLength(1);
    expect(validateProject(state().project)).toEqual([]);
  });

  it('recusa partir de uma extremidade já conectada; Esc fecha o menu', () => {
    const id = drawLine();
    state().startPipeFromPort({ elementId: id, portId: 'end' });
    state().commitPoint(vec3(6, 0, 0));
    state().setTool('select');
    state().startPipeFromPort({ elementId: id, portId: 'end' });
    expect(state().tool).toBe('select');
    expect(state().message?.level).toBe('error');

    state().openContextMenu({ x: 10, y: 10, elementId: id, port: null });
    state().select(id);
    state().cancelInteraction();
    expect(state().contextMenu).toBeNull();
    // O primeiro Esc só fecha o menu: a seleção permanece.
    expect(state().selection).toEqual([id]);
  });
});
