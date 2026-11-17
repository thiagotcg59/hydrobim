import {
  autoConnectElement,
  connectPorts,
  getElement,
  isPortFree,
  resolvePort,
} from './connectivity';
import {
  ANGLE_TOLERANCE,
  elbowLegLength,
  MAX_ELBOW_ANGLE,
  MIN_ELBOW_ANGLE,
  MIN_PIPE_LENGTH,
} from './dimensions';
import { GENERIC_CATALOG, type FittingCatalog } from './families';
import { newId } from './ids';
import { baseFields, elementKindLabel, nextName, now, putElement, touch } from './internal';
import {
  add,
  angleBetween,
  AXIS_Z,
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
  type Vec3,
} from './math';
import { getPort, pipeLength } from './ports';
import { reconcile, setPipeEnd, translateFitting, verifyCoupling } from './reconcile';
import { fail, ok, type Result } from './result';
import {
  PROJECT_FORMAT,
  SCHEMA_VERSION,
  type Discipline,
  type Elbow,
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
  type Reducer,
  type Tank,
  type Tee,
  type Valve,
  type ValveType,
} from './schema';
import { degToRad } from './units';

export { elementKindLabel };

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
    georeference: null,
    terrain: null,
    elements: [],
    connections: [],
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
  return ok({
    ...base,
    name: input.name ?? base.name,
    kind: 'pipe',
    start: input.start,
    end: input.end,
  });
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

  if (deflection <= ANGLE_TOLERANCE) {
    return addPipe(project, { start: corner, end: input.end, spec, systemId, name: input.name });
  }
  if (host.kind !== 'pipe') {
    return fail(
      'OFF_AXIS',
      'A partir de uma conexão, o tubo deve seguir o eixo da porta. Insira um joelho para mudar de direção.',
    );
  }
  if (deflection > MAX_ELBOW_ANGLE) {
    return fail(
      'ANGLE_TOO_SHARP',
      'Mudança de direção muito fechada para um joelho (máximo de 135° de deflexão).',
    );
  }

  const dims = (input.catalog ?? GENERIC_CATALOG).elbow(spec, deflection);
  const leg = elbowLegLength(deflection, dims.bendRadius);
  if (pipeLength(host) < leg + MIN_PIPE_LENGTH) {
    return fail('PIPE_TOO_SHORT', `"${host.name}" é curto demais para receber o joelho.`);
  }
  if (distance(input.end, corner) < leg + MIN_PIPE_LENGTH) {
    return fail('PIPE_TOO_SHORT', 'O novo trecho é curto demais para o joelho necessário.');
  }

  // Apara o tubo existente e posiciona o joelho com o vértice no ponto original.
  const trimmed = touch(setPipeEnd(host, port.ref.portId, sub(corner, scale(port.direction, leg))));
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
  };
  let next = putElement(putElement(project, trimmed), elbow);
  const pipe = buildPipe(
    next,
    { start: add(corner, scale(direction, leg)), end: input.end, spec, name: input.name },
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

// ---------------------------------------------------------------------------
// Conexões e equipamentos
// ---------------------------------------------------------------------------

export type FittingInput =
  | { kind: 'elbow'; angle?: number; bendRadius?: number; familyId?: string | null }
  | { kind: 'tee'; branchSpec?: PipeSpec; familyId?: string | null }
  | { kind: 'valve'; valveType?: ValveType; familyId?: string | null }
  | { kind: 'reducer'; outletSpec: PipeSpec; familyId?: string | null }
  | { kind: 'pump'; dischargeSpec?: PipeSpec }
  | { kind: 'tank'; diameter?: number; height?: number };

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
): Result<Fitting> {
  const placement = { position: ZERO, rotation: QUAT_IDENTITY };
  const base = baseFields(project, input.kind, spec, systemId);
  switch (input.kind) {
    case 'elbow': {
      const angle = input.angle ?? degToRad(90);
      const dims = catalog.elbow(spec, angle, input.familyId);
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
      };
      return ok(elbow);
    }
    case 'tee': {
      const branchSpec = input.branchSpec ?? spec;
      if (branchSpec.specificationId !== spec.specificationId) {
        return fail(
          'SPEC_MISMATCH',
          'A derivação do tê deve ter a mesma especificação da passagem.',
        );
      }
      if (branchSpec.dn > spec.dn) {
        return fail('INVALID_BRANCH', 'A derivação do tê não pode ser maior que a passagem.');
      }
      const dims = catalog.tee(spec, branchSpec, input.familyId);
      const tee: Tee = {
        ...base,
        kind: 'tee',
        placement,
        familyId: dims.familyId,
        ends: dims.ends,
        runLength: dims.runLength,
        branchLength: dims.branchLength,
        ...(branchSpec.dn !== spec.dn ? { branchSpec } : {}),
      };
      return ok(tee);
    }
    case 'valve': {
      const valveType = input.valveType ?? 'gate';
      const dims = catalog.valve(spec, valveType, input.familyId);
      const valve: Valve = {
        ...base,
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
      const dims = catalog.reducer(spec, input.outletSpec, input.familyId);
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

  const built = buildFitting(project, input.fitting, port.spec, host.systemId, input.catalog);
  if (!built.ok) return built;
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
    | { kind: 'valve'; valveType?: ValveType; familyId?: string | null };
  roll?: number;
  catalog?: FittingCatalog;
}

/**
 * Insere uma conexão em linha (tê ou válvula) dividindo o tubo em dois trechos.
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
  const built = buildFitting(project, input.fitting, pipe.spec, pipe.systemId, input.catalog);
  if (!built.ok) return built;
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
  const first = touch({ ...pipe, end: sub(center, scale(direction, half)) });
  const second: Pipe = {
    ...baseFields(project, 'pipe', pipe.spec, pipe.systemId),
    kind: 'pipe',
    properties: { ...pipe.properties },
    manufacturing: { ...pipe.manufacturing },
    start: add(center, scale(direction, half)),
    end: pipe.end,
  };

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

/** Parâmetros numéricos editáveis por tipo de elemento. */
const EDITABLE: Record<FittingKind, readonly string[]> = {
  elbow: ['angle', 'bendRadius'],
  tee: ['runLength', 'branchLength'],
  reducer: ['length'],
  valve: ['length', 'height', 'handwheelDiameter', 'width'],
  pump: ['length', 'dischargeOffset', 'dischargeHeight', 'ratedFlow', 'ratedHead'],
  tank: ['diameter', 'height', 'outletHeight', 'inletHeight', 'nozzleLength'],
};
/** Parâmetros que podem ser zero. */
const ALLOW_ZERO = new Set(['outletHeight', 'inletHeight']);
/** Parâmetros que não alteram a geometria (não desvinculam o elemento da família). */
const NON_GEOMETRIC = new Set(['ratedFlow', 'ratedHead']);

export type FittingPatch = {
  angle?: number;
  bendRadius?: number;
  runLength?: number;
  branchLength?: number;
  length?: number;
  height?: number;
  handwheelDiameter?: number;
  width?: number;
  dischargeOffset?: number;
  dischargeHeight?: number;
  ratedFlow?: number;
  ratedHead?: number;
  diameter?: number;
  outletHeight?: number;
  inletHeight?: number;
  nozzleLength?: number;
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
    if (!EDITABLE[element.kind].includes(key)) {
      return fail('INVALID_FIELD', `O parâmetro "${key}" não se aplica a este elemento.`);
    }
    const number = value as number;
    const valid = Number.isFinite(number) && (ALLOW_ZERO.has(key) ? number >= 0 : number > 0);
    if (!valid) return fail('INVALID_VALUE', 'Valor inválido: informe um número positivo.');
    numeric[key] = number;
    if (!NON_GEOMETRIC.has(key)) geometric = true;
  }

  let updated = { ...element, ...numeric } as Fitting;
  if (geometric) updated = { ...updated, familyId: null };
  if (updated.kind === 'elbow') {
    const check = validateElbow(updated.angle, updated.bendRadius);
    if (!check.ok) return check;
  }
  if (
    updated.kind === 'tank' &&
    Math.max(updated.outletHeight, updated.inletHeight) > updated.height
  ) {
    return fail('INVALID_VALUE', 'Os bocais devem ficar dentro da altura do reservatório.');
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
  if (ids.length === 0) return fail('ELEMENT_NOT_FOUND', 'Nenhum elemento selecionado.');
  const mapping = new Map<string, string>();
  let next = project;
  for (const id of ids) {
    const element = getElement(project, id);
    if (!element) return fail('ELEMENT_NOT_FOUND', 'Elemento inexistente.');
    const timestamp = now();
    const copy: HydroElement = {
      ...translated(element, delta),
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
  };
}
