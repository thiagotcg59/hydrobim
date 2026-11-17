import {
  add,
  closestPointOnLine,
  closestPointsBetweenLines,
  distance,
  dot,
  normalize,
  scale,
  sub,
  vec3,
  AXIS_Z,
  type Port,
  type Vec3,
} from '@hydrobim/core';

/**
 * Resolução do ponto 3D indicado pelo cursor. Funções puras (sem Three.js nem DOM),
 * para que as regras de snapping sejam testáveis de forma isolada.
 */

export interface Ray {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

export type SnapKind = 'port' | 'grid' | 'plane' | 'axis' | 'vertical';

export interface PickAnchor {
  readonly point: Vec3;
  /** Quando definido, o próximo ponto fica restrito a este eixo (saída de conexão). */
  readonly lockAxis: Vec3 | null;
}

export interface PickContext {
  readonly ray: Ray;
  readonly freePorts: readonly Port[];
  /** Cota Z do plano de trabalho (m). */
  readonly workPlaneZ: number;
  /** Passo do snap de grade (m); 0 desativa. */
  readonly gridStep: number;
  readonly anchor: PickAnchor | null;
  /** Restringe o ponto à vertical que passa pela âncora (tecla Shift). */
  readonly vertical: boolean;
}

export interface PickResult {
  readonly point: Vec3;
  readonly snap: SnapKind;
  readonly port: Port | null;
}

const snapValue = (value: number, step: number): number =>
  step > 0 ? Math.round(value / step) * step : value;

/** Porta livre mais próxima do raio, dentro de uma tolerância proporcional à distância. */
export function pickPort(ray: Ray, ports: readonly Port[]): Port | null {
  const direction = normalize(ray.direction);
  let best: Port | null = null;
  let bestDistance = Infinity;
  for (const port of ports) {
    const { point, t } = closestPointOnLine(ray.origin, direction, port.position);
    if (t <= 0) continue;
    const gap = distance(point, port.position);
    const tolerance = Math.max(port.spec.outerDiameter * 0.75, t * 0.018);
    if (gap <= tolerance && gap < bestDistance) {
      best = port;
      bestDistance = gap;
    }
  }
  return best;
}

export function pickPoint(context: PickContext): PickResult | null {
  const direction = normalize(context.ray.direction);
  const { origin } = context.ray;

  const port = pickPort(context.ray, context.freePorts);
  if (port) return { point: port.position, snap: 'port', port };

  const anchor = context.anchor;
  if (anchor?.lockAxis) {
    const axis = normalize(anchor.lockAxis);
    const closest = closestPointsBetweenLines(anchor.point, axis, origin, direction);
    if (!closest) return null;
    const t = Math.max(0, snapValue(closest.t1, context.gridStep));
    return { point: add(anchor.point, scale(axis, t)), snap: 'axis', port: null };
  }

  if (anchor && context.vertical) {
    const closest = closestPointsBetweenLines(anchor.point, AXIS_Z, origin, direction);
    if (!closest) return null;
    const dz = snapValue(closest.t1, context.gridStep);
    return {
      point: vec3(anchor.point.x, anchor.point.y, anchor.point.z + dz),
      snap: 'vertical',
      port: null,
    };
  }

  if (Math.abs(direction.z) < 1e-6) return null;
  const t = (context.workPlaneZ - origin.z) / direction.z;
  if (t <= 0) return null;
  const hit = add(origin, scale(direction, t));
  return {
    point: vec3(
      snapValue(hit.x, context.gridStep),
      snapValue(hit.y, context.gridStep),
      context.workPlaneZ,
    ),
    snap: context.gridStep > 0 ? 'grid' : 'plane',
    port: null,
  };
}

/** Distância, a partir do início do tubo, da projeção de `point` sobre o seu eixo. */
export function distanceAlongPipe(start: Vec3, end: Vec3, point: Vec3): number {
  const axis = normalize(sub(end, start));
  return dot(sub(point, start), axis);
}
