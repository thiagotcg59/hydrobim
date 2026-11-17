import type { FittingFamily } from '@hydrobim/core';
import { forSpecifications, type EndMm } from './builders';
import { DUCTILE_SPECIFICATIONS, PN10_FLANGE_MM } from './ductileIron';

/**
 * Válvulas flangeadas para redes de água — dimensões de páginas de produto da AVK
 * (avkvalves.eu), que declaram conformidade com as séries de face a face da EN 558.
 * As normas em si (EN 558, ABNT NBR 14968) não foram consultadas. Não foi possível obter
 * tabelas de fabricantes brasileiros.
 *
 * `height` = eixo do tubo ao topo da haste (o volante é acessório e sua altura de cubo
 * não é tabulada); `handwheelDiameter` vem da tabela de volantes AVK 08.
 * Flanges: EN 1092-2 PN 10, mesmas dimensões usadas nas conexões de ferro dúctil.
 */

const flange = (dn: number): EndMm => PN10_FLANGE_MM[dn] ?? [20, dn * 1.6];
const AVK = 'AVK (avkvalves.eu)';

// [DN, L (face a face), H (eixo ao topo da haste), Ø do volante]
const GATE_SHORT = [
  [80, 180, 282, 225],
  [100, 190, 305, 280],
  [150, 210, 401, 320],
  [200, 230, 490, 360],
  [250, 250, 625, 500],
  [300, 270, 740, 500],
  [350, 290, 924, 640],
  [400, 310, 951, 640],
  [500, 350, 1124, 640],
  [600, 390, 1263, 800],
] as const;

const GATE_LONG = [
  [80, 280, 282, 225],
  [100, 300, 306, 280],
  [150, 350, 403, 320],
  [200, 400, 490, 360],
  [250, 450, 625, 500],
  [300, 500, 706, 500],
  [350, 550, 947, 640],
  [400, 600, 959, 640],
  [500, 700, 1124, 640],
  [600, 800, 1263, 800],
] as const;

// Borboleta wafer — [DN, L (face a face), W2 (eixo à face do flange de topo)]
const BUTTERFLY_WAFER = [
  [80, 46, 160],
  [100, 52, 180],
  [150, 56, 210],
  [200, 60, 240],
  [250, 68, 279],
  [300, 78, 315],
  [350, 80, 330],
  [400, 102, 365],
  [500, 126, 437],
  [600, 153, 522],
] as const;

// Retenção portinhola — [DN, L (face a face), H (eixo ao topo da tampa)]
const SWING_CHECK = [
  [80, 260, 135],
  [100, 300, 150],
  [150, 400, 212],
  [200, 500, 247],
  [250, 600, 347],
  [300, 699, 391],
] as const;

// Ventosa — [DN do flange de entrada, H3 (altura da face do flange ao topo)]
const AIR_VALVE = [
  [80, 605],
  [100, 605],
  [150, 610],
  [200, 610],
] as const;

export const VALVE_FAMILIES: FittingFamily[] = [
  ...forSpecifications(DUCTILE_SPECIFICATIONS, {
    id: 'avk-gaveta-curta-en558-s14',
    name: 'Válvula de gaveta cunha de borracha — corpo curto (EN 558 série 14)',
    kind: 'valve',
    valveType: 'gate',
    endType: 'flange',
    manufacturer: 'AVK',
    standard: 'EN 558 série 14 (F4)',
    source: `${AVK}, série 06/30 — L (face a face), H (eixo ao topo da haste); volante: tabela AVK 08. Flange PN 10 conforme EN 1092-2.`,
    sizes: GATE_SHORT.map(([dn, l, h, wheel]) => ({
      dn,
      length: l,
      height: h,
      handwheelDiameter: wheel,
      end: flange(dn),
    })),
  }),
  ...forSpecifications(DUCTILE_SPECIFICATIONS, {
    id: 'avk-gaveta-longa-en558-s15',
    name: 'Válvula de gaveta cunha de borracha — corpo longo (EN 558 série 15)',
    kind: 'valve',
    valveType: 'gate',
    endType: 'flange',
    manufacturer: 'AVK',
    standard: 'EN 558 série 15 (F5)',
    source: `${AVK}, série 02/60 — L, H; volante: tabela AVK 08.`,
    sizes: GATE_LONG.map(([dn, l, h, wheel]) => ({
      dn,
      length: l,
      height: h,
      handwheelDiameter: wheel,
      end: flange(dn),
    })),
  }),
  ...forSpecifications(DUCTILE_SPECIFICATIONS, {
    id: 'avk-borboleta-wafer-en558-s20',
    name: 'Válvula borboleta wafer (EN 558 série 20)',
    kind: 'valve',
    valveType: 'butterfly',
    // Wafer: sem flanges próprios; fica entre os flanges da tubulação.
    endType: 'plain',
    manufacturer: 'AVK',
    standard: 'EN 558 série 20',
    source: `${AVK}, série 820 — L (face a face) e W2 (eixo à face do flange de topo, eixo nu, sem alavanca).`,
    sizes: BUTTERFLY_WAFER.map(([dn, l, w2]) => ({ dn, length: l, height: w2 })),
  }),
  ...forSpecifications(DUCTILE_SPECIFICATIONS, {
    id: 'avk-retencao-portinhola-en558-s48',
    name: 'Válvula de retenção portinhola (EN 558 série 48)',
    kind: 'valve',
    valveType: 'check',
    endType: 'flange',
    manufacturer: 'AVK',
    standard: 'EN 558 série 48',
    source: `${AVK}, série 41/60 — L (face a face) e H (eixo ao topo da tampa). DN 300 com L = 699 como impresso.`,
    sizes: SWING_CHECK.map(([dn, l, h]) => ({ dn, length: l, height: h, end: flange(dn) })),
  }),
  ...forSpecifications(DUCTILE_SPECIFICATIONS, {
    id: 'avk-ventosa-701',
    name: 'Ventosa flangeada',
    kind: 'valve',
    valveType: 'airRelease',
    endType: 'flange',
    manufacturer: 'AVK',
    standard: 'EN 1074-4',
    source: `${AVK}, série 701/70 — H3 (altura da face do flange de entrada ao topo). O diâmetro do corpo não é tabulado (representação genérica).`,
    sizes: AIR_VALVE.map(([dn, h]) => ({ dn, length: h, end: flange(dn) })),
  }),
];
