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

  it('F: diâmetro diferente do bocal — nenhuma alternativa, com o motivo', () => {
    const { project, from, to } = scene(0, 0, 150);
    const plan = planConnection(project, { from, to, catalog });
    if (!plan.ok) throw new Error(plan.error.message);
    expect(plan.value.candidates.filter((c) => c.connects)).toHaveLength(0);
    expect(plan.value.refusals.join(' ')).toMatch(/redução/);
  });
});
