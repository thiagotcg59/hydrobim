import { describe, expect, it } from 'vitest';
import { connectedPortRef, getElement } from './connectivity';
import { createFamilyCatalog } from './families';
import { vec3 } from './math';
import { createProject, drawPipe, placeEquipment, updateFitting } from './operations';
import { getPorts } from './ports';
import {
  applyPumpFamilyToInstances,
  duplicatePumpFamily,
  isCustomPumpFamilyId,
  pumpFamiliesOf,
  removePumpFamily,
  setPumpFlange,
  upsertPumpFamily,
  type PumpMouthResolver,
} from './pumpOps';
import {
  amphibiousLayout,
  pumpLengthMismatch,
  pumpModelRange,
  pumpParametersFromFamily,
  pumpTypeOf,
  type PumpSelection,
} from './pumps';
import { computeQuantities } from './quantities';
import {
  SCHEMA_VERSION,
  type EndTreatment,
  type Project,
  type Pump,
  type PumpFamily,
} from './schema';
import { parseProject, serializeProject } from './serialization';
import { applySpec } from './sizing';
import { testSpec } from './testSupport';
import { validateProject } from './validation';

const spec = testSpec(200);

const flange = (pressureClass: string, dn: number): EndTreatment => ({
  type: 'flange',
  length: pressureClass === 'PN 40' ? 0.03 : 0.02,
  outerDiameter: (dn + 150) / 1000,
});

/** Família de teste (o catálogo real é conferido em `packages/catalog`). */
const FAMILY: PumpFamily = {
  id: 'anfibia-teste',
  name: 'Bomba anfíbia de teste',
  pumpType: 'amphibious',
  manufacturer: 'Fabricante de teste',
  frequencyHz: 60,
  source: 'Catálogo de teste, p. 1',
  page: 1,
  description: '',
  approximations: [],
  remarks: [],
  origin: 'builtin',
  variants: [
    {
      id: 'anfibia-teste/a',
      models: ['T1-260/20B', 'T1-260/40B'],
      frame: '160L',
      suction: { dn: 200, pressureClass: 'PN 40' },
      discharge: { dn: 200, pressureClass: 'PN 40' },
      dimensions: {
        footOffset: 0.266,
        footSpan: 0.581,
        rearLength: 0.151,
        length: 0.998,
        footWidth: 0.34,
        footHoleDiameter: 0.027,
        axisHeight: 0.283,
        totalHeight: 0.543,
      },
      weightKg: 361,
      stages: 1,
    },
  ],
};

function place(selection: PumpSelection = { variantId: 'anfibia-teste/a' }): {
  project: Project;
  pump: Pump;
} {
  const parameters = pumpParametersFromFamily(FAMILY, selection, {
    a: flange('PN 40', 200),
    b: flange('PN 40', 200),
  });
  if (!parameters.ok) throw new Error(parameters.error.message);
  const placed = placeEquipment(createProject('bombas'), {
    spec,
    fitting: { kind: 'pump', parameters: parameters.value },
    position: vec3(1, 2, 3),
  });
  if (!placed.ok) throw new Error(placed.error.message);
  return { project: placed.value.project, pump: pumpOf(placed.value.project) };
}

function pumpOf(project: Project): Pump {
  const pump = project.elements.find((e) => e.kind === 'pump');
  if (pump?.kind !== 'pump') throw new Error('Bomba não encontrada.');
  return pump;
}

describe('bomba anfíbia de catálogo', () => {
  it('monta os parâmetros da linha da tabela e posiciona as portas em linha', () => {
    const { project, pump } = place();
    expect(pumpTypeOf(pump)).toBe('amphibious');
    expect(pump).toMatchObject({
      familyId: 'anfibia-teste',
      variantId: 'anfibia-teste/a',
      stages: 1,
      suctionFlangeClass: 'PN 40',
      dischargeFlangeClass: 'PN 40',
      length: 0.998,
      footOffset: 0.266,
      footSpan: 0.581,
      rearLength: 0.151,
      footWidth: 0.34,
      footHoleDiameter: 0.027,
      axisHeight: 0.283,
      totalHeight: 0.543,
    });
    expect(pump.manufacturing).toEqual({
      manufacturer: 'Fabricante de teste',
      model: 'Bomba anfíbia de teste — T1-260/20B a T1-260/40B',
    });
    expect(pump.dischargeOffset).toBeUndefined();

    // Sucção na origem (−X) e descarga no mesmo eixo, a F de distância (+X).
    const [a, b] = getPorts(pump);
    expect(a?.label).toBe('Sucção (A)');
    expect(a?.localPosition).toEqual(vec3(0, 0, 0));
    expect(a?.localDirection).toEqual(vec3(-1, 0, 0));
    expect(b?.localPosition).toEqual(vec3(0.998, 0, 0));
    expect(b?.localDirection).toEqual(vec3(1, 0, 0));
    expect(b?.position.x).toBeCloseTo(1.998, 9);
    expect(a?.end?.type).toBe('flange');

    // Pés a partir do flange B (C e D); base em −I e topo em J − I.
    const layout = amphibiousLayout(pump);
    expect(layout?.frontFootX).toBeCloseTo(0.732, 9);
    expect(layout?.rearFootX).toBeCloseTo(0.151, 9);
    expect(layout?.baseZ).toBeCloseTo(-0.283, 9);
    expect(layout?.topZ).toBeCloseTo(0.26, 9);
    expect(pumpLengthMismatch(FAMILY.variants[0]!.dimensions)).toBeCloseTo(0, 9);
    expect(pumpModelRange(FAMILY.variants[0]!)).toBe('T1-260/20B a T1-260/40B');

    expect(validateProject(project)).toEqual([]);
    expect(computeQuantities(project).find((r) => r.category === 'Equipamento')?.description).toBe(
      'Bomba anfíbia de teste — T1-260/20B a T1-260/40B',
    );
  });

  it('aceita cotas preenchidas pelo usuário, a partir da primeira linha da família', () => {
    const { pump } = place({
      custom: {
        dimensions: { length: 1.4, footSpan: 0.7 },
        stages: 3,
        suctionFlangeClass: 'PN 10',
      },
    });
    expect(pump.variantId).toBeUndefined();
    expect(pump.familyId).toBe('anfibia-teste');
    expect(pump).toMatchObject({ length: 1.4, footSpan: 0.7, footOffset: 0.266, stages: 3 });
    expect(pump.suctionFlangeClass).toBe('PN 10');
    expect(pump.manufacturing.model).toBe(
      'Bomba anfíbia de teste (cotas preenchidas pelo usuário)',
    );
  });

  it('recusa linha inexistente, cotas inválidas e cotas incoerentes', () => {
    const ends = {};
    const missing = pumpParametersFromFamily(FAMILY, { variantId: 'nao-existe' }, ends);
    expect(!missing.ok && missing.error.code).toBe('PUMP_VARIANT_NOT_FOUND');
    const negative = pumpParametersFromFamily(
      FAMILY,
      { custom: { dimensions: { length: -1 } } },
      ends,
    );
    expect(!negative.ok && negative.error.code).toBe('INVALID_VALUE');

    // C + D não cabem em F.
    const short = pumpParametersFromFamily(
      FAMILY,
      { custom: { dimensions: { length: 0.8 } } },
      ends,
    );
    if (!short.ok) throw new Error(short.error.message);
    const refused = placeEquipment(createProject('p'), {
      spec,
      fitting: { kind: 'pump', parameters: short.value },
      position: vec3(0, 0, 0),
    });
    expect(!refused.ok && refused.error.code).toBe('INVALID_VALUE');
    expect(!refused.ok && refused.error.message).toContain('C e D');
  });

  it('editar uma cota mantém a família, desfaz o vínculo com a linha e move a descarga', () => {
    const { project, pump } = place();
    const drawn = drawPipe(project, {
      fromPort: { elementId: pump.id, portId: 'b' },
      start: vec3(1.998, 2, 3),
      end: vec3(5, 2, 3),
      spec,
    });
    if (!drawn.ok) throw new Error(drawn.error.message);
    expect(
      connectedPortRef(drawn.value.project, { elementId: pump.id, portId: 'b' }),
    ).toBeDefined();

    const edited = updateFitting(drawn.value.project, pump.id, { length: 1.2, axisHeight: 0.3 });
    if (!edited.ok) throw new Error(edited.error.message);
    const after = pumpOf(edited.value);
    expect(after.id).toBe(pump.id);
    expect(after).toMatchObject({ length: 1.2, axisHeight: 0.3, familyId: 'anfibia-teste' });
    expect(after.variantId).toBeUndefined();
    expect(after.manufacturing.model).toBe(
      'Bomba anfíbia de teste (cotas preenchidas pelo usuário)',
    );
    // O tubo conectado à descarga acompanha a nova cota F.
    const pipe = edited.value.elements.find((e) => e.kind === 'pipe');
    expect(pipe?.kind === 'pipe' && pipe.start.x).toBeCloseTo(2.2, 9);
    expect(validateProject(edited.value)).toEqual([]);

    // Dados nominais não são geometria: o vínculo com a linha permanece.
    const rated = updateFitting(project, pump.id, { ratedFlow: 0.05 });
    expect(rated.ok && pumpOf(rated.value).variantId).toBe('anfibia-teste/a');

    // Cotas incoerentes e parâmetros de outro tipo de bomba são recusados.
    const tall = updateFitting(project, pump.id, { axisHeight: 0.6 });
    expect(!tall.ok && tall.error.code).toBe('INVALID_VALUE');
    const generic = updateFitting(project, pump.id, { dischargeHeight: 0.4 });
    expect(!generic.ok && generic.error.code).toBe('INVALID_FIELD');
  });

  it('a bomba genérica continua com o recalque vertical e recusa as cotas da anfíbia', () => {
    const placed = placeEquipment(createProject('g'), {
      spec,
      fitting: { kind: 'pump' },
      position: vec3(0, 0, 0),
    });
    if (!placed.ok) throw new Error(placed.error.message);
    const pump = pumpOf(placed.value.project);
    expect(pumpTypeOf(pump)).toBe('generic');
    expect(amphibiousLayout(pump)).toBeNull();
    expect(getPorts(pump)[1]?.localDirection).toEqual(vec3(0, 0, 1));
    const refused = updateFitting(placed.value.project, pump.id, { footSpan: 0.5 });
    expect(!refused.ok && refused.error.code).toBe('INVALID_FIELD');
    const edited = updateFitting(placed.value.project, pump.id, { dischargeHeight: 0.5 });
    expect(edited.ok && pumpOf(edited.value).dischargeHeight).toBe(0.5);
  });

  it('troca a classe do flange e acompanha o diâmetro pela tabela de flanges', () => {
    const { project, pump } = place();
    const swapped = setPumpFlange(project, pump.id, 'b', 'PN 10', flange('PN 10', 200));
    if (!swapped.ok) throw new Error(swapped.error.message);
    const after = pumpOf(swapped.value);
    expect(after.dischargeFlangeClass).toBe('PN 10');
    expect(after.ends.b?.length).toBe(0.02);
    expect(after.ends.a?.length).toBe(0.03);
    expect(after.variantId).toBeUndefined();
    expect(validateProject(swapped.value)).toEqual([]);

    const absent = setPumpFlange(project, pump.id, 'a', 'PN 40', null);
    expect(!absent.ok && absent.error.code).toBe('FLANGE_NOT_FOUND');
    const notPump = setPumpFlange(project, 'inexistente', 'a', 'PN 10', flange('PN 10', 200));
    expect(!notPump.ok && notPump.error.code).toBe('NOT_A_CATALOG_PUMP');

    // Novo diâmetro na sucção: o flange vem da tabela na mesma classe; sem flange tabulado,
    // a boca fica sem ele. A descarga não é alterada.
    const catalog = createFamilyCatalog(
      [],
      {},
      { flange: (s, pressureClass) => (s.dn <= 250 ? flange(pressureClass, s.dn) : undefined) },
    );
    const resized = applySpec(project, pump.id, testSpec(250), { portId: 'a', catalog });
    if (!resized.ok) throw new Error(resized.error.message);
    const bigger = pumpOf(resized.value);
    expect(bigger.spec.dn).toBe(250);
    expect(bigger.dischargeSpec.dn).toBe(200);
    expect(bigger.ends.a?.outerDiameter).toBeCloseTo(0.4, 9);
    expect(bigger.variantId).toBeUndefined();
    const untabulated = applySpec(project, pump.id, testSpec(300), { portId: 'a', catalog });
    expect(untabulated.ok && pumpOf(untabulated.value).ends.a).toBeUndefined();
    expect(untabulated.ok && pumpOf(untabulated.value).ends.b).toBeDefined();
  });

  it('grava, reabre e migra um projeto do esquema 12', () => {
    const { project, pump } = place();
    const reopened = parseProject(serializeProject(project));
    if (!reopened.ok) throw new Error(reopened.error.message);
    expect(getElement(reopened.value, pump.id)).toEqual(pump);

    // Esquema 12: bomba genérica com a posição do recalque — continua válida.
    const generic = placeEquipment(createProject('v12'), {
      spec,
      fitting: { kind: 'pump' },
      position: vec3(0, 0, 0),
    });
    if (!generic.ok) throw new Error(generic.error.message);
    const legacy = JSON.stringify({ ...generic.value.project, schemaVersion: 12 });
    const migrated = parseProject(legacy);
    if (!migrated.ok) throw new Error(migrated.error.message);
    expect(migrated.value.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.value.elements).toEqual(generic.value.project.elements);
  });
});

describe('famílias de bombas personalizadas', () => {
  // Resolve as bocas como o catálogo: especificação de teste e flange até DN 250.
  const resolve: PumpMouthResolver = (base, dn, pressureClass) =>
    dn <= 250
      ? { spec: testSpec(dn, base.specificationId), end: flange(pressureClass, dn) }
      : undefined;

  function duplicated(project: Project = createProject('p')) {
    const copy = duplicatePumpFamily(project, FAMILY);
    if (!copy.ok) throw new Error(copy.error.message);
    const family = copy.value.project.pumpFamilies[0]!;
    return { project: copy.value.project, family };
  }

  function placeFrom(project: Project, family: PumpFamily) {
    const parameters = pumpParametersFromFamily(
      family,
      { variantId: family.variants[0]!.id },
      { a: flange('PN 40', 200), b: flange('PN 40', 200) },
    );
    if (!parameters.ok) throw new Error(parameters.error.message);
    const placed = placeEquipment(project, {
      spec,
      fitting: { kind: 'pump', parameters: parameters.value },
      position: vec3(0, 0, 0),
    });
    if (!placed.ok) throw new Error(placed.error.message);
    return placed.value.project;
  }

  it('duplica a família de catálogo como cópia editável, que deixa de ser do fabricante', () => {
    const { project, family } = duplicated();
    expect(isCustomPumpFamilyId(family.id)).toBe(true);
    expect(isCustomPumpFamilyId(FAMILY.id)).toBe(false);
    expect(family).toMatchObject({
      name: 'Bomba anfíbia de teste (personalizado)',
      manufacturer: 'Personalizado',
      origin: 'custom',
      basedOn: 'anfibia-teste',
      pumpType: 'amphibious',
    });
    expect(family.source).toContain('cotas da tabela são do usuário');
    expect(family.variants[0]?.id).toBe(`${family.id}/a`);
    expect(family.variants[0]?.dimensions).toEqual(FAMILY.variants[0]?.dimensions);
    expect(pumpFamiliesOf(project, [FAMILY]).map((f) => f.origin)).toEqual(['builtin', 'custom']);

    // Grava, reabre e continua igual.
    const reopened = parseProject(serializeProject(project));
    expect(reopened.ok && reopened.value.pumpFamilies).toEqual([family]);
    expect(validateProject(project)).toEqual([]);
  });

  it('edita a tabela e recusa famílias de catálogo e tabelas incoerentes', () => {
    const { project, family } = duplicated();
    const row = family.variants[0]!;
    const edited = upsertPumpFamily(project, {
      ...family,
      name: 'Minha anfíbia',
      variants: [
        { ...row, dimensions: { ...row.dimensions, length: 1.1 } },
        { ...row, id: `${family.id}/b`, models: ['X-1'], stages: 3 },
      ],
    });
    if (!edited.ok) throw new Error(edited.error.message);
    expect(edited.value.pumpFamilies[0]?.name).toBe('Minha anfíbia');
    expect(edited.value.pumpFamilies[0]?.variants).toHaveLength(2);

    const readonly = upsertPumpFamily(project, FAMILY);
    expect(!readonly.ok && readonly.error.code).toBe('PUMP_FAMILY_READONLY');
    const bad = (variants: PumpFamily['variants']) =>
      upsertPumpFamily(project, { ...family, variants });
    const short = bad([{ ...row, dimensions: { ...row.dimensions, length: 0.5 } }]);
    expect(!short.ok && short.error.message).toContain('Linha 1');
    expect(!short.ok && short.error.message).toContain('C e D');
    const noModel = bad([{ ...row, models: [] }]);
    expect(!noModel.ok && noModel.error.message).toBe('Linha 1: informe ao menos um modelo.');
    const empty = bad([]);
    expect(!empty.ok && empty.error.message).toContain('ao menos uma linha');
    const repeated = bad([row, row]);
    expect(!repeated.ok && repeated.error.message).toContain('repetido');
  });

  it('reaplica a tabela às bombas inseridas e mantém as cotas de linha removida', () => {
    const base = duplicated();
    const row = base.family.variants[0]!;
    const project = placeFrom(base.project, base.family);
    const pumpId = pumpOf(project).id;
    expect(pumpOf(project).manufacturing.manufacturer).toBe('Personalizado');

    // Nova cota F e boca B em PN 16 / DN 250.
    const family: PumpFamily = {
      ...base.family,
      variants: [
        {
          ...row,
          discharge: { dn: 250, pressureClass: 'PN 16' },
          dimensions: { ...row.dimensions, length: 1.2 },
        },
      ],
    };
    const saved = upsertPumpFamily(project, family);
    if (!saved.ok) throw new Error(saved.error.message);
    const applied = applyPumpFamilyToInstances(saved.value, family, resolve);
    if (!applied.ok) throw new Error(applied.error.message);
    expect(applied.value.updated).toBe(1);
    const after = pumpOf(applied.value.project);
    expect(after.id).toBe(pumpId);
    expect(after).toMatchObject({ length: 1.2, variantId: row.id, dischargeFlangeClass: 'PN 16' });
    expect(after.dischargeSpec.dn).toBe(250);
    expect(after.ends.b?.length).toBe(0.02);
    expect(validateProject(applied.value.project)).toEqual([]);

    // Boca sem flange tabulado: nada é alterado.
    const tooBig: PumpFamily = {
      ...family,
      variants: [{ ...family.variants[0]!, suction: { dn: 300, pressureClass: 'PN 10' } }],
    };
    const refused = applyPumpFamilyToInstances(applied.value.project, tooBig, resolve);
    expect(!refused.ok && refused.error.code).toBe('FLANGE_NOT_FOUND');

    // Boca conectada que mudaria de diâmetro: recusado.
    const port = getPorts(after)[1]!;
    const drawn = drawPipe(applied.value.project, {
      fromPort: port.ref,
      start: port.position,
      end: vec3(port.position.x + 3, 0, 0),
      spec: after.dischargeSpec,
    });
    if (!drawn.ok) throw new Error(drawn.error.message);
    const reduced = applyPumpFamilyToInstances(drawn.value.project, base.family, resolve);
    expect(!reduced.ok && reduced.error.code).toBe('PUMP_PORT_CONNECTED');

    // Linha removida: a bomba mantém as cotas e perde o vínculo com a linha.
    const another = { ...family, variants: [{ ...family.variants[0]!, id: `${family.id}/z` }] };
    const unlinked = applyPumpFamilyToInstances(applied.value.project, another, resolve);
    if (!unlinked.ok) throw new Error(unlinked.error.message);
    const kept = pumpOf(unlinked.value.project);
    expect(kept.variantId).toBeUndefined();
    expect(kept.length).toBe(1.2);
    expect(kept.familyId).toBe(family.id);
  });

  it('excluir a família mantém a forma e as cotas das bombas, sem vínculo', () => {
    const base = duplicated();
    const project = placeFrom(base.project, base.family);
    const removed = removePumpFamily(project, base.family.id);
    if (!removed.ok) throw new Error(removed.error.message);
    expect(removed.value.pumpFamilies).toEqual([]);
    const pump = pumpOf(removed.value);
    expect(pump).toMatchObject({ familyId: null, pumpType: 'amphibious', length: 0.998 });
    expect(pump.variantId).toBeUndefined();
    expect(validateProject(removed.value)).toEqual([]);
    const missing = removePumpFamily(removed.value, base.family.id);
    expect(!missing.ok && missing.error.code).toBe('PUMP_FAMILY_NOT_FOUND');
  });
});
