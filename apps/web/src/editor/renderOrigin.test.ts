import { vec3 } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import {
  nextRenderOrigin,
  NO_RENDER_ORIGIN,
  RENDER_ORIGIN_RANGE,
  RENDER_ORIGIN_STEP,
  toCanonical,
  toRender,
} from './renderOrigin';

/** Menor passo representável em precisão simples em torno de `value`. */
const float32Step = (value: number): number => {
  const rounded = Math.fround(value);
  const view = new Float32Array([rounded]);
  const bits = new Uint32Array(view.buffer);
  bits[0] = (bits[0] ?? 0) + 1;
  return Math.abs((view[0] ?? rounded) - rounded);
};

describe('origem de renderização', () => {
  it('não muda enquanto o ponto observado está dentro do alcance', () => {
    const origin = vec3(333_000, 7_395_000, 1000);
    expect(nextRenderOrigin(origin, vec3(335_500, 7_391_000, 760))).toBe(origin);
    expect(nextRenderOrigin(NO_RENDER_ORIGIN, vec3(12, -40, 3))).toBe(NO_RENDER_ORIGIN);
  });

  it('é reposicionada em múltiplos do passo quando o ponto observado se afasta', () => {
    const next = nextRenderOrigin(NO_RENDER_ORIGIN, vec3(333_287.02, 7_394_586.09, 760.4));
    expect(next).toEqual(vec3(333_000, 7_395_000, 1000));
    for (const value of [next.x, next.y, next.z]) expect(value % RENDER_ORIGIN_STEP).toBe(0);
  });

  it('ignora pontos não finitos', () => {
    expect(nextRenderOrigin(NO_RENDER_ORIGIN, vec3(Number.NaN, 0, 0))).toBe(NO_RENDER_ORIGIN);
  });

  it('a conversão de ida e volta devolve exatamente as coordenadas do projeto', () => {
    const origin = vec3(333_000, 7_395_000, 1000);
    // Coordenadas com milímetros, como as de uma rede em UTM.
    for (const point of [
      vec3(333_287.021, 7_394_586.093, 760.125),
      vec3(336_412.5, 7_398_001.25, 812.75),
      vec3(0, 0, 0),
    ]) {
      expect(toCanonical(toRender(point, origin), origin)).toEqual(point);
    }
  });

  it('coordenadas de desenho cabem na precisão simples com folga; as do projeto, não', () => {
    const point = vec3(333_287.021, 7_394_586.093, 760.125);
    // Sem origem deslocada, o norte UTM é representado em passos de meio metro.
    expect(float32Step(point.y)).toBe(0.5);
    const origin = nextRenderOrigin(NO_RENDER_ORIGIN, point);
    const local = toRender(point, origin);
    // Dentro do alcance, o passo fica abaixo da tolerância de acoplamento das portas (0,5 mm).
    for (const value of [local.x, local.y, local.z]) {
      expect(Math.abs(value)).toBeLessThanOrEqual(RENDER_ORIGIN_RANGE);
      expect(float32Step(value)).toBeLessThan(5e-4);
    }
    expect(float32Step(RENDER_ORIGIN_RANGE)).toBeLessThanOrEqual(5e-4);
  });
});
