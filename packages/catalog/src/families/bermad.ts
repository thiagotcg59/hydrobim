import type { FittingFamily } from '@hydrobim/core';
import { flangeEndMm, flangeSourceNote } from '../flanges';
import { forSpecifications, type EndMm, type SizeMm } from './builders';
import { DUCTILE_SPECIFICATIONS } from './ductileIron';

/**
 * Válvula redutora de pressão BERMAD Modelo 720 — série 700 SIGMA (corpo em "Y", flangeada,
 * ferro dúctil, 25 bar), operada hidraulicamente por piloto.
 *
 * Fonte: BERMAD — "700 Series Engineering Data" (Waterworks), tabelas métricas
 * "Dimensions & Weights" do 700 SIGMA EN (p. 10) e do 700 SIGMA ES (p. 12):
 * https://catalog.bermad.com/BERMAD-Assets/Waterworks/700-Series-SIGMA-EN-ES/App-Eng.-tools/Engineering/WW-700-Engineering-English.pdf
 *
 * Cotas da tabela (mm), conforme o desenho da mesma página:
 *  - L: face a face (ISO 5752 / EN 558-1);
 *  - W: largura máxima;
 *  - h: do eixo ao ponto mais baixo (máximo);
 *  - H: altura total, do ponto mais baixo ao topo da tampa do atuador (máximo).
 *
 * Derivações (declaradas): altura do eixo ao topo = H − h; a largura máxima W é adotada
 * como diâmetro da tampa do atuador. As cotas H, h e W são MÁXIMAS e referem-se à válvula
 * básica; o circuito de controle (piloto e tubos) não é dimensionado no documento.
 *
 * Flanges: a BERMAD informa "Flanged (all standards)" e não tabula o flange. Adotado o
 * flange PN 10 da tabela única de flanges (`flanges.ts`), onde há dado; os DN que a tabela
 * não traz (40, 65 e 125) ficam sem o disco do flange na geometria.
 */

const SOURCE =
  'BERMAD — 700 Series Engineering Data (https://catalog.bermad.com/BERMAD-Assets/Waterworks/700-Series-SIGMA-EN-ES/App-Eng.-tools/Engineering/WW-700-Engineering-English.pdf)';

// [DN, L (face a face), W (largura máx.), h (eixo ao fundo), H (altura total)]
const SIGMA_EN = [
  [40, 230, 155, 81, 235],
  [50, 230, 165, 86, 240],
  [65, 290, 190, 98, 295],
  [80, 310, 210, 108, 335],
  [100, 350, 255, 131, 400],
  [150, 480, 320, 163, 525],
  [200, 600, 400, 193, 625],
  [250, 730, 480, 227, 735],
  [300, 850, 570, 272, 890],
  [400, 1100, 815, 334, 1180],
] as const;

const SIGMA_ES = [
  [65, 290, 190, 98, 240],
  [80, 310, 210, 108, 315],
  [100, 350, 255, 131, 335],
  [125, 400, 270, 140, 375],
  [150, 480, 320, 163, 445],
  [200, 600, 380, 193, 535],
  [250, 730, 450, 227, 625],
  [300, 850, 540, 265, 760],
  [350, 980, 585, 299, 920],
  [400, 1100, 660, 334, 960],
  [450, 1200, 815, 361, 1200],
  [500, 1250, 815, 398, 1220],
  [600, 1450, 920, 465, 1260],
] as const;

function sizes(rows: readonly (readonly [number, number, number, number, number])[]): SizeMm[] {
  return rows.map(([dn, l, w, h, total]) => {
    const flange: EndMm | undefined = flangeEndMm('PN 10', dn);
    return {
      dn,
      length: l,
      height: total - h,
      width: w,
      ...(flange ? { end: flange } : {}),
    };
  });
}

const common = {
  kind: 'valve',
  valveType: 'pressureReducing',
  endType: 'flange',
  manufacturer: 'BERMAD',
  standard: 'EN 1074 / face a face ISO 5752 (EN 558-1)',
} as const;

export const BERMAD_FAMILIES: FittingFamily[] = [
  ...forSpecifications(DUCTILE_SPECIFICATIONS, {
    ...common,
    id: 'bermad-720-sigma-en',
    name: 'Válvula redutora de pressão BERMAD 720 — 700 SIGMA EN',
    source: `${SOURCE}, p. 10 (700 SIGMA EN, métrico) — L, W, h, H. Altura do eixo ao topo = H − h; W adotada como diâmetro da tampa do atuador. ${flangeSourceNote('PN 10')} DN 40 e 65 sem dado de flange.`,
    sizes: sizes(SIGMA_EN),
  }),
  ...forSpecifications(DUCTILE_SPECIFICATIONS, {
    ...common,
    id: 'bermad-720-sigma-es',
    name: 'Válvula redutora de pressão BERMAD 720 — 700 SIGMA ES',
    source: `${SOURCE}, p. 12 (700 SIGMA ES, métrico) — L, W, h, H. Altura do eixo ao topo = H − h; W adotada como diâmetro da tampa do atuador. ${flangeSourceNote('PN 10')} DN 65 e 125 sem dado de flange.`,
    sizes: sizes(SIGMA_ES),
  }),
];
