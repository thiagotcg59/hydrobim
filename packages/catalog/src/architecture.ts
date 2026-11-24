import {
  newId,
  ROOF_IFC_PREDEFINED,
  type ArchCategory,
  type ArchLayer,
  type ArchTypeInput,
  type DoorLeafDesign,
  type DoorOperation,
  type RoofShape,
  type WindowOperation,
} from '@hydrobim/core';
import { PORMADE_DOOR_FAMILIES } from './doors/pormade';

/**
 * Catálogo de famílias ARQUITETÔNICAS, separado da biblioteca hidráulica.
 *
 * Três níveis: FAMÍLIA (a tipologia, aqui) → TIPO (a família com dimensões e composição
 * definidas, gravado no projeto por `addArchType`) → OCORRÊNCIA (cada elemento do modelo).
 *
 * As famílias deste arquivo são MODELOS GENÉRICOS PARAMETRIZÁVEIS: não descrevem produto
 * de nenhum fabricante nem transcrevem norma. As dimensões e as camadas de `defaults` são
 * apenas valores iniciais de edição, para que o tipo possa ser criado e ajustado pelo
 * usuário — não são dados de catálogo e não devem ser lidas como medidas padronizadas.
 * Nenhuma família traz resistência ao fogo, desempenho acústico, transmitância térmica nem
 * classificação: esses campos nascem pendentes (ver `docs/ARQUITETURA.md`).
 *
 * Família de produto comercial só entra com `generic: false` e `source` preenchida
 * (catálogo do fabricante, edição, página e URL), como no catálogo hidráulico. Elas ficam em
 * um módulo por categoria e fabricante (`doors/pormade.ts`) e são somadas a `ARCH_FAMILIES`.
 */
export interface ArchFamily {
  readonly id: string;
  readonly category: ArchCategory;
  readonly name: string;
  readonly description: string;
  readonly generic: boolean;
  /** Fabricante, catálogo, edição, página e URL; `null` nas famílias genéricas. */
  readonly source: string | null;
  /** Classificação IFC 4.3 que os tipos da família recebem ao nascer. */
  readonly ifc: {
    readonly entity: string;
    readonly typeEntity: string;
    readonly predefinedType: string;
    /** Por que este tipo predefinido (texto do esquema IFC 4.3, resumido). */
    readonly rationale: string;
  };
  /** O que NÃO é dado de catálogo nesta família (valores iniciais, representação). */
  readonly notes: readonly string[];
  /** Valores iniciais do tipo criado a partir da família (editáveis antes e depois). */
  readonly defaults: FamilyDefaults;
  /**
   * Produto de fabricante (portas): as medidas e os acabamentos que a fonte oferece. Com ele,
   * o tipo nasce de uma ESCOLHA (medida, acabamento, núcleo), não de valores digitados.
   */
  readonly product?: DoorProduct;
}

/** Medida de catálogo de uma porta: a folha e o vão correspondente (m). */
export interface DoorProductSize {
  readonly id: string;
  readonly label: string;
  readonly leafWidth: number;
  readonly leafHeight: number;
  /** Vão em que a porta é instalada: vira `width` e `height` do tipo. */
  readonly width: number;
  readonly height: number;
}

/** Acabamento de catálogo e os núcleos que a fonte lista para ele (vazio = não informado). */
export interface DoorProductFinish {
  readonly id: string;
  readonly label: string;
  readonly cores: readonly string[];
}

export interface DoorProduct {
  readonly manufacturer: string;
  readonly line: string;
  readonly model: string;
  readonly sizes: readonly DoorProductSize[];
  readonly defaultSizeId: string;
  readonly finishes: readonly DoorProductFinish[];
  readonly panelThickness: number;
  /** Desenho da folha (frisos); ausente = folha lisa. */
  readonly leaf?: DoorLeafDesign;
}

/** Escolha feita no catálogo para um produto; o que faltar usa o padrão da família. */
export interface DoorProductChoice {
  readonly sizeId?: string;
  readonly finishId?: string;
  /** Um dos núcleos do acabamento; ausente ou fora da lista = não informado (pendente). */
  readonly core?: string;
}

/** Chaves IFC (`Conjunto.Propriedade`) preenchidas pela escolha do catálogo. */
export const DOOR_FINISH_KEY = 'HydroBIM_Esquadria.Finish';
export const DOOR_CORE_KEY = 'HydroBIM_Esquadria.Core';

type FamilyDefaults =
  | { readonly layers: readonly Omit<ArchLayer, 'id'>[]; readonly shape?: RoofShape }
  | {
      readonly operation: DoorOperation;
      readonly width: number;
      readonly height: number;
      readonly frameWidth: number;
      readonly panelThickness: number;
    }
  | {
      readonly operation: WindowOperation;
      readonly width: number;
      readonly height: number;
      readonly sillHeight: number;
      readonly panels: number;
      readonly frameWidth: number;
    };

const INITIAL = 'Dimensões e camadas são valores iniciais de edição, não medidas de catálogo.';
const NO_PERFORMANCE =
  'Sem dados de desempenho (fogo, acústica, térmica): informe-os com a fonte do produto adotado.';

const wall = (
  id: string,
  name: string,
  description: string,
  predefinedType: string,
  rationale: string,
  layers: readonly Omit<ArchLayer, 'id'>[],
): ArchFamily => ({
  id,
  category: 'wall',
  name,
  description,
  generic: true,
  source: null,
  ifc: { entity: 'IfcWall', typeEntity: 'IfcWallType', predefinedType, rationale },
  notes: [INITIAL, NO_PERFORMANCE],
  defaults: { layers },
});

const SOLID =
  'SOLIDWALL: parede maciça, de camada única ou com camadas aplicadas — em geral alvenaria ou concreto.';
const ELEMENTED = 'ELEMENTEDWALL: parede estruturada em montantes e revestida com chapas.';

const floor = (
  id: string,
  category: 'slab' | 'flooring',
  name: string,
  description: string,
  layers: readonly Omit<ArchLayer, 'id'>[],
): ArchFamily => ({
  id,
  category,
  name,
  description,
  generic: true,
  source: null,
  ifc:
    category === 'slab'
      ? {
          entity: 'IfcSlab',
          typeEntity: 'IfcSlabType',
          predefinedType: 'FLOOR',
          rationale: 'FLOOR: a laje representa um piso estrutural.',
        }
      : {
          entity: 'IfcCovering',
          typeEntity: 'IfcCoveringType',
          predefinedType: 'FLOORING',
          rationale: 'FLOORING: o revestimento representa o acabamento de piso.',
        },
  notes: [INITIAL, NO_PERFORMANCE],
  defaults: { layers },
});

const ROOF_RATIONALE: Record<RoofShape, string> = {
  shed: 'SHED_ROOF: telhado de uma só água (um plano inclinado).',
  gable: 'GABLE_ROOF: telhado de duas águas que se encontram na cumeeira, com empenas nas pontas.',
};

/**
 * Família de telhado: a tipologia (uma ou duas águas) é da família e segue para o tipo, com
 * o tipo predefinido IFC correspondente. Inclinação e beiral são da ocorrência.
 */
const roof = (
  id: string,
  name: string,
  description: string,
  shape: RoofShape,
  layers: readonly Omit<ArchLayer, 'id'>[],
): ArchFamily => ({
  id,
  category: 'roof',
  name,
  description,
  generic: true,
  source: null,
  ifc: {
    entity: 'IfcRoof',
    typeEntity: 'IfcRoofType',
    predefinedType: ROOF_IFC_PREDEFINED[shape],
    rationale: ROOF_RATIONALE[shape],
  },
  notes: [
    INITIAL,
    NO_PERFORMANCE,
    'Águas planas sobre contorno retangular; a estrutura (tesouras, terças, caibros e ripas) não é modelada peça a peça — a camada de estrutura só reserva a espessura.',
    'Inclinação e beiral são da ocorrência e não vêm de fabricante: a inclinação mínima de cada telha é dado do produto adotado.',
  ],
  defaults: { shape, layers },
});

const door = (
  id: string,
  name: string,
  description: string,
  operation: DoorOperation,
  width: number,
): ArchFamily => ({
  id,
  category: 'door',
  name,
  description,
  generic: true,
  source: null,
  ifc: {
    entity: 'IfcDoor',
    typeEntity: 'IfcDoorType',
    predefinedType: 'DOOR',
    rationale: 'DOOR: porta comum em vão de parede. O modo de abertura vai em OperationType.',
  },
  notes: [
    INITIAL,
    NO_PERFORMANCE,
    'Marco e folha são representação; ferragens e guarnições não são modeladas.',
  ],
  defaults: { operation, width, height: 2.1, frameWidth: 0.05, panelThickness: 0.035 },
});

const window = (
  id: string,
  name: string,
  description: string,
  operation: WindowOperation,
  panels: number,
  width: number,
  height: number,
): ArchFamily => ({
  id,
  category: 'window',
  name,
  description,
  generic: true,
  source: null,
  ifc: {
    entity: 'IfcWindow',
    typeEntity: 'IfcWindowType',
    predefinedType: 'WINDOW',
    rationale:
      'WINDOW: janela comum em vão de parede. A divisão em folhas vai em PartitioningType e o modo de abertura de cada folha, em IfcWindowPanelProperties.',
  },
  notes: [
    INITIAL,
    NO_PERFORMANCE,
    'Marco, montantes e vidro são representação; a espessura do vidro não é dado do tipo.',
  ],
  defaults: { operation, width, height, sillHeight: 1.1, panels, frameWidth: 0.05 },
});

const layer = (
  material: string,
  thickness: number,
  fn: ArchLayer['function'],
  hatch: ArchLayer['hatch'] = 'none',
): Omit<ArchLayer, 'id'> => ({ material, thickness, function: fn, hatch });

export const ARCH_FAMILIES: readonly ArchFamily[] = [
  wall(
    'arq-parede-alvenaria-ceramica',
    'Parede de alvenaria cerâmica',
    'Bloco cerâmico com revestimento argamassado nas duas faces.',
    'SOLIDWALL',
    SOLID,
    [
      layer('Revestimento argamassado', 0.02, 'finish'),
      layer('Alvenaria de bloco cerâmico', 0.14, 'structure', 'diagonal'),
      layer('Revestimento argamassado', 0.02, 'finish'),
    ],
  ),
  wall(
    'arq-parede-bloco-concreto',
    'Parede de blocos de concreto',
    'Bloco de concreto com revestimento argamassado nas duas faces.',
    'SOLIDWALL',
    SOLID,
    [
      layer('Revestimento argamassado', 0.015, 'finish'),
      layer('Alvenaria de bloco de concreto', 0.14, 'structure', 'crossed'),
      layer('Revestimento argamassado', 0.015, 'finish'),
    ],
  ),
  wall(
    'arq-parede-drywall',
    'Parede de drywall',
    'Estrutura de montantes com uma chapa de gesso em cada face.',
    'ELEMENTEDWALL',
    ELEMENTED,
    [
      layer('Chapa de gesso', 0.0125, 'finish'),
      layer('Estrutura de montantes (vazio)', 0.07, 'structure'),
      layer('Chapa de gesso', 0.0125, 'finish'),
    ],
  ),
  floor('arq-laje-concreto', 'slab', 'Laje de concreto', 'Laje maciça de concreto armado.', [
    layer('Concreto armado', 0.12, 'structure', 'dotted'),
  ]),
  floor(
    'arq-piso-ceramica-porcelanato',
    'flooring',
    'Piso cerâmico ou porcelanato',
    'Placa cerâmica ou porcelanato assentado sobre contrapiso.',
    [
      layer('Placa cerâmica ou porcelanato', 0.01, 'finish'),
      layer('Contrapiso', 0.04, 'substrate'),
    ],
  ),
  floor('arq-piso-vinilico', 'flooring', 'Piso vinílico', 'Manta ou régua vinílica colada.', [
    layer('Piso vinílico', 0.003, 'finish'),
    layer('Contrapiso', 0.04, 'substrate'),
  ]),
  floor('arq-piso-laminado', 'flooring', 'Piso laminado', 'Régua laminada flutuante sobre manta.', [
    layer('Piso laminado', 0.008, 'finish'),
    layer('Manta', 0.002, 'membrane'),
    layer('Contrapiso', 0.04, 'substrate'),
  ]),
  roof(
    'arq-telhado-uma-agua',
    'Telhado de uma água',
    'Um plano inclinado sobre contorno retangular, caindo para o lado do beiral.',
    'shed',
    [
      layer('Cobertura (telhas)', 0.02, 'finish'),
      layer('Estrutura de apoio (ripas, caibros e terças)', 0.1, 'structure'),
    ],
  ),
  roof(
    'arq-telhado-duas-aguas',
    'Telhado de duas águas',
    'Duas águas iguais sobre contorno retangular, com a cumeeira no meio do vão.',
    'gable',
    [
      layer('Cobertura (telhas)', 0.02, 'finish'),
      layer('Estrutura de apoio (ripas, caibros e terças)', 0.1, 'structure'),
    ],
  ),
  door(
    'arq-porta-giro-1',
    'Porta de giro, uma folha',
    'Folha única com dobradiças.',
    'singleSwing',
    0.8,
  ),
  door(
    'arq-porta-giro-2',
    'Porta de giro, duas folhas',
    'Duas folhas com dobradiças.',
    'doubleSwing',
    1.6,
  ),
  door('arq-porta-correr', 'Porta de correr', 'Folha que corre ao lado do vão.', 'sliding', 0.9),
  door(
    'arq-porta-pivotante',
    'Porta pivotante',
    'Folha que gira em eixo vertical afastado da ombreira.',
    'pivot',
    1.0,
  ),
  window('arq-janela-fixa', 'Janela fixa', 'Vidro fixo, sem abertura.', 'fixed', 1, 1.0, 1.0),
  window(
    'arq-janela-correr',
    'Janela de correr',
    'Folhas que correm na horizontal.',
    'sliding',
    2,
    1.2,
    1.0,
  ),
  window(
    'arq-janela-abrir',
    'Janela de abrir',
    'Folhas com dobradiças laterais.',
    'casement',
    2,
    1.2,
    1.0,
  ),
  window(
    'arq-janela-basculante',
    'Janela basculante',
    'Folha que gira em eixo horizontal.',
    'pivotHorizontal',
    1,
    0.6,
    0.6,
  ),
  window(
    'arq-janela-maxim-ar',
    'Janela maxim-ar',
    'Folha articulada no topo, projetada para fora.',
    'topHung',
    1,
    0.8,
    0.6,
  ),
  ...PORMADE_DOOR_FAMILIES,
];

export const getArchFamily = (id: string): ArchFamily | undefined =>
  ARCH_FAMILIES.find((family) => family.id === id);

export const listArchFamilies = (category?: ArchCategory): ArchFamily[] =>
  ARCH_FAMILIES.filter((family) => !category || family.category === category);

/**
 * Tipo novo a partir de uma família: recebe a classificação IFC da família e os valores
 * iniciais, que `overrides` substitui (dimensões e camadas informadas pelo usuário). O
 * resultado vai a `addArchType`, que o valida e grava no projeto.
 */
export function archTypeFromFamily(
  family: ArchFamily,
  name?: string,
  overrides: Record<string, unknown> = {},
): ArchTypeInput {
  if (family.product) {
    const type = doorTypeFromProduct(family, {});
    if (type) return { ...type, ...(name ? { name } : {}), ...overrides } as ArchTypeInput;
  }
  return genericTypeFromFamily(family, name ?? family.name, overrides);
}

/** Medida e acabamento efetivos de uma escolha (os padrões da família onde ela não diz). */
export function resolveDoorChoice(
  product: DoorProduct,
  choice: DoorProductChoice,
): { size: DoorProductSize; finish: DoorProductFinish; core: string | null } | null {
  const size = product.sizes.find((entry) => entry.id === (choice.sizeId ?? product.defaultSizeId));
  const finish = choice.finishId
    ? product.finishes.find((entry) => entry.id === choice.finishId)
    : product.finishes[0];
  if (!size || !finish) return null;
  const core = choice.core && finish.cores.includes(choice.core) ? choice.core : null;
  return { size, finish, core };
}

/**
 * Tipo de porta a partir de um produto de catálogo: medidas do vão, espessura e desenho da
 * folha vêm da fonte; fabricante e modelo vão para `manufacturing`; acabamento e núcleo, para
 * os valores IFC do tipo. O que a fonte não informa (materiais, desempenho, núcleo não
 * escolhido) fica sem valor. `null` = a família não é produto ou a escolha não existe nela.
 */
export function doorTypeFromProduct(
  family: ArchFamily,
  choice: DoorProductChoice,
): ArchTypeInput | null {
  const { product } = family;
  if (!product || family.category !== 'door' || !('panelThickness' in family.defaults)) return null;
  const resolved = resolveDoorChoice(product, choice);
  if (!resolved) return null;
  const { size, finish, core } = resolved;
  return {
    category: 'door',
    // O núcleo entra no nome para dois tipos do mesmo modelo não se confundirem.
    name: `${family.name} — ${size.id} × ${Math.round(size.leafHeight * 100)} cm — ${finish.label}${
      core ? ` — núcleo ${core.toLocaleLowerCase('pt-BR')}` : ''
    }`,
    familyId: family.id,
    generic: false,
    source: family.source,
    manufacturing: { manufacturer: product.manufacturer, model: product.model },
    classifications: [],
    ifcPredefinedType: family.ifc.predefinedType,
    ifc: { [DOOR_FINISH_KEY]: finish.label, ...(core ? { [DOOR_CORE_KEY]: core } : {}) },
    operation: family.defaults.operation,
    width: size.width,
    height: size.height,
    // Derivado: o que sobra do vão de cada lado da folha (o catálogo não cota o marco).
    frameWidth: Number(((size.width - size.leafWidth) / 2).toFixed(6)),
    panelThickness: product.panelThickness,
    materials: {},
    ...(product.leaf
      ? { leaf: { ...product.leaf, friezes: product.leaf.friezes.map((entry) => ({ ...entry })) } }
      : {}),
  };
}

function genericTypeFromFamily(
  family: ArchFamily,
  name: string,
  overrides: Record<string, unknown>,
): ArchTypeInput {
  const base = {
    name,
    familyId: family.id,
    generic: family.generic,
    source: family.source,
    manufacturing: {},
    classifications: [],
    ifcPredefinedType: family.ifc.predefinedType,
    ifc: {},
  };
  const { defaults } = family;
  const specific =
    'layers' in defaults
      ? {
          layers: defaults.layers.map((entry) => ({ ...entry, id: newId() })),
          ...(defaults.shape ? { shape: defaults.shape } : {}),
        }
      : { ...defaults, materials: {} };
  return { ...base, category: family.category, ...specific, ...overrides } as ArchTypeInput;
}
