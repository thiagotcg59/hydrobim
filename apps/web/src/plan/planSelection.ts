import type { PlanOutline } from '@hydrobim/geometry';
import { getPorts, type HydroElement } from '@hydrobim/core';
import {
  passesFilter,
  shapeSelected,
  type Rect2,
  type ScreenShape,
  type SelectionFilter,
  type WindowMode,
} from '../editor/crossingSelection';

/**
 * Forma em planta da projeção do elemento (coordenadas do modelo, em metros): os triângulos
 * da máscara e as linhas visíveis do desenho. É a mesma figura desenhada na planta MEP.
 */
export function outlineShape(outline: PlanOutline): ScreenShape {
  const triangles = outline.fill.length / 6;
  const segments = outline.lines.length / 4;
  const points = new Float64Array(triangles * 6 + segments * 4);
  points.set(outline.fill, 0);
  points.set(outline.lines, triangles * 6);
  const triangleIndex = new Uint32Array(triangles * 3);
  for (let i = 0; i < triangleIndex.length; i += 1) triangleIndex[i] = i;
  const base = triangles * 3;
  const segmentIndex = new Uint32Array(segments * 2);
  for (let i = 0; i < segmentIndex.length; i += 1) segmentIndex[i] = base + i;
  return { points, triangles: triangleIndex, segments: segmentIndex };
}

/**
 * Forma simplificada do Infra (a planta desenha a rede extensa por eixos): o eixo do tubo ou,
 * nas peças e equipamentos, a origem e as portas.
 */
export function axisShape(element: HydroElement): ScreenShape {
  if (element.kind === 'pipe') {
    return {
      points: [element.start.x, element.start.y, element.end.x, element.end.y],
      segments: [0, 1],
    };
  }
  const points = [element.placement.position.x, element.placement.position.y];
  const segments: number[] = [];
  for (const port of getPorts(element)) {
    points.push(port.position.x, port.position.y);
    segments.push(0, points.length / 2 - 1);
  }
  return { points, segments };
}

/**
 * Elementos escolhidos pela janela em planta: inteiramente contidos (`contain`, arrasto para a
 * direita) ou tocados (`cross`, arrasto para a esquerda), respeitando o filtro.
 */
export function elementsInPlanWindow(
  elements: readonly HydroElement[],
  rect: Rect2,
  mode: WindowMode,
  shapeOf: (element: HydroElement) => ScreenShape,
  filter?: SelectionFilter,
): string[] {
  const ids: string[] = [];
  for (const element of elements) {
    if (filter && !passesFilter(element, filter)) continue;
    if (shapeSelected(shapeOf(element), rect, mode)) ids.push(element.id);
  }
  return ids;
}
