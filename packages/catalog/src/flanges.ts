import { mmToM, type EndTreatment, type PipeSpec } from '@hydrobim/core';
import type { EndMm } from './families/builders';

/**
 * Flanges — tabela ÚNICA usada por todas as famílias flangeadas do catálogo (conexões,
 * válvulas e tubos com flanges). Uma família nova que tenha flange PN deve buscar aqui as
 * dimensões (`flangeEndMm`), em vez de transcrever o flange de outra fonte.
 *
 * FONTE: "Catálogo Geral" (arquivo CATÁLOGO GERAL.pdf, fornecido pelo responsável do
 * projeto), capítulo 4, linha Água e Esgoto, p. 246–249 — "Junta com Flange – PN 10",
 * "– PN 16", "– PN 25" e "– PN 40". As páginas recebidas não trazem o nome do fabricante,
 * a edição nem a norma do flange: esses campos ficam declarados como não identificados.
 *
 * Cotas (mm), com as letras do desenho da página:
 *  - D: diâmetro externo do flange;
 *  - C: diâmetro do círculo de furação;
 *  - d: diâmetro dos furos;
 *  - parafusos: quantidade e dimensão nominal (rosca métrica);
 *  - a: espessura do flange;
 *  - g: diâmetro do ressalto; c: altura do ressalto.
 *
 * LEITURA ADOTADA (hipótese declarada): no corte do desenho, as cotas `c` e `a` partem da
 * mesma face (a de vedação), de modo que a espessura `a` INCLUI o ressalto `c`. A porta fica
 * na face do ressalto.
 *
 * O catálogo não tabula o cubo do flange nem o furo: são representação na geometria.
 * DN 1400 a 2000 (PN 10, 16 e 25): "Consultar" — sem dados, não cadastrados.
 */

export const FLANGE_PRESSURE_CLASSES = ['PN 10', 'PN 16', 'PN 25', 'PN 40'] as const;
export type FlangePressureClass = (typeof FLANGE_PRESSURE_CLASSES)[number];

export interface FlangeSize {
  readonly dn: number;
  /** Diâmetro externo. */
  readonly D: number;
  /** Círculo de furação. */
  readonly C: number;
  /** Diâmetro dos furos. */
  readonly d: number;
  readonly boltCount: number;
  /** Dimensão nominal dos parafusos, como impressa (ex.: `M16`). */
  readonly bolt: string;
  /** Espessura (inclui o ressalto — leitura adotada). */
  readonly a: number;
  /** Diâmetro do ressalto. */
  readonly g: number;
  /** Altura do ressalto. */
  readonly c: number;
}

export interface FlangeFamily {
  readonly id: string;
  readonly name: string;
  readonly pressureClass: FlangePressureClass;
  /** `null`: não consta das páginas recebidas. */
  readonly manufacturer: string | null;
  readonly standard: string;
  readonly source: string;
  /** O que NÃO vem da tabela (representação) e as leituras adotadas. */
  readonly approximations: readonly string[];
  readonly remarks: readonly string[];
  readonly sizes: readonly FlangeSize[];
}

type Row = readonly [
  dn: number,
  D: number,
  C: number,
  d: number,
  boltCount: number,
  bolt: number,
  a: number,
  g: number,
  c: number,
];

const sizes = (rows: readonly Row[]): FlangeSize[] =>
  rows.map(([dn, D, C, d, boltCount, bolt, a, g, c]) => ({
    dn,
    D,
    C,
    d,
    boltCount,
    bolt: `M${bolt}`,
    a,
    g,
    c,
  }));

// [DN, D, C, d, nº de parafusos, rosca M, a, g, c] — p. 246
const PN10: readonly Row[] = [
  [50, 165, 125, 19, 4, 16, 19, 99, 3],
  [80, 200, 160, 19, 8, 16, 19, 132, 3],
  [100, 220, 180, 19, 8, 16, 19, 156, 3],
  [150, 285, 240, 23, 8, 20, 19, 211, 3],
  [200, 340, 295, 23, 8, 20, 20, 266, 3],
  [250, 400, 350, 23, 12, 20, 22, 319, 3],
  [300, 455, 400, 23, 12, 20, 24.5, 370, 4],
  [350, 505, 460, 23, 16, 20, 24.5, 429, 4],
  [400, 565, 515, 28, 16, 24, 24.5, 480, 4],
  [450, 615, 565, 28, 20, 24, 25.5, 530, 4],
  [500, 670, 620, 28, 20, 24, 26.5, 582, 4],
  [600, 780, 725, 31, 20, 27, 30, 682, 5],
  [700, 895, 840, 31, 24, 27, 32.5, 794, 5],
  [800, 1015, 950, 34, 24, 30, 35, 901, 5],
  [900, 1115, 1050, 34, 28, 30, 37.5, 1001, 5],
  [1000, 1230, 1160, 37, 28, 33, 40, 1112, 5],
  [1200, 1455, 1380, 40, 32, 36, 45, 1328, 5],
];

// p. 247
const PN16: readonly Row[] = [
  [50, 165, 125, 19, 4, 16, 19, 99, 3],
  [80, 200, 160, 19, 8, 16, 19, 132, 3],
  [100, 220, 180, 19, 8, 16, 19, 156, 3],
  [150, 285, 240, 23, 8, 20, 19, 211, 3],
  [200, 340, 295, 23, 12, 20, 20, 266, 3],
  [250, 400, 355, 28, 12, 24, 22, 319, 3],
  [300, 455, 410, 28, 12, 24, 24.5, 370, 4],
  [350, 520, 470, 28, 16, 24, 26.5, 429, 4],
  [400, 580, 525, 31, 16, 27, 28, 480, 4],
  [450, 640, 585, 31, 20, 27, 30, 548, 4],
  [500, 715, 650, 34, 20, 30, 31.5, 609, 4],
  [600, 840, 770, 37, 20, 33, 36, 720, 5],
  [700, 910, 840, 37, 24, 33, 39.5, 794, 5],
  [800, 1025, 950, 40, 24, 36, 43, 901, 5],
  [900, 1125, 1050, 40, 28, 36, 46.5, 1001, 5],
  [1000, 1255, 1170, 43, 28, 39, 50, 1112, 5],
  [1200, 1485, 1390, 49, 32, 45, 57, 1328, 5],
];

// p. 248
const PN25: readonly Row[] = [
  [50, 165, 125, 19, 4, 16, 19, 99, 3],
  [80, 200, 160, 19, 8, 16, 19, 132, 3],
  [100, 235, 190, 23, 8, 20, 19, 156, 3],
  [150, 300, 250, 28, 8, 24, 20, 211, 3],
  [200, 360, 310, 28, 12, 24, 22, 274, 3],
  [250, 425, 370, 31, 12, 27, 24.5, 330, 3],
  [300, 485, 430, 31, 16, 27, 27.5, 389, 4],
  [350, 555, 490, 34, 16, 30, 30, 448, 4],
  [400, 620, 550, 37, 16, 33, 32, 503, 4],
  [450, 670, 600, 37, 20, 33, 34.5, 548, 4],
  [500, 730, 660, 37, 20, 33, 36.5, 609, 4],
  [600, 845, 770, 40, 20, 36, 42, 720, 5],
  [700, 960, 875, 43, 24, 39, 46.5, 820, 5],
  [800, 1085, 990, 49, 24, 45, 51, 928, 5],
  [900, 1185, 1090, 49, 28, 45, 55.5, 1028, 5],
  [1000, 1320, 1210, 56, 28, 52, 60, 1140, 5],
  [1200, 1530, 1420, 56, 32, 52, 69, 1350, 5],
];

// p. 249
const PN40: readonly Row[] = [
  [50, 165, 125, 19, 4, 16, 19, 99, 3],
  [80, 200, 160, 19, 8, 16, 19, 132, 3],
  [100, 235, 190, 23, 8, 20, 19, 156, 3],
  [150, 300, 250, 28, 8, 24, 26, 211, 3],
  [200, 375, 320, 31, 12, 27, 30, 284, 3],
  [250, 450, 385, 34, 12, 30, 34.5, 345, 3],
  [300, 515, 450, 34, 16, 30, 39.5, 409, 4],
  [350, 580, 510, 37, 16, 33, 44, 465, 4],
  [400, 660, 585, 40, 16, 36, 48, 535, 4],
  [450, 685, 610, 40, 20, 36, 49, 560, 4],
  [500, 755, 670, 43, 20, 39, 52, 615, 4],
  [600, 890, 795, 49, 20, 45, 58, 735, 5],
];

const CATALOG =
  'Catálogo Geral (arquivo CATÁLOGO GERAL.pdf, fornecido pelo responsável do projeto), cap. 4, linha Água e Esgoto';

const APPROXIMATIONS = [
  'A espessura "a" é lida como incluindo o ressalto "c" (as duas cotas partem da face de vedação no desenho).',
  'Cubo do flange (diâmetro, altura e concordância): não tabulado — representação.',
  'Furo do flange: não tabulado — adota-se o diâmetro do tubo da especificação à qual a peça se acopla.',
  'Chanfros, raios de fundição, marcações em relevo, juntas e parafusos não são modelados.',
] as const;

const family = (
  pn: 10 | 16 | 25 | 40,
  page: number,
  rows: readonly Row[],
  remarks: readonly string[],
): FlangeFamily => ({
  id: `flange-pn${pn}`,
  name: `Junta com flange — PN ${pn}`,
  pressureClass: `PN ${pn}`,
  manufacturer: null,
  standard: `PN ${pn} (norma não indicada nas páginas recebidas do catálogo)`,
  source: `${CATALOG}, p. ${page} — "Junta com Flange – PN ${pn}": D, C, d, parafusos (quantidade e dimensão nominal), a, ressalto g e c.`,
  approximations: APPROXIMATIONS,
  remarks,
  sizes: sizes(rows),
});

const CONSULT = 'DN 1400 a 2000: a tabela indica "Consultar" — sem dimensões, não cadastrados.';

export const FLANGE_FAMILIES: readonly FlangeFamily[] = [
  family(10, 246, PN10, [CONSULT]),
  family(16, 247, PN16, [CONSULT]),
  family(25, 248, PN25, [CONSULT]),
  family(40, 249, PN40, [
    'A tabela PN 40 vai só até DN 600.',
    'Nota da página: "Outras furações de flanges, sob consulta."',
  ]),
];

export function getFlangeFamily(pressureClass: FlangePressureClass): FlangeFamily | undefined {
  return FLANGE_FAMILIES.find((f) => f.pressureClass === pressureClass);
}

export function flangeSize(pressureClass: FlangePressureClass, dn: number): FlangeSize | undefined {
  return getFlangeFamily(pressureClass)?.sizes.find((s) => s.dn === dn);
}

/**
 * Flange em mm, no formato das famílias: [a, D, C, nº de furos, d, g, c]. `undefined` quando
 * a tabela não traz o DN — nunca se inventa um flange.
 */
export function flangeEndMm(pressureClass: FlangePressureClass, dn: number): EndMm | undefined {
  const size = flangeSize(pressureClass, dn);
  return size ? [size.a, size.D, size.C, size.boltCount, size.d, size.g, size.c] : undefined;
}

/** Flange em unidades SI, como acabamento de extremidade. */
export function flangeEnd(
  pressureClass: FlangePressureClass,
  dn: number,
): EndTreatment | undefined {
  const size = flangeSize(pressureClass, dn);
  if (!size) return undefined;
  return {
    type: 'flange',
    length: mmToM(size.a),
    outerDiameter: mmToM(size.D),
    boltCircle: mmToM(size.C),
    boltCount: size.boltCount,
    boltHoleDiameter: mmToM(size.d),
    raisedFaceDiameter: mmToM(size.g),
    raisedFaceHeight: mmToM(size.c),
  };
}

/** Texto de fonte para as famílias que usam o flange da tabela única. */
export function flangeSourceNote(pressureClass: FlangePressureClass): string {
  const page = 246 + FLANGE_PRESSURE_CLASSES.indexOf(pressureClass);
  return `Flange ${pressureClass}: Catálogo Geral (CATÁLOGO GERAL.pdf), p. ${page} — D, C, d, nº de furos, a, g, c.`;
}

// ---------------------------------------------------------------------------
// Tubos de ferro fundido dúctil com flanges
// ---------------------------------------------------------------------------

/**
 * Configuração das extremidades do tubo: `start` é o início e `end`, o fim do tubo.
 * "Ponta" é a ponta lisa.
 */
export const PIPE_END_CONFIGURATIONS = [
  'plainPlain',
  'flangeFlange',
  'flangePlain',
  'plainFlange',
] as const;
export type PipeEndConfiguration = (typeof PIPE_END_CONFIGURATIONS)[number];

export const PIPE_END_CONFIGURATION_LABELS: Record<PipeEndConfiguration, string> = {
  plainPlain: 'Ponta e ponta',
  flangeFlange: 'Flange e flange',
  flangePlain: 'Flange (início) e ponta',
  plainFlange: 'Ponta e flange (fim)',
};

/**
 * Família de tubos com flanges: o corpo é o tubo da especificação (diâmetros do catálogo de
 * tubos) e os flanges vêm da tabela única, na classe de pressão da família. O comprimento
 * é livre (definido pelo usuário, entre as portas — face do flange ou extremidade da ponta).
 */
export interface FlangedPipeFamily {
  readonly id: string;
  readonly name: string;
  readonly specificationId: string;
  readonly pressureClass: FlangePressureClass;
  readonly manufacturer: string | null;
  readonly standard: string;
  readonly source: string;
  readonly approximations: readonly string[];
}

const DUCTILE_PIPE = 'ferro-ductil-nbr7675-k9';

export const FLANGED_PIPE_FAMILIES: readonly FlangedPipeFamily[] = FLANGE_FAMILIES.map(
  (flange) => ({
    id: `tubo-fofo-flanges-${flange.id.replace('flange-', '')}`,
    name: `Tubo de ferro fundido dúctil com flanges ${flange.pressureClass}`,
    specificationId: DUCTILE_PIPE,
    pressureClass: flange.pressureClass,
    manufacturer: null,
    standard: `ABNT NBR 7675 / ISO 2531 (tubo) · flanges ${flange.pressureClass}`,
    source: `Corpo: especificação de tubo "Ferro fundido dúctil — classe K9" do catálogo embutido. ${flangeSourceNote(flange.pressureClass)} Configurações: flange e flange, flange e ponta (em qualquer das extremidades) e ponta e ponta; comprimento definido pelo usuário.`,
    approximations: [
      'O comprimento é livre: as páginas recebidas não tabulam comprimentos padronizados de tubos e tocos com flanges.',
      'A classe de espessura do tubo flangeado do fabricante não consta das páginas recebidas: o corpo usa a classe K9 da especificação embutida.',
      'Forma de fixação do flange (fundido, soldado ou roscado) e cubo: representação.',
    ],
  }),
);

export function getFlangedPipeFamily(id: string | null | undefined): FlangedPipeFamily | undefined {
  return FLANGED_PIPE_FAMILIES.find((f) => f.id === id);
}

/** Famílias de tubos com flanges oferecidas para uma especificação de tubo. */
export function flangedPipeFamiliesFor(specificationId: string): FlangedPipeFamily[] {
  return FLANGED_PIPE_FAMILIES.filter((f) => f.specificationId === specificationId);
}

/** Flange de um tubo da família, para o diâmetro de `spec`; `undefined` se não tabulado. */
export function pipeFlangeEnd(spec: PipeSpec, familyId: string): EndTreatment | undefined {
  const pipeFamily = getFlangedPipeFamily(familyId);
  if (!pipeFamily || pipeFamily.specificationId !== spec.specificationId) return undefined;
  return flangeEnd(pipeFamily.pressureClass, spec.dn);
}

/**
 * Extremidades de um tubo da família na configuração pedida. `null` quando a família não
 * atende a especificação ou o DN não tem flange tabulado.
 */
export function resolvePipeEnds(
  spec: PipeSpec,
  familyId: string,
  configuration: PipeEndConfiguration,
): { start: EndTreatment | null; end: EndTreatment | null } | null {
  if (configuration === 'plainPlain') return { start: null, end: null };
  const flange = pipeFlangeEnd(spec, familyId);
  if (!flange) return null;
  return {
    start: configuration === 'plainFlange' ? null : flange,
    end: configuration === 'flangePlain' ? null : flange,
  };
}

/** Configuração atual de um tubo, a partir do acabamento de suas extremidades. */
export function pipeEndConfigurationOf(pipe: {
  ends?: Record<string, EndTreatment> | undefined;
}): PipeEndConfiguration {
  const start = pipe.ends?.start?.type === 'flange';
  const end = pipe.ends?.end?.type === 'flange';
  return start && end ? 'flangeFlange' : start ? 'flangePlain' : end ? 'plainFlange' : 'plainPlain';
}
