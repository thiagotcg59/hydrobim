import { connectedPortRef, getElement, jointDeflection, resolvePort } from './connectivity';
import { pipeLength } from './ports';
import type { Pipe, PortRef, Project } from './schema';

/**
 * Tubulação contínua: sequência de tubos ligados diretamente uns aos outros, sem conexão, tê,
 * válvula ou outro acessório entre eles. É o que o usuário enxerga como "um tubo só" — os
 * trechos só existem porque o traçado muda de direção dentro do que a junta ou a curvatura a
 * frio admitem, ou porque foi desenhado em etapas.
 *
 * É DERIVADA do grafo de conexões: nada é persistido, e cada trecho continua sendo um
 * elemento com identificador próprio.
 */

const otherEnd = (portId: string): 'start' | 'end' => (portId === 'start' ? 'end' : 'start');

/** Tubo ligado diretamente à extremidade `portId` de `pipe`, e a porta dele que a recebe. */
function neighbour(project: Project, pipe: Pipe, portId: 'start' | 'end'): PortRef | null {
  const ref = connectedPortRef(project, { elementId: pipe.id, portId });
  if (!ref) return null;
  const other = getElement(project, ref.elementId);
  // Só extremidades de tubo continuam a tubulação; qualquer peça a interrompe.
  if (other?.kind !== 'pipe' || (ref.portId !== 'start' && ref.portId !== 'end')) return null;
  return ref;
}

/** Caminha a partir da extremidade `portId` de `pipe`, devolvendo os tubos seguintes. */
function walk(project: Project, pipe: Pipe, portId: 'start' | 'end', seen: Set<string>): string[] {
  const ids: string[] = [];
  let current = pipe;
  let exit: 'start' | 'end' = portId;
  for (;;) {
    const next = neighbour(project, current, exit);
    if (!next || seen.has(next.elementId)) return ids;
    const element = getElement(project, next.elementId);
    if (element?.kind !== 'pipe') return ids;
    seen.add(element.id);
    ids.push(element.id);
    current = element;
    exit = otherEnd(next.portId);
  }
}

/**
 * Identificadores dos tubos da tubulação contínua que contém `pipeId`, em ordem de percurso
 * de uma extremidade à outra. Devolve `[pipeId]` quando o tubo não tem vizinho direto e `[]`
 * quando o elemento não é um tubo.
 */
export function pipeRunOf(project: Project, pipeId: string): string[] {
  const pipe = getElement(project, pipeId);
  if (pipe?.kind !== 'pipe') return [];
  const seen = new Set<string>([pipe.id]);
  const before = walk(project, pipe, 'start', seen);
  const after = walk(project, pipe, 'end', seen);
  return [...before.reverse(), pipe.id, ...after];
}

export interface PipeRunSummary {
  /** Trechos, na ordem de percurso. */
  readonly pipes: readonly Pipe[];
  /** Soma dos comprimentos dos trechos (m). */
  readonly length: number;
  /** Desvio angular (rad) em cada vértice entre trechos consecutivos. */
  readonly deflections: readonly number[];
  /** Maior desvio (rad) entre os vértices; 0 quando a tubulação é reta. */
  readonly maxDeflection: number;
}

/**
 * Resumo da tubulação contínua formada pelos tubos `ids` (como devolvidos por `pipeRunOf`).
 * `null` quando algum identificador não é um tubo.
 */
export function pipeRunSummary(project: Project, ids: readonly string[]): PipeRunSummary | null {
  const pipes: Pipe[] = [];
  for (const id of ids) {
    const element = getElement(project, id);
    if (element?.kind !== 'pipe') return null;
    pipes.push(element);
  }
  const deflections: number[] = [];
  for (let i = 0; i + 1 < pipes.length; i += 1) {
    const current = pipes[i];
    const next = pipes[i + 1];
    if (!current || !next) continue;
    // A porta do trecho atual que está ligada ao seguinte.
    const joint = (['start', 'end'] as const)
      .map((portId) => ({ elementId: current.id, portId }))
      .find((ref) => connectedPortRef(project, ref)?.elementId === next.id);
    const a = joint ? resolvePort(project, joint) : undefined;
    const peer = joint ? connectedPortRef(project, joint) : undefined;
    const b = peer ? resolvePort(project, peer) : undefined;
    deflections.push(a && b ? jointDeflection(a, b) : 0);
  }
  return {
    pipes,
    length: pipes.reduce((sum, pipe) => sum + pipeLength(pipe), 0),
    deflections,
    maxDeflection: deflections.reduce((max, d) => Math.max(max, d), 0),
  };
}

/** `true` quando `ids` é exatamente uma tubulação contínua de mais de um trecho. */
export function isPipeRun(project: Project, ids: readonly string[]): boolean {
  const [first] = ids;
  if (ids.length < 2 || first === undefined) return false;
  const run = pipeRunOf(project, first);
  return run.length === ids.length && ids.every((id) => run.includes(id));
}
