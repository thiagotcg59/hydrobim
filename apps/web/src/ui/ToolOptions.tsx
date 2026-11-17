import { getSpecification } from '@hydrobim/catalog';
import {
  formatMeters,
  radToDeg,
  VALVE_TYPES,
  vec3,
  type FamilyKind,
  type FittingFamily,
} from '@hydrobim/core';
import { useState } from 'react';
import { familiesOf, useEditorStore } from '../state/editorStore';
import { NumberField, SelectField } from './fields';
import { TOOL_HINTS, TOOL_LABELS, VALVE_TYPE_LABELS } from './labels';
import { SpecSelector } from './SpecSelector';

const GRID_STEPS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 5, 10];
const POINT_TOOLS = new Set(['pipe', 'measure', 'pump', 'tank']);

/** Entrada de pontos por coordenadas exatas. */
function CoordinateEntry() {
  const workPlaneZ = useEditorStore((s) => s.workPlaneZ);
  const anchor = useEditorStore((s) => s.anchor);
  const tool = useEditorStore((s) => s.tool);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [z, setZ] = useState<number | null>(null);
  const effectiveZ = z ?? workPlaneZ;
  const caption =
    tool === 'pipe'
      ? anchor
        ? 'Ponto final'
        : 'Ponto inicial'
      : tool === 'measure'
        ? 'Ponto'
        : 'Posição';

  return (
    <div className="options__group" data-testid="coordinate-entry">
      <span className="options__caption">{caption} por coordenadas</span>
      <NumberField label="X" unit="m" value={x} onCommit={setX} testId="coord-x" />
      <NumberField label="Y" unit="m" value={y} onCommit={setY} testId="coord-y" />
      <NumberField label="Z" unit="m" value={effectiveZ} onCommit={setZ} testId="coord-z" />
      <button
        type="button"
        className="btn btn--primary"
        data-testid="coord-add"
        onClick={() => useEditorStore.getState().commitPoint(vec3(x, y, effectiveZ))}
      >
        {tool === 'pump' || tool === 'tank' ? 'Posicionar' : 'Adicionar ponto'}
      </button>
      {tool === 'pipe' && anchor && (
        <span className="muted" data-testid="anchor-info">
          Início: {formatMeters(anchor.point.x, 2)}; {formatMeters(anchor.point.y, 2)};{' '}
          {formatMeters(anchor.point.z, 2)}
          {anchor.port ? ' (extremidade livre)' : ''}
        </span>
      )}
    </div>
  );
}

/** Escolha da família de catálogo usada pela ferramenta. */
function FamilySelect({
  kind,
  accept = () => true,
  onPick,
}: {
  kind: FamilyKind;
  accept?: (family: FittingFamily) => boolean;
  onPick?: (family: FittingFamily | undefined) => void;
}) {
  const project = useEditorStore((s) => s.project);
  const specificationId = useEditorStore((s) => s.activeSpec.specificationId);
  const preferred = useEditorStore((s) => s.toolOptions.families[kind] ?? null);
  const families = familiesOf(project).filter(
    (f) => f.kind === kind && f.specificationId === specificationId && accept(f),
  );
  return (
    <>
      <SelectField
        label="Família"
        testId={`option-family-${kind}`}
        value={preferred && families.some((f) => f.id === preferred) ? preferred : 'auto'}
        options={[
          {
            value: 'auto',
            label: families.length ? 'Automática (primeira compatível)' : 'Genérica (sem catálogo)',
          },
          ...families.map((f) => ({
            value: f.id,
            label: `${f.name}${f.origin === 'custom' ? ' (personalizada)' : ''}`,
          })),
        ]}
        onChange={(value) => {
          const family = families.find((f) => f.id === value);
          useEditorStore.getState().setPreferredFamily(kind, family ? family.id : null);
          onPick?.(family);
        }}
      />
      {families.length === 0 && (
        <span className="muted">
          Não há família de catálogo para esta especificação: serão usadas dimensões genéricas.
        </span>
      )}
    </>
  );
}

export function ToolOptions() {
  const tool = useEditorStore((s) => s.tool);
  const discipline = useEditorStore((s) => s.project.discipline);
  const levels = useEditorStore((s) => s.project.levels);
  const activeSpec = useEditorStore((s) => s.activeSpec);
  const options = useEditorStore((s) => s.toolOptions);
  const workPlaneZ = useEditorStore((s) => s.workPlaneZ);
  const gridStep = useEditorStore((s) => s.gridStep);
  const snapToGrid = useEditorStore((s) => s.snapToGrid);
  const { setActiveSpec, setToolOptions, setWorkPlaneZ, setGridStep, setSnapToGrid } =
    useEditorStore.getState();

  const sizes = getSpecification(activeSpec.specificationId)?.sizes ?? [];
  const steps = GRID_STEPS.includes(gridStep) ? GRID_STEPS : [...GRID_STEPS, gridStep].sort();
  const isFittingTool =
    tool === 'elbow' || tool === 'tee' || tool === 'reducer' || tool === 'valve';
  const level = levels.find((l) => Math.abs(l.elevation - workPlaneZ) < 1e-9);

  return (
    <aside className="options" aria-label="Opções da ferramenta" data-testid="tool-options">
      <header className="options__header">
        <strong>{TOOL_LABELS[tool]}</strong>
        <span className="muted">{TOOL_HINTS[tool]}</span>
      </header>

      {(tool === 'pipe' || tool === 'pump' || tool === 'tank' || isFittingTool) && (
        <div className="options__group">
          <span className="options__caption">
            {isFittingTool ? 'Especificação (filtra as famílias)' : 'Especificação'}
          </span>
          <SpecSelector
            spec={activeSpec}
            discipline={discipline}
            onChange={setActiveSpec}
            testIdPrefix="active"
          />
          {isFittingTool && (
            <span className="muted">
              A peça inserida sempre assume a especificação da extremidade em que for acoplada.
            </span>
          )}
        </div>
      )}

      {tool === 'elbow' && (
        <div className="options__group">
          <NumberField
            label="Ângulo de deflexão"
            unit="°"
            digits={2}
            value={options.elbowAngleDeg}
            onCommit={(value) =>
              setToolOptions({ elbowAngleDeg: Math.min(135, Math.max(1, value)) })
            }
            testId="option-elbow-angle"
          />
          <div className="chips">
            {[90, 45, 22.5, 11.25].map((angle) => (
              <button
                key={angle}
                type="button"
                className={options.elbowAngleDeg === angle ? 'chip is-active' : 'chip'}
                onClick={() => setToolOptions({ elbowAngleDeg: angle })}
              >
                {String(angle).replace('.', ',')}°
              </button>
            ))}
          </div>
          <FamilySelect
            kind="elbow"
            onPick={(family) => {
              if (family?.angle) {
                setToolOptions({ elbowAngleDeg: Math.round(radToDeg(family.angle) * 100) / 100 });
              }
            }}
          />
          <span className="muted">Ângulos fora dos padronizados usam dimensões genéricas.</span>
        </div>
      )}

      {tool === 'tee' && (
        <div className="options__group">
          <SelectField
            label="Diâmetro da derivação"
            testId="option-tee-branch"
            value={options.teeBranchDn === null ? 'same' : String(options.teeBranchDn)}
            options={[
              { value: 'same', label: 'Igual à passagem' },
              ...sizes.map((s) => ({ value: String(s.dn), label: s.label })),
            ]}
            onChange={(value) =>
              setToolOptions({ teeBranchDn: value === 'same' ? null : Number(value) })
            }
          />
          <FamilySelect kind="tee" />
        </div>
      )}

      {tool === 'valve' && (
        <div className="options__group">
          <SelectField
            label="Tipo de válvula"
            testId="option-valve-type"
            value={options.valveType}
            options={VALVE_TYPES.map((type) => ({ value: type, label: VALVE_TYPE_LABELS[type] }))}
            onChange={(valveType) => setToolOptions({ valveType })}
          />
          <FamilySelect kind="valve" accept={(f) => f.valveType === options.valveType} />
          {options.valveType === 'airRelease' && (
            <span className="muted">
              A ventosa tem uma única porta: acople-a à derivação de um tê.
            </span>
          )}
        </div>
      )}

      {tool === 'reducer' && (
        <div className="options__group">
          <SelectField
            label="Diâmetro de saída"
            testId="option-reducer-dn"
            value={options.reducerDn === null ? 'auto' : String(options.reducerDn)}
            options={[
              { value: 'auto', label: 'Automático (imediatamente menor)' },
              ...sizes.map((s) => ({ value: String(s.dn), label: s.label })),
            ]}
            onChange={(value) =>
              setToolOptions({ reducerDn: value === 'auto' ? null : Number(value) })
            }
          />
          <FamilySelect kind="reducer" />
        </div>
      )}

      {POINT_TOOLS.has(tool) && <CoordinateEntry />}

      {tool !== 'select' && (
        <div className="options__group">
          <span className="options__caption">Plano de trabalho</span>
          <SelectField
            label="Nível"
            testId="option-level"
            value={level?.id ?? 'custom'}
            options={[
              ...levels.map((l) => ({
                value: l.id,
                label: `${l.name} (${formatMeters(l.elevation, 2)})`,
              })),
              ...(level ? [] : [{ value: 'custom', label: 'Cota livre' }]),
            ]}
            onChange={(id) => {
              const picked = levels.find((l) => l.id === id);
              if (picked) setWorkPlaneZ(picked.elevation);
            }}
          />
          <NumberField
            label="Cota Z"
            unit="m"
            value={workPlaneZ}
            onCommit={setWorkPlaneZ}
            testId="option-work-z"
          />
          <SelectField
            label="Passo da grade"
            value={String(gridStep)}
            options={steps.map((step) => ({ value: String(step), label: formatMeters(step, 2) }))}
            onChange={(value) => setGridStep(Number(value))}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={snapToGrid}
              onChange={(event) => setSnapToGrid(event.target.checked)}
            />
            Ajustar à grade
          </label>
        </div>
      )}
    </aside>
  );
}
