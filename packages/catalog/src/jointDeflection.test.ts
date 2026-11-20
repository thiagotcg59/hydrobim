import { radToDeg } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import {
  DUCTILE_IRON_JGS_DEFLECTION,
  getSpecification,
  jointDeflectionDegrees,
  PVC_ELASTIC_JOINT_DEFLECTION,
  resolvePipeSpec,
  SPECIFICATIONS,
} from './index';

const degreesOf = (specificationId: string, dn: number): number | undefined => {
  const limit = resolvePipeSpec(specificationId, dn)?.jointDeflection;
  return limit === undefined ? undefined : Math.round(radToDeg(limit) * 1000) / 1000;
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
      expect(degreesOf('ferro-ductil-nbr7675-k9', size.dn)).toBe(expected[size.dn]);
    }
    // Faixas tabuladas além dos DN que a especificação oferece hoje.
    expect(jointDeflectionDegrees(DUCTILE_IRON_JGS_DEFLECTION, 800)).toBe(2);
    expect(jointDeflectionDegrees(DUCTILE_IRON_JGS_DEFLECTION, 1200)).toBe(1.5);
  });

  it('PVC com junta elástica (PBA e DEFoFo): 1° por junta', () => {
    for (const id of [
      'pvc-pba-nbr5647-cl12',
      'pvc-pba-nbr5647-cl15',
      'pvc-pba-nbr5647-cl20',
      'pvc-defofo-nbr7665',
    ]) {
      for (const size of getSpecification(id)?.sizes ?? []) {
        expect(degreesOf(id, size.dn)).toBe(1);
      }
    }
  });

  it('juntas soldadas e por termofusão não têm deflexão', () => {
    expect(resolvePipeSpec('pvc-soldavel-nbr5648', 25)).toBeDefined();
    expect(degreesOf('pvc-soldavel-nbr5648', 25)).toBeUndefined();
    expect(degreesOf('aco-carbono-b3610-sch40', 100)).toBeUndefined();
    expect(degreesOf('pead-pe100-sdr11', 110)).toBeUndefined();
  });

  it('DN fora das faixas da fonte fica sem valor', () => {
    expect(jointDeflectionDegrees(DUCTILE_IRON_JGS_DEFLECTION, 60)).toBeUndefined();
    expect(jointDeflectionDegrees(DUCTILE_IRON_JGS_DEFLECTION, 1400)).toBeUndefined();
    expect(jointDeflectionDegrees(undefined, 100)).toBeUndefined();
  });

  it('só juntas elásticas têm tabela, e toda tabela cita documento, página e URL', () => {
    for (const specification of SPECIFICATIONS) {
      if (!specification.jointDeflection) continue;
      expect(specification.jointType).toBe('socketSpigot');
      expect(specification.jointDeflection.source).toMatch(/p\. \d+/);
      expect(specification.jointDeflection.source).toMatch(/https:\/\//);
    }
    expect(DUCTILE_IRON_JGS_DEFLECTION.source).toContain('Saint-Gobain Canalização');
    expect(PVC_ELASTIC_JOINT_DEFLECTION.source).toContain('Amanco Wavin');
  });
});
