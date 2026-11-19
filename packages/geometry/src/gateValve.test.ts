import {
  addPipe,
  attachFitting,
  createFamilyCatalog,
  createProject,
  vec3,
  type FamilySize,
  type FittingFamily,
  type PipeSpec,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { buildElementGeometry, type MeshPart } from './elements';

// Tubo de ferro dúctil DN 200 (DE 222) — valores do catálogo embutido.
const dn200: PipeSpec = {
  specificationId: 'fd',
  material: 'ductileIron',
  standard: 'NBR 7675',
  jointType: 'socketSpigot',
  pressureClass: 'K9',
  dn: 200,
  sizeLabel: 'DN 200',
  outerDiameter: 0.222,
  wallThickness: 0.0063,
  innerDiameter: 0.2094,
};
const flange200 = {
  length: 0.02,
  outerDiameter: 0.34,
  boltCircle: 0.295,
  boltCount: 12,
  boltHoleDiameter: 0.023,
};
// EURO 21 e EURO 23, DN 200: mesma torre (H1 515, K × K1 = 266 × 382), L = 400 e 230.
const long: FamilySize = {
  dn: 200,
  length: 0.4,
  height: 0.515,
  width: 0.382,
  bonnetLength: 0.266,
  end: flange200,
};
const short: FamilySize = { ...long, length: 0.23 };

function gate(size: FamilySize, endType: FittingFamily['endType'] = 'flange'): MeshPart[] {
  const family: FittingFamily = {
    id: 'gaveta',
    name: 'Gaveta',
    kind: 'valve',
    valveType: 'gate',
    specificationId: dn200.specificationId,
    endType,
    manufacturer: null,
    standard: 'Teste',
    source: 'Teste',
    origin: 'builtin',
    sizes: [size],
  };
  const pipe = addPipe(createProject('g'), {
    start: vec3(-3, 0, 0),
    end: vec3(-1, 0, 0),
    spec: dn200,
  });
  if (!pipe.ok) throw new Error(pipe.error.message);
  const attached = attachFitting(pipe.value.project, {
    target: { elementId: pipe.value.elementId, portId: 'end' },
    fitting: { kind: 'valve', valveType: 'gate' },
    catalog: createFamilyCatalog([family]),
  });
  if (!attached.ok) throw new Error(attached.error.message);
  const element = attached.value.project.elements.find((e) => e.kind === 'valve')!;
  return [
    ...buildElementGeometry({
      ...element,
      placement: { position: vec3(0, 0, 0), rotation: { x: 0, y: 0, z: 0, w: 1 } },
    } as typeof element).parts,
  ];
}

interface Extent {
  minX: number;
  maxX: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

function extent(parts: readonly MeshPart[], keep: (x: number, y: number, z: number) => boolean) {
  const e: Extent = { minX: Infinity, maxX: -Infinity, maxY: 0, minZ: Infinity, maxZ: -Infinity };
  for (const part of parts) {
    const p = part.mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      if (!keep(p[i]!, p[i + 1]!, p[i + 2]!)) continue;
      e.minX = Math.min(e.minX, p[i]!);
      e.maxX = Math.max(e.maxX, p[i]!);
      e.maxY = Math.max(e.maxY, Math.abs(p[i + 1]!));
      e.minZ = Math.min(e.minZ, p[i + 2]!);
      e.maxZ = Math.max(e.maxZ, p[i + 2]!);
    }
  }
  return e;
}

const all = (): boolean => true;

describe('gaveta de castelo retangular', () => {
  it('gera malhas válidas, com o revestimento azul e a haste em inox, sem volante', () => {
    const parts = gate(long);
    expect([...new Set(parts.map((part) => part.role))].sort()).toEqual(['coated', 'seal', 'trim']);
    for (const { mesh } of parts) {
      expect(mesh.positions.length).toBeGreaterThan(0);
      expect(mesh.normals.length).toBe(mesh.positions.length);
      expect(mesh.positions.every(Number.isFinite)).toBe(true);
      expect(mesh.normals.every(Number.isFinite)).toBe(true);
      expect(mesh.indices.every((i) => i < mesh.positions.length / 3)).toBe(true);
    }
  });

  it('respeita as cotas de catálogo: face a face, topo da haste e castelo K × K1', () => {
    const parts = gate(long);
    const total = extent(parts, all);
    expect(total.minX).toBeCloseTo(-0.2, 6);
    expect(total.maxX).toBeCloseTo(0.2, 6);
    // Topo da haste em H1 = 515 mm; abaixo do eixo, só o flange (Ø 340).
    expect(total.maxZ).toBeCloseTo(0.515, 6);
    expect(total.minZ).toBeCloseTo(-0.17, 4);

    // Castelo (acima dos flanges): 266 mm ao longo do eixo e 382 mm na transversal.
    const coated = parts.filter((part) => part.role === 'coated');
    const castle = extent(coated, (_x, _y, z) => z > 0.18);
    expect(castle.minX).toBeCloseTo(-0.133, 6);
    expect(castle.maxX).toBeCloseTo(0.133, 6);
    expect(castle.maxY).toBeCloseTo(0.191, 6);
  });

  it('deixa a passagem livre: nada do castelo desce abaixo da parede do tubo', () => {
    const parts = gate(long);
    // Dentro do furo (raio interno de 104,7 mm) não há vértices longe das faces dos flanges.
    const inside = extent(
      parts,
      (x, y, z) => Math.hypot(y, z) < dn200.innerDiameter / 2 - 0.002 && Math.abs(x) < 0.15,
    );
    expect(inside.maxZ).toBe(-Infinity);
  });

  it('no corpo curto, o castelo mais comprido que o face a face fica acima dos flanges', () => {
    const parts = gate(short);
    const total = extent(parts, all);
    // K = 266 > L = 230: o castelo avança além das faces.
    expect(total.minX).toBeCloseTo(-0.133, 6);
    expect(total.maxX).toBeCloseTo(0.133, 6);
    expect(total.maxZ).toBeCloseTo(0.515, 6);
    // Na altura dos flanges (até o raio de 170 mm) nada ultrapassa as faces.
    const low = extent(parts, (_x, _y, z) => z < 0.17);
    expect(low.minX).toBeCloseTo(-0.115, 6);
    expect(low.maxX).toBeCloseTo(0.115, 6);
  });

  it('com bolsas, o comprimento é entre os fundos e as bolsas avançam sobre os tubos', () => {
    // EURO 25 DN 200: Lu 170, P 100, D1 294, H1 510, K × K1 = 182 × 352.
    const parts = gate(
      {
        dn: 200,
        length: 0.17,
        height: 0.51,
        width: 0.352,
        bonnetLength: 0.182,
        end: { length: 0.1, outerDiameter: 0.294 },
      },
      'socket',
    );
    const total = extent(parts, all);
    // Lt = Lu + 2·P = 370 mm.
    expect(total.minX).toBeCloseTo(-0.185, 6);
    expect(total.maxX).toBeCloseTo(0.185, 6);
    expect(total.maxZ).toBeCloseTo(0.51, 6);
    // Por baixo, o ponto mais afastado é o bojo do corpo ou a bolsa (Ø 294).
    expect(total.minZ).toBeLessThanOrEqual(-0.147 + 1e-6);
    expect(total.minZ).toBeGreaterThan(-0.17);
  });

  it('sem as dimensões do castelo, a gaveta continua com o castelo genérico e o volante', () => {
    const { width: _w, bonnetLength: _k, ...generic } = long;
    const parts = gate({ ...generic, handwheelDiameter: 0.36 });
    expect(parts.some((part) => part.role === 'accent')).toBe(true);
    expect(parts.some((part) => part.role === 'coated')).toBe(false);
  });
});
