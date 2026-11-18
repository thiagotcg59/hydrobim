import { formatMeters } from '@hydrobim/core';
import {
  conformityOf,
  IFC_CONFORMITY_LABELS,
  IFC_ORIGIN_LABELS,
  issuesOfElement,
  typeOfElement,
  type IfcConformity,
  type IfcElementInfo,
  type IfcIssue,
  type IfcPortInfo,
  type IfcPropertyInfo,
  type IfcPropertySetInfo,
  type IfcScope,
  type IfcTypeInfo,
} from '@hydrobim/ifc';
import { Download, Library, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { selectPrimaryId, useEditorStore } from '../state/editorStore';
import { useIfcState, type IfcState } from '../state/ifcModel';
import { exportIdsFile, exportIfcFile } from '../state/projectActions';
import { ReadOnlyRow, Section, TextField } from '../ui/fields';
import { displayOf, editTextOf, formatIfcValue, parseIfcInput } from '../ui/ifcFormat';

const actions = () => useEditorStore.getState();

const SCOPE_LABELS: Record<IfcScope, string> = { type: 'Tipo', occurrence: 'Ocorrência' };

function ConformityBadge({ status, testId }: { status: IfcConformity; testId?: string }) {
  return (
    <span className={`bim-status bim-status--${status}`} data-testid={testId} data-status={status}>
      {IFC_CONFORMITY_LABELS[status]}
    </span>
  );
}

interface EditorProps {
  property: IfcPropertyInfo;
  elementId: string;
  scope: IfcScope;
}

/**
 * Campo de uma propriedade editável. Confirma ao sair do campo ou com Enter; a validação do
 * valor frente ao tipo IFC é feita pela operação de domínio, que devolve a mensagem de erro.
 */
function ValueEditor({ property, elementId, scope }: EditorProps) {
  const testId = `ifc-edit-${property.key}`;
  const [text, setText] = useState(() => editTextOf(property));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(editTextOf(property));
    setInvalid(false);
  }, [property]);
  const commit = (value: string | boolean | null): void => {
    // Sair do campo sem alterar o texto não muda nada (nem arredonda o valor guardado).
    if (typeof value === 'string' && value === editTextOf(property)) return;
    const parsed = typeof value === 'string' ? parseIfcInput(property, value) : value;
    if (parsed === undefined) {
      setInvalid(true);
      return;
    }
    if (parsed === property.value) {
      setText(editTextOf(property));
      return;
    }
    // Limpar um campo que nunca foi informado não altera o projeto.
    if (parsed === null && property.origin !== 'user') {
      setText(editTextOf(property));
      return;
    }
    const applied = actions().setIfcValue(elementId, scope, property.key, parsed);
    if (!applied) setInvalid(true);
  };

  if (property.kind === 'enumerated' || property.ifcType === 'IfcBoolean') {
    const options =
      property.ifcType === 'IfcBoolean'
        ? [
            { value: 'true', label: 'Sim' },
            { value: 'false', label: 'Não' },
          ]
        : (property.enumeration?.values ?? []).map((item) => ({ value: item, label: item }));
    return (
      <span className="field__control">
        <select
          data-testid={testId}
          aria-label={property.label}
          value={property.value === null ? '' : String(property.value)}
          onChange={(event) => {
            const selected = event.target.value;
            commit(
              selected === ''
                ? null
                : property.ifcType === 'IfcBoolean'
                  ? selected === 'true'
                  : selected,
            );
          }}
        >
          <option value="">— não informado —</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </span>
    );
  }
  const display = displayOf(property);
  const numeric = typeof property.value === 'number' || property.unit !== 'none';
  return (
    <span className={`field__control${invalid ? ' field__control--invalid' : ''}`}>
      <input
        data-testid={testId}
        aria-label={property.label}
        aria-invalid={invalid}
        type="text"
        inputMode={numeric ? 'decimal' : 'text'}
        placeholder="não informado"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => commit(text)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          else if (event.key === 'Escape') {
            setText(editTextOf(property));
            setInvalid(false);
          }
          event.stopPropagation();
        }}
      />
      {display.unit && <span className="field__unit">{display.unit}</span>}
    </span>
  );
}

function PropertyRow({ property, elementId, scope }: EditorProps) {
  const pending = property.value === null && property.required;
  const text = formatIfcValue(property);
  return (
    <div
      className={`ifc-prop${pending ? ' ifc-prop--pending' : ''}`}
      data-testid="ifc-property"
      data-property={property.key}
      data-origin={property.origin}
      data-pending={pending}
    >
      <span
        className="ifc-prop__label"
        title={`${property.key} — ${property.ifcType}${property.binding ? `\nDerivada de: ${property.binding}` : ''}`}
      >
        {property.label}
        <small>{property.name}</small>
      </span>
      <span className="ifc-prop__value">
        {property.editable ? (
          <ValueEditor property={property} elementId={elementId} scope={scope} />
        ) : (
          <span data-testid={`ifc-value-${property.key}`}>{text ?? '—'}</span>
        )}
      </span>
      <span className="ifc-prop__origin">
        {pending ? (
          <span className="bim-status bim-status--pending" title="Exigida pelo perfil do projeto">
            Pendente
          </span>
        ) : (
          <span
            className={`ifc-origin ifc-origin--${property.origin}`}
            title="Origem da informação"
          >
            {IFC_ORIGIN_LABELS[property.origin]}
          </span>
        )}
        {property.editable && property.origin === 'user' && (
          <button
            type="button"
            className="bim-tree__icon"
            data-testid={`ifc-clear-${property.key}`}
            title="Limpar o valor informado"
            aria-label={`Limpar ${property.label}`}
            onClick={() => actions().setIfcValue(elementId, scope, property.key, null)}
          >
            <X size={12} />
          </button>
        )}
      </span>
    </div>
  );
}

function PropertySets({
  sets,
  elementId,
  kind,
}: {
  sets: readonly IfcPropertySetInfo[];
  elementId: string;
  kind: 'pset' | 'qto';
}) {
  const shown = sets.filter((set) => set.kind === kind);
  if (shown.length === 0) return <p className="muted">Nenhum conjunto aplicável.</p>;
  return (
    <>
      {shown.map((set) => (
        <details
          key={`${set.scope}:${set.name}`}
          className="ifc-set"
          open
          data-testid="ifc-set"
          data-set-name={set.name}
          data-scope={set.scope}
        >
          <summary>
            <span className="ifc-set__name">{set.name}</span>
            <span
              className="badge"
              title={
                set.standard
                  ? 'Conjunto padronizado pela buildingSMART (IFC 4.3)'
                  : 'Conjunto próprio do HydroBIM'
              }
            >
              {set.standard ? 'buildingSMART' : 'Próprio'}
            </span>
            <span
              className="badge"
              title={
                set.scope === 'type'
                  ? 'Dado do tipo: vale para todas as ocorrências da mesma família e dimensão'
                  : 'Dado desta ocorrência'
              }
            >
              {SCOPE_LABELS[set.scope]}
            </span>
          </summary>
          {set.description && <p className="muted ifc-set__note">{set.description}</p>}
          {set.properties.map((property) => (
            <PropertyRow
              key={property.key}
              property={property}
              elementId={elementId}
              scope={set.scope}
            />
          ))}
        </details>
      ))}
    </>
  );
}

const point = (v: { x: number; y: number; z: number }): string =>
  `${formatMeters(v.x)}; ${formatMeters(v.y)}; ${formatMeters(v.z)}`;
const direction = (v: { x: number; y: number; z: number }): string =>
  [v.x, v.y, v.z].map((n) => String(Math.round(n * 1000) / 1000).replace('.', ',')).join('; ');

function PortCard({ port }: { port: IfcPortInfo }) {
  const value = (name: string): string | null => {
    const property = port.psets.flatMap((set) => set.properties).find((p) => p.name === name);
    return property ? formatIfcValue(property) : null;
  };
  return (
    <li className="port" data-testid="ifc-port" data-port-id={port.portId}>
      <div className="port__head">
        <strong>{port.name}</strong>
        <span className={port.connectedTo ? 'status status--connected' : 'status status--free'}>
          {port.connectedTo ? 'conectada' : 'livre'}
        </span>
      </div>
      <ReadOnlyRow
        label="IfcDistributionPort"
        value={`PIPE · ${port.systemType} · ${port.flowDirection}`}
      />
      <ReadOnlyRow label="GlobalId" value={<code>{port.globalId}</code>} />
      <ReadOnlyRow
        label="Tipo de conexão"
        value={`${value('ConnectionType') ?? '—'} · ${value('ConnectionSubtype') ?? '—'}`}
      />
      <ReadOnlyRow
        label="Diâmetro"
        value={`DN ${value('NominalDiameter') ?? '—'} · ext. ${value('OuterDiameter') ?? '—'} · int. ${value('InnerDiameter') ?? '—'}`}
      />
      <ReadOnlyRow label="Posição (X; Y; Z)" value={point(port.position)} />
      <ReadOnlyRow label="Orientação" value={direction(port.direction)} />
      <ReadOnlyRow
        label="Conectada a"
        value={
          port.connectedTo ? (
            <button
              type="button"
              className="link"
              data-testid="ifc-port-connected"
              onClick={() => actions().select(port.connectedTo?.elementId ?? null)}
            >
              {port.connectedTo.elementName} ({port.connectedTo.portId})
            </button>
          ) : (
            '—'
          )
        }
      />
    </li>
  );
}

const LEVEL_TITLES = {
  schema: 'Esquema IFC 4.3 (normativo)',
  project: 'Perfil do projeto (requisitos adicionais)',
} as const;

function IssueList({
  issues,
  onPick,
}: {
  issues: readonly IfcIssue[];
  onPick?: (issue: IfcIssue) => void;
}) {
  return (
    <>
      {(['schema', 'project'] as const).map((level) => {
        const ofLevel = issues.filter((issue) => issue.level === level);
        return (
          <div key={level} className="ifc-issues" data-testid={`ifc-issues-${level}`}>
            <h4>
              {LEVEL_TITLES[level]} <span className="badge">{ofLevel.length}</span>
            </h4>
            {ofLevel.length === 0 ? (
              <p className="muted">Nenhuma pendência.</p>
            ) : (
              <ul className="ifc-issues__list">
                {ofLevel.map((issue, index) => (
                  <li key={`${issue.code}:${issue.property ?? ''}:${index}`}>
                    <button
                      type="button"
                      className={`issue issue--${issue.severity}`}
                      data-testid="ifc-issue"
                      data-code={issue.code}
                      data-level={issue.level}
                      data-severity={issue.severity}
                      disabled={!onPick}
                      onClick={() => onPick?.(issue)}
                    >
                      {issue.message}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </>
  );
}

function TypeSection({ type }: { type: IfcTypeInfo }) {
  const value = (name: string): string | null => {
    const property = type.psets.flatMap((set) => set.properties).find((p) => p.name === name);
    return property ? formatIfcValue(property) : null;
  };
  return (
    <Section title="Tipo" testId="ifc-section-type">
      <ReadOnlyRow
        label="Entidade de tipo"
        value={<span data-testid="ifc-type-entity">{type.entity}</span>}
      />
      <ReadOnlyRow
        label="Nome do tipo"
        value={<span data-testid="ifc-type-name">{type.name}</span>}
      />
      <ReadOnlyRow label="GlobalId" value={<code>{type.globalId}</code>} />
      <ReadOnlyRow label="Família" value={type.familyName ?? 'Sem família de catálogo'} />
      <ReadOnlyRow label="ElementType" value={type.elementType} />
      <ReadOnlyRow label="Fabricante" value={value('Manufacturer') ?? '—'} />
      <ReadOnlyRow label="Modelo" value={value('ModelLabel') ?? value('Model') ?? '—'} />
      <ReadOnlyRow label="Referência do catálogo" value={type.catalogReference ?? '—'} />
      <ReadOnlyRow
        label="Ocorrências"
        value={<span data-testid="ifc-type-members">{type.memberIds.length}</span>}
      />
      <p className="muted">
        Os dados do tipo valem para todas as ocorrências desta família e dimensão, inclusive as
        criadas depois.
      </p>
    </Section>
  );
}

function ElementPanel({ element, state }: { element: IfcElementInfo; state: IfcState }) {
  const type = typeOfElement(state.model, element);
  const system = state.model.systems.find((s) => s.systemId === element.systemId);
  const issues = issuesOfElement(state.issues, element.elementId, element.typeKey);
  const sets = [...(type?.psets ?? []), ...element.psets];
  return (
    <div data-testid="ifc-element" data-element-id={element.elementId}>
      <Section title="Identificação" testId="ifc-section-identification">
        <ReadOnlyRow
          label="GlobalId"
          value={<code data-testid="ifc-global-id">{element.globalId}</code>}
        />
        <TextField
          label="Name"
          value={element.name}
          testId="ifc-name"
          onCommit={(name) => actions().rename(element.elementId, name)}
        />
        <TextField
          label="Description"
          value={element.description ?? ''}
          testId="ifc-description"
          onCommit={(text) =>
            actions().setIfcValue(element.elementId, 'occurrence', 'Description', text)
          }
        />
        <ReadOnlyRow label="Tag" value={<code data-testid="ifc-tag">{element.tag}</code>} />
        <ReadOnlyRow
          label="Entidade IFC"
          value={<strong data-testid="ifc-entity">{element.entity}</strong>}
        />
        <ReadOnlyRow
          label="PredefinedType"
          value={<span data-testid="ifc-predefined-type">{element.predefinedType}</span>}
        />
        <ReadOnlyRow
          label="ObjectType"
          value={<span data-testid="ifc-object-type">{element.objectType}</span>}
        />
        <ReadOnlyRow
          label="Sistema"
          value={
            system
              ? `${system.name} (IfcDistributionSystem · ${system.predefinedType})`
              : 'Sem sistema'
          }
        />
        <ReadOnlyRow
          label="Material"
          value={<span data-testid="ifc-material">{element.material.name}</span>}
        />
      </Section>
      {type && <TypeSection type={type} />}
      <Section title="Property Sets" testId="ifc-section-psets">
        <PropertySets sets={sets} elementId={element.elementId} kind="pset" />
      </Section>
      <Section title="Quantities" testId="ifc-section-quantities">
        <PropertySets sets={sets} elementId={element.elementId} kind="qto" />
      </Section>
      <Section title="Conexões" testId="ifc-section-ports">
        <ul className="ports">
          {element.ports.map((port) => (
            <PortCard key={port.portId} port={port} />
          ))}
        </ul>
      </Section>
      <Section title="Validação" testId="ifc-section-validation">
        <ReadOnlyRow
          label="Conformidade IFC"
          value={<ConformityBadge status={conformityOf(issues)} testId="ifc-conformity" />}
        />
        <IssueList issues={issues} />
      </Section>
    </div>
  );
}

function ProjectOverview({ state, onLibrary }: { state: IfcState; onLibrary: () => void }) {
  const classFilter = useEditorStore((s) => s.bimClassFilter);
  const { model, issues, conformity } = state;
  const byEntity = new Map<string, number>();
  for (const element of model.elements)
    byEntity.set(element.entity, (byEntity.get(element.entity) ?? 0) + 1);
  const count = (status: IfcConformity): number =>
    [...conformity.values()].filter((value) => value === status).length;
  const pick = (issue: IfcIssue): void => {
    const ids =
      issue.elementId !== null
        ? [issue.elementId]
        : (model.types.find((type) => type.key === issue.typeKey)?.memberIds ?? []);
    if (ids.length) actions().selectMany([...ids]);
  };
  return (
    <div data-testid="ifc-overview">
      <Section title="Modelo IFC" testId="ifc-section-model">
        <ReadOnlyRow label="Esquema" value={model.schema} />
        <ReadOnlyRow
          label="Elementos"
          value={<span data-testid="ifc-element-count">{model.elements.length}</span>}
        />
        <ReadOnlyRow
          label="Tipos (Ifc…Type)"
          value={<span data-testid="ifc-type-count">{model.types.length}</span>}
        />
        <ReadOnlyRow label="Sistemas" value={model.systems.length} />
        <div className="chips" data-testid="ifc-entity-chips">
          {[...byEntity.entries()].sort().map(([entity, total]) => (
            <button
              key={entity}
              type="button"
              className={`chip${classFilter === entity ? ' is-active' : ''}`}
              data-testid="ifc-entity-chip"
              data-entity={entity}
              title="Filtrar a árvore e o visualizador por esta classe IFC"
              onClick={() => actions().setBimClassFilter(classFilter === entity ? null : entity)}
            >
              {entity} <span className="badge">{total}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Conformidade" testId="ifc-section-conformity">
        <ReadOnlyRow
          label="Conformes"
          value={<span data-testid="ifc-count-conforming">{count('conforming')}</span>}
        />
        <ReadOnlyRow
          label="Com pendências"
          value={<span data-testid="ifc-count-pending">{count('pending')}</span>}
        />
        <ReadOnlyRow
          label="Não conformes"
          value={<span data-testid="ifc-count-invalid">{count('invalid')}</span>}
        />
        <p className="muted">
          Selecione um elemento no visualizador ou na árvore para consultar e completar suas
          propriedades IFC. Pendências são informações exigidas pelo perfil do projeto que ainda não
          foram informadas — nada é preenchido com valores fictícios.
        </p>
      </Section>
      <Section title="Exportação" testId="ifc-section-export">
        <div className="chips">
          <button
            type="button"
            className="btn btn--compact"
            data-testid="bim-export-ifc"
            onClick={exportIfcFile}
            title="Exportar o modelo em IFC 4.3 com os tipos, conjuntos de propriedades e quantidades desta aba"
          >
            <Download size={13} /> IFC 4.3
          </button>
          <button
            type="button"
            className="btn btn--compact"
            data-testid="bim-export-ids"
            onClick={exportIdsFile}
            title="Exportar os requisitos de informação do projeto em IDS 1.0 (buildingSMART)"
          >
            <Download size={13} /> IDS
          </button>
          <button
            type="button"
            className="btn btn--compact"
            data-testid="bim-library"
            onClick={onLibrary}
            title="Mapeamento IFC de todas as famílias da biblioteca"
          >
            <Library size={13} /> Biblioteca
          </button>
        </div>
      </Section>
      <Section title="Pendências do modelo" testId="ifc-section-issues">
        <IssueList issues={issues.slice(0, 200)} onPick={pick} />
        {issues.length > 200 && (
          <p className="muted">Mostrando 200 de {issues.length} pendências.</p>
        )}
      </Section>
    </div>
  );
}

/** Painel de propriedades IFC da aba BIM / IFC: elemento selecionado ou visão do modelo. */
export function IfcPanel({ onLibrary }: { onLibrary: () => void }) {
  const state = useIfcState();
  const primaryId = useEditorStore(selectPrimaryId);
  const selectionSize = useEditorStore((s) => s.selection.length);
  const element = state.model.elements.find((item) => item.elementId === primaryId);
  return (
    <aside className="panel" data-testid="ifc-panel" aria-label="Propriedades IFC">
      <div className="panel__header">
        <h2>{element ? element.name : 'BIM / IFC'}</h2>
        {element ? (
          <button
            type="button"
            className="link"
            data-testid="ifc-back"
            onClick={() => actions().select(null)}
          >
            Modelo
          </button>
        ) : (
          <span className="badge">{state.model.schema}</span>
        )}
      </div>
      <div className="panel__scroll">
        {selectionSize > 1 && (
          <p className="muted ifc-panel__note" data-testid="ifc-multi">
            {selectionSize} elementos selecionados; mostrando o primeiro.
          </p>
        )}
        {element ? (
          <ElementPanel element={element} state={state} />
        ) : (
          <ProjectOverview state={state} onLibrary={onLibrary} />
        )}
      </div>
    </aside>
  );
}
