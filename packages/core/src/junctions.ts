import {
  connectionsOfElement,
  getElement,
  isPortFree,
  oppositeRef,
  resolvePort,
} from './connectivity';
import { MIN_PIPE_LENGTH, POSITION_TOLERANCE } from './dimensions';
import { GENERIC_CATALOG, type FittingCatalog } from './families';
import { putElement, touch } from './internal';
import {
  add,
  closestPointOnLine,
  distance,
  dot,
  negate,
  quatFromAxisAngle,
  quatMultiply,
  quatNormalize,
  scale,
  sub,
  tryNormalize,
  type Vec3,
} from './math';
import {
  drawPipe,
  endMismatch,
  runToPort,
  type Created,
  type PipeEndsInput,
  type RunToPortInput,
} from './operations';
import { newPipeFlange } from './flangeMatch';
import { getPort, type Port } from './ports';
import { reconcile } from './reconcile';
import { fail, ok, type Result } from './result';
import type { Cross, EndType, PortRef, Project, Tee } from './schema';

/**
 * Tês e cruzetas como peças de derivação intercambiáveis. A troca preserva o elemento (mesmo
 * `id`, nome, sistema e propriedades) e as ligações: as portas `a`, `b` e `branch` têm o mesmo
 * significado nas duas peças, e a cruzeta acrescenta `branch2`, oposta a `branch`. Dimensões e
 * extremidades vêm sempre do catálogo; os vizinhos se ajustam pela reconciliação.
 */

export interface JunctionChange {
  readonly project: Project;
  readonly elementId: string;
  /** Dados do elemento anterior que não se aplicam à peça nova e foram descartados. */
  readonly notes: readonly string[];
  /** Família adotada (`null` = dimensões genéricas, só com `allowGeneric`). */
  readonly familyId: string | null;
}

export interface ConvertJunctionInput {
  catalog?: FittingCatalog;
  /** Família desejada para a peça nova; ausente = a primeira compatível. */
  familyId?: string | null;
  /**
   * Aceita dimensões genéricas quando não há família (projetos sem a política "somente peças
   * de catálogo"). Padrão: recusar — não se inventa cruzeta para permitir a operação.
   */
  allowGeneric?: boolean;
}

/** Acabamento predominante da peça (o da passagem), para manter a mesma linha de produto. */
function endTypeOf(element: Tee | Cross): EndType | undefined {
  return element.ends.a?.type ?? element.ends.b?.type ?? element.ends.branch?.type;
}

const pieceLabel = (kind: 'tee' | 'cross'): string => (kind === 'tee' ? 'tê' : 'cruzeta');

/** Explica por que não há peça de catálogo, listando o que o catálogo oferece. */
function unavailable(
  kind: 'tee' | 'cross',
  element: Tee | Cross,
  catalog: FittingCatalog,
  endType: EndType | undefined,
): Result<never> {
  const branchSpec = element.branchSpec ?? element.spec;
  const size =
    branchSpec.dn === element.spec.dn
      ? element.spec.sizeLabel
      : `${element.spec.sizeLabel} × ${branchSpec.sizeLabel}`;
  const finish = endType === 'flange' ? ' flangeada(o)' : endType === 'socket' ? ' com bolsas' : '';
  const others = (catalog.junctionFamilies?.(kind, element.spec, branchSpec) ?? []).filter(
    (family) => family.endType !== endType,
  );
  const hint =
    others.length > 0
      ? ` O catálogo tem ${pieceLabel(kind)} nesse diâmetro com outro acabamento (${others.map((f) => f.name).join('; ')}), que não casa com as ligações atuais.`
      : '';
  return fail(
    'NO_CATALOG_JUNCTION',
    `Não há ${pieceLabel(kind)}${finish} de catálogo para ${element.spec.standard}, ${size}.${hint}`,
  );
}

/** Confere que cada ligação existente continua com acabamentos compatíveis. */
function checkNeighbours(project: Project, id: string): Result<true> {
  for (const connection of connectionsOfElement(project, id)) {
    const own = connection.a.elementId === id ? connection.a : connection.b;
    const mine = resolvePort(project, own);
    const theirs = resolvePort(project, oppositeRef(connection, own));
    if (!mine || !theirs) continue;
    const mismatch = endMismatch(mine.end, theirs.end);
    if (mismatch) {
      const other = getElement(project, theirs.ref.elementId);
      return fail(
        'END_MISMATCH',
        `Ligação com "${other?.name ?? '?'}" (${mine.label}): ${mismatch}`,
      );
    }
  }
  return ok(true);
}

/** Dados de fabricação descrevem o produto anterior: não passam para a peça nova. */
function dropManufacturing<T extends Tee | Cross>(element: T, notes: string[]): T {
  const entries = Object.entries(element.manufacturing).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return element;
  notes.push(
    `Dados de fabricação removidos (${entries.map(([key]) => key).join(', ')}): descreviam a peça anterior.`,
  );
  return { ...element, manufacturing: {} };
}

/**
 * Converte o tê em cruzeta: mesmas portas `a`, `b` e `branch`, mais `branch2` na direção oposta
 * à derivação, todas com dimensões e extremidades da família de cruzetas. A quarta porta fica
 * livre. Recusa sem família de catálogo (salvo `allowGeneric`) ou quando um vizinho não casa
 * com a extremidade nova.
 */
export function convertTeeToCross(
  project: Project,
  teeId: string,
  input: ConvertJunctionInput = {},
): Result<JunctionChange> {
  const tee = getElement(project, teeId);
  if (!tee || tee.kind !== 'tee') return fail('NOT_A_TEE', 'O elemento não é um tê.');
  const catalog = input.catalog ?? GENERIC_CATALOG;
  const branchSpec = tee.branchSpec ?? tee.spec;
  const endType = input.familyId ? undefined : endTypeOf(tee);
  const dims = catalog.cross(tee.spec, branchSpec, input.familyId, endType);
  if (dims.familyId === null && !input.allowGeneric) {
    return unavailable('cross', tee, catalog, endType);
  }
  const notes: string[] = [];
  const { branchSpec: _branch, ...rest } = dropManufacturing(tee, notes);
  if (tee.familyId !== dims.familyId) {
    notes.push(
      dims.familyId === null
        ? 'Sem família de cruzetas: dimensões genéricas, identificadas como tal.'
        : `Dimensões e extremidades passam a ser as da família de cruzetas "${dims.familyId}".`,
    );
  }
  const cross: Cross = touch({
    ...rest,
    kind: 'cross',
    familyId: dims.familyId,
    ends: dims.ends,
    runLength: dims.runLength,
    branchLength: dims.branchLength,
    ...(branchSpec.dn !== tee.spec.dn ? { branchSpec } : {}),
  });
  return finishChange(project, cross, notes);
}

/**
 * Converte a cruzeta em tê, removendo uma derivação LIVRE (`branch2`, ou `branch` quando só ela
 * está livre — o tê é girado meia volta sobre a passagem para que a derivação restante seja a
 * sua `branch`). Com as duas derivações ligadas, recusa: nada da rede é apagado.
 */
export function convertCrossToTee(
  project: Project,
  crossId: string,
  input: ConvertJunctionInput = {},
): Result<JunctionChange> {
  const cross = getElement(project, crossId);
  if (!cross || cross.kind !== 'cross') return fail('NOT_A_CROSS', 'O elemento não é uma cruzeta.');
  const freeSecond = isPortFree(project, { elementId: crossId, portId: 'branch2' });
  const freeFirst = isPortFree(project, { elementId: crossId, portId: 'branch' });
  if (!freeSecond && !freeFirst) {
    return fail(
      'PORT_OCCUPIED',
      `As duas derivações de "${cross.name}" estão ligadas: a conversão em tê removeria uma delas. Desligue ou remova o ramal que deve sair antes de converter.`,
    );
  }
  const catalog = input.catalog ?? GENERIC_CATALOG;
  const branchSpec = cross.branchSpec ?? cross.spec;
  const endType = input.familyId ? undefined : endTypeOf(cross);
  const dims = catalog.tee(cross.spec, branchSpec, input.familyId, endType);
  if (dims.familyId === null && !input.allowGeneric) {
    return unavailable('tee', cross, catalog, endType);
  }
  const notes: string[] = [];
  const { branchSpec: _branch, ...rest } = dropManufacturing(cross, notes);
  let placement = cross.placement;
  let next = project;
  if (!freeSecond) {
    // Só `branch` está livre: o tê fica com a derivação de `branch2`. Meia volta em torno da
    // passagem leva +Y local a −Y (as portas `a` e `b` não se movem).
    const axis = getPort(cross, 'b');
    if (!axis) return fail('INTERNAL', 'Cruzeta sem passagem.');
    const q = quatFromAxisAngle(axis.direction, Math.PI);
    placement = {
      position: cross.placement.position,
      rotation: quatNormalize(quatMultiply(q, cross.placement.rotation)),
    };
    next = {
      ...project,
      connections: project.connections.map((c) => ({
        ...c,
        a:
          c.a.elementId === crossId && c.a.portId === 'branch2'
            ? { ...c.a, portId: 'branch' }
            : c.a,
        b:
          c.b.elementId === crossId && c.b.portId === 'branch2'
            ? { ...c.b, portId: 'branch' }
            : c.b,
      })),
    };
    notes.push(
      'A derivação ligada passa a ser a derivação do tê (a peça foi girada sobre a passagem).',
    );
  }
  if (cross.familyId !== dims.familyId) {
    notes.push(
      dims.familyId === null
        ? 'Sem família de tês: dimensões genéricas, identificadas como tal.'
        : `Dimensões e extremidades passam a ser as da família de tês "${dims.familyId}".`,
    );
  }
  const tee: Tee = touch({
    ...rest,
    kind: 'tee',
    placement,
    familyId: dims.familyId,
    ends: dims.ends,
    runLength: dims.runLength,
    branchLength: dims.branchLength,
    ...(branchSpec.dn !== cross.spec.dn ? { branchSpec } : {}),
  });
  return finishChange(next, tee, notes);
}

function finishChange(
  project: Project,
  element: Tee | Cross,
  notes: string[],
): Result<JunctionChange> {
  const placed = putElement(project, element);
  const ends = checkNeighbours(placed, element.id);
  if (!ends.ok) return ends;
  // Mudou o tamanho da peça: os tubos vizinhos acompanham as portas.
  const reconciled = reconcile(placed, [element.id]);
  if (!reconciled.ok) return reconciled;
  return ok({
    project: reconciled.value,
    elementId: element.id,
    notes,
    familyId: element.familyId,
  });
}

// ---------------------------------------------------------------------------
// Derivação sobre tê ou cruzeta existentes
// ---------------------------------------------------------------------------

export interface JunctionTarget {
  /** Projeto com a peça já preparada (tê convertido em cruzeta, se preciso). */
  readonly project: Project;
  /** Porta livre que recebe o ramal. */
  readonly port: Port;
  /** O tê foi convertido em cruzeta. */
  readonly converted: boolean;
  readonly notes: readonly string[];
}

/**
 * Porta de um tê ou cruzeta que recebe um ramal vindo de `from`: a derivação livre voltada
 * para o ponto (a oposta à derivação de um tê, com a conversão em cruzeta) ou uma passagem
 * livre alinhada. Recusa quando o ponto não está à frente de nenhuma porta livre.
 */
export function junctionPortToward(
  project: Project,
  junctionId: string,
  from: Vec3,
  input: ConvertJunctionInput & { convert?: boolean } = {},
): Result<JunctionTarget> {
  const element = getElement(project, junctionId);
  if (!element || (element.kind !== 'tee' && element.kind !== 'cross')) {
    return fail('NOT_A_JUNCTION', 'O destino não é um tê nem uma cruzeta.');
  }
  const center = element.placement.position;
  const branch = getPort(element, 'branch');
  const runB = getPort(element, 'b');
  if (!branch || !runB) return fail('INTERNAL', 'Peça sem portas.');
  const offset = sub(from, center);
  const sideways = dot(offset, branch.direction);
  const along = dot(offset, runB.direction);
  const name = element.name;

  // Ramal pela passagem (prolonga a linha principal por uma passagem livre).
  const lateral = Math.hypot(...vecParts(sub(offset, scale(runB.direction, along))));
  if (lateral <= POSITION_TOLERANCE) {
    const portId = along > 0 ? 'b' : 'a';
    const port = getPort(element, portId);
    if (port && isPortFree(project, port.ref)) {
      return ok({ project, port, converted: false, notes: [] });
    }
    return fail('PORT_OCCUPIED', `A passagem de "${name}" voltada para o ponto já está ligada.`);
  }
  // Derivações: o ponto precisa estar na perpendicular que passa pelo centro.
  const offAxis = Math.hypot(...vecParts(sub(offset, scale(branch.direction, sideways))));
  if (offAxis > POSITION_TOLERANCE) {
    return fail(
      'OFF_PORT_AXIS',
      `O ramal precisa chegar a "${name}" pelo eixo de uma derivação, a 90° da passagem: o ponto está ${(offAxis * 1000).toFixed(0)} mm fora desse eixo.`,
    );
  }
  if (sideways > 0) {
    if (isPortFree(project, branch.ref))
      return ok({ project, port: branch, converted: false, notes: [] });
    return fail('PORT_OCCUPIED', `A derivação de "${name}" voltada para o ponto já está ligada.`);
  }
  if (element.kind === 'cross') {
    const second = getPort(element, 'branch2');
    if (second && isPortFree(project, second.ref)) {
      return ok({ project, port: second, converted: false, notes: [] });
    }
    return fail('PORT_OCCUPIED', `A derivação de "${name}" voltada para o ponto já está ligada.`);
  }
  // Lado oposto à derivação de um tê: só com a conversão em cruzeta.
  if (input.convert === false) {
    return fail(
      'NEEDS_CROSS',
      `O ramal chega ao lado de "${name}" oposto à derivação: o tê não tem porta ali. Escolha "Cruzeta" ou "Automática" para convertê-lo.`,
    );
  }
  const converted = convertTeeToCross(project, junctionId, input);
  if (!converted.ok) return converted;
  const port = resolvePort(converted.value.project, { elementId: junctionId, portId: 'branch2' });
  if (!port) return fail('INTERNAL', 'Cruzeta sem a segunda derivação.');
  return ok({
    project: converted.value.project,
    port,
    converted: true,
    notes: converted.value.notes,
  });
}

const vecParts = (v: Vec3): [number, number, number] => [v.x, v.y, v.z];

export interface DrawPipeToJunctionInput extends RunToPortInput, ConvertJunctionInput {
  junctionId: string;
  /** `false` = não converter o tê (a escolha "Tê" recusa o lado oposto à derivação). */
  convert?: boolean;
}

export interface JunctionCreated extends Created {
  readonly converted: boolean;
  readonly extendedId: string | null;
  readonly notes: readonly string[];
}

/**
 * Leva o trecho até um tê ou cruzeta existentes, pela porta livre voltada para o ponto de
 * partida; no lado oposto à derivação de um tê, converte-o em cruzeta (mesmo `id`) e liga o
 * ramal à quarta porta. Uma única operação: falhando qualquer etapa, nada é alterado.
 */
export function drawPipeToJunction(
  project: Project,
  input: DrawPipeToJunctionInput,
): Result<JunctionCreated> {
  const origin = input.fromPort ? resolvePort(project, input.fromPort) : undefined;
  const start = origin?.position ?? input.start;
  const target = junctionPortToward(project, input.junctionId, start, input);
  if (!target.ok) return target;
  const run = runToPort(target.value.project, input, target.value.port.ref);
  if (!run.ok) return run;
  return ok({
    ...run.value,
    converted: target.value.converted,
    notes: target.value.notes,
  });
}

export interface DrawPipeFromJunctionInput extends ConvertJunctionInput {
  junctionId: string;
  /** Ponto indicado; vale a projeção no eixo da porta escolhida. */
  end: Vec3;
  convert?: boolean;
  name?: string;
}

/**
 * Parte de um tê ou cruzeta existentes: a porta livre voltada para o ponto (no lado oposto à
 * derivação de um tê, com a conversão em cruzeta) e um trecho reto pelo eixo dela até a
 * projeção do ponto indicado.
 */
export function drawPipeFromJunction(
  project: Project,
  input: DrawPipeFromJunctionInput,
): Result<JunctionCreated> {
  const element = getElement(project, input.junctionId);
  if (!element || (element.kind !== 'tee' && element.kind !== 'cross')) {
    return fail('NOT_A_JUNCTION', 'A origem não é um tê nem uma cruzeta.');
  }
  // Escolhe a porta pelo lado do ponto: projeta-o na perpendicular da passagem pelo centro.
  const center = element.placement.position;
  const runB = getPort(element, 'b');
  if (!runB) return fail('INTERNAL', 'Peça sem passagem.');
  const offset = sub(input.end, center);
  const radial = sub(offset, scale(runB.direction, dot(offset, runB.direction)));
  const toward = tryNormalize(radial);
  if (!toward) {
    return fail('PIPE_TOO_SHORT', `Indique um ponto ao lado de "${element.name}" para o ramal.`);
  }
  const branch = getPort(element, 'branch');
  if (!branch) return fail('INTERNAL', 'Peça sem derivação.');
  // O ramal sai a 90° da passagem, pela derivação mais próxima da direção indicada.
  const side = dot(toward, branch.direction) >= 0 ? branch.direction : negate(branch.direction);
  const probe = add(center, scale(side, 1));
  const target = junctionPortToward(project, input.junctionId, probe, input);
  if (!target.ok) return target;
  const port = target.value.port;
  const { point: end } = closestPointOnLine(port.position, port.direction, input.end);
  if (
    distance(end, port.position) < MIN_PIPE_LENGTH ||
    dot(sub(end, port.position), port.direction) <= 0
  ) {
    return fail('PIPE_TOO_SHORT', `O ponto está perto demais de "${element.name}" para o ramal.`);
  }
  let ends: PipeEndsInput | undefined;
  if (port.end?.type === 'flange') {
    const flange = newPipeFlange(input.catalog ?? GENERIC_CATALOG, port.spec, [port.end]);
    if (!flange.ok) return flange;
    ends = { start: flange.value.end, end: null, familyId: flange.value.familyId };
  }
  const drawn = drawPipe(target.value.project, {
    fromPort: port.ref,
    start: port.position,
    end,
    spec: port.spec,
    name: input.name,
    catalog: input.catalog,
    ...(ends ? { ends } : {}),
  });
  if (!drawn.ok) return drawn;
  return ok({
    ...drawn.value,
    converted: target.value.converted,
    extendedId: null,
    notes: target.value.notes,
  });
}

/** Porta livre referenciada, quando é uma derivação de tê ou cruzeta. */
export function isJunctionPort(project: Project, ref: PortRef): boolean {
  const element = getElement(project, ref.elementId);
  return (element?.kind === 'tee' || element?.kind === 'cross') && ref.portId.startsWith('branch');
}
