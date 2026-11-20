import { buildFitting, createProject, getPorts, pumpLengthMismatch } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import {
  flangeEnd,
  flangeForClass,
  flangeSize,
  getPumpFamily,
  PUMP_FAMILIES,
  resolvePipeSpec,
  resolvePumpPlacement,
} from './index';

const DUCTILE = 'ferro-ductil-nbr7675-k9';
const ductile = (dn: number) => resolvePipeSpec(DUCTILE, dn)!;

/** Linha da tabela em mm, na ordem das colunas: [C, D, E, F, G, ØH, I, J]. */
const row = (familyId: string, index: number): number[] => {
  const d = getPumpFamily(familyId)!.variants[index]!.dimensions;
  return [
    d.footOffset,
    d.footSpan,
    d.rearLength,
    d.length,
    d.footWidth,
    d.footHoleDiameter,
    d.axisHeight,
    d.totalHeight,
  ].map((v) => Math.round(v * 10000) / 10);
};

describe('bombas anfíbias HIGRA (Manual Técnico Rev. 22, p. 42–45)', () => {
  it('traz as quatro tabelas, com cinco linhas de portes diferentes em cada uma', () => {
    expect(PUMP_FAMILIES.map((f) => f.id)).toEqual([
      'higra-anfibia-estagio-unico-60hz',
      'higra-anfibia-multiplos-estagios-60hz',
      'higra-anfibia-estagio-unico-50hz',
      'higra-anfibia-multiplos-estagios-50hz',
    ]);
    const ids = new Set<string>();
    for (const family of PUMP_FAMILIES) {
      expect(family.manufacturer).toBe('HIGRA');
      expect(family.pumpType).toBe('amphibious');
      expect(family.source).toContain(`Tabela ${family.page - 26}, p. ${family.page}`);
      expect(family.variants).toHaveLength(5);
      // Portes diferentes: nenhuma linha repete o comprimento F de outra.
      expect(new Set(family.variants.map((v) => v.dimensions.length)).size).toBe(5);
      const multi = family.id.includes('multiplos');
      for (const variant of family.variants) {
        expect(ids.has(variant.id), variant.id).toBe(false);
        ids.add(variant.id);
        expect(variant.models.length).toBeGreaterThan(0);
        expect(variant.stages > 1, variant.id).toBe(multi);
        const d = variant.dimensions;
        expect(d.footOffset + d.footSpan, variant.id).toBeLessThan(d.length);
        expect(d.axisHeight, variant.id).toBeLessThan(d.totalHeight);
      }
    }
    expect(ids.size).toBe(20);
  });

  it('transcreve as linhas como impressas (amostras de cada tabela)', () => {
    const single60 = getPumpFamily('higra-anfibia-estagio-unico-60hz')!;
    expect(single60.variants[0]).toMatchObject({
      models: ['R1-195/15B', 'R1-195/20B', 'R1-195/25B', 'R1-195/30B'],
      frame: '132L',
      suction: { dn: 80, pressureClass: 'PN 40' },
      discharge: { dn: 80, pressureClass: 'PN 40' },
      weightKg: 210,
      stages: 1,
    });
    expect(row(single60.id, 0)).toEqual([160, 599, 174, 933, 270, 26.5, 206, 396]);
    expect(row(single60.id, 2)).toEqual([346, 747, 293, 1386, 376, 30, 327, 647]);
    expect(row(single60.id, 4)).toEqual([620, 787, 854, 2261, 530, 35, 590, 1097]);
    expect(single60.variants[4]?.suction).toEqual({ dn: 600, pressureClass: 'PN 10' });

    const multi60 = getPumpFamily('higra-anfibia-multiplos-estagios-60hz')!;
    expect(row(multi60.id, 1)).toEqual([385, 657, 373, 1406, 380, 30, 335, 635]);
    expect(multi60.variants[1]).toMatchObject({
      models: ['R2-265/40B', 'R2-265/50B', 'R2-265/60B'],
      suction: { dn: 150, pressureClass: 'PN 40' },
      discharge: { dn: 200, pressureClass: 'PN 40' },
      stages: 2,
      weightKg: 805,
    });
    expect(row(multi60.id, 4)).toEqual([394, 1333, 1024, 2752, 450, 35, 440, 828]);
    expect(multi60.variants[4]).toMatchObject({
      suction: { dn: 300, pressureClass: 'PN 25' },
      discharge: { dn: 300, pressureClass: 'PN 40' },
      stages: 4,
    });

    const single50 = getPumpFamily('higra-anfibia-estagio-unico-50hz')!;
    expect(row(single50.id, 0)).toEqual([160, 599, 174, 933, 270, 25, 206, 396]);
    expect(row(single50.id, 3)).toEqual([728, 762, 575, 2065, 450, 35, 480, 960]);
    expect(single50.variants[2]?.suction).toEqual({ dn: 300, pressureClass: 'PN 16' });

    const multi50 = getPumpFamily('higra-anfibia-multiplos-estagios-50hz')!;
    expect(row(multi50.id, 0)).toEqual([160, 599, 244, 1003, 270, 26, 206, 450]);
    expect(row(multi50.id, 2)).toEqual([355, 1080, 616, 2051, 450, 35, 435, 805]);
    expect(multi50.variants[1]?.frame).toBe('160T');
  });

  it('registra as linhas em que F impresso não é C + D + E', () => {
    const multi60 = getPumpFamily('higra-anfibia-multiplos-estagios-60hz')!;
    // R2-265: 385 + 657 + 373 = 1415, e F impresso = 1406.
    expect(pumpLengthMismatch(multi60.variants[1]!.dimensions)).toBeCloseTo(-0.009, 9);
    expect(multi60.remarks.some((r) => r.startsWith('R2-265/40B a R2-265/60B: F impresso'))).toBe(
      true,
    );
    // M1-305 fecha exatamente: sem observação.
    const single60 = getPumpFamily('higra-anfibia-estagio-unico-60hz')!;
    expect(pumpLengthMismatch(single60.variants[2]!.dimensions)).toBeCloseTo(0, 9);
    expect(single60.remarks.some((r) => r.startsWith('M1-305'))).toBe(false);
  });

  it('resolve toda linha no ferro fundido dúctil, com os flanges da tabela única', () => {
    const project = createProject('bombas');
    for (const family of PUMP_FAMILIES) {
      for (const variant of family.variants) {
        const placement = resolvePumpPlacement(family, { variantId: variant.id }, ductile(100));
        if (!placement.ok) throw new Error(`${variant.id}: ${placement.error.message}`);
        const { spec, fitting } = placement.value;
        expect(spec.dn).toBe(variant.suction.dn);
        expect(fitting.dischargeSpec?.dn).toBe(variant.discharge.dn);
        const built = buildFitting(project, fitting, spec, project.systems[0]!.id);
        if (!built.ok) throw new Error(`${variant.id}: ${built.error.message}`);
        const [a, b] = getPorts(built.value);
        expect(a?.end?.type, variant.id).toBe('flange');
        expect(b?.end?.type, variant.id).toBe('flange');
        expect(b?.localPosition.x).toBeCloseTo(variant.dimensions.length, 9);
      }
    }
    // O flange é o da tabela única, na classe impressa (PN 40, DN 200: D = 375, 12 furos).
    const family = getPumpFamily('higra-anfibia-estagio-unico-60hz')!;
    const placement = resolvePumpPlacement(
      family,
      { variantId: family.variants[1]!.id },
      ductile(80),
    );
    expect(placement.ok && placement.value.fitting.parameters?.ends.a).toEqual(
      flangeEnd('PN 40', 200),
    );
    expect(flangeForClass(ductile(200), 'PN 40')).toEqual(flangeEnd('PN 40', 200));
    expect(flangeForClass(ductile(200), 'PN 6')).toBeUndefined();
  });

  it('a Tabela 20 do manual (p. 46) confere com a tabela única de flanges', () => {
    // [classe, DN, ØD, C (espessura), ØK, ØL2, nº de furos], como impresso no manual.
    const TABLE_20 = [
      ['PN 40', 300, 515, 39.5, 450, 34, 16],
      ['PN 40', 250, 450, 34.5, 385, 34, 12],
      ['PN 40', 200, 375, 30, 320, 31, 12],
      ['PN 40', 150, 300, 26, 250, 28, 8],
      ['PN 40', 80, 200, 19, 160, 19, 8],
      ['PN 25', 400, 620, 32, 550, 37, 16],
      ['PN 25', 300, 485, 27.5, 430, 31, 16],
      ['PN 16', 300, 455, 24.5, 410, 28, 12],
      ['PN 10', 600, 780, 30, 725, 31, 20],
      ['PN 10', 500, 670, 26.5, 620, 28, 20],
      ['PN 10', 350, 505, 24.5, 460, 23, 16],
      ['PN 10', 300, 455, 24.5, 400, 23, 12],
      ['PN 10', 200, 340, 20, 295, 23, 8],
    ] as const;
    for (const [pressureClass, dn, D, thickness, K, hole, count] of TABLE_20) {
      const size = flangeSize(pressureClass, dn);
      expect(
        [size?.D, size?.a, size?.C, size?.d, size?.boltCount],
        `${pressureClass} DN ${dn}`,
      ).toEqual([D, thickness, K, hole, count]);
    }
    // Todo flange usado pelas linhas cadastradas está nessa tabela do manual.
    const printed = new Set(TABLE_20.map(([pressureClass, dn]) => `DN ${dn} ${pressureClass}`));
    for (const family of PUMP_FAMILIES) {
      for (const variant of family.variants) {
        for (const flange of [variant.suction, variant.discharge]) {
          expect(printed.has(`DN ${flange.dn} ${flange.pressureClass}`), variant.id).toBe(true);
        }
      }
    }
  });

  it('recusa a inserção quando a especificação não tem o diâmetro ou o flange', () => {
    const family = getPumpFamily('higra-anfibia-estagio-unico-60hz')!;
    // PVC soldável não tem DN 200.
    const pvc = resolvePipeSpec('pvc-soldavel-nbr5648', 25)!;
    const refused = resolvePumpPlacement(family, { variantId: family.variants[1]!.id }, pvc);
    expect(!refused.ok && refused.error.code).toBe('PUMP_NO_PIPE_SIZE');
    expect(!refused.ok && refused.error.message).toContain('DN 200');
    const unknown = resolvePumpPlacement(family, { variantId: 'nao-existe' }, ductile(100));
    expect(!unknown.ok && unknown.error.code).toBe('PUMP_VARIANT_NOT_FOUND');
    // Cotas preenchidas: PN 40 não é tabulado para DN 25.
    const noFlange = resolvePumpPlacement(family, { custom: {} }, pvc);
    expect(!noFlange.ok && noFlange.error.code).toBe('FLANGE_NOT_FOUND');
  });

  it('monta outro modelo com as cotas preenchidas pelo usuário', () => {
    const family = getPumpFamily('higra-anfibia-multiplos-estagios-60hz')!;
    const placement = resolvePumpPlacement(
      family,
      {
        custom: {
          dimensions: { length: 1.704, footOffset: 0.355, footSpan: 0.716, rearLength: 0.635 },
          stages: 5,
          suctionFlangeClass: 'PN 40',
          dischargeFlangeClass: 'PN 40',
        },
      },
      ductile(150),
      200,
    );
    if (!placement.ok) throw new Error(placement.error.message);
    const parameters = placement.value.fitting.parameters!;
    expect(placement.value.spec.dn).toBe(150);
    expect(placement.value.fitting.dischargeSpec?.dn).toBe(200);
    expect(parameters.variantId).toBeUndefined();
    expect(parameters).toMatchObject({ length: 1.704, footSpan: 0.716, stages: 5 });
    expect(parameters.ends.a).toEqual(flangeEnd('PN 40', 150));
    expect(parameters.ends.b).toEqual(flangeEnd('PN 40', 200));
    expect(parameters.manufacturing.model).toContain('cotas preenchidas pelo usuário');
  });
});
