import { describe, expect, it } from 'vitest';
import {
  angleBetween,
  AXIS_X,
  AXIS_Y,
  AXIS_Z,
  closestPointsBetweenLines,
  cross,
  distance,
  frameFromDirection,
  normalize,
  quatFromAxisAngle,
  quatFromBasis,
  rotate,
  vec3,
} from './math';

const close = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  expect(distance(a, b)).toBeLessThan(1e-9);

describe('math', () => {
  it('gira vetores com quaternions', () => {
    close(rotate(quatFromAxisAngle(AXIS_Z, Math.PI / 2), AXIS_X), AXIS_Y);
    close(rotate(quatFromAxisAngle(AXIS_X, Math.PI / 2), AXIS_Y), AXIS_Z);
  });

  it('reconstrói a base a partir do quaternion', () => {
    const bx = normalize(vec3(1, 2, 3));
    const by = normalize(cross(AXIS_Z, bx));
    const bz = cross(bx, by);
    const q = quatFromBasis(bx, by, bz);
    close(rotate(q, AXIS_X), bx);
    close(rotate(q, AXIS_Y), by);
    close(rotate(q, AXIS_Z), bz);
  });

  it.each([
    vec3(1, 0, 0),
    vec3(-1, 0, 0),
    vec3(0, 1, 0),
    vec3(0, 0, 1),
    vec3(0, 0, -1),
    vec3(1, 1, 1),
    vec3(-2, 0.5, -7),
  ])('frameFromDirection alinha X local com a direção %o', (direction) => {
    const q = frameFromDirection(direction);
    close(rotate(q, AXIS_X), normalize(direction));
    // Base ortonormal destra.
    close(cross(rotate(q, AXIS_X), rotate(q, AXIS_Y)), rotate(q, AXIS_Z));
  });

  it('mantém o Z local para cima em direções horizontais', () => {
    close(rotate(frameFromDirection(vec3(0, 1, 0)), AXIS_Z), AXIS_Z);
  });

  it('mede ângulos e distância entre retas', () => {
    expect(angleBetween(AXIS_X, AXIS_Y)).toBeCloseTo(Math.PI / 2);
    expect(angleBetween(AXIS_X, vec3(-1, 0, 0))).toBeCloseTo(Math.PI);
    const r = closestPointsBetweenLines(vec3(0, 0, 0), AXIS_X, vec3(3, 5, 2), AXIS_Z);
    expect(r).not.toBeNull();
    close(r!.p1, vec3(3, 0, 0));
    close(r!.p2, vec3(3, 5, 0));
    expect(closestPointsBetweenLines(vec3(0, 0, 0), AXIS_X, vec3(0, 1, 0), AXIS_X)).toBeNull();
  });
});
