import { dot, vec3 } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import {
  describeWorkPlane,
  pickOnAxis,
  pickOnPlane,
  planeFromPort,
  planeThrough,
  planeXY,
  planeXZ,
  planeYZ,
} from './workPlane';

const unwrap = (result: ReturnType<typeof pickOnPlane>) => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

describe('planos de trabalho', () => {
  it('XY: equivale ao plano do nível, com grade em X e Y', () => {
    const ray = { origin: vec3(1.23, 2.38, 10), direction: vec3(0, 0, -1) };
    expect(unwrap(pickOnPlane(ray, planeXY(2)))).toEqual(vec3(1.23, 2.38, 2));
    const snapped = unwrap(pickOnPlane(ray, planeXY(2), 0.1));
    expect(snapped.x).toBeCloseTo(1.2);
    expect(snapped.y).toBeCloseTo(2.4);
    expect(snapped.z).toBeCloseTo(2);
  });

  it('XZ: pontos com Y constante, grade em X e Z (modelagem em elevação)', () => {
    // Vista frontal: o raio corre ao longo de +Y.
    const ray = { origin: vec3(1.23, -20, 2.38), direction: vec3(0, 1, 0) };
    const hit = unwrap(pickOnPlane(ray, planeXZ(3), 0.1));
    expect(hit.x).toBeCloseTo(1.2);
    expect(hit.y).toBeCloseTo(3);
    expect(hit.z).toBeCloseTo(2.4);
  });

  it('YZ: pontos com X constante', () => {
    const ray = { origin: vec3(30, 0.52, 1.18), direction: vec3(-1, 0, 0) };
    const hit = unwrap(pickOnPlane(ray, planeYZ(-2), 0.5));
    expect(hit).toEqual(vec3(-2, 0.5, 1));
  });

  it('recusa o plano de perfil ou atrás do observador, sem devolver ponto distante', () => {
    // Vista frontal com o plano horizontal: o raio é paralelo ao plano.
    const front = { origin: vec3(0, -20, 1), direction: vec3(0, 1, 0) };
    const edge = pickOnPlane(front, planeXY(0));
    expect(!edge.ok && edge.error.code).toBe('PLANE_EDGE_ON');
    expect(!edge.ok && edge.error.message).toContain('de perfil');
    const behind = pickOnPlane({ origin: vec3(0, 0, 5), direction: vec3(0, 0, 1) }, planeXY(0));
    expect(!behind.ok && behind.error.code).toBe('PLANE_BEHIND');
  });

  it('plano pelo ponto: mantém o tipo e passa pela âncora', () => {
    const anchor = vec3(4, 5, 6);
    expect(planeThrough('xy', anchor).origin.z).toBe(6);
    expect(planeThrough('xz', anchor).origin.y).toBe(5);
    expect(planeThrough('yz', anchor).origin.x).toBe(4);
  });

  it('plano da porta: contém o eixo da porta e a vertical', () => {
    const plane = planeFromPort({ position: vec3(2, 1, 0.3), direction: vec3(1, 1, 0) });
    expect(Math.abs(dot(plane.normal, vec3(Math.SQRT1_2, Math.SQRT1_2, 0)))).toBeLessThan(1e-12);
    expect(Math.abs(dot(plane.normal, vec3(0, 0, 1)))).toBeLessThan(1e-12);
    // Um ponto acima da porta, no plano: subir a partir da extremidade.
    const ray = { origin: vec3(3 + 5, 2 - 5, 1.5), direction: vec3(-1, 1, 0) };
    const hit = unwrap(pickOnPlane(ray, plane));
    expect(hit.x).toBeCloseTo(3);
    expect(hit.y).toBeCloseTo(2);
    expect(hit.z).toBeCloseTo(1.5);
    // Porta vertical: a convenção é o plano XZ pela porta.
    const riser = planeFromPort({ position: vec3(2, 1, 0), direction: vec3(0, 0, 1) });
    expect(Math.abs(riser.normal.y)).toBeCloseTo(1);
  });

  it('trava de eixo: ponto sobre o eixo que passa pela âncora', () => {
    const anchor = vec3(1, 1, 0);
    const up = pickOnAxis(
      { origin: vec3(-10, 1, 2.52), direction: vec3(1, 0, 0) },
      anchor,
      'z',
      0.1,
    );
    expect(up?.x).toBeCloseTo(1);
    expect(up?.y).toBeCloseTo(1);
    expect(up?.z).toBeCloseTo(2.5);
    const alongX = pickOnAxis(
      { origin: vec3(3.26, 4, 10), direction: vec3(0, 0, -1) },
      anchor,
      'x',
      0.1,
    );
    expect(alongX?.x).toBeCloseTo(3.3);
    expect(alongX?.y).toBeCloseTo(1);
    // Olhando ao longo do eixo travado, a posição não é legível.
    expect(
      pickOnAxis({ origin: vec3(1, 1, 10), direction: vec3(0, 0, -1) }, anchor, 'z'),
    ).toBeNull();
  });

  it('descreve o plano, a referência e a trava', () => {
    expect(describeWorkPlane(planeXY(2.7), null)).toBe('Plano XY (horizontal) em Z 2,70 m');
    expect(describeWorkPlane(planeXZ(3), 'z')).toBe(
      'Plano XZ (elevação frontal) em Y 3,00 m · eixo Z travado',
    );
  });
});
