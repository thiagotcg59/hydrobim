import {
  ARCH_KIND_LABELS,
  DOOR_OPERATION_LABELS,
  WINDOW_OPERATION_LABELS,
  archVerticalRange,
  floorQuantities,
  hostWallOf,
  hostedQuantities,
  layersThickness,
  spaceQuantities,
  wallQuantities,
  type ArchElement,
  type ArchElementKind,
  type ArchType,
  type Project,
} from '@hydrobim/core';
import { standardTemplate, unitOfIfcType, type IfcResolvedValue } from './definitions';
import { IFC_PROPERTY_SETS } from './schemaData';
import type { IfcEnumeration, IfcScope, IfcUnit, IfcValue } from './types';

/**
 * Registro das propriedades IFC da ARQUITETURA — a parte arquitetônica do registro central
 * (`definitions.ts` cobre a rede hidráulica; os dois usam o mesmo mecanismo).
 *
 * Os conjuntos padronizados (`Pset_*Common`, `Qto_*BaseQuantities`…) NÃO são transcritos
 * aqui: as propriedades de cada um são lidas de `schemaData.ts` (gerado do esquema
 * IFC4X3_ADD2), com nome, forma, tipo de valor e enumeração oficiais. Aqui só se decide a que
 * categoria o conjunto se aplica, se o valor é do tipo ou da ocorrência, o rótulo em
 * português, o grupo do painel e de onde o valor vem.
 *
 * Campo disponível não é valor conhecido: toda propriedade cadastral nasce PENDENTE e só é
 * gravada com valor quando o usuário (ou o tipo) o informa. Nada é convertido em zero, falso
 * ou desempenho presumido, e nenhuma propriedade da arquitetura é exigida por padrão — a
 * obrigatoriedade depende dos requisitos de cada projeto.
 */

/** Categoria arquitetônica, para a aplicabilidade das definições. */
export type ArchIfcClass = ArchElementKind;

export const ARCH_IFC_ENTITIES: Record<ArchIfcClass, string> = {
  wall: 'IfcWall',
  slab: 'IfcSlab',
  flooring: 'IfcCovering',
  door: 'IfcDoor',
  window: 'IfcWindow',
  space: 'IfcSpace',
};

/** Grupos do painel de propriedades. */
export const ARCH_PROPERTY_GROUPS = [
  'identification',
  'classification',
  'dimensions',
  'materials',
  'performance',
  'quantities',
] as const;
export type ArchPropertyGroup = (typeof ARCH_PROPERTY_GROUPS)[number];

export const ARCH_GROUP_LABELS: Record<ArchPropertyGroup, string> = {
  identification: 'Identificação',
  classification: 'Classificação IFC',
  dimensions: 'Dimensões',
  materials: 'Materiais',
  performance: 'Desempenho',
  quantities: 'Quantitativos',
};

export interface ArchDefinitionContext {
  readonly project: Pick<Project, 'levels' | 'architecture'>;
  /** Uma ocorrência; nas definições de tipo, qualquer ocorrência dele (ou nenhuma). */
  readonly element: ArchElement | undefined;
  readonly type: ArchType | undefined;
}

export interface ArchPropertyDefinition {
  readonly set: string;
  readonly name: string;
  readonly label: string;
  readonly scope: IfcScope;
  readonly group: ArchPropertyGroup;
  readonly kind: 'single' | 'enumerated' | 'quantity';
  readonly ifcType: string;
  readonly unit: IfcUnit;
  readonly enumeration?: IfcEnumeration;
  readonly standard: boolean;
  readonly classes: readonly ArchIfcClass[];
  readonly resolve: (context: ArchDefinitionContext) => IfcResolvedValue | null;
  readonly editable: boolean;
  /** Parâmetro do modelo de que o valor é derivado, quando não é editável aqui. */
  readonly binding: string | null;
}

type Resolve = ArchPropertyDefinition['resolve'];
const none: Resolve = () => null;
const value = (
  v: IfcValue | null | undefined,
  origin: IfcResolvedValue['origin'],
): IfcResolvedValue | null =>
  v === null || v === undefined || v === '' ? null : { value: v, origin };

const PHYSICAL: readonly ArchIfcClass[] = ['wall', 'slab', 'flooring', 'door', 'window'];
const ALL: readonly ArchIfcClass[] = [...PHYSICAL, 'space'];

/** Rótulos em português das propriedades padronizadas (o identificador oficial fica à vista). */
const LABELS: Record<string, string> = {
  Reference: 'Referência do tipo',
  Status: 'Situação',
  AcousticRating: 'Classificação acústica',
  FireRating: 'Resistência ao fogo',
  Combustible: 'Combustível',
  SurfaceSpreadOfFlame: 'Propagação superficial de chama',
  ThermalTransmittance: 'Transmitância térmica (U)',
  IsExternal: 'Externo',
  LoadBearing: 'Função estrutural',
  ExtendToStructure: 'Estende-se até a estrutura',
  Compartmentation: 'Compartimentação',
  PitchAngle: 'Inclinação',
  FlammabilityRating: 'Classe de inflamabilidade',
  FragilityRating: 'Classe de fragilidade',
  Finish: 'Acabamento',
  HasNonSkidSurface: 'Superfície antiderrapante',
  HasAntiStaticSurface: 'Superfície antiestática',
  SecurityRating: 'Classe de segurança',
  DurabilityRating: 'Classe de durabilidade',
  HygrothermalRating: 'Classe higrotérmica',
  WaterTightnessRating: 'Estanqueidade à água',
  MechanicalLoadRating: 'Resistência a cargas mecânicas',
  WindLoadRating: 'Resistência à carga de vento',
  Infiltration: 'Infiltração de ar',
  GlazingAreaFraction: 'Fração envidraçada',
  HandicapAccessible: 'Acessível (PNE)',
  FireExit: 'Saída de emergência',
  HasDrive: 'Acionamento motorizado',
  SelfClosing: 'Fechamento automático',
  SmokeStop: 'Barreira de fumaça',
  HasSillExternal: 'Peitoril externo',
  HasSillInternal: 'Peitoril interno',
  GlassLayers: 'Número de vidros',
  GlassThickness1: 'Espessura do vidro 1',
  GlassThickness2: 'Espessura do vidro 2',
  GlassThickness3: 'Espessura do vidro 3',
  FillGas: 'Gás de preenchimento',
  GlassColour: 'Cor do vidro',
  IsTempered: 'Vidro temperado',
  IsLaminated: 'Vidro laminado',
  IsCoated: 'Vidro com película',
  IsWired: 'Vidro aramado',
  VisibleLightReflectance: 'Refletância à luz visível',
  VisibleLightTransmittance: 'Transmitância à luz visível',
  SolarAbsorption: 'Absortância solar',
  SolarReflectance: 'Refletância solar',
  SolarTransmittance: 'Transmitância solar',
  SolarHeatGainTransmittance: 'Fator solar',
  ShadingCoefficient: 'Coeficiente de sombreamento',
  ThermalTransmittanceSummer: 'Transmitância térmica (verão)',
  ThermalTransmittanceWinter: 'Transmitância térmica (inverno)',
  GrossPlannedArea: 'Área bruta planejada',
  NetPlannedArea: 'Área líquida planejada',
  PubliclyAccessible: 'Acesso público',
  Manufacturer: 'Fabricante',
  ModelLabel: 'Modelo',
  ModelReference: 'Referência do modelo',
  ArticleNumber: 'Código comercial',
  ProductionYear: 'Ano de fabricação',
  AssemblyPlace: 'Local de montagem',
  OperationalDocument: 'Documento de operação',
  SafetyDocument: 'Documento de segurança',
  PerformanceCertificate: 'Certificado de desempenho',
  GlobalTradeItemNumber: 'GTIN',
  InstallationDate: 'Data de execução / instalação',
  AcceptanceDate: 'Data de aceitação',
  PutIntoOperationDate: 'Data de entrada em operação',
};

/** Propriedades dos conjuntos `*Common` que são da ocorrência; as demais são do tipo. */
const OCCURRENCE_PROPERTIES = new Set([
  'Status',
  'IsExternal',
  'LoadBearing',
  'ExtendToStructure',
  'Compartmentation',
  'PitchAngle',
  'FireExit',
  'HandicapAccessible',
  'PubliclyAccessible',
  'GrossPlannedArea',
  'NetPlannedArea',
]);

const IDENTIFICATION = new Set(['Reference', 'Status']);

const SUPPORTED_TYPES = new Set([
  'IfcLabel',
  'IfcIdentifier',
  'IfcText',
  'IfcBoolean',
  'IfcDate',
  'IfcCountMeasure',
  'IfcPositiveLengthMeasure',
  'IfcAreaMeasure',
  'IfcPlaneAngleMeasure',
  'IfcPositiveRatioMeasure',
  'IfcNormalisedRatioMeasure',
  'IfcThermalTransmittanceMeasure',
  'IfcVolumetricFlowRateMeasure',
]);

interface SetOptions {
  readonly group: ArchPropertyGroup;
  /** Escopo fixo do conjunto; ausente = por propriedade (`OCCURRENCE_PROPERTIES`). */
  readonly scope?: IfcScope;
  /** Propriedades com valor derivado do modelo (não editáveis). */
  readonly derived?: Readonly<Record<string, { resolve: Resolve; binding: string }>>;
  /** Propriedades editáveis cujo valor inicial vem do cadastro do tipo. */
  readonly seeded?: Readonly<Record<string, Resolve>>;
  readonly only?: readonly string[];
}

/**
 * Todas as propriedades de um conjunto padronizado, lidas do esquema. As formas que o editor
 * não trata (valor por referência, intervalo, tabela) ficam de fora — não são inventadas.
 */
function standardSet(
  set: string,
  classes: readonly ArchIfcClass[],
  options: SetOptions,
): ArchPropertyDefinition[] {
  const template = IFC_PROPERTY_SETS[set];
  if (!template) throw new Error(`Conjunto inexistente no esquema IFC 4.3: ${set}.`);
  const definitions: ArchPropertyDefinition[] = [];
  for (const [name, property] of Object.entries(template.properties)) {
    if (options.only && !options.only.includes(name)) continue;
    if (property.kind !== 'P_SINGLEVALUE' && property.kind !== 'P_ENUMERATEDVALUE') continue;
    if (property.type === null || !SUPPORTED_TYPES.has(property.type)) continue;
    const derived = options.derived?.[name];
    definitions.push({
      set,
      name,
      label: LABELS[name] ?? name,
      scope: options.scope ?? (OCCURRENCE_PROPERTIES.has(name) ? 'occurrence' : 'type'),
      group: IDENTIFICATION.has(name) ? 'identification' : options.group,
      ...standardTemplate(set, name),
      standard: true,
      classes,
      resolve: derived?.resolve ?? options.seeded?.[name] ?? none,
      editable: derived === undefined,
      binding: derived?.binding ?? null,
    });
  }
  return definitions;
}

const reference = {
  Reference: {
    resolve: ({ type }: ArchDefinitionContext) => value(type?.name, 'model'),
    binding: 'Tipo: nome',
  },
};

/** Quantidade de um conjunto `Qto_*`: forma e unidade vêm do esquema. */
const quantity = (
  set: string,
  name: string,
  label: string,
  classes: readonly ArchIfcClass[],
  resolve: (context: ArchDefinitionContext) => number | null | undefined,
): ArchPropertyDefinition => ({
  set,
  name,
  label,
  scope: 'occurrence',
  group: 'quantities',
  ...standardTemplate(set, name),
  standard: true,
  classes,
  resolve: (context) => value(resolve(context), 'geometry'),
  editable: false,
  binding: 'Geometria do modelo',
});

/** Propriedade de conjunto próprio (`HydroBIM_*`). */
const own = (
  set: string,
  name: string,
  label: string,
  scope: IfcScope,
  group: ArchPropertyGroup,
  classes: readonly ArchIfcClass[],
  ifcType: string,
  resolve: Resolve | null,
  binding: string | null = null,
): ArchPropertyDefinition => ({
  set,
  name,
  label,
  scope,
  group,
  kind: 'single',
  ifcType,
  unit: unitOfIfcType(ifcType),
  standard: false,
  classes,
  resolve: resolve ?? none,
  editable: resolve === null,
  binding,
});

const wallQ = ({ project, element }: ArchDefinitionContext) =>
  element?.kind === 'wall' ? wallQuantities(project.architecture, element) : null;
const floorQ = ({ project, element }: ArchDefinitionContext) =>
  element?.kind === 'slab' || element?.kind === 'flooring'
    ? floorQuantities(project.architecture, element)
    : null;
const hostedQ = ({ project, element }: ArchDefinitionContext) =>
  element?.kind === 'door' || element?.kind === 'window'
    ? hostedQuantities(project.architecture, element)
    : null;
const spaceQ = ({ element }: ArchDefinitionContext) =>
  element?.kind === 'space' ? spaceQuantities(element) : null;
const range = ({ project, element }: ArchDefinitionContext) =>
  element ? archVerticalRange(project, element) : null;

const LOCATION_LINE_LABELS = {
  center: 'Eixo da parede',
  faceLeft: 'Face esquerda',
  faceRight: 'Face direita',
} as const;

const M = 'Pset_ManufacturerTypeInformation';
const WQ = 'Qto_WallBaseQuantities';
const SQ = 'Qto_SlabBaseQuantities';
const CQ = 'Qto_CoveringBaseQuantities';
const DQ = 'Qto_DoorBaseQuantities';
const NQ = 'Qto_WindowBaseQuantities';
const PQ = 'Qto_SpaceBaseQuantities';

export const ARCH_PROPERTY_DEFINITIONS: readonly ArchPropertyDefinition[] = [
  // ----- Conjuntos comuns de cada categoria (propriedades lidas do esquema) -----------------
  ...standardSet('Pset_WallCommon', ['wall'], { group: 'performance', derived: reference }),
  ...standardSet('Pset_SlabCommon', ['slab'], { group: 'performance', derived: reference }),
  ...standardSet('Pset_CoveringCommon', ['flooring'], {
    group: 'performance',
    derived: reference,
  }),
  ...standardSet('Pset_CoveringFlooring', ['flooring'], { group: 'performance' }),
  ...standardSet('Pset_DoorCommon', ['door'], { group: 'performance', derived: reference }),
  ...standardSet('Pset_WindowCommon', ['window'], { group: 'performance', derived: reference }),
  ...standardSet('Pset_DoorWindowGlazingType', ['door', 'window'], {
    group: 'performance',
    scope: 'type',
  }),
  ...standardSet('Pset_SpaceCommon', ['space'], {
    group: 'performance',
    scope: 'occurrence',
    // Ambientes não têm tipo: a referência é o número do ambiente, quando há.
    derived: {
      Reference: {
        resolve: ({ element }) => value(element?.kind === 'space' ? element.number : null, 'model'),
        binding: 'Ambiente: número',
      },
    },
  }),

  // ----- Fabricante e produto (tipo) --------------------------------------------------------
  ...standardSet(M, PHYSICAL, {
    group: 'identification',
    scope: 'type',
    only: ['Manufacturer', 'ModelLabel', 'ModelReference', 'ArticleNumber'],
    seeded: {
      Manufacturer: ({ type }) => value(type?.manufacturing.manufacturer, 'model'),
      ModelLabel: ({ type }) => value(type?.manufacturing.model, 'model'),
      ArticleNumber: ({ type }) => value(type?.manufacturing.partNumber, 'model'),
    },
  }),
  ...standardSet('Pset_InstallationOccurrence', PHYSICAL, {
    group: 'identification',
    scope: 'occurrence',
  }),
  own(
    'HydroBIM_Planejamento',
    'WbsCode',
    'Código EAP',
    'occurrence',
    'identification',
    PHYSICAL,
    'IfcLabel',
    null,
  ),

  // ----- Dimensões e posição (derivadas do modelo) ------------------------------------------
  own(
    'HydroBIM_Parede',
    'LocationLine',
    'Linha de referência',
    'occurrence',
    'dimensions',
    ['wall'],
    'IfcLabel',
    ({ element }) =>
      value(element?.kind === 'wall' ? LOCATION_LINE_LABELS[element.locationLine] : null, 'model'),
    'Parede: linha de referência',
  ),
  own(
    'HydroBIM_Parede',
    'BaseOffset',
    'Deslocamento da base',
    'occurrence',
    'dimensions',
    ['wall'],
    'IfcLengthMeasure',
    ({ element }) => value(element?.kind === 'wall' ? element.baseOffset : null, 'geometry'),
    'Parede: deslocamento vertical',
  ),
  ...(
    [
      ['BaseElevation', 'Cota inferior', 'base'],
      ['TopElevation', 'Cota superior', 'top'],
    ] as const
  ).map(([name, label, key]) =>
    own(
      'HydroBIM_Posicao',
      name,
      label,
      'occurrence',
      'dimensions',
      PHYSICAL,
      'IfcLengthMeasure',
      (context) => value(range(context)?.[key], 'geometry'),
      'Geometria: nível e deslocamento',
    ),
  ),
  own(
    'HydroBIM_Piso',
    'LevelOffset',
    'Deslocamento em relação ao nível',
    'occurrence',
    'dimensions',
    ['slab', 'flooring'],
    'IfcLengthMeasure',
    ({ element }) =>
      value(
        element?.kind === 'slab' || element?.kind === 'flooring' ? element.offset : null,
        'geometry',
      ),
    'Piso: deslocamento',
  ),
  own(
    'HydroBIM_Composicao',
    'TotalThickness',
    'Espessura total',
    'type',
    'materials',
    ['wall', 'slab', 'flooring'],
    'IfcPositiveLengthMeasure',
    ({ type }) => value(type && 'layers' in type ? layersThickness(type) : null, 'model'),
    'Tipo: soma das camadas',
  ),
  own(
    'HydroBIM_Composicao',
    'LayerCount',
    'Número de camadas',
    'type',
    'materials',
    ['wall', 'slab', 'flooring'],
    'IfcInteger',
    ({ type }) => value(type && 'layers' in type ? type.layers.length : null, 'model'),
    'Tipo: camadas',
  ),
  own(
    'HydroBIM_Esquadria',
    'Operation',
    'Tipo de abertura',
    'type',
    'dimensions',
    ['door', 'window'],
    'IfcLabel',
    ({ type }) =>
      value(
        type?.category === 'door'
          ? DOOR_OPERATION_LABELS[type.operation]
          : type?.category === 'window'
            ? WINDOW_OPERATION_LABELS[type.operation]
            : null,
        'model',
      ),
    'Tipo: abertura',
  ),
  own(
    'HydroBIM_Esquadria',
    'FrameWidth',
    'Largura do marco',
    'type',
    'dimensions',
    ['door', 'window'],
    'IfcPositiveLengthMeasure',
    ({ type }) =>
      value(
        type?.category === 'door' || type?.category === 'window' ? type.frameWidth : null,
        'model',
      ),
    'Tipo: marco',
  ),
  own(
    'HydroBIM_Esquadria',
    'PanelThickness',
    'Espessura da folha',
    'type',
    'dimensions',
    ['door'],
    'IfcPositiveLengthMeasure',
    ({ type }) => value(type?.category === 'door' ? type.panelThickness : null, 'model'),
    'Tipo: folha',
  ),
  own(
    'HydroBIM_Esquadria',
    'NumberOfPanels',
    'Número de folhas',
    'type',
    'dimensions',
    ['window'],
    'IfcInteger',
    ({ type }) => value(type?.category === 'window' ? type.panels : null, 'model'),
    'Tipo: folhas',
  ),
  own(
    'HydroBIM_Esquadria',
    'Finish',
    'Acabamento',
    'type',
    'materials',
    ['door', 'window'],
    'IfcLabel',
    null,
  ),
  own(
    'HydroBIM_Esquadria',
    'Hardware',
    'Ferragens (maçaneta, fechadura)',
    'type',
    'materials',
    ['door', 'window'],
    'IfcText',
    null,
  ),
  own(
    'HydroBIM_Vao',
    'HostName',
    'Parede hospedeira',
    'occurrence',
    'dimensions',
    ['door', 'window'],
    'IfcLabel',
    ({ project, element }) =>
      value(
        element?.kind === 'door' || element?.kind === 'window'
          ? hostWallOf(project.architecture, element)?.name
          : null,
        'model',
      ),
    'Vão: hospedeira',
  ),
  own(
    'HydroBIM_Vao',
    'OffsetAlongHost',
    'Posição na parede (centro do vão)',
    'occurrence',
    'dimensions',
    ['door', 'window'],
    'IfcLengthMeasure',
    ({ element }) =>
      value(
        element?.kind === 'door' || element?.kind === 'window' ? element.offset : null,
        'geometry',
      ),
    'Vão: posição',
  ),
  own(
    'HydroBIM_Vao',
    'SillHeight',
    'Altura do peitoril / soleira',
    'occurrence',
    'dimensions',
    ['door', 'window'],
    'IfcNonNegativeLengthMeasure',
    ({ element }) =>
      value(
        element?.kind === 'door' || element?.kind === 'window' ? element.sillHeight : null,
        'geometry',
      ),
    'Vão: peitoril',
  ),
  own(
    'HydroBIM_Vao',
    'OpeningSide',
    'Sentido de abertura',
    'occurrence',
    'dimensions',
    ['door', 'window'],
    'IfcLabel',
    ({ element }) =>
      element?.kind === 'door' || element?.kind === 'window'
        ? value(
            `Dobradiças à ${element.hand === 'left' ? 'esquerda' : 'direita'}; abre para a face ${element.facing === 1 ? 'esquerda' : 'direita'} da parede`,
            'model',
          )
        : null,
    'Vão: mão e face',
  ),
  own(
    'HydroBIM_Ambiente',
    'Number',
    'Número',
    'occurrence',
    'identification',
    ['space'],
    'IfcLabel',
    ({ element }) => value(element?.kind === 'space' ? element.number : null, 'model'),
    'Ambiente: número',
  ),

  // ----- Quantitativos (critérios dos Qto_*BaseQuantities do IFC 4.3) -----------------------
  quantity(WQ, 'Length', 'Comprimento (plano médio)', ['wall'], (c) => wallQ(c)?.length),
  quantity(WQ, 'Width', 'Espessura', ['wall'], (c) => wallQ(c)?.width),
  quantity(WQ, 'Height', 'Altura', ['wall'], (c) => wallQ(c)?.height),
  quantity(
    WQ,
    'GrossFootPrintArea',
    'Área de apoio bruta',
    ['wall'],
    (c) => wallQ(c)?.grossFootprintArea,
  ),
  quantity(
    WQ,
    'NetFootPrintArea',
    'Área de apoio líquida',
    ['wall'],
    (c) => wallQ(c)?.netFootprintArea,
  ),
  quantity(WQ, 'GrossSideArea', 'Área lateral bruta', ['wall'], (c) => wallQ(c)?.grossSideArea),
  quantity(
    WQ,
    'NetSideArea',
    'Área lateral líquida (sem vãos)',
    ['wall'],
    (c) => wallQ(c)?.netSideArea,
  ),
  quantity(WQ, 'GrossVolume', 'Volume bruto', ['wall'], (c) => wallQ(c)?.grossVolume),
  quantity(WQ, 'NetVolume', 'Volume líquido (sem vãos)', ['wall'], (c) => wallQ(c)?.netVolume),

  // Na laje, `Width` é a espessura; `Length` e `Depth` só valem para lajes retangulares e
  // por isso não são emitidos.
  quantity(SQ, 'Width', 'Espessura', ['slab'], (c) => floorQ(c)?.depth),
  quantity(SQ, 'Perimeter', 'Perímetro', ['slab'], (c) => floorQ(c)?.perimeter),
  quantity(SQ, 'GrossArea', 'Área bruta', ['slab'], (c) => floorQ(c)?.grossArea),
  quantity(SQ, 'NetArea', 'Área líquida (sem aberturas)', ['slab'], (c) => floorQ(c)?.netArea),
  quantity(SQ, 'GrossVolume', 'Volume bruto', ['slab'], (c) => floorQ(c)?.grossVolume),
  quantity(
    SQ,
    'NetVolume',
    'Volume líquido (sem aberturas)',
    ['slab'],
    (c) => floorQ(c)?.netVolume,
  ),

  quantity(CQ, 'Width', 'Espessura', ['flooring'], (c) => floorQ(c)?.depth),
  quantity(CQ, 'GrossArea', 'Área bruta', ['flooring'], (c) => floorQ(c)?.grossArea),
  quantity(CQ, 'NetArea', 'Área líquida (sem aberturas)', ['flooring'], (c) => floorQ(c)?.netArea),

  quantity(DQ, 'Width', 'Largura', ['door'], (c) => hostedQ(c)?.width),
  quantity(DQ, 'Height', 'Altura', ['door'], (c) => hostedQ(c)?.height),
  quantity(DQ, 'Perimeter', 'Perímetro', ['door'], (c) => hostedQ(c)?.perimeter),
  quantity(DQ, 'Area', 'Área', ['door'], (c) => hostedQ(c)?.area),

  quantity(NQ, 'Width', 'Largura', ['window'], (c) => hostedQ(c)?.width),
  quantity(NQ, 'Height', 'Altura', ['window'], (c) => hostedQ(c)?.height),
  quantity(NQ, 'Perimeter', 'Perímetro', ['window'], (c) => hostedQ(c)?.perimeter),
  quantity(NQ, 'Area', 'Área', ['window'], (c) => hostedQ(c)?.area),

  // Ambiente: só as quantidades BRUTAS, pelo contorno desenhado. As líquidas (descontando
  // elementos internos e vãos) exigiriam detectar o que há dentro do contorno e não são
  // emitidas. Altura e volume só existem com o pé-direito informado.
  quantity(PQ, 'Height', 'Pé-direito', ['space'], (c) => spaceQ(c)?.height),
  quantity(PQ, 'GrossPerimeter', 'Perímetro', ['space'], (c) => spaceQ(c)?.perimeter),
  quantity(PQ, 'GrossFloorArea', 'Área de piso', ['space'], (c) => spaceQ(c)?.area),
  quantity(PQ, 'GrossVolume', 'Volume', ['space'], (c) => spaceQ(c)?.volume),
];

/** Definição correspondente a uma chave `Conjunto.Propriedade`, no escopo e na categoria. */
export function findArchDefinition(
  key: string,
  scope: IfcScope,
  archClass: ArchIfcClass,
): ArchPropertyDefinition | undefined {
  return ARCH_PROPERTY_DEFINITIONS.find(
    (definition) =>
      `${definition.set}.${definition.name}` === key &&
      definition.scope === scope &&
      definition.classes.includes(archClass),
  );
}

export const archClassLabel = (archClass: ArchIfcClass): string => ARCH_KIND_LABELS[archClass];

/** Categorias com tipo (`Ifc…Type`); ambientes não têm tipo no modelo. */
export const ARCH_ALL_CLASSES = ALL;
