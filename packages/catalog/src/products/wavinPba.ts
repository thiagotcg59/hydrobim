import type { ProductColumn, ProductFamily, ProductSize } from './types';

/**
 * Linha PBA (PVC 6,3 com junta elástica, NBR 5647) — Amanco Wavin.
 *
 * Fonte única: Ficha Técnica "Linha PBA", FTC000088, revisão jan/2025. Os valores estão
 * como impressos nas tabelas ("medidas aproximadas em milímetros"); nada foi interpolado.
 * O que não é tabulado e foi derivado ou adotado para o modelo 3D está declarado em
 * `approximations`; as divergências do próprio catálogo, em `remarks`.
 */

const SOURCE =
  'Amanco Wavin — Ficha Técnica Linha PBA, FTC000088, rev. jan/2025 (https://mediahub.wavin.com/m/89a6b27bb1db716/original/FT-Linha-PBA.pdf)';
const source = (pages: string): string => `${SOURCE}, p. ${pages}.`;
const MANUFACTURER = 'Amanco Wavin';
const STANDARD = 'ABNT NBR 5647';

const PLANNED =
  'Inserção na rede prevista para a Fase 2 (peças de transição e novos tipos de conexão).';

/** Tubos PBA por DN: Ø externo (D) e espessura (e) por classe — FT, p. 14–15. */
export const PBA_PIPE_MM: Readonly<
  Record<
    number,
    { readonly outerDiameter: number; readonly wall: Readonly<Record<12 | 15 | 20, number>> }
  >
> = {
  50: { outerDiameter: 60, wall: { 12: 2.7, 15: 3.3, 20: 4.3 } },
  75: { outerDiameter: 85, wall: { 12: 3.9, 15: 4.7, 20: 6.1 } },
  100: { outerDiameter: 110, wall: { 12: 5.0, 15: 6.1, 20: 7.8 } },
};

/** Bolsa das conexões injetadas por DN: [A, B, C] — tabelas do cap, tê e cruzeta. */
const INJECTED_SOCKET: Readonly<Record<number, readonly [number, number, number]>> = {
  50: [82.9, 60.5, 60.5],
  75: [116.7, 85.5, 71.0],
  100: [144.9, 110.5, 76.0],
};
/** Profundidade (C) da bolsa das conexões injetadas, usada onde a tabela não a informa. */
export const PBA_INJECTED_SOCKET_DEPTH_MM: Readonly<Record<number, number>> = {
  50: 60.5,
  75: 71.0,
  100: 76.0,
};

/**
 * Saída roscada do colar de tomada, por rosca. `bossDiameter` e `threadLength` vêm das
 * linhas 25–40 da própria tabela do colar (colunas D e L, que nessas linhas acompanham a
 * rosca). `bore` é o diâmetro externo nominal da rosca Whitworth gás (G ½ = 20,955 mm;
 * G ¾ = 26,441 mm, ISO 228-1) — o catálogo não identifica o padrão da rosca: suposição.
 */
export const PBA_SADDLE_OUTLET_MM: Readonly<
  Record<
    '1/2' | '3/4',
    { readonly bossDiameter: number; readonly threadLength: number; readonly bore: number }
  >
> = {
  '1/2': { bossDiameter: 30.0, threadLength: 17.8, bore: 20.955 },
  '3/4': { bossDiameter: 36.5, threadLength: 18.5, bore: 26.441 },
};

const WALL_NOTE =
  'Espessura de parede e diâmetro interno do corpo não são tabulados: adotados os do tubo classe 20 de mesmo DN (as conexões são dimensionadas para a classe 20, FT p. 2).';
const GROOVE_NOTE =
  'Posição, largura e concordâncias do alojamento do anel dentro da bolsa são representação; A, B e C são os da tabela.';

const col = (key: string, title: string): ProductColumn => ({ key, title });
const SOCKET_COLUMNS = [
  col('A', 'Ø externo da bolsa, sobre o alojamento do anel'),
  col('B', 'Ø interno da boca da bolsa'),
  col('C', 'Profundidade da bolsa'),
];

type Row = readonly [code: string, description: string, weightG: number];

function sizes(
  labels: readonly (readonly [label: string, dn: number, dn2?: number])[],
  rows: readonly Row[],
  keys: readonly string[],
  values: readonly (readonly number[])[],
): ProductSize[] {
  return labels.map(([label, dn, dn2], index) => {
    const row = rows[index];
    const line = values[index];
    if (!row || !line || line.length !== keys.length) {
      throw new Error(`Tabela inconsistente: ${label}.`);
    }
    const dims: Record<string, number> = {};
    keys.forEach((key, k) => {
      dims[key] = line[k] as number;
    });
    return {
      label,
      dn,
      ...(dn2 !== undefined ? { dn2 } : {}),
      code: row[0],
      description: row[1],
      weightG: row[2],
      dims,
    };
  });
}

const DN_LABELS = [
  ['DN50', 50],
  ['DN75', 75],
  ['DN100', 100],
] as const;
const injected = (dn: number): readonly [number, number, number] => {
  const socket = INJECTED_SOCKET[dn];
  if (!socket) throw new Error(`DN ${dn} fora da linha PBA.`);
  return socket;
};

// ---------------------------------------------------------------------------
// Tubos
// ---------------------------------------------------------------------------

const PIPE_COLUMNS = [
  ...SOCKET_COLUMNS,
  col('D', 'Ø externo do tubo'),
  col('e', 'Espessura de parede'),
  col('L', 'Comprimento total (bolsa incluída); comprimento de montagem: 6,0 m'),
];
const PIPE_KEYS = ['A', 'B', 'C', 'D', 'e', 'L'];
/** Cotas comuns às três classes: [A, B, C, D, L]. */
const PIPE_COMMON = [
  [78.2, 60.4, 85.0, 60.0, 6110.0],
  [105.0, 85.6, 100.0, 85.0, 6130.0],
  [132.5, 110.6, 120.0, 110.0, 6155.0],
] as const;

function pipeFamily(
  pressureClass: 12 | 15 | 20,
  page: string,
  rows: readonly Row[],
): ProductFamily {
  return {
    id: `wavin-pba-tubo-cl${pressureClass}`,
    name: `Tubo PBA classe ${pressureClass}`,
    category: 'Tubos',
    shape: 'pipe',
    pressureClass,
    manufacturer: MANUFACTURER,
    standard: STANDARD,
    source: source(page),
    approximations: [
      GROOVE_NOTE,
      'Chanfro da ponta: 15° com metade da espessura na extremidade (FT, item 4.3).',
      'Anel JERI montado: ajustado ao alojamento da bolsa (as cotas do anel solto são as da tabela do anel).',
    ],
    remarks: [
      'As cotas A, B e C da bolsa são impressas iguais para as três classes, apesar das espessuras diferentes.',
    ],
    network: {
      inserted: true,
      note: `Inserido como tubo da especificação "PVC PBA junta elástica — classe ${pressureClass}". A bolsa integrada e o anel aparecem apenas neste modelo do produto: o tubo da rede é um trecho de comprimento livre.`,
    },
    columns: PIPE_COLUMNS,
    sizes: sizes(
      DN_LABELS,
      rows,
      PIPE_KEYS,
      DN_LABELS.map(([, dn], i) => {
        const [a, b, c, d, l] = PIPE_COMMON[i] as (typeof PIPE_COMMON)[number];
        return [a, b, c, d, PBA_PIPE_MM[dn]?.wall[pressureClass] ?? NaN, l];
      }),
    ),
  };
}

const pipes: ProductFamily[] = [
  pipeFamily(12, '14', [
    ['14966', 'TUBO PBA CL12 INFRA DN50', 4382],
    ['14967', 'TUBO PBA CL12 INFRA DN75', 8988],
    ['14968', 'TUBO PBA CL12 INFRA DN100', 14974.8],
  ]),
  pipeFamily(15, '14–15', [
    ['14969', 'TUBO PBA CL15 DN 50', 5299.8],
    ['14970', 'TUBO PBA CL15 DN 75', 10726.0],
    ['14971', 'TUBO PBA CL15 DN 100', 18078.1],
  ]),
  pipeFamily(20, '15', [
    ['14972', 'TUBO PBA CL20 DN 50', 6784.2],
    ['14973', 'TUBO PBA CL20 DN 75', 13678.7],
    ['14974', 'TUBO PBA CL20 DN 100', 22738.6],
  ]),
];

// ---------------------------------------------------------------------------
// Curvas ponta e bolsa (conformadas)
// ---------------------------------------------------------------------------

const BEND_COLUMNS = [
  ...SOCKET_COLUMNS,
  col('D', 'Ø externo da ponta'),
  col('F', 'Comprimento reto da ponta'),
  col('L', 'Comprimento total, da boca da bolsa ao ponto mais afastado da ponta'),
];
const BEND_KEYS = ['A', 'B', 'C', 'D', 'F', 'L'];
/** Cotas comuns a todas as curvas: [A, B, C, D, F]. */
const BEND_COMMON = [
  [81.0, 60.5, 70.0, 60.0, 122.2],
  [113.3, 85.5, 80.0, 85.0, 154.1],
  [142.4, 110.5, 100.0, 110.0, 195.6],
] as const;
const BEND_TOTAL: Readonly<Record<number, readonly [number, number, number]>> = {
  11.25: [267.0, 342.0, 436.0],
  22.5: [267.0, 342.0, 436.0],
  45: [299.0, 397.0, 511.0],
  90: [252.0, 347.0, 451.0],
};

const rad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Raio de curvatura e trecho reto após a bolsa de uma curva PBA — NÃO tabulados.
 *
 * Derivação: a cota L é lida como a projeção, no eixo da bolsa, da boca até o ponto mais
 * afastado da ponta: `L = C + S + R·sen θ + F·cos θ + (D/2)·sen θ`. Supondo que as curvas
 * de 45° e de 90° do mesmo DN tenham o mesmo raio R e o mesmo trecho reto S, as duas
 * equações dão `R = (L90 − L45 + F·cos 45°)/(1 − sen 45°) − D/2`. Com esse raio, o trecho
 * reto S de cada ângulo sai da sua própria cota L, que o modelo reproduz exatamente.
 * (Resultado: R ≈ 1,75 a 1,95·D e S ≈ 0,77·D nos três diâmetros.)
 */
export function pbaBendGeometryMm(
  angleDeg: number,
  dn: number,
): { bendRadius: number; lead: number } | undefined {
  const index = DN_LABELS.findIndex(([, size]) => size === dn);
  const common = BEND_COMMON[index];
  const l90 = BEND_TOTAL[90]?.[index];
  const l45 = BEND_TOTAL[45]?.[index];
  const total = BEND_TOTAL[angleDeg]?.[index];
  if (!common || l90 === undefined || l45 === undefined || total === undefined) return undefined;
  const [, , c, d, f] = common;
  const bendRadius = (l90 - l45 + f * Math.cos(rad(45))) / (1 - Math.sin(rad(45))) - d / 2;
  const theta = rad(angleDeg);
  const lead =
    total - c - bendRadius * Math.sin(theta) - f * Math.cos(theta) - (d / 2) * Math.sin(theta);
  return { bendRadius, lead };
}

/**
 * Cotas (mm) de uma curva PBA como conexão de rede: distância do vértice teórico ao fundo
 * da bolsa (`toSocket` = trecho reto S + R·tg θ/2) e à extremidade da ponta (`toSpigot` =
 * F + R·tg θ/2), raio e bolsa `[profundidade C, Ø externo A]`. Usa o raio e o trecho reto
 * derivados em `pbaBendGeometryMm` — mesma hipótese, mesma ressalva.
 */
export function pbaBendPortsMm(
  angleDeg: number,
  dn: number,
):
  | { bendRadius: number; toSocket: number; toSpigot: number; socket: readonly [number, number] }
  | undefined {
  const geometry = pbaBendGeometryMm(angleDeg, dn);
  const common = BEND_COMMON[DN_LABELS.findIndex(([, size]) => size === dn)];
  if (!geometry || !common) return undefined;
  const [a, , c, , f] = common;
  const leg = geometry.bendRadius * Math.tan(rad(angleDeg) / 2);
  return {
    bendRadius: geometry.bendRadius,
    toSocket: geometry.lead + leg,
    toSpigot: f + leg,
    socket: [c, a],
  };
}

function bendFamily(
  angleDeg: number,
  label: string,
  page: string,
  rows: readonly Row[],
  remarks: readonly string[] = [],
): ProductFamily {
  const totals = BEND_TOTAL[angleDeg];
  if (!totals) throw new Error(`Curva de ${angleDeg}° sem tabela.`);
  return {
    id: `wavin-pba-curva-${String(angleDeg).replace('.', '-')}`,
    name: `Curva ${label} ponta e bolsa PBA`,
    category: 'Curvas',
    shape: 'bend',
    angleDeg,
    manufacturer: MANUFACTURER,
    standard: STANDARD,
    source: source(page),
    approximations: [
      'Raio de curvatura e trecho reto após a bolsa não são tabulados: derivados das cotas L das curvas de 45° e 90°, supondo o mesmo raio nas duas (ver docs/CATALOGS.md). A cota L de cada curva é reproduzida exatamente.',
      'Espessura de parede não tabulada: adotada a do tubo classe 20 de mesmo DN.',
      'Ponta de topo reto, como no desenho (o chanfro de montagem não é cotado).',
      GROOVE_NOTE,
    ],
    remarks,
    network: {
      inserted: true,
      note: `Inserida como joelho pela ferramenta Tubo (mudança de direção) ou Joelho (família "Curva ${label} PBA ponta e bolsa"): a bolsa fica na porta A e a ponta na porta B.`,
    },
    columns: BEND_COLUMNS,
    sizes: sizes(
      DN_LABELS,
      rows,
      BEND_KEYS,
      BEND_COMMON.map((common, i) => [...common, totals[i] as number]),
    ),
  };
}

const SAME_TABLE =
  'As tabelas das curvas de 11°15′ e 22°30′ são impressas idênticas (mesmas cotas L e mesmos pesos); provável repetição no catálogo — confirmar com o fabricante.';

const bends: ProductFamily[] = [
  bendFamily(
    11.25,
    '11°15′',
    '20–21',
    [
      ['95763', 'CURVA LONGA 11º 15 PONTA-BOLSA PBA DN50', 532.6],
      ['95764', 'CURVA LONGA 11º 15 PONTA-BOLSA PBA DN75', 1045.0],
      ['95765', 'CURVA LONGA 11º 15 PONTA-BOLSA PBA DN100', 2230.0],
    ],
    [SAME_TABLE],
  ),
  bendFamily(
    22.5,
    '22°30′',
    '21',
    [
      ['22040', 'CURVA LONGA 22º 30 PONTA-BOLSA PBA DN50', 532.6],
      ['95758', 'CURVA LONGA 22º 30 PONTA-BOLSA PBA DN75', 1045.0],
      ['95757', 'CURVA LONGA 22º 30 PONTA-BOLSA PBA DN100', 2230.0],
    ],
    [SAME_TABLE],
  ),
  bendFamily(45, '45°', '21–22', [
    ['22041', 'CURVA LONGA 45º PONTA-BOLSA PBA DN 50', 588.0],
    ['95760', 'CURVA LONGA 45º PONTA-BOLSA PBA DN 75', 1035.0],
    ['95759', 'CURVA LONGA 45º PONTA-BOLSA PBA DN 100', 2600.0],
  ]),
  bendFamily(90, '90°', '22', [
    ['22042', 'CURVA LONGA 90º PONTA-BOLSA PBA DN 50', 710.0],
    ['95762', 'CURVA LONGA 90º PONTA-BOLSA PBA DN 75', 1700.0],
    ['95761', 'CURVA LONGA 90º PONTA-BOLSA PBA DN 100', 2345.0],
  ]),
];

// ---------------------------------------------------------------------------
// Tês e cruzetas (injetados, bolsas em todas as bocas)
// ---------------------------------------------------------------------------

const BRANCH_COLUMNS = [
  col('A1', 'Ø externo da bolsa da derivação'),
  col('B1', 'Ø interno da boca da bolsa da derivação'),
  col('C1', 'Profundidade da bolsa da derivação'),
];
const REDUCING_LABELS = [
  ['DN75xDN50', 75, 50],
  ['DN100xDN50', 100, 50],
  ['DN100xDN75', 100, 75],
] as const;

const tees: ProductFamily[] = [
  {
    id: 'wavin-pba-te',
    name: 'Tê PBA (bolsa–bolsa–bolsa)',
    category: 'Tês e cruzetas',
    shape: 'tee',
    manufacturer: MANUFACTURER,
    standard: STANDARD,
    source: source('24–25'),
    approximations: [WALL_NOTE, GROOVE_NOTE],
    remarks: [],
    network: {
      inserted: true,
      note: 'Inserido pela ferramenta Tê (família "Tê PBA junta elástica").',
    },
    columns: [
      ...SOCKET_COLUMNS,
      col('L1', 'Altura total, da geratriz inferior da passagem à boca da derivação'),
      col('L', 'Comprimento total da passagem, de boca a boca'),
    ],
    sizes: sizes(
      DN_LABELS,
      [
        ['22034', 'TE BOLSA-BOLSA-BOLSA PBA DN 50', 476.0],
        ['22035', 'TE BOLSA-BOLSA-BOLSA PBA DN 75', 1064.0],
        ['22036', 'TE BOLSA-BOLSA-BOLSA PBA DN 100', 1955.0],
      ],
      ['A', 'B', 'C', 'L1', 'L'],
      [
        [...injected(50), 140.5, 198.0],
        [...injected(75), 182.3, 248.0],
        [...injected(100), 216.5, 288.0],
      ],
    ),
  },
  {
    id: 'wavin-pba-te-reducao',
    name: 'Tê de redução PBA (bolsa–bolsa–bolsa)',
    category: 'Tês e cruzetas',
    shape: 'tee',
    manufacturer: MANUFACTURER,
    standard: STANDARD,
    source: source('25'),
    approximations: [WALL_NOTE, GROOVE_NOTE],
    remarks: [],
    network: {
      inserted: true,
      note: 'Inserido pela ferramenta Tê com derivação de diâmetro menor (família "Tê de redução PBA junta elástica").',
    },
    columns: [
      ...SOCKET_COLUMNS,
      ...BRANCH_COLUMNS,
      col('L1', 'Altura total, da geratriz inferior da passagem à boca da derivação'),
      col('L', 'Comprimento total da passagem, de boca a boca'),
    ],
    sizes: sizes(
      REDUCING_LABELS,
      [
        ['22037', 'TE DE REDUÇÃO BOLSA-BOLSA-BOLSA PBA DN 75 X 50', 911.5],
        ['22038', 'TE DE REDUÇÃO BOLSA-BOLSA-BOLSA PBA DN 100 X 50', 1624.0],
        ['22039', 'TE DE REDUÇÃO BOLSA-BOLSA-BOLSA PBA DN 100 X 75', 1758.0],
      ],
      ['A', 'B', 'C', 'A1', 'B1', 'C1', 'L1', 'L'],
      [
        [...injected(75), ...injected(50), 171.4, 248.0],
        [...injected(100), ...injected(50), 197.0, 288.0],
        [...injected(100), ...injected(75), 208.0, 288.0],
      ],
    ),
  },
  {
    id: 'wavin-pba-cruzeta',
    name: 'Cruzeta PBA',
    category: 'Tês e cruzetas',
    shape: 'cross',
    manufacturer: MANUFACTURER,
    standard: STANDARD,
    source: source('18'),
    approximations: [
      WALL_NOTE,
      GROOVE_NOTE,
      'A tabela traz uma única cota L: adotada para os dois eixos (peça simétrica no desenho).',
    ],
    remarks: [],
    network: { inserted: false, note: PLANNED },
    columns: [...SOCKET_COLUMNS, col('L', 'Comprimento total, de boca a boca')],
    sizes: sizes(
      DN_LABELS,
      [
        ['10873', 'CRUZETA PBA DN50', 590.0],
        ['10874', 'CRUZETA PBA DN75', 1315.0],
        ['10875', 'CRUZETA PBA DN100', 2358.0],
      ],
      ['A', 'B', 'C', 'L'],
      [
        [...injected(50), 198.0],
        [...injected(75), 248.0],
        [...injected(100), 288.0],
      ],
    ),
  },
  {
    id: 'wavin-pba-cruzeta-reducao',
    name: 'Cruzeta de redução PBA',
    category: 'Tês e cruzetas',
    shape: 'cross',
    manufacturer: MANUFACTURER,
    standard: STANDARD,
    source: source('20'),
    approximations: [WALL_NOTE, GROOVE_NOTE],
    remarks: [],
    network: { inserted: false, note: PLANNED },
    columns: [
      ...SOCKET_COLUMNS,
      ...BRANCH_COLUMNS,
      col('L1', 'Comprimento total das derivações, de boca a boca'),
      col('L', 'Comprimento total da passagem, de boca a boca'),
    ],
    sizes: sizes(
      [['DN75xDN50', 75, 50]],
      [['10876', 'CRUZETA RED PBA DN75XDN50', 1005.0]],
      ['A', 'B', 'C', 'A1', 'B1', 'C1', 'L1', 'L'],
      [[...injected(75), ...injected(50), 226.0, 248.0]],
    ),
  },
];

// ---------------------------------------------------------------------------
// Redução, luvas, cap e adaptador
// ---------------------------------------------------------------------------

const others: ProductFamily[] = [
  {
    id: 'wavin-pba-reducao',
    name: 'Redução PBA ponta e bolsa',
    category: 'Reduções',
    shape: 'reducer',
    manufacturer: MANUFACTURER,
    standard: STANDARD,
    source: source('24'),
    approximations: [
      WALL_NOTE,
      GROOVE_NOTE,
      'O ombro entre a ponta e a bolsa ocupa o trecho L − F − C, em cone reto.',
    ],
    remarks: [],
    network: {
      inserted: true,
      note: 'Inserida pela ferramenta Redução (família "Redução PBA ponta e bolsa"). Na rede, o comprimento da ponta (F) é proporcional ao comprimento da peça; neste modelo, é o da tabela.',
    },
    columns: [
      col('A', 'Ø externo da bolsa (lado menor)'),
      col('B', 'Ø interno da boca da bolsa'),
      col('C', 'Profundidade da bolsa'),
      col('D', 'Ø externo da ponta (lado maior)'),
      col('F', 'Comprimento da ponta'),
      col('L', 'Comprimento total'),
    ],
    sizes: sizes(
      REDUCING_LABELS,
      [
        ['22031', 'REDUCAO PONTA BOLSA PBA DN75 X DN50', 374.1],
        ['22032', 'REDUCAO PONTA BOLSA PBA DN100 X DN50', 620.5],
        ['22033', 'REDUCAO PONTA BOLSA PBA DN100 X DN75', 736.0],
      ],
      ['A', 'B', 'C', 'D', 'F', 'L'],
      [
        [...injected(50), 85.0, 81.0, 166.5],
        [...injected(50), 110.0, 93.0, 192.0],
        [...injected(75), 110.0, 93.0, 190.0],
      ],
    ),
  },
  {
    id: 'wavin-pba-luva-correr',
    name: 'Luva de correr PBA',
    category: 'Luvas e caps',
    shape: 'slipCoupling',
    manufacturer: MANUFACTURER,
    standard: STANDARD,
    source: source('23'),
    approximations: [
      WALL_NOTE,
      GROOVE_NOTE,
      'A tabela não informa a profundidade da bolsa: os alojamentos dos anéis foram posicionados como nas demais conexões injetadas de mesmo DN (cota C do tê). O furo é passante, sem batente.',
    ],
    remarks: [],
    network: { inserted: false, note: PLANNED },
    columns: [
      SOCKET_COLUMNS[0] as ProductColumn,
      SOCKET_COLUMNS[1] as ProductColumn,
      col('L', 'Comprimento total'),
    ],
    sizes: sizes(
      DN_LABELS,
      [
        ['22015', 'LUVA DE CORRER PBA DN 50', 236.9],
        ['22016', 'LUVA DE CORRER PBA DN 75', 584.5],
        ['22017', 'LUVA DE CORRER PBA DN 100', 1032.0],
      ],
      ['A', 'B', 'L'],
      [
        [82.9, 60.5, 142],
        [116.7, 85.5, 174],
        [144.9, 110.5, 188],
      ],
    ),
  },
  {
    id: 'wavin-pba-luva-simples',
    name: 'Luva simples PBA (bolsa soldável × bolsa PBA)',
    category: 'Luvas e caps',
    shape: 'transitionCoupling',
    manufacturer: MANUFACTURER,
    standard: STANDARD,
    source: source('23–24'),
    approximations: [
      WALL_NOTE,
      GROOVE_NOTE,
      'Batente interno entre as duas bolsas no trecho L − F − C; a cintura externa sobre ele é representação.',
    ],
    remarks: ['A cota A do DN100 é impressa 145,0 (144,9 nas demais conexões injetadas).'],
    network: { inserted: false, note: PLANNED },
    columns: [
      ...SOCKET_COLUMNS,
      col('D', 'Ø interno da bolsa lisa (soldável)'),
      col('F', 'Profundidade da bolsa lisa'),
      col('L', 'Comprimento total'),
    ],
    sizes: sizes(
      DN_LABELS,
      [
        ['22018', 'LUVA SIMPLES PBA DN 50', 240.0],
        ['22029', 'LUVA SIMPLES PBA DN 75', 550.0],
        ['22030', 'LUVA SIMPLES PBA DN 100', 1000.0],
      ],
      ['A', 'B', 'C', 'D', 'F', 'L'],
      [
        [82.9, 60.5, 60.5, 60.0, 63.5, 147.6],
        [116.7, 85.5, 71.0, 85.0, 72.9, 174.3],
        [145.0, 110.5, 76.0, 110.0, 91.0, 188.0],
      ],
    ),
  },
  {
    id: 'wavin-pba-cap',
    name: 'Cap PBA',
    category: 'Luvas e caps',
    shape: 'cap',
    manufacturer: MANUFACTURER,
    standard: STANDARD,
    source: source('17–18'),
    approximations: [
      WALL_NOTE,
      GROOVE_NOTE,
      'Fundo levemente abaulado, com cantos arredondados (forma do desenho; raios não tabulados).',
    ],
    remarks: [],
    network: { inserted: false, note: PLANNED },
    columns: [...SOCKET_COLUMNS, col('L', 'Comprimento total')],
    sizes: sizes(
      DN_LABELS,
      [
        ['22012', 'CAP PBA DN50', 166.0],
        ['22013', 'CAP PBA DN75', 355.0],
        ['22014', 'CAP PBA DN100', 645.0],
      ],
      ['A', 'B', 'C', 'L'],
      [
        [...injected(50), 77.4],
        [...injected(75), 95.6],
        [...injected(100), 109.1],
      ],
    ),
  },
  {
    id: 'wavin-pba-adaptador-defofo',
    name: 'Adaptador DEFoFo × PBA (ponta DEFoFo, bolsa PBA)',
    category: 'Adaptadores',
    shape: 'adapter',
    manufacturer: MANUFACTURER,
    standard: STANDARD,
    source: source('17'),
    approximations: [
      'Espessura de parede não tabulada: adotada a do tubo PBA classe 20 de mesmo DN (peça conformada a partir de tubo).',
      'O trecho L − C − F entre a bolsa e a ponta é dividido em pescoço (Ø do tubo PBA) e alargamento até o Ø da ponta DEFoFo; a divisão é representação.',
      GROOVE_NOTE,
    ],
    remarks: ['O produto 95754 é descrito como "DN 110" no catálogo; a tabela o lista como DN100.'],
    network: { inserted: false, note: PLANNED },
    columns: [
      ...SOCKET_COLUMNS,
      col('D', 'Ø externo da ponta DEFoFo'),
      col('F', 'Comprimento da ponta'),
      col('L', 'Comprimento total'),
    ],
    sizes: sizes(
      [
        ['DN50xDN50', 50],
        ['DN75xDN75', 75],
        ['DN100xDN100', 100],
      ],
      [
        ['95755', 'ADAPTADOR PONTA-BOLSA DEFOFO INFRA X PBA DN 50', 270.0],
        ['95756', 'ADAPTADOR PONTA-BOLSA DEFOFO INFRA X PBA DN 75', 590.0],
        ['95754', 'ADAPTADOR PONTA-BOLSA DEFOFO INFRA X PBA DN 110', 1310.0],
      ],
      ['A', 'B', 'C', 'D', 'F', 'L'],
      [
        [83.0, 60.5, 70.0, 66.0, 102.5, 206.4],
        [115.7, 85.5, 80.0, 92.0, 103.5, 226.8],
        [145.4, 110.5, 100.0, 118.0, 175.0, 328.3],
      ],
    ),
  },
];

// ---------------------------------------------------------------------------
// Colar de tomada
// ---------------------------------------------------------------------------

const SADDLE_ROWS: readonly (readonly [
  label: string,
  dn: number,
  thread: '1/2' | '3/4',
  code: string,
  weightG: number,
  l1: number,
  l: number,
  d: number,
])[] = [
  ['25 x ½', 25, '1/2', '10902', 61.7, 37.2, 17.8, 30.0],
  ['25 x ¾', 25, '3/4', '10903', 66.2, 37.9, 18.5, 35.5],
  ['32 x ½', 32, '1/2', '10904', 83, 41.2, 18.5, 30.0],
  ['32 x ¾', 32, '3/4', '10905', 87.4, 41.9, 18.5, 36.5],
  ['40 x ½', 40, '1/2', '10906', 94.5, 46.2, 17.8, 30.0],
  ['40 x ¾', 40, '3/4', '10907', 88.8, 46.9, 18.5, 36.5],
  ['DN50 x ½', 50, '1/2', '10908', 108.1, 87.1, 90.7, 60.0],
  ['DN50 x ¾', 50, '3/4', '10909', 113.0, 87.7, 90.7, 60.0],
  ['DN75 x ½', 75, '1/2', '10910', 192.3, 116.0, 120.9, 85.0],
  ['DN75 x ¾', 75, '3/4', '10911', 168.6, 116.7, 120.9, 85.0],
  ['DN100 x ½', 100, '1/2', '10912', 242.8, 141.8, 147.8, 110.0],
  ['DN100 x ¾', 100, '3/4', '10913', 246.5, 142.1, 147.8, 110.0],
];

const saddles: ProductFamily[] = [
  {
    id: 'wavin-pba-colar-tomada',
    name: 'Colar de tomada PBA',
    category: 'Colares de tomada',
    shape: 'saddle',
    manufacturer: MANUFACTURER,
    standard: STANDARD,
    source: source('18–19'),
    approximations: [
      'DN50 a DN100: L1 (altura total), L (largura total) e D (Ø do tubo) são da tabela. O Ø do ressalto e o comprimento da saída roscada vêm das linhas 25–40 da mesma tabela, por rosca (30,0 × 17,8 mm para ½"; 36,5 × 18,5 mm para ¾").',
      'Espessura da abraçadeira derivada: (L1 − D − comprimento da rosca) / 2.',
      'Rosca representada lisa, com o Ø nominal G ½ / G ¾ (ISO 228-1) — o catálogo não identifica o padrão da rosca. O furo de tomada no tubo é limitado a 75 % do raio do tubo.',
      'Comprimento da abraçadeira ao longo do tubo, abas de fechamento e demais detalhes são representação (não tabulados).',
    ],
    remarks: [
      'Linhas 25, 32 e 40 (diâmetros fora da linha PBA): as colunas L e D não correspondem às cotas do desenho (acompanham a rosca, não o tubo). Estão transcritas como impressas e ficam sem modelo 3D.',
      'Linha "40 x ¾": a coluna R é impressa "1/2"; o produto 10907 é descrito como DN40X3/4.',
    ],
    network: { inserted: false, note: PLANNED },
    columns: [
      col('L1', 'Altura total, da base da abraçadeira ao topo da saída'),
      col('L', 'Largura total entre as abas (DN50 a DN100)'),
      col('D', 'Ø do tubo (DN50 a DN100)'),
    ],
    sizes: SADDLE_ROWS.map(([label, dn, thread, code, weightG, l1, l, d]) => ({
      label,
      dn,
      code,
      description: `COLAR TOMADA PBA DN${dn}X${thread}`,
      weightG,
      thread,
      dims: { L1: l1, L: l, D: d },
    })),
  },
];

// ---------------------------------------------------------------------------
// Anéis de vedação
// ---------------------------------------------------------------------------

const seals: ProductFamily[] = [
  {
    id: 'wavin-pba-anel-jeri',
    name: 'Anel de vedação JERI EPDM',
    category: 'Anéis de vedação',
    shape: 'jeriSeal',
    manufacturer: MANUFACTURER,
    standard: 'ABNT NBR 7676',
    source: source('15–16'),
    approximations: [
      'Seção bilabial: D, C, A e B são da tabela (o lábio de vedação tem Ø interno D − 2·B, que coincide com o Ø externo do tubo). O recorte entre os lábios e os chanfros são representação.',
    ],
    remarks: [],
    network: {
      inserted: false,
      note: 'Acessório: acompanha os tubos PBA (montado na bolsa). Não é elemento da rede.',
    },
    columns: [
      col('A', 'Altura do anel (no sentido do eixo do tubo)'),
      col('B', 'Espessura radial máxima'),
      col('C', 'Ø interno do lado frontal'),
      col('D', 'Ø externo'),
    ],
    sizes: sizes(
      DN_LABELS,
      [
        ['92810', 'ANEL JERI PBA EPDM DN50 DUR50', 28.3],
        ['92811', 'ANEL JERI PBA EPDM DN75 DUR50', 50.0],
        ['92812', 'ANEL JERI PBA EPDM DN100 DUR50', 90.0],
      ],
      ['A', 'B', 'C', 'D'],
      [
        [18.6, 10.9, 67.3, 81.7],
        [21.7, 12.6, 93.4, 109.6],
        [24.2, 14.0, 119.7, 138.4],
      ],
    ),
  },
  {
    id: 'wavin-pba-anel-oring',
    name: "Anel de vedação O'Ring EPDM",
    category: 'Anéis de vedação',
    shape: 'oRing',
    manufacturer: MANUFACTURER,
    standard: 'ABNT NBR 7676',
    source: source('16'),
    approximations: [],
    remarks: [],
    network: {
      inserted: false,
      note: 'Acessório: vendido separadamente para as conexões PBA. Não é elemento da rede.',
    },
    columns: [col('A', 'Ø externo'), col('E', 'Ø da seção (cordão)')],
    sizes: sizes(
      DN_LABELS,
      [
        ['98803', 'ANEL DE VEDAÇÃO O´RING DN 50', 16.0],
        ['98804', 'ANEL DE VEDAÇÃO O´RING DN 75', 37.0],
        ['98805', 'ANEL DE VEDAÇÃO O´RING DN 100', 47.0],
      ],
      ['A', 'E'],
      [
        [79.0, 9.2],
        [107.0, 11.6],
        [133.5, 12.1],
      ],
    ),
  },
];

/** Dimensões do anel JERI por DN (mm), para o anel montado na bolsa dos tubos. */
export const PBA_JERI_MM: Readonly<
  Record<number, Readonly<Record<'A' | 'B' | 'C' | 'D', number>>>
> = {
  50: { A: 18.6, B: 10.9, C: 67.3, D: 81.7 },
  75: { A: 21.7, B: 12.6, C: 93.4, D: 109.6 },
  100: { A: 24.2, B: 14.0, C: 119.7, D: 138.4 },
};

export const WAVIN_PBA_PRODUCTS: readonly ProductFamily[] = [
  ...pipes,
  ...bends,
  ...tees,
  ...others,
  ...saddles,
  ...seals,
];
