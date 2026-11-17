import { z } from 'zod';

/**
 * Esquema versionado do projeto HydroBIM (fonte única de verdade dos tipos de domínio).
 *
 * Unidades internas: SI — comprimentos em metros, ângulos em radianos.
 * O diâmetro nominal (DN) é uma designação adimensional e nunca substitui os
 * diâmetros físicos (externo/interno), que são armazenados explicitamente.
 */

export const PROJECT_FORMAT = 'hydrobim-project' as const;
export const SCHEMA_VERSION = 1 as const;

const finite = z.number().finite();
const positive = finite.positive();

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

const elementBase = {
  /** Identificador persistente (UUID). Nunca muda durante a vida do elemento. */
  id: z.string().min(1),
  name: z.string(),
  systemId: z.string().min(1),
  spec: PipeSpecSchema,
  /** Propriedades BIM livres definidas pelo usuário. */
  properties: z.record(z.string(), PropertyValueSchema),
  manufacturing: ManufacturingSchema,
  meta: ElementMetaSchema,
};

/** Posicionamento de uma conexão: origem e orientação do referencial local. */
export const PlacementSchema = z.object({ position: Vec3Schema, rotation: QuatSchema });
export type Placement = z.infer<typeof PlacementSchema>;

export const PipeSchema = z.object({
  ...elementBase,
  kind: z.literal('pipe'),
  start: Vec3Schema,
  end: Vec3Schema,
});
export type Pipe = z.infer<typeof PipeSchema>;

export const ElbowSchema = z.object({
  ...elementBase,
  kind: z.literal('elbow'),
  placement: PlacementSchema,
  /** Ângulo de deflexão (rad): 90° = joelho de 90°. */
  angle: positive,
  /** Raio de curvatura na linha de centro (m). */
  bendRadius: positive,
});
export type Elbow = z.infer<typeof ElbowSchema>;

export const TeeSchema = z.object({
  ...elementBase,
  kind: z.literal('tee'),
  placement: PlacementSchema,
  /** Comprimento total da passagem direta, de face a face (m). */
  runLength: positive,
  /** Distância do centro à face da derivação (m). */
  branchLength: positive,
});
export type Tee = z.infer<typeof TeeSchema>;

export const ReducerSchema = z.object({
  ...elementBase,
  kind: z.literal('reducer'),
  placement: PlacementSchema,
  /** Especificação da segunda extremidade (porta `b`). `spec` descreve a porta `a`. */
  outletSpec: PipeSpecSchema,
  length: positive,
});
export type Reducer = z.infer<typeof ReducerSchema>;

export const VALVE_TYPES = ['gate', 'globe', 'ball', 'butterfly', 'check'] as const;
export const ValveTypeSchema = z.enum(VALVE_TYPES);
export type ValveType = z.infer<typeof ValveTypeSchema>;

export const ValveSchema = z.object({
  ...elementBase,
  kind: z.literal('valve'),
  placement: PlacementSchema,
  valveType: ValveTypeSchema,
  /** Comprimento face a face (m). */
  length: positive,
});
export type Valve = z.infer<typeof ValveSchema>;

export const ElementSchema = z.discriminatedUnion('kind', [
  PipeSchema,
  ElbowSchema,
  TeeSchema,
  ReducerSchema,
  ValveSchema,
]);
export type HydroElement = z.infer<typeof ElementSchema>;
export type Fitting = Elbow | Tee | Reducer | Valve;
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
});
export type HydraulicSystem = z.infer<typeof HydraulicSystemSchema>;

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
  elements: z.array(ElementSchema),
  connections: z.array(ConnectionSchema),
});
export type Project = z.infer<typeof ProjectSchema>;
