import type { FittingFamily } from '@hydrobim/core';
import { family } from './builders';

/**
 * Conexões de aço-carbono para solda de topo — ASME B16.9.
 * Fonte: tabelas dimensionais de wermac.org (fonte secundária que reproduz a ASME B16.9);
 * a norma em si não foi consultada.
 */

const STEEL = 'aco-carbono-b3610-sch40';
const SOURCE = 'ASME B16.9, conforme tabelas de wermac.org/fittings';

// [DN, A (joelho 90° raio longo, centro à extremidade), B (45°), C (tê, centro à extremidade)]
const ROWS = [
  [15, 38, 16, 25],
  [20, 38, 19, 29],
  [25, 38, 22, 38],
  [32, 48, 25, 48],
  [40, 57, 29, 57],
  [50, 76, 35, 64],
  [65, 95, 44, 76],
  [80, 114, 51, 86],
  [100, 152, 64, 105],
  [150, 229, 95, 143],
  [200, 305, 127, 178],
  [250, 381, 159, 216],
  [300, 457, 190, 254],
] as const;

// Redução concêntrica — [DN maior, DN menor, H (comprimento)]
const REDUCERS = [
  [20, 15, 38],
  [25, 15, 51],
  [25, 20, 51],
  [32, 15, 51],
  [32, 20, 51],
  [32, 25, 51],
  [40, 15, 64],
  [40, 20, 64],
  [40, 25, 64],
  [40, 32, 64],
  [50, 20, 76],
  [50, 25, 76],
  [50, 32, 76],
  [50, 40, 76],
  [65, 25, 89],
  [65, 32, 89],
  [65, 40, 89],
  [65, 50, 89],
  [80, 32, 89],
  [80, 40, 89],
  [80, 50, 89],
  [80, 65, 89],
  [100, 40, 102],
  [100, 50, 102],
  [100, 65, 102],
  [100, 80, 102],
  [150, 65, 140],
  [150, 80, 140],
  [150, 100, 140],
  [200, 100, 152],
  [200, 150, 152],
  [250, 100, 178],
  [250, 150, 178],
  [250, 200, 178],
  [300, 150, 203],
  [300, 200, 203],
  [300, 250, 203],
] as const;

const common = {
  specificationId: STEEL,
  endType: 'plain' as const,
  manufacturer: null,
  standard: 'ASME B16.9',
};

export const STEEL_FAMILIES: FittingFamily[] = [
  family({
    ...common,
    id: 'b169-joelho-90-raio-longo',
    name: 'Curva 90° raio longo — solda de topo',
    kind: 'elbow',
    angleDeg: 90,
    source: `${SOURCE} — A (centro à extremidade).`,
    sizes: ROWS.map(([dn, a]) => ({ dn, centerToEnd: a })),
  }),
  family({
    ...common,
    id: 'b169-joelho-45-raio-longo',
    name: 'Curva 45° raio longo — solda de topo',
    kind: 'elbow',
    angleDeg: 45,
    source: `${SOURCE} — B (centro à extremidade).`,
    sizes: ROWS.map(([dn, , b]) => ({ dn, centerToEnd: b })),
  }),
  family({
    ...common,
    id: 'b169-te',
    name: 'Tê reto — solda de topo',
    kind: 'tee',
    source: `${SOURCE} — C e M (centro à extremidade, iguais no tê reto).`,
    sizes: ROWS.map(([dn, , , c]) => ({ dn, centerToEnd: c, centerToBranch: c })),
  }),
  family({
    ...common,
    id: 'b169-reducao-concentrica',
    name: 'Redução concêntrica — solda de topo',
    kind: 'reducer',
    source: `${SOURCE} — H (comprimento de extremidade a extremidade).`,
    sizes: REDUCERS.map(([dn, small, h]) => ({ dn, dn2: small, length: h })),
  }),
];
