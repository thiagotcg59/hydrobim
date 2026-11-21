import { connectedPortRef, getElement } from './connectivity';
import { ANGLE_TOLERANCE } from './dimensions';
import { angleBetween, isFiniteVec, negate, scale, sub, type Vec3 } from './math';
import { getPorts, pipeLength, type Port } from './ports';
import { fail, ok, type Result } from './result';
import type { PortRef, Project } from './schema';
import { slideElements } from './slide';

/**
 * Cotas de posicionamento de uma peça na linha (válvula, tê, cruzeta, redução, medidor...):
 * a partir de cada extremidade conectada, o comprimento de tubo até o próximo elemento que
 * não é tubo (conexão, acessório, equipamento) ou até a extremidade livre da tubulação.
 *
 * A cota vai de porta a porta — fundo da bolsa ou face do flange, onde as portas ficam — e é
 * portanto o comprimento de tubo a cortar entre as duas peças. É DERIVADA do grafo e da
 * geometria; nada é persistido.
 */

export type ClearanceTarget =
  | { readonly kind: 'element'; readonly elementId: string; readonly portId: string }
  | { readonly kind: 'free'; readonly pipeId: string; readonly portId: 'start' | 'end' };

export interface InlineClearance {
  /** Porta da peça de onde a cota parte. */
  readonly portId: string;
  readonly portLabel: string;
  /** Ponto inicial (porta da peça) e final (porta do próximo elemento ou extremidade livre). */
  readonly from: Vec3;
  readonly to: Vec3;
  /** Pontos do percurso pelo eixo dos tubos, de `from` a `to` (inclui as emendas). */
  readonly path: readonly Vec3[];
  /** Soma dos comprimentos dos tubos percorridos (m). */
  readonly length: number;
  /** `true` quando o percurso é reto e alinhado à porta: a cota pode ser editada deslizando a peça. */
  readonly straight: boolean;
  readonly pipeIds: readonly string[];
  readonly target: ClearanceTarget;
}

const isAligned = (a: Vec3, b: Vec3): boolean => angleBetween(a, b) <= ANGLE_TOLERANCE;

/** Cota a partir da porta `port` da peça; `null` quando a porta está livre. */
function clearanceFrom(project: Project, port: Port): InlineClearance | null {
  const first = connectedPortRef(project, port.ref);
  if (!first) return null;
  const base = {
    portId: port.ref.portId,
    portLabel: port.label,
    from: port.position,
  };
  const firstElement = getElement(project, first.elementId);
  if (firstElement?.kind !== 'pipe') {
    // Peça encostada diretamente na outra (ex.: válvula flangeada no tê): cota nula.
    return {
      ...base,
      to: port.position,
      path: [port.position],
      length: 0,
      straight: true,
      pipeIds: [],
      target: { kind: 'element', elementId: first.elementId, portId: first.portId },
    };
  }

  const path: Vec3[] = [port.position];
  const pipeIds: string[] = [];
  let total = 0;
  let straight = true;
  let entry: PortRef = { elementId: first.elementId, portId: first.portId };
  const seen = new Set<string>();
  for (;;) {
    const pipe = getElement(project, entry.elementId);
    if (pipe?.kind !== 'pipe' || seen.has(pipe.id)) break;
    seen.add(pipe.id);
    const exit: 'start' | 'end' = entry.portId === 'start' ? 'end' : 'start';
    const exitPoint = pipe[exit];
    const entryPoint = pipe[entry.portId === 'start' ? 'start' : 'end'];
    // A cota é editável só quando todo o percurso segue a direção da porta.
    if (!isAligned(sub(exitPoint, entryPoint), port.direction)) straight = false;
    pipeIds.push(pipe.id);
    total += pipeLength(pipe);
    path.push(exitPoint);
    const next = connectedPortRef(project, { elementId: pipe.id, portId: exit });
    const nextElement = next ? getElement(project, next.elementId) : undefined;
    if (!next || !nextElement) {
      return {
        ...base,
        to: exitPoint,
        path,
        length: total,
        straight,
        pipeIds,
        target: { kind: 'free', pipeId: pipe.id, portId: exit },
      };
    }
    if (nextElement.kind !== 'pipe') {
      return {
        ...base,
        to: exitPoint,
        path,
        length: total,
        straight,
        pipeIds,
        target: { kind: 'element', elementId: next.elementId, portId: next.portId },
      };
    }
    entry = { elementId: next.elementId, portId: next.portId };
  }
  // Ciclo de tubos (não deveria ocorrer num traçado válido): sem cota.
  return null;
}

/**
 * Cotas de cada extremidade conectada de uma peça (não tubo), na ordem das portas. Vazio para
 * tubos, elementos inexistentes ou peças sem nada ligado.
 */
export function inlineClearancesOf(project: Project, elementId: string): InlineClearance[] {
  const element = getElement(project, elementId);
  if (!element || element.kind === 'pipe') return [];
  return getPorts(element)
    .map((port) => clearanceFrom(project, port))
    .filter((clearance): clearance is InlineClearance => clearance !== null);
}

/**
 * Eixo (unitário) em que a peça desliza entre os tubos: o das duas portas opostas e alinhadas
 * (passagem da válvula, do tê, da cruzeta, da redução). `null` quando a peça não tem passagem
 * reta (joelho, reservatório) ou não é uma conexão.
 */
export function inlineAxisOf(project: Project, elementId: string): Vec3 | null {
  const element = getElement(project, elementId);
  if (!element || element.kind === 'pipe') return null;
  const ports = getPorts(element);
  for (const [i, a] of ports.entries()) {
    for (const b of ports.slice(i + 1)) {
      if (isAligned(a.direction, negate(b.direction))) return a.direction;
    }
  }
  return null;
}

/**
 * Desliza a peça ao longo da linha até que a cota da extremidade `portId` valha `value` (m).
 * O tubo daquele lado encolhe ou estica e o do outro lado compensa (ver `slideElements`);
 * nada mais muda de lugar. Recusa cotas em percurso não alinhado (a peça só desliza em linha
 * reta) e falta de espaço na linha.
 */
export function setInlineClearance(
  project: Project,
  elementId: string,
  portId: string,
  value: number,
): Result<Project> {
  if (!Number.isFinite(value) || value < 0) {
    return fail('INVALID_LENGTH', 'Cota inválida: informe um comprimento maior ou igual a zero.');
  }
  const element = getElement(project, elementId);
  if (!element || element.kind === 'pipe') {
    return fail('ELEMENT_NOT_FOUND', 'Selecione uma conexão, válvula ou acessório na linha.');
  }
  const port = getPorts(element).find((candidate) => candidate.ref.portId === portId);
  const clearance = inlineClearancesOf(project, elementId).find((c) => c.portId === portId);
  if (!port || !clearance) {
    return fail('PORT_NOT_CONNECTED', 'Esta extremidade não está ligada a nenhum tubo.');
  }
  if (clearance.pipeIds.length === 0) {
    return fail(
      'NO_PIPE_BETWEEN',
      'A peça está encostada no elemento vizinho: não há tubo entre eles para ajustar.',
    );
  }
  if (!clearance.straight) {
    return fail(
      'CLEARANCE_NOT_STRAIGHT',
      'O tubo deste lado muda de direção: a cota só pode ser ajustada em trecho reto.',
    );
  }
  const axis = inlineAxisOf(project, elementId);
  if (!axis || (!isAligned(axis, port.direction) && !isAligned(axis, negate(port.direction)))) {
    return fail(
      'NOT_INLINE',
      'A peça não tem passagem reta nesta extremidade: não pode deslizar ao longo da linha.',
    );
  }
  // Aumentar a cota afasta a peça do vizinho: desloca contra a direção (para fora) da porta.
  const delta = scale(port.direction, clearance.length - value);
  if (!isFiniteVec(delta)) return fail('INVALID_POINT', 'Deslocamento inválido.');
  if (Math.abs(clearance.length - value) < 1e-9) return ok(project);
  const result = slideElements(project, [elementId], delta);
  if (!result.ok) return result;
  // O deslocamento move a peça; confere que a cota pedida foi de fato obtida (outro elemento
  // rígido no caminho, por exemplo, mudaria o resultado).
  const after = inlineClearancesOf(result.value, elementId).find((c) => c.portId === portId);
  if (!after || Math.abs(after.length - value) > 1e-6) {
    return fail('NO_ROOM', 'Não há espaço para posicionar a peça com essa cota.');
  }
  return result;
}
