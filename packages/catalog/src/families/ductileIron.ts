import type { FittingFamily } from '@hydrobim/core';
import { forSpecifications, type EndMm, type SizeMm } from './builders';

/**
 * Conexões de ferro fundido dúctil (EN 545 / ISO 2531; no Brasil, ABNT NBR 7675).
 *
 * FONTE: Saint-Gobain PAM — "Water supply and distribution", edição internacional 2010
 * (linhas NATURAL/CLASSIC, junta STANDARD). O catálogo brasileiro da PAM não pôde ser
 * consultado; a equivalência entre a junta STANDARD e a JGS/JE2GS brasileira é uma
 * suposição. Confira com o catálogo vigente do fabricante antes do uso em projeto.
 *
 * Valores copiados como impressos, inclusive os que parecem erros do catálogo (curvas
 * flangeadas de 22°30' e 11°15' em DN 500/600 repetem os valores da curva de 45°).
 *
 * Convenções: nas peças com bolsas a porta fica no fundo da bolsa; nas flangeadas, na
 * face do flange. As mesmas conexões atendem o PVC DEFoFo (mesmos diâmetros externos).
 */

const SPECIFICATIONS = ['ferro-ductil-nbr7675-k9', 'pvc-defofo-nbr7665'] as const;
const PAM = 'Saint-Gobain PAM — Water supply and distribution, ed. 2010 (EN 545 / ISO 2531)';

const DNS = [80, 100, 150, 200, 250, 300, 350, 400, 500, 600] as const;
const inRange = (dn: number): boolean => (DNS as readonly number[]).includes(dn);

/** Bolsa por DN: [profundidade P, diâmetro externo B] — curvas com bolsas, p. 411. */
const SOCKET: Record<number, EndMm> = {
  80: [85, 167.5],
  100: [88, 187.5],
  150: [94, 241],
  200: [100, 294],
  250: [105, 351],
  300: [110, 408.3],
  350: [110, 464.3],
  400: [112, 515.3],
  500: [117.5, 628],
  600: [132.5, 737],
};
/** Flange PN 10 por DN: [espessura b + ressalto f, diâmetro externo D] — p. 572. */
const FLANGE: Record<number, EndMm> = {
  80: [19, 200],
  100: [19, 220],
  150: [19, 285],
  200: [20, 340],
  250: [22, 400],
  300: [24.5, 455],
  350: [24.5, 505],
  400: [24.5, 565],
  500: [26.5, 670],
  600: [29, 780],
};
const socket = (dn: number): EndMm => SOCKET[dn] ?? [100, dn * 1.6];
const flange = (dn: number): EndMm => FLANGE[dn] ?? [20, dn * 1.6];

/** Lu por DN (80 … 600), na ordem de `DNS`. */
function bends(lu: readonly number[], end: (dn: number) => EndMm): SizeMm[] {
  return DNS.map((dn, i) => ({ dn, centerToEnd: lu[i] ?? 0, end: end(dn) }));
}

const SOCKET_BENDS = [
  {
    angle: 90,
    label: '90° (1/4)',
    page: 411,
    lu: [91.5, 105, 152.5, 200, 252, 304, 390, 436, 525, 624],
  },
  {
    angle: 45,
    label: '45° (1/8)',
    page: 411,
    lu: [56.5, 65, 92.5, 100, 136, 167.5, 168, 189, 220, 283],
  },
  {
    angle: 22.5,
    label: "22°30' (1/16)",
    page: 412,
    lu: [32, 35, 42, 51, 70, 70, 78, 92, 110, 140],
  },
  { angle: 11.25, label: "11°15' (1/32)", page: 412, lu: [40, 40, 46, 52, 55, 50, 53, 58, 71, 94] },
] as const;

const FLANGED_BENDS = [
  {
    angle: 90,
    label: '90° (1/4)',
    page: 535,
    lu: [165, 180, 220, 260, 350, 400, 450, 500, 600, 700],
  },
  {
    angle: 45,
    label: '45° (1/8)',
    page: 536,
    lu: [130, 140, 160, 180, 350, 400, 298, 326, 375, 426],
  },
  {
    angle: 22.5,
    label: "22°30' (1/16)",
    page: 537,
    lu: [100, 110, 109, 138, 190, 210, 210, 239, 375, 426],
  },
  {
    angle: 11.25,
    label: "11°15' (1/32)",
    page: 538,
    lu: [113, 115, 113, 132, 165, 175, 190, 205, 375, 426],
  },
] as const;

// Tê com bolsas — [DN, dn, Lu (entre fundos das bolsas da passagem), hu (eixo ao fundo da bolsa da derivação)], p. 415
const SOCKET_TEES = [
  [80, 80, 183, 91.5],
  [100, 80, 185, 103.5],
  [100, 100, 210, 105],
  [150, 80, 165, 136.5],
  [150, 100, 190, 140],
  [150, 150, 305, 152.5],
  [200, 80, 170, 166.5],
  [200, 100, 195, 170],
  [200, 150, 250, 177.5],
  [200, 200, 360, 180],
  [250, 80, 234, 182.5],
  [250, 100, 234, 183],
  [250, 150, 251, 164.5],
  [250, 200, 344, 168],
  [250, 250, 404, 202],
  [300, 100, 237, 213],
  [300, 150, 347, 194.5],
  [300, 200, 347, 198],
  [300, 250, 467, 207],
  [300, 300, 467, 233.5],
  [350, 350, 495, 250],
  [400, 400, 560, 280],
  [500, 500, 680, 340],
  [600, 600, 800, 400],
] as const;

// Redução com bolsas — [DN, dn, Lu (entre fundos das bolsas)], p. 419
const SOCKET_TAPERS = [
  [100, 80, 104.5],
  [150, 80, 170],
  [150, 100, 130],
  [200, 100, 230],
  [200, 150, 125],
  [250, 150, 225],
  [250, 200, 125],
  [300, 150, 321.5],
  [300, 200, 222],
  [300, 250, 123],
  [350, 200, 335],
  [350, 250, 260],
  [350, 300, 187],
  [400, 250, 335],
  [400, 300, 260],
  [400, 350, 176],
  [500, 350, 378],
  [500, 400, 290],
  [600, 400, 460],
  [600, 500, 258],
] as const;

// Tê com flanges — [DN, dn, Lu (comprimento total da passagem), hu (eixo à face do flange da derivação)], p. 545–546
const FLANGED_TEES = [
  [80, 80, 330, 165],
  [100, 80, 360, 175],
  [100, 100, 360, 180],
  [150, 80, 440, 205],
  [150, 100, 440, 210],
  [150, 150, 440, 220],
  [200, 80, 520, 235],
  [200, 100, 520, 240],
  [200, 150, 520, 250],
  [200, 200, 520, 260],
  [250, 80, 700, 265],
  [250, 100, 700, 275],
  [250, 150, 700, 300],
  [250, 200, 700, 325],
  [250, 250, 700, 350],
  [300, 80, 800, 290],
  [300, 100, 800, 300],
  [300, 150, 800, 325],
  [300, 200, 800, 350],
  [300, 250, 800, 380],
  [300, 300, 800, 400],
  [350, 80, 850, 325],
  [350, 100, 850, 325],
  [350, 150, 850, 325],
  [350, 200, 850, 325],
  [350, 250, 850, 325],
  [350, 300, 850, 425],
  [350, 350, 850, 425],
  [400, 100, 900, 350],
  [400, 150, 900, 350],
  [400, 200, 900, 350],
  [400, 250, 900, 350],
  [400, 300, 900, 450],
  [400, 350, 900, 450],
  [400, 400, 900, 450],
  [500, 100, 1000, 400],
  [500, 150, 1000, 400],
  [500, 200, 1000, 400],
  [500, 250, 1000, 400],
  [500, 300, 1000, 500],
  [500, 350, 1000, 500],
  [500, 400, 1000, 500],
  [500, 500, 1000, 500],
  [600, 80, 1100, 450],
  [600, 100, 1100, 450],
  [600, 150, 1100, 450],
  [600, 200, 1100, 450],
  [600, 300, 1100, 550],
  [600, 350, 1100, 550],
  [600, 400, 1100, 550],
  [600, 500, 1100, 550],
  [600, 600, 1100, 550],
] as const;

// Redução com flanges — [DN, dn, Lu (face a face)], p. 560–561
const FLANGED_TAPERS = [
  [100, 80, 200],
  [150, 80, 200],
  [150, 100, 200],
  [200, 80, 300],
  [200, 100, 300],
  [200, 150, 300],
  [250, 80, 600],
  [250, 100, 300],
  [250, 150, 300],
  [250, 200, 300],
  [300, 80, 700],
  [300, 100, 300],
  [300, 150, 300],
  [300, 200, 300],
  [300, 250, 300],
  [350, 200, 600],
  [350, 250, 300],
  [350, 300, 300],
  [400, 200, 300],
  [400, 250, 300],
  [400, 300, 300],
  [400, 350, 300],
  [500, 250, 700],
  [500, 300, 600],
  [500, 350, 600],
  [500, 400, 600],
  [600, 300, 800],
  [600, 350, 700],
  [600, 400, 600],
  [600, 500, 600],
] as const;

const common = { manufacturer: 'Saint-Gobain PAM', standard: 'EN 545 / ISO 2531 (ABNT NBR 7675)' };

export const DUCTILE_IRON_FAMILIES: FittingFamily[] = [
  ...SOCKET_BENDS.flatMap((bend) =>
    forSpecifications(SPECIFICATIONS, {
      ...common,
      id: `pam-curva-${bend.angle}-bolsas`,
      name: `Curva ${bend.label} com bolsas`,
      kind: 'elbow',
      endType: 'socket',
      angleDeg: bend.angle,
      source: `${PAM}, p. ${bend.page} — Lu (fundo da bolsa ao centro), P (profundidade) e B (Ø externo da bolsa).`,
      sizes: bends(bend.lu, socket),
    }),
  ),
  ...FLANGED_BENDS.flatMap((bend) =>
    forSpecifications(SPECIFICATIONS, {
      ...common,
      id: `pam-curva-${bend.angle}-flanges`,
      name: `Curva ${bend.label} com flanges PN 10`,
      kind: 'elbow',
      endType: 'flange',
      angleDeg: bend.angle,
      source: `${PAM}, p. ${bend.page} — Lu (face do flange ao centro). Flange PN 10: p. 572 (D; espessura b + ressalto f).`,
      sizes: bends(bend.lu, flange),
    }),
  ),
  ...forSpecifications(SPECIFICATIONS, {
    ...common,
    id: 'pam-te-bolsas',
    name: 'Tê com bolsas',
    kind: 'tee',
    endType: 'socket',
    source: `${PAM}, p. 415 — centro à porta da passagem = Lu/2 (derivado); hu (eixo ao fundo da bolsa da derivação).`,
    sizes: SOCKET_TEES.filter(([dn, branch]) => inRange(dn) && inRange(branch)).map(
      ([dn, branch, lu, hu]) => ({
        dn,
        ...(branch !== dn ? { dn2: branch } : {}),
        centerToEnd: lu / 2,
        centerToBranch: hu,
        end: socket(dn),
        end2: socket(branch),
      }),
    ),
  }),
  ...forSpecifications(SPECIFICATIONS, {
    ...common,
    id: 'pam-te-flanges',
    name: 'Tê com flanges PN 10',
    kind: 'tee',
    endType: 'flange',
    source: `${PAM}, p. 545–546 — centro à face da passagem = Lu/2 (derivado); hu (eixo à face da derivação). Flange PN 10: p. 572.`,
    sizes: FLANGED_TEES.map(([dn, branch, lu, hu]) => ({
      dn,
      ...(branch !== dn ? { dn2: branch } : {}),
      centerToEnd: lu / 2,
      centerToBranch: hu,
      end: flange(dn),
      end2: flange(branch),
    })),
  }),
  ...forSpecifications(SPECIFICATIONS, {
    ...common,
    id: 'pam-reducao-bolsas',
    name: 'Redução com bolsas',
    kind: 'reducer',
    endType: 'socket',
    source: `${PAM}, p. 419 — Lu (entre os fundos das bolsas).`,
    sizes: SOCKET_TAPERS.map(([dn, small, lu]) => ({
      dn,
      dn2: small,
      length: lu,
      end: socket(dn),
      end2: socket(small),
    })),
  }),
  ...forSpecifications(SPECIFICATIONS, {
    ...common,
    id: 'pam-reducao-flanges',
    name: 'Redução com flanges PN 10',
    kind: 'reducer',
    endType: 'flange',
    source: `${PAM}, p. 560–561 — Lu (face a face). Flange PN 10: p. 572.`,
    sizes: FLANGED_TAPERS.map(([dn, small, lu]) => ({
      dn,
      dn2: small,
      length: lu,
      end: flange(dn),
      end2: flange(small),
    })),
  }),
];

export { FLANGE as PN10_FLANGE_MM, SPECIFICATIONS as DUCTILE_SPECIFICATIONS };
