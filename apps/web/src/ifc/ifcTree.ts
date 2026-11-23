import type { IfcObjectSummary, IfcSpatialNode } from '@hydrobim/ifc-import';

/**
 * Árvore dos objetos de um arquivo IFC: estrutura espacial › categoria (entidade IFC) ›
 * objeto. Função pura, usada pelo diálogo de importação e pelo ramo "Modelos IFC" do
 * navegador.
 */

export interface IfcTreeItem<T> {
  readonly data: T;
  readonly summary: IfcObjectSummary;
}

export interface IfcTreeCategory<T> {
  readonly entity: string;
  readonly items: readonly IfcTreeItem<T>[];
}

export interface IfcTreeNode<T> {
  readonly key: string;
  readonly entity: string;
  readonly label: string;
  readonly categories: readonly IfcTreeCategory<T>[];
  readonly children: readonly IfcTreeNode<T>[];
  /** Objetos neste nó e abaixo dele. */
  readonly count: number;
}

export const ifcObjectLabel = (summary: IfcObjectSummary): string =>
  summary.name ?? `${summary.entity} #${summary.expressId}`;

const SPATIAL_LABELS: Record<string, string> = {
  IfcSite: 'Terreno',
  IfcBuilding: 'Edifício',
  IfcBuildingStorey: 'Pavimento',
  IfcFacility: 'Instalação',
  IfcFacilityPart: 'Parte da instalação',
  IfcBridge: 'Ponte',
  IfcRoad: 'Via',
  IfcRailway: 'Ferrovia',
};

/** Busca por nome, classe (entidade), GlobalId, tipo, tipo predefinido e etiqueta. */
export function ifcMatches(summary: IfcObjectSummary, query: string): boolean {
  const text = query.trim().toLocaleLowerCase('pt-BR');
  if (!text) return true;
  return [
    summary.name,
    summary.entity,
    summary.globalId,
    summary.typeName,
    summary.predefinedType,
    summary.objectType,
    summary.tag,
    summary.storeyName,
  ].some((value) => value?.toLocaleLowerCase('pt-BR').includes(text));
}

function categoriesOf<T>(items: readonly IfcTreeItem<T>[]): IfcTreeCategory<T>[] {
  const byEntity = new Map<string, IfcTreeItem<T>[]>();
  for (const item of items) {
    const list = byEntity.get(item.summary.entity);
    if (list) list.push(item);
    else byEntity.set(item.summary.entity, [item]);
  }
  return [...byEntity.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([entity, list]) => ({
      entity,
      items: [...list].sort((p, q) =>
        ifcObjectLabel(p.summary).localeCompare(ifcObjectLabel(q.summary), 'pt-BR', {
          numeric: true,
        }),
      ),
    }));
}

/**
 * Monta a árvore com os itens que casam com a busca; nós sem objetos somem. Objetos fora da
 * estrutura espacial ficam em um nó próprio, identificado.
 */
export function buildIfcTree<T>(
  spatial: IfcSpatialNode,
  items: readonly IfcTreeItem<T>[],
  query = '',
): IfcTreeNode<T>[] {
  const byContainer = new Map<number | null, IfcTreeItem<T>[]>();
  for (const item of items) {
    if (!ifcMatches(item.summary, query)) continue;
    const key = item.summary.containerId;
    const list = byContainer.get(key);
    if (list) list.push(item);
    else byContainer.set(key, [item]);
  }
  const known = new Set<number>();
  const nodeOf = (node: IfcSpatialNode): IfcTreeNode<T> | null => {
    known.add(node.expressId);
    const children = node.children.map(nodeOf).filter((child) => child !== null);
    const own = byContainer.get(node.expressId) ?? [];
    const count = own.length + children.reduce((sum, child) => sum + child.count, 0);
    if (count === 0) return null;
    const kind = SPATIAL_LABELS[node.entity] ?? node.entity;
    return {
      key: `n${node.expressId}`,
      entity: node.entity,
      label: node.name ? `${node.name}${node.longName ? ` — ${node.longName}` : ''}` : kind,
      categories: categoriesOf(own),
      children,
      count,
    };
  };
  const nodes = spatial.children.map(nodeOf).filter((node) => node !== null);
  // Fora da estrutura: sem contêiner, ou com um contêiner que a árvore do arquivo não liga.
  const outside: IfcTreeItem<T>[] = [];
  for (const [container, list] of byContainer) {
    if (container === null || !known.has(container)) outside.push(...list);
  }
  if (outside.length > 0) {
    nodes.push({
      key: 'outside',
      entity: '',
      label: 'Fora da estrutura espacial',
      categories: categoriesOf(outside),
      children: [],
      count: outside.length,
    });
  }
  return nodes;
}

/** Contagem por categoria (entidade IFC), da mais numerosa para a menos. */
export function ifcCategoryCounts(
  objects: readonly IfcObjectSummary[],
): { entity: string; count: number; withoutGeometry: number }[] {
  const counts = new Map<string, { count: number; withoutGeometry: number }>();
  for (const object of objects) {
    const entry = counts.get(object.entity) ?? { count: 0, withoutGeometry: 0 };
    entry.count += 1;
    if (object.geometry !== 'ok') entry.withoutGeometry += 1;
    counts.set(object.entity, entry);
  }
  return [...counts.entries()]
    .map(([entity, entry]) => ({ entity, ...entry }))
    .sort((a, b) => b.count - a.count || a.entity.localeCompare(b.entity));
}

export const IFC_GEOMETRY_LABELS: Record<IfcObjectSummary['geometry'], string> = {
  ok: 'Geometria lida do arquivo',
  none: 'Sem representação geométrica no arquivo',
  unsupported: 'Representação não convertida em malha pelo leitor',
  failed: 'Falha do leitor ao gerar a geometria',
};
