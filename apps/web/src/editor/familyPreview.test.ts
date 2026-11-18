import { BUILTIN_FAMILIES, resolvePipeSpec } from '@hydrobim/catalog';
import { createProject, type FittingFamily } from '@hydrobim/core';
import { buildElementGeometry } from '@hydrobim/geometry';
import { describe, expect, it } from 'vitest';
import { buildFamilyPreview } from './familyPreview';

const project = createProject('Pré-visualização', 'infra');

function builtin(predicate: (family: FittingFamily) => boolean): FittingFamily {
  const family = BUILTIN_FAMILIES.find(predicate);
  if (!family) throw new Error('família de teste ausente do catálogo');
  return family;
}

describe('buildFamilyPreview', () => {
  it('gera peça e geometria para todas as linhas do catálogo embutido', () => {
    let built = 0;
    for (const family of BUILTIN_FAMILIES) {
      for (const size of family.sizes) {
        const preview = buildFamilyPreview(project, family, size);
        const label = `${family.id} DN ${size.dn}${size.dn2 ? `×${size.dn2}` : ''}`;
        // Famílias compartilhadas entre especificações podem tabular DNs que o tubo da
        // especificação não tem; essas linhas não geram peça (nem na inserção).
        const dns = [size.dn, ...(family.kind === 'elbow' ? [] : [size.dn2 ?? size.dn])];
        if (dns.some((d) => !resolvePipeSpec(family.specificationId, d))) {
          expect(preview.ok, label).toBe(false);
          continue;
        }
        if (!preview.ok) throw new Error(`${label}: ${preview.reason}`);
        built += 1;
        expect(preview.element.kind, label).toBe(family.kind);
        expect(preview.element.familyId, label).toBe(family.id);
        expect(preview.element.spec.dn, label).toBe(size.dn);
        const { parts } = buildElementGeometry(preview.element);
        expect(parts.length, label).toBeGreaterThan(0);
        for (const part of parts) {
          expect(part.mesh.positions.every(Number.isFinite), label).toBe(true);
        }
      }
    }
    expect(built).toBeGreaterThan(100);
    // Percorre o catálogo inteiro (centenas de peças): mais tempo que o padrão de 5 s.
  }, 60_000);

  it('usa as dimensões da linha pedida, não as de outra linha do mesmo DN', () => {
    const family = builtin((f) => f.kind === 'valve' && f.sizes.length > 1);
    const size = family.sizes[1];
    if (!size?.length) throw new Error('linha de teste sem comprimento');
    const edited = { ...size, length: size.length * 2 };
    const preview = buildFamilyPreview(project, { ...family, sizes: [size, edited] }, edited);
    expect(preview.ok && preview.element.kind === 'valve' && preview.element.length).toBeCloseTo(
      edited.length,
    );
  });

  it('não mostra modelo genérico quando faltam dimensões ou o DN não existe', () => {
    const family = builtin((f) => f.kind === 'valve');
    const size = family.sizes[0];
    if (!size) throw new Error('família de teste sem linhas');
    const { length: _length, ...incomplete } = size;
    expect(buildFamilyPreview(project, family, incomplete).ok).toBe(false);
    expect(buildFamilyPreview(project, family, { ...size, dn: 7 }).ok).toBe(false);
  });

  it('não muta o projeto', () => {
    const family = builtin((f) => f.kind === 'elbow');
    const size = family.sizes[0];
    if (!size) throw new Error('família de teste sem linhas');
    buildFamilyPreview(project, family, size);
    expect(project.elements).toHaveLength(0);
  });
});
