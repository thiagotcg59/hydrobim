import type { FittingFamily } from '@hydrobim/core';
import { flangeEndMm, flangeSourceNote } from '../flanges';
import { forSpecifications, type EndMm, type SizeMm } from './builders';
import { DUCTILE_SPECIFICATIONS } from './ductileIron';

/**
 * Macromedidor — medidor de vazão eletromagnético flangeado SANECOM (carretel em
 * aço-carbono pintado de azul, revestimento de borracha neoprene, eletrodos de aço inox),
 * nas montagens remota (sensor IP68 com caixa de ligação, conversor à parte) e compacta.
 *
 * Fonte: Sanecom Saneamento — "Catálogo Medidor Eletromagnético" (PDF de 12 páginas, sem
 * número de edição; criado em 03/06/2026), p. 4 — "Dimensional":
 * https://irp.cdn-website.com/0710e58f/files/uploaded/CAT%C3%81LOGO+MEDIDOR+ELETROMAGNETICO+%281%29.pdf
 *
 * Cotas da tabela (mm), conforme o desenho da mesma página:
 *  - H: comprimento face a face dos flanges;
 *  - L: altura total, da borda inferior do flange ao topo do cabeçote;
 *  - D: diâmetro externo do flange; D1, n-Ød1 e C: furação e espessura do flange.
 *
 * Linhas transcritas: as das classes PN 1.6 (DN 65 a 200) e PN 1.0 (DN 250 a 1000) e o
 * DN 50 (última linha da PN 4.0). Os DN 10 a 40 (PN 4.0) e o bloco "PN 6.4" não foram
 * cadastrados: estão fora da faixa do ferro fundido dúctil e da tabela única de flanges.
 *
 * Derivação (declarada): altura do eixo ao topo = L − D/2, pois L parte da borda inferior
 * do flange. O D usado na conta é o da própria tabela do fabricante.
 *
 * DN 1000: a tabela imprime L = "135", menor que o próprio flange (D = 1230) — erro de
 * impressão. O face a face (H = 1000) é cadastrado e a altura fica SEM valor.
 *
 * O desenho cota o cabeçote da montagem compacta (53 × 115 mm, Ø98 × 152 mm), o mesmo em
 * todos os DN. A caixa de ligação da montagem remota não é cotada; a altura L é adotada
 * para as duas montagens.
 *
 * Flanges: a página diz "Norma flange: B16.5", mas as cotas D, D1 e a furação tabuladas
 * são as dos flanges PN (ex.: DN 100 — D = 220, D1 = 180, 8 furos), não as da ASME B16.5.
 * Conforme a regra do catálogo, o flange NÃO é transcrito desta fonte: vem da tabela única
 * (`flanges.ts`), na classe PN 10 das demais peças de ferro fundido dúctil do catálogo. O
 * fabricante indica PN 1.6 para DN 65 a 200 e PN 1.0 de DN 250 em diante; na tabela única
 * as duas classes só diferem, nessa faixa, no DN 200 (12 furos na PN 16, 8 na PN 10) — o
 * PN 10 foi adotado para a peça acoplar às conexões e válvulas existentes. DN 65 e 125 não
 * constam da tabela única e ficam sem o disco do flange na geometria.
 */

const SOURCE =
  'Sanecom Saneamento — Catálogo Medidor Eletromagnético (2026), p. 4 "Dimensional" (https://irp.cdn-website.com/0710e58f/files/uploaded/CAT%C3%81LOGO+MEDIDOR+ELETROMAGNETICO+%281%29.pdf)';

// [DN, H (face a face), L (altura total; null = erro de impressão), D (Ø do flange)]
export const SANECOM_ROWS = [
  [50, 200, 320, 165],
  [65, 200, 335, 185],
  [80, 200, 350, 200],
  [100, 250, 370, 220],
  [125, 250, 405, 250],
  [150, 300, 435, 285],
  [200, 350, 495, 340],
  [250, 400, 545, 395],
  [300, 500, 595, 445],
  [350, 500, 630, 505],
  [400, 600, 685, 565],
  [450, 600, 735, 615],
  [500, 600, 790, 670],
  [600, 600, 900, 780],
  [700, 700, 1035, 895],
  [800, 800, 1140, 1015],
  [900, 900, 1245, 1115],
  [1000, 1000, null, 1230],
] as const satisfies readonly (readonly [number, number, number | null, number])[];

const sizes: SizeMm[] = SANECOM_ROWS.map(([dn, faceToFace, total, flangeD]) => {
  const flange: EndMm | undefined = flangeEndMm('PN 10', dn);
  return {
    dn,
    length: faceToFace,
    ...(total !== null ? { height: total - flangeD / 2 } : {}),
    ...(flange ? { end: flange } : {}),
  };
});

export const SANECOM_FAMILIES: FittingFamily[] = forSpecifications(DUCTILE_SPECIFICATIONS, {
  id: 'sanecom-eletromagnetico',
  name: 'Macromedidor eletromagnético SANECOM — flangeado, PN 10',
  kind: 'valve',
  valveType: 'flowMeter',
  endType: 'flange',
  manufacturer: 'Sanecom',
  standard: 'Flanges PN 10 · sensor IP68 na montagem remota',
  source: `${SOURCE} — H (face a face) e L (altura total). Altura do eixo ao topo = L − D/2 (D da tabela do fabricante). DN 1000: L impresso "135" (erro) — altura sem valor. ${flangeSourceNote('PN 10')} O fabricante indica PN 1.6 para DN 65 a 200 (difere da PN 10 só no DN 200: 12 furos); adotado o PN 10 das demais peças de ferro dúctil. DN 65 e 125 sem dado de flange. A página cita "B16.5", mas as cotas tabuladas são as dos flanges PN.`,
  sizes,
});
