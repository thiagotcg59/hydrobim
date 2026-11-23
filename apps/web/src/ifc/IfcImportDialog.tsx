import { IFC_IMPORT_LIMITS } from '@hydrobim/core';
import { SUPPORTED_IFC_SCHEMAS, type IfcObjectSummary } from '@hydrobim/ifc-import';
import { FileUp, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { IfcPreviewCanvas } from './IfcScene';
import { ifcSourceOf, useIfcStore } from './ifcStore';
import {
  buildIfcTree,
  IFC_GEOMETRY_LABELS,
  ifcCategoryCounts,
  ifcMatches,
  ifcObjectLabel,
  type IfcTreeNode,
} from './ifcTree';

/**
 * Diálogo "Importar IFC": escolha do arquivo, andamento com cancelamento, prévia do modelo
 * (esquema, unidades, pavimentos, categorias, relatório) e escolha do que importar por
 * árvore, categoria e busca. O posicionamento é confirmado depois, nas vistas do editor.
 */

const MAX_ROWS = 400;
const level = (value: number): CSSProperties => ({ '--level': value }) as CSSProperties;

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Caixa de três estados para um grupo de objetos. */
function GroupCheck({
  ids,
  selected,
  onToggle,
  testId,
  data,
}: {
  ids: readonly number[];
  selected: ReadonlySet<number>;
  onToggle: (ids: readonly number[], checked: boolean) => void;
  testId: string;
  data?: Record<string, string>;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const count = ids.reduce((sum, id) => sum + (selected.has(id) ? 1 : 0), 0);
  const all = ids.length > 0 && count === ids.length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && !all;
  }, [count, all]);
  return (
    <input
      ref={ref}
      type="checkbox"
      data-testid={testId}
      {...Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]))}
      checked={all}
      onChange={(event) => onToggle(ids, event.target.checked)}
    />
  );
}

const idsOfNode = (node: IfcTreeNode<IfcObjectSummary>): number[] => [
  ...node.categories.flatMap((category) => category.items.map((item) => item.summary.expressId)),
  ...node.children.flatMap(idsOfNode),
];

export function IfcImportDialog({ open, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const wizard = useIfcStore((s) => s.wizard);
  const revision = useIfcStore((s) => s.revision);
  const [query, setQuery] = useState('');

  // O diálogo fica aberto enquanto se escolhe o arquivo e o conteúdo; no posicionamento ele
  // sai da frente para que a prévia apareça nas vistas.
  const visible = open && wizard?.step !== 'placing';
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (visible && !dialog.open) dialog.showModal();
    if (!visible && dialog.open) dialog.close();
  }, [visible]);

  const sha = wizard?.sha256 ?? null;
  const source = useMemo(
    () => (sha && wizard?.step === 'preview' ? ifcSourceOf(sha) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sha, wizard?.step, revision],
  );
  const summary = source?.summary ?? null;
  const selected = wizard?.selected ?? new Set<number>();
  const tree = useMemo(
    () =>
      summary
        ? buildIfcTree(
            summary.spatial,
            summary.objects.map((object) => ({ data: object, summary: object })),
            query,
          )
        : [],
    [summary, query],
  );
  const categories = useMemo(() => (summary ? ifcCategoryCounts(summary.objects) : []), [summary]);
  const storeys = useMemo(() => {
    const list: { name: string; elevation: number | null }[] = [];
    const walk = (node: NonNullable<typeof summary>['spatial']): void => {
      if (node.entity === 'IfcBuildingStorey') {
        list.push({ name: node.name ?? '(sem nome)', elevation: node.elevation });
      }
      node.children.forEach(walk);
    };
    if (summary) walk(summary.spatial);
    return list;
  }, [summary]);

  const toggle = (ids: readonly number[], checked: boolean): void => {
    const next = new Set(selected);
    for (const id of ids) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    useIfcStore.getState().setWizardSelected(next);
  };

  const close = (): void => {
    // Fechar o diálogo antes de confirmar cancela a importação: nada entra no projeto.
    if (useIfcStore.getState().wizard?.step !== 'placing') useIfcStore.getState().cancelImport();
    setQuery('');
    onClose();
  };

  const pick = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setQuery('');
    await useIfcStore
      .getState()
      .beginImport({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  };

  const renderNode = (node: IfcTreeNode<IfcObjectSummary>, depth: number): ReactNode => (
    <li key={node.key} data-testid="ifc-import-node">
      <label className="ifc-check ifc-check--node" style={level(depth)}>
        <GroupCheck
          ids={idsOfNode(node)}
          selected={selected}
          onToggle={toggle}
          testId="ifc-import-node-check"
        />
        <span>{node.label}</span>
        <small>{node.count}</small>
      </label>
      <ul>
        {node.children.map((child) => renderNode(child, depth + 1))}
        {node.categories.map((category) => (
          <li key={category.entity}>
            <label className="ifc-check ifc-check--node" style={level(depth + 1)}>
              <GroupCheck
                ids={category.items.map((item) => item.summary.expressId)}
                selected={selected}
                onToggle={toggle}
                testId="ifc-import-tree-category"
                data={{ entity: category.entity }}
              />
              <span>{category.entity}</span>
              <small>{category.items.length}</small>
            </label>
            <ul>
              {category.items.slice(0, MAX_ROWS).map(({ summary: object }) => (
                <li key={object.expressId}>
                  <label
                    className="ifc-check"
                    style={level(depth + 2)}
                    title={`${object.entity} · GlobalId ${object.globalId}\n${IFC_GEOMETRY_LABELS[object.geometry]}`}
                  >
                    <input
                      type="checkbox"
                      data-testid="ifc-import-object"
                      data-express-id={object.expressId}
                      data-global-id={object.globalId}
                      data-geometry={object.geometry}
                      checked={selected.has(object.expressId)}
                      onChange={(event) => toggle([object.expressId], event.target.checked)}
                    />
                    <span>{ifcObjectLabel(object)}</span>
                    {object.geometry !== 'ok' && (
                      <small className="is-warning">sem geometria</small>
                    )}
                  </label>
                </li>
              ))}
              {category.items.length > MAX_ROWS && (
                <li className="muted ifc-check" style={level(depth + 2)}>
                  … mais {category.items.length - MAX_ROWS}. Use a busca ou a caixa da categoria.
                </li>
              )}
            </ul>
          </li>
        ))}
      </ul>
    </li>
  );

  const matching = summary ? summary.objects.filter((object) => ifcMatches(object, query)) : [];
  const over = selected.size > IFC_IMPORT_LIMITS.maxObjects;

  return (
    <dialog
      ref={ref}
      className="dialog ifc-import"
      data-testid="ifc-import-dialog"
      data-step={wizard?.step ?? 'idle'}
      onClose={close}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="dialog__header">
        <h2>Importar IFC{wizard ? ` — ${wizard.fileName}` : ''}</h2>
        <button type="button" className="btn btn--icon" aria-label="Fechar" onClick={close}>
          <X size={16} />
        </button>
      </header>

      <input
        ref={fileRef}
        type="file"
        accept=".ifc"
        hidden
        data-testid="ifc-import-file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          void pick(file);
        }}
      />

      {(!wizard || wizard.step === 'error') && (
        <div className="dialog__body">
          {wizard?.step === 'error' && (
            <p className="ifc-error" role="alert" data-testid="ifc-import-error">
              <strong>Não foi possível importar {wizard.fileName}.</strong> {wizard.error}
            </p>
          )}
          <p>
            Escolha um arquivo <strong>.ifc</strong> (texto IFC-SPF) do seu computador. O arquivo é
            lido neste navegador — nada é enviado a servidores — e guardado dentro do projeto.
          </p>
          <ul className="ifc-report">
            <li>Esquemas lidos: {Object.keys(SUPPORTED_IFC_SCHEMAS).join(', ')}.</li>
            <li>
              Limites: {Math.round(IFC_IMPORT_LIMITS.maxFileBytes / 1024 / 1024)} MB por arquivo e{' '}
              {IFC_IMPORT_LIMITS.maxObjects.toLocaleString('pt-BR')} objetos por modelo.
            </li>
            <li>
              Os objetos entram como referência: não viram tubos, paredes nem equipamentos editáveis
              e não criam conexões hidráulicas.
            </li>
          </ul>
        </div>
      )}

      {wizard?.step === 'reading' && (
        <div className="dialog__body">
          <div className="ifc-progress" data-testid="ifc-import-progress" role="status">
            <strong>{wizard.label}…</strong>
            <progress
              max={1}
              value={wizard.fraction ?? undefined}
              aria-label="Andamento da leitura"
            />
            <span className="muted">
              A leitura roda fora da linha principal: o editor continua respondendo. Cancelar
              interrompe o leitor e não altera o projeto.
            </span>
          </div>
        </div>
      )}

      {wizard?.step === 'preview' && summary && source && (
        <div className="dialog__body ifc-import__body">
          <div className="ifc-import__column">
            <div className="ifc-import__preview">
              <ErrorBoundary
                title="Falha ao desenhar a prévia"
                hint="A importação continua disponível."
              >
                <IfcPreviewCanvas source={source} selected={selected} />
              </ErrorBoundary>
            </div>
            <dl className="ifc-import__facts">
              <dt>Esquema</dt>
              <dd data-testid="ifc-import-schema">{summary.header.schema}</dd>
              <dt>Unidades</dt>
              <dd data-testid="ifc-import-units">
                {summary.units.length === 0
                  ? 'não declaradas'
                  : summary.units.map((unit) => `${unit.label} (${unit.symbol})`).join(' · ')}
              </dd>
              <dt>Comprimento</dt>
              <dd data-testid="ifc-import-length-unit">
                {summary.lengthUnit.label}: 1 unidade ={' '}
                {summary.lengthUnit.scale.toLocaleString('pt-BR', { maximumFractionDigits: 6 })} m
              </dd>
              <dt>Projeto</dt>
              <dd>{summary.projectName ?? 'não informado'}</dd>
              <dt>Origem</dt>
              <dd>{summary.header.application ?? 'não informada'}</dd>
              <dt>Pavimentos</dt>
              <dd data-testid="ifc-import-storeys">
                {storeys.length === 0
                  ? 'nenhum'
                  : storeys
                      .map(
                        (storey) =>
                          `${storey.name}${storey.elevation !== null ? ` (${storey.elevation.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} m)` : ''}`,
                      )
                      .join(' · ')}
              </dd>
              <dt>Objetos</dt>
              <dd data-testid="ifc-import-count">
                {summary.objects.length.toLocaleString('pt-BR')} ({' '}
                {summary.objects.filter((o) => o.geometry === 'ok').length.toLocaleString('pt-BR')}{' '}
                com geometria · {summary.triangles.toLocaleString('pt-BR')} triângulos)
              </dd>
              <dt>Envoltória</dt>
              <dd data-testid="ifc-import-bounds">
                {summary.bounds
                  ? `X ${summary.bounds[0].toFixed(3)} a ${summary.bounds[3].toFixed(3)} · Y ${summary.bounds[1].toFixed(3)} a ${summary.bounds[4].toFixed(3)} · Z ${summary.bounds[2].toFixed(3)} a ${summary.bounds[5].toFixed(3)} m`
                  : 'sem geometria'}
              </dd>
              <dt>Georreferência</dt>
              <dd data-testid="ifc-import-georeference">
                {summary.georeference
                  ? `${summary.georeference.crsName ?? 'sistema sem nome'} · E ${summary.georeference.eastings} · N ${summary.georeference.northings} · H ${summary.georeference.orthogonalHeight} (declarada; não aplicada)`
                  : 'não declarada'}
              </dd>
            </dl>
            <h3 className="section__title">Relatório da leitura</h3>
            <ul className="ifc-report" data-testid="ifc-import-report">
              {summary.report.length === 0 && (
                <li>Nenhuma ocorrência: todos os objetos têm geometria lida.</li>
              )}
              {summary.report.map((item) => (
                <li key={item.code} data-code={item.code} data-severity={item.severity}>
                  {item.message}
                </li>
              ))}
            </ul>
          </div>

          <div className="ifc-import__column">
            <h3 className="section__title">O que importar</h3>
            <div className="ifc-import__toolbar">
              <input
                type="search"
                placeholder="Buscar por nome, classe ou GlobalId"
                aria-label="Buscar objetos"
                data-testid="ifc-import-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button
                type="button"
                className="btn"
                data-testid="ifc-import-all"
                title={query ? 'Marca os objetos encontrados' : 'Marca o modelo completo'}
                onClick={() =>
                  toggle(
                    matching.map((o) => o.expressId),
                    true,
                  )
                }
              >
                {query ? 'Marcar encontrados' : 'Modelo completo'}
              </button>
              <button
                type="button"
                className="btn"
                data-testid="ifc-import-none"
                onClick={() =>
                  toggle(
                    matching.map((o) => o.expressId),
                    false,
                  )
                }
              >
                {query ? 'Desmarcar encontrados' : 'Nenhum'}
              </button>
            </div>
            <div className="ifc-import__categories" data-testid="ifc-import-categories">
              {categories.map((category) => (
                <label
                  key={category.entity}
                  title={`${category.count} objeto(s)${category.withoutGeometry > 0 ? `, ${category.withoutGeometry} sem geometria` : ''}`}
                >
                  <GroupCheck
                    ids={summary.objects
                      .filter((object) => object.entity === category.entity)
                      .map((object) => object.expressId)}
                    selected={selected}
                    onToggle={toggle}
                    testId="ifc-import-category"
                    data={{ entity: category.entity }}
                  />
                  {category.entity} <small className="muted">({category.count})</small>
                </label>
              ))}
            </div>
            <div className="ifc-import__tree" data-testid="ifc-import-tree">
              <ul>
                {tree.map((node) => renderNode(node, 0))}
                {tree.length === 0 && (
                  <li className="muted ifc-check">Nenhum objeto encontrado.</li>
                )}
              </ul>
            </div>
            <span className="muted" data-testid="ifc-import-selected">
              {selected.size.toLocaleString('pt-BR')} de{' '}
              {summary.objects.length.toLocaleString('pt-BR')} objeto(s) escolhido(s)
              {over
                ? ` — acima do limite de ${IFC_IMPORT_LIMITS.maxObjects.toLocaleString('pt-BR')}`
                : ''}
            </span>
          </div>
        </div>
      )}

      <footer className="dialog__footer">
        {(!wizard || wizard.step === 'error' || wizard.step === 'preview') && (
          <button
            type="button"
            className={wizard?.step === 'preview' ? 'btn' : 'btn btn--primary'}
            data-testid="ifc-import-choose"
            onClick={() => fileRef.current?.click()}
          >
            <FileUp size={15} /> {wizard ? 'Escolher outro arquivo…' : 'Escolher arquivo .ifc…'}
          </button>
        )}
        {wizard?.step === 'preview' && (
          <button
            type="button"
            className="btn btn--primary"
            data-testid="ifc-import-next"
            disabled={selected.size === 0 || over}
            title={
              selected.size === 0
                ? 'Escolha ao menos um objeto'
                : 'Mostra a prévia nas vistas para confirmar a posição'
            }
            onClick={() => useIfcStore.getState().startPlacing()}
          >
            Posicionar…
          </button>
        )}
        <button type="button" className="btn" data-testid="ifc-import-cancel" onClick={close}>
          {wizard?.step === 'reading' ? 'Cancelar a leitura' : 'Cancelar'}
        </button>
      </footer>
    </dialog>
  );
}
