import type { IfcConformity, IfcElementInfo } from '@hydrobim/ifc';
import { ChevronDown, ChevronRight, Crosshair, Eye, EyeOff, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../state/editorStore';
import { useIfcState } from '../state/ifcModel';

/** Nó da árvore: sistema › entidade IFC › tipo (família) › ocorrências. */
interface TreeGroup {
  key: string;
  label: string;
  /** Texto secundário (tipo predefinido, entidade de tipo). */
  detail: string | null;
  level: 'project' | 'system' | 'entity' | 'type';
  ids: string[];
  groups: TreeGroup[];
  elements: IfcElementInfo[];
}

const CONFORMITY_TITLES: Record<IfcConformity, string> = {
  conforming: 'Conforme',
  pending: 'Com pendências de informação',
  invalid: 'Não conforme com o IFC 4.3',
};

/** Acima deste número de elementos, os tipos da árvore começam recolhidos. */
const LARGE_MODEL = 80;

const actions = () => useEditorStore.getState();

function VisibilityButtons({ ids, hidden }: { ids: string[]; hidden: ReadonlySet<string> }) {
  const allHidden = ids.length > 0 && ids.every((id) => hidden.has(id));
  return (
    <span className="bim-tree__actions">
      <button
        type="button"
        className="bim-tree__icon"
        data-testid="bim-toggle-visibility"
        data-hidden={allHidden}
        title={allHidden ? 'Exibir' : 'Ocultar'}
        aria-label={allHidden ? 'Exibir' : 'Ocultar'}
        onClick={(event) => {
          event.stopPropagation();
          actions().setBimHidden(ids, !allHidden);
        }}
      >
        {allHidden ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
      <button
        type="button"
        className="bim-tree__icon"
        data-testid="bim-isolate"
        title="Isolar (ocultar os demais)"
        aria-label="Isolar"
        onClick={(event) => {
          event.stopPropagation();
          actions().isolateBim(ids);
        }}
      >
        <Crosshair size={13} />
      </button>
    </span>
  );
}

/**
 * Árvore de elementos IFC da aba BIM / IFC. Organiza o modelo por sistema, entidade,
 * tipo (família) e ocorrência; seleciona, oculta, isola e filtra pela classificação IFC.
 * Só consulta o modelo de informação: a classificação vem de `@hydrobim/ifc`.
 */
export function BimTree() {
  const projectName = useEditorStore((s) => s.project.name);
  const selection = useEditorStore((s) => s.selection);
  const hiddenIds = useEditorStore((s) => s.bimHidden);
  const classFilter = useEditorStore((s) => s.bimClassFilter);
  const { model, conformity } = useIfcState();
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const listRef = useRef<HTMLDivElement>(null);

  const entities = useMemo(
    () => [...new Set(model.elements.map((element) => element.entity))].sort(),
    [model],
  );

  const tree = useMemo((): TreeGroup => {
    const text = query.trim().toLocaleLowerCase('pt-BR');
    const types = new Map(model.types.map((type) => [type.key, type]));
    const matches = (element: IfcElementInfo): boolean => {
      if (classFilter && element.entity !== classFilter) return false;
      if (!text) return true;
      const type = types.get(element.typeKey);
      return [element.name, element.globalId, element.entity, element.predefinedType, type?.name]
        .filter((item): item is string => typeof item === 'string')
        .some((item) => item.toLocaleLowerCase('pt-BR').includes(text));
    };
    const root: TreeGroup = {
      key: 'project',
      label: projectName,
      detail: 'IfcProject',
      level: 'project',
      ids: [],
      groups: [],
      elements: [],
    };
    for (const system of model.systems) {
      const members = model.elements.filter(
        (element) => element.systemId === system.systemId && matches(element),
      );
      if (members.length === 0) continue;
      const systemGroup: TreeGroup = {
        key: `system:${system.systemId}`,
        label: system.name,
        detail: `IfcDistributionSystem · ${system.predefinedType}`,
        level: 'system',
        ids: members.map((e) => e.elementId),
        groups: [],
        elements: [],
      };
      for (const entity of [...new Set(members.map((e) => e.entity))].sort()) {
        const ofEntity = members.filter((e) => e.entity === entity);
        const entityGroup: TreeGroup = {
          key: `${systemGroup.key}|${entity}`,
          label: entity,
          detail: null,
          level: 'entity',
          ids: ofEntity.map((e) => e.elementId),
          groups: [],
          elements: [],
        };
        for (const typeKey of [...new Set(ofEntity.map((e) => e.typeKey))]) {
          const ofType = ofEntity.filter((e) => e.typeKey === typeKey);
          const type = types.get(typeKey);
          entityGroup.groups.push({
            key: `${entityGroup.key}|${typeKey}`,
            label: type?.name ?? 'Tipo',
            detail: `${type?.entity ?? ''} · ${ofType[0]?.predefinedType ?? ''}`,
            level: 'type',
            ids: ofType.map((e) => e.elementId),
            groups: [],
            elements: ofType,
          });
        }
        entityGroup.groups.sort((a, b) =>
          a.label.localeCompare(b.label, 'pt-BR', { numeric: true }),
        );
        systemGroup.groups.push(entityGroup);
      }
      root.groups.push(systemGroup);
      root.ids.push(...systemGroup.ids);
    }
    return root;
  }, [model, projectName, query, classFilter]);

  // Selecionou no 3D: a ocorrência aparece na árvore.
  const primary = selection[0];
  useEffect(() => {
    if (!primary) return;
    listRef.current
      ?.querySelector(`[data-element-id="${CSS.escape(primary)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [primary]);

  const toggle = (key: string): void =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderGroup = (group: TreeGroup, depth: number) => {
    // Com busca ativa tudo fica aberto. Em modelos grandes os tipos começam fechados (o
    // clique alterna o estado) e abrem sozinhos quando contêm o elemento selecionado.
    const toggled = collapsed.has(group.key);
    const open = query.trim()
      ? true
      : group.level === 'type' && model.elements.length > LARGE_MODEL
        ? toggled || group.ids.some((id) => selection.includes(id))
        : !toggled;
    return (
      <div key={group.key} className="bim-tree__group">
        <div
          className={`bim-tree__row bim-tree__row--${group.level}`}
          style={{ paddingLeft: 6 + depth * 12 }}
          data-testid="bim-node"
          data-node-level={group.level}
          data-node-label={group.label}
          data-open={open}
        >
          <button
            type="button"
            className="bim-tree__toggle"
            aria-expanded={open}
            aria-label={open ? 'Recolher' : 'Expandir'}
            onClick={() => toggle(group.key)}
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <button
            type="button"
            className="bim-tree__label"
            title={group.detail ? `${group.label} — ${group.detail}` : group.label}
            onClick={() =>
              group.level === 'project' ? toggle(group.key) : actions().selectMany(group.ids)
            }
          >
            <span className="bim-tree__name">{group.label}</span>
            {group.detail && <span className="bim-tree__detail">{group.detail}</span>}
          </button>
          <span className="badge" data-testid="bim-node-count">
            {group.ids.length}
          </span>
          <VisibilityButtons ids={group.ids} hidden={hidden} />
        </div>
        {open && (
          <>
            {group.groups.map((child) => renderGroup(child, depth + 1))}
            {group.elements.map((element) => {
              const status = conformity.get(element.elementId) ?? 'conforming';
              return (
                <div
                  key={element.elementId}
                  className={`bim-tree__row bim-tree__row--item${selection.includes(element.elementId) ? ' is-active' : ''}${hidden.has(element.elementId) ? ' is-hidden' : ''}`}
                  style={{ paddingLeft: 24 + (depth + 1) * 12 }}
                  data-testid="bim-item"
                  data-element-id={element.elementId}
                  data-entity={element.entity}
                  data-conformity={status}
                >
                  <span
                    className={`bim-dot bim-dot--${status}`}
                    title={CONFORMITY_TITLES[status]}
                    aria-label={CONFORMITY_TITLES[status]}
                  />
                  <button
                    type="button"
                    className="bim-tree__label"
                    title={`${element.name} — ${element.globalId}`}
                    onClick={(event) =>
                      actions().select(element.elementId, event.ctrlKey || event.metaKey)
                    }
                  >
                    <span className="bim-tree__name">{element.name}</span>
                  </button>
                  <VisibilityButtons ids={[element.elementId]} hidden={hidden} />
                </div>
              );
            })}
          </>
        )}
      </div>
    );
  };

  return (
    <aside className="bim-tree" data-testid="bim-tree" aria-label="Árvore de elementos IFC">
      <div className="bim-tree__header">
        <h2>Elementos IFC</h2>
        <span className="badge" title="Esquema do modelo de informação">
          {model.schema}
        </span>
      </div>
      <div className="bim-tree__filters">
        <label className="bim-tree__search">
          <Search size={13} aria-hidden />
          <span className="visually-hidden">Localizar elemento</span>
          <input
            data-testid="bim-search"
            type="search"
            placeholder="Localizar por nome, tipo ou GlobalId"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </label>
        <label className="bim-tree__class">
          <span className="visually-hidden">Filtrar pela classificação IFC</span>
          <select
            data-testid="bim-class-filter"
            value={classFilter ?? ''}
            onChange={(event) => actions().setBimClassFilter(event.target.value || null)}
          >
            <option value="">Todas as classes IFC</option>
            {entities.map((entity) => (
              <option key={entity} value={entity}>
                {entity}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn--compact"
          data-testid="bim-show-all"
          disabled={hiddenIds.length === 0 && classFilter === null}
          onClick={() => actions().showAllBim()}
          title="Exibir todos os elementos e limpar o filtro de classe"
        >
          <Eye size={13} /> Exibir tudo
        </button>
      </div>
      <div className="bim-tree__list" ref={listRef}>
        {tree.ids.length === 0 ? (
          <p className="muted bim-tree__empty" data-testid="bim-tree-empty">
            {model.elements.length === 0
              ? 'O projeto ainda não tem elementos.'
              : 'Nenhum elemento corresponde ao filtro.'}
          </p>
        ) : (
          renderGroup(tree, 0)
        )}
      </div>
    </aside>
  );
}
