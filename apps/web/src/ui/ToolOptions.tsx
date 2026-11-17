import { getSpecification } from '@hydrobim/catalog';
import { formatMeters, VALVE_TYPES, vec3 } from '@hydrobim/core';
import { useState } from 'react';
import { useEditorStore } from '../state/editorStore';
import { NumberField, SelectField } from './fields';
import { TOOL_HINTS, TOOL_LABELS, VALVE_TYPE_LABELS } from './labels';
import { SpecSelector } from './SpecSelector';

const GRID_STEPS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 5, 10];

/** Entrada de pontos por coordenadas exatas (ferramentas de tubo e medição). */
function CoordinateEntry() {
  const workPlaneZ = useEditorStore((s) => s.workPlaneZ);
  const anchor = useEditorStore((s) => s.anchor);
  const tool = useEditorStore((s) => s.tool);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [z, setZ] = useState<number | null>(null);
  const effectiveZ = z ?? workPlaneZ;

  return (
    <div className="options__group" data-testid="coordinate-entry">
      <span className="options__caption">
        {tool === 'pipe' ? (anchor ? 'Ponto final' : 'Ponto inicial') : 'Ponto'} por coordenadas
      </span>
      <NumberField label="X" unit="m" value={x} onCommit={setX} testId="coord-x" />
      <NumberField label="Y" unit="m" value={y} onCommit={setY} testId="coord-y" />
      <NumberField label="Z" unit="m" value={effectiveZ} onCommit={setZ} testId="coord-z" />
      <button
        type="button"
        className="btn btn--primary"
        data-testid="coord-add"
        onClick={() => useEditorStore.getState().commitPoint(vec3(x, y, effectiveZ))}
      >
        Adicionar ponto
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

export function ToolOptions() {
  const tool = useEditorStore((s) => s.tool);
  const discipline = useEditorStore((s) => s.project.discipline);
  const activeSpec = useEditorStore((s) => s.activeSpec);
  const options = useEditorStore((s) => s.toolOptions);
  const workPlaneZ = useEditorStore((s) => s.workPlaneZ);
  const gridStep = useEditorStore((s) => s.gridStep);
  const snapToGrid = useEditorStore((s) => s.snapToGrid);
  const { setActiveSpec, setToolOptions, setWorkPlaneZ, setGridStep, setSnapToGrid } =
    useEditorStore.getState();

  const reducerSizes = getSpecification(activeSpec.specificationId)?.sizes ?? [];
  const steps = GRID_STEPS.includes(gridStep) ? GRID_STEPS : [...GRID_STEPS, gridStep].sort();

  return (
    <aside className="options" aria-label="Opções da ferramenta" data-testid="tool-options">
      <header className="options__header">
        <strong>{TOOL_LABELS[tool]}</strong>
        <span className="muted">{TOOL_HINTS[tool]}</span>
      </header>

      {tool === 'pipe' && (
        <div className="options__group">
          <span className="options__caption">Novo tubo</span>
          <SpecSelector
            spec={activeSpec}
            discipline={discipline}
            onChange={setActiveSpec}
            testIdPrefix="active"
          />
        </div>
      )}

      {tool === 'elbow' && (
        <div className="options__group">
          <NumberField
            label="Ângulo de deflexão"
            unit="°"
            digits={1}
            value={options.elbowAngleDeg}
            onCommit={(value) =>
              setToolOptions({ elbowAngleDeg: Math.min(135, Math.max(1, value)) })
            }
            testId="option-elbow-angle"
          />
          <div className="chips">
            {[90, 45, 22.5].map((angle) => (
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
              ...reducerSizes.map((s) => ({ value: String(s.dn), label: s.label })),
            ]}
            onChange={(value) =>
              setToolOptions({ reducerDn: value === 'auto' ? null : Number(value) })
            }
          />
          <span className="muted">
            A redução usa a especificação da extremidade em que for acoplada.
          </span>
        </div>
      )}

      {(tool === 'pipe' || tool === 'measure') && <CoordinateEntry />}

      {tool !== 'select' && (
        <div className="options__group">
          <span className="options__caption">Plano de trabalho</span>
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
