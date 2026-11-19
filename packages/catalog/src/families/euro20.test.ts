import { createFamilyCatalog, FittingFamilySchema, type FittingFamily } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { flangeEnd } from '../flanges';
import { BUILTIN_FAMILIES, resolvePipeSpec } from '../index';

const mm = (m: number | undefined): number => Math.round((m ?? NaN) * 1e5) / 100;
const DUCTILE = 'ferro-ductil-nbr7675-k9';

const byId = (id: string): FittingFamily => {
  const found = BUILTIN_FAMILIES.find((f) => f.id === id);
  if (!found) throw new Error(`família ausente: ${id}`);
  return found;
};
/** [DN, comprimento, H1, K, K1] de cada linha. */
const table = (family: FittingFamily): number[][] =>
  family.sizes.map((s) => [s.dn, mm(s.length), mm(s.height), mm(s.bonnetLength), mm(s.width)]);
const flange = (family: FittingFamily, dn: number) => {
  const end = family.sizes.find((s) => s.dn === dn)?.end;
  return [
    mm(end?.outerDiameter),
    mm(end?.length),
    mm(end?.boltCircle),
    end?.boltCount,
    mm(end?.boltHoleDiameter),
  ];
};

describe('válvulas de gaveta EURO 20 (Catálogo Geral, p. 344–348)', () => {
  const euro = BUILTIN_FAMILIES.filter((f) => f.id.startsWith('euro2'));

  it('são gavetas válidas, de fabricante não identificado e com a fonte citada', () => {
    // 5 famílias PN × 2 especificações + ANSI + PBA × 3 classes + bolsas × 2 especificações.
    expect(euro).toHaveLength(16);
    for (const family of euro) {
      expect(FittingFamilySchema.safeParse(family).success, family.id).toBe(true);
      expect(family.kind).toBe('valve');
      expect(family.valveType).toBe('gate');
      expect(family.manufacturer).toBeNull();
      expect(family.source, family.id).toContain('Catálogo Geral');
      expect(family.source, family.id).toMatch(/p\. 34[4-8]/);
      for (const size of family.sizes) {
        // Haste nua: sem volante; castelo sempre com as duas dimensões.
        expect(size.handwheelDiameter).toBeUndefined();
        expect(size.bonnetLength, `${family.id} DN ${size.dn}`).toBeGreaterThan(0);
        expect(size.width, `${family.id} DN ${size.dn}`).toBeGreaterThan(size.bonnetLength ?? 0);
      }
    }
  });

  it('EURO 21 (corpo longo): L, H1 e K × K1 da p. 344', () => {
    expect(table(byId(`euro21-gaveta-longa-pn16@${DUCTILE}`))).toEqual([
      [50, 250, 222, 95, 144],
      [80, 280, 275, 105, 174],
      [100, 300, 323, 111, 194],
      [150, 350, 410, 136, 257],
      [200, 400, 515, 266, 382],
      [250, 450, 595, 285, 470],
      [300, 500, 705, 305, 538],
    ]);
    expect(byId(`euro21-gaveta-longa-pn10@${DUCTILE}`).sizes.map((s) => s.dn)).toEqual([
      200, 250, 300,
    ]);
    expect(table(byId(`euro21-gaveta-longa-pn25@${DUCTILE}`))).toEqual([
      [50, 250, 222, 95, 144],
      [80, 280, 275, 105, 174],
      [100, 300, 323, 111, 194],
      [150, 350, 410, 136, 257],
    ]);
  });

  it('EURO 23 (corpo curto): L, H1 e K × K1 da p. 346, até DN 400', () => {
    expect(table(byId(`euro23-gaveta-curta-pn16@${DUCTILE}`))).toEqual([
      [50, 150, 222, 95, 144],
      [80, 180, 275, 105, 174],
      [100, 190, 323, 111, 194],
      [150, 210, 410, 136, 257],
      [200, 230, 515, 266, 382],
      [250, 250, 595, 285, 470],
      [300, 270, 705, 305, 538],
      [350, 290, 705, 305, 538],
      [400, 310, 914, 348, 686],
    ]);
    expect(byId(`euro23-gaveta-curta-pn10@${DUCTILE}`).sizes.map((s) => s.dn)).toEqual([
      200, 250, 300, 350,
    ]);
  });

  it('flanges PN: o flange inteiro vem da tabela única, na classe da família', () => {
    const classes = { pn16: 'PN 16', pn10: 'PN 10', pn25: 'PN 25' } as const;
    let checked = 0;
    for (const family of euro.filter(
      (f) => f.endType === 'flange' && f.id !== 'euro22-gaveta-ansi',
    )) {
      const key = /-(pn\d+)@/.exec(family.id)?.[1] as keyof typeof classes;
      for (const size of family.sizes) {
        const { type: _type, ...expected } = flangeEnd(classes[key], size.dn) ?? { type: 'flange' };
        expect(size.end, `${family.id} DN ${size.dn}`).toEqual(expected);
        checked += 1;
      }
    }
    expect(checked).toBe(2 * (7 + 3 + 4 + 9 + 4));

    const pn16 = byId(`euro21-gaveta-longa-pn16@${DUCTILE}`);
    const pn10 = byId(`euro21-gaveta-longa-pn10@${DUCTILE}`);
    const pn25 = byId(`euro21-gaveta-longa-pn25@${DUCTILE}`);
    // DN 100: vale a tabela de flanges (220); a página da válvula imprime 225.
    expect(flange(pn16, 100)).toEqual([220, 19, 180, 8, 19]);
    // DN 200: 8 furos em PN 10 e 12 em PN 16.
    expect(flange(pn10, 200)).toEqual([340, 20, 295, 8, 23]);
    expect(flange(pn16, 200)).toEqual([340, 20, 295, 12, 23]);
    expect(flange(pn25, 150)).toEqual([300, 20, 250, 8, 28]);
    // EURO 23 DN 350 e 400: os D e a impressos na página são os do PN 16.
    const short = byId(`euro23-gaveta-curta-pn16@${DUCTILE}`);
    expect(flange(short, 350)).toEqual([520, 26.5, 470, 16, 28]);
    expect(flange(short, 400)).toEqual([580, 28, 525, 16, 31]);
    expect(flange(byId(`euro23-gaveta-curta-pn10@${DUCTILE}`), 350)).toEqual([
      505, 24.5, 460, 16, 23,
    ]);
  });

  it('EURO 22 (ANSI): tabela da p. 345 no aço-carbono, com a furação classe 125', () => {
    const ansi = byId('euro22-gaveta-ansi');
    expect(ansi.specificationId).toBe('aco-carbono-b3610-sch40');
    expect(table(ansi)).toEqual([
      [80, 203, 275, 105, 174],
      [100, 229, 323, 111, 194],
      [150, 267, 410, 136, 257],
      [200, 292, 515, 266, 382],
      [250, 330, 595, 285, 470],
      [300, 356, 705, 305, 538],
    ]);
    expect(flange(ansi, 80)).toEqual([190, 19, 152.4, 4, 19.05]);
    expect(flange(ansi, 100)).toEqual([228, 24, 190.5, 8, 19.05]);
    expect(flange(ansi, 300)).toEqual([486, 24.5, 431.8, 12, 25.4]);
  });

  it('EURO 24 (bolsas PBA): L1 entre os fundos das bolsas e bolsa derivada de L, L1 e h', () => {
    const pba = byId('euro24-gaveta-bolsas-pba@pvc-pba-nbr5647-cl15');
    expect(pba.endType).toBe('socket');
    expect(table(pba)).toEqual([
      [50, 90, 222, 90, 144],
      [75, 122, 275, 105, 174],
      [100, 128, 323, 111, 194],
    ]);
    // Profundidade = (L − L1)/2; Ø externo = 2·h.
    expect(pba.sizes.map((s) => [mm(s.end?.length), mm(s.end?.outerDiameter)])).toEqual([
      [80, 100],
      [69, 130],
      [86, 152],
    ]);
    // A bolsa envolve o tubo de PVC.
    for (const size of pba.sizes) {
      const spec = resolvePipeSpec(pba.specificationId, size.dn);
      expect(spec, `DN ${size.dn}`).toBeDefined();
      expect(size.end?.outerDiameter ?? 0).toBeGreaterThan(spec?.outerDiameter ?? Infinity);
    }
  });

  it('EURO 25 (bolsas para ferro dúctil): Lu, P e D1 da p. 348; Lt = Lu + 2·P', () => {
    const socket = byId(`euro25-gaveta-bolsas-fd@${DUCTILE}`);
    expect(socket.endType).toBe('socket');
    // DN 100: K impresso "11", adotado 111.
    expect(table(socket)).toEqual([
      [80, 128, 289, 105, 174],
      [100, 141, 336, 111, 194],
      [150, 163, 421, 136, 257],
      [200, 170, 510, 182, 352],
      [250, 218, 618, 195, 430],
      [300, 215, 696, 214, 488],
    ]);
    // Lt impresso menos (Lu + 2·P): a tabela não fecha em DN 200 e 300 (17 e 23 mm).
    const lt = [298, 317, 351, 387, 428, 458];
    const excess = [0, 0, 0, 17, 0, 23];
    socket.sizes.forEach((size, i) => {
      expect(lt[i]! - (mm(size.length) + 2 * mm(size.end?.length)), `DN ${size.dn}`).toBeCloseTo(
        excess[i]!,
        6,
      );
      const spec = resolvePipeSpec(DUCTILE, size.dn);
      expect(size.end?.outerDiameter ?? 0).toBeGreaterThan(spec?.outerDiameter ?? Infinity);
    });
    expect(socket.sizes.map((s) => mm(s.end?.outerDiameter))).toEqual([
      141, 161, 212, 294, 351, 371.7,
    ]);
  });

  it('a família escolhida entrega ao elemento as dimensões do castelo e as extremidades', () => {
    const spec = resolvePipeSpec(DUCTILE, 150);
    if (!spec) throw new Error('especificação ausente');
    const dims = createFamilyCatalog(BUILTIN_FAMILIES, {
      valve: `euro21-gaveta-longa-pn16@${DUCTILE}`,
    }).valve(spec, 'gate');
    expect(dims.familyId).toBe(`euro21-gaveta-longa-pn16@${DUCTILE}`);
    expect(dims.length).toBeCloseTo(0.35);
    expect(dims.height).toBeCloseTo(0.41);
    expect(dims.bonnetLength).toBeCloseTo(0.136);
    expect(dims.width).toBeCloseTo(0.257);
    expect(dims.handwheelDiameter).toBeUndefined();
    expect(dims.ends.a?.type).toBe('flange');
    expect(dims.ends.a?.boltCount).toBe(8);
    expect(dims.ends.b).toEqual(dims.ends.a);

    const bolsas = createFamilyCatalog(BUILTIN_FAMILIES, {
      valve: `euro25-gaveta-bolsas-fd@${DUCTILE}`,
    }).valve(spec, 'gate');
    expect(bolsas.length).toBeCloseTo(0.163);
    expect(bolsas.ends.a).toEqual({
      type: 'socket',
      length: expect.closeTo(0.094, 9),
      outerDiameter: expect.closeTo(0.212, 9),
    });
  });
});
