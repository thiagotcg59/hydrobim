import {
  angleBetween,
  createProject,
  degToRad,
  getFreePorts,
  radToDeg,
  sub,
  validateProject,
  vec3,
  type Pipe,
} from '@hydrobim/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { previewOf } from '../editor/operationPreview';
import { pickPlanPoint } from '../editor/planPicking';
import { deflectionConstraintOf, drawElevationOf, useEditorStore } from './editorStore';
import { planClosures, planPipeSegment } from './pipePreview';

const state = () => useEditorStore.getState();
const pipes = (): Pipe[] => state().project.elements.filter((e): e is Pipe => e.kind === 'pipe');
const count = (kind: string): number =>
  state().project.elements.filter((e) => e.kind === kind).length;

/** Ponto da planta resolvido como a vista faz (com a trava de ângulo do trecho). */
function planPoint(x: number, y: number) {
  const s = state();
  const pick = pickPlanPoint({
    point: { x, y },
    tolerance: 0.05,
    freePorts: getFreePorts(s.project),
    drawZ: drawElevationOf(s),
    gridStep: 0,
    anchor: s.tool === 'pipe' && s.anchor ? s.anchor : null,
    constraint: deflectionConstraintOf(s),
  });
  if (!pick.ok) throw new Error(pick.error.message);
  return pick.value;
}

/** Deflexão (graus) do último tubo em relação ao anterior. */
function lastDeflection(): number {
  const [previous, last] = pipes().slice(-2);
  if (!previous || !last) throw new Error('faltam tubos');
  return radToDeg(angleBetween(sub(previous.end, previous.start), sub(last.end, last.start)));
}

beforeEach(() => {
  state().loadProject(createProject('Adutora', 'infra'));
  state().setToolOptions({ sizeMode: 'reducers', families: {}, lockElbowAngles: true });
  state().setViewMode('plan');
  state().setTool('pipe');
});

describe('deflexão na junta — ferro fundido dúctil DN 150 (5° por junta)', () => {
  beforeEach(() => {
    state().setActiveSpec('ferro-ductil-nbr7675-k9', 150);
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(6, 0, 0));
  });

  it('a especificação ativa traz o limite do catálogo', () => {
    expect(radToDeg(state().activeSpec.jointDeflection ?? 0)).toBeCloseTo(5);
    expect(radToDeg(deflectionConstraintOf(state())?.jointLimit ?? 0)).toBeCloseTo(5);
  });

  it('trecho com 3° sai sem joelho, conectado, e a mensagem informa a deflexão', () => {
    state().commitPoint(vec3(6 + 6 * Math.cos(degToRad(3)), 6 * Math.sin(degToRad(3)), 0));
    expect(count('pipe')).toBe(2);
    expect(count('elbow')).toBe(0);
    expect(state().project.connections).toHaveLength(1);
    expect(state().message?.text).toBe('Tubo criado com deflexão de 3° na junta (admitida: 5°).');
    expect(lastDeflection()).toBeCloseTo(3);
    expect(validateProject(state().project)).toEqual([]);
    // A polilinha continua: a próxima junta também pode defletir.
    state().commitPoint(vec3(18, 1, 0));
    expect(count('pipe')).toBe(3);
    expect(count('elbow')).toBe(0);
    expect(validateProject(state().project)).toEqual([]);
  });

  it('a prévia anuncia a mesma montagem: um tubo, sem joelho', () => {
    const target = vec3(6 + 6 * Math.cos(degToRad(4)), 6 * Math.sin(degToRad(4)), 0);
    const preview = previewOf(state().project, planPipeSegment(state(), target));
    expect(preview.error).toBeNull();
    expect(preview.created.map((e) => e.kind)).toEqual(['pipe']);
  });

  it('acima do limite e sem joelho desse ângulo: recusado, com o que a junta admite', () => {
    const before = state().project;
    state().commitPoint(vec3(6 + 6 * Math.cos(degToRad(7.5)), 6 * Math.sin(degToRad(7.5)), 0));
    expect(state().project).toBe(before);
    expect(state().message?.level).toBe('error');
    expect(state().message?.text).toContain('Sem peça, a junta admite deflexão de até 5°');
  });

  it('o cursor na planta: reto perto do eixo, livre dentro da junta, limite ou joelho fora', () => {
    const deflectionAt = (degrees: number): number => {
      const pick = planPoint(6 + 6 * Math.cos(degToRad(degrees)), 6 * Math.sin(degToRad(degrees)));
      return radToDeg(angleBetween(vec3(1, 0, 0), sub(pick.point, vec3(6, 0, 0))));
    };
    expect(deflectionAt(0.5)).toBeCloseTo(0);
    expect(deflectionAt(3.4)).toBeCloseTo(3.4);
    expect(deflectionAt(6)).toBeCloseTo(5);
    expect(deflectionAt(10)).toBeCloseTo(11.25);
    expect(deflectionAt(40)).toBeCloseTo(45);
  });
});

describe('deflexão na junta — demais materiais', () => {
  it('PVC PBA admite 1°; acima disso, joelho', () => {
    state().setActiveSpec('pvc-pba-nbr5647-cl15', 100);
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(6, 0, 0));
    state().commitPoint(vec3(12, 6 * Math.tan(degToRad(0.9)), 0));
    expect(count('pipe')).toBe(2);
    expect(state().message?.text).toContain('deflexão de 0,9° na junta (admitida: 1°)');
    const before = state().project;
    const end = pipes().at(-1)?.end ?? vec3(0, 0, 0);
    state().commitPoint(vec3(end.x + 6, end.y + 6 * Math.tan(degToRad(3.5)), 0));
    expect(state().project).toBe(before);
    expect(state().message?.level).toBe('error');
  });

  it('PEAD (termofusão) e PVC soldável não defletem na junta', () => {
    for (const [id, dn] of [
      ['pead-pe100-sdr11', 110],
      ['pvc-soldavel-nbr5648', 50],
    ] as const) {
      state().loadProject(createProject('Rede', 'mep'));
      state().setTool('pipe');
      state().setActiveSpec(id, dn);
      expect(state().activeSpec.jointDeflection).toBeUndefined();
      state().commitPoint(vec3(0, 0, 0));
      state().commitPoint(vec3(6, 0, 0));
      const before = state().project;
      state().commitPoint(vec3(12, 6 * Math.tan(degToRad(2)), 0));
      expect(state().project).toBe(before);
      expect(state().message?.level).toBe('error');
    }
  });
});

describe('ligar extremidades com deflexão nas juntas', () => {
  it('oferece o tubo direto antes do desvio com joelhos e aplica em um passo', () => {
    state().setActiveSpec('ferro-ductil-nbr7675-k9', 150);
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(6, 0, 0));
    state().cancelInteraction();
    state().commitPoint(vec3(12, 0.3, 0));
    state().commitPoint(vec3(18, 0.3, 0));
    state().cancelInteraction();
    const [a, b] = state().project.elements;
    if (!a || !b) throw new Error('sem tubos');
    const plan = planClosures(state(), a.id, b.id)[0];
    expect(plan?.closures[0]?.kind).toBe('deflected');
    if (!plan) return;
    const before = state().project;
    expect(state().closeFreeEnds(plan.a.ref, plan.b.ref, null)).toBe(true);
    expect(state().message?.text).toBe(
      'Extremidades ligadas: 1 tubo com deflexão de 2,86° e 2,86° nas juntas (admitida: 5°).',
    );
    expect(count('pipe')).toBe(3);
    expect(count('elbow')).toBe(0);
    expect(validateProject(state().project)).toEqual([]);
    state().undo();
    expect(state().project).toBe(before);
  });
});
