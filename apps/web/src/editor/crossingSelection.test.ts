import { describe, expect, it } from 'vitest';
import {
  NO_FILTER,
  passesFilter,
  rectOf,
  segmentTouchesRect,
  shapeInsideRect,
  shapeSelected,
  shapeTouchesRect,
  windowModeOf,
  type ScreenShape,
} from './crossingSelection';

const rect = rectOf({ x: 10, y: 10 }, { x: 0, y: 0 });

/** Tubo comprido em planta: retângulo fino de (−5, 4) a (15, 6), em dois triângulos. */
const pipe: ScreenShape = {
  points: [-5, 4, 15, 4, 15, 6, -5, 6],
  triangles: [0, 1, 2, 0, 2, 3],
};
/** Peça pequena inteiramente dentro da janela. */
const fitting: ScreenShape = { points: [2, 2, 4, 2, 3, 4], triangles: [0, 1, 2] };
/** Elemento grande que envolve a janela sem ter vértice nem aresta dentro dela. */
const tank: ScreenShape = { points: [-100, -100, 200, -100, 50, 300], triangles: [0, 1, 2] };
const far: ScreenShape = { points: [30, 30, 40, 30, 35, 40], triangles: [0, 1, 2] };

describe('seleção por janela', () => {
  it('o sentido do arrasto define o modo', () => {
    expect(windowModeOf(100, 300)).toBe('contain');
    expect(windowModeOf(300, 100)).toBe('cross');
    expect(rect).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('contenção: só o que está inteiramente dentro', () => {
    expect(shapeInsideRect(fitting, rect)).toBe(true);
    expect(shapeInsideRect(pipe, rect)).toBe(false);
    expect(shapeInsideRect({ points: [] }, rect)).toBe(false);
    expect(shapeSelected(pipe, rect, 'contain')).toBe(false);
  });

  it('cruzamento: o que a janela toca, mesmo sem vértice dentro', () => {
    // O tubo atravessa a janela: nenhum vértice dentro, mas as arestas cruzam.
    expect(shapeTouchesRect(pipe, rect)).toBe(true);
    expect(shapeTouchesRect(fitting, rect)).toBe(true);
    // A janela cai dentro de uma face do elemento.
    expect(shapeTouchesRect(tank, rect)).toBe(true);
    expect(shapeTouchesRect(far, rect)).toBe(false);
    expect(shapeSelected(pipe, rect, 'cross')).toBe(true);
  });

  it('desenho de linhas (planta): cruza por segmentos', () => {
    const axis: ScreenShape = { points: [-5, 5, 15, 5], segments: [0, 1] };
    expect(shapeTouchesRect(axis, rect)).toBe(true);
    const outside: ScreenShape = { points: [-5, 12, 15, 12], segments: [0, 1] };
    expect(shapeTouchesRect(outside, rect)).toBe(false);
    // Sem segmentos nem triângulos, vale a nuvem de pontos.
    expect(shapeTouchesRect({ points: [-5, 5, 15, 5] }, rect)).toBe(false);
  });

  it('interseção de segmento com retângulo', () => {
    expect(segmentTouchesRect(rect, -5, -5, 15, 15)).toBe(true);
    expect(segmentTouchesRect(rect, -5, 5, -1, 5)).toBe(false);
    // Tangente à borda conta como toque; paralelo e fora, não.
    expect(segmentTouchesRect(rect, -5, 10, 15, 10)).toBe(true);
    expect(segmentTouchesRect(rect, -5, 10.01, 15, 10.01)).toBe(false);
    expect(segmentTouchesRect(rect, 11, -5, 20, 5)).toBe(false);
  });

  it('filtros por categoria e por sistema', () => {
    const valve = { kind: 'valve', systemId: 'af' };
    expect(passesFilter(valve, NO_FILTER)).toBe(true);
    expect(passesFilter(valve, { kinds: new Set(['pipe']), systemIds: null })).toBe(false);
    expect(passesFilter(valve, { kinds: new Set(['valve']), systemIds: new Set(['af']) })).toBe(
      true,
    );
    expect(passesFilter(valve, { kinds: null, systemIds: new Set(['inc']) })).toBe(false);
  });
});
