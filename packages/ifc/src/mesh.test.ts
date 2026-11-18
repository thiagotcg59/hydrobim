import { vec3 } from '@hydrobim/core';
import { sweepTube } from '@hydrobim/geometry';
import { expect, it } from 'vitest';
import { weldMesh } from './mesh';

it('solda a costura e as tampas maciças, descartando seus triângulos degenerados', () => {
  const input = sweepTube(
    [0, 1].map((x) => ({
      center: vec3(x, 0, 0),
      tangent: vec3(1, 0, 0),
      outerRadius: 0.1,
      innerRadius: 0,
    })),
    { up: vec3(0, 0, 1), radialSegments: 16 },
  );
  const mesh = weldMesh(input);
  expect(mesh.points).toHaveLength(34);
  expect(mesh.triangles).toHaveLength(64);
  expect(mesh.closed).toBe(true);
  expect(
    mesh.triangles.every(
      (face) => new Set(face).size === 3 && face.every((i) => i >= 1 && i <= mesh.points.length),
    ),
  ).toBe(true);
});

it('não declara fechada uma malha com extremidade aberta', () => {
  const input = sweepTube(
    [0, 1].map((x) => ({
      center: vec3(x, 0, 0),
      tangent: vec3(1, 0, 0),
      outerRadius: 0.1,
      innerRadius: 0.08,
    })),
    { up: vec3(0, 0, 1), capStart: false },
  );
  expect(weldMesh(input).closed).toBe(false);
});
