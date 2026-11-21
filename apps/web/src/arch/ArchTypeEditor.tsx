import {
  ARCH_CATEGORY_LABELS,
  ARCH_HATCHES,
  ARCH_LAYER_FUNCTIONS,
  archTypeUsage,
  DOOR_OPERATION_LABELS,
  DOOR_OPERATIONS,
  duplicateArchType,
  getArchType,
  layersThickness,
  newId,
  removeArchType,
  updateArchType,
  WINDOW_OPERATION_LABELS,
  WINDOW_OPERATIONS,
  type ArchCategory,
  type ArchClassification,
  type ArchHatch,
  type ArchLayer,
  type ArchLayerFunction,
  type ArchType,
  type ArchTypeInput,
  type Project,
} from '@hydrobim/core';
import {
  ARCH_IFC_ENTITIES,
  archTypeProperties,
  IFC_ENTITIES,
  IFC_ORIGIN_LABELS,
  setArchIfcValue,
  type IfcPropertyInfo,
  type IfcValue,
} from '@hydrobim/ifc';
import { ArrowDown, ArrowUp, CopyPlus, Eraser, Plus, Save, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useEditorStore } from '../state/editorStore';
import '../styles/architecture.css';
import { formatDecimal, parseDecimal } from '../ui/fields';
import { displayOf, editTextOf, formatIfcValue, parseIfcInput } from '../ui/ifcFormat';
import { ArchPreview2D, ArchPreview3D, archPreviewNote } from './archPreview';

/**
 * Editor de um TIPO arquitetônico do projeto: parâmetros (camadas ou dimensões do vão), tipo
 * predefinido IFC, dados do produto, classificações externas e propriedades IFC do tipo.
 *
 * Nenhuma regra de modelagem mora aqui: a alteração é uma operação pura de `@hydrobim/core`
 * (`updateArchType`), que vale para todas as ocorrências do tipo ou é recusada por inteiro.
 * Antes de gravar, o editor mostra quantas e quais ocorrências serão afetadas.
 */

// ---------------------------------------------------------------------------
// Funções puras
// ---------------------------------------------------------------------------

export const LAYER_FUNCTION_LABELS: Record<ArchLayerFunction, string> = {
  structure: 'Estrutura',
  substrate: 'Base (substrato)',
  finish: 'Acabamento',
  insulation: 'Isolamento',
  membrane: 'Membrana',
  other: 'Outra',
};

export const HATCH_LABELS: Record<ArchHatch, string> = {
  none: 'Sem hachura',
  solid: 'Sólida',
  diagonal: 'Diagonal',
  crossed: 'Cruzada',
  dotted: 'Pontilhada',
};

export const CLASSIFICATION_LABELS: Record<ArchClassification['system'], string> = {
  nbr15965: 'ABNT NBR 15965',
  sinapi: 'SINAPI',
  other: 'Outra',
};

const text = (value: string | undefined | null): string => value?.trim() ?? '';

/**
 * Campos do rascunho que o editor grava (sem `id`, categoria, família nem os valores IFC, que
 * têm gravação própria). Textos vazios viram ausência de valor — nunca um texto de enfeite.
 */
export function archTypePatchOf(draft: ArchType): Partial<ArchTypeInput> {
  const manufacturing = {
    ...(text(draft.manufacturing.manufacturer)
      ? { manufacturer: text(draft.manufacturing.manufacturer) }
      : {}),
    ...(text(draft.manufacturing.model) ? { model: text(draft.manufacturing.model) } : {}),
    ...(text(draft.manufacturing.partNumber)
      ? { partNumber: text(draft.manufacturing.partNumber) }
      : {}),
  };
  const common = {
    name: draft.name,
    generic: draft.generic,
    // Modelo genérico não tem fonte; produto sem fonte fica `null` e o núcleo recusa.
    source: draft.generic ? null : text(draft.source) || null,
    manufacturing,
    classifications: draft.classifications.map((entry) => ({
      system: entry.system,
      code: text(entry.code),
      ...(text(entry.table) && entry.system !== 'sinapi' ? { table: text(entry.table) } : {}),
      ...(text(entry.description) ? { description: text(entry.description) } : {}),
    })),
    ifcPredefinedType: draft.ifcPredefinedType,
  };
  if (draft.category === 'door') {
    return {
      ...common,
      operation: draft.operation,
      width: draft.width,
      height: draft.height,
      frameWidth: draft.frameWidth,
      panelThickness: draft.panelThickness,
    };
  }
  if (draft.category === 'window') {
    return {
      ...common,
      operation: draft.operation,
      width: draft.width,
      height: draft.height,
      sillHeight: draft.sillHeight,
      panels: draft.panels,
      frameWidth: draft.frameWidth,
    };
  }
  return { ...common, layers: draft.layers };
}

/** O rascunho difere do tipo gravado em algum campo que o editor grava? */
export function archTypeDirty(stored: ArchType, draft: ArchType): boolean {
  return JSON.stringify(archTypePatchOf(stored)) !== JSON.stringify(archTypePatchOf(draft));
}

/**
 * Preenchimento obrigatório do formulário, conferido antes de chamar o núcleo: é só a falta de
 * um texto (as regras de engenharia — dimensões, encaixe dos vãos, fonte — são do núcleo).
 */
export function archDraftProblem(draft: ArchType): string | null {
  if (text(draft.name).length === 0) return 'Informe o nome do tipo.';
  if (draft.classifications.some((entry) => text(entry.code).length === 0)) {
    return 'Informe o código de cada classificação ou remova a linha em branco.';
  }
  return null;
}

/** Ocorrências que uma alteração do tipo atinge: quantas e quais (nomes). */
export function archTypeAffected(
  project: Pick<Project, 'architecture'>,
  typeId: string,
): { count: number; names: string[] } {
  const used = archTypeUsage(project.architecture, typeId);
  return { count: used.length, names: used.map((element) => element.name || element.id) };
}

/** Enumeração oficial do tipo predefinido da entidade IFC da categoria. */
export function predefinedTypesOf(category: ArchCategory, current?: string): string[] {
  const values = [...(IFC_ENTITIES[ARCH_IFC_ENTITIES[category]]?.predefinedTypes ?? [])];
  // Um valor gravado que a enumeração não traga continua visível (não é trocado em silêncio).
  if (current && !values.includes(current)) values.unshift(current);
  return values;
}

/** Texto de "N ocorrência(s)". */
export const occurrencesText = (count: number): string =>
  count === 0 ? 'nenhuma ocorrência' : count === 1 ? '1 ocorrência' : `${count} ocorrências`;

// ---------------------------------------------------------------------------
// Campos
// ---------------------------------------------------------------------------

function Labeled({ label, unit, children }: { label: string; unit?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <span className="field__control">
        {children}
        {unit && <span className="field__unit">{unit}</span>}
      </span>
    </label>
  );
}

function TextInput({
  value,
  onCommit,
  testId,
  placeholder,
  disabled,
  ariaLabel,
}: {
  value: string;
  onCommit: (value: string) => void;
  testId: string;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      type="text"
      data-testid={testId}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        event.stopPropagation();
      }}
    />
  );
}

/** Número positivo na unidade de apresentação (`factor` = unidade por metro). */
function NumberInput({
  value,
  factor = 1,
  digits = 3,
  integer = false,
  allowZero = false,
  onCommit,
  testId,
  ariaLabel,
}: {
  value: number;
  factor?: number;
  digits?: number;
  integer?: boolean;
  allowZero?: boolean;
  onCommit: (value: number) => void;
  testId: string;
  ariaLabel?: string;
}) {
  const shown = formatDecimal(value * factor, digits);
  const [draft, setDraft] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(shown);
    setInvalid(false);
  }, [shown]);
  return (
    <input
      type="text"
      inputMode="decimal"
      data-testid={testId}
      value={draft}
      aria-label={ariaLabel}
      aria-invalid={invalid}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const parsed = parseDecimal(draft);
        const valid =
          Number.isFinite(parsed) &&
          (allowZero ? parsed >= 0 : parsed > 0) &&
          (!integer || Number.isInteger(parsed));
        setInvalid(!valid);
        if (!valid) return;
        const next = Number((parsed / factor).toPrecision(12));
        if (Math.abs(next - value) > 1e-12) onCommit(next);
        else setDraft(shown);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        event.stopPropagation();
      }}
    />
  );
}

function Select<T extends string>({
  value,
  options,
  onChange,
  testId,
  ariaLabel,
  disabled,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  testId: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <select
      data-testid={testId}
      value={value}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

type LayerUnit = 'cm' | 'mm';
const LAYER_FACTOR: Record<LayerUnit, number> = { cm: 100, mm: 1000 };

function LayersTable({
  layers,
  onChange,
}: {
  layers: readonly ArchLayer[];
  onChange: (layers: ArchLayer[]) => void;
}) {
  const [unit, setUnit] = useState<LayerUnit>('cm');
  const set = (index: number, patch: Partial<ArchLayer>): void =>
    onChange(layers.map((layer, i) => (i === index ? { ...layer, ...patch } : layer)));
  const move = (index: number, offset: number): void => {
    const next = [...layers];
    const [layer] = next.splice(index, 1);
    if (!layer) return;
    next.splice(index + offset, 0, layer);
    onChange(next);
  };
  return (
    <fieldset data-testid="arch-layers">
      <legend>Camadas (na ordem de montagem)</legend>
      <div className="archcat__actions">
        <label className="archcat__check">
          Espessuras em
          <Select
            value={unit}
            testId="arch-layer-unit"
            ariaLabel="Unidade das espessuras"
            options={[
              { value: 'cm', label: 'cm' },
              { value: 'mm', label: 'mm' },
            ]}
            onChange={setUnit}
          />
        </label>
        <span className="muted" data-testid="arch-layers-total">
          Espessura total: {formatDecimal(layersThickness({ layers: [...layers] }) * 100, 2)} cm
        </span>
      </div>
      <table className="archcat__table">
        <thead>
          <tr>
            <th>Material</th>
            <th>Espessura ({unit})</th>
            <th>Função</th>
            <th>Hachura no corte</th>
            <th aria-label="Ações" />
          </tr>
        </thead>
        <tbody>
          {layers.map((layer, index) => (
            <tr key={layer.id} data-testid="arch-layer-row">
              <td>
                <TextInput
                  value={layer.material}
                  testId="arch-layer-material"
                  ariaLabel={`Material da camada ${index + 1}`}
                  onCommit={(material) => set(index, { material })}
                />
              </td>
              <td>
                <NumberInput
                  value={layer.thickness}
                  factor={LAYER_FACTOR[unit]}
                  testId="arch-layer-thickness"
                  ariaLabel={`Espessura da camada ${index + 1}`}
                  onCommit={(thickness) => set(index, { thickness })}
                />
              </td>
              <td>
                <Select
                  value={layer.function}
                  testId="arch-layer-function"
                  ariaLabel={`Função da camada ${index + 1}`}
                  options={ARCH_LAYER_FUNCTIONS.map((value) => ({
                    value,
                    label: LAYER_FUNCTION_LABELS[value],
                  }))}
                  onChange={(value) => set(index, { function: value })}
                />
              </td>
              <td>
                <Select
                  value={layer.hatch}
                  testId="arch-layer-hatch"
                  ariaLabel={`Hachura da camada ${index + 1}`}
                  options={ARCH_HATCHES.map((value) => ({ value, label: HATCH_LABELS[value] }))}
                  onChange={(hatch) => set(index, { hatch })}
                />
              </td>
              <td className="archcat__narrow">
                <button
                  type="button"
                  className="btn btn--icon"
                  data-testid="arch-layer-up"
                  aria-label={`Subir a camada ${index + 1}`}
                  title="Subir a camada"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={13} aria-hidden />
                </button>
                <button
                  type="button"
                  className="btn btn--icon"
                  data-testid="arch-layer-down"
                  aria-label={`Descer a camada ${index + 1}`}
                  title="Descer a camada"
                  disabled={index === layers.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={13} aria-hidden />
                </button>
                <button
                  type="button"
                  className="btn btn--icon"
                  data-testid="arch-layer-remove"
                  aria-label={`Remover a camada ${index + 1}`}
                  title={
                    layers.length === 1
                      ? 'O tipo precisa de ao menos uma camada'
                      : 'Remover a camada'
                  }
                  disabled={layers.length === 1}
                  onClick={() => onChange(layers.filter((_, i) => i !== index))}
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="archcat__actions">
        <button
          type="button"
          className="btn btn--compact"
          data-testid="arch-layer-add"
          title="Acrescenta uma camada ao fim; material e espessura são informados por você"
          onClick={() => {
            const last = layers[layers.length - 1];
            onChange([
              ...layers,
              {
                id: newId(),
                material: 'Nova camada',
                // Ponto de partida de edição: a espessura da última camada, não um dado de catálogo.
                thickness: last?.thickness ?? 0.01,
                function: 'other',
                hatch: 'none',
              },
            ]);
          }}
        >
          <Plus size={13} aria-hidden /> Adicionar camada
        </button>
      </div>
    </fieldset>
  );
}

/** Nome e parâmetros de um tipo (camadas, ou abertura e dimensões da esquadria). */
export function ArchTypeParameters({
  draft,
  onChange,
}: {
  draft: ArchType;
  onChange: (draft: ArchType) => void;
}) {
  return (
    <>
      <fieldset>
        <legend>Tipo</legend>
        <Labeled label="Nome do tipo">
          <TextInput
            value={draft.name}
            testId="arch-type-name"
            onCommit={(name) => onChange({ ...draft, name })}
          />
        </Labeled>
      </fieldset>
      {(draft.category === 'wall' ||
        draft.category === 'slab' ||
        draft.category === 'flooring') && (
        <LayersTable layers={draft.layers} onChange={(layers) => onChange({ ...draft, layers })} />
      )}
      {draft.category === 'door' && (
        <fieldset data-testid="arch-door-fields">
          <legend>Porta</legend>
          <div className="archcat__grid">
            <Labeled label="Abertura">
              <Select
                value={draft.operation}
                testId="arch-type-operation"
                options={DOOR_OPERATIONS.map((value) => ({
                  value,
                  label: DOOR_OPERATION_LABELS[value],
                }))}
                onChange={(operation) => onChange({ ...draft, operation })}
              />
            </Labeled>
            <Labeled label="Largura do vão" unit="m">
              <NumberInput
                value={draft.width}
                testId="arch-type-width"
                onCommit={(width) => onChange({ ...draft, width })}
              />
            </Labeled>
            <Labeled label="Altura do vão" unit="m">
              <NumberInput
                value={draft.height}
                testId="arch-type-height"
                onCommit={(height) => onChange({ ...draft, height })}
              />
            </Labeled>
            <Labeled label="Marco (largura aparente)" unit="cm">
              <NumberInput
                value={draft.frameWidth}
                factor={100}
                testId="arch-type-frame"
                onCommit={(frameWidth) => onChange({ ...draft, frameWidth })}
              />
            </Labeled>
            <Labeled label="Espessura da folha" unit="mm">
              <NumberInput
                value={draft.panelThickness}
                factor={1000}
                testId="arch-type-panel"
                onCommit={(panelThickness) => onChange({ ...draft, panelThickness })}
              />
            </Labeled>
          </div>
        </fieldset>
      )}
      {draft.category === 'window' && (
        <fieldset data-testid="arch-window-fields">
          <legend>Janela</legend>
          <div className="archcat__grid">
            <Labeled label="Abertura">
              <Select
                value={draft.operation}
                testId="arch-type-operation"
                options={WINDOW_OPERATIONS.map((value) => ({
                  value,
                  label: WINDOW_OPERATION_LABELS[value],
                }))}
                onChange={(operation) => onChange({ ...draft, operation })}
              />
            </Labeled>
            <Labeled label="Largura do vão" unit="m">
              <NumberInput
                value={draft.width}
                testId="arch-type-width"
                onCommit={(width) => onChange({ ...draft, width })}
              />
            </Labeled>
            <Labeled label="Altura do vão" unit="m">
              <NumberInput
                value={draft.height}
                testId="arch-type-height"
                onCommit={(height) => onChange({ ...draft, height })}
              />
            </Labeled>
            <Labeled label="Peitoril ao inserir" unit="m">
              <NumberInput
                value={draft.sillHeight}
                allowZero
                testId="arch-type-sill"
                onCommit={(sillHeight) => onChange({ ...draft, sillHeight })}
              />
            </Labeled>
            <Labeled label="Número de folhas">
              <NumberInput
                value={draft.panels}
                integer
                digits={0}
                testId="arch-type-panels"
                onCommit={(panels) => onChange({ ...draft, panels })}
              />
            </Labeled>
            <Labeled label="Marco (largura aparente)" unit="cm">
              <NumberInput
                value={draft.frameWidth}
                factor={100}
                testId="arch-type-frame"
                onCommit={(frameWidth) => onChange({ ...draft, frameWidth })}
              />
            </Labeled>
          </div>
        </fieldset>
      )}
    </>
  );
}

/** Prévias 2D e 3D do tipo (ou do rascunho em edição). */
export function ArchPreviewPanel({ type }: { type: ArchType }) {
  return (
    <figure className="archcat__preview" data-testid="arch-preview">
      <div className="archcat__preview-view">
        <ArchPreview2D type={type} />
      </div>
      <div className="archcat__preview-view">
        <ArchPreview3D type={type} />
      </div>
      <figcaption data-testid="arch-preview-note">
        {archPreviewNote(type)} O modelo 3D usa a malha real do tipo; arraste para girar.
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Classificação IFC, produto e classificações externas
// ---------------------------------------------------------------------------

function ProductFields({
  draft,
  onChange,
}: {
  draft: ArchType;
  onChange: (draft: ArchType) => void;
}) {
  const entity = ARCH_IFC_ENTITIES[draft.category];
  const setManufacturing = (patch: Partial<ArchType['manufacturing']>): void =>
    onChange({ ...draft, manufacturing: { ...draft.manufacturing, ...patch } });
  const setClassification = (index: number, patch: Partial<ArchClassification>): void =>
    onChange({
      ...draft,
      classifications: draft.classifications.map((entry, i) =>
        i === index ? { ...entry, ...patch } : entry,
      ),
    });
  const addClassification = (system: ArchClassification['system']): void =>
    onChange({ ...draft, classifications: [...draft.classifications, { system, code: '' }] });
  return (
    <>
      <fieldset data-testid="arch-ifc-class">
        <legend>Enquadramento IFC</legend>
        <div className="archcat__grid">
          <Labeled label={`Tipo predefinido (${entity})`}>
            <Select
              value={draft.ifcPredefinedType}
              testId="arch-type-predefined"
              options={predefinedTypesOf(draft.category, draft.ifcPredefinedType).map((value) => ({
                value,
                label: value,
              }))}
              onChange={(ifcPredefinedType) => onChange({ ...draft, ifcPredefinedType })}
            />
          </Labeled>
        </div>
      </fieldset>

      <fieldset data-testid="arch-product">
        <legend>Produto</legend>
        <label className="archcat__check">
          <input
            type="checkbox"
            data-testid="arch-type-generic"
            checked={draft.generic}
            onChange={(event) => onChange({ ...draft, generic: event.target.checked })}
          />
          Modelo genérico (dimensões e composição definidas no projeto, sem produto comercial)
        </label>
        {!draft.generic && (
          <>
            <Labeled label="Fonte dos dados">
              <TextInput
                value={draft.source ?? ''}
                testId="arch-type-source"
                placeholder="Fabricante, catálogo, edição, página e URL"
                onCommit={(source) => onChange({ ...draft, source })}
              />
            </Labeled>
            <p className="archcat__notice" data-testid="arch-source-notice">
              Produto comercial exige a fonte (fabricante, catálogo, edição, página e URL). Informe
              só o que o documento traz: nenhuma medida, classificação, resistência ao fogo ou
              desempenho é preenchido pelo HydroBIM.
            </p>
          </>
        )}
        <div className="archcat__grid">
          <Labeled label="Fabricante">
            <TextInput
              value={draft.manufacturing.manufacturer ?? ''}
              testId="arch-type-manufacturer"
              onCommit={(manufacturer) => setManufacturing({ manufacturer })}
            />
          </Labeled>
          <Labeled label="Modelo">
            <TextInput
              value={draft.manufacturing.model ?? ''}
              testId="arch-type-model"
              onCommit={(model) => setManufacturing({ model })}
            />
          </Labeled>
          <Labeled label="Código">
            <TextInput
              value={draft.manufacturing.partNumber ?? ''}
              testId="arch-type-part-number"
              onCommit={(partNumber) => setManufacturing({ partNumber })}
            />
          </Labeled>
        </div>
      </fieldset>

      <fieldset data-testid="arch-classifications">
        <legend>Classificações externas (complementam a entidade IFC)</legend>
        {draft.classifications.length === 0 ? (
          <p className="muted" data-testid="arch-classifications-empty">
            Não classificado (NC). Os códigos são informados por você: não há tabela embutida.
          </p>
        ) : (
          <table className="archcat__table">
            <thead>
              <tr>
                <th>Sistema</th>
                <th>Tabela / nome do sistema</th>
                <th>Código</th>
                <th>Descrição</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {draft.classifications.map((entry, index) => (
                <tr key={index} data-testid="arch-classification-row">
                  <td>
                    <Select
                      value={entry.system}
                      testId="arch-classification-system"
                      ariaLabel={`Sistema da classificação ${index + 1}`}
                      options={(['nbr15965', 'sinapi', 'other'] as const).map((value) => ({
                        value,
                        label: CLASSIFICATION_LABELS[value],
                      }))}
                      onChange={(system) => setClassification(index, { system })}
                    />
                  </td>
                  <td>
                    <TextInput
                      value={entry.table ?? ''}
                      testId="arch-classification-table"
                      ariaLabel={`Tabela da classificação ${index + 1}`}
                      disabled={entry.system === 'sinapi'}
                      placeholder={
                        entry.system === 'nbr15965'
                          ? 'Tabela (ex.: 3E)'
                          : entry.system === 'other'
                            ? 'Nome do sistema'
                            : '—'
                      }
                      onCommit={(table) => setClassification(index, { table })}
                    />
                  </td>
                  <td>
                    <TextInput
                      value={entry.code}
                      testId="arch-classification-code"
                      ariaLabel={`Código da classificação ${index + 1}`}
                      onCommit={(code) => setClassification(index, { code })}
                    />
                  </td>
                  <td>
                    <TextInput
                      value={entry.description ?? ''}
                      testId="arch-classification-description"
                      ariaLabel={`Descrição da classificação ${index + 1}`}
                      onCommit={(description) => setClassification(index, { description })}
                    />
                  </td>
                  <td className="archcat__narrow">
                    <button
                      type="button"
                      className="btn btn--icon"
                      data-testid="arch-classification-remove"
                      aria-label={`Remover a classificação ${index + 1}`}
                      title="Remover a classificação"
                      onClick={() =>
                        onChange({
                          ...draft,
                          classifications: draft.classifications.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="archcat__actions">
          <button
            type="button"
            className="btn btn--compact"
            data-testid="arch-classification-add-nbr"
            onClick={() => addClassification('nbr15965')}
          >
            <Plus size={13} aria-hidden /> NBR 15965
          </button>
          <button
            type="button"
            className="btn btn--compact"
            data-testid="arch-classification-add-sinapi"
            onClick={() => addClassification('sinapi')}
          >
            <Plus size={13} aria-hidden /> SINAPI
          </button>
          <button
            type="button"
            className="btn btn--compact"
            data-testid="arch-classification-add-other"
            onClick={() => addClassification('other')}
          >
            <Plus size={13} aria-hidden /> Outra
          </button>
        </div>
      </fieldset>
    </>
  );
}

// ---------------------------------------------------------------------------
// Propriedades IFC do tipo
// ---------------------------------------------------------------------------

const isBoolean = (property: IfcPropertyInfo): boolean =>
  property.ifcType === 'IfcBoolean' || property.ifcType === 'IfcLogical';

function IfcValueCell({
  property,
  disabled,
  onCommit,
}: {
  property: IfcPropertyInfo;
  disabled: boolean;
  onCommit: (value: IfcValue | null) => void;
}) {
  const shown = editTextOf(property);
  const [draft, setDraft] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(shown);
    setInvalid(false);
  }, [shown]);
  const testId = `arch-ifc-value-${property.key}`;
  if (!property.editable) return <span>{formatIfcValue(property) ?? '—'}</span>;
  if (isBoolean(property)) {
    const value = property.value === true ? 'true' : property.value === false ? 'false' : '';
    return (
      <select
        data-testid={testId}
        aria-label={property.label}
        value={value}
        disabled={disabled}
        onChange={(event) =>
          onCommit(event.target.value === '' ? null : event.target.value === 'true')
        }
      >
        <option value="">(não informado)</option>
        <option value="true">Sim</option>
        <option value="false">Não</option>
      </select>
    );
  }
  if (property.enumeration) {
    return (
      <select
        data-testid={testId}
        aria-label={property.label}
        value={typeof property.value === 'string' ? property.value : ''}
        disabled={disabled}
        onChange={(event) => onCommit(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">(não informado)</option>
        {property.enumeration.values.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      type="text"
      data-testid={testId}
      aria-label={property.label}
      aria-invalid={invalid}
      value={draft}
      disabled={disabled}
      placeholder="não informado"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft === shown) return;
        const parsed = parseIfcInput(property, draft);
        if (parsed === undefined) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        onCommit(parsed);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        event.stopPropagation();
      }}
    />
  );
}

function IfcProperties({ typeId, locked }: { typeId: string; locked: boolean }) {
  const project = useEditorStore((s) => s.project);
  const [error, setError] = useState<string | null>(null);
  const sets = useMemo(() => archTypeProperties(project, typeId), [project, typeId]);
  useEffect(() => setError(null), [typeId]);
  const commit = (property: IfcPropertyInfo, value: IfcValue | null): void => {
    const store = useEditorStore.getState();
    const result = setArchIfcValue(store.project, { typeId, scope: 'type' }, property.key, value);
    setError(result.ok ? null : result.error.message);
    store.applyOperation(
      result,
      value === null
        ? `${property.label}: valor limpo (pendente).`
        : `${property.label} informado no tipo.`,
    );
  };
  if (sets.length === 0) return null;
  return (
    <fieldset data-testid="arch-ifc-properties">
      <legend>Propriedades IFC do tipo</legend>
      <p className="muted">
        Valem para todas as ocorrências do tipo. Começam sem valor (pendentes) e só são gravadas
        quando você as informa; limpar volta a pendente. Cada campo é gravado ao ser confirmado.
      </p>
      {locked && (
        <p className="archcat__notice" data-testid="arch-ifc-locked">
          Grave ou descarte as alterações do tipo antes de editar as propriedades IFC.
        </p>
      )}
      {error && (
        <p className="archcat__error" role="alert" data-testid="arch-ifc-error">
          {error}
        </p>
      )}
      {sets.map((set) => (
        <table key={set.name} className="archcat__table" data-testid="arch-ifc-set">
          <thead>
            <tr>
              <th colSpan={4}>
                {set.name}{' '}
                <span className="badge">{set.standard ? 'buildingSMART' : 'conjunto próprio'}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {set.properties.map((property) => {
              const unit = displayOf(property).unit;
              const pending = property.origin === 'pending';
              return (
                <tr
                  key={property.key}
                  data-testid="arch-ifc-row"
                  data-key={property.key}
                  data-origin={property.origin}
                >
                  <td title={property.key}>{property.label}</td>
                  <td>
                    <IfcValueCell
                      property={property}
                      disabled={locked}
                      onCommit={(value) => commit(property, value)}
                    />
                  </td>
                  <td className="archcat__narrow">
                    {unit && typeof property.value !== 'string' && !isBoolean(property)
                      ? `${unit} · `
                      : ''}
                    <span className={pending ? 'archcat__pending' : 'muted'}>
                      {pending ? 'Pendente' : IFC_ORIGIN_LABELS[property.origin]}
                    </span>
                  </td>
                  <td className="archcat__narrow">
                    {property.editable && (
                      <button
                        type="button"
                        className="btn btn--icon"
                        data-testid={`arch-ifc-clear-${property.key}`}
                        aria-label={`Limpar ${property.label}`}
                        title="Limpar o valor (volta a pendente)"
                        disabled={locked || property.origin !== 'user'}
                        onClick={() => commit(property, null)}
                      >
                        <Eraser size={13} aria-hidden />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ))}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

interface EditorProps {
  typeId: string;
  /** Tipo criado por "Duplicar" (para o catálogo selecioná-lo) ou `null` após excluir. */
  onSelectType: (typeId: string | null) => void;
  /** "Usar este tipo": ausente = botão não aparece. */
  onUse?: (typeId: string, category: ArchCategory) => void;
}

export function ArchTypeEditor({ typeId, onSelectType, onUse }: EditorProps) {
  const project = useEditorStore((s) => s.project);
  const stored = getArchType(project.architecture, typeId);
  const [draft, setDraft] = useState<ArchType | null>(stored ?? null);
  const [error, setError] = useState<string | null>(null);
  /** Alteração conferida pelo núcleo, à espera da confirmação do usuário. */
  const [confirming, setConfirming] = useState(false);
  // O tipo gravado mudou (gravação, desfazer, outro tipo): o rascunho recomeça dele.
  useEffect(() => {
    setDraft(stored ?? null);
    setConfirming(false);
  }, [stored]);
  useEffect(() => setError(null), [typeId]);

  const affected = useMemo(() => archTypeAffected(project, typeId), [project, typeId]);
  if (!stored || !draft) return null;
  const dirty = archTypeDirty(stored, draft);

  const change = (next: ArchType): void => {
    setDraft(next);
    setConfirming(false);
    setError(null);
  };

  const save = (confirmed: boolean): void => {
    const store = useEditorStore.getState();
    const problem = archDraftProblem(draft);
    if (problem) {
      setError(problem);
      setConfirming(false);
      return;
    }
    // A operação é pura: conferi-la antes de confirmar não altera nada.
    const result = updateArchType(store.project, typeId, archTypePatchOf(draft));
    if (!result.ok) {
      setError(result.error.message);
      setConfirming(false);
      store.notify('error', result.error.message);
      return;
    }
    setError(null);
    const count = result.value.affected.length;
    if (count > 0 && !confirmed) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    store.applyOperation(
      { ok: true, value: result.value.project },
      count > 0
        ? `Tipo "${draft.name.trim()}" alterado: ${occurrencesText(count)} atualizada(s).`
        : `Tipo "${draft.name.trim()}" alterado.`,
    );
  };

  const duplicate = (): void => {
    const store = useEditorStore.getState();
    const result = duplicateArchType(store.project, typeId);
    if (!result.ok) {
      setError(result.error.message);
      store.notify('error', result.error.message);
      return;
    }
    setError(null);
    const copy = getArchType(result.value.project.architecture, result.value.typeId);
    if (
      store.applyOperation(
        { ok: true, value: result.value.project },
        `Tipo duplicado como "${copy?.name ?? ''}": as ocorrências continuam no original.`,
      )
    ) {
      onSelectType(result.value.typeId);
    }
  };

  const remove = (): void => {
    const store = useEditorStore.getState();
    const result = removeArchType(store.project, typeId);
    if (!result.ok) {
      setError(result.error.message);
      store.notify('error', result.error.message);
      return;
    }
    setError(null);
    if (store.applyOperation(result, `Tipo "${stored.name}" excluído.`)) onSelectType(null);
  };

  return (
    <div
      className="archcat__body"
      data-testid="arch-type-editor"
      data-type-id={typeId}
      data-dirty={dirty}
    >
      <div className="archcat__form">
        <ArchTypeParameters draft={draft} onChange={change} />
        <ProductFields draft={draft} onChange={change} />

        {error && (
          <p className="archcat__error" role="alert" data-testid="arch-type-error">
            {error} Nada foi alterado.
          </p>
        )}
        {confirming && (
          <div className="archcat__affected" role="alertdialog" data-testid="arch-type-affected">
            <strong data-testid="arch-type-affected-count">
              Esta alteração vale para {occurrencesText(affected.count)} do tipo:
            </strong>
            <ul>
              {affected.names.map((name, index) => (
                <li key={index} data-testid="arch-type-affected-name">
                  {name}
                </li>
              ))}
            </ul>
            <div className="archcat__actions">
              <button
                type="button"
                className="btn btn--primary"
                data-testid="arch-type-confirm"
                onClick={() => save(true)}
              >
                Confirmar a alteração
              </button>
              <button
                type="button"
                className="btn"
                data-testid="arch-type-cancel"
                onClick={() => setConfirming(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        <div className="archcat__actions">
          <button
            type="button"
            className="btn btn--primary"
            data-testid="arch-type-save"
            disabled={!dirty || confirming}
            title={
              dirty
                ? affected.count > 0
                  ? `Grava a alteração; ${occurrencesText(affected.count)} do tipo serão afetadas (com confirmação)`
                  : 'Grava a alteração do tipo'
                : 'Nenhuma alteração a gravar'
            }
            onClick={() => save(false)}
          >
            <Save size={14} aria-hidden /> Gravar alterações
          </button>
          <button
            type="button"
            className="btn"
            data-testid="arch-type-discard"
            disabled={!dirty}
            onClick={() => change(stored)}
          >
            <Undo2 size={14} aria-hidden /> Descartar
          </button>
          <button
            type="button"
            className="btn"
            data-testid="arch-type-duplicate"
            title="Cria um tipo independente com os mesmos valores; as ocorrências continuam no original"
            onClick={duplicate}
          >
            <CopyPlus size={14} aria-hidden /> Duplicar
          </button>
          <button
            type="button"
            className="btn btn--danger"
            data-testid="arch-type-delete"
            title={
              affected.count > 0
                ? `Em uso por ${occurrencesText(affected.count)}: troque o tipo delas antes de excluir`
                : 'Exclui o tipo do projeto (Ctrl+Z desfaz)'
            }
            onClick={remove}
          >
            <Trash2 size={14} aria-hidden /> Excluir
          </button>
          {onUse && (
            <button
              type="button"
              className="btn btn--primary"
              data-testid="arch-type-use"
              disabled={dirty}
              title={
                dirty
                  ? 'Grave ou descarte as alterações antes de usar o tipo'
                  : `Usa este tipo ao inserir ${ARCH_CATEGORY_LABELS[stored.category].toLowerCase()}`
              }
              onClick={() => onUse(typeId, stored.category)}
            >
              Usar este tipo
            </button>
          )}
        </div>

        <IfcProperties typeId={typeId} locked={dirty} />
      </div>
      <ArchPreviewPanel type={draft} />
    </div>
  );
}
