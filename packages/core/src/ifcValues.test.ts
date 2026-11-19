import { describe, expect, it } from 'vitest';
import { addPipe, createProject, setElementIfcValue, setIfcTypeValue } from './operations';
import { SCHEMA_VERSION } from './schema';
import { parseProject, serializeProject } from './serialization';
import type { Result } from './result';
import { testSpec } from './testSupport';
import { validateProject } from './validation';
import { vec3 } from './math';

const KEY = 'Pset_PipeSegmentOccurrence.InteriorRoughnessCoefficient';
const TEST_SPEC = testSpec(50);

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function sample() {
  return unwrap(
    addPipe(createProject('Valores IFC'), {
      spec: TEST_SPEC,
      start: vec3(0, 0, 0),
      end: vec3(2, 0, 0),
    }),
  );
}

describe('valores IFC informados pelo usuário', () => {
  it('guarda e remove o valor da ocorrência sem mutar o projeto nem trocar o id', () => {
    const { project, elementId } = sample();
    const before = structuredClone(project);
    const edited = unwrap(setElementIfcValue(project, elementId, KEY, 0.0001));
    expect(project).toEqual(before);
    const element = edited.elements[0];
    expect(element?.id).toBe(elementId);
    expect(element?.ifc).toEqual({ [KEY]: 0.0001 });
    expect(element?.meta.revision).toBe((project.elements[0]?.meta.revision ?? 0) + 1);
    expect(validateProject(edited)).toEqual([]);
    const cleared = unwrap(setElementIfcValue(edited, elementId, KEY, undefined));
    expect(cleared.elements[0]).not.toHaveProperty('ifc');
    expect(validateProject(cleared)).toEqual([]);
  });

  it('guarda e remove o valor do tipo, mantendo os elementos intactos', () => {
    const { project } = sample();
    const edited = unwrap(setIfcTypeValue(project, 'tipo-a', 'Pset_X.Y', 600000));
    expect(edited.ifcTypes).toEqual({ 'tipo-a': { 'Pset_X.Y': 600000 } });
    expect(edited.elements).toBe(project.elements);
    expect(project.ifcTypes).toEqual({});
    const second = unwrap(setIfcTypeValue(edited, 'tipo-a', 'Pset_X.Z', 'texto'));
    expect(second.ifcTypes['tipo-a']).toEqual({ 'Pset_X.Y': 600000, 'Pset_X.Z': 'texto' });
    const cleared = unwrap(
      setIfcTypeValue(
        unwrap(setIfcTypeValue(second, 'tipo-a', 'Pset_X.Y', undefined)),
        'tipo-a',
        'Pset_X.Z',
        undefined,
      ),
    );
    expect(cleared.ifcTypes).toEqual({});
    expect(validateProject(cleared)).toEqual([]);
  });

  it('recusa elemento inexistente e nomes vazios', () => {
    const { project, elementId } = sample();
    const code = (result: ReturnType<typeof setIfcTypeValue>): string =>
      result.ok ? 'ok' : result.error.code;
    expect(code(setElementIfcValue(project, 'inexistente', KEY, 1))).toBe('ELEMENT_NOT_FOUND');
    expect(code(setElementIfcValue(project, elementId, '  ', 1))).toBe('INVALID_NAME');
    expect(code(setIfcTypeValue(project, '', KEY, 1))).toBe('INVALID_NAME');
  });

  it('persiste os valores e migra projetos do esquema 8', () => {
    const { project, elementId } = sample();
    const edited = unwrap(
      setIfcTypeValue(
        unwrap(setElementIfcValue(project, elementId, KEY, 0.0001)),
        'tipo-a',
        'Pset_X.Y',
        true,
      ),
    );
    const reopened = unwrap(parseProject(serializeProject(edited)));
    expect(reopened.elements[0]?.ifc).toEqual({ [KEY]: 0.0001 });
    expect(reopened.ifcTypes).toEqual({ 'tipo-a': { 'Pset_X.Y': true } });

    const legacy = JSON.parse(serializeProject(project)) as Record<string, unknown>;
    legacy.schemaVersion = 8;
    delete legacy.ifcTypes;
    const migrated = unwrap(parseProject(JSON.stringify(legacy)));
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.ifcTypes).toEqual({});
  });
});
