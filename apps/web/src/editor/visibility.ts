import { getFreePorts, type HydroElement, type Port, type Project } from '@hydrobim/core';

/**
 * Filtro de visibilidade comum às duas vistas: o que não é desenhado (sistema oculto) também
 * não é capturado, não recebe marcador e não entra no enquadramento.
 */

export function visibleElementsOf({
  elements,
  systems,
}: Pick<Project, 'elements' | 'systems'>): HydroElement[] {
  const hidden = new Set(systems.filter((s) => s.visible === false).map((s) => s.id));
  return hidden.size === 0 ? [...elements] : elements.filter((e) => !hidden.has(e.systemId));
}

/** Portas livres dos elementos visíveis: os alvos de conexão oferecidos ao cursor. */
export function visibleFreePortsOf(project: Project): Port[] {
  const shown = new Set(visibleElementsOf(project).map((element) => element.id));
  return getFreePorts(project).filter((port) => shown.has(port.ref.elementId));
}
