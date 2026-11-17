import {
  addPipe,
  attachFitting,
  createFamilyCatalog,
  createProject,
  placeEquipment,
  getPorts,
  insertInline,
  rotate,
  add,
  vec3,
  type FittingFamily,
  type HydroElement,
  type PipeSpec,
  type Vec3,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { buildElementGeometry, type MeshData } from './index';

const spec: PipeSpec = {
  specificationId: 'test',
  material: 'pvc',
  standard: 'Teste',
  jointType: 'solventWeld',
  pressureClass: null,
  dn: 50,
  sizeLabel: 'DN 50',
  outerDiameter: 0.06,
  wallThickness: 0.003,
  innerDiameter: 0.054,
};
const spec25: PipeSpec = {
  ...spec,
  dn: 25,
  outerDiameter: 0.032,
  wallThickness: 0.002,
  innerDiameter: 0.028,
};

function expectValidMesh(mesh: MeshData): void {
  const vertexCount = mesh.positions.length / 3;
  expect(vertexCount).toBeGreaterThan(0);
  expect(mesh.normals.length).toBe(mesh.positions.length);
  expect(mesh.indices.length % 3).toBe(0);
  expect(mesh.positions.every(Number.isFinite)).toBe(true);
  expect(mesh.indices.every((i) => i < vertexCount)).toBe(true);
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const len = Math.hypot(mesh.normals[i]!, mesh.normals[i + 1]!, mesh.normals[i + 2]!);
    expect(len).toBeCloseTo(1, 5);
  }
}

/** Distância mínima entre um ponto global e os vértices (globais) da geometria. */
function distanceToMesh(element: HydroElement, point: Vec3): number {
  const { transform, parts } = buildElementGeometry(element);
  let best = Infinity;
  for (const part of parts) {
    const p = part.mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      const world = add(
        transform.position,
        rotate(transform.rotation, vec3(p[i]!, p[i + 1]!, p[i + 2]!)),
      );
      best = Math.min(best, Math.hypot(world.x - point.x, world.y - point.y, world.z - point.z));
    }
  }
  return best;
}

function build(): HydroElement[] {
  const a = addPipe(createProject('g'), { start: vec3(1, 2, 3), end: vec3(4, 6, 15), spec });
  if (!a.ok) throw new Error(a.error.message);
  const tee = insertInline(a.value.project, {
    pipeId: a.value.elementId,
    distanceFromStart: 5,
    fitting: { kind: 'tee' },
  });
  if (!tee.ok) throw new Error(tee.error.message);
  const valve = attachFitting(tee.value.project, {
    target: { elementId: tee.value.elementId, portId: 'branch' },
    fitting: { kind: 'valve', valveType: 'ball' },
  });
  if (!valve.ok) throw new Error(valve.error.message);
  const elbow = attachFitting(valve.value.project, {
    target: { elementId: valve.value.elementId, portId: 'b' },
    fitting: { kind: 'elbow', angle: Math.PI / 3 },
  });
  if (!elbow.ok) throw new Error(elbow.error.message);
  const reducer = attachFitting(elbow.value.project, {
    target: { elementId: elbow.value.elementId, portId: 'b' },
    fitting: { kind: 'reducer', outletSpec: spec25 },
  });
  if (!reducer.ok) throw new Error(reducer.error.message);
  return reducer.value.project.elements;
}

describe('extremidades de catálogo', () => {
  const family: FittingFamily = {
    id: 'fam',
    name: 'Joelho 90 com bolsas',
    kind: 'elbow',
    specificationId: 'test',
    endType: 'socket',
    angle: Math.PI / 2,
    manufacturer: null,
    standard: 'Teste',
    source: 'teste',
    origin: 'builtin',
    sizes: [{ dn: 50, centerToEnd: 0.045, end: { length: 0.04, outerDiameter: 0.075 } }],
  };

  function extent(
    element: HydroElement,
    withinRadius = Infinity,
  ): { maxRadiusFromPortAxis: number; reach: number } {
    const port = getPorts(element)[0]!;
    const { parts } = buildElementGeometry(element);
    let reach = -Infinity;
    let maxRadius = 0;
    for (const part of parts) {
      const p = part.mesh.positions;
      for (let i = 0; i < p.length; i += 3) {
        const rel = vec3(
          p[i]! - port.localPosition.x,
          p[i + 1]! - port.localPosition.y,
          p[i + 2]! - port.localPosition.z,
        );
        const along =
          rel.x * port.localDirection.x +
          rel.y * port.localDirection.y +
          rel.z * port.localDirection.z;
        const radius = Math.hypot(
          rel.x - along * port.localDirection.x,
          rel.y - along * port.localDirection.y,
          rel.z - along * port.localDirection.z,
        );
        // Considera apenas a região em torno do eixo da porta (ignora volantes etc.).
        if (radius > withinRadius) continue;
        reach = Math.max(reach, along);
        if (along > 1e-6) maxRadius = Math.max(maxRadius, radius);
      }
    }
    return { maxRadiusFromPortAxis: maxRadius, reach };
  }

  it('a bolsa avança além da porta com profundidade e diâmetro do catálogo', () => {
    const a = addPipe(createProject('g'), { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec });
    if (!a.ok) throw new Error(a.error.message);
    const elbow = attachFitting(a.value.project, {
      target: { elementId: a.value.elementId, portId: 'end' },
      fitting: { kind: 'elbow' },
      catalog: createFamilyCatalog([family]),
    });
    if (!elbow.ok) throw new Error(elbow.error.message);
    const element = elbow.value.project.elements.find((e) => e.kind === 'elbow')!;
    expect(element.familyId).toBe('fam');
    const { reach, maxRadiusFromPortAxis } = extent(element);
    expect(reach).toBeCloseTo(0.04, 6);
    expect(maxRadiusFromPortAxis).toBeCloseTo(0.0375, 6);
    for (const part of buildElementGeometry(element).parts) expectValidMesh(part.mesh);
  });

  it('joelho com bolsas: corpo com o diâmetro do tubo, batente e furo no fundo da bolsa', () => {
    const a = addPipe(createProject('g'), { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec });
    if (!a.ok) throw new Error(a.error.message);
    const elbow = attachFitting(a.value.project, {
      target: { elementId: a.value.elementId, portId: 'end' },
      fitting: { kind: 'elbow' },
      catalog: createFamilyCatalog([family]),
    });
    if (!elbow.ok) throw new Error(elbow.error.message);
    const element = elbow.value.project.elements.find((e) => e.kind === 'elbow')!;
    const [portA, portB] = getPorts(element);
    const mesh = buildElementGeometry(element).parts[0]!.mesh;
    // Raios dos vértices contidos no plano da porta A (fundo da bolsa).
    const atPort = new Set<number>();
    // Raio máximo no plano bissetor da curva (x + y = 0 no referencial local do joelho).
    let middle = 0;
    const bendCenter = vec3(portA!.localPosition.x, portB!.localPosition.y, 0);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const [x, y, z] = [mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!];
      if (Math.abs(x - portA!.localPosition.x) < 1e-7 && y < 0.04) {
        atPort.add(Math.round(Math.hypot(y, z) * 1e5) / 1e5);
      }
      const dx = x - bendCenter.x;
      const dy = y - bendCenter.y;
      if (Math.abs(dx + dy) < 1e-7 && dx > 0) {
        middle = Math.max(middle, Math.abs(Math.hypot(dx, dy) - 0.045));
      }
    }
    // Bolsa (Ø 75), furo da bolsa = Ø externo do tubo (60) e furo do corpo = Ø interno (54).
    expect([...atPort].sort()).toEqual([0.027, 0.03, 0.0375]);
    // No meio da curva o corpo tem o raio externo do tubo em torno da linha de centro.
    expect(middle).toBeCloseTo(0.03, 6);
  });

  it('o flange fica atrás da face da porta, com o diâmetro do catálogo', () => {
    const flanged: FittingFamily = {
      ...family,
      id: 'fam-valve',
      kind: 'valve',
      endType: 'flange',
      valveType: 'gate',
      angle: undefined,
      sizes: [
        {
          dn: 50,
          length: 0.15,
          height: 0.3,
          handwheelDiameter: 0.2,
          end: { length: 0.019, outerDiameter: 0.165 },
        },
      ],
    };
    const a = addPipe(createProject('g'), { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec });
    if (!a.ok) throw new Error(a.error.message);
    const valve = attachFitting(a.value.project, {
      target: { elementId: a.value.elementId, portId: 'end' },
      fitting: { kind: 'valve', valveType: 'gate' },
      catalog: createFamilyCatalog([flanged]),
    });
    if (!valve.ok) throw new Error(valve.error.message);
    const element = valve.value.project.elements.find((e) => e.kind === 'valve')!;
    expect(element.kind === 'valve' && element.length).toBeCloseTo(0.15);
    const { reach } = extent(element, 0.0826);
    expect(reach).toBeCloseTo(0, 6); // nada além da face do flange
    let maxRadius = 0;
    let maxZ = 0;
    for (const part of buildElementGeometry(element).parts) {
      expectValidMesh(part.mesh);
      const p = part.mesh.positions;
      for (let i = 0; i < p.length; i += 3) {
        maxZ = Math.max(maxZ, p[i + 2]!);
        if (Math.abs(Math.abs(p[i]!) - 0.075) < 1e-6) {
          maxRadius = Math.max(maxRadius, Math.hypot(p[i + 1]!, p[i + 2]!));
        }
      }
    }
    expect(maxRadius).toBeCloseTo(0.0825, 6);
    expect(maxZ).toBeCloseTo(0.3, 6);
  });

  it('redutora de pressão: topo e largura de catálogo, dentro das faces dos flanges', () => {
    const prv: FittingFamily = {
      ...family,
      id: 'fam-prv',
      kind: 'valve',
      endType: 'flange',
      valveType: 'pressureReducing',
      angle: undefined,
      sizes: [
        {
          dn: 50,
          length: 0.23,
          height: 0.154,
          width: 0.2,
          end: { length: 0.019, outerDiameter: 0.165 },
        },
      ],
    };
    const a = addPipe(createProject('g'), { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec });
    if (!a.ok) throw new Error(a.error.message);
    const valve = attachFitting(a.value.project, {
      target: { elementId: a.value.elementId, portId: 'end' },
      fitting: { kind: 'valve', valveType: 'pressureReducing' },
      catalog: createFamilyCatalog([prv]),
    });
    if (!valve.ok) throw new Error(valve.error.message);
    const element = valve.value.project.elements.find((e) => e.kind === 'valve')!;
    expect(element.kind === 'valve' && element.width).toBeCloseTo(0.2);
    const geometry = buildElementGeometry(element);
    const roles = new Set(geometry.parts.map((part) => part.role));
    // Válvula básica com o revestimento do fabricante; circuito de controle em inox.
    expect(roles.has('coated')).toBe(true);
    expect(roles.has('trim')).toBe(true);
    expect(roles.has('body')).toBe(false);
    let maxZ = 0;
    let maxY = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const part of geometry.parts) {
      expectValidMesh(part.mesh);
      const p = part.mesh.positions;
      for (let i = 0; i < p.length; i += 3) {
        minX = Math.min(minX, p[i]!);
        maxX = Math.max(maxX, p[i]!);
        // As cotas de catálogo referem-se à válvula básica (sem o circuito de controle).
        if (part.role !== 'coated') continue;
        maxZ = Math.max(maxZ, p[i + 2]!);
        maxY = Math.max(maxY, Math.abs(p[i + 1]!));
      }
    }
    expect(maxZ).toBeCloseTo(0.154, 5);
    expect(maxY).toBeCloseTo(0.1, 5);
    // Nada ultrapassa as faces dos flanges, nem o circuito de controle.
    expect(minX).toBeCloseTo(-0.115, 6);
    expect(maxX).toBeCloseTo(0.115, 6);
  });

  it('gera bomba, reservatório e ventosa', () => {
    const pump = placeEquipment(createProject('g'), {
      fitting: { kind: 'pump' },
      spec,
      position: vec3(0, 0, 0),
    });
    if (!pump.ok) throw new Error(pump.error.message);
    const tank = placeEquipment(pump.value.project, {
      fitting: { kind: 'tank' },
      spec,
      position: vec3(5, 0, 0),
    });
    if (!tank.ok) throw new Error(tank.error.message);
    const air = attachFitting(tank.value.project, {
      target: { elementId: tank.value.elementId, portId: 'a' },
      fitting: { kind: 'valve', valveType: 'airRelease' },
    });
    if (!air.ok) throw new Error(air.error.message);
    for (const element of air.value.project.elements) {
      const geometry = buildElementGeometry(element);
      expect(geometry.parts.length).toBeGreaterThan(0);
      for (const part of geometry.parts) expectValidMesh(part.mesh);
    }
  });
});

describe('geometria paramétrica', () => {
  const elements = build();

  it('gera malhas válidas para todos os tipos de elemento', () => {
    expect(new Set(elements.map((e) => e.kind))).toEqual(
      new Set(['pipe', 'tee', 'valve', 'elbow', 'reducer']),
    );
    for (const element of elements) {
      for (const part of buildElementGeometry(element).parts) expectValidMesh(part.mesh);
    }
  });

  it('a geometria chega exatamente às portas, em qualquer orientação', () => {
    for (const element of elements) {
      for (const port of getPorts(element)) {
        // Cada porta fica no centro de uma boca: há vértices a um raio externo de distância.
        const radius = port.spec.outerDiameter / 2;
        expect(distanceToMesh(element, port.position)).toBeLessThanOrEqual(radius + 1e-6);
        expect(distanceToMesh(element, port.position)).toBeGreaterThan(
          port.spec.innerDiameter / 2 - 1e-6,
        );
      }
    }
  });

  it('o tubo tem comprimento e raios coerentes com os parâmetros', () => {
    const pipe = elements.find((e) => e.kind === 'pipe')!;
    const mesh = buildElementGeometry(pipe).parts[0]!.mesh;
    let maxX = -Infinity;
    let minX = Infinity;
    let maxR = 0;
    let minR = Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      maxX = Math.max(maxX, mesh.positions[i]!);
      minX = Math.min(minX, mesh.positions[i]!);
      const r = Math.hypot(mesh.positions[i + 1]!, mesh.positions[i + 2]!);
      maxR = Math.max(maxR, r);
      minR = Math.min(minR, r);
    }
    const ports = getPorts(pipe);
    const length = Math.hypot(
      ports[1]!.position.x - ports[0]!.position.x,
      ports[1]!.position.y - ports[0]!.position.y,
      ports[1]!.position.z - ports[0]!.position.z,
    );
    expect(minX).toBeCloseTo(0);
    expect(maxX).toBeCloseTo(length, 5);
    expect(maxR).toBeCloseTo(0.03, 6);
    expect(minR).toBeCloseTo(0.027, 6);
  });
});
