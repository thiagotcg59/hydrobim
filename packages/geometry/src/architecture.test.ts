import {
  addArchType,
  addFloor,
  addFloorOpening,
  addHosted,
  addWalls,
  createProject,
  floorQuantities,
  getArchElement,
  rotate,
  vec3,
  wallQuantities,
  type ArchElement,
  type ArchTypeInput,
  type Point2,
  type Project,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { buildArchGeometry, doorSwings } from './architecture';
import { loopArea, sectionLoops } from './archSection';
import type { ElementGeometry } from './elements';
import { planOutline } from './plan';
import { countOpenEdges } from './skin';
import { viewOutline } from './viewOutline';

const p = (x: number, y: number): Point2 => ({ x, y });
const common = {
  familyId: null,
  generic: true,
  source: null,
  manufacturing: {},
  classifications: [],
  ifc: {},
};
const TYPES: ArchTypeInput[] = [
  {
    ...common,
    category: 'wall',
    name: 'Parede 20',
    ifcPredefinedType: 'SOLIDWALL',
    layers: [
      { id: 'a', material: 'Bloco', thickness: 0.2, function: 'structure', hatch: 'diagonal' },
    ],
  },
  {
    ...common,
    category: 'slab',
    name: 'Laje 12',
    ifcPredefinedType: 'FLOOR',
    layers: [
      { id: 'a', material: 'Concreto', thickness: 0.12, function: 'structure', hatch: 'dotted' },
    ],
  },
  {
    ...common,
    category: 'door',
    name: 'Porta 80',
    ifcPredefinedType: 'DOOR',
    operation: 'singleSwing',
    width: 0.8,
    height: 2.1,
    frameWidth: 0.05,
    panelThickness: 0.035,
    materials: {},
  },
  {
    ...common,
    category: 'window',
    name: 'Janela 120',
    ifcPredefinedType: 'WINDOW',
    operation: 'sliding',
    width: 1.2,
    height: 1,
    sillHeight: 1.1,
    panels: 2,
    frameWidth: 0.05,
    materials: {},
  },
];

function building(): {
  project: Project;
  walls: string[];
  door: string;
  window: string;
  slab: string;
} {
  let project = createProject('Casa', 'architecture');
  const types: string[] = [];
  for (const type of TYPES) {
    const added = addArchType(project, type);
    if (!added.ok) throw new Error(added.error.message);
    project = added.value.project;
    types.push(added.value.typeId);
  }
  const levelId = project.levels[0]?.id ?? '';
  const walls = addWalls(project, {
    typeId: types[0] ?? '',
    levelId,
    points: [p(0, 0), p(5, 0), p(5, 4), p(0, 4)],
    height: 2.8,
    closed: true,
  });
  if (!walls.ok) throw new Error(walls.error.message);
  const host = walls.value.elementIds[0] ?? '';
  const door = addHosted(walls.value.project, {
    kind: 'door',
    typeId: types[2] ?? '',
    hostId: host,
    at: 1.5,
  });
  if (!door.ok) throw new Error(door.error.message);
  const window = addHosted(door.value.project, {
    kind: 'window',
    typeId: types[3] ?? '',
    hostId: host,
    at: 3.5,
  });
  if (!window.ok) throw new Error(window.error.message);
  const slab = addFloor(window.value.project, {
    kind: 'slab',
    typeId: types[1] ?? '',
    levelId,
    boundary: [p(0, 0), p(5, 0), p(5, 4), p(0, 4)],
  });
  if (!slab.ok) throw new Error(slab.error.message);
  const opened = addFloorOpening(slab.value.project, slab.value.elementIds[0] ?? '', [
    p(1, 1),
    p(2, 1),
    p(2, 2),
    p(1, 2),
  ]);
  if (!opened.ok) throw new Error(opened.error.message);
  return {
    project: opened.value.project,
    walls: walls.value.elementIds,
    door: door.value.elementIds[0] ?? '',
    window: window.value.elementIds[0] ?? '',
    slab: slab.value.elementIds[0] ?? '',
  };
}

const element = (project: Project, id: string): ArchElement => {
  const found = getArchElement(project.architecture, id);
  if (!found) throw new Error('elemento inexistente');
  return found;
};

/** Volume da malha pelo teorema da divergência (exige malha fechada e bem orientada). */
function meshVolume(geometry: ElementGeometry): number {
  let volume = 0;
  for (const part of geometry.parts) {
    const { positions: q, indices } = part.mesh;
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]].map((i) => {
        const k = (i ?? 0) * 3;
        return [q[k] ?? 0, q[k + 1] ?? 0, q[k + 2] ?? 0];
      }) as [number[], number[], number[]];
      volume +=
        ((a[0] ?? 0) * ((b[1] ?? 0) * (c[2] ?? 0) - (b[2] ?? 0) * (c[1] ?? 0)) -
          (a[1] ?? 0) * ((b[0] ?? 0) * (c[2] ?? 0) - (b[2] ?? 0) * (c[0] ?? 0)) +
          (a[2] ?? 0) * ((b[0] ?? 0) * (c[1] ?? 0) - (b[1] ?? 0) * (c[0] ?? 0))) /
        6;
    }
  }
  return volume;
}

const PLAN = { origin: vec3(0, 0, 0), u: vec3(1, 0, 0), v: vec3(0, 1, 0), w: vec3(0, 0, 1) };

describe('geometria da arquitetura', () => {
  it('parede com porta e janela: malha fechada cujo volume é o volume líquido', () => {
    const b = building();
    const wall = element(b.project, b.walls[0] ?? '');
    const geometry = buildArchGeometry(b.project, wall);
    expect(geometry).not.toBeNull();
    if (!geometry || wall.kind !== 'wall') return;
    expect(geometry.parts.map((part) => part.role)).toEqual(['wall']);
    expect(
      countOpenEdges(
        geometry.parts[0]?.mesh ?? {
          positions: new Float32Array(),
          normals: new Float32Array(),
          indices: new Uint32Array(),
        },
      ),
    ).toBe(0);
    const q = wallQuantities(b.project.architecture, wall);
    expect(meshVolume(geometry)).toBeCloseTo(q?.netVolume ?? 0, 5);
    // Sem os vãos, o volume é o bruto.
    for (const id of b.walls.slice(1)) {
      const other = element(b.project, id);
      const g = buildArchGeometry(b.project, other);
      if (!g || other.kind !== 'wall') throw new Error('geometria esperada');
      expect(countOpenEdges(g.parts[0]?.mesh ?? geometry.parts[0]!.mesh)).toBe(0);
      expect(meshVolume(g)).toBeCloseTo(
        wallQuantities(b.project.architecture, other)?.grossVolume ?? 0,
        5,
      );
    }
  });

  it('as normais apontam para fora (faces de baixo voltadas para baixo)', () => {
    const b = building();
    const geometry = buildArchGeometry(b.project, element(b.project, b.slab));
    if (!geometry) throw new Error('geometria esperada');
    const { positions, normals, indices } = geometry.parts[0]!.mesh;
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const [a, c, d] = [indices[t]!, indices[t + 1]!, indices[t + 2]!].map((i) =>
        vec3(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!),
      ) as [ReturnType<typeof vec3>, ReturnType<typeof vec3>, ReturnType<typeof vec3>];
      const ux = c.x - a.x,
        uy = c.y - a.y,
        uz = c.z - a.z;
      const vx = d.x - a.x,
        vy = d.y - a.y,
        vz = d.z - a.z;
      const nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      const i = indices[t]! * 3;
      expect(nx * normals[i]! + ny * normals[i + 1]! + nz * normals[i + 2]!).toBeGreaterThan(0);
    }
  });

  it('laje com abertura: malha fechada, volume líquido e topo na cota do nível', () => {
    const b = building();
    const slab = element(b.project, b.slab);
    const geometry = buildArchGeometry(b.project, slab);
    if (!geometry || slab.kind !== 'slab') throw new Error('geometria esperada');
    expect(countOpenEdges(geometry.parts[0]!.mesh)).toBe(0);
    expect(meshVolume(geometry)).toBeCloseTo(
      floorQuantities(b.project.architecture, slab)?.netVolume ?? 0,
      5,
    );
    const zs = [...geometry.parts[0]!.mesh.positions].filter((_, i) => i % 3 === 2);
    expect(Math.max(...zs) + geometry.transform.position.z).toBeCloseTo(0, 6);
    expect(Math.min(...zs) + geometry.transform.position.z).toBeCloseTo(-0.12, 6);
  });

  it('porta e janela ficam dentro do vão da parede hospedeira', () => {
    const b = building();
    for (const [id, roles] of [
      [b.door, ['frame', 'joinery']],
      [b.window, ['frame', 'glass']],
    ] as const) {
      const hosted = element(b.project, id);
      const geometry = buildArchGeometry(b.project, hosted);
      if (!geometry) throw new Error('geometria esperada');
      expect(geometry.parts.map((part) => part.role)).toEqual(roles);
      const centre = hosted.kind === 'door' ? 1.5 : 3.5;
      const half = hosted.kind === 'door' ? 0.4 : 0.6;
      for (const part of geometry.parts) {
        for (let i = 0; i + 2 < part.mesh.positions.length; i += 3) {
          const world = rotate(
            geometry.transform.rotation,
            vec3(part.mesh.positions[i]!, part.mesh.positions[i + 1]!, part.mesh.positions[i + 2]!),
          );
          const x = world.x + geometry.transform.position.x;
          const y = world.y + geometry.transform.position.y;
          expect(x).toBeGreaterThanOrEqual(centre - half - 1e-6);
          expect(x).toBeLessThanOrEqual(centre + half + 1e-6);
          expect(Math.abs(y)).toBeLessThanOrEqual(0.1 + 1e-6);
        }
      }
    }
    expect(
      buildArchGeometry(b.project, { ...element(b.project, b.door), typeId: 'x' } as ArchElement),
    ).toBeNull();
  });

  it('seção em planta: a 1,20 m a parede é cortada com o vão da porta e o da janela', () => {
    const b = building();
    const geometry = buildArchGeometry(b.project, element(b.project, b.walls[0] ?? ''));
    if (!geometry) throw new Error('geometria esperada');
    const cut = (z: number): number =>
      sectionLoops(geometry, PLAN, { point: vec3(0, 0, z), normal: vec3(0, 0, -1) })
        .flatMap((section) => section.loops)
        .reduce((sum, loop) => sum + Math.abs(loopArea(loop)), 0);
    const full =
      wallQuantities(b.project.architecture, element(b.project, b.walls[0] ?? '') as never)
        ?.grossFootprintArea ?? 0;
    // A 0,50 m só a porta interrompe; a 1,20 m, porta e janela; a 2,50 m, nada.
    expect(cut(0.5)).toBeCloseTo(full - 0.8 * 0.2, 6);
    expect(cut(1.2)).toBeCloseTo(full - (0.8 + 1.2) * 0.2, 6);
    expect(cut(2.5)).toBeCloseTo(full, 6);
    expect(cut(3)).toBe(0);
    const loops = sectionLoops(geometry, PLAN, { point: vec3(0, 0, 1.2), normal: vec3(0, 0, -1) });
    expect(loops[0]?.loops).toHaveLength(3);
  });

  it('projeção em planta abaixo do corte: sem linhas internas nas juntas da malha', () => {
    const b = building();
    const geometry = buildArchGeometry(b.project, element(b.project, b.walls[1] ?? ''));
    if (!geometry) throw new Error('geometria esperada');
    const outline = planOutline(geometry);
    // Parede sem vãos vista de cima: só o contorno (4 lados, cada um um ou mais segmentos
    // colineares), sem diagonais nem divisões internas.
    const { lines } = outline;
    for (let i = 0; i + 3 < lines.length; i += 4) {
      const horizontal = Math.abs(lines[i + 1]! - lines[i + 3]!) < 1e-6;
      const vertical = Math.abs(lines[i]! - lines[i + 2]!) < 1e-6;
      const diagonalCorner = !horizontal && !vertical;
      // As únicas arestas inclinadas são as dos cantos em bisel (45°).
      if (diagonalCorner)
        expect(
          Math.abs(Math.abs(lines[i]! - lines[i + 2]!) - Math.abs(lines[i + 1]! - lines[i + 3]!)),
        ).toBeLessThan(1e-6);
    }
    const clipped = viewOutline(geometry, PLAN, [
      { point: vec3(0, 0, 1.2), normal: vec3(0, 0, -1) },
    ]);
    expect(clipped?.maxZ).toBeCloseTo(1.2, 5);
  });

  it('símbolo da porta: folha a 90° do lado da face e arco de um quarto de círculo', () => {
    const b = building();
    const door = element(b.project, b.door);
    if (door.kind !== 'door') throw new Error('porta esperada');
    const [swing] = doorSwings(b.project, door);
    expect(swing).toBeDefined();
    if (!swing?.arc) return;
    // Dobradiça à esquerda (x = 1,15), na face esquerda da parede (y = 0,10); folha de 0,70 m.
    expect(swing.leaf[0].x).toBeCloseTo(1.15, 9);
    expect(swing.leaf[0].y).toBeCloseTo(0.1, 9);
    expect(swing.leaf[1].y).toBeCloseTo(0.8, 9);
    expect(swing.arc.radius).toBeCloseTo(0.7, 9);
    expect(swing.arc.to - swing.arc.from).toBeCloseTo(Math.PI / 2, 9);
    const flipped = doorSwings(b.project, { ...door, facing: -1, hand: 'right' });
    expect(flipped[0]?.leaf[0].x).toBeCloseTo(1.85, 9);
    expect(flipped[0]?.leaf[1].y).toBeCloseTo(-0.8, 9);
  });
});
