import { describe, expect, it } from 'vitest';
import { getElement } from './connectivity';
import { availableElbowAngles } from './elbowAngles';
import { createFamilyCatalog } from './families';
import {
  addPipe,
  attachFitting,
  createProject,
  drawPipe,
  insertInline,
  pipeEndsOf,
  setPipeEnds,
  setPipeLength,
} from './operations';
import { getPorts, pipeLength } from './ports';
import { computeQuantities } from './quantities';
import type { EndTreatment, FittingFamily, Pipe, Project } from './schema';
import { parseProject, serializeProject } from './serialization';
import { applySpec } from './sizing';
import { testSpec } from './testSupport';
import { degToRad } from './units';
import { validateProject } from './validation';
import { vec3 } from './math';

const spec = testSpec(100); // DE 110 mm
const FAMILY = 'tubos-flangeados';

/** Flange de teste coerente com `testSpec(dn)`: Ø = DE + 100 mm, 20 mm de espessura. */
const flangeFor = (dn: number): EndTreatment => ({
  type: 'flange',
  length: 0.02,
  outerDiameter: (dn + 110) / 1000,
  boltCircle: (dn + 70) / 1000,
  boltCount: 8,
  boltHoleDiameter: 0.019,
  raisedFaceDiameter: (dn + 40) / 1000,
  raisedFaceHeight: 0.003,
});
const flange = flangeFor(100);

function pipeProject(length = 2): { project: Project; id: string } {
  const created = addPipe(createProject('p'), {
    start: vec3(0, 0, 0),
    end: vec3(length, 0, 0),
    spec,
  });
  if (!created.ok) throw new Error(created.error.message);
  return { project: created.value.project, id: created.value.elementId };
}

const pipeOf = (project: Project, id: string): Pipe => {
  const element = getElement(project, id);
  if (element?.kind !== 'pipe') throw new Error('tubo ausente');
  return element;
};

describe('extremidades de tubos (tubos com flanges)', () => {
  it('flange e flange: as portas passam a ter o flange e o identificador é preservado', () => {
    const { project, id } = pipeProject();
    const result = setPipeEnds(project, id, { start: flange, end: flange, familyId: FAMILY });
    if (!result.ok) throw new Error(result.error.message);
    const pipe = pipeOf(result.value, id);
    expect(pipe.id).toBe(id);
    expect(pipe.familyId).toBe(FAMILY);
    expect(pipe.ends).toEqual({ start: flange, end: flange });
    expect(pipe.meta.revision).toBe(1);
    expect(getPorts(pipe).map((p) => p.end)).toEqual([flange, flange]);
    // As portas (faces dos flanges) não mudam de lugar: o comprimento é entre as faces.
    expect(pipeLength(pipe)).toBeCloseTo(2);
    expect(validateProject(result.value)).toEqual([]);
    // O projeto recebido não é alterado.
    expect(pipeOf(project, id).ends).toBeUndefined();
  });

  it('flange em um só lado, em qualquer das extremidades', () => {
    const { project, id } = pipeProject();
    const startOnly = setPipeEnds(project, id, { start: flange, end: null, familyId: FAMILY });
    const endOnly = setPipeEnds(project, id, { start: null, end: flange, familyId: FAMILY });
    if (!startOnly.ok || !endOnly.ok) throw new Error('falha');
    expect(pipeOf(startOnly.value, id).ends).toEqual({ start: flange });
    expect(pipeOf(endOnly.value, id).ends).toEqual({ end: flange });
    expect(getPorts(pipeOf(endOnly.value, id)).map((p) => p.end)).toEqual([null, flange]);
    expect(validateProject(startOnly.value)).toEqual([]);
    expect(validateProject(endOnly.value)).toEqual([]);
  });

  it('ponta e ponta remove os flanges e o vínculo com a família', () => {
    const { project, id } = pipeProject();
    const flanged = setPipeEnds(project, id, { start: flange, end: flange, familyId: FAMILY });
    if (!flanged.ok) throw new Error(flanged.error.message);
    const plain = setPipeEnds(flanged.value, id, { start: null, end: null, familyId: FAMILY });
    if (!plain.ok) throw new Error(plain.error.message);
    const pipe = pipeOf(plain.value, id);
    expect(pipe.ends).toBeUndefined();
    expect(pipe.familyId).toBeNull();
    expect(pipeEndsOf(pipe)).toEqual({ start: null, end: null, familyId: null });
    expect(validateProject(plain.value)).toEqual([]);
  });

  it('o comprimento continua personalizável depois de flangeado', () => {
    const { project, id } = pipeProject();
    const flanged = setPipeEnds(project, id, { start: flange, end: flange, familyId: FAMILY });
    if (!flanged.ok) throw new Error(flanged.error.message);
    const resized = setPipeLength(flanged.value, id, 0.75);
    if (!resized.ok) throw new Error(resized.error.message);
    const pipe = pipeOf(resized.value, id);
    expect(pipeLength(pipe)).toBeCloseTo(0.75);
    expect(pipe.ends).toEqual({ start: flange, end: flange });
    expect(validateProject(resized.value)).toEqual([]);
  });

  it('recusa entradas inválidas com código estável', () => {
    const { project, id } = pipeProject();
    const code = (input: Parameters<typeof setPipeEnds>[2], target = id, base = project) => {
      const result = setPipeEnds(base, target, input);
      return result.ok ? 'ok' : result.error.code;
    };
    expect(code({ start: flange, end: null, familyId: FAMILY }, 'inexistente')).toBe('NOT_A_PIPE');
    expect(code({ start: { ...flange, type: 'socket' }, end: null, familyId: FAMILY })).toBe(
      'UNSUPPORTED_PIPE_END',
    );
    // Flange menor que o tubo (de outro diâmetro).
    expect(code({ start: { ...flange, outerDiameter: 0.1 }, end: null, familyId: FAMILY })).toBe(
      'INVALID_FLANGE',
    );
    expect(code({ start: { ...flange, length: 0 }, end: null, familyId: FAMILY })).toBe(
      'INVALID_FLANGE',
    );
    // Tubo de 30 mm não comporta dois flanges de 20 mm.
    const short = pipeProject(0.03);
    expect(code({ start: flange, end: flange, familyId: FAMILY }, short.id, short.project)).toBe(
      'PIPE_TOO_SHORT',
    );
  });

  it('tubos novos podem nascer com flanges (traçado)', () => {
    const ends = { start: flange, end: flange, familyId: FAMILY };
    const first = drawPipe(createProject('p'), {
      start: vec3(0, 0, 0),
      end: vec3(1, 0, 0),
      spec,
      ends,
    });
    if (!first.ok) throw new Error(first.error.message);
    // Continuação reta a partir da face do flange: flange contra flange.
    const second = drawPipe(first.value.project, {
      fromPort: { elementId: first.value.elementId, portId: 'end' },
      start: vec3(1, 0, 0),
      end: vec3(2.5, 0, 0),
      spec,
      ends,
    });
    if (!second.ok) throw new Error(second.error.message);
    const project = second.value.project;
    expect(pipeOf(project, second.value.elementId).ends).toEqual({ start: flange, end: flange });
    expect(project.connections).toHaveLength(1);
    expect(validateProject(project)).toEqual([]);
    const tooShort = addPipe(createProject('p'), {
      start: vec3(0, 0, 0),
      end: vec3(0.03, 0, 0),
      spec,
      ends,
    });
    expect(tooShort.ok ? 'ok' : tooShort.error.code).toBe('PIPE_TOO_SHORT');
  });

  it('ao dividir o tubo, cada trecho conserva só o flange da sua extremidade', () => {
    const { project, id } = pipeProject(3);
    const flanged = setPipeEnds(project, id, { start: flange, end: flange, familyId: FAMILY });
    if (!flanged.ok) throw new Error(flanged.error.message);
    const split = insertInline(flanged.value, {
      pipeId: id,
      distanceFromStart: 1.5,
      fitting: { kind: 'tee' },
    });
    if (!split.ok) throw new Error(split.error.message);
    const first = pipeOf(split.value.project, id);
    const second = split.value.project.elements.find(
      (e): e is Pipe => e.kind === 'pipe' && e.id !== id,
    )!;
    expect(first.ends).toEqual({ start: flange });
    expect(second.ends).toEqual({ end: flange });
    expect(second.familyId).toBe(FAMILY);
    expect(validateProject(split.value.project)).toEqual([]);

    // Tubo liso: a divisão continua sem extremidades nem família.
    const plain = pipeProject(3);
    const plainSplit = insertInline(plain.project, {
      pipeId: plain.id,
      distanceFromStart: 1.5,
      fitting: { kind: 'tee' },
    });
    if (!plainSplit.ok) throw new Error(plainSplit.error.message);
    for (const element of plainSplit.value.project.elements) {
      if (element.kind !== 'pipe') continue;
      expect(element.ends).toBeUndefined();
      expect(element.familyId).toBeNull();
    }
  });

  it('a troca de diâmetro leva o flange do novo diâmetro, pela mesma família', () => {
    const { project, id } = pipeProject();
    const flanged = setPipeEnds(project, id, { start: flange, end: null, familyId: FAMILY });
    if (!flanged.ok) throw new Error(flanged.error.message);
    const catalog = createFamilyCatalog(
      [],
      {},
      {
        pipeFlange: (s, familyId) =>
          familyId === FAMILY && s.dn <= 150 ? flangeFor(s.dn) : undefined,
      },
    );
    const bigger = applySpec(flanged.value, id, testSpec(150), { catalog });
    if (!bigger.ok) throw new Error(bigger.error.message);
    expect(pipeOf(bigger.value, id).ends).toEqual({ start: flangeFor(150) });
    expect(pipeOf(bigger.value, id).familyId).toBe(FAMILY);
    expect(validateProject(bigger.value)).toEqual([]);

    // Sem flange tabulado para o novo diâmetro, a extremidade volta a ser ponta lisa —
    // nunca fica com o flange do diâmetro antigo.
    const untabulated = applySpec(flanged.value, id, testSpec(200), { catalog });
    if (!untabulated.ok) throw new Error(untabulated.error.message);
    expect(pipeOf(untabulated.value, id).ends).toBeUndefined();
    expect(pipeOf(untabulated.value, id).familyId).toBeNull();
    // O catálogo genérico não oferece flanges.
    const generic = applySpec(flanged.value, id, testSpec(150));
    if (!generic.ok) throw new Error(generic.error.message);
    expect(pipeOf(generic.value, id).ends).toBeUndefined();
  });

  it('aparece no quantitativo com a configuração e a família', () => {
    const { project, id } = pipeProject();
    const both = setPipeEnds(project, id, { start: flange, end: flange, familyId: FAMILY });
    if (!both.ok) throw new Error(both.error.message);
    const names = [{ id: FAMILY, name: 'Tubo com flanges PN 10' }];
    expect(computeQuantities(both.value, names)[0]).toMatchObject({
      description: 'Tubo flange e flange',
      family: 'Tubo com flanges PN 10',
      unit: 'm',
      quantity: 2,
    });
    const one = setPipeEnds(project, id, { start: null, end: flange, familyId: FAMILY });
    if (!one.ok) throw new Error(one.error.message);
    expect(computeQuantities(one.value, names)[0]?.description).toBe('Tubo flange e ponta');
    expect(computeQuantities(project)[0]).toMatchObject({ description: 'Tubo', family: '—' });
  });

  it('é gravado no arquivo e validado ao abrir; documentos v6 migram sem alteração', () => {
    const { project, id } = pipeProject();
    const flanged = setPipeEnds(project, id, { start: flange, end: null, familyId: FAMILY });
    if (!flanged.ok) throw new Error(flanged.error.message);
    const reopened = parseProject(serializeProject(flanged.value));
    if (!reopened.ok) throw new Error(reopened.error.message);
    expect(reopened.value.schemaVersion).toBe(14);
    expect(pipeOf(reopened.value, id).ends).toEqual({ start: flange });

    const v6 = parseProject(JSON.stringify({ ...project, schemaVersion: 6 }));
    if (!v6.ok) throw new Error(v6.error.message);
    expect(v6.value.schemaVersion).toBe(14);
    expect(pipeOf(v6.value, id).ends).toBeUndefined();

    // Extremidade incoerente gravada à mão é apontada pela validação.
    const tampered = structuredClone(flanged.value);
    (tampered.elements[0] as Pipe).ends = { start: { ...flange, outerDiameter: 0.05 } };
    expect(validateProject(tampered).map((issue) => issue.code)).toEqual(['INVALID_PIPE_END']);
  });
});

describe('tubulação flangeada: conexões flange × flange', () => {
  /** Famílias de teste: joelho de bolsa (90° e 45°) e curva flangeada (só 90°). */
  const elbowFamily = (
    id: string,
    endType: 'socket' | 'flange',
    angleDeg: number,
  ): FittingFamily => ({
    id,
    name: `Curva ${angleDeg}° (${endType})`,
    kind: 'elbow',
    specificationId: spec.specificationId,
    endType,
    angle: degToRad(angleDeg),
    manufacturer: null,
    standard: 'Teste',
    source: 'Família de teste',
    origin: 'builtin',
    sizes: [
      {
        dn: 100,
        centerToEnd: 0.15,
        end:
          endType === 'flange'
            ? { length: flange.length, outerDiameter: flange.outerDiameter }
            : { length: 0.08, outerDiameter: 0.14 },
      },
    ],
  });
  // A família de bolsa vem primeiro: sem a regra, seria a escolhida.
  const families = [
    elbowFamily('bolsa-90', 'socket', 90),
    elbowFamily('bolsa-45', 'socket', 45),
    elbowFamily('flange-90', 'flange', 90),
  ];
  const catalog = createFamilyCatalog(families);
  const ends = { start: flange, end: flange, familyId: FAMILY };

  function flangedRun() {
    const first = addPipe(createProject('p'), {
      start: vec3(0, 0, 0),
      end: vec3(2, 0, 0),
      spec,
      ends,
    });
    if (!first.ok) throw new Error(first.error.message);
    return first.value;
  }

  it('a mudança de direção a partir de um flange usa a curva flangeada', () => {
    const first = flangedRun();
    const result = drawPipe(first.project, {
      fromPort: { elementId: first.elementId, portId: 'end' },
      start: vec3(2, 0, 0),
      end: vec3(2, 2, 0),
      spec,
      ends,
      catalog,
    });
    if (!result.ok) throw new Error(result.error.message);
    const elbow = getElement(result.value.project, result.value.createdIds[0] ?? '');
    expect(elbow?.kind).toBe('elbow');
    if (elbow?.kind !== 'elbow') return;
    expect(elbow.familyId).toBe('flange-90');
    expect(elbow.ends.a?.type).toBe('flange');
    expect(elbow.ends.b?.type).toBe('flange');
    expect(validateProject(result.value.project)).toEqual([]);
  });

  it('sem curva flangeada para o ângulo, recusa em vez de usar peça de bolsa', () => {
    const first = flangedRun();
    const result = drawPipe(first.project, {
      fromPort: { elementId: first.elementId, portId: 'end' },
      start: vec3(2, 0, 0),
      end: vec3(4, 2, 0),
      spec,
      ends,
      catalog,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NO_FLANGED_FITTING');
  });

  it('tubo de ponta lisa continua usando a família disponível', () => {
    const base = addPipe(createProject('p'), { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec });
    if (!base.ok) throw new Error(base.error.message);
    const result = drawPipe(base.value.project, {
      fromPort: { elementId: base.value.elementId, portId: 'end' },
      start: vec3(2, 0, 0),
      end: vec3(2, 2, 0),
      spec,
      catalog,
    });
    if (!result.ok) throw new Error(result.error.message);
    const elbow = getElement(result.value.project, result.value.createdIds[0] ?? '');
    expect(elbow?.kind === 'elbow' && elbow.familyId).toBe('bolsa-90');
  });

  it('peça colocada na porta flangeada é flangeada', () => {
    const first = flangedRun();
    const result = attachFitting(first.project, {
      target: { elementId: first.elementId, portId: 'end' },
      fitting: { kind: 'elbow', angle: degToRad(90) },
      catalog,
    });
    if (!result.ok) throw new Error(result.error.message);
    const elbow = getElement(result.value.project, result.value.elementId);
    expect(elbow?.kind === 'elbow' && elbow.familyId).toBe('flange-90');
    expect(validateProject(result.value.project)).toEqual([]);
    const refused = attachFitting(first.project, {
      target: { elementId: first.elementId, portId: 'end' },
      fitting: { kind: 'elbow', angle: degToRad(45) },
      catalog,
    });
    expect(!refused.ok && refused.error.code).toBe('NO_FLANGED_FITTING');
  });

  it('a trava de ângulos considera só as curvas flangeadas', () => {
    const toDeg = (angles: number[]) => angles.map((a) => Math.round((a * 180) / Math.PI));
    expect(toDeg(availableElbowAngles(families, spec))).toEqual([45, 90]);
    expect(toDeg(availableElbowAngles(families, spec, 'flange'))).toEqual([90]);
  });
});
