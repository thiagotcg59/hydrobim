import {
  elbowPortDistances,
  pipeLength,
  tankTypeOf,
  type EndTreatment,
  type HydroElement,
  type Pipe,
  type Valve,
  isCustomPumpFamilyId,
} from '@hydrobim/core';
import { IFC_PROPERTY_SETS } from './schemaData';
import type {
  IfcClassification,
  IfcEnumeration,
  IfcFamilyInfo,
  IfcScope,
  IfcUnit,
  IfcValue,
  IfcValueOrigin,
} from './types';

/**
 * Registro central das propriedades IFC. Cada definição diz a que classe de elemento se
 * aplica, em que conjunto fica, o tipo de valor, a unidade, de onde vem o valor, se o
 * perfil do projeto a exige e se o usuário pode informá-la. Não há estruturas por família:
 * famílias e ocorrências são resolvidas por estas mesmas definições.
 *
 * Nos conjuntos padronizados (`Pset_*`/`Qto_*`), o tipo de valor e a enumeração NÃO são
 * declarados aqui: vêm de `schemaData.ts`, gerado do esquema IFC 4.3. Uma propriedade que
 * não exista no esquema faz o módulo falhar ao carregar — não há como inventar uma.
 */

/** Classe de elemento do HydroBIM, para a aplicabilidade das definições. */
export type IfcElementClass =
  'pipe' | 'fitting' | 'valve' | 'strainer' | 'flowMeter' | 'pump' | 'tank';

export const IFC_CLASS_ENTITIES: Record<IfcElementClass, string> = {
  pipe: 'IfcPipeSegment',
  fitting: 'IfcPipeFitting',
  valve: 'IfcValve',
  strainer: 'IfcFilter',
  flowMeter: 'IfcFlowMeter',
  pump: 'IfcPump',
  tank: 'IfcTank',
};

export function elementClass(element: HydroElement): IfcElementClass {
  switch (element.kind) {
    case 'pipe':
      return 'pipe';
    case 'elbow':
    case 'tee':
    case 'cross':
    case 'reducer':
      return 'fitting';
    case 'valve':
      return element.valveType === 'strainer'
        ? 'strainer'
        : element.valveType === 'flowMeter'
          ? 'flowMeter'
          : 'valve';
    case 'pump':
      return 'pump';
    case 'tank':
      return 'tank';
  }
}

export interface IfcDefinitionContext {
  readonly element: HydroElement;
  readonly classification: IfcClassification;
  readonly family: IfcFamilyInfo | undefined;
}

export interface IfcResolvedValue {
  readonly value: IfcValue;
  readonly origin: Exclude<IfcValueOrigin, 'user' | 'pending'>;
}

export interface IfcPropertyDefinition {
  readonly set: string;
  readonly name: string;
  readonly label: string;
  readonly scope: IfcScope;
  readonly kind: 'single' | 'enumerated' | 'quantity';
  readonly ifcType: string;
  readonly unit: IfcUnit;
  readonly enumeration?: IfcEnumeration;
  /** Conjunto padronizado pela buildingSMART. */
  readonly standard: boolean;
  readonly classes: readonly IfcElementClass[];
  /** Condição adicional dentro da classe (tipo predefinido, existência de flange…). */
  readonly when: (context: IfcDefinitionContext) => boolean;
  /** Valor derivado do modelo; `null` = não há dado (fica pendente ou a cargo do usuário). */
  readonly resolve: (context: IfcDefinitionContext) => IfcResolvedValue | null;
  readonly required: boolean;
  readonly editable: boolean;
  readonly binding: string | null;
  /** Tipos predefinidos IFC a que se restringe; `null` = todos os da classe. */
  readonly predefinedTypes: readonly string[] | null;
}

const UNITS: Record<string, IfcUnit> = {
  IfcLengthMeasure: 'length',
  IfcPositiveLengthMeasure: 'length',
  IfcNonNegativeLengthMeasure: 'length',
  IfcAreaMeasure: 'area',
  IfcVolumeMeasure: 'volume',
  IfcPlaneAngleMeasure: 'angle',
  IfcPressureMeasure: 'pressure',
  IfcVolumetricFlowRateMeasure: 'flow',
  IfcPowerMeasure: 'power',
  IfcRotationalFrequencyMeasure: 'frequency',
  IfcRatioMeasure: 'ratio',
  IfcPositiveRatioMeasure: 'ratio',
  IfcNormalisedRatioMeasure: 'ratio',
  IfcThermalTransmittanceMeasure: 'thermalTransmittance',
  IfcQuantityLength: 'length',
  IfcQuantityArea: 'area',
  IfcQuantityVolume: 'volume',
};

export const unitOfIfcType = (ifcType: string): IfcUnit => UNITS[ifcType] ?? 'none';

const QUANTITY_TYPES: Record<string, string> = {
  Q_LENGTH: 'IfcQuantityLength',
  Q_AREA: 'IfcQuantityArea',
  Q_VOLUME: 'IfcQuantityVolume',
  Q_WEIGHT: 'IfcQuantityWeight',
  Q_COUNT: 'IfcQuantityCount',
};

/** Tipo, forma e enumeração de uma propriedade padronizada, lidos do esquema IFC 4.3. */
export function standardTemplate(
  set: string,
  name: string,
): Pick<IfcPropertyDefinition, 'kind' | 'ifcType' | 'unit' | 'enumeration'> {
  const template = IFC_PROPERTY_SETS[set]?.properties[name];
  if (!template) throw new Error(`Propriedade inexistente no esquema IFC 4.3: ${set}.${name}.`);
  if (template.kind.startsWith('Q_')) {
    const ifcType = QUANTITY_TYPES[template.kind];
    if (!ifcType) throw new Error(`Quantidade não suportada: ${set}.${name} (${template.kind}).`);
    return { kind: 'quantity', ifcType, unit: unitOfIfcType(ifcType) };
  }
  if (template.type === null) throw new Error(`Propriedade sem tipo de valor: ${set}.${name}.`);
  if (template.kind === 'P_ENUMERATEDVALUE') {
    if (!template.enumeration) throw new Error(`Enumeração ausente: ${set}.${name}.`);
    return {
      kind: 'enumerated',
      ifcType: template.type,
      unit: 'none',
      enumeration: template.enumeration,
    };
  }
  if (template.kind !== 'P_SINGLEVALUE')
    throw new Error(`Forma de propriedade não suportada: ${set}.${name} (${template.kind}).`);
  return { kind: 'single', ifcType: template.type, unit: unitOfIfcType(template.type) };
}

interface Options {
  when?: (context: IfcDefinitionContext) => boolean;
  resolve?: (context: IfcDefinitionContext) => IfcResolvedValue | null;
  required?: boolean;
  editable?: boolean;
  binding?: string;
  predefinedTypes?: readonly string[];
}

const base = (
  set: string,
  name: string,
  label: string,
  scope: IfcScope,
  classes: readonly IfcElementClass[],
  options: Options,
): Omit<IfcPropertyDefinition, 'kind' | 'ifcType' | 'unit' | 'enumeration' | 'standard'> => ({
  set,
  name,
  label,
  scope,
  classes,
  when: options.when ?? (() => true),
  resolve: options.resolve ?? (() => null),
  required: options.required ?? false,
  editable: options.editable ?? false,
  binding: options.binding ?? null,
  predefinedTypes: options.predefinedTypes ?? null,
});

/** Propriedade de um conjunto padronizado (tipo de valor vindo do esquema). */
const std = (
  set: string,
  name: string,
  label: string,
  scope: IfcScope,
  classes: readonly IfcElementClass[],
  options: Options = {},
): IfcPropertyDefinition => ({
  ...base(set, name, label, scope, classes, options),
  ...standardTemplate(set, name),
  standard: true,
});

/** Propriedade de um conjunto próprio (`HydroBIM_*`). */
const own = (
  set: string,
  name: string,
  label: string,
  scope: IfcScope,
  classes: readonly IfcElementClass[],
  ifcType: string,
  options: Options = {},
): IfcPropertyDefinition => ({
  ...base(set, name, label, scope, classes, options),
  kind: 'single',
  ifcType,
  unit: unitOfIfcType(ifcType),
  standard: false,
});

type Origin = IfcResolvedValue['origin'];
const value = (v: IfcValue | null | undefined, origin: Origin): IfcResolvedValue | null =>
  v === null || v === undefined || v === '' ? null : { value: v, origin };

const END_LABELS: Record<EndTreatment['type'], string> = {
  plain: 'Ponta lisa',
  socket: 'Bolsa',
  flange: 'Flange',
};

/** Acabamento das extremidades, na ordem das portas (ex.: "Bolsa × Bolsa × Bolsa"). */
function endTypes(element: HydroElement): string {
  const ids =
    element.kind === 'pipe'
      ? ['start', 'end']
      : element.kind === 'tee'
        ? ['a', 'b', 'branch']
        : element.kind === 'cross'
          ? ['a', 'b', 'branch', 'branch2']
          : element.kind === 'valve' && element.valveType === 'airRelease'
            ? ['a']
            : ['a', 'b'];
  return ids.map((id) => END_LABELS[element.ends?.[id]?.type ?? 'plain']).join(' × ');
}

/** Primeiro flange do tubo (os dois são iguais nos tubos flange e flange). */
const pipeFlange = (pipe: Pipe): EndTreatment | undefined =>
  [pipe.ends?.start, pipe.ends?.end].find((end) => end?.type === 'flange');

const isPipe = (e: HydroElement): e is Pipe => e.kind === 'pipe';
const isValve = (e: HydroElement): e is Valve => e.kind === 'valve';

/** Origem das dimensões de uma conexão: catálogo quando há família, senão cadastro livre. */
const dimensional = (element: HydroElement): Origin =>
  // Bomba de catálogo sem linha da tabela, ou de família personalizada: a forma é da
  // família, as cotas são do usuário.
  element.familyId === null ||
  (element.kind === 'pump' &&
    (element.variantId === undefined || isCustomPumpFamilyId(element.familyId)))
    ? 'model'
    : 'catalog';

/** Referência do tipo: família (ou especificação) e designação do diâmetro. */
function typeReference({ element }: IfcDefinitionContext): IfcResolvedValue | null {
  const size = `DN ${element.spec.dn}`;
  if (element.familyId !== null) return value(`${element.familyId} · ${size}`, 'catalog');
  if (element.kind === 'pipe') return value(`${element.spec.specificationId} · ${size}`, 'catalog');
  return null;
}

/** Comprimento ao longo do eixo, de porta a porta. */
function axisLength(element: HydroElement): number | null {
  switch (element.kind) {
    case 'pipe':
      return pipeLength(element);
    // O eixo entre as portas do joelho é o arco mais os trechos retos, quando existem.
    case 'elbow':
      return (
        element.bendRadius * element.angle + (element.straight?.a ?? 0) + (element.straight?.b ?? 0)
      );
    case 'tee':
    case 'cross':
      return element.runLength;
    case 'reducer':
      return element.length;
    default:
      return null;
  }
}

const horizontalRun = (pipe: Pipe): number =>
  Math.hypot(pipe.end.x - pipe.start.x, pipe.end.y - pipe.start.y);

const ALL: readonly IfcElementClass[] = [
  'pipe',
  'fitting',
  'valve',
  'strainer',
  'flowMeter',
  'pump',
  'tank',
];
const NOT_PIPE: readonly IfcElementClass[] = [
  'fitting',
  'valve',
  'strainer',
  'flowMeter',
  'pump',
  'tank',
];
/** Reservatório de catálogo: fabricante, modelo e tipo vêm da família (ver `tankSets.ts`). */
const notCatalogTank = ({ element }: IfcDefinitionContext): boolean =>
  !(element.kind === 'tank' && tankTypeOf(element) !== 'generic');

const VALVE_MECHANISM: Partial<Record<Valve['valveType'], string>> = {
  ball: 'BALL',
  butterfly: 'BUTTERFLY',
  globe: 'GLOBE',
};

const VALVE_LABELS: Record<Valve['valveType'], string> = {
  gate: 'Válvula de gaveta',
  globe: 'Válvula globo',
  ball: 'Válvula de esfera',
  butterfly: 'Válvula borboleta',
  check: 'Válvula de retenção',
  airRelease: 'Ventosa',
  pressureReducing: 'Válvula redutora de pressão',
  strainer: 'Filtro Y',
  flowMeter: 'Medidor de vazão',
};

const FITTING_LABEL = (element: HydroElement): string =>
  element.kind === 'elbow'
    ? 'Joelho/curva'
    : element.kind === 'tee'
      ? element.branchSpec
        ? 'Tê de redução'
        : 'Tê'
      : element.kind === 'cross'
        ? element.branchSpec
          ? 'Cruzeta de redução'
          : 'Cruzeta'
        : 'Redução';

/** Tê ou cruzeta: peças de derivação (passagem e derivação(ões) a 90°). */
const isJunction = (
  element: HydroElement,
): element is Extract<HydroElement, { kind: 'tee' | 'cross' }> =>
  element.kind === 'tee' || element.kind === 'cross';

const M = 'Pset_ManufacturerTypeInformation';
const SIZE = 'Pset_ElementSize';

export const IFC_PROPERTY_DEFINITIONS: readonly IfcPropertyDefinition[] = [
  // ----- Fabricante e produto (tipo) ------------------------------------------------------
  std(M, 'Manufacturer', 'Fabricante', 'type', ALL, {
    when: notCatalogTank,
    resolve: ({ element, family }) =>
      value(element.manufacturing.manufacturer, 'model') ?? value(family?.manufacturer, 'catalog'),
    required: true,
    editable: true,
  }),
  std(M, 'ModelLabel', 'Modelo', 'type', ALL, {
    when: notCatalogTank,
    resolve: ({ element, family }) =>
      value(element.manufacturing.model, 'model') ?? value(family?.name, 'catalog'),
    editable: true,
  }),
  std(M, 'ModelReference', 'Referência do modelo', 'type', ALL, {
    when: notCatalogTank,
    resolve: ({ element }) => value(element.familyId, 'catalog'),
    editable: true,
  }),
  std(M, 'ArticleNumber', 'Código comercial', 'type', ALL, {
    when: notCatalogTank,
    resolve: ({ element }) => value(element.manufacturing.partNumber, 'model'),
    editable: true,
  }),

  // ----- Tubos ----------------------------------------------------------------------------
  std('Pset_PipeSegmentTypeCommon', 'Reference', 'Referência do tipo', 'type', ['pipe'], {
    resolve: typeReference,
  }),
  std('Pset_PipeSegmentTypeCommon', 'NominalDiameter', 'Diâmetro nominal (DN)', 'type', ['pipe'], {
    // Convenção do IFC: a designação DN expressa como comprimento. Não é diâmetro físico.
    resolve: ({ element }) => value(element.spec.dn / 1000, 'catalog'),
    binding: 'Especificação: DN',
  }),
  std('Pset_PipeSegmentTypeCommon', 'OuterDiameter', 'Diâmetro externo', 'type', ['pipe'], {
    resolve: ({ element }) => value(element.spec.outerDiameter, 'catalog'),
    binding: 'Especificação: diâmetro externo',
  }),
  std('Pset_PipeSegmentTypeCommon', 'InnerDiameter', 'Diâmetro interno', 'type', ['pipe'], {
    resolve: ({ element }) => value(element.spec.innerDiameter, 'catalog'),
    binding: 'Especificação: diâmetro interno',
  }),
  std('Pset_PipeSegmentTypeCommon', 'WorkingPressure', 'Pressão de serviço', 'type', ['pipe'], {
    // A classe de pressão é uma designação (HydroBIM_Especificacao.PressureClass); a pressão
    // em pascal não é derivada dela: é informada pelo usuário.
    required: true,
    editable: true,
  }),
  std('Pset_PipeSegmentTypeCommon', 'Status', 'Situação', 'occurrence', ['pipe'], {
    editable: true,
  }),
  std('Pset_PipeSegmentTypeCommon', 'Length', 'Comprimento', 'occurrence', ['pipe'], {
    resolve: ({ element }) => (isPipe(element) ? value(pipeLength(element), 'geometry') : null),
    binding: 'Geometria: comprimento do tubo',
  }),
  std('Pset_PipeConnectionFlanged', 'FlangeStandard', 'Norma do flange', 'type', ['pipe'], {
    when: ({ element }) => isPipe(element) && pipeFlange(element) !== undefined,
    resolve: ({ family }) => value(family?.standard, 'catalog'),
  }),
  std('Pset_PipeConnectionFlanged', 'FlangeDiameter', 'Diâmetro do flange', 'type', ['pipe'], {
    when: ({ element }) => isPipe(element) && pipeFlange(element) !== undefined,
    resolve: ({ element }) =>
      isPipe(element) ? value(pipeFlange(element)?.outerDiameter, 'catalog') : null,
    binding: 'Flange de catálogo',
  }),
  std('Pset_PipeConnectionFlanged', 'FlangeThickness', 'Espessura do flange', 'type', ['pipe'], {
    when: ({ element }) => isPipe(element) && pipeFlange(element) !== undefined,
    resolve: ({ element }) =>
      isPipe(element) ? value(pipeFlange(element)?.length, 'catalog') : null,
    binding: 'Flange de catálogo',
  }),
  std('Pset_PipeConnectionFlanged', 'NumberOfBoltholes', 'Número de furos', 'type', ['pipe'], {
    when: ({ element }) => isPipe(element) && pipeFlange(element) !== undefined,
    resolve: ({ element }) =>
      isPipe(element) ? value(pipeFlange(element)?.boltCount, 'catalog') : null,
    binding: 'Flange de catálogo',
  }),
  std('Pset_PipeConnectionFlanged', 'BoltholePitch', 'Círculo de furação', 'type', ['pipe'], {
    when: ({ element }) => isPipe(element) && pipeFlange(element) !== undefined,
    resolve: ({ element }) =>
      isPipe(element) ? value(pipeFlange(element)?.boltCircle, 'catalog') : null,
    binding: 'Flange de catálogo',
  }),
  std(
    'Pset_PipeSegmentOccurrence',
    'InteriorRoughnessCoefficient',
    'Rugosidade interna',
    'occurrence',
    ['pipe'],
    { editable: true },
  ),
  std('Pset_PipeSegmentOccurrence', 'Gradient', 'Declividade', 'occurrence', ['pipe'], {
    // IfcPositiveRatioMeasure: só existe para trechos inclinados e não verticais.
    resolve: ({ element }) => {
      if (!isPipe(element)) return null;
      const run = horizontalRun(element);
      const rise = Math.abs(element.end.z - element.start.z);
      return run > 1e-9 && rise > 1e-9 ? value(rise / run, 'geometry') : null;
    },
    binding: 'Geometria: cotas das extremidades',
  }),
  std(
    'Pset_PipeSegmentOccurrence',
    'InvertElevation',
    'Cota da geratriz inferior',
    'occurrence',
    ['pipe'],
    {
      // Geratriz inferior interna no ponto mais baixo do eixo; sem sentido em tubo vertical.
      resolve: ({ element }) =>
        isPipe(element) && horizontalRun(element) > 1e-9
          ? value(
              Math.min(element.start.z, element.end.z) - element.spec.innerDiameter / 2,
              'geometry',
            )
          : null,
      binding: 'Geometria: cotas das extremidades',
    },
  ),
  ...(
    [
      ['StartX', 'Início — X', (p: Pipe) => p.start.x],
      ['StartY', 'Início — Y', (p: Pipe) => p.start.y],
      ['StartElevation', 'Cota inicial (eixo)', (p: Pipe) => p.start.z],
      ['EndX', 'Fim — X', (p: Pipe) => p.end.x],
      ['EndY', 'Fim — Y', (p: Pipe) => p.end.y],
      ['EndElevation', 'Cota final (eixo)', (p: Pipe) => p.end.z],
    ] as const
  ).map(([name, label, read]) =>
    own('HydroBIM_Tracado', name, label, 'occurrence', ['pipe'], 'IfcLengthMeasure', {
      resolve: ({ element }) => (isPipe(element) ? value(read(element), 'geometry') : null),
      binding: 'Geometria: extremidades do tubo',
    }),
  ),
  own(
    'HydroBIM_Tracado',
    'Slope',
    'Declividade (com sinal)',
    'occurrence',
    ['pipe'],
    'IfcRatioMeasure',
    {
      resolve: ({ element }) => {
        if (!isPipe(element)) return null;
        const run = horizontalRun(element);
        return run > 1e-9 ? value((element.end.z - element.start.z) / run, 'geometry') : null;
      },
      binding: 'Geometria: cotas das extremidades',
    },
  ),
  std('Qto_PipeSegmentBaseQuantities', 'Length', 'Comprimento', 'occurrence', ['pipe'], {
    resolve: ({ element }) => (isPipe(element) ? value(pipeLength(element), 'geometry') : null),
  }),
  std(
    'Qto_PipeSegmentBaseQuantities',
    'GrossCrossSectionArea',
    'Área da seção bruta',
    'occurrence',
    ['pipe'],
    {
      resolve: ({ element }) => value((Math.PI * element.spec.outerDiameter ** 2) / 4, 'geometry'),
    },
  ),
  std(
    'Qto_PipeSegmentBaseQuantities',
    'NetCrossSectionArea',
    'Área da seção da parede',
    'occurrence',
    ['pipe'],
    {
      resolve: ({ element: { spec } }) =>
        value((Math.PI * (spec.outerDiameter ** 2 - spec.innerDiameter ** 2)) / 4, 'geometry'),
    },
  ),
  std(
    'Qto_PipeSegmentBaseQuantities',
    'OuterSurfaceArea',
    'Área da superfície externa',
    'occurrence',
    ['pipe'],
    {
      // Superfície do corpo cilíndrico; flanges não entram.
      resolve: ({ element }) =>
        isPipe(element)
          ? value(Math.PI * element.spec.outerDiameter * pipeLength(element), 'geometry')
          : null,
    },
  ),

  // ----- Conexões -------------------------------------------------------------------------
  std('Pset_PipeFittingTypeCommon', 'Reference', 'Referência do tipo', 'type', ['fitting'], {
    resolve: typeReference,
  }),
  std('Pset_PipeFittingTypeCommon', 'PressureClass', 'Pressão nominal', 'type', ['fitting'], {
    required: true,
    editable: true,
  }),
  std(
    'Pset_PipeFittingTypeCommon',
    'FittingLossFactor',
    'Coeficiente de perda localizada (K)',
    'type',
    ['fitting'],
    { editable: true },
  ),
  std('Pset_PipeFittingTypeCommon', 'Status', 'Situação', 'occurrence', ['fitting'], {
    editable: true,
  }),
  std(
    'Pset_PipeFittingOccurrence',
    'InteriorRoughnessCoefficient',
    'Rugosidade interna',
    'occurrence',
    ['fitting'],
    { editable: true },
  ),
  own('HydroBIM_Conexao', 'FittingType', 'Tipo de conexão', 'type', ['fitting'], 'IfcLabel', {
    resolve: ({ element }) => value(FITTING_LABEL(element), 'model'),
  }),
  own('HydroBIM_Conexao', 'EndTypes', 'Extremidades', 'type', ['fitting'], 'IfcLabel', {
    resolve: ({ element }) => value(endTypes(element), dimensional(element)),
  }),
  own('HydroBIM_Conexao', 'NumberOfPorts', 'Número de portas', 'type', ['fitting'], 'IfcInteger', {
    resolve: ({ element }) =>
      value(element.kind === 'cross' ? 4 : element.kind === 'tee' ? 3 : 2, 'model'),
  }),
  own(
    'HydroBIM_Conexao',
    'BranchNominalDiameter',
    'DN da derivação',
    'type',
    ['fitting'],
    'IfcLabel',
    {
      when: ({ element }) => isJunction(element),
      resolve: ({ element }) =>
        isJunction(element)
          ? value((element.branchSpec ?? element.spec).sizeLabel, 'catalog')
          : null,
    },
  ),
  own(
    'HydroBIM_Conexao',
    'CenterToEnd',
    'Vértice à porta',
    'type',
    ['fitting'],
    'IfcPositiveLengthMeasure',
    {
      when: ({ element }) => element.kind === 'elbow',
      resolve: ({ element }) =>
        element.kind === 'elbow'
          ? // Curvas ponta e bolsa: a cota vale para a porta `a` (bolsa).
            value(elbowPortDistances(element).a, dimensional(element))
          : null,
      binding: 'Família: dimensão do joelho',
    },
  ),
  own(
    'HydroBIM_Conexao',
    'RunLength',
    'Comprimento da passagem',
    'type',
    ['fitting'],
    'IfcPositiveLengthMeasure',
    {
      when: ({ element }) => isJunction(element),
      resolve: ({ element }) =>
        isJunction(element) ? value(element.runLength, dimensional(element)) : null,
      binding: 'Família: dimensão do tê/cruzeta',
    },
  ),
  own(
    'HydroBIM_Conexao',
    'BranchLength',
    'Centro à derivação',
    'type',
    ['fitting'],
    'IfcPositiveLengthMeasure',
    {
      when: ({ element }) => isJunction(element),
      resolve: ({ element }) =>
        isJunction(element) ? value(element.branchLength, dimensional(element)) : null,
      binding: 'Família: dimensão do tê/cruzeta',
    },
  ),
  own(
    'HydroBIM_Conexao',
    'Length',
    'Comprimento (porta a porta)',
    'type',
    ['fitting'],
    'IfcPositiveLengthMeasure',
    {
      when: ({ element }) => element.kind === 'reducer',
      resolve: ({ element }) =>
        element.kind === 'reducer' ? value(element.length, dimensional(element)) : null,
      binding: 'Família: dimensão da redução',
    },
  ),
  std('Qto_PipeFittingBaseQuantities', 'Length', 'Comprimento no eixo', 'occurrence', ['fitting'], {
    resolve: ({ element }) => value(axisLength(element), 'geometry'),
  }),
  std(
    'Qto_PipeFittingBaseQuantities',
    'GrossCrossSectionArea',
    'Área da seção bruta (porta A)',
    'occurrence',
    ['fitting'],
    {
      resolve: ({ element }) => value((Math.PI * element.spec.outerDiameter ** 2) / 4, 'geometry'),
    },
  ),
  std(
    'Qto_PipeFittingBaseQuantities',
    'NetCrossSectionArea',
    'Área da seção da parede (porta A)',
    'occurrence',
    ['fitting'],
    {
      resolve: ({ element: { spec } }) =>
        value((Math.PI * (spec.outerDiameter ** 2 - spec.innerDiameter ** 2)) / 4, 'geometry'),
    },
  ),

  // ----- Válvulas e registros -------------------------------------------------------------
  std('Pset_ValveTypeCommon', 'Reference', 'Referência do tipo', 'type', ['valve'], {
    resolve: typeReference,
  }),
  std('Pset_ValveTypeCommon', 'ValvePattern', 'Configuração das portas', 'type', ['valve'], {
    resolve: ({ element }) =>
      isValve(element)
        ? value(element.valveType === 'airRelease' ? 'SINGLEPORT' : 'STRAIGHT_2_PORT', 'model')
        : null,
  }),
  std('Pset_ValveTypeCommon', 'ValveMechanism', 'Mecanismo', 'type', ['valve'], {
    // Gaveta: o esquema distingue cunha e faces paralelas; o cadastro não — fica a informar.
    resolve: ({ element }) =>
      isValve(element) ? value(VALVE_MECHANISM[element.valveType], 'model') : null,
    editable: true,
  }),
  std('Pset_ValveTypeCommon', 'ValveOperation', 'Acionamento', 'type', ['valve'], {
    // Volante só quando a família tabula o diâmetro do volante.
    // A retenção fecha pelo próprio escoamento: não tem acionamento.
    predefinedTypes: ['ISOLATING', 'REGULATING', 'AIRRELEASE', 'PRESSUREREDUCING'],
    resolve: ({ element }) =>
      isValve(element) && element.handwheelDiameter !== undefined
        ? value('WHEEL', dimensional(element))
        : null,
    required: true,
    editable: true,
  }),
  std('Pset_ValveTypeCommon', 'Size', 'Diâmetro nominal (DN)', 'type', ['valve'], {
    resolve: ({ element }) => value(element.spec.dn / 1000, 'catalog'),
    binding: 'Especificação: DN',
  }),
  std('Pset_ValveTypeCommon', 'WorkingPressure', 'Pressão de serviço', 'type', ['valve'], {
    required: true,
    editable: true,
  }),
  std('Pset_ValveTypeCommon', 'TestPressure', 'Pressão de ensaio', 'type', ['valve'], {
    editable: true,
  }),
  std('Pset_ValveTypeCommon', 'FlowCoefficient', 'Coeficiente de vazão', 'type', ['valve'], {
    editable: true,
  }),
  std('Pset_ValveTypeCommon', 'CloseOffRating', 'Pressão de fechamento', 'type', ['valve'], {
    editable: true,
  }),
  std('Pset_ValveTypeCommon', 'Status', 'Situação', 'occurrence', ['valve'], { editable: true }),
  std('Pset_ValveTypeIsolating', 'IsNormallyOpen', 'Normalmente aberta', 'occurrence', ['valve'], {
    predefinedTypes: ['ISOLATING'],
    editable: true,
  }),
  std('Pset_ValveTypeAirRelease', 'IsAutomatic', 'Automática', 'type', ['valve'], {
    predefinedTypes: ['AIRRELEASE'],
    editable: true,
  }),
  std(
    'Pset_ValveTypePressureReducing',
    'UpstreamPressure',
    'Pressão a montante',
    'occurrence',
    ['valve'],
    {
      predefinedTypes: ['PRESSUREREDUCING'],
      editable: true,
    },
  ),
  std(
    'Pset_ValveTypePressureReducing',
    'DownstreamPressure',
    'Pressão a jusante',
    'occurrence',
    ['valve'],
    {
      predefinedTypes: ['PRESSUREREDUCING'],
      required: true,
      editable: true,
    },
  ),
  own('HydroBIM_Valvula', 'ValveType', 'Tipo de válvula', 'type', ['valve'], 'IfcLabel', {
    resolve: ({ element }) =>
      isValve(element) ? value(VALVE_LABELS[element.valveType], 'model') : null,
  }),
  own('HydroBIM_Valvula', 'EndTypes', 'Extremidades', 'type', ['valve'], 'IfcLabel', {
    resolve: ({ element }) => value(endTypes(element), dimensional(element)),
  }),
  own(
    'HydroBIM_Valvula',
    'HandwheelDiameter',
    'Diâmetro do volante',
    'type',
    ['valve'],
    'IfcPositiveLengthMeasure',
    {
      when: ({ element }) => isValve(element) && element.handwheelDiameter !== undefined,
      resolve: ({ element }) =>
        isValve(element) ? value(element.handwheelDiameter, dimensional(element)) : null,
      binding: 'Família: volante',
    },
  ),

  // ----- Filtro Y -------------------------------------------------------------------------
  std('Pset_FilterTypeCommon', 'Reference', 'Referência do tipo', 'type', ['strainer'], {
    resolve: typeReference,
  }),
  std('Pset_FilterTypeCommon', 'NominalFlowrate', 'Vazão nominal', 'type', ['strainer'], {
    editable: true,
  }),
  std(
    'Pset_FilterTypeCommon',
    'NominalPressureDrop',
    'Perda de carga nominal',
    'type',
    ['strainer'],
    { editable: true },
  ),
  std('Pset_FilterTypeCommon', 'Status', 'Situação', 'occurrence', ['strainer'], {
    editable: true,
  }),
  own('HydroBIM_Filtro', 'FilterType', 'Tipo de filtro', 'type', ['strainer'], 'IfcLabel', {
    resolve: () => value('Filtro Y', 'model'),
  }),
  own('HydroBIM_Filtro', 'EndTypes', 'Extremidades', 'type', ['strainer'], 'IfcLabel', {
    resolve: ({ element }) => value(endTypes(element), dimensional(element)),
  }),
  own('HydroBIM_Filtro', 'NominalDiameter', 'Diâmetro nominal', 'type', ['strainer'], 'IfcLabel', {
    resolve: ({ element }) => value(element.spec.sizeLabel, 'catalog'),
  }),

  // ----- Medidor de vazão ------------------------------------------------------------------
  // Os conjuntos padronizados do IfcFlowMeter não constam de `schemaData.ts`: só entram
  // propriedades próprias, com o que o modelo realmente conhece.
  own('HydroBIM_Medidor', 'MeterType', 'Tipo de medidor', 'type', ['flowMeter'], 'IfcLabel', {
    resolve: () => value('Medidor de vazão em linha', 'model'),
  }),
  own('HydroBIM_Medidor', 'EndTypes', 'Extremidades', 'type', ['flowMeter'], 'IfcLabel', {
    resolve: ({ element }) => value(endTypes(element), dimensional(element)),
  }),
  own(
    'HydroBIM_Medidor',
    'NominalDiameter',
    'Diâmetro nominal',
    'type',
    ['flowMeter'],
    'IfcLabel',
    { resolve: ({ element }) => value(element.spec.sizeLabel, 'catalog') },
  ),

  // ----- Dimensões gerais (válvulas, filtros, medidores e bombas) --------------------------
  std(SIZE, 'NominalLength', 'Comprimento', 'type', ['valve', 'strainer', 'flowMeter', 'pump'], {
    resolve: ({ element }) =>
      element.kind === 'valve' || element.kind === 'pump'
        ? value(element.length, dimensional(element))
        : null,
    binding: 'Família: comprimento face a face',
  }),
  std(SIZE, 'NominalHeight', 'Altura', 'type', ['valve', 'strainer', 'flowMeter'], {
    when: ({ element }) => isValve(element) && element.height !== undefined,
    resolve: ({ element }) =>
      isValve(element) ? value(element.height, dimensional(element)) : null,
    binding: 'Família: altura',
  }),
  std(SIZE, 'NominalWidth', 'Largura', 'type', ['valve', 'strainer', 'flowMeter'], {
    when: ({ element }) => isValve(element) && element.width !== undefined,
    resolve: ({ element }) =>
      isValve(element) ? value(element.width, dimensional(element)) : null,
    binding: 'Família: largura',
  }),

  // ----- Bombas ---------------------------------------------------------------------------
  std('Pset_PumpTypeCommon', 'ConnectionSize', 'DN da sucção', 'type', ['pump'], {
    resolve: ({ element }) => value(element.spec.dn / 1000, 'catalog'),
    binding: 'Especificação da sucção: DN',
  }),
  std('Pset_PumpTypeCommon', 'NominalRotationSpeed', 'Rotação nominal', 'type', ['pump'], {
    required: true,
    editable: true,
  }),
  std('Pset_PumpTypeCommon', 'NetPositiveSuctionHead', 'NPSH requerido', 'type', ['pump'], {
    editable: true,
  }),
  std('Pset_PumpTypeCommon', 'Status', 'Situação', 'occurrence', ['pump'], { editable: true }),
  std('Pset_PumpOccurrence', 'BaseType', 'Tipo de base', 'occurrence', ['pump'], {
    editable: true,
  }),
  std('Pset_PumpOccurrence', 'DriveConnectionType', 'Acoplamento', 'occurrence', ['pump'], {
    editable: true,
  }),
  std('Pset_PumpOccurrence', 'ImpellerDiameter', 'Diâmetro do rotor', 'occurrence', ['pump'], {
    editable: true,
  }),
  own('HydroBIM_Bomba', 'PumpType', 'Tipo de bomba', 'type', ['pump'], 'IfcLabel', {
    resolve: ({ element }) =>
      element.kind === 'pump' && element.pumpType === 'amphibious'
        ? value('Bomba anfíbia em linha', 'catalog')
        : value('Conjunto motobomba — representação genérica', 'model'),
  }),
  own(
    'HydroBIM_Bomba',
    'SuctionNominalDiameter',
    'Diâmetro da sucção',
    'type',
    ['pump'],
    'IfcLabel',
    { resolve: ({ element }) => value(element.spec.sizeLabel, 'catalog') },
  ),
  own(
    'HydroBIM_Bomba',
    'DischargeNominalDiameter',
    'Diâmetro do recalque',
    'type',
    ['pump'],
    'IfcLabel',
    {
      resolve: ({ element }) =>
        element.kind === 'pump' ? value(element.dischargeSpec.sizeLabel, 'catalog') : null,
    },
  ),
  own(
    'HydroBIM_Bomba',
    'RatedFlow',
    'Vazão nominal',
    'type',
    ['pump'],
    'IfcVolumetricFlowRateMeasure',
    {
      resolve: ({ element }) =>
        element.kind === 'pump' ? value(element.ratedFlow, 'model') : null,
      required: true,
      binding: 'Bomba: vazão nominal',
    },
  ),
  own(
    'HydroBIM_Bomba',
    'RatedHead',
    'Altura manométrica nominal',
    'type',
    ['pump'],
    'IfcPositiveLengthMeasure',
    {
      resolve: ({ element }) =>
        element.kind === 'pump' ? value(element.ratedHead, 'model') : null,
      required: true,
      binding: 'Bomba: altura manométrica',
    },
  ),
  own('HydroBIM_Bomba', 'RatedPower', 'Potência', 'type', ['pump'], 'IfcPowerMeasure', {
    required: true,
    editable: true,
  }),
  own('HydroBIM_Bomba', 'Efficiency', 'Rendimento', 'type', ['pump'], 'IfcNormalisedRatioMeasure', {
    editable: true,
  }),
  own('HydroBIM_Bomba', 'CasingMaterial', 'Material da carcaça', 'type', ['pump'], 'IfcLabel', {
    editable: true,
  }),

  // ----- Reservatório genérico (os de catálogo estão em `tankSets.ts`) --------------------
  std('Pset_TankTypeCommon', 'PatternType', 'Forma', 'type', ['tank'], {
    when: notCatalogTank,
    resolve: () => value('VERTICALCYLINDER', 'model'),
  }),
  std('Pset_TankTypeCommon', 'NominalLengthOrDiameter', 'Diâmetro', 'type', ['tank'], {
    when: notCatalogTank,
    resolve: ({ element }) => (element.kind === 'tank' ? value(element.diameter, 'model') : null),
    binding: 'Reservatório: diâmetro',
  }),
  std('Pset_TankTypeCommon', 'NominalWidthOrDiameter', 'Diâmetro (largura)', 'type', ['tank'], {
    when: notCatalogTank,
    resolve: ({ element }) => (element.kind === 'tank' ? value(element.diameter, 'model') : null),
    binding: 'Reservatório: diâmetro',
  }),
  std('Pset_TankTypeCommon', 'NominalDepth', 'Altura', 'type', ['tank'], {
    when: notCatalogTank,
    resolve: ({ element }) => (element.kind === 'tank' ? value(element.height, 'model') : null),
    binding: 'Reservatório: altura',
  }),
  std('Pset_TankTypeCommon', 'TankNominalCapacity', 'Capacidade nominal', 'type', ['tank'], {
    when: notCatalogTank,
    resolve: ({ element }) =>
      element.kind === 'tank' ? value(element.nominalCapacity, 'model') : null,
    required: true,
    editable: true,
  }),

  // ----- Posição (todos, exceto tubos) ----------------------------------------------------
  ...(
    [
      ['X', 'Posição — X'],
      ['Y', 'Posição — Y'],
      ['Z', 'Cota de referência'],
    ] as const
  ).map(([name, label]) =>
    own('HydroBIM_Posicao', name, label, 'occurrence', NOT_PIPE, 'IfcLengthMeasure', {
      resolve: ({ element }) => {
        if (element.kind === 'pipe') return null;
        const { x, y, z } = element.placement.position;
        return value(name === 'X' ? x : name === 'Y' ? y : z, 'geometry');
      },
      binding: 'Geometria: posição do elemento',
    }),
  ),
];

/** Definição editável correspondente a uma chave `Conjunto.Propriedade`. */
export function findDefinition(
  key: string,
  scope: IfcScope,
  elementClassName: IfcElementClass,
): IfcPropertyDefinition | undefined {
  return IFC_PROPERTY_DEFINITIONS.find(
    (definition) =>
      `${definition.set}.${definition.name}` === key &&
      definition.scope === scope &&
      definition.classes.includes(elementClassName),
  );
}

/** A definição vale para o elemento: classe, tipo predefinido e condição adicional. */
export function definitionApplies(
  definition: IfcPropertyDefinition,
  context: IfcDefinitionContext,
): boolean {
  return (
    definition.classes.includes(elementClass(context.element)) &&
    (definition.predefinedTypes === null ||
      definition.predefinedTypes.includes(context.classification.predefinedType)) &&
    definition.when(context)
  );
}
