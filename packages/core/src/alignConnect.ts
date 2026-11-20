import { closureCandidates, type Closure, type ClosureInput } from './closure';
import { connectedComponent, getElement, isPortFree, resolvePort } from './connectivity';
import { ANGLE_TOLERANCE, MIN_PIPE_LENGTH, POSITION_TOLERANCE } from './dimensions';
import {
  add,
  angleBetween,
  closestPointsBetweenLines,
  distance,
  dot,
  length,
  negate,
  scale,
  sub,
  vec3,
  type Vec3,
} from './math';
import { translateElements } from './operations';
import type { Port } from './ports';
import { fail, ok, type Result } from './result';
import type { PortRef, Project } from './schema';
import { formatMeters } from './units';

/**
 * "Alinhar e conectar": liga a extremidade livre de um trecho à porta de um equipamento ou de
 * outro elemento. A PORTA de destino (posição, direção e cota) é a referência — nunca o centro
 * da malha.
 *
 *  - ALINHAR posiciona o trecho de partida segundo a referência (translação rígida do conjunto
 *    ligado à extremidade), sem criar peças nem registrar ligação.
 *  - CONECTAR completa a montagem (prolongamento, joelho, desvio) pelas mesmas operações do
 *    traçado e registra a ligação entre as portas.
 *
 * O equipamento de destino fica fixo; movê-lo só aparece como alternativa explícita.
 */

/** Relação entre os eixos das duas portas. */
export type AxisRelation = 'coincident' | 'collinear' | 'crossing' | 'parallel' | 'skew';

export interface ConnectionGuides {
  readonly from: Port;
  readonly to: Port;
  readonly relation: AxisRelation;
  /** Pontos de maior aproximação entre os eixos (no eixo de partida e no de destino). */
  readonly meet: { readonly onFrom: Vec3; readonly onTo: Vec3 } | null;
  /** Projeção da porta de partida no eixo da porta de destino. */
  readonly footOnTarget: Vec3;
  /** Avanço da porta de partida à frente da porta de destino, ao longo do eixo dela (m). */
  readonly ahead: number;
  /** Desvio da porta de partida em relação ao eixo de destino: horizontal e vertical (m). */
  readonly horizontalOffset: number;
  readonly verticalOffset: number;
  /** Distância em linha reta entre as portas (m). */
  readonly distance: number;
  /** Ângulo entre a saída da porta de partida e a chegada exigida pela de destino (rad). */
  readonly deflection: number;
}

/** Guias de alinhamento entre duas portas: eixos, projeções, encontro e desvios. */
export function connectionGuides(from: Port, to: Port): ConnectionGuides {
  const gap = sub(from.position, to.position);
  const ahead = dot(gap, to.direction);
  const footOnTarget = add(to.position, scale(to.direction, ahead));
  const lateral = sub(from.position, footOnTarget);
  // Desvio vertical: componente em Z do desalinhamento; com eixo de destino vertical, todo o
  // desvio é horizontal.
  const verticalAxis = Math.abs(to.direction.z) > 1 - 1e-9;
  const verticalOffset = verticalAxis ? 0 : lateral.z;
  const horizontalOffset = Math.hypot(lateral.x, lateral.y, verticalAxis ? lateral.z : 0);
  const crossing = closestPointsBetweenLines(
    from.position,
    from.direction,
    to.position,
    to.direction,
  );
  const meet = crossing ? { onFrom: crossing.p1, onTo: crossing.p2 } : null;
  const parallel =
    angleBetween(from.direction, negate(to.direction)) <= ANGLE_TOLERANCE ||
    angleBetween(from.direction, to.direction) <= ANGLE_TOLERANCE;
  const offAxis = length(lateral);
  let relation: AxisRelation;
  if (length(gap) <= POSITION_TOLERANCE) relation = 'coincident';
  else if (parallel) relation = offAxis <= POSITION_TOLERANCE ? 'collinear' : 'parallel';
  else if (meet && distance(meet.onFrom, meet.onTo) <= POSITION_TOLERANCE) relation = 'crossing';
  else relation = 'skew';
  return {
    from,
    to,
    relation,
    meet,
    footOnTarget,
    ahead,
    horizontalOffset,
    verticalOffset,
    distance: length(gap),
    deflection: angleBetween(from.direction, negate(to.direction)),
  };
}

export type ConnectionAction = 'connect' | 'align' | 'alignConnect' | 'moveEquipment';

export interface ConnectionCandidate {
  /** Chave estável da alternativa (para a escolha na interface e nos testes). */
  readonly key: string;
  readonly action: ConnectionAction;
  readonly label: string;
  readonly summary: string;
  /** Projeto resultante — o mesmo que a confirmação grava. */
  readonly project: Project;
  /** Elementos criados. */
  readonly createdIds: readonly string[];
  /** Elementos transladados pelo alinhamento (sem mudança de forma). */
  readonly movedIds: readonly string[];
  /** A ligação entre as duas portas fica registrada. */
  readonly connects: boolean;
}

export interface ConnectionPlan {
  readonly guides: ConnectionGuides;
  readonly candidates: readonly ConnectionCandidate[];
  /** Motivos das alternativas recusadas (para explicar quando não há nenhuma). */
  readonly refusals: readonly string[];
}

export interface ConnectionInput extends Omit<ClosureInput, 'a' | 'b'> {
  /** Extremidade livre do trecho (o que se move ao alinhar). */
  from: PortRef;
  /** Porta de referência: equipamento ou outro elemento (fica fixa). */
  to: PortRef;
}

const EQUIPMENT = new Set(['pump', 'tank']);

function closureLabel(closure: Closure): string {
  switch (closure.kind) {
    case 'coincident':
      return 'Registrar a ligação';
    case 'straight':
      return 'Prolongamento reto';
    case 'elbow':
      return 'Joelho no encontro dos eixos';
    case 'offset':
      return 'Desvio com dois joelhos';
    case 'deflected':
      return 'Tubo com deflexão nas juntas';
  }
}

const ORDER: Record<ConnectionAction, number> = {
  connect: 0,
  alignConnect: 1,
  align: 2,
  moveEquipment: 3,
};

/** Conecta (fechamento) e devolve as alternativas, com a chave prefixada. */
function connectOptions(
  project: Project,
  input: ConnectionInput,
  prefix: string,
  action: ConnectionAction,
  movedIds: readonly string[],
  lead: string,
): Result<ConnectionCandidate[]> {
  const found = closureCandidates(project, { ...input, a: input.from, b: input.to });
  if (!found.ok) return found;
  return ok(
    found.value.map((closure) => ({
      key: `${prefix}${closure.kind}${closure.angle === null ? '' : `:${Math.round(((closure.angle * 180) / Math.PI) * 100) / 100}`}`,
      action,
      label: `${lead}${closureLabel(closure)}`,
      summary: closure.summary,
      project: closure.project,
      createdIds: closure.createdIds,
      movedIds,
      connects: true,
    })),
  );
}

/**
 * Alternativas para ligar `from` a `to`, das mais simples às mais invasivas: ligação direta,
 * prolongamento, joelho, desvio; depois alinhar o trecho (cota, eixo) — sozinho ou já
 * conectando; por último, mover o equipamento (só quando ele está solto). Cada alternativa
 * traz o projeto resultante, calculado pelas operações de domínio. O projeto recebido nunca é
 * alterado.
 */
export function planConnection(project: Project, input: ConnectionInput): Result<ConnectionPlan> {
  if (input.from.elementId === input.to.elementId) {
    return fail('SAME_ELEMENT', 'Escolha portas de dois elementos diferentes.');
  }
  const from = resolvePort(project, input.from);
  const to = resolvePort(project, input.to);
  if (!from || !to) return fail('PORT_NOT_FOUND', 'Porta de conexão inexistente.');
  if (!isPortFree(project, input.from) || !isPortFree(project, input.to)) {
    return fail('PORT_OCCUPIED', 'Uma das portas já está ligada.');
  }
  const guides = connectionGuides(from, to);
  const candidates: ConnectionCandidate[] = [];
  const refusals: string[] = [];
  const keep = (result: Result<ConnectionCandidate[]>) => {
    if (result.ok) candidates.push(...result.value);
    else if (!refusals.includes(result.error.message)) refusals.push(result.error.message);
  };

  // 1. Conectar como está.
  keep(connectOptions(project, input, '', 'connect', [], ''));

  // 2. Alinhar o trecho de partida: translação rígida do conjunto ligado à extremidade, se ele
  //    não inclui o destino nem um equipamento (equipamento só se move por escolha explícita).
  const group = connectedComponent(project, input.from.elementId);
  const anchoredTo = group
    .map((id) => getElement(project, id))
    .find(
      (element) => element && (element.id === input.to.elementId || EQUIPMENT.has(element.kind)),
    );
  const lateral = sub(guides.footOnTarget, from.position);
  const moves: { key: string; label: string; delta: Vec3 }[] = [];
  if (Math.abs(guides.verticalOffset) > POSITION_TOLERANCE) {
    moves.push({
      key: 'elevation',
      label: `Alinhar a cota (${guides.verticalOffset > 0 ? 'descer' : 'subir'} ${formatMeters(Math.abs(guides.verticalOffset), 3)})`,
      delta: vec3(0, 0, -guides.verticalOffset),
    });
  }
  if (length(lateral) > POSITION_TOLERANCE && guides.horizontalOffset > POSITION_TOLERANCE) {
    moves.push({
      key: 'axis',
      label: `Alinhar ao eixo da porta (${formatMeters(length(lateral), 3)})`,
      delta: lateral,
    });
  }
  if (moves.length > 0 && anchoredTo) {
    refusals.push(
      anchoredTo.id === input.to.elementId
        ? 'Alinhar moveria também o elemento de destino: o trecho já está ligado a ele por outro caminho.'
        : `Alinhar moveria "${anchoredTo.name}", ligado ao trecho: o equipamento só é movido por escolha explícita.`,
    );
  } else {
    for (const move of moves) {
      const moved = translateElements(project, group, move.delta);
      if (!moved.ok) {
        refusals.push(moved.error.message);
        continue;
      }
      candidates.push({
        key: `align:${move.key}`,
        action: 'align',
        label: move.label,
        summary: `${group.length} elemento(s) transladado(s) ${formatMeters(length(move.delta), 3)}; sem ligação`,
        project: moved.value,
        createdIds: [],
        movedIds: group,
        connects: false,
      });
      const joined = connectOptions(
        moved.value,
        input,
        `align:${move.key}+`,
        'alignConnect',
        group,
        `${move.label} + `,
      );
      if (joined.ok) candidates.push(...joined.value);
    }
  }

  // 3. Mover o equipamento de destino, só quando ele está solto (sem outras ligações).
  const target = getElement(project, input.to.elementId);
  if (target && EQUIPMENT.has(target.kind)) {
    const own = connectedComponent(project, target.id);
    const ahead = Math.max(guides.ahead, 0);
    // A porta de destino passa a ficar no eixo de saída da partida, à mesma distância.
    const wanted = add(
      from.position,
      scale(from.direction, Math.max(ahead, MIN_PIPE_LENGTH * 100)),
    );
    const delta = sub(wanted, to.position);
    const opposite = angleBetween(from.direction, negate(to.direction)) <= ANGLE_TOLERANCE;
    if (own.length === 1 && opposite && length(delta) > POSITION_TOLERANCE) {
      const moved = translateElements(project, [target.id], delta);
      if (moved.ok) {
        const joined = connectOptions(
          moved.value,
          input,
          'move:',
          'moveEquipment',
          [target.id],
          `Mover "${target.name}" ${formatMeters(length(delta), 3)} + `,
        );
        if (joined.ok) candidates.push(...joined.value);
      }
    }
  }

  candidates.sort(
    (x, y) => ORDER[x.action] - ORDER[y.action] || x.createdIds.length - y.createdIds.length,
  );
  return ok({ guides, candidates, refusals });
}
