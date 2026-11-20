import {
  addPipe,
  attachFitting,
  createFamilyCatalog,
  createProject,
  vec3,
  type FittingFamily,
  type PipeSpec,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { buildElementGeometry } from './elements';

// Ferro dúctil DN 150 e flange PN 10 (valores do catálogo embutido).
const spec: PipeSpec = {
  specificationId: 'fofo',
  material: 'ductileIron',
  standard: 'ABNT NBR 7675',
  jointType: 'flanged',
  pressureClass: 'K9',
  dn: 150,
  sizeLabel: 'DN 150',
  outerDiameter: 0.17,
  wallThickness: 0.006,
  innerDiameter: 0.158,
};
const flange = {
  length: 0.019,
  outerDiameter: 0.285,
  boltCircle: 0.24,
  boltCount: 8,
  boltHoleDiameter: 0.023,
};

function meterParts(size: FittingFamily['sizes'][number]) {
  const family: FittingFamily = {
    id: 'medidor',
    name: 'Medidor',
    kind: 'valve',
    valveType: 'flowMeter',
    specificationId: spec.specificationId,
    endType: 'flange',
    manufacturer: null,
    standard: 'Teste',
    source: 'Teste',
    origin: 'builtin',
    sizes: [size],
  };
  const pipe = addPipe(createProject('g'), { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec });
  if (!pipe.ok) throw new Error(pipe.error.message);
  const attached = attachFitting(pipe.value.project, {
    target: { elementId: pipe.value.elementId, portId: 'end' },
    fitting: { kind: 'valve', valveType: 'flowMeter' },
    catalog: createFamilyCatalog([family]),
  });
  if (!attached.ok) throw new Error(attached.error.message);
  const element = attached.value.project.elements.find((e) => e.kind === 'valve')!;
  return buildElementGeometry(element).parts;
}

/** Extensão das malhas no referencial local: [mín., máx.] por eixo. */
function bounds(parts: ReturnType<typeof meterParts>) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const p = part.mesh.positions;
    for (let i = 0; i < p.length; i += 1) {
      const axis = i % 3;
      min[axis] = Math.min(min[axis]!, p[i]!);
      max[axis] = Math.max(max[axis]!, p[i]!);
    }
  }
  return { min, max };
}

describe('medidor de vazão eletromagnético', () => {
  // Sanecom DN 150: H = 300 mm, L − D/2 = 292,5 mm.
  const parts = meterParts({ dn: 150, length: 0.3, height: 0.2925, end: flange });

  it('respeita o face a face, o flange e a altura do eixo ao topo do catálogo', () => {
    const { min, max } = bounds(parts);
    expect(max[0]! - min[0]!).toBeCloseTo(0.3, 6);
    expect(max[2]!).toBeCloseTo(0.2925, 6);
    // Para baixo e para os lados, nada passa do flange.
    expect(min[2]!).toBeCloseTo(-flange.outerDiameter / 2, 3);
    expect(max[1]!).toBeCloseTo(flange.outerDiameter / 2, 3);
    expect(min[1]!).toBeCloseTo(-flange.outerDiameter / 2, 3);
  });

  it('tem carretel e carcaça pintados e a caixa de ligação à parte', () => {
    const roles = new Set(parts.map((part) => part.role));
    expect(roles.has('coated')).toBe(true);
    expect(roles.has('trim')).toBe(true);
    // O corpo genérico de válvula (sem pintura) não aparece.
    expect(roles.has('body')).toBe(false);
    for (const part of parts) {
      expect(Array.from(part.mesh.positions).every(Number.isFinite)).toBe(true);
      expect(part.mesh.indices.length % 3).toBe(0);
    }
  });

  it('sem altura de catálogo, o cabeçote continua acima da carcaça', () => {
    const generic = meterParts({ dn: 150, length: 0.3, end: flange });
    expect(bounds(generic).max[2]!).toBeGreaterThan(flange.outerDiameter * 0.41);
  });
});
