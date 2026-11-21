import type { Material } from '@hydrobim/core';
import type { PartRole } from './elements';

/**
 * Biblioteca de materiais de apresentação, compartilhada pelas vistas do editor e pela
 * exportação IFC (o arquivo sai com as mesmas cores da tela).
 *
 * Cada entrada é a aparência usual de um material em obra — cor, rugosidade e metalicidade
 * de um material físico (PBR). É dado de apresentação, não de catálogo: nenhuma dimensão
 * ou propriedade de engenharia sai daqui.
 *
 * Para reaproveitar em uma família nova: a geometria (`@hydrobim/geometry`) marca cada parte
 * com um `PartRole`, e `ROLE_FINISH` abaixo diz qual acabamento o papel usa. Um material que
 * ainda não existe entra em `FINISHES` e ganha um papel em `PartRole`; não se escolhe cor
 * diretamente na geometria nem no componente.
 */
export interface SurfaceFinish {
  /** Nome exibível, em português. */
  readonly label: string;
  readonly color: string;
  /** 0 = espelhado, 1 = fosco. */
  readonly roughness: number;
  /** 0 = dielétrico (plástico, tinta, borracha), 1 = metal. */
  readonly metalness: number;
  /** 1 (ou ausente) = opaco; menor que 1 = translúcido (vidro). */
  readonly opacity?: number;
}

export const FINISHES = {
  /** PVC marrom de água fria (soldável, PBA). */
  pvcBrown: { label: 'PVC marrom', color: '#6e4a36', roughness: 0.4, metalness: 0 },
  /** PEAD preto, superfície lisa. */
  hdpeBlack: { label: 'PEAD preto', color: '#141518', roughness: 0.32, metalness: 0 },
  /** Ferro fundido dúctil com pintura betuminosa preta, fosca. */
  bitumenIron: {
    label: 'Ferro dúctil betumado',
    color: '#34373c',
    roughness: 0.75,
    metalness: 0.15,
  },
  /** Aço-carbono aparente (tubos). */
  carbonSteel: { label: 'Aço-carbono', color: '#8b9197', roughness: 0.42, metalness: 0.85 },
  /** Aço aparente de reservatórios e estruturas. */
  bareSteel: { label: 'Aço aparente', color: '#9aa1a8', roughness: 0.42, metalness: 0.85 },
  /** Aço inoxidável: hastes, parafusos, acessórios. */
  stainless: { label: 'Aço inoxidável', color: '#cdd2d7', roughness: 0.28, metalness: 0.9 },
  /** Chapa corrugada galvanizada. */
  galvanized: { label: 'Aço galvanizado', color: '#b6bcc2', roughness: 0.5, metalness: 0.8 },
  /** Ferro fundido com a pintura cinza-azulada do fabricante (filtro Y Spirax Sarco CI). */
  paintedCastIron: {
    label: 'Ferro fundido pintado',
    color: '#93a0ae',
    roughness: 0.6,
    metalness: 0.1,
  },
  /** Revestimento epóxi azul de válvulas de controle: película lisa, sem aspecto metálico. */
  blueEpoxy: { label: 'Epóxi azul', color: '#1f5fc4', roughness: 0.35, metalness: 0.05 },
  /** Revestimento interno azul de reservatórios. */
  blueLiner: { label: 'Revestimento interno azul', color: '#1e63c8', roughness: 0.6, metalness: 0 },
  /** Pintura clara de acabamento de reservatórios metálicos. */
  lightPaint: { label: 'Pintura clara', color: '#eef1f4', roughness: 0.5, metalness: 0.05 },
  /** Vermelho de acionamentos (volantes, alavancas). */
  actuatorRed: {
    label: 'Acionamento vermelho',
    color: '#d9534a',
    roughness: 0.45,
    metalness: 0.05,
  },
  /** Anéis de vedação em borracha EPDM. */
  epdmRubber: { label: 'Borracha EPDM', color: '#1b1c1f', roughness: 0.85, metalness: 0 },
  // Arquitetura: aparência genérica por categoria (não descreve o material das camadas).
  wallBody: { label: 'Parede', color: '#d9d4c7', roughness: 0.9, metalness: 0 },
  slabBody: { label: 'Laje', color: '#a9aaa8', roughness: 0.85, metalness: 0 },
  floorFinish: { label: 'Revestimento de piso', color: '#c9b79a', roughness: 0.6, metalness: 0 },
  doorPanel: { label: 'Folha de porta', color: '#8a6747', roughness: 0.55, metalness: 0 },
  joineryFrame: { label: 'Marco de esquadria', color: '#eceef0', roughness: 0.45, metalness: 0.1 },
  glazing: { label: 'Vidro', color: '#9cc9df', roughness: 0.08, metalness: 0, opacity: 0.35 },
} as const satisfies Record<string, SurfaceFinish>;

export type FinishName = keyof typeof FINISHES;

/** Acabamento do corpo (`body`), conforme o material da especificação do tubo. */
export const MATERIAL_FINISH: Record<Material, FinishName> = {
  pvc: 'pvcBrown',
  hdpe: 'hdpeBlack',
  ductileIron: 'bitumenIron',
  carbonSteel: 'carbonSteel',
};

/** Acabamento de cada papel de parte; `body` segue o material do tubo. */
export const ROLE_FINISH: Record<Exclude<PartRole, 'body'>, FinishName> = {
  accent: 'actuatorRed',
  trim: 'stainless',
  seal: 'epdmRubber',
  coated: 'blueEpoxy',
  castIron: 'paintedCastIron',
  paint: 'lightPaint',
  steel: 'bareSteel',
  galvanized: 'galvanized',
  liner: 'blueLiner',
  wall: 'wallBody',
  slab: 'slabBody',
  flooring: 'floorFinish',
  joinery: 'doorPanel',
  frame: 'joineryFrame',
  glass: 'glazing',
};

/**
 * Papéis que mantêm a própria cor mesmo quando o sistema hidráulico tem cor definida:
 * identificam uma função (acionamento, vedação, acessório, revestimento interno), não a rede.
 */
const FIXED_COLOR_ROLES: ReadonlySet<PartRole> = new Set([
  'accent',
  'trim',
  'seal',
  'liner',
  'wall',
  'slab',
  'flooring',
  'joinery',
  'frame',
  'glass',
]);

/** Acabamento de uma parte; a cor do sistema, se houver, substitui apenas a cor. */
export function partFinish(
  role: PartRole,
  material: Material,
  colorOverride?: string,
): SurfaceFinish {
  const finish = FINISHES[role === 'body' ? MATERIAL_FINISH[material] : ROLE_FINISH[role]];
  if (colorOverride === undefined || FIXED_COLOR_ROLES.has(role)) return finish;
  return { ...finish, color: colorOverride };
}
