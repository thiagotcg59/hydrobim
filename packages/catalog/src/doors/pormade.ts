import type { DoorFrieze } from '@hydrobim/core';
import type { ArchFamily, DoorProductFinish, DoorProductSize } from '../architecture';

/**
 * Portas de madeira Pormade — linhas Frizzatta e Lisa (porta de abrir, uma folha).
 *
 * FONTE: Pormade Portas, "Catálogo de Produtos" (PDF "catalogo_pormade_portas_2017", 28 p.,
 * fornecido pelo responsável do projeto; as páginas não trazem número de edição legível — o
 * ano é o do nome do arquivo). Fabricante: www.pormade.com.br.
 *  - p. 7: modelos FRI 001 a FRI 004, nas versões Verniz e "Primer e Branco", e a nota
 *    "A Linha Frizzatta têm a opção com frisos claros";
 *  - p. 8: Lisa, nas versões Verniz e "Primer e Branco";
 *  - p. 26, "Detalhes Técnicos": quadros "PORTA DE ABRIR — medidas padrão do vão",
 *    "DIMENSÕES — linhas Frizzatta, Lisa e Veneziana" e "Núcleo".
 *
 * TRANSCRITO (p. 26):
 *  - porta 60 / 70 / 80 / 90 cm → largura do vão 68 / 78 / 88 / 98 cm;
 *  - altura da porta 210 cm → altura do vão 215 cm ("conforme norma ABNT 15.930");
 *  - espessura da folha 35 mm; largura dos frisos da Frizzatta 16 mm;
 *  - núcleo das linhas "Frizzatta, Lisa e Primer": sarrafeado ou sólido. O quadro ao lado
 *    ("Madeirado e Branco": colmeia ou sólido) não diz qual vale para uma Frizzatta ou Lisa
 *    na versão Branco, e por isso o Branco fica SEM opções de núcleo (valor pendente).
 *
 * LIDO DAS ILUSTRAÇÕES (p. 7), sem cota no catálogo: a quantidade e a orientação dos frisos
 * de cada modelo. A POSIÇÃO deles é representação esquemática (`schematic: true`): frisos
 * horizontais igualmente espaçados nos FRI 002, 003 e 004; no FRI 001, frações estimadas da
 * figura. O friso curvo do FRI 003 não é representado.
 *
 * DERIVADO: largura aparente do marco = (largura do vão − largura da porta) / 2 = 4 cm. O
 * catálogo não cota a seção montada do batente; com isso a folha do modelo fica com 2,11 m
 * de altura (vão − marco), contra os 2,10 m do catálogo.
 *
 * FORA DO PILOTO: Lisa com visor, com bandeira e modulares (duas folhas), linhas Veneziana,
 * Madeirada e Boutique, kits de correr, batentes, guarnições e rodapés.
 */
const SOURCE = (pages: string): string =>
  `Pormade Portas, "Catálogo de Produtos" (PDF catalogo_pormade_portas_2017, 28 p.), ${pages}; www.pormade.com.br`;

const LEAF_HEIGHT = 2.1;
const OPENING_HEIGHT = 2.15;
const PANEL_THICKNESS = 0.035;
const FRIEZE_WIDTH = 0.016;

/** [largura da porta, largura do vão], em cm (p. 26). */
const WIDTHS_CM = [
  [60, 68],
  [70, 78],
  [80, 88],
  [90, 98],
] as const;

const SIZES: readonly DoorProductSize[] = WIDTHS_CM.map(([leaf, opening]) => ({
  id: String(leaf),
  label: `${leaf} × 210 cm (vão ${opening} × 215 cm)`,
  leafWidth: leaf / 100,
  leafHeight: LEAF_HEIGHT,
  width: opening / 100,
  height: OPENING_HEIGHT,
}));

const SLATTED_OR_SOLID = ['Sarrafeado', 'Sólido'] as const;

const FINISHES: readonly DoorProductFinish[] = [
  { id: 'verniz', label: 'Verniz', cores: SLATTED_OR_SOLID },
  { id: 'primer', label: 'Primer', cores: SLATTED_OR_SOLID },
  { id: 'branco', label: 'Branco', cores: [] },
];

const FRIZZATTA_FINISHES: readonly DoorProductFinish[] = [
  FINISHES[0] as DoorProductFinish,
  { id: 'verniz-frisos-claros', label: 'Verniz com frisos claros', cores: SLATTED_OR_SOLID },
  ...FINISHES.slice(1),
];

const horizontal = (position: number): DoorFrieze => ({ orientation: 'horizontal', position });
const vertical = (position: number): DoorFrieze => ({ orientation: 'vertical', position });

/** `count` frisos horizontais igualmente espaçados (a folha fica dividida em `count + 1`). */
const evenly = (count: number): DoorFrieze[] =>
  Array.from({ length: count }, (_, index) => horizontal((index + 1) / (count + 1)));

const NOT_MODELLED =
  'Batente, guarnições, fechadura e dobradiças são itens do kit Porta Pronta e não são modelados; a largura do batente acompanha a parede e não é dado do tipo.';
const FRAME_DERIVED =
  'Largura aparente do marco (4 cm) é derivada: (largura do vão − largura da porta) / 2. A folha do modelo fica com 2,11 m de altura (vão − marco); a do catálogo tem 2,10 m.';
const NO_PERFORMANCE =
  'Sem dados de desempenho (fogo, acústica, térmica) nem de peso: o catálogo não os traz.';
const COLOUR = 'A cor no modelo 3D é genérica: não reproduz o acabamento escolhido.';
const FRIEZES_SCHEMATIC =
  'Quantidade, orientação e largura (16 mm) dos frisos são do catálogo; a posição deles é esquemática, lida da ilustração (p. 7), que não a cota.';

const door = (
  id: string,
  model: string,
  description: string,
  line: string,
  pages: string,
  finishes: readonly DoorProductFinish[],
  friezes: readonly DoorFrieze[] | null,
  extraNotes: readonly string[] = [],
): ArchFamily => ({
  id,
  category: 'door',
  name: `Pormade ${model}`,
  description,
  generic: false,
  source: SOURCE(pages),
  ifc: {
    entity: 'IfcDoor',
    typeEntity: 'IfcDoorType',
    predefinedType: 'DOOR',
    rationale: 'DOOR: porta comum em vão de parede. O modo de abertura vai em OperationType.',
  },
  notes: [
    ...(friezes ? [FRIEZES_SCHEMATIC] : []),
    ...extraNotes,
    FRAME_DERIVED,
    NOT_MODELLED,
    COLOUR,
    NO_PERFORMANCE,
  ],
  defaults: {
    operation: 'singleSwing',
    width: 0.88,
    height: OPENING_HEIGHT,
    frameWidth: 0.04,
    panelThickness: PANEL_THICKNESS,
  },
  product: {
    manufacturer: 'Pormade',
    line,
    model,
    sizes: SIZES,
    defaultSizeId: '80',
    finishes,
    panelThickness: PANEL_THICKNESS,
    ...(friezes
      ? { leaf: { friezes: [...friezes], friezeWidth: FRIEZE_WIDTH, schematic: true } }
      : {}),
  },
});

const frizzatta = (
  number: string,
  description: string,
  friezes: readonly DoorFrieze[],
  extraNotes: readonly string[] = [],
): ArchFamily =>
  door(
    `arq-porta-pormade-frizzatta-fri-${number}`,
    `Frizzatta FRI ${number}`,
    `Porta de abrir de madeira, linha Frizzatta: ${description}`,
    'Frizzatta',
    'p. 7 e 26',
    FRIZZATTA_FINISHES,
    friezes,
    extraNotes,
  );

export const PORMADE_DOOR_FAMILIES: readonly ArchFamily[] = [
  door(
    'arq-porta-pormade-lisa',
    'Lisa',
    'Porta de abrir de madeira, linha Lisa: folha lisa, sem frisos.',
    'Lisa',
    'p. 8 e 26',
    FINISHES,
    null,
  ),
  frizzatta(
    '001',
    'dois frisos horizontais junto ao topo e dois verticais do lado das dobradiças.',
    [horizontal(0.91), horizontal(0.86), vertical(0.2), vertical(0.35)],
  ),
  frizzatta('002', 'seis frisos horizontais.', evenly(6)),
  frizzatta('003', 'seis frisos horizontais e um friso curvo vertical.', evenly(6), [
    'O friso curvo vertical do FRI 003 NÃO é representado: o modelo traz só os seis frisos horizontais.',
  ]),
  frizzatta('004', 'quatro frisos horizontais.', evenly(4)),
];
