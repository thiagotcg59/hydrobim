import type { HydroElement } from '@hydrobim/core';
import { createLucideIcon, type LucideIcon } from 'lucide-react';

/**
 * Símbolos técnicos do HydroBIM, na mesma linguagem da biblioteca de ícones: quadro de 24,
 * traço arredondado de espessura única, sem preenchimento. Distinguem a forma das peças
 * (flanges nas extremidades, corpo, eixo) sem representar dimensões de catálogo.
 */

/** Trecho de tubo entre dois flanges. */
export const PipeIcon = createLucideIcon('HydroPipe', [
  ['path', { d: 'M3 7v10M21 7v10', key: 'flanges' }],
  ['path', { d: 'M6 8.5v7M18 8.5v7', key: 'collars' }],
  ['path', { d: 'M6 9.5h12M6 14.5h12', key: 'wall' }],
  ['path', { d: 'M3 12h3M18 12h3', opacity: '0.55', key: 'necks' }],
]);

/** Joelho de 90°, com as duas extremidades flangeadas. */
export const ElbowIcon = createLucideIcon('HydroElbow', [
  ['path', { d: 'M4 6h5a9 9 0 0 1 9 9v5', key: 'outer' }],
  ['path', { d: 'M4 11h5a4 4 0 0 1 4 4v5', key: 'inner' }],
  ['path', { d: 'M4 4.5v8M11.5 20h8', key: 'flanges' }],
]);

/** Tê: passagem horizontal e derivação para baixo. */
export const TeeIcon = createLucideIcon('HydroTee', [
  ['path', { d: 'M4 8h16', key: 'top' }],
  ['path', { d: 'M4 13h5.5v6M20 13h-5.5v6', key: 'body' }],
  ['path', { d: 'M4 6.5v8M20 6.5v8M8 19h8', key: 'flanges' }],
]);

/** Redução concêntrica: boca maior à esquerda. */
export const ReducerIcon = createLucideIcon('HydroReducer', [
  ['path', { d: 'M4 6.5h3l10 3h3', key: 'top' }],
  ['path', { d: 'M4 17.5h3l10-3h3', key: 'bottom' }],
  ['path', { d: 'M4 5v14M20 8v8', key: 'flanges' }],
]);

/** Válvula: corpo em gravata, haste e volante. */
export const ValveIcon = createLucideIcon('HydroValve', [
  ['path', { d: 'm4 11 8 4-8 4Zm16 0-8 4 8 4Z', key: 'body' }],
  ['path', { d: 'M12 15V7', key: 'stem' }],
  ['path', { d: 'M8 5.5h8', key: 'wheel' }],
  ['path', { d: 'M2.5 10v10M21.5 10v10', opacity: '0.55', key: 'flanges' }],
]);

/** Bomba centrífuga: voluta, recalque tangencial, sucção e base. */
export const PumpIcon = createLucideIcon('HydroPump', [
  ['circle', { cx: '11', cy: '12', r: '6', key: 'volute' }],
  ['path', { d: 'M11 6h9v4.5h-3.2', key: 'discharge' }],
  ['path', { d: 'M2.5 12H5', key: 'suction' }],
  ['circle', { cx: '11', cy: '12', r: '1.6', key: 'shaft' }],
  ['path', { d: 'm7.5 17-1.5 3.5h10L14.5 17', key: 'base' }],
]);

/** Reservatório cilíndrico vertical, com o nível de água e a saída. */
export const TankIcon = createLucideIcon('HydroTank', [
  ['path', { d: 'M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6', key: 'shell' }],
  ['ellipse', { cx: '12', cy: '6', rx: '7', ry: '3', key: 'top' }],
  ['path', { d: 'M5 13c1.5 1.4 4 2 7 2s5.5-.6 7-2', opacity: '0.55', key: 'level' }],
  ['path', { d: 'M19 17h3', key: 'outlet' }],
]);

/** Usado pela faixa, pelo navegador e pelo inspetor para manter o mesmo símbolo por tipo. */
export const ELEMENT_ICONS: Readonly<Record<HydroElement['kind'], LucideIcon>> = {
  pipe: PipeIcon,
  elbow: ElbowIcon,
  tee: TeeIcon,
  reducer: ReducerIcon,
  valve: ValveIcon,
  pump: PumpIcon,
  tank: TankIcon,
};
