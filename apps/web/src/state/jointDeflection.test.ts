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

describe('curvatura a frio do tubo — PVC e PEAD', () => {
  /** Ponto a `length` de (6, 0, 0), com desvio `degrees` em planta. */
  const turn = (degrees: number, length = 6) =>
    vec3(6 + length * Math.cos(degToRad(degrees)), length * Math.sin(degToRad(degrees)), 0);

  it('PVC PBA DN 100: até 4,34° entre barras de 6 m; a junta fica alinhada', () => {
    state().setActiveSpec('pvc-pba-nbr5647-cl15', 100);
    expect(state().activeSpec.jointDeflection).toBeUndefined();
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(6, 0, 0));
    expect(radToDeg(deflectionConstraintOf(state())?.jointLimit ?? 0)).toBeCloseTo(4.34, 2);
    state().commitPoint(turn(3));
    expect(count('pipe')).toBe(2);
    expect(count('elbow')).toBe(0);
    expect(state().message?.text).toBe(
      'Tubo criado com curvatura a frio de 3° no vértice (admitida: 4,34°).',
    );
    expect(validateProject(state().project)).toEqual([]);
  });

  it('PVC DEFoFo: o limite cai com o diâmetro (DN 100: 7,63°; DN 300: 1,15°)', () => {
    for (const [dn, accepted, refused] of [
      [100, 7, 8.5],
      [300, 1, 2],
    ] as const) {
      state().loadProject(createProject('Adutora', 'infra'));
      state().setTool('pipe');
      state().setActiveSpec('pvc-defofo-nbr7665', dn);
      state().commitPoint(vec3(0, 0, 0));
      state().commitPoint(vec3(6, 0, 0));
      const before = state().project;
      state().commitPoint(turn(refused));
      expect(state().project).toBe(before);
      expect(state().message?.text).toContain('o tubo, curvado a frio, admite até');
      state().commitPoint(turn(accepted));
      expect(count('pipe')).toBe(2);
      expect(count('elbow')).toBe(0);
      expect(validateProject(state().project)).toEqual([]);
    }
  });

  it('PEAD DE 110: raio de 3,30 m — o desvio depende do comprimento do trecho', () => {
    state().setActiveSpec('pead-pe100-sdr11', 110);
    expect(state().activeSpec.coldBendRadius).toBeCloseTo(3.3);
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(6, 0, 0));
    // Trecho de 0,5 m admite 0,5/3,3 rad = 8,68°: 15° é recusado.
    const before = state().project;
    state().commitPoint(turn(15, 0.5));
    expect(state().project).toBe(before);
    expect(state().message?.text).toContain('admite até 8,68° neste vértice');
    // Trecho de 1 m admite 17,36°.
    state().commitPoint(turn(15, 1));
    expect(count('pipe')).toBe(2);
    expect(state().message?.text).toBe(
      'Tubo criado com curvatura a frio de 15° no vértice (admitida: 17,36°).',
    );
    expect(validateProject(state().project)).toEqual([]);
  });

  it('PEAD: nenhum vértice passa de 22,5°, por mais longos que sejam os trechos', () => {
    state().setActiveSpec('pead-pe100-sdr11', 110);
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(6, 0, 0));
    const before = state().project;
    state().commitPoint(turn(30));
    expect(state().project).toBe(before);
    expect(state().message?.text).toContain('admite até 22,5° neste vértice');
  });

  it('PVC soldável e aço soldado: sem deflexão nem curvatura', () => {
    for (const [id, dn] of [
      ['pvc-soldavel-nbr5648', 50],
      ['aco-carbono-b3610-sch40', 100],
    ] as const) {
      state().loadProject(createProject('Rede', 'mep'));
      state().setTool('pipe');
      state().setActiveSpec(id, dn);
      expect(state().activeSpec.jointDeflection).toBeUndefined();
      expect(state().activeSpec.coldBendRadius).toBeUndefined();
      state().commitPoint(vec3(0, 0, 0));
      state().commitPoint(vec3(6, 0, 0));
      const before = state().project;
      state().commitPoint(turn(2));
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

describe('seleção: tubos sem peça entre eles são um tubo só', () => {
  beforeEach(() => {
    state().setActiveSpec('ferro-ductil-nbr7675-k9', 150);
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(6, 0, 0));
    state().commitPoint(vec3(6 + 6 * Math.cos(degToRad(3)), 6 * Math.sin(degToRad(3)), 0));
    // 45°: aqui o traçado insere um joelho, que encerra a tubulação contínua.
    const end = pipes().at(-1)?.end ?? vec3(0, 0, 0);
    const heading = degToRad(3 + 45);
    state().commitPoint(vec3(end.x + 6 * Math.cos(heading), end.y + 6 * Math.sin(heading), 0));
    state().cancelInteraction();
    state().setTool('select');
  });

  it('clicar em um trecho seleciona todos os ligados só pelo ângulo', () => {
    const [first, second, third] = pipes();
    if (!first || !second || !third) throw new Error('faltam tubos');
    expect(count('elbow')).toBe(1);
    state().select(second.id);
    expect(state().selection).toEqual([first.id, second.id]);
    state().select(first.id);
    expect(state().selection).toEqual([first.id, second.id]);
    // Depois do joelho é outro tubo.
    state().select(third.id);
    expect(state().selection).toEqual([third.id]);
  });

  it('Ctrl+clique soma e retira a tubulação inteira; um trecho isolado sai pelo painel', () => {
    const [first, second, third] = pipes();
    if (!first || !second || !third) throw new Error('faltam tubos');
    state().select(third.id);
    state().select(first.id, true);
    expect(state().selection).toEqual([third.id, first.id, second.id]);
    state().select(second.id, true);
    expect(state().selection).toEqual([third.id]);
    // O painel de propriedades usa `selectMany` para abrir um único trecho.
    state().selectMany([second.id]);
    expect(state().selection).toEqual([second.id]);
  });

  it('excluir a seleção remove a tubulação inteira em um passo de desfazer', () => {
    const [first] = pipes();
    if (!first) throw new Error('sem tubo');
    const before = state().project;
    state().select(first.id);
    state().deleteSelected();
    expect(count('pipe')).toBe(1);
    state().undo();
    expect(state().project).toBe(before);
  });
});
