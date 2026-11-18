import { BUILTIN_FAMILIES } from '@hydrobim/catalog';
import { createProject, dot, sub, type FamilySize, type FittingFamily } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { catalogDimensions } from './familyDimensions';
import { buildFamilyPreview } from './familyPreview';

const project = createProject('Cotas de catálogo', 'infra');

function dimensionsOf(family: FittingFamily, size: FamilySize) {
  const preview = buildFamilyPreview(project, family, size);
  if (!preview.ok) throw new Error(preview.reason);
  return new Map(catalogDimensions(preview.element).map((d) => [d.key, d]));
}

function find(id: string, dn: number): [FittingFamily, FamilySize] {
  const family = BUILTIN_FAMILIES.find((f) => f.id.startsWith(id));
  const size = family?.sizes.find((s) => s.dn === dn);
  if (!family || !size) throw new Error(`família ${id} DN ${dn} ausente`);
  return [family, size];
}

describe('catalogDimensions', () => {
  it('redutora BERMAD: face a face, altura, largura e flange iguais aos da tabela', () => {
    const [family, size] = find('bermad-720-sigma-en', 100);
    const dims = dimensionsOf(family, size);
    expect(dims.get('length')?.value).toBeCloseTo(0.35, 9);
    expect(dims.get('height')?.value).toBeCloseTo(0.269, 9);
    expect(dims.get('width')?.value).toBeCloseTo(0.255, 9);
    expect(dims.get('end.length')?.value).toBeCloseTo(size.end?.length ?? -1, 9);
    expect(dims.get('end.outerDiameter')?.value).toBeCloseTo(size.end?.outerDiameter ?? -1, 9);
    // A redutora não tem volante.
    expect(dims.has('handwheelDiameter')).toBe(false);
    // A altura parte do eixo e sobe; a face a face corre ao longo do eixo.
    const height = dims.get('height');
    expect(height && sub(height.b, height.a).z).toBeCloseTo(0.269, 9);
  });

  it('não cota dimensões ausentes no catálogo', () => {
    const [family, full] = find('bermad-720-sigma-en', 100);
    const { end: _end, width: _width, ...size } = full;
    const dims = dimensionsOf(family, size);
    expect(dims.has('width')).toBe(false);
    expect(dims.has('end.length')).toBe(false);
    expect(dims.has('end.outerDiameter')).toBe(false);
    expect(dims.has('length')).toBe(true);
  });

  it('todas as linhas do catálogo: valor da cota = valor tabulado, linha fora do trecho medido', () => {
    let checked = 0;
    for (const family of BUILTIN_FAMILIES) {
      for (const size of family.sizes) {
        const preview = buildFamilyPreview(project, family, size);
        if (!preview.ok) continue;
        const label = `${family.id} DN ${size.dn}`;
        for (const d of catalogDimensions(preview.element)) {
          const [group, field] = d.key.split('.');
          const tabulated =
            field && (group === 'end' || group === 'end2')
              ? size[group]?.[field as 'length' | 'outerDiameter']
              : (size[d.key as keyof FamilySize] as number | undefined);
          expect(tabulated, `${label} ${d.key}`).toBeDefined();
          expect(d.value, `${label} ${d.key}`).toBeCloseTo(tabulated ?? -1, 6);
          // A linha de cota é paralela ao trecho medido: o afastamento é perpendicular.
          expect(Math.abs(dot(d.offset, sub(d.b, d.a))), `${label} ${d.key}`).toBeLessThan(1e-9);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(300);
  });
});
