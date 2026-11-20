/**
 * Mudança de direção sem peça, por especificação e diâmetro nominal. Há dois mecanismos, e
 * cada especificação usa o que o fabricante admite:
 *
 *  - deflexão angular da junta elástica (`JointDeflectionTable`): o desvio máximo entre dois
 *    tubos, ou entre tubo e conexão com bolsa, depois de montada a junta;
 *  - curvatura a frio do próprio tubo (`ColdBending`): o tubo é fletido e as juntas ficam
 *    alinhadas. No modelo a curva é uma poligonal, e o desvio em cada vértice é limitado
 *    pelo comprimento dos trechos vizinhos e pelo raio.
 *
 * Cada dado vem de um documento do fabricante, citado em `source`; os valores estão como
 * impressos e nada foi interpolado. O que foi derivado (raio a partir da flecha, raio
 * equivalente da poligonal) está declarado. Especificação ou diâmetro sem dado fica sem
 * valor — e sem valor a mudança de direção exige peça. Os valores adotados foram confirmados
 * pelo responsável em 2026-11-19 (ver `docs/CATALOGS.md`).
 */

export interface JointDeflectionRange {
  /** Faixa de DN, inclusive nos dois extremos, como impressa na fonte. */
  readonly dnMin: number;
  readonly dnMax: number;
  /** Deflexão máxima por junta, em graus. */
  readonly degrees: number;
}

export interface JointDeflectionTable {
  /** Documento, edição, página e URL de onde os valores foram copiados. */
  readonly source: string;
  readonly ranges: readonly JointDeflectionRange[];
  /** Ressalvas de aplicação declaradas junto do dado. */
  readonly remarks?: string;
}

const range = (dnMin: number, dnMax: number, degrees: number): JointDeflectionRange => ({
  dnMin,
  dnMax,
  degrees,
});

/**
 * Ferro fundido dúctil, junta elástica JGS (perfil "junta standard") — tubos e conexões com
 * bolsas. A mesma página traz as juntas travadas (JTI, JTE), com limites menores em alguns
 * diâmetros; elas não são modeladas e não usam esta tabela.
 */
export const DUCTILE_IRON_JGS_DEFLECTION: JointDeflectionTable = {
  source:
    'Saint-Gobain Canalização — Manual Técnico de Montagem e Manutenção, V.3 (2019), p. 14, "Deflexão angular: tubos e conexões com bolsas", tabela "Perfil JGS — junta standard" (https://produto.sgpam.com.br/api/GetFile?filePath=C%3A%5Cmounts%5Cimages%5CUploaded%5CProduct%5CAttachment%5C1%5CManual_tecnico_2019.pdf)',
  ranges: [
    range(80, 150, 5),
    range(200, 300, 4),
    range(350, 600, 3),
    range(700, 800, 2),
    range(900, 1200, 1.5),
  ],
  remarks:
    'A montagem é feita com os tubos alinhados; a deflexão só é dada depois de concluída a junta. Junta travada (JTI, JTE) tem tabela própria.',
};

/** Deflexão por junta (graus) para o DN, ou `undefined` quando a fonte não o traz. */
export function jointDeflectionDegrees(
  table: JointDeflectionTable | undefined,
  dn: number,
): number | undefined {
  return table?.ranges.find((r) => dn >= r.dnMin && dn <= r.dnMax)?.degrees;
}

/**
 * Curvatura a frio do tubo. A fonte dá o limite de uma de três formas; em todas o resultado
 * é o raio equivalente da poligonal (`coldBendRadiusM`): o desvio admitido em um vértice é o
 * comprimento do trecho vizinho mais curto dividido por esse raio.
 */
export interface ColdBending {
  readonly source: string;
  readonly remarks?: string;
  /** Raio mínimo como múltiplo do diâmetro externo (tubo contínuo, curvado em arco). */
  readonly outerDiameterFactor?: number;
  /**
   * Flecha máxima (m) por DN, medida no meio da barra de comprimento `barLengthM` — como
   * impressa. O raio é DERIVADO do arco de círculo: R = (L²/4 + h²) / (2·h).
   */
  readonly sagittaMByDn?: Readonly<Record<number, number>>;
  /**
   * Barra curvada como viga biapoiada com carga no meio do vão: raio mínimo de
   * `midSpanRadiusFactor` × DE no meio do vão `bentLengthM`. O desvio total da barra, pela
   * expressão da própria fonte, é 2·θ = L / (2·R); o raio equivalente da poligonal é
   * DERIVADO para que uma barra inteira dê esse desvio: R_eq = barLengthM · 2·R / L.
   */
  readonly midSpanRadiusFactor?: number;
  readonly bentLengthM?: number;
  /** Comprimento útil da barra (m): o trecho contado em cada vértice não passa dele. */
  readonly barLengthM?: number;
}

/**
 * PVC DEFoFo: a junta elástica fica alinhada e o tubo é fletido. Flecha `h` sobre a barra de
 * 6 m entre juntas, por DN, como impressa.
 */
export const TIGRE_DEFOFO_COLD_BENDING: ColdBending = {
  source:
    'Tigre — Ficha Técnica MPVC DEFoFo, jan/2026, p. 2, item 3.1 c) e tabela "Flexão permitida no tubo" (https://tigresite.s3.amazonaws.com/2026/01/FT_DE-FoFo-MPVC_2025_V7.pdf); mesma tabela no Catálogo Infraestrutura Tigre (2022), Tabela 1',
  sagittaMByDn: {
    100: 0.1,
    150: 0.035,
    200: 0.02,
    250: 0.015,
    300: 0.015,
    350: 0.01,
    400: 0.01,
    500: 0.01,
  },
  barLengthM: 6,
  remarks:
    'A região da junta elástica deve ficar alinhada, com escoramento, e as bolsas ancoradas. O raio é derivado da flecha (arco de círculo sobre a barra de 6 m). Não é permitido aquecer o tubo.',
};

/**
 * PVC PBA: curvatura por flexão do tubo, com raio mínimo de 300 × DE no meio do vão (a fonte
 * cita a ENV 1452-6) e 0,5 m retos em cada extremidade da barra de 6 m. A fonte trata as
 * tubulações de PVC em conjunto e exemplifica com a linha Biax; a Tigre não tabula o PBA.
 */
export const AMANCO_PVC_COLD_BENDING: ColdBending = {
  source:
    'Amanco Wavin — Manual Técnico Infraestrutura (mai/2023), p. 84–85, item 13.2 "Curvatura através da flexão do tubo": raio mínimo de 300 vezes o diâmetro externo, comprimento curvado de 5 m (https://mediahub.wavin.com/m/32ed9fa83d5aa656/original/Manual-Infraestrutura.pdf)',
  midSpanRadiusFactor: 300,
  bentLengthM: 5,
  barLengthM: 6,
  remarks:
    'O desvio por barra é derivado da expressão do manual (2·θ = L / 2R, com L = 5 m). A bolsa não serve de apoio para curvar; colar de tomada e tê de serviço não são recomendados em tubo curvado. A deflexão de 1° na junta (item 13.1) não foi somada.',
};

/** PEAD PE 100 (termofusão): tubo contínuo curvado a frio. */
export const PEAD_COLD_BENDING: ColdBending = {
  source:
    'Corr Plastik — Manual Técnico PEAD Liso (ago/2025), p. 24, "Qual a curvatura admitida para os tubos?": raios de 25 a 30 vezes o diâmetro externo, até 50 vezes para SDR maior que 17 (https://corrplastik.com.br/wp-content/uploads/2025/11/Manual-Tecnico-PEAD-Liso-Agosto-20251.pdf)',
  outerDiameterFactor: 30,
  remarks:
    'Adotado o extremo conservador da faixa (30 × DE), válido para SDR até 17. No modelo a curva é uma poligonal: use trechos curtos para acompanhar o arco.',
};

/**
 * Raio equivalente da poligonal (m) para o DN e o diâmetro externo (mm), ou `undefined`
 * quando a fonte não traz o diâmetro.
 */
export function coldBendRadiusM(
  bending: ColdBending | undefined,
  dn: number,
  outerDiameterMm: number,
): number | undefined {
  if (!bending) return undefined;
  const outerDiameter = outerDiameterMm / 1000;
  if (bending.outerDiameterFactor !== undefined) {
    return bending.outerDiameterFactor * outerDiameter;
  }
  const bar = bending.barLengthM;
  if (bar === undefined) return undefined;
  if (bending.sagittaMByDn) {
    const h = bending.sagittaMByDn[dn];
    return h === undefined ? undefined : (bar * bar) / 4 / (2 * h) + h / 2;
  }
  if (bending.midSpanRadiusFactor !== undefined && bending.bentLengthM !== undefined) {
    const radius = bending.midSpanRadiusFactor * outerDiameter;
    return (bar * 2 * radius) / bending.bentLengthM;
  }
  return undefined;
}
