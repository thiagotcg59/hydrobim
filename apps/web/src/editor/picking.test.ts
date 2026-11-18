import { addPipe, createProject, getFreePorts, vec3, type PipeSpec } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { distanceAlongPipe, pickPoint, type PickContext } from './picking';

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

const base: PickContext = {
  ray: { origin: vec3(1.23, 2.38, 10), direction: vec3(0, 0, -1) },
  freePorts: [],
  workPlaneZ: 0,
  gridStep: 0.1,
  anchor: null,
  vertical: false,
};

describe('pickPoint', () => {
  it('projeta no plano de trabalho e ajusta à grade', () => {
    const hit = pickPoint(base);
    expect(hit?.snap).toBe('grid');
    expect(hit?.point.x).toBeCloseTo(1.2);
    expect(hit?.point.y).toBeCloseTo(2.4);
    expect(hit?.point.z).toBe(0);
    const free = pickPoint({ ...base, gridStep: 0, workPlaneZ: 2 });
    expect(free?.snap).toBe('plane');
    expect(free?.point).toEqual(vec3(1.23, 2.38, 2));
  });

  it('retorna nulo quando o raio não alcança o plano', () => {
    expect(
      pickPoint({ ...base, ray: { origin: vec3(0, 0, 5), direction: vec3(0, 0, 1) } }),
    ).toBeNull();
    expect(
      pickPoint({ ...base, ray: { origin: vec3(0, 0, 5), direction: vec3(1, 0, 0) } }),
    ).toBeNull();
  });

  it('prioriza portas livres próximas ao raio', () => {
    const created = addPipe(createProject('t'), { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec });
    if (!created.ok) throw new Error(created.error.message);
    const freePorts = getFreePorts(created.value.project);
    const hit = pickPoint({
      ...base,
      freePorts,
      ray: { origin: vec3(2.02, 0.01, 10), direction: vec3(0, 0, -1) },
    });
    expect(hit?.snap).toBe('port');
    expect(hit?.port?.ref.portId).toBe('end');
    expect(hit?.point).toEqual(vec3(2, 0, 0));
    const away = pickPoint({
      ...base,
      freePorts,
      ray: { origin: vec3(3, 1, 10), direction: vec3(0, 0, -1) },
    });
    expect(away?.snap).toBe('grid');
  });

  it('restringe ao eixo da porta ao sair de uma conexão', () => {
    const hit = pickPoint({
      ...base,
      anchor: { point: vec3(1, 1, 0), lockAxis: vec3(0, 1, 0) },
      ray: { origin: vec3(4, 3.26, 10), direction: vec3(0, 0, -1) },
    });
    expect(hit?.snap).toBe('axis');
    expect(hit?.point.x).toBeCloseTo(1);
    expect(hit?.point.y).toBeCloseTo(3.3);
  });

  it('restringe à vertical com a âncora', () => {
    const hit = pickPoint({
      ...base,
      vertical: true,
      anchor: { point: vec3(1, 1, 0), lockAxis: null },
      ray: { origin: vec3(-10, 1, 2.52), direction: vec3(1, 0, 0) },
    });
    expect(hit?.snap).toBe('vertical');
    expect(hit?.point).toEqual(vec3(1, 1, 2.5));
  });

  it('mede a posição ao longo do tubo', () => {
    expect(distanceAlongPipe(vec3(0, 0, 0), vec3(0, 0, 4), vec3(0.03, 0, 1.5))).toBeCloseTo(1.5);
  });
});
