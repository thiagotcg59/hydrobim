import {
  FLANGE_PRESSURE_CLASSES,
  flangedPipeFamiliesFor,
  JOINT_TYPE_LABELS,
  MATERIAL_LABELS,
  PIPE_END_CONFIGURATION_LABELS,
  PIPE_END_CONFIGURATIONS,
  pipeEndConfigurationOf,
} from '@hydrobim/catalog';
import {
  connectedComponent,
  connectedPortRef,
  elementElevation,
  degToRad,
  elementKindLabel,
  formatMeters,
  formatMillimeters,
  getElement,
  getPorts,
  mmToM,
  mToMm,
  isPipeRun,
  pipeLength,
  pipeRunSummary,
  PUMP_DIMENSION_KEYS,
  PUMP_DIMENSION_LABELS,
  pumpLengthMismatch,
  pumpModelRange,
  radToDeg,
  VALVE_TYPES,
  terrainElevationAt,
  vec3,
  type FittingPatch,
  type HydroElement,
  type Pipe,
  type PipeSpec,
  type Port,
  type Project,
  type Pump,
  type Vec3,
} from '@hydrobim/core';
import { ArrowLeft, Copy, FolderTree, Layers2, Move, Trash2, Unlink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  familiesOf,
  pumpFamilyOf,
  selectPrimaryId,
  useEditorStore,
  type SizeMode,
} from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { CloseEnds } from './CloseEnds';
import { ELEMENT_ICONS } from './EngineeringIcons';
import { NumberField, ReadOnlyRow, Section, SelectField, TextField } from './fields';
import { PipeRunPanel } from './PipeRunPanel';
import { SYSTEM_KIND_LABELS, VALVE_TYPE_LABELS } from './labels';
import { SpecSelector } from './SpecSelector';
import { TankProperties } from './TankProperties';

const actions = () => useEditorStore.getState();

const formatPoint = (p: Vec3): string =>
  `${formatMeters(p.x)}; ${formatMeters(p.y)}; ${formatMeters(p.z)}`;

function SpecDetails({ spec }: { spec: PipeSpec }) {
  return (
    <>
      <ReadOnlyRow label="Material" value={MATERIAL_LABELS[spec.material]} />
      <ReadOnlyRow label="Norma" value={spec.standard} />
      <ReadOnlyRow label="Classe" value={spec.pressureClass ?? '—'} />
      <ReadOnlyRow label="Junta" value={JOINT_TYPE_LABELS[spec.jointType]} />
      <ReadOnlyRow label="Diâmetro nominal" value={`DN ${spec.dn}`} />
      <ReadOnlyRow
        label="Diâmetro externo"
        value={
          <span data-testid="prop-outer-diameter">{formatMillimeters(spec.outerDiameter)}</span>
        }
      />
      <ReadOnlyRow label="Diâmetro interno" value={formatMillimeters(spec.innerDiameter, 2)} />
      <ReadOnlyRow label="Espessura de parede" value={formatMillimeters(spec.wallThickness, 2)} />
    </>
  );
}

const SIZE_MODES: { value: SizeMode; label: string; hint: string }[] = [
  {
    value: 'reducers',
    label: 'Somente esta peça (insere reduções)',
    hint: 'Altera apenas este elemento. Reduções são inseridas, ajustadas ou removidas junto aos vizinhos; os tubos adjacentes cedem o comprimento necessário.',
  },
  {
    value: 'propagate',
    label: 'Todo o trecho conectado',
    hint: 'Altera todos os elementos conectados, até encontrar uma mudança de diâmetro.',
  },
];

function SpecificationSection({ element, project }: { element: HydroElement; project: Project }) {
  const sizeMode = useEditorStore((s) => s.toolOptions.sizeMode);
  const family = element.familyId
    ? familiesOf(project).find((f) => f.id === element.familyId)
    : undefined;
  const change = (portId?: string) => (id: string, dn: number) =>
    actions().changeSpec(element.id, id, dn, portId);
  const secondary =
    element.kind === 'reducer'
      ? { spec: element.outletSpec, portId: 'b', label: 'Diâmetro — porta B' }
      : element.kind === 'pump'
        ? {
            spec: element.dischargeSpec,
            portId: 'b',
            label:
              element.pumpType === 'amphibious'
                ? 'B — diâmetro da descarga'
                : 'Diâmetro — recalque',
          }
        : element.kind === 'tee'
          ? {
              spec: element.branchSpec ?? element.spec,
              portId: 'branch',
              label: 'Diâmetro — derivação',
            }
          : null;

  return (
    <Section title="Especificação" testId="section-spec">
      <SpecSelector
        spec={element.spec}
        discipline={project.discipline}
        sizeLabel={
          element.kind === 'reducer'
            ? 'Diâmetro — porta A'
            : element.kind === 'pump'
              ? element.pumpType === 'amphibious'
                ? 'A — diâmetro da sucção'
                : 'Diâmetro — sucção'
              : element.kind === 'tee'
                ? 'Diâmetro — passagem'
                : 'Diâmetro'
        }
        testIdPrefix="prop"
        onChange={change(secondary ? 'a' : undefined)}
      />
      {secondary && (
        <SpecSelector
          spec={secondary.spec}
          discipline={project.discipline}
          sizeOnly
          sizeLabel={secondary.label}
          testIdPrefix="prop-b"
          onChange={change(secondary.portId)}
        />
      )}

      {element.kind !== 'reducer' && (
        <fieldset className="radio-group" data-testid="size-mode">
          <legend>Ao alterar o diâmetro</legend>
          {SIZE_MODES.map((mode) => (
            <label key={mode.value} className="check" title={mode.hint}>
              <input
                type="radio"
                name="size-mode"
                data-testid={`size-mode-${mode.value}`}
                checked={sizeMode === mode.value}
                onChange={() => actions().setToolOptions({ sizeMode: mode.value })}
              />
              {mode.label}
            </label>
          ))}
        </fieldset>
      )}
      {element.kind === 'reducer' && (
        <span className="muted">
          Na redução, a alteração de um lado é aplicada ao trecho conectado a ele.
        </span>
      )}

      {element.kind !== 'pipe' && element.kind !== 'pump' && element.kind !== 'tank' && (
        <ReadOnlyRow
          label="Família"
          value={
            <span data-testid="prop-family" data-family-id={element.familyId ?? ''}>
              {family ? (
                `${family.name}${family.manufacturer ? ` — ${family.manufacturer}` : ''}`
              ) : (
                <span className="warn">Dimensões genéricas (fora de catálogo)</span>
              )}
            </span>
          }
        />
      )}
      <SpecDetails spec={element.spec} />
    </Section>
  );
}

function PointFields({
  title,
  point,
  locked,
  onCommit,
  testId,
}: {
  title: string;
  point: Vec3;
  locked: boolean;
  onCommit: (point: Vec3) => void;
  testId: string;
}) {
  const hint = locked
    ? 'Extremidade conectada: desconecte-a para editar as coordenadas.'
    : undefined;
  return (
    <div className="point" data-testid={testId}>
      <span className="point__title">
        {title}
        {locked && <span className="badge">conectada</span>}
      </span>
      <div className="point__fields">
        <NumberField
          label="X"
          unit="m"
          value={point.x}
          disabled={locked}
          title={hint}
          onCommit={(x) => onCommit(vec3(x, point.y, point.z))}
          testId={`${testId}-x`}
        />
        <NumberField
          label="Y"
          unit="m"
          value={point.y}
          disabled={locked}
          title={hint}
          onCommit={(y) => onCommit(vec3(point.x, y, point.z))}
          testId={`${testId}-y`}
        />
        <NumberField
          label="Z"
          unit="m"
          value={point.z}
          disabled={locked}
          title={hint}
          onCommit={(z) => onCommit(vec3(point.x, point.y, z))}
          testId={`${testId}-z`}
        />
      </div>
    </div>
  );
}

/**
 * Cota Z do elemento. Em tubos e conexões a alteração leva junto todos os elementos
 * conectados; em equipamentos, só o próprio elemento (a regra está no domínio).
 */
function ElevationField({
  element,
  project,
  label,
}: {
  element: HydroElement;
  project: Project;
  label: string;
}) {
  const equipment = element.kind === 'pump' || element.kind === 'tank';
  const connected = equipment ? 0 : connectedComponent(project, element.id).length - 1;
  return (
    <>
      <NumberField
        label={label}
        unit="m"
        value={elementElevation(element)}
        onCommit={(value) => actions().changeElevation(element.id, value)}
        testId="prop-elevation"
      />
      {equipment && <GroundElevation element={element} project={project} />}
      <span className="muted" data-testid="prop-elevation-info">
        {equipment
          ? 'Altera só este equipamento; tubos conectados se ajustam quando o acoplamento permite.'
          : connected > 0
            ? `Alterar a elevação move também os ${connected} elemento(s) conectado(s).`
            : 'Sem elementos conectados: só este elemento é movido.'}
      </span>
    </>
  );
}

/** Cota do terreno sob o equipamento e o atalho para assentá-lo sobre a superfície. */
function GroundElevation({ element, project }: { element: HydroElement; project: Project }) {
  if (!project.terrain || element.kind === 'pipe') return null;
  const { x, y, z } = element.placement.position;
  const ground = terrainElevationAt(project.terrain, x, y);
  if (ground === null) {
    return (
      <ReadOnlyRow
        label="Terreno no ponto"
        value={<span data-testid="prop-ground-elevation">fora da superfície</span>}
      />
    );
  }
  const rounded = Math.round(ground * 1000) / 1000;
  return (
    <>
      <ReadOnlyRow
        label="Terreno no ponto"
        value={<span data-testid="prop-ground-elevation">{formatMeters(rounded)}</span>}
      />
      <button
        type="button"
        className="chip"
        data-testid="prop-seat-on-terrain"
        disabled={Math.abs(rounded - z) < 1e-9}
        title="Leva a cota de referência do elemento à do terreno sob a sua origem"
        onClick={() => actions().changeElevation(element.id, rounded)}
      >
        Assentar no terreno
      </button>
    </>
  );
}

/**
 * Extremidades do tubo (tubos com flanges): flange e flange, flange e ponta, ponta e flange
 * ou ponta e ponta, com o flange da classe escolhida. Só aparece quando a especificação do
 * tubo tem família de tubos flangeados no catálogo.
 */
function PipeEnds({ pipe }: { pipe: Pipe }) {
  const families = flangedPipeFamiliesFor(pipe.spec.specificationId);
  if (families.length === 0) return null;
  const configuration = pipeEndConfigurationOf(pipe);
  const family = families.find((f) => f.id === pipe.familyId) ?? families[0];
  const flange = pipe.ends?.start ?? pipe.ends?.end;
  return (
    <>
      <SelectField
        label="Extremidades"
        value={configuration}
        options={PIPE_END_CONFIGURATIONS.map((value) => ({
          value,
          label: PIPE_END_CONFIGURATION_LABELS[value],
        }))}
        onChange={(value) => actions().changePipeEnds(pipe.id, value, family?.id ?? null)}
        testId="prop-pipe-ends"
      />
      {configuration !== 'plainPlain' && family && (
        <>
          <SelectField
            label="Flange"
            value={family.id}
            options={families.map((f) => ({ value: f.id, label: f.pressureClass }))}
            onChange={(id) => actions().changePipeEnds(pipe.id, configuration, id)}
            testId="prop-pipe-flange"
          />
          {flange && (
            <ReadOnlyRow
              label="Flange (catálogo)"
              value={
                <span data-testid="prop-pipe-flange-info">
                  Ø {formatMillimeters(flange.outerDiameter)} · esp.{' '}
                  {formatMillimeters(flange.length, 1)}
                  {flange.boltCount !== undefined && flange.boltHoleDiameter !== undefined
                    ? ` · ${flange.boltCount} furos Ø ${formatMillimeters(flange.boltHoleDiameter)}`
                    : ''}
                </span>
              }
            />
          )}
        </>
      )}
    </>
  );
}

function PipeGeometry({ pipe, project }: { pipe: Pipe; project: Project }) {
  const startLocked =
    connectedPortRef(project, { elementId: pipe.id, portId: 'start' }) !== undefined;
  const endLocked = connectedPortRef(project, { elementId: pipe.id, portId: 'end' }) !== undefined;
  const length = pipeLength(pipe);
  const horizontal = Math.hypot(pipe.end.x - pipe.start.x, pipe.end.y - pipe.start.y);
  const rise = pipe.end.z - pipe.start.z;
  const slope =
    horizontal < 1e-9
      ? 'Vertical'
      : `${((rise / horizontal) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} %`;
  return (
    <Section title="Geometria" testId="section-geometry">
      <NumberField
        label="Comprimento"
        unit="m"
        value={length}
        disabled={startLocked && endLocked}
        title={
          startLocked && endLocked ? 'Definido pelas conexões das duas extremidades.' : undefined
        }
        onCommit={(value) => actions().changePipeLength(pipe.id, value)}
        testId="prop-length"
      />
      <ReadOnlyRow label="Declividade" value={slope} />
      <PipeEnds pipe={pipe} />
      <ElevationField
        element={pipe}
        project={project}
        label={Math.abs(rise) < 1e-9 ? 'Elevação do eixo' : 'Elevação do eixo (início)'}
      />
      {Math.abs(rise) >= 1e-9 && (
        <ReadOnlyRow
          label="Elevação (eixo)"
          value={`${formatMeters(pipe.start.z)} → ${formatMeters(pipe.end.z)}`}
        />
      )}
      <PointFields
        title="Início"
        point={pipe.start}
        locked={startLocked}
        testId="prop-start"
        onCommit={(p) => actions().movePipeEnd(pipe.id, 'start', p)}
      />
      <PointFields
        title="Fim"
        point={pipe.end}
        locked={endLocked}
        testId="prop-end"
        onCommit={(p) => actions().movePipeEnd(pipe.id, 'end', p)}
      />
    </Section>
  );
}

/**
 * Bomba de catálogo: família, linha da tabela, flanges A e B e as cotas do dimensional, com
 * as letras do fabricante — é o que se transcreve do catálogo para o modelo usado.
 */
function CatalogPumpFields({ pump }: { pump: Pump }) {
  const project = useEditorStore((s) => s.project);
  const family = pumpFamilyOf(project, pump.familyId);
  const variant = family?.variants.find((v) => v.id === pump.variantId);
  const classes = FLANGE_PRESSURE_CLASSES.map((c) => ({ value: c as string, label: c }));
  const mismatch = pumpLengthMismatch({
    length: pump.length,
    footOffset: pump.footOffset ?? 0,
    footSpan: pump.footSpan ?? 0,
    rearLength: pump.rearLength ?? 0,
    footWidth: pump.footWidth ?? 0,
    footHoleDiameter: pump.footHoleDiameter ?? 0,
    axisHeight: pump.axisHeight ?? 0,
    totalHeight: pump.totalHeight ?? 0,
  });
  return (
    <>
      <ReadOnlyRow
        label="Família"
        value={
          <span data-testid="prop-pump-family" data-family-id={pump.familyId ?? ''}>
            {family?.name ?? pump.manufacturing.model ?? '—'}
          </span>
        }
      />
      <ReadOnlyRow
        label="Modelo"
        value={
          <span data-testid="prop-pump-variant" data-variant-id={pump.variantId ?? ''}>
            {variant ? (
              `${pumpModelRange(variant)} · carcaça ${variant.frame}`
            ) : (
              <span className="warn">Cotas preenchidas pelo usuário</span>
            )}
          </span>
        }
      />
      {(['a', 'b'] as const).map((portId) => (
        <SelectField
          key={portId}
          label={
            portId === 'a' ? 'A — classe do flange de sucção' : 'B — classe do flange de descarga'
          }
          testId={`prop-pump-class-${portId}`}
          value={(portId === 'a' ? pump.suctionFlangeClass : pump.dischargeFlangeClass) ?? ''}
          options={classes}
          onChange={(pressureClass) => actions().changePumpFlange(pump.id, portId, pressureClass)}
        />
      ))}
      {PUMP_DIMENSION_KEYS.map((key) => (
        <Dimension
          key={key}
          element={pump}
          field={key}
          label={`${PUMP_DIMENSION_LABELS[key].letter} — ${PUMP_DIMENSION_LABELS[key].description}`}
          testId={`prop-pump-${key}`}
        />
      ))}
      <ReadOnlyRow label="Estágios" value={String(pump.stages ?? 1)} />
      {Math.abs(mismatch) > 0.0005 && (
        <span className="warn" data-testid="prop-pump-mismatch">
          F − (C + D + E) = {formatMillimeters(mismatch, 1)}: as portas usam F e os pés, C e D.
        </span>
      )}
      <span className="muted" data-testid="prop-pump-note">
        {variant
          ? `Cotas da linha da tabela ${family?.origin === 'custom' ? 'da família personalizada (definidas pelo usuário)' : 'do fabricante'}. Alterar uma cota, um flange ou um diâmetro desfaz o vínculo com a linha.`
          : 'Preencha com os valores do dimensional do fabricante (mesmas letras da tabela).'}{' '}
        Carcaça, tirantes, pés e olhais são representação.
      </span>
    </>
  );
}

/** Campo de dimensão em milímetros ligado a um parâmetro da conexão. */
function Dimension({
  element,
  field,
  label,
  testId,
  unit = 'mm',
}: {
  element: HydroElement;
  field: keyof FittingPatch;
  label: string;
  testId: string;
  unit?: 'mm' | 'm';
}) {
  const raw = (element as unknown as Record<string, number | undefined>)[field];
  if (raw === undefined) return null;
  const toDisplay = unit === 'mm' ? mToMm : (v: number) => v;
  const fromDisplay = unit === 'mm' ? mmToM : (v: number) => v;
  return (
    <NumberField
      label={label}
      unit={unit}
      digits={unit === 'mm' ? 1 : 3}
      value={toDisplay(raw)}
      onCommit={(v) => actions().changeFitting(element.id, { [field]: fromDisplay(v) })}
      testId={testId}
    />
  );
}

function FittingGeometry({
  element,
  project,
}: {
  element: Exclude<HydroElement, Pipe>;
  project: Project;
}) {
  const ports = getPorts(element);
  const [axisPort, setAxisPort] = useState(ports[0]?.ref.portId ?? 'a');
  const [step, setStep] = useState(90);
  const axis = ports.some((p) => p.ref.portId === axisPort)
    ? axisPort
    : (ports[0]?.ref.portId ?? 'a');
  const change = actions().changeFitting;

  return (
    <Section title="Geometria" testId="section-geometry">
      {element.kind === 'elbow' && (
        <>
          <NumberField
            label="Ângulo de deflexão"
            unit="°"
            digits={2}
            value={radToDeg(element.angle)}
            onCommit={(v) => change(element.id, { angle: degToRad(v) })}
            testId="prop-angle"
          />
          <Dimension
            element={element}
            field="bendRadius"
            label="Raio de curvatura"
            testId="prop-bend-radius"
          />
          {element.straight && (
            <ReadOnlyRow
              label="Trechos retos (bolsa / ponta)"
              value={`${formatMillimeters(element.straight.a, 1)} / ${formatMillimeters(element.straight.b, 1)}`}
            />
          )}
        </>
      )}
      {element.kind === 'tee' && (
        <>
          <Dimension
            element={element}
            field="runLength"
            label="Comprimento da passagem"
            testId="prop-run-length"
          />
          <Dimension
            element={element}
            field="branchLength"
            label="Centro à derivação"
            testId="prop-branch-length"
          />
        </>
      )}
      {element.kind === 'valve' && (
        <>
          <SelectField
            label="Tipo"
            testId="prop-valve-type"
            value={element.valveType}
            options={VALVE_TYPES.map((t) => ({ value: t, label: VALVE_TYPE_LABELS[t] }))}
            onChange={(valveType) => change(element.id, { valveType })}
          />
          <Dimension
            element={element}
            field="length"
            label={
              element.valveType === 'airRelease'
                ? 'Altura acima da porta'
                : 'Comprimento face a face'
            }
            testId="prop-valve-length"
          />
          <Dimension
            element={element}
            field="height"
            label={
              element.valveType === 'strainer' ? 'Eixo ao fundo do bojo' : 'Altura do eixo ao topo'
            }
            testId="prop-valve-height"
          />
          <Dimension
            element={element}
            field="handwheelDiameter"
            label="Volante / alavanca"
            testId="prop-valve-wheel"
          />
          <Dimension
            element={element}
            field="width"
            label="Largura / tampa do atuador"
            testId="prop-valve-width"
          />
          {element.bonnetLength !== undefined && (
            <Dimension
              element={element}
              field="bonnetLength"
              label="Castelo ao longo do eixo"
              testId="prop-valve-bonnet-length"
            />
          )}
        </>
      )}
      {element.kind === 'reducer' && (
        <Dimension
          element={element}
          field="length"
          label="Comprimento"
          testId="prop-reducer-length"
        />
      )}
      {element.kind === 'pump' && element.pumpType === 'amphibious' && (
        <CatalogPumpFields pump={element} />
      )}
      {element.kind === 'pump' && (
        <>
          {element.pumpType !== 'amphibious' && (
            <Dimension
              element={element}
              field="length"
              label="Comprimento do conjunto"
              testId="prop-pump-length"
            />
          )}
          <Dimension
            element={element}
            field="dischargeOffset"
            label="Sucção ao eixo do recalque"
            testId="prop-pump-offset"
          />
          <Dimension
            element={element}
            field="dischargeHeight"
            label="Altura do recalque"
            testId="prop-pump-height"
          />
          <NumberField
            label="Vazão nominal"
            unit="L/s"
            digits={2}
            value={(element.ratedFlow ?? 0) * 1000}
            onCommit={(v) => change(element.id, { ratedFlow: v / 1000 })}
            testId="prop-pump-flow"
          />
          <NumberField
            label="Altura manométrica"
            unit="m"
            digits={2}
            value={element.ratedHead ?? 0}
            onCommit={(v) => change(element.id, { ratedHead: v })}
            testId="prop-pump-head"
          />
          {element.pumpType !== 'amphibious' && (
            <span className="muted">
              Representação genérica de conjunto motobomba; não corresponde a um modelo comercial.
            </span>
          )}
        </>
      )}
      {element.kind === 'tank' && <TankProperties tank={element} />}
      <ReadOnlyRow label="Origem" value={formatPoint(element.placement.position)} />
      <ElevationField
        element={element}
        project={project}
        label={element.kind === 'tank' ? 'Elevação da base' : 'Elevação'}
      />

      <div className="rotate">
        <span className="point__title">Girar em torno do eixo da porta</span>
        <div className="rotate__controls">
          <SelectField
            label="Porta"
            value={axis}
            options={ports.map((p) => ({ value: p.ref.portId, label: p.label }))}
            onChange={setAxisPort}
            testId="prop-roll-port"
          />
          <NumberField
            label="Passo"
            unit="°"
            digits={1}
            value={step}
            onCommit={(v) => setStep(Math.abs(v))}
            testId="prop-roll-step"
          />
        </div>
        <div className="chips">
          <button
            type="button"
            className="chip"
            data-testid="prop-roll-minus"
            onClick={() => actions().roll(element.id, axis, -step)}
          >
            − {String(step).replace('.', ',')}°
          </button>
          <button
            type="button"
            className="chip"
            data-testid="prop-roll-plus"
            onClick={() => actions().roll(element.id, axis, step)}
          >
            + {String(step).replace('.', ',')}°
          </button>
        </div>
      </div>
    </Section>
  );
}

const END_LABELS = { socket: 'bolsa', flange: 'flange', plain: 'ponta lisa' } as const;

function PortRow({ port, project }: { port: Port; project: Project }) {
  const other = connectedPortRef(project, port.ref);
  const otherElement = other ? getElement(project, other.elementId) : undefined;
  return (
    <li className="port" data-testid={`port-${port.ref.portId}`}>
      <div className="port__head">
        <strong>{port.label}</strong>
        <span className={other ? 'status status--connected' : 'status status--free'}>
          {other ? 'Conectada' : 'Livre'}
        </span>
      </div>
      <span className="muted">
        {port.spec.sizeLabel}
        {port.end
          ? ` · ${END_LABELS[port.end.type]} Ø ${formatMillimeters(port.end.outerDiameter)}`
          : ''}{' '}
        · {formatPoint(port.position)}
      </span>
      {other ? (
        <div className="port__actions">
          <button type="button" className="link" onClick={() => actions().select(other.elementId)}>
            {otherElement?.name ?? 'elemento removido'}
          </button>
          <button
            type="button"
            className="chip"
            data-testid={`port-${port.ref.portId}-disconnect`}
            onClick={() => actions().disconnectPort(port.ref)}
          >
            <Unlink size={13} /> Desconectar
          </button>
        </div>
      ) : (
        <div className="port__actions">
          {(['elbow', 'tee', 'valve', 'reducer'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className="chip"
              data-testid={`port-${port.ref.portId}-add-${kind}`}
              title={`Acoplar ${elementKindLabel(kind).toLowerCase()} nesta extremidade (usa as opções atuais da ferramenta)`}
              onClick={() => actions().insertFittingAtPort(kind, port.ref)}
            >
              + {elementKindLabel(kind)}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

function InlineInsert({ pipe }: { pipe: Pipe }) {
  const length = pipeLength(pipe);
  const [distance, setDistance] = useState<number | null>(null);
  const value = distance === null || distance > length ? length / 2 : distance;
  return (
    <Section title="Inserir em linha" testId="section-inline">
      <NumberField
        label="Distância do início"
        unit="m"
        value={value}
        onCommit={setDistance}
        testId="inline-distance"
      />
      <div className="chips">
        <button
          type="button"
          className="chip"
          data-testid="inline-add-tee"
          onClick={() => actions().insertFittingInline('tee', pipe.id, value)}
        >
          + Tê
        </button>
        <button
          type="button"
          className="chip"
          data-testid="inline-add-valve"
          onClick={() => actions().insertFittingInline('valve', pipe.id, value)}
        >
          + Válvula
        </button>
      </div>
      <span className="muted">O tubo é dividido em dois trechos; este mantém o identificador.</span>
    </Section>
  );
}

function BimProperties({ element }: { element: HydroElement }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const entries = Object.entries(element.properties);
  const add = (): void => {
    if (key.trim().length === 0) return;
    const numeric = Number(value.replace(',', '.'));
    actions().setProperty(
      element.id,
      key,
      value.trim() !== '' && Number.isFinite(numeric) ? numeric : value,
    );
    setKey('');
    setValue('');
  };
  return (
    <Section title="Propriedades BIM" testId="section-bim">
      {entries.length === 0 && <span className="muted">Nenhuma propriedade definida.</span>}
      {entries.map(([name, current]) => (
        <div className="row" key={name}>
          <span className="row__label">{name}</span>
          <span className="row__value">
            {String(current)}{' '}
            <button
              type="button"
              className="link"
              aria-label={`Remover ${name}`}
              onClick={() => actions().setProperty(element.id, name, undefined)}
            >
              remover
            </button>
          </span>
        </div>
      ))}
      <div className="bim-add">
        <input
          aria-label="Nome da propriedade"
          placeholder="Nome"
          value={key}
          data-testid="bim-key"
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <input
          aria-label="Valor da propriedade"
          placeholder="Valor"
          value={value}
          data-testid="bim-value"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
            e.stopPropagation();
          }}
        />
        <button type="button" className="chip" data-testid="bim-add" onClick={add}>
          Adicionar
        </button>
      </div>
    </Section>
  );
}

/** Mover e copiar a seleção por deslocamento numérico. */
function MoveCopy() {
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [dz, setDz] = useState(0);
  const delta = vec3(dx, dy, dz);
  const empty = dx === 0 && dy === 0 && dz === 0;
  return (
    <Section title="Mover / copiar" testId="section-move">
      <div className="point__fields">
        <NumberField label="ΔX" unit="m" value={dx} onCommit={setDx} testId="move-dx" />
        <NumberField label="ΔY" unit="m" value={dy} onCommit={setDy} testId="move-dy" />
        <NumberField label="ΔZ" unit="m" value={dz} onCommit={setDz} testId="move-dz" />
      </div>
      <div className="chips">
        <button
          type="button"
          className="btn btn--compact btn--confirm"
          data-testid="move-apply"
          disabled={empty}
          onClick={() => actions().moveSelection(delta)}
        >
          <Move size={13} /> Mover
        </button>
        <button
          type="button"
          className="btn btn--compact"
          data-testid="copy-apply"
          disabled={empty}
          onClick={() => actions().copySelection(delta)}
        >
          <Copy size={13} /> Copiar
        </button>
      </div>
      <span className="muted">
        Ao mover, tubos conectados se ajustam quando o deslocamento segue o eixo; caso contrário a
        operação é recusada.
      </span>
    </Section>
  );
}

function SystemField({ project, systemId }: { project: Project; systemId: string }) {
  return (
    <SelectField
      label="Sistema"
      testId="prop-system"
      value={systemId}
      options={project.systems.map((s) => ({
        value: s.id,
        label: `${s.name} (${SYSTEM_KIND_LABELS[s.kind]})`,
      }))}
      onChange={(id) => actions().assignSystem(id)}
    />
  );
}

function ElementProperties({ element, project }: { element: HydroElement; project: Project }) {
  return (
    <div
      className="panel__scroll"
      data-testid="element-properties"
      data-element-id={element.id}
      data-element-kind={element.kind}
    >
      <Section title="Identificação" testId="section-identity">
        <TextField
          label="Nome"
          value={element.name}
          onCommit={(name) => actions().rename(element.id, name)}
          testId="prop-name"
        />
        <ReadOnlyRow
          label="Identificador"
          value={<code data-testid="prop-id">{element.id}</code>}
        />
        <SystemField project={project} systemId={element.systemId} />
      </Section>

      <SpecificationSection element={element} project={project} />
      {element.kind === 'pipe' ? (
        <PipeGeometry pipe={element} project={project} />
      ) : (
        <FittingGeometry key={element.id} element={element} project={project} />
      )}

      <Section title="Portas de conexão" testId="section-ports">
        <ul className="ports">
          {getPorts(element).map((port) => (
            <PortRow key={port.ref.portId} port={port} project={project} />
          ))}
        </ul>
      </Section>

      {element.kind === 'pipe' && <InlineInsert key={element.id} pipe={element} />}
      <MoveCopy />
      <BimProperties key={`bim-${element.id}`} element={element} />

      <Section title="Histórico" testId="section-history">
        <ReadOnlyRow
          label="Criado em"
          value={new Date(element.meta.createdAt).toLocaleString('pt-BR')}
        />
        <ReadOnlyRow
          label="Alterado em"
          value={new Date(element.meta.updatedAt).toLocaleString('pt-BR')}
        />
        <ReadOnlyRow
          label="Revisão"
          value={<span data-testid="prop-revision">{element.meta.revision}</span>}
        />
      </Section>

      <button
        type="button"
        className="btn btn--danger"
        data-testid="action-delete"
        onClick={() => actions().deleteSelected()}
      >
        <Trash2 size={15} /> Excluir elemento
      </button>
    </div>
  );
}

/** Ações que valem para todos os trechos de uma tubulação contínua. */
function SelectionActions({ elements, project }: { elements: HydroElement[]; project: Project }) {
  const first = elements[0];
  if (!first) return null;
  return (
    <>
      <Section title="Sistema" testId="section-pipe-run-system">
        <SystemField project={project} systemId={first.systemId} />
      </Section>
      <MoveCopy />
      <button
        type="button"
        className="btn btn--danger"
        data-testid="action-delete"
        onClick={() => actions().deleteSelected()}
      >
        <Trash2 size={15} /> Excluir a tubulação
      </button>
    </>
  );
}
function MultiSelection({ elements, project }: { elements: HydroElement[]; project: Project }) {
  const counts = new Map<string, number>();
  for (const e of elements) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const systems = new Set(elements.map((e) => e.systemId));
  const first = elements[0];
  return (
    <div className="panel__scroll" data-testid="multi-properties" data-count={elements.length}>
      <Section title={`${elements.length} elementos selecionados`} testId="section-multi">
        {[...counts.entries()].map(([kind, count]) => (
          <ReadOnlyRow
            key={kind}
            label={elementKindLabel(kind as HydroElement['kind'])}
            value={count}
          />
        ))}
        {first && (
          <>
            <SystemField
              project={project}
              systemId={systems.size === 1 ? first.systemId : first.systemId}
            />
            {systems.size > 1 && (
              <span className="muted">A seleção contém elementos de sistemas diferentes.</span>
            )}
          </>
        )}
      </Section>
      {elements.length === 2 && <CloseEnds elements={elements} project={project} />}
      <MoveCopy />
      <button
        type="button"
        className="btn btn--danger"
        data-testid="action-delete"
        onClick={() => actions().deleteSelected()}
      >
        <Trash2 size={15} /> Excluir selecionados
      </button>
    </div>
  );
}

/** Resumo do projeto e quantitativo básico, exibidos quando não há seleção. */
function ProjectSummary({ project }: { project: Project }) {
  const lengths = new Map<string, { label: string; length: number; count: number }>();
  let generic = 0;
  for (const element of project.elements) {
    if (element.kind !== 'pipe') {
      const cataloged =
        element.kind === 'pump' || element.kind === 'tank' || element.familyId !== null;
      if (!cataloged) generic += 1;
      continue;
    }
    const key = `${element.spec.specificationId}#${element.spec.dn}`;
    const entry = lengths.get(key) ?? {
      label: `${MATERIAL_LABELS[element.spec.material]} ${element.spec.sizeLabel}`,
      length: 0,
      count: 0,
    };
    entry.length += pipeLength(element);
    entry.count += 1;
    lengths.set(key, entry);
  }
  return (
    <div className="panel__scroll">
      <p className="panel__empty" data-testid="properties-empty">
        <strong>Nada selecionado.</strong> Clique em um elemento na vista ou no navegador do projeto
        para ver e editar as suas propriedades. Ctrl+clique soma à seleção.
      </p>
      <Section title="Projeto" testId="section-project">
        <ReadOnlyRow label="Nome" value={project.name} />
        <ReadOnlyRow label="Ambiente" value={project.discipline === 'mep' ? 'MEP' : 'Infra'} />
        <ReadOnlyRow label="Sistemas" value={project.systems.map((s) => s.name).join(', ')} />
        <ReadOnlyRow
          label="Elementos"
          value={<span data-testid="element-count">{project.elements.length}</span>}
        />
        <ReadOnlyRow
          label="Conexões"
          value={<span data-testid="connection-count">{project.connections.length}</span>}
        />
        <ReadOnlyRow
          label="Peças fora de catálogo"
          value={
            <span data-testid="generic-count" className={generic > 0 ? 'warn' : undefined}>
              {generic}
            </span>
          }
        />
      </Section>
      <Section title="Tubos por diâmetro" testId="section-quantities">
        {lengths.size === 0 && (
          <span className="muted">
            Nenhum tubo modelado. Use Modelagem › Tubulação para iniciar.
          </span>
        )}
        {[...lengths.values()].map((entry) => (
          <ReadOnlyRow
            key={entry.label}
            label={entry.label}
            value={`${formatMeters(entry.length, 2)} · ${entry.count} trecho(s)`}
          />
        ))}
      </Section>
    </div>
  );
}

/**
 * Propriedades dos elementos já selecionados (os parâmetros do próximo elemento ficam na aba
 * Ferramenta do mesmo painel). Sem seleção, mostra o resumo do projeto.
 */
export function PropertiesPanel() {
  const project = useEditorStore((s) => s.project);
  const selection = useEditorStore((s) => s.selection);
  const primaryId = useEditorStore(selectPrimaryId);
  const reveal = useUiStore((s) => s.reveal);
  const rootRef = useRef<HTMLElement>(null);
  const elements = selection
    .map((id) => getElement(project, id))
    .filter((e): e is HydroElement => e !== undefined);
  const element = elements.length === 1 && primaryId ? elements[0] : undefined;
  // Tubos ligados direto uns aos outros, sem peça entre eles: apresentados como um tubo só.
  const run = isPipeRun(project, selection) ? pipeRunSummary(project, selection) : null;
  const SelectionIcon = element
    ? ELEMENT_ICONS[element.kind]
    : run
      ? ELEMENT_ICONS.pipe
      : elements.length > 1
        ? Layers2
        : FolderTree;

  // Comandos da faixa (Mover, Comprimento, Elevação…) levam ao campo que os executa.
  useEffect(() => {
    if (!reveal) return;
    const target = rootRef.current?.querySelector<HTMLElement>(`[data-testid="${reveal.target}"]`);
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    if (target instanceof HTMLInputElement) {
      target.focus();
      target.select();
    } else if (target instanceof HTMLSelectElement) target.focus();
  }, [reveal]);

  return (
    <aside
      className="panel inspector"
      aria-label="Propriedades"
      ref={rootRef}
      data-testid="properties-panel"
    >
      <header className="panel__header inspector__header">
        <span className="inspector__identity-icon" aria-hidden>
          <SelectionIcon size={23} strokeWidth={1.5} />
        </span>
        <div className="inspector__identity">
          <span className="inspector__type" data-testid="properties-type">
            {element
              ? elementKindLabel(element.kind)
              : run
                ? 'Tubulação contínua'
                : elements.length > 1
                  ? 'Seleção múltipla'
                  : 'Propriedades do projeto'}
          </span>
          <h2 data-testid="properties-title" title={element?.name ?? project.name}>
            {element
              ? element.name
              : run
                ? `Tubo · ${run.pipes.length} trechos`
                : elements.length > 1
                  ? `${elements.length} elementos selecionados`
                  : 'Projeto'}
          </h2>
        </div>
        {elements.length > 0 && (
          <button
            type="button"
            className="inspector__back"
            data-testid="back-to-project"
            aria-label="Ver projeto"
            title="Limpar a seleção e ver o resumo do projeto"
            onClick={() => actions().selectMany([])}
          >
            <ArrowLeft size={15} aria-hidden />
          </button>
        )}
      </header>
      <span
        className={`panel__scope panel__scope--${element ? 'single' : elements.length > 1 ? 'multi' : 'none'}`}
        data-testid="properties-scope"
      >
        {element
          ? `Seleção única · ${elementKindLabel(element.kind)}`
          : run
            ? 'Tubulação contínua · sem peça entre os trechos'
            : elements.length > 1
              ? 'Seleção múltipla · alterações valem para todos'
              : 'Sem seleção'}
      </span>
      {element ? (
        <ElementProperties element={element} project={project} />
      ) : run ? (
        <PipeRunPanel run={run}>
          <SelectionActions elements={elements} project={project} />
        </PipeRunPanel>
      ) : elements.length > 1 ? (
        <MultiSelection elements={elements} project={project} />
      ) : (
        <ProjectSummary project={project} />
      )}
    </aside>
  );
}
