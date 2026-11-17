import {
  arePortsAligned,
  autoConnectElement,
  connectPorts,
  connectionsOfElement,
  findConnection,
  getElement,
  isPortFree,
  oppositeRef,
  resolvePort,
} from './connectivity';
import {
  ANGLE_TOLERANCE,
  defaultBendRadius,
  defaultReducerLength,
  defaultTeeDimensions,
  defaultValveLength,
  elbowLegLength,
  MAX_ELBOW_ANGLE,
  MIN_ELBOW_ANGLE,
  MIN_PIPE_LENGTH,
} from './dimensions';
import { newId } from './ids';
import {
  add,
  angleBetween,
  cross,
  distance,
  dot,
  frameFromDirection,
  isFiniteVec,
  normalize,
  QUAT_IDENTITY,
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
import { getPort, getPorts, pipeLength } from './ports';
import { fail, ok, type Result } from './result';
import {
  PROJECT_FORMAT,
  SCHEMA_VERSION,
  type Discipline,
  type Elbow,
  type ElementKind,
  type Fitting,
  type HydraulicSystem,
  type HydroElement,
  type Pipe,
  type PipeSpec,
  type PortRef,
  type Project,
  type PropertyValue,
  type Reducer,
  type Tee,
  type Valve,
  type ValveType,
} from './schema';
import { degToRad } from './units';

/**
 * Operações paramétricas sobre o projeto. Todas são funções puras: recebem um projeto
 * imutável e retornam um novo projeto (ou um erro de domínio), o que torna desfazer/
 * refazer e testes triviais.
 */

const now = (): string => new Date().toISOString();

const KIND_LABEL: Record<ElementKind, string> = {
  pipe: 'Tubo',
  elbow: 'Joelho',
  tee: 'Tê',
  reducer: 'Redução',
  valve: 'Válvula',
};

export const elementKindLabel = (kind: ElementKind): string => KIND_LABEL[kind];

function nextName(project: Project, kind: ElementKind): string {
  const prefix = `${KIND_LABEL[kind]} `;
  let max = 0;
  for (const e of project.elements) {
    if (e.kind !== kind || !e.name.startsWith(prefix)) continue;
    const n = Number.parseInt(e.name.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${max + 1}`;
}

function touch<T extends HydroElement>(element: T): T {
  return {
    ...element,
    meta: { ...element.meta, updatedAt: now(), revision: element.meta.revision + 1 },
  };
}

function putElement(project: Project, element: HydroElement): Project {
  const exists = project.elements.some((e) => e.id === element.id);
  return {
    ...project,
    updatedAt: now(),
    elements: exists
      ? project.elements.map((e) => (e.id === element.id ? element : e))
      : [...project.elements, element],
  };
}

function baseFields(project: Project, kind: ElementKind, spec: PipeSpec, systemId: string) {
  const timestamp = now();
  return {
    id: newId(),
    name: nextName(project, kind),
    systemId,
    spec,
    properties: {},
    manufacturing: {},
    meta: { createdAt: timestamp, updatedAt: timestamp, revision: 0 },
  };
}

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
// Reconciliação topológica
// ---------------------------------------------------------------------------

function translateFitting<T extends Fitting>(fitting: T, delta: Vec3): T {
  return {
    ...fitting,
    placement: { ...fitting.placement, position: add(fitting.placement.position, delta) },
  };
}

function setPipeEnd(pipe: Pipe, portId: string, point: Vec3): Pipe {
  return portId === 'start' ? { ...pipe, start: point } : { ...pipe, end: point };
}

/**
 * Restabelece o acoplamento geométrico das conexões após a alteração dos elementos
 * `rootIds` (mudança de dimensões, translação etc.):
 *  - tubos vizinhos absorvem a diferença, ajustando a extremidade conectada;
 *  - conexões vizinhas são transladadas rigidamente, propagando o ajuste.
 * Falha (sem alterar nada) quando o acoplamento não puder ser preservado.
 */
export function reconcile(project: Project, rootIds: readonly string[]): Result<Project> {
  let current = project;
  const affected = new Set<string>(rootIds);
  const processed = new Set<string>();
  const fixedFittings = new Set<string>();
  // Conexões primeiro: elas definem as posições; os tubos se ajustam a elas.
  const queue = [...rootIds].sort((a, b) => {
    const ka = getElement(project, a)?.kind === 'pipe' ? 1 : 0;
    const kb = getElement(project, b)?.kind === 'pipe' ? 1 : 0;
    return ka - kb;
  });

  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined || processed.has(id)) continue;
    processed.add(id);
    const element = getElement(current, id);
    if (!element) continue;
    if (element.kind !== 'pipe') fixedFittings.add(id);

    for (const port of getPorts(element)) {
      const connection = findConnection(current, port.ref);
      if (!connection) continue;
      const otherRef = oppositeRef(connection, port.ref);
      const other = getElement(current, otherRef.elementId);
      const otherPort = other ? getPort(other, otherRef.portId) : undefined;
      if (!other || !otherPort) continue;
      if (arePortsAligned(port, otherPort)) continue;
      affected.add(other.id);

      if (other.kind === 'pipe') {
        current = putElement(current, touch(setPipeEnd(other, otherRef.portId, port.position)));
      } else if (element.kind === 'pipe') {
        // O tubo sempre se ajusta à conexão, nunca o contrário.
        const live = getElement(current, id);
        if (live?.kind === 'pipe') {
          current = putElement(
            current,
            touch(setPipeEnd(live, port.ref.portId, otherPort.position)),
          );
        }
      } else {
        if (fixedFittings.has(other.id)) {
          return fail(
            'OVERCONSTRAINED',
            `Não foi possível ajustar "${other.name}": o conjunto de conexões está rigidamente restringido.`,
          );
        }
        const delta = sub(port.position, otherPort.position);
        current = putElement(current, touch(translateFitting(other, delta)));
        queue.push(other.id);
      }
    }
  }

  return verifyCoupling(current, [...affected]);
}

/** Confere que todas as conexões dos elementos indicados permanecem acopladas. */
function verifyCoupling(project: Project, elementIds: readonly string[]): Result<Project> {
  for (const id of elementIds) {
    const element = getElement(project, id);
    if (!element) continue;
    if (element.kind === 'pipe' && pipeLength(element) < MIN_PIPE_LENGTH) {
      return fail(
        'PIPE_TOO_SHORT',
        `A alteração deixaria "${element.name}" sem comprimento suficiente.`,
      );
    }
    for (const connection of connectionsOfElement(project, id)) {
      const pa = resolvePort(project, connection.a);
      const pb = resolvePort(project, connection.b);
      if (!pa || !pb) continue;
      if (!arePortsAligned(pa, pb)) {
        const other = getElement(
          project,
          connection.a.elementId === id ? connection.b.elementId : connection.a.elementId,
        );
        return fail(
          'COUPLING_BROKEN',
          `A alteração romperia o alinhamento entre "${element.name}" e "${other?.name ?? '?'}". Desconecte os elementos antes de alterar.`,
        );
      }
    }
  }
  return ok(project);
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

  const bendRadius = defaultBendRadius(spec);
  const leg = elbowLegLength(deflection, bendRadius);
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
    placement: { position: corner, rotation: quatFromBasis(bx, by, bz) },
    angle: deflection,
    bendRadius,
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
// Conexões (joelho, tê, redução, válvula)
// ---------------------------------------------------------------------------

export type FittingInput =
  | { kind: 'elbow'; angle?: number; bendRadius?: number }
  | { kind: 'tee' }
  | { kind: 'valve'; valveType?: ValveType }
  | { kind: 'reducer'; outletSpec: PipeSpec };

function buildFitting(
  project: Project,
  input: FittingInput,
  spec: PipeSpec,
  systemId: string,
): Result<Fitting> {
  const placement = { position: ZERO, rotation: QUAT_IDENTITY };
  switch (input.kind) {
    case 'elbow': {
      const angle = input.angle ?? degToRad(90);
      const bendRadius = input.bendRadius ?? defaultBendRadius(spec);
      const check = validateElbow(angle, bendRadius);
      if (!check.ok) return check;
      const elbow: Elbow = {
        ...baseFields(project, 'elbow', spec, systemId),
        kind: 'elbow',
        placement,
        angle,
        bendRadius,
      };
      return ok(elbow);
    }
    case 'tee': {
      const tee: Tee = {
        ...baseFields(project, 'tee', spec, systemId),
        kind: 'tee',
        placement,
        ...defaultTeeDimensions(spec),
      };
      return ok(tee);
    }
    case 'valve': {
      const valve: Valve = {
        ...baseFields(project, 'valve', spec, systemId),
        kind: 'valve',
        placement,
        valveType: input.valveType ?? 'gate',
        length: defaultValveLength(spec),
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
      const reducer: Reducer = {
        ...baseFields(project, 'reducer', spec, systemId),
        kind: 'reducer',
        placement,
        outletSpec: input.outletSpec,
        length: defaultReducerLength(spec, input.outletSpec),
      };
      return ok(reducer);
    }
  }
}

function validateElbow(angle: number, bendRadius: number): Result<true> {
  if (!Number.isFinite(angle) || angle < MIN_ELBOW_ANGLE || angle > MAX_ELBOW_ANGLE) {
    return fail('INVALID_ANGLE', 'O ângulo do joelho deve estar entre 1° e 135°.');
  }
  if (!Number.isFinite(bendRadius) || bendRadius <= 0) {
    return fail('INVALID_RADIUS', 'Raio de curvatura inválido.');
  }
  return ok(true);
}

/** Posiciona a conexão de modo que sua porta `a` acople em (`position`, `direction`). */
function placeAtPort<T extends Fitting>(fitting: T, position: Vec3, flow: Vec3, roll: number): T {
  let rotation = frameFromDirection(flow);
  if (roll !== 0) rotation = quatNormalize(quatMultiply(quatFromAxisAngle(flow, roll), rotation));
  const oriented = { ...fitting, placement: { position: ZERO, rotation } };
  const portA = getPort(oriented, 'a');
  if (!portA) return oriented;
  return { ...oriented, placement: { position: sub(position, portA.position), rotation } };
}

export interface AttachFittingInput {
  /** Porta livre que receberá a conexão. */
  target: PortRef;
  fitting: FittingInput;
  /** Giro (rad) em torno do eixo da porta, a partir da orientação padrão. */
  roll?: number;
}

/** Insere uma conexão acoplada a uma porta livre (extremidade de tubo ou de outra conexão). */
export function attachFitting(project: Project, input: AttachFittingInput): Result<Created> {
  const port = resolvePort(project, input.target);
  const host = getElement(project, input.target.elementId);
  if (!port || !host) return fail('PORT_NOT_FOUND', 'Porta de conexão inexistente.');
  if (!isPortFree(project, port.ref)) return fail('PORT_OCCUPIED', 'A porta já está conectada.');

  const built = buildFitting(project, input.fitting, port.spec, host.systemId);
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

export interface InsertInlineInput {
  pipeId: string;
  /** Posição do centro da conexão, medida a partir do início do tubo (m). */
  distanceFromStart: number;
  fitting: { kind: 'tee' } | { kind: 'valve'; valveType?: ValveType };
  roll?: number;
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
  const built = buildFitting(project, input.fitting, pipe.spec, pipe.systemId);
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
  const secondBase = baseFields(project, 'pipe', pipe.spec, pipe.systemId);
  const second: Pipe = {
    ...secondBase,
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

export type FittingPatch = {
  angle?: number;
  bendRadius?: number;
  runLength?: number;
  branchLength?: number;
  length?: number;
  valveType?: ValveType;
};

const isPositive = (v: number | undefined): v is number =>
  v !== undefined && Number.isFinite(v) && v > 0;

/** Altera parâmetros de uma conexão e reajusta os elementos vizinhos. */
export function updateFitting(project: Project, id: string, patch: FittingPatch): Result<Project> {
  const element = getElement(project, id);
  if (!element || element.kind === 'pipe')
    return fail('NOT_A_FITTING', 'Elemento não é uma conexão.');
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key !== 'valveType' && !isPositive(value as number | undefined)) {
      return fail('INVALID_VALUE', 'Valor inválido: informe um número positivo.');
    }
  }
  let updated: Fitting;
  switch (element.kind) {
    case 'elbow': {
      const angle = patch.angle ?? element.angle;
      const bendRadius = patch.bendRadius ?? element.bendRadius;
      const check = validateElbow(angle, bendRadius);
      if (!check.ok) return check;
      updated = { ...element, angle, bendRadius };
      break;
    }
    case 'tee':
      updated = {
        ...element,
        runLength: patch.runLength ?? element.runLength,
        branchLength: patch.branchLength ?? element.branchLength,
      };
      break;
    case 'reducer':
      updated = { ...element, length: patch.length ?? element.length };
      break;
    case 'valve':
      updated = {
        ...element,
        length: patch.length ?? element.length,
        valveType: patch.valveType ?? element.valveType,
      };
      break;
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
  if (!element || element.kind === 'pipe')
    return fail('NOT_A_FITTING', 'Elemento não é uma conexão.');
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
  const next = putElement(project, rotated);
  // Não se usa `reconcile`: um giro não pode ser absorvido esticando tubos.
  return verifyCoupling(next, [id]);
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
    next = putElement(
      next,
      touch(
        element.kind === 'pipe'
          ? { ...element, start: add(element.start, delta), end: add(element.end, delta) }
          : translateFitting(element, delta),
      ),
    );
  }
  return reconcile(next, ids);
}

// ---------------------------------------------------------------------------
// Especificação (material / diâmetro)
// ---------------------------------------------------------------------------

function withSpec(element: HydroElement, spec: PipeSpec, portId: string | null): HydroElement {
  switch (element.kind) {
    case 'pipe':
      return { ...element, spec };
    case 'elbow':
      return { ...element, spec, bendRadius: defaultBendRadius(spec) };
    case 'tee':
      return { ...element, spec, ...defaultTeeDimensions(spec) };
    case 'valve':
      return { ...element, spec, length: defaultValveLength(spec) };
    case 'reducer': {
      const next = portId === 'b' ? { ...element, outletSpec: spec } : { ...element, spec };
      return { ...next, length: defaultReducerLength(next.spec, next.outletSpec) };
    }
  }
}

export interface ApplySpecOptions {
  /** Propaga a especificação pelo trecho conectado, parando nas reduções. */
  propagate?: boolean;
  /** Para reduções: qual extremidade recebe a especificação (`a` por padrão). */
  portId?: 'a' | 'b';
}

/**
 * Altera material/diâmetro de um elemento. As dimensões das conexões são recalculadas
 * e os vizinhos reajustados. Com `propagate`, a alteração percorre o trecho conectado
 * até encontrar reduções (que têm apenas a extremidade correspondente atualizada).
 */
export function applySpec(
  project: Project,
  elementId: string,
  spec: PipeSpec,
  options: ApplySpecOptions = {},
): Result<Project> {
  if (!getElement(project, elementId)) return fail('ELEMENT_NOT_FOUND', 'Elemento inexistente.');
  let next = project;
  const changed: string[] = [];
  const visited = new Set<string>();
  const queue: { id: string; via: string | null }[] = [
    { id: elementId, via: options.portId ?? null },
  ];

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || visited.has(item.id)) continue;
    visited.add(item.id);
    const element = getElement(next, item.id);
    if (!element) continue;
    const isOrigin = item.id === elementId;
    const side = element.kind === 'reducer' ? (item.via === 'b' ? 'b' : 'a') : null;
    next = putElement(next, touch(withSpec(element, spec, side)));
    changed.push(item.id);
    if (!options.propagate) continue;

    for (const port of getPorts(element)) {
      // Reduções delimitam o trecho: só se atravessa a extremidade alterada da origem.
      if (element.kind === 'reducer' && (!isOrigin || port.ref.portId !== side)) continue;
      const connection = findConnection(next, port.ref);
      if (!connection) continue;
      const other = oppositeRef(connection, port.ref);
      queue.push({ id: other.elementId, via: other.portId });
    }
  }
  return reconcile(next, changed);
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
