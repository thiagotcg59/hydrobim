import {
  addPipe,
  catalogViolation,
  createProject,
  deleteElements,
  drawPipe,
  fail,
  ok,
  vec3,
  type PipeSpec,
  type Project,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { diffProjects, previewOf } from './operationPreview';

const spec: PipeSpec = {
  specificationId: 'test',
  material: 'pvc',
  standard: 'Teste',
  jointType: 'solventWeld',
  pressureClass: null,
  dn: 50,
  sizeLabel: 'DN 50',
  outerDiameter: 0.06,
  wallThickness: 0.003,
  innerDiameter: 0.054,
};

function base(): { project: Project; pipeId: string } {
  const created = addPipe(createProject('t'), { start: vec3(0, 0, 0), end: vec3(3, 0, 0), spec });
  if (!created.ok) throw new Error(created.error.message);
  return { project: created.value.project, pipeId: created.value.elementId };
}

describe('prévia real da montagem', () => {
  it('lista o que o traçado com mudança de direção cria e ajusta', () => {
    const { project, pipeId } = base();
    const result = drawPipe(project, {
      fromPort: { elementId: pipeId, portId: 'end' },
      start: vec3(3, 0, 0),
      end: vec3(3, 2, 0),
      spec,
    });
    if (!result.ok) throw new Error(result.error.message);
    const preview = previewOf(project, ok(result.value.project));
    expect(preview.error).toBeNull();
    expect(preview.created.map((e) => e.kind).sort()).toEqual(['elbow', 'pipe']);
    // O tubo existente é aparado para receber o joelho: mesmo identificador, novo comprimento.
    expect(preview.modified.map((e) => e.id)).toEqual([pipeId]);
    expect(preview.connectionsAdded).toBe(2);
    expect(preview.summary).toContain('Cria 1 joelho e 1 tubo');
    expect(preview.summary).toMatch(/ajusta Tubo 1 3,00 m → 2,9\d m/);
    // A prévia não altera o projeto.
    expect(project.elements).toHaveLength(1);
  });

  it('é idêntica ao resultado confirmado: mesmos elementos, mesma contagem', () => {
    const { project, pipeId } = base();
    const input = {
      fromPort: { elementId: pipeId, portId: 'end' },
      start: vec3(3, 0, 0),
      end: vec3(5, 0, 0),
      spec,
    };
    const hovered = drawPipe(project, input);
    const confirmed = drawPipe(project, input);
    if (!hovered.ok || !confirmed.ok) throw new Error('traçado recusado');
    const preview = diffProjects(project, hovered.value.project);
    const applied = diffProjects(project, confirmed.value.project);
    expect(preview.created.map((e) => e.kind)).toEqual(applied.created.map((e) => e.kind));
    expect(preview.summary).toBe(applied.summary);
    expect(preview.summary).toBe('Cria 1 tubo');
  });

  it('mostra a recusa do núcleo antes da confirmação', () => {
    const { project, pipeId } = base();
    const refused = drawPipe(project, {
      fromPort: { elementId: pipeId, portId: 'end' },
      start: vec3(3, 0, 0),
      end: vec3(3, 0.01, 0),
      spec,
    });
    expect(refused.ok).toBe(false);
    const preview = previewOf(
      project,
      refused.ok ? ok(refused.value.project) : fail(refused.error.code, refused.error.message),
    );
    expect(preview.error).toContain('curto demais');
    expect(preview.created).toEqual([]);
    expect(preview.summary).toBe(preview.error);
  });

  it('aplica a mesma política da confirmação (somente peças de catálogo)', () => {
    const { project, pipeId } = base();
    const result = drawPipe(project, {
      fromPort: { elementId: pipeId, portId: 'end' },
      start: vec3(3, 0, 0),
      end: vec3(3, 2, 0),
      spec,
    });
    if (!result.ok) throw new Error(result.error.message);
    // A especificação de teste não tem família: o joelho sairia genérico.
    const preview = previewOf(project, ok(result.value.project), (after) =>
      catalogViolation(project, after),
    );
    expect(preview.error).toContain('peça de dimensões genéricas');
    expect(preview.created).toEqual([]);
  });

  it('descreve remoções e a ausência de alterações', () => {
    const { project, pipeId } = base();
    expect(diffProjects(project, project).summary).toBe('Nada a alterar.');
    const removed = diffProjects(project, deleteElements(project, [pipeId]));
    expect(removed.removedIds).toEqual([pipeId]);
    expect(removed.summary).toBe('Remove 1 elemento');
  });
});
