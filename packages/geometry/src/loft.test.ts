import { vec3 } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { box, loft, type MeshData, type ProfilePoint } from './index';

/** Volume com sinal: positivo quando as faces estão orientadas para fora. */
function signedVolume(mesh: MeshData): number {
  const p = mesh.positions;
  let volume = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = [mesh.indices[i]! * 3, mesh.indices[i + 1]! * 3, mesh.indices[i + 2]! * 3];
    volume +=
      (p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) -
        p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) +
        p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)) /
      6;
  }
  return volume;
}

describe('loft', () => {
  const X = vec3(1, 0, 0);
  const point = (x: number, radius: number, crease = false): ProfilePoint => ({
    center: vec3(x, 0, 0),
    tangent: X,
    radius,
    crease,
  });

  it('perfil fechado de tubo: volume da parede e normais para fora', () => {
    // Parede externa para a frente, face, furo de volta e face inicial.
    const mesh = loft(
      [
        point(0, 0.05),
        point(1, 0.05, true),
        point(1, 0.04, true),
        point(0, 0.04, true),
        point(0, 0.05),
      ],
      { up: vec3(0, 0, 1), radialSegments: 96 },
    );
    const expected = Math.PI * (0.05 ** 2 - 0.04 ** 2);
    expect(signedVolume(mesh)).toBeGreaterThan(expected * 0.99);
    expect(signedVolume(mesh)).toBeLessThan(expected);

    for (let i = 0; i < mesh.positions.length; i += 3) {
      const [x, y, z] = [mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!];
      const [nx, ny, nz] = [mesh.normals[i]!, mesh.normals[i + 1]!, mesh.normals[i + 2]!];
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 5);
      // Arestas vivas: cada normal é puramente radial ou puramente axial.
      const radial = (nx * 0 + ny * y + nz * z) / Math.hypot(y, z);
      expect(Math.abs(Math.abs(radial) - 1) < 1e-4 || Math.abs(Math.abs(nx) - 1) < 1e-4).toBe(true);
      if (Math.abs(nx) > 0.5) expect(Math.sign(nx)).toBe(x > 0.5 ? 1 : -1);
    }
  });

  it('cone sem aresta viva tem normais inclinadas e contínuas', () => {
    const mesh = loft([point(0, 0.02), point(0.02, 0.04)], { up: vec3(0, 0, 1) });
    for (let i = 0; i < mesh.normals.length; i += 3) {
      expect(mesh.normals[i]!).toBeCloseTo(-Math.SQRT1_2, 3);
    }
  });

  it('paralelepípedo fechado e orientado para fora', () => {
    expect(signedVolume(box(vec3(-1, 0, 2), vec3(1, 3, 4)))).toBeCloseTo(12, 5);
  });
});
