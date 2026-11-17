import { ANGLE_TOLERANCE, POSITION_TOLERANCE } from './dimensions';
import { newId } from './ids';
import { angleBetween, distance, negate } from './math';
import { getPort, getPorts, samePortRef, type Port } from './ports';
import { fail, ok, type Result } from './result';
import type { Connection, HydroElement, PortRef, Project } from './schema';

/**
 * Motor de conectividade. Opera apenas sobre o modelo de domínio (elementos + grafo de
 * conexões) e não conhece renderização.
 */

export type CompatibilityCode =
  'DN_MISMATCH' | 'SPEC_MISMATCH' | 'POSITION_MISMATCH' | 'DIRECTION_MISMATCH';

export interface CompatibilityIssue {
  readonly code: CompatibilityCode;
  readonly message: string;
}

export function getElement(project: Project, id: string): HydroElement | undefined {
  return project.elements.find((e) => e.id === id);
}

export function resolvePort(project: Project, ref: PortRef): Port | undefined {
  const element = getElement(project, ref.elementId);
  return element ? getPort(element, ref.portId) : undefined;
}

export function findConnection(project: Project, ref: PortRef): Connection | undefined {
  return project.connections.find((c) => samePortRef(c.a, ref) || samePortRef(c.b, ref));
}

/** Porta do outro lado da conexão, vista a partir de `ref`. */
export function oppositeRef(connection: Connection, ref: PortRef): PortRef {
  return samePortRef(connection.a, ref) ? connection.b : connection.a;
}

export function connectedPortRef(project: Project, ref: PortRef): PortRef | undefined {
  const connection = findConnection(project, ref);
  return connection ? oppositeRef(connection, ref) : undefined;
}

export const isPortFree = (project: Project, ref: PortRef): boolean =>
  findConnection(project, ref) === undefined;

/** Terminais livres: portas sem conexão no grafo. */
export function getFreePorts(project: Project): Port[] {
  const used = new Set<string>();
  for (const c of project.connections) {
    used.add(portKey(c.a));
    used.add(portKey(c.b));
  }
  return project.elements.flatMap((e) => getPorts(e).filter((p) => !used.has(portKey(p.ref))));
}

export const portKey = (ref: PortRef): string => `${ref.elementId}#${ref.portId}`;

export function connectionsOfElement(project: Project, elementId: string): Connection[] {
  return project.connections.filter(
    (c) => c.a.elementId === elementId || c.b.elementId === elementId,
  );
}

/** Verifica se duas portas estão geometricamente acopladas (coincidentes e opostas). */
export function arePortsAligned(a: Port, b: Port): boolean {
  return (
    distance(a.position, b.position) <= POSITION_TOLERANCE &&
    angleBetween(a.direction, negate(b.direction)) <= ANGLE_TOLERANCE
  );
}

/**
 * Compatibilidade dimensional e geométrica entre duas portas.
 * Materiais, normas dimensionais ou DN diferentes NUNCA são considerados compatíveis
 * automaticamente: exigem redução ou peça de transição apropriada.
 */
export function checkPortCompatibility(a: Port, b: Port): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];
  if (a.spec.specificationId !== b.spec.specificationId) {
    issues.push({
      code: 'SPEC_MISMATCH',
      message: `Especificações diferentes (${a.spec.standard} × ${b.spec.standard}): é necessária uma peça de transição.`,
    });
  } else if (a.spec.dn !== b.spec.dn) {
    issues.push({
      code: 'DN_MISMATCH',
      message: `Diâmetros nominais diferentes (${a.spec.sizeLabel} × ${b.spec.sizeLabel}): é necessária uma redução.`,
    });
  }
  if (distance(a.position, b.position) > POSITION_TOLERANCE) {
    issues.push({ code: 'POSITION_MISMATCH', message: 'As portas não estão na mesma posição.' });
  }
  if (angleBetween(a.direction, negate(b.direction)) > ANGLE_TOLERANCE) {
    issues.push({ code: 'DIRECTION_MISMATCH', message: 'As portas não estão alinhadas.' });
  }
  return issues;
}

/** Conecta explicitamente duas portas livres e compatíveis. */
export function connectPorts(project: Project, a: PortRef, b: PortRef): Result<Project> {
  if (a.elementId === b.elementId) {
    return fail('SAME_ELEMENT', 'Não é possível conectar um elemento a ele mesmo.');
  }
  const pa = resolvePort(project, a);
  const pb = resolvePort(project, b);
  if (!pa || !pb) return fail('PORT_NOT_FOUND', 'Porta de conexão inexistente.');
  if (!isPortFree(project, a) || !isPortFree(project, b)) {
    return fail('PORT_OCCUPIED', 'Uma das portas já está conectada.');
  }
  const issues = checkPortCompatibility(pa, pb);
  const first = issues[0];
  if (first) return fail(first.code, first.message);
  return ok({ ...project, connections: [...project.connections, { id: newId(), a, b }] });
}

export function disconnect(project: Project, connectionId: string): Result<Project> {
  if (!project.connections.some((c) => c.id === connectionId)) {
    return fail('CONNECTION_NOT_FOUND', 'Conexão inexistente.');
  }
  return ok({
    ...project,
    connections: project.connections.filter((c) => c.id !== connectionId),
  });
}

/**
 * Conecta as portas livres de `elementId` a portas livres coincidentes e compatíveis de
 * outros elementos. Só há conexão quando o acoplamento é exato (dentro das tolerâncias).
 */
export function autoConnectElement(project: Project, elementId: string): Project {
  const element = getElement(project, elementId);
  if (!element) return project;
  let current = project;
  for (const port of getPorts(element)) {
    if (!isPortFree(current, port.ref)) continue;
    const candidate = getFreePorts(current).find(
      (other) =>
        other.ref.elementId !== elementId && checkPortCompatibility(port, other).length === 0,
    );
    if (!candidate) continue;
    const result = connectPorts(current, port.ref, candidate.ref);
    if (result.ok) current = result.value;
  }
  return current;
}

/** Elementos alcançáveis a partir de `elementId` pelo grafo de conexões (inclui a origem). */
export function connectedComponent(project: Project, elementId: string): string[] {
  const visited = new Set<string>([elementId]);
  const queue = [elementId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const c of connectionsOfElement(project, current)) {
      const other = c.a.elementId === current ? c.b.elementId : c.a.elementId;
      if (!visited.has(other)) {
        visited.add(other);
        queue.push(other);
      }
    }
  }
  return [...visited];
}
