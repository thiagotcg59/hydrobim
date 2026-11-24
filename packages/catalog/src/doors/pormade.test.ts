import { addArchType, createProject, validateProject } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import {
  archTypeFromFamily,
  DOOR_CORE_KEY,
  DOOR_FINISH_KEY,
  doorTypeFromProduct,
  getArchFamily,
  listArchFamilies,
} from '../architecture';
import { PORMADE_DOOR_FAMILIES } from './pormade';

const family = (id: string) => {
  const found = getArchFamily(id);
  if (!found) throw new Error(`família ausente: ${id}`);
  return found;
};

describe('portas Pormade (linhas Lisa e Frizzatta)', () => {
  it('entram no catálogo de arquitetura como produto com fonte e páginas', () => {
    expect(PORMADE_DOOR_FAMILIES.map((entry) => entry.id)).toEqual([
      'arq-porta-pormade-lisa',
      'arq-porta-pormade-frizzatta-fri-001',
      'arq-porta-pormade-frizzatta-fri-002',
      'arq-porta-pormade-frizzatta-fri-003',
      'arq-porta-pormade-frizzatta-fri-004',
    ]);
    for (const entry of PORMADE_DOOR_FAMILIES) {
      expect(listArchFamilies('door')).toContain(entry);
      expect(entry.generic, entry.id).toBe(false);
      expect(entry.source, entry.id).toMatch(/Pormade.*Catálogo de Produtos.*p\. \d+ e 26/);
      expect(entry.product?.manufacturer).toBe('Pormade');
    }
  });

  it('medidas da p. 26: porta 60/70/80/90 × 210 em vão 68/78/88/98 × 215, folha de 35 mm', () => {
    const { product } = family('arq-porta-pormade-lisa');
    expect(
      product?.sizes.map((size) => [size.leafWidth, size.width, size.leafHeight, size.height]),
    ).toEqual([
      [0.6, 0.68, 2.1, 2.15],
      [0.7, 0.78, 2.1, 2.15],
      [0.8, 0.88, 2.1, 2.15],
      [0.9, 0.98, 2.1, 2.15],
    ]);
    expect(product?.panelThickness).toBe(0.035);
    expect(product?.leaf).toBeUndefined();
  });

  it('frisos da Frizzatta: 16 mm, quantidade por modelo e posição declarada esquemática', () => {
    const count = (number: string) => {
      const leaf = family(`arq-porta-pormade-frizzatta-fri-${number}`).product?.leaf;
      expect(leaf?.friezeWidth).toBe(0.016);
      expect(leaf?.schematic).toBe(true);
      return [
        leaf?.friezes.filter((entry) => entry.orientation === 'horizontal').length,
        leaf?.friezes.filter((entry) => entry.orientation === 'vertical').length,
      ];
    };
    expect(count('001')).toEqual([2, 2]);
    expect(count('002')).toEqual([6, 0]);
    expect(count('003')).toEqual([6, 0]);
    expect(count('004')).toEqual([4, 0]);
    // Igualmente espaçados: quatro frisos dividem a folha em cinco partes.
    expect(
      family('arq-porta-pormade-frizzatta-fri-004').product?.leaf?.friezes.map((f) => f.position),
    ).toEqual([0.2, 0.4, 0.6, 0.8]);
    // O friso curvo do FRI 003 não é representado, e a família o diz.
    expect(family('arq-porta-pormade-frizzatta-fri-003').notes.join(' ')).toMatch(
      /curvo.*NÃO é representado/,
    );
  });

  it('a escolha monta o tipo: vão, marco derivado, fabricante, acabamento e núcleo', () => {
    const type = doorTypeFromProduct(family('arq-porta-pormade-frizzatta-fri-002'), {
      sizeId: '90',
      finishId: 'verniz',
      core: 'Sólido',
    });
    if (!type || type.category !== 'door') throw new Error('tipo de porta esperado');
    expect(type).toMatchObject({
      name: 'Pormade Frizzatta FRI 002 — 90 × 210 cm — Verniz — núcleo sólido',
      generic: false,
      operation: 'singleSwing',
      width: 0.98,
      height: 2.15,
      frameWidth: 0.04,
      panelThickness: 0.035,
      manufacturing: { manufacturer: 'Pormade', model: 'Frizzatta FRI 002' },
      materials: {},
      ifc: { [DOOR_FINISH_KEY]: 'Verniz', [DOOR_CORE_KEY]: 'Sólido' },
    });
    // A folha que resulta do vão e do marco tem a largura do catálogo.
    expect(type.width - 2 * type.frameWidth).toBeCloseTo(0.9, 9);
    expect(type.leaf?.friezes).toHaveLength(6);
  });

  it('núcleo que a fonte não lista para o acabamento fica pendente', () => {
    const lisa = family('arq-porta-pormade-lisa');
    const white = doorTypeFromProduct(lisa, { finishId: 'branco', core: 'Colmeia' });
    expect(white?.ifc).toEqual({ [DOOR_FINISH_KEY]: 'Branco' });
    expect(white?.name).toBe('Pormade Lisa — 80 × 210 cm — Branco');
    expect(doorTypeFromProduct(lisa, { sizeId: '100' })).toBeNull();
    expect(doorTypeFromProduct(lisa, { finishId: 'laca' })).toBeNull();
    expect(doorTypeFromProduct(family('arq-porta-giro-1'), {})).toBeNull();
  });

  it('o tipo entra no projeto e não deixa pendência de validação', () => {
    let project = createProject('Casa', 'architecture');
    for (const entry of PORMADE_DOOR_FAMILIES) {
      const added = addArchType(project, archTypeFromFamily(entry));
      if (!added.ok) throw new Error(added.error.message);
      project = added.value.project;
    }
    expect(project.architecture.types).toHaveLength(5);
    expect(validateProject(project).filter((issue) => issue.severity === 'error')).toEqual([]);
    // O tipo é cópia: mudar a família depois não alcança o projeto.
    const stored = project.architecture.types[1];
    expect(stored?.category === 'door' && stored.leaf).not.toBe(
      family('arq-porta-pormade-frizzatta-fri-001').product?.leaf,
    );
  });
});
