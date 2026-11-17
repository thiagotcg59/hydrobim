import { add, cross, dot, normalize, scale, sub, vec3, type Vec3 } from '@hydrobim/core';
import type { MeshData } from './sweep';

/**
 * Ponto de um perfil de revolução generalizado: um anel circular de raio `radius`
 * centrado em `center`, no plano normal a `tangent`.
 *
 * `tangent` é sempre o sentido de AVANÇO da trajetória (não o sentido em que o perfil é
 * percorrido). Assim, um perfil fechado — parede externa para a frente, face da
 * extremidade, furo de volta — sai com orientação coerente e normais para fora.
 */
export interface ProfilePoint {
  readonly center: Vec3;
  readonly tangent: Vec3;
  readonly radius: number;
  /** Aresta viva: encerra o grupo de suavização neste anel e inicia outro. */
  readonly crease?: boolean;
}

export interface LoftOptions {
  /** Vetor de referência (não paralelo às tangentes) que fixa a rotação dos anéis. */
  readonly up: Vec3;
  readonly radialSegments?: number;
}

/**
 * Superfície que une anéis consecutivos. As normais são calculadas a partir das faces,
 * dentro de cada grupo de suavização, de modo que cones e concordâncias ficam suaves e
 * ressaltos (pontos com `crease`) ficam com aresta viva.
 */
export function loft(points: readonly ProfilePoint[], options: LoftOptions): MeshData {
  if (points.length < 2) throw new Error('O perfil exige ao menos dois pontos.');
  const segments = options.radialSegments ?? 32;

  const groups: ProfilePoint[][] = [];
  let current: ProfilePoint[] = [];
  points.forEach((point, index) => {
    current.push(point);
    if (point.crease && index > 0 && index < points.length - 1) {
      groups.push(current);
      current = [point];
    }
  });
  groups.push(current);

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (const group of groups) {
    if (group.length < 2) continue;
    const base = positions.length / 3;
    const stride = segments + 1;
    const fallback: Vec3[] = [];

    for (const point of group) {
      const t = normalize(point.tangent);
      const n = normalize(sub(options.up, scale(t, dot(options.up, t))));
      const b = cross(t, n);
      for (let j = 0; j <= segments; j += 1) {
        const angle = (j / segments) * Math.PI * 2;
        const dir = add(scale(n, Math.cos(angle)), scale(b, Math.sin(angle)));
        const p = add(point.center, scale(dir, point.radius));
        positions.push(p.x, p.y, p.z);
        fallback.push(dir);
      }
    }

    const count = group.length * stride;
    const sums = new Float64Array(count * 3);
    const at = (v: number): Vec3 =>
      vec3(
        positions[(base + v) * 3] as number,
        positions[(base + v) * 3 + 1] as number,
        positions[(base + v) * 3 + 2] as number,
      );
    const face = (a: number, b: number, c: number): void => {
      const pa = at(a);
      const normal = cross(sub(at(b), pa), sub(at(c), pa));
      // Triângulos degenerados (anel de raio nulo) não entram na malha.
      if (Math.hypot(normal.x, normal.y, normal.z) < 1e-18) return;
      indices.push(base + a, base + b, base + c);
      for (const v of [a, b, c]) {
        sums[v * 3] = (sums[v * 3] as number) + normal.x;
        sums[v * 3 + 1] = (sums[v * 3 + 1] as number) + normal.y;
        sums[v * 3 + 2] = (sums[v * 3 + 2] as number) + normal.z;
      }
    };

    for (let i = 0; i < group.length - 1; i += 1) {
      for (let j = 0; j < segments; j += 1) {
        const a = i * stride + j;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        face(a, b, c);
        face(b, d, c);
      }
    }

    for (let i = 0; i < group.length; i += 1) {
      // Costura: o primeiro e o último vértice do anel coincidem.
      const first = i * stride;
      const last = first + segments;
      for (let k = 0; k < 3; k += 1) {
        const total = (sums[first * 3 + k] as number) + (sums[last * 3 + k] as number);
        sums[first * 3 + k] = total;
        sums[last * 3 + k] = total;
      }
    }
    for (let v = 0; v < count; v += 1) {
      const x = sums[v * 3] as number;
      const y = sums[v * 3 + 1] as number;
      const z = sums[v * 3 + 2] as number;
      const length = Math.hypot(x, y, z);
      if (length > 1e-18) normals.push(x / length, y / length, z / length);
      else {
        const dir = fallback[v] as Vec3;
        normals.push(dir.x, dir.y, dir.z);
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

/** Paralelepípedo alinhado aos eixos locais, com faces planas. */
export function box(min: Vec3, max: Vec3): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3): void => {
    const base = positions.length / 3;
    for (const p of [a, b, c, d]) {
      positions.push(p.x, p.y, p.z);
      normals.push(n.x, n.y, n.z);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const p = (x: number, y: number, z: number): Vec3 =>
    vec3(x ? max.x : min.x, y ? max.y : min.y, z ? max.z : min.z);
  quad(p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1), vec3(1, 0, 0));
  quad(p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0), vec3(-1, 0, 0));
  quad(p(0, 1, 0), p(0, 1, 1), p(1, 1, 1), p(1, 1, 0), vec3(0, 1, 0));
  quad(p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1), vec3(0, -1, 0));
  quad(p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1), vec3(0, 0, 1));
  quad(p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0), vec3(0, 0, -1));
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}
