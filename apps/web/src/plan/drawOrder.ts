import type { Connection, HydroElement } from '@hydrobim/core';

/**
 * Ordem de desenho da planta (algoritmo do pintor).
 *
 * A base é a cota de cada elemento (`zOf`), do mais baixo ao mais alto. Mas a cota máxima
 * de um tubo inclinado fica na outra ponta: só por ela, o tubo que entra numa bolsa pode
 * acabar desenhado por cima da peça e parecer atravessá-la. Como o tubo termina no fundo da
 * bolsa (a ponta fica dentro da peça), toda peça é desenhada depois dos tubos ligados a ela.
 * Exceção: o tubo quase vertical (prumada), cuja projeção é um círculo sobre a peça — esse
 * continua só pela cota (a prumada que sobe cobre a peça; a que desce fica por baixo).
 */
export function planDrawOrder(
  elements: readonly HydroElement[],
  connections: readonly Connection[],
  zOf: (element: HydroElement) => number,
): HydroElement[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  /** Tubos (não verticais) que precisam vir antes de cada peça. */
  const before = new Map<string, Set<string>>();
  const link = (fittingId: string, pipeId: string): void => {
    const fitting = byId.get(fittingId);
    const pipe = byId.get(pipeId);
    if (!fitting || fitting.kind === 'pipe' || pipe?.kind !== 'pipe') return;
    const run = Math.hypot(pipe.end.x - pipe.start.x, pipe.end.y - pipe.start.y);
    if (run <= pipe.spec.outerDiameter) return;
    const set = before.get(fittingId) ?? new Set<string>();
    set.add(pipeId);
    before.set(fittingId, set);
  };
  for (const { a, b } of connections) {
    link(a.elementId, b.elementId);
    link(b.elementId, a.elementId);
  }

  const sorted = elements
    .map((element, index) => ({ element, index, z: zOf(element) }))
    .sort((p, q) => p.z - q.z || p.index - q.index)
    .map((entry) => entry.element);

  const out: HydroElement[] = [];
  const drawn = new Set<string>();
  /** Peças à espera de algum tubo ligado, na ordem em que apareceram. */
  let waiting: HydroElement[] = [];
  const ready = (element: HydroElement): boolean =>
    [...(before.get(element.id) ?? [])].every((id) => drawn.has(id));
  const emit = (element: HydroElement): void => {
    out.push(element);
    drawn.add(element.id);
    if (element.kind !== 'pipe' || waiting.length === 0) return;
    const still: HydroElement[] = [];
    for (const fitting of waiting) {
      if (ready(fitting)) {
        out.push(fitting);
        drawn.add(fitting.id);
      } else {
        still.push(fitting);
      }
    }
    waiting = still;
  };
  for (const element of sorted) {
    if (ready(element)) emit(element);
    else waiting.push(element);
  }
  // Só sobra algo se um tubo ligado não estiver na lista (ex.: oculto): desenha assim mesmo.
  for (const element of waiting) out.push(element);
  return out;
}
