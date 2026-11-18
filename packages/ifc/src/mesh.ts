import { cross, length, sub, vec3, type Vec3 } from '@hydrobim/core';
import type { MeshData } from '@hydrobim/geometry';

export interface WeldedMesh {
  points: Vec3[];
  triangles: [number, number, number][];
  closed: boolean;
}

/**
 * Une a costura e as cópias de vértices usadas pelas normais das tampas.
 * A tolerância de 1 nm está bem abaixo da precisão do contexto IFC (10 µm).
 */
export function weldMesh(mesh: MeshData): WeldedMesh {
  const points: Vec3[] = [];
  const indices: number[] = [];
  const byPosition = new Map<string, number>();
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i];
    const y = mesh.positions[i + 1];
    const z = mesh.positions[i + 2];
    if (x === undefined || y === undefined || z === undefined) {
      throw new Error('Malha com coordenadas incompletas.');
    }
    const key = [x, y, z].map((v) => Math.round(v / 1e-9)).join(',');
    let index = byPosition.get(key);
    if (index === undefined) {
      index = points.length;
      points.push(vec3(x, y, z));
      byPosition.set(key, index);
    }
    indices.push(index);
  }
  const triangles: [number, number, number][] = [];
  const edges = new Map<string, { count: number; balance: number }>();
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const original = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]];
    const [a, b, c] = original.map((index) => (index === undefined ? undefined : indices[index]));
    if (a === undefined || b === undefined || c === undefined) {
      throw new Error('Malha com índice de vértice inválido.');
    }
    const pa = points[a];
    const pb = points[b];
    const pc = points[c];
    if (!pa || !pb || !pc) throw new Error('Malha sem vértice referenciado.');
    if (a === b || b === c || c === a || length(cross(sub(pb, pa), sub(pc, pa))) <= 1e-18) continue;
    triangles.push([a + 1, b + 1, c + 1]);
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = `${Math.min(from, to)},${Math.max(from, to)}`;
      const edge = edges.get(key) ?? { count: 0, balance: 0 };
      edge.count += 1;
      edge.balance += from < to ? 1 : -1;
      edges.set(key, edge);
    }
  }
  return {
    points,
    triangles,
    closed:
      triangles.length > 0 &&
      [...edges.values()].every((edge) => edge.count === 2 && edge.balance === 0),
  };
}
