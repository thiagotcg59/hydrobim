import { FLANGE_PRESSURE_CLASSES, resolvePipeSpec, resolvePumpPlacement } from '@hydrobim/catalog';
import {
  buildFitting,
  mmToM,
  mToMm,
  newId,
  PUMP_DIMENSION_KEYS,
  PUMP_DIMENSION_LABELS,
  pumpFlangeLabel,
  pumpLengthMismatch,
  pumpModelRange,
  pumpVariantLabel,
  type PipeSpec,
  type Pump,
  type PumpDimensionKey,
  type PumpFamily,
  type PumpFlangeRef,
  type PumpVariant,
} from '@hydrobim/core';
import { CopyPlus, PackagePlus, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { pumpFamiliesOf, useEditorStore } from '../state/editorStore';
import { FamilyPreview } from '../viewport/FamilyPreview';
import { formatDecimal, parseDecimal } from './fields';

interface Props {
  /** O canvas 3D só é montado com o diálogo aberto. */
  open: boolean;
  /** Fecha o catálogo depois de levar o modelo para a ferramenta Bomba. */
  onUse: () => void;
}

type Model = { ok: true; pump: Pump; spec: PipeSpec } | { ok: false; reason: string };

/** Especificação usada quando a ativa não tem os diâmetros do modelo (bocas flangeadas). */
const FALLBACK_SPECIFICATION = 'ferro-ductil-nbr7675-k9';

const millimeters = (meters: number): string => formatDecimal(mToMm(meters), 1);

const stop = (event: { stopPropagation: () => void }): void => event.stopPropagation();

/** Família com uma linha nova no fim: cópia da última, a preencher pelo usuário. */
function withNewRow(family: PumpFamily): PumpFamily {
  const last = family.variants[family.variants.length - 1];
  if (!last) return family;
  const next: PumpVariant = { ...last, id: `${family.id}/${newId()}`, models: ['Novo modelo'] };
  return { ...family, variants: [...family.variants, next] };
}

/** Célula numérica da tabela de uma família personalizada (confirma ao sair do campo). */
function NumberCell({
  value,
  digits,
  integer = false,
  optional = false,
  onCommit,
  testId,
}: {
  value: number | undefined;
  digits: number;
  integer?: boolean;
  /** Vazio é aceito (valor não informado). */
  optional?: boolean;
  onCommit: (value: number | undefined) => void;
  testId: string;
}) {
  const display = value === undefined ? '' : formatDecimal(value, digits);
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
      onClick={stop}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        event.stopPropagation();
      }}
      onBlur={() => {
        if (optional && text.trim() === '') {
          setInvalid(false);
          if (value !== undefined) onCommit(undefined);
          return;
        }
        const parsed = parseDecimal(text);
        if (!Number.isFinite(parsed) || parsed <= 0 || (integer && !Number.isInteger(parsed))) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        if (value === undefined || Math.abs(parsed - value) > 1e-9) onCommit(parsed);
      }}
    />
  );
}

/** Célula de texto (modelos, carcaça). */
function TextCell({
  value,
  onCommit,
  testId,
  className = 'cell cell--text',
}: {
  value: string;
  onCommit: (value: string) => void;
  testId: string;
  className?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className={className}
      data-testid={testId}
      value={text}
      onClick={stop}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        event.stopPropagation();
      }}
      onBlur={() => {
        if (text !== value) onCommit(text);
      }}
    />
  );
}

/** Boca (DN e classe PN) editável. */
function FlangeCells({
  flange,
  onCommit,
  testId,
}: {
  flange: PumpFlangeRef;
  onCommit: (flange: PumpFlangeRef) => void;
  testId: string;
}) {
  return (
    <>
      <td>
        <NumberCell
          value={flange.dn}
          digits={0}
          integer
          testId={`${testId}-dn`}
          onCommit={(dn) => dn !== undefined && onCommit({ ...flange, dn })}
        />
      </td>
      <td>
        <select
          className="cell cell--select"
          data-testid={`${testId}-class`}
          value={flange.pressureClass}
          onClick={stop}
          onKeyDown={stop}
          onChange={(event) => onCommit({ ...flange, pressureClass: event.target.value })}
        >
          {FLANGE_PRESSURE_CLASSES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </td>
    </>
  );
}

/**
 * Bombas do catálogo: tabela dimensional do fabricante (somente leitura, com as letras das
 * cotas como impressas) e o modelo 3D gerado pela mesma operação usada na inserção. Uma
 * família pode ser DUPLICADA como família personalizada do projeto; a tabela da cópia é
 * editável e deixa de ser dado de fabricante.
 */
export function PumpLibrary({ open, onUse }: Props) {
  const project = useEditorStore((s) => s.project);
  const activeSpec = useEditorStore((s) => s.activeSpec);
  const families = useMemo(() => pumpFamiliesOf(project), [project]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [row, setRow] = useState(0);
  const [applyToInstances, setApplyToInstances] = useState(true);
  const stored = families.find((f) => f.id === selectedId) ?? null;
  /** Rascunho em edição (só as personalizadas são alteradas). */
  const [draft, setDraft] = useState<PumpFamily | null>(null);
  /** Nova linha pedida numa família de catálogo: entra na cópia assim que ela é criada. */
  const pendingRow = useRef(false);
  useEffect(() => {
    if (pendingRow.current && stored?.origin === 'custom') {
      pendingRow.current = false;
      setDraft(withNewRow(stored));
      setRow(stored.variants.length);
      return;
    }
    setDraft(stored);
  }, [stored]);
  useEffect(() => {
    if (!pendingRow.current) setRow(0);
  }, [selectedId]);

  const family = draft;
  const editable = family?.origin === 'custom';
  const dirty = draft !== null && stored !== null && draft !== stored;
  const instances = family
    ? project.elements.filter((e) => e.kind === 'pump' && e.familyId === family.id).length
    : 0;
  const index = family ? Math.min(row, Math.max(family.variants.length - 1, 0)) : -1;
  const variant = family?.variants[index];

  // O modelo acompanha o rascunho: cada célula confirmada regenera a bomba.
  const model = useMemo((): Model | null => {
    if (!family || !variant) return null;
    // As bocas usam a especificação ativa; sem os diâmetros do modelo nela, a prévia (e a
    // inserção por este painel) recorre ao ferro fundido dúctil, que os tem.
    const fallback = resolvePipeSpec(FALLBACK_SPECIFICATION, variant.suction.dn);
    let placement = resolvePumpPlacement(family, { variantId: variant.id }, activeSpec);
    if (!placement.ok && fallback) {
      placement = resolvePumpPlacement(family, { variantId: variant.id }, fallback);
    }
    if (!placement.ok) return { ok: false, reason: placement.error.message };
    const built = buildFitting(
      project,
      placement.value.fitting,
      placement.value.spec,
      project.systems[0]?.id ?? 'previa',
    );
    if (!built.ok) return { ok: false, reason: built.error.message };
    return built.value.kind === 'pump'
      ? { ok: true, pump: built.value, spec: placement.value.spec }
      : { ok: false, reason: 'Falha ao gerar o modelo.' };
  }, [project, activeSpec, family, variant]);

  const use = (): void => {
    if (!stored || !variant) return;
    const store = useEditorStore.getState();
    // Sem o diâmetro na especificação ativa, a ferramenta passa a usar a da prévia.
    if (model?.ok && model.spec.specificationId !== activeSpec.specificationId) {
      store.setActiveSpec(model.spec.specificationId, model.spec.dn);
      store.notify(
        'info',
        `Especificação ativa alterada para ${model.spec.standard}, que tem os diâmetros das bocas deste modelo.`,
      );
    }
    store.setToolOptions({
      pump: { familyId: stored.id, variantId: variant.id, custom: {}, dischargeDn: null },
    });
    store.setTool('pump');
    onUse();
  };

  const duplicate = (): void => {
    if (!stored) return;
    const id = useEditorStore.getState().duplicatePumpFamily(stored);
    if (id) setSelectedId(id);
  };

  const replaceVariant = (at: number, next: PumpVariant): void => {
    if (!draft) return;
    setDraft({ ...draft, variants: draft.variants.map((v, i) => (i === at ? next : v)) });
  };
  const updateVariant = (at: number, patch: Partial<PumpVariant>): void => {
    const current = draft?.variants[at];
    if (current) replaceVariant(at, { ...current, ...patch });
  };
  const updateDimension = (at: number, key: PumpDimensionKey, value: number): void => {
    const current = draft?.variants[at];
    if (current) updateVariant(at, { dimensions: { ...current.dimensions, [key]: value } });
  };

  const addRow = (): void => {
    if (!draft) return;
    if (draft.origin !== 'custom') {
      // A tabela do fabricante não é alterada: a linha entra numa cópia personalizável.
      if (!stored) return;
      const id = useEditorStore.getState().duplicatePumpFamily(stored);
      if (!id) return;
      pendingRow.current = true;
      setSelectedId(id);
      return;
    }
    setDraft(withNewRow(draft));
    setRow(draft.variants.length);
  };

  return (
    <div className="families" data-testid="pump-library">
      <aside className="families__list">
        <span className="section__title">Bombas</span>
        <ul className="element-list" data-testid="pump-family-list">
          {families.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                data-testid="pump-family-item"
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
                  {item.variants.length} linhas da tabela
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="families__detail">
        {!family && (
          <p className="muted">
            Selecione uma família de bombas para consultar o dimensional e o modelo 3D. As famílias
            de fabricante são somente leitura: use &quot;Duplicar como família personalizável&quot;
            para criar, no projeto, uma cópia com a tabela editável. Para um modelo avulso, use a
            ferramenta Bomba → &quot;Outro modelo (preencher as cotas)&quot;.
          </p>
        )}
        {family && stored && (
          <>
            <div className="products__header">
              {editable ? (
                <label className="stack">
                  <span className="section__title">Nome</span>
                  <input
                    data-testid="pump-family-name"
                    value={family.name}
                    onChange={(event) => setDraft({ ...family, name: event.target.value })}
                    onKeyDown={stop}
                  />
                </label>
              ) : (
                <h3>{family.name}</h3>
              )}
              <button
                type="button"
                className="btn btn--primary"
                data-testid="pump-library-use"
                disabled={dirty || !model?.ok}
                onClick={use}
                title={
                  dirty
                    ? 'Salve a família antes de inserir.'
                    : 'Abre a ferramenta Bomba com esta família e este modelo selecionados.'
                }
              >
                <PackagePlus size={15} /> Inserir no modelo
              </button>
            </div>
            <p className="muted families__source">{family.description}</p>
            <p className="muted families__source" data-testid="pump-library-source">
              <strong>{editable ? 'Personalizada neste projeto. ' : ''}</strong>
              {editable ? '' : `${family.manufacturer} · `}Fonte: {family.source}
            </p>

            <div className="families__body">
              <div className="products__info">
                <div className="families__table">
                  <table className="pump-table" data-testid="pump-table">
                    <thead>
                      <tr>
                        <th>Modelo</th>
                        <th>Carcaça</th>
                        {editable ? (
                          <>
                            <th>
                              A — DN<small> sucção</small>
                            </th>
                            <th>A — PN</th>
                            <th>
                              B — DN<small> descarga</small>
                            </th>
                            <th>B — PN</th>
                          </>
                        ) : (
                          <>
                            <th>A — sucção</th>
                            <th>B — descarga</th>
                          </>
                        )}
                        {PUMP_DIMENSION_KEYS.map((key) => (
                          <th key={key} title={PUMP_DIMENSION_LABELS[key].description}>
                            {PUMP_DIMENSION_LABELS[key].letter}
                            <small> mm</small>
                          </th>
                        ))}
                        <th>
                          Peso<small> kg</small>
                        </th>
                        <th>Estágios</th>
                        {editable && <th aria-label="Ações" />}
                      </tr>
                    </thead>
                    <tbody>
                      {family.variants.map((item, i) => (
                        <tr
                          key={item.id}
                          data-testid="pump-row"
                          data-variant-id={item.id}
                          className={i === index ? 'is-preview' : undefined}
                          onClick={() => setRow(i)}
                          onFocus={() => setRow(i)}
                          title={item.models.join(', ')}
                        >
                          {editable ? (
                            <>
                              <td>
                                <TextCell
                                  value={item.models.join(', ')}
                                  testId={`pump-cell-${i}-models`}
                                  onCommit={(text) =>
                                    updateVariant(i, {
                                      models: text
                                        .split(',')
                                        .map((m) => m.trim())
                                        .filter(Boolean),
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <TextCell
                                  value={item.frame}
                                  className="cell cell--frame"
                                  testId={`pump-cell-${i}-frame`}
                                  onCommit={(frame) => updateVariant(i, { frame })}
                                />
                              </td>
                              <FlangeCells
                                flange={item.suction}
                                testId={`pump-cell-${i}-suction`}
                                onCommit={(suction) => updateVariant(i, { suction })}
                              />
                              <FlangeCells
                                flange={item.discharge}
                                testId={`pump-cell-${i}-discharge`}
                                onCommit={(discharge) => updateVariant(i, { discharge })}
                              />
                              {PUMP_DIMENSION_KEYS.map((key) => (
                                <td key={key}>
                                  <NumberCell
                                    value={mToMm(item.dimensions[key])}
                                    digits={1}
                                    testId={`pump-cell-${i}-${key}`}
                                    onCommit={(v) =>
                                      v !== undefined && updateDimension(i, key, mmToM(v))
                                    }
                                  />
                                </td>
                              ))}
                              <td>
                                <NumberCell
                                  value={item.weightKg}
                                  digits={1}
                                  optional
                                  testId={`pump-cell-${i}-weight`}
                                  onCommit={(weightKg) => {
                                    const { weightKg: _previous, ...rest } = item;
                                    replaceVariant(
                                      i,
                                      weightKg === undefined ? rest : { ...rest, weightKg },
                                    );
                                  }}
                                />
                              </td>
                              <td>
                                <NumberCell
                                  value={item.stages}
                                  digits={0}
                                  integer
                                  testId={`pump-cell-${i}-stages`}
                                  onCommit={(stages) =>
                                    stages !== undefined && updateVariant(i, { stages })
                                  }
                                />
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="btn btn--icon"
                                  aria-label={`Remover a linha ${i + 1}`}
                                  data-testid="pump-row-remove"
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
                              <td>{pumpModelRange(item)}</td>
                              <td>{item.frame}</td>
                              <td>{pumpFlangeLabel(item.suction)}</td>
                              <td>{pumpFlangeLabel(item.discharge)}</td>
                              {PUMP_DIMENSION_KEYS.map((key) => (
                                <td key={key}>{millimeters(item.dimensions[key])}</td>
                              ))}
                              <td>
                                {item.weightKg === undefined
                                  ? '—'
                                  : item.weightKg.toLocaleString('pt-BR')}
                              </td>
                              <td>{item.stages}</td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {family.variants.length === 0 && (
                  <p className="warn" data-testid="pump-library-no-rows">
                    A família precisa de ao menos uma linha na tabela para ser salva.
                  </p>
                )}
                {editable && (
                  <p className="muted families__source" data-testid="pump-library-custom-note">
                    As cotas desta tabela são do usuário: no painel de propriedades e no IFC
                    aparecem como definidas pelo usuário, não como dado de fabricante. Os flanges
                    continuam vindo da tabela única, pela classe PN de cada boca.
                  </p>
                )}
                <div className="products__notes" data-testid="pump-library-legend">
                  <span className="section__title">Cotas do dimensional</span>
                  <ul>
                    <li>
                      <strong>A</strong>: flange de sucção (DN e classe); <strong>B</strong>: flange
                      de descarga
                    </li>
                    {PUMP_DIMENSION_KEYS.map((key) => (
                      <li key={key}>
                        <strong>{PUMP_DIMENSION_LABELS[key].letter}</strong>:{' '}
                        {PUMP_DIMENSION_LABELS[key].description}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="products__notes" data-testid="pump-library-approximations">
                  <span className="section__title">Não tabulado (derivado ou representação)</span>
                  <ul>
                    {family.approximations.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
                {family.remarks.length > 0 && (
                  <div className="products__notes" data-testid="pump-library-remarks">
                    <span className="section__title">Observações da transcrição</span>
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
                data-testid="pump-preview"
                data-variant-id={variant?.id ?? ''}
                data-state={model?.ok ? 'model' : 'empty'}
              >
                <div className="families__preview-view">
                  {open && model?.ok && <FamilyPreview element={model.pump} />}
                  {model && !model.ok && (
                    <p className="muted" data-testid="pump-preview-message">
                      {model.reason}
                    </p>
                  )}
                </div>
                <figcaption className="muted">
                  {variant && <strong>{pumpVariantLabel(variant)}</strong>} Clique em uma linha para
                  ver o modelo. Arraste para girar; role para aproximar.
                  {model?.ok && variant && (
                    <span className="products__extent" data-testid="pump-preview-extent">
                      Bocas em {model.spec.standard} · F {millimeters(model.pump.length)} mm · I{' '}
                      {millimeters(variant.dimensions.axisHeight)} mm · J{' '}
                      {millimeters(variant.dimensions.totalHeight)} mm
                      {Math.abs(pumpLengthMismatch(variant.dimensions)) > 0.0005
                        ? ` · F − (C + D + E) = ${millimeters(pumpLengthMismatch(variant.dimensions))} mm`
                        : ''}
                    </span>
                  )}
                </figcaption>
              </figure>
            </div>

            <div className="families__actions">
              <button
                type="button"
                className="btn"
                data-testid="pump-library-duplicate"
                disabled={dirty}
                onClick={duplicate}
                title="Cria no projeto uma cópia desta família, com a tabela de cotas editável."
              >
                <CopyPlus size={15} /> Duplicar como família personalizável
              </button>
              <button
                type="button"
                className="btn"
                data-testid="pump-row-add"
                disabled={family.variants.length === 0 || (!editable && dirty)}
                onClick={addRow}
                title={
                  editable
                    ? 'Acrescenta uma linha (cópia da última, com o modelo "Novo modelo") para preencher.'
                    : 'A tabela do fabricante não é alterada: cria uma cópia personalizável da família e acrescenta nela a linha nova.'
                }
              >
                <Plus size={15} /> {editable ? 'Linha' : 'Nova linha (em cópia personalizável)'}
              </button>
              {editable && (
                <>
                  <button
                    type="button"
                    className="btn"
                    data-testid="pump-family-delete"
                    onClick={() => {
                      useEditorStore.getState().deletePumpFamily(family.id);
                      setSelectedId(null);
                    }}
                    title="As bombas do projeto mantêm a forma e as cotas, sem vínculo com a família."
                  >
                    <Trash2 size={15} /> Excluir família
                  </button>
                  <label
                    className="check"
                    title="Recalcula as bombas já inseridas que usam uma linha desta família e reajusta os tubos conectados."
                  >
                    <input
                      type="checkbox"
                      data-testid="pump-family-apply"
                      checked={applyToInstances}
                      onChange={(event) => setApplyToInstances(event.target.checked)}
                    />
                    Aplicar às {instances} bomba(s) do projeto
                  </label>
                  <button
                    type="button"
                    className="btn btn--primary"
                    data-testid="pump-family-save"
                    disabled={!dirty}
                    onClick={() =>
                      useEditorStore.getState().savePumpFamily(family, applyToInstances)
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
