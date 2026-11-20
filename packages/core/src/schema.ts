import { z } from 'zod';

/**
 * Esquema versionado do projeto HydroBIM (fonte única de verdade dos tipos de domínio).
 *
 * Unidades internas: SI — comprimentos em metros, ângulos em radianos.
 * O diâmetro nominal (DN) é uma designação adimensional e nunca substitui os
 * diâmetros físicos (externo/interno), que são armazenados explicitamente.
 */

export const PROJECT_FORMAT = 'hydrobim-project' as const;
export const SCHEMA_VERSION = 12 as const;

const finite = z.number().finite();
const positive = finite.positive();
const nonNegative = finite.nonnegative();

export const Vec3Schema = z.object({ x: finite, y: finite, z: finite });
export const QuatSchema = z.object({ x: finite, y: finite, z: finite, w: finite });

export const MATERIALS = ['pvc', 'hdpe', 'ductileIron', 'carbonSteel'] as const;
export const MaterialSchema = z.enum(MATERIALS);
export type Material = z.infer<typeof MaterialSchema>;

export const JOINT_TYPES = [
  'solventWeld',
  'socketSpigot',
  'buttFusion',
  'buttWeld',
  'flanged',
  'threaded',
] as const;
export const JointTypeSchema = z.enum(JOINT_TYPES);
export type JointType = z.infer<typeof JointTypeSchema>;

/** Especificação dimensional resolvida de um tubo/porta (valores físicos em metros). */
export const PipeSpecSchema = z.object({
  /** Identificador da especificação no catálogo (ex.: `pvc-soldavel-nbr5648`). */
  specificationId: z.string().min(1),
  material: MaterialSchema,
  /** Norma dimensional de referência (ex.: `ABNT NBR 5648`). */
  standard: z.string(),
  jointType: JointTypeSchema,
  pressureClass: z.string().nullable(),
  /** Diâmetro nominal — designação adimensional conforme a norma. */
  dn: positive,
  /** Designação comercial apresentada ao usuário (ex.: `DE 25 (DN 20)`). */
  sizeLabel: z.string(),
  outerDiameter: positive,
  innerDiameter: positive,
  wallThickness: positive,
  /**
   * Deflexão angular máxima admitida em cada junta (rad) — juntas elásticas, conforme o
   * fabricante. É dado de catálogo, com fonte; ausente = junta rígida ou valor não informado,
   * caso em que só o alinhamento exato conecta.
   */
  jointDeflection: positive.optional(),
});
export type PipeSpec = z.infer<typeof PipeSpecSchema>;

const PropertyValueSchema = z.union([z.string(), finite, z.boolean()]);
export type PropertyValue = z.infer<typeof PropertyValueSchema>;

export const ElementMetaSchema = z.object({
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Incrementado a cada alteração do elemento (histórico básico). */
  revision: z.number().int().nonnegative(),
});
export type ElementMeta = z.infer<typeof ElementMetaSchema>;

export const ManufacturingSchema = z.object({
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  partNumber: z.string().optional(),
});
export type Manufacturing = z.infer<typeof ManufacturingSchema>;

export const END_TYPES = ['plain', 'socket', 'flange'] as const;
export const EndTypeSchema = z.enum(END_TYPES);
export type EndType = z.infer<typeof EndTypeSchema>;

/**
 * Furação do flange, quando tabulada pela norma ou pelo catálogo: diâmetro do círculo de
 * furação, número de furos e diâmetro dos furos (m). Ausente = flange representado sem furos.
 *
 * Ressalto da face de vedação, quando tabulado: diâmetro (`raisedFaceDiameter`) e altura
 * (`raisedFaceHeight`). A altura do ressalto está INCLUÍDA na espessura `length`; a porta
 * fica na face do ressalto.
 */
const flangeDrilling = {
  boltCircle: positive.optional(),
  boltCount: z.number().int().positive().optional(),
  boltHoleDiameter: positive.optional(),
  raisedFaceDiameter: positive.optional(),
  raisedFaceHeight: positive.optional(),
};

/**
 * Acabamento da extremidade de uma conexão em uma porta:
 *  - `plain`: ponta lisa (solda de topo, termofusão);
 *  - `socket`: bolsa — `length` é a profundidade além da porta (sobre o tubo);
 *  - `flange`: flange — `length` é a espessura, da face (porta) para dentro da peça.
 */
export const EndTreatmentSchema = z.object({
  type: EndTypeSchema,
  length: nonNegative,
  outerDiameter: positive,
  ...flangeDrilling,
});
export type EndTreatment = z.infer<typeof EndTreatmentSchema>;

const elementBase = {
  /** Identificador persistente (UUID). Nunca muda durante a vida do elemento. */
  id: z.string().min(1),
  name: z.string(),
  systemId: z.string().min(1),
  spec: PipeSpecSchema,
  /** Família de catálogo que originou as dimensões (`null` = dimensões genéricas/livres). */
  familyId: z.string().nullable(),
  /** Propriedades BIM livres definidas pelo usuário. */
  properties: z.record(z.string(), PropertyValueSchema),
  manufacturing: ManufacturingSchema,
  /**
   * Valores IFC informados pelo usuário para ESTA ocorrência, por `Conjunto.Propriedade`
   * (ex.: `Pset_PipeSegmentOccurrence.InteriorRoughnessCoefficient`), em unidades SI. A
   * chave `Description` substitui a descrição gerada. Só guarda o que o usuário digitou:
   * os demais valores são derivados do modelo a cada exportação. Ausente = nenhum.
   */
  ifc: z.record(z.string(), PropertyValueSchema).optional(),
  meta: ElementMetaSchema,
};

/** Posicionamento de uma conexão: origem e orientação do referencial local. */
export const PlacementSchema = z.object({ position: Vec3Schema, rotation: QuatSchema });
export type Placement = z.infer<typeof PlacementSchema>;

const fittingBase = {
  ...elementBase,
  placement: PlacementSchema,
  /** Acabamento por porta; portas ausentes são pontas lisas. */
  ends: z.record(z.string(), EndTreatmentSchema),
};

/**
 * Tubo reto. `ends` descreve o acabamento das extremidades `start` e `end` (tubos com
 * flanges); extremidade ausente = ponta lisa. Com flange, a porta fica na face do flange e
 * `familyId` identifica a família de tubos flangeados que forneceu as dimensões.
 */
export const PipeSchema = z.object({
  ...elementBase,
  kind: z.literal('pipe'),
  start: Vec3Schema,
  end: Vec3Schema,
  ends: z.record(z.string(), EndTreatmentSchema).optional(),
});
export type Pipe = z.infer<typeof PipeSchema>;

export const ElbowSchema = z.object({
  ...fittingBase,
  kind: z.literal('elbow'),
  /** Ângulo de deflexão (rad): 90° = joelho de 90°. */
  angle: positive,
  /** Raio de curvatura na linha de centro (m). */
  bendRadius: positive,
  /**
   * Trechos retos (m) entre o arco e as portas `a` e `b` — curvas ponta e bolsa, em que as
   * duas portas ficam a distâncias diferentes do vértice. Ausente = arco de porta a porta.
   */
  straight: z.object({ a: nonNegative, b: nonNegative }).optional(),
});
export type Elbow = z.infer<typeof ElbowSchema>;

export const TeeSchema = z.object({
  ...fittingBase,
  kind: z.literal('tee'),
  /** Comprimento total da passagem direta, de porta a porta (m). */
  runLength: positive,
  /** Distância do centro à porta da derivação (m). */
  branchLength: positive,
  /** Especificação da derivação em tês de redução; ausente = igual à passagem. */
  branchSpec: PipeSpecSchema.optional(),
});
export type Tee = z.infer<typeof TeeSchema>;

export const ReducerSchema = z.object({
  ...fittingBase,
  kind: z.literal('reducer'),
  /** Especificação da segunda extremidade (porta `b`). `spec` descreve a porta `a`. */
  outletSpec: PipeSpecSchema,
  length: positive,
});
export type Reducer = z.infer<typeof ReducerSchema>;

export const VALVE_TYPES = [
  'gate',
  'globe',
  'ball',
  'butterfly',
  'check',
  'airRelease',
  // Redutora de pressão pilotada (corpo em Y). A porta `a` é a de montante.
  'pressureReducing',
  // Filtro Y (não é válvula: no IFC é `IfcFilter`). A porta `a` é a de montante; o bojo do
  // elemento filtrante desce a 45° no sentido de jusante.
  'strainer',
  // Medidor de vazão em linha (macromedidor eletromagnético; não é válvula: no IFC é
  // `IfcFlowMeter`). A porta `a` é a de montante.
  'flowMeter',
] as const;
export const ValveTypeSchema = z.enum(VALVE_TYPES);
export type ValveType = z.infer<typeof ValveTypeSchema>;

export const ValveSchema = z.object({
  ...fittingBase,
  kind: z.literal('valve'),
  valveType: ValveTypeSchema,
  /** Comprimento face a face (m). Na ventosa (`airRelease`): altura acima da porta. */
  length: positive,
  /**
   * Altura do eixo ao topo do acionamento (m), quando informada pelo catálogo. No filtro Y
   * (`strainer`): do eixo ao ponto mais baixo do bojo (tampa). No medidor de vazão
   * (`flowMeter`): do eixo ao topo do cabeçote (conversor ou caixa de ligação).
   */
  height: positive.optional(),
  /** Diâmetro do volante (m), quando informado pelo catálogo. */
  handwheelDiameter: positive.optional(),
  /**
   * Largura máxima / diâmetro da tampa do atuador (m), quando informada pelo catálogo. Na
   * gaveta de castelo retangular: dimensão do castelo transversal ao eixo do tubo.
   */
  width: positive.optional(),
  /**
   * Dimensão do castelo ao longo do eixo do tubo (m), quando informada pelo catálogo. Com
   * `width`, define o castelo retangular das gavetas de cunha de borracha.
   */
  bonnetLength: positive.optional(),
});
export type Valve = z.infer<typeof ValveSchema>;

/** Conjunto motobomba (representação genérica: sucção axial, recalque vertical). */
export const PumpSchema = z.object({
  ...fittingBase,
  kind: z.literal('pump'),
  /** Especificação do recalque (porta `b`). `spec` descreve a sucção (porta `a`). */
  dischargeSpec: PipeSpecSchema,
  /** Comprimento total do conjunto ao longo do eixo de sucção (m). */
  length: positive,
  /** Distância da face de sucção ao eixo do recalque (m). */
  dischargeOffset: positive,
  /** Altura do eixo de sucção à face do recalque (m). */
  dischargeHeight: positive,
  /** Vazão nominal (m³/s) e altura manométrica (m), quando conhecidas. */
  ratedFlow: positive.optional(),
  ratedHead: positive.optional(),
});
export type Pump = z.infer<typeof PumpSchema>;

/**
 * Forma construtiva do reservatório. Ausente no elemento = `generic` (cilindro vertical
 * simples, sem identificação de produto).
 */
export const TANK_TYPES = [
  'generic',
  // Taça (cálice) com armazenamento também na coluna.
  'gobletWet',
  // Taça (cálice) com a coluna seca: só a taça armazena.
  'gobletDry',
  // Tubular alto: cilindro vertical esbelto apoiado no solo.
  'tubular',
  // Australiano: costado baixo de chapa corrugada, aberto, fundo cônico e pés.
  'australian',
  // Vertical apoiado: cilindro de fundo plano sobre a base.
  'verticalGround',
  // Vertical elevado: fundo cônico e pés de apoio.
  'verticalConeLegs',
  // Vertical apoiado de grande porte, montado na obra.
  'fieldErected',
  // Cilíndrico horizontal, sobre longarina ou pés.
  'horizontal',
] as const;
export const TankTypeSchema = z.enum(TANK_TYPES);
export type TankType = z.infer<typeof TankTypeSchema>;

export const TANK_NOZZLE_ROLES = ['inlet', 'outlet', 'overflow', 'drain'] as const;
export const TankNozzleRoleSchema = z.enum(TANK_NOZZLE_ROLES);
export type TankNozzleRole = z.infer<typeof TankNozzleRoleSchema>;

/**
 * Bocal adicional do reservatório (além da saída `a` e da entrada `b`). O `id` é o
 * identificador da porta. O diâmetro vem sempre de uma especificação de tubo escolhida
 * pelo usuário — nunca é presumido a partir do reservatório.
 */
export const TankNozzleSchema = z.object({
  id: z.string().min(1),
  role: TankNozzleRoleSchema,
  /** Altura do eixo do bocal acima da base do reservatório (m). */
  height: nonNegative,
  /** Direção do bocal em planta, a partir do eixo X local, anti-horária (rad). */
  azimuth: finite,
  spec: PipeSpecSchema,
});
export type TankNozzle = z.infer<typeof TankNozzleSchema>;

/**
 * Acessórios construtivos. Posições e dimensões são de REPRESENTAÇÃO (o catálogo dos
 * fabricantes não as tabula); o usuário pode ligá-los, desligá-los e reposicioná-los.
 */
export const TankAccessoriesSchema = z.object({
  /** Escada externa tipo marinheiro. */
  ladder: z.boolean(),
  /** Posição da escada em planta, a partir do eixo X local (rad). */
  ladderAzimuth: finite,
  /** Gaiola de proteção da escada. */
  cage: z.boolean(),
  /** Guarda-corpo na cobertura. */
  guardrail: z.boolean(),
  guardrailHeight: positive,
  /** Boca de visita (inspeção). */
  manhole: z.boolean(),
});
export type TankAccessories = z.infer<typeof TankAccessoriesSchema>;

export const TANK_SUPPORT_TYPES = ['legs', 'skid'] as const;
export const TankSupportTypeSchema = z.enum(TANK_SUPPORT_TYPES);
export type TankSupportType = z.infer<typeof TankSupportTypeSchema>;

/**
 * Reservatório. Sem `tankType` é o cilindro vertical genérico. Com `tankType`, a geometria
 * segue a forma construtiva; `familyId` identifica a família de catálogo e `variantId`, o
 * modelo comercial (ausente = dimensões personalizadas).
 *
 * A porta `a` é a saída e a porta `b`, a entrada (bocais opostos: +X e −X; no reservatório
 * horizontal ficam nos tampos).
 */
export const TankSchema = z.object({
  ...fittingBase,
  kind: z.literal('tank'),
  /** Diâmetro do corpo (da taça, nos reservatórios tipo taça) (m). */
  diameter: positive,
  /**
   * Altura de catálogo (m): altura total acima da base — exceto no australiano, em que é a
   * altura do costado (os pés ficam abaixo dele).
   */
  height: positive,
  /** Altura do eixo do bocal de saída (porta `a`) acima da base (m). */
  outletHeight: nonNegative,
  /** Altura do eixo do bocal de entrada (porta `b`) acima da base (m). */
  inletHeight: nonNegative,
  /** Comprimento dos bocais além do costado (m). */
  nozzleLength: positive,
  tankType: TankTypeSchema.optional(),
  /** Modelo comercial da família (`familyId`); ausente = dimensões personalizadas. */
  variantId: z.string().min(1).optional(),
  /** Capacidade nominal (m³), como informada pelo catálogo ou pelo usuário. */
  nominalCapacity: positive.optional(),
  /** Taça: altura da coluna, da base ao início da transição cônica (m). */
  columnHeight: positive.optional(),
  /** Taça: diâmetro da coluna (m). */
  columnDiameter: positive.optional(),
  /** Altura da transição cônica (taça) ou do fundo cônico (m). */
  coneHeight: positive.optional(),
  /** Altura dos pés de apoio ou da longarina (m). */
  supportHeight: nonNegative.optional(),
  /** Horizontal: tipo de apoio. */
  supportType: TankSupportTypeSchema.optional(),
  /** Horizontal: comprimento total, de tampo a tampo (m). */
  length: positive.optional(),
  /** Espessura das chapas (m), quando informada pelo usuário; o catálogo não a tabula. */
  shellThickness: positive.optional(),
  /** Quantidade de células internas (ausente = 1). */
  compartments: z.number().int().positive().optional(),
  /** Nível máximo de água acima da base (m), informado pelo usuário. */
  maxWaterLevel: positive.optional(),
  accessories: TankAccessoriesSchema.optional(),
  /** Bocais adicionais (extravasor, descarga, outras entradas e saídas). */
  nozzles: z.array(TankNozzleSchema).optional(),
});
export type Tank = z.infer<typeof TankSchema>;

// ---------------------------------------------------------------------------
// Famílias de reservatórios (catálogo embutido e famílias personalizadas do projeto)
// ---------------------------------------------------------------------------

/** Modelo de uma família: uma linha da tabela (valores em SI; capacidade em litros). */
export const TankVariantSchema = z.object({
  id: z.string().min(1),
  /** Capacidade nominal (litros). */
  capacityL: positive,
  /** Altura total (m). */
  height: positive,
  /** Diâmetro do corpo ou da taça (m). */
  diameter: positive,
  /** Altura da coluna (m), quando tabulada. */
  columnHeight: positive.optional(),
  /** Marca impressa junto à linha (ex.: asterisco), transcrita sem interpretação. */
  mark: z.string().optional(),
});
export type TankVariant = z.infer<typeof TankVariantSchema>;

/**
 * Família de reservatórios: forma construtiva e tabela de modelos. `builtin` = transcrita
 * do catálogo de um fabricante; `custom` = criada no projeto (em geral, duplicada de uma
 * família de catálogo) — suas dimensões são do usuário, não do fabricante.
 */
export const TankFamilySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tankType: TankTypeSchema.exclude(['generic']),
  manufacturer: z.string(),
  /** Material do corpo, como descrito pelo fabricante. */
  material: z.string(),
  /** Documento, página e URL; nas personalizadas, de onde a família foi duplicada. */
  source: z.string(),
  page: z.number().int().nonnegative(),
  description: z.string(),
  /** Modelos tabulados (vazio = só a faixa de capacidade é conhecida). */
  variants: z.array(TankVariantSchema),
  /** Faixa de capacidade informada no texto do catálogo (litros). */
  capacityRangeL: z.tuple([positive, positive]),
  /** Alturas informadas no texto do catálogo (m), quando não há tabela. */
  catalogHeights: z.array(positive).optional(),
  /** Altura dos pés informada pelo catálogo (m). */
  catalogSupportHeight: positive.optional(),
  /** Dimensões iniciais para um modelo fora da tabela. */
  customDefaults: z.object({
    capacityL: positive,
    diameter: positive,
    height: positive,
    length: positive.optional(),
  }),
  /** O que NÃO vem do catálogo: valores derivados, estimados ou de representação. */
  approximations: z.array(z.string()),
  /** Observações sobre a transcrição (divergências, marcas sem legenda). */
  remarks: z.array(z.string()),
  origin: z.enum(['builtin', 'custom']),
  /** Personalizadas: família de catálogo de que esta foi duplicada. */
  basedOn: z.string().optional(),
});
export type TankFamily = z.infer<typeof TankFamilySchema>;

export const ElementSchema = z.discriminatedUnion('kind', [
  PipeSchema,
  ElbowSchema,
  TeeSchema,
  ReducerSchema,
  ValveSchema,
  PumpSchema,
  TankSchema,
]);
export type HydroElement = z.infer<typeof ElementSchema>;
export type Fitting = Elbow | Tee | Reducer | Valve | Pump | Tank;
export type ElementKind = HydroElement['kind'];
export type FittingKind = Fitting['kind'];

export const PortRefSchema = z.object({
  elementId: z.string().min(1),
  portId: z.string().min(1),
});
export type PortRef = z.infer<typeof PortRefSchema>;

/** Aresta do grafo de conectividade: une duas portas de elementos distintos. */
export const ConnectionSchema = z.object({
  id: z.string().min(1),
  a: PortRefSchema,
  b: PortRefSchema,
});
export type Connection = z.infer<typeof ConnectionSchema>;

export const SYSTEM_KINDS = [
  'domesticColdWater',
  'domesticHotWater',
  'fireProtection',
  'waterSupply',
  'other',
] as const;
export const SystemKindSchema = z.enum(SYSTEM_KINDS);
export type SystemKind = z.infer<typeof SystemKindSchema>;

export const HydraulicSystemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  kind: SystemKindSchema,
  /** Cor de exibição (#rrggbb); ausente = cor do material. */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  /** Ausente = visível. */
  visible: z.boolean().optional(),
});
export type HydraulicSystem = z.infer<typeof HydraulicSystemSchema>;

// ---------------------------------------------------------------------------
// Famílias de conexões (catálogo dimensional editável)
// ---------------------------------------------------------------------------

export const FAMILY_KINDS = ['elbow', 'tee', 'reducer', 'valve'] as const;
export const FamilyKindSchema = z.enum(FAMILY_KINDS);
export type FamilyKind = z.infer<typeof FamilyKindSchema>;

export const FamilyEndSchema = z.object({
  length: nonNegative,
  outerDiameter: positive,
  ...flangeDrilling,
});
export type FamilyEnd = z.infer<typeof FamilyEndSchema>;

/**
 * Linha dimensional de uma família. Significado por tipo:
 *  - joelho: `centerToEnd` = vértice teórico à porta; em curvas ponta e bolsa, `centerToEnd`
 *    vale para a porta `a` (bolsa), `centerToEnd2` para a porta `b` (ponta) e `bendRadius` é
 *    o raio da linha de centro (o restante de cada lado é trecho reto); `end` descreve só a
 *    porta `a` e `end2`, se houver, a porta `b`;
 *  - tê: `centerToEnd` = centro à porta da passagem; `centerToBranch` = centro à derivação;
 *    `dn2` = DN da derivação (tê de redução);
 *  - redução: `length` = porta a porta; `dn` = maior, `dn2` = menor;
 *  - válvula: `length` = face a face; `height`/`handwheelDiameter` opcionais.
 * `end` descreve a extremidade do lado `dn`; `end2`, a do lado `dn2`.
 */
export const FamilySizeSchema = z.object({
  dn: positive,
  dn2: positive.optional(),
  centerToEnd: positive.optional(),
  centerToEnd2: positive.optional(),
  bendRadius: positive.optional(),
  centerToBranch: positive.optional(),
  length: positive.optional(),
  height: positive.optional(),
  handwheelDiameter: positive.optional(),
  width: positive.optional(),
  bonnetLength: positive.optional(),
  end: FamilyEndSchema.optional(),
  end2: FamilyEndSchema.optional(),
});
export type FamilySize = z.infer<typeof FamilySizeSchema>;

export const FittingFamilySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  kind: FamilyKindSchema,
  /** Especificação de tubo à qual a família se acopla. */
  specificationId: z.string().min(1),
  endType: EndTypeSchema,
  /** Joelhos: ângulo de deflexão da família (rad). */
  angle: positive.optional(),
  /** Válvulas: tipo da família. */
  valveType: ValveTypeSchema.optional(),
  manufacturer: z.string().nullable(),
  standard: z.string(),
  /** Referência da fonte dimensional (catálogo, página, URL). */
  source: z.string(),
  /** `builtin` = catálogo embutido; `custom` = criada ou alterada pelo usuário. */
  origin: z.enum(['builtin', 'custom']),
  sizes: z.array(FamilySizeSchema),
});
export type FittingFamily = z.infer<typeof FittingFamilySchema>;

export const LevelSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  /** Cota do nível (m). */
  elevation: finite,
});
export type Level = z.infer<typeof LevelSchema>;

/**
 * Georreferenciamento informado EXPLICITAMENTE pelo usuário: posição da origem local no
 * sistema projetado. Nunca é preenchido automaticamente.
 */
export const GeoreferenceSchema = z.object({
  /** Nome do sistema de referência (ex.: `SIRGAS 2000 / UTM zone 23S`). */
  crsName: z.string().min(1),
  epsg: z.number().int().positive().nullable(),
  eastings: finite,
  northings: finite,
  orthogonalHeight: finite,
  /** Rotação do eixo X local em relação ao leste, sentido anti-horário (rad). */
  rotation: finite,
  /**
   * Referência altimétrica das cotas (ex.: `Imbituba`, `Santana`, `local`). `null` = não
   * informada: as cotas valem só como cotas do projeto, sem datum vertical declarado.
   */
  verticalDatum: z.string().min(1).nullable(),
});
export type Georeference = z.infer<typeof GeoreferenceSchema>;

/**
 * Configuração própria do ambiente Infra (Planta Infra): escala de documentação, mapa de
 * fundo, camadas e rótulos. É independente da planta do MEP (`drawingScale`). Só guarda o que é
 * preciso para reabrir o projeto como foi deixado; zoom, filtros e origem de renderização são
 * estado de sessão e não entram aqui.
 */
export const InfraSettingsSchema = z.object({
  /** Denominador da escala de documentação da Planta Infra (1000 = 1:1.000). */
  drawingScale: positive,
  basemap: z.object({
    /**
     * Identificador da fonte de mapa (registro de provedores do editor); `null` = fundo técnico
     * limpo. O domínio não conhece o provedor: guarda só a escolha.
     */
    sourceId: z.string().min(1).nullable(),
    visible: z.boolean(),
    /** Opacidade da imagem, de 0 a 1. */
    opacity: z.number().min(0).max(1),
  }),
  layers: z.object({
    /** Tubos e conexões. */
    network: z.boolean(),
    /** Válvulas, bombas e reservatórios. */
    equipment: z.boolean(),
    /** Triangulação do terreno importado. */
    terrain: z.boolean(),
    /** Malha de coordenadas do sistema projetado. */
    references: z.boolean(),
    /** Cotas, textos, chamadas e etiquetas. */
    annotations: z.boolean(),
  }),
  labels: z.object({
    /** Identificação de nós e trechos. */
    names: z.boolean(),
    /** Comprimento dos trechos. */
    lengths: z.boolean(),
    /** Cotas do eixo nos nós e, havendo terreno sob o ponto, cota do terreno e recobrimento. */
    elevations: z.boolean(),
  }),
});
export type InfraSettings = z.infer<typeof InfraSettingsSchema>;

/** Escalas de documentação oferecidas na Planta Infra. */
export const INFRA_DRAWING_SCALES = [200, 500, 1000, 2000, 5000, 10000] as const;

/** Configuração inicial do ambiente Infra: fundo técnico, todas as camadas, sem rótulos. */
export function defaultInfraSettings(drawingScale = 1000): InfraSettings {
  return {
    drawingScale,
    basemap: { sourceId: null, visible: true, opacity: 1 },
    layers: { network: true, equipment: true, terrain: true, references: true, annotations: true },
    labels: { names: false, lengths: false, elevations: false },
  };
}

/**
 * Procedência dos dados de elevação de uma superfície. Tudo o que a fonte não declara fica
 * `null` (não informado): resolução do raster NÃO é exatidão altimétrica, e nenhuma das duas é
 * presumida.
 */
export const TerrainSourceSchema = z.object({
  /** `survey` = levantamento topográfico (pontos e linhas de quebra); `dem` = modelo raster. */
  kind: z.enum(['survey', 'dem']),
  /** Quem forneceu o dado (serviço, formato ou "Pontos XYZ"). */
  provider: z.string().min(1),
  /** Arquivo ou conjunto de dados de origem. */
  dataset: z.string().min(1).nullable(),
  /** Sistema de referência horizontal em que o dado foi recebido (ex.: `EPSG:3857`). */
  horizontalCrs: z.string().min(1).nullable(),
  /** Referência altimétrica declarada pela fonte; `null` = não declarada. */
  verticalDatum: z.string().min(1).nullable(),
  /** Espaçamento (m) entre as amostras do raster usadas na superfície; `null` em levantamentos. */
  resolution: positive.nullable(),
  /** Exatidão altimétrica (m) declarada pela fonte; `null` = não declarada. */
  verticalAccuracy: positive.nullable(),
  /** Quando o dado foi obtido ou importado (ISO 8601); `null` em superfícies antigas. */
  acquiredAt: z.string().min(1).nullable(),
  /** Atribuição exigida pela fonte. */
  attribution: z.string().min(1).nullable(),
  /** Ressalvas da fonte (sobreamostragem, lacunas, datum misto). */
  notes: z.string().min(1).nullable(),
});
export type TerrainSource = z.infer<typeof TerrainSourceSchema>;

/**
 * Superfície de terreno triangulada (TIN), em coordenadas locais do projeto (o sistema
 * horizontal e a referência altimétrica são os da georreferência do projeto). A estrutura —
 * pontos, faces, limite e linhas de quebra — é a mesma de uma superfície LandXML e de um
 * `IfcTriangulatedIrregularNetwork`, e a malha vai direto para faces 3D no DXF.
 */
export const TerrainSchema = z.object({
  name: z.string(),
  points: z.array(Vec3Schema),
  /** Índices dos vértices, três por triângulo, em sentido anti-horário em planta. */
  triangles: z.array(z.number().int().nonnegative()),
  /**
   * Limite da superfície: o primeiro anel é o contorno externo, os demais são furos; `null` =
   * envoltória convexa dos pontos. Nenhum triângulo fica fora do contorno ou dentro de um furo.
   */
  boundary: z.array(z.array(Vec3Schema).min(3)).min(1).nullable(),
  /** Linhas de quebra: arestas obrigatórias da triangulação (cristas, pés de talude, sarjetas). */
  breaklines: z.array(z.array(Vec3Schema).min(2)),
  source: TerrainSourceSchema,
});
export type Terrain = z.infer<typeof TerrainSchema>;

/** Procedência de um levantamento por pontos informado em arquivo. */
export function surveySource(dataset: string | null, acquiredAt: string | null): TerrainSource {
  return {
    kind: 'survey',
    provider: 'Pontos XYZ',
    dataset,
    horizontalCrs: null,
    verticalDatum: null,
    resolution: null,
    verticalAccuracy: null,
    acquiredAt,
    attribution: null,
    notes: null,
  };
}

// ---------------------------------------------------------------------------
// Documentação: anotações da planta baixa
// ---------------------------------------------------------------------------

/** Ponto da planta (projeção horizontal, plano XY), em metros. */
export const Point2Schema = z.object({ x: finite, y: finite });
export type Point2 = z.infer<typeof Point2Schema>;

export const DIMENSION_MODES = ['aligned', 'horizontal', 'vertical'] as const;
export const DimensionModeSchema = z.enum(DIMENSION_MODES);
export type DimensionMode = z.infer<typeof DimensionModeSchema>;

/**
 * Cota linear entre dois pontos da planta. O valor cotado é DERIVADO dos pontos
 * (nunca persistido): distância em planta (`aligned`), ΔX (`horizontal`) ou ΔY (`vertical`).
 */
export const DimensionAnnotationSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('dimension'),
  a: Point2Schema,
  b: Point2Schema,
  /** Afastamento da linha de cota em relação ao ponto `a`, na normal à direção cotada (m). */
  offset: finite,
  mode: DimensionModeSchema,
});
export type DimensionAnnotation = z.infer<typeof DimensionAnnotationSchema>;

/** Texto livre; com `leader`, é uma chamada (linha com seta até o ponto indicado). */
export const TextAnnotationSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('text'),
  position: Point2Schema,
  text: z.string().min(1),
  /** Rotação do texto, anti-horária (rad). */
  rotation: finite,
  leader: Point2Schema.optional(),
});
export type TextAnnotation = z.infer<typeof TextAnnotationSchema>;

/** Etiqueta de elemento: o conteúdo é DERIVADO do elemento (designação e comprimento). */
export const TagAnnotationSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('tag'),
  elementId: z.string().min(1),
  position: Point2Schema,
});
export type TagAnnotation = z.infer<typeof TagAnnotationSchema>;

export const AnnotationSchema = z.discriminatedUnion('kind', [
  DimensionAnnotationSchema,
  TextAnnotationSchema,
  TagAnnotationSchema,
]);
export type Annotation = z.infer<typeof AnnotationSchema>;

export const DisciplineSchema = z.enum(['mep', 'infra']);
export type Discipline = z.infer<typeof DisciplineSchema>;

export const ProjectSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string(),
  discipline: DisciplineSchema,
  units: z.object({ length: z.literal('m'), angle: z.literal('rad') }),
  createdAt: z.string(),
  updatedAt: z.string(),
  systems: z.array(HydraulicSystemSchema).min(1),
  levels: z.array(LevelSchema),
  /** Famílias personalizadas ou alteradas neste projeto (sobrepõem o catálogo embutido). */
  families: z.array(FittingFamilySchema),
  /** Famílias de reservatórios personalizadas neste projeto (somam-se ao catálogo embutido). */
  tankFamilies: z.array(TankFamilySchema),
  /**
   * Valores IFC informados pelo usuário para os TIPOS (`Ifc…Type`), por chave do tipo e
   * `Conjunto.Propriedade`. Valem para todas as ocorrências do mesmo tipo — inclusive as
   * criadas depois. As chaves dos tipos são geradas por `@hydrobim/ifc`.
   */
  ifcTypes: z.record(z.string(), z.record(z.string(), PropertyValueSchema)),
  georeference: GeoreferenceSchema.nullable(),
  terrain: TerrainSchema.nullable(),
  elements: z.array(ElementSchema),
  connections: z.array(ConnectionSchema),
  /** Anotações da planta baixa (cotas, textos, chamadas e etiquetas). */
  annotations: z.array(AnnotationSchema),
  /** Denominador da escala do desenho (50 = 1:50); define o tamanho de textos e cotas. */
  drawingScale: positive,
  /** Configuração da Planta Infra (independente da planta do MEP). */
  infra: InfraSettingsSchema,
});
export type Project = z.infer<typeof ProjectSchema>;
