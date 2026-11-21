import { archTypeFromFamily, listArchFamilies, type ArchFamily } from '@hydrobim/catalog';
import {
  addArchType,
  ARCH_CATEGORIES,
  ARCH_CATEGORY_LABELS,
  archTypeSizeLabel,
  archTypeUsage,
  getArchType,
  type ArchCategory,
  type ArchType,
  type Architecture,
} from '@hydrobim/core';
import { PackagePlus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../state/editorStore';
import '../styles/architecture.css';
import { useArchStore } from './archStore';
import {
  archDraftProblem,
  ArchPreviewPanel,
  ArchTypeEditor,
  ArchTypeParameters,
  occurrencesText,
} from './ArchTypeEditor';

/**
 * Catálogo de famílias ARQUITETÔNICAS — biblioteca separada da hidráulica. Três níveis sempre
 * à vista: FAMÍLIA (tipologia do catálogo) › TIPO (a família com dimensões e composição,
 * gravado no projeto) › OCORRÊNCIAS (os elementos do modelo que usam o tipo).
 */

interface Props {
  onClose: () => void;
  /** "Usar este tipo": leva o tipo à ferramenta de inserção da categoria. */
  onUseType?: (typeId: string, category: ArchCategory) => void;
}

type Selection = { level: 'family'; id: string } | { level: 'type'; id: string } | null;

const fold = (value: string): string =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');

export interface CatalogGroup {
  readonly category: ArchCategory;
  readonly families: readonly {
    readonly family: ArchFamily;
    readonly types: readonly ArchType[];
  }[];
  /** Tipos do projeto sem família do catálogo (criados fora dele ou de família ausente). */
  readonly orphans: readonly ArchType[];
}

/**
 * Lista do catálogo: famílias por categoria, cada uma com os tipos do projeto que vieram dela.
 * A busca vale para o nome e a descrição da família e para o nome dos tipos; uma família que
 * não casa aparece só com os tipos que casam.
 */
export function catalogGroups(
  families: readonly ArchFamily[],
  architecture: Pick<Architecture, 'types'>,
  query: string,
  category: ArchCategory | null,
): CatalogGroup[] {
  const needle = fold(query.trim());
  const matches = (value: string): boolean => needle.length === 0 || fold(value).includes(needle);
  const known = new Set(families.map((family) => family.id));
  const groups: CatalogGroup[] = [];
  for (const current of ARCH_CATEGORIES) {
    if (category && category !== current) continue;
    const types = architecture.types.filter((type) => type.category === current);
    const listed = families
      .filter((family) => family.category === current)
      .map((family) => {
        const own = types.filter((type) => type.familyId === family.id);
        const hit = matches(family.name) || matches(family.description);
        return { family, hit, types: hit ? own : own.filter((type) => matches(type.name)) };
      })
      .filter((entry) => entry.hit || entry.types.length > 0)
      .map(({ family, types: own }) => ({ family, types: own }));
    const orphans = types.filter(
      (type) => (type.familyId === null || !known.has(type.familyId)) && matches(type.name),
    );
    if (listed.length > 0 || orphans.length > 0) {
      groups.push({ category: current, families: listed, orphans });
    }
  }
  return groups;
}

/** Rascunho do tipo que nasce de uma família, com os valores iniciais dela. */
const draftFrom = (family: ArchFamily): ArchType =>
  ({ ...archTypeFromFamily(family), id: `rascunho-${family.id}` }) as ArchType;

function FamilyDetail({
  family,
  onCreated,
}: {
  family: ArchFamily;
  onCreated: (typeId: string) => void;
}) {
  const [draft, setDraft] = useState<ArchType>(() => draftFrom(family));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(draftFrom(family));
    setError(null);
  }, [family]);

  const create = (): void => {
    const store = useEditorStore.getState();
    const problem = archDraftProblem(draft);
    if (problem) {
      setError(problem);
      return;
    }
    const { id: _id, name, familyId: _familyId, ...values } = draft;
    const result = addArchType(store.project, archTypeFromFamily(family, name, values));
    if (!result.ok) {
      setError(result.error.message);
      store.notify('error', result.error.message);
      return;
    }
    setError(null);
    if (
      store.applyOperation(
        { ok: true, value: result.value.project },
        `Tipo "${name.trim()}" criado a partir da família "${family.name}".`,
      )
    ) {
      onCreated(result.value.typeId);
    }
  };

  return (
    <div data-testid="arch-family-detail" data-family-id={family.id} className="archcat__form">
      <p className="archcat__crumbs" data-testid="arch-crumbs">
        <span className="archcat__level">Família</span>
        <strong>{family.name}</strong>
        <span>› escolha ou crie um tipo › as ocorrências são os elementos do modelo</span>
      </p>
      <div className="archcat__head">
        <h3>{family.name}</h3>
        <span className="badge">{ARCH_CATEGORY_LABELS[family.category]}</span>
        {family.generic ? (
          <span className="badge badge--estimated" data-testid="arch-family-generic">
            Modelo genérico parametrizável
          </span>
        ) : (
          <span className="badge badge--catalog" data-testid="arch-family-product">
            Produto de fabricante
          </span>
        )}
      </div>
      <p>{family.description}</p>
      {family.source && (
        <p className="muted" data-testid="arch-family-source">
          Fonte: {family.source}
        </p>
      )}
      <div className="archcat__body">
        <div className="archcat__form">
          <fieldset data-testid="arch-family-notes">
            <legend>O que não é dado de catálogo</legend>
            <ul className="archcat__notes">
              {family.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </fieldset>
          <fieldset data-testid="arch-family-ifc">
            <legend>Enquadramento IFC com que os tipos nascem</legend>
            <dl className="archcat__ifc">
              <dt>Entidade</dt>
              <dd>
                <code>{family.ifc.entity}</code>
              </dd>
              <dt>Entidade de tipo</dt>
              <dd>
                <code>{family.ifc.typeEntity}</code>
              </dd>
              <dt>Tipo predefinido</dt>
              <dd>
                <code>{family.ifc.predefinedType}</code>
              </dd>
              <dt>Justificativa</dt>
              <dd>{family.ifc.rationale}</dd>
            </dl>
          </fieldset>

          <fieldset data-testid="arch-create-form">
            <legend>Criar tipo a partir desta família</legend>
            <p className="archcat__notice" data-testid="arch-create-notice">
              Os valores abaixo são valores iniciais de edição, não medidas de catálogo: ajuste-os
              ao que o projeto adota antes de criar o tipo.
            </p>
            <ArchTypeParameters
              draft={draft}
              onChange={(next) => {
                setDraft(next);
                setError(null);
              }}
            />
            {error && (
              <p className="archcat__error" role="alert" data-testid="arch-create-error">
                {error} Nada foi criado.
              </p>
            )}
            <div className="archcat__actions">
              <button
                type="button"
                className="btn btn--primary"
                data-testid="arch-create-type"
                onClick={create}
              >
                <PackagePlus size={14} aria-hidden /> Criar tipo
              </button>
            </div>
          </fieldset>
        </div>
        <ArchPreviewPanel type={draft} />
      </div>
    </div>
  );
}

export function ArchCatalogDialog({ onClose, onUseType }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const architecture = useEditorStore((s) => s.project.architecture);
  const [query, setQuery] = useState('');
  // Aberto por uma ferramenta sem tipo, o catálogo já vem filtrado pela categoria dela.
  const [category, setCategory] = useState<ArchCategory | null>(
    () => useArchStore.getState().catalogCategory,
  );
  const [selection, setSelection] = useState<Selection>(null);

  // O diálogo é montado já aberto por quem registra o comando.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const families = useMemo(() => listArchFamilies(), []);
  const groups = useMemo(
    () => catalogGroups(families, architecture, query, category),
    [families, architecture, query, category],
  );
  const family =
    selection?.level === 'family' ? families.find((entry) => entry.id === selection.id) : undefined;
  const type = selection?.level === 'type' ? getArchType(architecture, selection.id) : undefined;
  const typeFamily = type ? families.find((entry) => entry.id === type.familyId) : undefined;
  const usage = type ? archTypeUsage(architecture, type.id).length : 0;
  const shown = groups.reduce(
    (sum, group) =>
      sum +
      group.families.length +
      group.families.reduce((count, entry) => count + entry.types.length, 0) +
      group.orphans.length,
    0,
  );

  const typeButton = (item: ArchType) => {
    const count = archTypeUsage(architecture, item.id).length;
    return (
      <li key={item.id}>
        <button
          type="button"
          data-testid="arch-type-item"
          data-type-id={item.id}
          data-usage={count}
          className={
            selection?.level === 'type' && selection.id === item.id
              ? 'element-list__item is-active'
              : 'element-list__item'
          }
          onClick={() => setSelection({ level: 'type', id: item.id })}
        >
          <span>
            <span className="archcat__level">Tipo</span> {item.name}
          </span>
          <span className="muted">
            {archTypeSizeLabel(item)} · {occurrencesText(count)}
          </span>
        </button>
      </li>
    );
  };

  return (
    <dialog
      ref={dialogRef}
      className="dialog dialog--wide dialog--arch"
      data-testid="arch-catalog-dialog"
      aria-label="Catálogo de arquitetura"
      onClose={onClose}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="dialog__header">
        <h2>Catálogo de arquitetura — famílias, tipos e ocorrências</h2>
        <button
          type="button"
          className="btn btn--icon"
          onClick={onClose}
          aria-label="Fechar"
          data-testid="arch-catalog-close"
        >
          <X size={16} />
        </button>
      </header>

      <div className="archcat">
        <aside className="archcat__list">
          <input
            type="search"
            className="archcat__search"
            data-testid="arch-catalog-search"
            value={query}
            placeholder="Buscar família ou tipo"
            aria-label="Buscar família ou tipo"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
          <div className="chips" role="group" aria-label="Filtrar por categoria">
            <button
              type="button"
              className={category === null ? 'chip is-active' : 'chip'}
              data-testid="arch-catalog-filter-all"
              aria-pressed={category === null}
              onClick={() => setCategory(null)}
            >
              Todas
            </button>
            {ARCH_CATEGORIES.map((item) => (
              <button
                key={item}
                type="button"
                className={category === item ? 'chip is-active' : 'chip'}
                data-testid={`arch-catalog-filter-${item}`}
                aria-pressed={category === item}
                onClick={() => setCategory(item)}
              >
                {ARCH_CATEGORY_LABELS[item]}
              </button>
            ))}
          </div>
          <span className="muted" data-testid="arch-catalog-count" data-count={shown}>
            {shown === 0 ? 'Nada encontrado.' : `${shown} itens (famílias e tipos)`}
          </span>
          {groups.map((group) => (
            <section key={group.category} data-testid={`arch-catalog-group-${group.category}`}>
              <h3 className="archcat__group">{ARCH_CATEGORY_LABELS[group.category]}</h3>
              {group.families.map(({ family: item, types }) => (
                <div key={item.id} className="archcat__family">
                  <button
                    type="button"
                    data-testid="arch-family-item"
                    data-family-id={item.id}
                    className={
                      selection?.level === 'family' && selection.id === item.id
                        ? 'element-list__item is-active'
                        : 'element-list__item'
                    }
                    onClick={() => setSelection({ level: 'family', id: item.id })}
                  >
                    <span>
                      <span className="archcat__level">Família</span> {item.name}
                    </span>
                    <span className="muted">
                      {item.generic ? 'genérica' : 'fabricante'} ·{' '}
                      {types.length === 0
                        ? 'sem tipos no projeto'
                        : types.length === 1
                          ? '1 tipo'
                          : `${types.length} tipos`}
                    </span>
                  </button>
                  {types.length > 0 && <ul className="archcat__types">{types.map(typeButton)}</ul>}
                </div>
              ))}
              {group.orphans.length > 0 && (
                <div className="archcat__family">
                  <span className="muted">Tipos sem família do catálogo</span>
                  <ul className="archcat__types">{group.orphans.map(typeButton)}</ul>
                </div>
              )}
            </section>
          ))}
        </aside>

        <section className="archcat__detail" data-testid="arch-catalog-detail">
          {!family && !type && (
            <p className="muted" data-testid="arch-catalog-empty">
              Escolha uma família para ver a descrição, o enquadramento IFC e criar um tipo; ou um
              tipo do projeto para editá-lo. Família é a tipologia do catálogo; tipo é a família com
              dimensões e composição, gravado no projeto; ocorrências são os elementos do modelo que
              usam o tipo.
            </p>
          )}
          {family && (
            <FamilyDetail family={family} onCreated={(id) => setSelection({ level: 'type', id })} />
          )}
          {type && (
            <>
              <p className="archcat__crumbs" data-testid="arch-crumbs">
                <span className="archcat__level">Família</span>
                {typeFamily ? (
                  <button
                    type="button"
                    className="btn link"
                    data-testid="arch-crumb-family"
                    onClick={() => setSelection({ level: 'family', id: typeFamily.id })}
                  >
                    {typeFamily.name}
                  </button>
                ) : (
                  <span>sem família do catálogo</span>
                )}
                <span>›</span>
                <span className="archcat__level">Tipo</span>
                <strong>{type.name}</strong>
                <span>›</span>
                <span className="archcat__level">Ocorrências</span>
                <strong data-testid="arch-type-usage" data-usage={usage}>
                  {occurrencesText(usage)}
                </strong>
              </p>
              <div className="archcat__head">
                <h3>{type.name}</h3>
                <span className="badge">{ARCH_CATEGORY_LABELS[type.category]}</span>
                <span className="badge">{archTypeSizeLabel(type)}</span>
                {type.generic ? (
                  <span className="badge badge--estimated" data-testid="arch-type-generic-badge">
                    Modelo genérico parametrizável
                  </span>
                ) : (
                  <span className="badge badge--catalog" data-testid="arch-type-product-badge">
                    Produto de fabricante
                  </span>
                )}
              </div>
              <ArchTypeEditor
                typeId={type.id}
                onSelectType={(id) => setSelection(id ? { level: 'type', id } : null)}
                onUse={
                  onUseType
                    ? (id, used) => {
                        onUseType(id, used);
                        onClose();
                      }
                    : undefined
                }
              />
            </>
          )}
        </section>
      </div>
    </dialog>
  );
}
