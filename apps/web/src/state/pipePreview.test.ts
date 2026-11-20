import { createProject, getFreePorts, validateProject, vec3, type Pipe } from '@hydrobim/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { diffProjects, previewOf } from '../editor/operationPreview';
import { resolveSegmentEntry } from '../editor/segmentEntry';
import { useEditorStore } from './editorStore';
import { planClosures, planPipeSegment } from './pipePreview';

const state = () => useEditorStore.getState();
const kindsOf = (elements: readonly { kind: string }[]): string[] =>
  elements.map((e) => e.kind).sort();

beforeEach(() => {
  state().loadProject(createProject('Teste', 'mep'));
  state().setToolOptions({ sizeMode: 'reducers', families: {}, lockElbowAngles: true });
  state().setTool('pipe');
});

describe('prévia do trecho: mesmas regras da confirmação', () => {
  it('a prévia e a confirmação produzem as mesmas peças', () => {
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(3, 0, 0));
    const before = state().project;
    const planned = planPipeSegment(state(), vec3(3, 2, 0));
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const preview = diffProjects(before, planned.value);
    // Planejar não altera o projeto nem o histórico.
    expect(state().project).toBe(before);
    const undoDepth = state().past.length;

    state().commitPoint(vec3(3, 2, 0));
    const applied = diffProjects(before, state().project);
    expect(state().past.length).toBe(undoDepth + 1);
    expect(kindsOf(preview.created)).toEqual(kindsOf(applied.created));
    expect(kindsOf(preview.created)).toEqual(['elbow', 'pipe']);
    expect(preview.modified.map((e) => e.id)).toEqual(applied.modified.map((e) => e.id));
    expect(preview.summary).toBe(applied.summary);
    // Peças de catálogo, como na confirmação.
    expect(preview.created.find((e) => e.kind === 'elbow')?.familyId).not.toBeNull();
  });

  it('a recusa da prévia é a mesma mensagem da confirmação', () => {
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(3, 0, 0));
    const before = state().project;
    // 60° não tem joelho de catálogo.
    const target = vec3(4, Math.tan(Math.PI / 3), 0);
    const preview = previewOf(before, planPipeSegment(state(), target));
    expect(preview.error).toContain('Ângulos disponíveis');
    state().commitPoint(target);
    expect(state().project).toBe(before);
    expect(state().message?.text).toBe(preview.error);
  });

  it('aplica a política de catálogo na prévia (especificação sem joelho)', () => {
    state().setActiveSpec('pead-pe100-sdr11', 50);
    state().setToolOptions({ lockElbowAngles: false });
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(3, 0, 0));
    expect(planPipeSegment(state(), vec3(3, 2, 0)).ok).toBe(true);
    state().setToolOptions({ lockElbowAngles: true });
    const refused = planPipeSegment(state(), vec3(3, 2, 0));
    expect(refused.ok).toBe(false);
  });

  it('sem trecho em andamento não há o que planejar', () => {
    const planned = planPipeSegment(state(), vec3(1, 0, 0));
    expect(!planned.ok && planned.error.code).toBe('NO_ANCHOR');
  });

  it('entrada por valores: o ponto resolvido segue para a mesma operação do clique', () => {
    state().commitPoint(vec3(0, 0, 0.3));
    state().commitPoint(vec3(3, 0, 0.3));
    const anchor = state().anchor;
    if (!anchor) throw new Error('sem âncora');
    // 2,40 m a 90° para o lado do cursor.
    const target = resolveSegmentEntry(
      { anchor: anchor.point, axis: vec3(1, 0, 0), cursor: vec3(3.5, 1, 0.3) },
      { length: 2.4, deflection: Math.PI / 2 },
    );
    if (!target.ok) throw new Error(target.error.message);
    state().commitPoint(target.value);
    const last = state()
      .project.elements.filter((e): e is Pipe => e.kind === 'pipe')
      .at(-1);
    expect(last?.end.x).toBeCloseTo(3);
    expect(last?.end.y).toBeCloseTo(2.4);
    expect(last?.end.z).toBeCloseTo(0.3);
    expect(validateProject(state().project)).toEqual([]);
  });
});

describe('fechamento entre extremidades pela store', () => {
  /** Dois tubos paralelos desalinhados, de frente um para o outro. */
  function parallel(): { a: string; b: string } {
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(1, 0, 0));
    state().cancelInteraction();
    state().commitPoint(vec3(5, 1, 0));
    state().commitPoint(vec3(6, 1, 0));
    state().cancelInteraction();
    const [a, b] = state().project.elements;
    if (!a || !b) throw new Error('sem tubos');
    return { a: a.id, b: b.id };
  }

  it('lista as soluções com peças de catálogo e aplica a escolhida', () => {
    const { a, b } = parallel();
    const plans = planClosures(state(), a, b);
    // Só o par de extremidades de frente uma para a outra tem solução.
    const solved = plans.filter((plan) => plan.closures.length > 0);
    expect(solved).toHaveLength(1);
    expect(plans[0]).toBe(solved[0]);
    const plan = solved[0]!;
    expect(plan.closures.length).toBeGreaterThanOrEqual(2);
    for (const closure of plan.closures) {
      const elbows = closure.project.elements.filter((e) => e.kind === 'elbow');
      expect(elbows).toHaveLength(2);
      expect(elbows.every((e) => e.familyId !== null)).toBe(true);
    }
    const chosen = plan.closures.find((c) => Math.abs((c.angle ?? 0) - Math.PI / 4) < 1e-6);
    expect(chosen).toBeDefined();

    const before = state().project;
    expect(state().closeFreeEnds(plan.a.ref, plan.b.ref, Math.PI / 4)).toBe(true);
    expect(state().message?.text).toContain('2 joelhos de 45°');
    const elbows = state().project.elements.filter((e) => e.kind === 'elbow');
    expect(elbows).toHaveLength(2);
    expect(getFreePorts(state().project)).toHaveLength(2);
    expect(validateProject(state().project)).toEqual([]);
    // Um único passo de desfazer devolve o projeto anterior.
    state().undo();
    expect(state().project).toBe(before);
  });

  it('explica a recusa e não altera o projeto', () => {
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(1, 0, 0));
    state().cancelInteraction();
    state().commitPoint(vec3(3, 2, 0.5));
    state().commitPoint(vec3(3, 4, 0.5));
    state().cancelInteraction();
    const [a, b] = state().project.elements;
    const plans = planClosures(state(), a!.id, b!.id);
    expect(plans.every((plan) => plan.closures.length === 0)).toBe(true);
    expect(plans.some((plan) => plan.error?.includes('não se cruzam'))).toBe(true);

    const before = state().project;
    const skew = plans.find((plan) => plan.error?.includes('não se cruzam'))!;
    expect(state().closeFreeEnds(skew.a.ref, skew.b.ref, null)).toBe(false);
    expect(state().project).toBe(before);
    expect(state().message?.level).toBe('error');
  });

  it('com "somente peças de catálogo", descarta a solução que criaria joelho genérico', () => {
    // PEAD não tem joelho de catálogo. O desalinhamento (45°) passa do que a curvatura a frio
    // do tubo admite num vértice, de modo que só restaria o desvio com joelhos genéricos.
    state().setActiveSpec('pead-pe100-sdr11', 50);
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(1, 0, 0));
    state().cancelInteraction();
    state().commitPoint(vec3(4, 3, 0));
    state().commitPoint(vec3(5, 3, 0));
    state().cancelInteraction();
    const [first, second] = state().project.elements;
    if (!first || !second) throw new Error('sem tubos');
    const a = first.id;
    const b = second.id;
    const plans = planClosures(state(), a, b);
    expect(plans.every((plan) => plan.closures.length === 0)).toBe(true);
    expect(plans.some((plan) => plan.error?.includes('peça de dimensões genéricas'))).toBe(true);
    state().setToolOptions({ lockElbowAngles: false });
    expect(planClosures(state(), a, b).some((plan) => plan.closures.length > 0)).toBe(true);
  });
});
