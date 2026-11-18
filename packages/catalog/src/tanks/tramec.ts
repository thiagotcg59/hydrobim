import type { TankFamily, TankVariant } from '@hydrobim/core';

/**
 * Reservatórios metálicos TRAMEC — transcrição do catálogo do fabricante.
 *
 * Fonte: TRAMEC Caixas d'Água e Reservatórios Metálicos, "Catálogo" (8 páginas, sem data nem
 * número de edição), www.tramec.com.br — arquivo `catalogo-tramec.pdf`.
 *
 * O catálogo tabula, por modelo, SOMENTE: capacidade (L), altura total (m), diâmetro (m) e,
 * na taça sem água na coluna, a altura da coluna (m). Informa ainda os pés de 50 cm do
 * reservatório de fundo cônico. Não traz espessura de chapa, diâmetro da coluna, altura do
 * cone, bocais nem dimensões de escadas e guarda-corpos — o que o editor mostrar além das
 * colunas da tabela é estimativa de representação, identificada como tal.
 *
 * As linhas estão na ordem e com os valores impressos, inclusive os que parecem
 * inconsistentes (ver `remarks` de cada família).
 */

const MANUFACTURER = 'TRAMEC';
/** "Fabricados em aço carbono estrutural" (catálogo, p. 3). */
const MATERIAL = 'Aço-carbono estrutural';
const source = (page: number): string =>
  `TRAMEC — Catálogo Caixas d'Água e Reservatórios Metálicos (s/d), p. ${page} — www.tramec.com.br`;

const centi = (meters: number): number => Math.round(meters * 100);

/** Linha da tabela: [capacidade (L), altura total (m), diâmetro (m), altura da coluna (m)?]. */
type Row = readonly [number, number, number, number?];

const variants = (familyId: string, rows: readonly Row[], marked: readonly number[] = []) =>
  rows.map(([capacityL, height, diameter, columnHeight], index): TankVariant => ({
    id: `${familyId}/${capacityL}-${centi(height)}-${centi(diameter)}${
      columnHeight === undefined ? '' : `-${centi(columnHeight)}`
    }`,
    capacityL,
    height,
    diameter,
    ...(columnHeight !== undefined ? { columnHeight } : {}),
    ...(marked.includes(index) ? { mark: '*' } : {}),
  }));

const SHARED_APPROXIMATIONS = [
  'Espessura das chapas: o catálogo não informa. O desenho usa 6 mm só para dar corpo às superfícies; a propriedade fica vazia até o usuário informá-la.',
  'Escada, gaiola, guarda-corpo e boca de visita: forma lida das imagens do catálogo; dimensões e posições são de representação (escada de 0,45 m, guarda-corpo de 1,10 m).',
  'Bocais de entrada, saída, extravasor e descarga: o catálogo não os posiciona nem dimensiona. São definidos pelo usuário, com o diâmetro da especificação de tubo escolhida.',
] as const;

// --- p. 4 — Reservatório tipo taça com água na coluna ------------------------------------
const GOBLET_WET_ROWS: readonly Row[] = [
  [5000, 6.7, 1.44],
  [7500, 6.7, 1.44],
  [10000, 7.05, 1.91],
  [12500, 8.8, 1.91],
  [15000, 7.6, 2.22],
  [15000, 8.1, 1.91],
  [15000, 9.4, 1.91],
  [20000, 7.8, 2.54],
  [20000, 9.4, 2.23],
  [25000, 8.4, 2.54],
  [30000, 8.2, 2.86],
  [30000, 10.2, 2.55],
  [40000, 7.9, 3.2],
  [40000, 11.3, 2.86],
  [50000, 10.1, 3.2],
  [50000, 12.0, 3.2],
  [50000, 12.8, 3.2],
  [60000, 13.2, 3.2],
  [80000, 15.0, 3.2],
];

// --- p. 4 — Reservatório tipo taça sem água na coluna ------------------------------------
const GOBLET_DRY_ROWS: readonly Row[] = [
  [2000, 5.7, 1.18, 3.6],
  [2000, 6.9, 1.18, 4.8],
  [2000, 8.1, 1.18, 6.0],
  [3000, 5.7, 1.44, 3.6],
  [3000, 6.9, 1.44, 4.8],
  [3000, 8.1, 1.44, 6.0],
  [5000, 6.3, 1.6, 3.6],
  [5000, 7.5, 1.6, 4.8],
  [5000, 8.7, 1.6, 6.0],
  [10000, 7.1, 1.91, 3.6],
  [10000, 8.3, 1.91, 4.8],
  [10000, 9.5, 1.91, 6.0],
  [12000, 8.1, 1.91, 3.6],
  [12000, 9.3, 1.91, 4.8],
  [12000, 10.5, 1.91, 6.0],
  [15000, 7.6, 2.23, 3.6],
  [15000, 8.8, 2.23, 4.8],
  [15000, 10.0, 2.23, 6.0],
  [20000, 7.8, 2.55, 3.6],
  [20000, 9.0, 2.55, 4.8],
  [20000, 10.2, 2.55, 6.0],
  [25000, 9.0, 2.55, 3.6],
  [25000, 10.2, 2.55, 4.8],
  [25000, 11.4, 2.55, 6.0],
  [30000, 8.4, 2.86, 3.6],
  [30000, 9.6, 2.86, 4.8],
  [30000, 10.8, 2.86, 6.0],
  [40000, 8.9, 3.2, 3.6],
  [40000, 10.1, 3.2, 4.8],
  [40000, 11.3, 3.2, 6.0],
  [50000, 10.2, 3.2, 3.6],
  [50000, 11.4, 3.2, 4.8],
  [50000, 12.6, 3.2, 6.0],
  [60000, 15.0, 3.2, 7.2],
];

// --- p. 5 — Reservatório tubular alto ----------------------------------------------------
const TUBULAR_ROWS: readonly Row[] = [
  [3000, 6.0, 0.8],
  [5000, 5.4, 1.1],
  [7500, 7.8, 1.1],
  [10000, 6.0, 1.44],
  [10000, 8.0, 1.27],
  [12000, 6.0, 1.59],
  [12500, 7.8, 1.43],
  [12000, 9.6, 1.27],
  [15000, 9.6, 1.43],
  [18000, 9.2, 1.59],
  [20000, 7.2, 1.91],
  [20000, 10.2, 1.59],
  [25000, 9.0, 1.91],
  [30500, 7.8, 2.23],
  [30000, 10.8, 1.91],
  [36000, 12.6, 1.91],
  [40000, 10.8, 2.23],
  [40000, 14.4, 1.91],
  [50000, 10.0, 2.55],
  [50000, 13.2, 2.23],
  [60000, 12.0, 2.55],
  [70000, 10.8, 2.86],
  [80000, 10.0, 3.2],
  [90000, 11.4, 3.2],
  [100000, 12.6, 3.2],
  [100000, 15.6, 2.86],
  [120000, 15.0, 3.2],
  [150000, 18.6, 3.2],
  [170000, 15.0, 3.82],
  [200000, 18.0, 3.82],
];
/** Linhas impressas com asterisco (36.000, 40.000 × 14,40, 50.000 × 13,20 e de 100.000 × 15,60 em diante). */
const TUBULAR_MARKED = [15, 17, 19, 25, 26, 27, 28, 29];

// --- p. 6 — Reservatório vertical apoiado ------------------------------------------------
const VERTICAL_GROUND_ROWS: readonly Row[] = [
  [5000, 1.8, 1.91],
  [10000, 2.4, 2.32],
  [12000, 3.1, 2.23],
  [15000, 4.0, 2.23],
  [20000, 4.0, 2.55],
  [25000, 4.0, 2.86],
  [30000, 4.0, 3.1],
  [40000, 4.8, 3.2],
  [50000, 6.0, 3.2],
  [60000, 7.4, 3.2],
];

// --- p. 6 — Reservatório vertical fundo cônico com pés -----------------------------------
const VERTICAL_CONE_ROWS: readonly Row[] = [
  [5000, 2.3, 1.91],
  [10000, 2.9, 2.32],
  [12000, 3.5, 2.23],
  [15000, 4.5, 2.23],
  [20000, 4.5, 2.55],
  [25000, 4.5, 2.86],
  [30000, 4.5, 3.1],
  [40000, 5.3, 3.2],
  [50000, 6.5, 3.2],
  [60000, 7.9, 3.2],
];

const GOBLET_REMARK =
  'O texto da p. 4 fala em capacidades de 5.000 a 100.000 L "por padrão", mas as tabelas vão de 5.000 a 80.000 L (com água na coluna) e de 2.000 a 60.000 L (sem água na coluna). Valem as linhas tabuladas; acima disso, só sob consulta ao fabricante.';

const FAMILIES: readonly Omit<TankFamily, 'origin'>[] = [
  {
    id: 'tramec-taca-com-agua',
    name: 'Reservatório tipo taça com água na coluna',
    tankType: 'gobletWet',
    manufacturer: MANUFACTURER,
    material: MATERIAL,
    source: source(4),
    page: 4,
    description:
      'Taça (cálice) sobre coluna, com armazenamento também na coluna. Água potável; indicado para condomínios e sobrados.',
    variants: variants('tramec-taca-com-agua', GOBLET_WET_ROWS),
    capacityRangeL: [5000, 100000],
    customDefaults: { capacityL: 10000, diameter: 1.91, height: 7.05 },
    approximations: [
      'Altura da coluna: não tabulada nesta família. Adota-se a altura que reproduz a capacidade nominal com o diâmetro de coluna estimado.',
      'Diâmetro da coluna (metade do diâmetro da taça, mínimo 0,60 m) e altura da transição cônica (20 % do diâmetro da taça): proporções lidas das imagens.',
      ...SHARED_APPROXIMATIONS,
    ],
    remarks: [
      GOBLET_REMARK,
      'Os diâmetros 2,22 m e 2,54 m desta tabela aparecem como 2,23 m e 2,55 m nas demais tabelas do catálogo; foram mantidos como impressos.',
    ],
  },
  {
    id: 'tramec-taca-sem-agua',
    name: 'Reservatório tipo taça sem água na coluna',
    tankType: 'gobletDry',
    manufacturer: MANUFACTURER,
    material: MATERIAL,
    source: source(4),
    page: 4,
    description:
      'Taça (cálice) sobre coluna seca: só a taça armazena. Três alturas de coluna por capacidade.',
    variants: variants('tramec-taca-sem-agua', GOBLET_DRY_ROWS),
    capacityRangeL: [5000, 100000],
    customDefaults: { capacityL: 10000, diameter: 1.91, height: 7.1 },
    approximations: [
      'A "Altura Coluna" da tabela é lida como a cota em que começa a transição cônica; o catálogo não traz desenho cotado que o confirme.',
      'Diâmetro da coluna (metade do diâmetro da taça, mínimo 0,60 m) e altura da transição cônica (20 % do diâmetro da taça): proporções lidas das imagens.',
      ...SHARED_APPROXIMATIONS,
    ],
    remarks: [GOBLET_REMARK],
  },
  {
    id: 'tramec-tubular-alto',
    name: 'Reservatório tubular alto',
    tankType: 'tubular',
    manufacturer: MANUFACTURER,
    material: MATERIAL,
    source: source(5),
    page: 5,
    description:
      'Cilindro vertical esbelto apoiado no solo, de 3.000 a 200.000 L, com ou sem divisão interna de células.',
    variants: variants('tramec-tubular-alto', TUBULAR_ROWS, TUBULAR_MARKED),
    capacityRangeL: [3000, 200000],
    customDefaults: { capacityL: 10000, diameter: 1.44, height: 6.0 },
    approximations: [
      'Divisão interna de células: o catálogo cita a opção, mas não a posiciona. É registrada como propriedade (quantidade de células), sem geometria.',
      ...SHARED_APPROXIMATIONS,
    ],
    remarks: [
      'Oito linhas trazem um asterisco junto à capacidade (36.000; 40.000 × 14,40; 50.000 × 13,20; 100.000 × 15,60; 120.000; 150.000; 170.000; 200.000). O catálogo não traz a legenda do asterisco: confirmar com o fabricante.',
      'As capacidades 12.500 L e 30.500 L estão impressas assim, intercaladas com 12.000 L e 30.000 L.',
    ],
  },
  {
    id: 'tramec-australiano',
    name: 'Reservatório tipo australiano',
    tankType: 'australian',
    manufacturer: MANUFACTURER,
    material: MATERIAL,
    source: source(5),
    page: 5,
    description:
      'Costado de chapas corrugadas, de 4.300 a 540.000 L, com alturas de 0,90 m ou 1,72 m, fundo cônico e pés de apoio. Uso agropecuário.',
    variants: [],
    capacityRangeL: [4300, 540000],
    catalogHeights: [0.9, 1.72],
    customDefaults: { capacityL: 20000, diameter: 5.319, height: 0.9 },
    approximations: [
      'O catálogo NÃO tabula os modelos: informa só a faixa de capacidade e as duas alturas. Não há modelos comerciais a escolher — a capacidade é informada pelo usuário.',
      'Diâmetro: derivado da capacidade e da altura do costado, como cilindro (D = √(4V/πh)). As alturas 0,90 m e 1,72 m são lidas como altura do costado, sem os pés.',
      'Altura dos pés (0,35 m), altura do fundo cônico, passo e profundidade das ondas da chapa (76 mm × 18 mm) e o revestimento interno azul: representação lida das imagens.',
      'Espessura das chapas: o catálogo não informa.',
      'Bocais: definidos pelo usuário, com o diâmetro da especificação de tubo escolhida.',
    ],
    remarks: [],
  },
  {
    id: 'tramec-vertical-apoiado',
    name: 'Reservatório vertical apoiado',
    tankType: 'verticalGround',
    manufacturer: MANUFACTURER,
    material: MATERIAL,
    source: source(6),
    page: 6,
    description:
      'Cilindro vertical de fundo plano apoiado na base, de 5.000 a 60.000 L, para água potável sem necessidade de grande altura manométrica.',
    variants: variants('tramec-vertical-apoiado', VERTICAL_GROUND_ROWS),
    capacityRangeL: [5000, 60000],
    customDefaults: { capacityL: 10000, diameter: 2.32, height: 2.4 },
    approximations: [...SHARED_APPROXIMATIONS],
    remarks: [],
  },
  {
    id: 'tramec-vertical-fundo-conico',
    name: 'Reservatório vertical de fundo cônico com pés',
    tankType: 'verticalConeLegs',
    manufacturer: MANUFACTURER,
    material: MATERIAL,
    source: source(6),
    page: 6,
    description:
      'Cilindro vertical elevado sobre pés, com fundo cônico, de 5.000 a 60.000 L. Pés padrão de 50 cm de altura.',
    variants: variants('tramec-vertical-fundo-conico', VERTICAL_CONE_ROWS),
    capacityRangeL: [5000, 60000],
    catalogSupportHeight: 0.5,
    customDefaults: { capacityL: 10000, diameter: 2.32, height: 2.9 },
    approximations: [
      'Altura do fundo cônico: não tabulada. Adotam-se 80 % da altura dos pés (0,40 m), para o vértice ficar acima do piso, como nas imagens.',
      'Quantidade e perfil dos pés: representação lida das imagens.',
      ...SHARED_APPROXIMATIONS,
    ],
    remarks: [
      'A altura total é a do reservatório apoiado de mesma capacidade mais os 0,50 m dos pés — exceto no de 12.000 L (3,50 m contra 3,10 m, diferença de 0,40 m). Mantido como impresso.',
    ],
  },
  {
    id: 'tramec-vertical-in-loco',
    name: 'Reservatório vertical apoiado montado na obra',
    tankType: 'fieldErected',
    manufacturer: MANUFACTURER,
    material: MATERIAL,
    source: source(7),
    page: 7,
    description:
      'Cilindro vertical apoiado, montado na obra ("in loco"), de 200.000 a 10.000.000 L, com ou sem divisão interna de células. Dimensionado por projeto.',
    variants: [],
    capacityRangeL: [200000, 10000000],
    customDefaults: { capacityL: 200000, diameter: 8, height: 4 },
    approximations: [
      'O catálogo NÃO tabula os modelos: informa só a faixa de capacidade ("pode ser dimensionado atendendo os mais diversos projetos"). Diâmetro e altura são informados pelo usuário.',
      ...SHARED_APPROXIMATIONS,
    ],
    remarks: [],
  },
  {
    id: 'tramec-cilindrico-horizontal',
    name: 'Reservatório cilíndrico horizontal',
    tankType: 'horizontal',
    manufacturer: MANUFACTURER,
    material: MATERIAL,
    source: source(7),
    page: 7,
    description:
      'Cilindro horizontal de 2.000 a 20.000 L, para água potável, água de reúso, diesel, gasolina e outros líquidos. Apoio em longarina ou em pés de 0,50 m; pode ser enterrado.',
    variants: [],
    capacityRangeL: [2000, 20000],
    catalogSupportHeight: 0.5,
    customDefaults: { capacityL: 10000, diameter: 1.91, height: 2.06, length: 3.6 },
    approximations: [
      'O catálogo NÃO tabula os modelos: informa só a faixa de capacidade e a altura dos pés (0,50 m). Diâmetro e comprimento são informados pelo usuário.',
      'Tampos abaulados (profundidade de 12 % do diâmetro), altura da longarina (0,15 m), berços, boca de visita e escada: representação lida das imagens.',
      'A instalação enterrada citada no catálogo não é modelada.',
      'Espessura das chapas: o catálogo não informa.',
      'Bocais: definidos pelo usuário, com o diâmetro da especificação de tubo escolhida.',
    ],
    remarks: [],
  },
];

/** Famílias transcritas do catálogo do fabricante (somente leitura no editor). */
export const TRAMEC_TANK_FAMILIES: readonly TankFamily[] = FAMILIES.map((family) => ({
  ...family,
  origin: 'builtin',
}));
