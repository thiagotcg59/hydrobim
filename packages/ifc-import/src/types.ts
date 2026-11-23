/**
 * Tipos do leitor IFC. Tudo o que tem coordenada está no REFERENCIAL DO ARQUIVO convertido
 * para a convenção do HydroBIM: metros, sistema destro, Z para cima. Nenhuma recentralização
 * é feita: um arquivo modelado longe da origem continua longe da origem.
 */

/** Esquemas com leitura implementada e testada. */
export type IfcSchemaFamily = 'IFC2X3' | 'IFC4' | 'IFC4X3';

export interface IfcHeaderInfo {
  /** Identificador declarado em `FILE_SCHEMA` (ex.: `IFC4X3_ADD2`). */
  readonly schema: string;
  readonly family: IfcSchemaFamily;
  readonly fileName: string | null;
  readonly timestamp: string | null;
  /** Aplicativo de origem declarado no cabeçalho. */
  readonly application: string | null;
  /** Descrição do cabeçalho (costuma trazer a ViewDefinition/MVD). */
  readonly description: string | null;
}

export interface IfcUnitInfo {
  /** `UnitType` do IFC (ex.: `LENGTHUNIT`). */
  readonly type: string;
  /** Nome declarado (ex.: `MILLIMETRE`, `FOOT`, `SQUARE_METRE`). */
  readonly label: string;
  /** Símbolo para exibição (ex.: `mm`). */
  readonly symbol: string;
  /** Fator para a unidade SI coerente (m, m², m³, rad…); `null` quando não é dedutível. */
  readonly toSi: number | null;
}

/** Georreferência como declarada no arquivo (`IfcMapConversion` + `IfcProjectedCRS`). */
export interface IfcGeoreferenceInfo {
  readonly crsName: string | null;
  readonly crsDescription: string | null;
  readonly geodeticDatum: string | null;
  readonly verticalDatum: string | null;
  readonly mapProjection: string | null;
  readonly mapZone: string | null;
  /** Em unidades do mapa, como no arquivo. */
  readonly eastings: number;
  readonly northings: number;
  readonly orthogonalHeight: number;
  readonly xAxisAbscissa: number | null;
  readonly xAxisOrdinate: number | null;
  /** Fator declarado entre a unidade do modelo e a do mapa (`Scale`), se houver. */
  readonly scale: number | null;
}

export interface IfcSpatialNode {
  readonly expressId: number;
  readonly entity: string;
  readonly name: string | null;
  readonly longName: string | null;
  /** Cota declarada do pavimento (`Elevation`), em metros. */
  readonly elevation: number | null;
  readonly children: readonly IfcSpatialNode[];
  /** Objetos contidos diretamente neste nó (`expressId`). */
  readonly objectIds: readonly number[];
}

/**
 * - `ok`: malha triangulada lida da representação do arquivo;
 * - `none`: o produto não tem representação geométrica;
 * - `unsupported`: tem representação, mas o leitor não a converte em malha (curvas, eixos,
 *   anotações 2D…);
 * - `failed`: o leitor falhou ao gerar a malha.
 *
 * Nos três últimos casos o objeto NÃO recebe geometria substituta.
 */
export type IfcGeometryStatus = 'ok' | 'none' | 'unsupported' | 'failed';

/** Caixa envolvente: [xmin, ymin, zmin, xmax, ymax, zmax]. */
export type IfcBounds = readonly [number, number, number, number, number, number];

export interface IfcObjectSummary {
  readonly expressId: number;
  readonly globalId: string;
  readonly entity: string;
  readonly predefinedType: string | null;
  readonly name: string | null;
  readonly objectType: string | null;
  readonly tag: string | null;
  /** Nó espacial que contém o objeto (`expressId`), ou `null` fora da estrutura. */
  readonly containerId: number | null;
  readonly storeyName: string | null;
  readonly typeName: string | null;
  readonly geometry: IfcGeometryStatus;
  /** Representações declaradas (ex.: `Body · SweptSolid`). */
  readonly representations: readonly string[];
  readonly bounds: IfcBounds | null;
  readonly triangles: number;
}

export interface IfcReportItem {
  readonly code:
    | 'NO_GEOMETRY'
    | 'UNSUPPORTED_REPRESENTATION'
    | 'GEOMETRY_FAILED'
    | 'OPENINGS'
    | 'PORTS'
    | 'GEOREFERENCE'
    | 'NO_STRUCTURE'
    | 'ANGLE_UNIT';
  readonly severity: 'info' | 'warning';
  /** Mensagem em português, pronta para o usuário. */
  readonly message: string;
  readonly expressIds: readonly number[];
}

export interface IfcModelSummary {
  readonly header: IfcHeaderInfo;
  readonly projectName: string | null;
  readonly units: readonly IfcUnitInfo[];
  /** Unidade de comprimento do arquivo e quantos metros ela vale. */
  readonly lengthUnit: { readonly label: string; readonly symbol: string; readonly scale: number };
  readonly georeference: IfcGeoreferenceInfo | null;
  /** Raiz da estrutura espacial (o `IfcProject`). */
  readonly spatial: IfcSpatialNode;
  readonly objects: readonly IfcObjectSummary[];
  readonly report: readonly IfcReportItem[];
  readonly bounds: IfcBounds | null;
  readonly triangles: number;
  /** Total de `IfcProduct` no arquivo (objetos, estrutura, vãos e portas). */
  readonly productCount: number;
}

// --- Malhas --------------------------------------------------------------------------------

/** Geometria no referencial próprio; várias instâncias podem compartilhá-la. */
export interface IfcMeshGeometry {
  readonly id: number;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
}

export interface IfcMeshPart {
  readonly geometryId: number;
  /**
   * Matriz 4×4 em ordem de colunas, em dupla precisão: do referencial da geometria para o do
   * arquivo (metros, Z para cima), já com os posicionamentos hierárquicos aplicados.
   */
  readonly matrix: readonly number[];
  /** Cor de apresentação declarada no arquivo: [r, g, b, a], de 0 a 1. */
  readonly color: readonly [number, number, number, number];
}

export interface IfcObjectMesh {
  readonly expressId: number;
  readonly parts: readonly IfcMeshPart[];
}

export interface IfcMeshSet {
  readonly geometries: readonly IfcMeshGeometry[];
  readonly objects: readonly IfcObjectMesh[];
}

// --- Propriedades --------------------------------------------------------------------------

export type IfcPropertyScope = 'occurrence' | 'type';

export interface IfcPropertyEntry {
  readonly name: string;
  readonly description: string | null;
  /** `single`, `enumerated`, `bounded`, `list` e `quantity` são lidos; o resto é listado. */
  readonly kind: 'single' | 'enumerated' | 'bounded' | 'list' | 'quantity' | 'unsupported';
  /** Tipo de valor declarado (ex.: `IfcLengthMeasure`), preservado. */
  readonly valueType: string | null;
  /** Valor como está no arquivo, sem conversão de unidade; `null` = não informado. */
  readonly value: string | number | boolean | null;
  /** Valores de propriedades enumeradas e de lista. */
  readonly values: readonly (string | number | boolean)[] | null;
  /** Limites de propriedades com faixa. */
  readonly lower: number | string | null;
  readonly upper: number | string | null;
  /** Unidade do valor (símbolo) e de onde ela vem. */
  readonly unit: string | null;
  readonly unitSource: 'property' | 'file' | null;
}

export interface IfcPropertyGroup {
  readonly expressId: number;
  readonly name: string;
  readonly kind: 'properties' | 'quantities';
  readonly scope: IfcPropertyScope;
  readonly properties: readonly IfcPropertyEntry[];
}

export interface IfcMaterialInfo {
  readonly name: string;
  readonly role: 'material' | 'layer' | 'constituent' | 'list' | 'profile' | 'unsupported';
  /** Nome do conjunto (camadas, constituintes, perfis), se houver. */
  readonly setName: string | null;
  /** Espessura da camada, na unidade de comprimento do arquivo. */
  readonly thickness: number | null;
  readonly thicknessUnit: string | null;
  readonly category: string | null;
  readonly scope: IfcPropertyScope;
}

export interface IfcClassificationInfo {
  readonly system: string | null;
  readonly edition: string | null;
  readonly identification: string | null;
  readonly name: string | null;
  readonly location: string | null;
  readonly scope: IfcPropertyScope;
}

export interface IfcTypeInfo {
  readonly expressId: number;
  readonly globalId: string | null;
  readonly entity: string;
  readonly name: string | null;
  readonly predefinedType: string | null;
}

export interface IfcObjectProperties {
  readonly expressId: number;
  readonly globalId: string;
  readonly entity: string;
  readonly predefinedType: string | null;
  readonly name: string | null;
  readonly description: string | null;
  readonly objectType: string | null;
  readonly tag: string | null;
  readonly longName: string | null;
  readonly type: IfcTypeInfo | null;
  readonly container: { readonly entity: string; readonly name: string | null } | null;
  readonly storeyName: string | null;
  readonly groups: readonly IfcPropertyGroup[];
  readonly materials: readonly IfcMaterialInfo[];
  readonly classifications: readonly IfcClassificationInfo[];
  /** Portas de distribuição declaradas no arquivo para este objeto (só informativo). */
  readonly portCount: number;
}

/** Erro previsível da leitura, com mensagem em português. */
export class IfcReadError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IfcReadError';
  }
}

export type IfcReadStage = 'opening' | 'structure' | 'geometry' | 'finishing';

export interface IfcReadProgress {
  readonly stage: IfcReadStage;
  /** De 0 a 1 dentro da etapa; `null` quando a etapa não mede andamento. */
  readonly fraction: number | null;
}

export const IFC_READ_STAGE_LABELS: Record<IfcReadStage, string> = {
  opening: 'Abrindo o arquivo',
  structure: 'Lendo estrutura, objetos e unidades',
  geometry: 'Gerando a geometria',
  finishing: 'Concluindo',
};
