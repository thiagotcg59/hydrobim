import type { ClosureInput } from './closure';
import { connectedComponent, findConnection, isPortFree, resolvePort } from './connectivity';
import { MIN_PIPE_LENGTH, POSITION_TOLERANCE } from './dimensions';
import { matchElbowAngle } from './elbowAngles';
import { GENERIC_CATALOG } from './families';
import { newPipeFlange } from './flangeMatch';
import {
  add,
  cross,
  distance,
  dot,
  length,
  negate,
  scale,
  sub,
  tryNormalize,
  type Vec3,
} from './math';
import { drawPipe, endMismatch, runToPort, type PipeEndsInput } from './operations';
import type { Port } from './ports';
import { fail, ok, type Result } from './result';
import type { PortRef, Project } from './schema';
import { formatMeters } from './units';

export interface ConnectionRoute {
  readonly project: Project;
  readonly createdIds: readonly string[];
  readonly summary: string;
}

/**
 * Resolve três cantos de 90° entre dois trechos de chegada já definidos. O primeiro e o
 * último seguem os eixos das portas; os dois trechos intermediários são perpendiculares
 * entre si. O giro dos planos dos joelhos vence o desnível sem inventar ângulos de catálogo.
 */
function middleCorners(first: Vec3, last: Vec3, departure: Vec3, arrival: Vec3): Vec3[] {
  const u = tryNormalize(sub(arrival, scale(departure, dot(arrival, departure))));
  if (!u) return [];
  const v = cross(departure, u);
  const gap = sub(last, first);
  const x = dot(gap, u);
  const y = dot(gap, v);
  const magnitude = Math.hypot(x, y);
  const arrivalInPlane = dot(arrival, u);
  if (magnitude < MIN_PIPE_LENGTH || Math.abs(arrivalInPlane) < 1e-10) return [];
  // d1 = u cos(t) + v sin(t); (gap·d1)(arrival·d1) = gap·arrival.
  // A igualdade garante que d2 = gap - (gap·d1)d1 seja perpendicular à chegada.
  const cosine = ((2 * dot(gap, arrival)) / arrivalInPlane - x) / magnitude;
  if (cosine < -1 - 1e-10 || cosine > 1 + 1e-10) return [];
  const phase = Math.atan2(y, x);
  const offset = Math.acos(Math.max(-1, Math.min(1, cosine)));
  return [1, -1].flatMap((side) => {
    const angle = (phase + side * offset) / 2;
    let direction = add(scale(u, Math.cos(angle)), scale(v, Math.sin(angle)));
    let reach = dot(gap, direction);
    if (reach < 0) {
      direction = negate(direction);
      reach = -reach;
    }
    const corner = add(first, scale(direction, reach));
    const next = sub(last, corner);
    if (reach < MIN_PIPE_LENGTH || length(next) < MIN_PIPE_LENGTH) return [];
    // Protege os casos quase singulares: a folga numérica não vira desvio angular da junta.
    const nextDirection = tryNormalize(next);
    if (!nextDirection || Math.abs(dot(nextDirection, arrival)) > 1e-7) return [];
    return [corner];
  });
}

function startEnds(port: Port, input: ClosureInput): Result<PipeEndsInput | undefined> {
  if (port.end?.type !== 'flange') return ok(undefined);
  const flange = newPipeFlange(input.catalog ?? GENERIC_CATALOG, port.spec, [port.end]);
  return flange.ok
    ? ok({ start: flange.value.end, end: null, familyId: flange.value.familyId })
    : flange;
}

/** Monta o percurso pelas operações normais de desenho, preservando todos os elementos. */
function buildRoute(
  project: Project,
  input: ClosureInput,
  corners: readonly Vec3[],
): Result<ConnectionRoute> {
  let current = project;
  let from: PortRef = input.a;
  const createdIds: string[] = [];
  for (const point of corners) {
    const port = resolvePort(current, from);
    if (!port) return fail('PORT_NOT_FOUND', 'Porta de conexão inexistente.');
    const ends = startEnds(port, input);
    if (!ends.ok) return ends;
    const drawn = drawPipe(current, {
      fromPort: from,
      start: port.position,
      end: point,
      spec: port.spec,
      catalog: input.catalog,
      elbowAngles: [Math.PI / 2],
      ...(ends.value ? { ends: ends.value } : {}),
    });
    if (!drawn.ok) return drawn;
    current = drawn.value.project;
    createdIds.push(...drawn.value.createdIds);
    from = { elementId: drawn.value.elementId, portId: 'end' };
  }
  const port = resolvePort(current, from);
  if (!port) return fail('PORT_NOT_FOUND', 'Porta de conexão inexistente.');
  const closed = runToPort(
    current,
    {
      fromPort: from,
      start: port.position,
      spec: port.spec,
      catalog: input.catalog,
      elbowAngles: [Math.PI / 2],
    },
    input.b,
  );
  if (!closed.ok) return closed;
  current = closed.value.project;
  createdIds.push(...closed.value.createdIds);
  const originals = new Map(project.elements.map((element) => [element.id, element]));
  if (
    current.elements.some(
      (element) => originals.has(element.id) && originals.get(element.id) !== element,
    )
  ) {
    return fail('ROUTE_MOVES_ENDPOINT', 'O percurso exigiria alterar uma extremidade existente.');
  }
  if (
    !findConnection(current, input.a) ||
    !findConnection(current, input.b) ||
    !connectedComponent(current, input.a.elementId).includes(input.b.elementId)
  ) {
    return fail('NOT_COUPLED', 'O percurso não acopla às duas extremidades; nada foi criado.');
  }
  const previousLinks = new Set(project.connections.map((connection) => connection.id));
  for (const connection of current.connections) {
    if (previousLinks.has(connection.id)) continue;
    const a = resolvePort(current, connection.a);
    const b = resolvePort(current, connection.b);
    if (!a || !b) return fail('PORT_NOT_FOUND', 'Porta de conexão inexistente.');
    const mismatch = endMismatch(a.end, b.end);
    if (mismatch) return fail('END_MISMATCH', mismatch);
    if (distance(a.position, b.position) > POSITION_TOLERANCE) {
      return fail('NOT_COUPLED', 'O percurso não acopla às duas extremidades; nada foi criado.');
    }
  }
  const created = current.elements.filter((element) => createdIds.includes(element.id));
  const pipes = created.filter((element) => element.kind === 'pipe');
  const elbows = created.filter((element) => element.kind === 'elbow');
  const total = pipes.reduce((sum, pipe) => sum + distance(pipe.start, pipe.end), 0);
  return ok({
    project: current,
    createdIds,
    summary: `${elbows.length} joelhos de 90° e ${pipes.length} tubos (${formatMeters(total, 3)}); extremidades e equipamentos mantidos`,
  });
}

/**
 * Alternativa para eixos reversos: três joelhos de 90° em planos diferentes, com trechos
 * retos nas portas. Cada tentativa é uma montagem completa; peças que não cabem ou não
 * acoplam são descartadas. Não é um desvio de obstáculos: a prévia deve ser conferida.
 */
export function routeConnection(project: Project, input: ClosureInput): Result<ConnectionRoute> {
  const a = resolvePort(project, input.a);
  const b = resolvePort(project, input.b);
  if (!a || !b) return fail('PORT_NOT_FOUND', 'Porta de conexão inexistente.');
  if (!isPortFree(project, input.a) || !isPortFree(project, input.b)) {
    return fail('PORT_OCCUPIED', 'Uma das extremidades já está conectada.');
  }
  if (a.spec.specificationId !== b.spec.specificationId) {
    return fail('SPEC_MISMATCH', 'Especificações diferentes exigem uma peça de transição.');
  }
  if (a.spec.dn !== b.spec.dn) {
    return fail('DN_MISMATCH', 'Diâmetros diferentes exigem uma redução antes do percurso.');
  }
  const catalog = input.catalog ?? GENERIC_CATALOG;
  if (
    (input.elbowAngles?.length && matchElbowAngle(input.elbowAngles, Math.PI / 2) === null) ||
    catalog.elbow(a.spec, Math.PI / 2).familyId === null
  ) {
    return fail(
      'NO_ROUTE_ELBOW',
      'O percurso em planos diferentes exige joelhos de 90° de catálogo para esta especificação e DN.',
    );
  }
  const gap = sub(b.position, a.position);
  const arrival = negate(b.direction);
  const span = length(gap);
  const departureReach = Math.max(dot(gap, a.direction), span / 4);
  const arrivalReach = Math.max(dot(gap, arrival), span / 4);
  const solutions: { corners: Vec3[]; total: number }[] = [];
  for (const startFraction of [0.25, 0.5, 0.75]) {
    for (const endFraction of [0.25, 0.5, 0.75]) {
      const first = add(a.position, scale(a.direction, departureReach * startFraction));
      const last = add(b.position, scale(b.direction, arrivalReach * endFraction));
      for (const middle of middleCorners(first, last, a.direction, arrival)) {
        solutions.push({
          corners: [first, middle, last],
          total:
            distance(a.position, first) +
            distance(first, middle) +
            distance(middle, last) +
            distance(last, b.position),
        });
      }
    }
  }
  solutions.sort((one, other) => one.total - other.total);
  let refusal = 'Não há espaço para um percurso com três joelhos de 90° entre estas extremidades.';
  for (const solution of solutions) {
    const built = buildRoute(project, input, solution.corners);
    if (built.ok) return built;
    refusal = built.error.message;
  }
  return fail('NO_ROUTE', refusal);
}
