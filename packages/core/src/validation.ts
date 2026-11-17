import { checkPortCompatibility, getFreePorts, portKey, resolvePort } from './connectivity';
import { MIN_PIPE_LENGTH, POSITION_TOLERANCE } from './dimensions';
import { distance } from './math';
import { pipeLength } from './ports';
import type { PipeSpec, Project } from './schema';

export type Severity = 'error' | 'warning';

export interface ValidationIssue {
  readonly severity: Severity;
  readonly code: string;
  readonly message: string;
  /** Elementos envolvidos (para seleção/realce na interface). */
  readonly elementIds: readonly string[];
}

function specIssues(spec: PipeSpec): string | null {
  if (spec.innerDiameter >= spec.outerDiameter) {
    return 'o diâmetro interno deve ser menor que o externo';
  }
  const expected = spec.outerDiameter - 2 * spec.wallThickness;
  if (Math.abs(expected - spec.innerDiameter) > 1e-6) {
    return 'diâmetro interno incoerente com o diâmetro externo e a espessura de parede';
  }
  return null;
}

/**
 * Validação do projeto. O estado de validação é sempre DERIVADO do modelo (nunca
 * persistido), de modo que não pode ficar desatualizado.
 */
export function validateProject(project: Project): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const names = new Map(project.elements.map((e) => [e.id, e.name]));
  const systemIds = new Set(project.systems.map((s) => s.id));

  const seenIds = new Set<string>();
  for (const element of project.elements) {
    if (seenIds.has(element.id)) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_ID',
        message: `Identificador duplicado: ${element.id}.`,
        elementIds: [element.id],
      });
    }
    seenIds.add(element.id);

    if (!systemIds.has(element.systemId)) {
      issues.push({
        severity: 'error',
        code: 'SYSTEM_NOT_FOUND',
        message: `"${element.name}" referencia um sistema hidráulico inexistente.`,
        elementIds: [element.id],
      });
    }
    if (element.kind === 'pipe' && pipeLength(element) < MIN_PIPE_LENGTH) {
      issues.push({
        severity: 'error',
        code: 'PIPE_TOO_SHORT',
        message: `"${element.name}" não tem comprimento.`,
        elementIds: [element.id],
      });
    }
    const specs = element.kind === 'reducer' ? [element.spec, element.outletSpec] : [element.spec];
    for (const spec of specs) {
      const problem = specIssues(spec);
      if (problem) {
        issues.push({
          severity: 'error',
          code: 'INVALID_SPEC',
          message: `"${element.name}": ${problem}.`,
          elementIds: [element.id],
        });
      }
    }
    if (element.kind === 'reducer' && element.spec.dn === element.outletSpec.dn) {
      issues.push({
        severity: 'warning',
        code: 'REDUCER_SAME_DN',
        message: `"${element.name}" tem o mesmo diâmetro nominal nas duas extremidades.`,
        elementIds: [element.id],
      });
    }
  }

  const usedPorts = new Map<string, string>();
  const seenPairs = new Set<string>();
  for (const connection of project.connections) {
    const ids = [connection.a.elementId, connection.b.elementId];
    const pa = resolvePort(project, connection.a);
    const pb = resolvePort(project, connection.b);
    if (!pa || !pb) {
      issues.push({
        severity: 'error',
        code: 'DANGLING_CONNECTION',
        message: 'Conexão referencia um elemento ou porta inexistente.',
        elementIds: ids.filter((id) => names.has(id)),
      });
      continue;
    }
    if (connection.a.elementId === connection.b.elementId) {
      issues.push({
        severity: 'error',
        code: 'SAME_ELEMENT',
        message: `"${names.get(ids[0] ?? '')}" está conectado a ele mesmo.`,
        elementIds: [connection.a.elementId],
      });
    }
    const pair = [portKey(connection.a), portKey(connection.b)].sort().join('|');
    if (seenPairs.has(pair)) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_CONNECTION',
        message: 'Conexão duplicada entre as mesmas portas.',
        elementIds: ids,
      });
    }
    seenPairs.add(pair);
    for (const ref of [connection.a, connection.b]) {
      const key = portKey(ref);
      if (usedPorts.has(key) && usedPorts.get(key) !== connection.id) {
        issues.push({
          severity: 'error',
          code: 'PORT_OVERUSED',
          message: `Uma porta de "${names.get(ref.elementId)}" participa de mais de uma conexão.`,
          elementIds: [ref.elementId],
        });
      }
      usedPorts.set(key, connection.id);
    }
    for (const problem of checkPortCompatibility(pa, pb)) {
      issues.push({
        severity: 'error',
        code: problem.code,
        message: `"${names.get(ids[0] ?? '')}" ↔ "${names.get(ids[1] ?? '')}": ${problem.message}`,
        elementIds: ids,
      });
    }
  }

  for (const annotation of project.annotations) {
    if (annotation.kind === 'tag' && !names.has(annotation.elementId)) {
      issues.push({
        severity: 'error',
        code: 'DANGLING_ANNOTATION',
        message: 'Há uma etiqueta na planta que referencia um elemento inexistente.',
        elementIds: [],
      });
    }
  }

  // Terminais livres coincidentes: provável conexão esquecida ou incompatível.
  const free = getFreePorts(project);
  for (let i = 0; i < free.length; i += 1) {
    for (let j = i + 1; j < free.length; j += 1) {
      const a = free[i];
      const b = free[j];
      if (!a || !b || a.ref.elementId === b.ref.elementId) continue;
      if (distance(a.position, b.position) > POSITION_TOLERANCE) continue;
      const reason = checkPortCompatibility(a, b)[0];
      issues.push({
        severity: 'warning',
        code: 'COINCIDENT_UNCONNECTED',
        message: `"${names.get(a.ref.elementId)}" e "${names.get(b.ref.elementId)}" têm extremidades coincidentes sem conexão${reason ? `: ${reason.message}` : '.'}`,
        elementIds: [a.ref.elementId, b.ref.elementId],
      });
    }
  }

  return issues;
}
