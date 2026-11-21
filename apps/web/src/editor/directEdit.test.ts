import {
  addPipe,
  AXIS_X,
  AXIS_Y,
  AXIS_Z,
  createProject,
  getElement,
  insertInline,
  vec3,
  type Pipe,
  type PipeSpec,
  type Port,
  type Project,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import {
  arrowPreferences,
  chooseSlideDirection,
  contextTargetOf,
  nudgeStep,
  snapStretchLength,
  stretchLengthAt,
} from './directEdit';

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

function linePipe(start = vec3(0, 0, 0), end = vec3(4, 0, 0)): { project: Project; pipe: Pipe } {
  const created = addPipe(createProject('Teste'), { start, end, spec });
  if (!created.ok) throw new Error(created.error.message);
  const pipe = getElement(created.value.project, created.value.elementId);
  if (pipe?.kind !== 'pipe') throw new Error('não é tubo');
  return { project: created.value.project, pipe };
}

describe('setas do teclado', () => {
  const key = (name: string) => arrowPreferences(name, AXIS_X, AXIS_Y, AXIS_Z) ?? [];

  it('move no sentido em que a seta aponta na tela', () => {
    expect(chooseSlideDirection([AXIS_X], key('ArrowRight'))).toEqual(vec3(1, 0, 0));
    expect(chooseSlideDirection([AXIS_X], key('ArrowLeft'))).toEqual(vec3(-1, 0, 0));
    // O eixo do tubo pode estar orientado ao contrário: vale o sentido na tela.
    expect(chooseSlideDirection([vec3(-1, 0, 0)], key('ArrowRight'))).toEqual(vec3(1, 0, 0));
    expect(chooseSlideDirection([AXIS_Y], key('ArrowUp'))).toEqual(vec3(0, 1, 0));
    expect(chooseSlideDirection([AXIS_Y], key('ArrowDown'))).toEqual(vec3(0, -1, 0));
  });

  it('seta perpendicular ao tubo ainda move a peça, pela direção secundária', () => {
    expect(chooseSlideDirection([AXIS_X], key('ArrowUp'))).toEqual(vec3(1, 0, 0));
    expect(chooseSlideDirection([AXIS_Y], key('ArrowLeft'))).toEqual(vec3(0, -1, 0));
    // Tubo vertical visto em planta: direita/cima sobem, esquerda/baixo descem.
    expect(chooseSlideDirection([AXIS_Z], key('ArrowRight'))).toEqual(vec3(0, 0, 1));
    expect(chooseSlideDirection([AXIS_Z], key('ArrowDown'))).toEqual(vec3(0, 0, -1));
  });

  it('entre dois eixos (joelho, tê), escolhe o mais alinhado com a seta', () => {
    expect(chooseSlideDirection([AXIS_X, AXIS_Y], key('ArrowUp'))).toEqual(vec3(0, 1, 0));
    expect(chooseSlideDirection([AXIS_X, AXIS_Y], key('ArrowLeft'))).toEqual(vec3(-1, 0, 0));
    expect(chooseSlideDirection([], key('ArrowUp'))).toBeNull();
    expect(arrowPreferences('Enter', AXIS_X, AXIS_Y, AXIS_Z)).toBeNull();
  });

  it('passo: grade, Shift ×10 e Ctrl ÷10', () => {
    const none = { shiftKey: false, ctrlKey: false, metaKey: false };
    expect(nudgeStep(0.1, none)).toBeCloseTo(0.1);
    expect(nudgeStep(0.1, { ...none, shiftKey: true })).toBeCloseTo(1);
    expect(nudgeStep(0.1, { ...none, ctrlKey: true })).toBeCloseTo(0.01);
  });
});

describe('alça de comprimento', () => {
  it('mede o comprimento a partir da extremidade oposta', () => {
    const { pipe } = linePipe(vec3(1, 0, 0), vec3(4, 0, 0));
    expect(stretchLengthAt(pipe, 'end', vec3(5.2, 3, 0))).toBeCloseTo(4.2);
    expect(stretchLengthAt(pipe, 'start', vec3(0, 0, 0))).toBeCloseTo(4);
  });

  it('tubo paralelo a um eixo: a extremidade cai na grade', () => {
    const { pipe } = linePipe(vec3(0.03, 0, 0), vec3(2.03, 0, 0));
    // Extremidade em x = 0,03 + 2,41 = 2,44 → grade 2,4 → comprimento 2,37.
    expect(snapStretchLength(pipe, 'end', 2.41, 0.1)).toBeCloseTo(2.37);
    expect(snapStretchLength(pipe, 'end', 2.41, 0)).toBeCloseTo(2.41);
  });

  it('tubo inclinado: o comprimento é múltiplo do passo', () => {
    const { pipe } = linePipe(vec3(0, 0, 0), vec3(3, 4, 0));
    expect(snapStretchLength(pipe, 'end', 5.26, 0.1)).toBeCloseTo(5.3);
  });
});

describe('alvo do botão direito', () => {
  const nearest =
    (x: number, y: number, radius: number) =>
    (ports: readonly Port[]): Port | null =>
      ports.find((p) => Math.hypot(p.position.x - x, p.position.y - y) <= radius) ?? null;
  const gapTo = (x: number, y: number) => (port: Port) =>
    Math.hypot(port.position.x - x, port.position.y - y);

  it('extremidade livre de tubo: oferece a porta', () => {
    const { project, pipe } = linePipe();
    expect(contextTargetOf(project, null, nearest(4, 0.05, 0.2), gapTo(4, 0.05))).toEqual({
      elementId: pipe.id,
      port: { elementId: pipe.id, portId: 'end' },
    });
    // Longe das extremidades, sobre o tubo: o menu do elemento (Mover), sem porta.
    expect(contextTargetOf(project, pipe.id, nearest(2, 0, 0.2), gapTo(2, 0))).toEqual({
      elementId: pipe.id,
      port: null,
    });
    // Fora de qualquer elemento, nada.
    expect(contextTargetOf(project, null, nearest(2, 0, 0.2), gapTo(2, 0))).toBeNull();
  });

  it('extremidade já conectada: menu sem ação; corpo de conexão: porta livre mais próxima', () => {
    const { project, pipe } = linePipe();
    const tee = insertInline(project, {
      pipeId: pipe.id,
      distanceFromStart: 2,
      fitting: { kind: 'tee' },
    });
    if (!tee.ok) throw new Error(tee.error.message);
    const first = getElement(tee.value.project, pipe.id);
    if (first?.kind !== 'pipe') throw new Error('não é tubo');
    // Junto à emenda tubo–tê só há portas ocupadas.
    const joint = contextTargetOf(
      tee.value.project,
      null,
      nearest(first.end.x, 0, 0.01),
      gapTo(first.end.x, 0),
    );
    expect(joint?.port).toBeNull();
    // Apontando o corpo do tê, longe de qualquer porta: a derivação livre.
    expect(
      contextTargetOf(tee.value.project, tee.value.elementId, () => null, gapTo(2, 0)),
    ).toEqual({
      elementId: tee.value.elementId,
      port: { elementId: tee.value.elementId, portId: 'branch' },
    });
  });
});
