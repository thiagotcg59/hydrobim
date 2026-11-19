import type { Vec3 } from '@hydrobim/core';

/**
 * Vistas predefinidas do modelo 3D e ponto de interesse compartilhado entre as vistas.
 * Sem Three.js nem React: as direções e as conversões de enquadramento são testáveis.
 */

/** Quadrantes da isométrica: posição do observador em relação ao modelo (Y = norte). */
export const ISO_QUADRANTS = ['isoSE', 'isoSW', 'isoNW', 'isoNE'] as const;
export type IsoQuadrant = (typeof ISO_QUADRANTS)[number];
export type ViewPreset = 'fit' | 'iso' | 'top' | 'front' | IsoQuadrant;

export const ISO_LABELS: Record<IsoQuadrant, string> = {
  isoSE: 'sudeste',
  isoSW: 'sudoeste',
  isoNW: 'noroeste',
  isoNE: 'nordeste',
};

/**
 * Direção do alvo para a câmera. A isométrica verdadeira olha ao longo da diagonal do cubo
 * (±1, ±1, 1): os três eixos aparecem com o mesmo encurtamento e a 120° entre si. `iso` é a
 * vista em perspectiva de três quartos, mantida como comando separado.
 */
export const VIEW_DIRECTIONS: Record<
  Exclude<ViewPreset, 'fit'>,
  readonly [number, number, number]
> = {
  iso: [1, -1.25, 0.9],
  top: [0, -0.0001, 1],
  front: [0, -1, 0],
  isoSE: [1, -1, 1],
  isoSW: [-1, -1, 1],
  isoNW: [-1, 1, 1],
  isoNE: [1, 1, 1],
};

export const isIsoQuadrant = (preset: ViewPreset | null | undefined): preset is IsoQuadrant =>
  (ISO_QUADRANTS as readonly string[]).includes(preset ?? '');

/** Próximo quadrante (giro no sentido horário visto de cima); fora da isométrica, o sudeste. */
export function nextIsoQuadrant(current: ViewPreset | null | undefined): IsoQuadrant {
  if (!isIsoQuadrant(current)) return 'isoSE';
  return ISO_QUADRANTS[(ISO_QUADRANTS.indexOf(current) + 1) % ISO_QUADRANTS.length] ?? 'isoSE';
}

/**
 * Ponto de interesse da vista: o centro observado e a metade da altura visível (m). É o que
 * a planta e o modelo 3D trocam ao alternar, para que o usuário continue olhando o mesmo
 * trecho da rede na mesma ampliação.
 */
export interface ViewFocus {
  readonly center: Vec3;
  readonly halfHeight: number;
}

let focus: ViewFocus | null = null;
/** Direção do alvo para a câmera 3D, preservada ao trocar a projeção. */
let direction: Vec3 | null = null;

export const getViewFocus = (): ViewFocus | null => focus;
export const getViewDirection = (): Vec3 | null => direction;

export function setViewFocus(next: ViewFocus, towardCamera?: Vec3): void {
  if (!Number.isFinite(next.halfHeight) || next.halfHeight <= 0) return;
  focus = next;
  if (towardCamera) direction = towardCamera;
}

/** Esquece o ponto de interesse (projeto novo ou aberto: a vista volta a enquadrar tudo). */
export function clearViewFocus(): void {
  focus = null;
  direction = null;
}

/** Metros do modelo por pixel da planta que mostram `halfHeight` em uma vista de `height` px. */
export const planScaleFor = (halfHeight: number, height: number): number =>
  (2 * halfHeight) / Math.max(height, 1);

/** Distância da câmera em perspectiva (campo de visão vertical `fov`, rad) para ver `halfHeight`. */
export const perspectiveDistanceFor = (halfHeight: number, fov: number): number =>
  halfHeight / Math.tan(fov / 2);

/** Zoom da câmera ortográfica (px por metro) para ver `halfHeight` em uma vista de `height` px. */
export const orthographicZoomFor = (halfHeight: number, height: number): number =>
  Math.max(height, 1) / (2 * halfHeight);
