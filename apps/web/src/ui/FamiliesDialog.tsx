import { BUILTIN_FAMILIES, SPECIFICATIONS } from '@hydrobim/catalog';
import {
  degToRad,
  END_TYPES,
  mmToM,
  mToMm,
  newId,
  radToDeg,
  type EndType,
  type FamilyKind,
  type FamilySize,
  type FittingFamily,
} from '@hydrobim/core';
import { CopyPlus, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { catalogDimensions } from '../editor/familyDimensions';
import { buildFamilyPreview } from '../editor/familyPreview';
import { familiesOf, useEditorStore } from '../state/editorStore';
import { FamilyPreview } from '../viewport/FamilyPreview';
import { formatDecimal, parseDecimal } from './fields';
import { FlangeLibrary } from './FlangeLibrary';
import { ProductLibrary } from './ProductLibrary';
import { TankLibrary } from './TankLibrary';

/** Filtro de especificação que lista as famílias de todas as especificações. */
const ALL_SPECIFICATIONS = 'all';

const KIND_LABELS: Record<FamilyKind, string> = {
  elbow: 'Joelhos e curvas',
  tee: 'Tês',
  reducer: 'Reduções',
  valve: 'Válvulas',
};
const END_LABELS: Record<EndType, string> = {
  plain: 'Ponta lisa',
  socket: 'Bolsa',
  flange: 'Flange',
};

type Path =
  keyof FamilySize | 'end.length' | 'end.outerDiameter' | 'end2.length' | 'end2.outerDiameter';

interface Column {
  path: Path;
  label: string;
  title: string;
  /** DN é adimensional; as demais colunas são comprimentos exibidos em mm. */
  raw?: boolean;
}

function columnsFor(family: FittingFamily): Column[] {
  const endName = family.endType === 'flange' ? 'Flange' : 'Bolsa';
  const depth = family.endType === 'flange' ? 'espessura' : 'profundidade';
  const end: Column[] =
    family.endType === 'plain'
      ? []
      : [
          {
            path: 'end.length',
            label: `${endName}: ${depth}`,
            title: `${endName} do lado DN — ${depth} (mm)`,
          },
          {
            path: 'end.outerDiameter',
            label: `${endName}: Ø ext.`,
            title: `${endName} do lado DN — diâmetro externo (mm)`,
          },
        ];
  const end2: Column[] =
    family.endType === 'plain'
      ? []
      : [
          {
            path: 'end2.length',
            label: `${endName} 2: ${depth}`,
            title: `${endName} do lado DN 2 — ${depth} (mm)`,
          },
          {
            path: 'end2.outerDiameter',
            label: `${endName} 2: Ø ext.`,
            title: `${endName} do lado DN 2 — diâmetro externo (mm)`,
          },
        ];
  const dn: Column = { path: 'dn', label: 'DN', title: 'Diâmetro nominal', raw: true };
  switch (family.kind) {
    case 'elbow':
      return [
        dn,
        { path: 'centerToEnd', label: 'Centro à porta', title: 'Do vértice teórico à porta (mm)' },
        ...end,
      ];
    case 'tee':
      return [
        dn,
        {
          path: 'dn2',
          label: 'DN deriv.',
          title: 'DN da derivação (vazio = igual à passagem)',
          raw: true,
        },
        {
          path: 'centerToEnd',
          label: 'Centro à passagem',
          title: 'Do centro à porta da passagem (mm)',
        },
        {
          path: 'centerToBranch',
          label: 'Centro à deriv.',
          title: 'Do eixo da passagem à porta da derivação (mm)',
        },
        ...end,
        ...end2,
      ];
    case 'reducer':
      return [
        dn,
        { path: 'dn2', label: 'DN menor', title: 'DN da extremidade menor', raw: true },
        { path: 'length', label: 'Comprimento', title: 'Distância entre as portas (mm)' },
        ...end,
        ...end2,
      ];
    case 'valve':
      return [
        dn,
        {
          path: 'length',
          label: 'Face a face',
          title: 'Comprimento entre portas; na ventosa, altura acima da porta (mm)',
        },
        {
          path: 'height',
          label: family.valveType === 'strainer' ? 'Eixo ao fundo' : 'Altura',
          title:
            family.valveType === 'strainer'
              ? 'Do eixo ao ponto mais baixo do bojo do filtro (mm)'
              : 'Do eixo ao topo do acionamento (mm)',
        },
        {
          path: 'handwheelDiameter',
          label: 'Volante',
          title: 'Diâmetro do volante ou comprimento da alavanca (mm)',
        },
        {
          path: 'width',
          label: 'Largura',
          title: 'Largura máxima / diâmetro da tampa do atuador (mm)',
        },
        ...end,
      ];
  }
}

function readCell(size: FamilySize, path: Path): number | undefined {
  if (path.startsWith('end')) {
    const [group, field] = path.split('.') as ['end' | 'end2', 'length' | 'outerDiameter'];
    return size[group]?.[field];
  }
  return size[path as keyof FamilySize] as number | undefined;
}

function writeCell(size: FamilySize, path: Path, value: number | undefined): FamilySize {
  if (path.startsWith('end')) {
    const [group, field] = path.split('.') as ['end' | 'end2', 'length' | 'outerDiameter'];
    const current = size[group] ?? { length: 0, outerDiameter: 0 };
    const next = { ...current, [field]: value ?? 0 };
    // Uma extremidade sem dimensões deixa de existir (ponta lisa nesse lado).
    if (next.length === 0 && next.outerDiameter === 0) {
      const { [group]: _removed, ...rest } = size;
      return rest as FamilySize;
    }
    return { ...size, [group]: next };
  }
  if (value === undefined) {
    const { [path as keyof FamilySize]: _removed, ...rest } = size;
    return rest as FamilySize;
  }
  return { ...size, [path]: value };
}

function Cell({
  value,
  raw,
  onCommit,
  testId,
}: {
  value: number | undefined;
  raw?: boolean;
  onCommit: (value: number | undefined) => void;
  testId: string;
}) {
  const display = value === undefined ? '' : formatDecimal(raw ? value : mToMm(value), 2);
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
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        event.stopPropagation();
      }}
      onBlur={() => {
        if (text.trim() === '') {
          setInvalid(false);
          if (value !== undefined) onCommit(undefined);
          return;
        }
        const parsed = parseDecimal(text);
        if (!Number.isFinite(parsed) || parsed < 0) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        const next = raw ? parsed : mmToM(parsed);
        if (value === undefined || Math.abs(next - value) > 1e-9) onCommit(next);
      }}
    />
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Catálogo: famílias de conexões (consulta e edição das tabelas dimensionais, gravadas no
 * projeto sobre o catálogo embutido), reservatórios e biblioteca de produtos 3D.
 */
export function FamiliesDialog({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const project = useEditorStore((s) => s.project);
  const activeSpecification = useEditorStore((s) => s.activeSpec.specificationId);
  const families = useMemo(() => familiesOf(project), [project]);

  const [specificationId, setSpecificationId] = useState(activeSpecification);
  const [kind, setKind] = useState<FamilyKind | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FittingFamily | null>(null);
  const [applyToInstances, setApplyToInstances] = useState(true);
  /** Linha da tabela mostrada no modelo 3D. */
  const [previewRow, setPreviewRow] = useState(0);
  /** Cotas de catálogo sobre o modelo 3D. */
  const [showDimensions, setShowDimensions] = useState(true);
  /** Aba: conexões (editáveis), reservatórios ou biblioteca de produtos (modelos 3D). */
  const [tab, setTab] = useState<'fittings' | 'flanges' | 'tanks' | 'products'>('fittings');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setSpecificationId(activeSpecification);
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
  }, [open, activeSpecification]);

  const visible = families
    .filter(
      (f) =>
        (specificationId === ALL_SPECIFICATIONS || f.specificationId === specificationId) &&
        (kind === 'all' || f.kind === kind),
    )
    .sort(
      (a, b) =>
        a.specificationId.localeCompare(b.specificationId) ||
        a.kind.localeCompare(b.kind) ||
        a.name.localeCompare(b.name, 'pt-BR'),
    );
  const specificationName = (id: string): string =>
    SPECIFICATIONS.find((s) => s.id === id)?.name ?? id;
  const stored = families.find((f) => f.id === selectedId) ?? null;

  // Ao trocar de família (ou após salvar), o rascunho volta a refletir o que está gravado.
  useEffect(() => {
    setDraft(stored);
  }, [stored]);
  useEffect(() => {
    setPreviewRow(0);
  }, [selectedId]);

  const dirty = draft !== null && stored !== null && draft !== stored;
  const hasBuiltin = draft ? BUILTIN_FAMILIES.some((f) => f.id === draft.id) : false;
  const instances = draft ? project.elements.filter((e) => e.familyId === draft.id).length : 0;
  const columns = draft ? columnsFor(draft) : [];

  // O modelo acompanha o rascunho: cada célula confirmada regenera a peça.
  const previewIndex = draft ? Math.min(previewRow, draft.sizes.length - 1) : -1;
  const previewSize = draft?.sizes[previewIndex];
  const preview = useMemo(
    () => (draft && previewSize ? buildFamilyPreview(project, draft, previewSize) : null),
    [project, draft, previewSize],
  );
  const dimensions = useMemo(
    () => (preview?.ok && showDimensions ? catalogDimensions(preview.element) : []),
    [preview, showDimensions],
  );

  const updateSize = (index: number, path: Path, value: number | undefined): void => {
    if (!draft) return;
    setDraft({
      ...draft,
      sizes: draft.sizes.map((size, i) => (i === index ? writeCell(size, path, value) : size)),
    });
  };

  const save = (): void => {
    if (!draft) return;
    useEditorStore.getState().saveFamily(draft, applyToInstances);
  };

  const duplicate = (): void => {
    if (!draft) return;
    const copy: FittingFamily = {
      ...draft,
      id: `custom-${newId()}`,
      name: `${draft.name} (cópia)`,
      origin: 'custom',
      source: `Família criada no projeto a partir de "${draft.name}". ${draft.source}`,
    };
    if (useEditorStore.getState().saveFamily(copy, false)) setSelectedId(copy.id);
  };

  return (
    <dialog
      ref={dialogRef}
      className="dialog dialog--wide dialog--families"
      data-testid="families-dialog"
      onClose={onClose}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="dialog__header">
        <h2>Catálogo</h2>
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'fittings'}
            className={tab === 'fittings' ? 'tabs__item is-active' : 'tabs__item'}
            data-testid="families-tab-fittings"
            onClick={() => setTab('fittings')}
          >
            Conexões
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'flanges'}
            className={tab === 'flanges' ? 'tabs__item is-active' : 'tabs__item'}
            data-testid="families-tab-flanges"
            onClick={() => setTab('flanges')}
          >
            Flanges e tubos flangeados
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'tanks'}
            className={tab === 'tanks' ? 'tabs__item is-active' : 'tabs__item'}
            data-testid="families-tab-tanks"
            onClick={() => setTab('tanks')}
          >
            Reservatórios
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'products'}
            className={tab === 'products' ? 'tabs__item is-active' : 'tabs__item'}
            data-testid="families-tab-products"
            onClick={() => setTab('products')}
          >
            Biblioteca de produtos (3D)
          </button>
        </div>
        <button
          type="button"
          className="btn btn--icon"
          onClick={onClose}
          aria-label="Fechar"
          data-testid="families-close"
        >
          <X size={16} />
        </button>
      </header>

      {tab === 'flanges' && <FlangeLibrary open={open} onUse={onClose} />}
      {tab === 'products' && <ProductLibrary open={open} />}
      {tab === 'tanks' && <TankLibrary open={open} onUse={onClose} />}
      <div className="families" hidden={tab !== 'fittings'}>
        <aside className="families__list">
          <label className="stack">
            <span className="section__title">Especificação de tubo</span>
            <select
              data-testid="families-specification"
              value={specificationId}
              onChange={(event) => {
                setSpecificationId(event.target.value);
                setSelectedId(null);
              }}
            >
              <option value={ALL_SPECIFICATIONS}>Todas as especificações</option>
              {SPECIFICATIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="stack">
            <span className="section__title">Tipo</span>
            <select
              data-testid="families-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as FamilyKind | 'all')}
            >
              <option value="all">Todos</option>
              {(Object.keys(KIND_LABELS) as FamilyKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <ul className="element-list" data-testid="families-list">
            {visible.length === 0 && (
              <li className="muted">
                Nenhuma família de catálogo para esta especificação. As peças usam dimensões
                genéricas.
              </li>
            )}
            {visible.map((family) => (
              <li key={family.id}>
                <button
                  type="button"
                  data-testid="family-item"
                  data-family-id={family.id}
                  className={
                    family.id === selectedId ? 'element-list__item is-active' : 'element-list__item'
                  }
                  onClick={() => setSelectedId(family.id)}
                >
                  <span>{family.name}</span>
                  <span className="muted">
                    {family.origin === 'custom'
                      ? 'personalizada'
                      : (family.manufacturer ?? family.standard)}
                    {specificationId === ALL_SPECIFICATIONS
                      ? ` · ${specificationName(family.specificationId)}`
                      : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="families__detail">
          {!draft && (
            <p className="muted">
              Selecione uma família para consultar e editar suas dimensões. As alterações são
              gravadas neste projeto e sobrepõem o catálogo embutido.
            </p>
          )}
          {draft && (
            <>
              <div className="families__meta">
                <label className="stack">
                  <span className="section__title">Nome</span>
                  <input
                    data-testid="family-name"
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    onKeyDown={(event) => event.stopPropagation()}
                  />
                </label>
                <label className="stack">
                  <span className="section__title">Extremidades</span>
                  <select
                    data-testid="family-end-type"
                    value={draft.endType}
                    onChange={(event) =>
                      setDraft({ ...draft, endType: event.target.value as EndType })
                    }
                  >
                    {END_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {END_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </label>
                {draft.kind === 'elbow' && (
                  <label className="stack">
                    <span className="section__title">Ângulo (°)</span>
                    <Cell
                      raw
                      testId="family-angle"
                      value={
                        draft.angle === undefined
                          ? undefined
                          : Math.round(radToDeg(draft.angle) * 1000) / 1000
                      }
                      onCommit={(value) => value && setDraft({ ...draft, angle: degToRad(value) })}
                    />
                  </label>
                )}
              </div>
              <p className="muted families__source">
                <strong>{draft.origin === 'custom' ? 'Personalizada neste projeto. ' : ''}</strong>
                {draft.manufacturer ? `${draft.manufacturer} · ` : ''}
                {draft.standard} · Fonte: {draft.source}
              </p>

              <div className="families__body">
                <div className="families__table">
                  <table data-testid="family-table">
                    <thead>
                      <tr>
                        {columns.map((column) => (
                          <th key={column.path} title={column.title}>
                            {column.label}
                            {!column.raw && <small> mm</small>}
                          </th>
                        ))}
                        <th aria-label="Ações" />
                      </tr>
                    </thead>
                    <tbody>
                      {draft.sizes.map((size, index) => (
                        <tr
                          key={index}
                          data-testid="family-row"
                          data-dn={size.dn}
                          className={index === previewIndex ? 'is-preview' : undefined}
                          onClick={() => setPreviewRow(index)}
                          onFocus={() => setPreviewRow(index)}
                        >
                          {columns.map((column) => (
                            <td key={column.path}>
                              <Cell
                                raw={column.raw}
                                value={readCell(size, column.path)}
                                testId={`family-cell-${index}-${column.path}`}
                                onCommit={(value) => updateSize(index, column.path, value)}
                              />
                            </td>
                          ))}
                          <td>
                            <button
                              type="button"
                              className="btn btn--icon"
                              aria-label={`Remover a linha do DN ${size.dn}`}
                              onFocus={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (index < previewRow) setPreviewRow(previewRow - 1);
                                setDraft({
                                  ...draft,
                                  sizes: draft.sizes.filter((_, i) => i !== index),
                                });
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <figure
                  className="families__preview"
                  data-testid="family-preview"
                  data-dn={previewSize?.dn}
                  data-state={preview?.ok ? 'model' : 'empty'}
                  data-dimensions={dimensions.map((d) => d.key).join(' ')}
                >
                  <div className="families__preview-view">
                    {open && tab === 'fittings' && preview?.ok && (
                      <FamilyPreview element={preview.element} dimensions={dimensions} />
                    )}
                    {preview && !preview.ok && (
                      <p className="muted" data-testid="family-preview-message">
                        {preview.reason}
                      </p>
                    )}
                    {!preview && <p className="muted">A família não tem linhas.</p>}
                  </div>
                  <figcaption className="muted">
                    {previewSize && (
                      <strong>
                        DN {previewSize.dn}
                        {previewSize.dn2 ? ` × ${previewSize.dn2}` : ''}
                      </strong>
                    )}{' '}
                    Clique em uma linha para ver o modelo. Arraste para girar; role para aproximar.
                    <label className="families__preview-toggle">
                      <input
                        type="checkbox"
                        data-testid="family-preview-dimensions"
                        checked={showDimensions}
                        onChange={(event) => setShowDimensions(event.target.checked)}
                      />
                      Mostrar as cotas do catálogo (mm)
                    </label>
                  </figcaption>
                </figure>
              </div>

              <div className="families__actions">
                <button
                  type="button"
                  className="btn"
                  data-testid="family-add-row"
                  onClick={() => {
                    const last = draft.sizes[draft.sizes.length - 1];
                    setDraft({
                      ...draft,
                      sizes: [...draft.sizes, { ...(last ?? {}), dn: (last?.dn ?? 0) + 1 }],
                    });
                  }}
                >
                  <Plus size={15} /> Linha
                </button>
                <button
                  type="button"
                  className="btn"
                  data-testid="family-duplicate"
                  onClick={duplicate}
                >
                  <CopyPlus size={15} /> Duplicar como nova família
                </button>
                {draft.origin === 'custom' && hasBuiltin && (
                  <button
                    type="button"
                    className="btn"
                    data-testid="family-reset"
                    onClick={() => useEditorStore.getState().resetFamily(draft.id)}
                  >
                    <RotateCcw size={15} /> Restaurar catálogo
                  </button>
                )}
                <label
                  className="check"
                  title="Recalcula as peças já inseridas que usam esta família e reajusta os tubos vizinhos."
                >
                  <input
                    type="checkbox"
                    data-testid="family-apply"
                    checked={applyToInstances}
                    onChange={(event) => setApplyToInstances(event.target.checked)}
                  />
                  Aplicar às {instances} peça(s) do projeto
                </label>
                <button
                  type="button"
                  className="btn btn--primary"
                  data-testid="family-save"
                  disabled={!dirty}
                  onClick={save}
                >
                  <Save size={15} /> Salvar no projeto
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </dialog>
  );
}
