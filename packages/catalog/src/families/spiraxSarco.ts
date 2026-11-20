import type { FittingFamily } from '@hydrobim/core';
import { family, type EndMm } from './builders';

/**
 * Filtro Y Spirax Sarco modelo CI — ferro fundido cinzento (ASTM A126 Cl. B), flangeado
 * ASME B16.1 classe 125, de 2" a 16".
 *
 * Fonte: Spirax Sarco — folha técnica TI-D245-01, BR Rev. 00 (© 2008), "CI — Filtro Y —
 * Ferro Fundido Cinzento", tabela "Dimensões/pesos (aproximados)" e desenho da p. 2 (PDF
 * fornecido pelo responsável pelo projeto).
 *
 * Cotas da tabela (mm), conforme o desenho:
 *  - A: face a face dos flanges;
 *  - B: do eixo da tubulação ao ponto mais baixo do bojo (tampa);
 *  - C: distância para manutenção (folga para retirar a tela) — NÃO é cota da peça e não é
 *    usada na geometria.
 * Os pesos da tabela não são registrados (o modelo não tem campo de massa).
 *
 * Flanges: a folha informa "Flangeado ASME B16.1 125#" e não tabula o flange. Diâmetro
 * externo, espessura e furação são os da ASME B16.1-1998 classe 125, conforme a tabela de
 * amesweb.info (fonte secundária que reproduz a norma; a norma em si não foi consultada):
 * https://amesweb.info/Piping/Class-125-Cast-Iron-Flanges-Dimensions-Chart.aspx
 * Valores em polegadas convertidos para milímetros (× 25,4; espessura com uma casa).
 *
 * Especificação de tubo: ferro fundido dúctil (decisão do responsável pelo projeto — a peça
 * é de ferro fundido e fica no grupo do ferro fundido do catálogo). ATENÇÃO: o flange da
 * peça continua sendo o ASME B16.1 classe 125 do fabricante, cuja furação NÃO coincide com
 * a dos flanges PN 10/16 das demais peças de ferro dúctil (ex.: DN 100 — círculo de 190,5 mm
 * contra 180 mm). A união com flange PN exige contraflange ASME ou peça de transição; o
 * flange não foi trocado pelo PN para não descaracterizar o produto.
 *
 * DN: correspondência convencional entre NPS e DN (2" = DN 50 … 16" = DN 400). Os
 * tamanhos de 2" e 2½" são transcritos, mas a especificação de tubo embutida começa em DN 80.
 */

const DUCTILE = 'ferro-ductil-nbr7675-k9';

// [DN, A (face a face), B (eixo ao ponto mais baixo)] — NPS 2", 2½", 3", 4", 6" … 16".
const CI = [
  [50, 230, 159],
  [65, 290, 234],
  [80, 310, 230],
  [100, 370, 265],
  [150, 480, 383],
  [200, 600, 482],
  [250, 762, 488],
  [300, 858, 610],
  [350, 980, 723],
  [400, 1080, 746],
] as const;

// ASME B16.1 classe 125 — [espessura, Ø externo, círculo de furação, nº de furos, Ø do furo].
// Em polegadas na fonte: O / Q / círculo / furos / furo.
export const B16_1_CLASS_125_MM: Record<number, EndMm> = {
  50: [15.7, 152.4, 120.65, 4, 19.05], // 6.00 / 0.62 / 4.75 / 4 / 0.75
  65: [17.5, 177.8, 139.7, 4, 19.05], // 7.00 / 0.69 / 5.50 / 4 / 0.75
  80: [19.1, 190.5, 152.4, 4, 19.05], // 7.50 / 0.75 / 6.00 / 4 / 0.75
  100: [23.9, 228.6, 190.5, 8, 19.05], // 9.00 / 0.94 / 7.50 / 8 / 0.75
  150: [25.4, 279.4, 241.3, 8, 22.35], // 11.00 / 1.00 / 9.50 / 8 / 0.88
  200: [28.4, 342.9, 298.45, 8, 22.35], // 13.50 / 1.12 / 11.75 / 8 / 0.88
  250: [30.2, 406.4, 361.95, 12, 25.4], // 16.00 / 1.19 / 14.25 / 12 / 1.00
  300: [31.8, 482.6, 431.8, 12, 25.4], // 19.00 / 1.25 / 17.00 / 12 / 1.00
  350: [35.1, 533.4, 476.25, 12, 28.45], // 21.00 / 1.38 / 18.75 / 12 / 1.12
  400: [36.6, 596.9, 539.75, 16, 28.45], // 23.50 / 1.44 / 21.25 / 16 / 1.12
};

export const SPIRAX_SARCO_FAMILIES: FittingFamily[] = [
  family({
    id: 'spirax-sarco-ci-125',
    name: 'Filtro Y Spirax Sarco CI — ferro fundido cinzento, flange ASME 125',
    kind: 'valve',
    valveType: 'strainer',
    specificationId: DUCTILE,
    endType: 'flange',
    manufacturer: 'Spirax Sarco',
    standard: 'Flanges ASME B16.1 classe 125 · corpo ASTM A126 Cl. B',
    source:
      'Spirax Sarco — TI-D245-01 BR Rev. 00 (2008), p. 2 — A (face a face) e B (do eixo ao ponto mais baixo do bojo); C (distância para manutenção) é folga, não cota da peça. Flange (Ø externo, espessura e furação): ASME B16.1-1998 classe 125, conforme amesweb.info/Piping/Class-125-Cast-Iron-Flanges-Dimensions-Chart.aspx (fonte secundária), convertido de polegadas. Furação diferente da dos flanges PN 10/16 do ferro dúctil: a união exige contraflange ASME. 2" e 2½" sem tubo correspondente na especificação.',
    sizes: CI.map(([dn, a, b]) => {
      const flange = B16_1_CLASS_125_MM[dn];
      return { dn, length: a, height: b, ...(flange ? { end: flange } : {}) };
    }),
  }),
];
