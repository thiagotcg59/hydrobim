import {
  ARCH_KIND_LABELS,
  archLevelIdOf,
  archTypeOf,
  type ArchElement,
  type ArchElementKind,
  type Project,
} from '@hydrobim/core';

/**
 * Árvore da arquitetura para o navegador do projeto: pavimento › categoria › elemento. Portas
 * e janelas ficam no pavimento da parede hospedeira. Função pura.
 */

export const ARCH_TREE_KINDS: readonly { kind: ArchElementKind; label: string }[] = [
  { kind: 'wall', label: 'Paredes' },
  { kind: 'slab', label: 'Lajes' },
  { kind: 'flooring', label: 'Pisos' },
  { kind: 'roof', label: 'Telhados' },
  { kind: 'door', label: 'Portas' },
  { kind: 'window', label: 'Janelas' },
  { kind: 'space', label: 'Ambientes' },
];

export interface ArchTreeItem {
  readonly element: ArchElement;
  /** Nome do tipo (ou o número do ambiente), mostrado ao lado do nome. */
  readonly detail: string;
}

export interface ArchTreeCategory {
  readonly kind: ArchElementKind;
  readonly label: string;
  readonly items: readonly ArchTreeItem[];
}

export interface ArchTreeLevel {
  /** `null`: elementos sem pavimento (hospedeira ou nível ausentes). */
  readonly levelId: string | null;
  readonly name: string;
  readonly count: number;
  readonly categories: readonly ArchTreeCategory[];
}

/**
 * Pavimentos (na ordem das cotas) com os elementos que correspondem à busca; pavimentos e
 * categorias sem elemento ficam fora.
 */
export function archTreeOf(
  project: Pick<Project, 'levels' | 'architecture'>,
  query = '',
): ArchTreeLevel[] {
  const { architecture } = project;
  const text = query.trim().toLocaleLowerCase('pt-BR');
  const levelNames = new Map(project.levels.map((level) => [level.id, level.name]));
  const byLevel = new Map<string | null, ArchTreeItem[]>();
  for (const element of architecture.elements) {
    const levelId = archLevelIdOf(architecture, element);
    const known = levelId !== null && levelNames.has(levelId) ? levelId : null;
    const detail =
      element.kind === 'space'
        ? (element.number ?? '')
        : (archTypeOf(architecture, element)?.name ?? '');
    const haystack =
      `${element.name} ${ARCH_KIND_LABELS[element.kind]} ${detail} ${known ? levelNames.get(known) : ''}`.toLocaleLowerCase(
        'pt-BR',
      );
    if (text && !haystack.includes(text)) continue;
    const list = byLevel.get(known);
    if (list) list.push({ element, detail });
    else byLevel.set(known, [{ element, detail }]);
  }
  const ordered: { levelId: string | null; name: string }[] = [
    ...[...project.levels]
      .sort((a, b) => a.elevation - b.elevation)
      .map((level) => ({ levelId: level.id as string | null, name: level.name })),
    { levelId: null, name: 'Sem pavimento' },
  ];
  return ordered.flatMap(({ levelId, name }) => {
    const items = byLevel.get(levelId) ?? [];
    if (items.length === 0) return [];
    return [
      {
        levelId,
        name,
        count: items.length,
        categories: ARCH_TREE_KINDS.map(({ kind, label }) => ({
          kind,
          label,
          items: items.filter((item) => item.element.kind === kind),
        })).filter((category) => category.items.length > 0),
      },
    ];
  });
}

/** Total de elementos da árvore. */
export const archTreeCount = (levels: readonly ArchTreeLevel[]): number =>
  levels.reduce((sum, level) => sum + level.count, 0);
