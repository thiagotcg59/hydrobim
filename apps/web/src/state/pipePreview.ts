import {
  catalogViolation,
  closureCandidates,
  fail,
  getFreePorts,
  ok,
  resolvePort,
  type Closure,
  type Port,
  type PortRef,
  type Project,
  type Result,
  type Vec3,
} from '@hydrobim/core';
import {
  catalogOf,
  elbowAnglesOf,
  pipeSegmentOperation,
  pipeTargetOperation,
  type DrawAnchor,
  type PipeOperationState,
  type ToolOptions,
} from './editorStore';
import type { PipeSpec } from '@hydrobim/core';

/**
 * Planejamento das operações de traçado sem gravá-las: a mesma chamada ao núcleo, com os
 * mesmos parâmetros (especificação, catálogo, ângulos de joelho, política de catálogo) que a
 * confirmação usa. É o que alimenta a prévia — o que ela mostra é o que será criado.
 */

export interface PipePlanState {
  readonly project: Project;
  readonly anchor: DrawAnchor | null;
  readonly activeSpec: PipeSpec;
  readonly toolOptions: ToolOptions;
}

/** Recusa da política "somente peças de catálogo", como na confirmação. */
function policy(state: PipePlanState, after: Project): Result<Project> {
  const problem = state.toolOptions.lockElbowAngles ? catalogViolation(state.project, after) : null;
  return problem ? fail('OFF_CATALOG', problem) : ok(after);
}

/**
 * Projeto resultante de terminar o trecho em andamento no ponto dado (sem alterar nada).
 * Recusa pelos mesmos motivos da confirmação: ângulo sem joelho, tubo curto, peça genérica.
 */
export function planPipeSegment(state: PipePlanState, point: Vec3): Result<Project> {
  if (!state.anchor) return fail('NO_ANCHOR', 'Indique primeiro o ponto inicial do trecho.');
  const result = pipeSegmentOperation(state, point);
  return result.ok ? policy(state, result.value.project) : result;
}

/**
 * Projeto resultante de terminar o trecho sobre o tubo, tê ou cruzeta `elementId` — a mesma
 * operação da confirmação (tê automático, cruzeta, prolongamento do ramal, flanges).
 */
export function planPipeTarget(
  state: PipePlanState & { viewMode?: PipeOperationState['viewMode'] },
  elementId: string,
): Result<Project> {
  if (!state.anchor) return fail('NO_ANCHOR', 'Indique primeiro o ponto inicial do trecho.');
  const result = pipeTargetOperation(state, elementId);
  return result.ok ? policy(state, result.value.project) : result;
}

export interface ClosurePlan {
  readonly a: Port;
  readonly b: Port;
  /** Soluções disponíveis para o par; vazio quando `error` explica a recusa. */
  readonly closures: readonly Closure[];
  readonly error: string | null;
}

/** Parâmetros do fechamento para a especificação da porta, como no traçado. */
export function closureInputFor(
  state: Pick<PipePlanState, 'project' | 'toolOptions'>,
  a: PortRef,
  b: PortRef,
) {
  const port = resolvePort(state.project, a);
  return {
    a,
    b,
    catalog: catalogOf(state.project, state.toolOptions.families),
    elbowAngles:
      port && state.toolOptions.lockElbowAngles
        ? elbowAnglesOf(state.project, port.spec, port.end)
        : undefined,
  };
}

/**
 * Formas de ligar as extremidades livres de dois elementos: para cada par de portas, as
 * soluções com peças disponíveis ou o motivo da recusa. Soluções que criariam peça genérica
 * com "somente peças de catálogo" ligado são descartadas, com a explicação.
 */
export function planClosures(
  state: Pick<PipePlanState, 'project' | 'toolOptions'>,
  elementA: string,
  elementB: string,
): ClosurePlan[] {
  const free = getFreePorts(state.project);
  const plans: ClosurePlan[] = [];
  for (const a of free.filter((port) => port.ref.elementId === elementA)) {
    for (const b of free.filter((port) => port.ref.elementId === elementB)) {
      const found = closureCandidates(state.project, closureInputFor(state, a.ref, b.ref));
      if (!found.ok) {
        plans.push({ a, b, closures: [], error: found.error.message });
        continue;
      }
      const accepted: Closure[] = [];
      let refusal: string | null = null;
      for (const closure of found.value) {
        const problem = state.toolOptions.lockElbowAngles
          ? catalogViolation(state.project, closure.project)
          : null;
        if (problem) refusal ??= problem;
        else accepted.push(closure);
      }
      plans.push({ a, b, closures: accepted, error: accepted.length > 0 ? null : refusal });
    }
  }
  // Pares com solução primeiro; entre eles, os de menos peças.
  return plans.sort(
    (x, y) =>
      Number(y.closures.length > 0) - Number(x.closures.length > 0) ||
      (x.closures[0]?.createdIds.length ?? 0) - (y.closures[0]?.createdIds.length ?? 0),
  );
}
