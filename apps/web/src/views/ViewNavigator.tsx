import { VIEW_KIND_LABELS, type ProjectView, type ProjectViewKind } from '@hydrobim/core';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../state/editorStore';
import { VIEW_ICONS } from './viewIcons';
import { useViewStore } from './viewStore';

/**
 * Navegador de vistas: as vistas salvas no projeto, agrupadas por tipo, na ordem definida pelo
 * usuário. O clique abre a vista na área de desenho correspondente (planta ou modelo 3D); as
 * ações da linha renomeiam, duplicam, reordenam e excluem. Não guarda regras: chama a store.
 */

const GROUPS: readonly { kind: ProjectViewKind; label: string }[] = [
  { kind: 'plan', label: 'Plantas' },
  { kind: 'section', label: 'Cortes' },
  { kind: 'elevation', label: 'Elevações' },
  { kind: '3d', label: 'Vistas 3D' },
];

function RenameField({ view }: { view: ProjectView }) {
  const [name, setName] = useState(view.name);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  const commit = (): void => {
    const views = useViewStore.getState();
    if (name.trim() === view.name) views.setRenaming(null);
    // Nome recusado (vazio ou repetido): a mensagem aparece e o campo continua aberto.
    else views.rename(view.id, name);
  };
  return (
    <input
      ref={field}
      className="viewnav__rename"
      data-testid="view-rename-input"
      value={name}
      aria-label={`Nome da vista ${view.name}`}
      onChange={(event) => setName(event.target.value)}
      onBlur={commit}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        else if (event.key === 'Escape') useViewStore.getState().setRenaming(null);
        event.stopPropagation();
      }}
    />
  );
}

export function ViewNavigator() {
  const views = useEditorStore((s) => s.project.views);
  const open2d = useViewStore((s) => s.open2d);
  const open3d = useViewStore((s) => s.open3d);
  const marker = useViewStore((s) => s.marker);
  const renaming = useViewStore((s) => s.renaming);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const store = useViewStore.getState();

  if (views.length === 0) {
    return (
      <p className="viewnav__empty muted" data-testid="view-navigator-empty">
        Nenhuma vista salva. Crie plantas, cortes, elevações e vistas 3D em Visualizar › Vistas do
        projeto.
      </p>
    );
  }

  return (
    <ul className="tree viewnav" data-testid="view-navigator" aria-label="Vistas salvas">
      {GROUPS.map((group) => {
        const items = views.filter((view) => view.kind === group.kind);
        if (items.length === 0) return null;
        const open = !closed.has(group.kind);
        const Icon = VIEW_ICONS[group.kind];
        return (
          <li key={group.kind} className="tree__branch" data-testid={`view-group-${group.kind}`}>
            <button
              type="button"
              className="tree__row tree__row--branch"
              aria-expanded={open}
              title={open ? `Recolher ${group.label}` : `Expandir ${group.label}`}
              onClick={() =>
                setClosed((current) => {
                  const next = new Set(current);
                  if (next.has(group.kind)) next.delete(group.kind);
                  else next.add(group.kind);
                  return next;
                })
              }
            >
              <span className="tree__caret" aria-hidden>
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
              <span className="tree__icon" aria-hidden>
                <Icon size={16} />
              </span>
              <span className="tree__label">{group.label}</span>
              <span className="tree__count">{items.length}</span>
            </button>
            {open && (
              <ul className="tree__children">
                {items.map((view, index) => {
                  const active = view.id === open2d || view.id === open3d;
                  const selected = view.id === marker;
                  const kind = VIEW_KIND_LABELS[view.kind];
                  return (
                    <li
                      key={view.id}
                      className={[
                        'viewnav__item',
                        active ? 'is-active' : '',
                        selected ? 'is-selected' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      data-testid="view-item"
                      data-view-id={view.id}
                      data-view-kind={view.kind}
                      data-view-name={view.name}
                      data-open={active}
                    >
                      {renaming === view.id ? (
                        <RenameField view={view} />
                      ) : (
                        <button
                          type="button"
                          className={
                            active
                              ? 'tree__row tree__row--leaf is-active'
                              : 'tree__row tree__row--leaf'
                          }
                          style={{ ['--level' as string]: 1 }}
                          data-testid="view-open"
                          aria-pressed={active}
                          title={`${kind} "${view.name}": clique para abrir; duplo clique para renomear`}
                          onClick={() => store.openView(view.id)}
                          onDoubleClick={() => store.setRenaming(view.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'F2') store.setRenaming(view.id);
                          }}
                        >
                          <span className="tree__label">{view.name}</span>
                        </button>
                      )}
                      <span className="viewnav__actions">
                        <button
                          type="button"
                          className="tree__action"
                          data-testid="view-rename"
                          aria-label={`Renomear ${view.name}`}
                          title="Renomear (F2)"
                          onClick={() => store.setRenaming(view.id)}
                        >
                          <Pencil size={14} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="tree__action"
                          data-testid="view-duplicate"
                          aria-label={`Duplicar ${view.name}`}
                          title="Duplicar a vista, com a configuração e os detalhes"
                          onClick={() => store.duplicate(view.id)}
                        >
                          <Copy size={14} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="tree__action"
                          data-testid="view-up"
                          aria-label={`Subir ${view.name}`}
                          title="Subir na lista"
                          disabled={index === 0}
                          onClick={() => store.reorder(view.id, -1)}
                        >
                          <ArrowUp size={14} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="tree__action"
                          data-testid="view-down"
                          aria-label={`Descer ${view.name}`}
                          title="Descer na lista"
                          disabled={index === items.length - 1}
                          onClick={() => store.reorder(view.id, 1)}
                        >
                          <ArrowDown size={14} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="tree__action"
                          data-testid="view-delete"
                          aria-label={`Excluir ${view.name}`}
                          title="Excluir a vista (o modelo não muda; Ctrl+Z desfaz)"
                          onClick={() => store.remove(view.id)}
                        >
                          <Trash2 size={14} aria-hidden />
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
