import {
  closureCandidates,
  deflectedElbowClosure,
  type Closure,
  type ClosureInput,
} from './closure';
import { prepareConnectionReduction } from './connectionReduction';
import { routeConnection } from './connectionRoute';
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
import { rotateElements, translateElements } from './operations';
import type { Port } from './ports';
import { fail, ok, type Result } from './result';
import type { PortRef, Project } from './schema';
import { formatDegrees, formatMeters } from './units';

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
 * Nas alternativas de conectar e de alinhar o trecho, a referência fica fixa. Alinhar também é
 * oferecido para o lado da referência (em relação ao trecho). Quando o conjunto alinhado inclui
 * um equipamento, ele vai junto: a alternativa sai como `moveEquipment`, identificada e
 * ordenada por último.
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
    case 'elbowDeflected':
      return 'Um joelho com deflexão na junta';
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
  const from = resolvePort(project, input.from);
  const to = resolvePort(project, input.to);
  if (from && to && from.spec.dn !== to.spec.dn) {
    const reduction = prepareConnectionReduction(project, input);
    if (!reduction.ok) return reduction;
    const prepared = reduction.value;
    if (prepared.connects) {
      return ok([
        {
          key: `${prefix}reduction`,
          action,
          label: `${lead}Conectar com redução de catálogo`,
          summary: prepared.summary,
          project: prepared.project,
          createdIds: prepared.createdIds,
          movedIds,
          connects: true,
        },
      ]);
    }
    // O DN de saída pode ter menos ângulos que o de partida; só entram os resolvidos
    // pelo catálogo para o novo diâmetro, inclusive o 90° necessário ao percurso espacial.
    const elbowAngles = [...new Set([...(input.elbowAngles ?? []), Math.PI / 2])].filter(
      (angle) => {
        // Sem catálogo não há ângulo resolvido; `familyId: null` é a peça genérica.
        const familyId = input.catalog?.elbow(to.spec, angle).familyId;
        return familyId !== undefined && familyId !== null;
      },
    );
    const joined = connectOptions(
      prepared.project,
      { ...input, from: prepared.from, elbowAngles },
      `${prefix}reduction:`,
      action,
      movedIds,
      `${lead}Redução + `,
    );
    return joined.ok
      ? ok(
          joined.value.map((candidate) => ({
            ...candidate,
            createdIds: [...prepared.createdIds, ...candidate.createdIds],
            summary: `${prepared.summary}; ${candidate.summary}`,
          })),
        )
      : joined;
  }
  const ends = { ...input, a: input.from, b: input.to };
  const fromClosure = (closure: Closure): ConnectionCandidate => ({
    key: `${prefix}${closure.kind}${closure.angle === null ? '' : `:${Math.round(((closure.angle * 180) / Math.PI) * 100) / 100}`}`,
    action,
    label: `${lead}${closureLabel(closure)}`,
    summary: closure.summary,
    project: closure.project,
    createdIds: closure.createdIds,
    movedIds,
    connects: true,
  });
  const found = closureCandidates(project, ends);
  if (found.ok) return ok(found.value.map(fromClosure));
  // Sem fechamento exato: primeiro o mais simples (um joelho, com a sobra na deflexão que a
  // junta admite); depois o percurso de três joelhos, que não depende de deflexão.
  const options: ConnectionCandidate[] = [];
  const simple = deflectedElbowClosure(project, ends);
  if (simple.ok) options.push(fromClosure(simple.value));
  const route = routeConnection(project, ends);
  if (route.ok) {
    options.push({
      key: `${prefix}route:orthogonal`,
      action,
      label: `${lead}Traçar conexão em planos diferentes`,
      summary: route.value.summary,
      project: route.value.project,
      createdIds: route.value.createdIds,
      movedIds,
      connects: true,
    });
  }
  if (options.length > 0) return ok(options);
  return fail(
    found.error.code,
    `${found.error.message} Um joelho: ${simple.ok ? '' : simple.error.message} Percurso alternativo: ${route.ok ? '' : route.error.message}`,
  );
}

/**
 * Alternativas para ligar `from` a `to`, das mais simples às mais invasivas: ligação direta,
 * prolongamento, joelho, desvio; depois alinhar o trecho (cota, eixo) — sozinho ou já
 * conectando, e o mesmo para o lado da referência, alinhado ao trecho; por último, as que movem
 * equipamento — o levado junto pelo alinhamento de um dos lados ou o de destino solto. Sem
 * montagem possível como está, alinhar inclui o giro em planta que põe as portas de frente. Cada alternativa
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

  // 2. Alinhar um dos lados ao outro: movimento rígido do conjunto ligado àquela porta (a rede
  //    ligada não se deforma). Primeiro o trecho de partida em relação à porta de referência;
  //    depois o lado da referência em relação ao trecho. Com equipamento no conjunto, ele vai
  //    junto e a alternativa é identificada como "mover o equipamento".
  const group = connectedComponent(project, input.from.elementId);
  const target = getElement(project, input.to.elementId);
  const directlyConnectable = candidates.some((candidate) => candidate.connects);
  const opposite = angleBetween(from.direction, negate(to.direction)) <= ANGLE_TOLERANCE;
  const targetGroup = connectedComponent(project, input.to.elementId);
  // Equipamento de destino solto e de frente para o trecho: tratado no passo 3.
  const looseTarget =
    target !== undefined && EQUIPMENT.has(target.kind) && targetGroup.length === 1 && opposite;

  const alignSide = (side: 'from' | 'to'): void => {
    const ids = side === 'from' ? group : targetGroup;
    const moving = side === 'from' ? from : to;
    const fixed = side === 'from' ? to : from;
    // Do ponto de vista do lado que se move, a outra porta é a referência.
    const own = side === 'from' ? guides : connectionGuides(to, from);
    const carried = ids.flatMap((id) => {
      const element = getElement(project, id);
      return element && EQUIPMENT.has(element.kind) ? [element] : [];
    });
    const movesEquipment = carried.length > 0;
    const prefix = `${movesEquipment ? 'move:' : ''}align:${side === 'to' ? 'target:' : ''}`;
    const subject =
      side === 'from'
        ? ''
        : ` de "${target?.name ?? '?'}"${ids.length > 1 ? ' e da rede ligada' : ''}`;
    const reference = side === 'from' ? 'da porta' : 'do trecho';
    const carrying = movesEquipment
      ? `, movendo ${carried.map((element) => `"${element.name}"`).join(', ')}`
      : '';

    const moves: { key: string; label: string; moved: Result<Project>; summary: string }[] = [];
    const lateral = sub(own.footOnTarget, moving.position);
    if (Math.abs(own.verticalOffset) > POSITION_TOLERANCE) {
      const delta = vec3(0, 0, -own.verticalOffset);
      moves.push({
        key: 'elevation',
        label: `Alinhar a cota${subject} (${own.verticalOffset > 0 ? 'descer' : 'subir'} ${formatMeters(Math.abs(own.verticalOffset), 3)})${carrying}`,
        moved: translateElements(project, ids, delta),
        summary: `${ids.length} elemento(s) transladado(s) ${formatMeters(length(delta), 3)}`,
      });
    }
    // O equipamento de destino solto já tem a alternativa própria (passo 3).
    if (
      length(lateral) > POSITION_TOLERANCE &&
      own.horizontalOffset > POSITION_TOLERANCE &&
      !(side === 'to' && looseTarget)
    ) {
      moves.push({
        key: 'axis',
        label: `Alinhar${subject} ao eixo ${reference} (${formatMeters(length(lateral), 3)})${carrying}`,
        moved: translateElements(project, ids, lateral),
        summary: `${ids.length} elemento(s) transladado(s) ${formatMeters(length(lateral), 3)}`,
      });
    }
    // Sem montagem possível como está e com os eixos desencontrados em planta: girar o conjunto
    // em torno do eixo vertical pela própria porta (as cotas não mudam) e levá-lo ao eixo da
    // referência deixa as duas portas de frente uma para a outra, prontas para o encaixe.
    const wanted = negate(fixed.direction);
    const turn = Math.atan2(
      moving.direction.x * wanted.y - moving.direction.y * wanted.x,
      moving.direction.x * wanted.x + moving.direction.y * wanted.y,
    );
    const inPlan =
      Math.hypot(moving.direction.x, moving.direction.y) > 1e-9 &&
      Math.hypot(wanted.x, wanted.y) > 1e-9;
    if (!directlyConnectable && inPlan && Math.abs(turn) > ANGLE_TOLERANCE) {
      const turned = rotateElements(project, ids, moving.position, turn);
      let moved: Result<Project> = turned;
      let shift = 0;
      if (turned.ok) {
        const movingNow = resolvePort(turned.value, moving.ref);
        const fixedNow = resolvePort(turned.value, fixed.ref);
        if (movingNow && fixedNow) {
          const delta = sub(connectionGuides(movingNow, fixedNow).footOnTarget, movingNow.position);
          shift = length(delta);
          if (shift > POSITION_TOLERANCE) moved = translateElements(turned.value, ids, delta);
        }
      }
      const angle = formatDegrees(Math.abs(turn), 2);
      const shifted = shift > POSITION_TOLERANCE;
      moves.push({
        key: 'turn',
        label: `Alinhar${subject} ao eixo ${reference} (girar ${angle} em planta${shifted ? ` e deslocar ${formatMeters(shift, 3)}` : ''})${carrying}`,
        moved,
        summary: `${ids.length} elemento(s) girado(s) ${angle} em planta${shifted ? ` e transladado(s) ${formatMeters(shift, 3)}` : ''}`,
      });
    }

    for (const move of moves) {
      if (!move.moved.ok) {
        if (!refusals.includes(move.moved.error.message)) refusals.push(move.moved.error.message);
        continue;
      }
      candidates.push({
        key: `${prefix}${move.key}`,
        action: movesEquipment ? 'moveEquipment' : 'align',
        label: move.label,
        summary: `${move.summary}; sem ligação`,
        project: move.moved.value,
        createdIds: [],
        movedIds: ids,
        connects: false,
      });
      const joined = connectOptions(
        move.moved.value,
        input,
        `${prefix}${move.key}+`,
        movesEquipment ? 'moveEquipment' : 'alignConnect',
        ids,
        `${move.label} + `,
      );
      if (joined.ok) candidates.push(...joined.value);
    }
  };

  if (group.includes(input.to.elementId)) {
    if (guides.distance > POSITION_TOLERANCE) {
      refusals.push(
        'Alinhar moveria também o elemento de destino: o trecho já está ligado a ele por outro caminho.',
      );
    }
  } else {
    alignSide('from');
    alignSide('to');
  }

  // 3. Mover o equipamento de DESTINO solto (sem outras ligações) até a frente do trecho.
  if (target && looseTarget) {
    const ahead = Math.max(guides.ahead, 0);
    // A porta de destino passa a ficar no eixo de saída da partida, à mesma distância.
    const wanted = add(
      from.position,
      scale(from.direction, Math.max(ahead, MIN_PIPE_LENGTH * 100)),
    );
    const delta = sub(wanted, to.position);
    if (length(delta) > POSITION_TOLERANCE) {
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
