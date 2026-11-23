import {
  formatMeters,
  getElement,
  resolvePort,
  type PortRef,
  type Project,
  type Vec3,
} from '@hydrobim/core';
import type { SnapKind } from './picking';

/**
 * Identificação do que o cursor capturou: tipo de snap, elemento, porta e cota. Função pura,
 * usada pelas duas vistas e pela barra de status, para que a indicação seja sempre a mesma.
 */

export const SNAP_LABELS: Record<SnapKind, string> = {
  port: 'Extremidade livre',
  grid: 'Grade',
  plane: 'Plano de trabalho',
  axis: 'Eixo da porta',
  vertical: 'Vertical',
  angle: 'Ângulo de catálogo',
  pipe: 'Tê automático no tubo',
  terrain: 'Terreno',
  ifc: 'Vértice de objeto IFC importado',
};

export interface SnapTarget {
  readonly snap: SnapKind;
  readonly point: Vec3;
  readonly port: PortRef | null;
  /** Elemento capturado (dono da porta ou tubo que receberá o tê). */
  readonly elementId?: string | null;
  /** Portas livres sob o cursor (mais de uma: Tab alterna). */
  readonly stacked?: number;
}

/** Rótulo curto da captura, ex.: `Extremidade livre · Tubo 3 · Fim · Z 2,70 m`. */
export function describeSnap(project: Project, target: SnapTarget): string {
  const parts: string[] = [SNAP_LABELS[target.snap]];
  const port = target.port ? resolvePort(project, target.port) : undefined;
  const element = getElement(project, target.port?.elementId ?? target.elementId ?? '');
  if (element) parts.push(element.name);
  if (port) parts.push(port.label);
  // A cota só é informação nova quando o ponto vem de um elemento (em pontos livres ela é
  // a do plano de trabalho, já mostrada nas coordenadas).
  if (element) parts.push(`Z ${formatMeters(target.point.z, 2)}`);
  if ((target.stacked ?? 1) > 1) parts.push(`${target.stacked} sobrepostas — Tab alterna`);
  return parts.join(' · ');
}
