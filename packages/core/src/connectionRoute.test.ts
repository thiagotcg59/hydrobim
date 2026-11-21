import { describe, expect, it } from 'vitest';
import { planConnection } from './alignConnect';
import { routeConnection } from './connectionRoute';
import { connectedComponent, findConnection, resolvePort } from './connectivity';
import { GENERIC_CATALOG, type FittingCatalog } from './families';
import { add, distance, vec3, type Vec3 } from './math';
import { addPipe, attachFitting, createProject } from './operations';
import type { PortRef, Project } from './schema';
import { testSpec } from './testSupport';
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
