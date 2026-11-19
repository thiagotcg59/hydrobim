import { addPipe, createProject, getFreePorts, vec3, type PipeSpec } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { distanceAlongPipe, pickPoint, pickPort, SNAP_PX, type PickContext } from './picking';

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
  // 5 mm por pixel: o raio de captura (10 px) vale 5 cm.
  pixelScale: { constant: 0.005, perDistance: 0 },
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

describe('pickPort: tolerância em pixels', () => {
  const created = addPipe(createProject('t'), { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec });
  if (!created.ok) throw new Error(created.error.message);
  const ports = getFreePorts(created.value.project);
  const down = (x: number, y: number, z = 10) => ({
    origin: vec3(x, y, z),
    direction: vec3(0, 0, -1),
  });

  it('na ortográfica, o raio de captura acompanha o zoom e não a distância da câmera', () => {
    // Câmera a 500 m (como na vista ortográfica), 1 mm por pixel: raio de 10 px = 1 cm,
    // menor que o marcador da porta — vale o marcador (0,62 × DE = 3,72 cm).
    const zoomedIn = { constant: 0.001, perDistance: 0 };
    expect(pickPort(down(2.03, 0, 500), ports, zoomedIn)?.port.ref.portId).toBe('end');
    expect(pickPort(down(2.05, 0, 500), ports, zoomedIn)).toBeNull();
    // Afastando o zoom (2 cm por pixel), os mesmos 10 px cobrem 20 cm.
    const zoomedOut = { constant: 0.02, perDistance: 0 };
    expect(pickPort(down(2.19, 0, 500), ports, zoomedOut)?.port.ref.portId).toBe('end');
    expect(pickPort(down(2.21, 0, 500), ports, zoomedOut)).toBeNull();
  });

  it('na perspectiva, o raio em metros cresce com a distância e é constante na tela', () => {
    const scale = { constant: 0, perDistance: 0.001 };
    const tolerance = (z: number): number => SNAP_PX * scale.perDistance * z;
    for (const z of [50, 200]) {
      expect(pickPort(down(2 + tolerance(z) * 0.95, 0, z), ports, scale)).not.toBeNull();
      expect(pickPort(down(2 + tolerance(z) * 1.05, 0, z), ports, scale)).toBeNull();
    }
  });

  it('alterna entre as portas sob o cursor e informa quantas são', () => {
    const upper = addPipe(created.value.project, {
      start: vec3(0, 0, 3),
      end: vec3(2, 0, 3),
      spec,
    });
    if (!upper.ok) throw new Error(upper.error.message);
    const all = getFreePorts(upper.value.project);
    const scale = { constant: 0.005, perDistance: 0 };
    const first = pickPort(down(2, 0), all, scale);
    // Empate na tela: prefere a mais próxima da câmera (cota 3).
    expect(first?.stacked).toBe(2);
    expect(first?.port.position.z).toBe(3);
    expect(pickPort(down(2, 0), all, scale, 1)?.port.position.z).toBe(0);
    expect(pickPort(down(2, 0), all, scale, -1)?.port.position.z).toBe(0);
    expect(pickPort(down(2, 0), all, scale, 2)?.port.position.z).toBe(3);
  });
});
