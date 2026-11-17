import { z } from 'zod';

/**
 * Esquema versionado do projeto HydroBIM (fonte única de verdade dos tipos de domínio).
 *
 * Unidades internas: SI — comprimentos em metros, ângulos em radianos.
 * O diâmetro nominal (DN) é uma designação adimensional e nunca substitui os
 * diâmetros físicos (externo/interno), que são armazenados explicitamente.
 */

export const PROJECT_FORMAT = 'hydrobim-project' as const;
export const SCHEMA_VERSION = 3 as const;

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
 * Acabamento da extremidade de uma conexão em uma porta:
 *  - `plain`: ponta lisa (solda de topo, termofusão);
 *  - `socket`: bolsa — `length` é a profundidade além da porta (sobre o tubo);
 *  - `flange`: flange — `length` é a espessura, da face (porta) para dentro da peça.
 */
export const EndTreatmentSchema = z.object({
  type: EndTypeSchema,
  length: nonNegative,
  outerDiameter: positive,
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

export const PipeSchema = z.object({
  ...elementBase,
  kind: z.literal('pipe'),
  start: Vec3Schema,
  end: Vec3Schema,
});
export type Pipe = z.infer<typeof PipeSchema>;

export const ElbowSchema = z.object({
  ...fittingBase,
  kind: z.literal('elbow'),
  /** Ângulo de deflexão (rad): 90° = joelho de 90°. */
  angle: positive,
  /** Raio de curvatura na linha de centro (m). */
  bendRadius: positive,
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
] as const;
export const ValveTypeSchema = z.enum(VALVE_TYPES);
export type ValveType = z.infer<typeof ValveTypeSchema>;

export const ValveSchema = z.object({
  ...fittingBase,
  kind: z.literal('valve'),
  valveType: ValveTypeSchema,
  /** Comprimento face a face (m). Na ventosa (`airRelease`): altura acima da porta. */
  length: positive,
  /** Altura do eixo ao topo do acionamento (m), quando informada pelo catálogo. */
  height: positive.optional(),
  /** Diâmetro do volante (m), quando informado pelo catálogo. */
  handwheelDiameter: positive.optional(),
  /** Largura máxima / diâmetro da tampa do atuador (m), quando informada pelo catálogo. */
  width: positive.optional(),
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

/** Reservatório cilíndrico vertical com dois bocais radiais opostos. */
export const TankSchema = z.object({
  ...fittingBase,
  kind: z.literal('tank'),
  diameter: positive,
  height: positive,
  /** Altura do eixo do bocal de saída (porta `a`) acima da base (m). */
  outletHeight: nonNegative,
  /** Altura do eixo do bocal de entrada (porta `b`) acima da base (m). */
  inletHeight: nonNegative,
  /** Comprimento dos bocais além do costado (m). */
  nozzleLength: positive,
});
export type Tank = z.infer<typeof TankSchema>;

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

export const FamilyEndSchema = z.object({ length: nonNegative, outerDiameter: positive });
export type FamilyEnd = z.infer<typeof FamilyEndSchema>;

/**
 * Linha dimensional de uma família. Significado por tipo:
 *  - joelho: `centerToEnd` = vértice teórico à porta;
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
  centerToBranch: positive.optional(),
  length: positive.optional(),
  height: positive.optional(),
  handwheelDiameter: positive.optional(),
  width: positive.optional(),
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
});
export type Georeference = z.infer<typeof GeoreferenceSchema>;

/** Superfície de terreno triangulada (TIN), em coordenadas locais do projeto. */
export const TerrainSchema = z.object({
  name: z.string(),
  points: z.array(Vec3Schema),
  /** Índices dos vértices, três por triângulo. */
  triangles: z.array(z.number().int().nonnegative()),
});
export type Terrain = z.infer<typeof TerrainSchema>;

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
  georeference: GeoreferenceSchema.nullable(),
  terrain: TerrainSchema.nullable(),
  elements: z.array(ElementSchema),
  connections: z.array(ConnectionSchema),
});
export type Project = z.infer<typeof ProjectSchema>;
