import { createFamilyCatalog } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { BUILTIN_FAMILIES, resolvePipeSpec } from '../index';

const mm = (m: number | undefined): number => Math.round((m ?? NaN) * 1e5) / 100;

describe('filtro Y Spirax Sarco CI (TI-D245-01)', () => {
  const family = BUILTIN_FAMILIES.find((f) => f.id === 'spirax-sarco-ci-125');
  if (!family) throw new Error('família ausente');

  it('transcreve a tabela de dimensões: A (face a face) e B (eixo ao fundo do bojo)', () => {
    expect(family.kind).toBe('valve');
    expect(family.valveType).toBe('strainer');
    expect(family.endType).toBe('flange');
    expect(family.manufacturer).toBe('Spirax Sarco');
    expect(family.source).toContain('TI-D245-01');
    // [DN, A, B] de 2" a 16".
    expect(family.sizes.map((s) => [s.dn, mm(s.length), mm(s.height)])).toEqual([
      [50, 230, 159],
      [65, 290, 234],
      [80, 310, 230],
      [100, 370, 265],
      [150, 480, 383],
      [200, 600, 482],
      [250, 762, 488],
      [300, 858, 610],
      [350, 980, 723],
      [400, 1080, 746],
    ]);
    // C (distância para manutenção) e o peso não viram dimensões da peça.
    for (const size of family.sizes) {
      expect(size.width).toBeUndefined();
      expect(size.handwheelDiameter).toBeUndefined();
    }
  });

  it('usa o flange ASME B16.1 classe 125, com a furação da norma', () => {
    const flange = (dn: number) => {
      const end = family.sizes.find((s) => s.dn === dn)?.end;
      return [
        mm(end?.outerDiameter),
        mm(end?.length),
        mm(end?.boltCircle),
        end?.boltCount,
        mm(end?.boltHoleDiameter),
      ];
    };
    // Em polegadas na fonte: 2" → 6.00 / 0.62 / 4.75 / 4 / 0.75.
    expect(flange(50)).toEqual([152.4, 15.7, 120.65, 4, 19.05]);
    // 4" → 9.00 / 0.94 / 7.50 / 8 / 0.75.
    expect(flange(100)).toEqual([228.6, 23.9, 190.5, 8, 19.05]);
    // 16" → 23.50 / 1.44 / 21.25 / 16 / 1.12.
    expect(flange(400)).toEqual([596.9, 36.6, 539.75, 16, 28.45]);
    // A furação cabe no flange e fora do tubo em todos os diâmetros.
    for (const size of family.sizes) {
      const end = size.end;
      if (!end?.boltCircle || !end.boltHoleDiameter) throw new Error(`DN ${size.dn} sem furação`);
      expect(end.boltCircle + end.boltHoleDiameter, `DN ${size.dn}`).toBeLessThan(
        end.outerDiameter,
      );
      const spec = resolvePipeSpec(family.specificationId, size.dn);
      if (spec) {
        expect(end.boltCircle - end.boltHoleDiameter, `DN ${size.dn}`).toBeGreaterThan(
          spec.outerDiameter,
        );
      }
    }
  });

  it('é resolvido pelo catálogo no aço-carbono e não é oferecido ao ferro dúctil', () => {
    const catalog = createFamilyCatalog(BUILTIN_FAMILIES);
    const steel = resolvePipeSpec('aco-carbono-b3610-sch40', 100);
    const ductile = resolvePipeSpec('ferro-ductil-nbr7675-k9', 100);
    if (!steel || !ductile) throw new Error('especificação ausente');
    const dims = catalog.valve(steel, 'strainer');
    expect(dims.familyId).toBe('spirax-sarco-ci-125');
    expect(dims.length).toBeCloseTo(0.37);
    expect(dims.height).toBeCloseTo(0.265);
    expect(dims.ends.a).toEqual({
      type: 'flange',
      length: expect.closeTo(0.0239, 9),
      outerDiameter: expect.closeTo(0.2286, 9),
      boltCircle: expect.closeTo(0.1905, 9),
      boltCount: 8,
      boltHoleDiameter: expect.closeTo(0.01905, 9),
    });
    expect(dims.ends.b).toEqual(dims.ends.a);
    // Flange ASME 125 não casa com o flange PN do ferro dúctil: sem família, dimensão genérica.
    expect(catalog.valve(ductile, 'strainer').familyId).toBeNull();
  });
});
