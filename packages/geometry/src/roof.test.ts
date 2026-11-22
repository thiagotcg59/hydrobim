import {
  addArchType,
  addRoof,
  archVerticalRange,
  createProject,
  getArchElement,
  percentToSlope,
  roofQuantities,
  rotate,
  viewFrameOf,
  type ArchTypeInput,
  type Point2,
  type Project,
  type Roof,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { buildArchGeometry } from './architecture';
import { loopArea, sectionLoops } from './archSection';
import type { ElementGeometry } from './elements';

const p = (x: number, y: number): Point2 => ({ x, y });

const type = (shape: 'shed' | 'gable'): ArchTypeInput => ({
  familyId: null,
  generic: true,
  source: null,
  manufacturing: {},
  classifications: [],
  ifc: {},
  category: 'roof',
  name: shape,
  shape,
  ifcPredefinedType: shape === 'shed' ? 'SHED_ROOF' : 'GABLE_ROOF',
  layers: [{ id: 'a', material: 'Telha', thickness: 0.1, function: 'finish', hatch: 'none' }],
});

function build(
  shape: 'shed' | 'gable',
  boundary: Point2[],
  slopePercent: number,
  overhang: number,
): { project: Project; roof: Roof; geometry: ElementGeometry } {
  const added = addArchType(createProject('t', 'architecture'), type(shape));
  if (!added.ok) throw new Error(added.error.message);
  const levelId = added.value.project.levels[0]?.id ?? '';
  const created = addRoof(added.value.project, {
    typeId: added.value.typeId,
    levelId,
    boundary,
    slope: percentToSlope(slopePercent),
    overhang,
    offset: 3,
  });
  if (!created.ok) throw new Error(created.error.message);
  const roof = getArchElement(
    created.value.project.architecture,
    created.value.elementIds[0] ?? '',
  );
  if (roof?.kind !== 'roof') throw new Error('sem telhado');
  const geometry = buildArchGeometry(created.value.project, roof);
  if (!geometry) throw new Error('sem malha');
  return { project: created.value.project, roof, geometry };
}

/** Vértices no referencial do projeto e triângulos da malha. */
function world(geometry: ElementGeometry): { points: number[][]; triangles: number[][] } {
  const [part] = geometry.parts;
  if (!part) throw new Error('sem parte');
  const { positions, indices } = part.mesh;
  const points: number[][] = [];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const q = rotate(geometry.transform.rotation, {
      x: positions[i] ?? 0,
      y: positions[i + 1] ?? 0,
      z: positions[i + 2] ?? 0,
    });
    points.push([
      q.x + geometry.transform.position.x,
      q.y + geometry.transform.position.y,
      q.z + geometry.transform.position.z,
    ]);
  }
  const triangles: number[][] = [];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    triangles.push([indices[t] ?? 0, indices[t + 1] ?? 0, indices[t + 2] ?? 0]);
  }
  return { points, triangles };
}

/** Volume pelo teorema da divergência: só é o do sólido se a malha for fechada e orientada. */
function volumeOf(geometry: ElementGeometry): number {
  const { points, triangles } = world(geometry);
  let sum = 0;
  for (const [a, b, c] of triangles) {
    const A = points[a ?? 0] as number[];
    const B = points[b ?? 0] as number[];
    const C = points[c ?? 0] as number[];
    sum +=
      (A[0] ?? 0) * ((B[1] ?? 0) * (C[2] ?? 0) - (B[2] ?? 0) * (C[1] ?? 0)) -
      (A[1] ?? 0) * ((B[0] ?? 0) * (C[2] ?? 0) - (B[2] ?? 0) * (C[0] ?? 0)) +
      (A[2] ?? 0) * ((B[0] ?? 0) * (C[1] ?? 0) - (B[1] ?? 0) * (C[0] ?? 0));
  }
  return sum / 6;
}

/** Cada aresta aparece uma vez em cada sentido: malha fechada e coerentemente orientada. */
function isClosed(geometry: ElementGeometry): boolean {
  const { points, triangles } = world(geometry);
  const key = (index: number): string =>
    (points[index] as number[]).map((value) => Math.round(value * 1e6)).join(',');
  const edges = new Map<string, number>();
  for (const [a, b, c] of triangles) {
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const forward = `${key(from ?? 0)}>${key(to ?? 0)}`;
      const backward = `${key(to ?? 0)}>${key(from ?? 0)}`;
      if (edges.has(backward)) {
        const left = (edges.get(backward) ?? 0) - 1;
        if (left === 0) edges.delete(backward);
        else edges.set(backward, left);
      } else edges.set(forward, (edges.get(forward) ?? 0) + 1);
    }
  }
  return edges.size === 0;
}

/** Área dos triângulos voltados para cima (a face das telhas). */
function topArea(geometry: ElementGeometry): number {
  const { points, triangles } = world(geometry);
  let sum = 0;
  for (const [a, b, c] of triangles) {
    const A = points[a ?? 0] as number[];
    const B = points[b ?? 0] as number[];
    const C = points[c ?? 0] as number[];
    const u = [(B[0] ?? 0) - (A[0] ?? 0), (B[1] ?? 0) - (A[1] ?? 0), (B[2] ?? 0) - (A[2] ?? 0)];
    const v = [(C[0] ?? 0) - (A[0] ?? 0), (C[1] ?? 0) - (A[1] ?? 0), (C[2] ?? 0) - (A[2] ?? 0)];
    const n = [
      (u[1] ?? 0) * (v[2] ?? 0) - (u[2] ?? 0) * (v[1] ?? 0),
      (u[2] ?? 0) * (v[0] ?? 0) - (u[0] ?? 0) * (v[2] ?? 0),
      (u[0] ?? 0) * (v[1] ?? 0) - (u[1] ?? 0) * (v[0] ?? 0),
    ];
    if ((n[2] ?? 0) > 1e-9) sum += Math.hypot(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0) / 2;
  }
  return sum;
}

const RECT = [p(0, 0), p(8, 0), p(8, 6), p(0, 6)];
const OBLIQUE = RECT.map((q) => {
  const angle = (23 * Math.PI) / 180;
  return {
    x: 5 + q.x * Math.cos(angle) - q.y * Math.sin(angle),
    y: -2 + q.x * Math.sin(angle) + q.y * Math.cos(angle),
  };
});

describe('malha do telhado', () => {
  for (const shape of ['shed', 'gable'] as const) {
    for (const [label, boundary] of [
      ['ortogonal', RECT],
      ['oblíquo', OBLIQUE],
    ] as const) {
      it(`${shape} ${label}: corpo fechado, com o volume e a área inclinada do quantitativo`, () => {
        const { project, roof, geometry } = build(shape, [...boundary], 35, 0.6);
        const q = roofQuantities(project.architecture, roof);
        expect(isClosed(geometry)).toBe(true);
        expect(volumeOf(geometry)).toBeCloseTo(q?.volume ?? 0, 5);
        expect(topArea(geometry)).toBeCloseTo(q?.slopeArea ?? 0, 5);
        // A malha fica entre as cotas derivadas pelo núcleo.
        const range = archVerticalRange(project, roof);
        const zs = world(geometry).points.map((point) => point[2] ?? 0);
        expect(Math.min(...zs)).toBeCloseTo(range?.base ?? 0, 5);
        expect(Math.max(...zs)).toBeCloseTo(range?.top ?? 0, 5);
      });
    }
  }

  it('a face inferior passa pela cota de referência sobre a linha do beiral do contorno', () => {
    const { geometry } = build('shed', RECT, 30, 0.5);
    const points = world(geometry).points;
    // Lado do beiral: y = 0. Com o beiral de 0,5 m, a borda fica em y = −0,5 e 0,15 m abaixo.
    const lowest = Math.min(...points.map((point) => point[2] ?? 0));
    expect(lowest).toBeCloseTo(3 - 0.15, 6);
    expect(Math.min(...points.map((point) => point[1] ?? 0))).toBeCloseTo(-0.5, 6);
  });

  it('a espessura é medida perpendicularmente à água', () => {
    const { geometry } = build('shed', RECT, 100, 0);
    const points = world(geometry).points;
    // 45°: em um mesmo ponto em planta, topo e fundo distam 0,1 ÷ cos 45°.
    const atEave = points.filter((point) => Math.abs(point[1] ?? 0) < 1e-6);
    const zs = atEave.map((point) => point[2] ?? 0);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(0.1 / Math.SQRT1_2, 6);
  });

  it('é cortado por uma vista: a seção transversal de duas águas tem a área esperada', () => {
    const { geometry } = build('gable', RECT, 50, 0.5);
    const view = {
      kind: 'section' as const,
      a: p(4, -3),
      b: p(4, 9),
      side: 1 as const,
      depth: 10,
    };
    const frame = viewFrameOf(view as never);
    const loops = sectionLoops(geometry, frame, {
      point: { x: 4, y: 0, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
    });
    const area = loops
      .flatMap((section) => section.loops)
      .reduce((sum, loop) => sum + Math.abs(loopArea(loop)), 0);
    // Largura em planta (6 + 2 × 0,5) × espessura na vertical.
    expect(area).toBeCloseTo((7 * 0.1) / Math.cos(percentToSlope(50)), 6);
  });
});
