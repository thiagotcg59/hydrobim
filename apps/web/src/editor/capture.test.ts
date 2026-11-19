import {
  addPipe,
  addSystem,
  createProject,
  getFreePorts,
  setElementsSystem,
  updateSystem,
  vec3,
  type PipeSpec,
  type Project,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { describeSnap } from './snapLabel';
import { visibleElementsOf, visibleFreePortsOf } from './visibility';

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

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** Dois tubos soltos, o segundo em um sistema próprio. */
function twoSystems(): { project: Project; hiddenPipeId: string; systemId: string } {
  let project = createProject('t');
  project = unwrap(addPipe(project, { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec })).project;
  const second = unwrap(addPipe(project, { start: vec3(0, 1, 0), end: vec3(2, 1, 0), spec }));
  project = unwrap(addSystem(second.project, 'Incêndio', 'fireProtection'));
  const systemId = project.systems.at(-1)?.id ?? '';
  project = unwrap(setElementsSystem(project, [second.elementId], systemId));
  return { project, hiddenPipeId: second.elementId, systemId };
}

describe('filtro de visibilidade da captura', () => {
  it('não oferece portas nem elementos de sistemas ocultos', () => {
    const { project, hiddenPipeId, systemId } = twoSystems();
    expect(visibleFreePortsOf(project)).toHaveLength(4);
    const hidden = unwrap(updateSystem(project, systemId, { visible: false }));
    expect(visibleElementsOf(hidden).map((e) => e.id)).not.toContain(hiddenPipeId);
    const ports = visibleFreePortsOf(hidden);
    expect(ports).toHaveLength(2);
    expect(ports.every((port) => port.ref.elementId !== hiddenPipeId)).toBe(true);
    // O grafo não muda: a porta continua livre, só não é alvo do cursor.
    expect(getFreePorts(hidden)).toHaveLength(4);
  });
});

describe('describeSnap', () => {
  const { project } = twoSystems();
  const pipe = project.elements[0];
  if (!pipe) throw new Error('sem tubo');

  it('identifica tipo, elemento, porta e cota da extremidade capturada', () => {
    const label = describeSnap(project, {
      snap: 'port',
      point: vec3(2, 0, 0),
      port: { elementId: pipe.id, portId: 'end' },
    });
    expect(label).toContain('Extremidade livre');
    expect(label).toContain(pipe.name);
    expect(label).toContain('Z 0,00 m');
  });

  it('informa o empilhamento e o tubo do tê automático', () => {
    expect(
      describeSnap(project, {
        snap: 'port',
        point: vec3(2, 0, 0),
        port: { elementId: pipe.id, portId: 'end' },
        stacked: 2,
      }),
    ).toContain('2 sobrepostas — Tab alterna');
    const onPipe = describeSnap(project, {
      snap: 'pipe',
      point: vec3(1, 0, 0),
      port: null,
      elementId: pipe.id,
    });
    expect(onPipe).toBe(`Tê automático no tubo · ${pipe.name} · Z 0,00 m`);
  });

  it('em ponto livre mostra só o tipo de captura', () => {
    expect(describeSnap(project, { snap: 'grid', point: vec3(1, 1, 0), port: null })).toBe('Grade');
  });
});
