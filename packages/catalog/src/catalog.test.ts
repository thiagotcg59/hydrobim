import { describe, expect, it } from 'vitest';
import {
  defaultPipeSpec,
  listSpecifications,
  resolveNearestPipeSpec,
  resolvePipeSpec,
  SPECIFICATIONS,
} from './index';

describe('catálogo', () => {
  it('tem identificadores únicos e diâmetros crescentes e coerentes', () => {
    const ids = SPECIFICATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const specification of SPECIFICATIONS) {
      let previous = 0;
      for (const size of specification.sizes) {
        expect(size.dn).toBeGreaterThan(previous);
        previous = size.dn;
        expect(size.wallThicknessMm * 2).toBeLessThan(size.outerDiameterMm);
      }
    }
  });

  it('resolve especificações em unidades SI sem confundir DN com diâmetros reais', () => {
    const spec = resolvePipeSpec('pvc-soldavel-nbr5648', 20);
    expect(spec).toBeDefined();
    expect(spec?.outerDiameter).toBeCloseTo(0.025);
    expect(spec?.wallThickness).toBeCloseTo(0.0017);
    expect(spec?.innerDiameter).toBeCloseTo(0.0216);
    expect(spec?.dn).toBe(20);
    expect(resolvePipeSpec('pvc-soldavel-nbr5648', 999)).toBeUndefined();
    expect(resolvePipeSpec('inexistente', 20)).toBeUndefined();
  });

  it('encontra o diâmetro mais próximo ao trocar de especificação', () => {
    expect(resolveNearestPipeSpec('ferro-ductil-nbr7675-k9', 50)?.dn).toBe(80);
    expect(resolveNearestPipeSpec('pead-pe100-sdr11', 60)?.dn).toBe(63);
  });

  it('oferece padrões por ambiente', () => {
    expect(defaultPipeSpec('mep').material).toBe('pvc');
    expect(defaultPipeSpec('infra').material).toBe('ductileIron');
    expect(listSpecifications('infra').length).toBeGreaterThan(0);
  });
});
