import {
  createProject,
  findConnection,
  getElement,
  resolvePort,
  validateProject,
  vec3,
  type Project,
} from '@hydrobim/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { chosenCandidate, useEditorStore } from './editorStore';
import { planPipeTarget } from './pipePreview';

/**
 * Fluxos da interface sobre o núcleo: derivação com tê/cruzeta pela Tubulação, conversão
 * tê ⇄ cruzeta pelo painel e "Alinhar e conectar". Cada montagem é um passo único no
 * histórico; a confirmação grava exatamente a prévia; cancelar preserva o projeto.
 */

const state = () => useEditorStore.getState();
const errors = (project: Project) =>
  validateProject(project).filter((issue) => issue.severity === 'error');
const kinds = (project: Project, kind: string) => project.elements.filter((e) => e.kind === kind);

/** Coletor PBA DN 75 em X, de 0 a 4 m, desenhado pela Tubulação. */
function collector(): string {
  state().setActiveSpec('pvc-pba-nbr5647-cl15', 75);
  state().setTool('pipe');
  state().commitPoint(vec3(0, 0, 0));
  state().commitPoint(vec3(4, 0, 0));
  state().cancelInteraction();
  const pipe = kinds(state().project, 'pipe')[0];
  if (!pipe) throw new Error('coletor ausente');
  return pipe.id;
}

beforeEach(() => {
  state().loadProject(createProject('Derivações', 'infra'));
  state().setToolOptions({ families: {}, lockElbowAngles: true, junction: 'auto' });
});

describe('Tubulação: derivação com tê ou cruzeta', () => {
  it('Cruzeta escolhida: a quarta porta fica livre; desfazer e refazer num passo só', () => {
    const pipeId = collector();
    state().setToolOptions({ junction: 'cross' });
    state().setTool('pipe');
    state().commitPoint(vec3(2, 2, 0));
    const before = state().project;
    const depth = state().past.length;
    // A prévia é a mesma operação da confirmação.
    const planned = planPipeTarget(state(), pipeId);
    expect(planned.ok ? '' : planned.error.message).toBe('');
    state().finishPipeOnPipe(pipeId);
    const after = state().project;
    expect(state().past.length).toBe(depth + 1);
    const [cross] = kinds(after, 'cross');
    expect(cross?.familyId).toBe('wavin-cruzeta-pba@pvc-pba-nbr5647-cl15');
    expect(
      findConnection(after, { elementId: cross?.id ?? '', portId: 'branch2' }),
    ).toBeUndefined();
    expect(errors(after)).toEqual([]);
    if (planned.ok) {
      expect(planned.value.elements.map((e) => e.kind).sort()).toEqual(
        after.elements.map((e) => e.kind).sort(),
      );
    }
    state().undo();
    expect(state().project).toBe(before);
    state().redo();
    expect(state().project).toBe(after);
  });

  it('Automática: ramal no lado oposto do tê o converte em cruzeta (mesmo id)', () => {
    const pipeId = collector();
    state().setTool('pipe');
    state().commitPoint(vec3(2, 2, 0));
    state().finishPipeOnPipe(pipeId);
    const [tee] = kinds(state().project, 'tee');
    if (!tee) throw new Error('tê ausente');
    state().setTool('pipe');
    state().commitPoint(vec3(2, -2, 0));
    state().finishPipeOnJunction(tee.id);
    const converted = getElement(state().project, tee.id);
    expect(converted?.kind).toBe('cross');
    expect(state().message?.text).toMatch(/convertido em cruzeta/);
    expect(errors(state().project)).toEqual([]);
    // "Tê" recusa o lado oposto, sem alterar nada.
    state().undo();
    const before = state().project;
    state().setToolOptions({ junction: 'tee' });
    state().setTool('pipe');
    state().commitPoint(vec3(2, -2, 0));
    state().finishPipeOnJunction(tee.id);
    expect(state().project).toBe(before);
    expect(state().message?.level).toBe('error');
  });
});

describe('Converter tê ⇄ cruzeta pelo painel', () => {
  it('prévia, confirmação exata, cancelamento e desfazer', () => {
    const pipeId = collector();
    state().setTool('pipe');
    state().commitPoint(vec3(2, 2, 0));
    state().finishPipeOnPipe(pipeId);
    state().setTool('select');
    const [tee] = kinds(state().project, 'tee');
    if (!tee) throw new Error('tê ausente');
    const before = state().project;

    state().previewJunction(tee.id, null);
    state().cancelJunction();
    expect(state().project).toBe(before);

    state().previewJunction(tee.id, null);
    const preview = state().junctionPreview;
    expect(preview?.result.ok).toBe(true);
    expect(state().confirmJunction()).toBe(true);
    if (preview?.result.ok) expect(state().project).toBe(preview.result.value.project);
    expect(getElement(state().project, tee.id)?.kind).toBe('cross');
    state().undo();
    expect(state().project).toBe(before);
  });
});

describe('Alinhar e conectar', () => {
  it('liga duas extremidades por joelho e grava exatamente a alternativa escolhida', () => {
    state().setActiveSpec('pvc-pba-nbr5647-cl15', 75);
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(2, 0, 0));
    state().cancelInteraction();
    state().commitPoint(vec3(4, 3, 0));
    state().commitPoint(vec3(4, 1.5, 0));
    state().cancelInteraction();
    const [a, b] = kinds(state().project, 'pipe');
    if (!a || !b) throw new Error('tubos ausentes');
    const before = state().project;

    state().setTool('connect');
    state().pickConnectPort({ elementId: a.id, portId: 'end' });
    state().pickConnectPort({ elementId: b.id, portId: 'end' });
    const plan = state().connect.plan?.result;
    expect(plan?.ok ? '' : plan?.error.message).toBe('');
    if (!plan?.ok) return;
    expect(plan.value.guides.relation).toBe('crossing');
    const candidate = chosenCandidate(state().connect);
    expect(candidate?.key).toBe('elbow:90');
    expect(state().project).toBe(before);
    expect(state().confirmConnection()).toBe(true);
    expect(state().project).toBe(candidate?.project);
    expect(findConnection(state().project, { elementId: b.id, portId: 'end' })).toBeDefined();
    expect(errors(state().project)).toEqual([]);
    state().undo();
    expect(state().project).toBe(before);
    // A porta de referência não se move: só o trecho de partida é prolongado.
    state().redo();
    expect(resolvePort(state().project, { elementId: b.id, portId: 'end' })?.position).toEqual(
      resolvePort(before, { elementId: b.id, portId: 'end' })?.position,
    );
  });
});
