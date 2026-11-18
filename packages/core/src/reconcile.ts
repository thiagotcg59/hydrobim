import {
  arePortsAligned,
  connectionsOfElement,
  findConnection,
  getElement,
  oppositeRef,
  resolvePort,
} from './connectivity';
import { MIN_PIPE_LENGTH } from './dimensions';
import { putElement, touch } from './internal';
import { add, sub, type Vec3 } from './math';
import { getPort, getPorts, pipeLength } from './ports';
import { fail, ok, type Result } from './result';
import type { Fitting, Pipe, Project } from './schema';

export function translateFitting<T extends Fitting>(fitting: T, delta: Vec3): T {
  return {
    ...fitting,
    placement: { ...fitting.placement, position: add(fitting.placement.position, delta) },
  };
}

export function setPipeEnd(pipe: Pipe, portId: string, point: Vec3): Pipe {
  return portId === 'start' ? { ...pipe, start: point } : { ...pipe, end: point };
}

/**
 * Restabelece o acoplamento geométrico das conexões após a alteração dos elementos
 * `rootIds` (mudança de dimensões, translação etc.):
 *  - tubos vizinhos absorvem a diferença, ajustando a extremidade conectada;
 *  - conexões vizinhas são transladadas rigidamente, propagando o ajuste.
 * Falha (sem alterar nada) quando o acoplamento não puder ser preservado.
 */
export function reconcile(project: Project, rootIds: readonly string[]): Result<Project> {
  let current = project;
  const affected = new Set<string>(rootIds);
  const processed = new Set<string>();
  const fixedFittings = new Set<string>();
  // Conexões primeiro: elas definem as posições; os tubos se ajustam a elas.
  const queue = [...rootIds].sort((a, b) => {
    const ka = getElement(project, a)?.kind === 'pipe' ? 1 : 0;
    const kb = getElement(project, b)?.kind === 'pipe' ? 1 : 0;
    return ka - kb;
  });

  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined || processed.has(id)) continue;
    processed.add(id);
    const element = getElement(current, id);
    if (!element) continue;
    if (element.kind !== 'pipe') fixedFittings.add(id);

    for (const port of getPorts(element)) {
      const connection = findConnection(current, port.ref);
      if (!connection) continue;
      const otherRef = oppositeRef(connection, port.ref);
      const other = getElement(current, otherRef.elementId);
      const otherPort = other ? getPort(other, otherRef.portId) : undefined;
      if (!other || !otherPort) continue;
      if (arePortsAligned(port, otherPort)) continue;
      affected.add(other.id);

      if (other.kind === 'pipe') {
        current = putElement(current, touch(setPipeEnd(other, otherRef.portId, port.position)));
      } else if (element.kind === 'pipe') {
        // O tubo sempre se ajusta à conexão, nunca o contrário.
        const live = getElement(current, id);
        if (live?.kind === 'pipe') {
          current = putElement(
            current,
            touch(setPipeEnd(live, port.ref.portId, otherPort.position)),
          );
        }
      } else {
        if (fixedFittings.has(other.id)) {
          return fail(
            'OVERCONSTRAINED',
            `Não foi possível ajustar "${other.name}": o conjunto de conexões está rigidamente restringido.`,
          );
        }
        const delta = sub(port.position, otherPort.position);
        current = putElement(current, touch(translateFitting(other, delta)));
        queue.push(other.id);
      }
    }
  }

  return verifyCoupling(current, [...affected]);
}

/** Confere que todas as conexões dos elementos indicados permanecem acopladas. */
export function verifyCoupling(project: Project, elementIds: readonly string[]): Result<Project> {
  for (const id of elementIds) {
    const element = getElement(project, id);
    if (!element) continue;
    if (element.kind === 'pipe' && pipeLength(element) < MIN_PIPE_LENGTH) {
      return fail(
        'PIPE_TOO_SHORT',
        `A alteração deixaria "${element.name}" sem comprimento suficiente.`,
      );
    }
    for (const connection of connectionsOfElement(project, id)) {
      const pa = resolvePort(project, connection.a);
      const pb = resolvePort(project, connection.b);
      if (!pa || !pb) continue;
      if (!arePortsAligned(pa, pb)) {
        const other = getElement(
          project,
          connection.a.elementId === id ? connection.b.elementId : connection.a.elementId,
        );
        return fail(
          'COUPLING_BROKEN',
          `A alteração romperia o alinhamento entre "${element.name}" e "${other?.name ?? '?'}". Desconecte os elementos antes de alterar.`,
        );
      }
    }
  }
  return ok(project);
}
