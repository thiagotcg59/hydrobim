import type { Vec3 } from '@hydrobim/core';

/**
 * Origem de renderização. A placa de vídeo e o SVG trabalham em precisão simples (cerca de 7
 * algarismos): com coordenadas de centenas de quilômetros — uma rede modelada diretamente em
 * UTM — os milímetros se perdem e a geometria treme. As vistas desenham, por isso, em relação a
 * um ponto próximo do que está sendo observado.
 *
 * É só apresentação: as coordenadas canônicas do projeto, os identificadores, a conectividade
 * e as exportações nunca passam por aqui. Tudo o que entra ou sai de uma vista (cliques, raios,
 * pontos capturados) é convertido por `toRender`/`toCanonical`.
 */

/** A origem fica em múltiplos deste passo (m), para que a grade de trabalho continue alinhada. */
export const RENDER_ORIGIN_STEP = 1000;
/**
 * Distância (m) do ponto observado à origem a partir da qual ela é reposicionada. A 5 km a
 * resolução da precisão simples é de 0,5 mm — a tolerância de acoplamento das portas.
 */
export const RENDER_ORIGIN_RANGE = 5000;

export const NO_RENDER_ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

const snap = (value: number): number => Math.round(value / RENDER_ORIGIN_STEP) * RENDER_ORIGIN_STEP;

/**
 * Origem para observar `focus`. Devolve a MESMA origem enquanto o ponto observado estiver
 * dentro do alcance, para que navegar pela rede não a troque a todo instante.
 */
export function nextRenderOrigin(current: Vec3, focus: Vec3): Vec3 {
  if (![focus.x, focus.y, focus.z].every(Number.isFinite)) return current;
  const far =
    Math.abs(focus.x - current.x) > RENDER_ORIGIN_RANGE ||
    Math.abs(focus.y - current.y) > RENDER_ORIGIN_RANGE ||
    Math.abs(focus.z - current.z) > RENDER_ORIGIN_RANGE;
  if (!far) return current;
  return { x: snap(focus.x), y: snap(focus.y), z: snap(focus.z) };
}

/** Coordenadas do projeto → coordenadas de desenho. */
export const toRender = (point: Vec3, origin: Vec3): Vec3 => ({
  x: point.x - origin.x,
  y: point.y - origin.y,
  z: point.z - origin.z,
});

/** Coordenadas de desenho → coordenadas do projeto. */
export const toCanonical = (point: Vec3, origin: Vec3): Vec3 => ({
  x: point.x + origin.x,
  y: point.y + origin.y,
  z: point.z + origin.z,
});
