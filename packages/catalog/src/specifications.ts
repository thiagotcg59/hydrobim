import type { Discipline, JointType, Material } from '@hydrobim/core';
import {
  AMANCO_PVC_COLD_BENDING,
  DUCTILE_IRON_JGS_DEFLECTION,
  PEAD_COLD_BENDING,
  TIGRE_DEFOFO_COLD_BENDING,
  type ColdBending,
  type JointDeflectionTable,
} from './jointDeflection';

/**
 * Catálogo de especificações dimensionais de tubos.
 *
 * AVISO DE ENGENHARIA: os valores abaixo são dimensões nominais de referência das
 * normas indicadas, incluídos para viabilizar a modelagem. Devem ser conferidos com a
 * edição vigente da norma e com o catálogo do fabricante antes do uso em projeto.
 * Tolerâncias de fabricação não são representadas.
 */

export interface CatalogSize {
  /** Diâmetro nominal (designação adimensional da norma). */
  readonly dn: number;
  /** Designação comercial apresentada ao usuário. */
  readonly label: string;
  readonly outerDiameterMm: number;
  readonly wallThicknessMm: number;
}

export interface PipeSpecification {
  readonly id: string;
  readonly name: string;
  readonly material: Material;
  readonly standard: string;
  readonly jointType: JointType;
  readonly pressureClass: string | null;
  /** Ambientes em que a especificação é oferecida por padrão. */
  readonly disciplines: readonly Discipline[];
  readonly sizes: readonly CatalogSize[];
  /**
   * Deflexão angular admitida em cada junta, com a fonte. Ausente = junta rígida (soldada,
   * por termofusão) ou valor não levantado: nenhuma deflexão é aceita.
   */
  readonly jointDeflection?: JointDeflectionTable;
  /**
   * Curvatura a frio do próprio tubo, com a fonte. Ausente = o tubo não é curvado (ou o
   * valor não foi levantado).
   */
  readonly coldBending?: ColdBending;
}

const size = (dn: number, label: string, od: number, wall: number): CatalogSize => ({
  dn,
  label,
  outerDiameterMm: od,
  wallThicknessMm: wall,
});

export const SPECIFICATIONS: readonly PipeSpecification[] = [
  {
    id: 'pvc-soldavel-nbr5648',
    name: 'PVC rígido soldável — água fria predial',
    material: 'pvc',
    standard: 'ABNT NBR 5648',
    jointType: 'solventWeld',
    pressureClass: 'PN 7,5',
    disciplines: ['mep'],
    // Série soldável: a designação comercial é o diâmetro externo (DE).
    sizes: [
      size(15, 'DE 20 (DN 15)', 20, 1.5),
      size(20, 'DE 25 (DN 20)', 25, 1.7),
      size(25, 'DE 32 (DN 25)', 32, 2.1),
      size(32, 'DE 40 (DN 32)', 40, 2.4),
      size(40, 'DE 50 (DN 40)', 50, 3.0),
      size(50, 'DE 60 (DN 50)', 60, 3.3),
      size(65, 'DE 75 (DN 65)', 75, 4.2),
      size(75, 'DE 85 (DN 75)', 85, 4.7),
      size(100, 'DE 110 (DN 100)', 110, 6.1),
    ],
  },
  {
    id: 'pvc-pba-nbr5647-cl12',
    name: 'PVC PBA junta elástica — classe 12',
    material: 'pvc',
    standard: 'ABNT NBR 5647',
    jointType: 'socketSpigot',
    coldBending: AMANCO_PVC_COLD_BENDING,
    pressureClass: 'Classe 12 (0,60 MPa)',
    disciplines: ['infra'],
    // Fonte: Amanco Wavin (FT Linha PBA, FTC000088, jan/2025, p. 14).
    sizes: [
      size(50, 'DN 50 (DE 60)', 60, 2.7),
      size(75, 'DN 75 (DE 85)', 85, 3.9),
      size(100, 'DN 100 (DE 110)', 110, 5.0),
    ],
  },
  {
    id: 'pvc-pba-nbr5647-cl15',
    name: 'PVC PBA junta elástica — classe 15',
    material: 'pvc',
    standard: 'ABNT NBR 5647',
    jointType: 'socketSpigot',
    coldBending: AMANCO_PVC_COLD_BENDING,
    pressureClass: 'Classe 15 (0,75 MPa)',
    disciplines: ['infra'],
    // Fonte: Tigre (Catálogo Infraestrutura 07/2025) e Amanco Wavin (FT Linha PBA, jan/2025).
    sizes: [
      size(50, 'DN 50 (DE 60)', 60, 3.3),
      size(75, 'DN 75 (DE 85)', 85, 4.7),
      size(100, 'DN 100 (DE 110)', 110, 6.1),
    ],
  },
  {
    id: 'pvc-pba-nbr5647-cl20',
    name: 'PVC PBA junta elástica — classe 20',
    material: 'pvc',
    standard: 'ABNT NBR 5647',
    jointType: 'socketSpigot',
    coldBending: AMANCO_PVC_COLD_BENDING,
    pressureClass: 'Classe 20 (1,0 MPa)',
    disciplines: ['infra'],
    sizes: [
      size(50, 'DN 50 (DE 60)', 60, 4.3),
      size(75, 'DN 75 (DE 85)', 85, 6.1),
      size(100, 'DN 100 (DE 110)', 110, 7.8),
    ],
  },
  {
    id: 'pvc-defofo-nbr7665',
    name: 'PVC DEFoFo junta elástica — 1 MPa',
    material: 'pvc',
    standard: 'ABNT NBR 7665',
    jointType: 'socketSpigot',
    coldBending: TIGRE_DEFOFO_COLD_BENDING,
    pressureClass: 'PN 1 MPa',
    disciplines: ['infra'],
    // Fonte: Tigre MPVC DEFoFo (Catálogo Infraestrutura 07/2025, p. 15). Diâmetros externos
    // iguais aos do ferro fundido dúctil.
    sizes: [
      size(100, 'DN 100', 118, 4.8),
      size(150, 'DN 150', 170, 6.8),
      size(200, 'DN 200', 222, 8.9),
      size(250, 'DN 250', 274, 11.0),
      size(300, 'DN 300', 326, 13.1),
      size(350, 'DN 350', 378, 15.2),
      size(400, 'DN 400', 429, 17.2),
      size(500, 'DN 500', 532, 21.3),
    ],
  },
  {
    id: 'aco-carbono-b3610-sch40',
    name: 'Aço-carbono — Schedule 40',
    material: 'carbonSteel',
    standard: 'ASME B36.10M',
    jointType: 'buttWeld',
    pressureClass: 'SCH 40',
    disciplines: ['mep', 'infra'],
    sizes: [
      size(15, 'DN 15 (½")', 21.3, 2.77),
      size(20, 'DN 20 (¾")', 26.7, 2.87),
      size(25, 'DN 25 (1")', 33.4, 3.38),
      size(32, 'DN 32 (1¼")', 42.2, 3.56),
      size(40, 'DN 40 (1½")', 48.3, 3.68),
      size(50, 'DN 50 (2")', 60.3, 3.91),
      size(65, 'DN 65 (2½")', 73.0, 5.16),
      size(80, 'DN 80 (3")', 88.9, 5.49),
      size(100, 'DN 100 (4")', 114.3, 6.02),
      size(150, 'DN 150 (6")', 168.3, 7.11),
      size(200, 'DN 200 (8")', 219.1, 8.18),
      size(250, 'DN 250 (10")', 273.0, 9.27),
      size(300, 'DN 300 (12")', 323.8, 10.31),
    ],
  },
  {
    id: 'ferro-ductil-nbr7675-k9',
    name: 'Ferro fundido dúctil — classe K9',
    material: 'ductileIron',
    standard: 'ABNT NBR 7675 / ISO 2531',
    jointType: 'socketSpigot',
    jointDeflection: DUCTILE_IRON_JGS_DEFLECTION,
    pressureClass: 'K9',
    disciplines: ['infra', 'mep'],
    sizes: [
      size(80, 'DN 80', 98, 6.0),
      size(100, 'DN 100', 118, 6.0),
      size(150, 'DN 150', 170, 6.0),
      size(200, 'DN 200', 222, 6.3),
      size(250, 'DN 250', 274, 6.8),
      size(300, 'DN 300', 326, 7.2),
      size(350, 'DN 350', 378, 7.7),
      size(400, 'DN 400', 429, 8.1),
      size(500, 'DN 500', 532, 9.0),
      size(600, 'DN 600', 635, 9.9),
    ],
  },
  {
    id: 'pead-pe100-sdr11',
    name: 'PEAD PE 100 — SDR 11',
    material: 'hdpe',
    standard: 'ABNT NBR 15561 / ISO 4427',
    jointType: 'buttFusion',
    coldBending: PEAD_COLD_BENDING,
    pressureClass: 'PN 16 (SDR 11)',
    disciplines: ['infra', 'mep'],
    // Em polietileno o diâmetro nominal é o próprio diâmetro externo (DN/DE).
    sizes: [
      size(20, 'DE 20', 20, 2.0),
      size(25, 'DE 25', 25, 2.3),
      size(32, 'DE 32', 32, 3.0),
      size(40, 'DE 40', 40, 3.7),
      size(50, 'DE 50', 50, 4.6),
      size(63, 'DE 63', 63, 5.8),
      size(75, 'DE 75', 75, 6.8),
      size(90, 'DE 90', 90, 8.2),
      size(110, 'DE 110', 110, 10.0),
      size(160, 'DE 160', 160, 14.6),
      size(200, 'DE 200', 200, 18.2),
      size(250, 'DE 250', 250, 22.7),
      size(315, 'DE 315', 315, 28.6),
    ],
  },
];
