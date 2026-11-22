import {
  alignmentTolerance,
  connectPorts,
  describeAllowance,
  findConnection,
  getElement,
  deflectionAllowance,
  isPortFree,
  resolvePort,
} from './connectivity';
import { ANGLE_TOLERANCE, MIN_PIPE_LENGTH, POSITION_TOLERANCE } from './dimensions';
import { formatAngleList, matchElbowAngle } from './elbowAngles';
import { GENERIC_CATALOG, type FittingCatalog } from './families';
import { newPipeFlange } from './flangeMatch';
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
  type Vec3,
} from './math';
import {
  drawPipe,
  endMismatch,
  runToPort,
  setPipeEndpoint,
  type PipeEndsInput,
} from './operations';
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
 *  - `offset`: eixos paralelos e opostos, desalinhados — dois joelhos de mesmo ângulo;
 *  - `deflected`: um tubo direto, quando ele sai das duas extremidades dentro da deflexão
 *    que a junta elástica ou a curvatura a frio do tubo admitem (dados de catálogo da
 *    especificação) — sem joelhos.
 * Eixos reversos, extremidades voltadas para o mesmo lado e cruzamentos atrás das portas são
 * recusados com explicação.
 */

export type ClosureKind =
  'coincident' | 'straight' | 'elbow' | 'offset' | 'deflected' | 'elbowDeflected';

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
 * Tubo novo saindo de uma porta flangeada: a face de partida recebe o flange de uma família de
 * tubos com flanges que case com ela (`undefined` = porta sem flange, tubo de ponta lisa).
 */
function flangedStart(port: Port, input: ClosureInput): Result<PipeEndsInput | undefined> {
  if (port.end?.type !== 'flange') return ok(undefined);
  const flange = newPipeFlange(input.catalog ?? GENERIC_CATALOG, port.spec, [port.end]);
  if (!flange.ok) return flange;
  return ok({ start: flange.value.end, end: null, familyId: flange.value.familyId });
}

/** Último trecho: chega à porta de destino pelo eixo dela, com o flange que ela exigir. */
function arriveAt(
  project: Project,
  from: PortRef,
  target: PortRef,
  input: ClosureInput,
): Result<{ project: Project; ref: PortRef; createdIds: string[] }> {
  const port = resolvePort(project, from);
  if (!port) return fail('PORT_NOT_FOUND', 'Porta de conexão inexistente.');
  const run = runToPort(
    project,
    {
      fromPort: from,
      start: port.position,
      spec: port.spec,
      catalog: input.catalog,
      elbowAngles: input.elbowAngles,
    },
    target,
  );
  if (!run.ok) return run;
  const last: PortRef =
    run.value.extendedId !== null || run.value.createdIds.length === 0
      ? from
      : { elementId: run.value.elementId, portId: 'end' };
  return ok({ project: run.value.project, ref: last, createdIds: run.value.createdIds });
}

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
  const ends = flangedStart(port, input);
  if (!ends.ok) return ends;
  const drawn = drawPipe(project, {
    fromPort: ref,
    start: port.position,
    end: point,
    spec: port.spec,
    catalog: input.catalog,
    ...(ends.value ? { ends: ends.value } : {}),
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
  const ends = flangedStart(port, input);
  if (!ends.ok) return ends;
  const drawn = drawPipe(project, {
    fromPort: from,
    start: port.position,
    end,
    spec: port.spec,
    catalog: input.catalog,
    elbowAngles: input.elbowAngles,
    ...(ends.value ? { ends: ends.value } : {}),
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
  // Tubos existentes prolongados (o fechamento prefere prolongar a acrescentar um trecho).
  for (const old of before.elements) {
    const now = getElement(project, old.id);
    if (old.kind !== 'pipe' || now?.kind !== 'pipe') continue;
    const grown = distance(now.start, now.end) - distance(old.start, old.end);
    if (grown > POSITION_TOLERANCE) {
      parts.push(`prolongamento de "${old.name}" em ${formatMeters(grown, 3)}`);
    }
  }
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
  const third = arriveAt(second.value.project, second.value.ref, input.b, input);
  if (!third.ok) return third;
  return finish(project, third.value.project, third.value.ref, input.b, 'offset', angle, [
    ...first.value.createdIds,
    ...second.value.createdIds,
    ...third.value.createdIds,
  ]);
}

/**
 * Tubo direto entre as extremidades, com a deflexão absorvida pelas duas juntas. Só existe
 * quando a especificação traz a deflexão admitida e o tubo sai de cada porta dentro dela;
 * `null` nos demais casos (inclusive o alinhamento exato, que é o fechamento `straight`).
 */
function deflectedClosure(project: Project, input: ClosureInput): Closure | null {
  const pa = resolvePort(project, input.a);
  const pb = resolvePort(project, input.b);
  if (!pa || !pb || input.a.elementId === input.b.elementId) return null;
  if (!isPortFree(project, input.a) || !isPortFree(project, input.b)) return null;
  if (!sameSpec(pa, pb).ok) return null;
  if (!plainCompatible(project, pa).ok || !plainCompatible(project, pb).ok) return null;

  const gap = sub(pb.position, pa.position);
  if (length(gap) < MIN_PIPE_LENGTH) return null;
  // O trecho criado é de ponta lisa nas duas extremidades; seu comprimento conta para a
  // curvatura a frio.
  const plain = { spec: pa.spec, end: null, run: length(gap) };
  const atA = angleBetween(pa.direction, gap);
  const atB = angleBetween(pb.direction, negate(gap));
  if (Math.max(atA, atB) <= ANGLE_TOLERANCE) return null;
  if (atA > alignmentTolerance(pa, plain) || atB > alignmentTolerance(pb, plain)) return null;

  const run = runTo(project, input.a, pb.position, { ...input, elbowAngles: undefined });
  if (!run.ok) return null;
  const closed = finish(
    project,
    run.value.project,
    run.value.ref,
    input.b,
    'deflected',
    null,
    run.value.createdIds,
  );
  if (!closed.ok) return null;
  const fromA = deflectionAllowance(pa, plain);
  const fromB = deflectionAllowance(pb, plain);
  const tightest = fromA.limit <= fromB.limit ? fromA : fromB;
  const where = tightest.kind === 'bend' ? 'por curvatura do tubo' : 'nas juntas';
  return {
    ...closed.value,
    summary: `${closed.value.summary} com deflexão de ${formatDegrees(atA, 2)} e ${formatDegrees(atB, 2)} ${where} (admitida: ${formatDegrees(tightest.limit, 2)})`,
  };
}

/**
 * Todas as formas de fechar as duas extremidades com as peças disponíveis (mais de uma no
 * desvio paralelo, uma por ângulo de joelho que cabe; e o tubo direto com deflexão nas juntas,
 * quando a junta o admite, listado primeiro por não exigir peça). Falha com o motivo quando
 * não há nenhuma; o projeto recebido nunca é alterado.
 */
export function closureCandidates(project: Project, input: ClosureInput): Result<Closure[]> {
  const rigid = rigidClosures(project, input);
  // Ângulo de desvio pedido: a escolha é a solução com joelhos.
  if (input.offsetAngle !== undefined) return rigid;
  if (rigid.ok && rigid.value.some((c) => c.kind === 'coincident' || c.kind === 'straight')) {
    return rigid;
  }
  const deflected = deflectedClosure(project, input);
  if (!deflected) return rigid;
  return ok([deflected, ...(rigid.ok ? rigid.value : [])]);
}

/** Fechamentos com juntas alinhadas: conexão direta, tubo reto, um joelho ou desvio. */
function rigidClosures(project: Project, input: ClosureInput): Result<Closure[]> {
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
    const mismatch = endMismatch(pa.end, pb.end);
    if (mismatch) return fail('END_MISMATCH', mismatch);
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

  // Extremidades flangeadas: os tubos que encostam nelas recebem flange de uma família de
  // tubos com flanges que case (`runToPort`/`flangedStart`); sem ela, a recusa explica.
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
      // Alinhadas: prolonga o tubo de partida (ou um tubo novo saindo da peça).
      const run = arriveAt(project, input.a, input.b, { ...input, elbowAngles: undefined });
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
      const closed = closeOffset(project, input, pa, along, lateral, angle);
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
  const second = arriveAt(first.value.project, first.value.ref, input.b, input);
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

/**
 * Um joelho no eixo de partida e um tubo direto até a chegada, que entra na porta de destino
 * com a deflexão que a junta admite. O vértice fica onde o joelho tem exatamente o ângulo de
 * catálogo; a sobra (eixos reversos por poucos milímetros, ou encontro fora do ângulo
 * fabricado) vai para a junta de chegada, nunca para o joelho.
 */
function elbowFromDeparture(project: Project, input: ClosureInput): Result<Closure> {
  const pa = resolvePort(project, input.a);
  const pb = resolvePort(project, input.b);
  if (!pa || !pb) return fail('PORT_NOT_FOUND', 'Porta de conexão inexistente.');
  if (!isPortFree(project, input.a) || !isPortFree(project, input.b)) {
    return fail('PORT_OCCUPIED', 'Uma das extremidades já está conectada.');
  }
  const spec = sameSpec(pa, pb);
  if (!spec.ok) return spec;

  const gap = sub(pb.position, pa.position);
  const along = dot(gap, pa.direction);
  const offset = length(sub(gap, scale(pa.direction, along)));
  if (offset < MIN_PIPE_LENGTH) {
    return fail('NO_SOLUTION', 'A extremidade de destino está no eixo de partida: não há joelho.');
  }
  const between = angleBetween(pa.direction, negate(pb.direction));
  // Do ângulo de catálogo mais próximo do encontro dos eixos ao mais distante.
  const angles = input.elbowAngles?.length
    ? [...input.elbowAngles].sort((x, y) => Math.abs(x - between) - Math.abs(y - between))
    : [between];
  let refusal: Result<Closure> = fail(
    'NO_SOLUTION',
    'Não há joelho que feche as extremidades com a deflexão admitida pela junta.',
  );
  for (const angle of angles) {
    if (angle <= ANGLE_TOLERANCE || angle >= Math.PI - ANGLE_TOLERANCE) continue;
    const reach = along - (offset * Math.cos(angle)) / Math.sin(angle);
    if (reach < MIN_PIPE_LENGTH) {
      refusal = fail(
        'CROSSING_BEHIND',
        `O joelho de ${formatDegrees(angle, 2)} ficaria atrás da extremidade de partida.`,
      );
      continue;
    }
    const corner = add(pa.position, scale(pa.direction, reach));
    const leg = sub(pb.position, corner);
    const arrival = angleBetween(leg, negate(pb.direction));
    const plain = { spec: pa.spec, end: null, run: length(leg) };
    const allowance = deflectionAllowance(pb, plain);
    if (arrival > alignmentTolerance(pb, plain)) {
      refusal = fail(
        'DEFLECTION_EXCEEDED',
        `Com um joelho de ${formatDegrees(angle, 2)}, o tubo chegaria à extremidade com deflexão de ${formatDegrees(arrival, 2)}${
          allowance.limit > 0
            ? `; ${describeAllowance(allowance)}`
            : ', e a junta não admite deflexão'
        }.`,
      );
      continue;
    }
    const first = extendTo(project, input.a, corner, input);
    if (!first.ok) {
      refusal = first;
      continue;
    }
    const second = runTo(first.value.project, first.value.ref, pb.position, input);
    if (!second.ok) {
      refusal = second;
      continue;
    }
    const closed = finish(
      project,
      second.value.project,
      second.value.ref,
      input.b,
      'elbowDeflected',
      angle,
      [...first.value.createdIds, ...second.value.createdIds],
    );
    if (!closed.ok) {
      refusal = closed;
      continue;
    }
    // A sobra é sempre declarada, mesmo abaixo da tolerância de alinhamento das portas.
    const host = getElement(project, input.b.elementId);
    const admitted =
      arrival <= ANGLE_TOLERANCE
        ? 'dentro da tolerância de alinhamento'
        : `admitida: ${formatDegrees(allowance.limit, 2)}`;
    return ok({
      ...closed.value,
      summary: `${closed.value.summary}; deflexão de ${formatDegrees(arrival, 2)} na junta com "${host?.name ?? '?'}" (${admitted})`,
    });
  }
  return refusal;
}

/**
 * Fechamento com um único joelho quando os eixos não fecham exatamente (reversos por pouco, ou
 * encontro fora do ângulo de catálogo): joelho de ângulo fabricado e a sobra absorvida pela
 * deflexão admitida na junta de uma das extremidades. Tenta primeiro o joelho no eixo de `a`
 * (a extremidade `b` não é alterada); sem solução, o joelho no eixo de `b`. Não entra em
 * `closureCandidates`: é alternativa oferecida à escolha, nunca aplicada por omissão.
 */
export function deflectedElbowClosure(project: Project, input: ClosureInput): Result<Closure> {
  if (input.a.elementId === input.b.elementId) {
    return fail('SAME_ELEMENT', 'Escolha extremidades de dois elementos diferentes.');
  }
  const direct = elbowFromDeparture(project, input);
  if (direct.ok) return direct;
  const reverse = elbowFromDeparture(project, { ...input, a: input.b, b: input.a });
  return reverse.ok ? reverse : direct;
}

/** Fecha as duas extremidades com a primeira solução disponível (ver `closureCandidates`). */
export function closePorts(project: Project, input: ClosureInput): Result<Closure> {
  const candidates = closureCandidates(project, input);
  if (!candidates.ok) return candidates;
  const [first] = candidates.value;
  return first ? ok(first) : fail('NO_SOLUTION', 'Não há peças que fechem as duas extremidades.');
}
