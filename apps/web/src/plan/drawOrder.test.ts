import { BUILTIN_FAMILIES, resolvePipeSpec } from '@hydrobim/catalog';
import {
  addPipe,
  createFamilyCatalog,
  createProject,
  drawPipe,
  vec3,
  type HydroElement,
  type Project,
  type Vec3,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { planDrawOrder } from './drawOrder';

const spec = resolvePipeSpec('ferro-ductil-nbr7675-k9', 80);

/** Tubo horizontal de (0,0,0) a (2,0,0) e um segundo trecho a partir da ponta, com curva. */
function corner(next: Vec3): Project {
  if (!spec) throw new Error('especificação ausente');
  const a = addPipe(createProject('t', 'infra'), {
    start: vec3(0, 0, 0),
    end: vec3(2, 0, 0),
    spec,
  });
  if (!a.ok) throw new Error(a.error.message);
  const d = drawPipe(a.value.project, {
    fromPort: { elementId: a.value.elementId, portId: 'end' },
    start: vec3(2, 0, 0),
    end: next,
    spec,
    catalog: createFamilyCatalog(BUILTIN_FAMILIES),
  });
  if (!d.ok) throw new Error(d.error.message);
  return d.value.project;
}

/** Cota máxima simples: a maior cota de ponta (tubo) ou da posição (peça). */
const zOf = (element: HydroElement): number =>
  element.kind === 'pipe' ? Math.max(element.start.z, element.end.z) : element.placement.position.z;

const kinds = (project: Project): string[] =>
  planDrawOrder(project.elements, project.connections, zOf).map((element) => element.kind);

describe('planDrawOrder', () => {
  it('desenha a curva depois do tubo inclinado que sobe a partir dela', () => {
    const project = corner(vec3(2, -3, 0.4));
    // Só pela cota, o tubo inclinado (ponta mais alta) viria por cima da bolsa da curva.
    const naive = [...project.elements].sort((p, q) => zOf(p) - zOf(q)).map((e) => e.kind);
    expect(naive.at(-1)).toBe('pipe');
    expect(kinds(project).at(-1)).toBe('elbow');
  });

  it('mantém a prumada que sobe por cima da curva', () => {
    const project = corner(vec3(2, 0, 3));
    expect(kinds(project).at(-1)).toBe('pipe');
  });

  it('não perde nem repete elementos', () => {
    const project = corner(vec3(2, -3, 0));
    const order = planDrawOrder(project.elements, project.connections, zOf);
    expect(order.map((e) => e.id).sort()).toEqual(project.elements.map((e) => e.id).sort());
  });
});
