import {
  alignmentTolerance,
  arePortsAligned,
  autoConnectElement,
  connectPorts,
  connectedComponent,
  findConnection,
  getElement,
  deflectionAllowance,
  describeAllowance,
  isPortFree,
  resolvePort,
} from './connectivity';
import {
  ANGLE_TOLERANCE,
  elbowPortDistances,
  MAX_ELBOW_ANGLE,
  MIN_ELBOW_ANGLE,
  MIN_PIPE_LENGTH,
  POSITION_TOLERANCE,
} from './dimensions';
import { formatAngleList, matchElbowAngle } from './elbowAngles';
import { GENERIC_CATALOG, requiredEndType, type Ends, type FittingCatalog } from './families';
import {
  describeDrilling,
  flangesMate,
  newPipeFlange,
  pipeFlangeFor,
  type PipeFlange,
} from './flangeMatch';
import { newId } from './ids';
import { baseFields, elementKindLabel, nextName, now, putElement, touch } from './internal';
import {
  add,
  angleBetween,
  AXIS_Z,
  closestPointOnLine,
  cross,
  distance,
  dot,
  frameFromDirection,
  isFiniteVec,
  negate,
  normalize,
  QUAT_IDENTITY,
  quatConjugate,
  quatFromAxisAngle,
  quatFromBasis,
  quatMultiply,
  quatNormalize,
  rotate,
  scale,
  sub,
  tryNormalize,
  ZERO,
  type Quat,
  type Vec3,
} from './math';
import { getPort, pipeLength, type Port } from './ports';
import { reconcile, setPipeEnd, translateFitting, verifyCoupling } from './reconcile';
import { fail, ok, type Result } from './result';
import {
  defaultInfraSettings,
  PROJECT_FORMAT,
  SCHEMA_VERSION,
  type Cross,
  type Discipline,
  type Elbow,
  type EndTreatment,
  type EndType,
  type Fitting,
  type FittingKind,
  type HydraulicSystem,
  type HydroElement,
  type Pipe,
  type PipeSpec,
  type PortRef,
  type Project,
  type PropertyValue,
  type Pump,
  type PumpType,
  type Reducer,
  type Tank,
  type TankType,
  type Tee,
  type Valve,
  type ValveType,
} from './schema';
import {
  PUMP_DIMENSION_KEYS,
  pumpProblem,
  pumpTypeOf,
  unlinkPumpVariant,
  type PumpParameters,
} from './pumps';
import { TANK_TYPE_LABELS, tankProblem, tankTypeOf, type TankParameters } from './tanks';
import { degToRad, formatDegrees } from './units';

export { elementKindLabel };

/** Peças cujas extremidades vêm de família de conexões (equipamentos ficam de fora). */
const CATALOG_FITTINGS: ReadonlySet<string> = new Set([
  'elbow',
  'tee',
  'cross',
  'valve',
  'reducer',
]);

/**
 * Recusa a peça quando a porta exige flange e o catálogo não tem a peça flangeada no
 * diâmetro: encostar bolsa, ponta ou peça genérica num flange presumiria um adaptador.
 */
function flangeMismatch(
  piece: string,
  spec: PipeSpec,
  endType: EndType | undefined,
  resolved: { familyId: string | null; ends: Readonly<Ends> },
): Result<never> | null {
  if (endType !== 'flange') return null;
  // A busca já filtrou as famílias pelo acabamento: achar uma família basta.
  if (resolved.familyId !== null) return null;
  if (Object.values(resolved.ends).some((end) => end.type === 'flange')) return null;
  return fail(
    'NO_FLANGED_FITTING',
    `A extremidade é flangeada e não há ${piece} flangeado(a) no catálogo para ${spec.standard}, ${spec.sizeLabel}: a ligação exige peça flange × flange.`,
  );
}

/**
 * Operações paramétricas sobre o projeto. Todas são funções puras: recebem um projeto
 * imutável e retornam um novo projeto (ou um erro de domínio), o que torna desfazer/
 * refazer e testes triviais.
 */

// ---------------------------------------------------------------------------
// Projeto
// ---------------------------------------------------------------------------

export function createProject(name: string, discipline: Discipline = 'mep'): Project {
  const timestamp = now();
  const system: HydraulicSystem =
    discipline === 'infra'
      ? { id: newId(), name: 'Abastecimento de água', kind: 'waterSupply' }
      : { id: newId(), name: 'Água fria', kind: 'domesticColdWater' };
  return {
    format: PROJECT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    name,
    discipline,
    units: { length: 'm', angle: 'rad' },
    createdAt: timestamp,
    updatedAt: timestamp,
    systems: [system],
    levels: [{ id: newId(), name: discipline === 'infra' ? 'Referência' : 'Térreo', elevation: 0 }],
    families: [],
    tankFamilies: [],
    pumpFamilies: [],
    ifcTypes: {},
    georeference: null,
    terrain: null,
    elements: [],
    connections: [],
    annotations: [],
    drawingScale: discipline === 'infra' ? 500 : 50,
    infra: defaultInfraSettings(),
    views: [],
  };
}

export function updateProjectInfo(
  project: Project,
  patch: { name?: string; discipline?: Discipline },
): Project {
  return { ...project, ...patch, updatedAt: now() };
}

// ---------------------------------------------------------------------------
// Tubos
// ---------------------------------------------------------------------------

export interface AddPipeInput {
  start: Vec3;
  end: Vec3;
  spec: PipeSpec;
  systemId?: string;
  name?: string;
  /** Tubo com flanges: acabamento das extremidades e família que forneceu as dimensões. */
  ends?: PipeEndsInput;
}

/**
 * Acabamento das extremidades de um tubo: flange (`EndTreatment` do tipo `flange`) ou ponta
 * lisa (`null`). `familyId` identifica a família de tubos flangeados de origem.
 */
export interface PipeEndsInput {
  start: EndTreatment | null;
  end: EndTreatment | null;
  familyId: string | null;
}

/**
 * Aplica o acabamento das extremidades a um tubo, conferindo a coerência dimensional. O
 * comprimento do tubo é medido entre as portas (face do flange ou extremidade da ponta),
 * de modo que os flanges precisam caber nele.
 */
function applyPipeEnds(pipe: Pipe, input: PipeEndsInput): Result<Pipe> {
  const ends: Record<string, EndTreatment> = {};
  for (const [portId, end] of [
    ['start', input.start],
    ['end', input.end],
  ] as const) {
    if (!end) continue;
    if (end.type !== 'flange') {
      return fail(
        'UNSUPPORTED_PIPE_END',
        'Extremidades de tubo aceitam flange ou ponta lisa; bolsas pertencem às conexões.',
      );
    }
    if (
      !Number.isFinite(end.length) ||
      end.length <= 0 ||
      !Number.isFinite(end.outerDiameter) ||
      end.outerDiameter <= pipe.spec.outerDiameter
    ) {
      return fail(
        'INVALID_FLANGE',
        `O flange não é compatível com o tubo ${pipe.spec.sizeLabel}: o diâmetro externo do flange deve ser maior que o do tubo.`,
      );
    }
    ends[portId] = end;
  }
  const { ends: _previous, ...bare } = pipe;
  const flanges = Object.values(ends);
  if (flanges.length === 0) return ok({ ...bare, familyId: null });
  const needed = flanges.reduce((sum, end) => sum + end.length, 0) + MIN_PIPE_LENGTH;
  if (pipeLength(pipe) < needed) {
    return fail(
      'PIPE_TOO_SHORT',
      `"${pipe.name}" é curto demais para os flanges (mínimo de ${(needed * 1000).toFixed(0)} mm entre as faces).`,
    );
  }
  return ok({ ...bare, familyId: input.familyId, ends });
}

export interface Created {
  project: Project;
  /** Elemento principal criado pela operação. */
  elementId: string;
  /** Todos os elementos criados (inclui conexões automáticas). */
  createdIds: string[];
}

function defaultSystemId(project: Project, systemId?: string): Result<string> {
  if (systemId === undefined) {
    const first = project.systems[0];
    return first ? ok(first.id) : fail('NO_SYSTEM', 'O projeto não possui sistema hidráulico.');
  }
  return project.systems.some((s) => s.id === systemId)
    ? ok(systemId)
    : fail('SYSTEM_NOT_FOUND', 'Sistema hidráulico inexistente.');
}

function buildPipe(project: Project, input: AddPipeInput, systemId: string): Result<Pipe> {
  if (!isFiniteVec(input.start) || !isFiniteVec(input.end)) {
    return fail('INVALID_POINT', 'Coordenadas inválidas.');
  }
  if (distance(input.start, input.end) < MIN_PIPE_LENGTH) {
    return fail('PIPE_TOO_SHORT', 'Os dois pontos do tubo são coincidentes ou próximos demais.');
  }
  const base = baseFields(project, 'pipe', input.spec, systemId);
  const pipe: Pipe = {
    ...base,
    name: input.name ?? base.name,
    kind: 'pipe',
    start: input.start,
    end: input.end,
  };
  return input.ends ? applyPipeEnds(pipe, input.ends) : ok(pipe);
}

/** Cria um tubo reto entre dois pontos e conecta extremidades exatamente acopladas. */
export function addPipe(project: Project, input: AddPipeInput): Result<Created> {
  const system = defaultSystemId(project, input.systemId);
  if (!system.ok) return system;
  const pipe = buildPipe(project, input, system.value);
  if (!pipe.ok) return pipe;
  const next = autoConnectElement(putElement(project, pipe.value), pipe.value.id);
  return ok({ project: next, elementId: pipe.value.id, createdIds: [pipe.value.id] });
}

export interface DrawPipeInput extends AddPipeInput {
  /** Porta livre a partir da qual o tubo é desenhado (o `start` é ignorado). */
  fromPort?: PortRef;
  /** Catálogo de conexões usado para o joelho automático. */
  catalog?: FittingCatalog;
  /**
   * Deflexões (rad) para as quais existe joelho de catálogo. Quando informadas, uma mudança
   * de direção fora delas é recusada, em vez de criar uma peça genérica que não é fabricada.
   * Ausente ou vazio: ângulo livre.
   */
  elbowAngles?: readonly number[];
  /** Família preferida para o joelho automático. */
  elbowFamilyId?: string | null;
}

/**
 * Desenha um tubo, opcionalmente a partir de uma porta livre:
 *  - na direção da porta: o tubo é conectado diretamente;
 *  - em outra direção, saindo da extremidade de um tubo: o tubo existente é aparado e um
 *    joelho com o ângulo exato é inserido no vértice;
 *  - em outra direção, saindo de uma conexão: operação recusada (use o eixo da porta).
 * O tubo criado herda a especificação da porta de origem.
 */
export function drawPipe(project: Project, input: DrawPipeInput): Result<Created> {
  if (!input.fromPort) return addPipe(project, input);
  const port = resolvePort(project, input.fromPort);
  const host = getElement(project, input.fromPort.elementId);
  if (!port || !host) return fail('PORT_NOT_FOUND', 'Porta de conexão inexistente.');
  if (!isPortFree(project, port.ref)) return fail('PORT_OCCUPIED', 'A porta já está conectada.');
  if (!isFiniteVec(input.end)) return fail('INVALID_POINT', 'Coordenadas inválidas.');

  const corner = port.position;
  const direction = tryNormalize(sub(input.end, corner));
  if (!direction) {
    return fail('PIPE_TOO_SHORT', 'Os dois pontos do tubo são coincidentes ou próximos demais.');
  }
  const spec = port.spec;
  const systemId = host.systemId;
  const deflection = angleBetween(port.direction, direction);
  // Junta elástica: a deflexão que o fabricante admite dispensa a peça. O tubo novo sai de
  // ponta lisa, salvo o flange pedido em `ends.start` (flange não deflete).
  // Curvatura a frio: conta o comprimento do trecho novo.
  const newSide = { spec, end: input.ends?.start ?? null, run: distance(corner, input.end) };
  const allowance = deflectionAllowance(port, newSide);
  const jointLimit = allowance.limit;

  if (deflection <= alignmentTolerance(port, newSide)) {
    return addPipe(project, {
      start: corner,
      end: input.end,
      spec,
      systemId,
      name: input.name,
      ...(input.ends ? { ends: input.ends } : {}),
    });
  }
  if (host.kind !== 'pipe') {
    return fail(
      'OFF_AXIS',
      jointLimit > 0
        ? `A partir de uma conexão, o tubo deve seguir o eixo da porta; ${describeAllowance(allowance)}, e a pedida é de ${formatDegrees(deflection, 2)}. Insira um joelho para mudar de direção.`
        : 'A partir de uma conexão, o tubo deve seguir o eixo da porta. Insira um joelho para mudar de direção.',
    );
  }
  if (deflection > MAX_ELBOW_ANGLE) {
    return fail(
      'ANGLE_TOO_SHARP',
      'Mudança de direção muito fechada para um joelho (máximo de 135° de deflexão).',
    );
  }
  if (input.elbowAngles?.length && matchElbowAngle(input.elbowAngles, deflection) === null) {
    return fail(
      'NO_ELBOW_FOR_ANGLE',
      `Não há joelho de ${formatDegrees(deflection, 2)} no catálogo para ${spec.sizeLabel}. Ângulos disponíveis: ${formatAngleList(input.elbowAngles)}.${
        jointLimit > 0 ? ` Sem peça, ${describeAllowance(allowance)}.` : ''
      }`,
    );
  }

  // Tubo flangeado muda de direção com curva flangeada (flange × flange), nunca com uma
  // peça de bolsa ou de ponta encostada no flange.
  const endType = requiredEndType(port.end, input.ends?.start);
  const dims = (input.catalog ?? GENERIC_CATALOG).elbow(
    spec,
    deflection,
    input.elbowFamilyId,
    endType,
  );
  const unmatched = flangeMismatch('joelho', spec, endType, dims);
  if (unmatched) return unmatched;
  const legs = elbowPortDistances({ angle: deflection, ...dims });
  if (pipeLength(host) < legs.a + MIN_PIPE_LENGTH) {
    return fail('PIPE_TOO_SHORT', `"${host.name}" é curto demais para receber o joelho.`);
  }
  if (distance(input.end, corner) < legs.b + MIN_PIPE_LENGTH) {
    return fail('PIPE_TOO_SHORT', 'O novo trecho é curto demais para o joelho necessário.');
  }

  // Apara o tubo existente e posiciona o joelho com o vértice no ponto original.
  const trimmed = touch(
    setPipeEnd(host, port.ref.portId, sub(corner, scale(port.direction, legs.a))),
  );
  const bx = port.direction;
  const by = normalize(sub(direction, scale(bx, dot(direction, bx))));
  const bz = cross(bx, by);
  const elbow: Elbow = {
    ...baseFields(project, 'elbow', spec, systemId),
    kind: 'elbow',
    familyId: dims.familyId,
    ends: dims.ends,
    placement: { position: corner, rotation: quatFromBasis(bx, by, bz) },
    angle: deflection,
    bendRadius: dims.bendRadius,
    ...(dims.straight ? { straight: dims.straight } : {}),
  };
  let next = putElement(putElement(project, trimmed), elbow);
  const pipe = buildPipe(
    next,
    {
      start: add(corner, scale(direction, legs.b)),
      end: input.end,
      spec,
      name: input.name,
      ...(input.ends ? { ends: input.ends } : {}),
    },
    systemId,
  );
  if (!pipe.ok) return pipe;
  next = putElement(next, pipe.value);

  const first = connectPorts(next, port.ref, { elementId: elbow.id, portId: 'a' });
  if (!first.ok) return first;
  const second = connectPorts(
    first.value,
    { elementId: elbow.id, portId: 'b' },
    { elementId: pipe.value.id, portId: 'start' },
  );
  if (!second.ok) return second;
  next = autoConnectElement(second.value, pipe.value.id);
  return ok({ project: next, elementId: pipe.value.id, createdIds: [elbow.id, pipe.value.id] });
}

/** Move uma extremidade LIVRE do tubo. Extremidades conectadas são definidas pela conexão. */
export function setPipeEndpoint(
  project: Project,
  pipeId: string,
  which: 'start' | 'end',
  point: Vec3,
): Result<Project> {
  const pipe = getElement(project, pipeId);
  if (!pipe || pipe.kind !== 'pipe') return fail('NOT_A_PIPE', 'Elemento não é um tubo.');
  if (!isFiniteVec(point)) return fail('INVALID_POINT', 'Coordenadas inválidas.');
  if (!isPortFree(project, { elementId: pipeId, portId: which })) {
    return fail(
      'PORT_OCCUPIED',
      'Esta extremidade está conectada. Desconecte-a antes de alterar suas coordenadas.',
    );
  }
  const moved = touch(setPipeEnd(pipe, which, point));
  if (pipeLength(moved) < MIN_PIPE_LENGTH) {
    return fail('PIPE_TOO_SHORT', 'O tubo ficaria sem comprimento.');
  }
  return reconcile(putElement(project, moved), [pipeId]);
}

/** Altera o comprimento movendo, ao longo do eixo, uma extremidade livre do tubo. */
export function setPipeLength(project: Project, pipeId: string, length: number): Result<Project> {
  const pipe = getElement(project, pipeId);
  if (!pipe || pipe.kind !== 'pipe') return fail('NOT_A_PIPE', 'Elemento não é um tubo.');
  if (!Number.isFinite(length) || length < MIN_PIPE_LENGTH) {
    return fail('INVALID_LENGTH', 'Comprimento inválido.');
  }
  const direction = normalize(sub(pipe.end, pipe.start));
  if (isPortFree(project, { elementId: pipeId, portId: 'end' })) {
    return setPipeEndpoint(project, pipeId, 'end', add(pipe.start, scale(direction, length)));
  }
  if (isPortFree(project, { elementId: pipeId, portId: 'start' })) {
    return setPipeEndpoint(project, pipeId, 'start', sub(pipe.end, scale(direction, length)));
  }
  return fail(
    'PIPE_CONSTRAINED',
    'As duas extremidades estão conectadas; o comprimento é definido pelas conexões.',
  );
}

/**
 * Define o acabamento das extremidades de um tubo (flange e flange, flange e ponta, ponta
 * e flange ou ponta e ponta). As dimensões do flange vêm do catálogo, resolvidas por quem
 * chama; o identificador e a posição das portas do tubo não mudam.
 */
export function setPipeEnds(
  project: Project,
  pipeId: string,
  input: PipeEndsInput,
): Result<Project> {
  const pipe = getElement(project, pipeId);
  if (!pipe || pipe.kind !== 'pipe') return fail('NOT_A_PIPE', 'Elemento não é um tubo.');
  const updated = applyPipeEnds(pipe, input);
  if (!updated.ok) return updated;
  return ok(putElement(project, touch(updated.value)));
}

/** Acabamento das extremidades de um tubo, no formato de `setPipeEnds`. */
export function pipeEndsOf(pipe: Pipe): PipeEndsInput {
  return {
    start: pipe.ends?.start ?? null,
    end: pipe.ends?.end ?? null,
    familyId: pipe.familyId,
  };
}

/** Tubo com apenas a extremidade indicada preservada (as demais passam a ponta lisa). */
function keepPipeEnd(pipe: Pipe, portId: 'start' | 'end'): Pipe {
  const { ends, ...bare } = pipe;
  const kept = ends?.[portId];
  return kept ? { ...bare, ends: { [portId]: kept } } : { ...bare, familyId: null };
}

// ---------------------------------------------------------------------------
// Conexões e equipamentos
// ---------------------------------------------------------------------------

export type FittingInput =
  | { kind: 'elbow'; angle?: number; bendRadius?: number; familyId?: string | null }
  | { kind: 'tee'; branchSpec?: PipeSpec; familyId?: string | null }
  | { kind: 'cross'; branchSpec?: PipeSpec; familyId?: string | null }
  | { kind: 'valve'; valveType?: ValveType; familyId?: string | null }
  | { kind: 'reducer'; outletSpec: PipeSpec; familyId?: string | null }
  | {
      kind: 'pump';
      dischargeSpec?: PipeSpec;
      /** Parâmetros de uma família de catálogo (`pumpParametersFromFamily`). */
      parameters?: PumpParameters;
    }
  | {
      kind: 'tank';
      diameter?: number;
      height?: number;
      /** Parâmetros de uma família de catálogo (`tankParametersFromFamily`). */
      parameters?: TankParameters;
    };

function validateElbow(angle: number, bendRadius: number): Result<true> {
  if (!Number.isFinite(angle) || angle < MIN_ELBOW_ANGLE || angle > MAX_ELBOW_ANGLE) {
    return fail('INVALID_ANGLE', 'O ângulo do joelho deve estar entre 1° e 135°.');
  }
  if (!Number.isFinite(bendRadius) || bendRadius <= 0) {
    return fail('INVALID_RADIUS', 'Raio de curvatura inválido.');
  }
  return ok(true);
}

/** Constrói a conexão na origem, com dimensões do catálogo (ou genéricas). */
export function buildFitting(
  project: Project,
  input: FittingInput,
  spec: PipeSpec,
  systemId: string,
  catalog: FittingCatalog = GENERIC_CATALOG,
  /** Acabamento exigido das extremidades (porta flangeada → peça flangeada). */
  endType?: EndType,
): Result<Fitting> {
  const placement = { position: ZERO, rotation: QUAT_IDENTITY };
  const base = baseFields(project, input.kind, spec, systemId);
  switch (input.kind) {
    case 'elbow': {
      const angle = input.angle ?? degToRad(90);
      const dims = catalog.elbow(spec, angle, input.familyId, endType);
      const custom = input.bendRadius !== undefined;
      const bendRadius = input.bendRadius ?? dims.bendRadius;
      const check = validateElbow(angle, bendRadius);
      if (!check.ok) return check;
      const elbow: Elbow = {
        ...base,
        kind: 'elbow',
        placement,
        familyId: custom ? null : dims.familyId,
        ends: dims.ends,
        angle,
        bendRadius,
        // Raio informado à mão: a peça é genérica, sem os trechos retos da família.
        ...(!custom && dims.straight ? { straight: dims.straight } : {}),
      };
      return ok(elbow);
    }
    case 'tee':
    case 'cross': {
      const piece = input.kind === 'tee' ? 'tê' : 'cruzeta';
      const branchSpec = input.branchSpec ?? spec;
      if (branchSpec.specificationId !== spec.specificationId) {
        return fail(
          'SPEC_MISMATCH',
          `A derivação da ${piece} deve ter a mesma especificação da passagem.`,
        );
      }
      if (branchSpec.dn > spec.dn) {
        return fail('INVALID_BRANCH', `A derivação da ${piece} não pode ser maior que a passagem.`);
      }
      const dims = catalog[input.kind](spec, branchSpec, input.familyId, endType);
      const junction = {
        ...base,
        placement,
        familyId: dims.familyId,
        ends: dims.ends,
        runLength: dims.runLength,
        branchLength: dims.branchLength,
        ...(branchSpec.dn !== spec.dn ? { branchSpec } : {}),
      };
      return ok(
        input.kind === 'tee'
          ? ({ ...junction, kind: 'tee' } satisfies Tee)
          : ({ ...junction, kind: 'cross' } satisfies Cross),
      );
    }
    case 'valve': {
      const valveType = input.valveType ?? 'gate';
      const dims = catalog.valve(spec, valveType, input.familyId, endType);
      const valve: Valve = {
        ...base,
        // O filtro Y é uma peça em linha tratada como "válvula", mas não leva esse nome.
        ...(valveType === 'strainer' ? { name: nextName(project, 'valve', 'Filtro Y') } : {}),
        ...(valveType === 'flowMeter'
          ? { name: nextName(project, 'valve', 'Medidor de vazão') }
          : {}),
        kind: 'valve',
        placement,
        familyId: dims.familyId,
        ends: dims.ends,
        valveType,
        length: dims.length,
        ...(dims.height !== undefined ? { height: dims.height } : {}),
        ...(dims.handwheelDiameter !== undefined
          ? { handwheelDiameter: dims.handwheelDiameter }
          : {}),
        ...(dims.width !== undefined ? { width: dims.width } : {}),
        ...(dims.bonnetLength !== undefined ? { bonnetLength: dims.bonnetLength } : {}),
      };
      return ok(valve);
    }
    case 'reducer': {
      if (input.outletSpec.specificationId !== spec.specificationId) {
        return fail(
          'SPEC_MISMATCH',
          'A redução deve unir dois diâmetros da mesma especificação de tubo.',
        );
      }
      if (input.outletSpec.dn === spec.dn) {
        return fail('REDUCER_SAME_DN', 'A redução deve ter dois diâmetros nominais diferentes.');
      }
      const dims = catalog.reducer(spec, input.outletSpec, input.familyId, endType);
      const reducer: Reducer = {
        ...base,
        kind: 'reducer',
        placement,
        familyId: dims.familyId,
        ends: dims.ends,
        outletSpec: input.outletSpec,
        length: dims.length,
      };
      return ok(reducer);
    }
    case 'pump': {
      const dischargeSpec = input.dischargeSpec ?? spec;
      if (input.parameters) {
        const pump: Pump = { ...base, kind: 'pump', placement, dischargeSpec, ...input.parameters };
        const problem = pumpProblem(pump);
        return problem ? fail('INVALID_VALUE', problem) : ok(pump);
      }
      const length = Math.max(8 * spec.outerDiameter, 0.6);
      const pump: Pump = {
        ...base,
        kind: 'pump',
        placement,
        ends: {},
        dischargeSpec,
        length,
        dischargeOffset: length * 0.22,
        dischargeHeight: Math.max(3.5 * dischargeSpec.outerDiameter, 0.25),
      };
      return ok(pump);
    }
    case 'tank': {
      if (input.parameters) {
        const tank: Tank = { ...base, kind: 'tank', placement, ends: {}, ...input.parameters };
        const problem = tankProblem(tank);
        return problem ? fail('INVALID_VALUE', problem) : ok(tank);
      }
      const diameter = input.diameter ?? 2;
      const height = input.height ?? 2.5;
      if (!(diameter > 0) || !(height > 0)) {
        return fail('INVALID_VALUE', 'Dimensões do reservatório inválidas.');
      }
      const tank: Tank = {
        ...base,
        kind: 'tank',
        placement,
        ends: {},
        diameter,
        height,
        outletHeight: Math.min(0.2, height / 2),
        inletHeight: Math.max(height - 0.3, height / 2),
        nozzleLength: 0.15,
      };
      return ok(tank);
    }
  }
}

/**
 * Posiciona a conexão de modo que sua porta `a` acople em `position`, com a direção da
 * porta oposta a `flow` (sentido de quem entra na conexão). O eixo Z local permanece o
 * mais próximo possível do Z global; `roll` gira em torno do eixo da porta.
 */
export function placeAtPort<T extends Fitting>(
  fitting: T,
  position: Vec3,
  flow: Vec3,
  roll = 0,
): T {
  const local = getPort(
    { ...fitting, placement: { position: ZERO, rotation: QUAT_IDENTITY } },
    'a',
  );
  if (!local) return fitting;
  let rotation = quatMultiply(
    frameFromDirection(negate(flow)),
    quatConjugate(frameFromDirection(local.localDirection)),
  );
  if (roll !== 0) rotation = quatMultiply(quatFromAxisAngle(flow, roll), rotation);
  rotation = quatNormalize(rotation);
  return {
    ...fitting,
    placement: { position: sub(position, rotate(rotation, local.localPosition)), rotation },
  };
}

export interface AttachFittingInput {
  /** Porta livre que receberá a conexão. */
  target: PortRef;
  fitting: FittingInput;
  /** Giro (rad) em torno do eixo da porta, a partir da orientação padrão. */
  roll?: number;
  catalog?: FittingCatalog;
}

/** Insere uma conexão acoplada a uma porta livre (extremidade de tubo ou de outra conexão). */
export function attachFitting(project: Project, input: AttachFittingInput): Result<Created> {
  const port = resolvePort(project, input.target);
  const host = getElement(project, input.target.elementId);
  if (!port || !host) return fail('PORT_NOT_FOUND', 'Porta de conexão inexistente.');
  if (!isPortFree(project, port.ref)) return fail('PORT_OCCUPIED', 'A porta já está conectada.');

  const endType = requiredEndType(port.end);
  const built = buildFitting(
    project,
    input.fitting,
    port.spec,
    host.systemId,
    input.catalog,
    endType,
  );
  if (!built.ok) return built;
  if (CATALOG_FITTINGS.has(built.value.kind)) {
    const unmatched = flangeMismatch(
      elementKindLabel(built.value.kind).toLowerCase(),
      port.spec,
      endType,
      built.value,
    );
    if (unmatched) return unmatched;
  }
  const fitting = placeAtPort(built.value, port.position, port.direction, input.roll ?? 0);
  const connected = connectPorts(putElement(project, fitting), port.ref, {
    elementId: fitting.id,
    portId: 'a',
  });
  if (!connected.ok) return connected;
  return ok({
    project: autoConnectElement(connected.value, fitting.id),
    elementId: fitting.id,
    createdIds: [fitting.id],
  });
}

export interface PlaceEquipmentInput {
  fitting: FittingInput;
  spec: PipeSpec;
  /** Posição da origem do elemento. */
  position: Vec3;
  /** Giro em torno do eixo Z global (rad). */
  rotationZ?: number;
  systemId?: string;
  catalog?: FittingCatalog;
}

/** Posiciona um elemento isolado (bomba, reservatório etc.) em um ponto do modelo. */
export function placeEquipment(project: Project, input: PlaceEquipmentInput): Result<Created> {
  if (!isFiniteVec(input.position)) return fail('INVALID_POINT', 'Coordenadas inválidas.');
  const system = defaultSystemId(project, input.systemId);
  if (!system.ok) return system;
  const built = buildFitting(project, input.fitting, input.spec, system.value, input.catalog);
  if (!built.ok) return built;
  const placed: Fitting = {
    ...built.value,
    placement: {
      position: input.position,
      rotation: quatFromAxisAngle(AXIS_Z, input.rotationZ ?? 0),
    },
  };
  const next = autoConnectElement(putElement(project, placed), placed.id);
  return ok({ project: next, elementId: placed.id, createdIds: [placed.id] });
}

export interface InsertInlineInput {
  pipeId: string;
  /** Posição do centro da conexão, medida a partir do início do tubo (m). */
  distanceFromStart: number;
  fitting:
    | { kind: 'tee'; branchSpec?: PipeSpec; familyId?: string | null }
    | { kind: 'cross'; branchSpec?: PipeSpec; familyId?: string | null }
    | { kind: 'valve'; valveType?: ValveType; familyId?: string | null };
  roll?: number;
  catalog?: FittingCatalog;
  /**
   * Acabamento exigido da peça (porta flangeada → peça flangeada). Ausente: o do tubo — um
   * tubo com flanges recebe peça flangeada e as faces do corte ganham o flange da família do
   * tubo (`cutFlange`).
   */
  endType?: EndType;
  /**
   * Flange das faces criadas pelo corte quando a peça é flangeada. Ausente: o da família de
   * tubos flangeados do próprio tubo, ou de uma família que case com o flange da peça.
   */
  cutFlange?: { end: EndTreatment; familyId: string };
}

/**
 * Acabamento da peça em linha: o pedido; o da família escolhida (tê, cruzeta); ou, num tubo
 * com flanges, o flangeado — o coletor flangeado recebe tê flangeado.
 */
function inlineEndType(
  pipe: Pipe,
  input: InsertInlineInput,
  catalog: FittingCatalog,
): EndType | undefined {
  if (input.endType) return input.endType;
  const { fitting } = input;
  if (fitting.kind !== 'tee' && fitting.kind !== 'cross') return undefined;
  if (fitting.familyId) {
    const chosen = catalog
      .junctionFamilies?.(fitting.kind, pipe.spec, fitting.branchSpec ?? pipe.spec)
      .find((family) => family.id === fitting.familyId);
    if (chosen) return chosen.endType;
  }
  const flanged = pipe.ends && Object.values(pipe.ends).some((end) => end.type === 'flange');
  if (!flanged) return undefined;
  // Sem peça flangeada no catálogo, vale a peça de bolsas sobre as pontas do corte (montagem
  // real: o corte de um tubo flangeado deixa pontas lisas).
  const offered = catalog.junctionFamilies?.(
    fitting.kind,
    pipe.spec,
    fitting.branchSpec ?? pipe.spec,
    'flange',
  );
  return offered && offered.length > 0 ? 'flange' : undefined;
}

/**
 * Insere uma conexão em linha (tê, cruzeta ou válvula) dividindo o tubo em dois trechos.
 * O tubo original mantém seu identificador no primeiro trecho.
 */
export function insertInline(project: Project, input: InsertInlineInput): Result<Created> {
  const pipe = getElement(project, input.pipeId);
  if (!pipe || pipe.kind !== 'pipe') {
    return fail('NOT_A_PIPE', 'Selecione um tubo para inserir a conexão em linha.');
  }
  if (input.fitting.kind === 'valve' && input.fitting.valveType === 'airRelease') {
    return fail('NOT_INLINE', 'A ventosa não é instalada em linha: acople-a à derivação de um tê.');
  }
  const catalog = input.catalog ?? GENERIC_CATALOG;
  const endType = inlineEndType(pipe, input, catalog);
  const built = buildFitting(project, input.fitting, pipe.spec, pipe.systemId, catalog, endType);
  if (!built.ok) return built;
  const unmatched = flangeMismatch(
    elementKindLabel(built.value.kind).toLowerCase(),
    pipe.spec,
    endType,
    built.value,
  );
  if (unmatched) return unmatched;
  // Peça flangeada: as duas faces do corte precisam de flange que case com o da peça. O tubo
  // cortado vira dois tubos com flanges da família — nunca uma ponta lisa encostada no flange.
  const runFlange = built.value.ends.a;
  let cutFlange: PipeFlange | null = null;
  if (runFlange?.type === 'flange') {
    const chosen = input.cutFlange ? ok(input.cutFlange) : pipeFlangeFor(catalog, pipe, runFlange);
    // Válvulas: sem família de tubos com flanges que case (aço-carbono, por exemplo), mantém-se
    // o comportamento anterior — a verificação geral do tipo de extremidade ainda é pendência
    // (ROADMAP, Fase 2). Tês e cruzetas seguem a regra estrita.
    if (!chosen.ok && input.fitting.kind !== 'valve') return chosen;
    if (chosen.ok) {
      if (!flangesMate(chosen.value.end, runFlange)) {
        return fail(
          'FLANGE_MISMATCH',
          `O flange do tubo (${describeDrilling(chosen.value.end)}) não casa com o da peça (${describeDrilling(runFlange)}).`,
        );
      }
      cutFlange = chosen.value;
    }
  }
  const total = pipeLength(pipe);
  const direction = normalize(sub(pipe.end, pipe.start));
  const fitting = placeAtPort(built.value, ZERO, direction, input.roll ?? 0);
  const portA = getPort(fitting, 'a');
  const portB = getPort(fitting, 'b');
  if (!portA || !portB) return fail('INTERNAL', 'Conexão sem portas de passagem.');
  const faceToFace = distance(portA.position, portB.position);
  const half = faceToFace / 2;
  const d = input.distanceFromStart;
  if (!Number.isFinite(d) || d - half < MIN_PIPE_LENGTH || total - d - half < MIN_PIPE_LENGTH) {
    return fail(
      'NO_ROOM',
      `Não há espaço para a conexão nessa posição (necessário ao menos ${(half * 1000).toFixed(0)} mm de tubo de cada lado do centro).`,
    );
  }

  const center = add(pipe.start, scale(direction, d));
  const placed: Fitting = {
    ...fitting,
    placement: {
      rotation: fitting.placement.rotation,
      // Translada de modo que o ponto médio das portas de passagem caia em `center`.
      position: add(
        fitting.placement.position,
        sub(center, scale(add(portA.position, portB.position), 0.5)),
      ),
    },
  };
  // O corte cria duas pontas lisas: cada trecho conserva só o flange da sua extremidade
  // original (tubo com flanges) e, com peça flangeada, recebe o flange na face do corte.
  const kept = keepPipeEnd({ ...pipe, end: sub(center, scale(direction, half)) }, 'start');
  const firstResult = cutFlange
    ? applyPipeEnds(kept, {
        start: kept.ends?.start ?? null,
        end: cutFlange.end,
        familyId: cutFlange.familyId,
      })
    : ok(kept);
  if (!firstResult.ok) return firstResult;
  const first = touch(firstResult.value);
  const tail = keepPipeEnd(
    {
      ...baseFields(project, 'pipe', pipe.spec, pipe.systemId),
      kind: 'pipe',
      familyId: pipe.familyId,
      properties: { ...pipe.properties },
      manufacturing: { ...pipe.manufacturing },
      start: add(center, scale(direction, half)),
      end: pipe.end,
      ...(pipe.ends ? { ends: pipe.ends } : {}),
    },
    'end',
  );
  const secondResult = cutFlange
    ? applyPipeEnds(tail, {
        start: cutFlange.end,
        end: tail.ends?.end ?? null,
        familyId: cutFlange.familyId,
      })
    : ok(tail);
  if (!secondResult.ok) return secondResult;
  const second: Pipe = secondResult.value;

  // A conexão que existia no fim do tubo original passa para o novo trecho.
  const oldEnd: PortRef = { elementId: pipe.id, portId: 'end' };
  const newEnd: PortRef = { elementId: second.id, portId: 'end' };
  let next: Project = {
    ...project,
    connections: project.connections.map((c) => ({
      ...c,
      a: c.a.elementId === oldEnd.elementId && c.a.portId === oldEnd.portId ? newEnd : c.a,
      b: c.b.elementId === oldEnd.elementId && c.b.portId === oldEnd.portId ? newEnd : c.b,
    })),
  };
  next = putElement(putElement(putElement(next, first), placed), second);
  const c1 = connectPorts(next, oldEnd, { elementId: placed.id, portId: 'a' });
  if (!c1.ok) return c1;
  const c2 = connectPorts(
    c1.value,
    { elementId: placed.id, portId: 'b' },
    { elementId: second.id, portId: 'start' },
  );
  if (!c2.ok) return c2;
  return ok({ project: c2.value, elementId: placed.id, createdIds: [placed.id, second.id] });
}

/**
 * Acabamentos que se acoplam diretamente: flange só com flange de mesma furação; bolsa
 * recebe ponta (nunca outra bolsa); ponta com ponta é a junta entre tubos já modelada.
 * Devolve o motivo da incompatibilidade, ou `null`.
 */
export function endMismatch(a: EndTreatment | null, b: EndTreatment | null): string | null {
  const flangeA = a?.type === 'flange';
  const flangeB = b?.type === 'flange';
  if (flangeA && flangeB && a && b) {
    return flangesMate(a, b)
      ? null
      : `Os flanges não casam (${describeDrilling(a)} × ${describeDrilling(b)}).`;
  }
  if (flangeA || flangeB) {
    return 'Flange só se liga a flange: a outra extremidade é bolsa ou ponta lisa e exigiria peça de transição.';
  }
  if (a?.type === 'socket' && b?.type === 'socket') {
    return 'Bolsa não recebe bolsa: a ligação exige um tubo ou peça com ponta.';
  }
  return null;
}

export interface RunToPortInput {
  /** Porta livre de onde o trecho parte; ausente = ponto livre `start`. */
  fromPort?: PortRef;
  start: Vec3;
  spec: PipeSpec;
  systemId?: string;
  name?: string;
  catalog?: FittingCatalog;
  elbowAngles?: readonly number[];
  elbowFamilyId?: string | null;
}

/** Resultado de levar um trecho até uma porta: `extendedId` = tubo existente prolongado. */
export interface RunToPort extends Created {
  readonly extendedId: string | null;
}

/**
 * Leva o trecho de `input` até a porta livre `target` e registra a ligação. A porta de destino
 * é a referência: o trecho tem de chegar pelo eixo dela (oposto à sua direção).
 *  - Saindo da extremidade livre de um tubo, alinhada ao destino: o próprio tubo é prolongado
 *    (sem peça nem junta intermediária).
 *  - Nos demais casos, um tubo novo (com joelho automático saindo de tubo, como no traçado).
 * Destino flangeado: a face do tubo recebe flange de uma família de tubos com flanges que case
 * com ele; sem essa família, a ligação é recusada (não há flange a presumir). Bolsa recebe
 * ponta; flange nunca encosta em bolsa ou ponta.
 */
export function runToPort(
  project: Project,
  input: RunToPortInput,
  target: PortRef,
): Result<RunToPort> {
  const goal = resolvePort(project, target);
  const goalHost = getElement(project, target.elementId);
  if (!goal || !goalHost) return fail('PORT_NOT_FOUND', 'Porta de destino inexistente.');
  if (!isPortFree(project, target))
    return fail('PORT_OCCUPIED', 'A porta de destino já está ligada.');
  const origin = input.fromPort ? resolvePort(project, input.fromPort) : undefined;
  if (input.fromPort && !origin) return fail('PORT_NOT_FOUND', 'Porta de partida inexistente.');
  if (origin && !isPortFree(project, origin.ref)) {
    return fail('PORT_OCCUPIED', 'A porta de partida já está ligada.');
  }
  const spec = origin?.spec ?? input.spec;
  if (spec.specificationId !== goal.spec.specificationId) {
    return fail(
      'SPEC_MISMATCH',
      `Especificações diferentes (${spec.standard} × ${goal.spec.standard}): é necessária uma peça de transição.`,
    );
  }
  if (spec.dn !== goal.spec.dn) {
    return fail(
      'DN_MISMATCH',
      `Diâmetros diferentes (${spec.sizeLabel} × ${goal.spec.sizeLabel}): é necessária uma redução.`,
    );
  }
  const start = origin?.position ?? input.start;
  const catalog = input.catalog ?? GENERIC_CATALOG;
  const gap = sub(goal.position, start);
  const reach = Math.hypot(gap.x, gap.y, gap.z);

  // Portas já encostadas e opostas: só registrar a ligação.
  if (origin && reach <= POSITION_TOLERANCE) {
    const mismatch = endMismatch(origin.end, goal.end);
    if (mismatch) return fail('END_MISMATCH', mismatch);
    const joined = connectPorts(project, origin.ref, target);
    if (!joined.ok) return joined;
    return ok({
      project: joined.value,
      elementId: origin.ref.elementId,
      createdIds: [],
      extendedId: null,
    });
  }
  if (reach < MIN_PIPE_LENGTH) {
    return fail('PIPE_TOO_SHORT', 'O ponto de partida está perto demais da porta de destino.');
  }
  // O último trecho chega pelo eixo da porta de destino.
  const arrival = angleBetween(gap, negate(goal.direction));
  const lateral = reach * Math.sin(Math.min(arrival, Math.PI / 2));
  const host = origin ? getElement(project, origin.ref.elementId) : undefined;
  const fromPipeEnd = host?.kind === 'pipe' && origin !== undefined;
  const straight = origin ? angleBetween(origin.direction, gap) <= ANGLE_TOLERANCE : true;
  if (arrival > ANGLE_TOLERANCE) {
    return fail(
      'OFF_PORT_AXIS',
      `O trecho não chega pelo eixo da porta de "${goalHost.name}" (desvio de ${formatDegrees(arrival, 2)}, ${(lateral * 1000).toFixed(0)} mm fora do eixo). Use "Alinhar e conectar" para escolher joelhos ou desvio.`,
    );
  }

  // Prolongamento do próprio tubo.
  if (fromPipeEnd && host?.kind === 'pipe' && origin && straight) {
    const which = origin.ref.portId === 'start' ? 'start' : 'end';
    const current = host.ends?.[which] ?? null;
    let ends = pipeEndsOf(host);
    if (goal.end?.type === 'flange' && current?.type !== 'flange') {
      // A face prolongada recebe o flange da família do tubo (ou de uma que case).
      const flange = pipeFlangeFor(catalog, host, goal.end);
      if (!flange.ok) return flange;
      ends =
        which === 'start'
          ? { ...ends, start: flange.value.end, familyId: flange.value.familyId }
          : { ...ends, end: flange.value.end, familyId: flange.value.familyId };
    }
    const mismatch = endMismatch(which === 'start' ? ends.start : ends.end, goal.end);
    if (mismatch) return fail('END_MISMATCH', mismatch);
    const moved = applyPipeEnds(setPipeEnd(host, which, goal.position), ends);
    if (!moved.ok) return moved;
    const joined = connectPorts(putElement(project, touch(moved.value)), origin.ref, target);
    if (!joined.ok) return joined;
    return ok({ project: joined.value, elementId: host.id, createdIds: [], extendedId: host.id });
  }

  // Tubo novo: flange nas faces que encostam em flange (partida de peça flangeada, destino
  // flangeado), da mesma família de tubos com flanges.
  const startMate = origin?.end?.type === 'flange' ? origin.end : null;
  const endMate = goal.end?.type === 'flange' ? goal.end : null;
  let ends: PipeEndsInput | undefined;
  if (startMate || endMate) {
    const family = newPipeFlange(
      catalog,
      spec,
      [startMate, endMate].filter((end): end is EndTreatment => end !== null),
    );
    if (!family.ok) return family;
    ends = {
      start: startMate ? family.value.end : null,
      end: endMate ? family.value.end : null,
      familyId: family.value.familyId,
    };
  }
  const mismatch = endMismatch(ends?.end ?? null, goal.end);
  if (mismatch) return fail('END_MISMATCH', mismatch);
  const drawn = drawPipe(project, {
    fromPort: input.fromPort,
    start,
    end: goal.position,
    spec,
    systemId: input.systemId ?? goalHost.systemId,
    name: input.name,
    catalog,
    elbowAngles: input.elbowAngles,
    elbowFamilyId: input.elbowFamilyId,
    ...(ends ? { ends } : {}),
  });
  if (!drawn.ok) return drawn;
  const link = findConnection(drawn.value.project, target);
  const joined =
    link &&
    [link.a, link.b].some((r) => r.elementId === drawn.value.elementId && r.portId === 'end');
  if (!joined) {
    return fail(
      'NOT_COUPLED',
      `O trecho não acopla na porta de "${goalHost.name}"; nada foi criado.`,
    );
  }
  return ok({ ...drawn.value, extendedId: null });
}

/**
 * Pé da perpendicular de `from` sobre o eixo do tubo: único ponto em que um trecho vindo de
 * `from` pode derivar por um tê (derivação a 90°). `distanceFromStart` pode cair fora do tubo.
 */
export function pipeBranchPoint(
  pipe: Pipe,
  from: Vec3,
): { point: Vec3; distanceFromStart: number } {
  const { point, t } = closestPointOnLine(pipe.start, sub(pipe.end, pipe.start), from);
  return { point, distanceFromStart: t };
}

/**
 * Insere um tê em linha no tubo com a derivação apontando para `toward` (unitário e
 * perpendicular ao eixo). A derivação assume `spec` (tê de redução quando o DN difere).
 */
/**
 * Peça da derivação: `auto` e `tee` = tê; `cross` = cruzeta, com a derivação oposta livre (só
 * um acessório real a fecharia). Sobre um tê existente, `auto` o converte em cruzeta.
 */
export type JunctionChoice = 'auto' | 'tee' | 'cross';

export interface JunctionOptions {
  catalog?: FittingCatalog;
  teeFamilyId?: string | null;
  crossFamilyId?: string | null;
  junction?: JunctionChoice;
}

function insertBranchTee(
  project: Project,
  pipe: Pipe,
  distanceFromStart: number,
  toward: Vec3,
  spec: PipeSpec,
  options: JunctionOptions,
): Result<{ project: Project; createdIds: string[]; branch: Port }> {
  const asCross = options.junction === 'cross';
  const branchSpec =
    spec.specificationId !== pipe.spec.specificationId || spec.dn !== pipe.spec.dn
      ? { branchSpec: spec }
      : {};
  const fitting: InsertInlineInput['fitting'] = asCross
    ? { kind: 'cross', familyId: options.crossFamilyId, ...branchSpec }
    : { kind: 'tee', familyId: options.teeFamilyId, ...branchSpec };
  // Giro que leva a derivação, da orientação padrão, à direção pedida.
  const probe = buildFitting(project, fitting, pipe.spec, pipe.systemId, options.catalog);
  if (!probe.ok) return probe;
  const axis = normalize(sub(pipe.end, pipe.start));
  const rest = getPort(placeAtPort(probe.value, ZERO, axis), 'branch');
  if (!rest) return fail('INTERNAL', 'Tê sem porta de derivação.');
  const roll = Math.atan2(dot(cross(rest.direction, toward), axis), dot(rest.direction, toward));

  const inserted = insertInline(project, {
    pipeId: pipe.id,
    distanceFromStart,
    fitting,
    roll,
    catalog: options.catalog,
  });
  if (!inserted.ok) return inserted;
  const branch = resolvePort(inserted.value.project, {
    elementId: inserted.value.elementId,
    portId: 'branch',
  });
  if (!branch) return fail('INTERNAL', 'Tê sem porta de derivação.');
  return ok({ project: inserted.value.project, createdIds: inserted.value.createdIds, branch });
}

export interface DrawPipeToPipeInput extends Omit<DrawPipeInput, 'end'>, JunctionOptions {
  /** Tubo existente que recebe o novo trecho. */
  targetPipeId: string;
}

/**
 * Desenha um tubo que termina sobre um tubo existente: em vez de deixar o trecho solto sobre
 * o outro, insere um tê em linha no pé da perpendicular do ponto de partida, gira a derivação
 * para esse ponto e acopla o novo trecho a ela. A derivação assume o diâmetro do novo trecho
 * (tê de redução), que não pode ser maior nem de outra especificação que a passagem.
 */
export function drawPipeToPipe(project: Project, input: DrawPipeToPipeInput): Result<Created> {
  const target = getElement(project, input.targetPipeId);
  if (!target || target.kind !== 'pipe') {
    return fail('NOT_A_PIPE', 'O destino da derivação não é um tubo.');
  }
  let start = input.start;
  let spec = input.spec;
  if (input.fromPort) {
    const port = resolvePort(project, input.fromPort);
    if (!port) return fail('PORT_NOT_FOUND', 'Porta de conexão inexistente.');
    if (port.ref.elementId === target.id) {
      return fail('SAME_PIPE', 'O trecho não pode terminar no próprio tubo de onde parte.');
    }
    start = port.position;
    spec = port.spec;
  }
  if (!isFiniteVec(start)) return fail('INVALID_POINT', 'Coordenadas inválidas.');

  const { point: junction, distanceFromStart } = pipeBranchPoint(target, start);
  if (distanceFromStart <= 0 || distanceFromStart >= pipeLength(target)) {
    return fail(
      'NO_PERPENDICULAR',
      `O tê deriva a 90°, mas a perpendicular do ponto de partida não encontra "${target.name}". Parta de um ponto em frente ao tubo.`,
    );
  }
  const reach = distance(start, junction);
  const toward = reach < MIN_PIPE_LENGTH ? null : tryNormalize(sub(start, junction));
  if (!toward) {
    return fail('PIPE_TOO_SHORT', `O ponto de partida está sobre o eixo de "${target.name}".`);
  }

  const inserted = insertBranchTee(project, target, distanceFromStart, toward, spec, input);
  if (!inserted.ok) return inserted;
  const { branch } = inserted.value;
  const piece = input.junction === 'cross' ? 'da cruzeta' : 'do tê';
  if (reach - distance(branch.position, junction) < MIN_PIPE_LENGTH) {
    return fail(
      'NO_ROOM',
      `O ponto de partida está perto demais de "${target.name}" para a derivação ${piece}.`,
    );
  }

  // Saindo da extremidade livre de um tubo alinhado à derivação, o próprio tubo é prolongado.
  const drawn = runToPort(
    inserted.value.project,
    {
      fromPort: input.fromPort,
      start,
      spec,
      systemId: input.systemId ?? target.systemId,
      name: input.name,
      catalog: input.catalog,
      elbowAngles: input.elbowAngles,
      elbowFamilyId: input.elbowFamilyId,
    },
    branch.ref,
  );
  if (!drawn.ok) return drawn;
  return ok({
    project: drawn.value.project,
    elementId: drawn.value.elementId,
    createdIds: [...inserted.value.createdIds, ...drawn.value.createdIds],
  });
}

export interface DrawPipeFromPipeInput extends JunctionOptions {
  /** Tubo existente de onde o novo trecho deriva. */
  sourcePipeId: string;
  /** Posição do centro do tê, medida a partir do início do tubo de origem (m). */
  distanceFromStart: number;
  /**
   * Ponto final indicado. A derivação sai a 90°: só vale a componente perpendicular ao tubo
   * de origem (a componente ao longo do eixo é descartada).
   */
  end: Vec3;
  /** Quando informado, o trecho termina sobre este tubo, com um segundo tê automático. */
  targetPipeId?: string;
  spec: PipeSpec;
  name?: string;
}

/** Projeção de `point` no plano perpendicular ao tubo que passa por `origin` (ponto do eixo). */
export function projectOntoPipeNormal(pipe: Pipe, origin: Vec3, point: Vec3): Vec3 {
  const axis = normalize(sub(pipe.end, pipe.start));
  const offset = sub(point, origin);
  return add(origin, sub(offset, scale(axis, dot(offset, axis))));
}

/**
 * Desenha um tubo que parte de um ponto sobre um tubo existente: insere um tê em linha nesse
 * ponto, com a derivação voltada para o ponto final, e o novo trecho sai da derivação.
 */
export function drawPipeFromPipe(project: Project, input: DrawPipeFromPipeInput): Result<Created> {
  const source = getElement(project, input.sourcePipeId);
  if (!source || source.kind !== 'pipe') {
    return fail('NOT_A_PIPE', 'A origem da derivação não é um tubo.');
  }
  if (input.targetPipeId === source.id) {
    return fail('SAME_PIPE', 'O trecho não pode terminar no próprio tubo de onde parte.');
  }
  if (!isFiniteVec(input.end) || !Number.isFinite(input.distanceFromStart)) {
    return fail('INVALID_POINT', 'Coordenadas inválidas.');
  }
  const axis = normalize(sub(source.end, source.start));
  const center = add(source.start, scale(axis, input.distanceFromStart));
  const end = projectOntoPipeNormal(source, center, input.end);
  const reach = distance(end, center);
  const toward = reach < MIN_PIPE_LENGTH ? null : tryNormalize(sub(end, center));
  if (!toward) {
    return fail(
      'PIPE_TOO_SHORT',
      `O ponto indicado está sobre o eixo de "${source.name}": indique um ponto ao lado do tubo para a derivação.`,
    );
  }
  const inserted = insertBranchTee(
    project,
    source,
    input.distanceFromStart,
    toward,
    input.spec,
    input,
  );
  if (!inserted.ok) return inserted;
  const { branch } = inserted.value;

  let drawn: Result<Created>;
  if (input.targetPipeId !== undefined) {
    drawn = drawPipeToPipe(inserted.value.project, {
      fromPort: branch.ref,
      start: branch.position,
      targetPipeId: input.targetPipeId,
      spec: branch.spec,
      name: input.name,
      catalog: input.catalog,
      teeFamilyId: input.teeFamilyId,
      crossFamilyId: input.crossFamilyId,
      // A segunda peça segue a escolha; `auto` sobre tubo simples é tê.
      junction: input.junction,
    });
  } else {
    if (reach - distance(branch.position, center) < MIN_PIPE_LENGTH) {
      return fail(
        'NO_ROOM',
        `O ponto indicado está perto demais de "${source.name}" para a derivação ${input.junction === 'cross' ? 'da cruzeta' : 'do tê'}.`,
      );
    }
    // Derivação flangeada: o ramal sai com flange (família de tubos com flanges que case).
    let ends: PipeEndsInput | undefined;
    if (branch.end?.type === 'flange') {
      const flange = newPipeFlange(input.catalog ?? GENERIC_CATALOG, branch.spec, [branch.end]);
      if (!flange.ok) return flange;
      ends = { start: flange.value.end, end: null, familyId: flange.value.familyId };
    }
    drawn = drawPipe(inserted.value.project, {
      fromPort: branch.ref,
      start: branch.position,
      end,
      spec: branch.spec,
      name: input.name,
      catalog: input.catalog,
      ...(ends ? { ends } : {}),
    });
  }
  if (!drawn.ok) return drawn;
  return ok({
    project: drawn.value.project,
    elementId: drawn.value.elementId,
    createdIds: [...inserted.value.createdIds, ...drawn.value.createdIds],
  });
}

/** Parâmetros numéricos editáveis por tipo de elemento. */
const EDITABLE: Record<FittingKind, readonly string[]> = {
  elbow: ['angle', 'bendRadius'],
  tee: ['runLength', 'branchLength'],
  cross: ['runLength', 'branchLength'],
  reducer: ['length'],
  valve: ['length', 'height', 'handwheelDiameter', 'width', 'bonnetLength'],
  pump: [
    'length',
    'dischargeOffset',
    'dischargeHeight',
    'ratedFlow',
    'ratedHead',
    'footOffset',
    'footSpan',
    'rearLength',
    'footWidth',
    'footHoleDiameter',
    'axisHeight',
    'totalHeight',
  ],
  tank: [
    'diameter',
    'height',
    'outletHeight',
    'inletHeight',
    'nozzleLength',
    'columnHeight',
    'columnDiameter',
    'coneHeight',
    'supportHeight',
    'length',
    'shellThickness',
    'maxWaterLevel',
    'nominalCapacity',
  ],
};
/** Parâmetros que podem ser zero. */
const ALLOW_ZERO = new Set(['outletHeight', 'inletHeight', 'supportHeight']);
/** Parâmetros que não alteram a geometria (não desvinculam o elemento da família). */
const NON_GEOMETRIC = new Set(['ratedFlow', 'ratedHead', 'nominalCapacity', 'maxWaterLevel']);
/** Reservatórios: parâmetros de forma aplicáveis a cada tipo construtivo. */
const TANK_SHAPE_FIELDS: Record<TankType, readonly string[]> = {
  generic: [],
  gobletWet: ['columnHeight', 'columnDiameter', 'coneHeight'],
  gobletDry: ['columnHeight', 'columnDiameter', 'coneHeight'],
  tubular: [],
  australian: ['coneHeight', 'supportHeight'],
  verticalGround: [],
  verticalConeLegs: ['coneHeight', 'supportHeight'],
  fieldErected: [],
  horizontal: ['supportHeight', 'length'],
};
const TANK_SHAPE_KEYS = new Set(Object.values(TANK_SHAPE_FIELDS).flat());
/** Bombas: parâmetros de forma aplicáveis a cada tipo construtivo. */
const PUMP_SHAPE_FIELDS: Record<PumpType, readonly string[]> = {
  generic: ['dischargeOffset', 'dischargeHeight'],
  amphibious: PUMP_DIMENSION_KEYS.filter((key) => key !== 'length'),
};
const PUMP_SHAPE_KEYS = new Set(Object.values(PUMP_SHAPE_FIELDS).flat());
/** Reservatórios: parâmetros que identificam o modelo comercial do catálogo. */
const TANK_CATALOG_KEYS = new Set([
  'diameter',
  'height',
  'columnHeight',
  'supportHeight',
  'length',
  'nominalCapacity',
]);

export type FittingPatch = {
  angle?: number;
  bendRadius?: number;
  runLength?: number;
  branchLength?: number;
  length?: number;
  height?: number;
  handwheelDiameter?: number;
  width?: number;
  bonnetLength?: number;
  dischargeOffset?: number;
  dischargeHeight?: number;
  footOffset?: number;
  footSpan?: number;
  rearLength?: number;
  footWidth?: number;
  footHoleDiameter?: number;
  axisHeight?: number;
  totalHeight?: number;
  ratedFlow?: number;
  ratedHead?: number;
  diameter?: number;
  outletHeight?: number;
  inletHeight?: number;
  nozzleLength?: number;
  columnHeight?: number;
  columnDiameter?: number;
  coneHeight?: number;
  supportHeight?: number;
  shellThickness?: number;
  maxWaterLevel?: number;
  nominalCapacity?: number;
  valveType?: ValveType;
};

/**
 * Altera parâmetros de uma conexão e reajusta os elementos vizinhos. Editar dimensões
 * manualmente desvincula o elemento da família de catálogo (`familyId = null`).
 */
export function updateFitting(project: Project, id: string, patch: FittingPatch): Result<Project> {
  const element = getElement(project, id);
  if (!element || element.kind === 'pipe') {
    return fail('NOT_A_FITTING', 'Elemento não é uma conexão.');
  }
  const numeric: Record<string, number> = {};
  let geometric = false;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || key === 'valveType') continue;
    const applies =
      EDITABLE[element.kind].includes(key) &&
      (element.kind !== 'tank' ||
        !TANK_SHAPE_KEYS.has(key) ||
        (TANK_SHAPE_FIELDS[tankTypeOf(element)] ?? []).includes(key)) &&
      (element.kind !== 'pump' ||
        !PUMP_SHAPE_KEYS.has(key) ||
        PUMP_SHAPE_FIELDS[pumpTypeOf(element)].includes(key));
    if (!applies) {
      return fail('INVALID_FIELD', `O parâmetro "${key}" não se aplica a este elemento.`);
    }
    const number = value as number;
    const valid = Number.isFinite(number) && (ALLOW_ZERO.has(key) ? number >= 0 : number > 0);
    if (!valid) return fail('INVALID_VALUE', 'Valor inválido: informe um número positivo.');
    numeric[key] = number;
    if (!NON_GEOMETRIC.has(key)) geometric = true;
  }

  let updated = { ...element, ...numeric } as Fitting;
  if (updated.kind === 'tank' && tankTypeOf(updated) !== 'generic') {
    // A forma da família permanece; só o vínculo com o modelo comercial é desfeito quando
    // uma dimensão de catálogo é alterada.
    if (tankTypeOf(updated) === 'horizontal') {
      updated = { ...updated, height: (updated.supportHeight ?? 0) + updated.diameter };
    }
    if (updated.variantId && Object.keys(numeric).some((key) => TANK_CATALOG_KEYS.has(key))) {
      const { variantId: _variant, ...rest } = updated;
      updated = {
        ...rest,
        manufacturing: {
          ...rest.manufacturing,
          model: `${TANK_TYPE_LABELS[tankTypeOf(rest)]} (dimensões personalizadas)`,
        },
      };
    }
  } else if (updated.kind === 'pump' && pumpTypeOf(updated) !== 'generic') {
    // A forma da família permanece; alterar uma cota desfaz o vínculo com a linha da tabela.
    if (geometric) updated = unlinkPumpVariant(updated);
  } else if (geometric) updated = { ...updated, familyId: null };
  if (updated.kind === 'pump') {
    const problem = pumpProblem(updated);
    if (problem) return fail('INVALID_VALUE', problem);
  }
  if (updated.kind === 'elbow') {
    const check = validateElbow(updated.angle, updated.bendRadius);
    if (!check.ok) return check;
  }
  if (updated.kind === 'tank') {
    const problem = tankProblem(updated);
    if (problem) return fail('INVALID_VALUE', problem);
  }
  if (patch.valveType !== undefined && updated.kind === 'valve') {
    const wasAir = updated.valveType === 'airRelease';
    const willBeAir = patch.valveType === 'airRelease';
    if (wasAir !== willBeAir) {
      return fail(
        'INVALID_VALUE',
        'Não é possível converter entre ventosa e válvula em linha; exclua e insira novamente.',
      );
    }
    updated = { ...updated, valveType: patch.valveType };
  }
  return reconcile(putElement(project, touch(updated)), [id]);
}

/**
 * Gira a conexão em torno do eixo de uma de suas portas. Só é aceito quando as demais
 * portas conectadas permanecem acopladas (ex.: tê em linha girando sobre a passagem).
 */
export function rollFitting(
  project: Project,
  id: string,
  axisPortId: string,
  angle: number,
): Result<Project> {
  const element = getElement(project, id);
  if (!element || element.kind === 'pipe') {
    return fail('NOT_A_FITTING', 'Elemento não é uma conexão.');
  }
  const port = getPort(element, axisPortId);
  if (!port) return fail('PORT_NOT_FOUND', 'Porta de conexão inexistente.');
  if (!Number.isFinite(angle)) return fail('INVALID_ANGLE', 'Ângulo inválido.');
  const q = quatFromAxisAngle(port.direction, angle);
  const rotated: Fitting = touch({
    ...element,
    placement: {
      rotation: quatNormalize(quatMultiply(q, element.placement.rotation)),
      position: add(port.position, rotate(q, sub(element.placement.position, port.position))),
    },
  });
  // Não se usa `reconcile`: um giro não pode ser absorvido esticando tubos.
  return verifyCoupling(putElement(project, rotated), [id]);
}

function translated(element: HydroElement, delta: Vec3): HydroElement {
  return element.kind === 'pipe'
    ? { ...element, start: add(element.start, delta), end: add(element.end, delta) }
    : translateFitting(element, delta);
}

/** Translada elementos; tubos vizinhos se ajustam quando o acoplamento permite. */
export function translateElements(
  project: Project,
  ids: readonly string[],
  delta: Vec3,
): Result<Project> {
  if (!isFiniteVec(delta)) return fail('INVALID_POINT', 'Deslocamento inválido.');
  let next = project;
  for (const id of ids) {
    const element = getElement(next, id);
    if (!element) return fail('ELEMENT_NOT_FOUND', 'Elemento inexistente.');
    next = putElement(next, touch(translated(element, delta)));
  }
  return reconcile(next, ids);
}

function rotatedAbout(element: HydroElement, center: Vec3, q: Quat): HydroElement {
  return rigidlyMoved(element, center, center, q);
}

/** Movimento rígido: gira `q` em torno de `from` e leva `from` a `to`. */
function rigidlyMoved(element: HydroElement, from: Vec3, to: Vec3, q: Quat): HydroElement {
  const turn = (point: Vec3): Vec3 => add(to, rotate(q, sub(point, from)));
  if (element.kind === 'pipe') {
    return { ...element, start: turn(element.start), end: turn(element.end) };
  }
  return {
    ...element,
    placement: {
      position: turn(element.placement.position),
      rotation: quatNormalize(quatMultiply(q, element.placement.rotation)),
    },
  };
}

/**
 * Gira elementos em torno do eixo vertical que passa por `center` (`angle` em radianos,
 * positivo no sentido anti-horário visto de cima). O giro é rígido: comprimentos, ângulos
 * das peças e ligações internas ao conjunto se preservam, e a cota de cada ponto não muda
 * (só o eixo vertical: girar em torno de um eixo horizontal tombaria equipamentos e prumadas).
 * Uma ligação com elemento de fora do conjunto que deixe de ficar alinhada recusa a operação
 * — para levar a rede junto, inclua o conjunto conectado (`connectedComponent`).
 */
export function rotateElements(
  project: Project,
  ids: readonly string[],
  center: Vec3,
  angle: number,
): Result<Project> {
  if (!isFiniteVec(center)) return fail('INVALID_POINT', 'Centro de giro inválido.');
  if (!Number.isFinite(angle)) return fail('INVALID_ANGLE', 'Ângulo inválido.');
  if (ids.length === 0) return fail('ELEMENT_NOT_FOUND', 'Nenhum elemento a girar.');
  const turns = angle / (2 * Math.PI);
  if (Math.abs(turns - Math.round(turns)) < 1e-12) return ok(project);
  const q = quatFromAxisAngle(AXIS_Z, angle);
  let next = project;
  for (const id of ids) {
    const element = getElement(next, id);
    if (!element) return fail('ELEMENT_NOT_FOUND', 'Elemento inexistente.');
    next = putElement(next, touch(rotatedAbout(element, center, q)));
  }
  return keepOutsideCoupling(
    next,
    ids,
    'ROTATION_BREAKS_COUPLING',
    'não gira junto: gire levando a rede ligada ou desconecte antes',
  );
}

/**
 * Num movimento rígido não há tubo que estique: toda ligação com elemento de fora do conjunto
 * precisa continuar acoplada, senão a operação é recusada com `code`.
 */
function keepOutsideCoupling(
  next: Project,
  ids: readonly string[],
  code: string,
  reason: string,
): Result<Project> {
  const inside = new Set(ids);
  for (const connection of next.connections) {
    const aIn = inside.has(connection.a.elementId);
    if (aIn === inside.has(connection.b.elementId)) continue;
    const pa = resolvePort(next, connection.a);
    const pb = resolvePort(next, connection.b);
    if (!pa || !pb || arePortsAligned(pa, pb)) continue;
    const own = getElement(next, aIn ? connection.a.elementId : connection.b.elementId);
    const other = getElement(next, aIn ? connection.b.elementId : connection.a.elementId);
    return fail(
      code,
      `"${own?.name ?? '?'}" está ligado a "${other?.name ?? '?'}", que ${reason}.`,
    );
  }
  return ok(next);
}

/**
 * Alinhamento por dois pares de pontos (como o ALIGN do AutoCAD): o ponto de origem 1 vai ao
 * destino 1 e o conjunto gira em torno dele até a direção origem 1 → origem 2 coincidir, em
 * planta, com a direção destino 1 → destino 2. Sem o segundo par, é só o deslocamento.
 */
export interface AlignPoints {
  readonly source1: Vec3;
  readonly target1: Vec3;
  readonly source2?: Vec3 | null;
  readonly target2?: Vec3 | null;
}

/**
 * Giro (radianos, anti-horário visto de cima) que leva a direção origem 1 → origem 2 à
 * direção destino 1 → destino 2, medido em planta. `0` sem o segundo par; `null` quando um
 * dos pares não define direção horizontal (pontos na mesma vertical).
 */
export function alignmentAngle(points: AlignPoints): number | null {
  const { source1, target1, source2, target2 } = points;
  if (!source2 || !target2) return 0;
  const sx = source2.x - source1.x;
  const sy = source2.y - source1.y;
  const tx = target2.x - target1.x;
  const ty = target2.y - target1.y;
  if (Math.hypot(sx, sy) < 1e-6 || Math.hypot(tx, ty) < 1e-6) return null;
  let angle = Math.atan2(ty, tx) - Math.atan2(sy, sx);
  while (angle <= -Math.PI) angle += 2 * Math.PI;
  while (angle > Math.PI) angle -= 2 * Math.PI;
  return Math.abs(angle) < 1e-9 ? 0 : angle;
}

function alignmentOf(points: AlignPoints): Result<{ readonly q: Quat; readonly angle: number }> {
  const all = [points.source1, points.target1, points.source2, points.target2];
  if (!all.every((p) => p === null || p === undefined || isFiniteVec(p))) {
    return fail('INVALID_POINT', 'Ponto de alinhamento inválido.');
  }
  const angle = alignmentAngle(points);
  if (angle === null) {
    return fail(
      'ALIGN_DIRECTION_UNDEFINED',
      'Os dois pontos de um par estão na mesma vertical: indique pontos afastados em planta para definir a direção.',
    );
  }
  return ok({ q: quatFromAxisAngle(AXIS_Z, angle), angle });
}

/**
 * Alinha elementos por dois pares de pontos (`AlignPoints`). O movimento é rígido e o giro só
 * em torno do eixo vertical — como em `rotateElements`, girar em torno de eixo horizontal
 * tombaria equipamentos e prumadas; a cota do segundo par só não entra no giro. Não há escala:
 * tubos e peças têm dimensões de catálogo. Sem giro, equivale a `translateElements` (tubos
 * ligados se ajustam quando o acoplamento permite); com giro, uma ligação com elemento de fora
 * do conjunto que deixe de ficar alinhada recusa a operação.
 */
export function alignElements(
  project: Project,
  ids: readonly string[],
  points: AlignPoints,
): Result<Project> {
  if (ids.length === 0) return fail('ELEMENT_NOT_FOUND', 'Nenhum elemento a alinhar.');
  const alignment = alignmentOf(points);
  if (!alignment.ok) return alignment;
  const { q, angle } = alignment.value;
  if (angle === 0) {
    const delta = sub(points.target1, points.source1);
    if (Math.hypot(delta.x, delta.y, delta.z) < 1e-12) return ok(project);
    return translateElements(project, ids, delta);
  }
  let next = project;
  for (const id of ids) {
    const element = getElement(next, id);
    if (!element) return fail('ELEMENT_NOT_FOUND', 'Elemento inexistente.');
    next = putElement(next, touch(rigidlyMoved(element, points.source1, points.target1, q)));
  }
  return keepOutsideCoupling(
    next,
    ids,
    'ALIGN_BREAKS_COUPLING',
    'não é alinhado junto: alinhe levando a rede ligada ou desconecte antes',
  );
}

/**
 * Copia elementos alinhados por dois pares de pontos (como `alignElements`, mas os originais
 * ficam onde estão). As cópias mantêm as ligações internas ao conjunto e conectam-se só a
 * portas livres exatamente acopladas.
 */
export function copyAlignedElements(
  project: Project,
  ids: readonly string[],
  points: AlignPoints,
): Result<Created> {
  const alignment = alignmentOf(points);
  if (!alignment.ok) return alignment;
  const { q } = alignment.value;
  return copyTransformed(project, ids, (element) =>
    rigidlyMoved(element, points.source1, points.target1, q),
  );
}

/**
 * Elevação (cota Z, em metros) de referência do elemento: o eixo no início do tubo ou a
 * origem da conexão/equipamento (no reservatório, a base).
 */
export function elementElevation(element: HydroElement): number {
  return element.kind === 'pipe' ? element.start.z : element.placement.position.z;
}

/**
 * Define a elevação do elemento (ver `elementElevation`).
 *  - Tubo ou conexão: todos os elementos conectados sobem ou descem junto, rigidamente,
 *    preservando declividades, prumadas e acoplamentos.
 *  - Equipamento (bomba, reservatório): só ele é deslocado; os tubos vizinhos se ajustam
 *    quando o acoplamento permite (ex.: prumada sob o bocal), senão a operação é recusada.
 */
export function setElementElevation(
  project: Project,
  id: string,
  elevation: number,
): Result<Project> {
  const element = getElement(project, id);
  if (!element) return fail('ELEMENT_NOT_FOUND', 'Elemento inexistente.');
  if (!Number.isFinite(elevation)) return fail('INVALID_VALUE', 'Elevação inválida.');
  const dz = elevation - elementElevation(element);
  if (Math.abs(dz) < 1e-9) return ok(project);
  const ids =
    element.kind === 'pump' || element.kind === 'tank' ? [id] : connectedComponent(project, id);
  return translateElements(project, ids, { x: 0, y: 0, z: dz });
}

/**
 * Copia elementos com um deslocamento. As cópias recebem novos identificadores, mantêm as
 * conexões internas ao conjunto e conectam-se a portas livres exatamente acopladas.
 */
export function copyElements(
  project: Project,
  ids: readonly string[],
  delta: Vec3,
): Result<Created> {
  if (!isFiniteVec(delta)) return fail('INVALID_POINT', 'Deslocamento inválido.');
  return copyTransformed(project, ids, (element) => translated(element, delta));
}

/**
 * Copia elementos girados em torno do eixo vertical por `center` (como `rotateElements`, mas
 * os originais ficam onde estão). As cópias mantêm as ligações internas ao conjunto e
 * conectam-se só a portas livres exatamente acopladas.
 */
export function copyRotatedElements(
  project: Project,
  ids: readonly string[],
  center: Vec3,
  angle: number,
): Result<Created> {
  if (!isFiniteVec(center)) return fail('INVALID_POINT', 'Centro de giro inválido.');
  if (!Number.isFinite(angle)) return fail('INVALID_ANGLE', 'Ângulo inválido.');
  const q = quatFromAxisAngle(AXIS_Z, angle);
  return copyTransformed(project, ids, (element) => rotatedAbout(element, center, q));
}

function copyTransformed(
  project: Project,
  ids: readonly string[],
  transform: (element: HydroElement) => HydroElement,
): Result<Created> {
  if (ids.length === 0) return fail('ELEMENT_NOT_FOUND', 'Nenhum elemento selecionado.');
  const mapping = new Map<string, string>();
  let next = project;
  for (const id of ids) {
    const element = getElement(project, id);
    if (!element) return fail('ELEMENT_NOT_FOUND', 'Elemento inexistente.');
    const timestamp = now();
    const copy: HydroElement = {
      ...transform(element),
      id: newId(),
      name: nextName(next, element.kind),
      meta: { createdAt: timestamp, updatedAt: timestamp, revision: 0 },
    };
    mapping.set(id, copy.id);
    next = putElement(next, copy);
  }
  const internal = project.connections.flatMap((c) => {
    const a = mapping.get(c.a.elementId);
    const b = mapping.get(c.b.elementId);
    return a && b
      ? [
          {
            id: newId(),
            a: { elementId: a, portId: c.a.portId },
            b: { elementId: b, portId: c.b.portId },
          },
        ]
      : [];
  });
  next = { ...next, connections: [...next.connections, ...internal] };
  const createdIds = [...mapping.values()];
  for (const id of createdIds) next = autoConnectElement(next, id);
  const first = createdIds[0];
  if (!first) return fail('ELEMENT_NOT_FOUND', 'Nenhum elemento selecionado.');
  return ok({ project: next, elementId: first, createdIds });
}

// ---------------------------------------------------------------------------
// Edição geral
// ---------------------------------------------------------------------------

export function renameElement(project: Project, id: string, name: string): Result<Project> {
  const element = getElement(project, id);
  if (!element) return fail('ELEMENT_NOT_FOUND', 'Elemento inexistente.');
  const trimmed = name.trim();
  if (trimmed.length === 0) return fail('INVALID_NAME', 'O nome não pode ser vazio.');
  return ok(putElement(project, touch({ ...element, name: trimmed })));
}

export function setElementProperty(
  project: Project,
  id: string,
  key: string,
  value: PropertyValue | undefined,
): Result<Project> {
  const element = getElement(project, id);
  if (!element) return fail('ELEMENT_NOT_FOUND', 'Elemento inexistente.');
  const name = key.trim();
  if (name.length === 0) return fail('INVALID_NAME', 'O nome da propriedade não pode ser vazio.');
  const properties = Object.fromEntries(
    Object.entries(element.properties).filter(([existing]) => existing !== name),
  );
  if (value !== undefined) properties[name] = value;
  return ok(putElement(project, touch({ ...element, properties })));
}

/**
 * Guarda (ou remove, com `undefined`) um valor IFC informado pelo usuário para a ocorrência.
 * A chave é `Conjunto.Propriedade`; a validade do valor frente ao esquema IFC é conferida
 * por `@hydrobim/ifc` (`setIfcValue`), que é quem chama esta operação.
 */
export function setElementIfcValue(
  project: Project,
  id: string,
  key: string,
  value: PropertyValue | undefined,
): Result<Project> {
  const element = getElement(project, id);
  if (!element) return fail('ELEMENT_NOT_FOUND', 'Elemento inexistente.');
  if (key.trim().length === 0)
    return fail('INVALID_NAME', 'O nome da propriedade não pode ser vazio.');
  const values = Object.fromEntries(
    Object.entries(element.ifc ?? {}).filter(([existing]) => existing !== key),
  );
  if (value !== undefined) values[key] = value;
  const { ifc: _previous, ...rest } = element;
  return ok(
    putElement(
      project,
      touch((Object.keys(values).length ? { ...rest, ifc: values } : rest) as HydroElement),
    ),
  );
}

/**
 * Guarda (ou remove, com `undefined`) um valor IFC informado pelo usuário para um TIPO: vale
 * para todas as ocorrências com a mesma chave de tipo, inclusive as criadas depois.
 */
export function setIfcTypeValue(
  project: Project,
  typeKey: string,
  key: string,
  value: PropertyValue | undefined,
): Result<Project> {
  if (typeKey.trim().length === 0 || key.trim().length === 0)
    return fail('INVALID_NAME', 'O tipo e o nome da propriedade não podem ser vazios.');
  const values = Object.fromEntries(
    Object.entries(project.ifcTypes[typeKey] ?? {}).filter(([existing]) => existing !== key),
  );
  if (value !== undefined) values[key] = value;
  const ifcTypes = Object.fromEntries(
    Object.entries(project.ifcTypes).filter(([existing]) => existing !== typeKey),
  );
  if (Object.keys(values).length) ifcTypes[typeKey] = values;
  return ok({ ...project, updatedAt: now(), ifcTypes });
}

/** Exclui elementos e todas as conexões que os referenciam. */
export function deleteElements(project: Project, ids: readonly string[]): Project {
  const remove = new Set(ids);
  return {
    ...project,
    updatedAt: now(),
    elements: project.elements.filter((e) => !remove.has(e.id)),
    connections: project.connections.filter(
      (c) => !remove.has(c.a.elementId) && !remove.has(c.b.elementId),
    ),
    // Etiquetas não sobrevivem ao elemento que descrevem.
    annotations: project.annotations.filter((a) => a.kind !== 'tag' || !remove.has(a.elementId)),
  };
}
