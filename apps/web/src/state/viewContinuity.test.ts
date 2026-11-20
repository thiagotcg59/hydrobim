import { createProject, vec3 } from '@hydrobim/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { getViewFocus, setViewFocus } from '../editor/viewPresets';
import { useEditorStore } from './editorStore';

const state = () => useEditorStore.getState();

beforeEach(() => {
  state().loadProject(createProject('Teste', 'mep'));
  state().setOrthographic(false);
});

describe('continuidade entre a planta e o modelo 3D', () => {
  it('mantém a ferramenta e o trecho em andamento ao trocar de vista', () => {
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(2, 0, 0));
    const anchor = state().anchor;
    expect(anchor?.port?.portId).toBe('end');
    const nonce = state().viewRequest?.nonce;

    state().setViewMode('plan');
    expect(state().tool).toBe('pipe');
    expect(state().anchor).toBe(anchor);
    // Sem novo pedido de enquadramento: a vista retoma o ponto de interesse.
    expect(state().viewRequest?.nonce).toBe(nonce);

    // O trecho começado no 3D termina na planta, e vice-versa.
    state().commitPoint(vec3(2, 2, 0));
    state().setViewMode('3d');
    expect(state().tool).toBe('pipe');
    state().commitPoint(vec3(4, 2, 0));
    expect(state().project.elements.filter((e) => e.kind === 'pipe')).toHaveLength(3);
    expect(state().project.elements.filter((e) => e.kind === 'elbow')).toHaveLength(2);
    // Um passo de desfazer por trecho, qualquer que seja a vista em que foi criado.
    state().undo();
    expect(state().project.elements.filter((e) => e.kind === 'pipe')).toHaveLength(2);
  });

  it('mantém a medição em andamento e encerra as ferramentas de documentação fora da planta', () => {
    state().setTool('measure');
    state().commitPoint(vec3(1, 1, 0));
    state().setViewMode('plan');
    expect(state().tool).toBe('measure');
    expect(state().measure.a).toEqual(vec3(1, 1, 0));

    state().setTool('dimension');
    state().setViewMode('3d');
    expect(state().tool).toBe('select');
  });

  it('a aba BIM / IFC entra e sai em Selecionar, reenquadrando', () => {
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 0));
    const nonce = state().viewRequest?.nonce ?? 0;
    state().setViewMode('bim');
    expect(state().tool).toBe('select');
    expect(state().anchor).toBeNull();
    expect(state().viewRequest?.nonce).toBe(nonce + 1);
  });

  it('abrir outro projeto esquece o ponto de interesse', () => {
    setViewFocus({ center: vec3(5, 5, 0), halfHeight: 2 });
    state().loadProject(createProject('Outro', 'infra'));
    expect(getViewFocus()).toBeNull();
  });
});

describe('vistas do modelo 3D', () => {
  it('a isométrica liga a projeção ortográfica e gira de quadrante a cada comando', () => {
    state().requestIsometric();
    expect(state().orthographic).toBe(true);
    expect(state().viewRequest?.preset).toBe('isoSE');
    expect(state().message?.text).toContain('sudeste');
    state().requestIsometric();
    expect(state().viewRequest?.preset).toBe('isoSW');
    state().requestIsometric();
    state().requestIsometric();
    state().requestIsometric();
    expect(state().viewRequest?.preset).toBe('isoSE');
  });

  it('a perspectiva é um comando separado e sai da ortográfica', () => {
    state().requestIsometric();
    state().requestView('iso');
    expect(state().orthographic).toBe(false);
    // De volta à isométrica, recomeça no sudeste.
    state().requestIsometric();
    expect(state().viewRequest?.preset).toBe('isoSE');
  });

  it('trocar a projeção não reenquadra e o enquadramento pode ser só da seleção', () => {
    const nonce = state().viewRequest?.nonce ?? 0;
    state().setOrthographic(true);
    expect(state().viewRequest?.nonce).toBe(nonce);
    state().requestView('fit', { selection: true });
    expect(state().viewRequest).toMatchObject({ preset: 'fit', selection: true });
    state().requestView('fit');
    expect(state().viewRequest?.selection).toBeUndefined();
  });
});
