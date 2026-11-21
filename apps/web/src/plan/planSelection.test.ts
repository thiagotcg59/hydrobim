import { createProject, vec3, type Pipe } from '@hydrobim/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { rectOf } from '../editor/crossingSelection';
import { useEditorStore } from '../state/editorStore';
import { outlineOf } from './planDrawing';
import { axisShape, elementsInPlanWindow, outlineShape } from './planSelection';

const state = () => useEditorStore.getState();

/** Trecho em L: tubo (0,0)–(3,0), joelho e tubo até (3,2). */
function drawBend(): { first: Pipe; second: Pipe; elbow: string } {
  state().setTool('pipe');
  state().commitPoint(vec3(0, 0, 0));
  state().commitPoint(vec3(3, 0, 0));
  state().commitPoint(vec3(3, 2, 0));
  state().setTool('select');
  const pipes = state().project.elements.filter((e): e is Pipe => e.kind === 'pipe');
  const elbow = state().project.elements.find((e) => e.kind === 'elbow');
  const [first, second] = pipes;
  if (!first || !second || !elbow) throw new Error('trecho incompleto');
  return { first, second, elbow: elbow.id };
}

beforeEach(() => {
  state().loadProject(createProject('Teste', 'mep'));
});

describe('seleção por janela na planta', () => {
  const mep = (element: Parameters<typeof outlineOf>[0]) =>
    outlineShape(outlineOf(element).outline);

  it('janela (contida): só o que está inteiramente dentro', () => {
    const { first } = drawBend();
    const elements = state().project.elements;
    // Em torno do primeiro tubo (termina no fundo da bolsa do joelho), sem conter o joelho.
    const ids = elementsInPlanWindow(
      elements,
      rectOf({ x: -0.5, y: -0.5 }, { x: first.end.x + 0.001, y: 0.5 }),
      'contain',
      mep,
    );
    expect(ids).toEqual([first.id]);
    // Tudo: os três elementos.
    const all = elementsInPlanWindow(
      elements,
      rectOf({ x: -1, y: -1 }, { x: 4, y: 3 }),
      'contain',
      mep,
    );
    expect(all).toHaveLength(3);
  });

  it('cruzamento: o que a janela toca, mesmo parcialmente', () => {
    const { first, second } = drawBend();
    const elements = state().project.elements;
    // Faixa vertical que corta o primeiro tubo no meio: nada contido, só ele tocado.
    const rect = rectOf({ x: 1, y: -0.5 }, { x: 1.2, y: 0.5 });
    expect(elementsInPlanWindow(elements, rect, 'contain', mep)).toEqual([]);
    expect(elementsInPlanWindow(elements, rect, 'cross', mep)).toEqual([first.id]);
    // Janela pequena no meio do segundo tubo (dentro da máscara, sem conter vértices).
    const inside = rectOf({ x: 2.999, y: 1 }, { x: 3.001, y: 1.002 });
    expect(elementsInPlanWindow(elements, inside, 'cross', mep)).toEqual([second.id]);
  });

  it('Infra: forma pelo eixo e filtro por categoria', () => {
    const { first, elbow } = drawBend();
    const elements = state().project.elements;
    const rect = rectOf({ x: 2.5, y: -0.5 }, { x: 3.5, y: 0.5 });
    const crossed = elementsInPlanWindow(elements, rect, 'cross', axisShape);
    expect(crossed).toContain(first.id);
    expect(crossed).toContain(elbow);
    const onlyElbows = elementsInPlanWindow(elements, rect, 'cross', axisShape, {
      kinds: new Set(['elbow']),
      systemIds: null,
    });
    expect(onlyElbows).toEqual([elbow]);
  });
});
