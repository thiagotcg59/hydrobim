import {
  ARCH_KIND_CATEGORY,
  ARCH_KIND_LABELS,
  archTypeSizeLabel,
  archGroundElevationAt,
  archSeatPoint,
  archTypeUsage,
  archVerticalRange,
  degToRad,
  formatMeters,
  getArchElement,
  hasDesignTerrain,
  type GroundSurface,
  type ArchElement,
  type ArchElementPatch,
  type Project,
} from '@hydrobim/core';
import {
  ARCH_GROUP_LABELS,
  ARCH_PROPERTY_GROUPS,
  buildArchIfcModel,
  type ArchIfcElementInfo,
  type ArchIfcTypeInfo,
  type ArchPropertyGroup,
  type IfcPropertyInfo,
} from '@hydrobim/ifc';
import { ArrowLeft, Layers2, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { ARCH_ICONS } from '../ui/EngineeringIcons';
import {
  formatDecimal,
  NumberField,
  parseDecimal,
  ReadOnlyRow,
  Section,
  SelectField,
  TextField,
} from '../ui/fields';
import { displayOf, editTextOf, formatIfcValue, parseIfcInput } from '../ui/ifcFormat';
import { planCenterOf } from './archGeometry';
import {
  ARCH_NATURE_HINTS,
  ARCH_NATURE_LABELS,
  ARCH_NATURE_MARKS,
  archPanelRows,
  type ArchPanelRow,
} from './archPanelModel';
import { useArchStore } from './archStore';
import {
  FACING_OPTIONS,
  HAND_OPTIONS,
  LOCATION_LINE_OPTIONS,
  OptionalNumberField,
} from './ArchToolOptions';

const arch = () => useArchStore.getState();

const isBoolean = (property: IfcPropertyInfo): boolean =>
  property.ifcType === 'IfcBoolean' || property.ifcType === 'IfcLogical';

/**
 * Campo de uma propriedade editável. Enumeração vira lista; booleano tem três estados (não
 * informado, sim, não); número mostra a unidade; data é AAAA-MM-DD. Limpar o campo volta o
 * valor a pendente. A conferência do valor é da operação de domínio (`setArchIfcValue`).
 */
function ValueEditor({ row, elementId }: { row: ArchPanelRow; elementId: string }) {
  const { property, scope } = row;
  const testId = `arch-edit-${property.key}`;
  const [text, setText] = useState(() => editTextOf(property));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(editTextOf(property));
    setInvalid(false);
  }, [property]);

  const commit = (value: string | boolean | null): void => {
    if (typeof value === 'string' && value === editTextOf(property)) return;
    const parsed = typeof value === 'string' ? parseIfcInput(property, value) : value;
    if (parsed === undefined) {
      setInvalid(true);
      return;
    }
    // Limpar um campo que nunca foi informado não altera o projeto.
    if (parsed === property.value || (parsed === null && property.origin !== 'user')) {
      setText(editTextOf(property));
      return;
    }
    if (!arch().setIfcValue(elementId, scope, property.key, parsed)) setInvalid(true);
  };

  if (property.kind === 'enumerated' || isBoolean(property)) {
    const options = isBoolean(property)
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
            commit(selected === '' ? null : isBoolean(property) ? selected === 'true' : selected);
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
  const date = property.ifcType === 'IfcDate';
  const numeric = !date && (typeof property.value === 'number' || property.unit !== 'none');
  return (
    <span className={`field__control${invalid ? ' field__control--invalid' : ''}`}>
      <input
        data-testid={testId}
        aria-label={property.label}
        aria-invalid={invalid}
        type="text"
        inputMode={numeric ? 'decimal' : 'text'}
        placeholder={date ? 'AAAA-MM-DD' : 'não informado'}
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

/** Linha de propriedade: rótulo em português, identificador oficial, valor e natureza. */
function PropertyRow({ row, elementId }: { row: ArchPanelRow; elementId: string }) {
  const { property, scope, nature } = row;
  const text = formatIfcValue(property);
  return (
    <div
      className={`arch-prop arch-prop--${nature}`}
      data-testid="arch-property"
      data-property={property.key}
      data-nature={nature}
      data-scope={scope}
    >
      <span className="arch-prop__label">
        {property.label}
        <code title={`${property.key} — ${property.ifcType}`}>{property.key}</code>
      </span>
      <span className="arch-prop__value">
        {property.editable ? (
          <ValueEditor row={row} elementId={elementId} />
        ) : (
          <span data-testid={`arch-value-${property.key}`}>{text ?? '—'}</span>
        )}
      </span>
      <span className="arch-prop__nature">
        <span
          className={`arch-nature arch-nature--${nature}`}
          data-testid="arch-nature"
          title={
            ARCH_NATURE_HINTS[nature] +
            (nature === 'pending'
              ? ` Ao informar, o valor é ${scope === 'type' ? 'do tipo (todas as ocorrências)' : 'desta ocorrência'}.`
              : '')
          }
        >
          <b aria-hidden>{ARCH_NATURE_MARKS[nature]}</b>
          {ARCH_NATURE_LABELS[nature]}
        </span>
        {nature === 'pending' && property.editable && (
          <small>{scope === 'type' ? 'do tipo' : 'da ocorrência'}</small>
        )}
        {property.editable && property.origin === 'user' && (
          <button
            type="button"
            className="bim-tree__icon"
            data-testid={`arch-clear-${property.key}`}
            title="Limpar o valor informado (volta a pendente)"
            aria-label={`Limpar ${property.label}`}
            onClick={() => arch().setIfcValue(elementId, scope, property.key, null)}
          >
            <X size={12} />
          </button>
        )}
      </span>
    </div>
  );
}

const SYSTEM_LABELS = { nbr15965: 'ABNT NBR 15965', sinapi: 'SINAPI', other: 'Outro' } as const;

function ClassificationDetails({
  info,
  type,
}: {
  info: ArchIfcElementInfo;
  type: ArchIfcTypeInfo | undefined;
}) {
  const attributes = { ...(type?.attributes ?? {}), ...info.attributes };
  return (
    <>
      <ReadOnlyRow
        label="Entidade IFC"
        value={<code data-testid="arch-ifc-entity">{info.entity}</code>}
      />
      <ReadOnlyRow
        label="Entidade de tipo"
        value={<code data-testid="arch-ifc-type-entity">{type?.entity ?? '— (sem tipo)'}</code>}
      />
      <ReadOnlyRow
        label="Tipo predefinido"
        value={<code data-testid="arch-ifc-predefined">{info.predefinedType}</code>}
      />
      {Object.entries(attributes).map(([name, value]) => (
        <ReadOnlyRow
          key={name}
          label={`Atributo ${name}`}
          value={<code>{typeof value === 'number' ? formatDecimal(value, 3) : String(value)}</code>}
        />
      ))}
      <ReadOnlyRow label="GlobalId" value={<code>{info.globalId}</code>} />
      {type && (
        <div data-testid="arch-classifications">
          <span className="row__label">Classificações externas do tipo</span>
          {type.classifications.length === 0 ? (
            <p className="muted">
              Nenhuma informada. O código é cadastrado no tipo, no Catálogo de arquitetura.
            </p>
          ) : (
            type.classifications.map((item, index) => (
              <ReadOnlyRow
                key={index}
                label={
                  item.system === 'other' ? (item.table ?? 'Outro') : SYSTEM_LABELS[item.system]
                }
                value={[item.system !== 'other' ? item.table : null, item.code, item.description]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))
          )}
        </div>
      )}
    </>
  );
}

function MaterialDetails({ type }: { type: ArchIfcTypeInfo | undefined }) {
  if (!type) return <p className="muted">Ambientes não têm tipo nem material.</p>;
  return (
    <div data-testid="arch-materials">
      {type.layers.map((layer, index) => (
        <ReadOnlyRow
          key={index}
          label={`Camada ${index + 1} · ${layer.category}`}
          value={`${layer.material} · ${formatDecimal(layer.thickness * 1000, 1)} mm`}
        />
      ))}
      {type.constituents.map((item) => (
        <ReadOnlyRow key={item.name} label={`Componente ${item.name}`} value={item.material} />
      ))}
      {type.layers.length === 0 && type.constituents.length === 0 && (
        <p className="muted">
          Materiais dos componentes não informados no tipo (pendente; edite no Catálogo de
          arquitetura).
        </p>
      )}
    </div>
  );
}

/**
 * Elevações absolutas do elemento (derivadas do nível, dos deslocamentos e do tipo) e, havendo
 * terreno, a cota de cada superfície no ponto de referência com o atalho para assentar a base.
 */
function ElevationRows({ element, project }: { element: ArchElement; project: Project }) {
  const range = archVerticalRange(project, element);
  const point = archSeatPoint(element);
  const twoGrounds = hasDesignTerrain(project);
  const surfaces: GroundSurface[] =
    project.terrain && point ? (twoGrounds ? ['design', 'natural'] : ['design']) : [];
  // Ambiente sem pé-direito informado não tem cota superior.
  const hasTop = !(element.kind === 'space' && element.height === null);
  return (
    <>
      <ReadOnlyRow
        label={
          element.kind === 'door'
            ? 'Elevação da soleira'
            : element.kind === 'window'
              ? 'Elevação do peitoril'
              : element.kind === 'space'
                ? 'Elevação do piso'
                : 'Elevação da base'
        }
        value={
          <span data-testid="arch-prop-base-elevation">
            {range ? formatMeters(range.base, 3) : '—'}
          </span>
        }
      />
      <ReadOnlyRow
        label="Elevação do topo"
        value={
          <span data-testid="arch-prop-top-elevation">
            {range && hasTop ? formatMeters(range.top, 3) : '—'}
          </span>
        }
      />
      {point &&
        surfaces.map((surface) => {
          const ground = archGroundElevationAt(project, surface, point);
          const suffix = surface === 'natural' ? '-natural' : '';
          const name = twoGrounds
            ? surface === 'natural'
              ? 'Terreno natural'
              : 'Terreno projetado'
            : 'Terreno';
          return (
            <div key={surface}>
              <ReadOnlyRow
                label={`${name} no ponto de referência`}
                value={
                  <span data-testid={`arch-prop-ground${suffix}`}>
                    {ground === null ? 'fora da superfície' : formatMeters(ground, 3)}
                  </span>
                }
              />
              <button
                type="button"
                className="chip"
                data-testid={`arch-prop-seat${suffix}`}
                disabled={
                  ground === null || (range !== null && Math.abs(range.base - ground) < 5e-4)
                }
                title={`Leva a base do elemento à cota do ${name.toLowerCase()} no ponto de referência (${element.kind === 'wall' ? 'início da parede' : 'primeiro vértice do contorno'})`}
                onClick={() => arch().seat(element.id, surface)}
              >
                {twoGrounds
                  ? `Assentar no ${surface === 'natural' ? 'natural' : 'projetado'}`
                  : 'Assentar no terreno'}
              </button>
            </div>
          );
        })}
    </>
  );
}

/** Parâmetros editáveis da ocorrência, conforme a categoria. */
function InstanceFields({ element, project }: { element: ArchElement; project: Project }) {
  const update = (patch: ArchElementPatch): void => {
    arch().update(element.id, patch);
  };
  const levels = project.levels.map((level) => ({ value: level.id, label: level.name }));
  const types =
    element.kind === 'space'
      ? []
      : project.architecture.types.filter(
          (type) => type.category === ARCH_KIND_CATEGORY[element.kind],
        );
  return (
    <>
      <TextField
        label="Nome"
        value={element.name}
        testId="arch-prop-name"
        onCommit={(name) => update({ name })}
      />
      {element.kind !== 'space' && (
        <SelectField
          label="Tipo"
          value={element.typeId}
          testId="arch-prop-type"
          options={types.map((type) => ({
            value: type.id,
            label: `${type.name} · ${archTypeSizeLabel(type)}`,
          }))}
          onChange={(typeId) => update({ typeId })}
        />
      )}
      {element.kind !== 'door' && element.kind !== 'window' && (
        <SelectField
          label="Nível"
          value={element.levelId}
          testId="arch-prop-level"
          options={levels}
          onChange={(levelId) => update({ levelId })}
        />
      )}
      <ElevationRows element={element} project={project} />
      {element.kind === 'wall' && (
        <>
          <NumberField
            label="Altura"
            unit="m"
            value={element.height}
            testId="arch-prop-height"
            onCommit={(height) => update({ height })}
          />
          <NumberField
            label="Deslocamento da base"
            unit="m"
            value={element.baseOffset}
            testId="arch-prop-base-offset"
            onCommit={(baseOffset) => update({ baseOffset })}
          />
          <SelectField
            label="Linha de referência"
            value={element.locationLine}
            testId="arch-prop-location-line"
            options={LOCATION_LINE_OPTIONS}
            onChange={(locationLine) => update({ locationLine })}
          />
          {(['start', 'end'] as const).map((end) => (
            <div key={end} className="arch-fields">
              {(['x', 'y'] as const).map((axis) => (
                <NumberField
                  key={axis}
                  label={`${end === 'start' ? 'Início' : 'Fim'} ${axis.toUpperCase()}`}
                  unit="m"
                  value={element[end][axis]}
                  testId={`arch-prop-${end}-${axis}`}
                  onCommit={(value) => update({ [end]: { ...element[end], [axis]: value } })}
                />
              ))}
            </div>
          ))}
        </>
      )}
      {(element.kind === 'slab' || element.kind === 'flooring') && (
        <>
          <NumberField
            label={
              element.kind === 'slab'
                ? 'Cota do topo (rel. ao nível)'
                : 'Cota da base (rel. ao nível)'
            }
            unit="m"
            value={element.offset}
            testId="arch-prop-offset"
            onCommit={(offset) => update({ offset })}
          />
          <div data-testid="arch-openings">
            <span className="row__label">Aberturas ({element.openings.length})</span>
            {element.openings.length === 0 && (
              <p className="muted">
                Nenhuma. Use Arquitetura › Abertura no piso com este elemento selecionado.
              </p>
            )}
            {element.openings.map((opening, index) => (
              <div key={opening.id} className="row" data-testid="arch-opening">
                <span className="row__label">
                  Abertura {index + 1} · {opening.boundary.length} vértices
                </span>
                <button
                  type="button"
                  className="btn btn--compact"
                  data-testid="arch-opening-remove"
                  title="Remover esta abertura do piso"
                  onClick={() => arch().removeOpening(element.id, opening.id)}
                >
                  <Trash2 size={13} /> Remover
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {(element.kind === 'door' || element.kind === 'window') && (
        <>
          <ReadOnlyRow
            label="Parede hospedeira"
            value={getArchElement(project.architecture, element.hostId)?.name ?? '—'}
          />
          <NumberField
            label="Posição na parede (do início ao centro do vão)"
            unit="m"
            value={element.offset}
            testId="arch-prop-position"
            onCommit={(offset) => update({ offset })}
          />
          <NumberField
            label={element.kind === 'door' ? 'Soleira (acima da base)' : 'Peitoril'}
            unit="m"
            value={element.sillHeight}
            testId="arch-prop-sill"
            onCommit={(sillHeight) => update({ sillHeight })}
          />
          <SelectField
            label={element.kind === 'door' ? 'Mão (dobradiças)' : 'Mão'}
            value={element.hand}
            testId="arch-prop-hand"
            options={HAND_OPTIONS}
            onChange={(hand) => update({ hand })}
          />
          <SelectField
            label="Abre para"
            value={element.facing === 1 ? '1' : '-1'}
            testId="arch-prop-facing"
            options={FACING_OPTIONS}
            onChange={(facing) => update({ facing: facing === '1' ? 1 : -1 })}
          />
        </>
      )}
      {element.kind === 'space' && (
        <>
          <TextField
            label="Número"
            value={element.number ?? ''}
            testId="arch-prop-number"
            onCommit={(number) => update({ number: number.trim() === '' ? null : number })}
          />
          <OptionalNumberField
            label="Pé-direito"
            unit="m"
            value={element.height}
            placeholder="não informado"
            testId="arch-prop-space-height"
            onCommit={(height) => update({ height })}
          />
          <NumberField
            label="Cota do piso (rel. ao nível)"
            unit="m"
            value={element.offset}
            testId="arch-prop-offset"
            onCommit={(offset) => update({ offset })}
          />
        </>
      )}
    </>
  );
}

/** Campo numérico livre dos comandos de Modificar (não confirma nada sozinho). */
function DraftNumber({
  label,
  unit,
  value,
  testId,
  onChange,
}: {
  label: string;
  unit: string;
  value: string;
  testId: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <span className="field__control">
        <input
          data-testid={testId}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
        />
        <span className="field__unit">{unit}</span>
      </span>
    </label>
  );
}

/** Mover, copiar, girar e espelhar a seleção: cada botão chama a operação do núcleo. */
function ModifySection({ ids, project }: { ids: readonly string[]; project: Project }) {
  const center = useMemo(
    () => planCenterOf(project.architecture, ids) ?? { x: 0, y: 0 },
    [project.architecture, ids],
  );
  const [delta, setDelta] = useState({ dx: '0', dy: '0', dz: '0' });
  const [angle, setAngle] = useState('90');
  const [pivot, setPivot] = useState({ x: '', y: '' });
  const [axis, setAxis] = useState({ ax: '', ay: '', bx: '', by: '' });
  const number = (text: string, fallback: number): number => {
    const parsed = text.trim() === '' ? fallback : parseDecimal(text);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };
  const refuse = (): void =>
    useEditorStore.getState().notify('error', 'Valor inválido: confira os números digitados.');
  const shift = (): { delta: { x: number; y: number }; dz: number } | null => {
    const x = number(delta.dx, 0);
    const y = number(delta.dy, 0);
    const dz = number(delta.dz, 0);
    if (![x, y, dz].every(Number.isFinite)) {
      refuse();
      return null;
    }
    return { delta: { x, y }, dz };
  };
  const turn = (copy: boolean): void => {
    const degrees = number(angle, 0);
    const x = number(pivot.x, center.x);
    const y = number(pivot.y, center.y);
    if (![degrees, x, y].every(Number.isFinite)) refuse();
    else arch().rotate({ x, y }, degToRad(degrees), copy);
  };
  const flip = (copy: boolean): void => {
    const values = [axis.ax, axis.ay, axis.bx, axis.by].map((text) => number(text, Number.NaN));
    const [ax, ay, bx, by] = values;
    if (ax === undefined || ay === undefined || bx === undefined || by === undefined) return;
    if (!values.every(Number.isFinite)) {
      useEditorStore
        .getState()
        .notify('error', 'Espelhar: informe os dois pontos do eixo (X e Y de cada um).');
      return;
    }
    arch().mirror({ x: ax, y: ay }, { x: bx, y: by }, copy);
  };
  return (
    <Section title="Modificar" testId="arch-section-modify">
      <div className="arch-fields">
        <DraftNumber
          label="ΔX"
          unit="m"
          value={delta.dx}
          testId="arch-move-dx"
          onChange={(dx) => setDelta({ ...delta, dx })}
        />
        <DraftNumber
          label="ΔY"
          unit="m"
          value={delta.dy}
          testId="arch-move-dy"
          onChange={(dy) => setDelta({ ...delta, dy })}
        />
        <DraftNumber
          label="ΔZ"
          unit="m"
          value={delta.dz}
          testId="arch-move-dz"
          onChange={(dz) => setDelta({ ...delta, dz })}
        />
      </div>
      <div className="arch-actions">
        <button
          type="button"
          className="btn btn--compact"
          data-testid="arch-move-apply"
          onClick={() => {
            const value = shift();
            if (value) arch().move(value.delta, value.dz);
          }}
        >
          Mover
        </button>
        <button
          type="button"
          className="btn btn--compact"
          data-testid="arch-copy-apply"
          onClick={() => {
            const value = shift();
            if (value) arch().copy(value.delta, value.dz);
          }}
        >
          Copiar
        </button>
      </div>
      <div className="arch-fields">
        <DraftNumber
          label="Ângulo (anti-horário)"
          unit="°"
          value={angle}
          testId="arch-rotate-angle"
          onChange={setAngle}
        />
        <DraftNumber
          label={`Centro X (vazio = ${formatDecimal(center.x, 3)})`}
          unit="m"
          value={pivot.x}
          testId="arch-rotate-cx"
          onChange={(x) => setPivot({ ...pivot, x })}
        />
        <DraftNumber
          label={`Centro Y (vazio = ${formatDecimal(center.y, 3)})`}
          unit="m"
          value={pivot.y}
          testId="arch-rotate-cy"
          onChange={(y) => setPivot({ ...pivot, y })}
        />
      </div>
      <div className="arch-actions">
        <button
          type="button"
          className="btn btn--compact"
          data-testid="arch-rotate-apply"
          onClick={() => turn(false)}
        >
          Girar
        </button>
        <button
          type="button"
          className="btn btn--compact"
          data-testid="arch-rotate-copy"
          onClick={() => turn(true)}
        >
          Girar uma cópia
        </button>
      </div>
      <div className="arch-fields">
        {(['ax', 'ay', 'bx', 'by'] as const).map((key) => (
          <DraftNumber
            key={key}
            label={`Eixo de espelho · ponto ${key.startsWith('a') ? '1' : '2'} ${key.endsWith('x') ? 'X' : 'Y'}`}
            unit="m"
            value={axis[key]}
            testId={`arch-mirror-${key}`}
            onChange={(value) => setAxis({ ...axis, [key]: value })}
          />
        ))}
      </div>
      <div className="arch-actions">
        <button
          type="button"
          className="btn btn--compact"
          data-testid="arch-mirror-apply"
          onClick={() => flip(false)}
        >
          Espelhar
        </button>
        <button
          type="button"
          className="btn btn--compact"
          data-testid="arch-mirror-copy"
          onClick={() => flip(true)}
        >
          Espelhar uma cópia
        </button>
      </div>
    </Section>
  );
}

function SingleElement({ element, project }: { element: ArchElement; project: Project }) {
  // O mesmo modelo de informação que a exportação IFC grava: o que se vê é o que se exporta.
  const model = useMemo(
    () => buildArchIfcModel(project),
    // A identidade do projeto muda a cada alteração; a arquitetura e os níveis bastam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.id, project.levels, project.architecture],
  );
  const info = model.elements.find((item) => item.elementId === element.id);
  const type = info?.typeKey ? model.types.find((item) => item.key === info.typeKey) : undefined;
  const rows = useMemo(() => (info ? archPanelRows(info, type) : null), [info, type]);
  const usage =
    element.kind === 'space' ? 0 : archTypeUsage(project.architecture, element.typeId).length;
  if (!info || !rows) return null;
  const details: Partial<Record<ArchPropertyGroup, ReactNode>> = {
    classification: <ClassificationDetails info={info} type={type} />,
    materials: <MaterialDetails type={type} />,
  };
  return (
    <>
      <Section title="Ocorrência" testId="arch-section-instance">
        <InstanceFields element={element} project={project} />
      </Section>
      {type && (
        <p className="arch-type-usage" data-testid="arch-type-usage" data-count={usage}>
          Tipo <strong>{type.name}</strong>: compartilhado por {usage}{' '}
          {usage === 1 ? 'ocorrência' : 'ocorrências'}. Alterar um valor marcado <b>T</b> Tipo vale
          para todas elas.
        </p>
      )}
      {ARCH_PROPERTY_GROUPS.map((group) => (
        <Section key={group} title={ARCH_GROUP_LABELS[group]} testId={`arch-group-${group}`}>
          {details[group]}
          {rows[group].map((row) => (
            <PropertyRow
              key={`${row.scope}:${row.property.key}`}
              row={row}
              elementId={element.id}
            />
          ))}
          {rows[group].length === 0 && !details[group] && (
            <p className="muted">Nenhuma propriedade deste grupo para a categoria.</p>
          )}
        </Section>
      ))}
    </>
  );
}

/**
 * Painel de propriedades da seleção arquitetônica: ocorrência, tipo e os grupos de informação
 * IFC. Não guarda regras: lê o projeto e chama as operações pela sessão da arquitetura.
 */
export function ArchProperties() {
  const project = useEditorStore((s) => s.project);
  const selection = useArchStore((s) => s.selection);
  const reveal = useUiStore((s) => s.reveal);
  const rootRef = useRef<HTMLElement>(null);
  const elements = selection
    .map((id) => getArchElement(project.architecture, id))
    .filter((element): element is ArchElement => element !== undefined);
  const single = elements.length === 1 ? elements[0] : undefined;
  const Icon = single ? ARCH_ICONS[single.kind] : Layers2;

  // Os comandos de Modificar da faixa levam ao campo que executa a operação.
  useEffect(() => {
    if (!reveal) return;
    const target = rootRef.current?.querySelector<HTMLElement>(`[data-testid="${reveal.target}"]`);
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    if (target instanceof HTMLInputElement) {
      target.focus();
      target.select();
    }
  }, [reveal]);

  return (
    <aside
      className="panel inspector"
      aria-label="Propriedades"
      ref={rootRef}
      data-testid="properties-panel"
      data-arch="true"
    >
      <header className="panel__header inspector__header">
        <span className="inspector__identity-icon" aria-hidden>
          <Icon size={23} strokeWidth={1.5} />
        </span>
        <div className="inspector__identity">
          <span className="inspector__type" data-testid="properties-type">
            {single ? ARCH_KIND_LABELS[single.kind] : 'Seleção múltipla'}
          </span>
          <h2 data-testid="properties-title" title={single?.name}>
            {single ? single.name : `${elements.length} elementos de arquitetura`}
          </h2>
        </div>
        <button
          type="button"
          className="inspector__back"
          data-testid="back-to-project"
          aria-label="Ver projeto"
          title="Limpar a seleção e ver o resumo do projeto"
          onClick={() => arch().select(null)}
        >
          <ArrowLeft size={15} aria-hidden />
        </button>
      </header>
      <span
        className={`panel__scope panel__scope--${single ? 'single' : 'multi'}`}
        data-testid="properties-scope"
      >
        {single
          ? `Arquitetura · ${ARCH_KIND_LABELS[single.kind]}`
          : 'Arquitetura · seleção múltipla'}
      </span>
      <div className="panel__scroll" data-testid="arch-properties">
        {single && <SingleElement element={single} project={project} />}
        <ModifySection ids={selection} project={project} />
        <div className="arch-actions">
          <button
            type="button"
            className="btn btn--danger"
            data-testid="arch-delete"
            onClick={() => arch().deleteSelected()}
          >
            <Trash2 size={15} /> Excluir selecionados
          </button>
        </div>
      </div>
    </aside>
  );
}
