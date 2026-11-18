import { TANK_FAMILIES } from '@hydrobim/catalog';
import {
  addTankNozzle,
  createProject,
  getElement,
  placeEquipment,
  tankGeometricVolume,
  tankLayout,
  tankParametersFromFamily,
  updateFitting,
  updateTankSettings,
  validateProject,
  vec3,
  type PipeSpec,
  type Project,
  type Tank,
  type TankFamily,
  type TankSelection,
} from '@hydrobim/core';
import {
  buildElementGeometry,
  countOpenEdges,
  type MeshData,
  type MeshPart,
} from '@hydrobim/geometry';
import { describe, expect, it } from 'vitest';

const spec: PipeSpec = {
  specificationId: 'ferro-ductil-nbr7675-k9',
  material: 'ductileIron',
  standard: 'ABNT NBR 7675',
  jointType: 'socketSpigot',
  pressureClass: 'K9',
  dn: 100,
  sizeLabel: 'DN 100',
  outerDiameter: 0.118,
  innerDiameter: 0.1058,
  wallThickness: 0.0061,
};

function place(family: TankFamily, selection: TankSelection): { project: Project; tank: Tank } {
  const parameters = tankParametersFromFamily(family, selection);
  if (!parameters.ok) throw new Error(parameters.error.message);
  const placed = placeEquipment(createProject('Teste', 'infra'), {
    spec,
    fitting: { kind: 'tank', parameters: parameters.value },
    position: vec3(0, 0, 0),
  });
  if (!placed.ok) throw new Error(placed.error.message);
  const tank = getElement(placed.value.project, placed.value.elementId);
  if (tank?.kind !== 'tank') throw new Error('Reservatório não criado.');
  return { project: placed.value.project, tank };
}

interface Extent {
  min: [number, number, number];
  max: [number, number, number];
}

function extent(meshes: readonly MeshData[]): Extent {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.positions.length; i += 1) {
      const axis = (i % 3) as 0 | 1 | 2;
      const value = mesh.positions[i] ?? 0;
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return { min, max };
}

/** Volume delimitado pela malha (teorema da divergência); negativo = normais invertidas. */
function signedVolume(mesh: MeshData): number {
  const p = mesh.positions;
  let volume = 0;
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t] ?? 0, mesh.indices[t + 1] ?? 0, mesh.indices[t + 2] ?? 0];
    const [ax, ay, az] = [p[a * 3] ?? 0, p[a * 3 + 1] ?? 0, p[a * 3 + 2] ?? 0];
    const [bx, by, bz] = [p[b * 3] ?? 0, p[b * 3 + 1] ?? 0, p[b * 3 + 2] ?? 0];
    const [cx, cy, cz] = [p[c * 3] ?? 0, p[c * 3 + 1] ?? 0, p[c * 3 + 2] ?? 0];
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return volume;
}

/** A primeira parte é sempre o corpo (costado, fundo e cobertura). */
const shellOf = (parts: readonly MeshPart[]): MeshData => {
  const shell = parts[0];
  if (!shell) throw new Error('Reservatório sem corpo.');
  return shell.mesh;
};

const family = (id: string): TankFamily => {
  const found = TANK_FAMILIES.find((f) => f.id === id);
  if (!found) throw new Error(`Família inexistente: ${id}`);
  return found;
};

const selections = (f: TankFamily): TankSelection[] =>
  f.variants.length > 0 ? f.variants.map((v) => ({ variantId: v.id })) : [{ custom: {} }];

describe('geometria dos reservatórios TRAMEC', () => {
  it.each(TANK_FAMILIES.map((f) => [f.name, f] as const))(
    '%s: todos os modelos geram corpo fechado com as dimensões do catálogo',
    (_name, f) => {
      for (const selection of selections(f)) {
        const { project, tank } = place(f, selection);
        expect(validateProject(project)).toEqual([]);
        const { parts } = buildElementGeometry(tank);
        const shell = shellOf(parts);
        for (const part of parts) {
          expect(part.mesh.positions.every(Number.isFinite)).toBe(true);
          expect(part.mesh.normals.every(Number.isFinite)).toBe(true);
        }
        expect(countOpenEdges(shell), `${tank.manufacturing.model}: corpo aberto`).toBe(0);

        const box = extent([shell]);
        const layout = tankLayout(tank);
        // Topo do costado na altura total e base no piso (ou no vértice do cone).
        expect(box.max[2]).toBeCloseTo(layout.top, 4);
        const bottom =
          layout.type === 'verticalConeLegs' || layout.type === 'australian'
            ? layout.waterBottom
            : layout.type === 'horizontal'
              ? layout.support
              : 0;
        expect(box.min[2]).toBeCloseTo(bottom, 4);
        if (layout.type === 'horizontal') {
          expect(box.max[0] - box.min[0]).toBeCloseTo(tank.length ?? 0, 4);
          expect(box.max[1] - box.min[1]).toBeCloseTo(tank.diameter, 3);
          expect(box.max[2] - box.min[2]).toBeCloseTo(tank.diameter, 3);
        } else if (layout.type === 'australian') {
          // A onda da chapa corrugada passa do diâmetro nominal por meia profundidade.
          expect(box.max[0] - box.min[0]).toBeGreaterThanOrEqual(tank.diameter - 1e-4);
          expect(box.max[0] - box.min[0]).toBeLessThan(tank.diameter + 0.02);
        } else {
          expect(box.max[0] - box.min[0]).toBeCloseTo(tank.diameter, 4);
          expect(box.max[1] - box.min[1]).toBeCloseTo(tank.diameter, 3);
        }

        // Normais para fora: o volume de material da casca é positivo e pequeno diante do
        // volume do reservatório.
        const steel = signedVolume(shell);
        expect(steel).toBeGreaterThan(0);
        expect(steel).toBeLessThan(0.2 * tankGeometricVolume(tank) + 0.5);
      }
    },
    // Dezenas de modelos por família: folga para máquinas carregadas.
    30_000,
  );

  it('a taça sem água na coluna reproduz coluna, transição e taça', () => {
    const f = family('tramec-taca-sem-agua');
    const { tank } = place(f, { variantId: 'tramec-taca-sem-agua/10000-830-191-480' });
    expect(tank).toMatchObject({ height: 8.3, diameter: 1.91, columnHeight: 4.8 });
    const shell = shellOf(buildElementGeometry(tank).parts);
    const p = shell.positions;
    // Raio máximo abaixo do topo da coluna = raio da coluna; acima da transição = taça.
    let column = 0;
    let bowl = 0;
    for (let i = 0; i < p.length; i += 3) {
      const r = Math.hypot(p[i] ?? 0, p[i + 1] ?? 0);
      const z = p[i + 2] ?? 0;
      if (z < 4.8 - 1e-6) column = Math.max(column, r);
      if (z > 4.8 + (tank.coneHeight ?? 0) + 1e-6) bowl = Math.max(bowl, r);
    }
    expect(column).toBeCloseTo((tank.columnDiameter ?? 0) / 2, 4);
    expect(bowl).toBeCloseTo(1.91 / 2, 4);
  });

  it('o fundo cônico fica entre o piso e a base do costado, sobre pés de 0,50 m', () => {
    const f = family('tramec-vertical-fundo-conico');
    const { tank } = place(f, { variantId: f.variants[1]?.id ?? '' });
    expect(tank.supportHeight).toBe(0.5);
    const parts = buildElementGeometry(tank).parts;
    const shell = extent([shellOf(parts)]);
    expect(shell.min[2]).toBeCloseTo(0.5 - (tank.coneHeight ?? 0), 5);
    expect(shell.min[2]).toBeGreaterThan(0);
    // Os pés chegam ao piso.
    const accessories = parts[1];
    expect(accessories && extent([accessories.mesh]).min[2]).toBeCloseTo(0, 5);
  });

  it('acessórios aparecem nas formas em que o catálogo os mostra e podem ser desligados', () => {
    const tubular = family('tramec-tubular-alto');
    const { project, tank } = place(tubular, { variantId: tubular.variants[0]?.id ?? '' });
    const withAll = buildElementGeometry(tank).parts;
    // Guarda-corpo e escada passam do topo do costado.
    expect(extent(withAll.map((part) => part.mesh)).max[2]).toBeCloseTo(6 + 1.1, 1);
    // Escada com gaiola do lado +Y (azimute de 90°).
    expect(extent(withAll.map((part) => part.mesh)).max[1]).toBeGreaterThan(0.4 + 0.5);

    const bare = updateTankSettings(project, tank.id, {
      accessories: { ladder: false, guardrail: false, manhole: false },
    });
    if (!bare.ok) throw new Error(bare.error.message);
    const stripped = getElement(bare.value, tank.id);
    if (stripped?.kind !== 'tank') throw new Error('Reservatório perdido.');
    const without = buildElementGeometry(stripped).parts;
    expect(extent(without.slice(0, 2).map((part) => part.mesh)).max[2]).toBeCloseTo(6, 4);

    const australian = family('tramec-australiano');
    const open = place(australian, { custom: { capacityL: 50000, height: 1.72 } }).tank;
    expect(open.accessories).toMatchObject({ ladder: false, guardrail: false });
    expect(buildElementGeometry(open).parts.map((part) => part.role)).toEqual([
      'galvanized',
      'galvanized',
      'liner',
      'body',
      'body',
    ]);
  });

  it('alterar um parâmetro regenera a geometria', () => {
    const f = family('tramec-vertical-apoiado');
    const { project, tank } = place(f, { variantId: f.variants[0]?.id ?? '' });
    const taller = updateFitting(project, tank.id, { height: 3, diameter: 2.5 });
    if (!taller.ok) throw new Error(taller.error.message);
    const edited = getElement(taller.value, tank.id);
    if (edited?.kind !== 'tank') throw new Error('Reservatório perdido.');
    expect(edited.variantId).toBeUndefined();
    expect(edited.familyId).toBe(f.id);
    const box = extent([shellOf(buildElementGeometry(edited).parts)]);
    expect(box.max[2]).toBeCloseTo(3, 5);
    expect(box.max[0] - box.min[0]).toBeCloseTo(2.5, 4);
  });

  it('cada bocal gera um tubo que termina exatamente na porta', () => {
    const f = family('tramec-cilindrico-horizontal');
    const { project, tank } = place(f, { custom: {} });
    const added = addTankNozzle(project, tank.id, {
      role: 'overflow',
      height: 1.6,
      azimuth: Math.PI / 2,
      spec,
    });
    if (!added.ok) throw new Error(added.error.message);
    const next = getElement(added.value.project, tank.id);
    if (next?.kind !== 'tank') throw new Error('Reservatório perdido.');
    const parts = buildElementGeometry(next).parts;
    const nozzles = parts.filter((part) => part.role === 'body');
    expect(nozzles).toHaveLength(3);
    const all = extent(nozzles.map((part) => part.mesh));
    // Entrada e saída nos tampos; extravasor na lateral.
    expect(all.max[0]).toBeCloseTo(3.6 / 2 + next.nozzleLength, 5);
    expect(all.min[0]).toBeCloseTo(-(3.6 / 2 + next.nozzleLength), 5);
    expect(all.max[1]).toBeGreaterThan(next.diameter / 2);
  });
});
