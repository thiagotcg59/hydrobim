import {
  addPipe,
  createProject,
  degToRad,
  getElement,
  vec3,
  type Pipe,
  type Project,
  validateProject,
} from '@hydrobim/core';
import { defaultPipeSpec } from '@hydrobim/catalog';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  alignAngleOf,
  alignGuidesOf,
  alignStepOf,
  alignTargetOf,
  planAlign,
  type AlignState,
} from './alignTool';
import { useEditorStore } from './editorStore';

const EMPTY: AlignState = {
  ids: [],
  source1: null,
  target1: null,
  source2: null,
  withConnected: true,
  copy: false,
};

function onePipe(): { project: Project; id: string } {
  const created = addPipe(createProject('Teste'), {
    start: vec3(0, 0, 0),
    end: vec3(2, 0, 0),
    spec: defaultPipeSpec('mep'),
  });
  if (!created.ok) throw new Error(created.error.message);
  return { project: created.value.project, id: created.value.elementId };
}

function pipeOf(project: Project, id: string): Pipe {
  const element = getElement(project, id);
  if (element?.kind !== 'pipe') throw new Error('tubo ausente');
  return element;
}

describe('alinhar por pontos (estado da ferramenta)', () => {
  it('as etapas seguem a ordem origem 1, destino 1, origem 2, destino 2', () => {
    expect(alignStepOf(EMPTY)).toBe('source1');
    const s1 = { ...EMPTY, source1: vec3(0, 0, 0) };
    expect(alignStepOf(s1)).toBe('target1');
    const t1 = { ...s1, target1: vec3(1, 0, 0) };
    expect(alignStepOf(t1)).toBe('source2');
    expect(alignStepOf({ ...t1, source2: vec3(2, 0, 0) })).toBe('target2');
  });

  it('o destino fora de porta mantém a cota da origem; sobre porta vale inteiro', () => {
    expect(alignTargetOf(vec3(0, 0, 1.5), vec3(3, 4, 0), 'grid')).toEqual(vec3(3, 4, 1.5));
    expect(alignTargetOf(vec3(0, 0, 1.5), vec3(3, 4, 0), 'port')).toEqual(vec3(3, 4, 0));
  });

  it('linhas auxiliares acompanham o cursor na etapa em curso', () => {
    const cursor = vec3(5, 5, 0);
    expect(alignGuidesOf(EMPTY, cursor)).toEqual([]);
    const s1 = { ...EMPTY, source1: vec3(0, 0, 0) };
    expect(alignGuidesOf(s1, cursor)).toEqual([{ from: s1.source1, to: cursor, label: '1' }]);
    const s2 = { ...s1, target1: vec3(1, 0, 0), source2: vec3(2, 0, 0) };
    expect(alignGuidesOf(s2, cursor).map((g) => g.label)).toEqual(['1', '2']);
  });

  it('a prévia e a confirmação usam a mesma operação; com cópia os originais ficam', () => {
    const { project, id } = onePipe();
    const align: AlignState = {
      ...EMPTY,
      ids: [id],
      source1: vec3(0, 0, 0),
      target1: vec3(10, 10, 0),
      source2: vec3(2, 0, 0),
    };
    expect(planAlign(project, { ...align, target1: null }, [id], null)).toBeNull();
    expect(alignAngleOf(align, vec3(10, 12, 0))).toBeCloseTo(degToRad(90));
    const result = planAlign(project, align, [id], vec3(10, 12, 0));
    if (!result?.ok) throw new Error('alinhamento recusado');
    const pipe = pipeOf(result.value, id);
    expect(pipe.start.x).toBeCloseTo(10);
    expect(pipe.end.y).toBeCloseTo(12);
    const copied = planAlign(project, { ...align, copy: true }, [id], vec3(10, 12, 0));
    if (!copied?.ok) throw new Error('cópia recusada');
    expect(copied.value.elements).toHaveLength(2);
    expect(pipeOf(copied.value, id)).toEqual(pipeOf(project, id));
  });
});

describe('alinhar por pontos (fluxo no editor)', () => {
  const state = () => useEditorStore.getState();

  beforeEach(() => {
    state().loadProject(createProject('Teste', 'mep'));
    state().setToolOptions({ sizeMode: 'reducers', families: {}, lockElbowAngles: false });
    // Trecho em L: tubo, joelho e tubo.
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(3, 0, 0));
    state().commitPoint(vec3(3, 2, 0));
    state().setTool('select');
  });

  it('quatro pontos alinham a rede ligada num só passo do histórico; Esc desfaz o último', () => {
    const first = state().project.elements.find((e) => e.kind === 'pipe');
    if (!first) throw new Error('tubo ausente');
    state().select(first.id);
    state().startAlign();
    expect(state().tool).toBe('align');
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(10, 0, 0));
    state().cancelInteraction();
    expect(state().align?.target1).toBeNull();
    state().commitPoint(vec3(10, 0, 0));
    state().commitPoint(vec3(1, 0, 0));
    const past = state().past.length;
    state().commitPoint(vec3(10, -5, 0));
    expect(state().tool).toBe('select');
    expect(state().past.length).toBe(past + 1);
    const pipe = pipeOf(state().project, first.id);
    expect(pipe.start.x).toBeCloseTo(10);
    expect(pipe.end.y).toBeLessThan(-1);
    expect(state().project.elements).toHaveLength(3);
    expect(validateProject(state().project).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('sem a rede ligada, o giro que rompe a ligação é recusado e o alinhar continua', () => {
    const first = state().project.elements.find((e) => e.kind === 'pipe');
    if (!first) throw new Error('tubo ausente');
    state().startAlign([first.id]);
    state().setAlignWithConnected(false);
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(1, 0, 0));
    const before = state().project;
    expect(state().applyAlign(vec3(0, 1, 0))).toBe(false);
    expect(state().project).toBe(before);
    expect(state().tool).toBe('align');
    // Só o primeiro par (nulo): nada a alterar.
    expect(state().applyAlign(null)).toBe(false);
  });
});
