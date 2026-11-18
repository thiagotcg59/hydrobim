import { add, scale, sub, vec3, type Vec3 } from '@hydrobim/core';
import type { MeshPart } from './elements';
import { loft, type ProfilePoint } from './loft';
import { sweepTube, type MeshData, type Station } from './sweep';

/** Primitivas de malha compartilhadas pelos geradores de peças. */

export const X = vec3(1, 0, 0);
export const Z = vec3(0, 0, 1);
export const ORIGIN = vec3(0, 0, 0);

export const station = (center: Vec3, tangent: Vec3, outer: number, inner: number): Station => ({
  center,
  tangent,
  outerRadius: outer,
  innerRadius: inner,
});

/** Vetor de referência não paralelo a `direction`, para orientar as seções. */
export const upFor = (direction: Vec3): Vec3 =>
  Math.abs(direction.z) > 0.9 * Math.hypot(direction.x, direction.y, direction.z) ? X : Z;

export const body = (mesh: MeshData): MeshPart => ({ role: 'body', mesh });
export const accent = (mesh: MeshData): MeshPart => ({ role: 'accent', mesh });
export const coated = (mesh: MeshData): MeshPart => ({ role: 'coated', mesh });
export const trim = (mesh: MeshData): MeshPart => ({ role: 'trim', mesh });
export const seal = (mesh: MeshData): MeshPart => ({ role: 'seal', mesh });

/** Cilindro (oco ou maciço) entre dois pontos. */
export function cylinder(from: Vec3, to: Vec3, outer: number, inner = 0, segments = 32): MeshData {
  const direction = sub(to, from);
  return sweepTube([station(from, direction, outer, inner), station(to, direction, outer, inner)], {
    up: upFor(direction),
    radialSegments: segments,
  });
}

/**
 * Sólido de revolução: lista de [distância ao longo do eixo, raio, suave?]. Os pontos têm
 * aresta viva, exceto os marcados como suaves (superfícies abauladas).
 */
export function turned(
  origin: Vec3,
  axis: Vec3,
  profile: readonly (readonly [number, number, boolean?])[],
  segments = 32,
): MeshData {
  const first = profile[0];
  const last = profile[profile.length - 1];
  if (!first || !last) throw new Error('Perfil vazio.');
  const point = (h: number, radius: number, smooth = false): ProfilePoint => ({
    center: add(origin, scale(axis, h)),
    tangent: axis,
    radius,
    crease: !smooth,
  });
  return loft(
    [
      point(first[0], 0),
      ...profile.map(([h, r, smooth]) => point(h, r, smooth)),
      point(last[0], 0),
    ],
    {
      up: upFor(axis),
      radialSegments: segments,
    },
  );
}

/** Toro horizontal (aro do volante). */
export function torus(center: Vec3, majorRadius: number, tubeRadius: number): MeshData {
  const steps = 40;
  const points: ProfilePoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const phi = (i / steps) * Math.PI * 2;
    points.push({
      center: add(center, vec3(majorRadius * Math.cos(phi), majorRadius * Math.sin(phi), 0)),
      tangent: vec3(-Math.sin(phi), Math.cos(phi), 0),
      radius: tubeRadius,
    });
  }
  return loft(points, { up: Z, radialSegments: 12 });
}

/** Esfera (cotovelos de tubos finos e calotas). */
export function ball(center: Vec3, radius: number, segments = 12): MeshData {
  const rings = 8;
  const points: ProfilePoint[] = [];
  for (let i = 0; i <= rings; i += 1) {
    const phi = (Math.PI * i) / rings;
    points.push({
      center: vec3(center.x, center.y, center.z - radius * Math.cos(phi)),
      tangent: Z,
      radius: radius * Math.sin(phi),
    });
  }
  return loft(points, { up: X, radialSegments: segments });
}
