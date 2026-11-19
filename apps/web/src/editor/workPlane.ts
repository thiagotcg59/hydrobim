import {
  add,
  AXIS_X,
  AXIS_Y,
  AXIS_Z,
  closestPointsBetweenLines,
  cross,
  dot,
  fail,
  normalize,
  ok,
  scale,
  sub,
  tryNormalize,
  type Result,
  type Vec3,
} from '@hydrobim/core';
import type { Ray } from './picking';

/**
 * Planos de trabalho do modelo 3D: horizontal (XY, o nível), verticais (XZ e YZ, para
 * modelar em elevação e em corte) e o plano orientado pela porta selecionada. O cursor é
 * resolvido na interseção do raio com o plano; quando o plano fica de perfil na vista, a
 * interseção é instável e o ponto é recusado com orientação, em vez de saltar para longe.
 * Z para cima, sistema destro, metros.
 */

export type WorkPlaneKind = 'xy' | 'xz' | 'yz' | 'port';

export interface WorkPlane {
  readonly kind: WorkPlaneKind;
  /** Ponto do plano (referência da grade). */
  readonly origin: Vec3;
  /** Normal unitária. */
  readonly normal: Vec3;
  /** Base ortonormal do plano: os dois eixos em que a grade é medida. */
  readonly u: Vec3;
  readonly v: Vec3;
}

export const WORK_PLANE_LABELS: Record<WorkPlaneKind, string> = {
  xy: 'Plano XY (horizontal)',
  xz: 'Plano XZ (elevação frontal)',
  yz: 'Plano YZ (elevação lateral)',
  port: 'Plano da porta',
};

/** Plano horizontal na cota `z` (o nível mais a elevação do eixo). */
export const planeXY = (z: number): WorkPlane => ({
  kind: 'xy',
  origin: { x: 0, y: 0, z },
  normal: AXIS_Z,
  u: AXIS_X,
  v: AXIS_Y,
});

/** Plano vertical paralelo a X e Z, passando por `y`. */
export const planeXZ = (y: number): WorkPlane => ({
  kind: 'xz',
  origin: { x: 0, y, z: 0 },
  normal: AXIS_Y,
  u: AXIS_X,
  v: AXIS_Z,
});

/** Plano vertical paralelo a Y e Z, passando por `x`. */
export const planeYZ = (x: number): WorkPlane => ({
  kind: 'yz',
  origin: { x, y: 0, z: 0 },
  normal: AXIS_X,
  u: AXIS_Y,
  v: AXIS_Z,
});

/** Plano de mesmo tipo (XY, XZ ou YZ) passando pelo ponto dado — ex.: a âncora do trecho. */
export function planeThrough(kind: Exclude<WorkPlaneKind, 'port'>, point: Vec3): WorkPlane {
  return kind === 'xy' ? planeXY(point.z) : kind === 'xz' ? planeXZ(point.y) : planeYZ(point.x);
}

/**
 * Plano orientado pela porta: contém o eixo da porta e a vertical (é o plano em que um
 * joelho "para cima" ou "para baixo" trabalha). Com a porta vertical, o plano contém a
 * vertical e o eixo X — a orientação horizontal é indeterminada e X é a convenção.
 */
export function planeFromPort(port: { position: Vec3; direction: Vec3 }): WorkPlane {
  const axis = normalize(port.direction);
  const horizontal = tryNormalize({ x: axis.x, y: axis.y, z: 0 });
  const u = horizontal ?? AXIS_X;
  return {
    kind: 'port',
    origin: port.position,
    normal: normalize(cross(u, AXIS_Z)),
    u,
    v: AXIS_Z,
  };
}

/** Seno mínimo do ângulo entre o raio e o plano para a interseção ser confiável (~2°). */
const MIN_INCIDENCE = 0.035;

const snapValue = (value: number, step: number): number =>
  step > 0 ? Math.round(value / step) * step : value;

/**
 * Ponto do plano indicado pelo raio do cursor, ajustado à grade do plano (medida a partir da
 * origem do mundo, para que a grade coincida entre planos).
 */
export function pickOnPlane(ray: Ray, plane: WorkPlane, gridStep = 0): Result<Vec3> {
  const direction = normalize(ray.direction);
  const incidence = dot(direction, plane.normal);
  if (Math.abs(incidence) < MIN_INCIDENCE) {
    return fail(
      'PLANE_EDGE_ON',
      `O ${WORK_PLANE_LABELS[plane.kind].toLowerCase()} está de perfil nesta vista: gire a vista ou escolha outro plano de trabalho.`,
    );
  }
  const t = dot(sub(plane.origin, ray.origin), plane.normal) / incidence;
  if (t <= 0) {
    return fail('PLANE_BEHIND', 'O plano de trabalho está atrás do observador nesta vista.');
  }
  const hit = add(ray.origin, scale(direction, t));
  if (gridStep <= 0) return ok(hit);
  // Coordenadas no plano em relação à projeção da origem do mundo sobre ele.
  const base = scale(plane.normal, dot(plane.origin, plane.normal));
  const local = sub(hit, base);
  const a = snapValue(dot(local, plane.u), gridStep);
  const b = snapValue(dot(local, plane.v), gridStep);
  return ok(add(base, add(scale(plane.u, a), scale(plane.v, b))));
}

export type AxisLock = 'x' | 'y' | 'z';

const AXES: Record<AxisLock, Vec3> = { x: AXIS_X, y: AXIS_Y, z: AXIS_Z };

/**
 * Trava de eixo: ponto sobre a reta que passa pela âncora na direção do eixo travado, o mais
 * próximo do raio do cursor; a distância à âncora é ajustada à grade. `null` quando o eixo
 * aponta para o observador (a posição ao longo dele não é legível na vista).
 */
export function pickOnAxis(ray: Ray, anchor: Vec3, axis: AxisLock, gridStep = 0): Vec3 | null {
  const closest = closestPointsBetweenLines(anchor, AXES[axis], ray.origin, ray.direction);
  if (!closest) return null;
  return add(anchor, scale(AXES[axis], snapValue(closest.t1, gridStep)));
}

/** Descrição da trava para a barra de status, com a referência de elevação. */
export function describeWorkPlane(plane: WorkPlane, lock: AxisLock | null): string {
  const reference =
    plane.kind === 'xy'
      ? `Z ${plane.origin.z.toFixed(2).replace('.', ',')} m`
      : plane.kind === 'xz'
        ? `Y ${plane.origin.y.toFixed(2).replace('.', ',')} m`
        : plane.kind === 'yz'
          ? `X ${plane.origin.x.toFixed(2).replace('.', ',')} m`
          : `pela porta, Z ${plane.origin.z.toFixed(2).replace('.', ',')} m`;
  const locked = lock ? ` · eixo ${lock.toUpperCase()} travado` : '';
  return `${WORK_PLANE_LABELS[plane.kind]} em ${reference}${locked}`;
}
