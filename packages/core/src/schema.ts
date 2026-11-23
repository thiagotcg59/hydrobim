import { z } from 'zod';

/**
 * Esquema versionado do projeto HydroBIM (fonte única de verdade dos tipos de domínio).
 *
 * Unidades internas: SI — comprimentos em metros, ângulos em radianos.
 * O diâmetro nominal (DN) é uma designação adimensional e nunca substitui os
 * diâmetros físicos (externo/interno), que são armazenados explicitamente.
 */

export const PROJECT_FORMAT = 'hydrobim-project' as const;
export const SCHEMA_VERSION = 20 as const;

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
  /**
   * Curvatura a frio do próprio tubo: raio (m) da poligonal equivalente. O desvio admitido em
   * um vértice entre dois tubos é o comprimento do trecho vizinho mais curto dividido por
   * este raio. Dado de catálogo, com fonte; ausente = o tubo não é curvado.
   */
  coldBendRadius: positive.optional(),
  /** Comprimento da barra (m): o trecho contado em cada vértice não passa dele. */
  coldBendSpan: positive.optional(),
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

/**
 * Cruzeta: passagem ao longo de X (portas `a` e `b`) e duas derivações opostas, `branch` em +Y
 * e `branch2` em −Y, no mesmo diâmetro (`branchSpec` na cruzeta de redução). As quatro portas
 * são reais: uma derivação sem tubo fica livre — só um acessório (cap, flange cego) a fecharia.
 */
export const CrossSchema = z.object({
  ...fittingBase,
  kind: z.literal('cross'),
  /** Comprimento total da passagem direta, de porta a porta (m). */
  runLength: positive,
  /** Distância do centro à porta de cada derivação (m). */
  branchLength: positive,
  /** Especificação das derivações na cruzeta de redução; ausente = igual à passagem. */
  branchSpec: PipeSpecSchema.optional(),
});
export type Cross = z.infer<typeof CrossSchema>;

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

/**
 * Forma construtiva da bomba. Ausente no elemento = `generic` (conjunto motobomba de
 * representação: sucção axial, recalque vertical, sem identificação de produto).
 */
export const PUMP_TYPES = [
  'generic',
  // Bomba anfíbia em linha: sucção e descarga flangeadas e coaxiais, motor entre elas,
  // apoiada em dois pares de pés.
  'amphibious',
] as const;
export const PumpTypeSchema = z.enum(PUMP_TYPES);
export type PumpType = z.infer<typeof PumpTypeSchema>;

/**
 * Bomba. Sem `pumpType` é o conjunto motobomba genérico (sucção axial na porta `a`, recalque
 * vertical na porta `b`, posicionado por `dischargeOffset` e `dischargeHeight`).
 *
 * Bomba anfíbia (`pumpType: 'amphibious'`): a porta `a` (sucção, flange A do catálogo) fica
 * na origem e a porta `b` (descarga, flange B) no mesmo eixo, a `length` (cota F) de
 * distância. As demais cotas levam, na interface, as letras do dimensional do fabricante:
 * C = `footOffset`, D = `footSpan`, E = `rearLength`, G = `footWidth`, ØH =
 * `footHoleDiameter`, I = `axisHeight`, J = `totalHeight`. `familyId` identifica a família
 * de catálogo e `variantId`, a linha da tabela (ausente = cotas preenchidas pelo usuário).
 */
export const PumpSchema = z.object({
  ...fittingBase,
  kind: z.literal('pump'),
  /** Especificação do recalque (porta `b`). `spec` descreve a sucção (porta `a`). */
  dischargeSpec: PipeSpecSchema,
  /**
   * Comprimento total ao longo do eixo de sucção (m). Na bomba anfíbia é a cota F: de face a
   * face dos flanges.
   */
  length: positive,
  /** Genérica: distância da face de sucção ao eixo do recalque (m). */
  dischargeOffset: positive.optional(),
  /** Genérica: altura do eixo de sucção à face do recalque (m). */
  dischargeHeight: positive.optional(),
  /** Vazão nominal (m³/s) e altura manométrica (m), quando conhecidas. */
  ratedFlow: positive.optional(),
  ratedHead: positive.optional(),
  pumpType: PumpTypeSchema.optional(),
  /** Linha da tabela da família (`familyId`); ausente = cotas preenchidas pelo usuário. */
  variantId: z.string().min(1).optional(),
  /** Número de estágios (1 = estágio único); muda só a representação do corpo. */
  stages: z.number().int().positive().optional(),
  /** Classe de pressão dos flanges de sucção (A) e de descarga (B), ex.: `PN 40`. */
  suctionFlangeClass: z.string().min(1).optional(),
  dischargeFlangeClass: z.string().min(1).optional(),
  /** Cota C: da face do flange de descarga (B) ao primeiro par de pés (m). */
  footOffset: positive.optional(),
  /** Cota D: distância entre os dois pares de pés, ao longo do eixo (m). */
  footSpan: positive.optional(),
  /** Cota E: do segundo par de pés à face do flange de sucção (A) (m). */
  rearLength: positive.optional(),
  /** Cota G: distância entre os furos dos pés, transversal ao eixo (m). */
  footWidth: positive.optional(),
  /** Cota ØH: diâmetro dos furos dos pés (m). */
  footHoleDiameter: positive.optional(),
  /** Cota I: da base dos pés ao eixo da bomba (m). */
  axisHeight: positive.optional(),
  /** Cota J: altura total, da base dos pés ao topo (m). */
  totalHeight: positive.optional(),
});
export type Pump = z.infer<typeof PumpSchema>;

// ---------------------------------------------------------------------------
// Famílias de bombas (catálogo embutido e famílias personalizadas do projeto)
// ---------------------------------------------------------------------------

/** Flange de uma boca, como impresso no catálogo (ex.: DN 200 PN 40). */
export const PumpFlangeRefSchema = z.object({
  dn: positive,
  pressureClass: z.string().min(1),
});
export type PumpFlangeRef = z.infer<typeof PumpFlangeRefSchema>;

/** Cotas do dimensional (m), com os nomes dos parâmetros da bomba (letras C a J). */
export const PumpDimensionsSchema = z.object({
  footOffset: positive,
  footSpan: positive,
  rearLength: positive,
  length: positive,
  footWidth: positive,
  footHoleDiameter: positive,
  axisHeight: positive,
  totalHeight: positive,
});
export type PumpDimensions = z.infer<typeof PumpDimensionsSchema>;

/** Linha da tabela dimensional: vale para todos os modelos listados em `models`. */
export const PumpVariantSchema = z.object({
  id: z.string().min(1),
  /** Modelos a que a linha se aplica, como impressos. */
  models: z.array(z.string().min(1)).min(1),
  /** Carcaça do motor, como impressa. */
  frame: z.string(),
  /** Coluna A (sucção) e coluna B (descarga). */
  suction: PumpFlangeRefSchema,
  discharge: PumpFlangeRefSchema,
  dimensions: PumpDimensionsSchema,
  /** Peso (kg), como impresso; ausente = não informado. */
  weightKg: positive.optional(),
  /** Número de estágios. */
  stages: z.number().int().positive(),
});
export type PumpVariant = z.infer<typeof PumpVariantSchema>;

/**
 * Família de bombas: forma construtiva e tabela dimensional. `builtin` = transcrita do
 * catálogo de um fabricante; `custom` = criada no projeto (duplicada de uma família de
 * catálogo) — suas cotas são do usuário, não do fabricante.
 */
export const PumpFamilySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  pumpType: PumpTypeSchema.exclude(['generic']),
  manufacturer: z.string(),
  /** Frequência da rede a que a tabela se refere (Hz). */
  frequencyHz: positive,
  /** Documento, revisão, tabela e página; nas personalizadas, de onde a família veio. */
  source: z.string(),
  page: z.number().int().nonnegative(),
  description: z.string(),
  variants: z.array(PumpVariantSchema),
  /** O que NÃO vem do catálogo: valores derivados, estimados ou de representação. */
  approximations: z.array(z.string()),
  /** Observações sobre a transcrição (divergências do próprio catálogo). */
  remarks: z.array(z.string()),
  origin: z.enum(['builtin', 'custom']),
  /** Personalizadas: família de catálogo de que esta foi duplicada. */
  basedOn: z.string().optional(),
});
export type PumpFamily = z.infer<typeof PumpFamilySchema>;

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
  CrossSchema,
  ReducerSchema,
  ValveSchema,
  PumpSchema,
  TankSchema,
]);
export type HydroElement = z.infer<typeof ElementSchema>;
export type Fitting = Elbow | Tee | Cross | Reducer | Valve | Pump | Tank;
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

export const FAMILY_KINDS = ['elbow', 'tee', 'cross', 'reducer', 'valve'] as const;
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
 *  - cruzeta: como o tê, com `centerToBranch` valendo para as duas derivações;
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
const terrainMeshShape = {
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
};

/** Malha de uma superfície (pontos, faces, limite e linhas de quebra), sem a identificação. */
export const TerrainMeshSchema = z.object(terrainMeshShape);
export type TerrainMesh = z.infer<typeof TerrainMeshSchema>;

export const TerrainSchema = z.object({
  /** Identificador persistente da superfície (o mesmo no IFC e nas edições seguintes). */
  id: z.string().min(1),
  name: z.string(),
  /** Identificação dada pelo projetista (código da superfície); vazia = não informada. */
  tag: z.string(),
  ...terrainMeshShape,
  source: TerrainSourceSchema,
  /**
   * Superfície como foi importada ou gerada, guardada na primeira edição (pontos, cotas ou
   * limite) para comparação e para desfazer as edições; `null` = nunca editada. Os platôs não
   * alteram a superfície: o terreno projetado é derivado dela (`project.earthworks`).
   */
  original: TerrainMeshSchema.nullable(),
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

// ---------------------------------------------------------------------------
// Terraplenagem: platôs e parâmetros de volume
// ---------------------------------------------------------------------------

/**
 * Platô: área plana na cota de implantação, ligada ao terreno por taludes de inclinação
 * constante. É paramétrico — o terreno projetado, os taludes e os volumes são derivados
 * destes dados e da superfície natural, e nunca são gravados.
 */
export const PlatformSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  /** Perímetro em planta (anel fechado sem repetir o primeiro vértice), anti-horário. */
  outline: z.array(Point2Schema).min(3),
  /** Cota de implantação (Z local, m). */
  elevation: finite,
  /** Talude de corte, H:V: metros na horizontal por metro na vertical (1,5 = 1,5H:1V). */
  cutSlope: positive,
  /** Talude de aterro, H:V. */
  fillSlope: positive,
});
export type Platform = z.infer<typeof PlatformSchema>;

/**
 * Terraplenagem do projeto. Os três parâmetros de volume são do projetista (dependem do solo e
 * do controle de compactação): `null` = não informado, e as quantidades que dependem deles
 * ficam pendentes.
 */
export const EarthworksSchema = z.object({
  /** Platôs, na ordem de execução: cada um é aplicado sobre o resultado dos anteriores. */
  platforms: z.array(PlatformSchema),
  /** Empolamento (%): V solto = V corte in situ × (1 + empolamento ÷ 100). */
  swellPercent: z.number().min(0).max(200).nullable(),
  /**
   * Fator de conversão do corte para o aterro: m³ de aterro COMPACTADO obtidos de 1 m³ de
   * corte IN SITU (ex.: 0,90). Não é o grau de compactação.
   */
  compactionFactor: z.number().positive().max(2).nullable(),
  /** Parcela (%) do material escavado que serve para os aterros. */
  reusePercent: z.number().min(0).max(100).nullable(),
});
export type Earthworks = z.infer<typeof EarthworksSchema>;

export function defaultEarthworks(): Earthworks {
  return { platforms: [], swellPercent: null, compactionFactor: null, reusePercent: null };
}

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

// ---------------------------------------------------------------------------
// Vistas de projeto: plantas, cortes, elevações e vistas 3D
// ---------------------------------------------------------------------------

/**
 * Detalhes desenhados em uma vista 2D (linhas, polilinhas, retângulos, círculos, textos e
 * cotas). Pertencem à vista e ficam nas coordenadas dela (m): não são tubulação nem geometria
 * física, não entram no quantitativo, na validação da rede nem nas exportações do modelo.
 */
export const DetailLineSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('line'),
  a: Point2Schema,
  b: Point2Schema,
});
export type DetailLine = z.infer<typeof DetailLineSchema>;

export const DetailPolylineSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('polyline'),
  points: z.array(Point2Schema).min(2),
  closed: z.boolean(),
});
export type DetailPolyline = z.infer<typeof DetailPolylineSchema>;

/** Retângulo alinhado aos eixos da vista, por dois cantos opostos. */
export const DetailRectSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('rect'),
  a: Point2Schema,
  b: Point2Schema,
});
export type DetailRect = z.infer<typeof DetailRectSchema>;

export const DetailCircleSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('circle'),
  center: Point2Schema,
  radius: positive,
});
export type DetailCircle = z.infer<typeof DetailCircleSchema>;

/** Textos e cotas de detalhe têm a mesma forma das anotações da planta de trabalho. */
export const ViewDetailSchema = z.discriminatedUnion('kind', [
  DetailLineSchema,
  DetailPolylineSchema,
  DetailRectSchema,
  DetailCircleSchema,
  TextAnnotationSchema,
  DimensionAnnotationSchema,
]);
export type ViewDetail = z.infer<typeof ViewDetailSchema>;
export type ViewDetailKind = ViewDetail['kind'];

/** Categorias de elementos que uma vista pode ocultar. */
export const VIEW_CATEGORIES = [
  'pipes',
  'fittings',
  'valves',
  'equipment',
  'tanks',
  'walls',
  'floors',
  'doors',
  'windows',
  'spaces',
  'roofs',
  'ifcModels',
] as const;
export const ViewCategorySchema = z.enum(VIEW_CATEGORIES);
export type ViewCategory = z.infer<typeof ViewCategorySchema>;

/**
 * Visibilidade própria da vista. Soma-se à do sistema (`system.visible`): o que o projeto
 * oculta não aparece em vista nenhuma; o que a vista oculta continua nas demais.
 */
export const ViewVisibilitySchema = z.object({
  hiddenSystemIds: z.array(z.string().min(1)),
  hiddenCategories: z.array(ViewCategorySchema),
  /** Detalhes e marcadores de corte à mostra (vistas 2D). */
  details: z.boolean(),
});
export type ViewVisibility = z.infer<typeof ViewVisibilitySchema>;

const viewBase = {
  id: z.string().min(1),
  name: z.string().min(1),
  visibility: ViewVisibilitySchema,
};

const view2d = {
  ...viewBase,
  /** Denominador da escala de documentação da vista (50 = 1:50). */
  scale: positive,
  /** Estilo gráfico: tema (cores do modelo ou preto e branco) e traço fino na tela. */
  style: z.object({ theme: z.enum(['color', 'mono']), thinLines: z.boolean() }),
  /** Região de recorte, nas coordenadas da vista; `null` = nunca definida. */
  crop: z.object({ enabled: z.boolean(), min: Point2Schema, max: Point2Schema }).nullable(),
  /** Enquadramento salvo: centro e altura visível (m), nas coordenadas da vista. */
  frame: z.object({ center: Point2Schema, height: positive }).nullable(),
  details: z.array(ViewDetailSchema),
};

/**
 * Planta de um nível. A faixa de corte vai do plano de corte (`cutHeight` acima da cota do
 * nível) até `depth` abaixo dele: só o que está nessa faixa é desenhado, cortado nos limites.
 */
export const PlanViewSchema = z.object({
  ...view2d,
  kind: z.literal('plan'),
  levelId: z.string().min(1),
  cutHeight: finite,
  depth: positive,
  /**
   * Altura, acima do nível, do plano em que a ARQUITETURA é cortada (paredes, portas e
   * janelas aparecem em seção, com traço forte e hachura). A rede continua visível até
   * `cutHeight`: a tubulação junto ao teto não some da planta.
   */
  archCutHeight: positive,
  /** Orientação: giro do eixo horizontal da vista em relação a +X, anti-horário (rad). */
  rotation: finite,
});
export type PlanProjectView = z.infer<typeof PlanViewSchema>;

/** Plano de corte da arquitetura adotado em plantas novas: 1,20 m, dentro da faixa da vista. */
export function defaultArchCutHeight(cutHeight: unknown): number {
  const top = typeof cutHeight === 'number' && Number.isFinite(cutHeight) ? cutHeight : 1.2;
  return Math.max(0.1, Math.min(1.2, top));
}

/**
 * Corte vertical definido em planta pela linha `a`–`b` (coordenadas do projeto). `side` diz
 * para que lado se olha (+1 = à esquerda de quem vai de `a` para `b`); `depth` é o alcance da
 * vista a partir da linha. O corte só controla a visualização: o modelo não é alterado.
 */
export const SectionViewSchema = z.object({
  ...view2d,
  kind: z.literal('section'),
  a: Point2Schema,
  b: Point2Schema,
  side: z.union([z.literal(1), z.literal(-1)]),
  depth: positive,
});
export type SectionProjectView = z.infer<typeof SectionViewSchema>;

/** Elevação: a fachada indicada, vista de fora (ex.: `south` = observador ao sul, olhando o norte). */
export const ELEVATION_DIRECTIONS = ['north', 'south', 'east', 'west'] as const;
export const ElevationViewSchema = z.object({
  ...view2d,
  kind: z.literal('elevation'),
  direction: z.enum(ELEVATION_DIRECTIONS),
});
export type ElevationProjectView = z.infer<typeof ElevationViewSchema>;
export type ElevationDirection = (typeof ELEVATION_DIRECTIONS)[number];

/** Câmera salva: ponto observado, direção do alvo para o observador e meia altura visível. */
export const ViewCameraSchema = z.object({
  target: Vec3Schema,
  direction: Vec3Schema,
  halfHeight: positive,
  projection: z.enum(['perspective', 'orthographic']),
});
export type ViewCamera = z.infer<typeof ViewCameraSchema>;

/** Caixa de corte da vista 3D (coordenadas do projeto): fora dela nada é desenhado. */
export const SectionBoxSchema = z.object({
  enabled: z.boolean(),
  min: Vec3Schema,
  max: Vec3Schema,
});
export type SectionBox = z.infer<typeof SectionBoxSchema>;

export const View3dSchema = z.object({
  ...viewBase,
  kind: z.literal('3d'),
  /** `null` = câmera ainda não salva: a vista abre enquadrando o modelo. */
  camera: ViewCameraSchema.nullable(),
  sectionBox: SectionBoxSchema.nullable(),
  /** Estilo gráfico: sombreado ou aramado. */
  display: z.enum(['shaded', 'wireframe']),
});
export type ModelProjectView = z.infer<typeof View3dSchema>;

export const ProjectViewSchema = z.discriminatedUnion('kind', [
  PlanViewSchema,
  SectionViewSchema,
  ElevationViewSchema,
  View3dSchema,
]);
export type ProjectView = z.infer<typeof ProjectViewSchema>;
export type ProjectView2d = PlanProjectView | SectionProjectView | ElevationProjectView;
export type ProjectViewKind = ProjectView['kind'];

// ---------------------------------------------------------------------------
// Arquitetura: tipos, ocorrências (paredes, lajes, revestimentos de piso, portas e janelas)
// e ambientes
// ---------------------------------------------------------------------------

/**
 * Os elementos arquitetônicos vivem em `Project.architecture`, FORA de `Project.elements`:
 * não têm sistema hidráulico, DN, especificação de tubo nem portas, e por isso não entram no
 * grafo de conectividade. Compartilham com a rede os níveis, as coordenadas e as vistas.
 *
 * Três níveis, como nas famílias hidráulicas:
 *  - FAMÍLIA: a tipologia do catálogo (`@hydrobim/catalog`), ex.: "Parede de alvenaria";
 *  - TIPO (`ArchType`): a família com dimensões e composição definidas, guardado no projeto;
 *  - OCORRÊNCIA (`ArchElement`): cada elemento posicionado, que aponta o seu tipo.
 */
export const ARCH_CATEGORIES = ['wall', 'slab', 'flooring', 'roof', 'door', 'window'] as const;
export const ArchCategorySchema = z.enum(ARCH_CATEGORIES);
export type ArchCategory = z.infer<typeof ArchCategorySchema>;

/** Função da camada na composição (vira a categoria da camada de material no IFC). */
export const ARCH_LAYER_FUNCTIONS = [
  'structure',
  'substrate',
  'finish',
  'insulation',
  'membrane',
  'other',
] as const;
export const ArchLayerFunctionSchema = z.enum(ARCH_LAYER_FUNCTIONS);
export type ArchLayerFunction = z.infer<typeof ArchLayerFunctionSchema>;

/**
 * Hachura da camada quando cortada por uma vista. É representação gráfica escolhida no tipo:
 * o caderno de referência só fixa o sistema "Hachura" (Apêndice I) e remete os padrões à
 * norma de desenho — nenhum padrão é presumido por material.
 */
export const ARCH_HATCHES = ['none', 'solid', 'diagonal', 'crossed', 'dotted'] as const;
export const ArchHatchSchema = z.enum(ARCH_HATCHES);
export type ArchHatch = z.infer<typeof ArchHatchSchema>;

/** Camada de material de um tipo (parede, laje ou revestimento), na ordem de montagem. */
export const ArchLayerSchema = z.object({
  id: z.string().min(1),
  /** Material da camada, como descrito pelo usuário ou pela fonte (vira `IfcMaterial`). */
  material: z.string().min(1),
  thickness: positive,
  function: ArchLayerFunctionSchema,
  hatch: ArchHatchSchema,
});
export type ArchLayer = z.infer<typeof ArchLayerSchema>;

/**
 * Classificação externa do tipo (ABNT NBR 15965, SINAPI ou outra). Complementa a entidade
 * IFC — nunca a substitui. O código é sempre informado pelo usuário: não há tabela embutida.
 */
export const ARCH_CLASSIFICATION_SYSTEMS = ['nbr15965', 'sinapi', 'other'] as const;
export const ArchClassificationSchema = z.object({
  system: z.enum(ARCH_CLASSIFICATION_SYSTEMS),
  /** Nome do sistema, quando `other`; tabela da NBR 15965 (ex.: `3E`), quando informada. */
  table: z.string().min(1).optional(),
  code: z.string().min(1),
  description: z.string().min(1).optional(),
});
export type ArchClassification = z.infer<typeof ArchClassificationSchema>;

const archTypeBase = {
  id: z.string().min(1),
  name: z.string().min(1),
  /** Família do catálogo de que o tipo veio; `null` = criado sem família. */
  familyId: z.string().min(1).nullable(),
  /**
   * `true` = modelo genérico parametrizável: dimensões e composição são do usuário, sem
   * produto comercial. `false` = produto de fabricante, e então `source` é obrigatória.
   */
  generic: z.boolean(),
  /** Fonte dos valores: fabricante, catálogo, edição, página e URL. `null` nos genéricos. */
  source: z.string().min(1).nullable(),
  manufacturing: ManufacturingSchema,
  classifications: z.array(ArchClassificationSchema),
  /** Tipo predefinido IFC da categoria (`IfcWallTypeEnum`, `IfcSlabTypeEnum`…). */
  ifcPredefinedType: z.string().min(1),
  /**
   * Valores IFC informados pelo usuário para o TIPO, por `Conjunto.Propriedade`, em SI.
   * Valem para todas as ocorrências, salvo o que a ocorrência sobrescrever.
   */
  ifc: z.record(z.string(), PropertyValueSchema),
};

const layeredType = {
  ...archTypeBase,
  /** Composição: a espessura do tipo é a soma das camadas. */
  layers: z.array(ArchLayerSchema).min(1),
};

/** Camadas da face esquerda para a direita de quem percorre a parede do início ao fim. */
export const WallTypeSchema = z.object({ ...layeredType, category: z.literal('wall') });
export type WallType = z.infer<typeof WallTypeSchema>;

/** Laje estrutural de piso. Camadas de cima para baixo. */
export const SlabTypeSchema = z.object({ ...layeredType, category: z.literal('slab') });
export type SlabType = z.infer<typeof SlabTypeSchema>;

/** Revestimento (acabamento) de piso, aplicado sobre a laje. Camadas de cima para baixo. */
export const FlooringTypeSchema = z.object({ ...layeredType, category: z.literal('flooring') });
export type FlooringType = z.infer<typeof FlooringTypeSchema>;

/**
 * Tipologias de telhado modeladas. `shed` = uma água (um plano inclinado); `gable` = duas
 * águas iguais, com a cumeeira no meio do vão. Quatro águas e coberturas compostas ainda não
 * existem (ver `docs/ROADMAP.md`).
 */
export const ROOF_SHAPES = ['shed', 'gable'] as const;
export const RoofShapeSchema = z.enum(ROOF_SHAPES);
export type RoofShape = z.infer<typeof RoofShapeSchema>;

/**
 * Tipo de telhado: a tipologia e a composição. Camadas de cima (telha) para baixo; a espessura
 * do tipo é a soma delas, medida PERPENDICULARMENTE à água.
 */
export const RoofTypeSchema = z.object({
  ...layeredType,
  category: z.literal('roof'),
  shape: RoofShapeSchema,
});
export type RoofType = z.infer<typeof RoofTypeSchema>;

export const DOOR_OPERATIONS = ['singleSwing', 'doubleSwing', 'sliding', 'pivot'] as const;
export const DoorOperationSchema = z.enum(DOOR_OPERATIONS);
export type DoorOperation = z.infer<typeof DoorOperationSchema>;

/** Materiais dos componentes da esquadria, quando informados (sem valor = pendente). */
const JoineryMaterialsSchema = z.object({
  frame: z.string().min(1).optional(),
  panel: z.string().min(1).optional(),
  glazing: z.string().min(1).optional(),
});
export type JoineryMaterials = z.infer<typeof JoineryMaterialsSchema>;

export const DOOR_FRIEZE_ORIENTATIONS = ['horizontal', 'vertical'] as const;

/**
 * Friso reto da folha, de borda a borda. `position` é uma FRAÇÃO da folha (não uma cota), para
 * o desenho acompanhar qualquer medida do modelo: no friso horizontal, da base para o topo; no
 * vertical, da borda das dobradiças para a da fechadura.
 */
export const DoorFriezeSchema = z.object({
  orientation: z.enum(DOOR_FRIEZE_ORIENTATIONS),
  position: z.number().gt(0).lt(1),
});
export type DoorFrieze = z.infer<typeof DoorFriezeSchema>;

/**
 * Desenho da folha (frisos). `schematic: true` = a fonte ilustra os frisos mas não cota a
 * posição deles: quantidade e orientação são do produto, a posição é representação (regra 8).
 */
export const DoorLeafDesignSchema = z.object({
  friezes: z.array(DoorFriezeSchema).min(1),
  /** Largura do friso (m). */
  friezeWidth: positive,
  schematic: z.boolean(),
});
export type DoorLeafDesign = z.infer<typeof DoorLeafDesignSchema>;

export const DoorTypeSchema = z.object({
  ...archTypeBase,
  category: z.literal('door'),
  operation: DoorOperationSchema,
  /** Dimensões nominais do vão (m). */
  width: positive,
  height: positive,
  /** Largura aparente do marco (batente), em cada lado e no topo (m). */
  frameWidth: positive,
  /** Espessura da folha (m). */
  panelThickness: positive,
  materials: JoineryMaterialsSchema,
  /** Desenho da folha, quando o modelo tem frisos; ausente = folha lisa. */
  leaf: DoorLeafDesignSchema.optional(),
});
export type DoorType = z.infer<typeof DoorTypeSchema>;

export const WINDOW_OPERATIONS = [
  'fixed',
  'sliding',
  'casement',
  'pivotHorizontal',
  'topHung',
] as const;
export const WindowOperationSchema = z.enum(WINDOW_OPERATIONS);
export type WindowOperation = z.infer<typeof WindowOperationSchema>;

export const WindowTypeSchema = z.object({
  ...archTypeBase,
  category: z.literal('window'),
  /** `pivotHorizontal` = basculante; `topHung` = maxim-ar. */
  operation: WindowOperationSchema,
  /** Dimensões nominais do vão (m). */
  width: positive,
  height: positive,
  /** Peitoril adotado ao inserir (m acima da base da parede); a ocorrência guarda o seu. */
  sillHeight: nonNegative,
  /** Número de folhas lado a lado. */
  panels: z.number().int().positive(),
  /** Largura aparente do marco da esquadria (m). */
  frameWidth: positive,
  materials: JoineryMaterialsSchema,
});
export type WindowType = z.infer<typeof WindowTypeSchema>;

export const ArchTypeSchema = z.discriminatedUnion('category', [
  WallTypeSchema,
  SlabTypeSchema,
  FlooringTypeSchema,
  RoofTypeSchema,
  DoorTypeSchema,
  WindowTypeSchema,
]);
export type ArchType = z.infer<typeof ArchTypeSchema>;
export type LayeredArchType = WallType | SlabType | FlooringType | RoofType;

const archElementBase = {
  /** Identificador persistente (UUID): base do GlobalId IFC. Nunca muda. */
  id: z.string().min(1),
  name: z.string(),
  /** Propriedades livres definidas pelo usuário. */
  properties: z.record(z.string(), PropertyValueSchema),
  /** Valores IFC informados pelo usuário para ESTA ocorrência (sobrepõem os do tipo). */
  ifc: z.record(z.string(), PropertyValueSchema).optional(),
  meta: ElementMetaSchema,
};

/**
 * Onde a linha de referência (`start`–`end`) fica na espessura da parede: no eixo, na face
 * esquerda ou na face direita (esquerda de quem vai do início ao fim).
 */
export const WALL_LOCATION_LINES = ['center', 'faceLeft', 'faceRight'] as const;
export const WallLocationLineSchema = z.enum(WALL_LOCATION_LINES);
export type WallLocationLine = z.infer<typeof WallLocationLineSchema>;

/**
 * Parede reta. A base fica em `cota do nível + baseOffset`; os encontros em L e em T com as
 * paredes vizinhas são DERIVADOS (extremidades coincidentes ou apoiadas), nunca gravados.
 */
export const WallSchema = z.object({
  ...archElementBase,
  kind: z.literal('wall'),
  typeId: z.string().min(1),
  levelId: z.string().min(1),
  start: Point2Schema,
  end: Point2Schema,
  locationLine: WallLocationLineSchema,
  /** Deslocamento vertical da base em relação ao nível (m). */
  baseOffset: finite,
  height: positive,
});
export type Wall = z.infer<typeof WallSchema>;

/** Abertura (vão) em laje ou revestimento: contorno fechado, sem repetir o primeiro ponto. */
export const FloorOpeningSchema = z.object({
  id: z.string().min(1),
  boundary: z.array(Point2Schema).min(3),
});
export type FloorOpening = z.infer<typeof FloorOpeningSchema>;

const floorBase = {
  ...archElementBase,
  typeId: z.string().min(1),
  levelId: z.string().min(1),
  /** Contorno fechado em planta (anti-horário), sem repetir o primeiro ponto. */
  boundary: z.array(Point2Schema).min(3),
  openings: z.array(FloorOpeningSchema),
};

/** Laje estrutural de piso: `offset` é a cota do TOPO em relação ao nível (m). */
export const SlabSchema = z.object({ ...floorBase, kind: z.literal('slab'), offset: finite });
export type Slab = z.infer<typeof SlabSchema>;

/** Revestimento de piso: `offset` é a cota da BASE em relação ao nível (m). */
export const FlooringSchema = z.object({
  ...floorBase,
  kind: z.literal('flooring'),
  offset: finite,
});
export type Flooring = z.infer<typeof FlooringSchema>;

/**
 * Telhado de uma ou duas águas sobre contorno RETANGULAR (a tipologia é do tipo).
 *
 * - `boundary`: os quatro cantos do retângulo de referência, em planta (anti-horário) — em
 *   geral a face externa ou o eixo das paredes que recebem o telhado.
 * - `eaveEdge`: lado do contorno (0 = do 1º ao 2º canto) que é BEIRAL. Uma água: a água cai
 *   para esse lado. Duas águas: a cumeeira é paralela a ele, no meio do vão. A direção nunca
 *   contradiz o contorno, pois é um lado dele.
 * - Cota de referência (`cota do nível + offset`): a da face INFERIOR do telhado sobre a linha
 *   do beiral do contorno (a linha de apoio).
 * - `slope`: inclinação das águas em relação ao plano horizontal (rad).
 * - `overhang`: beiral, medido na HORIZONTAL para fora do contorno, nos quatro lados; a água
 *   continua com a mesma inclinação, de modo que a borda do beiral fica abaixo da referência.
 */
export const RoofSchema = z.object({
  ...archElementBase,
  kind: z.literal('roof'),
  typeId: z.string().min(1),
  levelId: z.string().min(1),
  boundary: z.array(Point2Schema).length(4),
  eaveEdge: z.number().int().min(0).max(3),
  /** Deslocamento vertical da cota de referência em relação ao nível (m). */
  offset: finite,
  slope: positive,
  overhang: nonNegative,
});
export type Roof = z.infer<typeof RoofSchema>;

const hostedBase = {
  ...archElementBase,
  typeId: z.string().min(1),
  /** Parede hospedeira: o vão acompanha a parede e não existe sem ela. */
  hostId: z.string().min(1),
  /** Distância do início da linha de referência da parede ao centro do vão (m). */
  offset: finite,
  /** Altura da soleira ou do peitoril acima da base da parede (m). */
  sillHeight: nonNegative,
  /** Lado das dobradiças (ou de recolhimento), visto de quem percorre a parede. */
  hand: z.enum(['left', 'right']),
  /** Face para a qual a folha abre: +1 = lado esquerdo da parede; −1 = lado direito. */
  facing: z.union([z.literal(1), z.literal(-1)]),
};

export const DoorSchema = z.object({ ...hostedBase, kind: z.literal('door') });
export type Door = z.infer<typeof DoorSchema>;

export const WindowSchema = z.object({ ...hostedBase, kind: z.literal('window') });
export type ArchWindow = z.infer<typeof WindowSchema>;

/**
 * Ambiente (espaço). Não é elemento físico: delimita uma região do pavimento, de que se
 * derivam área e perímetro. `height` (pé-direito) fica `null` enquanto não for informado.
 */
export const SpaceSchema = z.object({
  ...archElementBase,
  kind: z.literal('space'),
  levelId: z.string().min(1),
  /** Número ou sigla do ambiente, quando houver. */
  number: z.string().min(1).optional(),
  boundary: z.array(Point2Schema).min(3),
  /** Cota do piso acabado em relação ao nível (m). */
  offset: finite,
  height: positive.nullable(),
});
export type Space = z.infer<typeof SpaceSchema>;

export const ArchElementSchema = z.discriminatedUnion('kind', [
  WallSchema,
  SlabSchema,
  FlooringSchema,
  RoofSchema,
  DoorSchema,
  WindowSchema,
  SpaceSchema,
]);
export type ArchElement = z.infer<typeof ArchElementSchema>;
export type ArchElementKind = ArchElement['kind'];
export type HostedElement = Door | ArchWindow;
export type FloorElement = Slab | Flooring;

export const ArchitectureSchema = z.object({
  /** Tipos usados ou personalizados neste projeto (o projeto é autossuficiente). */
  types: z.array(ArchTypeSchema),
  elements: z.array(ArchElementSchema),
});
export type Architecture = z.infer<typeof ArchitectureSchema>;

// --- Modelos IFC importados --------------------------------------------------------------
//
// Objetos de referência lidos de arquivos .ifc de terceiros. Não são elementos da rede nem da
// arquitetura: não têm portas, especificação nem edição paramétrica. O projeto guarda o
// arquivo-fonte íntegro, quais objetos foram incluídos e as transformações; malhas e
// propriedades são relidas da fonte (nunca gravadas).

/** Limites documentados da importação (`docs/IFC_IMPORT.md`). */
export const IFC_IMPORT_LIMITS = {
  /** Tamanho máximo do arquivo .ifc, em bytes. */
  maxFileBytes: 100 * 1024 * 1024,
  /** Máximo de objetos incluídos por modelo. */
  maxObjects: 50_000,
} as const;

export const IFC_SOURCE_ENCODINGS = ['gzip-base64'] as const;

/**
 * Arquivo-fonte, guardado como veio (compactado, sem alteração de conteúdo): `sha256` e
 * `byteLength` são do arquivo original. `data` vazio = a fonte não está embutida neste
 * documento (cópia de trabalho do navegador, que a guarda à parte); o arquivo baixado sempre
 * a traz.
 */
export const IfcSourceSchema = z.object({
  fileName: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  encoding: z.enum(IFC_SOURCE_ENCODINGS),
  data: z.string(),
});
export type IfcSource = z.infer<typeof IfcSourceSchema>;

/**
 * Transformação rígida em planta: giro em torno de Z (radianos, anti-horário visto de cima)
 * seguido de translação (metros). Sem escala e sem inclinação: a geometria do arquivo é
 * preservada.
 */
export const IfcTransformSchema = z.object({ translation: Vec3Schema, rotation: finite });
export type IfcTransform = z.infer<typeof IfcTransformSchema>;

/** Como o posicionamento foi definido na importação (registro; o que vale é a transformação). */
export const IFC_PLACEMENT_MODES = ['original', 'basePoint', 'offset', 'aligned'] as const;
export const IfcPlacementModeSchema = z.enum(IFC_PLACEMENT_MODES);
export type IfcPlacementMode = z.infer<typeof IfcPlacementModeSchema>;

/**
 * Objeto incluído. `id` é a identidade interna, persistente e única no projeto; `expressId`
 * e `globalId` apontam a entidade no arquivo-fonte (que não muda). Uma cópia é outro objeto
 * (outro `id`, `copy: true`) da mesma entidade.
 */
export const IfcImportedObjectSchema = z.object({
  id: z.string().min(1),
  expressId: z.number().int().positive(),
  globalId: z.string(),
  /**
   * Transformação própria do componente, no referencial do arquivo (aplicada ANTES da do
   * modelo); `null` = no lugar original dentro do modelo.
   */
  transform: IfcTransformSchema.nullable(),
  copy: z.boolean(),
});
export type IfcImportedObject = z.infer<typeof IfcImportedObjectSchema>;

export const IfcImportedModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: IfcSourceSchema,
  /** Esquema declarado no cabeçalho do arquivo (ex.: `IFC2X3`, `IFC4`, `IFC4X3_ADD2`). */
  schema: z.string().min(1),
  /** Unidade de comprimento declarada no arquivo e quantos metros ela vale (registro). */
  lengthUnit: z.string(),
  unitScale: positive,
  importedAt: z.string(),
  placementMode: IfcPlacementModeSchema,
  /** Do referencial do arquivo (em metros, Z para cima) para o do projeto. */
  placement: IfcTransformSchema,
  visible: z.boolean(),
  /** Opacidade de exibição, de 0,05 a 1. */
  opacity: z.number().min(0.05).max(1),
  objects: z.array(IfcImportedObjectSchema),
});
export type IfcImportedModel = z.infer<typeof IfcImportedModelSchema>;

export const DisciplineSchema = z.enum(['mep', 'infra', 'architecture']);
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
  /** Famílias de bombas personalizadas (somam-se ao catálogo). */
  pumpFamilies: z.array(PumpFamilySchema),
  /**
   * Valores IFC informados pelo usuário para os TIPOS (`Ifc…Type`), por chave do tipo e
   * `Conjunto.Propriedade`. Valem para todas as ocorrências do mesmo tipo — inclusive as
   * criadas depois. As chaves dos tipos são geradas por `@hydrobim/ifc`.
   */
  ifcTypes: z.record(z.string(), z.record(z.string(), PropertyValueSchema)),
  georeference: GeoreferenceSchema.nullable(),
  terrain: TerrainSchema.nullable(),
  /** Platôs e parâmetros de volume; o terreno projetado é derivado (nunca gravado). */
  earthworks: EarthworksSchema,
  elements: z.array(ElementSchema),
  connections: z.array(ConnectionSchema),
  /** Anotações da planta baixa (cotas, textos, chamadas e etiquetas). */
  annotations: z.array(AnnotationSchema),
  /** Denominador da escala do desenho (50 = 1:50); define o tamanho de textos e cotas. */
  drawingScale: positive,
  /** Configuração da Planta Infra (independente da planta do MEP). */
  infra: InfraSettingsSchema,
  /**
   * Vistas de projeto (plantas por nível, cortes, elevações e vistas 3D), na ordem do
   * navegador. Todas representam o mesmo modelo: guardam só como ele é mostrado e os
   * detalhes 2D desenhados sobre a vista.
   */
  views: z.array(ProjectViewSchema),
  /**
   * Modelo arquitetônico (tipos, paredes, lajes, revestimentos, telhados, portas, janelas e
   * ambientes),
   * no mesmo projeto, níveis e coordenadas da rede hidráulica.
   */
  architecture: ArchitectureSchema,
  /** Modelos IFC importados como referência (arquivo-fonte, objetos incluídos e posição). */
  ifcModels: z.array(IfcImportedModelSchema),
});
export type Project = z.infer<typeof ProjectSchema>;
