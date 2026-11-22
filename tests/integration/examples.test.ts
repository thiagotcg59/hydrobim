import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSpecification } from '@hydrobim/catalog';
import { getPorts, parseProject, validateProject } from '@hydrobim/core';
import { buildArchGeometry, buildElementGeometry } from '@hydrobim/geometry';
import { describe, expect, it } from 'vitest';

/**
 * Integração entre pacotes: os projetos de `examples/` devem abrir com o esquema atual,
 * validar sem pendências, usar apenas especificações do catálogo e gerar geometria.
 */

const examplesDir = join(import.meta.dirname, '..', '..', 'examples');
const files = readdirSync(examplesDir).filter((name) => name.endsWith('.json'));

describe('projetos de exemplo', () => {
  it('existe ao menos um exemplo', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s abre, valida e gera geometria', (file) => {
    const parsed = parseProject(readFileSync(join(examplesDir, file), 'utf8'));
    expect(parsed.ok ? '' : parsed.error.message).toBe('');
    if (!parsed.ok) return;
    const project = parsed.value;
    expect(validateProject(project)).toEqual([]);
    expect(project.elements.length).toBeGreaterThan(0);

    for (const element of project.elements) {
      const specification = getSpecification(element.spec.specificationId);
      const size = specification?.sizes.find((s) => s.dn === element.spec.dn);
      expect(size, `${element.name}: especificação fora do catálogo`).toBeDefined();
      expect(element.spec.outerDiameter).toBeCloseTo((size?.outerDiameterMm ?? 0) / 1000, 9);
      // A ventosa é a única peça de uma porta só: fica na derivação de um tê.
      const terminal = element.kind === 'valve' && element.valveType === 'airRelease';
      expect(getPorts(element).length).toBeGreaterThanOrEqual(terminal ? 1 : 2);
      const geometry = buildElementGeometry(element);
      expect(geometry.parts.length).toBeGreaterThan(0);
      for (const part of geometry.parts) {
        expect(part.mesh.positions.every(Number.isFinite)).toBe(true);
      }
    }

    // Arquitetura (quando houver): todo elemento físico gera malha; ambientes, não.
    for (const element of project.architecture.elements) {
      const geometry = buildArchGeometry(project, element);
      if (element.kind === 'space') {
        expect(geometry).toBeNull();
        continue;
      }
      expect(geometry, `${element.name}: sem geometria`).not.toBeNull();
      for (const part of geometry?.parts ?? []) {
        expect(part.mesh.indices.length).toBeGreaterThan(0);
        expect(part.mesh.positions.every(Number.isFinite)).toBe(true);
      }
    }
  });
});
