import {
  BUILTIN_FAMILIES,
  flangedPipeFamiliesFor,
  flangeForClass,
  pipeFlangeEnd,
  resolvePipeSpec,
} from '@hydrobim/catalog';
import {
  addPipe,
  createFamilyCatalog,
  createProject,
  distance,
  flangesMate,
  getElement,
  getPort,
  insertInline,
  pipeLength,
  resizeWithReducers,
  validateProject,
  vec3,
  type PipeSpec,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';

/**
 * Troca de diâmetro "somente esta peça" com o catálogo real de ferro dúctil: a redução
 * inserida junto a um tê acompanha o acabamento dele (bolsas ou flanges PN 10).
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
const family = (id: string) => `${id}@${DUCTILE}`;
const spec = (dn: number): PipeSpec => {
  const resolved = resolvePipeSpec(DUCTILE, dn);
  if (!resolved) throw new Error(`DN ${dn} ausente`);
  return resolved;
};

/** Tubo DN 100 de 8 m com um tê da família indicada no meio; devolve o trecho depois do tê. */
function line(teeFamilyId: string) {
  const p0 = createProject('Rede', 'infra');
  const pipe = addPipe(p0, { start: vec3(0, 0, 0), end: vec3(8, 0, 0), spec: spec(100) });
  if (!pipe.ok) throw new Error(pipe.error.message);
  const tee = insertInline(pipe.value.project, {
    pipeId: pipe.value.elementId,
    distanceFromStart: 4,
    fitting: { kind: 'tee', familyId: teeFamilyId },
    catalog,
  });
  if (!tee.ok) throw new Error(tee.error.message);
  const after = tee.value.createdIds[1];
  if (!after) throw new Error('trecho depois do tê ausente');
  return { project: tee.value.project, teeId: tee.value.elementId, after };
}

describe('troca de diâmetro junto a um tê de catálogo (ferro dúctil)', () => {
  it('tê com bolsas: toco de tubo entre as bolsas do tê e da redução', () => {
    const n = line(family('pam-te-bolsas'));
    const result = resizeWithReducers(n.project, n.after, spec(150), { catalog });
    if (!result.ok) throw new Error(result.error.message);
    const { project, createdIds, stubIds } = result.value;
    const reducer = getElement(project, createdIds[0] ?? '');
    const stub = getElement(project, stubIds[0] ?? '');
    const tee = getElement(project, n.teeId);
    if (!reducer || !tee || stub?.kind !== 'pipe') throw new Error('peças ausentes');
    expect(reducer.familyId).toBe(family('pam-reducao-bolsas'));
    const teePort = getPort(tee, 'b');
    const inlet = getPort(reducer, 'a');
    if (!teePort?.end || !inlet?.end) throw new Error('bolsas ausentes');
    expect(stub.spec.dn).toBe(100);
    expect(pipeLength(stub)).toBeCloseTo(teePort.end.length + inlet.end.length);
    expect(distance(teePort.position, inlet.position)).toBeCloseTo(pipeLength(stub));
    expect(validateProject(project).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('tê com flanges: redução flange × flange PN 10 e flange da tabela na face do tubo', () => {
    const n = line(family('pam-te-flanges'));
    const result = resizeWithReducers(n.project, n.after, spec(150), { catalog });
    if (!result.ok) throw new Error(result.error.message);
    const { project, createdIds, stubIds } = result.value;
    expect(stubIds).toEqual([]);
    const reducer = getElement(project, createdIds[0] ?? '');
    const tee = getElement(project, n.teeId);
    const pipe = getElement(project, n.after);
    if (!reducer || !tee || pipe?.kind !== 'pipe') throw new Error('peças ausentes');
    expect(reducer.familyId).toBe(family('pam-reducao-flanges'));
    const teePort = getPort(tee, 'b');
    const inlet = getPort(reducer, 'a');
    const outlet = getPort(reducer, 'b');
    if (!teePort?.end || !inlet?.end || !outlet?.end) throw new Error('flanges ausentes');
    expect(distance(teePort.position, inlet.position)).toBeLessThan(1e-9);
    expect(flangesMate(teePort.end, inlet.end)).toBe(true);
    // Flanges da tabela única (PN 10), nos dois diâmetros.
    expect(inlet.end).toEqual(flangeForClass(spec(100), 'PN 10'));
    expect(outlet.end).toEqual(flangeForClass(spec(150), 'PN 10'));
    const face = pipe.ends?.start;
    expect(face && flangesMate(face, outlet.end)).toBe(true);
    expect(validateProject(project).filter((i) => i.severity === 'error')).toEqual([]);
  });
});
