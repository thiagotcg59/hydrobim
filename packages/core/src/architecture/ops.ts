import { newId } from '../ids';
import { now } from '../internal';
import { fail, ok, type Result } from '../result';
import {
  ArchElementSchema,
  ArchTypeSchema,
  type ArchElement,
  type ArchElementKind,
  type ArchType,
  type ArchWindow,
  type Architecture,
  type Door,
  type FloorElement,
  type Flooring,
  type HostedElement,
  type Point2,
  type Project,
  type PropertyValue,
  type Slab,
  type Space,
  type Wall,
  type WallLocationLine,
} from '../schema';
import { pointInRing, validatePolygon } from '../terrain/polygon';
import { ARCH_KIND_CATEGORY, ARCH_KIND_LABELS, archTypeUsage, hostWallOf } from './derive';
import { add2, distance2, sub2 } from './polygon2';
import {
  getArchElement,
  getArchType,
  hostedOf,
  hostedTypeOf,
  isHosted,
  MIN_WALL_LENGTH,
  offsetAlongWall,
  openingOf,
  openingProblem,
  wallLength,
} from './walls';

/**
 * Operações da arquitetura. Como as da rede, são funções puras `(Project, entrada) →
 * Result`: nunca mutam o projeto, nunca trocam o `id` de um elemento e, quando recusam,
 * nada é alterado — o projeto devolvido é sempre íntegro (vãos dentro das paredes
 * hospedeiras, contornos válidos, tipos e níveis existentes).
 */

export interface ArchCreated {
  readonly project: Project;
  readonly elementIds: string[];
}

const withArchitecture = (project: Project, architecture: Architecture): Project => ({
  ...project,
  updatedAt: now(),
  architecture,
});

const meta = (): ArchElement['meta'] => {
  const timestamp = now();
  return { createdAt: timestamp, updatedAt: timestamp, revision: 0 };
};

const touched = <T extends ArchElement>(element: T): T => ({
  ...element,
  meta: { ...element.meta, updatedAt: now(), revision: element.meta.revision + 1 },
});

function nextArchName(architecture: Architecture, kind: ArchElementKind): string {
  const prefix = `${ARCH_KIND_LABELS[kind]} `;
  let max = 0;
  for (const element of architecture.elements) {
    if (element.kind !== kind || !element.name.startsWith(prefix)) continue;
    const n = Number.parseInt(element.name.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${max + 1}`;
}

/**
 * Confere a integridade de toda a arquitetura depois de uma alteração: é o que garante que
 * uma operação impossível seja recusada por inteiro. Devolve o primeiro problema.
 */
export function archIntegrityProblem(
  project: Pick<Project, 'levels' | 'architecture'>,
): { code: string; message: string } | null {
  const { architecture, levels } = project;
  const levelIds = new Set(levels.map((level) => level.id));
  const typeIds = new Set<string>();
  for (const type of architecture.types) {
    if (typeIds.has(type.id)) {
      return { code: 'ARCH_DUPLICATE_TYPE', message: `Tipo duplicado: "${type.name}".` };
    }
    typeIds.add(type.id);
    if (!type.generic && type.source === null) {
      return {
        code: 'ARCH_SOURCE_REQUIRED',
        message: `"${type.name}" é produto de fabricante: informe a fonte (catálogo, edição, página e URL) ou marque o tipo como genérico.`,
      };
    }
  }
  const ids = new Set<string>();
  for (const element of architecture.elements) {
    if (ids.has(element.id)) {
      return { code: 'ARCH_DUPLICATE_ID', message: `Identificador duplicado (${element.id}).` };
    }
    ids.add(element.id);
    if (element.kind !== 'space') {
      const type = getArchType(architecture, element.typeId);
      if (!type) {
        return { code: 'ARCH_TYPE_NOT_FOUND', message: `"${element.name}" não tem tipo.` };
      }
      if (type.category !== ARCH_KIND_CATEGORY[element.kind]) {
        return {
          code: 'ARCH_TYPE_MISMATCH',
          message: `O tipo "${type.name}" não é de ${ARCH_KIND_LABELS[element.kind].toLowerCase()}.`,
        };
      }
    }
    if (!isHosted(element) && !levelIds.has(element.levelId)) {
      return {
        code: 'LEVEL_NOT_FOUND',
        message: `"${element.name}" referencia um nível inexistente.`,
      };
    }
    if (element.kind === 'wall' && wallLength(element) < MIN_WALL_LENGTH) {
      return {
        code: 'WALL_TOO_SHORT',
        message: `"${element.name}" ficaria sem comprimento (mínimo de ${MIN_WALL_LENGTH * 100} cm).`,
      };
    }
    if (element.kind === 'slab' || element.kind === 'flooring') {
      const polygon = validatePolygon([
        element.boundary,
        ...element.openings.map((opening) => opening.boundary),
      ]);
      if (!polygon.ok) {
        return {
          code: polygon.error.code,
          message: `"${element.name}": ${polygon.error.message.replaceAll('furo', 'abertura').replaceAll('O abertura', 'A abertura')}`,
        };
      }
    }
    if (element.kind === 'space') {
      const polygon = validatePolygon([element.boundary]);
      if (!polygon.ok) {
        return { code: polygon.error.code, message: `"${element.name}": ${polygon.error.message}` };
      }
    }
  }
  for (const element of architecture.elements) {
    if (!isHosted(element)) continue;
    const host = hostWallOf(architecture, element);
    if (!host) {
      return {
        code: 'HOST_NOT_FOUND',
        message: `"${element.name}" não tem parede hospedeira.`,
      };
    }
    const type = hostedTypeOf(architecture, element);
    if (!type) continue;
    const problem = openingProblem(architecture, host, openingOf(element, type));
    if (problem) return { code: 'OPENING_DOES_NOT_FIT', message: `"${element.name}": ${problem}.` };
  }
  return null;
}

/** Aplica a alteração somente se a arquitetura resultante for íntegra. */
function commit(project: Project, architecture: Architecture): Result<Project> {
  const next = withArchitecture(project, architecture);
  const problem = archIntegrityProblem(next);
  return problem ? fail(problem.code, problem.message) : ok(next);
}

function putElements(architecture: Architecture, elements: readonly ArchElement[]): Architecture {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const kept = architecture.elements.map((element) => byId.get(element.id) ?? element);
  const known = new Set(architecture.elements.map((element) => element.id));
  return {
    ...architecture,
    elements: [...kept, ...elements.filter((element) => !known.has(element.id))],
  };
}

function parseElement<T extends ArchElement>(element: T): Result<T> {
  const parsed = ArchElementSchema.safeParse(element);
  if (!parsed.success) {
    const where = parsed.error.issues[0]?.path.join('.') ?? '';
    return fail(
      'INVALID_VALUE',
      `Valor inválido${where ? ` em "${where}"` : ''}: confira as dimensões informadas.`,
    );
  }
  return ok(parsed.data as T);
}

/** Cópia do registro com a chave definida, ou sem ela quando o valor é `undefined`. */
function withEntry(
  record: Readonly<Record<string, PropertyValue>>,
  key: string,
  value: PropertyValue | undefined,
): Record<string, PropertyValue> {
  const entries = Object.entries(record).filter(([name]) => name !== key);
  if (value !== undefined) entries.push([key, value]);
  return Object.fromEntries(entries);
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
export type ArchTypeInput = WithoutId<ArchType>;

function parseType(type: ArchType): Result<ArchType> {
  const parsed = ArchTypeSchema.safeParse({ ...type, name: type.name.trim() });
  if (!parsed.success) {
    const where = parsed.error.issues[0]?.path.join('.') ?? '';
    return fail(
      'INVALID_ARCH_TYPE',
      `Tipo inválido${where ? ` em "${where}"` : ''}: nome, dimensões e camadas devem ser preenchidos com valores positivos.`,
    );
  }
  return ok(parsed.data);
}

const sameText = (a: string, b: string): boolean =>
  a.trim().toLocaleLowerCase('pt-BR') === b.trim().toLocaleLowerCase('pt-BR');

function typeNameTaken(architecture: Architecture, type: ArchType): boolean {
  return architecture.types.some(
    (other) =>
      other.id !== type.id && other.category === type.category && sameText(other.name, type.name),
  );
}

/** Acrescenta um tipo ao projeto (vindo do catálogo ou criado pelo usuário). */
export function addArchType(
  project: Project,
  input: ArchTypeInput,
): Result<{ project: Project; typeId: string }> {
  const parsed = parseType({ ...input, id: newId() } as ArchType);
  if (!parsed.ok) return parsed;
  if (typeNameTaken(project.architecture, parsed.value)) {
    return fail('ARCH_TYPE_NAME_TAKEN', `Já existe um tipo chamado "${parsed.value.name}".`);
  }
  const next = commit(project, {
    ...project.architecture,
    types: [...project.architecture.types, parsed.value],
  });
  return next.ok ? ok({ project: next.value, typeId: parsed.value.id }) : next;
}

/** Cópia independente do tipo, com outro nome: as ocorrências continuam no tipo original. */
export function duplicateArchType(
  project: Project,
  typeId: string,
  name?: string,
): Result<{ project: Project; typeId: string }> {
  const source = getArchType(project.architecture, typeId);
  if (!source) return fail('ARCH_TYPE_NOT_FOUND', 'Tipo inexistente.');
  let copyName = name?.trim() || `${source.name} — cópia`;
  for (
    let n = 2;
    typeNameTaken(project.architecture, { ...source, id: '', name: copyName });
    n += 1
  ) {
    if (name?.trim())
      return fail('ARCH_TYPE_NAME_TAKEN', `Já existe um tipo chamado "${copyName}".`);
    copyName = `${source.name} — cópia ${n}`;
  }
  const { id: _id, ...rest } = source;
  const layered =
    'layers' in rest
      ? { ...rest, layers: rest.layers.map((layer) => ({ ...layer, id: newId() })) }
      : rest;
  return addArchType(project, { ...layered, name: copyName } as ArchTypeInput);
}

/**
 * Altera um tipo. Vale para TODAS as ocorrências dele (`affected`); se alguma deixar de
 * caber — porta mais larga que o trecho livre da parede, por exemplo — a alteração inteira é
 * recusada. A categoria não muda.
 */
export function updateArchType(
  project: Project,
  typeId: string,
  patch: Partial<ArchTypeInput>,
): Result<{ project: Project; affected: string[] }> {
  const current = getArchType(project.architecture, typeId);
  if (!current) return fail('ARCH_TYPE_NOT_FOUND', 'Tipo inexistente.');
  if (patch.category !== undefined && patch.category !== current.category) {
    return fail('ARCH_TYPE_CATEGORY', 'A categoria de um tipo não pode ser alterada.');
  }
  const parsed = parseType({ ...current, ...patch, id: current.id } as ArchType);
  if (!parsed.ok) return parsed;
  if (typeNameTaken(project.architecture, parsed.value)) {
    return fail('ARCH_TYPE_NAME_TAKEN', `Já existe um tipo chamado "${parsed.value.name}".`);
  }
  const next = commit(project, {
    ...project.architecture,
    types: project.architecture.types.map((type) => (type.id === typeId ? parsed.value : type)),
  });
  if (!next.ok) return next;
  return ok({
    project: next.value,
    affected: archTypeUsage(project.architecture, typeId).map((element) => element.id),
  });
}

export function removeArchType(project: Project, typeId: string): Result<Project> {
  const type = getArchType(project.architecture, typeId);
  if (!type) return fail('ARCH_TYPE_NOT_FOUND', 'Tipo inexistente.');
  const used = archTypeUsage(project.architecture, typeId).length;
  if (used > 0) {
    return fail(
      'ARCH_TYPE_IN_USE',
      `"${type.name}" é usado por ${used} elemento(s); troque o tipo deles antes de excluir.`,
    );
  }
  return commit(project, {
    ...project.architecture,
    types: project.architecture.types.filter((other) => other.id !== typeId),
  });
}

/** Informa (ou limpa, com `undefined`) um valor IFC do tipo. */
export function setArchTypeIfcValue(
  project: Project,
  typeId: string,
  key: string,
  value: PropertyValue | undefined,
): Result<Project> {
  const type = getArchType(project.architecture, typeId);
  if (!type) return fail('ARCH_TYPE_NOT_FOUND', 'Tipo inexistente.');
  const ifc = withEntry(type.ifc, key, value);
  return commit(project, {
    ...project.architecture,
    types: project.architecture.types.map((other) =>
      other.id === typeId ? { ...other, ifc } : other,
    ),
  });
}

// ---------------------------------------------------------------------------
// Paredes
// ---------------------------------------------------------------------------

export interface WallInput {
  typeId: string;
  levelId: string;
  /** Vértices do traçado contínuo: cada par consecutivo vira uma parede. */
  points: readonly Point2[];
  height: number;
  baseOffset?: number;
  locationLine?: WallLocationLine;
  /** Liga o último ponto ao primeiro (contorno fechado). */
  closed?: boolean;
}

/** Traçado contínuo de paredes: os encontros em L entre trechos consecutivos são derivados. */
export function addWalls(project: Project, input: WallInput): Result<ArchCreated> {
  const points = [...input.points];
  if (input.closed && points.length >= 3) points.push(points[0] as Point2);
  if (points.length < 2) {
    return fail('WALL_NEEDS_POINTS', 'A parede precisa de dois pontos.');
  }
  let architecture = project.architecture;
  const created: Wall[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const start = points[i] as Point2;
    const end = points[i + 1] as Point2;
    if (distance2(start, end) < MIN_WALL_LENGTH) {
      return fail(
        'WALL_TOO_SHORT',
        `O trecho ${i + 1} é curto demais (mínimo de ${MIN_WALL_LENGTH * 100} cm).`,
      );
    }
    const wall = parseElement<Wall>({
      id: newId(),
      kind: 'wall',
      name: nextArchName(architecture, 'wall'),
      typeId: input.typeId,
      levelId: input.levelId,
      start,
      end,
      locationLine: input.locationLine ?? 'center',
      baseOffset: input.baseOffset ?? 0,
      height: input.height,
      properties: {},
      meta: meta(),
    });
    if (!wall.ok) return wall;
    created.push(wall.value);
    architecture = putElements(architecture, [wall.value]);
  }
  const next = commit(project, architecture);
  return next.ok ? ok({ project: next.value, elementIds: created.map((wall) => wall.id) }) : next;
}

// ---------------------------------------------------------------------------
// Lajes, revestimentos de piso e ambientes
// ---------------------------------------------------------------------------

export interface FloorInput {
  kind: 'slab' | 'flooring';
  typeId: string;
  levelId: string;
  boundary: readonly Point2[];
  /** Laje: cota do topo; revestimento: cota da base — ambas em relação ao nível. */
  offset?: number;
}

export function addFloor(project: Project, input: FloorInput): Result<ArchCreated> {
  const polygon = validatePolygon([input.boundary]);
  if (!polygon.ok) return polygon;
  const element = parseElement<FloorElement>({
    id: newId(),
    kind: input.kind,
    name: nextArchName(project.architecture, input.kind),
    typeId: input.typeId,
    levelId: input.levelId,
    boundary: polygon.value[0] as Point2[],
    openings: [],
    offset: input.offset ?? 0,
    properties: {},
    meta: meta(),
  } as Slab | Flooring);
  if (!element.ok) return element;
  const next = commit(project, putElements(project.architecture, [element.value]));
  return next.ok ? ok({ project: next.value, elementIds: [element.value.id] }) : next;
}

function floorOf(project: Project, id: string): Result<FloorElement> {
  const element = getArchElement(project.architecture, id);
  if (!element || (element.kind !== 'slab' && element.kind !== 'flooring')) {
    return fail('FLOOR_NOT_FOUND', 'Selecione uma laje ou um revestimento de piso.');
  }
  return ok(element);
}

/** Abre um vão no piso: contorno fechado inteiro dentro do elemento, sem tocar outros vãos. */
export function addFloorOpening(
  project: Project,
  floorId: string,
  boundary: readonly Point2[],
): Result<{ project: Project; openingId: string }> {
  const floor = floorOf(project, floorId);
  if (!floor.ok) return floor;
  const openingId = newId();
  const rings = [
    floor.value.boundary,
    ...floor.value.openings.map((opening) => opening.boundary),
    boundary,
  ];
  const polygon = validatePolygon(rings);
  if (!polygon.ok) {
    return fail(
      polygon.error.code === 'POLYGON_HOLE_OUTSIDE' ? 'OPENING_OUTSIDE' : polygon.error.code,
      polygon.error.code === 'POLYGON_HOLE_OUTSIDE'
        ? 'A abertura precisa ficar inteira dentro do contorno do piso.'
        : polygon.error.code === 'POLYGON_HOLE_CROSSING'
          ? 'A abertura toca ou cruza o contorno do piso ou outra abertura.'
          : polygon.error.message,
    );
  }
  const cleaned = polygon.value[polygon.value.length - 1] as Point2[];
  const next = commit(
    project,
    putElements(project.architecture, [
      touched({
        ...floor.value,
        openings: [...floor.value.openings, { id: openingId, boundary: cleaned }],
      }),
    ]),
  );
  return next.ok ? ok({ project: next.value, openingId }) : next;
}

export function removeFloorOpening(
  project: Project,
  floorId: string,
  openingId: string,
): Result<Project> {
  const floor = floorOf(project, floorId);
  if (!floor.ok) return floor;
  if (!floor.value.openings.some((opening) => opening.id === openingId)) {
    return fail('OPENING_NOT_FOUND', 'Abertura inexistente.');
  }
  return commit(
    project,
    putElements(project.architecture, [
      touched({
        ...floor.value,
        openings: floor.value.openings.filter((opening) => opening.id !== openingId),
      }),
    ]),
  );
}

export interface SpaceInput {
  levelId: string;
  boundary: readonly Point2[];
  name?: string;
  number?: string;
  /** Pé-direito (m); `null` ou ausente = não informado. */
  height?: number | null;
  offset?: number;
}

export function addSpace(project: Project, input: SpaceInput): Result<ArchCreated> {
  const polygon = validatePolygon([input.boundary]);
  if (!polygon.ok) return polygon;
  const name = input.name?.trim() || nextArchName(project.architecture, 'space');
  const space = parseElement<Space>({
    id: newId(),
    kind: 'space',
    name,
    levelId: input.levelId,
    ...(input.number?.trim() ? { number: input.number.trim() } : {}),
    boundary: polygon.value[0] as Point2[],
    offset: input.offset ?? 0,
    height: input.height ?? null,
    properties: {},
    meta: meta(),
  });
  if (!space.ok) return space;
  const next = commit(project, putElements(project.architecture, [space.value]));
  return next.ok ? ok({ project: next.value, elementIds: [space.value.id] }) : next;
}

// ---------------------------------------------------------------------------
// Portas e janelas (hospedadas em parede)
// ---------------------------------------------------------------------------

export interface HostedInput {
  kind: 'door' | 'window';
  typeId: string;
  hostId: string;
  /** Centro do vão: distância do início da parede (m) ou um ponto em planta, projetado nela. */
  at: number | Point2;
  /** Ausente: 0 na porta; o peitoril do tipo na janela. */
  sillHeight?: number;
  hand?: 'left' | 'right';
  facing?: 1 | -1;
}

export function addHosted(project: Project, input: HostedInput): Result<ArchCreated> {
  const host = getArchElement(project.architecture, input.hostId);
  if (!host || host.kind !== 'wall') {
    return fail('HOST_NOT_FOUND', 'Portas e janelas são inseridas em uma parede.');
  }
  const type = getArchType(project.architecture, input.typeId);
  if (!type || type.category !== input.kind) {
    return fail(
      'ARCH_TYPE_NOT_FOUND',
      `Escolha um tipo de ${ARCH_KIND_LABELS[input.kind].toLowerCase()} do catálogo.`,
    );
  }
  const offset = typeof input.at === 'number' ? input.at : offsetAlongWall(host, input.at);
  const element = parseElement<HostedElement>({
    id: newId(),
    kind: input.kind,
    name: nextArchName(project.architecture, input.kind),
    typeId: input.typeId,
    hostId: input.hostId,
    offset,
    sillHeight: input.sillHeight ?? (type.category === 'window' ? type.sillHeight : 0),
    hand: input.hand ?? 'left',
    facing: input.facing ?? 1,
    properties: {},
    meta: meta(),
  } as Door | ArchWindow);
  if (!element.ok) return element;
  const next = commit(project, putElements(project.architecture, [element.value]));
  return next.ok ? ok({ project: next.value, elementIds: [element.value.id] }) : next;
}

// ---------------------------------------------------------------------------
// Edição
// ---------------------------------------------------------------------------

/** Campos editáveis; os que não existem no tipo do elemento são recusados. */
export interface ArchElementPatch {
  name?: string;
  typeId?: string;
  levelId?: string;
  start?: Point2;
  end?: Point2;
  locationLine?: WallLocationLine;
  baseOffset?: number;
  height?: number | null;
  boundary?: Point2[];
  offset?: number;
  hostId?: string;
  sillHeight?: number;
  hand?: 'left' | 'right';
  facing?: 1 | -1;
  number?: string | null;
}

/**
 * Altera uma ocorrência. Editar a parede atualiza os elementos hospedados (são posicionados
 * em relação a ela); se um vão deixar de caber, a alteração é recusada por inteiro.
 */
export function updateArchElement(
  project: Project,
  id: string,
  patch: ArchElementPatch,
): Result<Project> {
  const current = getArchElement(project.architecture, id);
  if (!current) return fail('ARCH_ELEMENT_NOT_FOUND', 'Elemento inexistente.');
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  for (const [key] of entries) {
    const optionalSpaceField = current.kind === 'space' && key === 'number';
    if (!(key in current) && !optionalSpaceField) {
      return fail(
        'INVALID_ARCH_PATCH',
        `"${key}" não se aplica a ${ARCH_KIND_LABELS[current.kind].toLowerCase()}.`,
      );
    }
  }
  if (entries.length === 0) return ok(project);
  const merged: Record<string, unknown> = { ...current, ...Object.fromEntries(entries) };
  if (merged.number === null || merged.number === '') delete merged.number;
  if (typeof merged.name === 'string') merged.name = merged.name.trim();
  if (merged.name === '') return fail('INVALID_NAME', 'O nome não pode ser vazio.');
  if (current.kind !== 'space' && merged.height === null) {
    return fail('INVALID_VALUE', 'Informe a altura.');
  }
  if ('boundary' in merged && patch.boundary) {
    const openings =
      current.kind === 'slab' || current.kind === 'flooring'
        ? current.openings.map((opening) => opening.boundary)
        : [];
    const polygon = validatePolygon([patch.boundary, ...openings]);
    if (!polygon.ok) return polygon;
    merged.boundary = polygon.value[0];
  }
  const parsed = parseElement(merged as ArchElement);
  if (!parsed.ok) return parsed;
  return commit(project, putElements(project.architecture, [touched(parsed.value)]));
}

export const renameArchElement = (project: Project, id: string, name: string): Result<Project> =>
  updateArchElement(project, id, { name });

/** Informa (ou limpa) um valor IFC da ocorrência. */
export function setArchElementIfcValue(
  project: Project,
  id: string,
  key: string,
  value: PropertyValue | undefined,
): Result<Project> {
  const element = getArchElement(project.architecture, id);
  if (!element) return fail('ARCH_ELEMENT_NOT_FOUND', 'Elemento inexistente.');
  const ifc = withEntry(element.ifc ?? {}, key, value);
  const { ifc: _previous, ...rest } = element;
  const next = (Object.keys(ifc).length > 0 ? { ...rest, ifc } : rest) as ArchElement;
  return commit(project, putElements(project.architecture, [touched(next)]));
}

/** Informa (ou remove, com `undefined`) uma propriedade livre da ocorrência. */
export function setArchElementProperty(
  project: Project,
  id: string,
  key: string,
  value: PropertyValue | undefined,
): Result<Project> {
  const element = getArchElement(project.architecture, id);
  if (!element) return fail('ARCH_ELEMENT_NOT_FOUND', 'Elemento inexistente.');
  const name = key.trim();
  if (name.length === 0) return fail('INVALID_NAME', 'O nome da propriedade não pode ser vazio.');
  const properties = withEntry(element.properties, name, value);
  return commit(project, putElements(project.architecture, [touched({ ...element, properties })]));
}

/**
 * Exclui elementos. Excluir uma parede exclui as portas e janelas hospedadas nela (um vão não
 * existe sem a parede); `removed` lista tudo o que saiu.
 */
export function deleteArchElements(
  project: Project,
  ids: readonly string[],
): { project: Project; removed: string[] } {
  const doomed = new Set(ids.filter((id) => getArchElement(project.architecture, id)));
  for (const element of project.architecture.elements) {
    if (isHosted(element) && doomed.has(element.hostId)) doomed.add(element.id);
  }
  if (doomed.size === 0) return { project, removed: [] };
  return {
    project: withArchitecture(project, {
      ...project.architecture,
      elements: project.architecture.elements.filter((element) => !doomed.has(element.id)),
    }),
    removed: [...doomed],
  };
}

// ---------------------------------------------------------------------------
// Mover, copiar, girar e espelhar
// ---------------------------------------------------------------------------

/** Transformação rígida em planta (com reflexão opcional) e deslocamento vertical. */
interface PlanTransform {
  readonly point: (p: Point2) => Point2;
  readonly dz: number;
  /** A reflexão inverte o sentido das paredes: mão e face dos vãos trocam de lado. */
  readonly mirrored: boolean;
}

function transformElement(
  element: ArchElement,
  t: PlanTransform,
  hostLength?: number,
): ArchElement {
  switch (element.kind) {
    case 'wall':
      // No espelho o sentido da parede é invertido (início ↔ fim): assim a face esquerda
      // continua sendo a mesma face física, com as mesmas camadas e a mesma linha de
      // referência.
      return {
        ...element,
        start: t.point(t.mirrored ? element.end : element.start),
        end: t.point(t.mirrored ? element.start : element.end),
        baseOffset: element.baseOffset + t.dz,
      };
    case 'slab':
    case 'flooring': {
      const ring = (points: readonly Point2[]): Point2[] => {
        const moved = points.map(t.point);
        return t.mirrored ? moved.reverse() : moved;
      };
      return {
        ...element,
        boundary: ring(element.boundary),
        openings: element.openings.map((opening) => ({
          ...opening,
          boundary: ring(opening.boundary),
        })),
        offset: element.offset + t.dz,
      };
    }
    case 'space': {
      const moved = element.boundary.map(t.point);
      return {
        ...element,
        boundary: t.mirrored ? moved.reverse() : moved,
        offset: element.offset + t.dz,
      };
    }
    case 'door':
    case 'window':
      // Acompanha a hospedeira. No espelho a parede é percorrida ao contrário: a posição é
      // medida da outra ponta e as dobradiças trocam de lado; a face de abertura é a mesma.
      return t.mirrored && hostLength !== undefined
        ? {
            ...element,
            offset: hostLength - element.offset,
            hand: element.hand === 'left' ? 'right' : 'left',
          }
        : element;
  }
}

/** Conjunto a transformar: os escolhidos e, das paredes, os elementos hospedados. */
function closure(architecture: Architecture, ids: readonly string[]): Result<ArchElement[]> {
  const chosen = new Map<string, ArchElement>();
  for (const id of ids) {
    const element = getArchElement(architecture, id);
    if (!element) return fail('ARCH_ELEMENT_NOT_FOUND', 'Elemento inexistente.');
    chosen.set(id, element);
  }
  if (chosen.size === 0) return fail('NOTHING_SELECTED', 'Selecione ao menos um elemento.');
  for (const element of [...chosen.values()]) {
    if (element.kind !== 'wall') continue;
    for (const hosted of hostedOf(architecture, element.id)) chosen.set(hosted.id, hosted);
  }
  return ok([...chosen.values()]);
}

function applyTransform(
  project: Project,
  ids: readonly string[],
  t: PlanTransform,
  copy: boolean,
  /** Deslocamento em planta, para deslizar ao longo da parede um vão movido sozinho. */
  delta?: Point2,
): Result<ArchCreated> {
  const set = closure(project.architecture, ids);
  if (!set.ok) return set;
  const moving = new Set(set.value.map((element) => element.id));
  const idMap = new Map<string, string>();
  if (copy) for (const element of set.value) idMap.set(element.id, newId());
  let architecture = project.architecture;
  const result: ArchElement[] = [];
  for (const element of set.value) {
    let next: ArchElement;
    if (isHosted(element) && !moving.has(element.hostId)) {
      // Porta ou janela sozinha: só desliza ao longo da hospedeira.
      const host = hostWallOf(project.architecture, element);
      if (!host) return fail('HOST_NOT_FOUND', `"${element.name}" não tem parede hospedeira.`);
      if (!delta || t.mirrored) {
        return fail(
          'HOSTED_NEEDS_HOST',
          `"${element.name}" é hospedada em "${host.name}": gire ou espelhe a parede para levá-la junto.`,
        );
      }
      const along = offsetAlongWall(host, add2(host.start, delta));
      next = { ...element, offset: element.offset + along, sillHeight: element.sillHeight + t.dz };
    } else {
      const host = isHosted(element) ? hostWallOf(project.architecture, element) : undefined;
      next = transformElement(element, t, host ? wallLength(host) : undefined);
    }
    if (copy) {
      const id = idMap.get(element.id) as string;
      const hostId = isHosted(next) ? (idMap.get(next.hostId) ?? next.hostId) : undefined;
      const { ifc: _ifc, ...rest } = next;
      next = {
        ...rest,
        ...(next.ifc ? { ifc: { ...next.ifc } } : {}),
        ...(hostId ? { hostId } : {}),
        ...('openings' in next
          ? { openings: next.openings.map((opening) => ({ ...opening, id: newId() })) }
          : {}),
        id,
        name: nextArchName(architecture, next.kind),
        meta: meta(),
      } as ArchElement;
    } else {
      next = touched(next);
    }
    const parsed = parseElement(next);
    if (!parsed.ok) return parsed;
    result.push(parsed.value);
    architecture = putElements(architecture, [parsed.value]);
  }
  const committed = commit(project, architecture);
  return committed.ok
    ? ok({ project: committed.value, elementIds: result.map((element) => element.id) })
    : committed;
}

const finiteDelta = (delta: Point2, dz: number): boolean =>
  Number.isFinite(delta.x) && Number.isFinite(delta.y) && Number.isFinite(dz);

/**
 * Desloca os elementos. Uma parede leva as portas e janelas hospedadas; uma porta ou janela
 * movida sozinha desliza ao longo da sua parede (só conta a componente do deslocamento no
 * eixo dela) e é recusada se sair do trecho livre.
 */
export function moveArchElements(
  project: Project,
  ids: readonly string[],
  delta: Point2,
  dz = 0,
): Result<Project> {
  if (!finiteDelta(delta, dz)) return fail('INVALID_VALUE', 'Deslocamento inválido.');
  const moved = applyTransform(
    project,
    ids,
    { point: (p) => add2(p, delta), dz, mirrored: false },
    false,
    delta,
  );
  return moved.ok ? ok(moved.value.project) : moved;
}

/** Copia os elementos, deslocados; as cópias têm novos identificadores e nomes. */
export function copyArchElements(
  project: Project,
  ids: readonly string[],
  delta: Point2,
  dz = 0,
): Result<ArchCreated> {
  if (!finiteDelta(delta, dz)) return fail('INVALID_VALUE', 'Deslocamento inválido.');
  return applyTransform(
    project,
    ids,
    { point: (p) => add2(p, delta), dz, mirrored: false },
    true,
    delta,
  );
}

/** Gira (ou copia girando) em torno de um eixo vertical por `center`; cotas preservadas. */
export function rotateArchElements(
  project: Project,
  ids: readonly string[],
  center: Point2,
  angle: number,
  copy = false,
): Result<ArchCreated> {
  if (!Number.isFinite(angle)) return fail('INVALID_VALUE', 'Ângulo inválido.');
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const point = (p: Point2): Point2 => {
    const d = sub2(p, center);
    return { x: center.x + d.x * cos - d.y * sin, y: center.y + d.x * sin + d.y * cos };
  };
  return applyTransform(project, ids, { point, dz: 0, mirrored: false }, copy);
}

/** Espelha (ou copia espelhando) em relação à reta que passa por `a` e `b`, em planta. */
export function mirrorArchElements(
  project: Project,
  ids: readonly string[],
  a: Point2,
  b: Point2,
  copy = false,
): Result<ArchCreated> {
  const axis = sub2(b, a);
  const size2 = axis.x * axis.x + axis.y * axis.y;
  if (size2 < 1e-12) {
    return fail(
      'MIRROR_AXIS_UNDEFINED',
      'O eixo de espelhamento precisa de dois pontos distintos.',
    );
  }
  const point = (p: Point2): Point2 => {
    const d = sub2(p, a);
    const t = (d.x * axis.x + d.y * axis.y) / size2;
    const foot = { x: a.x + axis.x * t, y: a.y + axis.y * t };
    return { x: 2 * foot.x - p.x, y: 2 * foot.y - p.y };
  };
  return applyTransform(project, ids, { point, dz: 0, mirrored: true }, copy);
}

/** O ponto está sobre o piso (dentro do contorno e fora das aberturas)? */
export function pointOnFloor(element: FloorElement, point: Point2): boolean {
  if (!pointInRing(element.boundary, point.x, point.y)) return false;
  return !element.openings.some((opening) => pointInRing(opening.boundary, point.x, point.y));
}
