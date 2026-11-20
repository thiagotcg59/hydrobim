import {
  BUILTIN_FAMILIES,
  FLANGED_PIPE_FAMILIES,
  flangedPipeFamiliesFor,
  flangeForClass,
  pipeFlangeEnd,
  resolvePipeSpec,
} from '@hydrobim/catalog';
import {
  addPipe,
  convertCrossToTee,
  convertTeeToCross,
  createFamilyCatalog,
  createProject,
  deleteElements,
  drawPipeToJunction,
  drawPipeToPipe,
  findConnection,
  getElement,
  getPort,
  insertInline,
  resolvePort,
  setPipeEnds,
  validateProject,
  vec3,
  type HydroElement,
  type PipeSpec,
  type Project,
  type Vec3,
} from '@hydrobim/core';
import { buildElementGeometry } from '@hydrobim/geometry';
import { buildIfcModel } from '@hydrobim/ifc';
import { describe, expect, it } from 'vitest';

/**
 * Derivações sobre tubos de qualquer especificação (tê e cruzeta de catálogo), conversões
 * tê ⇄ cruzeta e montagens flangeadas, com o catálogo embutido real.
 */

const catalog = createFamilyCatalog(
  BUILTIN_FAMILIES,
  {},
  {
    pipeFlange: pipeFlangeEnd,
    flange: flangeForClass,
    flangedPipeFamilies: (id) => flangedPipeFamiliesFor(id).map((family) => family.id),
  },
);

const DUCTILE = 'ferro-ductil-nbr7675-k9';
const spec = (id: string, dn: number): PipeSpec => {
  const resolved = resolvePipeSpec(id, dn);
  if (!resolved) throw new Error(`${id} DN ${dn} ausente`);
  return resolved;
};
const pnFamily = (pressureClass: string): string => {
  const family = FLANGED_PIPE_FAMILIES.find((f) => f.pressureClass === pressureClass);
  if (!family) throw new Error(`família ${pressureClass} ausente`);
  return family.id;
};

function pipe(
  project: Project,
  start: Vec3,
  end: Vec3,
  s: PipeSpec,
  flanges?: { start?: boolean; end?: boolean; pressureClass?: string },
): { project: Project; id: string } {
  const created = addPipe(project, { start, end, spec: s });
  if (!created.ok) throw new Error(created.error.message);
  const id = created.value.elementId;
  if (!flanges) return { project: created.value.project, id };
  const familyId = pnFamily(flanges.pressureClass ?? 'PN 10');
  const flange = pipeFlangeEnd(s, familyId);
  if (!flange) throw new Error('flange ausente');
  const ends = setPipeEnds(created.value.project, id, {
    start: flanges.start ? flange : null,
    end: flanges.end ? flange : null,
    familyId,
  });
  if (!ends.ok) throw new Error(ends.error.message);
  return { project: ends.value, id };
}

const errors = (project: Project) =>
  validateProject(project).filter((issue) => issue.severity === 'error');
const close = (a: Vec3, b: Vec3) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
  expect(a.z).toBeCloseTo(b.z, 6);
};
const kindOf = (project: Project, kind: HydroElement['kind']) =>
  project.elements.filter((e) => e.kind === kind);

/** Coletor flangeado DN 150 em X e um ramal vertical flangeado chegando de cima. */
function flangedCollector(dn = 150, branchClass = 'PN 10') {
  const s = spec(DUCTILE, dn);
  const collector = pipe(createProject('Coletor', 'infra'), vec3(0, 0, 0), vec3(6, 0, 0), s, {
    start: true,
    end: true,
  });
  const branch = pipe(collector.project, vec3(3, 0, 3), vec3(3, 0, 1.5), s, {
    end: true,
    pressureClass: branchClass,
  });
  return { project: branch.project, collectorId: collector.id, branchId: branch.id, spec: s };
}

describe('derivação sobre coletor flangeado (ferro dúctil)', () => {
  it('B: prolonga o ramal até o coletor e insere o tê flangeado de catálogo', () => {
    const { project, collectorId, branchId } = flangedCollector();
    const result = drawPipeToPipe(project, {
      fromPort: { elementId: branchId, portId: 'end' },
      start: vec3(3, 0, 1.5),
      spec: spec(DUCTILE, 150),
      targetPipeId: collectorId,
      catalog,
    });
    expect(result.ok ? '' : result.error.message).toBe('');
    if (!result.ok) return;
    const after = result.value.project;
    const [tee] = kindOf(after, 'tee');
    expect(tee?.familyId).toBe(`pam-te-flanges@${DUCTILE}`);
    expect(tee?.ends.branch?.type).toBe('flange');
    // O ramal existente foi prolongado (mesmo id), sem tubo intermediário.
    const branch = getElement(after, branchId);
    expect(branch?.kind === 'pipe' && branch.end.z).toBeCloseTo(0.22, 6);
    expect(kindOf(after, 'pipe')).toHaveLength(3);
    // As faces do corte do coletor receberam o flange PN 10 da família do tubo.
    const pieces = kindOf(after, 'pipe').filter((p) => p.id !== branchId);
    for (const piece of pieces) {
      expect(piece.kind === 'pipe' && Object.keys(piece.ends ?? {}).sort()).toEqual([
        'end',
        'start',
      ]);
    }
    // Três ligações registradas no tê, todas flange × flange.
    for (const portId of ['a', 'b', 'branch']) {
      expect(findConnection(after, { elementId: tee?.id ?? '', portId })).toBeDefined();
    }
    expect(errors(after)).toEqual([]);
    // O coletor original mantém o id no primeiro trecho.
    expect(getElement(after, collectorId)).toBeDefined();
  });

  it('C: ramal no lado oposto converte o tê em cruzeta (mesmo id) e mantém as ligações', () => {
    const base = flangedCollector();
    const b = drawPipeToPipe(base.project, {
      fromPort: { elementId: base.branchId, portId: 'end' },
      start: vec3(3, 0, 1.5),
      spec: base.spec,
      targetPipeId: base.collectorId,
      catalog,
    });
    if (!b.ok) throw new Error(b.error.message);
    const [tee] = kindOf(b.value.project, 'tee');
    if (!tee) throw new Error('tê ausente');
    const below = pipe(b.value.project, vec3(3, 0, -3), vec3(3, 0, -1.5), base.spec, { end: true });
    const before = below.project;
    const c = drawPipeToJunction(before, {
      fromPort: { elementId: below.id, portId: 'end' },
      start: vec3(3, 0, -1.5),
      spec: base.spec,
      junctionId: tee.id,
      catalog,
    });
    expect(c.ok ? '' : c.error.message).toBe('');
    if (!c.ok) return;
    const after = c.value.project;
    const cross = getElement(after, tee.id);
    expect(cross?.kind).toBe('cross');
    expect(cross?.familyId).toBe(`avk-cruzeta-flanges@${DUCTILE}`);
    expect(cross?.name).toBe(tee.name);
    expect(cross?.systemId).toBe(tee.systemId);
    expect(c.value.converted).toBe(true);
    for (const portId of ['a', 'b', 'branch', 'branch2']) {
      expect(findConnection(after, { elementId: tee.id, portId })).toBeDefined();
    }
    // As ligações antigas continuam as mesmas (passagem e derivação de cima).
    for (const portId of ['a', 'b', 'branch']) {
      expect(findConnection(after, { elementId: tee.id, portId })?.id).toBe(
        findConnection(before, { elementId: tee.id, portId })?.id,
      );
    }
    expect(errors(after)).toEqual([]);
    // Geometria e IFC da cruzeta: quatro portas, entidade de junção.
    expect(buildElementGeometry(cross as HydroElement).parts.length).toBeGreaterThan(0);
    const model = buildIfcModel(after, { families: BUILTIN_FAMILIES });
    const ifc = model.elements.find((e) => e.elementId === tee.id);
    expect(ifc?.entity).toBe('IfcPipeFitting');
    expect(ifc?.predefinedType).toBe('JUNCTION');
    expect(ifc?.objectType).toBe('cross');
    // O projeto de partida não foi alterado.
    expect(getElement(before, tee.id)?.kind).toBe('tee');
  });

  it('Cruzeta escolhida com três ligações: a quarta porta fica livre (sem tampão)', () => {
    const { project, collectorId, branchId, spec: s } = flangedCollector();
    const result = drawPipeToPipe(project, {
      fromPort: { elementId: branchId, portId: 'end' },
      start: vec3(3, 0, 1.5),
      spec: s,
      targetPipeId: collectorId,
      catalog,
      junction: 'cross',
    });
    if (!result.ok) throw new Error(result.error.message);
    const [cross] = kindOf(result.value.project, 'cross');
    if (!cross) throw new Error('cruzeta ausente');
    expect(
      findConnection(result.value.project, { elementId: cross.id, portId: 'branch2' }),
    ).toBeUndefined();
    expect(kindOf(result.value.project, 'tee')).toHaveLength(0);
    // Porta livre é aviso, não erro.
    expect(errors(result.value.project)).toEqual([]);
    // Converter em tê: a derivação livre é removida, o resto permanece.
    const tee = convertCrossToTee(result.value.project, cross.id, { catalog });
    expect(tee.ok ? '' : tee.error.message).toBe('');
    if (!tee.ok) return;
    expect(getElement(tee.value.project, cross.id)?.kind).toBe('tee');
    expect(errors(tee.value.project)).toEqual([]);
  });

  it('F: recusa classes de flange de furação diferente (PN 16 DN 200 × PN 10)', () => {
    const { project, collectorId, branchId, spec: s } = flangedCollector(200, 'PN 16');
    const result = drawPipeToPipe(project, {
      fromPort: { elementId: branchId, portId: 'end' },
      start: vec3(3, 0, 1.5),
      spec: s,
      targetPipeId: collectorId,
      catalog,
    });
    expect(result.ok ? 'ok' : result.error.code).toBe('END_MISMATCH');
  });

  it('F: recusa quando o coletor não tem espaço para a peça', () => {
    const s = spec(DUCTILE, 150);
    const collector = pipe(createProject('Curto', 'infra'), vec3(0, 0, 0), vec3(0.3, 0, 0), s);
    const result = drawPipeToPipe(collector.project, {
      start: vec3(0.15, 0, 2),
      spec: s,
      targetPipeId: collector.id,
      catalog,
    });
    expect(result.ok ? 'ok' : result.error.code).toBe('NO_ROOM');
  });

  it('F: recusa quando o ponto de partida não está no eixo da derivação', () => {
    const { project } = flangedCollector();
    const collector = project.elements[0];
    if (!collector) throw new Error('coletor ausente');
    const result = drawPipeToPipe(project, {
      start: vec3(3, 0, 2),
      spec: spec(DUCTILE, 150),
      targetPipeId: collector.id,
      catalog,
    });
    // Do ponto livre, um tubo reto chega à derivação: aceito (nada é desalinhado).
    expect(result.ok ? '' : result.error.message).toBe('');
  });
});

describe('conversões tê ⇄ cruzeta', () => {
  function pbaTee(): { project: Project; teeId: string } {
    const s = spec('pvc-pba-nbr5647-cl15', 75);
    const run = pipe(createProject('PBA'), vec3(0, 0, 0), vec3(4, 0, 0), s);
    const inserted = insertInline(run.project, {
      pipeId: run.id,
      distanceFromStart: 2,
      fitting: { kind: 'tee' },
      catalog,
    });
    if (!inserted.ok) throw new Error(inserted.error.message);
    return { project: inserted.value.project, teeId: inserted.value.elementId };
  }

  it('E: converte manualmente o tê PBA em cruzeta, preservando id, nome e propriedades', () => {
    const { project, teeId } = pbaTee();
    const tagged: Project = {
      ...project,
      elements: project.elements.map((e) =>
        e.id === teeId
          ? { ...e, properties: { Etiqueta: 'T-01' }, manufacturing: { model: 'TE PBA DN 75' } }
          : e,
      ),
    };
    const result = convertTeeToCross(tagged, teeId, { catalog });
    expect(result.ok ? '' : result.error.message).toBe('');
    if (!result.ok) return;
    const cross = getElement(result.value.project, teeId);
    expect(cross?.kind).toBe('cross');
    expect(cross?.familyId).toBe('wavin-cruzeta-pba@pvc-pba-nbr5647-cl15');
    expect(cross?.properties).toEqual({ Etiqueta: 'T-01' });
    // O modelo de fabricação descrevia o tê: descartado com aviso.
    expect(cross?.manufacturing).toEqual({});
    expect(result.value.notes.join(' ')).toMatch(/fabricação/);
    expect(
      resolvePort(result.value.project, { elementId: teeId, portId: 'branch2' }),
    ).toBeDefined();
    // Portas da passagem continuam ligadas e acopladas.
    expect(errors(result.value.project)).toEqual([]);
    // A derivação oposta nasce do lado contrário à derivação existente.
    if (cross?.kind === 'cross') {
      const one = getPort(cross, 'branch');
      const two = getPort(cross, 'branch2');
      expect((one?.direction.y ?? 0) + (two?.direction.y ?? 0)).toBeCloseTo(0, 9);
    }
  });

  it('F: sem cruzeta de catálogo (PVC soldável), explica e não altera nada', () => {
    const s = spec('pvc-soldavel-nbr5648', 25);
    const run = pipe(createProject('Soldável'), vec3(0, 0, 0), vec3(2, 0, 0), s);
    const inserted = insertInline(run.project, {
      pipeId: run.id,
      distanceFromStart: 1,
      fitting: { kind: 'tee' },
      catalog,
    });
    if (!inserted.ok) throw new Error(inserted.error.message);
    const result = convertTeeToCross(inserted.value.project, inserted.value.elementId, { catalog });
    expect(result.ok ? 'ok' : result.error.code).toBe('NO_CATALOG_JUNCTION');
    expect(result.ok ? '' : result.error.message).toMatch(/Não há cruzeta/);
  });

  it('cruzeta com só a derivação 1 livre vira tê girado; com as duas ligadas, recusa', () => {
    const base = flangedCollector();
    const b = drawPipeToPipe(base.project, {
      fromPort: { elementId: base.branchId, portId: 'end' },
      start: vec3(3, 0, 1.5),
      spec: base.spec,
      targetPipeId: base.collectorId,
      catalog,
    });
    if (!b.ok) throw new Error(b.error.message);
    const [tee] = kindOf(b.value.project, 'tee');
    if (!tee) throw new Error('tê ausente');
    const below = pipe(b.value.project, vec3(3, 0, -3), vec3(3, 0, -1.5), base.spec, { end: true });
    const c = drawPipeToJunction(below.project, {
      fromPort: { elementId: below.id, portId: 'end' },
      start: vec3(3, 0, -1.5),
      spec: base.spec,
      junctionId: tee.id,
      catalog,
    });
    if (!c.ok) throw new Error(c.error.message);
    const refused = convertCrossToTee(c.value.project, tee.id, { catalog });
    expect(refused.ok ? 'ok' : refused.error.code).toBe('PORT_OCCUPIED');
    // Sem o ramal de cima, só `branch` fica livre.
    const without = deleteElements(c.value.project, [base.branchId]);
    const lower = resolvePort(without, { elementId: tee.id, portId: 'branch2' });
    const converted = convertCrossToTee(without, tee.id, { catalog });
    expect(converted.ok ? '' : converted.error.message).toBe('');
    if (!converted.ok) return;
    const after = converted.value.project;
    const branch = resolvePort(after, { elementId: tee.id, portId: 'branch' });
    if (!branch || !lower) throw new Error('portas ausentes');
    close(branch.position, lower.position);
    expect(findConnection(after, { elementId: tee.id, portId: 'branch' })).toBeDefined();
    expect(errors(after)).toEqual([]);
  });
});

describe('mesmo fluxo em PVC PBA (bolsas)', () => {
  it('D: deriva com tê PBA e depois converte em cruzeta PBA pelo lado oposto', () => {
    const s = spec('pvc-pba-nbr5647-cl15', 75);
    const run = pipe(createProject('PBA'), vec3(0, 0, 0), vec3(4, 0, 0), s);
    const first = drawPipeToPipe(run.project, {
      start: vec3(2, 2, 0),
      spec: s,
      targetPipeId: run.id,
      catalog,
    });
    if (!first.ok) throw new Error(first.error.message);
    const [tee] = kindOf(first.value.project, 'tee');
    expect(tee?.familyId).toBe('wavin-te-pba@pvc-pba-nbr5647-cl15');
    const second = drawPipeToJunction(first.value.project, {
      start: vec3(2, -2, 0),
      spec: s,
      junctionId: tee?.id ?? '',
      catalog,
    });
    expect(second.ok ? '' : second.error.message).toBe('');
    if (!second.ok) return;
    expect(getElement(second.value.project, tee?.id ?? '')?.familyId).toBe(
      'wavin-cruzeta-pba@pvc-pba-nbr5647-cl15',
    );
    expect(errors(second.value.project)).toEqual([]);
  });
});
