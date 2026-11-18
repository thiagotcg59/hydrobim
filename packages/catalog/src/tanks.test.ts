import {
  tankGeometricVolume,
  tankParametersFromFamily,
  tankProblem,
  type Tank,
  type TankFamily,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { getTankFamily, TANK_FAMILIES } from './tanks';

const family = (id: string): TankFamily => {
  const found = getTankFamily(id);
  if (!found) throw new Error(`Família inexistente: ${id}`);
  return found;
};

/** Linha impressa: [capacidade (L), altura total (m), diâmetro (m), altura da coluna (m)?]. */
const row = (f: TankFamily, index: number): (number | undefined)[] => {
  const v = f.variants[index];
  return v ? [v.capacityL, v.height, v.diameter, v.columnHeight] : [];
};

describe('catálogo TRAMEC de reservatórios metálicos', () => {
  it('traz as oito famílias do catálogo, com fonte e página', () => {
    expect(TANK_FAMILIES.map((f) => [f.id, f.tankType, f.page])).toEqual([
      ['tramec-taca-com-agua', 'gobletWet', 4],
      ['tramec-taca-sem-agua', 'gobletDry', 4],
      ['tramec-tubular-alto', 'tubular', 5],
      ['tramec-australiano', 'australian', 5],
      ['tramec-vertical-apoiado', 'verticalGround', 6],
      ['tramec-vertical-fundo-conico', 'verticalConeLegs', 6],
      ['tramec-vertical-in-loco', 'fieldErected', 7],
      ['tramec-cilindrico-horizontal', 'horizontal', 7],
    ]);
    for (const f of TANK_FAMILIES) {
      expect(f.manufacturer).toBe('TRAMEC');
      expect(f.material).toBe('Aço-carbono estrutural');
      expect(f.source).toContain(`p. ${f.page}`);
      expect(f.source).toContain('tramec.com.br');
      expect(f.approximations.length).toBeGreaterThan(0);
    }
  });

  it('tem todas as linhas das tabelas (113 modelos) e nenhuma nas famílias sem tabela', () => {
    expect(Object.fromEntries(TANK_FAMILIES.map((f) => [f.id, f.variants.length]))).toEqual({
      'tramec-taca-com-agua': 19,
      'tramec-taca-sem-agua': 34,
      'tramec-tubular-alto': 30,
      'tramec-australiano': 0,
      'tramec-vertical-apoiado': 10,
      'tramec-vertical-fundo-conico': 10,
      'tramec-vertical-in-loco': 0,
      'tramec-cilindrico-horizontal': 0,
    });
    const ids = TANK_FAMILIES.flatMap((f) => f.variants.map((v) => v.id));
    expect(new Set(ids).size).toBe(ids.length);
    // As famílias sem tabela declaram isso ao usuário.
    for (const id of [
      'tramec-australiano',
      'tramec-vertical-in-loco',
      'tramec-cilindrico-horizontal',
    ]) {
      expect(family(id).approximations[0]).toContain('NÃO tabula');
    }
  });

  it('confere linhas da p. 4 — taça com e sem água na coluna', () => {
    const wet = family('tramec-taca-com-agua');
    expect(row(wet, 0)).toEqual([5000, 6.7, 1.44, undefined]);
    expect(row(wet, 4)).toEqual([15000, 7.6, 2.22, undefined]);
    expect(row(wet, 8)).toEqual([20000, 9.4, 2.23, undefined]);
    expect(row(wet, 13)).toEqual([40000, 11.3, 2.86, undefined]);
    expect(row(wet, 18)).toEqual([80000, 15, 3.2, undefined]);
    // Três variantes de 50.000 L com o mesmo diâmetro e alturas diferentes.
    expect(wet.variants.filter((v) => v.capacityL === 50000).map((v) => v.height)).toEqual([
      10.1, 12, 12.8,
    ]);

    const dry = family('tramec-taca-sem-agua');
    expect(row(dry, 0)).toEqual([2000, 5.7, 1.18, 3.6]);
    expect(row(dry, 8)).toEqual([5000, 8.7, 1.6, 6]);
    expect(row(dry, 10)).toEqual([10000, 8.3, 1.91, 4.8]);
    expect(row(dry, 23)).toEqual([25000, 11.4, 2.55, 6]);
    expect(row(dry, 33)).toEqual([60000, 15, 3.2, 7.2]);
    // Regra da tabela: cada capacidade em três colunas (3,60 / 4,80 / 6,00), exceto 60.000 L,
    // e a altura total cresce exatamente o que a coluna cresce.
    for (let i = 0; i < 33; i += 3) {
      const [a, b, c] = [dry.variants[i], dry.variants[i + 1], dry.variants[i + 2]];
      expect([a?.columnHeight, b?.columnHeight, c?.columnHeight]).toEqual([3.6, 4.8, 6]);
      expect(new Set([a?.capacityL, b?.capacityL, c?.capacityL]).size).toBe(1);
      expect((b?.height ?? 0) - (a?.height ?? 0)).toBeCloseTo(1.2, 9);
      expect((c?.height ?? 0) - (b?.height ?? 0)).toBeCloseTo(1.2, 9);
    }
  });

  it('confere linhas da p. 5 — tubular alto, com os asteriscos impressos', () => {
    const tubular = family('tramec-tubular-alto');
    expect(row(tubular, 0)).toEqual([3000, 6, 0.8, undefined]);
    expect(row(tubular, 6)).toEqual([12500, 7.8, 1.43, undefined]);
    expect(row(tubular, 13)).toEqual([30500, 7.8, 2.23, undefined]);
    expect(row(tubular, 24)).toEqual([100000, 12.6, 3.2, undefined]);
    expect(row(tubular, 29)).toEqual([200000, 18, 3.82, undefined]);
    expect(
      tubular.variants.filter((v) => v.mark === '*').map((v) => [v.capacityL, v.height]),
    ).toEqual([
      [36000, 12.6],
      [40000, 14.4],
      [50000, 13.2],
      [100000, 15.6],
      [120000, 15],
      [150000, 18.6],
      [170000, 15],
      [200000, 18],
    ]);
    // Cilindro simples: a altura total é a do costado (o volume fecha com a capacidade).
    for (const v of tubular.variants) {
      const volume = (Math.PI * v.diameter ** 2 * v.height) / 4;
      expect(Math.abs(volume * 1000 - v.capacityL) / v.capacityL).toBeLessThan(0.08);
    }
  });

  it('confere linhas da p. 6 — vertical apoiado e de fundo cônico com pés', () => {
    const ground = family('tramec-vertical-apoiado');
    const cone = family('tramec-vertical-fundo-conico');
    expect(row(ground, 0)).toEqual([5000, 1.8, 1.91, undefined]);
    expect(row(ground, 6)).toEqual([30000, 4, 3.1, undefined]);
    expect(row(ground, 9)).toEqual([60000, 7.4, 3.2, undefined]);
    expect(row(cone, 0)).toEqual([5000, 2.3, 1.91, undefined]);
    expect(row(cone, 9)).toEqual([60000, 7.9, 3.2, undefined]);
    expect(cone.catalogSupportHeight).toBe(0.5);
    // Mesmas capacidades e diâmetros; o de fundo cônico é 0,50 m mais alto (pés), exceto o
    // de 12.000 L, impresso com 0,40 m de diferença.
    const differences = ground.variants.map((g, i) => {
      const c = cone.variants[i];
      expect([c?.capacityL, c?.diameter]).toEqual([g.capacityL, g.diameter]);
      return Math.round(((c?.height ?? 0) - g.height) * 100) / 100;
    });
    expect(differences).toEqual([0.5, 0.5, 0.4, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
  });

  it('registra as faixas e os valores informados só no texto do catálogo', () => {
    expect(family('tramec-australiano')).toMatchObject({
      capacityRangeL: [4300, 540000],
      catalogHeights: [0.9, 1.72],
    });
    expect(family('tramec-vertical-in-loco').capacityRangeL).toEqual([200000, 10000000]);
    expect(family('tramec-cilindrico-horizontal')).toMatchObject({
      capacityRangeL: [2000, 20000],
      catalogSupportHeight: 0.5,
    });
    expect(family('tramec-tubular-alto').capacityRangeL).toEqual([3000, 200000]);
  });

  it('todo modelo gera parâmetros coerentes, com volume geométrico compatível com o nominal', () => {
    for (const f of TANK_FAMILIES) {
      const selections =
        f.variants.length > 0
          ? f.variants.map((v) => ({ variantId: v.id }))
          : [{ custom: {} as const }];
      for (const selection of selections) {
        const parameters = tankParametersFromFamily(f, selection);
        expect(parameters.ok ? '' : parameters.error.message).toBe('');
        if (!parameters.ok) continue;
        const tank = parameters.value as unknown as Tank;
        expect(tankProblem(tank)).toBeNull();
        expect(tank.manufacturing.manufacturer).toBe('TRAMEC');
        // As dimensões externas tabuladas comportam a capacidade nominal (tolerância larga:
        // a capacidade é nominal e a forma interna é estimada).
        const ratio = tankGeometricVolume(tank) / (tank.nominalCapacity ?? 1);
        expect(ratio, `${f.id} ${JSON.stringify(selection)}`).toBeGreaterThan(0.85);
        expect(ratio, `${f.id} ${JSON.stringify(selection)}`).toBeLessThan(1.3);
      }
    }
  });
});
