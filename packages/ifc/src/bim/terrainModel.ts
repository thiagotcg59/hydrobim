import { terrainStats, type Project, type Terrain, type TerrainStats } from '@hydrobim/core';
import { persistentGuid } from '../guid';
import { unitOfIfcType } from './definitions';
import { IFC_ENTITIES } from './schemaData';
import type {
  IfcClassification,
  IfcPropertyInfo,
  IfcPropertySetInfo,
  IfcValue,
  IfcValueOrigin,
} from './types';

/**
 * Modelo de informação IFC da SUPERFÍCIE DO TERRENO: classificação, atributos e conjuntos de
 * propriedades e de quantidades. É derivado do projeto a cada consulta — o painel de
 * propriedades e o arquivo exportado leem a mesma estrutura, de modo que o que se vê é o que
 * se grava.
 *
 * O esquema IFC 4.3 não traz conjunto padronizado (`Pset_*`/`Qto_*`) para
 * `IfcGeographicElement`: a procedência dos dados e as medidas da superfície vão em conjuntos
 * próprios, com o prefixo `HydroBIM_`.
 */

export const TERRAIN_IFC_ENTITY = 'IfcGeographicElement';
export const TERRAIN_IFC_PREDEFINED_TYPE = 'TERRAIN';

if (!IFC_ENTITIES[TERRAIN_IFC_ENTITY]?.predefinedTypes.includes(TERRAIN_IFC_PREDEFINED_TYPE)) {
  throw new Error(
    `Classificação inexistente no esquema IFC 4.3: ${TERRAIN_IFC_ENTITY}.${TERRAIN_IFC_PREDEFINED_TYPE}.`,
  );
}

interface TerrainDefinitionContext {
  readonly project: Project;
  readonly terrain: Terrain;
  readonly stats: TerrainStats;
}

interface TerrainPropertyDefinition {
  readonly set: string;
  readonly name: string;
  readonly label: string;
  readonly kind: 'single' | 'quantity';
  readonly ifcType: string;
  /** De onde vem o valor quando ele existe. */
  readonly origin: Exclude<IfcValueOrigin, 'pending'>;
  /** Valor do modelo; `null` = a fonte não o declara (fica pendente, nunca preenchido). */
  readonly resolve: (context: TerrainDefinitionContext) => IfcValue | null;
  /** Parâmetro da superfície que o usuário altera no painel de propriedades, quando houver. */
  readonly binding: string | null;
}

const SOURCE_SET = 'HydroBIM_Terreno';
const QUANTITY_SET = 'HydroBIM_TerrenoQuantidades';

/**
 * Registro das propriedades IFC do terreno. A ordem é a do arquivo exportado: mudá-la altera
 * o IFC gerado.
 */
export const TERRAIN_PROPERTY_DEFINITIONS: readonly TerrainPropertyDefinition[] = [
  {
    set: SOURCE_SET,
    name: 'SourceKind',
    label: 'Tipo de dado',
    kind: 'single',
    ifcType: 'IfcLabel',
    origin: 'model',
    resolve: ({ terrain }) => (terrain.source.kind === 'survey' ? 'Levantamento' : 'DEM'),
    binding: null,
  },
  {
    set: SOURCE_SET,
    name: 'SourceProvider',
    label: 'Fonte',
    kind: 'single',
    ifcType: 'IfcLabel',
    origin: 'model',
    resolve: ({ terrain }) => terrain.source.provider,
    binding: null,
  },
  {
    set: SOURCE_SET,
    name: 'SourceDataset',
    label: 'Conjunto de dados',
    kind: 'single',
    ifcType: 'IfcLabel',
    origin: 'model',
    resolve: ({ terrain }) => terrain.source.dataset,
    binding: null,
  },
  {
    set: SOURCE_SET,
    name: 'SourceHorizontalCRS',
    label: 'Sistema horizontal da fonte',
    kind: 'single',
    ifcType: 'IfcLabel',
    origin: 'model',
    resolve: ({ terrain }) => terrain.source.horizontalCrs,
    binding: null,
  },
  {
    set: SOURCE_SET,
    name: 'VerticalDatum',
    label: 'Referência altimétrica',
    kind: 'single',
    ifcType: 'IfcLabel',
    origin: 'model',
    // A referência do projeto, quando definida, é a que vale para as cotas do modelo.
    resolve: ({ project, terrain }) =>
      project.georeference?.verticalDatum ?? terrain.source.verticalDatum,
    binding: null,
  },
  {
    set: SOURCE_SET,
    name: 'SourceResolution',
    label: 'Resolução da fonte',
    kind: 'single',
    ifcType: 'IfcPositiveLengthMeasure',
    origin: 'model',
    resolve: ({ terrain }) => terrain.source.resolution,
    binding: null,
  },
  {
    set: SOURCE_SET,
    name: 'VerticalAccuracy',
    label: 'Exatidão altimétrica',
    kind: 'single',
    ifcType: 'IfcPositiveLengthMeasure',
    origin: 'model',
    resolve: ({ terrain }) => terrain.source.verticalAccuracy,
    binding: 'terrain.source.verticalAccuracy',
  },
  {
    set: SOURCE_SET,
    name: 'AcquiredAt',
    label: 'Obtido em',
    kind: 'single',
    ifcType: 'IfcLabel',
    origin: 'model',
    resolve: ({ terrain }) => terrain.source.acquiredAt,
    binding: null,
  },
  {
    set: SOURCE_SET,
    name: 'MinElevation',
    label: 'Cota mínima',
    kind: 'single',
    ifcType: 'IfcLengthMeasure',
    origin: 'geometry',
    resolve: ({ stats }) => stats.minZ,
    binding: null,
  },
  {
    set: SOURCE_SET,
    name: 'MaxElevation',
    label: 'Cota máxima',
    kind: 'single',
    ifcType: 'IfcLengthMeasure',
    origin: 'geometry',
    resolve: ({ stats }) => stats.maxZ,
    binding: null,
  },
  {
    set: SOURCE_SET,
    name: 'Edited',
    label: 'Superfície editada',
    kind: 'single',
    ifcType: 'IfcBoolean',
    origin: 'model',
    resolve: ({ terrain }) => terrain.original !== null,
    binding: null,
  },
  {
    set: QUANTITY_SET,
    name: 'ProjectedArea',
    label: 'Área em planta',
    kind: 'quantity',
    ifcType: 'IfcQuantityArea',
    origin: 'geometry',
    resolve: ({ stats }) => stats.planArea,
    binding: null,
  },
  {
    set: QUANTITY_SET,
    name: 'SurfaceArea',
    label: 'Área da superfície',
    kind: 'quantity',
    ifcType: 'IfcQuantityArea',
    origin: 'geometry',
    resolve: ({ stats }) => stats.surfaceArea,
    binding: null,
  },
];

const SET_DESCRIPTIONS: Record<string, string> = {
  [SOURCE_SET]: 'Procedência dos dados de elevação e cotas extremas da superfície',
  [QUANTITY_SET]: 'Áreas da superfície triangulada',
};

export interface TerrainIfcInfo extends IfcClassification {
  readonly terrainId: string;
  readonly globalId: string;
  readonly name: string;
  readonly description: string;
  /** Identificação dada pelo projetista (`Tag`); vazia = não informada. */
  readonly tag: string;
  readonly psets: readonly IfcPropertySetInfo[];
}

/** Informação IFC da superfície do projeto; `null` sem terreno ou sem nenhuma face. */
export function buildTerrainIfcInfo(project: Project): TerrainIfcInfo | null {
  const { terrain } = project;
  if (!terrain || terrain.triangles.length < 3) return null;
  const context: TerrainDefinitionContext = { project, terrain, stats: terrainStats(terrain) };

  const sets = new Map<string, IfcPropertyInfo[]>();
  for (const definition of TERRAIN_PROPERTY_DEFINITIONS) {
    const value = definition.resolve(context);
    const properties = sets.get(definition.set) ?? [];
    properties.push({
      key: `${definition.set}.${definition.name}`,
      set: definition.set,
      name: definition.name,
      label: definition.label,
      kind: definition.kind,
      ifcType: definition.ifcType,
      unit: unitOfIfcType(definition.ifcType),
      value,
      origin: value === null ? 'pending' : definition.origin,
      required: false,
      // O valor é alterado pelo parâmetro da superfície (`binding`), não por um valor IFC à parte.
      editable: false,
      binding: definition.binding,
    });
    sets.set(definition.set, properties);
  }

  return {
    terrainId: terrain.id,
    globalId: persistentGuid(terrain.id),
    entity: TERRAIN_IFC_ENTITY,
    predefinedType: TERRAIN_IFC_PREDEFINED_TYPE,
    objectType: 'TERRENO_NATURAL',
    name: terrain.name,
    description: 'Superfície topográfica natural (TIN)',
    tag: terrain.tag,
    psets: [...sets].map(([name, properties]) => ({
      name,
      kind: properties.every((property) => property.kind === 'quantity') ? 'qto' : 'pset',
      standard: false,
      scope: 'occurrence',
      description: SET_DESCRIPTIONS[name] ?? null,
      properties,
    })),
  };
}
