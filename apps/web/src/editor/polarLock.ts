import {
  constrainDeflection,
  cross,
  degToRad,
  dot,
  getElement,
  length,
  resolvePort,
  sub,
  vec3,
  type PortRef,
  type Project,
  type Vec3,
} from '@hydrobim/core';
import type { PickResult, Ray } from './picking';
import { lengthStepOf } from './precision';
import { precision } from '../state/precisionStore';

/**
 * Trava de ângulo com Shift, no traçado de tubos: o trecho fica a 0°, 45° ou 90°.
 *  - partindo da extremidade de um tubo, os ângulos são medidos em relação a esse tubo
 *    (prolongamento reto, joelho de 45° ou joelho de 90°);
 *  - no primeiro trecho, ou partindo de um ponto livre, em relação aos eixos X e Y do
 *    projeto, de 45° em 45°.
 * É só uma restrição do ponto indicado: a operação e as suas regras (joelho de catálogo,
 * comprimentos mínimos) são as mesmas do clique livre.
 */

/** Mudanças de direção oferecidas pela trava, além do prolongamento reto. */
export const POLAR_DEFLECTIONS: readonly number[] = [degToRad(45), degToRad(90)];
const POLAR_STEP = degToRad(45);

const snapLength = (value: number, step: number): number =>
  step > 0 ? Math.round(value / step) * step : value;

/**
 * Ponto travado. `axis` é a direção do tubo de partida (ou `null` sem tubo de partida);
 * `lengthStep` arredonda o comprimento do trecho (0 = sem arredondar). Devolve o ponto pedido
 * quando ele coincide com a origem.
 */
export function polarLockPoint(
  origin: Vec3,
  axis: Vec3 | null,
  target: Vec3,
  lengthStep = 0,
): Vec3 {
  if (axis) return constrainDeflection(origin, axis, target, POLAR_DEFLECTIONS, lengthStep);
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  if (Math.hypot(dx, dy) < 1e-9) return target;
  const angle = Math.round(Math.atan2(dy, dx) / POLAR_STEP) * POLAR_STEP;
  const direction = vec3(Math.cos(angle), Math.sin(angle), 0);
  const projected = dx * direction.x + dy * direction.y;
  const rounded = snapLength(projected, lengthStep);
  const distance = rounded > 1e-9 ? rounded : projected;
  // A cota do ponto pedido é mantida (elevação do traçado, recobrimento sobre o terreno).
  return vec3(origin.x + direction.x * distance, origin.y + direction.y * distance, target.z);
}

interface PolarState {
  readonly project: Project;
  readonly tool: string;
  readonly anchor: {
    readonly point: Vec3;
    readonly port: PortRef | null;
    readonly lockAxis: Vec3 | null;
  } | null;
  readonly snapToGrid: boolean;
  readonly gridStep: number;
}

/**
 * Ponto do cursor com a trava aplicada ao trecho em andamento, ou `null` quando ela não se
 * aplica: fora da ferramenta de tubo, sem ponto de partida, ou saindo de uma conexão (o eixo
 * da porta já é obrigatório).
 */
export function polarLockedPoint(state: PolarState, point: Vec3): Vec3 | null {
  const { anchor } = state;
  if (state.tool !== 'pipe' || !anchor || anchor.lockAxis) return null;
  const port = anchor.port ? resolvePort(state.project, anchor.port) : undefined;
  const host = anchor.port ? getElement(state.project, anchor.port.elementId) : undefined;
  const axis = port && host?.kind === 'pipe' ? port.direction : null;
  return polarLockPoint(anchor.point, axis, point, lengthStepOf(state, precision()));
}

/** Distância (m) de um ponto ao raio do cursor. */
function distanceToRay(ray: Ray, point: Vec3): number {
  const offset = sub(point, ray.origin);
  const direction = ray.direction;
  const norm = length(direction);
  if (norm < 1e-12) return length(offset);
  return length(cross(offset, direction)) / norm;
}

/**
 * Vista 3D com Shift: o trecho vertical e a trava de 45°/90° no plano de trabalho concorrem.
 * Vale o ponto mais próximo do cursor — apontando para cima ou para baixo do ponto de partida,
 * o trecho é vertical; apontando para os lados, fica no plano, travado. Porta capturada sempre
 * prevalece. `flat` e `up` são as capturas sem e com a restrição vertical.
 */
export function shiftPick(
  state: PolarState,
  ray: Ray,
  flat: PickResult | null,
  up: PickResult | null,
): PickResult | null {
  if (flat?.port) return flat;
  const locked = flat ? polarLockedPoint(state, flat.point) : null;
  if (!locked) return up ?? flat;
  const planar: PickResult = { point: locked, snap: 'angle', port: null, stacked: 1 };
  if (!up) return planar;
  // Compara pelo afastamento visto do cursor (distância ao raio sobre a distância ao olho).
  const seen = (point: Vec3): number => {
    const depth = Math.max(
      dot(sub(point, ray.origin), ray.direction) / length(ray.direction),
      1e-6,
    );
    return distanceToRay(ray, point) / depth;
  };
  return seen(up.point) < seen(planar.point) ? up : planar;
}

// --- Estado da tecla ------------------------------------------------------------------------
// A planta resolve o ponto fora do evento do ponteiro; por isso o estado do Shift é mantido
// aqui, a partir dos eventos de teclado e de ponteiro da janela.

let held = false;

/** `true` enquanto o Shift está pressionado. */
export const isPolarLockHeld = (): boolean => held;

/** Só para testes e para quem recebe o evento diretamente. */
export function setPolarLockHeld(value: boolean): void {
  held = value;
}

if (typeof window !== 'undefined') {
  const sync = (event: KeyboardEvent | PointerEvent | MouseEvent): void => {
    held = event.shiftKey;
  };
  window.addEventListener('keydown', sync, true);
  window.addEventListener('keyup', sync, true);
  window.addEventListener('pointermove', sync, true);
  window.addEventListener('pointerdown', sync, true);
  window.addEventListener('blur', () => {
    held = false;
  });
}
