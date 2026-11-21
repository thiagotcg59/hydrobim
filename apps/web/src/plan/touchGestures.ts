/**
 * Gestos de toque da planta: pinça (zoom e deslocamento com dois dedos) e toque longo.
 * Só a matemática fica aqui; a planta trata os eventos.
 *
 * Posições de tela em pixels, relativas ao centro da planta, com Y para baixo — a mesma
 * convenção da roda do mouse: o ponto do modelo sob a tela é (cx + px·mpp, cy − py·mpp).
 */

export interface PlanWindow {
  /** Metros do modelo por pixel de tela. */
  readonly mpp: number;
  readonly cx: number;
  readonly cy: number;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** Tempo (ms) do dedo parado para o toque longo abrir o menu do botão direito. */
export const LONG_PRESS_MS = 550;

/** Movimento (px) abaixo do qual um toque ainda é toque, não arrasto: o dedo treme mais que o mouse. */
export const TOUCH_TOLERANCE_PX = 10;

/** Menor afastamento entre os dois dedos (px) usado na escala, contra saltos com dedos juntos. */
const MIN_SPAN_PX = 24;

/**
 * Janela da planta durante a pinça: a escala segue a razão entre as distâncias dos dedos e o
 * ponto do modelo que estava sob o ponto médio inicial acompanha o ponto médio atual (zoom e
 * deslocamento no mesmo gesto). `maxMpp` é o afastamento máximo do ambiente.
 */
export function pinchWindow(
  start: PlanWindow,
  a0: ScreenPoint,
  b0: ScreenPoint,
  a1: ScreenPoint,
  b1: ScreenPoint,
  maxMpp: number,
): PlanWindow {
  const span0 = Math.max(Math.hypot(b0.x - a0.x, b0.y - a0.y), MIN_SPAN_PX);
  const span1 = Math.max(Math.hypot(b1.x - a1.x, b1.y - a1.y), MIN_SPAN_PX);
  const mpp = Math.min(maxMpp, Math.max(1e-5, (start.mpp * span0) / span1));
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  // Ponto do modelo sob o ponto médio no início do gesto.
  const mx = start.cx + m0.x * start.mpp;
  const my = start.cy - m0.y * start.mpp;
  return { mpp, cx: mx - m1.x * mpp, cy: my + m1.y * mpp };
}
