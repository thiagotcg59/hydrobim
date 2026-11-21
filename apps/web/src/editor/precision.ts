import {
  getElement,
  resolvePort,
  vec3,
  type PortRef,
  type Project,
  type Vec3,
} from '@hydrobim/core';
import type { PrecisionSettings } from '../state/precisionStore';

const roundTo = (value: number, step: number): number =>
  step > 0 ? Math.round(value / step) * step : value;

/**
 * Ponto do trecho com a precisão de modelagem: em planta, a direção anda de `angleStep` em
 * `angleStep` a partir de `reference` (rad; o eixo do tubo de partida ou +X) e o comprimento
 * horizontal de `lengthStep` em `lengthStep`; a cota pedida é mantida. Trecho vertical (sem
 * afastamento em planta): só o desnível é arredondado. Nunca devolve comprimento nulo.
 */
export function precisePoint(
  origin: Vec3,
  target: Vec3,
  reference: number,
  settings: Pick<PrecisionSettings, 'lengthStep' | 'angleStep'>,
): Vec3 {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const horizontal = Math.hypot(dx, dy);
  if (horizontal < 1e-9) {
    const dz = roundTo(target.z - origin.z, settings.lengthStep);
    return Math.abs(dz) > 1e-9 ? vec3(origin.x, origin.y, origin.z + dz) : target;
  }
  const angle = reference + roundTo(Math.atan2(dy, dx) - reference, settings.angleStep);
  const rounded = roundTo(horizontal, settings.lengthStep);
  const distance =
    rounded > 1e-9 ? rounded : settings.lengthStep > 0 ? settings.lengthStep : horizontal;
  return vec3(
    origin.x + Math.cos(angle) * distance,
    origin.y + Math.sin(angle) * distance,
    target.z,
  );
}

interface PreciseState {
  readonly project: Project;
  readonly tool: string;
  readonly anchor: {
    readonly point: Vec3;
    readonly port: PortRef | null;
    readonly lockAxis: Vec3 | null;
  } | null;
}

/**
 * Ponto do cursor com a precisão aplicada ao trecho de tubo em andamento, ou `null` quando ela
 * não se aplica: fora da ferramenta de tubo, sem ponto de partida, precisão desligada ou
 * saindo de uma conexão (o eixo da porta já é obrigatório). Partindo de um tubo, os ângulos
 * contam a partir do eixo dele (seguir reto fica exato).
 */
export function precisePipePoint(
  state: PreciseState,
  point: Vec3,
  settings: PrecisionSettings,
): Vec3 | null {
  const { anchor } = state;
  if (!settings.enabled || state.tool !== 'pipe' || !anchor || anchor.lockAxis) return null;
  const port = anchor.port ? resolvePort(state.project, anchor.port) : undefined;
  const host = anchor.port ? getElement(state.project, anchor.port.elementId) : undefined;
  const axis = port && host?.kind === 'pipe' ? port.direction : null;
  const reference = axis && Math.hypot(axis.x, axis.y) > 1e-9 ? Math.atan2(axis.y, axis.x) : 0;
  return precisePoint(anchor.point, point, reference, settings);
}

/** Passo de comprimento efetivo: o da precisão, se ligada; senão, o da grade. */
export function lengthStepOf(
  state: { readonly snapToGrid: boolean; readonly gridStep: number },
  settings: PrecisionSettings,
): number {
  if (settings.enabled) return settings.lengthStep;
  return state.snapToGrid ? state.gridStep : 0;
}
