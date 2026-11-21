import {
  BUILTIN_FAMILIES,
  flangedPipeFamiliesFor,
  flangeForClass,
  pipeFlangeEnd,
  PUMP_FAMILIES,
  resolvePipeSpec,
  resolvePumpPlacement,
} from '@hydrobim/catalog';
import {
  add,
  addPipe,
  availableElbowAngles,
  createFamilyCatalog,
  createProject,
  findConnection,
  getElement,
  placeEquipment,
  planConnection,
  resolvePort,
  validateProject,
  vec3,
  type Project,
  type PortRef,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';

/**
 * Caso A: ligar o bocal flangeado de uma bomba de catálogo à extremidade de um tubo
 * horizontal, com a bomba fixa. A porta (posição, direção, cota) é a referência.
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

function scene(
  dz: number,
  dy = 0,
  pipeDn?: number,
): { project: Project; pumpId: string; from: PortRef; to: PortRef } {
  const base = resolvePipeSpec(DUCTILE, 100);
  const family = PUMP_FAMILIES[0];
  if (!base || !family) throw new Error('catálogo incompleto');
  const variant =
    family.variants.find((v) => v.discharge.dn === v.suction.dn) ?? family.variants[0];
  if (!variant) throw new Error('sem linha');
  const placement = resolvePumpPlacement(family, { variantId: variant.id }, base);
  if (!placement.ok) throw new Error(placement.error.message);
  const placed = placeEquipment(createProject('Recalque', 'infra'), {
    spec: placement.value.spec,
    fitting: placement.value.fitting,
    position: vec3(0, 0, 1),
  });
  if (!placed.ok) throw new Error(placed.error.message);
  const pumpId = placed.value.elementId;
  const discharge = resolvePort(placed.value.project, { elementId: pumpId, portId: 'b' });
  if (!discharge) throw new Error('sem descarga');
  // Tubo horizontal de frente para a descarga, 3 m adiante, com desvio vertical `dz`.
  const x = discharge.position.x + 3;
  const pipe = addPipe(placed.value.project, {
    start: vec3(x + 4, dy, discharge.position.z + dz),
    end: vec3(x, dy, discharge.position.z + dz),
    spec: (pipeDn && resolvePipeSpec(DUCTILE, pipeDn)) || discharge.spec,
  });
  if (!pipe.ok) throw new Error(pipe.error.message);
  return {
    project: pipe.value.project,
    pumpId,
    from: { elementId: pipe.value.elementId, portId: 'end' },
    to: { elementId: pumpId, portId: 'b' },
  };
}

const errors = (project: Project) =>
  validateProject(project).filter((issue) => issue.severity === 'error');

describe('Alinhar e conectar a um equipamento', () => {
  it('A: eixos alinhados — prolonga o tubo até o flange da bomba, que fica fixa', () => {
    const { project, pumpId, from, to } = scene(0);
    const plan = planConnection(project, { from, to, catalog });
    expect(plan.ok ? '' : plan.error.message).toBe('');
    if (!plan.ok) return;
    expect(plan.value.guides.relation).toBe('collinear');
    const [first] = plan.value.candidates;
    expect(first?.key).toBe('straight');
    if (!first) return;
    const pump = getElement(first.project, pumpId);
    expect(pump?.kind === 'pump' && pump.placement).toEqual(
      getElement(project, pumpId)?.kind === 'pump' &&
        (getElement(project, pumpId) as { placement: unknown }).placement,
    );
    // O tubo ganhou o flange que casa com o da bomba e a ligação foi registrada.
    const pipe = getElement(first.project, from.elementId);
    expect(pipe?.kind === 'pipe' && pipe.ends?.end?.type).toBe('flange');
    expect(findConnection(first.project, to)).toBeDefined();
    expect(errors(first.project)).toEqual([]);
  });

  it('A: desvio de cota — guias medem o desnível; oferece desvio com joelhos e alinhar a cota', () => {
    const { project, pumpId, from, to } = scene(0.6);
    const spec = resolvePort(project, from)?.spec;
    if (!spec) throw new Error('sem porta');
    const plan = planConnection(project, {
      from,
      to,
      catalog,
      elbowAngles: availableElbowAngles(BUILTIN_FAMILIES, spec),
    });
    if (!plan.ok) throw new Error(plan.error.message);
    const { guides, candidates } = plan.value;
    expect(guides.relation).toBe('parallel');
    expect(guides.verticalOffset).toBeCloseTo(0.6, 9);
    expect(guides.horizontalOffset).toBeCloseTo(0, 9);
    expect(guides.ahead).toBeCloseTo(3, 9);
    const keys = candidates.map((c) => c.key);
    expect(keys.some((k) => k.startsWith('offset'))).toBe(true);
    expect(keys).toContain('align:elevation');
    expect(keys).toContain('align:elevation+straight');
    // Alinhar não liga; alinhar e conectar liga — a bomba nunca se move.
    const align = candidates.find((c) => c.key === 'align:elevation');
    expect(align?.connects).toBe(false);
    expect(align && findConnection(align.project, to)).toBeUndefined();
    for (const candidate of candidates.filter((c) => c.action !== 'moveEquipment')) {
      const before = getElement(project, pumpId);
      const after = getElement(candidate.project, pumpId);
      expect(after?.kind === 'pump' && before?.kind === 'pump' && after.placement).toEqual(
        before?.kind === 'pump' && before.placement,
      );
      if (candidate.connects) expect(errors(candidate.project)).toEqual([]);
    }
    // O projeto recebido continua intacto.
    expect(findConnection(project, to)).toBeUndefined();
  });

  it('trecho já ligado a um equipamento: alinhar é oferecido movendo o equipamento junto', () => {
    // Tubo ligado à bomba (cena A); a outra ponta vai a um segundo tubo, 0,5 m acima.
    const start = scene(0);
    const first = planConnection(start.project, { from: start.from, to: start.to, catalog });
    if (!first.ok) throw new Error(first.error.message);
    const joined = first.value.candidates.find((c) => c.key === 'straight');
    if (!joined) throw new Error('sem prolongamento');
    const from: PortRef = { elementId: start.from.elementId, portId: 'start' };
    const free = resolvePort(joined.project, from);
    if (!free) throw new Error('sem ponta livre');
    const other = addPipe(joined.project, {
      start: add(free.position, vec3(6, 0, 0.5)),
      end: add(free.position, vec3(2, 0, 0.5)),
      spec: free.spec,
    });
    if (!other.ok) throw new Error(other.error.message);
    const project = other.value.project;
    const to: PortRef = { elementId: other.value.elementId, portId: 'end' };
    const plan = planConnection(project, {
      from,
      to,
      catalog,
      elbowAngles: availableElbowAngles(BUILTIN_FAMILIES, free.spec),
    });
    if (!plan.ok) throw new Error(plan.error.message);
    const { candidates, refusals } = plan.value;
    const keys = candidates.map((c) => c.key);
    expect(keys).toContain('move:align:elevation');
    expect(keys).toContain('move:align:elevation+straight');
    expect(keys).not.toContain('align:elevation');
    expect(refusals.join(' ')).not.toMatch(/escolha explícita/);
    const placementOf = (p: Project) => {
      const pump = getElement(p, start.pumpId);
      if (pump?.kind !== 'pump') throw new Error('sem bomba');
      return pump.placement;
    };
    const before = placementOf(project);
    for (const candidate of candidates) {
      const after = placementOf(candidate.project);
      if (candidate.key.startsWith('move:align:')) {
        // Identificada como "mover o equipamento", por último, com a bomba 0,5 m acima.
        expect(candidate.action).toBe('moveEquipment');
        expect(candidate.label).toMatch(/movendo "/);
        expect(candidate.movedIds).toContain(start.pumpId);
        expect(after.position.z - before.position.z).toBeCloseTo(0.5, 9);
        expect(after.rotation).toEqual(before.rotation);
        // A ligação que já existia com a bomba continua registrada.
        expect(findConnection(candidate.project, start.to)).toBeDefined();
      } else {
        expect(after).toEqual(before);
      }
      if (candidate.connects) expect(errors(candidate.project)).toEqual([]);
    }
    const actions = candidates.map((c) => c.action);
    expect(actions.indexOf('moveEquipment')).toBeGreaterThan(actions.lastIndexOf('connect'));
  });

  it('eixos reversos: alinhar um lado ou o outro (giro em planta + eixo) permite o encaixe', () => {
    // Tubo ligado à bomba; adiante, um tubo 3° fora do eixo em planta, 60 mm ao lado e 1 mm acima.
    const start = scene(0);
    const first = planConnection(start.project, { from: start.from, to: start.to, catalog });
    if (!first.ok) throw new Error(first.error.message);
    const joined = first.value.candidates.find((c) => c.key === 'straight');
    if (!joined) throw new Error('sem prolongamento');
    const from: PortRef = { elementId: start.from.elementId, portId: 'start' };
    const free = resolvePort(joined.project, from);
    if (!free) throw new Error('sem ponta livre');
    const angle = (3 * Math.PI) / 180;
    const end = add(free.position, vec3(0.33, 0.06, 0.001));
    const other = addPipe(joined.project, {
      start: add(end, vec3(4 * Math.cos(angle), 4 * Math.sin(angle), 0)),
      end,
      spec: free.spec,
    });
    if (!other.ok) throw new Error(other.error.message);
    const project = other.value.project;
    const to: PortRef = { elementId: other.value.elementId, portId: 'end' };
    const plan = planConnection(project, {
      from,
      to,
      catalog,
      elbowAngles: availableElbowAngles(BUILTIN_FAMILIES, free.spec),
    });
    if (!plan.ok) throw new Error(plan.error.message);
    const { guides, candidates } = plan.value;
    expect(guides.relation).toBe('skew');
    // Como está não há montagem; as alternativas corrigem um lado ou o outro.
    expect(candidates.filter((c) => c.action === 'connect')).toEqual([]);
    const pumpOf = (p: Project) => {
      const pump = getElement(p, start.pumpId);
      if (pump?.kind !== 'pump') throw new Error('sem bomba');
      return pump.placement;
    };
    const pipeOf = (p: Project, id: string) => {
      const pipe = getElement(p, id);
      if (pipe?.kind !== 'pipe') throw new Error('sem tubo');
      return pipe;
    };

    // Lado do trecho (leva a bomba): gira, vai ao eixo e encaixa; o outro tubo não se move.
    const mine = candidates.find((c) => c.key === 'move:align:turn+straight');
    expect(mine?.action).toBe('moveEquipment');
    expect(mine?.connects).toBe(true);
    if (!mine) return;
    expect(mine.label).toMatch(/girar 3° em planta/);
    expect(mine.movedIds).toContain(start.pumpId);
    expect(pumpOf(mine.project)).not.toEqual(pumpOf(project));
    expect(pipeOf(mine.project, to.elementId).start).toEqual(pipeOf(project, to.elementId).start);
    expect(findConnection(mine.project, to)).toBeDefined();
    expect(findConnection(mine.project, start.to)).toBeDefined();
    expect(errors(mine.project)).toEqual([]);

    // Lado da referência: o outro tubo gira e vai ao eixo do trecho; a bomba fica fixa.
    const theirs = candidates.find((c) => c.key === 'align:target:turn+straight');
    expect(theirs?.action).toBe('alignConnect');
    expect(theirs?.connects).toBe(true);
    if (!theirs) return;
    expect(theirs.movedIds).toEqual([to.elementId]);
    expect(pumpOf(theirs.project)).toEqual(pumpOf(project));
    expect(findConnection(theirs.project, to)).toBeDefined();
    expect(errors(theirs.project)).toEqual([]);

    // O ajuste de cota também é oferecido, para os dois lados.
    const keys = candidates.map((c) => c.key);
    expect(keys).toContain('move:align:elevation');
    expect(keys).toContain('align:target:elevation');
  });

  it('F: diâmetro diferente do bocal — conecta com redução de catálogo', () => {
    // A mudança de DN entra como redução de catálogo antes do traçado (connectionReduction):
    // nunca uma ligação direta entre diâmetros diferentes.
    const { project, from, to } = scene(0, 0, 150);
    const plan = planConnection(project, { from, to, catalog });
    if (!plan.ok) throw new Error(plan.error.message);
    const connecting = plan.value.candidates.filter((c) => c.connects);
    expect(connecting).toHaveLength(1);
    const [reduced] = connecting;
    expect(reduced?.key).toMatch(/reduction/);
    expect(reduced?.summary).toMatch(/redução DN 150 → DN 80 de catálogo/);
    if (reduced) expect(errors(reduced.project)).toEqual([]);
  });
});
