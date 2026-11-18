import {
  AXIS_X,
  AXIS_Z,
  dot,
  findConnection,
  getElement,
  getPorts,
  normalize,
  oppositeRef,
  pipeLength,
  radToDeg,
  scale,
  sub,
  TANK_NOZZLE_ROLE_LABELS,
  TANK_TYPE_LABELS,
  tankNozzlePorts,
  tankTypeOf,
  type EndTreatment,
  type HydroElement,
  type JointType,
  type Material,
  type Port,
  type Project,
  type SystemKind,
  type Tank,
  type TankFamily,
  type TankNozzlePort,
} from '@hydrobim/core';
import { derivedGuid, persistentGuid } from '../guid';
import {
  definitionApplies,
  IFC_PROPERTY_DEFINITIONS,
  type IfcDefinitionContext,
  type IfcPropertyDefinition,
} from './definitions';
import { IFC_ENTITIES, IFC_SCHEMA_ID } from './schemaData';
import { STRUCTURAL_STEEL, tankOccurrenceSets, tankTypeSets } from './tankSets';
import type {
  IfcClassification,
  IfcElementInfo,
  IfcFamilyInfo,
  IfcMaterialInfo,
  IfcModel,
  IfcPortInfo,
  IfcPropertyInfo,
  IfcPropertySetInfo,
  IfcScope,
  IfcSystemInfo,
  IfcTypeInfo,
  IfcValue,
} from './types';
import { checkIfcValue, ownProperty, standardProperty } from './values';

export interface IfcModelOptions {
  /** Famílias de conexões, válvulas e tubos flangeados (catálogo + projeto). */
  families?: readonly IfcFamilyInfo[];
  /** Famílias de reservatórios (catálogo + projeto). */
  tankFamilies?: readonly TankFamily[];
}

export const SYSTEM_TYPES: Record<SystemKind, string> = {
  domesticColdWater: 'DOMESTICCOLDWATER',
  domesticHotWater: 'DOMESTICHOTWATER',
  fireProtection: 'FIREPROTECTION',
  waterSupply: 'WATERSUPPLY',
  other: 'USERDEFINED',
};

export const MATERIAL_NAMES: Record<Material, string> = {
  pvc: 'PVC',
  hdpe: 'PEAD',
  ductileIron: 'Ferro fundido dúctil',
  carbonSteel: 'Aço-carbono',
};

const JOINT_LABELS: Record<JointType, string> = {
  solventWeld: 'Soldável (adesivo)',
  socketSpigot: 'Ponta e bolsa com junta elástica',
  buttFusion: 'Termofusão de topo',
  buttWeld: 'Solda de topo',
  flanged: 'Flangeada',
  threaded: 'Roscada',
};
/** `PEnum_PipeEndStyleTreatment`: adesivo e junta elástica não têm item próprio (OTHER). */
const JOINT_CONNECTION: Record<JointType, string> = {
  solventWeld: 'OTHER',
  socketSpigot: 'OTHER',
  buttFusion: 'WELDED',
  buttWeld: 'WELDED',
  flanged: 'FLANGED',
  threaded: 'THREADED',
};
const END_LABELS: Record<EndTreatment['type'], string> = {
  plain: 'Ponta lisa',
  socket: 'Bolsa',
  flange: 'Flange',
};

/** Reservatório de família de catálogo (forma construtiva definida). */
export const isCatalogTank = (element: HydroElement): boolean =>
  element.kind === 'tank' && tankTypeOf(element) !== 'generic';

/** Entidade IFC, tipo predefinido e tipo interno de um elemento. */
export function classifyElement(element: HydroElement): IfcClassification {
  switch (element.kind) {
    case 'pipe':
      return { entity: 'IfcPipeSegment', predefinedType: 'RIGIDSEGMENT', objectType: 'pipe' };
    case 'elbow':
      return { entity: 'IfcPipeFitting', predefinedType: 'BEND', objectType: 'elbow' };
    case 'tee':
      return { entity: 'IfcPipeFitting', predefinedType: 'JUNCTION', objectType: 'tee' };
    case 'reducer':
      return { entity: 'IfcPipeFitting', predefinedType: 'TRANSITION', objectType: 'reducer' };
    case 'pump':
      return { entity: 'IfcPump', predefinedType: 'ENDSUCTION', objectType: 'pump' };
    case 'tank':
      return { entity: 'IfcTank', predefinedType: 'STORAGE', objectType: 'tank' };
    case 'valve':
      // O filtro Y é um tipo interno de "válvula" (peça em linha), mas no IFC é IfcFilter.
      if (element.valveType === 'strainer')
        return { entity: 'IfcFilter', predefinedType: 'STRAINER', objectType: 'strainer' };
      return {
        entity: 'IfcValve',
        predefinedType: {
          gate: 'ISOLATING',
          ball: 'ISOLATING',
          butterfly: 'ISOLATING',
          globe: 'REGULATING',
          check: 'CHECK',
          airRelease: 'AIRRELEASE',
          pressureReducing: 'PRESSUREREDUCING',
        }[element.valveType],
        objectType: element.valveType,
      };
  }
}

const round = (value: number): string => String(Math.round(value * 1e6) / 1e6);

/** Chave do tipo de um reservatório de catálogo (a mesma das exportações anteriores). */
const catalogTankKey = (tank: Tank): string =>
  tank.variantId
    ? JSON.stringify([
        tank.familyId,
        tank.variantId,
        tank.compartments ?? 1,
        tank.accessories?.manhole ?? false,
      ])
    : JSON.stringify(['custom', tank.id]);

/**
 * Chave do tipo IFC de um elemento: elementos com a mesma chave compartilham o `Ifc…Type`
 * e os valores informados para o tipo (`Project.ifcTypes`). Reúne tudo o que define o
 * produto — família, especificação, diâmetros, dimensões e dados de fabricação — e nada
 * que seja da ocorrência (posição, nome, sistema).
 */
export function ifcTypeKey(element: HydroElement): string {
  if (element.kind === 'tank' && isCatalogTank(element)) return `tank|${catalogTankKey(element)}`;
  const spec = element.spec;
  const family = element.familyId ?? 'generic';
  const maker = [
    element.manufacturing.manufacturer,
    element.manufacturing.model,
    element.manufacturing.partNumber,
  ];
  const parts: (string | number | undefined)[] = [];
  switch (element.kind) {
    case 'pipe':
      parts.push(
        'pipe',
        family,
        spec.specificationId,
        spec.dn,
        ...(['start', 'end'] as const).map((id) => {
          const end = element.ends?.[id];
          return end ? `${end.type}:${round(end.outerDiameter)}:${round(end.length)}` : 'plain';
        }),
      );
      break;
    case 'elbow':
      parts.push(
        'elbow',
        family,
        spec.specificationId,
        spec.dn,
        round(radToDeg(element.angle)),
        round(element.bendRadius),
        // Trechos retos distinguem a curva ponta e bolsa do joelho de mesmo raio.
        ...(element.straight ? [round(element.straight.a), round(element.straight.b)] : []),
      );
      break;
    case 'tee':
      parts.push(
        'tee',
        family,
        spec.specificationId,
        spec.dn,
        element.branchSpec?.specificationId,
        element.branchSpec?.dn,
        round(element.runLength),
        round(element.branchLength),
      );
      break;
    case 'reducer':
      parts.push(
        'reducer',
        family,
        spec.specificationId,
        spec.dn,
        element.outletSpec.specificationId,
        element.outletSpec.dn,
        round(element.length),
      );
      break;
    case 'valve':
      parts.push(
        'valve',
        element.valveType,
        family,
        spec.specificationId,
        spec.dn,
        round(element.length),
        element.height === undefined ? undefined : round(element.height),
        element.width === undefined ? undefined : round(element.width),
        element.handwheelDiameter === undefined ? undefined : round(element.handwheelDiameter),
      );
      break;
    case 'pump':
      parts.push(
        'pump',
        spec.specificationId,
        spec.dn,
        element.dischargeSpec.specificationId,
        element.dischargeSpec.dn,
        round(element.length),
        element.ratedFlow === undefined ? undefined : round(element.ratedFlow),
        element.ratedHead === undefined ? undefined : round(element.ratedHead),
      );
      break;
    case 'tank':
      parts.push(
        'tank',
        'generic',
        round(element.diameter),
        round(element.height),
        element.nominalCapacity === undefined ? undefined : round(element.nominalCapacity),
      );
      break;
  }
  if (maker.some((item) => item)) parts.push(...maker.map((item) => item ?? ''));
  for (const [id, end] of Object.entries(element.kind === 'pipe' ? {} : element.ends).sort(
    ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
  ))
    parts.push(`${id}:${end.type}`);
  return parts.map((part) => part ?? '').join('|');
}

const KIND_LABELS: Record<HydroElement['kind'], string> = {
  pipe: 'Tubo',
  elbow: 'Joelho/curva',
  tee: 'Tê',
  reducer: 'Redução',
  valve: 'Válvula',
  pump: 'Conjunto motobomba',
  tank: 'Reservatório',
};
const VALVE_NAMES: Record<string, string> = {
  gate: 'Válvula de gaveta',
  globe: 'Válvula globo',
  ball: 'Válvula de esfera',
  butterfly: 'Válvula borboleta',
  check: 'Válvula de retenção',
  airRelease: 'Ventosa',
  pressureReducing: 'Válvula redutora de pressão',
  strainer: 'Filtro Y',
};

/** Designação do diâmetro (ou das dimensões) de um tipo. */
function sizeText(element: HydroElement): string {
  const size = element.spec.sizeLabel;
  switch (element.kind) {
    case 'elbow':
      return `${String(Math.round(radToDeg(element.angle) * 100) / 100).replace('.', ',')}° ${size}`;
    case 'tee':
      return element.branchSpec ? `${size} × ${element.branchSpec.sizeLabel}` : size;
    case 'reducer':
      return `${size} × ${element.outletSpec.sizeLabel}`;
    case 'pump':
      return `${size} × ${element.dischargeSpec.sizeLabel}`;
    case 'tank':
      return `Ø ${element.diameter.toLocaleString('pt-BR')} m × ${element.height.toLocaleString('pt-BR')} m`;
    default:
      return size;
  }
}

function typeName(element: HydroElement, family: IfcFamilyInfo | undefined): string {
  if (element.kind === 'tank' && isCatalogTank(element))
    return element.manufacturing.model ?? TANK_TYPE_LABELS[tankTypeOf(element)];
  if (family) return `${family.name} — ${sizeText(element)}`;
  const label =
    element.kind === 'valve'
      ? (VALVE_NAMES[element.valveType] ?? 'Válvula')
      : KIND_LABELS[element.kind];
  if (element.kind === 'pipe')
    return `${label} ${MATERIAL_NAMES[element.spec.material]} ${element.spec.standard} — ${sizeText(element)}`;
  return `${label} ${sizeText(element)}`;
}

function typeDescription(element: HydroElement, family: IfcFamilyInfo | undefined): string | null {
  if (element.kind === 'tank' && isCatalogTank(element))
    return TANK_TYPE_LABELS[tankTypeOf(element)];
  if (family) return `Família de catálogo. Fonte: ${family.source}`;
  if (element.kind === 'pipe') return 'Tubo da especificação do catálogo de tubos.';
  if (element.kind === 'pump' || element.kind === 'tank')
    return 'Representação genérica; sem identificação de produto comercial.';
  return 'Dimensões genéricas; sem identificação de produto comercial.';
}

function elementDescription(element: HydroElement): string | null {
  const custom = element.ifc?.Description;
  if (typeof custom === 'string' && custom.trim().length > 0) return custom;
  if (element.kind === 'pipe') return null;
  if (isCatalogTank(element))
    return 'Geometria paramétrica da forma construtiva da família; dimensões principais do catálogo ou do usuário. Chapas, acessórios e bocais são representação ou configuração do usuário.';
  return element.familyId === null
    ? 'Geometria genérica; dimensões livres, sem identificação de produto comercial.'
    : 'Geometria simplificada; dimensões principais da família de catálogo.';
}

/** Resolve uma definição: valor do modelo, substituído pelo do usuário quando houver. */
function resolveProperty(
  definition: IfcPropertyDefinition,
  context: IfcDefinitionContext,
  overrides: Readonly<Record<string, IfcValue>> | undefined,
): IfcPropertyInfo {
  const key = `${definition.set}.${definition.name}`;
  const automatic = definition.resolve(context);
  const stored = definition.editable ? overrides?.[key] : undefined;
  // Um valor guardado que deixou de ser válido é ignorado aqui e apontado pela validação.
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
    required: definition.required,
    editable: definition.editable,
    binding: definition.binding,
  };
}

/** Conjuntos de um escopo, na ordem do registro. Sem valor, só ficam os campos a informar. */
function registrySets(
  scope: IfcScope,
  context: IfcDefinitionContext,
  overrides: Readonly<Record<string, IfcValue>> | undefined,
): IfcPropertySetInfo[] {
  const sets = new Map<
    string,
    { definition: IfcPropertyDefinition; properties: IfcPropertyInfo[] }
  >();
  for (const definition of IFC_PROPERTY_DEFINITIONS) {
    if (definition.scope !== scope || !definitionApplies(definition, context)) continue;
    const property = resolveProperty(definition, context, overrides);
    if (property.value === null) {
      if (definition.kind === 'quantity') continue;
      if (!definition.editable && !definition.required) continue;
    }
    const entry = sets.get(definition.set);
    if (entry) entry.properties.push(property);
    else sets.set(definition.set, { definition, properties: [property] });
  }
  return [...sets.entries()].map(([name, { definition, properties }]) => ({
    name,
    kind: definition.kind === 'quantity' ? 'qto' : 'pset',
    standard: definition.standard,
    scope,
    description: null,
    properties,
  }));
}

/** `HydroBIM_Especificacao`: especificação dimensional do elemento (ocorrência). */
function specificationSet(element: HydroElement): IfcPropertySetInfo {
  const set = 'HydroBIM_Especificacao';
  const spec = element.spec;
  const length = 'IfcPositiveLengthMeasure';
  const properties = [
    ownProperty(set, 'NominalDiameter', 'Diâmetro nominal', 'IfcLabel', spec.sizeLabel, 'catalog'),
    ownProperty(set, 'DN', 'DN', 'IfcReal', spec.dn, 'catalog'),
    ownProperty(set, 'OuterDiameter', 'Diâmetro externo', length, spec.outerDiameter, 'catalog'),
    ownProperty(set, 'InnerDiameter', 'Diâmetro interno', length, spec.innerDiameter, 'catalog'),
    ownProperty(set, 'WallThickness', 'Espessura da parede', length, spec.wallThickness, 'catalog'),
    ownProperty(set, 'Standard', 'Norma', 'IfcLabel', spec.standard, 'catalog'),
    ownProperty(
      set,
      'PressureClass',
      'Classe de pressão',
      'IfcLabel',
      spec.pressureClass,
      'catalog',
    ),
    ownProperty(set, 'JointType', 'Tipo de junta', 'IfcLabel', spec.jointType, 'catalog'),
    ownProperty(set, 'Material', 'Material', 'IfcLabel', MATERIAL_NAMES[spec.material], 'catalog'),
  ];
  if (element.familyId !== null)
    properties.push(
      ownProperty(set, 'FamilyId', 'Família', 'IfcLabel', element.familyId, 'catalog'),
    );
  if (element.kind === 'reducer')
    properties.push(
      ownProperty(
        set,
        'OutletNominalDiameter',
        'Diâmetro nominal da saída',
        'IfcLabel',
        element.outletSpec.sizeLabel,
        'catalog',
      ),
      ownProperty(
        set,
        'OutletOuterDiameter',
        'Diâmetro externo da saída',
        length,
        element.outletSpec.outerDiameter,
        'catalog',
      ),
    );
  if (element.kind === 'pipe') {
    properties.push(
      ownProperty(set, 'Length', 'Comprimento', length, pipeLength(element), 'geometry'),
    );
    // Tubo com flanges: acabamento de cada extremidade e dimensões do flange de catálogo.
    for (const [portId, end] of Object.entries(element.ends ?? {}).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      const prefix = portId === 'start' ? 'StartFlange' : 'EndFlange';
      const where = portId === 'start' ? 'início' : 'fim';
      properties.push(
        ownProperty(
          set,
          `${prefix}OuterDiameter`,
          `Flange (${where}) — diâmetro`,
          length,
          end.outerDiameter,
          'catalog',
        ),
        ownProperty(
          set,
          `${prefix}Thickness`,
          `Flange (${where}) — espessura`,
          length,
          end.length,
          'catalog',
        ),
      );
      if (end.boltCircle !== undefined && end.boltCount !== undefined)
        properties.push(
          ownProperty(
            set,
            `${prefix}BoltCircle`,
            `Flange (${where}) — círculo de furação`,
            length,
            end.boltCircle,
            'catalog',
          ),
          ownProperty(
            set,
            `${prefix}BoltCount`,
            `Flange (${where}) — furos`,
            'IfcInteger',
            end.boltCount,
            'catalog',
          ),
        );
    }
  }
  if (element.kind === 'elbow')
    properties.push(
      ownProperty(set, 'Angle', 'Ângulo', 'IfcPlaneAngleMeasure', element.angle, 'geometry'),
      ownProperty(
        set,
        'BendRadius',
        'Raio de curvatura',
        length,
        element.bendRadius,
        element.familyId === null ? 'model' : 'catalog',
      ),
    );
  return {
    name: set,
    kind: 'pset',
    standard: false,
    scope: 'occurrence',
    description:
      element.kind === 'tank' ? 'Especificação da tubulação dos bocais de entrada e saída' : null,
    properties,
  };
}

/** `HydroBIM_Propriedades`: propriedades livres definidas pelo usuário. */
function freeSet(element: HydroElement): IfcPropertySetInfo | null {
  const set = 'HydroBIM_Propriedades';
  const entries = Object.entries(element.properties).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  if (entries.length === 0) return null;
  return {
    name: set,
    kind: 'pset',
    standard: false,
    scope: 'occurrence',
    description: null,
    properties: entries.map(([name, value]) =>
      ownProperty(
        set,
        name,
        name,
        typeof value === 'string'
          ? 'IfcText'
          : typeof value === 'boolean'
            ? 'IfcBoolean'
            : 'IfcReal',
        value,
        'user',
      ),
    ),
  };
}

function portSets(
  port: Port,
  index: number,
  nozzle: TankNozzlePort | undefined,
): IfcPropertySetInfo[] {
  const common = 'Pset_DistributionPortCommon';
  const pipe = 'Pset_DistributionPortTypePipe';
  const flanged = port.end?.type === 'flange';
  const sets: IfcPropertySetInfo[] = [
    {
      name: common,
      kind: 'pset',
      standard: true,
      scope: 'occurrence',
      description: null,
      properties: [standardProperty(common, 'PortNumber', 'Número da porta', index + 1, 'model')],
    },
    {
      name: pipe,
      kind: 'pset',
      standard: true,
      scope: 'occurrence',
      description: null,
      properties: [
        standardProperty(
          pipe,
          'ConnectionType',
          'Tipo de conexão',
          flanged ? 'FLANGED' : JOINT_CONNECTION[port.spec.jointType],
          port.end ? 'catalog' : 'model',
        ),
        standardProperty(
          pipe,
          'ConnectionSubtype',
          'Junta / extremidade',
          port.end ? END_LABELS[port.end.type] : JOINT_LABELS[port.spec.jointType],
          port.end ? 'catalog' : 'model',
        ),
        // NominalDiameter é a designação DN expressa como comprimento (convenção do IFC);
        // os diâmetros físicos vêm da especificação de tubo da porta.
        standardProperty(
          pipe,
          'NominalDiameter',
          'Diâmetro nominal (DN)',
          port.spec.dn / 1000,
          'catalog',
        ),
        standardProperty(
          pipe,
          'InnerDiameter',
          'Diâmetro interno',
          port.spec.innerDiameter,
          'catalog',
        ),
        standardProperty(
          pipe,
          'OuterDiameter',
          'Diâmetro externo',
          port.spec.outerDiameter,
          'catalog',
        ),
      ],
    },
  ];
  if (nozzle) {
    const set = 'HydroBIM_Bocal';
    sets.push({
      name: set,
      kind: 'pset',
      standard: false,
      scope: 'occurrence',
      description: null,
      properties: [
        ownProperty(
          set,
          'Function',
          'Função',
          'IfcLabel',
          TANK_NOZZLE_ROLE_LABELS[nozzle.role],
          'model',
        ),
        ownProperty(
          set,
          'NominalDiameterLabel',
          'Diâmetro nominal',
          'IfcLabel',
          port.spec.sizeLabel,
          'catalog',
        ),
        ownProperty(
          set,
          'HeightAboveBase',
          'Altura acima da base',
          'IfcLengthMeasure',
          nozzle.height,
          'model',
        ),
        ownProperty(
          set,
          'Azimuth',
          'Direção em planta',
          'IfcPlaneAngleMeasure',
          nozzle.azimuth,
          'model',
        ),
        ownProperty(
          set,
          'Specification',
          'Especificação',
          'IfcLabel',
          port.spec.standard,
          'catalog',
        ),
      ],
    });
  }
  return sets;
}

function materialOf(element: HydroElement): IfcMaterialInfo {
  // O material de um reservatório de catálogo é o do corpo, não o da tubulação dos bocais.
  return isCatalogTank(element)
    ? { name: STRUCTURAL_STEEL, category: 'steel' }
    : { name: MATERIAL_NAMES[element.spec.material], category: null };
}

/**
 * Constrói o modelo de informação IFC do projeto. É uma função pura e derivada: nada do
 * resultado é persistido, exceto os valores que o usuário informou (`element.ifc` e
 * `project.ifcTypes`), que ela aplica sobre os valores do modelo.
 */
export function buildIfcModel(project: Project, options: IfcModelOptions = {}): IfcModel {
  const families = new Map((options.families ?? []).map((family) => [family.id, family]));
  const tankFamilies = new Map((options.tankFamilies ?? []).map((family) => [family.id, family]));
  const systemKinds = new Map(project.systems.map((system) => [system.id, system.kind]));
  const elements: IfcElementInfo[] = [];
  const types = new Map<string, IfcTypeInfo & { memberIds: string[] }>();

  for (const element of project.elements) {
    const classification = classifyElement(element);
    const family = element.familyId === null ? undefined : families.get(element.familyId);
    const context: IfcDefinitionContext = { element, classification, family };
    const typeKey = ifcTypeKey(element);
    const kind = systemKinds.get(element.systemId);
    if (!kind) throw new Error(`Sistema inexistente em "${element.name}".`);

    const psets: IfcPropertySetInfo[] = [specificationSet(element)];
    const free = freeSet(element);
    if (free) psets.push(free);
    if (element.kind === 'tank' && isCatalogTank(element))
      psets.push(...tankOccurrenceSets(element, tankFamilies.get(element.familyId ?? '')));
    psets.push(...registrySets('occurrence', context, element.ifc));

    const nozzles =
      element.kind === 'tank'
        ? new Map(tankNozzlePorts(element).map((nozzle) => [nozzle.id, nozzle]))
        : null;
    const ports: IfcPortInfo[] = getPorts(element).map((port, index) => {
      const z = port.localDirection;
      const reference = Math.abs(dot(z, AXIS_Z)) > 0.9 ? AXIS_X : AXIS_Z;
      const nozzle = nozzles?.get(port.ref.portId);
      const connection = findConnection(project, port.ref);
      const other = connection ? oppositeRef(connection, port.ref) : undefined;
      const otherElement = other ? getElement(project, other.elementId) : undefined;
      return {
        portId: port.ref.portId,
        globalId: derivedGuid(`${element.id}:port:${port.ref.portId}`),
        name: port.label,
        description: nozzle ? `Bocal: ${TANK_NOZZLE_ROLE_LABELS[nozzle.role].toLowerCase()}` : null,
        // Bocais de reservatório têm função definida: a entrada recebe o escoamento (SINK);
        // saída, extravasor e descarga o entregam (SOURCE).
        flowDirection: nozzle ? (nozzle.role === 'inlet' ? 'SINK' : 'SOURCE') : 'NOTDEFINED',
        systemType: SYSTEM_TYPES[kind],
        localPosition: port.localPosition,
        localDirection: z,
        localReference: normalize(sub(reference, scale(z, dot(reference, z)))),
        position: port.position,
        direction: port.direction,
        psets: portSets(port, index, nozzle),
        connectedTo:
          other && otherElement
            ? { elementId: other.elementId, portId: other.portId, elementName: otherElement.name }
            : null,
      };
    });

    elements.push({
      ...classification,
      elementId: element.id,
      globalId: persistentGuid(element.id),
      name: element.name,
      description: elementDescription(element),
      tag: element.id,
      systemId: element.systemId,
      typeKey,
      material: materialOf(element),
      psets,
      ports,
    });

    const existing = types.get(typeKey);
    if (existing) {
      existing.memberIds.push(element.id);
      continue;
    }
    const catalogTank = element.kind === 'tank' && isCatalogTank(element);
    const seed = catalogTank
      ? `${project.id}:tank-type:${typeKey.slice('tank|'.length)}`
      : `${project.id}:type:${typeKey}`;
    const typeEntity = IFC_ENTITIES[classification.entity]?.typeEntity;
    if (!typeEntity) throw new Error(`Entidade sem tipo no esquema: ${classification.entity}.`);
    const tankFamily = catalogTank ? tankFamilies.get(element.familyId ?? '') : undefined;
    types.set(typeKey, {
      key: typeKey,
      seed,
      globalId: derivedGuid(seed),
      entity: typeEntity,
      predefinedType: classification.predefinedType,
      elementType: catalogTank ? tankTypeOf(element) : classification.objectType,
      name: typeName(element, family),
      description: typeDescription(element, family),
      familyId: element.familyId,
      familyName: family?.name ?? tankFamily?.name ?? null,
      catalogReference: family?.source ?? tankFamily?.source ?? null,
      material: materialOf(element),
      psets: catalogTank
        ? tankTypeSets(element)
        : registrySets('type', context, project.ifcTypes[typeKey]),
      memberIds: [element.id],
    });
  }

  const systems: IfcSystemInfo[] = project.systems.map((system) => ({
    systemId: system.id,
    globalId: derivedGuid(`${system.id}:system`),
    name: system.name,
    predefinedType: SYSTEM_TYPES[system.kind],
    objectType: system.kind === 'other' ? system.kind : null,
    memberIds: project.elements.filter((e) => e.systemId === system.id).map((e) => e.id),
  }));

  return { schema: IFC_SCHEMA_ID, elements, types: [...types.values()], systems };
}

/** Tipo IFC de um elemento do modelo. */
export const typeOfElement = (model: IfcModel, element: IfcElementInfo): IfcTypeInfo | undefined =>
  model.types.find((type) => type.key === element.typeKey);
