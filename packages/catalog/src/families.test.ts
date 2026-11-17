import { createFamilyCatalog, FittingFamilySchema, type FittingFamily } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { BUILTIN_FAMILIES, getSpecification, resolvePipeSpec } from './index';

const byId = (id: string): FittingFamily => {
  const family = BUILTIN_FAMILIES.find((f) => f.id === id);
  if (!family) throw new Error(`família ausente: ${id}`);
  return family;
};
const mm = (m: number | undefined): number => Math.round((m ?? NaN) * 1e5) / 100;

describe('famílias embutidas', () => {
  it('são válidas, têm identificadores únicos, fonte e especificação existente', () => {
    const ids = new Set<string>();
    for (const family of BUILTIN_FAMILIES) {
      expect(FittingFamilySchema.safeParse(family).success, family.id).toBe(true);
      expect(ids.has(family.id), family.id).toBe(false);
      ids.add(family.id);
      expect(family.origin).toBe('builtin');
      expect(family.source.length, family.id).toBeGreaterThan(20);
      expect(getSpecification(family.specificationId), family.id).toBeDefined();
      expect(family.sizes.length, family.id).toBeGreaterThan(0);
      if (family.kind === 'elbow') expect(family.angle, family.id).toBeGreaterThan(0);
      if (family.kind === 'valve') expect(family.valveType, family.id).toBeDefined();

      const keys = new Set<string>();
      for (const size of family.sizes) {
        const key = `${size.dn}/${size.dn2 ?? ''}`;
        expect(keys.has(key), `${family.id} ${key}`).toBe(false);
        keys.add(key);
        if (family.kind === 'reducer') {
          expect(size.dn2, family.id).toBeLessThan(size.dn);
          expect(size.length, family.id).toBeGreaterThan(0);
        }
        if (family.kind === 'elbow' || family.kind === 'tee') {
          expect(size.centerToEnd, family.id).toBeGreaterThan(0);
        }
        if (family.kind === 'valve') expect(size.length, family.id).toBeGreaterThan(0);
        // Bolsas e flanges precisam envolver o tubo.
        const spec = resolvePipeSpec(family.specificationId, size.dn);
        if (spec && size.end) {
          expect(size.end.outerDiameter, `${family.id} DN ${size.dn}`).toBeGreaterThan(
            spec.outerDiameter,
          );
        }
      }
    }
  });

  it('reproduz valores dos catálogos (conferência por amostragem)', () => {
    // Krona, joelho 90° soldável DE 25 (DN 20): Z 14,4; bolsa 19 × Ø 33,8.
    const joelho = byId('krona-joelho-90-soldavel').sizes.find((s) => s.dn === 20);
    expect([
      mm(joelho?.centerToEnd),
      mm(joelho?.end?.length),
      mm(joelho?.end?.outerDiameter),
    ]).toEqual([14.4, 19, 33.8]);
    // Krona, tê de redução 50×25 (DN 40×20): Z1 13,3; Z2 27.
    const te = byId('krona-te-reducao-soldavel').sizes.find((s) => s.dn === 40 && s.dn2 === 20);
    expect([mm(te?.centerToEnd), mm(te?.centerToBranch)]).toEqual([13.3, 27]);
    // PAM, curva 90° com flanges DN 150: Lu 220; flange PN 10 Ø 285.
    const curva = byId('pam-curva-90-flanges@ferro-ductil-nbr7675-k9').sizes.find(
      (s) => s.dn === 150,
    );
    expect([mm(curva?.centerToEnd), mm(curva?.end?.outerDiameter)]).toEqual([220, 285]);
    // PAM, curva 45° com bolsas DN 200: Lu 100; bolsa 100 × Ø 294.
    const bolsa = byId('pam-curva-45-bolsas@ferro-ductil-nbr7675-k9').sizes.find(
      (s) => s.dn === 200,
    );
    expect([mm(bolsa?.centerToEnd), mm(bolsa?.end?.length), mm(bolsa?.end?.outerDiameter)]).toEqual(
      [100, 100, 294],
    );
    // AVK, gaveta corpo curto DN 100: L 190; H 305; volante 280.
    const gaveta = byId('avk-gaveta-curta-en558-s14@ferro-ductil-nbr7675-k9').sizes.find(
      (s) => s.dn === 100,
    );
    expect([mm(gaveta?.length), mm(gaveta?.height), mm(gaveta?.handwheelDiameter)]).toEqual([
      190, 305, 280,
    ]);
    // ASME B16.9, DN 100: joelho 90° LR 152; tê 105; redução 100×80 102.
    expect(mm(byId('b169-joelho-90-raio-longo').sizes.find((s) => s.dn === 100)?.centerToEnd)).toBe(
      152,
    );
    expect(mm(byId('b169-te').sizes.find((s) => s.dn === 100)?.centerToEnd)).toBe(105);
    expect(
      mm(byId('b169-reducao-concentrica').sizes.find((s) => s.dn === 100 && s.dn2 === 80)?.length),
    ).toBe(102);
  });

  it('resolve dimensões pelo catálogo para as especificações reais', () => {
    const catalog = createFamilyCatalog(BUILTIN_FAMILIES);
    const pvc20 = resolvePipeSpec('pvc-soldavel-nbr5648', 20)!;
    const pvc25 = resolvePipeSpec('pvc-soldavel-nbr5648', 25)!;
    const elbow = catalog.elbow(pvc20, Math.PI / 2);
    expect(elbow.familyId).toBe('krona-joelho-90-soldavel');
    expect(elbow.bendRadius).toBeCloseTo(0.0144);
    expect(elbow.ends.a?.type).toBe('socket');

    // Redução 32×25 (DN 25×20), em qualquer ordem das portas.
    const down = catalog.reducer(pvc25, pvc20);
    const up = catalog.reducer(pvc20, pvc25);
    expect(down.familyId).toBe('krona-luva-reducao-soldavel');
    expect(down.length).toBeCloseTo(0.0033);
    expect(up.length).toBeCloseTo(0.0033);
    expect(down.ends.a?.outerDiameter).toBeCloseTo(0.042);
    expect(up.ends.b?.outerDiameter).toBeCloseTo(0.042);

    // Ferro dúctil: preferência do usuário escolhe entre bolsas e flanges.
    const di150 = resolvePipeSpec('ferro-ductil-nbr7675-k9', 150)!;
    expect(catalog.elbow(di150, Math.PI / 2).ends.a?.type).toBe('socket');
    const flanged = createFamilyCatalog(BUILTIN_FAMILIES, {
      elbow: 'pam-curva-90-flanges@ferro-ductil-nbr7675-k9',
    }).elbow(di150, Math.PI / 2);
    expect(flanged.ends.a?.type).toBe('flange');
    expect(flanged.bendRadius).toBeCloseTo(0.22);

    // Fora de catálogo: ângulo arbitrário cai nas dimensões genéricas.
    expect(catalog.elbow(di150, 0.6).familyId).toBeNull();
    // Válvulas por tipo.
    expect(catalog.valve(di150, 'gate').length).toBeCloseTo(0.21);
    expect(catalog.valve(di150, 'check').length).toBeCloseTo(0.4);
    expect(Object.keys(catalog.valve(di150, 'airRelease').ends)).toEqual(['a']);
  });

  it('redutora de pressão BERMAD 720: todos os diâmetros das tabelas SIGMA EN e ES', () => {
    const en = byId('bermad-720-sigma-en@ferro-ductil-nbr7675-k9');
    const es = byId('bermad-720-sigma-es@ferro-ductil-nbr7675-k9');
    expect(en.valveType).toBe('pressureReducing');
    expect(en.sizes.map((s) => s.dn)).toEqual([40, 50, 65, 80, 100, 150, 200, 250, 300, 400]);
    expect(es.sizes.map((s) => s.dn)).toEqual([
      65, 80, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500, 600,
    ]);

    // SIGMA EN DN 100: L 350, W 255, h 131, H 400 → eixo ao topo = 400 − 131 = 269.
    const en100 = en.sizes.find((s) => s.dn === 100)!;
    expect(en100.length).toBeCloseTo(0.35);
    expect(en100.width).toBeCloseTo(0.255);
    expect(en100.height).toBeCloseTo(0.269);
    expect(en100.end?.outerDiameter).toBeCloseTo(0.22);
    // SIGMA ES DN 600: L 1450, W 920, h 465, H 1260.
    const es600 = es.sizes.find((s) => s.dn === 600)!;
    expect(es600.length).toBeCloseTo(1.45);
    expect(es600.width).toBeCloseTo(0.92);
    expect(es600.height).toBeCloseTo(0.795);
    // DN sem dado de flange não recebem flange inventado.
    expect(en.sizes.find((s) => s.dn === 50)!.end).toBeUndefined();

    // A preferência do usuário escolhe entre as séries EN e ES.
    const di150 = resolvePipeSpec('ferro-ductil-nbr7675-k9', 150)!;
    const dims = createFamilyCatalog(BUILTIN_FAMILIES).valve(di150, 'pressureReducing');
    expect(dims.familyId).toBe('bermad-720-sigma-en@ferro-ductil-nbr7675-k9');
    expect(dims.length).toBeCloseTo(0.48);
    expect(dims.height).toBeCloseTo(0.362);
    expect(dims.width).toBeCloseTo(0.32);
    expect(Object.keys(dims.ends)).toEqual(['a', 'b']);
    const reduced = createFamilyCatalog(BUILTIN_FAMILIES, {
      valve: 'bermad-720-sigma-es@ferro-ductil-nbr7675-k9',
    }).valve(di150, 'pressureReducing');
    expect(reduced.height).toBeCloseTo(0.282);
  });
});
