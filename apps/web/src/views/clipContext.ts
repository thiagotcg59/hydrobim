import { createContext } from 'react';
import type { Plane } from 'three';

/**
 * Como a vista 3D aberta desenha os elementos: planos da caixa de corte (coordenadas da cena) e
 * estilo gráfico. É só apresentação — as malhas e o modelo são os mesmos.
 */
export interface ModelDisplay {
  /** Planos de corte aplicados aos materiais dos elementos; `null` = sem caixa de corte. */
  readonly planes: Plane[] | null;
  readonly wireframe: boolean;
}

export const DEFAULT_MODEL_DISPLAY: ModelDisplay = { planes: null, wireframe: false };

export const ModelDisplayContext = createContext<ModelDisplay>(DEFAULT_MODEL_DISPLAY);

/**
 * Planos da caixa de corte em vigor, para o apontamento: o que a caixa esconde não pode ser
 * selecionado através dela.
 */
let activePlanes: Plane[] | null = null;
export const setActiveClipPlanes = (planes: Plane[] | null): void => {
  activePlanes = planes;
};
export const getActiveClipPlanes = (): Plane[] | null => activePlanes;
