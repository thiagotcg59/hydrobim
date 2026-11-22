import type { ArchElementKind, HydroElement } from '@hydrobim/core';
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

/** Cruzeta: passagem horizontal e duas derivações opostas. */
export const CrossIcon = createLucideIcon('HydroCross', [
  ['path', { d: 'M4 9.5h5.5V4M20 9.5h-5.5V4', key: 'top' }],
  ['path', { d: 'M4 14.5h5.5V20M20 14.5h-5.5V20', key: 'bottom' }],
  ['path', { d: 'M2.5 8v8M21.5 8v8M8 2.5h8M8 21.5h8', key: 'flanges' }],
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

// ----- Arquitetura: símbolos de planta e de elevação, no mesmo traço -----

/** Parede em planta: as duas faces e a hachura do corte. */
export const WallIcon = createLucideIcon('ArchWall', [
  ['rect', { x: '3', y: '8', width: '18', height: '8', rx: '0.5', key: 'faces' }],
  ['path', { d: 'm6 16 4-8M11 16l4-8M16 16l4-8', opacity: '0.55', key: 'hatch' }],
]);

/** Laje: placa em perspectiva, com a espessura à vista. */
export const SlabIcon = createLucideIcon('ArchSlab', [
  ['path', { d: 'm3 10 9-4 9 4-9 4Z', key: 'top' }],
  ['path', { d: 'M3 10v4l9 4 9-4v-4', key: 'edge' }],
  ['path', { d: 'M12 14v4', opacity: '0.55', key: 'corner' }],
]);

/** Revestimento de piso: peças assentadas, em perspectiva. */
export const FlooringIcon = createLucideIcon('ArchFlooring', [
  ['path', { d: 'M7 7h10l4 10H3Z', key: 'outline' }],
  ['path', { d: 'M5 12h14M10.3 7 9 17M13.7 7 15 17', opacity: '0.55', key: 'joints' }],
]);

/** Telhado de duas águas em elevação: as águas, a cumeeira e os beirais além das paredes. */
export const RoofIcon = createLucideIcon('ArchRoof', [
  ['path', { d: 'M2 13.5 12 5l10 8.5', key: 'slopes' }],
  ['path', { d: 'M5.5 12.5V20h13v-7.5', opacity: '0.55', key: 'walls' }],
]);

/** Porta em planta: a parede interrompida, a folha aberta e o arco de abertura. */
export const DoorIcon = createLucideIcon('ArchDoor', [
  ['path', { d: 'M2.5 19h4.5M17 19h4.5', key: 'wall' }],
  ['path', { d: 'M7 19V9', key: 'leaf' }],
  ['path', { d: 'M7 9a10 10 0 0 1 10 10', opacity: '0.55', key: 'swing' }],
]);

/** Janela em elevação: marco, montante, travessa e peitoril. */
export const WindowIcon = createLucideIcon('ArchWindow', [
  ['rect', { x: '4.5', y: '4', width: '15', height: '14', rx: '0.5', key: 'frame' }],
  ['path', { d: 'M12 4v14M4.5 11h15', opacity: '0.55', key: 'bars' }],
  ['path', { d: 'M3 20.5h18', key: 'sill' }],
]);

/** Ambiente: a região delimitada (contorno tracejado) e a sua identificação. */
export const SpaceIcon = createLucideIcon('ArchSpace', [
  [
    'rect',
    {
      x: '3.5',
      y: '4.5',
      width: '17',
      height: '15',
      rx: '0.5',
      strokeDasharray: '3 2.5',
      key: 'a',
    },
  ],
  ['path', { d: 'M8.5 10.5h7M10 14h4', key: 'label' }],
]);

/** Abertura no piso: a placa com o vão (shaft) marcado em X. */
export const FloorOpeningIcon = createLucideIcon('ArchFloorOpening', [
  ['rect', { x: '3.5', y: '4.5', width: '17', height: '15', rx: '0.5', key: 'floor' }],
  ['rect', { x: '9', y: '9', width: '6', height: '6', key: 'opening' }],
  ['path', { d: 'm9 9 6 6M15 9l-6 6', opacity: '0.55', key: 'cross' }],
]);

/** Espelhar: a forma e a sua imagem em relação ao eixo. */
export const MirrorIcon = createLucideIcon('ArchMirror', [
  ['path', { d: 'M12 3v18', strokeDasharray: '2.5 2.5', key: 'axis' }],
  ['path', { d: 'M9 7 4 17h5Z', key: 'left' }],
  ['path', { d: 'm15 7 5 10h-5Z', opacity: '0.55', key: 'right' }],
]);

/** Aparar/estender para canto: as duas paredes no canto e, tracejado, o que sai. */
export const TrimCornerIcon = createLucideIcon('ArchTrimCorner', [
  ['path', { d: 'M7 21V7h14', key: 'corner' }],
  ['path', { d: 'M7 7V3', strokeDasharray: '2 2', opacity: '0.55', key: 'cut-a' }],
  ['path', { d: 'M7 7H3', strokeDasharray: '2 2', opacity: '0.55', key: 'cut-b' }],
]);

/** Aparar/estender até parede: a parede-limite e a que é levada até ela. */
export const TrimExtendIcon = createLucideIcon('ArchTrimExtend', [
  ['path', { d: 'M18 3v18', key: 'limit' }],
  ['path', { d: 'M3 12h8', key: 'wall' }],
  ['path', { d: 'M11 12h7', strokeDasharray: '2 2', key: 'extension' }],
  ['path', { d: 'm14 9 3 3-3 3', opacity: '0.55', key: 'arrow' }],
]);

/** Alinhar: a reta de referência (tracejada) e as arestas levadas até ela. */
export const AlignEdgeIcon = createLucideIcon('ArchAlignEdge', [
  ['path', { d: 'M5 3v18', strokeDasharray: '2.5 2.5', key: 'reference' }],
  ['rect', { x: '5', y: '6', width: '13', height: '4', key: 'first' }],
  ['rect', { x: '5', y: '14', width: '8', height: '4', opacity: '0.55', key: 'second' }],
]);

/** Dividir parede: os dois trechos e o ponto do corte. */
export const SplitWallIcon = createLucideIcon('ArchSplitWall', [
  ['rect', { x: '2', y: '9', width: '8', height: '6', key: 'head' }],
  ['rect', { x: '14', y: '9', width: '8', height: '6', key: 'tail' }],
  ['path', { d: 'M12 4v16', strokeDasharray: '2.5 2.5', key: 'cut' }],
]);

/** Símbolo de cada categoria arquitetônica (faixa, navegador e painel de propriedades). */
export const ARCH_ICONS: Readonly<Record<ArchElementKind, LucideIcon>> = {
  wall: WallIcon,
  slab: SlabIcon,
  flooring: FlooringIcon,
  roof: RoofIcon,
  door: DoorIcon,
  window: WindowIcon,
  space: SpaceIcon,
};

/** Usado pela faixa, pelo navegador e pelo inspetor para manter o mesmo símbolo por tipo. */
export const ELEMENT_ICONS: Readonly<Record<HydroElement['kind'], LucideIcon>> = {
  pipe: PipeIcon,
  elbow: ElbowIcon,
  tee: TeeIcon,
  cross: CrossIcon,
  reducer: ReducerIcon,
  valve: ValveIcon,
  pump: PumpIcon,
  tank: TankIcon,
};
