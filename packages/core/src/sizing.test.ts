import { describe, expect, it } from 'vitest';
import { arePortsAligned, getElement, resolvePort } from './connectivity';
import { createFamilyCatalog, GENERIC_CATALOG } from './families';
import { distance, vec3 } from './math';
import {
  addPipe,
  attachFitting,
  copyElements,
  createProject,
  drawPipe,
  insertInline,
  placeEquipment,
  updateFitting,
} from './operations';
import { getPort, getPorts, pipeLength } from './ports';
import { applyFamilyToInstances, upsertFamily } from './projectOps';
import type { Result } from './result';
import type { FittingFamily, Pipe, Project } from './schema';
import { parseProjectDocument, serializeProject } from './serialization';
import { resizeWithReducers } from './sizing';
import { testSpec } from './testSupport';
import { validateProject } from './validation';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

const pipeOf = (project: Project, id: string): Pipe => {
  const e = getElement(project, id);
  if (!e || e.kind !== 'pipe') throw new Error('não é tubo');
  return e;
};

function expectCoupled(project: Project): void {
  for (const c of project.connections) {
    const a = resolvePort(project, c.a);
    const b = resolvePort(project, c.b);
    expect(a && b && arePortsAligned(a, b)).toBe(true);
  }
  expect(validateProject(project).filter((i) => i.severity === 'error')).toEqual([]);
}

const kinds = (project: Project, kind: string) => project.elements.filter((e) => e.kind === kind);

/** Tubo A — joelho — tubo B — tê em linha (em B) — tubo C. Tudo DN 50. */
function network() {
  const p0 = createProject('Rede');
  const a = unwrap(addPipe(p0, { start: vec3(0, 0, 0), end: vec3(4, 0, 0), spec: testSpec(50) }));
  const b = unwrap(
    drawPipe(a.project, {
      fromPort: { elementId: a.elementId, portId: 'end' },
      start: vec3(0, 0, 0),
      end: vec3(4, 6, 0),
      spec: testSpec(50),
    }),
  );
  const tee = unwrap(
    insertInline(b.project, {
      pipeId: b.elementId,
      distanceFromStart: 3,
      fitting: { kind: 'tee' },
    }),
  );
  return {
    project: tee.project,
    a: a.elementId,
    elbow: b.createdIds[0]!,
    b: b.elementId,
    tee: tee.elementId,
    c: tee.createdIds[1]!,
  };
}

describe('troca de diâmetro com reduções automáticas', () => {
  it('altera só o tubo e insere reduções nas duas extremidades conectadas', () => {
    const n = network();
    const before = n.project;
    const result = unwrap(resizeWithReducers(before, n.b, testSpec(25)));
    const project = result.project;

    expect(result.createdIds).toHaveLength(2);
    expect(kinds(project, 'reducer')).toHaveLength(2);
    expect(pipeOf(project, n.b).spec.dn).toBe(25);
    // Vizinhos preservam diâmetro e posição.
    for (const id of [n.a, n.elbow, n.tee, n.c]) {
      expect(getElement(project, id)).toEqual(getElement(before, id));
    }
    // O tubo cede exatamente o comprimento das duas reduções.
    const reducers = kinds(project, 'reducer');
    const taken = reducers.reduce((sum, r) => sum + (r.kind === 'reducer' ? r.length : 0), 0);
    expect(pipeLength(pipeOf(project, n.b))).toBeCloseTo(pipeLength(pipeOf(before, n.b)) - taken);
    expect(project.connections).toHaveLength(before.connections.length + 2);
    expectCoupled(project);
  });

  it('ajusta reduções existentes em vez de empilhar novas', () => {
    const n = network();
    const once = unwrap(resizeWithReducers(n.project, n.b, testSpec(25))).project;
    const twice = unwrap(resizeWithReducers(once, n.b, testSpec(32)));
    expect(twice.createdIds).toEqual([]);
    expect(kinds(twice.project, 'reducer')).toHaveLength(2);
    for (const r of kinds(twice.project, 'reducer')) {
      expect(r.kind === 'reducer' && [r.spec.dn, r.outletSpec.dn].sort()).toEqual([32, 50]);
    }
    expectCoupled(twice.project);
  });

  it('remove as reduções ao voltar ao diâmetro original, restaurando o tubo', () => {
    const n = network();
    const reduced = unwrap(resizeWithReducers(n.project, n.b, testSpec(25))).project;
    const restored = unwrap(resizeWithReducers(reduced, n.b, testSpec(50)));
    expect(restored.removedIds).toHaveLength(2);
    expect(kinds(restored.project, 'reducer')).toHaveLength(0);
    const original = pipeOf(n.project, n.b);
    const back = pipeOf(restored.project, n.b);
    expect(distance(back.start, original.start)).toBeLessThan(1e-9);
    expect(distance(back.end, original.end)).toBeLessThan(1e-9);
    expect(restored.project.connections).toHaveLength(n.project.connections.length);
    expectCoupled(restored.project);
  });

  it('altera só uma conexão: os tubos vizinhos cedem espaço às reduções', () => {
    const n = network();
    const result = unwrap(resizeWithReducers(n.project, n.tee, testSpec(100)));
    const project = result.project;
    expect(result.createdIds).toHaveLength(2); // a derivação está livre
    expect(getElement(project, n.tee)?.spec.dn).toBe(100);
    expect(pipeOf(project, n.b).spec.dn).toBe(50);
    expect(pipeOf(project, n.c).spec.dn).toBe(50);
    // O tê permanece no lugar.
    const teeBefore = getElement(n.project, n.tee);
    const teeAfter = getElement(project, n.tee);
    expect(teeAfter?.kind === 'tee' && teeBefore?.kind === 'tee' && teeAfter.placement).toEqual(
      teeBefore?.kind === 'tee' ? teeBefore.placement : null,
    );
    expectCoupled(project);
  });

  it('extremidade livre não recebe redução', () => {
    const p0 = createProject('Rede');
    const a = unwrap(addPipe(p0, { start: vec3(0, 0, 0), end: vec3(4, 0, 0), spec: testSpec(50) }));
    const result = unwrap(resizeWithReducers(a.project, a.elementId, testSpec(25)));
    expect(result.createdIds).toEqual([]);
    expect(result.project.elements).toHaveLength(1);
  });

  it('recusa quando não há espaço ou quando muda o material', () => {
    const p0 = createProject('Rede');
    const a = unwrap(addPipe(p0, { start: vec3(0, 0, 0), end: vec3(1, 0, 0), spec: testSpec(50) }));
    const b = unwrap(
      addPipe(a.project, { start: vec3(1, 0, 0), end: vec3(1.05, 0, 0), spec: testSpec(50) }),
    );
    const c = unwrap(
      addPipe(b.project, { start: vec3(1.05, 0, 0), end: vec3(3, 0, 0), spec: testSpec(50) }),
    );
    const noRoom = resizeWithReducers(c.project, b.elementId, testSpec(25));
    expect(noRoom.ok ? '' : noRoom.error.code).toBe('NO_ROOM');
    const material = resizeWithReducers(c.project, a.elementId, testSpec(25, 'outra-norma'));
    expect(material.ok ? '' : material.error.code).toBe('SPEC_MISMATCH');
  });
});

const elbowFamily: FittingFamily = {
  id: 'fam-joelho-90',
  name: 'Joelho 90° de teste',
  kind: 'elbow',
  specificationId: 'test-spec',
  endType: 'socket',
  angle: Math.PI / 2,
  manufacturer: null,
  standard: 'Teste',
  source: 'teste',
  origin: 'builtin',
  sizes: [
    { dn: 50, centerToEnd: 0.04, end: { length: 0.03, outerDiameter: 0.07 } },
    { dn: 25, centerToEnd: 0.02, end: { length: 0.018, outerDiameter: 0.042 } },
  ],
};

describe('famílias de catálogo', () => {
  const catalog = createFamilyCatalog([elbowFamily]);

  it('usa as dimensões da família e cai no genérico fora do catálogo', () => {
    const hit = catalog.elbow(testSpec(50), Math.PI / 2);
    expect(hit.familyId).toBe('fam-joelho-90');
    expect(hit.bendRadius).toBeCloseTo(0.04);
    expect(hit.ends.a).toEqual({ type: 'socket', length: 0.03, outerDiameter: 0.07 });
    expect(catalog.elbow(testSpec(80), Math.PI / 2).familyId).toBeNull();
    expect(catalog.elbow(testSpec(50), Math.PI / 4).familyId).toBeNull();
    expect(catalog.tee(testSpec(50), testSpec(50))).toEqual(
      GENERIC_CATALOG.tee(testSpec(50), testSpec(50)),
    );
  });

  it('aplica a família ao desenhar e ao alterar o diâmetro', () => {
    const p0 = createProject('Rede');
    const a = unwrap(addPipe(p0, { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec: testSpec(50) }));
    const b = unwrap(
      drawPipe(a.project, {
        fromPort: { elementId: a.elementId, portId: 'end' },
        start: vec3(0, 0, 0),
        end: vec3(2, 2, 0),
        spec: testSpec(50),
        catalog,
      }),
    );
    const elbow = getElement(b.project, b.createdIds[0]!)!;
    expect(elbow.familyId).toBe('fam-joelho-90');
    expect(pipeOf(b.project, a.elementId).end.x).toBeCloseTo(2 - 0.04);
    expect(getPort(elbow, 'b')?.end?.type).toBe('socket');

    // Editar a dimensão manualmente desvincula a peça da família.
    const edited = unwrap(updateFitting(b.project, elbow.id, { bendRadius: 0.06 }));
    expect(getElement(edited, elbow.id)?.familyId).toBeNull();
  });

  it('personaliza a família no projeto e reaplica às peças existentes', () => {
    const p0 = createProject('Rede');
    const a = unwrap(addPipe(p0, { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec: testSpec(50) }));
    const b = unwrap(
      drawPipe(a.project, {
        fromPort: { elementId: a.elementId, portId: 'end' },
        start: vec3(0, 0, 0),
        end: vec3(2, 2, 0),
        spec: testSpec(50),
        catalog,
      }),
    );
    const custom: FittingFamily = {
      ...elbowFamily,
      sizes: elbowFamily.sizes.map((s) => (s.dn === 50 ? { ...s, centerToEnd: 0.055 } : s)),
    };
    const withFamily = unwrap(upsertFamily(b.project, custom));
    expect(withFamily.families[0]?.origin).toBe('custom');
    const applied = unwrap(
      applyFamilyToInstances(withFamily, custom.id, createFamilyCatalog(withFamily.families)),
    );
    expect(applied.updated).toBe(1);
    expect(pipeOf(applied.project, a.elementId).end.x).toBeCloseTo(2 - 0.055);
    expectCoupled(applied.project);

    const invalid = upsertFamily(b.project, { ...custom, sizes: [{ dn: -1 }] });
    expect(invalid.ok).toBe(false);
    const duplicated = upsertFamily(b.project, { ...custom, sizes: [{ dn: 50 }, { dn: 50 }] });
    expect(duplicated.ok ? '' : duplicated.error.code).toBe('DUPLICATE_SIZE');
  });
});

describe('equipamentos e cópia', () => {
  it('posiciona bomba e reservatório com portas coerentes', () => {
    const p0 = createProject('Casa de bombas');
    const pump = unwrap(
      placeEquipment(p0, {
        fitting: { kind: 'pump', dischargeSpec: testSpec(40) },
        spec: testSpec(50),
        position: vec3(1, 1, 0.3),
      }),
    );
    const el = getElement(pump.project, pump.elementId)!;
    const [suction, discharge] = getPorts(el);
    expect(suction?.spec.dn).toBe(50);
    expect(discharge?.spec.dn).toBe(40);
    expect(discharge?.direction.z).toBeCloseTo(1);

    // Tubo de sucção desenhado a partir da porta da bomba (eixo travado).
    const suctionPipe = unwrap(
      drawPipe(pump.project, {
        fromPort: suction!.ref,
        start: vec3(0, 0, 0),
        end: vec3(-1, 1, 0.3),
        spec: testSpec(50),
      }),
    );
    const tank = unwrap(
      attachFitting(suctionPipe.project, {
        target: { elementId: suctionPipe.elementId, portId: 'end' },
        fitting: { kind: 'tank', diameter: 2, height: 2 },
      }),
    );
    const tankEl = getElement(tank.project, tank.elementId)!;
    // O reservatório fica de pé (eixo Z local vertical) e a jusante do tubo.
    expect(tankEl.kind === 'tank' && tankEl.placement.position.x).toBeLessThan(-1);
    expectCoupled(tank.project);
  });

  it('acopla ventosa (porta única) à derivação de um tê', () => {
    const p0 = createProject('Adutora', 'infra');
    const a = unwrap(
      addPipe(p0, { start: vec3(0, 0, 0), end: vec3(6, 0, 0), spec: testSpec(150) }),
    );
    const tee = unwrap(
      insertInline(a.project, {
        pipeId: a.elementId,
        distanceFromStart: 3,
        fitting: { kind: 'tee' },
      }),
    );
    const air = unwrap(
      attachFitting(tee.project, {
        target: { elementId: tee.elementId, portId: 'branch' },
        fitting: { kind: 'valve', valveType: 'airRelease' },
      }),
    );
    expect(getPorts(getElement(air.project, air.elementId)!)).toHaveLength(1);
    expectCoupled(air.project);
    const inline = insertInline(a.project, {
      pipeId: a.elementId,
      distanceFromStart: 3,
      fitting: { kind: 'valve', valveType: 'airRelease' },
    });
    expect(inline.ok ? '' : inline.error.code).toBe('NOT_INLINE');
  });

  it('copia um conjunto preservando as conexões internas', () => {
    const n = network();
    const ids = n.project.elements.map((e) => e.id);
    const copied = unwrap(copyElements(n.project, ids, vec3(0, 0, 3)));
    expect(copied.project.elements).toHaveLength(ids.length * 2);
    expect(copied.project.connections).toHaveLength(n.project.connections.length * 2);
    expect(new Set(copied.project.elements.map((e) => e.id)).size).toBe(ids.length * 2);
    expectCoupled(copied.project);
  });
});

describe('migração de esquema', () => {
  it('abre projetos da versão 1 completando os novos campos', () => {
    const n = network();
    const v2 = JSON.parse(serializeProject(n.project)) as Record<string, unknown>;
    const {
      levels: _l,
      families: _f,
      georeference: _g,
      terrain: _t,
      annotations: _a,
      drawingScale: _s,
      ...rest
    } = v2;
    const v1 = {
      ...rest,
      schemaVersion: 1,
      elements: (v2.elements as Record<string, unknown>[]).map(
        ({ familyId: _id, ends: _ends, ...element }) => element,
      ),
    };
    const migrated = parseProjectDocument(v1);
    expect(migrated.ok ? '' : migrated.error.message).toBe('');
    if (!migrated.ok) return;
    expect(migrated.value.schemaVersion).toBe(4);
    expect(migrated.value.annotations).toEqual([]);
    expect(migrated.value.levels).toHaveLength(1);
    expect(migrated.value.elements.map((e) => e.id)).toEqual(n.project.elements.map((e) => e.id));
    expectCoupled(migrated.value);
  });

  it('abre projetos da versão 2 sem alterar o conteúdo', () => {
    const n = network();
    const current = JSON.parse(serializeProject(n.project)) as Record<string, unknown>;
    const { annotations: _a, drawingScale: _s, ...v2 } = current;
    const migrated = parseProjectDocument({ ...v2, schemaVersion: 2 });
    expect(migrated.ok ? '' : migrated.error.message).toBe('');
    if (!migrated.ok) return;
    expect(migrated.value).toEqual(n.project);
  });
});
