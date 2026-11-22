import {
  archLevelIdOf,
  archTypeOf,
  getArchElement,
  getArchType,
  setArchElementIfcValue,
  setArchTypeIfcValue,
  fail,
  type ArchClassification,
  type ArchElement,
  type ArchElementKind,
  type ArchType,
  type Project,
  type Result,
} from '@hydrobim/core';
import { derivedGuid, persistentGuid } from '../guid';
import {
  ARCH_IFC_ENTITIES,
  ARCH_PROPERTY_DEFINITIONS,
  findArchDefinition,
  type ArchDefinitionContext,
  type ArchPropertyDefinition,
} from './archDefinitions';
import { IFC_ENTITIES } from './schemaData';
import type {
  IfcClassification,
  IfcPropertyInfo,
  IfcPropertySetInfo,
  IfcScope,
  IfcValue,
} from './types';
import { checkIfcValue } from './values';

/**
 * Modelo de informação IFC da ARQUITETURA: classificação, atributos, tipos (`Ifc…Type`),
 * conjuntos de propriedades e de quantidades, camadas de material e classificações externas.
 * É derivado do projeto a cada consulta — o painel de propriedades e o arquivo exportado
 * leem a mesma estrutura, de modo que o que se vê é o que se grava.
 */

export interface ArchIfcLayer {
  readonly material: string;
  readonly thickness: number;
  /** Categoria da camada (função na composição). */
  readonly category: string;
}

export interface ArchIfcConstituent {
  /** Componente: `Frame`, `Panel` ou `Glazing`. */
  readonly name: string;
  readonly material: string;
}

export interface ArchIfcElementInfo extends IfcClassification {
  readonly elementId: string;
  readonly kind: ArchElementKind;
  readonly globalId: string;
  readonly name: string;
  readonly description: string | null;
  /** Pavimento que contém o elemento (o da hospedeira, em portas e janelas). */
  readonly levelId: string | null;
  readonly hostId: string | null;
  readonly archTypeId: string | null;
  /** Chave do `Ifc…Type`; `null` em ambientes. */
  readonly typeKey: string | null;
  /** Atributos próprios da entidade (ex.: `OverallWidth`, `LongName`). */
  readonly attributes: Readonly<Record<string, IfcValue>>;
  readonly psets: readonly IfcPropertySetInfo[];
}

export interface ArchIfcTypeInfo {
  readonly key: string;
  readonly seed: string;
  readonly globalId: string;
  readonly entity: string;
  readonly predefinedType: string;
  readonly elementType: string;
  readonly name: string;
  readonly description: string | null;
  readonly archTypeId: string;
  readonly familyId: string | null;
  /** Modelo genérico parametrizável (sem produto comercial). */
  readonly generic: boolean;
  readonly source: string | null;
  /** Atributos próprios do tipo (`OperationType`, `PartitioningType`…). */
  readonly attributes: Readonly<Record<string, IfcValue>>;
  readonly psets: readonly IfcPropertySetInfo[];
  /** Camadas de material (parede, laje, revestimento, telhado), na ordem do tipo. */
  readonly layers: readonly ArchIfcLayer[];
  /** Materiais dos componentes da esquadria, só os informados. */
  readonly constituents: readonly ArchIfcConstituent[];
  /** Folhas da janela, com o modo de abertura de cada uma (`IfcWindowPanelProperties`). */
  readonly windowPanels: readonly { readonly operation: string; readonly position: string }[];
  readonly classifications: readonly ArchClassification[];
  readonly memberIds: readonly string[];
}

export interface ArchIfcModel {
  readonly elements: readonly ArchIfcElementInfo[];
  readonly types: readonly ArchIfcTypeInfo[];
}

const LAYER_CATEGORIES: Record<string, string> = {
  structure: 'LoadBearing',
  substrate: 'Substrate',
  finish: 'Finish',
  insulation: 'Insulation',
  membrane: 'Membrane',
  other: 'Other',
};

/** Classificação IFC de um elemento arquitetônico (entidade e tipo predefinido). */
export function classifyArchElement(
  element: ArchElement,
  type: ArchType | undefined,
): IfcClassification {
  const entity = ARCH_IFC_ENTITIES[element.kind];
  if (element.kind === 'space') {
    // SPACE = espaço sem outra categoria; INTERNAL/EXTERNAL só quando o usuário informou.
    const external = element.ifc?.['Pset_SpaceCommon.IsExternal'];
    return {
      entity,
      predefinedType: external === true ? 'EXTERNAL' : external === false ? 'INTERNAL' : 'SPACE',
      objectType: 'space',
    };
  }
  return {
    entity,
    predefinedType: type?.ifcPredefinedType ?? 'NOTDEFINED',
    objectType: element.kind,
  };
}

/** Portas e janelas com dobradiça lateral têm um `Ifc…Type` por mão (o IFC a põe no tipo). */
function handed(type: ArchType): boolean {
  if (type.category === 'door') return type.operation !== 'doubleSwing';
  return type.category === 'window' && type.operation === 'casement' && type.panels === 1;
}

/** Chave do `Ifc…Type` de uma ocorrência: o tipo do projeto e, quando conta, a mão. */
export function archIfcTypeKey(element: ArchElement, type: ArchType): string {
  const hand =
    (element.kind === 'door' || element.kind === 'window') && handed(type)
      ? `|${element.hand}`
      : '';
  return `${type.id}${hand}`;
}

function doorOperation(
  type: Extract<ArchType, { category: 'door' }>,
  hand: 'left' | 'right',
): Record<string, IfcValue> {
  const side = hand === 'left' ? 'LEFT' : 'RIGHT';
  switch (type.operation) {
    case 'singleSwing':
      return { OperationType: `SINGLE_SWING_${side}` };
    case 'doubleSwing':
      return { OperationType: 'DOUBLE_DOOR_SINGLE_SWING' };
    case 'sliding':
      return { OperationType: `SLIDING_TO_${side}` };
    case 'pivot':
      // A enumeração não tem porta pivotante de eixo vertical deslocado.
      return { OperationType: 'USERDEFINED', UserDefinedOperationType: 'PIVOT' };
  }
}

function windowPartitioning(
  type: Extract<ArchType, { category: 'window' }>,
): Record<string, IfcValue> {
  if (type.panels === 1) return { PartitioningType: 'SINGLE_PANEL' };
  if (type.panels === 2) return { PartitioningType: 'DOUBLE_PANEL_VERTICAL' };
  if (type.panels === 3) return { PartitioningType: 'TRIPLE_PANEL_VERTICAL' };
  return {
    PartitioningType: 'USERDEFINED',
    UserDefinedPartitioningType: `${type.panels} folhas verticais`,
  };
}

function windowPanels(
  type: Extract<ArchType, { category: 'window' }>,
  hand: 'left' | 'right',
): { operation: string; position: string }[] {
  // O esquema só nomeia as posições de até três folhas lado a lado.
  if (type.panels > 3) return [];
  const positions =
    type.panels === 1
      ? ['MIDDLE']
      : type.panels === 2
        ? ['LEFT', 'RIGHT']
        : ['LEFT', 'MIDDLE', 'RIGHT'];
  return positions.map((position, index) => {
    let operation: string;
    switch (type.operation) {
      case 'fixed':
        operation = 'FIXEDCASEMENT';
        break;
      case 'sliding':
        operation = 'SLIDINGHORIZONTAL';
        break;
      case 'pivotHorizontal':
        operation = 'PIVOTHORIZONTAL';
        break;
      case 'topHung':
        operation = 'TOPHUNG';
        break;
      case 'casement':
        // Folha única: a mão da ocorrência; várias: cada folha se articula na sua ombreira.
        operation =
          type.panels === 1
            ? hand === 'left'
              ? 'SIDEHUNGLEFTHAND'
              : 'SIDEHUNGRIGHTHAND'
            : index < type.panels / 2
              ? 'SIDEHUNGLEFTHAND'
              : 'SIDEHUNGRIGHTHAND';
        break;
    }
    return { operation, position };
  });
}

function resolveProperty(
  definition: ArchPropertyDefinition,
  context: ArchDefinitionContext,
  overrides: Readonly<Record<string, IfcValue>> | undefined,
): IfcPropertyInfo {
  const key = `${definition.set}.${definition.name}`;
  const automatic = definition.resolve(context);
  const stored = definition.editable ? overrides?.[key] : undefined;
  const user =
    stored !== undefined && checkIfcValue(definition, stored) === null ? stored : undefined;
  return {
    key,
    set: definition.set,
    name: definition.name,
    label: definition.label,
    kind: definition.kind,
    ifcType: definition.ifcType,
    unit: definition.unit,
    ...(definition.enumeration ? { enumeration: definition.enumeration } : {}),
    value: user ?? automatic?.value ?? null,
    origin: user !== undefined ? 'user' : (automatic?.origin ?? 'pending'),
    required: false,
    editable: definition.editable,
    binding: definition.binding,
    group: definition.group,
  };
}

/**
 * Conjuntos de um escopo. Propriedades editáveis aparecem sempre (sem valor = pendente);
 * derivadas e quantidades só quando o modelo tem o dado.
 */
function sets(
  scope: IfcScope,
  kind: ArchElementKind,
  context: ArchDefinitionContext,
  overrides: Readonly<Record<string, IfcValue>> | undefined,
): IfcPropertySetInfo[] {
  const grouped = new Map<
    string,
    { definition: ArchPropertyDefinition; properties: IfcPropertyInfo[] }
  >();
  for (const definition of ARCH_PROPERTY_DEFINITIONS) {
    if (definition.scope !== scope || !definition.classes.includes(kind)) continue;
    const property = resolveProperty(definition, context, overrides);
    if (property.value === null && !definition.editable) continue;
    const entry = grouped.get(definition.set);
    if (entry) entry.properties.push(property);
    else grouped.set(definition.set, { definition, properties: [property] });
  }
  return [...grouped.entries()].map(([name, { definition, properties }]) => ({
    name,
    kind: definition.kind === 'quantity' ? 'qto' : 'pset',
    standard: definition.standard,
    scope,
    description: null,
    properties,
  }));
}

/** `HydroBIM_Propriedades`: propriedades livres do usuário. */
function freeSet(element: ArchElement): IfcPropertySetInfo | null {
  const entries = Object.entries(element.properties).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  if (entries.length === 0) return null;
  const set = 'HydroBIM_Propriedades';
  return {
    name: set,
    kind: 'pset',
    standard: false,
    scope: 'occurrence',
    description: null,
    properties: entries.map(([name, value]) => ({
      key: `${set}.${name}`,
      set,
      name,
      label: name,
      kind: 'single',
      ifcType:
        typeof value === 'string'
          ? 'IfcText'
          : typeof value === 'boolean'
            ? 'IfcBoolean'
            : 'IfcReal',
      unit: 'none',
      value,
      origin: 'user',
      required: false,
      editable: false,
      binding: null,
      group: 'identification',
    })),
  };
}

const KIND_OF_CATEGORY: Record<ArchType['category'], ArchElementKind> = {
  wall: 'wall',
  slab: 'slab',
  flooring: 'flooring',
  roof: 'roof',
  door: 'door',
  window: 'window',
};

function typeInfo(
  project: Pick<Project, 'id' | 'levels' | 'architecture'>,
  type: ArchType,
  key: string,
  sample: ArchElement | undefined,
): ArchIfcTypeInfo {
  const kind = KIND_OF_CATEGORY[type.category];
  const entity = IFC_ENTITIES[ARCH_IFC_ENTITIES[kind]]?.typeEntity;
  if (!entity) throw new Error(`Entidade sem tipo no esquema: ${ARCH_IFC_ENTITIES[kind]}.`);
  const hand = sample?.kind === 'door' || sample?.kind === 'window' ? sample.hand : 'left';
  const seed = `${project.id}:arch-type:${key}`;
  const constituents: ArchIfcConstituent[] = [];
  if (type.category === 'door' || type.category === 'window') {
    if (type.materials.frame) constituents.push({ name: 'Frame', material: type.materials.frame });
    if (type.materials.panel) constituents.push({ name: 'Panel', material: type.materials.panel });
    if (type.materials.glazing)
      constituents.push({ name: 'Glazing', material: type.materials.glazing });
  }
  const suffix = key !== type.id ? ` — ${hand === 'left' ? 'esquerda' : 'direita'}` : '';
  return {
    key,
    seed,
    globalId: derivedGuid(seed),
    entity,
    predefinedType: type.ifcPredefinedType,
    elementType: type.category,
    name: `${type.name}${suffix}`,
    description: type.generic
      ? 'Modelo genérico parametrizável: dimensões e composição definidas pelo usuário, sem produto comercial.'
      : `Produto de fabricante. Fonte: ${type.source ?? ''}`,
    archTypeId: type.id,
    familyId: type.familyId,
    generic: type.generic,
    source: type.source,
    attributes:
      type.category === 'door'
        ? doorOperation(type, hand)
        : type.category === 'window'
          ? windowPartitioning(type)
          : {},
    psets: sets('type', kind, { project, element: sample, type }, type.ifc),
    layers:
      'layers' in type
        ? type.layers.map((layer) => ({
            material: layer.material,
            thickness: layer.thickness,
            category: LAYER_CATEGORIES[layer.function] ?? 'Other',
          }))
        : [],
    constituents,
    windowPanels: type.category === 'window' ? windowPanels(type, hand) : [],
    classifications: type.classifications,
    memberIds: [],
  };
}

/** Constrói o modelo de informação IFC da arquitetura do projeto (função pura). */
export function buildArchIfcModel(
  project: Pick<Project, 'id' | 'levels' | 'architecture'>,
): ArchIfcModel {
  const { architecture } = project;
  const elements: ArchIfcElementInfo[] = [];
  const types = new Map<string, ArchIfcTypeInfo & { memberIds: string[] }>();

  for (const element of architecture.elements) {
    const type = archTypeOf(architecture, element);
    const classification = classifyArchElement(element, type);
    const context: ArchDefinitionContext = { project, element, type };
    const psets = sets('occurrence', element.kind, context, element.ifc);
    const free = freeSet(element);
    if (free) psets.push(free);

    const attributes: Record<string, IfcValue> = {};
    if ((element.kind === 'door' || element.kind === 'window') && type && 'width' in type) {
      attributes.OverallWidth = type.width;
      attributes.OverallHeight = type.height;
      Object.assign(
        attributes,
        type.category === 'door' ? doorOperation(type, element.hand) : windowPartitioning(type),
      );
    }
    if (element.kind === 'space') {
      attributes.LongName = element.name;
      attributes.Name = element.number ?? element.name;
    }

    let typeKey: string | null = null;
    if (type) {
      typeKey = archIfcTypeKey(element, type);
      let entry = types.get(typeKey);
      if (!entry) {
        entry = { ...typeInfo(project, type, typeKey, element), memberIds: [] };
        types.set(typeKey, entry);
      }
      entry.memberIds.push(element.id);
    }

    const custom = element.ifc?.Description;
    elements.push({
      ...classification,
      elementId: element.id,
      kind: element.kind,
      globalId: persistentGuid(element.id),
      name: element.name,
      description: typeof custom === 'string' && custom.trim() ? custom : null,
      levelId: archLevelIdOf(architecture, element),
      hostId: element.kind === 'door' || element.kind === 'window' ? element.hostId : null,
      archTypeId: type?.id ?? null,
      typeKey,
      attributes,
      psets,
    });
  }

  // Tipos sem ocorrência também fazem parte do projeto e aparecem no catálogo.
  for (const type of architecture.types) {
    if ([...types.values()].some((entry) => entry.archTypeId === type.id)) continue;
    types.set(type.id, { ...typeInfo(project, type, type.id, undefined), memberIds: [] });
  }

  return { elements, types: [...types.values()] };
}

/** Parâmetros disponíveis de um tipo ainda sem ocorrências (catálogo e editor de tipos). */
export function archTypeProperties(
  project: Pick<Project, 'id' | 'levels' | 'architecture'>,
  typeId: string,
): IfcPropertySetInfo[] {
  const type = getArchType(project.architecture, typeId);
  if (!type) return [];
  return sets(
    'type',
    KIND_OF_CATEGORY[type.category],
    { project, element: undefined, type },
    type.ifc,
  );
}

export interface ArchIfcValueTarget {
  /** Elemento selecionado; nos valores de tipo, identifica o tipo dele. */
  readonly elementId?: string;
  /** Tipo, quando o valor é informado direto no catálogo (sem ocorrência). */
  readonly typeId?: string;
  readonly scope: IfcScope;
}

/**
 * Informa (ou limpa, com `null`) uma propriedade IFC editável da arquitetura: no tipo vale
 * para todas as ocorrências dele; na ocorrência, só para ela. O valor é conferido contra o
 * tipo de valor e a enumeração do esquema. Nada na geometria muda.
 */
export function setArchIfcValue(
  project: Project,
  target: ArchIfcValueTarget,
  key: string,
  value: IfcValue | null,
): Result<Project> {
  const element = target.elementId
    ? getArchElement(project.architecture, target.elementId)
    : undefined;
  if (target.elementId && !element) return fail('ARCH_ELEMENT_NOT_FOUND', 'Elemento inexistente.');
  const type = element
    ? archTypeOf(project.architecture, element)
    : getArchType(project.architecture, target.typeId ?? '');
  const kind = element?.kind ?? (type ? KIND_OF_CATEGORY[type.category] : undefined);
  if (!kind) return fail('ARCH_TYPE_NOT_FOUND', 'Tipo inexistente.');

  if (key === 'Description' && target.scope === 'occurrence' && element) {
    if (value !== null && typeof value !== 'string')
      return fail('IFC_VALUE_INVALID', 'Descrição: o valor deve ser um texto.');
    const text = value?.trim() ?? '';
    return setArchElementIfcValue(project, element.id, key, text.length ? text : undefined);
  }

  const definition = findArchDefinition(key, target.scope, kind);
  if (!definition)
    return fail(
      'IFC_PROPERTY_NOT_APPLICABLE',
      `A propriedade ${key} não se aplica a este elemento.`,
    );
  if (!definition.editable)
    return fail(
      'IFC_PROPERTY_NOT_EDITABLE',
      `${definition.label} é derivada do modelo${definition.binding ? ` (${definition.binding})` : ''} e não pode ser editada aqui.`,
    );
  const stored = typeof value === 'string' ? value.trim() : value;
  if (stored !== null) {
    const problem = checkIfcValue(definition, stored);
    if (problem) return fail('IFC_VALUE_INVALID', `${definition.label}: ${problem}.`);
  }
  if (target.scope === 'type') {
    if (!type) return fail('ARCH_TYPE_NOT_FOUND', 'O elemento não tem tipo.');
    return setArchTypeIfcValue(project, type.id, key, stored ?? undefined);
  }
  if (!element) return fail('ARCH_ELEMENT_NOT_FOUND', 'Selecione um elemento.');
  return setArchElementIfcValue(project, element.id, key, stored ?? undefined);
}
