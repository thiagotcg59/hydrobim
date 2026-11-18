import { EndTreatmentSchema } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_FAMILIES,
  FLANGE_FAMILIES,
  FLANGED_PIPE_FAMILIES,
  flangedPipeFamiliesFor,
  flangeEnd,
  flangeEndMm,
  flangeSize,
  getSpecification,
  pipeEndConfigurationOf,
  pipeFlangeEnd,
  resolvePipeEnds,
  resolvePipeSpec,
} from './index';

const row = (pn: 'PN 10' | 'PN 16' | 'PN 25' | 'PN 40', dn: number) => {
  const s = flangeSize(pn, dn);
  if (!s) throw new Error(`${pn} DN ${dn} ausente`);
  return [s.D, s.C, s.d, s.boltCount, s.bolt, s.a, s.g, s.c];
};

describe('tabela única de flanges (Catálogo Geral, p. 246–249)', () => {
  it('tem as quatro classes, com os diâmetros das tabelas', () => {
    expect(FLANGE_FAMILIES.map((f) => f.pressureClass)).toEqual([
      'PN 10',
      'PN 16',
      'PN 25',
      'PN 40',
    ]);
    const full = [
      50, 80, 100, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000, 1200,
    ];
    for (const family of FLANGE_FAMILIES.slice(0, 3)) {
      expect(
        family.sizes.map((s) => s.dn),
        family.id,
      ).toEqual(full);
    }
    // PN 40 vai só até DN 600.
    expect(FLANGE_FAMILIES[3]?.sizes.map((s) => s.dn)).toEqual(full.slice(0, 12));
    for (const family of FLANGE_FAMILIES) {
      expect(family.source, family.id).toContain('CATÁLOGO GERAL.pdf');
      // O fabricante não consta das páginas recebidas: não é inventado.
      expect(family.manufacturer).toBeNull();
    }
  });

  it('reproduz as tabelas (conferência por amostragem, linha inteira)', () => {
    // [D, C, d, nº, parafuso, a, g, c]
    expect(row('PN 10', 50)).toEqual([165, 125, 19, 4, 'M16', 19, 99, 3]);
    expect(row('PN 10', 200)).toEqual([340, 295, 23, 8, 'M20', 20, 266, 3]);
    expect(row('PN 10', 600)).toEqual([780, 725, 31, 20, 'M27', 30, 682, 5]);
    expect(row('PN 10', 1200)).toEqual([1455, 1380, 40, 32, 'M36', 45, 1328, 5]);
    // PN 16 difere do PN 10 a partir do DN 200 (12 furos).
    expect(row('PN 16', 200)).toEqual([340, 295, 23, 12, 'M20', 20, 266, 3]);
    expect(row('PN 16', 450)).toEqual([640, 585, 31, 20, 'M27', 30, 548, 4]);
    expect(row('PN 16', 1200)).toEqual([1485, 1390, 49, 32, 'M45', 57, 1328, 5]);
    expect(row('PN 25', 100)).toEqual([235, 190, 23, 8, 'M20', 19, 156, 3]);
    expect(row('PN 25', 700)).toEqual([960, 875, 43, 24, 'M39', 46.5, 820, 5]);
    expect(row('PN 25', 1000)).toEqual([1320, 1210, 56, 28, 'M52', 60, 1140, 5]);
    expect(row('PN 40', 150)).toEqual([300, 250, 28, 8, 'M24', 26, 211, 3]);
    expect(row('PN 40', 600)).toEqual([890, 795, 49, 20, 'M45', 58, 735, 5]);
  });

  it('cada linha é geometricamente coerente', () => {
    for (const family of FLANGE_FAMILIES) {
      let previous = 0;
      for (const s of family.sizes) {
        const where = `${family.id} DN ${s.dn}`;
        expect(s.D, where).toBeGreaterThan(previous); // D cresce com o DN
        previous = s.D;
        expect(s.C + s.d, where).toBeLessThan(s.D); // furos dentro do disco
        expect(s.g, where).toBeLessThan(s.C - s.d); // ressalto por dentro dos furos
        expect(s.c, where).toBeLessThan(s.a); // ressalto contido na espessura
        expect(s.boltCount % 4, where).toBe(0);
        // O parafuso passa com folga no furo.
        expect(Number(s.bolt.slice(1)), where).toBeLessThan(s.d);
        // Furos vizinhos não se tocam.
        expect(s.C * Math.sin(Math.PI / s.boltCount), where).toBeGreaterThan(s.d);
      }
    }
  });

  it('converte para acabamento de extremidade em SI, com furação e ressalto', () => {
    expect(flangeEndMm('PN 10', 150)).toEqual([19, 285, 240, 8, 23, 211, 3]);
    const end = flangeEnd('PN 16', 300);
    expect(EndTreatmentSchema.safeParse(end).success).toBe(true);
    expect(end).toEqual({
      type: 'flange',
      length: expect.closeTo(0.0245, 9),
      outerDiameter: expect.closeTo(0.455, 9),
      boltCircle: expect.closeTo(0.41, 9),
      boltCount: 12,
      boltHoleDiameter: expect.closeTo(0.028, 9),
      raisedFaceDiameter: expect.closeTo(0.37, 9),
      raisedFaceHeight: expect.closeTo(0.004, 9),
    });
    // Sem linha na tabela não há flange (nunca inventado).
    expect(flangeEnd('PN 10', 65)).toBeUndefined();
    expect(flangeEnd('PN 40', 700)).toBeUndefined();
    expect(flangeEndMm('PN 10', 1400)).toBeUndefined();
  });
});

describe('famílias flangeadas existentes padronizadas no PN 10', () => {
  it('conexões PAM, válvulas AVK e redutora BERMAD usam o flange da tabela única', () => {
    const flanged = BUILTIN_FAMILIES.filter(
      (f) => f.endType === 'flange' && !f.id.startsWith('spirax-'),
    );
    expect(flanged.length).toBeGreaterThan(10);
    let checked = 0;
    for (const family of flanged) {
      for (const size of family.sizes) {
        for (const [dn, end] of [
          [size.dn, size.end],
          [size.dn2 ?? size.dn, size.end2],
        ] as const) {
          const expected = flangeEnd('PN 10', dn);
          if (!end) continue;
          const { type: _type, ...dims } = expected ?? { type: 'flange' };
          expect(end, `${family.id} DN ${dn}`).toEqual(dims);
          checked += 1;
        }
        // Onde a tabela tem o DN, a peça tem o flange; onde não tem, fica sem.
        expect(size.end !== undefined, `${family.id} DN ${size.dn}`).toBe(
          flangeEnd('PN 10', size.dn) !== undefined,
        );
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('o filtro Spirax Sarco mantém o flange ASME classe 125 informado pelo fabricante', () => {
    const strainer = BUILTIN_FAMILIES.find((f) => f.id === 'spirax-sarco-ci-125');
    const end = strainer?.sizes.find((s) => s.dn === 100)?.end;
    expect(end?.boltCircle).toBeCloseTo(0.1905, 6);
    expect(end?.raisedFaceDiameter).toBeUndefined();
  });
});

describe('tubos de ferro fundido dúctil com flanges', () => {
  it('há uma família por classe de pressão, para a especificação K9', () => {
    expect(FLANGED_PIPE_FAMILIES.map((f) => f.id)).toEqual([
      'tubo-fofo-flanges-pn10',
      'tubo-fofo-flanges-pn16',
      'tubo-fofo-flanges-pn25',
      'tubo-fofo-flanges-pn40',
    ]);
    for (const family of FLANGED_PIPE_FAMILIES) {
      const specification = getSpecification(family.specificationId);
      expect(specification?.material).toBe('ductileIron');
      // Todo diâmetro do tubo tem flange tabulado, maior que o tubo.
      for (const size of specification?.sizes ?? []) {
        const spec = resolvePipeSpec(family.specificationId, size.dn)!;
        const flange = pipeFlangeEnd(spec, family.id);
        expect(flange, `${family.id} DN ${size.dn}`).toBeDefined();
        expect(flange!.outerDiameter).toBeGreaterThan(spec.outerDiameter);
        expect(flange!.raisedFaceDiameter!).toBeGreaterThan(spec.outerDiameter);
      }
    }
    expect(flangedPipeFamiliesFor('ferro-ductil-nbr7675-k9')).toHaveLength(4);
    expect(flangedPipeFamiliesFor('pvc-soldavel-nbr5648')).toHaveLength(0);
  });

  it('resolve as quatro configurações de extremidades', () => {
    const spec = resolvePipeSpec('ferro-ductil-nbr7675-k9', 150)!;
    const id = 'tubo-fofo-flanges-pn16';
    const flange = flangeEnd('PN 16', 150);
    expect(resolvePipeEnds(spec, id, 'flangeFlange')).toEqual({ start: flange, end: flange });
    expect(resolvePipeEnds(spec, id, 'flangePlain')).toEqual({ start: flange, end: null });
    expect(resolvePipeEnds(spec, id, 'plainFlange')).toEqual({ start: null, end: flange });
    expect(resolvePipeEnds(spec, id, 'plainPlain')).toEqual({ start: null, end: null });
    // Outra especificação não recebe o flange do ferro dúctil.
    const pvc = resolvePipeSpec('pvc-defofo-nbr7665', 150)!;
    expect(resolvePipeEnds(pvc, id, 'flangeFlange')).toBeNull();
    expect(pipeFlangeEnd(spec, 'inexistente')).toBeUndefined();

    expect(pipeEndConfigurationOf({})).toBe('plainPlain');
    expect(pipeEndConfigurationOf({ ends: { start: flange!, end: flange! } })).toBe('flangeFlange');
    expect(pipeEndConfigurationOf({ ends: { start: flange! } })).toBe('flangePlain');
    expect(pipeEndConfigurationOf({ ends: { end: flange! } })).toBe('plainFlange');
  });
});
