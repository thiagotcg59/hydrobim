import { createProject, validateProject, vec3, type Pipe } from '@hydrobim/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { moveTargetOf, planMove, useEditorStore } from './editorStore';

const state = () => useEditorStore.getState();
const pipes = () => state().project.elements.filter((e): e is Pipe => e.kind === 'pipe');

/** Trecho em L (tubo, joelho, tubo) a partir da origem; devolve os ids dos tubos. */
function drawBend(): string[] {
  state().setTool('pipe');
  state().commitPoint(vec3(0, 0, 0));
  state().commitPoint(vec3(3, 0, 0));
  state().commitPoint(vec3(3, 2, 0));
  state().setTool('select');
  return pipes().map((p) => p.id);
}

/** Tubo solto de 2 m em X, em y = 5. */
function drawLoose(): string {
  state().setTool('pipe');
  state().commitPoint(vec3(0, 5, 0));
  state().commitPoint(vec3(2, 5, 0));
  state().setTool('select');
  const pipe = pipes().find((p) => p.start.y === 5);
  if (!pipe) throw new Error('tubo ausente');
  return pipe.id;
}

beforeEach(() => {
  state().loadProject(createProject('Teste', 'mep'));
  state().setToolOptions({ sizeMode: 'reducers', families: {}, lockElbowAngles: false });
});

describe('mover interativo (ponto-base e destino)', () => {
  it('sem seleção não começa; com seleção, pede o ponto-base e depois o destino', () => {
    state().startMove();
    expect(state().tool).toBe('select');
    expect(state().message?.text).toContain('Selecione');

    const id = drawLoose();
    state().select(id);
    state().startMove();
    expect(state().tool).toBe('move');
    expect(state().move).toEqual({ ids: [id], from: null, withConnected: false });

    const history = state().past.length;
    state().commitPoint(vec3(0, 5, 0));
    expect(state().move?.from).toEqual(vec3(0, 5, 0));
    // A prévia é a mesma operação da confirmação e não altera o projeto.
    const move = state().move;
    if (!move) throw new Error('sem mover');
    const preview = planMove(state().project, move, vec3(1, 7, 0));
    expect(preview?.ok).toBe(true);
    expect(pipes().find((p) => p.id === id)?.start).toEqual(vec3(0, 5, 0));

    state().commitPoint(vec3(1, 7, 0));
    const moved = pipes().find((p) => p.id === id);
    expect(moved?.start).toEqual(vec3(1, 7, 0));
    expect(moved?.end).toEqual(vec3(3, 7, 0));
    // Um passo no histórico; a ferramenta volta a Selecionar com o elemento selecionado.
    expect(state().past).toHaveLength(history + 1);
    expect(state().tool).toBe('select');
    expect(state().move).toBeNull();
    expect(state().selection).toEqual([id]);
    // A confirmação grava a geometria da prévia (só o carimbo de tempo difere).
    expect(preview?.ok && preview.value.elements.map((e) => e.kind === 'pipe' && e.start)).toEqual(
      state().project.elements.map((e) => e.kind === 'pipe' && e.start),
    );
    expect(validateProject(state().project).filter((i) => i.severity === 'error')).toEqual([]);

    state().undo();
    expect(pipes().find((p) => p.id === id)?.start).toEqual(vec3(0, 5, 0));
  });

  it('no plano o deslocamento é horizontal; porta ou vertical mudam a cota', () => {
    const from = vec3(1, 1, 0.5);
    expect(moveTargetOf(from, vec3(4, 2, 0), 'grid')).toEqual(vec3(4, 2, 0.5));
    expect(moveTargetOf(from, vec3(4, 2, 0), 'plane')).toEqual(vec3(4, 2, 0.5));
    expect(moveTargetOf(from, vec3(4, 2, 0), 'port')).toEqual(vec3(4, 2, 0));
    expect(moveTargetOf(from, vec3(1, 1, 3), 'vertical')).toEqual(vec3(1, 1, 3));
  });

  it('recusa o que os tubos ligados não absorvem; com a rede ligada, move o conjunto', () => {
    const [first] = drawBend();
    if (!first) throw new Error('tubo ausente');
    const before = state().project;
    state().selectMany([first]);
    state().startMove();
    state().commitPoint(vec3(0, 0, 0));
    // Deslocar o primeiro tubo para o lado (+Y) obrigaria o joelho a sair do lugar.
    state().commitPoint(vec3(0, 1, 0));
    expect(state().project).toBe(before);
    expect(state().message?.level).toBe('error');
    // O mover continua, aguardando outro destino.
    expect(state().tool).toBe('move');
    expect(state().move?.from).toEqual(vec3(0, 0, 0));

    state().setMoveWithConnected(true);
    state().commitPoint(vec3(0, 1, 0));
    expect(state().tool).toBe('select');
    const ys = pipes().map((p) => [p.start.y, p.end.y]);
    expect(ys.flat().every((y) => y >= 1 - 1e-9)).toBe(true);
    expect(state().project.connections).toHaveLength(before.connections.length);
    expect(validateProject(state().project).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('Esc volta ao ponto-base; o segundo Esc encerra sem alterar o projeto', () => {
    const id = drawLoose();
    const before = state().project;
    state().startMove([id]);
    state().commitPoint(vec3(0, 5, 0));
    state().cancelInteraction();
    expect(state().move?.from).toBeNull();
    expect(state().tool).toBe('move');
    state().cancelInteraction();
    expect(state().tool).toBe('select');
    expect(state().move).toBeNull();
    expect(state().project).toBe(before);
  });
});
