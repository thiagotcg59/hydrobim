import {
  mmToM,
  pumpLengthMismatch,
  pumpModelRange,
  type PumpFamily,
  type PumpVariant,
} from '@hydrobim/core';

/**
 * Bombas anfíbias HIGRA — transcrição do dimensional do manual do fabricante.
 *
 * Fonte: HIGRA — "Manual Técnico Bombas Anfíbias", Rev. 22 (arquivo
 * `MANUAL-TECNICO-BOMBAS-ANFIBIAS-REV-22-PORTUGUES.pdf`, fornecido pelo responsável do
 * projeto), item 2.7 "Dimensionais", p. 41–45: Figuras 42 e 43 e Tabelas 16 a 19.
 *
 * Colunas da tabela, com as letras das figuras (mm):
 *  - A: flange de sucção (DN e classe PN); B: flange de descarga;
 *  - C: da face do flange B ao primeiro par de pés; D: entre os dois pares de pés;
 *    E: do segundo par de pés à face do flange A; F: comprimento total, de face a face;
 *  - G: distância entre os furos dos pés (vista frontal); ØH: diâmetro desses furos;
 *  - I: da base dos pés ao eixo; J: altura total, da base ao topo;
 *  - Peso (kg). A coluna GD²/4 (momento de inércia das partes girantes) não é cadastrada.
 *
 * SELEÇÃO: por decisão do responsável, cada tabela entra com CINCO linhas de portes
 * diferentes — não a tabela inteira. Para um modelo fora delas, o editor oferece "Outro
 * modelo (preencher as cotas)": os campos levam as mesmas letras do dimensional.
 *
 * Cada linha da tabela vale para vários modelos (as potências de uma mesma carcaça); os
 * modelos estão listados como impressos.
 *
 * Estágios: o manual não tabula o número de estágios. Ele é LIDO do prefixo do modelo
 * (R1, M1, S1 = estágio único; R2 a R5 = múltiplos estágios) e só muda a representação do
 * corpo.
 *
 * Notas do manual (p. 41): considerar ±5 % no peso; bombas com pistão equalizador e/ou
 * sensoriamento nas configurações Básico e Premium podem ter dimensões diferentes das
 * tabelas — consultar a engenharia da HIGRA.
 *
 * Flanges: o manual traz a sua própria tabela (item 2.8, Tabela 20, p. 46). Pela regra do
 * catálogo (tabela única de flanges), o flange NÃO é transcrito dessa fonte: vem de
 * `flanges.ts`, na classe e no DN das colunas A e B. As 13 linhas da Tabela 20 conferem
 * com a tabela única em diâmetro externo, espessura, círculo de furação, diâmetro e
 * número de furos (comparação em `pumps.test.ts`); a diferença é o ressalto, que o manual
 * diz não existir nos flanges da bomba (nota 4), e a ressalva de que alguns PN 10 podem
 * ter espessura reforçada ou menos furos (notas 2 e 3).
 */

const MANUFACTURER = 'HIGRA';

const source = (table: number, page: number): string =>
  `HIGRA — Manual Técnico Bombas Anfíbias, Rev. 22 (MANUAL-TECNICO-BOMBAS-ANFIBIAS-REV-22-PORTUGUES.pdf), item 2.7 "Dimensionais", Tabela ${table}, p. ${page}`;

type Pn = 10 | 16 | 25 | 40;

/**
 * Linha da tabela: [série, potências, carcaça, DN e PN de A, DN e PN de B, C, D, E, F, G,
 * ØH, I, J, peso]. Série "R1-195" + potência "15B" = modelo "R1-195/15B".
 */
type Row = readonly [
  series: string,
  powers: readonly string[],
  frame: string,
  dnA: number,
  pnA: Pn,
  dnB: number,
  pnB: Pn,
  C: number,
  D: number,
  E: number,
  F: number,
  G: number,
  H: number,
  I: number,
  J: number,
  weightKg: number,
];

const variants = (familyId: string, rows: readonly Row[]): PumpVariant[] =>
  rows.map(([series, powers, frame, dnA, pnA, dnB, pnB, C, D, E, F, G, H, I, J, weightKg]) => ({
    id: `${familyId}/${series.toLowerCase()}-${frame.toLowerCase()}`,
    models: powers.map((power) => `${series}/${power}`),
    frame,
    suction: { dn: dnA, pressureClass: `PN ${pnA}` },
    discharge: { dn: dnB, pressureClass: `PN ${pnB}` },
    dimensions: {
      footOffset: mmToM(C),
      footSpan: mmToM(D),
      rearLength: mmToM(E),
      length: mmToM(F),
      footWidth: mmToM(G),
      footHoleDiameter: mmToM(H),
      axisHeight: mmToM(I),
      totalHeight: mmToM(J),
    },
    weightKg,
    // Prefixo do modelo: letra da hidráulica e número de estágios (leitura adotada).
    stages: Number(series.charAt(1)),
  }));

const APPROXIMATIONS: readonly string[] = [
  'Flanges A e B: da tabela única de flanges do catálogo, na classe PN e no DN impressos. A Tabela 20 do manual (p. 46) traz os mesmos diâmetros, espessuras e furações, mas informa que os flanges da bomba saem sem o ressalto que o modelo mostra e que alguns PN 10 podem ter espessura reforçada ou menos furos.',
  'Corpo: diâmetro da carcaça do motor, cone da descarga, bocal da sucção, anéis, tirantes, pés e olhais de içamento são representação, lida das Figuras 42 e 43 e escalada pelas cotas I e J. O manual não os dimensiona.',
  'Posição dos pés: a partir da face do flange B, pelas cotas C e D. A cota E fica registrada e não entra na geometria.',
  'Número de estágios: lido do prefixo do modelo (R1/M1/S1 = 1; R2 a R5 = 2 a 5); muda só a representação do corpo.',
  'Peso: como impresso, com ±5 % segundo o manual. A coluna GD²/4 não é cadastrada.',
  'Bombas com pistão equalizador ou sensoriamento (configurações Básico e Premium) podem ter outras dimensões: consultar a engenharia da HIGRA.',
];

const SELECTION_NOTE =
  'Cadastradas cinco linhas da tabela, de portes diferentes; para os demais modelos use "Outro modelo (preencher as cotas)", com as mesmas letras do dimensional.';

const millimeters = (meters: number): string =>
  (Math.round(meters * 10000) / 10).toLocaleString('pt-BR');

/** Linhas em que a cota F impressa não é a soma C + D + E (transcritas como impressas). */
const mismatchRemarks = (rows: readonly PumpVariant[]): string[] =>
  rows
    .filter((row) => Math.abs(pumpLengthMismatch(row.dimensions)) > 0.0005)
    .map(
      (row) =>
        `${pumpModelRange(row)}: F impresso = ${millimeters(row.dimensions.length)} mm, mas C + D + E = ${millimeters(row.dimensions.length - pumpLengthMismatch(row.dimensions))} mm. Valores mantidos como impressos; as portas usam F.`,
    );

function family(
  id: string,
  name: string,
  frequencyHz: number,
  table: number,
  page: number,
  description: string,
  rows: readonly Row[],
): PumpFamily {
  const list = variants(id, rows);
  return {
    id,
    name,
    pumpType: 'amphibious',
    manufacturer: MANUFACTURER,
    frequencyHz,
    source: source(table, page),
    page,
    description,
    variants: list,
    approximations: [...APPROXIMATIONS],
    remarks: [SELECTION_NOTE, ...mismatchRemarks(list)],
    origin: 'builtin',
  };
}

const SINGLE =
  'Bomba anfíbia em linha, de estágio único (Figura 42): sucção e descarga flangeadas no mesmo eixo, com o motor entre elas.';
const MULTI =
  'Bomba anfíbia em linha, de múltiplos estágios (Figura 43): os estágios ficam em série do lado da sucção.';

// [série, potências, carcaça, DN A, PN A, DN B, PN B, C, D, E, F, G, ØH, I, J, peso]

/** Tabela 16 — estágio único, 60 Hz (p. 42). */
const SINGLE_60: readonly Row[] = [
  [
    'R1-195',
    ['15B', '20B', '25B', '30B'],
    '132L',
    80,
    40,
    80,
    40,
    160,
    599,
    174,
    933,
    270,
    26.5,
    206,
    396,
    210,
  ],
  [
    'R1-260',
    ['20B', '25B', '30B', '40B'],
    '160L',
    200,
    40,
    200,
    40,
    266,
    581,
    151,
    998,
    340,
    27,
    283,
    543,
    361,
  ],
  [
    'M1-305',
    ['75B', '100B', '125B'],
    '225S',
    300,
    10,
    300,
    10,
    346,
    747,
    293,
    1386,
    376,
    30,
    327,
    647,
    753,
  ],
  [
    'R1-430',
    ['350B', '400B'],
    '315S',
    400,
    25,
    400,
    25,
    355,
    1215,
    299,
    1870,
    530,
    35,
    495,
    995,
    2240,
  ],
  [
    'S1-630',
    ['150B', '175B', '200B', '250B'],
    '315L',
    600,
    10,
    600,
    10,
    620,
    787,
    854,
    2261,
    530,
    35,
    590,
    1097,
    2200,
  ],
];

/** Tabela 17 — múltiplos estágios, 60 Hz (p. 43). */
const MULTI_60: readonly Row[] = [
  ['R2-155', ['15B', '20B'], '132L', 80, 40, 80, 40, 160, 599, 193, 951, 270, 24, 206, 396, 215],
  [
    'R2-265',
    ['40B', '50B', '60B'],
    '225S',
    150,
    40,
    200,
    40,
    385,
    657,
    373,
    1406,
    380,
    30,
    335,
    635,
    805,
  ],
  [
    'R3-320',
    ['100B', '125B', '150B'],
    '225S',
    200,
    40,
    200,
    40,
    385,
    658,
    444,
    1487,
    380,
    30,
    325,
    613,
    940,
  ],
  [
    'R2-360',
    ['150B', '175B', '200B', '250B', '300B'],
    '315S',
    250,
    40,
    250,
    40,
    355,
    1080,
    453,
    1891,
    450,
    35,
    435,
    818,
    1650,
  ],
  [
    'R4-365',
    ['400B', '450B', '500B', '550B', '600B', '650B'],
    '315L',
    300,
    25,
    300,
    40,
    394,
    1333,
    1024,
    2752,
    450,
    35,
    440,
    828,
    2700,
  ],
];

/** Tabela 18 — estágio único, 50 Hz (p. 44). */
const SINGLE_50: readonly Row[] = [
  [
    'R1-195',
    ['12B', '15B', '20B'],
    '132L',
    80,
    40,
    80,
    40,
    160,
    599,
    174,
    933,
    270,
    25,
    206,
    396,
    210,
  ],
  [
    'R1-320',
    ['25B', '30B', '40B'],
    '225S',
    200,
    40,
    200,
    40,
    385,
    658,
    211,
    1252,
    380,
    30,
    335,
    635,
    640,
  ],
  [
    'M1-335',
    ['100B', '125B'],
    '225S',
    300,
    16,
    300,
    16,
    319,
    906,
    227,
    1452,
    520,
    30,
    376,
    731,
    1100,
  ],
  [
    'M1-400',
    ['200B', '250B', '300B'],
    '315S',
    400,
    25,
    400,
    25,
    728,
    762,
    575,
    2065,
    450,
    35,
    480,
    960,
    1942,
  ],
  [
    'S1-630',
    ['75B', '100B', '125B', '150B', '175B'],
    '315L',
    600,
    10,
    600,
    10,
    620,
    787,
    854,
    2261,
    530,
    35,
    590,
    1095,
    2200,
  ],
];

/** Tabela 19 — múltiplos estágios, 50 Hz (p. 45). */
const MULTI_50: readonly Row[] = [
  [
    'R2-195',
    ['15B', '20B', '25B', '30B'],
    '160L',
    80,
    40,
    80,
    40,
    160,
    599,
    244,
    1003,
    270,
    26,
    206,
    450,
    220,
  ],
  [
    'R3-265',
    ['30B', '40B', '50B'],
    '160T',
    150,
    40,
    200,
    40,
    385,
    656,
    465,
    1506,
    380,
    30,
    325,
    630,
    690,
  ],
  [
    'R4-320',
    ['100B', '125B', '150B'],
    '315S',
    200,
    40,
    250,
    40,
    355,
    1080,
    616,
    2051,
    450,
    35,
    435,
    805,
    1700,
  ],
  [
    'R2-360',
    ['100B', '125B', '150B', '175B'],
    '315S',
    250,
    40,
    250,
    40,
    355,
    1080,
    453,
    1891,
    450,
    35,
    435,
    818,
    1650,
  ],
  [
    'R4-365',
    ['300B', '350B', '400B'],
    '315L',
    300,
    25,
    300,
    40,
    394,
    1333,
    1024,
    2752,
    450,
    35,
    440,
    828,
    2700,
  ],
];

export const HIGRA_PUMP_FAMILIES: readonly PumpFamily[] = [
  family(
    'higra-anfibia-estagio-unico-60hz',
    'Bomba anfíbia HIGRA de estágio único, 60 Hz',
    60,
    16,
    42,
    SINGLE,
    SINGLE_60,
  ),
  family(
    'higra-anfibia-multiplos-estagios-60hz',
    'Bomba anfíbia HIGRA de múltiplos estágios, 60 Hz',
    60,
    17,
    43,
    MULTI,
    MULTI_60,
  ),
  family(
    'higra-anfibia-estagio-unico-50hz',
    'Bomba anfíbia HIGRA de estágio único, 50 Hz',
    50,
    18,
    44,
    SINGLE,
    SINGLE_50,
  ),
  family(
    'higra-anfibia-multiplos-estagios-50hz',
    'Bomba anfíbia HIGRA de múltiplos estágios, 50 Hz',
    50,
    19,
    45,
    MULTI,
    MULTI_50,
  ),
];
