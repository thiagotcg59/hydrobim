import { describe, expect, it } from 'vitest';
import { vec3 } from './math';
import { addPipe, attachFitting, createProject, drawPipe, insertInline } from './operations';
import type { Project } from './schema';
import { parseProject, serializeProject } from './serialization';
import { testSpec } from './testSupport';
import { validateProject } from './validation';

function sample(): Project {
  const spec = testSpec(50);
  const a = addPipe(createProject('Amostra'), { start: vec3(0, 0, 0), end: vec3(4, 0, 0), spec });
  if (!a.ok) throw new Error(a.error.message);
  const b = drawPipe(a.value.project, {
    fromPort: { elementId: a.value.elementId, portId: 'end' },
    start: vec3(0, 0, 0),
    end: vec3(4, 0, 3),
    spec,
  });
  if (!b.ok) throw new Error(b.error.message);
  const tee = insertInline(b.value.project, {
    pipeId: a.value.elementId,
    distanceFromStart: 1,
    fitting: { kind: 'tee' },
  });
  if (!tee.ok) throw new Error(tee.error.message);
  const valve = attachFitting(tee.value.project, {
    target: { elementId: tee.value.elementId, portId: 'branch' },
    fitting: { kind: 'valve' },
  });
  if (!valve.ok) throw new Error(valve.error.message);
  return valve.value.project;
}

describe('serialização', () => {
  it('salva e reabre sem perda de elementos, identificadores ou conexões', () => {
    const project = sample();
    const json = serializeProject(project);
    const reopened = parseProject(json);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.value).toEqual(project);
    expect(reopened.value.elements.map((e) => e.id)).toEqual(project.elements.map((e) => e.id));
    expect(validateProject(reopened.value)).toEqual([]);
  });

  it('recusa documentos inválidos com mensagens claras', () => {
    const codeOf = (json: string) => {
      const r = parseProject(json);
      return r.ok ? 'ok' : r.error.code;
    };
    expect(codeOf('{ nada')).toBe('INVALID_JSON');
    expect(codeOf('[]')).toBe('INVALID_DOCUMENT');
    expect(codeOf('{"format":"outro"}')).toBe('INVALID_FORMAT');

    const project = sample();
    expect(codeOf(JSON.stringify({ ...project, schemaVersion: 99 }))).toBe('NEWER_VERSION');
    expect(codeOf(JSON.stringify({ ...project, elements: [{ kind: 'pipe' }] }))).toBe(
      'SCHEMA_ERROR',
    );
    const dangling = {
      ...project,
      connections: [
        { id: 'x', a: { elementId: 'fantasma', portId: 'a' }, b: project.connections[0]!.b },
      ],
    };
    expect(codeOf(JSON.stringify(dangling))).toBe('DANGLING_CONNECTION');
    const duplicated = { ...project, elements: [...project.elements, project.elements[0]] };
    expect(codeOf(JSON.stringify(duplicated))).toBe('DUPLICATE_ID');
  });
});
