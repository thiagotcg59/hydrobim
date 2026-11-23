import { describe, expect, it } from 'vitest';
import { featureEdges, projectEdges, sectionSegments } from './meshEdges';
import type { OutlineFrame } from './viewOutline';

/** Caixa 2 × 1 × 3 com vértices repetidos por face, como nas malhas de IFC. */
function box(): { positions: Float32Array; indices: Uint32Array } {
  const [x, y, z] = [2, 1, 3];
  const quads: [number, number, number][][] = [
    [
      [0, 0, 0],
      [0, y, 0],
      [x, y, 0],
      [x, 0, 0],
    ],
    [
      [0, 0, z],
      [x, 0, z],
      [x, y, z],
      [0, y, z],
    ],
    [
      [0, 0, 0],
      [x, 0, 0],
      [x, 0, z],
      [0, 0, z],
    ],
    [
      [0, y, 0],
      [0, y, z],
      [x, y, z],
      [x, y, 0],
    ],
    [
      [0, 0, 0],
      [0, 0, z],
      [0, y, z],
      [0, y, 0],
    ],
    [
      [x, 0, 0],
      [x, y, 0],
      [x, y, z],
      [x, 0, z],
    ],
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  for (const quad of quads) {
    const base = positions.length / 3;
    for (const corner of quad) positions.push(...corner);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

const TOP: OutlineFrame = {
  origin: { x: 0, y: 0, z: 0 },
  u: { x: 1, y: 0, z: 0 },
  v: { x: 0, y: 1, z: 0 },
  w: { x: 0, y: 0, z: 1 },
};

describe('traços de malhas importadas', () => {
  it('acha as 12 arestas da caixa e ignora as diagonais das faces', () => {
    const { positions, indices } = box();
    const edges = featureEdges(positions, indices);
    expect(edges.length / 6).toBe(12);
    let total = 0;
    for (let i = 0; i < edges.length; i += 6) {
      total += Math.hypot(
        edges[i + 3]! - edges[i]!,
        edges[i + 4]! - edges[i + 1]!,
        edges[i + 5]! - edges[i + 2]!,
      );
    }
    expect(total).toBeCloseTo(4 * (2 + 1 + 3), 5);
  });

  it('mantém a borda livre de uma face aberta', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    const edges = featureEdges(positions, new Uint32Array([0, 1, 2, 0, 2, 3]));
    expect(edges.length / 6).toBe(4);
  });

  it('projeta em planta sem as arestas verticais', () => {
    const { positions, indices } = box();
    const lines = projectEdges(featureEdges(positions, indices), TOP);
    // Quatro arestas da base e quatro do topo; as quatro verticais viram pontos.
    expect(lines.length / 4).toBe(8);
    const xs = [...lines].filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(2, 6);
  });

  it('recorta pelas faixas de corte e traça o contorno da seção', () => {
    const { positions, indices } = box();
    // Planta cortada em z = 1,2, olhando para baixo: fica o que está abaixo do plano.
    const clip = [{ point: { x: 0, y: 0, z: 1.2 }, normal: { x: 0, y: 0, z: -1 } }];
    const lines = projectEdges(featureEdges(positions, indices), TOP, clip);
    expect(lines.length / 4).toBe(4);
    const cut = sectionSegments(positions, indices, TOP, clip);
    // O plano corta as quatro faces laterais (duas faces triangulares cada): perímetro 2+1+2+1.
    let perimeter = 0;
    for (let i = 0; i < cut.length; i += 4) {
      perimeter += Math.hypot(cut[i + 2]! - cut[i]!, cut[i + 3]! - cut[i + 1]!);
    }
    expect(perimeter).toBeCloseTo(6, 6);
    // Fora da faixa não há seção nem arestas.
    const away = [{ point: { x: 0, y: 0, z: -1 }, normal: { x: 0, y: 0, z: -1 } }];
    expect(projectEdges(featureEdges(positions, indices), TOP, away).length).toBe(0);
    expect(sectionSegments(positions, indices, TOP, away).length).toBe(0);
  });
});
