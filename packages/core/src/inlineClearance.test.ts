import { describe, expect, it } from 'vitest';
import { arePortsAligned, getElement, resolvePort } from './connectivity';
import { inlineAxisOf, inlineClearancesOf, setInlineClearance } from './inlineClearance';
import { distance, vec3 } from './math';
import { addPipe, createProject, drawPipe, insertInline } from './operations';
import type { Result } from './result';
import type { Project } from './schema';
import { testSpec } from './testSupport';
import { validateProject } from './validation';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

const spec50 = testSpec(50);

function expectSound(project: Project): void {
  for (const c of project.connections) {
    const a = resolvePort(project, c.a);
    const b = resolvePort(project, c.b);
    expect(a && b && arePortsAligned(a, b)).toBe(true);
  }
  expect(validateProject(project).filter((i) => i.severity === 'error')).toEqual([]);
}

/**
 * Pórtico como o da figura: tubo horizontal de 4 m em X com joelhos nas duas pontas descendo
 * em Z, e uma válvula na linha a 1,5 m do início.
 */
function portal(): { project: Project; valve: string; elbows: string[] } {
  const base = unwrap(
    addPipe(createProject('Teste'), { start: vec3(0, 0, 2), end: vec3(4, 0, 2), spec: spec50 }),
  );
  const right = unwrap(
    drawPipe(base.project, {
      fromPort: { elementId: base.elementId, portId: 'end' },
      start: vec3(4, 0, 2),
      end: vec3(4, 0, 0),
      spec: spec50,
    }),
  );
  const left = unwrap(
    drawPipe(right.project, {
      fromPort: { elementId: base.elementId, portId: 'start' },
      start: vec3(0, 0, 2),
      end: vec3(0, 0, 0),
      spec: spec50,
    }),
  );
  const valve = unwrap(
    insertInline(left.project, {
      pipeId: base.elementId,
      distanceFromStart: 1.5,
      fitting: { kind: 'valve' },
    }),
  );
  const elbows = valve.project.elements.filter((e) => e.kind === 'elbow').map((e) => e.id);
  expect(elbows).toHaveLength(2);
  return { project: valve.project, valve: valve.elementId, elbows };
}

describe('cotas de peças na linha', () => {
  it('mede, de cada extremidade da válvula, o tubo até o joelho seguinte', () => {
    const { project, valve, elbows } = portal();
    const clearances = inlineClearancesOf(project, valve);
    expect(clearances.map((c) => c.portId)).toEqual(['a', 'b']);
    for (const clearance of clearances) {
      expect(clearance.target.kind).toBe('element');
      if (clearance.target.kind === 'element') {
        expect(elbows).toContain(clearance.target.elementId);
      }
      expect(clearance.straight).toBe(true);
      expect(clearance.pipeIds).toHaveLength(1);
      // Porta a porta: o comprimento é o do tubo entre as duas peças.
      expect(clearance.length).toBeCloseTo(distance(clearance.from, clearance.to), 9);
      expect(clearance.length).toBeGreaterThan(0);
    }
    const [a, b] = clearances;
    if (!a || !b) throw new Error('cotas ausentes');
    // As duas cotas mais o comprimento da válvula fecham a distância entre os joelhos.
    expect(a.length + distance(a.from, b.from) + b.length).toBeCloseTo(distance(a.to, b.to), 9);
  });

  it('desliza a válvula para a cota informada, preservando identificadores e ligações', () => {
    const { project, valve } = portal();
    const before = inlineClearancesOf(project, valve);
    const [a0, b0] = before;
    if (!a0 || !b0) throw new Error('cotas ausentes');
    const next = unwrap(setInlineClearance(project, valve, 'a', 1));
    const [a1, b1] = inlineClearancesOf(next, valve);
    expect(a1?.length).toBeCloseTo(1, 9);
    // O que um lado perde o outro ganha; os joelhos não saem do lugar.
    expect(b1?.length).toBeCloseTo(b0.length + (a0.length - 1), 9);
    expect(a1?.to).toEqual(a0.to);
    expect(b1?.to).toEqual(b0.to);
    expect(next.elements.map((e) => e.id).sort()).toEqual(project.elements.map((e) => e.id).sort());
    expect(next.connections).toEqual(project.connections);
    expectSound(next);
    // Projeto de entrada intacto.
    expect(inlineClearancesOf(project, valve)[0]?.length).toBeCloseTo(a0.length, 9);
  });

  it('ajusta pela outra extremidade e aceita a cota atual sem alterar nada', () => {
    const { project, valve } = portal();
    const next = unwrap(setInlineClearance(project, valve, 'b', 0.75));
    expect(inlineClearancesOf(next, valve)[1]?.length).toBeCloseTo(0.75, 9);
    expectSound(next);
    const same = inlineClearancesOf(project, valve)[0]?.length ?? 0;
    expect(unwrap(setInlineClearance(project, valve, 'a', same))).toBe(project);
  });

  it('recusa cota sem espaço na linha, negativa ou em elemento que não é peça', () => {
    const { project, valve } = portal();
    const tooFar = setInlineClearance(project, valve, 'a', 10);
    expect(tooFar.ok).toBe(false);
    if (!tooFar.ok) expect(tooFar.error.code).toBe('NO_ROOM');
    const negative = setInlineClearance(project, valve, 'a', -1);
    expect(!negative.ok && negative.error.code).toBe('INVALID_LENGTH');
    const pipe = project.elements.find((e) => e.kind === 'pipe');
    const notFitting = setInlineClearance(project, pipe?.id ?? '', 'start', 1);
    expect(!notFitting.ok && notFitting.error.code).toBe('ELEMENT_NOT_FOUND');
    expect(inlineClearancesOf(project, pipe?.id ?? '')).toEqual([]);
  });

  it('termina na extremidade livre quando não há peça adiante', () => {
    const base = unwrap(
      addPipe(createProject('Teste'), { start: vec3(0, 0, 0), end: vec3(4, 0, 0), spec: spec50 }),
    );
    const inserted = unwrap(
      insertInline(base.project, {
        pipeId: base.elementId,
        distanceFromStart: 2,
        fitting: { kind: 'valve' },
      }),
    );
    const clearances = inlineClearancesOf(inserted.project, inserted.elementId);
    expect(clearances.map((c) => c.target.kind)).toEqual(['free', 'free']);
    const total = clearances.reduce((sum, c) => sum + c.length, 0);
    const valve = getElement(inserted.project, inserted.elementId);
    expect(valve?.kind).toBe('valve');
    const [a, b] = clearances;
    expect(total + distance(a?.from ?? vec3(0, 0, 0), b?.from ?? vec3(0, 0, 0))).toBeCloseTo(4, 9);
  });

  it('identifica o eixo de passagem só em peças com portas opostas', () => {
    const { project, valve, elbows } = portal();
    const axis = inlineAxisOf(project, valve);
    expect(axis && Math.abs(axis.x)).toBeCloseTo(1, 9);
    expect(inlineAxisOf(project, elbows[0] ?? '')).toBeNull();
  });
});
