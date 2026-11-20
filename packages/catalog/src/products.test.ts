import { describe, expect, it } from 'vitest';
import {
  BUILTIN_FAMILIES,
  getSpecification,
  PBA_PIPE_MM,
  pbaBendGeometryMm,
  PRODUCT_CATEGORIES,
  PRODUCT_FAMILIES,
  resolvePipeSpec,
  type ProductFamily,
} from './index';

const byId = (id: string): ProductFamily => {
  const family = PRODUCT_FAMILIES.find((f) => f.id === id);
  if (!family) throw new Error(`produto ausente: ${id}`);
  return family;
};
const dims = (id: string, label: string): Readonly<Record<string, number>> => {
  const size = byId(id).sizes.find((s) => s.label === label);
  if (!size) throw new Error(`linha ausente: ${id} ${label}`);
  return size.dims;
};

describe('biblioteca de produtos', () => {
  it('tem identificadores e códigos únicos, fonte com página e tabelas completas', () => {
    const ids = new Set<string>();
    const codes = new Set<string>();
    for (const family of PRODUCT_FAMILIES) {
      expect(ids.has(family.id), family.id).toBe(false);
      ids.add(family.id);
      expect(PRODUCT_CATEGORIES).toContain(family.category);
      expect(family.source, family.id).toMatch(/FTC000088.*p\. \d/);
      expect(family.network.note.length, family.id).toBeGreaterThan(20);
      expect(family.sizes.length, family.id).toBeGreaterThan(0);
      for (const size of family.sizes) {
        expect(codes.has(size.code), `${family.id} ${size.code}`).toBe(false);
        codes.add(size.code);
        expect(size.weightG, size.code).toBeGreaterThan(0);
        for (const column of family.columns) {
          expect(size.dims[column.key], `${family.id} ${size.label} ${column.key}`).toBeGreaterThan(
            0,
          );
        }
      }
    }
  });

  it('cobre todos os itens da linha PBA do catálogo', () => {
    const count = (shape: ProductFamily['shape']): number =>
      PRODUCT_FAMILIES.filter((f) => f.shape === shape).reduce((n, f) => n + f.sizes.length, 0);
    expect(count('pipe')).toBe(9); // classes 12, 15 e 20 × DN 50, 75 e 100
    expect(count('bend')).toBe(12); // 11°15′, 22°30′, 45° e 90°
    expect(count('tee')).toBe(6);
    expect(count('cross')).toBe(4);
    expect(count('reducer')).toBe(3);
    expect(count('cap')).toBe(3);
    expect(count('slipCoupling')).toBe(3);
    expect(count('transitionCoupling')).toBe(3);
    expect(count('adapter')).toBe(3);
    expect(count('saddle')).toBe(12);
    expect(count('jeriSeal')).toBe(3);
    expect(count('oRing')).toBe(3);
  });

  it('reproduz valores do catálogo (conferência por amostragem)', () => {
    expect(dims('wavin-pba-tubo-cl12', 'DN100')).toEqual({
      A: 132.5,
      B: 110.6,
      C: 120,
      D: 110,
      e: 5,
      L: 6155,
    });
    expect(dims('wavin-pba-tubo-cl20', 'DN75').e).toBe(6.1);
    expect(dims('wavin-pba-curva-45', 'DN75')).toEqual({
      A: 113.3,
      B: 85.5,
      C: 80,
      D: 85,
      F: 154.1,
      L: 397,
    });
    expect(dims('wavin-pba-curva-90', 'DN100').L).toBe(451);
    expect(dims('wavin-pba-te-reducao', 'DN100xDN75')).toMatchObject({
      A1: 116.7,
      L1: 208,
      L: 288,
    });
    expect(dims('wavin-pba-cruzeta-reducao', 'DN75xDN50')).toMatchObject({ L1: 226, L: 248 });
    expect(dims('wavin-pba-reducao', 'DN100xDN50')).toMatchObject({ D: 110, F: 93, L: 192 });
    expect(dims('wavin-pba-adaptador-defofo', 'DN100xDN100')).toMatchObject({ D: 118, L: 328.3 });
    expect(dims('wavin-pba-luva-simples', 'DN75')).toMatchObject({ F: 72.9, L: 174.3 });
    expect(dims('wavin-pba-colar-tomada', 'DN75 x ¾')).toEqual({ L1: 116.7, L: 120.9, D: 85 });
    expect(dims('wavin-pba-anel-jeri', 'DN50')).toEqual({ A: 18.6, B: 10.9, C: 67.3, D: 81.7 });
    expect(dims('wavin-pba-anel-oring', 'DN100')).toEqual({ A: 133.5, E: 12.1 });
  });

  it('os tubos da biblioteca coincidem com as especificações de tubo do editor', () => {
    for (const pressureClass of [12, 15, 20] as const) {
      const specification = getSpecification(`pvc-pba-nbr5647-cl${pressureClass}`);
      expect(specification, `classe ${pressureClass}`).toBeDefined();
      for (const size of byId(`wavin-pba-tubo-cl${pressureClass}`).sizes) {
        const spec = resolvePipeSpec(`pvc-pba-nbr5647-cl${pressureClass}`, size.dn);
        expect(spec?.outerDiameter).toBeCloseTo((size.dims.D ?? NaN) / 1000, 9);
        expect(spec?.wallThickness).toBeCloseTo((size.dims.e ?? NaN) / 1000, 9);
        expect(PBA_PIPE_MM[size.dn]?.wall[pressureClass]).toBe(size.dims.e);
      }
    }
  });

  it('as conexões PBA da rede atendem às três classes de tubo', () => {
    for (const pressureClass of [12, 15, 20]) {
      const spec = `pvc-pba-nbr5647-cl${pressureClass}`;
      // Conexões da ficha PBA; as válvulas vêm de outros catálogos e têm testes próprios.
      const kinds = BUILTIN_FAMILIES.filter(
        (f) => f.specificationId === spec && f.kind !== 'valve',
      ).map((f) => f.kind);
      expect(kinds.sort()).toEqual([
        'cross',
        'cross',
        'elbow',
        'elbow',
        'elbow',
        'elbow',
        'reducer',
        'tee',
        'tee',
      ]);
    }
  });

  it('curvas: o raio derivado reproduz a cota L de todas as curvas', () => {
    for (const family of PRODUCT_FAMILIES.filter((f) => f.shape === 'bend')) {
      for (const size of family.sizes) {
        const geometry = pbaBendGeometryMm(family.angleDeg ?? NaN, size.dn);
        expect(geometry, `${family.id} ${size.label}`).toBeDefined();
        if (!geometry) continue;
        const { C = NaN, D = NaN, F = NaN, L = NaN } = size.dims;
        const theta = ((family.angleDeg ?? NaN) * Math.PI) / 180;
        const total =
          C +
          geometry.lead +
          geometry.bendRadius * Math.sin(theta) +
          F * Math.cos(theta) +
          (D / 2) * Math.sin(theta);
        expect(total).toBeCloseTo(L, 9);
        // O trecho reto após a bolsa é positivo e o raio fica entre 1,5 e 2,5 diâmetros.
        expect(geometry.lead).toBeGreaterThan(0);
        expect(geometry.bendRadius / D).toBeGreaterThan(1.5);
        expect(geometry.bendRadius / D).toBeLessThan(2.5);
      }
    }
    expect(pbaBendGeometryMm(90, 50)?.bendRadius).toBeCloseTo(104.55, 1);
    expect(pbaBendGeometryMm(30, 50)).toBeUndefined();
  });
});
