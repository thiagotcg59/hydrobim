/**
 * Álgebra vetorial mínima do domínio. Independente de motor gráfico.
 * Convenção: sistema destro, eixo Z para cima, comprimentos em metros.
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Quaternion unitário (x, y, z, w). */
export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const ZERO: Vec3 = vec3(0, 0, 0);
export const AXIS_X: Vec3 = vec3(1, 0, 0);
export const AXIS_Y: Vec3 = vec3(0, 1, 0);
export const AXIS_Z: Vec3 = vec3(0, 0, 1);
export const QUAT_IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => vec3(a.x * s, a.y * s, a.z * s);
export const negate = (a: Vec3): Vec3 => vec3(-a.x, -a.y, -a.z);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));

/** Normaliza; retorna `null` para vetores (quase) nulos. */
export function tryNormalize(a: Vec3): Vec3 | null {
  const len = length(a);
  if (!Number.isFinite(len) || len < 1e-12) return null;
  return scale(a, 1 / len);
}

export function normalize(a: Vec3): Vec3 {
  const n = tryNormalize(a);
  if (!n) throw new Error('Não é possível normalizar um vetor nulo.');
  return n;
}

export const isFiniteVec = (a: Vec3): boolean =>
  Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);

/** Ângulo (rad, 0..π) entre dois vetores não nulos. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const na = normalize(a);
  const nb = normalize(b);
  // atan2 é numericamente estável próximo de 0 e de π.
  return Math.atan2(length(cross(na, nb)), dot(na, nb));
}

export function quatNormalize(q: Quat): Quat {
  const len = Math.hypot(q.x, q.y, q.z, q.w);
  if (len < 1e-12) return QUAT_IDENTITY;
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const n = normalize(axis);
  const s = Math.sin(angle / 2);
  return { x: n.x * s, y: n.y * s, z: n.z * s, w: Math.cos(angle / 2) };
}

/** Produto de Hamilton: aplica `b` e depois `a`. */
export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function rotate(q: Quat, v: Vec3): Vec3 {
  // v' = v + 2w(u × v) + 2(u × (u × v)), com u = (x, y, z)
  const u = vec3(q.x, q.y, q.z);
  const uv = cross(u, v);
  const uuv = cross(u, uv);
  return add(v, add(scale(uv, 2 * q.w), scale(uuv, 2)));
}

/** Quaternion a partir de uma base ortonormal destra (colunas = imagens de X, Y, Z). */
export function quatFromBasis(bx: Vec3, by: Vec3, bz: Vec3): Quat {
  const m00 = bx.x,
    m01 = by.x,
    m02 = bz.x;
  const m10 = bx.y,
    m11 = by.y,
    m12 = bz.y;
  const m20 = bx.z,
    m21 = by.z,
    m22 = bz.z;
  const trace = m00 + m11 + m22;
  let q: Quat;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q = { w: 0.25 / s, x: (m21 - m12) * s, y: (m02 - m20) * s, z: (m10 - m01) * s };
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = { w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s };
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = { w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s };
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s };
  }
  return quatNormalize(q);
}

/**
 * Orientação determinística cujo eixo X local aponta em `direction` e cujo eixo Z local
 * fica o mais próximo possível do Z global (para direções verticais usa-se o Y global).
 * É a regra única de orientação de tubos e conexões no HydroBIM.
 */
export function frameFromDirection(direction: Vec3): Quat {
  const bx = normalize(direction);
  const reference = Math.abs(dot(bx, AXIS_Z)) > 0.999 ? AXIS_Y : AXIS_Z;
  const bz = normalize(sub(reference, scale(bx, dot(reference, bx))));
  const by = cross(bz, bx);
  return quatFromBasis(bx, by, bz);
}

/** Ponto da reta (origem + t·direção) mais próximo de `p`, com o parâmetro t. */
export function closestPointOnLine(
  origin: Vec3,
  direction: Vec3,
  p: Vec3,
): { point: Vec3; t: number } {
  const d = normalize(direction);
  const t = dot(sub(p, origin), d);
  return { point: add(origin, scale(d, t)), t };
}

/**
 * Par de pontos mais próximos entre duas retas (cada uma: origem + parâmetro·direção unitária).
 * Retorna `null` quando as retas são paralelas.
 */
export function closestPointsBetweenLines(
  o1: Vec3,
  d1: Vec3,
  o2: Vec3,
  d2: Vec3,
): { t1: number; t2: number; p1: Vec3; p2: Vec3 } | null {
  const a = normalize(d1);
  const b = normalize(d2);
  const w = sub(o1, o2);
  const ab = dot(a, b);
  const denom = 1 - ab * ab;
  if (denom < 1e-9) return null;
  const aw = dot(a, w);
  const bw = dot(b, w);
  const t1 = (ab * bw - aw) / denom;
  const t2 = (bw - ab * aw) / denom;
  return { t1, t2, p1: add(o1, scale(a, t1)), p2: add(o2, scale(b, t2)) };
}
