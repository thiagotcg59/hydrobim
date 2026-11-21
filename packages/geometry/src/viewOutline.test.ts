import {
  addPipe,
  addView,
  createProject,
  getView,
  isView2d,
  vec3,
  viewClipPlanesOf,
  viewFrameOf,
  type PipeSpec,
  type Project,
  type ProjectView2d,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { buildElementGeometry } from './elements';
import { planOutline } from './plan';
import { viewOutline } from './viewOutline';

/** Especificação fictícia para os testes de projeção: DE = DN + 10 mm. */
function testSpecForGeometry(dn: number): PipeSpec {
  const outerDiameter = (dn + 10) / 1000;
  const wallThickness = outerDiameter * 0.05;
  return {
    specificationId: 'test-spec',
    material: 'pvc',
    standard: 'Norma de teste',
    jointType: 'solventWeld',
    pressureClass: null,
    dn,
    sizeLabel: `DN ${dn}`,
    outerDiameter,
    wallThickness,
    innerDiameter: outerDiameter - 2 * wallThickness,
  };
}

function pipeProject(start = vec3(0, 0, 1), end = vec3(4, 0, 1)): Project {
  const created = addPipe(createProject('Vistas'), { start, end, spec: testSpecForGeometry(100) });
  if (!created.ok) throw new Error(created.error.message);
  return created.value.project;
}

function withView(
  project: Project,
  input: Parameters<typeof addView>[1],
): { project: Project; view: ProjectView2d } {
  const added = addView(project, input);
  if (!added.ok) throw new Error(added.error.message);
  const view = getView(added.value.project, added.value.viewId);
  if (!view || !isView2d(view)) throw new Error('vista 2D esperada');
  return { project: added.value.project, view };
}

const outlineIn = (project: Project, view: ProjectView2d) => {
  const element = project.elements[0];
  if (!element) throw new Error('elemento esperado');
  return viewOutline(
    buildElementGeometry(element),
    viewFrameOf(view),
    viewClipPlanesOf(project, view),
  );
};

describe('projeÃ§Ã£o nas vistas', () => {
  it('a planta sem giro coincide com a projeÃ§Ã£o da planta de trabalho', () => {
    const base = pipeProject();
    const { project, view } = withView(base, { kind: 'plan', levelId: base.levels[0]?.id ?? '' });
    const outline = outlineIn(project, view);
    const element = project.elements[0];
    if (!outline || !element) throw new Error('contorno esperado');
    const reference = planOutline(buildElementGeometry(element));
    expect(outline.minX).toBeCloseTo(reference.minX, 5);
    expect(outline.maxX).toBeCloseTo(reference.maxX, 5);
    expect(outline.minY).toBeCloseTo(reference.minY, 5);
    expect(outline.maxY).toBeCloseTo(reference.maxY, 5);
    expect(outline.lines.length).toBeGreaterThan(0);
  });

  it('a faixa de corte da planta esconde o que estÃ¡ fora dela e corta o que a atravessa', () => {
    // Prumada de 0 a 5 m: a planta do tÃ©rreo (corte a 3 m, fundo a âˆ’0,3 m) mostra sÃ³ a faixa.
    const base = pipeProject(vec3(0, 0, 0), vec3(0, 0, 5));
    const level = base.levels[0]?.id ?? '';
    const { project, view } = withView(base, { kind: 'plan', levelId: level });
    expect(outlineIn(project, view)).not.toBeNull();
    // Faixa inteiramente acima do tubo: nada a desenhar.
    const above = { ...view, cutHeight: 9, depth: 2 } as ProjectView2d;
    expect(outlineIn(project, above)).toBeNull();

    // Tubo inclinado atravessando o plano de corte: a projeÃ§Ã£o termina no corte.
    const sloped = pipeProject(vec3(0, 0, 0), vec3(4, 0, 4));
    const cut = withView(sloped, { kind: 'plan', levelId: sloped.levels[0]?.id ?? '' });
    const low = { ...cut.view, cutHeight: 2, depth: 5 } as ProjectView2d;
    const outline = outlineIn(cut.project, low);
    if (!outline) throw new Error('contorno esperado');
    // O eixo cruza z = 2 em x = 2; com a parede do tubo o corte passa pouco alÃ©m.
    expect(outline.maxX).toBeGreaterThan(1.9);
    expect(outline.maxX).toBeLessThan(2.2);
  });

  it('o corte mostra o tubo em elevaÃ§Ã£o, limitado Ã  linha e ao alcance', () => {
    const base = pipeProject();
    const { project, view } = withView(base, {
      kind: 'section',
      a: { x: 1, y: -1 },
      b: { x: 3, y: -1 },
      side: 1,
      depth: 2,
    });
    const outline = outlineIn(project, view);
    if (!outline) throw new Error('contorno esperado');
    // A linha vai de x = 1 a x = 3: na vista, de 0 a 2 m; a cota do eixo (1 m) vira o Y.
    expect(outline.minX).toBeCloseTo(0, 5);
    expect(outline.maxX).toBeCloseTo(2, 5);
    expect((outline.minY + outline.maxY) / 2).toBeCloseTo(1, 3);
    expect(outline.maxY - outline.minY).toBeCloseTo(0.11, 2);

    // Olhando para o outro lado, o tubo fica atrÃ¡s do observador.
    expect(outlineIn(project, { ...view, side: -1 } as ProjectView2d)).toBeNull();
    // Alcance curto demais para chegar ao tubo (a 1 m da linha).
    expect(outlineIn(project, { ...view, depth: 0.5 } as ProjectView2d)).toBeNull();
  });

  it('a elevaÃ§Ã£o nÃ£o corta e inverte o sentido conforme a fachada', () => {
    const base = pipeProject(vec3(1, 0, 1), vec3(4, 0, 1));
    const south = withView(base, { kind: 'elevation', direction: 'south' });
    const north = withView(base, { kind: 'elevation', direction: 'north' });
    const fromSouth = outlineIn(south.project, south.view);
    const fromNorth = outlineIn(north.project, north.view);
    if (!fromSouth || !fromNorth) throw new Error('contornos esperados');
    expect(fromSouth.minX).toBeCloseTo(1, 5);
    expect(fromSouth.maxX).toBeCloseTo(4, 5);
    expect(fromNorth.minX).toBeCloseTo(-4, 5);
    expect(fromNorth.maxX).toBeCloseTo(-1, 5);
  });

  it('mantÃ©m os milÃ­metros com coordenadas de rede georreferenciada', () => {
    const base = pipeProject(vec3(500000, 7400000, 700), vec3(500004, 7400000, 700));
    const { project, view } = withView(base, { kind: 'elevation', direction: 'south' });
    const outline = outlineIn(project, view);
    if (!outline) throw new Error('contorno esperado');
    expect(outline.maxX - outline.minX).toBeCloseTo(4, 4);
    expect(outline.maxY - outline.minY).toBeCloseTo(0.11, 3);
  });
});
