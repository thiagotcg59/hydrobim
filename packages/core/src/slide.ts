import { connectedPortRef, getElement, isPortFree } from './connectivity';
import { ANGLE_TOLERANCE, MIN_PIPE_LENGTH } from './dimensions';
import { putElement, touch } from './internal';
import { add, angleBetween, isFiniteVec, length, normalize, scale, sub, type Vec3 } from './math';
import { elementElevation, setPipeEndpoint, translateElements } from './operations';
import { getPorts, pipeLength } from './ports';
import { setPipeEnd, verifyCoupling } from './reconcile';
import { fail, ok, type Result } from './result';
import type { Pipe, Project } from './schema';

/**
 * Edição direta do traçado: esticar ou encolher um tubo e deslizar peças ao longo da linha.
 * As duas operações seguem a mesma regra física: o que está acoplado se move rigidamente
 * junto, até um tubo paralelo ao deslocamento, que absorve a diferença mudando de comprimento.
 */

const isParallel = (a: Vec3, b: Vec3): boolean => {
  const angle = angleBetween(a, b);
  return angle <= ANGLE_TOLERANCE || angle >= Math.PI - ANGLE_TOLERANCE;
};

const pipeAxis = (pipe: Pipe): Vec3 => normalize(sub(pipe.end, pipe.start));

/**
 * Eixos (unitários) ao longo dos quais o elemento pode deslizar: o eixo do próprio tubo ou,
 * nas conexões e equipamentos, as direções das portas conectadas (das portas todas, quando
 * nenhuma está conectada). Direções opostas contam como um único eixo.
 */
export function slideAxesOf(project: Project, id: string): Vec3[] {
  const element = getElement(project, id);
  if (!element) return [];
  if (element.kind === 'pipe') return pipeLength(element) > 0 ? [pipeAxis(element)] : [];
  const ports = getPorts(element);
  const connected = ports.filter((port) => !isPortFree(project, port.ref));
  const axes: Vec3[] = [];
  for (const port of connected.length > 0 ? connected : ports) {
    if (!axes.some((axis) => isParallel(axis, port.direction))) axes.push(port.direction);
  }
  return axes;
}

/**
 * Conjunto que se desloca rigidamente com `ids`: a partir de cada elemento, tudo o que está
 * acoplado vem junto, exceto os tubos paralelos ao deslocamento, que absorvem a diferença.
 */
function rigidSet(project: Project, ids: readonly string[], delta: Vec3): string[] {
  const moved = new Set<string>(ids);
  const queue = [...ids];
  while (queue.length > 0) {
    const id = queue.shift();
    const element = id === undefined ? undefined : getElement(project, id);
    if (!element) continue;
    for (const port of getPorts(element)) {
      const otherRef = connectedPortRef(project, port.ref);
      const other = otherRef ? getElement(project, otherRef.elementId) : undefined;
      if (!other || moved.has(other.id)) continue;
      if (other.kind === 'pipe' && isParallel(pipeAxis(other), delta)) continue;
      moved.add(other.id);
      queue.push(other.id);
    }
  }
  return [...moved];
}

/** Tubos alterados precisam manter comprimento para os seus flanges (tubo com flanges). */
function checkPipeLengths(before: Project, after: Project): Result<Project> {
  for (const element of after.elements) {
    if (element.kind !== 'pipe' || getElement(before, element.id) === element) continue;
    const flanges = Object.values(element.ends ?? {}).reduce((sum, end) => sum + end.length, 0);
    if (pipeLength(element) < flanges + MIN_PIPE_LENGTH) {
      return fail(
        'NO_ROOM',
        `Não há espaço para o deslocamento: "${element.name}" ficaria curto demais.`,
      );
    }
  }
  return ok(after);
}

/** Um tubo vizinho que não consegue absorver o deslocamento é falta de espaço na linha. */
function asNoRoom(result: Result<Project>): Result<Project> {
  if (result.ok) return result;
  const { code } = result.error;
  return code === 'PIPE_TOO_SHORT' || code === 'COUPLING_BROKEN'
    ? fail('NO_ROOM', 'Não há espaço para o deslocamento: um tubo vizinho ficaria sem comprimento.')
    : result;
}

/**
 * Desliza elementos por `delta`. Os tubos paralelos ao deslocamento que encostam no conjunto
 * esticam ou encolhem; todo o resto que está acoplado é transladado junto. Falha (sem
 * alterar nada) quando um tubo vizinho ficaria sem comprimento.
 */
export function slideElements(
  project: Project,
  ids: readonly string[],
  delta: Vec3,
): Result<Project> {
  if (!isFiniteVec(delta)) return fail('INVALID_POINT', 'Deslocamento inválido.');
  if (ids.length === 0) return fail('ELEMENT_NOT_FOUND', 'Nenhum elemento selecionado.');
  if (ids.some((id) => !getElement(project, id))) {
    return fail('ELEMENT_NOT_FOUND', 'Elemento inexistente.');
  }
  if (length(delta) < 1e-9) return ok(project);
  const moved = asNoRoom(translateElements(project, rigidSet(project, ids, delta), delta));
  return moved.ok ? checkPipeLengths(project, moved.value) : moved;
}

/**
 * Define a elevação do elemento (ver `elementElevation`).
 *  - Tubo ou conexão: é um deslizamento na vertical (`slideElements`). Os tubos verticais
 *    ligados ao conjunto esticam ou encolhem, com a OUTRA extremidade fixa; o que está
 *    acoplado sem um tubo vertical no caminho sobe ou desce junto, preservando declividades e
 *    acoplamentos. Sem tubo vertical que absorva, toda a rede conectada se desloca. Recusa
 *    (`NO_ROOM`) quando um tubo vertical ficaria sem comprimento.
 *  - Equipamento (bomba, reservatório): só ele é deslocado; os tubos vizinhos se ajustam
 *    quando o acoplamento permite (ex.: prumada sob o bocal), senão a operação é recusada.
 */
export function setElementElevation(
  project: Project,
  id: string,
  elevation: number,
): Result<Project> {
  const element = getElement(project, id);
  if (!element) return fail('ELEMENT_NOT_FOUND', 'Elemento inexistente.');
  if (!Number.isFinite(elevation)) return fail('INVALID_VALUE', 'Elevação inválida.');
  const dz = elevation - elementElevation(element);
  if (Math.abs(dz) < 1e-9) return ok(project);
  const delta = { x: 0, y: 0, z: dz };
  return element.kind === 'pump' || element.kind === 'tank'
    ? translateElements(project, [id], delta)
    : slideElements(project, [id], delta);
}

/**
 * Elementos que mudam de cota junto com `id` ao alterar a elevação dele (ele incluído): o
 * conjunto acoplado até os tubos verticais, que absorvem a diferença.
 */
export function elevationFollowers(project: Project, id: string): string[] {
  const element = getElement(project, id);
  if (!element) return [];
  return element.kind === 'pump' || element.kind === 'tank'
    ? [id]
    : rigidSet(project, [id], { x: 0, y: 0, z: 1 });
}

/**
 * Estica ou encolhe o tubo para `newLength`, movendo a extremidade `which` ao longo do eixo
 * (a outra fica onde está):
 *  - extremidade livre: só o tubo muda;
 *  - ligada a outro tubo alinhado: a emenda se desloca e o vizinho compensa;
 *  - ligada a uma conexão ou equipamento: a peça desliza junto (ver `slideElements`).
 */
export function stretchPipe(
  project: Project,
  pipeId: string,
  which: 'start' | 'end',
  newLength: number,
): Result<Project> {
  const pipe = getElement(project, pipeId);
  if (!pipe || pipe.kind !== 'pipe') return fail('NOT_A_PIPE', 'Elemento não é um tubo.');
  if (!Number.isFinite(newLength) || newLength < MIN_PIPE_LENGTH) {
    return fail('INVALID_LENGTH', 'Comprimento inválido.');
  }
  const fixed = which === 'end' ? pipe.start : pipe.end;
  const moving = which === 'end' ? pipe.end : pipe.start;
  const target = add(fixed, scale(normalize(sub(moving, fixed)), newLength));
  const delta = sub(target, moving);
  if (length(delta) < 1e-9) return ok(project);

  const neighbourRef = connectedPortRef(project, { elementId: pipeId, portId: which });
  const neighbour = neighbourRef ? getElement(project, neighbourRef.elementId) : undefined;
  let result: Result<Project>;
  if (!neighbourRef || !neighbour) {
    result = setPipeEndpoint(project, pipeId, which, target);
  } else if (neighbour.kind === 'pipe') {
    const next = putElement(
      putElement(project, touch(setPipeEnd(pipe, which, target))),
      touch(setPipeEnd(neighbour, neighbourRef.portId, target)),
    );
    result = asNoRoom(verifyCoupling(next, [pipeId, neighbour.id]));
  } else {
    result = slideElements(project, [neighbour.id], delta);
  }
  return result.ok ? checkPipeLengths(project, result.value) : result;
}
