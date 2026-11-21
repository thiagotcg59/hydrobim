import { resolvePipeSpec } from '@hydrobim/catalog';
import {
  addPipe,
  attachFitting,
  connectedComponent,
  createProject,
  distance,
  findConnection,
  getElement,
  validateProject,
  vec3,
  type PortRef,
  type Result,
} from '@hydrobim/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { chosenCandidate, useEditorStore } from './editorStore';

const state = () => useEditorStore.getState();

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** Mesma cota nas pontas; a pequena declividade do destino afasta os eixos em 11 mm. */
function scenario() {
  const spec = resolvePipeSpec('ferro-ductil-nbr7675-k9', 150);
  if (!spec) throw new Error('Especificação DN 150 ausente.');
  const from = must(
    addPipe(createProject('Ligação entre eixos reversos'), {
      start: vec3(-3, 0, 665.153),
      end: vec3(0, 0, 665.153),
      spec,
      name: 'Trecho do reservatório',
    }),
  );
  // O reservatório impede que uma simples translação da rede esconda a falta de percurso.
  const tank = must(
    attachFitting(from.project, {
      target: { elementId: from.elementId, portId: 'start' },
      fitting: { kind: 'tank', diameter: 2, height: 2 },
    }),
  );
  const to = must(
    addPipe(tank.project, {
      start: vec3(4, 10.2, 665.153 + (0.011 * 3) / 7.2),
      end: vec3(4, 7.2, 665.153),
      spec,
      name: 'Trecho de referência',
    }),
  );
  return {
    project: to.project,
    from: { elementId: from.elementId, portId: 'end' } satisfies PortRef,
    to: { elementId: to.elementId, portId: 'end' } satisfies PortRef,
    tankId: tank.elementId,
  };
}

beforeEach(() => {
  state().setToolOptions({ families: {}, lockElbowAngles: true });
});

describe('Alinhar e conectar: percurso entre eixos reversos', () => {
  it('mostra a montagem sem mover o reservatório e confirma a prévia num único passo', () => {
    const setup = scenario();
    state().loadProject(setup.project);
    state().setTool('connect');
    state().pickConnectPort(setup.from);
    state().pickConnectPort(setup.to);

    const plan = state().connect.plan?.result;
    expect(plan?.ok).toBe(true);
    if (!plan?.ok) throw new Error('Plano de ligação ausente.');
    expect(plan.value.guides.relation).toBe('skew');
    expect(plan.value.guides.from.position.z).toBe(plan.value.guides.to.position.z);
    expect(distance(plan.value.guides.meet!.onFrom, plan.value.guides.meet!.onTo)).toBeCloseTo(
      0.011,
      5,
    );

    const route = plan.value.candidates.find((candidate) => candidate.key === 'route:orthogonal');
    expect(route?.connects).toBe(true);
    expect(route?.movedIds).toEqual([]);
    if (!route) throw new Error('Percurso alternativo ausente.');
    state().setConnectChoice(route.key);
    expect(chosenCandidate(state().connect)).toBe(route);
    expect(state().project).toBe(setup.project);
    expect(state().past).toHaveLength(0);
    const newElbows = route.project.elements.filter(
      (element) => element.kind === 'elbow' && route.createdIds.includes(element.id),
    );
    expect(newElbows.length).toBeGreaterThan(0);
    expect(newElbows.every((element) => element.familyId !== null)).toBe(true);

    expect(state().confirmConnection()).toBe(true);
    expect(state().project).toBe(route.project);
    expect(state().past).toHaveLength(1);
    expect(findConnection(state().project, setup.from)).toBeDefined();
    expect(findConnection(state().project, setup.to)).toBeDefined();
    expect(connectedComponent(state().project, setup.tankId)).toContain(setup.to.elementId);
    for (const original of setup.project.elements) {
      expect(getElement(state().project, original.id)).toEqual(original);
    }
    expect(validateProject(state().project).filter((issue) => issue.severity === 'error')).toEqual(
      [],
    );
    state().undo();
    expect(state().project).toBe(setup.project);
    state().redo();
    expect(state().project).toBe(route.project);
  });

  it('recomeçar descarta só a prévia, preservando o projeto e o histórico', () => {
    const setup = scenario();
    state().loadProject(setup.project);
    state().setTool('connect');
    state().pickConnectPort(setup.from);
    state().pickConnectPort(setup.to);
    expect(chosenCandidate(state().connect)?.connects).toBe(true);

    state().resetConnection();
    expect(chosenCandidate(state().connect)).toBeNull();
    expect(state().connect.from).toBeNull();
    expect(state().connect.to).toBeNull();
    expect(state().project).toBe(setup.project);
    expect(state().past).toHaveLength(0);
  });
});
