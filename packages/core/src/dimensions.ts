import type { PipeSpec } from './schema';
import { degToRad } from './units';

/**
 * Tolerâncias e dimensões genéricas das conexões.
 *
 * ATENÇÃO: as dimensões padrão de conexões abaixo são proporções genéricas em função do
 * diâmetro externo, usadas enquanto não existir catálogo dimensional de conexões por
 * fabricante/norma (Fase 2). Não representam nenhum produto comercial específico.
 */

/** Distância máxima (m) para considerar duas portas coincidentes. */
export const POSITION_TOLERANCE = 5e-4;
/** Desvio angular máximo (rad) para considerar duas direções alinhadas. */
export const ANGLE_TOLERANCE = degToRad(0.5);
/** Comprimento mínimo (m) de um trecho de tubo. */
export const MIN_PIPE_LENGTH = 1e-3;

export const MIN_ELBOW_ANGLE = degToRad(1);
export const MAX_ELBOW_ANGLE = degToRad(135);

/** Raio de curvatura padrão (raio longo genérico: 1,5 × diâmetro externo). */
export const defaultBendRadius = (spec: PipeSpec): number => 1.5 * spec.outerDiameter;

/** Distância do vértice teórico do joelho até a face de cada porta. */
export const elbowLegLength = (angle: number, bendRadius: number): number =>
  bendRadius * Math.tan(angle / 2);

export const defaultTeeDimensions = (
  spec: PipeSpec,
): { runLength: number; branchLength: number } => ({
  runLength: Math.max(3 * spec.outerDiameter, 0.05),
  branchLength: Math.max(1.5 * spec.outerDiameter, 0.025),
});

export const defaultValveLength = (spec: PipeSpec): number =>
  Math.max(3 * spec.outerDiameter, 0.06);

export const defaultReducerLength = (a: PipeSpec, b: PipeSpec): number =>
  Math.max(2 * Math.max(a.outerDiameter, b.outerDiameter), 0.05);
