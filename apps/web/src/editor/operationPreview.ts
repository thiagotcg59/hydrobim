import {
  distance,
  elementKindLabel,
  formatDegrees,
  formatMeters,
  getElement,
  type HydroElement,
  type Project,
  type Result,
} from '@hydrobim/core';

/**
 * Prévia real da montagem: como as operações de domínio são funções puras, a prévia é a
 * própria operação aplicada ao projeto atual, sem gravar. Este módulo compara o projeto
 * antes e depois e descreve o que seria criado, alterado ou removido — exatamente o que a
 * confirmação fará, porque é o mesmo resultado. Em caso de recusa, a mensagem é a do núcleo.
 */

export interface OperationPreview {
  /** Elementos que a operação cria (para desenhar como fantasmas). */
  readonly created: readonly HydroElement[];
  /** Elementos existentes que mudam (versão resultante), com o mesmo identificador. */
  readonly modified: readonly HydroElement[];
  readonly removedIds: readonly string[];
  /** Variação no número de conexões do grafo. */
  readonly connectionsAdded: number;
  readonly connectionsRemoved: number;
  /** Mensagem da recusa, quando a operação não pode ser aplicada. */
  readonly error: string | null;
  /** Resumo em uma linha para mostrar junto ao cursor. */
  readonly summary: string;
}

const EMPTY: Omit<OperationPreview, 'error' | 'summary'> = {
  created: [],
  modified: [],
  removedIds: [],
  connectionsAdded: 0,
  connectionsRemoved: 0,
};

const lengthOf = (element: HydroElement): number | null =>
  element.kind === 'pipe' ? distance(element.start, element.end) : null;

/** "1 joelho e 2 tubos", na ordem em que os tipos aparecem. */
function countByKind(elements: readonly HydroElement[]): string {
  const counts = new Map<string, number>();
  for (const element of elements) counts.set(element.kind, (counts.get(element.kind) ?? 0) + 1);
  const parts = [...counts].map(([kind, count]) => {
    const label = elementKindLabel(kind as HydroElement['kind']).toLowerCase();
    return `${count} ${label}${count > 1 ? 's' : ''}`;
  });
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}`;
}

/** Diferença entre dois projetos, pela identidade dos elementos (o projeto é imutável). */
export function diffProjects(before: Project, after: Project): OperationPreview {
  if (before === after) return { ...EMPTY, error: null, summary: 'Nada a alterar.' };
  const previous = new Map(before.elements.map((element) => [element.id, element]));
  const created: HydroElement[] = [];
  const modified: HydroElement[] = [];
  for (const element of after.elements) {
    const old = previous.get(element.id);
    if (!old) created.push(element);
    else if (old !== element) modified.push(element);
    previous.delete(element.id);
  }
  const removedIds = [...previous.keys()];
  const oldLinks = new Set(before.connections.map((c) => c.id));
  const newLinks = new Set(after.connections.map((c) => c.id));
  const connectionsAdded = [...newLinks].filter((id) => !oldLinks.has(id)).length;
  const connectionsRemoved = [...oldLinks].filter((id) => !newLinks.has(id)).length;

  const parts: string[] = [];
  if (created.length > 0) parts.push(`cria ${countByKind(created)}`);
  // Tubos existentes que mudam de comprimento: é o que o usuário precisa conferir.
  const resized = modified.flatMap((element) => {
    const old = before.elements.find((e) => e.id === element.id);
    const from = old ? lengthOf(old) : null;
    const to = lengthOf(element);
    return from !== null && to !== null && Math.abs(from - to) > 1e-6
      ? [`${element.name} ${formatMeters(from, 2)} → ${formatMeters(to, 2)}`]
      : [];
  });
  if (resized.length > 0) parts.push(`ajusta ${resized.join('; ')}`);
  const moved = modified.length - resized.length;
  if (moved > 0) parts.push(`altera ${moved} elemento${moved > 1 ? 's' : ''}`);
  if (removedIds.length > 0) {
    parts.push(`remove ${removedIds.length} elemento${removedIds.length > 1 ? 's' : ''}`);
  }
  if (parts.length === 0 && connectionsAdded > 0) {
    parts.push(`conecta ${connectionsAdded} extremidade${connectionsAdded > 1 ? 's' : ''}`);
  }
  const text = parts.join(' · ');
  return {
    created,
    modified,
    removedIds,
    connectionsAdded,
    connectionsRemoved,
    error: null,
    summary: text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Nada a alterar.',
  };
}

const END_SHORT: Record<string, string> = { flange: 'flange', socket: 'bolsa', plain: 'ponta' };

/** Linha de uma peça: tipo, nome, dimensão principal, família e extremidades. */
function describePiece(element: HydroElement): string {
  const family = element.familyId ? ` · ${element.familyId.split('@')[0]}` : ' · genérica';
  switch (element.kind) {
    case 'pipe': {
      const ends = [element.ends?.start?.type ?? 'plain', element.ends?.end?.type ?? 'plain']
        .map((type) => END_SHORT[type])
        .join(' × ');
      return `${element.name} — ${element.spec.sizeLabel}, ${formatMeters(distance(element.start, element.end), 3)} (${ends})`;
    }
    case 'elbow':
      return `${element.name} — ${element.spec.sizeLabel}, ${formatDegrees(element.angle, 2)}${family}`;
    case 'tee':
    case 'cross': {
      const branch = element.branchSpec ? ` × ${element.branchSpec.sizeLabel}` : '';
      return `${element.name} — ${element.spec.sizeLabel}${branch}, passagem ${formatMeters(element.runLength, 3)}${family}`;
    }
    default:
      return `${element.name} — ${element.spec.sizeLabel}${family}`;
  }
}

/**
 * Peças da operação, para conferência antes de confirmar: as criadas (com dimensões e
 * família), os tubos existentes que mudam de comprimento ou de extremidades e as peças que
 * mudam de tipo (tê ⇄ cruzeta).
 */
export function describeChanges(
  before: Project,
  after: Project,
): {
  readonly created: readonly string[];
  readonly changed: readonly string[];
} {
  const diff = diffProjects(before, after);
  const changed = diff.modified.flatMap((element) => {
    const old = getElement(before, element.id);
    if (!old) return [];
    if (old.kind !== element.kind) {
      return [
        `${element.name}: ${elementKindLabel(old.kind)} → ${elementKindLabel(element.kind)} (${describePiece(element)})`,
      ];
    }
    if (old.kind === 'pipe' && element.kind === 'pipe') {
      const from = distance(old.start, old.end);
      const to = distance(element.start, element.end);
      const endsChanged = JSON.stringify(old.ends ?? {}) !== JSON.stringify(element.ends ?? {});
      if (Math.abs(from - to) > 1e-6 || endsChanged) {
        return [
          `${element.name}: ${formatMeters(from, 3)} → ${describePiece(element).split(' — ')[1]}`,
        ];
      }
      return [`${element.name}: deslocado`];
    }
    return [
      `${element.name}: ${old.familyId === element.familyId ? 'deslocado' : describePiece(element)}`,
    ];
  });
  return { created: diff.created.map(describePiece), changed };
}

/**
 * Prévia de uma operação já calculada: o resultado aceito vira a lista de peças; a recusa
 * vira a mensagem do núcleo. `policy` aplica a mesma verificação extra da confirmação
 * (ex.: "somente peças de catálogo") e devolve o motivo ou `null`.
 */
export function previewOf(
  before: Project,
  result: Result<Project>,
  policy?: (after: Project) => string | null,
): OperationPreview {
  if (!result.ok) return { ...EMPTY, error: result.error.message, summary: result.error.message };
  const problem = policy?.(result.value) ?? null;
  if (problem) return { ...EMPTY, error: problem, summary: problem };
  return diffProjects(before, result.value);
}
