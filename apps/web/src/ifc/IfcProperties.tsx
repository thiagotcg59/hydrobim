import {
  findIfcModel,
  findIfcObject,
  formatMeters,
  ifcObjectTransform,
  type IfcImportedModel,
  type IfcImportedObject,
  type IfcTransform,
} from '@hydrobim/core';
import type {
  IfcObjectProperties,
  IfcObjectSummary,
  IfcPropertyEntry,
  IfcPropertyGroup,
} from '@hydrobim/ifc-import';
import { Copy, Crosshair, EyeOff, FileBox, Focus, Move, RotateCw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useEditorStore } from '../state/editorStore';
import { NumberField, ReadOnlyRow, Section, TextField } from '../ui/fields';
import { transformBounds } from './ifcGeometry';
import {
  fetchIfcProperties,
  ifcSelectionBounds,
  ifcSourceOf,
  useIfcStore,
  type IfcSourceStatus,
} from './ifcStore';
import { IFC_GEOMETRY_LABELS, ifcObjectLabel } from './ifcTree';

/**
 * Painel de propriedades dos objetos IFC importados. Mostra o que o ARQUIVO informa
 * (recebido, com a unidade e o tipo de valor dele), o que o HydroBIM calcula (posição e
 * dimensões no projeto) e o que não foi informado — sem preencher lacunas. Objetos importados
 * não têm edição paramétrica: só posição, cópia, visibilidade e remoção.
 */

type Nature = 'occurrence' | 'type' | 'calculated' | 'pending';

const NATURE_LABELS: Record<Nature, string> = {
  occurrence: 'Recebido',
  type: 'Recebido do tipo',
  calculated: 'Calculado',
  pending: 'Não informado',
};
const NATURE_MARKS: Record<Nature, string> = {
  occurrence: 'R',
  type: 'T',
  calculated: 'ƒ',
  pending: '?',
};
const NATURE_HINTS: Record<Nature, string> = {
  occurrence: 'Valor lido do arquivo IFC, na ocorrência',
  type: 'Valor lido do arquivo IFC, no tipo associado (vale para todas as ocorrências do tipo)',
  calculated: 'Valor calculado pelo HydroBIM a partir da geometria e do posicionamento',
  pending: 'O arquivo não informa este valor',
};

const number = (value: number): string =>
  value.toLocaleString('pt-BR', { maximumFractionDigits: 6 });

const scalar = (value: string | number | boolean): string =>
  typeof value === 'boolean'
    ? value
      ? 'Sim'
      : 'Não'
    : typeof value === 'number'
      ? number(value)
      : value;

/** Texto do valor como está no arquivo, com a unidade dele. */
function valueText(entry: IfcPropertyEntry): string | null {
  const unit = entry.unit ? ` ${entry.unit}` : '';
  if (entry.kind === 'enumerated' || entry.kind === 'list') {
    return entry.values && entry.values.length > 0
      ? entry.values.map(scalar).join('; ') + unit
      : null;
  }
  if (entry.kind === 'bounded') {
    if (entry.lower === null && entry.upper === null && entry.value === null) return null;
    const range = `${entry.lower === null ? '…' : scalar(entry.lower)} a ${entry.upper === null ? '…' : scalar(entry.upper)}`;
    return `${range}${unit}${entry.value !== null ? ` (ajuste ${scalar(entry.value)})` : ''}`;
  }
  if (entry.kind === 'unsupported') return null;
  return entry.value === null ? null : `${scalar(entry.value)}${unit}`;
}

function Row({
  label,
  code,
  value,
  nature,
  property,
}: {
  label: string;
  code?: string | null;
  value: ReactNode | null;
  nature: Nature;
  property?: string;
}) {
  const shown: Nature = value === null ? 'pending' : nature;
  return (
    <div
      className={`arch-prop arch-prop--${shown}`}
      data-testid="ifc-import-property"
      data-property={property ?? label}
      data-nature={shown}
    >
      <span className="arch-prop__label">
        {label}
        {code && <code>{code}</code>}
      </span>
      <span className="arch-prop__value ifc-props__value">{value ?? '—'}</span>
      <span className="arch-prop__nature">
        <span className={`arch-nature arch-nature--${shown}`} title={NATURE_HINTS[shown]}>
          <b aria-hidden>{NATURE_MARKS[shown]}</b>
          {NATURE_LABELS[shown]}
        </span>
      </span>
    </div>
  );
}

function GroupSection({ group }: { group: IfcPropertyGroup }) {
  const scope = group.scope === 'type' ? ' (tipo)' : '';
  return (
    <Section title={`${group.name}${scope}`} testId={`ifc-group-${group.scope}-${group.name}`}>
      {group.properties.length === 0 && <p className="ifc-note">Conjunto sem propriedades.</p>}
      {group.properties.map((entry, index) => (
        <Row
          key={`${entry.name}:${index}`}
          label={entry.name}
          code={entry.kind === 'unsupported' ? `${entry.valueType} (não lido)` : entry.valueType}
          value={valueText(entry)}
          nature={group.scope}
          property={`${group.name}.${entry.name}`}
        />
      ))}
    </Section>
  );
}

const degrees = (radians: number): string =>
  `${((radians * 180) / Math.PI).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}°`;

const transformText = (transform: IfcTransform): string =>
  `ΔX ${formatMeters(transform.translation.x, 3)} · ΔY ${formatMeters(transform.translation.y, 3)} · ΔZ ${formatMeters(transform.translation.z, 3)} · giro ${degrees(transform.rotation)}`;

/** Mover, girar, copiar, enquadrar, ocultar, isolar e remover — para o modelo ou componentes. */
function ModifySection({ whole, ids }: { whole: boolean; ids: readonly string[] }) {
  const [delta, setDelta] = useState({ x: 0, y: 0, z: 0 });
  const [angle, setAngle] = useState(90);
  const ifc = useIfcStore.getState;
  return (
    <Section title="Modificar" testId="ifc-modify">
      <NumberField
        label="ΔX"
        unit="m"
        value={delta.x}
        onCommit={(x) => setDelta((d) => ({ ...d, x }))}
        testId="ifc-move-dx"
      />
      <NumberField
        label="ΔY"
        unit="m"
        value={delta.y}
        onCommit={(y) => setDelta((d) => ({ ...d, y }))}
        testId="ifc-move-dy"
      />
      <NumberField
        label="ΔZ"
        unit="m"
        value={delta.z}
        onCommit={(z) => setDelta((d) => ({ ...d, z }))}
        testId="ifc-move-dz"
      />
      <div className="ifc-actions-row">
        <button
          type="button"
          className="btn"
          data-testid="ifc-move-apply"
          title="Desloca a seleção pelos valores informados"
          onClick={() => ifc().moveSelection(delta)}
        >
          <Move size={14} /> Mover
        </button>
        {!whole && (
          <button
            type="button"
            className="btn"
            data-testid="ifc-copy-apply"
            title="Cria cópias deslocadas pelos valores informados, com identidades internas novas"
            onClick={() => ifc().copySelection(delta)}
          >
            <Copy size={14} /> Copiar
          </button>
        )}
      </div>
      <NumberField
        label="Giro"
        unit="°"
        digits={4}
        value={angle}
        onCommit={setAngle}
        testId="ifc-rotate-angle"
        title="Em torno do eixo vertical, anti-horário visto de cima, pelo centro da seleção"
      />
      <div className="ifc-actions-row">
        <button
          type="button"
          className="btn"
          data-testid="ifc-rotate-apply"
          title="Gira a seleção em torno do eixo vertical que passa pelo centro dela"
          onClick={() => ifc().rotateSelection(angle)}
        >
          <RotateCw size={14} /> Girar
        </button>
        <button
          type="button"
          className="btn"
          data-testid="ifc-frame"
          title="Enquadra a seleção nas vistas"
          onClick={() => useEditorStore.getState().requestView('fit', { selection: true })}
        >
          <Focus size={14} /> Enquadrar
        </button>
        {!whole && (
          <>
            <button
              type="button"
              className="btn"
              data-testid="ifc-hide"
              title="Oculta os objetos selecionados (nesta sessão)"
              onClick={() => {
                ifc().setHidden(ids, true);
                ifc().select(null);
              }}
            >
              <EyeOff size={14} /> Ocultar
            </button>
            <button
              type="button"
              className="btn"
              data-testid="ifc-isolate"
              title="Oculta os demais objetos importados"
              onClick={() => ifc().isolate(ids)}
            >
              <Crosshair size={14} /> Isolar
            </button>
          </>
        )}
        <button
          type="button"
          className="btn btn--danger"
          data-testid="ifc-remove"
          title={whole ? 'Remove o modelo importado do projeto' : 'Remove os objetos selecionados'}
          onClick={() => ifc().removeSelection()}
        >
          <Trash2 size={14} /> Remover
        </button>
      </div>
      <p className="ifc-note">
        Objetos importados são referência: não têm edição paramétrica nem criam conexões
        hidráulicas. Cada alteração é um passo do histórico (desfazer/refazer).
      </p>
    </Section>
  );
}

function Header({ type, title, scope }: { type: string; title: string; scope: string }) {
  return (
    <header className="panel__header inspector__header">
      <span className="inspector__identity-icon" aria-hidden>
        <FileBox size={20} />
      </span>
      <div className="inspector__identity">
        <span className="inspector__type" data-testid="properties-type">
          {type}
        </span>
        <h2 data-testid="properties-title">{title}</h2>
      </div>
      <span className="panel__scope panel__scope--single" data-testid="properties-scope">
        {scope}
      </span>
    </header>
  );
}

function ObjectPanel({ model, object }: { model: IfcImportedModel; object: IfcImportedObject }) {
  const revision = useIfcStore((s) => s.revision);
  const status = useIfcStore((s) => s.sources[model.source.sha256]);
  const source = useMemo(
    () => ifcSourceOf(model.source.sha256),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model.source.sha256, revision],
  );
  const summary: IfcObjectSummary | null = source?.objects.get(object.expressId) ?? null;
  const [properties, setProperties] = useState<IfcObjectProperties | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  useEffect(() => {
    let alive = true;
    setState('loading');
    setProperties(null);
    if (!source) {
      setState('unavailable');
      return undefined;
    }
    void fetchIfcProperties(model, object.expressId).then((result) => {
      if (!alive) return;
      setProperties(result);
      setState(result ? 'ready' : 'unavailable');
    });
    return () => {
      alive = false;
    };
  }, [model, object.expressId, source]);

  const transform = ifcObjectTransform(model, object);
  const bounds = summary?.bounds ? transformBounds(summary.bounds, transform) : null;
  const name = properties?.name ?? summary?.name ?? null;
  const entity = properties?.entity ?? summary?.entity ?? 'Objeto IFC';
  return (
    <aside
      className="panel inspector"
      data-testid="ifc-properties"
      data-ifc-id={object.id}
      data-state={state}
    >
      <Header
        type={`${entity}${object.copy ? ' · cópia' : ''}`}
        title={name ?? (summary ? ifcObjectLabel(summary) : object.globalId)}
        scope="Objeto IFC importado"
      />
      <div className="panel__scroll">
        <Section title="Identificação" testId="ifc-identity">
          <Row label="Arquivo de origem" value={model.source.fileName} nature="occurrence" />
          <Row
            label="GlobalId original"
            code="GlobalId"
            value={object.globalId || null}
            nature="occurrence"
            property="GlobalId"
          />
          <Row label="Entidade IFC" value={entity} nature="occurrence" property="Entity" />
          <Row
            label="Tipo predefinido"
            code="PredefinedType"
            value={properties?.predefinedType ?? summary?.predefinedType ?? null}
            nature="occurrence"
            property="PredefinedType"
          />
          <Row
            label="Tipo associado"
            code={properties?.type?.entity}
            value={properties?.type?.name ?? summary?.typeName ?? null}
            nature="occurrence"
            property="Type"
          />
          <Row label="Nome" code="Name" value={name} nature="occurrence" property="Name" />
          <Row
            label="Descrição"
            code="Description"
            value={properties?.description ?? null}
            nature="occurrence"
            property="Description"
          />
          <Row
            label="Tipo de objeto"
            code="ObjectType"
            value={properties?.objectType ?? summary?.objectType ?? null}
            nature="occurrence"
            property="ObjectType"
          />
          <Row
            label="Etiqueta"
            code="Tag"
            value={properties?.tag ?? summary?.tag ?? null}
            nature="occurrence"
            property="Tag"
          />
          <Row
            label="Pavimento"
            value={properties?.storeyName ?? summary?.storeyName ?? null}
            nature="occurrence"
            property="Storey"
          />
          <Row
            label="Identidade interna"
            value={`${object.id}${object.copy ? ' (cópia do componente de mesmo GlobalId)' : ''}`}
            nature="calculated"
            property="InternalId"
          />
          <Row
            label="Linha no arquivo"
            value={`#${object.expressId}`}
            nature="occurrence"
            property="ExpressId"
          />
        </Section>

        <Section title="Geometria e posição no projeto" testId="ifc-geometry">
          <Row
            label="Representação"
            value={
              summary
                ? `${IFC_GEOMETRY_LABELS[summary.geometry]}${summary.representations.length > 0 ? ` (${summary.representations.join('; ')})` : ''}`
                : null
            }
            nature="occurrence"
            property="Geometry"
          />
          <Row
            label="Dimensões da envoltória"
            value={
              bounds
                ? `${formatMeters(bounds[3] - bounds[0], 3)} × ${formatMeters(bounds[4] - bounds[1], 3)} × ${formatMeters(bounds[5] - bounds[2], 3)}`
                : null
            }
            nature="calculated"
            property="BoundsSize"
          />
          <Row
            label="Envoltória mínima (X; Y; Z)"
            value={
              bounds
                ? `${formatMeters(bounds[0], 3)}; ${formatMeters(bounds[1], 3)}; ${formatMeters(bounds[2], 3)}`
                : null
            }
            nature="calculated"
            property="BoundsMin"
          />
          <Row
            label="Envoltória máxima (X; Y; Z)"
            value={
              bounds
                ? `${formatMeters(bounds[3], 3)}; ${formatMeters(bounds[4], 3)}; ${formatMeters(bounds[5], 3)}`
                : null
            }
            nature="calculated"
            property="BoundsMax"
          />
          <Row
            label="Transformação do modelo"
            value={transformText(model.placement)}
            nature="calculated"
            property="ModelTransform"
          />
          <Row
            label="Transformação do componente"
            value={
              object.transform
                ? transformText(object.transform)
                : 'nenhuma (no lugar original do modelo)'
            }
            nature="calculated"
            property="ObjectTransform"
          />
          {(properties?.portCount ?? 0) > 0 && (
            <Row
              label="Portas IFC"
              value={`${properties?.portCount} (informativo: não criam conexões hidráulicas)`}
              nature="occurrence"
              property="Ports"
            />
          )}
        </Section>

        <ModifySection whole={false} ids={[object.id]} />

        {state === 'loading' && <p className="ifc-note">Lendo as propriedades do arquivo…</p>}
        {state === 'unavailable' && (
          <p className="ifc-note" data-testid="ifc-properties-unavailable">
            {status?.status === 'missing'
              ? 'Arquivo-fonte ausente: as propriedades voltam quando o arquivo original for religado.'
              : status?.status === 'error'
                ? status.message
                : 'As propriedades ficam disponíveis quando a leitura do arquivo-fonte terminar.'}
          </p>
        )}
        {properties && (
          <>
            <Section title="Materiais" testId="ifc-materials">
              {properties.materials.length === 0 && (
                <Row label="Material" value={null} nature="occurrence" property="Material" />
              )}
              {properties.materials.map((material, index) => (
                <Row
                  key={index}
                  label={
                    material.role === 'layer'
                      ? `Camada ${index + 1}`
                      : material.role === 'constituent'
                        ? `Constituinte ${index + 1}`
                        : material.role === 'profile'
                          ? `Perfil ${index + 1}`
                          : 'Material'
                  }
                  code={material.setName}
                  value={`${material.name}${material.thickness !== null ? ` · ${number(material.thickness)}${material.thicknessUnit ? ` ${material.thicknessUnit}` : ''}` : ''}${material.category ? ` · ${material.category}` : ''}`}
                  nature={material.scope}
                  property={`Material.${index}`}
                />
              ))}
            </Section>
            <Section title="Classificações" testId="ifc-classifications">
              {properties.classifications.length === 0 && (
                <Row
                  label="Classificação"
                  value={null}
                  nature="occurrence"
                  property="Classification"
                />
              )}
              {properties.classifications.map((item, index) => (
                <Row
                  key={index}
                  label={`${item.system ?? 'Sistema não informado'}${item.edition ? ` (${item.edition})` : ''}`}
                  value={[item.identification, item.name].filter(Boolean).join(' — ') || null}
                  nature={item.scope}
                  property={`Classification.${index}`}
                />
              ))}
            </Section>
            {properties.groups.length === 0 && (
              <p className="ifc-note">
                O arquivo não traz conjuntos de propriedades nem de quantidades para este objeto.
              </p>
            )}
            {properties.groups.map((group) => (
              <GroupSection key={`${group.scope}:${group.expressId}`} group={group} />
            ))}
          </>
        )}
      </div>
    </aside>
  );
}

const SOURCE_TEXT = (status: IfcSourceStatus | undefined): string =>
  status?.status === 'loading'
    ? `Lendo: ${status.label}${status.fraction !== null ? ` (${Math.round(status.fraction * 100)}%)` : ''}`
    : status?.status === 'error'
      ? `Falha na leitura: ${status.message}`
      : status?.status === 'missing'
        ? 'Arquivo-fonte ausente neste navegador'
        : 'Arquivo-fonte guardado no projeto e lido';

function ModelPanel({ model }: { model: IfcImportedModel }) {
  const status = useIfcStore((s) => s.sources[model.source.sha256]);
  const revision = useIfcStore((s) => s.revision);
  const fileRef = useRef<HTMLInputElement>(null);
  const source = useMemo(
    () => ifcSourceOf(model.source.sha256),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model.source.sha256, revision],
  );
  const bounds = useMemo(
    () => ifcSelectionBounds(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, revision],
  );
  const copies = model.objects.filter((object) => object.copy).length;
  const without = source
    ? model.objects.filter((object) => source.objects.get(object.expressId)?.geometry !== 'ok')
        .length
    : null;
  return (
    <aside className="panel inspector" data-testid="ifc-model-properties" data-model-id={model.id}>
      <Header type={model.schema} title={model.name} scope="Modelo IFC importado" />
      <div className="panel__scroll">
        <Section title="Arquivo de origem" testId="ifc-model-source">
          <TextField
            label="Nome no projeto"
            value={model.name}
            onCommit={(name) => useIfcStore.getState().setModelDisplay(model.id, { name })}
            testId="ifc-model-name"
          />
          <ReadOnlyRow label="Arquivo" value={model.source.fileName} />
          <ReadOnlyRow
            label="Esquema IFC"
            value={<span data-testid="ifc-model-schema">{model.schema}</span>}
          />
          <ReadOnlyRow
            label="Unidade de comprimento"
            value={`${model.lengthUnit} (1 unidade = ${number(model.unitScale)} m)`}
          />
          <ReadOnlyRow
            label="Tamanho"
            value={`${(model.source.byteLength / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`}
          />
          <ReadOnlyRow
            label="SHA-256"
            value={<code title={model.source.sha256}>{model.source.sha256.slice(0, 16)}…</code>}
          />
          <ReadOnlyRow
            label="Importado em"
            value={new Date(model.importedAt).toLocaleString('pt-BR')}
          />
          <ReadOnlyRow
            label="Situação"
            value={
              <span data-testid="ifc-model-status" data-status={status?.status ?? 'ready'}>
                {SOURCE_TEXT(status)}
              </span>
            }
          />
          {status?.status === 'missing' && (
            <>
              <p className="ifc-note">
                Este projeto foi salvo no navegador e o arquivo-fonte não está mais no armazenamento
                dele. Selecione o arquivo .ifc original para religá-lo (o conteúdo é conferido pelo
                SHA-256).
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".ifc"
                hidden
                data-testid="ifc-relink-file"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  await useIfcStore.getState().relinkSource(model.id, {
                    name: file.name,
                    bytes: new Uint8Array(await file.arrayBuffer()),
                  });
                }}
              />
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                Religar arquivo original…
              </button>
            </>
          )}
        </Section>

        <Section title="Conteúdo incluído" testId="ifc-model-content">
          <ReadOnlyRow
            label="Objetos"
            value={<span data-testid="ifc-model-objects">{model.objects.length}</span>}
          />
          <ReadOnlyRow label="Cópias de componentes" value={copies} />
          <ReadOnlyRow
            label="Sem geometria"
            value={
              without === null ? '—' : `${without} (na árvore e nas propriedades, sem desenho)`
            }
          />
        </Section>

        <Section title="Posição no projeto" testId="ifc-model-placement">
          <ReadOnlyRow
            label="Transformação"
            value={<span data-testid="ifc-model-transform">{transformText(model.placement)}</span>}
          />
          <ReadOnlyRow
            label="Envoltória (X)"
            value={bounds ? `${formatMeters(bounds[0], 3)} a ${formatMeters(bounds[3], 3)}` : '—'}
          />
          <ReadOnlyRow
            label="Envoltória (Y)"
            value={bounds ? `${formatMeters(bounds[1], 3)} a ${formatMeters(bounds[4], 3)}` : '—'}
          />
          <ReadOnlyRow
            label="Envoltória (Z)"
            value={bounds ? `${formatMeters(bounds[2], 3)} a ${formatMeters(bounds[5], 3)}` : '—'}
          />
        </Section>

        <Section title="Exibição" testId="ifc-model-display">
          <label className="ifc-opacity">
            <input
              type="checkbox"
              checked={model.visible}
              data-testid="ifc-model-visible"
              onChange={(event) =>
                useIfcStore.getState().setModelDisplay(model.id, { visible: event.target.checked })
              }
            />
            Visível
          </label>
          <label className="ifc-opacity">
            Opacidade
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={Math.round(model.opacity * 100)}
              data-testid="ifc-model-opacity"
              onChange={(event) =>
                useIfcStore
                  .getState()
                  .setModelDisplay(model.id, { opacity: Number(event.target.value) / 100 })
              }
            />
            <span data-testid="ifc-model-opacity-value">{Math.round(model.opacity * 100)}%</span>
          </label>
        </Section>

        <ModifySection whole ids={[]} />

        <Section title="Exportações" testId="ifc-model-exports">
          <p className="ifc-note">
            O arquivo do projeto (.hydrobim.json) leva o arquivo-fonte, os objetos incluídos e as
            transformações. As exportações IFC, DXF, SVG, CSV, INP e IDS não incluem os objetos
            importados.
          </p>
        </Section>
      </div>
    </aside>
  );
}

function ManyPanel({ ids }: { ids: readonly string[] }) {
  return (
    <aside className="panel inspector" data-testid="ifc-properties" data-count={ids.length}>
      <Header
        type="Seleção"
        title={`${ids.length} objetos IFC importados`}
        scope="Seleção múltipla"
      />
      <div className="panel__scroll">
        <ModifySection whole={false} ids={ids} />
      </div>
    </aside>
  );
}

export function IfcProperties() {
  const project = useEditorStore((s) => s.project);
  const selection = useIfcStore((s) => s.selection);
  const modelSelection = useIfcStore((s) => s.modelSelection);
  if (modelSelection) {
    const model = findIfcModel(project, modelSelection);
    return model ? <ModelPanel model={model} /> : null;
  }
  if (selection.length > 1) return <ManyPanel ids={selection} />;
  const ref = selection[0] ? findIfcObject(project, selection[0]) : null;
  return ref ? <ObjectPanel model={ref.model} object={ref.object} /> : null;
}
