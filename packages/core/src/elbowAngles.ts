import { add, angleBetween, dot, length, scale, sub, tryNormalize, type Vec3 } from './math';
import type { FittingFamily, PipeSpec } from './schema';
import { degToRad, formatDegrees } from './units';

/**
 * Ângulos de joelho que existem como peça de catálogo. Servem para travar o traçado nas
 * deflexões fabricadas: uma mudança de direção fora delas exigiria uma peça que não existe.
 */

/** Desvio máximo (rad) para considerar que uma deflexão corresponde a um ângulo de catálogo. */
export const ELBOW_ANGLE_MATCH = degToRad(0.5);

/**
 * Deflexões (rad, em ordem crescente) dos joelhos e curvas de catálogo disponíveis para a
 * especificação e o diâmetro informados. Lista vazia: não há família para a especificação
 * (as peças são genéricas e o ângulo fica livre).
 */
export function availableElbowAngles(families: readonly FittingFamily[], spec: PipeSpec): number[] {
  const angles: number[] = [];
  for (const family of families) {
    if (family.kind !== 'elbow' || family.specificationId !== spec.specificationId) continue;
    const angle = family.angle;
    if (angle === undefined) continue;
    if (!family.sizes.some((s) => s.dn === spec.dn && s.centerToEnd !== undefined)) continue;
    if (!angles.some((a) => Math.abs(a - angle) <= ELBOW_ANGLE_MATCH)) angles.push(angle);
  }
  return angles.sort((a, b) => a - b);
}

/** Ângulo de catálogo correspondente à deflexão, ou `null` quando não há peça para ela. */
export function matchElbowAngle(angles: readonly number[], deflection: number): number | null {
  return angles.find((a) => Math.abs(a - deflection) <= ELBOW_ANGLE_MATCH) ?? null;
}

/** Lista de ângulos para mensagens, com a precisão das curvas de catálogo (11,25°). */
export function formatAngleList(angles: readonly number[]): string {
  return angles.map((angle) => formatDegrees(angle, 2)).join(', ');
}

const snapLength = (value: number, step: number): number =>
  step > 0 ? Math.round(value / step) * step : value;

/**
 * Ajusta o ponto final de um trecho que sai de `origin` na direção `axis` (direção da porta)
 * para que a deflexão seja 0 (prolongamento reto) ou um dos ângulos de `angles`. O ponto
 * permanece no plano definido por `axis` e pelo ponto pedido; o comprimento é a projeção do
 * ponto pedido sobre a direção travada, arredondado a `lengthStep` (0 = sem arredondar).
 * Sem ângulos (não há joelho de catálogo), só o prolongamento reto é possível. Quando o
 * ponto pedido está sobre a origem ou no sentido oposto ao eixo (direção indefinida),
 * devolve o ponto pedido sem alteração.
 */
export function constrainDeflection(
  origin: Vec3,
  axis: Vec3,
  target: Vec3,
  angles: readonly number[],
  lengthStep = 0,
): Vec3 {
  const u = tryNormalize(axis);
  const v = sub(target, origin);
  if (!u || length(v) < 1e-9) return target;

  const deflection = angleBetween(u, v);
  let chosen = 0;
  for (const angle of angles) {
    if (Math.abs(angle - deflection) < Math.abs(chosen - deflection)) chosen = angle;
  }

  let direction = u;
  if (chosen > 0) {
    const normal = tryNormalize(sub(v, scale(u, dot(v, u))));
    if (!normal) return target;
    direction = add(scale(u, Math.cos(chosen)), scale(normal, Math.sin(chosen)));
  }
  const projected = snapLength(dot(v, direction), lengthStep);
  // Arredondamento que anularia o trecho: mantém a projeção exata.
  const distance = projected > 1e-9 ? projected : dot(v, direction);
  return distance > 1e-9 ? add(origin, scale(direction, distance)) : target;
}
