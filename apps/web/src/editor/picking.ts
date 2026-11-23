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

export type SnapKind =
  'port' | 'grid' | 'plane' | 'axis' | 'vertical' | 'angle' | 'pipe' | 'terrain' | 'ifc';

export interface PickAnchor {
  readonly point: Vec3;
  /** Quando definido, o próximo ponto fica restrito a este eixo (saída de conexão). */
  readonly lockAxis: Vec3 | null;
}

/** Raio de captura na tela (px), igual na planta e no modelo 3D em qualquer zoom. */
export const SNAP_PX = 10;

/**
 * Metros do modelo por pixel de tela ao longo do raio do cursor: `constant + perDistance · t`.
 * Na perspectiva o pixel cresce com a distância à câmera; na ortográfica é constante — por
 * isso a tolerância não pode ser derivada só da distância (a câmera ortográfica fica longe
 * do modelo em qualquer zoom).
 */
export interface PixelScale {
  readonly constant: number;
  readonly perDistance: number;
}

export const metersPerPixel = (scale: PixelScale, t: number): number =>
  scale.constant + scale.perDistance * t;

/** Raio (m) do marcador de uma porta livre no modelo 3D; clicar nele sempre captura a porta. */
export const portMarkerRadius = (port: Port): number =>
  Math.max(port.spec.outerDiameter * 0.62, 0.02);

export interface PickContext {
  readonly ray: Ray;
  /** Portas livres capturáveis (somente de elementos visíveis). */
  readonly freePorts: readonly Port[];
  readonly pixelScale: PixelScale;
  /** Escolha manual entre portas sob o cursor: avança N posições a partir da preferida. */
  readonly cycle?: number;
  /** Cota Z do plano de trabalho (m). */
  readonly workPlaneZ: number;
  /** Passo do snap de grade (m); 0 desativa. */
  readonly gridStep: number;
  readonly anchor: PickAnchor | null;
  /** Restringe o ponto à vertical que passa pela âncora (tecla Shift). */
  readonly vertical: boolean;
  /**
   * Assentamento sobre o terreno (equipamentos): fora das portas, o ponto é onde o raio atinge
   * a superfície, com a cota de assentamento daquele (x, y). `null`/ausente = plano de trabalho.
   */
  readonly ground?: PickGround | null;
}

export interface PickGround {
  /** Ponto (x, y) em que o raio atinge a superfície desenhada; `null` quando não a atinge. */
  readonly hit: (ray: Ray) => { readonly x: number; readonly y: number } | null;
  /** Cota de assentamento em (x, y); `null` fora da superfície. */
  readonly elevationAt: (x: number, y: number) => number | null;
}

export interface PickResult {
  readonly point: Vec3;
  readonly snap: SnapKind;
  readonly port: Port | null;
  /** Portas livres sob o cursor no ponto capturado (1 = sem ambiguidade). */
  readonly stacked: number;
}

const snapValue = (value: number, step: number): number =>
  step > 0 ? Math.round(value / step) * step : value;

/**
 * Porta livre sob o cursor: a que estiver a até `SNAP_PX` do raio na tela (ou dentro do seu
 * marcador). Havendo mais de uma, a preferida é a mais próxima do raio e, no empate, a mais
 * próxima da câmera; `cycle` percorre as demais (escolha manual do usuário).
 */
export function pickPort(
  ray: Ray,
  ports: readonly Port[],
  scale: PixelScale,
  cycle = 0,
  radiusPx = SNAP_PX,
): { port: Port; stacked: number } | null {
  const direction = normalize(ray.direction);
  const near: { port: Port; score: number; t: number }[] = [];
  for (const port of ports) {
    const { point, t } = closestPointOnLine(ray.origin, direction, port.position);
    if (t <= 0) continue;
    const gap = distance(point, port.position);
    const tolerance = Math.max(portMarkerRadius(port), radiusPx * metersPerPixel(scale, t));
    if (gap <= tolerance) near.push({ port, score: gap / tolerance, t });
  }
  if (near.length === 0) return null;
  near.sort((a, b) => a.score - b.score || a.t - b.t);
  const chosen = near[((cycle % near.length) + near.length) % near.length];
  return chosen ? { port: chosen.port, stacked: near.length } : null;
}

export function pickPoint(context: PickContext): PickResult | null {
  const direction = normalize(context.ray.direction);
  const { origin } = context.ray;

  const captured = pickPort(context.ray, context.freePorts, context.pixelScale, context.cycle);
  if (captured) {
    return {
      point: captured.port.position,
      snap: 'port',
      port: captured.port,
      stacked: captured.stacked,
    };
  }

  const anchor = context.anchor;
  if (anchor?.lockAxis) {
    const axis = normalize(anchor.lockAxis);
    const closest = closestPointsBetweenLines(anchor.point, axis, origin, direction);
    if (!closest) return null;
    const t = Math.max(0, snapValue(closest.t1, context.gridStep));
    return { point: add(anchor.point, scale(axis, t)), snap: 'axis', port: null, stacked: 1 };
  }

  if (anchor && context.vertical) {
    const closest = closestPointsBetweenLines(anchor.point, AXIS_Z, origin, direction);
    if (!closest) return null;
    const dz = snapValue(closest.t1, context.gridStep);
    return {
      point: vec3(anchor.point.x, anchor.point.y, anchor.point.z + dz),
      snap: 'vertical',
      port: null,
      stacked: 1,
    };
  }

  const onGround = context.ground
    ? groundPoint(context.ground, context.ray, context.gridStep)
    : null;
  if (onGround) return { point: onGround, snap: 'terrain', port: null, stacked: 1 };

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
    stacked: 1,
  };
}

/** Ponto sobre o terreno; a grade arredonda o (x, y) e a cota é a do ponto arredondado. */
function groundPoint(ground: PickGround, ray: Ray, gridStep: number): Vec3 | null {
  const hit = ground.hit(ray);
  if (!hit) return null;
  const x = snapValue(hit.x, gridStep);
  const y = snapValue(hit.y, gridStep);
  const z = ground.elevationAt(x, y);
  if (z !== null) return vec3(x, y, z);
  // O ponto da grade caiu fora da borda da superfície: vale o ponto atingido, sem grade.
  const raw = ground.elevationAt(hit.x, hit.y);
  return raw === null ? null : vec3(hit.x, hit.y, raw);
}

/** Distância, a partir do início do tubo, da projeção de `point` sobre o seu eixo. */
export function distanceAlongPipe(start: Vec3, end: Vec3, point: Vec3): number {
  const axis = normalize(sub(end, start));
  return dot(sub(point, start), axis);
}
