import { describe, expect, it } from 'vitest';
import { createFamilyCatalog } from './families';
import { vec3 } from './math';
import { addPipe, attachFitting, createProject } from './operations';
import type { FittingFamily } from './schema';
import { parseProject, serializeProject } from './serialization';
import { testSpec } from './testSupport';
import { validateProject } from './validation';

const spec = testSpec(100);
const family: FittingFamily = {
  id: 'gaveta-castelo',
  name: 'Gaveta de castelo retangular',
  kind: 'valve',
  valveType: 'gate',
  specificationId: spec.specificationId,
  endType: 'flange',
  manufacturer: null,
  standard: 'Teste',
  source: 'Teste',
  origin: 'builtin',
  sizes: [
    {
      dn: 100,
      length: 0.3,
      height: 0.323,
      width: 0.194,
      bonnetLength: 0.111,
      end: { length: 0.019, outerDiameter: 0.22 },
    },
  ],
};

function network(catalogFamily: FittingFamily = family) {
  const pipe = addPipe(createProject('Gaveta'), { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec });
  if (!pipe.ok) throw new Error(pipe.error.message);
  const attached = attachFitting(pipe.value.project, {
    target: { elementId: pipe.value.elementId, portId: 'end' },
    fitting: { kind: 'valve', valveType: 'gate' },
    catalog: createFamilyCatalog([catalogFamily]),
  });
  if (!attached.ok) throw new Error(attached.error.message);
  return attached.value.project;
}

describe('dimensões do castelo da válvula de gaveta', () => {
  it('vêm da família para o elemento, sem pendências de validação', () => {
    const project = network();
    const valve = project.elements.find((e) => e.kind === 'valve');
    if (valve?.kind !== 'valve') throw new Error('válvula ausente');
    expect(valve.familyId).toBe('gaveta-castelo');
    expect(valve.length).toBeCloseTo(0.3);
    expect(valve.height).toBeCloseTo(0.323);
    expect(valve.width).toBeCloseTo(0.194);
    expect(valve.bonnetLength).toBeCloseTo(0.111);
    expect(valve.handwheelDiameter).toBeUndefined();
    expect(validateProject(project).filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('ficam ausentes quando a família não as tabula', () => {
    const [size] = family.sizes;
    if (!size) throw new Error('linha ausente');
    const { bonnetLength: _k, width: _w, ...plain } = size;
    const valve = network({ ...family, sizes: [plain] }).elements.find((e) => e.kind === 'valve');
    expect(valve && 'bonnetLength' in valve).toBe(false);
    expect(valve && 'width' in valve).toBe(false);
  });

  it('sobrevivem à gravação e à reabertura; valores inválidos são recusados', () => {
    const project = network();
    const reopened = parseProject(serializeProject(project));
    expect(reopened.ok ? '' : reopened.error.message).toBe('');
    expect(reopened.ok && reopened.value).toEqual(project);

    const document = JSON.parse(serializeProject(project)) as {
      elements: { kind: string; bonnetLength?: number }[];
    };
    const valve = document.elements.find((e) => e.kind === 'valve');
    if (!valve) throw new Error('válvula ausente');
    valve.bonnetLength = -0.1;
    expect(parseProject(JSON.stringify(document)).ok).toBe(false);
  });
});
