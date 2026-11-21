import { BUILTIN_FAMILIES, flangeEnd, resolvePipeSpec } from '@hydrobim/catalog';
import { describe, expect, it } from 'vitest';
import { prepareConnectionReduction } from './connectionReduction';
import { getElement, isPortFree, resolvePort } from './connectivity';
import { createFamilyCatalog, GENERIC_CATALOG } from './families';
import { vec3 } from './math';
import { addPipe, attachFitting, createProject } from './operations';
import type { PipeSpec, PortRef } from './schema';
import { validateProject } from './validation';

const catalog = createFamilyCatalog(BUILTIN_FAMILIES);
const spec = (dn: number): PipeSpec => {
  const value = resolvePipeSpec('ferro-ductil-nbr7675-k9', dn);
  if (!value) throw new Error('Especificação de teste ausente.');
  return value;
};

function scenario(outlet = spec(100), distance = 4) {
  const first = addPipe(createProject('Redução no percurso'), {
    start: vec3(-2, 0, 665.153),
    end: vec3(0, 0, 665.153),
    spec: spec(150),
  });
  if (!first.ok) throw new Error(first.error.message);
  const second = addPipe(first.value.project, {
    start: vec3(distance, 0, 665.153),
    end: vec3(distance + 2, 0, 665.153),
    spec: outlet,
  });
  if (!second.ok) throw new Error(second.error.message);
  return {
    project: second.value.project,
    from: { elementId: first.value.elementId, portId: 'end' } satisfies PortRef,
    to: { elementId: second.value.elementId, portId: 'start' } satisfies PortRef,
    catalog,
  };
}

describe('redução de catálogo antes do percurso', () => {
  it('prepara DN 150 → 100 mantendo os tubos e a cota, com dimensões tabuladas', () => {
    const input = scenario();
    const before = JSON.stringify(input.project);
    const result = prepareConnectionReduction(input.project, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reducer = getElement(result.value.project, result.value.createdIds[0]!);
    expect(reducer?.kind).toBe('reducer');
    if (reducer?.kind !== 'reducer') return;
    // Saint-Gobain PAM, ed. 2010, p. 419: Lu entre fundos das bolsas = 130 mm.
    expect(reducer.length).toBe(0.13);
    expect(reducer.familyId).toBeTruthy();
    expect(reducer.spec.dn).toBe(150);
    expect(reducer.outletSpec.dn).toBe(100);
    expect(resolvePort(result.value.project, result.value.from)?.position).toEqual(
      vec3(0.13, 0, 665.153),
    );
    expect(isPortFree(result.value.project, result.value.from)).toBe(true);
    expect(result.value.connects).toBe(false);
    for (const element of input.project.elements) {
      expect(getElement(result.value.project, element.id)).toBe(element);
    }
    expect(JSON.stringify(input.project)).toBe(before);
    expect(validateProject(result.value.project)).toEqual([]);
  });

  it('reconhece quando a própria redução completa a ligação', () => {
    const input = scenario(spec(100), 0.13);
    const result = prepareConnectionReduction(input.project, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.connects).toBe(true);
    expect(isPortFree(result.value.project, input.to)).toBe(false);
    expect(validateProject(result.value.project)).toEqual([]);
  });

  it('recusa redução genérica e mantém o projeto intacto', () => {
    const input = scenario();
    const result = prepareConnectionReduction(input.project, {
      ...input,
      catalog: GENERIC_CATALOG,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'NO_CATALOG_REDUCER' } });
    expect(input.project.elements).toHaveLength(2);
    expect(input.project.connections).toHaveLength(0);
  });

  it.each(['material', 'pressureClass', 'standard', 'jointType', 'specificationId'] as const)(
    'recusa diferença em %s sem presumir transição',
    (field) => {
      const changed = {
        material: 'carbonSteel',
        pressureClass: 'PN 40',
        standard: 'Outra norma',
        jointType: 'buttWeld',
        specificationId: 'outra-especificacao',
      } as const;
      const input = scenario({ ...spec(100), [field]: changed[field] });
      expect(prepareConnectionReduction(input.project, input)).toMatchObject({
        ok: false,
        error: { code: 'SPEC_MISMATCH' },
      });
    },
  );

  it('recusa bolsa contra bolsa em saída de conexão', () => {
    const input = scenario();
    const attached = attachFitting(input.project, {
      target: input.from,
      fitting: { kind: 'elbow' },
      catalog,
    });
    if (!attached.ok) throw new Error(attached.error.message);
    expect(
      prepareConnectionReduction(attached.value.project, {
        ...input,
        from: { elementId: attached.value.elementId, portId: 'b' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'END_MISMATCH' } });
  });

  it('seleciona redução flangeada e confere a furação da partida', () => {
    const input = scenario();
    const flange = flangeEnd('PN 10', 150);
    if (!flange) throw new Error('Flange de teste ausente.');
    const project = {
      ...input.project,
      elements: input.project.elements.map((element) =>
        element.id === input.from.elementId && element.kind === 'pipe'
          ? { ...element, ends: { end: flange } }
          : element,
      ),
    };
    const result = prepareConnectionReduction(project, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(resolvePort(result.value.project, result.value.from)?.end?.type).toBe('flange');
    expect(validateProject(result.value.project)).toEqual([]);
    const incompatible = {
      ...project,
      elements: project.elements.map((element) =>
        element.id === input.from.elementId && element.kind === 'pipe'
          ? { ...element, ends: { end: { ...flange, boltCount: 5 } } }
          : element,
      ),
    };
    expect(prepareConnectionReduction(incompatible, input)).toMatchObject({
      ok: false,
      error: { code: 'END_MISMATCH' },
    });
  });

  it('recusa portas ocupadas, inexistentes e DN iguais', () => {
    const input = scenario();
    const prepared = prepareConnectionReduction(input.project, input);
    if (!prepared.ok) throw new Error(prepared.error.message);
    expect(prepareConnectionReduction(prepared.value.project, input)).toMatchObject({
      ok: false,
      error: { code: 'PORT_OCCUPIED' },
    });
    expect(
      prepareConnectionReduction(input.project, {
        ...input,
        to: { elementId: 'inexistente', portId: 'start' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'PORT_NOT_FOUND' } });
    const equal = scenario(spec(150));
    expect(prepareConnectionReduction(equal.project, equal)).toMatchObject({
      ok: false,
      error: { code: 'REDUCER_SAME_DN' },
    });
  });
});
