import { describe, expect, it } from 'vitest';
import { arePortsAligned, getElement, resolvePort } from './connectivity';
import { distance, vec3 } from './math';
import { addPipe, createProject, drawPipe, insertInline } from './operations';
import { pipeLength } from './ports';
import type { Result } from './result';
import type { Fitting, Pipe, Project } from './schema';
import { slideAxesOf, slideElements, stretchPipe } from './slide';
import { testSpec } from './testSupport';
import { validateProject } from './validation';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

const spec50 = testSpec(50);

function pipeOf(project: Project, id: string): Pipe {
  const element = getElement(project, id);
  if (!element || element.kind !== 'pipe') throw new Error('não é tubo');
  return element;
}

function fittingOf(project: Project, id: string): Fitting {
  const element = getElement(project, id);
  if (!element || element.kind === 'pipe') throw new Error('não é conexão');
  return element;
}

/** Todas as conexões acopladas e nenhuma pendência de validação. */
function expectSound(project: Project): void {
  for (const c of project.connections) {
    const a = resolvePort(project, c.a);
    const b = resolvePort(project, c.b);
    expect(a && b && arePortsAligned(a, b)).toBe(true);
  }
  expect(validateProject(project).filter((i) => i.severity === 'error')).toEqual([]);
}

/** Tubo de 4 m em X com uma válvula em linha a 2 m: [primeiro trecho, válvula, segundo trecho]. */
function lineWithValve(): { project: Project; first: string; valve: string; second: string } {
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
  const second = inserted.createdIds.find((id) => id !== inserted.elementId);
  if (!second) throw new Error('segundo trecho ausente');
  return { project: inserted.project, first: base.elementId, valve: inserted.elementId, second };
}

describe('esticar e encolher tubos', () => {
  it('move a extremidade livre ao longo do eixo, nos dois sentidos e nas duas pontas', () => {
    const { project, elementId } = unwrap(
      addPipe(createProject('Teste'), { start: vec3(1, 0, 0), end: vec3(3, 0, 0), spec: spec50 }),
    );
    const longer = unwrap(stretchPipe(project, elementId, 'end', 3.5));
    expect(pipeOf(longer, elementId).end).toEqual(vec3(4.5, 0, 0));
    expect(pipeOf(longer, elementId).start).toEqual(vec3(1, 0, 0));

    const shorter = unwrap(stretchPipe(longer, elementId, 'start', 1));
    expect(pipeOf(shorter, elementId).start.x).toBeCloseTo(3.5);
    expect(pipeOf(shorter, elementId).end).toEqual(vec3(4.5, 0, 0));
    expect(pipeOf(shorter, elementId).id).toBe(elementId);
    expectSound(shorter);
    // O projeto recebido não é alterado.
    expect(pipeOf(project, elementId).end).toEqual(vec3(3, 0, 0));
  });

  it('recusa comprimento inválido e elemento que não é tubo', () => {
    const { project, first, valve } = lineWithValve();
    expect(stretchPipe(project, first, 'end', 0)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_LENGTH' },
    });
    expect(stretchPipe(project, first, 'end', Number.NaN)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_LENGTH' },
    });
    expect(stretchPipe(project, valve, 'end', 1)).toMatchObject({
      ok: false,
      error: { code: 'NOT_A_PIPE' },
    });
  });

  it('extremidade ligada a uma válvula: a válvula desliza e o tubo seguinte compensa', () => {
    const { project, first, valve, second } = lineWithValve();
    const before = pipeLength(pipeOf(project, first));
    const total = before + pipeLength(pipeOf(project, second));
    const next = unwrap(stretchPipe(project, first, 'end', before + 0.5));

    expect(pipeLength(pipeOf(next, first))).toBeCloseTo(before + 0.5);
    expect(pipeLength(pipeOf(next, first)) + pipeLength(pipeOf(next, second))).toBeCloseTo(total);
    expect(fittingOf(next, valve).placement.position.x).toBeCloseTo(
      fittingOf(project, valve).placement.position.x + 0.5,
    );
    // As extremidades da linha não saem do lugar.
    expect(pipeOf(next, first).start).toEqual(vec3(0, 0, 0));
    expect(pipeOf(next, second).end).toEqual(vec3(4, 0, 0));
    expect(next.connections).toEqual(project.connections);
    expectSound(next);
  });

  it('recusa quando o tubo vizinho ficaria sem comprimento', () => {
    const { project, first } = lineWithValve();
    const result = stretchPipe(project, first, 'end', 10);
    expect(result).toMatchObject({ ok: false, error: { code: 'NO_ROOM' } });
  });

  it('extremidade ligada a um joelho: o joelho e o trecho seguinte acompanham', () => {
    const a = unwrap(
      addPipe(createProject('Teste'), { start: vec3(0, 0, 0), end: vec3(3, 0, 0), spec: spec50 }),
    );
    const b = unwrap(
      drawPipe(a.project, {
        fromPort: { elementId: a.elementId, portId: 'end' },
        start: vec3(3, 0, 0),
        end: vec3(3, 2, 0),
        spec: spec50,
      }),
    );
    const before = pipeLength(pipeOf(b.project, a.elementId));
    const next = unwrap(stretchPipe(b.project, a.elementId, 'end', before + 1));

    expect(pipeLength(pipeOf(next, a.elementId))).toBeCloseTo(before + 1);
    // O trecho perpendicular é transladado inteiro, sem mudar de comprimento.
    expect(pipeOf(next, b.elementId).end).toEqual(vec3(4, 2, 0));
    expect(pipeLength(pipeOf(next, b.elementId))).toBeCloseTo(
      pipeLength(pipeOf(b.project, b.elementId)),
    );
    expectSound(next);
  });

  it('emenda entre dois tubos alinhados: a emenda se desloca e o vizinho compensa', () => {
    const a = unwrap(
      addPipe(createProject('Teste'), { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec: spec50 }),
    );
    const b = unwrap(
      addPipe(a.project, { start: vec3(2, 0, 0), end: vec3(5, 0, 0), spec: spec50 }),
    );
    expect(b.project.connections).toHaveLength(1);

    const next = unwrap(stretchPipe(b.project, a.elementId, 'end', 3));
    expect(pipeOf(next, a.elementId).end).toEqual(vec3(3, 0, 0));
    expect(pipeOf(next, b.elementId).start).toEqual(vec3(3, 0, 0));
    expect(pipeOf(next, b.elementId).end).toEqual(vec3(5, 0, 0));
    expectSound(next);

    // Além do fim do vizinho não há espaço.
    expect(stretchPipe(b.project, a.elementId, 'end', 6)).toMatchObject({
      ok: false,
      error: { code: 'NO_ROOM' },
    });
  });
});

describe('deslizar peças ao longo da linha', () => {
  it('informa os eixos de deslizamento de tubos e conexões', () => {
    const { project, first, valve } = lineWithValve();
    expect(slideAxesOf(project, first)).toEqual([vec3(1, 0, 0)]);
    const axes = slideAxesOf(project, valve);
    expect(axes).toHaveLength(1);
    expect(Math.abs(axes[0]?.x ?? 0)).toBeCloseTo(1);
    expect(slideAxesOf(project, 'inexistente')).toEqual([]);
  });

  it('desliza a válvula nos dois sentidos, preservando o comprimento total da linha', () => {
    const { project, first, valve, second } = lineWithValve();
    const x0 = fittingOf(project, valve).placement.position.x;
    const forward = unwrap(slideElements(project, [valve], vec3(0.3, 0, 0)));
    expect(fittingOf(forward, valve).placement.position.x).toBeCloseTo(x0 + 0.3);
    const back = unwrap(slideElements(forward, [valve], vec3(-0.8, 0, 0)));
    expect(fittingOf(back, valve).placement.position.x).toBeCloseTo(x0 - 0.5);
    expect(pipeOf(back, first).start).toEqual(vec3(0, 0, 0));
    expect(pipeOf(back, second).end).toEqual(vec3(4, 0, 0));
    expect(fittingOf(back, valve).id).toBe(valve);
    expectSound(back);
    expect(fittingOf(project, valve).placement.position.x).toBeCloseTo(x0);
  });

  it('recusa passar do fim do tubo e deslocamentos inválidos', () => {
    const { project, valve } = lineWithValve();
    expect(slideElements(project, [valve], vec3(5, 0, 0))).toMatchObject({
      ok: false,
      error: { code: 'NO_ROOM' },
    });
    expect(slideElements(project, [valve], vec3(Number.NaN, 0, 0))).toMatchObject({
      ok: false,
      error: { code: 'INVALID_POINT' },
    });
    expect(slideElements(project, ['inexistente'], vec3(1, 0, 0))).toMatchObject({
      ok: false,
      error: { code: 'ELEMENT_NOT_FOUND' },
    });
    expect(slideElements(project, [], vec3(1, 0, 0)).ok).toBe(false);
  });

  it('tê em linha: a derivação conectada acompanha o deslizamento', () => {
    const base = unwrap(
      addPipe(createProject('Teste'), { start: vec3(0, 0, 0), end: vec3(4, 0, 0), spec: spec50 }),
    );
    const tee = unwrap(
      insertInline(base.project, {
        pipeId: base.elementId,
        distanceFromStart: 2,
        fitting: { kind: 'tee' },
      }),
    );
    const branch = resolvePort(tee.project, { elementId: tee.elementId, portId: 'branch' });
    if (!branch) throw new Error('derivação ausente');
    const drawn = unwrap(
      drawPipe(tee.project, {
        fromPort: branch.ref,
        start: branch.position,
        end: addScaled(branch.position, branch.direction, 1.5),
        spec: spec50,
      }),
    );
    const before = pipeOf(drawn.project, drawn.elementId);
    const next = unwrap(slideElements(drawn.project, [tee.elementId], vec3(0.4, 0, 0)));
    const after = pipeOf(next, drawn.elementId);
    expect(after.start.x).toBeCloseTo(before.start.x + 0.4);
    expect(after.end.x).toBeCloseTo(before.end.x + 0.4);
    expect(pipeLength(after)).toBeCloseTo(pipeLength(before));
    expect(distance(pipeOf(next, base.elementId).start, vec3(0, 0, 0))).toBeCloseTo(0);
    expectSound(next);
  });

  it('desliza um tubo solto ao longo do próprio eixo', () => {
    const { project, elementId } = unwrap(
      addPipe(createProject('Teste'), { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec: spec50 }),
    );
    const next = unwrap(slideElements(project, [elementId], vec3(0.5, 0, 0)));
    expect(pipeOf(next, elementId).start).toEqual(vec3(0.5, 0, 0));
    expect(pipeOf(next, elementId).end).toEqual(vec3(2.5, 0, 0));
    expectSound(next);
  });
});

function addScaled(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  amount: number,
): { x: number; y: number; z: number } {
  return {
    x: origin.x + direction.x * amount,
    y: origin.y + direction.y * amount,
    z: origin.z + direction.z * amount,
  };
}
