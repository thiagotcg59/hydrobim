import {
  addArchType,
  addHosted,
  addWalls,
  createProject,
  getArchElement,
  type DoorType,
  type Project,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { buildArchGeometry, doorElevation } from './architecture';
import { partFinish } from './finishes';
import { countOpenEdges } from './skin';

const common = {
  familyId: null,
  generic: true,
  source: null,
  manufacturing: {},
  classifications: [],
  ifc: {},
};

const DOOR: Omit<DoorType, 'id'> = {
  ...common,
  category: 'door',
  name: 'Porta com frisos',
  ifcPredefinedType: 'DOOR',
  operation: 'singleSwing',
  width: 0.88,
  height: 2.15,
  frameWidth: 0.04,
  panelThickness: 0.035,
  materials: {},
  leaf: {
    friezes: [
      { orientation: 'horizontal', position: 0.5 },
      { orientation: 'vertical', position: 0.25 },
    ],
    friezeWidth: 0.016,
    schematic: true,
  },
};

const typed = (overrides: Partial<DoorType> = {}): DoorType =>
  ({ ...DOOR, id: 'porta', ...overrides }) as DoorType;

function placed(
  type: Omit<DoorType, 'id'>,
  hand: 'left' | 'right',
): { project: Project; id: string } {
  let project = createProject('Casa', 'architecture');
  const wallType = addArchType(project, {
    ...common,
    category: 'wall',
    name: 'Parede 15',
    ifcPredefinedType: 'SOLIDWALL',
    layers: [{ id: 'a', material: 'Bloco', thickness: 0.15, function: 'structure', hatch: 'none' }],
  });
  if (!wallType.ok) throw new Error(wallType.error.message);
  const doorType = addArchType(wallType.value.project, type);
  if (!doorType.ok) throw new Error(doorType.error.message);
  project = doorType.value.project;
  const walls = addWalls(project, {
    typeId: wallType.value.typeId,
    levelId: project.levels[0]?.id ?? '',
    points: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ],
    height: 2.8,
  });
  if (!walls.ok) throw new Error(walls.error.message);
  const door = addHosted(walls.value.project, {
    kind: 'door',
    typeId: doorType.value.typeId,
    hostId: walls.value.elementIds[0] ?? '',
    at: 2,
    hand,
  });
  if (!door.ok) throw new Error(door.error.message);
  return { project: door.value.project, id: door.value.elementIds[0] ?? '' };
}

describe('elevação da porta', () => {
  it('folha lisa: uma folha dentro do marco, sem frisos', () => {
    const elevation = doorElevation(typed({ leaf: undefined }), 'left');
    expect(elevation.friezes).toEqual([]);
    expect(elevation.leaves).toHaveLength(1);
    const [leaf] = elevation.leaves;
    expect(leaf?.x0).toBeCloseTo(-0.4, 9);
    expect(leaf?.x1).toBeCloseTo(0.4, 9);
    expect(leaf?.z1).toBeCloseTo(2.11, 9);
  });

  it('friso horizontal: de borda a borda, centrado na fração da altura da folha', () => {
    const [horizontal] = doorElevation(typed(), 'left').friezes;
    expect(horizontal?.x0).toBeCloseTo(-0.4, 9);
    expect(horizontal?.x1).toBeCloseTo(0.4, 9);
    expect(((horizontal?.z0 ?? 0) + (horizontal?.z1 ?? 0)) / 2).toBeCloseTo(2.11 / 2, 9);
    expect((horizontal?.z1 ?? 0) - (horizontal?.z0 ?? 0)).toBeCloseTo(0.016, 9);
  });

  it('friso vertical conta a partir das dobradiças: espelha com a mão da porta', () => {
    const centre = (hand: 'left' | 'right'): number => {
      const vertical = doorElevation(typed(), hand).friezes[1];
      expect(vertical?.z0).toBe(0);
      expect(vertical?.z1).toBeCloseTo(2.11, 9);
      return ((vertical?.x0 ?? 0) + (vertical?.x1 ?? 0)) / 2;
    };
    // Folha de 0,80 m: um quarto da largura a partir da borda das dobradiças.
    expect(centre('left')).toBeCloseTo(-0.4 + 0.2, 9);
    expect(centre('right')).toBeCloseTo(0.4 - 0.2, 9);
  });

  it('duas folhas: cada uma leva os frisos, com as dobradiças nas bordas externas', () => {
    const elevation = doorElevation(typed({ operation: 'doubleSwing', width: 1.68 }), 'left');
    expect(elevation.leaves).toHaveLength(2);
    expect(elevation.friezes).toHaveLength(4);
    const verticals = elevation.friezes.filter((frieze) => frieze.z0 === 0 && frieze.z1 > 1);
    const centres = verticals.map((frieze) => (frieze.x0 + frieze.x1) / 2);
    expect(centres[0]).toBeCloseTo(-(centres[1] ?? 0), 9);
  });

  it('friso junto à borda não sai da folha', () => {
    const elevation = doorElevation(
      typed({
        leaf: {
          friezes: [{ orientation: 'horizontal', position: 0.999 }],
          friezeWidth: 0.016,
          schematic: true,
        },
      }),
      'left',
    );
    expect(elevation.friezes[0]?.z1).toBeLessThanOrEqual(2.11 + 1e-9);
  });
});

describe('malha da porta com frisos', () => {
  it('os frisos são uma parte própria, fechada, nas duas faces da folha', () => {
    const { project, id } = placed(DOOR, 'left');
    const door = getArchElement(project.architecture, id);
    const geometry = door ? buildArchGeometry(project, door) : null;
    if (!geometry) throw new Error('geometria esperada');
    expect(geometry.parts.map((part) => part.role)).toEqual(['frame', 'joinery', 'frieze']);
    const frieze = geometry.parts[2];
    if (!frieze) throw new Error('frisos esperados');
    expect(countOpenEdges(frieze.mesh)).toBe(0);
    // Dois frisos × duas faces × 8 vértices por bloco.
    const ys = new Set<number>();
    for (let i = 1; i < frieze.mesh.positions.length; i += 3) {
      ys.add(Number((frieze.mesh.positions[i] ?? 0).toFixed(4)));
    }
    // Quatro planos: 1 mm para fora de cada face da folha de 35 mm.
    const sorted = [...ys].sort((a, b) => a - b);
    expect(sorted).toHaveLength(4);
    expect((sorted[3] ?? 0) - (sorted[0] ?? 0)).toBeCloseTo(0.035 + 0.002, 4);
    expect(partFinish('frieze', 'pvc').label).toBe('Friso de porta');
  });

  it('a mão da ocorrência leva o friso vertical para o lado das dobradiças', () => {
    const side = (hand: 'left' | 'right'): number => {
      const { project, id } = placed(
        {
          ...DOOR,
          leaf: {
            friezes: [{ orientation: 'vertical', position: 0.25 }],
            friezeWidth: 0.016,
            schematic: true,
          },
        },
        hand,
      );
      const door = getArchElement(project.architecture, id);
      const geometry = door ? buildArchGeometry(project, door) : null;
      const mesh = geometry?.parts.find((part) => part.role === 'frieze')?.mesh;
      if (!mesh) throw new Error('frisos esperados');
      let sum = 0;
      for (let i = 0; i < mesh.positions.length; i += 3) sum += mesh.positions[i] ?? 0;
      return sum / (mesh.positions.length / 3);
    };
    expect(side('left')).toBeCloseTo(-0.2, 6);
    expect(side('right')).toBeCloseTo(0.2, 6);
  });

  it('porta sem desenho de folha continua com marco e folha apenas', () => {
    const { leaf: _leaf, ...plain } = DOOR;
    const { project, id } = placed(plain, 'left');
    const door = getArchElement(project.architecture, id);
    const geometry = door ? buildArchGeometry(project, door) : null;
    expect(geometry?.parts.map((part) => part.role)).toEqual(['frame', 'joinery']);
  });
});
