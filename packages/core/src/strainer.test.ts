import { describe, expect, it } from 'vitest';
import { exportEpanet } from './epanet';
import { createFamilyCatalog } from './families';
import { addPipe, attachFitting, createProject } from './operations';
import { vec3 } from './math';
import { computeQuantities } from './quantities';
import type { FittingFamily } from './schema';
import { parseProject, serializeProject } from './serialization';
import { testSpec } from './testSupport';
import { validateProject } from './validation';

const spec = testSpec(100);
const drilling = { boltCircle: 0.1905, boltCount: 8, boltHoleDiameter: 0.01905 };
const family: FittingFamily = {
  id: 'filtro-y',
  name: 'Filtro Y',
  kind: 'valve',
  valveType: 'strainer',
  specificationId: spec.specificationId,
  endType: 'flange',
  manufacturer: null,
  standard: 'Teste',
  source: 'Teste',
  origin: 'builtin',
  sizes: [
    {
      dn: 100,
      length: 0.37,
      height: 0.265,
      end: { length: 0.0239, outerDiameter: 0.2286, ...drilling },
    },
  ],
};

function network() {
  const pipe = addPipe(createProject('Filtro'), { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec });
  if (!pipe.ok) throw new Error(pipe.error.message);
  const attached = attachFitting(pipe.value.project, {
    target: { elementId: pipe.value.elementId, portId: 'end' },
    fitting: { kind: 'valve', valveType: 'strainer' },
    catalog: createFamilyCatalog([family]),
  });
  if (!attached.ok) throw new Error(attached.error.message);
  return attached.value.project;
}

describe('filtro Y', () => {
  it('é inserido com as dimensões e a furação da família, sem pendências de validação', () => {
    const project = network();
    const strainer = project.elements.find((e) => e.kind === 'valve');
    if (strainer?.kind !== 'valve') throw new Error('filtro ausente');
    expect(strainer.name).toBe('Filtro Y 1');
    expect(strainer.valveType).toBe('strainer');
    expect(strainer.familyId).toBe('filtro-y');
    expect(strainer.length).toBeCloseTo(0.37);
    expect(strainer.height).toBeCloseTo(0.265);
    expect(strainer.ends.a).toEqual({
      type: 'flange',
      length: 0.0239,
      outerDiameter: 0.2286,
      ...drilling,
    });
    expect(strainer.ends.b).toEqual(strainer.ends.a);
    expect(validateProject(project).filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('a furação só acompanha extremidades flangeadas', () => {
    const socket = createFamilyCatalog([{ ...family, endType: 'socket' }]).valve(spec, 'strainer');
    expect(socket.ends.a).toEqual({ type: 'socket', length: 0.0239, outerDiameter: 0.2286 });
  });

  it('sobrevive à gravação e à reabertura do projeto', () => {
    const project = network();
    const reopened = parseProject(serializeProject(project));
    expect(reopened.ok ? '' : reopened.error.message).toBe('');
    expect(reopened.ok && reopened.value).toEqual(project);
  });

  it('recusa furação inválida no documento', () => {
    const project = network();
    const document = JSON.parse(serializeProject(project)) as {
      elements: { kind: string; ends?: Record<string, Record<string, unknown>> }[];
    };
    const strainer = document.elements.find((e) => e.kind === 'valve');
    if (!strainer?.ends?.a) throw new Error('filtro ausente');
    strainer.ends.a.boltCount = 2.5;
    expect(parseProject(JSON.stringify(document)).ok).toBe(false);
  });

  it('aparece no quantitativo como filtro e no EPANET como trecho aberto com aviso', () => {
    const project = network();
    const row = computeQuantities(project).find((r) => r.description === 'Filtro Y');
    expect(row?.quantity).toBe(1);
    const { inp, warnings } = exportEpanet(project);
    expect(warnings.some((w) => w.includes('filtro Y'))).toBe(true);
    expect(inp).toContain('Filtro Y 1');
  });
});
