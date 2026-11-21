import {
  arePortsAligned,
  createProject,
  degToRad,
  resolvePort,
  validateProject,
  vec3,
  type Pipe,
  type Project,
} from '@hydrobim/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  elementOriginOf,
  rotationAngleOf,
  rotationSweepOf,
  selectionCenterOf,
  useEditorStore,
} from './editorStore';

const state = () => useEditorStore.getState();
const pipes = () => state().project.elements.filter((e): e is Pipe => e.kind === 'pipe');

/** Trecho em L: tubo, joelho e tubo, de (0,0) a (3,0) e (3,2); mais uma válvula em linha. */
function drawNetwork(): void {
  state().setTool('pipe');
  state().commitPoint(vec3(0, 0, 0));
  state().commitPoint(vec3(3, 0, 0));
  state().commitPoint(vec3(3, 2, 0));
  state().setTool('select');
  const first = pipes()[0];
  if (!first) throw new Error('tubo ausente');
  state().insertFittingInline('valve', first.id, 1);
}

function expectCoupled(project: Project): void {
  for (const c of project.connections) {
    const a = resolvePort(project, c.a);
    const b = resolvePort(project, c.b);
    expect(a && b && arePortsAligned(a, b)).toBe(true);
  }
  expect(validateProject(project).filter((i) => i.severity === 'error')).toEqual([]);
}

beforeEach(() => {
  state().loadProject(createProject('Teste', 'mep'));
  state().setToolOptions({ sizeMode: 'reducers', families: {}, lockElbowAngles: false });
});

describe('girar em planta com a rede ligada', () => {
  it('ângulo pelo cursor: a partir de +X, anti-horário, de 15° em 15°', () => {
    const c = vec3(1, 1, 0);
    expect(rotationAngleOf(c, vec3(1, 3, 0))).toBeCloseTo(degToRad(90));
    expect(rotationAngleOf(c, vec3(-1, 1.1, 0))).toBeCloseTo(degToRad(180));
    expect(rotationAngleOf(c, vec3(2, 1.27, 0))).toBeCloseTo(degToRad(15));
    expect(rotationAngleOf(c, vec3(1, 1, 5))).toBeNull();
  });

  it('girar a válvula leva tubos, joelho e válvula juntos, em um passo do histórico', () => {
    drawNetwork();
    const valve = state().project.elements.find((e) => e.kind === 'valve');
    if (!valve) throw new Error('válvula ausente');
    const before = state().project;
    const count = before.elements.length;
    state().select(valve.id);
    state().startRotate();
    expect(state().tool).toBe('rotate');
    expect(state().rotate?.withConnected).toBe(true);

    // O centro começa no meio da seleção (a válvula); raio inicial a leste e final ao norte.
    const origin = elementOriginOf(state().project, valve.id);
    if (!origin) throw new Error('sem origem');
    expect(state().rotate?.center?.x).toBeCloseTo(origin.x);
    expect(state().rotate?.center?.y).toBeCloseTo(origin.y);
    state().setRotateCenter(origin);
    const history = state().past.length;
    state().commitPoint(vec3(origin.x + 2, origin.y, 0));
    expect(state().rotate?.reference).toBeCloseTo(0);
    expect(state().past).toHaveLength(history);
    state().commitPoint(vec3(origin.x, origin.y + 2, 0));

    expect(state().tool).toBe('select');
    expect(state().past).toHaveLength(history + 1);
    expect(state().project.elements).toHaveLength(count);
    expect(state().project.connections).toEqual(before.connections);
    // O primeiro tubo, que ia de x = 0 em +X, passa a correr em Y a partir de (1, -1).
    const first = pipes().find((p) => p.id === before.elements.find((e) => e.kind === 'pipe')?.id);
    expect(first?.start.x).toBeCloseTo(1);
    expect(first?.start.y).toBeCloseTo(-1);
    expect(state().message?.text).toContain('girados 90°');
    expectCoupled(state().project);

    state().undo();
    expect(state().project).toBe(before);
  });

  it('sem a rede ligada, recusa o giro que romperia ligações e continua no girar', () => {
    drawNetwork();
    const valve = state().project.elements.find((e) => e.kind === 'valve');
    if (!valve) throw new Error('válvula ausente');
    const before = state().project;
    state().startRotate([valve.id]);
    state().setRotateWithConnected(false);
    state().setRotateCenter(vec3(1, 0, 0));
    expect(state().applyRotation(degToRad(90))).toBe(false);
    expect(state().project).toBe(before);
    expect(state().message?.level).toBe('error');
    expect(state().tool).toBe('rotate');
    // Com a rede ligada, o mesmo giro é aceito.
    state().setRotateWithConnected(true);
    expect(state().applyRotation(degToRad(-90))).toBe(true);
    expectCoupled(state().project);
  });

  it('Esc volta ao raio inicial; o segundo Esc encerra sem alterar o projeto', () => {
    drawNetwork();
    const before = state().project;
    state().startRotate([before.elements[0]?.id ?? '']);
    state().setRotateCenter(vec3(0, 0, 0));
    state().commitPoint(vec3(1, 1, 0));
    expect(state().rotate?.reference).toBeCloseTo(Math.PI / 4);
    state().cancelInteraction();
    expect(state().rotate?.reference).toBeNull();
    expect(state().rotate?.center).not.toBeNull();
    state().cancelInteraction();
    expect(state().tool).toBe('select');
    expect(state().rotate).toBeNull();
    expect(state().project).toBe(before);
  });

  it('giro relativo ao raio inicial, de 15° em 15°, no intervalo (−180°, 180°]', () => {
    const c = vec3(0, 0, 0);
    const north = degToRad(90);
    expect(rotationSweepOf(c, north, vec3(-1, 0, 0))).toBeCloseTo(degToRad(90));
    expect(rotationSweepOf(c, north, vec3(1, 0.02, 0))).toBeCloseTo(degToRad(-90));
    expect(rotationSweepOf(c, degToRad(170), vec3(1, -0.5, 0))).toBeCloseTo(degToRad(165));
    expect(rotationSweepOf(c, north, c)).toBeNull();
  });

  it('centro da seleção: meio da envoltória das portas', () => {
    drawNetwork();
    const ids = state().project.elements.map((e) => e.id);
    const center = selectionCenterOf(state().project, ids);
    expect(center?.x).toBeCloseTo(1.5);
    expect(center?.y).toBeCloseTo(1);
    expect(selectionCenterOf(state().project, ['x'])).toBeNull();
  });

  it('Copiar: gira uma cópia da rede e mantém os originais, com as cópias selecionadas', () => {
    drawNetwork();
    const before = state().project;
    const first = pipes()[0];
    if (!first) throw new Error('tubo ausente');
    state().startRotate([first.id]);
    state().setRotateCopy(true);
    state().setRotateCenter(vec3(10, 10, 0));
    expect(state().applyRotation(degToRad(180))).toBe(true);
    const after = state().project;
    expect(after.elements).toHaveLength(before.elements.length * 2);
    for (const element of before.elements) {
      expect(after.elements.find((e) => e.id === element.id)).toEqual(element);
    }
    expect(state().selection).toHaveLength(before.elements.length);
    expect(state().selection.every((id) => !before.elements.some((e) => e.id === id))).toBe(true);
    expect(state().message?.text).toContain('copiado');
    expectCoupled(after);
  });

  it('Espaço: gira a seleção 90° em torno do centro dela, com a rede ligada', () => {
    drawNetwork();
    const before = state().project;
    const ids = before.elements.map((e) => e.id);
    state().selectMany(ids);
    expect(state().rotateSelectionQuarter()).toBe(true);
    expect(state().past.length).toBeGreaterThan(0);
    const center = selectionCenterOf(state().project, ids);
    expect(center?.x).toBeCloseTo(1.5);
    expect(center?.y).toBeCloseTo(1);
    const turned = pipes().find((p) => p.id === pipes()[0]?.id);
    // (0,0) gira em torno de (1.5, 1) para (2.5, -0.5).
    expect(turned?.start.x).toBeCloseTo(2.5);
    expect(turned?.start.y).toBeCloseTo(-0.5);
    expectCoupled(state().project);
    state().select(null);
    expect(state().rotateSelectionQuarter()).toBe(false);
  });
});
