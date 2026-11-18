import { add, cross, dot, normalize, scale, sub, type Vec3 } from '@hydrobim/core';

/** Malha triangular indexada, independente de motor gráfico. */
export interface MeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
}

/** Seção circular (possivelmente oca) ao longo de uma trajetória. */
export interface Station {
  readonly center: Vec3;
  /** Direção da trajetória na seção (unitária). */
  readonly tangent: Vec3;
  readonly outerRadius: number;
  /** Raio interno; 0 gera uma seção maciça. */
  readonly innerRadius: number;
}

export interface SweepOptions {
  /** Vetor de referência (não paralelo às tangentes) que fixa a rotação das seções. */
  readonly up: Vec3;
  readonly radialSegments?: number;
  readonly capStart?: boolean;
  readonly capEnd?: boolean;
}

class MeshBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly indices: number[] = [];

  vertex(p: Vec3, n: Vec3): number {
    this.positions.push(p.x, p.y, p.z);
    this.normals.push(n.x, n.y, n.z);
    return this.positions.length / 3 - 1;
  }

  triangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  build(): MeshData {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      indices: new Uint32Array(this.indices),
    };
  }
}

/**
 * Varre uma seção circular oca pelas estações informadas, gerando parede externa,
 * parede interna (quando oca) e tampas anulares nas extremidades.
 */
export function sweepTube(stations: readonly Station[], options: SweepOptions): MeshData {
  if (stations.length < 2) throw new Error('A varredura exige ao menos duas estações.');
  const segments = options.radialSegments ?? 32;
  const builder = new MeshBuilder();
  const hollow = stations.some((s) => s.innerRadius > 0);

  const frames = stations.map((s) => {
    const t = normalize(s.tangent);
    const n = normalize(sub(options.up, scale(t, dot(options.up, t))));
    return { t, n, b: cross(t, n) };
  });
  const radial = (i: number, j: number): Vec3 => {
    const frame = frames[i];
    if (!frame) throw new Error('Estação inexistente.');
    const angle = (j / segments) * Math.PI * 2;
    return add(scale(frame.n, Math.cos(angle)), scale(frame.b, Math.sin(angle)));
  };

  const wall = (pick: (s: Station) => number, outward: boolean): void => {
    const rings: number[][] = stations.map((s, i) => {
      const ring: number[] = [];
      for (let j = 0; j <= segments; j += 1) {
        const dir = radial(i, j);
        ring.push(
          builder.vertex(add(s.center, scale(dir, pick(s))), outward ? dir : scale(dir, -1)),
        );
      }
      return ring;
    });
    for (let i = 0; i < rings.length - 1; i += 1) {
      const r0 = rings[i];
      const r1 = rings[i + 1];
      if (!r0 || !r1) continue;
      for (let j = 0; j < segments; j += 1) {
        const a = r0[j] as number;
        const b = r0[j + 1] as number;
        const c = r1[j] as number;
        const d = r1[j + 1] as number;
        if (outward) {
          builder.triangle(a, b, c);
          builder.triangle(b, d, c);
        } else {
          builder.triangle(a, c, b);
          builder.triangle(b, c, d);
        }
      }
    }
  };

  wall((s) => s.outerRadius, true);
  if (hollow) wall((s) => s.innerRadius, false);

  const cap = (index: number, atStart: boolean): void => {
    const station = stations[index];
    const frame = frames[index];
    if (!station || !frame) return;
    const normal = atStart ? scale(frame.t, -1) : frame.t;
    const outer: number[] = [];
    const inner: number[] = [];
    for (let j = 0; j <= segments; j += 1) {
      const dir = radial(index, j);
      outer.push(builder.vertex(add(station.center, scale(dir, station.outerRadius)), normal));
      inner.push(builder.vertex(add(station.center, scale(dir, station.innerRadius)), normal));
    }
    for (let j = 0; j < segments; j += 1) {
      const a = inner[j] as number;
      const b = inner[j + 1] as number;
      const c = outer[j] as number;
      const d = outer[j + 1] as number;
      if (atStart) {
        builder.triangle(a, b, c);
        builder.triangle(b, d, c);
      } else {
        builder.triangle(a, c, b);
        builder.triangle(b, c, d);
      }
    }
  };

  if (options.capStart ?? true) cap(0, true);
  if (options.capEnd ?? true) cap(stations.length - 1, false);
  return builder.build();
}
