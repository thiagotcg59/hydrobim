/**
 * Deflexão angular admitida em cada junta elástica, por especificação e diâmetro nominal.
 *
 * Cada tabela vem de um documento do fabricante, citado em `source`; os valores estão como
 * impressos (em graus) e nada foi interpolado. Diâmetro fora das faixas tabuladas fica sem
 * valor — e sem valor a junta é tratada como rígida. Juntas soldadas, por termofusão e
 * flangeadas não têm tabela: não admitem deflexão.
 *
 * O que o valor representa: o desvio angular máximo entre dois tubos (ou entre tubo e conexão
 * com bolsa) depois de montada a junta. Não é a curvatura a frio do próprio tubo (PVC, PEAD),
 * que depende de um elemento de tubo curvo e não é modelada.
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

/**
 * PVC com junta elástica (PBA, DEFoFo). O manual do fabricante trata as "tubulações de PVC"
 * em conjunto e admite 1° por junta; a tabela não distingue diâmetros, e por isso a faixa
 * cobre só os DN que as especificações deste catálogo oferecem.
 */
export const PVC_ELASTIC_JOINT_DEFLECTION: JointDeflectionTable = {
  source:
    'Amanco Wavin — Manual Técnico Infraestrutura (mai/2023), p. 84, item 13.1 "Curvatura através da deflexão angular das juntas": "cada junta poderá ser defletida de 1°" (https://mediahub.wavin.com/m/32ed9fa83d5aa656/original/Manual-Infraestrutura.pdf)',
  ranges: [range(50, 500, 1)],
  remarks:
    'Valor do fabricante Amanco Wavin; tubos de outro fabricante devem ser conferidos no catálogo dele. A curvatura a frio do próprio tubo (item 13.2 do manual) não é modelada.',
};

/** Deflexão por junta (graus) para o DN, ou `undefined` quando a fonte não o traz. */
export function jointDeflectionDegrees(
  table: JointDeflectionTable | undefined,
  dn: number,
): number | undefined {
  return table?.ranges.find((r) => dn >= r.dnMin && dn <= r.dnMax)?.degrees;
}
