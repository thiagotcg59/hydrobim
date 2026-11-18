import { describe, expect, it } from 'vitest';
import { ndcRectFromPixels, verticesInsideRect } from './boxSelection';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const FULL = { minX: -1, minY: -1, maxX: 1, maxY: 1 };

describe('ndcRectFromPixels', () => {
  it('normaliza os cantos em qualquer ordem e inverte o eixo Y', () => {
    const rect = ndcRectFromPixels({ x: 300, y: 150 }, { x: 100, y: 50 }, 400, 200);
    expect(rect.minX).toBeCloseTo(-0.5);
    expect(rect.maxX).toBeCloseTo(0.5);
    expect(rect.minY).toBeCloseTo(-0.5);
    expect(rect.maxY).toBeCloseTo(0.5);
  });
});

describe('verticesInsideRect', () => {
  const rect = { minX: -0.5, minY: -0.5, maxX: 0.5, maxY: 0.5 };

  it('aceita a malha inteiramente contida no retângulo', () => {
    expect(verticesInsideRect([0, 0, 0, 0.4, -0.4, 0.2], IDENTITY, rect)).toBe(true);
  });

  it('recusa a malha com um vértice fora do retângulo', () => {
    expect(verticesInsideRect([0, 0, 0, 0.6, 0, 0], IDENTITY, rect)).toBe(false);
  });

  it('recusa a malha vazia', () => {
    expect(verticesInsideRect([], IDENTITY, FULL)).toBe(false);
  });

  it('aplica a matriz (translação na quarta coluna)', () => {
    const moved = [...IDENTITY];
    moved[12] = 0.8;
    expect(verticesInsideRect([0, 0, 0], moved, rect)).toBe(false);
    expect(verticesInsideRect([-0.8, 0, 0], moved, rect)).toBe(true);
  });

  it('recusa vértices atrás da câmera ou além dos planos de corte', () => {
    // Projeção em perspectiva mínima: w = −z (a câmera olha para −Z).
    const perspective = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0];
    expect(verticesInsideRect([0, 0, -1], perspective, FULL)).toBe(true);
    expect(verticesInsideRect([0, 0, 1], perspective, FULL)).toBe(false);
    expect(verticesInsideRect([0, 0, 2], IDENTITY, FULL)).toBe(false);
  });
});
