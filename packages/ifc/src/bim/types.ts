import type { Vec3 } from '@hydrobim/core';

/**
 * Modelo de informação IFC do projeto: a mesma estrutura alimenta a aba BIM / IFC e o
 * escritor do arquivo. O que aparece no painel é, por construção, o que é exportado.
 */

export type IfcValue = string | number | boolean;

/** De onde vem cada valor. `pending` = ainda não informado (nunca é preenchido com ficção). */
export type IfcValueOrigin = 'geometry' | 'model' | 'catalog' | 'user' | 'pending';

export const IFC_ORIGIN_LABELS: Record<IfcValueOrigin, string> = {
  geometry: 'Geometria',
  model: 'Cadastro',
  catalog: 'Catálogo',
  user: 'Usuário',
  pending: 'Não informado',
};

/** Grandeza do valor, em unidades SI no modelo e no arquivo. */
export type IfcUnit =
  | 'none'
  | 'length'
  | 'area'
  | 'volume'
  | 'angle'
  | 'pressure'
  | 'flow'
  | 'power'
  | 'frequency'
  | 'ratio'
  | 'thermalTransmittance';

/** `type` = dado da família/tipo (`Ifc…Type`); `occurrence` = dado do elemento. */
export type IfcScope = 'type' | 'occurrence';

export interface IfcEnumeration {
  readonly name: string;
  readonly values: readonly string[];
}

export interface IfcPropertyInfo {
  /** `Conjunto.Propriedade` — chave dos valores informados pelo usuário. */
  readonly key: string;
  readonly set: string;
  readonly name: string;
  /** Rótulo em português. */
  readonly label: string;
  readonly kind: 'single' | 'enumerated' | 'quantity';
  /** Tipo de valor IFC (`IfcLabel`…) ou de quantidade (`IfcQuantityLength`…). */
  readonly ifcType: string;
  readonly unit: IfcUnit;
  readonly enumeration?: IfcEnumeration;
  readonly value: IfcValue | null;
  readonly origin: IfcValueOrigin;
  /** Exigida pelo perfil de requisitos do projeto (não pelo esquema IFC). */
  readonly required: boolean;
  /** O usuário pode informar ou substituir o valor na aba BIM / IFC. */
  readonly editable: boolean;
  /** Parâmetro do modelo de que o valor é derivado (não editável aqui), quando houver. */
  readonly binding: string | null;
  /** Grupo do painel de propriedades (arquitetura). */
  readonly group?: string;
}

export interface IfcPropertySetInfo {
  readonly name: string;
  readonly kind: 'pset' | 'qto';
  /** Conjunto padronizado pela buildingSMART (`Pset_*`/`Qto_*` do esquema). */
  readonly standard: boolean;
  readonly scope: IfcScope;
  readonly description: string | null;
  readonly properties: readonly IfcPropertyInfo[];
}

export interface IfcClassification {
  readonly entity: string;
  readonly predefinedType: string;
  /** Tipo interno do HydroBIM, gravado em `ObjectType`/`ElementType`. */
  readonly objectType: string;
}

export interface IfcMaterialInfo {
  readonly name: string;
  readonly category: string | null;
}

export interface IfcPortInfo {
  readonly portId: string;
  readonly globalId: string;
  readonly name: string;
  readonly description: string | null;
  readonly flowDirection: 'SOURCE' | 'SINK' | 'SOURCEANDSINK' | 'NOTDEFINED';
  readonly systemType: string;
  /** Posição e eixos no referencial local do elemento (como gravados no arquivo). */
  readonly localPosition: Vec3;
  readonly localDirection: Vec3;
  readonly localReference: Vec3;
  /** Posição e direção globais (apresentação e verificação da conectividade). */
  readonly position: Vec3;
  readonly direction: Vec3;
  readonly psets: readonly IfcPropertySetInfo[];
  readonly connectedTo: {
    readonly elementId: string;
    readonly portId: string;
    readonly elementName: string;
  } | null;
}

export interface IfcElementInfo extends IfcClassification {
  readonly elementId: string;
  readonly globalId: string;
  readonly name: string;
  readonly description: string | null;
  readonly tag: string;
  readonly systemId: string;
  readonly typeKey: string;
  readonly material: IfcMaterialInfo;
  /** Conjuntos de propriedades e de quantidades da ocorrência. */
  readonly psets: readonly IfcPropertySetInfo[];
  readonly ports: readonly IfcPortInfo[];
}

export interface IfcTypeInfo {
  readonly key: string;
  /** Semente dos GlobalIds do tipo e de seus conjuntos. */
  readonly seed: string;
  readonly globalId: string;
  readonly entity: string;
  readonly predefinedType: string;
  readonly elementType: string;
  readonly name: string;
  readonly description: string | null;
  /** Dados da família de catálogo, quando o tipo vem de uma. */
  readonly familyId: string | null;
  readonly familyName: string | null;
  readonly catalogReference: string | null;
  readonly material: IfcMaterialInfo;
  readonly psets: readonly IfcPropertySetInfo[];
  readonly memberIds: readonly string[];
}

export interface IfcSystemInfo {
  readonly systemId: string;
  readonly globalId: string;
  readonly name: string;
  readonly predefinedType: string;
  readonly objectType: string | null;
  readonly memberIds: readonly string[];
}

export interface IfcModel {
  readonly schema: string;
  readonly elements: readonly IfcElementInfo[];
  readonly types: readonly IfcTypeInfo[];
  readonly systems: readonly IfcSystemInfo[];
}

/** Dados de uma família de catálogo usados na camada IFC (estruturalmente, `FittingFamily`). */
export interface IfcFamilyInfo {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string | null;
  readonly standard?: string;
  readonly source: string;
}
