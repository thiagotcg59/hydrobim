import {
  buildFitting,
  newId,
  tankGeometricVolume,
  tankLayout,
  tankParametersFromFamily,
  tankVariantLabel,
  type Tank,
  type TankFamily,
  type TankVariant,
} from '@hydrobim/core';
import { CopyPlus, PackagePlus, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { tankFamiliesOf, useEditorStore } from '../state/editorStore';
import { FamilyPreview } from '../viewport/FamilyPreview';
import { formatDecimal, parseDecimal } from './fields';

interface Props {
  /** O canvas 3D só é montado com o diálogo aberto. */
  open: boolean;
  /** Fecha o catálogo depois de levar o modelo para a ferramenta Reservatório. */
  onUse: () => void;
}

type Model = { ok: true; tank: Tank } | { ok: false; reason: string };
type Column = 'capacityL' | 'height' | 'diameter' | 'columnHeight';

const meters = (value: number): string =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

/** Célula editável da tabela de uma família personalizada. */
function Cell({
  value,
  digits,
  onCommit,
  testId,
}: {
  value: number;
  digits: number;
  onCommit: (value: number) => void;
  testId: string;
}) {
  const display = formatDecimal(value, digits);
  const [text, setText] = useState(display);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(display);
    setInvalid(false);
  }, [display]);
  return (
    <input
      className={invalid ? 'cell cell--invalid' : 'cell'}
      data-testid={testId}
      inputMode="decimal"
      value={text}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        event.stopPropagation();
      }}
      onBlur={() => {
        const parsed = parseDecimal(text);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        if (Math.abs(parsed - value) > 1e-9) onCommit(parsed);
      }}
    />
  );
}

/**
 * Reservatórios do catálogo: tabelas dos fabricantes (somente leitura) e o modelo 3D gerado
 * pela mesma operação usada na inserção. Uma família pode ser DUPLICADA como família
 * personalizada do projeto; a tabela da cópia é editável e deixa de ser dado de fabricante.
 */
export function TankLibrary({ open, onUse }: Props) {
  const project = useEditorStore((s) => s.project);
  const activeSpec = useEditorStore((s) => s.activeSpec);
  const families = useMemo(() => tankFamiliesOf(project), [project]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [row, setRow] = useState(0);
  const [applyToInstances, setApplyToInstances] = useState(true);
  const stored = families.find((f) => f.id === selectedId) ?? null;
  /** Rascunho em edição (só as personalizadas são alteradas). */
  const [draft, setDraft] = useState<TankFamily | null>(null);
  useEffect(() => {
    setDraft(stored);
  }, [stored]);
  useEffect(() => {
    setRow(0);
  }, [selectedId]);

  const family = draft;
  const editable = family?.origin === 'custom';
  const dirty = draft !== null && stored !== null && draft !== stored;
  const instances = family
    ? project.elements.filter((e) => e.kind === 'tank' && e.familyId === family.id).length
    : 0;
  const index = family ? Math.min(row, Math.max(family.variants.length - 1, 0)) : -1;
  const variant = family?.variants[index];
  const hasColumn =
    family?.tankType === 'gobletDry' ||
    (family?.variants.some((v) => v.columnHeight !== undefined) ?? false);

  // O modelo acompanha o rascunho: cada célula confirmada regenera o reservatório.
  const model = useMemo((): Model | null => {
    if (!family) return null;
    const parameters = tankParametersFromFamily(
      family,
      variant ? { variantId: variant.id } : { custom: {} },
    );
    if (!parameters.ok) return { ok: false, reason: parameters.error.message };
    // A prévia usa a especificação ativa só para os bocais; nada é inserido no projeto.
    const built = buildFitting(
      project,
      { kind: 'tank', parameters: parameters.value },
      activeSpec,
      project.systems[0]?.id ?? 'previa',
    );
    if (!built.ok) return { ok: false, reason: built.error.message };
    return built.value.kind === 'tank'
      ? { ok: true, tank: built.value }
      : { ok: false, reason: 'Falha ao gerar o modelo.' };
  }, [project, activeSpec, family, variant]);

  const use = (): void => {
    if (!stored) return;
    const store = useEditorStore.getState();
    store.setToolOptions({
      tank: { familyId: stored.id, variantId: variant?.id ?? null, custom: {} },
    });
    store.setTool('tank');
    onUse();
  };

  const duplicate = (): void => {
    if (!stored) return;
    const id = useEditorStore.getState().duplicateTankFamily(stored);
    if (id) setSelectedId(id);
  };

  const updateVariant = (at: number, column: Column, value: number): void => {
    if (!draft) return;
    setDraft({
      ...draft,
      variants: draft.variants.map((v, i) => (i === at ? { ...v, [column]: value } : v)),
    });
  };

  const addRow = (): void => {
    if (!draft) return;
    const last = draft.variants[draft.variants.length - 1];
    const next: TankVariant = last
      ? { ...last, id: `${draft.id}/${newId()}` }
      : {
          id: `${draft.id}/${newId()}`,
          capacityL: draft.customDefaults.capacityL,
          height: draft.customDefaults.height,
          diameter: draft.customDefaults.diameter,
          ...(draft.tankType === 'gobletDry' ? { columnHeight: 3.6 } : {}),
        };
    setDraft({ ...draft, variants: [...draft.variants, next] });
    setRow(draft.variants.length);
  };

  return (
    <div className="families" data-testid="tank-library">
      <aside className="families__list">
        <span className="section__title">Reservatórios metálicos</span>
        <ul className="element-list" data-testid="tank-family-list">
          {families.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                data-testid="tank-family-item"
                data-family-id={item.id}
                data-origin={item.origin}
                className={
                  item.id === selectedId ? 'element-list__item is-active' : 'element-list__item'
                }
                onClick={() => setSelectedId(item.id)}
              >
                <span>{item.name}</span>
                <span className="muted">
                  {item.origin === 'custom' ? 'personalizada' : item.manufacturer} ·{' '}
                  {item.variants.length > 0 ? `${item.variants.length} modelos` : 'sem tabela'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="families__detail">
        {!family && (
          <p className="muted">
            Selecione uma família de reservatórios para consultar a tabela e o modelo 3D. As
            famílias de fabricante são somente leitura: use &quot;Duplicar como família
            personalizável&quot; para criar, no projeto, uma cópia com a tabela editável.
          </p>
        )}
        {family && stored && (
          <>
            <div className="products__header">
              {editable ? (
                <label className="stack">
                  <span className="section__title">Nome</span>
                  <input
                    data-testid="tank-family-name"
                    value={family.name}
                    onChange={(event) => setDraft({ ...family, name: event.target.value })}
                    onKeyDown={(event) => event.stopPropagation()}
                  />
                </label>
              ) : (
                <h3>{family.name}</h3>
              )}
              <button
                type="button"
                className="btn btn--primary"
                data-testid="tank-library-use"
                disabled={dirty}
                onClick={use}
                title={
                  dirty
                    ? 'Salve a família antes de inserir.'
                    : 'Abre a ferramenta Reservatório com esta família e este modelo selecionados.'
                }
              >
                <PackagePlus size={15} /> Inserir no modelo
              </button>
            </div>
            {family.description && <p className="muted families__source">{family.description}</p>}
            <p className="muted families__source" data-testid="tank-library-source">
              <strong>{editable ? 'Personalizada neste projeto. ' : ''}</strong>
              {editable ? '' : `${family.manufacturer} · `}
              {family.material} · Fonte: {family.source}
            </p>

            <div className="families__body">
              <div className="products__info">
                {family.variants.length > 0 ? (
                  <div className="families__table">
                    <table data-testid="tank-table">
                      <thead>
                        <tr>
                          <th>
                            Capacidade<small> L</small>
                          </th>
                          <th>
                            Altura total<small> m</small>
                          </th>
                          <th>
                            {family.tankType === 'gobletWet' || family.tankType === 'gobletDry'
                              ? 'Ø da taça'
                              : 'Diâmetro'}
                            <small> m</small>
                          </th>
                          {hasColumn && (
                            <th>
                              Altura da coluna<small> m</small>
                            </th>
                          )}
                          {editable && <th aria-label="Ações" />}
                        </tr>
                      </thead>
                      <tbody>
                        {family.variants.map((item, i) => (
                          <tr
                            key={item.id}
                            data-testid="tank-row"
                            data-variant-id={item.id}
                            className={i === index ? 'is-preview' : undefined}
                            onClick={() => setRow(i)}
                            onFocus={() => setRow(i)}
                            title={tankVariantLabel(item)}
                          >
                            {editable ? (
                              <>
                                {(
                                  [
                                    ['capacityL', 0],
                                    ['height', 3],
                                    ['diameter', 3],
                                    ...(hasColumn ? ([['columnHeight', 3]] as const) : []),
                                  ] as readonly (readonly [Column, number])[]
                                ).map(([column, digits]) => (
                                  <td key={column}>
                                    <Cell
                                      value={item[column] ?? 0}
                                      digits={digits}
                                      testId={`tank-cell-${i}-${column}`}
                                      onCommit={(value) => updateVariant(i, column, value)}
                                    />
                                  </td>
                                ))}
                                <td>
                                  <button
                                    type="button"
                                    className="btn btn--icon"
                                    aria-label={`Remover a linha ${i + 1}`}
                                    data-testid="tank-row-remove"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (i < row) setRow(row - 1);
                                      setDraft({
                                        ...family,
                                        variants: family.variants.filter((_, k) => k !== i),
                                      });
                                    }}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              </>
                            ) : (
                              <>
                                <td>
                                  {item.capacityL.toLocaleString('pt-BR')}
                                  {item.mark ?? ''}
                                </td>
                                <td>{meters(item.height)}</td>
                                <td>{meters(item.diameter)}</td>
                                {hasColumn && (
                                  <td>
                                    {item.columnHeight === undefined
                                      ? '—'
                                      : meters(item.columnHeight)}
                                  </td>
                                )}
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="warn" data-testid="tank-library-no-table">
                    {editable
                      ? 'Esta família ainda não tem modelos: acrescente linhas à tabela.'
                      : `O catálogo não tabula os modelos desta família — informa só a faixa de ${family.capacityRangeL[0].toLocaleString('pt-BR')} a ${family.capacityRangeL[1].toLocaleString('pt-BR')} L${
                          family.catalogHeights
                            ? ` e as alturas ${family.catalogHeights.map(meters).join(' m e ')} m`
                            : ''
                        }.`}{' '}
                    O modelo ao lado usa dimensões iniciais, a ajustar pelo usuário.
                  </p>
                )}
                {editable && (
                  <p className="muted families__source" data-testid="tank-library-custom-note">
                    As dimensões desta tabela são do usuário: no painel de propriedades e no IFC
                    aparecem como &quot;definido pelo usuário&quot;, não como dado de fabricante.
                  </p>
                )}
                <div className="products__notes" data-testid="tank-library-approximations">
                  <span className="section__title">Não tabulado (derivado ou representação)</span>
                  <ul>
                    {family.approximations.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
                {family.remarks.length > 0 && (
                  <div className="products__notes" data-testid="tank-library-remarks">
                    <span className="section__title">Divergências do catálogo</span>
                    <ul>
                      {family.remarks.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <figure
                className="families__preview"
                data-testid="tank-preview"
                data-variant-id={variant?.id ?? 'custom'}
                data-state={model?.ok ? 'model' : 'empty'}
              >
                <div className="families__preview-view">
                  {open && model?.ok && <FamilyPreview element={model.tank} />}
                  {model && !model.ok && (
                    <p className="muted" data-testid="tank-preview-message">
                      {model.reason}
                    </p>
                  )}
                </div>
                <figcaption className="muted">
                  {variant ? (
                    <strong>{tankVariantLabel(variant)}</strong>
                  ) : (
                    <strong>Dimensões iniciais (do usuário)</strong>
                  )}{' '}
                  Clique em uma linha para ver o modelo. Arraste para girar; role para aproximar.
                  {model?.ok && (
                    <span className="products__extent" data-testid="tank-preview-extent">
                      Topo do costado: {meters(tankLayout(model.tank).top)} m · Ø{' '}
                      {meters(model.tank.diameter)} m · volume geométrico:{' '}
                      {formatDecimal(tankGeometricVolume(model.tank), 2)} m³
                    </span>
                  )}
                </figcaption>
              </figure>
            </div>

            <div className="families__actions">
              <button
                type="button"
                className="btn"
                data-testid="tank-library-duplicate"
                disabled={dirty}
                onClick={duplicate}
                title="Cria no projeto uma cópia desta família, com a tabela de dimensões editável."
              >
                <CopyPlus size={15} /> Duplicar como família personalizável
              </button>
              {editable && (
                <>
                  <button type="button" className="btn" data-testid="tank-row-add" onClick={addRow}>
                    <Plus size={15} /> Linha
                  </button>
                  <button
                    type="button"
                    className="btn"
                    data-testid="tank-family-delete"
                    onClick={() => {
                      useEditorStore.getState().deleteTankFamily(family.id);
                      setSelectedId(null);
                    }}
                    title="Os reservatórios do projeto mantêm a forma e as dimensões, sem vínculo com a família."
                  >
                    <Trash2 size={15} /> Excluir família
                  </button>
                  <label
                    className="check"
                    title="Recalcula os reservatórios já inseridos que usam um modelo desta família e reajusta os tubos conectados."
                  >
                    <input
                      type="checkbox"
                      data-testid="tank-family-apply"
                      checked={applyToInstances}
                      onChange={(event) => setApplyToInstances(event.target.checked)}
                    />
                    Aplicar aos {instances} reservatório(s) do projeto
                  </label>
                  <button
                    type="button"
                    className="btn btn--primary"
                    data-testid="tank-family-save"
                    disabled={!dirty}
                    onClick={() =>
                      useEditorStore.getState().saveTankFamily(family, applyToInstances)
                    }
                  >
                    <Save size={15} /> Salvar no projeto
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
