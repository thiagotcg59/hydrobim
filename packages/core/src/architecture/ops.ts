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
  type Roof,
  type Slab,
  type Space,
  type Wall,
  type WallLocationLine,
} from '../schema';
import { pointInRing, validatePolygon } from '../terrain/polygon';
import { ARCH_KIND_CATEGORY, ARCH_KIND_LABELS, archTypeUsage, hostWallOf } from './derive';
import { add2, cross2, distance2, dot2, intersectLines, length2, scale2, sub2 } from './polygon2';
import {
  normalizeRoofBoundary,
  ROOF_IFC_PREDEFINED,
  ROOF_SHAPE_LABELS,
  roofBoundaryProblem,
  roofSlopeProblem,
} from './roofs';
import {
  getArchElement,
  getArchType,
  hostedOf,
  hostedPoint,
  hostedTypeOf,
  isHosted,
  layersThickness,
  MIN_WALL_LENGTH,
  offsetAlongWall,
  openingOf,
  openingProblem,
  WALL_NODE_TOLERANCE,
  wallAxes,
  wallFaceOffsets,
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
    // A tipologia do telhado e o tipo predefinido IFC dizem a mesma coisa: não se contradizem.
    if (type.category === 'roof' && type.ifcPredefinedType !== ROOF_IFC_PREDEFINED[type.shape]) {
      return {
        code: 'ROOF_TYPE_MISMATCH',
        message: `"${type.name}": telhado de ${ROOF_SHAPE_LABELS[type.shape].toLowerCase()} tem o tipo predefinido IFC ${ROOF_IFC_PREDEFINED[type.shape]}.`,
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
    if (element.kind === 'roof') {
      const problem = roofBoundaryProblem(element.boundary) ?? roofSlopeProblem(element.slope);
      if (problem) {
        return {
          code: roofBoundaryProblem(element.boundary)
            ? 'ROOF_BOUNDARY_INVALID'
            : 'ROOF_SLOPE_INVALID',
          message: `"${element.name}": ${problem}.`,
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
// Telhados
// ---------------------------------------------------------------------------

export interface RoofInput {
  typeId: string;
  levelId: string;
  /** Os quatro cantos do retângulo de referência, em qualquer sentido. */
  boundary: readonly Point2[];
  /** Lado do contorno que é beiral (0 = do 1º ao 2º canto); ausente = o primeiro lado. */
  eaveEdge?: number;
  /** Deslocamento da cota de referência em relação ao nível (m). */
  offset?: number;
  /** Inclinação das águas (rad). */
  slope: number;
  /** Beiral, na horizontal, para fora do contorno (m). */
  overhang?: number;
}

/**
 * Cria um telhado de uma ou de duas águas (a tipologia é a do tipo) sobre um contorno
 * retangular. Contorno não retangular, lado curto demais e inclinação fora da faixa são
 * recusados com o motivo.
 */
export function addRoof(project: Project, input: RoofInput): Result<ArchCreated> {
  const boundaryProblem = roofBoundaryProblem(input.boundary);
  if (boundaryProblem) return fail('ROOF_BOUNDARY_INVALID', `Telhado: ${boundaryProblem}.`);
  const slopeProblem = roofSlopeProblem(input.slope);
  if (slopeProblem) return fail('ROOF_SLOPE_INVALID', `Telhado: ${slopeProblem}.`);
  const edge = input.eaveEdge ?? 0;
  if (!Number.isInteger(edge) || edge < 0 || edge > 3) {
    return fail('INVALID_VALUE', 'Telhado: o lado do beiral é um dos quatro lados do contorno.');
  }
  const type = getArchType(project.architecture, input.typeId);
  if (!type || type.category !== 'roof') {
    return fail('ARCH_TYPE_NOT_FOUND', 'Escolha um tipo de telhado do catálogo.');
  }
  const normalized = normalizeRoofBoundary(input.boundary, edge);
  const roof = parseElement<Roof>({
    id: newId(),
    kind: 'roof',
    name: nextArchName(project.architecture, 'roof'),
    typeId: input.typeId,
    levelId: input.levelId,
    boundary: normalized.boundary,
    eaveEdge: normalized.eaveEdge,
    offset: input.offset ?? 0,
    slope: input.slope,
    overhang: input.overhang ?? 0,
    properties: {},
    meta: meta(),
  });
  if (!roof.ok) return roof;
  const next = commit(project, putElements(project.architecture, [roof.value]));
  return next.ok ? ok({ project: next.value, elementIds: [roof.value.id] }) : next;
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
  /** Telhado: lado do beiral, inclinação (rad) e beiral (m). */
  eaveEdge?: number;
  slope?: number;
  overhang?: number;
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
  if (current.kind === 'roof') {
    // O contorno continua retangular e anti-horário; o lado do beiral acompanha a inversão.
    const roof = merged as unknown as Roof;
    const problem = roofBoundaryProblem(roof.boundary);
    if (problem) return fail('ROOF_BOUNDARY_INVALID', `"${current.name}": ${problem}.`);
    const slopeProblem = roofSlopeProblem(roof.slope);
    if (slopeProblem) return fail('ROOF_SLOPE_INVALID', `"${current.name}": ${slopeProblem}.`);
    Object.assign(merged, normalizeRoofBoundary(roof.boundary, roof.eaveEdge));
  } else if ('boundary' in merged && patch.boundary) {
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

/**
 * Leva uma extremidade da parede a `point` (a outra fica). As portas e janelas hospedadas
 * permanecem ONDE ESTÃO em relação à extremidade fixa: mover o início muda a distância gravada
 * (medida do início) para que o vão não ande junto. Se algum vão deixar de caber — parede
 * encurtada além dele, por exemplo —, nada é alterado e o motivo é devolvido.
 */
export function moveWallEndpoint(
  project: Project,
  wallId: string,
  end: 'start' | 'end',
  point: Point2,
): Result<Project> {
  const wall = getArchElement(project.architecture, wallId);
  if (!wall || wall.kind !== 'wall') return fail('WALL_NOT_FOUND', 'Selecione uma parede.');
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return fail('INVALID_VALUE', 'Ponto inválido.');
  }
  const moved = touched({ ...wall, [end]: { x: point.x, y: point.y } });
  const changed: ArchElement[] = [moved];
  if (end === 'start') {
    const shift = wallLength(moved) - wallLength(wall);
    for (const hosted of hostedOf(project.architecture, wall.id)) {
      changed.push(touched({ ...hosted, offset: hosted.offset + shift }));
    }
  }
  return commit(project, putElements(project.architecture, changed));
}

// ---------------------------------------------------------------------------
// Aparar, estender, dividir e alinhar
// ---------------------------------------------------------------------------

/** Parede indicada e o ponto do clique sobre ela: diz qual lado da parede é mantido. */
export interface WallPick {
  wallId: string;
  point: Point2;
}

/** Reta em planta, dada por dois pontos distintos (aresta de referência ou do elemento). */
export interface PlanLine {
  a: Point2;
  b: Point2;
}

/** Retas com o seno do ângulo abaixo disto são tratadas como paralelas (≈ 0,006°). */
const PARALLEL_SINE = 1e-4;

function wallOf(project: Project, id: string): Result<Wall> {
  const wall = getArchElement(project.architecture, id);
  return wall?.kind === 'wall' ? ok(wall) : fail('WALL_NOT_FOUND', 'Indique uma parede.');
}

/**
 * Parede com novas extremidades NA MESMA DIREÇÃO (aparada, estendida ou deslocada de `delta`).
 * As portas e janelas hospedadas ficam onde estão em relação ao corpo da parede: a distância
 * gravada, medida do início, é recalculada para que o vão não ande quando o início muda.
 */
function reshapedWall(
  architecture: Architecture,
  wall: Wall,
  start: Point2,
  end: Point2,
  delta: Point2 = { x: 0, y: 0 },
): ArchElement[] {
  const moved = touched({
    ...wall,
    start: { x: start.x, y: start.y },
    end: { x: end.x, y: end.y },
  });
  const changed: ArchElement[] = [moved];
  for (const hosted of hostedOf(architecture, wall.id)) {
    const at = add2(hostedPoint(wall, hosted.offset), delta);
    const offset = offsetAlongWall(moved, at);
    if (Math.abs(offset - hosted.offset) > 1e-9) changed.push(touched({ ...hosted, offset }));
  }
  return changed;
}

/** A parede continuaria com comprimento e no mesmo sentido entre `start` e `end`? */
function keepsSense(wall: Wall, start: Point2, end: Point2): boolean {
  return dot2(sub2(end, start), wallAxes(wall).dir) >= MIN_WALL_LENGTH;
}

const collapsed = (wall: Wall): Result<never> =>
  fail(
    'WALL_TOO_SHORT',
    `"${wall.name}" ficaria sem comprimento (mínimo de ${MIN_WALL_LENGTH * 100} cm).`,
  );

/** Ponto de encontro das linhas de referência de duas paredes do mesmo nível. */
function wallsMeetingPoint(a: Wall, b: Wall): Result<Point2> {
  if (a.id === b.id) return fail('TRIM_SAME_WALL', 'Indique duas paredes diferentes.');
  if (a.levelId !== b.levelId) {
    return fail(
      'WALLS_DIFFERENT_LEVELS',
      `"${a.name}" e "${b.name}" estão em níveis diferentes: o encontro só é resolvido entre paredes do mesmo nível.`,
    );
  }
  const da = wallAxes(a).dir;
  const db = wallAxes(b).dir;
  const hit =
    Math.abs(cross2(da, db)) > PARALLEL_SINE ? intersectLines(a.start, da, b.start, db) : null;
  return hit
    ? ok(hit)
    : fail('WALLS_PARALLEL', `"${a.name}" e "${b.name}" são paralelas: não há ponto de encontro.`);
}

/**
 * Extremidade que vai ao ponto de encontro `hit`. Encontro fora da parede: a extremidade mais
 * próxima é estendida. Encontro no corpo: fica o lado do clique (`keep`) e o outro é aparado.
 */
function endToMeet(wall: Wall, hit: Point2, keep: Point2): 'start' | 'end' {
  const t = offsetAlongWall(wall, hit);
  if (t <= WALL_NODE_TOLERANCE) return 'start';
  if (t >= wallLength(wall) - WALL_NODE_TOLERANCE) return 'end';
  return offsetAlongWall(wall, keep) < t ? 'end' : 'start';
}

function wallMeeting(architecture: Architecture, pick: Wall, hit: Point2, keep: Point2) {
  const end = endToMeet(pick, hit, keep);
  const start = end === 'start' ? hit : pick.start;
  const finish = end === 'end' ? hit : pick.end;
  return keepsSense(pick, start, finish)
    ? ok(reshapedWall(architecture, pick, start, finish))
    : collapsed(pick);
}

/**
 * Aparar/estender para canto: leva as duas paredes ao encontro das suas linhas de referência.
 * De cada parede fica o lado indicado pelo clique; o trecho além do encontro é aparado, e a
 * parede que não chega até ele é estendida. O canto em bisel é derivado das extremidades
 * coincidentes. Paralelas, níveis diferentes e vão que ficaria no trecho aparado são recusados.
 */
export function trimWallsToCorner(
  project: Project,
  first: WallPick,
  second: WallPick,
): Result<Project> {
  const a = wallOf(project, first.wallId);
  if (!a.ok) return a;
  const b = wallOf(project, second.wallId);
  if (!b.ok) return b;
  const hit = wallsMeetingPoint(a.value, b.value);
  if (!hit.ok) return hit;
  const { architecture } = project;
  const movedA = wallMeeting(architecture, a.value, hit.value, first.point);
  if (!movedA.ok) return movedA;
  const movedB = wallMeeting(architecture, b.value, hit.value, second.point);
  if (!movedB.ok) return movedB;
  return commit(project, putElements(architecture, [...movedA.value, ...movedB.value]));
}

/**
 * Aparar/estender até uma parede: só `target` muda — a extremidade dela vai à linha de
 * referência de `boundaryId`, que fica como está. O encontro em T é derivado quando a
 * extremidade cai no corpo da parede-limite.
 */
export function trimWallToWall(
  project: Project,
  boundaryId: string,
  target: WallPick,
): Result<Project> {
  const boundary = wallOf(project, boundaryId);
  if (!boundary.ok) return boundary;
  const wall = wallOf(project, target.wallId);
  if (!wall.ok) return wall;
  const hit = wallsMeetingPoint(wall.value, boundary.value);
  if (!hit.ok) return hit;
  const moved = wallMeeting(project.architecture, wall.value, hit.value, target.point);
  if (!moved.ok) return moved;
  return commit(project, putElements(project.architecture, moved.value));
}

/**
 * Divide a parede no pé da perpendicular de `point` sobre a linha de referência. A parede
 * original mantém o `id` e fica com o trecho do início; o trecho do fim é uma parede nova, com
 * o mesmo tipo, nível, altura e propriedades. As portas e janelas passam para o trecho em que
 * estão; dividir dentro de um vão é recusado.
 */
export function splitWall(project: Project, wallId: string, point: Point2): Result<ArchCreated> {
  const found = wallOf(project, wallId);
  if (!found.ok) return found;
  const wall = found.value;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return fail('INVALID_VALUE', 'Ponto inválido.');
  }
  const { architecture } = project;
  const at = offsetAlongWall(wall, point);
  if (at < MIN_WALL_LENGTH || at > wallLength(wall) - MIN_WALL_LENGTH) {
    return fail(
      'SPLIT_OUTSIDE_WALL',
      `O ponto de divisão precisa ficar no corpo de "${wall.name}", a pelo menos ${MIN_WALL_LENGTH * 100} cm das extremidades.`,
    );
  }
  const cut = hostedPoint(wall, at);
  const { ifc: _ifc, ...rest } = wall;
  const tail: Wall = {
    ...rest,
    ...(wall.ifc ? { ifc: { ...wall.ifc } } : {}),
    properties: { ...wall.properties },
    id: newId(),
    name: nextArchName(architecture, 'wall'),
    start: cut,
    end: wall.end,
    meta: meta(),
  };
  const changed: ArchElement[] = [touched({ ...wall, end: cut }), tail];
  for (const hosted of hostedOf(architecture, wall.id)) {
    const type = hostedTypeOf(architecture, hosted);
    const opening = type ? openingOf(hosted, type) : null;
    if (opening && opening.from < at - 1e-6 && opening.to > at + 1e-6) {
      return fail(
        'SPLIT_THROUGH_OPENING',
        `O ponto de divisão cai dentro do vão de "${hosted.name}": divida fora das portas e janelas.`,
      );
    }
    if (hosted.offset > at) {
      changed.push(touched({ ...hosted, hostId: tail.id, offset: hosted.offset - at }));
    }
  }
  const next = commit(project, putElements(architecture, changed));
  return next.ok ? ok({ project: next.value, elementIds: [tail.id] }) : next;
}

/** O ponto está sobre o corpo da parede (dentro da espessura, fora das pontas)? */
function restsOnBody(architecture: Architecture, host: Wall, point: Point2): boolean {
  const type = getArchType(architecture, host.typeId);
  const thickness = type?.category === 'wall' ? layersThickness(type) : 0;
  const { lo, hi } = wallFaceOffsets(host, thickness);
  const { dir, left } = wallAxes(host);
  const rel = sub2(point, host.start);
  const along = dot2(rel, dir);
  const across = dot2(rel, left);
  return (
    along > WALL_NODE_TOLERANCE &&
    along < wallLength(host) - WALL_NODE_TOLERANCE &&
    across >= lo - WALL_NODE_TOLERANCE &&
    across <= hi + WALL_NODE_TOLERANCE
  );
}

/**
 * Desloca a parede de `delta` levando junto os encontros: o canto compartilhado vai ao novo
 * cruzamento das duas linhas (a vizinha é esticada ou encurtada na própria direção), a
 * extremidade apoiada em T continua sobre a parede de apoio, e as paredes apoiadas nesta são
 * levadas até ela. Vizinhas paralelas (no prolongamento) não têm cruzamento e ficam como estão.
 */
function shiftWallWithJoins(project: Project, wall: Wall, delta: Point2): Result<Project> {
  const { architecture } = project;
  const { dir } = wallAxes(wall);
  const origin = add2(wall.start, delta);
  const others = architecture.elements.filter(
    (element): element is Wall =>
      element.kind === 'wall' && element.id !== wall.id && element.levelId === wall.levelId,
  );
  /** Cruzamento da nova linha desta parede com a linha de outra; `null` se paralelas. */
  const crossing = (other: Wall): Point2 | null => {
    const otherDir = wallAxes(other).dir;
    return Math.abs(cross2(dir, otherDir)) > PARALLEL_SINE
      ? intersectLines(origin, dir, other.start, otherDir)
      : null;
  };
  const ends = { start: add2(wall.start, delta), end: add2(wall.end, delta) };
  const carried = new Map<string, { wall: Wall; start: Point2; end: Point2 }>();
  const carry = (other: Wall, end: 'start' | 'end', point: Point2): void => {
    const entry = carried.get(other.id) ?? { wall: other, start: other.start, end: other.end };
    carried.set(other.id, { ...entry, [end]: point });
  };

  for (const end of ['start', 'end'] as const) {
    const node = wall[end];
    const partners = others.flatMap((other) =>
      (['start', 'end'] as const)
        .filter((otherEnd) => distance2(other[otherEnd], node) <= WALL_NODE_TOLERANCE)
        .map((otherEnd) => ({ other, otherEnd })),
    );
    if (partners.length > 0) {
      const corner = partners.map(({ other }) => crossing(other)).find((hit) => hit !== null);
      if (!corner) continue;
      ends[end] = corner;
      for (const { other, otherEnd } of partners) {
        // Só acompanha a vizinha cuja linha passa pelo novo canto: a direção dela não muda.
        const off = cross2(sub2(corner, other.start), wallAxes(other).dir);
        if (Math.abs(off) <= 1e-6) carry(other, otherEnd, corner);
      }
      continue;
    }
    const support = others.find((other) => restsOnBody(architecture, other, node));
    const hit = support ? crossing(support) : null;
    if (hit) ends[end] = hit;
  }
  for (const other of others) {
    for (const otherEnd of ['start', 'end'] as const) {
      if (!restsOnBody(architecture, wall, other[otherEnd])) continue;
      const hit = crossing(other);
      if (hit) carry(other, otherEnd, hit);
    }
  }

  if (!keepsSense(wall, ends.start, ends.end)) return collapsed(wall);
  let next = putElements(
    architecture,
    reshapedWall(architecture, wall, ends.start, ends.end, delta),
  );
  for (const entry of carried.values()) {
    if (!keepsSense(entry.wall, entry.start, entry.end)) return collapsed(entry.wall);
    next = putElements(next, reshapedWall(architecture, entry.wall, entry.start, entry.end));
  }
  return commit(project, next);
}

/**
 * Alinhar: desloca o elemento na perpendicular à reta de referência até que a aresta indicada
 * (`edge`, uma aresta dele) fique sobre ela. A aresta tem de ser paralela à referência — a
 * operação não gira nada.
 *  - Parede, aresta ao longo dela (face ou eixo): a parede inteira se desloca e leva os
 *    encontros (ver `shiftWallWithJoins`).
 *  - Parede, aresta de topo: só a extremidade mais próxima é estendida ou aparada até a
 *    referência; os vãos ficam no lugar.
 *  - Laje, piso, ambiente e telhado: o elemento inteiro se desloca.
 * Portas e janelas acompanham a parede hospedeira e não são alinhadas sozinhas.
 */
export function alignArchElement(
  project: Project,
  elementId: string,
  reference: PlanLine,
  edge: PlanLine,
): Result<Project> {
  const element = getArchElement(project.architecture, elementId);
  if (!element) return fail('ARCH_ELEMENT_NOT_FOUND', 'Elemento inexistente.');
  if (isHosted(element)) {
    return fail(
      'ALIGN_HOSTED',
      `"${element.name}" acompanha a parede hospedeira: alinhe a parede ou ajuste a posição no painel de propriedades.`,
    );
  }
  const along = sub2(reference.b, reference.a);
  const side = sub2(edge.b, edge.a);
  const values = [
    along.x,
    along.y,
    side.x,
    side.y,
    reference.a.x,
    reference.a.y,
    edge.a.x,
    edge.a.y,
  ];
  if (!values.every(Number.isFinite) || length2(along) < 1e-9 || length2(side) < 1e-9) {
    return fail(
      'INVALID_VALUE',
      'Alinhar: a referência e a aresta precisam de dois pontos distintos.',
    );
  }
  const r = scale2(along, 1 / length2(along));
  if (Math.abs(cross2(r, side)) / length2(side) > PARALLEL_SINE) {
    return fail(
      'ALIGN_NOT_PARALLEL',
      `A aresta de "${element.name}" não é paralela à referência: gire o elemento antes de alinhar.`,
    );
  }
  const normal = { x: -r.y, y: r.x };
  const gap = dot2(sub2(reference.a, edge.a), normal);
  if (Math.abs(gap) < 1e-9) {
    return fail('ALIGN_NO_CHANGE', `"${element.name}" já está alinhada com a referência.`);
  }
  const delta = scale2(normal, gap);
  if (element.kind !== 'wall') return moveArchElements(project, [element.id], delta);
  const { dir } = wallAxes(element);
  if (Math.abs(cross2(dir, r)) <= PARALLEL_SINE) return shiftWallWithJoins(project, element, delta);
  // Aresta de topo: a extremidade anda ao longo da parede até a aresta chegar à referência.
  const middle = scale2(add2(edge.a, edge.b), 0.5);
  const end = offsetAlongWall(element, middle) < wallLength(element) / 2 ? 'start' : 'end';
  const moved = add2(element[end], scale2(dir, gap / dot2(dir, normal)));
  const start = end === 'start' ? moved : element.start;
  const finish = end === 'end' ? moved : element.end;
  if (!keepsSense(element, start, finish)) return collapsed(element);
  return commit(
    project,
    putElements(project.architecture, reshapedWall(project.architecture, element, start, finish)),
  );
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
    case 'roof': {
      // No espelho o anel é invertido para continuar anti-horário; o lado do beiral é o mesmo
      // lado físico, com o índice do anel invertido.
      const moved = element.boundary.map(t.point);
      return {
        ...element,
        ...(t.mirrored ? normalizeRoofBoundary(moved, element.eaveEdge) : { boundary: moved }),
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
