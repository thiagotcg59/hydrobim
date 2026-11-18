import {
  addPipe,
  createProject,
  degToRad,
  getElement,
  getFreePorts,
  vec3,
  type Pipe,
  type PipeSpec,
  type Project,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { pickPlanPoint, pickPlanPort, planPipeHit, type PlanPickContext } from './planPicking';

const spec: PipeSpec = {
  specificationId: 'test',
  material: 'pvc',
  standard: 'Teste',
  jointType: 'solventWeld',
  pressureClass: null,
  dn: 50,
  sizeLabel: 'DN 50',
  outerDiameter: 0.06,
  wallThickness: 0.003,
  innerDiameter: 0.054,
};

function withPipe(
  project: Project,
  start: [number, number, number],
  end: [number, number, number],
) {
  const result = addPipe(project, { start: vec3(...start), end: vec3(...end), spec });
  if (!result.ok) throw new Error(result.error.message);
  const pipe = getElement(result.value.project, result.value.elementId) as Pipe;
  return { project: result.value.project, pipe };
}

const base: PlanPickContext = {
  point: { x: 1.23, y: 2.38 },
  tolerance: 0.1,
  freePorts: [],
  drawZ: 2.7,
  gridStep: 0.1,
  anchor: null,
  constraint: null,
};

describe('pickPlanPoint', () => {
  it('cria o ponto livre na elevação de desenho, ajustado à grade', () => {
    const pick = pickPlanPoint(base);
    expect(pick.ok && pick.value.snap).toBe('grid');
    if (!pick.ok) return;
    expect(pick.value.point.x).toBeCloseTo(1.2);
    expect(pick.value.point.y).toBeCloseTo(2.4);
    expect(pick.value.point.z).toBe(2.7);

    const free = pickPlanPoint({ ...base, gridStep: 0 });
    expect(free.ok && free.value.snap).toBe('plane');
    expect(free.ok && free.value.point).toEqual(vec3(1.23, 2.38, 2.7));
  });

  it('mantém o trecho na cota da âncora (elevação herdada)', () => {
    const pick = pickPlanPoint({
      ...base,
      anchor: { point: vec3(0, 0, 1.5), lockAxis: null },
    });
    expect(pick.ok && pick.value.point.z).toBe(1.5);
  });

  it('captura a porta livre e devolve a cota real dela', () => {
    const { project } = withPipe(createProject('Teste'), [1, 2, 3], [4, 2, 3]);
    const pick = pickPlanPoint({
      ...base,
      point: { x: 1.04, y: 2.03 },
      freePorts: getFreePorts(project),
    });
    expect(pick.ok).toBe(true);
    if (!pick.ok) return;
    expect(pick.value.snap).toBe('port');
    expect(pick.value.port?.ref.portId).toBe('start');
    expect(pick.value.point).toEqual(vec3(1, 2, 3));
    expect(pick.value.stacked).toBe(1);
  });

  it('desempata portas sobrepostas em planta pela cota mais próxima da elevação', () => {
    // Dois tubos com extremidade no mesmo X/Y, em cotas diferentes (prumadas distintas).
    const low = withPipe(createProject('Teste'), [0, 0, 0], [3, 0, 0]);
    const both = withPipe(low.project, [0, 0, 3], [3, 0, 3]);
    const ports = getFreePorts(both.project);

    const atLow = pickPlanPort({ x: 0.02, y: 0 }, ports, 0.1, 0.2);
    expect(atLow?.stacked).toBe(2);
    expect(atLow?.port.ref.elementId).toBe(low.pipe.id);

    const atHigh = pickPlanPort({ x: 0.02, y: 0 }, ports, 0.1, 2.9);
    expect(atHigh?.stacked).toBe(2);
    expect(atHigh?.port.ref.elementId).toBe(both.pipe.id);

    // Com um trecho em andamento, a referência é a cota da âncora.
    const chained = pickPlanPoint({
      ...base,
      drawZ: 0,
      point: { x: 3, y: 0.02 },
      freePorts: ports,
      anchor: { point: vec3(3, 4, 3), lockAxis: null },
    });
    expect(chained.ok && chained.value.port?.ref.elementId).toBe(both.pipe.id);
    expect(pickPlanPort({ x: 1.5, y: 1 }, ports, 0.1, 0)).toBeNull();

    // Escolha manual: cada passo avança para a próxima sobreposta e volta ao início.
    const next = pickPlanPort({ x: 0.02, y: 0 }, ports, 0.1, 0.2, 1);
    expect(next?.port.ref.elementId).toBe(both.pipe.id);
    const around = pickPlanPort({ x: 0.02, y: 0 }, ports, 0.1, 0.2, 2);
    expect(around?.port.ref.elementId).toBe(low.pipe.id);
  });

  it('segue o eixo travado de uma conexão, inclusive inclinado', () => {
    const horizontal = pickPlanPoint({
      ...base,
      point: { x: 2.32, y: 0.9 },
      anchor: { point: vec3(1, 0, 1), lockAxis: vec3(1, 0, 0) },
    });
    expect(horizontal.ok && horizontal.value.snap).toBe('axis');
    expect(horizontal.ok && horizontal.value.point.x).toBeCloseTo(2.3);
    expect(horizontal.ok && horizontal.value.point.y).toBeCloseTo(0);

    // Eixo a 45° para cima: 1 m em planta corresponde a √2 m ao longo do eixo.
    const s = Math.SQRT1_2;
    const sloped = pickPlanPoint({
      ...base,
      gridStep: 0,
      point: { x: 2, y: 0.5 },
      anchor: { point: vec3(1, 0, 1), lockAxis: vec3(s, 0, s) },
    });
    expect(sloped.ok).toBe(true);
    if (!sloped.ok) return;
    expect(sloped.value.point.x).toBeCloseTo(2);
    expect(sloped.value.point.z).toBeCloseTo(2);

    // Atrás da porta: o trecho não recua.
    const behind = pickPlanPoint({
      ...base,
      point: { x: 0, y: 0 },
      anchor: { point: vec3(1, 0, 1), lockAxis: vec3(1, 0, 0) },
    });
    expect(behind.ok && behind.value.point).toEqual(vec3(1, 0, 1));
  });

  it('recusa o eixo travado vertical, que não é definível em planta', () => {
    const pick = pickPlanPoint({
      ...base,
      anchor: { point: vec3(1, 0, 1), lockAxis: vec3(0, 0, 1) },
    });
    expect(pick.ok).toBe(false);
    expect(!pick.ok && pick.error.code).toBe('VERTICAL_AXIS_IN_PLAN');
  });

  it('trava a direção nos ângulos de catálogo, na cota da âncora', () => {
    const pick = pickPlanPoint({
      ...base,
      point: { x: 3.2, y: 1.9 },
      anchor: { point: vec3(3, 0, 1), lockAxis: null },
      constraint: {
        origin: vec3(3, 0, 1),
        axis: vec3(1, 0, 0),
        angles: [degToRad(45), degToRad(90)],
      },
    });
    expect(pick.ok).toBe(true);
    if (!pick.ok) return;
    expect(pick.value.snap).toBe('angle');
    expect(pick.value.point.x).toBeCloseTo(3);
    expect(pick.value.point.y).toBeCloseTo(1.9);
    expect(pick.value.point.z).toBeCloseTo(1);
  });
});

describe('planPipeHit', () => {
  it('projeta o clique sobre o eixo real de um tubo inclinado', () => {
    const { pipe } = withPipe(createProject('Teste'), [0, 0, 0], [4, 0, 2]);
    const hit = planPipeHit(pipe, { x: 1, y: 0.3 });
    expect(hit.ok && hit.value).toEqual(vec3(1, 0, 0.5));
    // Fora do trecho: limita às extremidades.
    const past = planPipeHit(pipe, { x: 9, y: 0 });
    expect(past.ok && past.value).toEqual(vec3(4, 0, 2));
  });

  it('recusa o tubo vertical com código estável', () => {
    const { pipe } = withPipe(createProject('Teste'), [1, 1, 0], [1, 1, 3]);
    const hit = planPipeHit(pipe, { x: 1, y: 1 });
    expect(hit.ok).toBe(false);
    expect(!hit.ok && hit.error.code).toBe('PIPE_VERTICAL_IN_PLAN');
  });
});
