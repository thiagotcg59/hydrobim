import {
  dot,
  getElement,
  getPorts,
  negate,
  normalize,
  portKey,
  scale,
  sub,
  type Pipe,
  type Port,
  type PortRef,
  type Project,
  type Vec3,
} from '@hydrobim/core';
import { visibleElementsOf, visibleFreePortsOf } from './visibility';

/**
 * Edição direta na vista (alças de tubo e setas do teclado). Funções puras (sem Three.js nem
 * DOM): traduzem o gesto do usuário em comprimento ou sentido ao longo do eixo.
 */

/** Alinhamento mínimo (cosseno) entre a seta e um eixo para a seta escolher o sentido. */
const MIN_ALIGNMENT = 0.2;

/**
 * Sentido de deslizamento para uma seta do teclado. `preferences` são as direções da seta no
 * modelo, em ordem de prioridade (ex.: "direita" da tela, depois "cima", depois "para o
 * observador"): vale o eixo mais alinhado com a primeira que não lhe for perpendicular — assim
 * toda seta move a peça, mesmo quando o tubo está perpendicular a ela na tela.
 */
export function chooseSlideDirection(
  axes: readonly Vec3[],
  preferences: readonly Vec3[],
): Vec3 | null {
  for (const preference of preferences) {
    let best: Vec3 | null = null;
    let bestAlignment = MIN_ALIGNMENT;
    for (const axis of axes) {
      const alignment = dot(normalize(axis), preference);
      if (Math.abs(alignment) > bestAlignment) {
        bestAlignment = Math.abs(alignment);
        const signed = scale(normalize(axis), Math.sign(alignment));
        // Sem zeros negativos, que poluiriam as coordenadas apresentadas.
        best = { x: signed.x || 0, y: signed.y || 0, z: signed.z || 0 };
      }
    }
    if (best) return best;
  }
  return null;
}

/** Componente dominante de um eixo paralelo a X, Y ou Z; `null` para eixo inclinado. */
function worldAxisOf(axis: Vec3): 'x' | 'y' | 'z' | null {
  for (const key of ['x', 'y', 'z'] as const) {
    if (Math.abs(axis[key]) > 1 - 1e-6) return key;
  }
  return null;
}

/**
 * Comprimento do tubo ajustado à grade ao arrastar a extremidade `which`: em tubo paralelo a
 * um eixo do modelo a extremidade cai sobre a grade; em tubo inclinado, o comprimento é
 * múltiplo do passo. `step` 0 desativa o ajuste.
 */
export function snapStretchLength(
  pipe: Pipe,
  which: 'start' | 'end',
  length: number,
  step: number,
): number {
  if (step <= 0) return length;
  const fixed = which === 'end' ? pipe.start : pipe.end;
  const moving = which === 'end' ? pipe.end : pipe.start;
  const axis = normalize(sub(moving, fixed));
  const key = worldAxisOf(axis);
  if (!key) return Math.round(length / step) * step;
  const coordinate = Math.round((fixed[key] + axis[key] * length) / step) * step;
  return (coordinate - fixed[key]) * axis[key];
}

/**
 * Direções de uma seta do teclado no modelo, em ordem de prioridade, a partir dos vetores
 * "direita", "cima" e "para o observador" da vista. `null` = a tecla não é uma seta.
 */
export function arrowPreferences(key: string, right: Vec3, up: Vec3, out: Vec3): Vec3[] | null {
  switch (key) {
    case 'ArrowRight':
      return [right, up, out];
    case 'ArrowLeft':
      return [negate(right), negate(up), negate(out)];
    case 'ArrowUp':
      return [up, right, out];
    case 'ArrowDown':
      return [negate(up), negate(right), negate(out)];
    default:
      return null;
  }
}

/** Passo das setas: o da grade; Shift multiplica por 10 e Ctrl divide por 10 (ajuste fino). */
export function nudgeStep(
  gridStep: number,
  modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
): number {
  if (modifiers.shiftKey) return gridStep * 10;
  return modifiers.ctrlKey || modifiers.metaKey ? gridStep / 10 : gridStep;
}

/** Raio (px) em que o botão direito reconhece uma extremidade de tubo ou porta de conexão. */
export const CONTEXT_PX = 24;

/**
 * Alvo do botão direito: a porta livre junto ao cursor (de onde um tubo pode partir); na
 * falta dela, a porta já conectada que estiver ali (o menu explica por que não há ação) ou,
 * apontando o corpo de uma conexão ou equipamento, a porta livre dele mais próxima (no corpo
 * de um tubo, o próprio tubo, sem porta).
 * `pick` escolhe a porta sob o cursor entre as candidatas e `gap` mede a distância ao cursor
 * — cada vista (3D ou planta) fornece os seus. `null` = nada a oferecer nesse ponto.
 */
export function contextTargetOf(
  project: Project,
  hitElementId: string | null,
  pick: (ports: readonly Port[]) => Port | null,
  gap: (port: Port) => number,
): { elementId: string; port: PortRef | null } | null {
  const free = visibleFreePortsOf(project);
  const near = pick(free);
  if (near) return { elementId: near.ref.elementId, port: near.ref };
  const freeKeys = new Set(free.map((port) => portKey(port.ref)));
  const taken = pick(
    visibleElementsOf(project)
      .flatMap(getPorts)
      .filter((port) => !freeKeys.has(portKey(port.ref))),
  );
  if (taken) return { elementId: taken.ref.elementId, port: null };
  const hit = hitElementId ? getElement(project, hitElementId) : undefined;
  if (!hit) return null;
  // No corpo do tubo, longe das extremidades, não há de onde partir um tubo — o menu abre
  // pelas ações do próprio elemento (Mover).
  if (hit.kind === 'pipe') return { elementId: hit.id, port: null };
  const own = free.filter((port) => port.ref.elementId === hit.id).sort((a, b) => gap(a) - gap(b));
  return { elementId: hit.id, port: own[0]?.ref ?? null };
}

/** Comprimento (a partir da extremidade oposta) indicado por um ponto sobre o eixo do tubo. */
export function stretchLengthAt(pipe: Pipe, which: 'start' | 'end', point: Vec3): number {
  const fixed = which === 'end' ? pipe.start : pipe.end;
  const moving = which === 'end' ? pipe.end : pipe.start;
  return dot(sub(point, fixed), normalize(sub(moving, fixed)));
}
