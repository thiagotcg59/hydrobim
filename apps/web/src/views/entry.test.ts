import { describe, expect, it } from 'vitest';
import { entryPoint, parseEntry, snapViewPoint } from './entry';

describe('entrada numérica do desenho 2D', () => {
  it('lê ponto absoluto, deslocamento, polar e valor único, com vírgula decimal', () => {
    expect(parseEntry('2,5;1')).toEqual({ kind: 'absolute', point: { x: 2.5, y: 1 } });
    expect(parseEntry(' 3 -4.25 ')).toEqual({ kind: 'absolute', point: { x: 3, y: -4.25 } });
    expect(parseEntry('@1,2;0')).toEqual({ kind: 'relative', delta: { x: 1.2, y: 0 } });
    expect(parseEntry('3<90')).toEqual({ kind: 'polar', distance: 3, angle: Math.PI / 2 });
    expect(parseEntry('@2<45')).toEqual({ kind: 'polar', distance: 2, angle: Math.PI / 4 });
    expect(parseEntry('0,75')).toEqual({ kind: 'value', value: 0.75 });
  });

  it('recusa o que não é um ponto nem um valor', () => {
    for (const text of ['', '  ', 'abc', '1;2;3', '1<2<3', '@5', '1;x', '<30']) {
      expect(parseEntry(text)).toBeNull();
    }
  });

  it('resolve o ponto a partir do último ponto e do cursor', () => {
    const last = { x: 1, y: 1 };
    const absolute = parseEntry('4;5');
    const relative = parseEntry('@2;-1');
    const polar = parseEntry('2<90');
    const value = parseEntry('3');
    if (!absolute || !relative || !polar || !value) throw new Error('entradas válidas');
    expect(entryPoint(absolute, null, null)).toEqual({ x: 4, y: 5 });
    expect(entryPoint(relative, last, null)).toEqual({ x: 3, y: 0 });
    const turned = entryPoint(polar, last, null);
    expect(turned?.x).toBeCloseTo(1);
    expect(turned?.y).toBeCloseTo(3);
    // Um valor único segue a direção do cursor.
    expect(entryPoint(value, last, { x: 1, y: 9 })).toEqual({ x: 1, y: 4 });
    // Sem último ponto (ou sem direção) a entrada relativa não tem como ser aplicada.
    expect(entryPoint(relative, null, null)).toBeNull();
    expect(entryPoint(value, last, null)).toBeNull();
    expect(entryPoint(value, last, last)).toBeNull();
  });

  it('captura o ponto notável mais próximo, depois a grade, depois o ponto livre', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ];
    expect(snapViewPoint({ x: 1.96, y: 0.03 }, points, 0.1, 0.5)).toEqual({
      point: { x: 2, y: 0 },
      snap: 'point',
    });
    expect(snapViewPoint({ x: 1.2, y: 0.3 }, points, 0.1, 0.5)).toEqual({
      point: { x: 1, y: 0.5 },
      snap: 'grid',
    });
    expect(snapViewPoint({ x: 1.2, y: 0.3 }, points, 0.1, 0)).toEqual({
      point: { x: 1.2, y: 0.3 },
      snap: 'free',
    });
  });
});
