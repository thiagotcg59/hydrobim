import { connectPorts, findConnection, getElement, isPortFree, resolvePort } from './connectivity';
import { ANGLE_TOLERANCE, MIN_PIPE_LENGTH, POSITION_TOLERANCE } from './dimensions';
import { formatAngleList, matchElbowAngle } from './elbowAngles';
import type { FittingCatalog } from './families';
import {
  add,
  angleBetween,
  closestPointsBetweenLines,
  distance,
  dot,
  negate,
  scale,
  sub,
  type Vec3,
} from './math';
import { drawPipe, setPipeEndpoint } from './operations';
import type { Port } from './ports';
import { fail, ok, type Result } from './result';
import type { PortRef, Project } from './schema';
import { degToRad, formatDegrees, formatMeters } from './units';

/**
 * Fechamento assistido entre duas extremidades livres: liga as duas portas com tubos e
 * joelhos, sempre pelas operações de traçado (`drawPipe`), de modo que valem as mesmas regras
 * do traçado manual — especificação herdada da porta, joelho com o ângulo exato, comprimentos
 * mínimos e acoplamento geométrico exato. Não há tolerância de encaixe: se as peças não
 * fecham exatamente, nada é criado e o motivo é informado.
 *
 * Só são resolvidas as geometrias que fecham com peças definidas:
 *  - `straight`: eixos colineares e opostos — um tubo;
 *  - `elbow`: eixos que se cruzam à frente das duas portas — um joelho no cruzamento;
 *  - `offset`: eixos paralelos e opostos, desalinhados — dois joelhos de mesmo ângulo.
 * Eixos reversos, extremidades voltadas para o mesmo lado e cruzamentos atrás das portas são
 * recusados com explicação.
 */

export type ClosureKind = 'coincident' | 'straight' | 'elbow' | 'offset';

export interface ClosureInput {
  a: PortRef;
  b: PortRef;
  /** Catálogo de conexões usado para os joelhos. */
  catalog?: FittingCatalog;
  /**
   * Deflexões (rad) com joelho de catálogo. Quando informadas, só elas são usadas; ausente
   * ou vazio, o ângulo é livre (joelho genérico, identificado como tal).
   */
  elbowAngles?: readonly number[];
  /** Ângulo (rad) dos dois joelhos do desvio paralelo; ausente = todos os possíveis. */
  offsetAngle?: number;
}

export interface Closure {
  readonly project: Project;
  readonly kind: ClosureKind;
  /** Ângulo dos joelhos criados (rad); `null` quando não há joelho. */
  readonly angle: number | null;
  /** Elementos criados, na ordem do percurso de `a` para `b`. */
  readonly createdIds: readonly string[];
  /** Resumo para o usuário, ex.: "2 joelhos de 45° e 2 tubos". */
  readonly summary: string;
}

/** Ângulos tentados no desvio paralelo quando o catálogo não restringe (peça genérica). */
const FREE_OFFSET_ANGLES = [degToRad(45), degToRad(90)];

const sameSpec = (a: Port, b: Port): Result<true> => {
  if (a.spec.specificationId !== b.spec.specificationId) {
    return fail(
      'SPEC_MISMATCH',
      `As extremidades têm especificações diferentes (${a.spec.standard} × ${b.spec.standard}): é necessária uma peça de transição, que o fechamento não escolhe.`,
    );
  }
  if (a.spec.dn !== b.spec.dn) {
    return fail(
      'DN_MISMATCH',
      `As extremidades têm diâmetros diferentes (${a.spec.sizeLabel} × ${b.spec.sizeLabel}): insira a redução antes de fechar.`,
    );
  }
  return ok(true);
};

/**
 * O fechamento cria tubos de ponta lisa. Uma extremidade flangeada exige tubo com flange da
 * mesma norma e classe, escolha que não pode ser presumida.
 */
const plainCompatible = (project: Project, port: Port): Result<true> => {
  if (port.end?.type !== 'flange') return ok(true);
  const host = getElement(project, port.ref.elementId);
  return fail(
    'END_NOT_SUPPORTED',
    `A extremidade de "${host?.name ?? '?'}" é flangeada: o fechamento usa tubo de ponta lisa e não escolhe o flange. Ligue-a com um tubo flangeado.`,
  );
};

/**
 * Leva a porta `ref` até `point`, ao longo do seu eixo: prolonga o tubo dono da porta ou,
 * saindo de uma conexão, cria o trecho reto. Devolve a porta que passa a estar em `point`.
 */
function extendTo(
  project: Project,
  ref: PortRef,
  point: Vec3,
  input: ClosureInput,
): Result<{ project: Project; ref: PortRef; createdIds: string[] }> {
  const port = resolvePort(project, ref);
  const host = getElement(project, ref.elementId);
  if (!port || !host) return fail('PORT_NOT_FOUND', 'Porta de conexão inexistente.');
  if (distance(port.position, point) <= POSITION_TOLERANCE) {
    return ok({ project, ref, createdIds: [] });
  }
  if (host.kind === 'pipe' && (ref.portId === 'start' || ref.portId === 'end')) {
    const moved = setPipeEndpoint(project, host.id, ref.portId, point);
    return moved.ok ? ok({ project: moved.value, ref, createdIds: [] }) : moved;
  }
  const drawn = drawPipe(project, {
    fromPort: ref,
    start: port.position,
    end: point,
    spec: port.spec,
    catalog: input.catalog,
  });
  if (!drawn.ok) return drawn;
  return ok({
    project: drawn.value.project,
    ref: { elementId: drawn.value.elementId, portId: 'end' },
    createdIds: drawn.value.createdIds,
  });
}

/** Desenha de `from` até `end` (com joelho, se mudar de direção) e devolve a ponta nova. */
function runTo(
  project: Project,
  from: PortRef,
  end: Vec3,
  input: ClosureInput,
): Result<{ project: Project; ref: PortRef; createdIds: string[] }> {
  const port = resolvePort(project, from);
  if (!port) return fail('PORT_NOT_FOUND', 'Porta de conexão inexistente.');
  const drawn = drawPipe(project, {
    fromPort: from,
    start: port.position,
    end,
    spec: port.spec,
    catalog: input.catalog,
    elbowAngles: input.elbowAngles,
  });
  if (!drawn.ok) return drawn;
  return ok({
    project: drawn.value.project,
    ref: { elementId: drawn.value.elementId, portId: 'end' },
    createdIds: drawn.value.createdIds,
  });
}

/** Confere que a ponta do último trecho ficou conectada à porta de destino. */
function coupled(project: Project, last: PortRef, target: PortRef): boolean {
  const link = findConnection(project, target);
  if (!link) return false;
  return [link.a, link.b].some((r) => r.elementId === last.elementId && r.portId === last.portId);
}

function describe(project: Project, before: Project, createdIds: readonly string[]): string {
  const known = new Set(before.elements.map((e) => e.id));
  const created = createdIds
    .map((id) => getElement(project, id))
    .filter((e) => e !== undefined && !known.has(e.id));
  const pipes = created.filter((e) => e?.kind === 'pipe').length;
  const elbows = created.filter((e) => e?.kind === 'elbow');
  const first = elbows[0];
  const parts: string[] = [];
  if (first?.kind === 'elbow') {
    parts.push(
      `${elbows.length} joelho${elbows.length > 1 ? 's' : ''} de ${formatDegrees(first.angle, 2)}`,
    );
  }
  if (pipes > 0) parts.push(`${pipes} tubo${pipes > 1 ? 's' : ''}`);
  return parts.length > 0 ? parts.join(' e ') : 'sem peças novas';
}

function finish(
  before: Project,
  after: Project,
  last: PortRef,
  target: PortRef,
  kind: ClosureKind,
  angle: number | null,
  createdIds: readonly string[],
): Result<Closure> {
  if (!coupled(after, last, target)) {
    return fail(
      'NOT_COUPLED',
      'As peças não fecham exatamente na extremidade de destino; nada foi criado.',
    );
  }
  return ok({
    project: after,
    kind,
    angle,
    createdIds,
    summary: describe(after, before, createdIds),
  });
}

/** Dois joelhos de ângulo `angle` vencendo o desalinhamento `offset` entre eixos paralelos. */
function closeOffset(
  project: Project,
  input: ClosureInput,
  pa: Port,
  pb: Port,
  along: number,
  lateral: Vec3,
  angle: number,
): Result<Closure> {
  const offset = Math.hypot(lateral.x, lateral.y, lateral.z);
  const normal = scale(lateral, 1 / offset);
  // Avanço axial consumido pelo trecho inclinado entre os dois joelhos.
  const advance = Math.abs(Math.cos(angle)) < 1e-12 ? 0 : offset / Math.tan(angle);
  const slack = along - advance;
  if (slack < 2 * MIN_PIPE_LENGTH) {
    return fail(
      'NO_ROOM',
      `Com joelhos de ${formatDegrees(angle, 2)}, o desvio de ${formatMeters(offset, 3)} consome ${formatMeters(advance, 3)} ao longo do eixo, mas só há ${formatMeters(along, 3)} entre as extremidades.`,
    );
  }
  // A folga axial é dividida igualmente entre os dois lados.
  const corner1 = add(pa.position, scale(pa.direction, slack / 2));
  const diagonal = add(scale(pa.direction, Math.cos(angle)), scale(normal, Math.sin(angle)));
  const corner2 = add(corner1, scale(diagonal, offset / Math.sin(angle)));

  const first = extendTo(project, input.a, corner1, input);
  if (!first.ok) return first;
  const second = runTo(first.value.project, first.value.ref, corner2, input);
  if (!second.ok) return second;
  const third = runTo(second.value.project, second.value.ref, pb.position, input);
  if (!third.ok) return third;
  return finish(project, third.value.project, third.value.ref, input.b, 'offset', angle, [
    ...first.value.createdIds,
    ...second.value.createdIds,
    ...third.value.createdIds,
  ]);
}

/**
 * Todas as formas de fechar as duas extremidades com as peças disponíveis (mais de uma só
 * no desvio paralelo, uma por ângulo de joelho que cabe). Falha com o motivo quando não há
 * nenhuma; o projeto recebido nunca é alterado.
 */
export function closureCandidates(project: Project, input: ClosureInput): Result<Closure[]> {
  if (input.a.elementId === input.b.elementId) {
    return fail('SAME_ELEMENT', 'Escolha extremidades de dois elementos diferentes.');
  }
  const pa = resolvePort(project, input.a);
  const pb = resolvePort(project, input.b);
  if (!pa || !pb) return fail('PORT_NOT_FOUND', 'Porta de conexão inexistente.');
  if (!isPortFree(project, input.a) || !isPortFree(project, input.b)) {
    return fail('PORT_OCCUPIED', 'Uma das extremidades já está conectada.');
  }
  const spec = sameSpec(pa, pb);
  if (!spec.ok) return spec;

  const gap = sub(pb.position, pa.position);
  const facing = angleBetween(pa.direction, negate(pb.direction));

  // Portas já encostadas e opostas: basta conectar (flange com flange inclusive).
  if (distance(pa.position, pb.position) <= POSITION_TOLERANCE && facing <= ANGLE_TOLERANCE) {
    const joined = connectPorts(project, input.a, input.b);
    if (!joined.ok) return joined;
    return ok([
      {
        project: joined.value,
        kind: 'coincident',
        angle: null,
        createdIds: [],
        summary: 'extremidades já acopladas: conexão registrada',
      },
    ]);
  }

  for (const port of [pa, pb]) {
    const plain = plainCompatible(project, port);
    if (!plain.ok) return plain;
  }

  if (facing <= ANGLE_TOLERANCE) {
    const along = dot(gap, pa.direction);
    const lateral = sub(gap, scale(pa.direction, along));
    const offset = Math.hypot(lateral.x, lateral.y, lateral.z);
    if (along < MIN_PIPE_LENGTH) {
      return fail(
        'NO_ROOM',
        'As extremidades não estão de frente uma para a outra: não há trecho entre elas a preencher.',
      );
    }
    if (offset <= POSITION_TOLERANCE) {
      const run = runTo(project, input.a, pb.position, { ...input, elbowAngles: undefined });
      if (!run.ok) return run;
      const closed = finish(
        project,
        run.value.project,
        run.value.ref,
        input.b,
        'straight',
        null,
        run.value.createdIds,
      );
      return closed.ok ? ok([closed.value]) : closed;
    }

    const catalogAngles = input.elbowAngles?.length ? input.elbowAngles : FREE_OFFSET_ANGLES;
    const angles =
      input.offsetAngle === undefined
        ? [...catalogAngles]
        : catalogAngles.filter((a) => matchElbowAngle([a], input.offsetAngle ?? 0) !== null);
    if (angles.length === 0) {
      return fail(
        'NO_ELBOW_FOR_ANGLE',
        `Não há joelho de ${formatDegrees(input.offsetAngle ?? 0, 2)} no catálogo para ${pa.spec.sizeLabel}. Ângulos disponíveis: ${formatAngleList(catalogAngles)}.`,
      );
    }
    const closures: Closure[] = [];
    let firstError: Result<Closure> | null = null;
    // Do joelho mais aberto ao mais fechado: 90° usa o menor avanço axial.
    for (const angle of [...angles].sort((x, y) => y - x)) {
      const closed = closeOffset(project, input, pa, pb, along, lateral, angle);
      if (closed.ok) closures.push(closed.value);
      else firstError ??= closed;
    }
    if (closures.length > 0) return ok(closures);
    return firstError && !firstError.ok
      ? firstError
      : fail('NO_SOLUTION', 'Não há joelhos que fechem o desvio entre as extremidades.');
  }

  if (angleBetween(pa.direction, pb.direction) <= ANGLE_TOLERANCE) {
    return fail(
      'SAME_DIRECTION',
      'As extremidades estão voltadas para o mesmo lado: o retorno depende de onde a tubulação deve dar a volta. Trace-o manualmente.',
    );
  }

  const crossing = closestPointsBetweenLines(pa.position, pa.direction, pb.position, pb.direction);
  if (!crossing) {
    return fail('NO_SOLUTION', 'Os eixos das extremidades são paralelos e não se encontram.');
  }
  const skew = distance(crossing.p1, crossing.p2);
  if (skew > POSITION_TOLERANCE) {
    return fail(
      'SKEW_AXES',
      `Os eixos das extremidades não se cruzam: passam a ${formatMeters(skew, 3)} um do outro. Alinhe uma das extremidades (elevação ou posição) para fechar com um joelho.`,
    );
  }
  if (crossing.t1 < MIN_PIPE_LENGTH || crossing.t2 < MIN_PIPE_LENGTH) {
    return fail(
      'CROSSING_BEHIND',
      'Os eixos se cruzam atrás de uma das extremidades: não é possível fechar prolongando os dois lados.',
    );
  }
  const deflection = angleBetween(pa.direction, negate(pb.direction));
  if (input.elbowAngles?.length && matchElbowAngle(input.elbowAngles, deflection) === null) {
    return fail(
      'NO_ELBOW_FOR_ANGLE',
      `As extremidades se encontram a ${formatDegrees(deflection, 2)}, e não há joelho desse ângulo no catálogo para ${pa.spec.sizeLabel}. Ângulos disponíveis: ${formatAngleList(input.elbowAngles)}.`,
    );
  }
  const first = extendTo(project, input.a, crossing.p1, input);
  if (!first.ok) return first;
  const second = runTo(first.value.project, first.value.ref, pb.position, input);
  if (!second.ok) return second;
  const closed = finish(
    project,
    second.value.project,
    second.value.ref,
    input.b,
    'elbow',
    deflection,
    [...first.value.createdIds, ...second.value.createdIds],
  );
  return closed.ok ? ok([closed.value]) : closed;
}

/** Fecha as duas extremidades com a primeira solução disponível (ver `closureCandidates`). */
export function closePorts(project: Project, input: ClosureInput): Result<Closure> {
  const candidates = closureCandidates(project, input);
  if (!candidates.ok) return candidates;
  const [first] = candidates.value;
  return first ? ok(first) : fail('NO_SOLUTION', 'Não há peças que fechem as duas extremidades.');
}
