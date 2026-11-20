import type { FittingFamily, ValveType } from '@hydrobim/core';
import { IFC_ENTITIES } from './schemaData';
import type { IfcClassification } from './types';

/**
 * Classificação IFC das famílias da biblioteca (catálogo embutido e famílias do projeto),
 * inclusive dos produtos que ainda não são inseridos na rede. As descrições dos tipos
 * predefinidos foram conferidas na documentação do IFC 4.3 embutida no IfcOpenShell
 * (`ifcopenshell.util.doc`); ver docs/IFC_MAPPING.md.
 */

const VALVE_TYPES: Record<Exclude<ValveType, 'strainer' | 'flowMeter'>, string> = {
  gate: 'ISOLATING',
  ball: 'ISOLATING',
  butterfly: 'ISOLATING',
  globe: 'REGULATING',
  check: 'CHECK',
  airRelease: 'AIRRELEASE',
  pressureReducing: 'PRESSUREREDUCING',
};

/** Classificação de uma família de conexões ou válvulas. */
export function classifyFittingFamily(
  family: Pick<FittingFamily, 'kind' | 'valveType'>,
): IfcClassification {
  switch (family.kind) {
    case 'elbow':
      return { entity: 'IfcPipeFitting', predefinedType: 'BEND', objectType: 'elbow' };
    case 'tee':
      return { entity: 'IfcPipeFitting', predefinedType: 'JUNCTION', objectType: 'tee' };
    case 'cross':
      return { entity: 'IfcPipeFitting', predefinedType: 'JUNCTION', objectType: 'cross' };
    case 'reducer':
      return { entity: 'IfcPipeFitting', predefinedType: 'TRANSITION', objectType: 'reducer' };
    case 'valve': {
      const type = family.valveType ?? 'gate';
      if (type === 'strainer')
        return { entity: 'IfcFilter', predefinedType: 'STRAINER', objectType: 'strainer' };
      if (type === 'flowMeter')
        return { entity: 'IfcFlowMeter', predefinedType: 'WATERMETER', objectType: 'flowMeter' };
      return { entity: 'IfcValve', predefinedType: VALVE_TYPES[type], objectType: type };
    }
  }
}

/** Formas da biblioteca de produtos (`ProductShape` de `@hydrobim/catalog`). */
export type IfcProductShape =
  | 'pipe'
  | 'bend'
  | 'tee'
  | 'cross'
  | 'cap'
  | 'slipCoupling'
  | 'transitionCoupling'
  | 'reducer'
  | 'adapter'
  | 'saddle'
  | 'jeriSeal'
  | 'oRing';

const fitting = (predefinedType: string, objectType: string): IfcClassification => ({
  entity: 'IfcPipeFitting',
  predefinedType,
  objectType,
});

const PRODUCT_SHAPES: Record<IfcProductShape, IfcClassification & { note: string }> = {
  pipe: {
    entity: 'IfcPipeSegment',
    predefinedType: 'RIGIDSEGMENT',
    objectType: 'pipe',
    note: 'Segmento rígido e contínuo de tubo.',
  },
  bend: { ...fitting('BEND', 'bend'), note: 'Duas portas; muda a direção do escoamento.' },
  tee: { ...fitting('JUNCTION', 'tee'), note: 'Mais de duas portas; redistribui o escoamento.' },
  cross: {
    ...fitting('JUNCTION', 'cross'),
    note: 'Mais de duas portas; redistribui o escoamento.',
  },
  // O colar deriva o ramal a partir do tubo: três portas, como uma junção.
  saddle: {
    ...fitting('JUNCTION', 'saddle'),
    note: 'Deriva o ramal a partir do tubo (passagem e tomada).',
  },
  slipCoupling: { ...fitting('CONNECTOR', 'slipCoupling'), note: 'Luva: une duas portas.' },
  transitionCoupling: {
    ...fitting('CONNECTOR', 'transitionCoupling'),
    note: 'Luva: une duas portas (bolsa soldável × bolsa PBA).',
  },
  reducer: {
    ...fitting('TRANSITION', 'reducer'),
    note: 'Duas portas de diâmetros diferentes.',
  },
  adapter: {
    ...fitting('TRANSITION', 'adapter'),
    note: 'Duas portas de padrões dimensionais diferentes (DEFoFo × PBA).',
  },
  // O esquema não tem valor para tampão de extremidade: OBSTRUCTION descreve peças de duas
  // portas (crivo, placa perfurada). Fica USERDEFINED, identificado em ObjectType.
  cap: {
    ...fitting('USERDEFINED', 'CAP'),
    note: 'Sem tipo predefinido para tampão no IFC 4.3: USERDEFINED com ObjectType "CAP".',
  },
  jeriSeal: {
    entity: 'IfcDiscreteAccessory',
    predefinedType: 'USERDEFINED',
    objectType: 'SEALINGRING',
    note: 'Acessório da junta; sem tipo predefinido para anel de vedação: ObjectType "SEALINGRING".',
  },
  oRing: {
    entity: 'IfcDiscreteAccessory',
    predefinedType: 'USERDEFINED',
    objectType: 'SEALINGRING',
    note: 'Acessório da junta; sem tipo predefinido para anel de vedação: ObjectType "SEALINGRING".',
  },
};

/** Classificação de um produto da biblioteca pela sua forma. */
export function classifyProductShape(shape: IfcProductShape): IfcClassification & { note: string } {
  return PRODUCT_SHAPES[shape];
}

export type IfcLibraryGroup =
  'Conexões e válvulas' | 'Tubos com flanges' | 'Reservatórios' | 'Biblioteca de produtos';

/** Mapeamento IFC de uma família da biblioteca. */
export interface IfcLibraryEntry extends IfcClassification {
  readonly id: string;
  readonly name: string;
  readonly group: IfcLibraryGroup;
  /** Entidade de tipo (`Ifc…Type`) criada para as ocorrências da família. */
  readonly typeEntity: string;
  readonly manufacturer: string | null;
  readonly source: string;
  /** Justificativa da classificação ou situação da família na rede. */
  readonly note: string | null;
}

interface Named {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string | null;
  readonly source: string;
}

export interface IfcLibraryInput {
  fittingFamilies?: readonly (Named & Pick<FittingFamily, 'kind' | 'valveType'>)[];
  flangedPipeFamilies?: readonly Named[];
  tankFamilies?: readonly Named[];
  productFamilies?: readonly (Named & {
    readonly shape: IfcProductShape;
    readonly network: { readonly inserted: boolean; readonly note: string };
  })[];
}

const entry = (
  family: Named,
  group: IfcLibraryGroup,
  classification: IfcClassification,
  note: string | null,
): IfcLibraryEntry => {
  const typeEntity = IFC_ENTITIES[classification.entity]?.typeEntity;
  if (!typeEntity) throw new Error(`Entidade sem tipo no esquema: ${classification.entity}.`);
  return {
    ...classification,
    id: family.id,
    name: family.name,
    group,
    typeEntity,
    manufacturer: family.manufacturer || null,
    source: family.source,
    note,
  };
};

/** Percorre a biblioteca e atribui a cada família a entidade e o tipo predefinido IFC. */
export function classifyLibrary(input: IfcLibraryInput): IfcLibraryEntry[] {
  return [
    ...(input.fittingFamilies ?? []).map((family) =>
      entry(family, 'Conexões e válvulas', classifyFittingFamily(family), null),
    ),
    ...(input.flangedPipeFamilies ?? []).map((family) =>
      entry(
        family,
        'Tubos com flanges',
        { entity: 'IfcPipeSegment', predefinedType: 'RIGIDSEGMENT', objectType: 'pipe' },
        'Os flanges são geometria e propriedades do tubo (Pset_PipeConnectionFlanged), não entidades separadas.',
      ),
    ),
    ...(input.tankFamilies ?? []).map((family) =>
      entry(
        family,
        'Reservatórios',
        { entity: 'IfcTank', predefinedType: 'STORAGE', objectType: 'tank' },
        null,
      ),
    ),
    ...(input.productFamilies ?? []).map((family) => {
      const { note, ...classification } = classifyProductShape(family.shape);
      return entry(
        family,
        'Biblioteca de produtos',
        classification,
        family.network.inserted
          ? note
          : `${note} Ainda não inserido na rede: ${family.network.note}`,
      );
    }),
  ];
}
