import { radToDeg } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import {
  AMANCO_PVC_COLD_BENDING,
  coldBendRadiusM,
  DUCTILE_IRON_JGS_DEFLECTION,
  getSpecification,
  jointDeflectionDegrees,
  PEAD_COLD_BENDING,
  resolvePipeSpec,
  SPECIFICATIONS,
  TIGRE_DEFOFO_COLD_BENDING,
} from './index';

const jointDegreesOf = (specificationId: string, dn: number): number | undefined => {
  const limit = resolvePipeSpec(specificationId, dn)?.jointDeflection;
  return limit === undefined ? undefined : Math.round(radToDeg(limit) * 1000) / 1000;
};

/** Desvio (graus) que a curvatura a frio dá em uma barra inteira. */
const barDegreesOf = (specificationId: string, dn: number): number | undefined => {
  const spec = resolvePipeSpec(specificationId, dn);
  if (spec?.coldBendRadius === undefined || spec.coldBendSpan === undefined) return undefined;
  return Math.round(radToDeg(spec.coldBendSpan / spec.coldBendRadius) * 100) / 100;
};

describe('deflexão admitida na junta', () => {
  it('ferro fundido dúctil JGS: valores do manual, por faixa de DN', () => {
    const expected: Record<number, number> = {
      80: 5,
      100: 5,
      150: 5,
      200: 4,
      250: 4,
      300: 4,
      350: 3,
      400: 3,
      500: 3,
      600: 3,
    };
    const sizes = getSpecification('ferro-ductil-nbr7675-k9')?.sizes ?? [];
    expect(sizes.map((s) => s.dn)).toEqual(Object.keys(expected).map(Number));
    for (const size of sizes) {
      expect(jointDegreesOf('ferro-ductil-nbr7675-k9', size.dn)).toBe(expected[size.dn]);
    }
    // O tubo de ferro dúctil não é curvado.
    expect(resolvePipeSpec('ferro-ductil-nbr7675-k9', 150)?.coldBendRadius).toBeUndefined();
    // Faixas tabuladas além dos DN que a especificação oferece hoje.
    expect(jointDeflectionDegrees(DUCTILE_IRON_JGS_DEFLECTION, 800)).toBe(2);
    expect(jointDeflectionDegrees(DUCTILE_IRON_JGS_DEFLECTION, 1200)).toBe(1.5);
    // DN fora das faixas da fonte fica sem valor.
    expect(jointDeflectionDegrees(DUCTILE_IRON_JGS_DEFLECTION, 60)).toBeUndefined();
    expect(jointDeflectionDegrees(undefined, 100)).toBeUndefined();
  });

  it('PVC e PEAD não defletem na junta', () => {
    for (const [id, dn] of [
      ['pvc-pba-nbr5647-cl15', 100],
      ['pvc-defofo-nbr7665', 150],
      ['pead-pe100-sdr11', 110],
      ['pvc-soldavel-nbr5648', 25],
      ['aco-carbono-b3610-sch40', 100],
    ] as const) {
      expect(resolvePipeSpec(id, dn)).toBeDefined();
      expect(jointDegreesOf(id, dn)).toBeUndefined();
    }
  });
});

describe('curvatura a frio do tubo', () => {
  it('PVC DEFoFo (Tigre): raio derivado da flecha sobre a barra de 6 m', () => {
    // h = 0,10 m em 6 m → R = 6²/(8·0,10) + 0,10/2 = 45,05 m.
    expect(resolvePipeSpec('pvc-defofo-nbr7665', 100)?.coldBendRadius).toBeCloseTo(45.05, 6);
    expect(resolvePipeSpec('pvc-defofo-nbr7665', 100)?.coldBendSpan).toBe(6);
    const expected: Record<number, number> = {
      100: 7.63,
      150: 2.67,
      200: 1.53,
      250: 1.15,
      300: 1.15,
      350: 0.76,
      400: 0.76,
      500: 0.76,
    };
    const sizes = getSpecification('pvc-defofo-nbr7665')?.sizes ?? [];
    expect(sizes.map((s) => s.dn)).toEqual(Object.keys(expected).map(Number));
    for (const size of sizes) {
      expect(barDegreesOf('pvc-defofo-nbr7665', size.dn)).toBe(expected[size.dn]);
    }
    // DN que a tabela não traz fica sem valor.
    expect(coldBendRadiusM(TIGRE_DEFOFO_COLD_BENDING, 75, 85)).toBeUndefined();
  });

  it('PVC PBA (Amanco Wavin): 300 × DE no meio de 5 m curvados da barra de 6 m', () => {
    // DE 110: R = 33 m; desvio da barra = 5 / (2·33) rad = 4,34°.
    expect(barDegreesOf('pvc-pba-nbr5647-cl15', 100)).toBe(4.34);
    expect(barDegreesOf('pvc-pba-nbr5647-cl15', 75)).toBe(5.62);
    expect(barDegreesOf('pvc-pba-nbr5647-cl15', 50)).toBe(7.96);
    // As três classes têm o mesmo diâmetro externo, logo o mesmo limite.
    expect(barDegreesOf('pvc-pba-nbr5647-cl12', 100)).toBe(4.34);
    expect(barDegreesOf('pvc-pba-nbr5647-cl20', 100)).toBe(4.34);
    // Confere com o exemplo do próprio manual (linha Biax, DN 100, DE 118): 2θ = 4,0°.
    const biax = coldBendRadiusM(AMANCO_PVC_COLD_BENDING, 100, 118) ?? 0;
    expect(radToDeg(6 / biax)).toBeCloseTo(4.0, 1);
  });

  it('PEAD PE 100 SDR 11: raio de 30 × DE, tubo contínuo (sem barra)', () => {
    const spec = resolvePipeSpec('pead-pe100-sdr11', 110);
    expect(spec?.coldBendRadius).toBeCloseTo(3.3, 9);
    expect(spec?.coldBendSpan).toBeUndefined();
    expect(coldBendRadiusM(PEAD_COLD_BENDING, 315, 315)).toBeCloseTo(9.45, 9);
  });

  it('PVC soldável e aço soldado: nem junta, nem curvatura', () => {
    for (const [id, dn] of [
      ['pvc-soldavel-nbr5648', 50],
      ['aco-carbono-b3610-sch40', 100],
    ] as const) {
      const spec = resolvePipeSpec(id, dn);
      expect(spec).toBeDefined();
      expect(spec?.jointDeflection).toBeUndefined();
      expect(spec?.coldBendRadius).toBeUndefined();
    }
  });

  it('todo dado cita documento, página e URL', () => {
    for (const specification of SPECIFICATIONS) {
      for (const source of [
        specification.jointDeflection?.source,
        specification.coldBending?.source,
      ]) {
        if (source === undefined) continue;
        expect(source).toMatch(/p\. \d+/);
        expect(source).toMatch(/https:\/\//);
      }
      // Deflexão de junta só em junta elástica.
      if (specification.jointDeflection) expect(specification.jointType).toBe('socketSpigot');
    }
  });
});
