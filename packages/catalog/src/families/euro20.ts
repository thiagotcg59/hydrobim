import type { FittingFamily } from '@hydrobim/core';
import { flangeEndMm, flangeSourceNote, type FlangePressureClass } from '../flanges';
import { family, forSpecifications, type EndMm, type SizeMm } from './builders';
import { DUCTILE_SPECIFICATIONS } from './ductileIron';
import { B16_1_CLASS_125_MM } from './spiraxSarco';

/**
 * Válvulas de gaveta com cunha de borracha, linha EURO 20 (EURO 21 a 25), versão "com
 * cabeçote" (haste nua com quadrado de manobra, sem volante).
 *
 * FONTE: "Catálogo Geral" (arquivo CATÁLOGO GERAL - VALVULA GAVETAS.pdf, fornecido pelo
 * responsável do projeto), capítulo 6, "Válvulas de gaveta com cunha emborrachada",
 * p. 344–348. É o mesmo catálogo da tabela única de flanges (`flanges.ts`); as páginas
 * recebidas não trazem o nome do fabricante nem a edição — ficam como não identificados.
 *
 * Cotas (mm), com as letras dos desenhos:
 *  - L: face a face (EURO 21: ISO 5752 série 15; EURO 23: série 14; EURO 22: ASME B16.1/B16.5);
 *  - H1: do eixo do tubo ao topo da haste;
 *  - H: altura total, da parte mais baixa ao topo do cabeçote (tracejado no desenho) — NÃO
 *    usada: o cabeçote é acessório e a peça de referência é a de haste nua;
 *  - D e a: diâmetro externo e espessura do flange;
 *  - K × K1: dimensões do castelo — K ao longo do eixo do tubo, K1 transversal;
 *  - bolsas (EURO 25): Lu = comprimento útil (entre os fundos das bolsas), P = profundidade e
 *    D1 = diâmetro externo da bolsa. Lt = Lu + 2·P confere em DN 80, 100, 150 e 250; em
 *    DN 200 e 300 o Lt impresso (387 e 458) excede Lu + 2·P em 17 e 23 mm — vale o Lu
 *    impresso, e a divergência fica registrada (não se corrige a tabela por conta própria).
 * "Nº de voltas para fechar" e massas não são registrados (o modelo não tem esses campos).
 *
 * LEITURAS E DERIVAÇÕES (declaradas):
 *  - Flanges PN (regra 14 do AGENTS.md): o flange inteiro — D, a, furação e ressalto — vem
 *    da tabela única de flanges, na classe da família; as colunas D e a da página da válvula
 *    ficam transcritas abaixo só para conferência. Coincidem com a tabela em todas as linhas,
 *    exceto no DN 100 PN 10/16, em que a página da válvula imprime D = 225 e a tabela de
 *    flanges, 220 (vale a tabela), e nos DN 350 e 400 do EURO 23, cujos D e a impressos são
 *    os do PN 16.
 *  - As linhas "PN 10/16" valem para as duas classes. Até DN 150 a furação é a mesma; de
 *    DN 200 em diante há uma família PN 10 e outra PN 16, como na tabela de abreviaturas.
 *  - EURO 22 (ANSI): D e a da tabela da válvula; furação da ASME B16.1 classe 125 (a mesma
 *    da B16.5 classe 150), pela fonte secundária já usada no filtro Y.
 *  - EURO 24 (bolsas PBA): a tabela dá L (total) e L1 (entre os fundos das bolsas), mas não a
 *    bolsa. Profundidade derivada = (L − L1)/2; diâmetro externo adotado = 2·h, em que h é
 *    a distância do eixo à parte mais baixa (no desenho, a geratriz inferior da bolsa).
 *  - EURO 25, DN 100: K × K1 impresso "11 x 194" — erro de impressão evidente; adotado
 *    111 × 194, como no DN 100 das demais tabelas da linha.
 *  - EURO 23, DN 350: passagem do fluido igual à do DN 300 (nota da página).
 */

const CATALOG =
  'Catálogo Geral (CATÁLOGO GERAL - VALVULA GAVETAS.pdf, fornecido pelo responsável do projeto), cap. 6';
const COLUMNS =
  'L (face a face), H1 (eixo ao topo da haste), K × K1 (castelo: K ao longo do eixo, K1 transversal). Versão com cabeçote (haste nua); H total, voltas e massas não registrados.';

const STEEL = 'aco-carbono-b3610-sch40';
const PBA = ['pvc-pba-nbr5647-cl12', 'pvc-pba-nbr5647-cl15', 'pvc-pba-nbr5647-cl20'] as const;

/** [DN, L, H1, D, K, K1, a] */
type FlangedRow = readonly [
  dn: number,
  l: number,
  h1: number,
  d: number,
  k: number,
  k1: number,
  a: number,
];

// EURO 21 — corpo longo, p. 344 (linhas PN 10/16 e 10/16/25).
const EURO_21: readonly FlangedRow[] = [
  [50, 250, 222, 165, 95, 144, 19],
  [80, 280, 275, 200, 105, 174, 19],
  [100, 300, 323, 225, 111, 194, 19],
  [150, 350, 410, 285, 136, 257, 19],
  [200, 400, 515, 340, 266, 382, 20],
  [250, 450, 595, 400, 285, 470, 22],
  [300, 500, 705, 455, 305, 538, 24.5],
];
// EURO 21 — linhas PN 25 (DN 50 e 80 são as linhas "10/16/25").
const EURO_21_PN25: readonly FlangedRow[] = [
  [50, 250, 222, 165, 95, 144, 19],
  [80, 280, 275, 200, 105, 174, 19],
  [100, 300, 323, 235, 111, 194, 19],
  [150, 350, 410, 300, 136, 257, 20],
];
// EURO 22 — ANSI, p. 345.
const EURO_22: readonly FlangedRow[] = [
  [80, 203, 275, 190, 105, 174, 19],
  [100, 229, 323, 228, 111, 194, 24],
  [150, 267, 410, 280, 136, 257, 25],
  [200, 292, 515, 343, 266, 382, 20],
  [250, 330, 595, 406, 285, 470, 22],
  [300, 356, 705, 486, 305, 538, 24.5],
];
// EURO 23 — corpo curto, p. 346.
const EURO_23: readonly FlangedRow[] = [
  [50, 150, 222, 165, 95, 144, 19],
  [80, 180, 275, 200, 105, 174, 19],
  [100, 190, 323, 225, 111, 194, 19],
  [150, 210, 410, 285, 136, 257, 19],
  [200, 230, 515, 340, 266, 382, 20],
  [250, 250, 595, 400, 285, 470, 22],
  [300, 270, 705, 455, 305, 538, 24.5],
  [350, 290, 705, 520, 305, 538, 26.5],
  [400, 310, 914, 580, 348, 686, 28],
];

// EURO 24 — bolsas para PVC PBA, p. 347: [DN, L, L1, H1, h, K, K1].
const EURO_24 = [
  [50, 250, 90, 222, 50, 90, 144],
  [75, 260, 122, 275, 65, 105, 174],
  [100, 300, 128, 323, 76, 111, 194],
] as const;

// EURO 25 — bolsas para ferro dúctil e PVC DEFoFo, p. 348: [DN, Lu, P, D1, H1, K, K1].
const EURO_25 = [
  [80, 128, 85, 141, 289, 105, 174],
  [100, 141, 88, 161, 336, 111, 194], // K impresso "11": adotado 111 (ver cabeçalho).
  [150, 163, 94, 212, 421, 136, 257],
  [200, 170, 100, 294, 510, 182, 352],
  [250, 218, 105, 351, 618, 195, 430],
  [300, 215, 110, 371.7, 696, 214, 488],
] as const;

/** Flange com D e a informados e a furação (e ressalto, se houver) de `drilling`. */
function flange(d: number, a: number, drilling: EndMm | undefined): EndMm {
  const [, , circle, count, hole, raisedD, raisedH] = drilling ?? [];
  if (circle === undefined || count === undefined || hole === undefined) return [a, d];
  return raisedD !== undefined && raisedH !== undefined
    ? [a, d, circle, count, hole, raisedD, raisedH]
    : [a, d, circle, count, hole];
}

function flanged(
  rows: readonly FlangedRow[],
  end: (row: FlangedRow) => EndMm | undefined,
): SizeMm[] {
  return rows.map((row) => {
    const [dn, l, h1, , k, k1] = row;
    const flangeEnd = end(row);
    return {
      dn,
      length: l,
      height: h1,
      width: k1,
      bonnetLength: k,
      ...(flangeEnd ? { end: flangeEnd } : {}),
    };
  });
}

/** Flange PN da tabela única, na classe da família. */
const pn =
  (pressureClass: FlangePressureClass) =>
  ([dn]: FlangedRow): EndMm | undefined =>
    flangeEndMm(pressureClass, dn);

/** EURO 22: D e a da página da válvula; furação ASME classe 125 da fonte citada. */
const ansi = ([dn, , , d, , , a]: FlangedRow): EndMm => flange(d, a, B16_1_CLASS_125_MM[dn]);

const common = {
  kind: 'valve',
  valveType: 'gate',
  manufacturer: null,
} as const;

const fromDn = (rows: readonly FlangedRow[], min: number, max = Infinity): FlangedRow[] =>
  rows.filter(([dn]) => dn >= min && dn <= max);

export const EURO_20_FAMILIES: FittingFamily[] = [
  ...forSpecifications(DUCTILE_SPECIFICATIONS, {
    ...common,
    id: 'euro21-gaveta-longa-pn16',
    name: 'Válvula de gaveta EURO 21 — flanges, corpo longo, PN 10/16 (PN 16 a partir de DN 200)',
    endType: 'flange',
    standard: 'Face a face ISO 5752 série 15 · flanges PN 10/16',
    source: `${CATALOG}, p. 344 — ${COLUMNS} ${flangeSourceNote('PN 16')}`,
    sizes: flanged(EURO_21, pn('PN 16')),
  }),
  ...forSpecifications(DUCTILE_SPECIFICATIONS, {
    ...common,
    id: 'euro21-gaveta-longa-pn10',
    name: 'Válvula de gaveta EURO 21 — flanges, corpo longo, PN 10 (DN 200 a 300)',
    endType: 'flange',
    standard: 'Face a face ISO 5752 série 15 · flanges PN 10',
    source: `${CATALOG}, p. 344 — ${COLUMNS} ${flangeSourceNote('PN 10')}`,
    sizes: flanged(fromDn(EURO_21, 200), pn('PN 10')),
  }),
  ...forSpecifications(DUCTILE_SPECIFICATIONS, {
    ...common,
    id: 'euro21-gaveta-longa-pn25',
    name: 'Válvula de gaveta EURO 21 — flanges, corpo longo, PN 25 (DN 50 a 150)',
    endType: 'flange',
    standard: 'Face a face ISO 5752 série 15 · flanges PN 25',
    source: `${CATALOG}, p. 344 (linhas PN 25) — ${COLUMNS} ${flangeSourceNote('PN 25')}`,
    sizes: flanged(EURO_21_PN25, pn('PN 25')),
  }),
  family({
    ...common,
    id: 'euro22-gaveta-ansi',
    name: 'Válvula de gaveta EURO 22 — flanges ANSI classe 125/150',
    specificationId: STEEL,
    endType: 'flange',
    standard: 'Face a face ASME B16.1 classe 125 / B16.5 classe 150',
    source: `${CATALOG}, p. 345 — ${COLUMNS} Flange: D e a da mesma tabela; furação ASME B16.1-1998 classe 125 (igual à B16.5 classe 150), conforme amesweb.info/Piping/Class-125-Cast-Iron-Flanges-Dimensions-Chart.aspx (fonte secundária).`,
    sizes: flanged(EURO_22, ansi),
  }),
  ...forSpecifications(DUCTILE_SPECIFICATIONS, {
    ...common,
    id: 'euro23-gaveta-curta-pn16',
    name: 'Válvula de gaveta EURO 23 — flanges, corpo curto, PN 10/16 (PN 16 a partir de DN 200)',
    endType: 'flange',
    standard: 'Face a face ISO 5752 série 14 · flanges PN 10/16',
    source: `${CATALOG}, p. 346 — ${COLUMNS} DN 350 com passagem de DN 300. ${flangeSourceNote('PN 16')}`,
    sizes: flanged(EURO_23, pn('PN 16')),
  }),
  ...forSpecifications(DUCTILE_SPECIFICATIONS, {
    ...common,
    id: 'euro23-gaveta-curta-pn10',
    name: 'Válvula de gaveta EURO 23 — flanges, corpo curto, PN 10 (DN 200 a 350)',
    endType: 'flange',
    standard: 'Face a face ISO 5752 série 14 · flanges PN 10',
    source: `${CATALOG}, p. 346 — ${COLUMNS} DN 350 com passagem de DN 300. ${flangeSourceNote('PN 10')}`,
    sizes: flanged(fromDn(EURO_23, 200, 350), pn('PN 10')),
  }),
  ...forSpecifications(PBA, {
    ...common,
    id: 'euro24-gaveta-bolsas-pba',
    name: 'Válvula de gaveta EURO 24 — bolsas para PVC PBA',
    endType: 'socket',
    standard: 'Bolsas para tubos de PVC PBA (DE 60, 85 e 110)',
    source: `${CATALOG}, p. 347 — L1 (entre os fundos das bolsas), H1 (eixo ao topo da haste), K × K1 (castelo). Bolsa não tabulada: profundidade derivada (L − L1)/2 e diâmetro externo adotado 2·h (h = eixo à parte mais baixa).`,
    sizes: EURO_24.map(([dn, l, l1, h1, h, k, k1]) => ({
      dn,
      length: l1,
      height: h1,
      width: k1,
      bonnetLength: k,
      end: [(l - l1) / 2, 2 * h] as const,
    })),
  }),
  ...forSpecifications(DUCTILE_SPECIFICATIONS, {
    ...common,
    id: 'euro25-gaveta-bolsas-fd',
    name: 'Válvula de gaveta EURO 25 — bolsas para ferro dúctil e PVC DEFoFo',
    endType: 'socket',
    standard: 'Bolsas para tubos de ferro dúctil e PVC DEFoFo',
    source: `${CATALOG}, p. 348 — Lu (comprimento útil, entre os fundos das bolsas), P e D1 (profundidade e Ø externo da bolsa), H1 (eixo ao topo da haste), K × K1 (castelo). DN 100: K impresso "11", adotado 111. DN 200 e 300: o Lt impresso excede Lu + 2·P em 17 e 23 mm; usado o Lu impresso.`,
    sizes: EURO_25.map(([dn, lu, p, d1, h1, k, k1]) => ({
      dn,
      length: lu,
      height: h1,
      width: k1,
      bonnetLength: k,
      end: [p, d1] as const,
    })),
  }),
];
