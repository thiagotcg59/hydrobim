import { degToRad, distance, vec3 } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import {
  deflectionTo,
  resolveSegmentEntry,
  riserTargets,
  type SegmentEntryContext,
} from './segmentEntry';

/** Trecho saindo de uma extremidade em (1, 1, 0,3), ao longo de +X, com o cursor a nordeste. */
const fromPort: SegmentEntryContext = {
  anchor: vec3(1, 1, 0.3),
  axis: vec3(1, 0, 0),
  cursor: vec3(3, 2, 0.3),
};
const free: SegmentEntryContext = { anchor: vec3(0, 0, 0), axis: null, cursor: vec3(3, 4, 0) };

const point = (context: SegmentEntryContext, entry: Parameters<typeof resolveSegmentEntry>[1]) => {
  const result = resolveSegmentEntry(context, entry);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
const code = (context: SegmentEntryContext, entry: Parameters<typeof resolveSegmentEntry>[1]) => {
  const result = resolveSegmentEntry(context, entry);
  return result.ok ? null : result.error.code;
};

describe('entrada dinâmica do trecho', () => {
  it('comprimento na direção do cursor', () => {
    const end = point(free, { length: 2.5 });
    expect(end.x).toBeCloseTo(1.5);
    expect(end.y).toBeCloseTo(2);
    expect(end.z).toBe(0);
  });

  it('comprimento e ângulo: gira a direção de partida para o lado do cursor', () => {
    const left = point(fromPort, { length: 2, deflection: degToRad(90) });
    expect(left.x).toBeCloseTo(1);
    expect(left.y).toBeCloseTo(3);
    const right = point(
      { ...fromPort, cursor: vec3(3, -2, 0.3) },
      { length: 2, deflection: degToRad(45) },
    );
    expect(right.x).toBeCloseTo(1 + Math.SQRT2);
    expect(right.y).toBeCloseTo(1 - Math.SQRT2);
    // Ângulo zero: prolongamento reto, qualquer que seja o cursor.
    expect(point(fromPort, { length: 2, deflection: 0 })).toEqual(vec3(3, 1, 0.3));
    expect(deflectionTo(fromPort, left)).toBeCloseTo(Math.PI / 2);
  });

  it('deslocamentos relativos, com desnível opcional', () => {
    expect(point(fromPort, { dx: 2, dy: -1 })).toEqual(vec3(3, 0, 0.3));
    expect(point(fromPort, { dx: 2, dz: 0.5 })).toEqual(vec3(3, 1, 0.8));
    expect(point(fromPort, { dx: 3, dy: 4, finalZ: 1 })).toEqual(vec3(4, 5, 1));
    // Declividade aplicada à projeção horizontal do deslocamento (5 m).
    expect(point(fromPort, { dx: 3, dy: 4, slope: -0.02 }).z).toBeCloseTo(0.2);
  });

  it('só o desnível: prumada no ponto de partida', () => {
    expect(point(fromPort, { finalZ: 3 })).toEqual(vec3(1, 1, 3));
    expect(point(fromPort, { dz: -0.3 })).toEqual(vec3(1, 1, 0));
  });

  it('separa comprimento real, projeção e desnível', () => {
    // Comprimento real 5 com desnível 3: projeção 4.
    const sloped = point(free, { length: 5, dz: 3 });
    expect(Math.hypot(sloped.x, sloped.y)).toBeCloseTo(4);
    expect(sloped.z).toBeCloseTo(3);
    expect(distance(free.anchor, sloped)).toBeCloseTo(5);
    // Projeção 4 com cota final 3: comprimento real 5.
    const projected = point(free, { horizontal: 4, finalZ: 3 });
    expect(distance(free.anchor, projected)).toBeCloseTo(5);
  });

  it('declividade: 1 % em 10 m de projeção desce 0,10 m', () => {
    const end = point(free, { horizontal: 10, slope: -0.01 });
    expect(Math.hypot(end.x, end.y)).toBeCloseTo(10);
    expect(end.z).toBeCloseTo(-0.1);
    // Com o comprimento real, a projeção é L / √(1 + i²).
    const real = point(free, { length: 10, slope: 0.75 });
    expect(Math.hypot(real.x, real.y)).toBeCloseTo(8);
    expect(real.z).toBeCloseTo(6);
  });

  it('recusa entradas incompletas, conflitantes ou impossíveis', () => {
    expect(code(free, {})).toBe('INCOMPLETE_ENTRY');
    expect(code(free, { slope: 0.01 })).toBe('INCOMPLETE_ENTRY');
    expect(code(free, { deflection: 1, finalZ: 2 })).toBe('INCOMPLETE_ENTRY');
    expect(code(free, { length: 2, dz: 1, slope: 0.1 })).toBe('CONFLICTING_ENTRY');
    expect(code(free, { length: 2, dx: 1 })).toBe('CONFLICTING_ENTRY');
    expect(code(free, { length: 1, dz: 2 })).toBe('LENGTH_SHORTER_THAN_RISE');
    expect(code(free, { length: 0 })).toBe('INVALID_ENTRY');
    expect(code(free, { length: Number.NaN })).toBe('INVALID_ENTRY');
    // Ângulo sem extremidade de partida; e ângulo sem lado indicado.
    expect(code(free, { length: 2, deflection: 1 })).toBe('NO_REFERENCE_AXIS');
    expect(code({ ...fromPort, cursor: vec3(4, 1, 0.3) }, { length: 2, deflection: 1 })).toBe(
      'NO_DIRECTION',
    );
    expect(code({ anchor: vec3(0, 0, 0), axis: null, cursor: null }, { length: 2 })).toBe(
      'NO_DIRECTION',
    );
    // Cursor na vertical: não há direção horizontal para combinar com o desnível.
    expect(code({ ...free, cursor: vec3(0, 0, 2) }, { length: 5, dz: 3 })).toBe('NO_DIRECTION');
  });
});

describe('destinos de subir e descer por pavimento', () => {
  const levels = [
    { id: 't', name: 'Térreo', elevation: 0 },
    { id: 'p1', name: '1º pavimento', elevation: 3 },
    { id: 'c', name: 'Cobertura', elevation: 6 },
  ];

  it('leva o eixo à mesma altura acima do piso no pavimento vizinho', () => {
    const { up, down } = riserTargets(levels, 3.3, 0.3);
    expect(up).toMatchObject({ z: 6.3, levelId: 'c', levelName: 'Cobertura' });
    expect(down).toMatchObject({ z: 0.3, levelId: 't' });
  });

  it('considera a cota atual do eixo, não só o nível ativo', () => {
    // Eixo a meia altura do térreo: subir chega ao teto do próprio pavimento de referência.
    const { up, down } = riserTargets(levels, 1.5, 2.7);
    expect(up?.z).toBeCloseTo(2.7);
    expect(down).toBeNull();
  });

  it('sem pavimento naquele sentido, não há destino', () => {
    expect(riserTargets(levels, 6.3, 0.3).up).toBeNull();
    expect(riserTargets([levels[0]!], 0.3, 0.3)).toEqual({ up: null, down: null });
  });
});
