import { archIntegrityProblem } from './architecture/ops';
import { checkPortCompatibility, getFreePorts, portKey, resolvePort } from './connectivity';
import { MIN_PIPE_LENGTH, POSITION_TOLERANCE } from './dimensions';
import { distance } from './math';
import { pipeLength } from './ports';
import type { PipeSpec, Project } from './schema';
import { tankProblem } from './tanks';
import { designSurfaceFor } from './terrain/grading';

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
    if (element.kind === 'pipe' && element.ends) {
      const flanges = Object.values(element.ends);
      const thickness = flanges.reduce((sum, end) => sum + end.length, 0);
      if (
        flanges.some(
          (end) => end.type !== 'flange' || end.outerDiameter <= element.spec.outerDiameter,
        )
      ) {
        issues.push({
          severity: 'error',
          code: 'INVALID_PIPE_END',
          message: `"${element.name}" tem extremidade incompatível com o tubo (em tubos, só flange maior que o diâmetro externo).`,
          elementIds: [element.id],
        });
      } else if (pipeLength(element) < thickness + MIN_PIPE_LENGTH) {
        issues.push({
          severity: 'error',
          code: 'PIPE_TOO_SHORT',
          message: `"${element.name}" é curto demais para os flanges das extremidades.`,
          elementIds: [element.id],
        });
      }
    }
    const specs =
      element.kind === 'reducer'
        ? [element.spec, element.outletSpec]
        : element.kind === 'tank'
          ? [element.spec, ...(element.nozzles ?? []).map((nozzle) => nozzle.spec)]
          : [element.spec];
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
    if (element.kind === 'tank') {
      const problem = tankProblem(element);
      if (problem) {
        issues.push({
          severity: 'error',
          code: 'INVALID_TANK',
          message: `"${element.name}": ${problem}`,
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

  // Arquitetura: as operações só gravam estados íntegros; um projeto editado por fora
  // (arquivo alterado à mão) aparece aqui com o motivo.
  const archProblem = archIntegrityProblem(project);
  if (archProblem) {
    issues.push({
      severity: 'error',
      code: archProblem.code,
      message: archProblem.message,
      elementIds: [],
    });
  }

  // Terraplenagem: os platôs são gravados só quando podem ser gerados, mas a superfície pode
  // mudar depois (terreno trocado, limite reduzido, pontos editados). Um platô que deixou de
  // caber no terreno fica fora do terreno projetado e dos volumes — e aparece aqui.
  if (project.earthworks.platforms.length > 0) {
    if (!project.terrain) {
      issues.push({
        severity: 'warning',
        code: 'EARTHWORKS_NO_TERRAIN',
        message: `O projeto tem ${project.earthworks.platforms.length} platô(s) e nenhuma superfície de terreno: não há terreno projetado nem volumes.`,
        elementIds: [],
      });
    } else {
      const design = designSurfaceFor(project.terrain, project.earthworks.platforms);
      for (const failure of design.failures) {
        const name =
          project.earthworks.platforms.find((p) => p.id === failure.platformId)?.name ?? 'Platô';
        issues.push({
          severity: 'warning',
          code: 'PLATFORM_NOT_GENERATED',
          message: `"${name}" não pôde ser gerado sobre o terreno atual e está fora dos volumes: ${failure.error.message}`,
          elementIds: [],
        });
      }
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
