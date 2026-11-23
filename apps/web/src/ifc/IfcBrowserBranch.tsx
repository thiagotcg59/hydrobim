import type { IfcImportedModel, IfcImportedObject } from '@hydrobim/core';
import {
  Box,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Eye,
  EyeOff,
  FileBox,
  Layers,
  Shapes,
} from 'lucide-react';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useEditorStore } from '../state/editorStore';
import { ifcSourceOf, useIfcStore, type IfcSourceStatus } from './ifcStore';
import { buildIfcTree, ifcObjectLabel, type IfcTreeNode } from './ifcTree';

/**
 * Ramo "Modelos IFC" do navegador: arquivo › estrutura espacial › categoria › objeto, com
 * busca por nome, classe e GlobalId, seleção, ocultar e isolar. A visibilidade do modelo é do
 * projeto; ocultar e isolar objetos valem para a sessão.
 */

const MAX_ROWS = 300;

const indent = (level: number): CSSProperties => ({ '--level': level }) as CSSProperties;

const STATUS_TEXT: Record<IfcSourceStatus['status'], string> = {
  loading: 'lendo…',
  ready: '',
  missing: 'fonte ausente',
  error: 'falha na leitura',
};

function Actions({ ids, scope }: { ids: readonly string[]; scope: string }) {
  const hidden = useIfcStore((s) => s.hidden);
  const allHidden = ids.length > 0 && ids.every((id) => hidden.includes(id));
  return (
    <span className="ifc-actions">
      <button
        type="button"
        className="bim-tree__icon"
        data-testid={`ifc-${scope}-visibility`}
        data-hidden={allHidden}
        title={allHidden ? 'Exibir' : 'Ocultar'}
        aria-label={allHidden ? 'Exibir' : 'Ocultar'}
        onClick={() => useIfcStore.getState().setHidden(ids, !allHidden)}
      >
        {allHidden ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
      <button
        type="button"
        className="bim-tree__icon"
        data-testid={`ifc-${scope}-isolate`}
        title="Isolar (ocultar os demais objetos importados)"
        aria-label="Isolar"
        onClick={() => useIfcStore.getState().isolate(ids)}
      >
        <Crosshair size={13} />
      </button>
    </span>
  );
}

interface FoldProps {
  id: string;
  level: number;
  label: string;
  icon: ReactNode;
  count: number;
  open: boolean;
  onToggle: (id: string) => void;
  testId: string;
  ids: readonly string[];
  children: ReactNode;
}

function Fold({ id, level, label, icon, count, open, onToggle, testId, ids, children }: FoldProps) {
  return (
    <li className="tree__branch" data-testid={testId} data-collapsed={!open}>
      <div className="ifc-line">
        <button
          type="button"
          className="tree__row tree__row--branch"
          style={indent(level)}
          aria-expanded={open}
          title={open ? `Recolher ${label}` : `Expandir ${label}`}
          onClick={() => onToggle(id)}
        >
          <span className="tree__caret" aria-hidden>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <span className="tree__icon" aria-hidden>
            {icon}
          </span>
          <span className="tree__label">{label}</span>
          <span className="tree__count">{count}</span>
        </button>
        <Actions ids={ids} scope="group" />
      </div>
      {open && <ul className="tree__children">{children}</ul>}
    </li>
  );
}

const idsOf = (node: IfcTreeNode<IfcImportedObject>): string[] => [
  ...node.categories.flatMap((category) => category.items.map((item) => item.data.id)),
  ...node.children.flatMap(idsOf),
];

interface ModelProps {
  model: IfcImportedModel;
  query: string;
  status: IfcSourceStatus | undefined;
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
}

function ModelBranch({ model, query, status, isOpen, toggle }: ModelProps) {
  const revision = useIfcStore((s) => s.revision);
  const selection = useIfcStore((s) => s.selection);
  const modelSelection = useIfcStore((s) => s.modelSelection);
  const hidden = useIfcStore((s) => s.hidden);
  const source = useMemo(
    () => ifcSourceOf(model.source.sha256),
    // A revisão muda quando a fonte termina de carregar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model.source.sha256, revision],
  );
  const tree = useMemo(() => {
    if (!source) return [];
    const items = model.objects.flatMap((object) => {
      const summary = source.objects.get(object.expressId);
      return summary ? [{ data: object, summary }] : [];
    });
    return buildIfcTree(source.summary.spatial, items, query);
  }, [source, model.objects, query]);
  const shown = tree.reduce((sum, node) => sum + node.count, 0);
  const selected = new Set(selection);
  const hiddenSet = new Set(hidden);
  const modelKey = `ifc:${model.id}`;
  const open = isOpen(modelKey);
  const whole = modelSelection === model.id;
  const state = status?.status ?? (source ? 'ready' : 'loading');

  const renderNode = (node: IfcTreeNode<IfcImportedObject>, level: number): ReactNode => {
    const key = `${modelKey}:${node.key}`;
    return (
      <Fold
        key={key}
        id={key}
        level={level}
        label={node.label}
        icon={<Layers size={16} />}
        count={node.count}
        open={isOpen(key)}
        onToggle={toggle}
        testId="nav-ifc-node"
        ids={idsOf(node)}
      >
        {node.children.map((child) => renderNode(child, level + 1))}
        {node.categories.map((category) => {
          const categoryKey = `${key}:${category.entity}`;
          return (
            <Fold
              key={categoryKey}
              id={categoryKey}
              level={level + 1}
              label={category.entity}
              icon={<Shapes size={16} />}
              count={category.items.length}
              open={isOpen(categoryKey)}
              onToggle={toggle}
              testId="nav-ifc-category"
              ids={category.items.map((item) => item.data.id)}
            >
              {category.items.slice(0, MAX_ROWS).map(({ data, summary }) => {
                const active = whole || selected.has(data.id);
                return (
                  <li
                    key={data.id}
                    className={hiddenSet.has(data.id) ? 'ifc-line is-hidden' : 'ifc-line'}
                  >
                    <button
                      type="button"
                      data-testid="ifc-item"
                      data-ifc-id={data.id}
                      data-global-id={data.globalId}
                      data-entity={summary.entity}
                      data-copy={data.copy || undefined}
                      aria-pressed={active}
                      className={
                        active ? 'tree__row tree__row--leaf is-active' : 'tree__row tree__row--leaf'
                      }
                      style={indent(level + 2)}
                      title={`${ifcObjectLabel(summary)} · ${summary.entity} · GlobalId ${data.globalId}${data.copy ? ' · cópia' : ''}${summary.geometry === 'ok' ? '' : ' · sem geometria'}\nCtrl+clique para selecionar vários`}
                      onClick={(event) =>
                        useIfcStore
                          .getState()
                          .select(data.id, event.ctrlKey || event.metaKey || event.shiftKey)
                      }
                    >
                      <span className="tree__icon" aria-hidden>
                        <Box size={15} />
                      </span>
                      <span className="tree__label">{ifcObjectLabel(summary)}</span>
                      {(data.copy || summary.geometry !== 'ok') && (
                        <span className="tree__value">{data.copy ? 'cópia' : 'sem geometria'}</span>
                      )}
                    </button>
                    <Actions ids={[data.id]} scope="item" />
                  </li>
                );
              })}
              {category.items.length > MAX_ROWS && (
                <li className="muted tree__more" style={indent(level + 2)}>
                  … mais {category.items.length - MAX_ROWS} objeto(s). Use a busca.
                </li>
              )}
            </Fold>
          );
        })}
      </Fold>
    );
  };

  return (
    <li
      className="tree__branch"
      data-testid="nav-ifc-model"
      data-model-id={model.id}
      data-status={state}
      data-collapsed={!open}
    >
      <div className={model.visible ? 'ifc-line' : 'ifc-line is-hidden'}>
        <button
          type="button"
          className={
            whole ? 'tree__row tree__row--branch is-active' : 'tree__row tree__row--branch'
          }
          style={indent(2)}
          data-testid="nav-ifc-model-row"
          aria-expanded={open}
          aria-pressed={whole}
          title={`${model.name} · ${model.schema} · ${model.objects.length} objeto(s)\nClique seleciona o modelo inteiro; a seta abre a estrutura`}
          onClick={() => useIfcStore.getState().selectModel(whole ? null : model.id)}
        >
          <span
            className="tree__caret"
            data-testid="nav-ifc-model-toggle"
            role="button"
            aria-label={open ? 'Recolher' : 'Expandir'}
            onClick={(event) => {
              event.stopPropagation();
              toggle(modelKey);
            }}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <span className="tree__icon" aria-hidden>
            <FileBox size={16} />
          </span>
          <span className="tree__label">{model.name}</span>
          <span className="tree__count">{query.trim() ? shown : model.objects.length}</span>
        </button>
        <span className="ifc-actions" style={{ opacity: 1 }}>
          <button
            type="button"
            className="bim-tree__icon"
            data-testid="ifc-model-visibility"
            data-hidden={!model.visible}
            title={model.visible ? 'Ocultar o modelo' : 'Exibir o modelo'}
            aria-label={model.visible ? 'Ocultar o modelo' : 'Exibir o modelo'}
            onClick={() =>
              useIfcStore.getState().setModelDisplay(model.id, { visible: !model.visible })
            }
          >
            {model.visible ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
        </span>
      </div>
      {open && (
        <ul className="tree__children">
          {state !== 'ready' && (
            <li
              className={`muted tree__more ifc-status ifc-status--${state}`}
              style={indent(3)}
              data-testid="nav-ifc-status"
            >
              {status?.status === 'loading'
                ? `${status.label}${status.fraction !== null ? ` (${Math.round(status.fraction * 100)}%)` : ''}…`
                : status?.status === 'error'
                  ? status.message
                  : status?.status === 'missing'
                    ? 'Arquivo-fonte ausente neste navegador: selecione o modelo e religue o arquivo original.'
                    : STATUS_TEXT[state]}
            </li>
          )}
          {tree.map((node) => renderNode(node, 3))}
          {source && shown === 0 && (
            <li className="muted tree__more" style={indent(3)}>
              Nenhum objeto encontrado.
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

/** Quantos objetos importados casam com a busca (para o contador do navegador). */
export function useIfcSearchCount(query: string): number {
  const models = useEditorStore((s) => s.project.ifcModels);
  const revision = useIfcStore((s) => s.revision);
  return useMemo(() => {
    if (!query.trim()) return 0;
    let count = 0;
    for (const model of models) {
      const source = ifcSourceOf(model.source.sha256);
      if (!source) continue;
      const items = model.objects.flatMap((object) => {
        const summary = source.objects.get(object.expressId);
        return summary ? [{ data: object, summary }] : [];
      });
      count += buildIfcTree(source.summary.spatial, items, query).reduce(
        (sum, node) => sum + node.count,
        0,
      );
    }
    return count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, query, revision]);
}

interface BranchProps {
  query: string;
  /** Recolhido por padrão? (a busca abre tudo) */
  searching: boolean;
  onImport: () => void;
}

export function IfcBrowserBranch({ query, searching, onImport }: BranchProps) {
  const models = useEditorStore((s) => s.project.ifcModels);
  const sources = useIfcStore((s) => s.sources);
  const hiddenCount = useIfcStore((s) => s.hidden.length);
  // Modelo e nós da estrutura abertos; categorias recolhidas (podem ter milhares de objetos).
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const [rootClosed, setRootClosed] = useState(false);
  const isOpen = (id: string): boolean => {
    if (searching) return true;
    const category = id.split(':').length >= 4;
    return category ? toggled.has(id) : !toggled.has(id);
  };
  const toggle = (id: string): void =>
    setToggled((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const total = models.reduce((sum, model) => sum + model.objects.length, 0);
  const open = searching || !rootClosed;
  return (
    <li className="tree__branch" data-testid="nav-ifc-models" data-collapsed={!open}>
      <button
        type="button"
        className="tree__row tree__row--branch"
        style={indent(1)}
        data-testid="nav-ifc-models-toggle"
        aria-expanded={open}
        title="Modelos IFC importados (objetos de referência)"
        onClick={() => setRootClosed((value) => !value)}
      >
        <span className="tree__caret" aria-hidden>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="tree__icon" aria-hidden>
          <FileBox size={17} />
        </span>
        <span className="tree__label">Modelos IFC</span>
        <span className="tree__count" data-testid="nav-ifc-count">
          {total}
        </span>
      </button>
      {open && (
        <ul className="tree__children">
          {models.length === 0 && (
            <li className="muted tree__more" style={indent(2)} data-testid="nav-ifc-empty">
              Nenhum modelo importado.{' '}
              <button type="button" className="btn btn--link" onClick={onImport}>
                Importar IFC…
              </button>
            </li>
          )}
          {hiddenCount > 0 && (
            <li className="muted tree__more" style={indent(2)}>
              {hiddenCount} objeto(s) oculto(s).{' '}
              <button
                type="button"
                className="btn btn--link"
                data-testid="ifc-show-all"
                onClick={() => useIfcStore.getState().showAll()}
              >
                Mostrar todos
              </button>
            </li>
          )}
          {models.map((model) => (
            <ModelBranch
              key={model.id}
              model={model}
              query={query}
              status={sources[model.source.sha256]}
              isOpen={isOpen}
              toggle={toggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
