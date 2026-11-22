import { describe, expect, it } from 'vitest';
import { planConnection } from './alignConnect';
import { deflectedElbowClosure } from './closure';
import { routeConnection } from './connectionRoute';
import { connectedComponent, findConnection, resolvePort } from './connectivity';
import { GENERIC_CATALOG, type FittingCatalog } from './families';
import { add, distance, vec3, type Vec3 } from './math';
import { addPipe, attachFitting, createProject } from './operations';
import type { PipeSpec, PortRef, Project } from './schema';
import { testSpec } from './testSupport';
import { degToRad } from './units';
import { validateProject } from './validation';

// Dimensões fictícias, declaradas apenas para exercitar o solucionador sem depender do catálogo.
const catalog: FittingCatalog = {
  ...GENERIC_CATALOG,
  elbow: () => ({ familyId: 'joelho-teste-90', ends: {}, bendRadius: 0.2 }),
};

function fixture(origin = vec3(0, 0, 0), rotation = 0, tinyOffset = true) {
  const transform = (point: Vec3) =>
    add(
      origin,
      vec3(
        point.x * Math.cos(rotation) - point.y * Math.sin(rotation),
        point.x * Math.sin(rotation) + point.y * Math.cos(rotation),
        point.z,
      ),
    );
  const spec = testSpec(150);
  const first = addPipe(createProject('Eixos reversos'), {
    start: transform(vec3(-3, 0, 665.153)),
    end: transform(vec3(0, 0, 665.153)),
    spec,
  });
  if (!first.ok) throw new Error(first.error.message);
  const second = addPipe(first.value.project, {
    start: transform(vec3(4, 10.2, tinyOffset ? 665.1575833333 : 665.306)),
    end: transform(vec3(4, 7.2, tinyOffset ? 665.153 : 665.306)),
    spec,
  });
  if (!second.ok) throw new Error(second.error.message);
  const equipment = attachFitting(second.value.project, {
    target: { elementId: first.value.elementId, portId: 'start' },
    fitting: { kind: 'tank', diameter: 2, height: 2 },
  });
  if (!equipment.ok) throw new Error(equipment.error.message);
  return {
    project: equipment.value.project,
    a: { elementId: first.value.elementId, portId: 'end' },
    b: { elementId: second.value.elementId, portId: 'end' },
    catalog,
    elbowAngles: [Math.PI / 2],
  };
}

function assertConnected(before: Project, after: Project, a: PortRef, b: PortRef) {
  for (const original of before.elements) {
    expect(after.elements.find((element) => element.id === original.id)).toEqual(original);
  }
  expect(connectedComponent(after, a.elementId)).toContain(b.elementId);
  expect(findConnection(after, a)).toBeDefined();
  expect(findConnection(after, b)).toBeDefined();
  for (const connection of after.connections) {
    const first = resolvePort(after, connection.a)!;
    const second = resolvePort(after, connection.b)!;
    expect(distance(first.position, second.position)).toBeLessThan(1e-7);
  }
  expect(validateProject(after)).toEqual([]);
}

describe('percurso espacial entre extremidades', () => {
  it.each([
    [vec3(0, 0, 0), 0],
    [vec3(500000, 8000000, 0), 0.71],
  ])('vence 11 mm entre os eixos sem alterar extremidades e equipamento', (origin, rotation) => {
    const input = fixture(origin, rotation);
    const before = structuredClone(input.project);
    const planned = planConnection(input.project, { ...input, from: input.a, to: input.b });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.guides.relation).toBe('skew');
    const route = planned.value.candidates.find(
      (candidate) => candidate.key === 'route:orthogonal',
    );
    expect(route, planned.value.refusals.join(' ')).toBeDefined();
    if (!route) return;
    expect(route.movedIds).toEqual([]);
    expect(route.createdIds).toHaveLength(7);
    expect(route.project.elements.filter((element) => element.kind === 'elbow')).toHaveLength(3);
    assertConnected(input.project, route.project, input.a, input.b);
    expect(input.project).toEqual(before);
  });

  describe('alternativa simples: um joelho com deflexão na junta', () => {
    // Junta elástica fictícia (5°), só para exercitar a deflexão admitida.
    const elastic: PipeSpec = { ...testSpec(100), jointDeflection: degToRad(5) };
    // Partida ao longo de +X; referência chegando a `angle` do eixo de partida, `lift` acima.
    function meeting(angle: number, lift: number, spec = elastic) {
      const first = addPipe(createProject('Encontro'), {
        start: vec3(-3, 0, 665),
        end: vec3(0, 0, 665),
        spec,
      });
      if (!first.ok) throw new Error(first.error.message);
      const along = vec3(Math.cos(angle), Math.sin(angle), 0);
      const corner = vec3(4, 0, 665 + lift);
      const second = addPipe(first.value.project, {
        start: add(corner, vec3(along.x * 5, along.y * 5, 0)),
        end: add(corner, vec3(along.x * 2, along.y * 2, 0)),
        spec,
      });
      if (!second.ok) throw new Error(second.error.message);
      return {
        project: second.value.project,
        from: { elementId: first.value.elementId, portId: 'end' },
        to: { elementId: second.value.elementId, portId: 'end' },
        catalog,
        elbowAngles: [Math.PI / 4, Math.PI / 2],
      };
    }

    it.each([
      ['eixos na mesma cota que se encontram a 88,9°', degToRad(91.1), 0],
      ['eixos reversos por 13 mm', degToRad(90), 0.013],
    ])('%s: oferece um joelho de 90° antes do percurso de três', (_title, angle, lift) => {
      const input = meeting(angle, lift);
      const before = structuredClone(input.project);
      const planned = planConnection(input.project, input);
      expect(planned.ok).toBe(true);
      if (!planned.ok) return;
      const keys = planned.value.candidates.map((candidate) => candidate.key);
      expect(keys.slice(0, 2)).toEqual(['elbowDeflected:90', 'route:orthogonal']);
      const simple = planned.value.candidates[0]!;
      expect(simple.movedIds).toEqual([]);
      expect(simple.createdIds).toHaveLength(2);
      expect(simple.summary).toContain('deflexão de');
      const elbows = simple.project.elements.filter((element) => element.kind === 'elbow');
      expect(elbows).toHaveLength(1);
      expect(elbows[0]?.kind === 'elbow' && elbows[0].angle).toBeCloseTo(Math.PI / 2, 9);
      // A referência não é alterada; a ligação fica registrada e o projeto valida.
      const target = input.project.elements.find((element) => element.id === input.to.elementId);
      expect(simple.project.elements.find((element) => element.id === input.to.elementId)).toBe(
        target,
      );
      expect(connectedComponent(simple.project, input.from.elementId)).toContain(
        input.to.elementId,
      );
      expect(findConnection(simple.project, input.to)).toBeDefined();
      expect(validateProject(simple.project)).toEqual([]);
      expect(input.project).toEqual(before);
    });

    it('não oferece o joelho único quando a junta não admite a deflexão', () => {
      const input = meeting(degToRad(91.1), 0, testSpec(100));
      const planned = planConnection(input.project, input);
      expect(planned.ok).toBe(true);
      if (!planned.ok) return;
      const keys = planned.value.candidates.map((candidate) => candidate.key);
      expect(keys.some((key) => key.includes('elbowDeflected'))).toBe(false);
      expect(keys).toContain('route:orthogonal');
      const refused = deflectedElbowClosure(input.project, {
        ...input,
        a: input.from,
        b: input.to,
      });
      expect(!refused.ok && refused.error.code).toBe('DEFLECTION_EXCEEDED');
    });
  });

  it('vence o desnível de 153 mm com os mesmos três joelhos reais', () => {
    const input = fixture(vec3(0, 0, 0), 0, false);
    const route = routeConnection(input.project, input);
    expect(route.ok ? '' : route.error.message).toBe('');
    if (route.ok) assertConnected(input.project, route.value.project, input.a, input.b);
  });

  it('recusa sem joelho de 90° de catálogo e não altera o projeto', () => {
    const input = fixture();
    const before = structuredClone(input.project);
    const missing = routeConnection(input.project, { ...input, catalog: GENERIC_CATALOG });
    expect(!missing.ok && missing.error.code).toBe('NO_ROUTE_ELBOW');
    const angle = routeConnection(input.project, { ...input, elbowAngles: [Math.PI / 4] });
    expect(!angle.ok && angle.error.code).toBe('NO_ROUTE_ELBOW');
    expect(input.project).toEqual(before);
  });

  it('recusa portas ocupadas e espaço insuficiente para as peças', () => {
    const input = fixture();
    const occupied = routeConnection(input.project, {
      ...input,
      a: { ...input.a, portId: 'start' },
    });
    expect(!occupied.ok && occupied.error.code).toBe('PORT_OCCUPIED');
    const oversized: FittingCatalog = {
      ...catalog,
      elbow: () => ({ familyId: 'teste', ends: {}, bendRadius: 100 }),
    };
    const tooShort = routeConnection(input.project, { ...input, catalog: oversized });
    expect(!tooShort.ok && tooShort.error.code).toBe('NO_ROUTE');
  });
});
