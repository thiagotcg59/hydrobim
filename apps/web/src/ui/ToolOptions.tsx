import {
  flangedPipeFamiliesFor,
  getSpecification,
  getTankFamily,
  PIPE_END_CONFIGURATION_LABELS,
  PIPE_END_CONFIGURATIONS,
  TANK_FAMILIES,
} from '@hydrobim/catalog';
import {
  formatMeters,
  australianDiameter,
  radToDeg,
  tankVariantLabel,
  VALVE_TYPES,
  vec3,
  type FamilyKind,
  type FittingFamily,
} from '@hydrobim/core';
import { useState } from 'react';
import { drawElevationOf, elbowAnglesOf, familiesOf, useEditorStore } from '../state/editorStore';
import { NumberField, SelectField } from './fields';
import { PLAN_TOOL_HINTS, TOOL_HINTS, TOOL_LABELS, VALVE_TYPE_LABELS } from './labels';
import { SpecSelector } from './SpecSelector';

const GRID_STEPS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 5, 10];
const POINT_TOOLS = new Set(['pipe', 'measure', 'pump', 'tank']);

/** Entrada de pontos por coordenadas exatas. */
function CoordinateEntry() {
  const workPlaneZ = useEditorStore(drawElevationOf);
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
  const catalogOnly = useEditorStore((s) => s.toolOptions.lockElbowAngles);
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
            label: families.length
              ? 'Automática (primeira compatível)'
              : catalogOnly
                ? 'Sem família de catálogo'
                : 'Genérica (sem catálogo)',
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
          {catalogOnly
            ? 'Não há família de catálogo para esta especificação: a inserção será recusada.'
            : 'Não há família de catálogo para esta especificação: serão usadas dimensões genéricas.'}
        </span>
      )}
    </>
  );
}

/** Família, modelo comercial e dimensões do reservatório a inserir. */
function TankOptions() {
  const tank = useEditorStore((s) => s.toolOptions.tank);
  const { setToolOptions } = useEditorStore.getState();
  const family = getTankFamily(tank.familyId);
  const custom = tank.custom;
  const set = (patch: Partial<typeof tank>): void =>
    setToolOptions({ tank: { ...tank, ...patch } });
  const setCustom = (patch: Partial<typeof custom>): void =>
    set({ custom: { ...custom, ...patch } });
  const defaults = family?.customDefaults;
  const type = family?.tankType;
  const capacityL = custom.capacityL ?? defaults?.capacityL ?? 0;
  const height = custom.height ?? defaults?.height ?? 0;

  return (
    <div className="options__group" data-testid="tank-options">
      <span className="options__caption">Reservatório</span>
      <SelectField
        label="Família"
        testId="option-tank-family"
        value={family?.id ?? 'generic'}
        options={[
          { value: 'generic', label: 'Genérico (sem catálogo)' },
          ...TANK_FAMILIES.map((f) => ({ value: f.id, label: `${f.name} — ${f.manufacturer}` })),
        ]}
        onChange={(id) => {
          const next = getTankFamily(id);
          // Ao trocar de família, parte-se do primeiro modelo tabulado (ou das dimensões
          // iniciais, quando o catálogo não tabula a família).
          set({
            familyId: next?.id ?? null,
            variantId: next?.variants[0]?.id ?? null,
            custom: {},
          });
        }}
      />
      {!family && (
        <span className="muted">
          Cilindro vertical simples, com dimensões genéricas (fora de catálogo).
        </span>
      )}
      {family && family.variants.length > 0 && (
        <SelectField
          label="Modelo comercial"
          testId="option-tank-variant"
          value={tank.variantId ?? 'custom'}
          options={[
            ...family.variants.map((v) => ({ value: v.id, label: tankVariantLabel(v) })),
            { value: 'custom', label: 'Dimensões personalizadas' },
          ]}
          onChange={(id) => set({ variantId: id === 'custom' ? null : id })}
        />
      )}
      {family && family.variants.length === 0 && (
        <span className="muted" data-testid="option-tank-no-table">
          O catálogo não tabula os modelos desta família — só a faixa de{' '}
          {family.capacityRangeL[0].toLocaleString('pt-BR')} a{' '}
          {family.capacityRangeL[1].toLocaleString('pt-BR')} L. Informe as dimensões.
        </span>
      )}
      {family && defaults && tank.variantId === null && (
        <>
          <NumberField
            label="Capacidade nominal"
            unit="L"
            digits={0}
            value={capacityL}
            onCommit={(v) => setCustom({ capacityL: v })}
            testId="option-tank-capacity"
          />
          {type === 'australian' ? (
            <>
              <SelectField
                label="Altura do costado"
                testId="option-tank-wall"
                value={String(height)}
                options={(family.catalogHeights ?? [height]).map((h) => ({
                  value: String(h),
                  label: `${h.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} m`,
                }))}
                onChange={(v) => setCustom({ height: Number(v) })}
              />
              <span className="muted" data-testid="option-tank-derived">
                Diâmetro derivado da capacidade e da altura:{' '}
                {formatMeters(custom.diameter ?? australianDiameter(capacityL / 1000, height), 3)}.
              </span>
            </>
          ) : (
            <>
              <NumberField
                label={
                  type === 'gobletWet' || type === 'gobletDry' ? 'Diâmetro da taça' : 'Diâmetro'
                }
                unit="m"
                value={custom.diameter ?? defaults.diameter}
                onCommit={(v) => setCustom({ diameter: v })}
                testId="option-tank-diameter"
              />
              {type !== 'horizontal' && (
                <NumberField
                  label="Altura total"
                  unit="m"
                  value={height}
                  onCommit={(v) => setCustom({ height: v })}
                  testId="option-tank-height"
                />
              )}
            </>
          )}
          {type === 'gobletDry' && (
            <NumberField
              label="Altura da coluna"
              unit="m"
              value={custom.columnHeight ?? 3.6}
              onCommit={(v) => setCustom({ columnHeight: v })}
              testId="option-tank-column"
            />
          )}
          {type === 'horizontal' && (
            <>
              <NumberField
                label="Comprimento"
                unit="m"
                value={custom.length ?? defaults.length ?? 0}
                onCommit={(v) => setCustom({ length: v })}
                testId="option-tank-length"
              />
              <SelectField
                label="Apoio"
                testId="option-tank-support"
                value={custom.supportType ?? 'skid'}
                options={[
                  { value: 'skid', label: 'Longarina' },
                  { value: 'legs', label: 'Pés de 0,50 m' },
                ]}
                onChange={(supportType) => setCustom({ supportType })}
              />
            </>
          )}
        </>
      )}
      {family && (
        <span className="muted families__source" data-testid="option-tank-source">
          Fonte: {family.source}. Chapas, acessórios e bocais não são tabulados: aparecem como
          representação e podem ser ajustados nas propriedades.
        </span>
      )}
    </div>
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
  const viewMode = useEditorStore((s) => s.viewMode);
  const pipeElevation = useEditorStore((s) => s.pipeElevation);
  const drawing = useEditorStore((s) => s.anchor !== null);
  const project = useEditorStore((s) => s.project);
  const { setActiveSpec, setToolOptions, setWorkPlaneZ, setGridStep, setSnapToGrid } =
    useEditorStore.getState();
  const pipeFamilies = flangedPipeFamiliesFor(activeSpec.specificationId);
  const catalogAngles = elbowAnglesOf(project, activeSpec).map(
    (angle) => Math.round(radToDeg(angle) * 100) / 100,
  );
  const catalogOnly = (
    <label
      className="check"
      title="Recusa joelho, tê, redução ou válvula sem família de catálogo (dimensões genéricas)"
    >
      <input
        type="checkbox"
        data-testid="option-lock-angles"
        checked={options.lockElbowAngles}
        onChange={(event) => setToolOptions({ lockElbowAngles: event.target.checked })}
      />
      Somente peças de catálogo
    </label>
  );
  const angleLock = (
    <>
      {catalogOnly}
      <span className="muted" data-testid="option-catalog-angles">
        {catalogAngles.length > 0
          ? `Joelhos de catálogo para ${activeSpec.sizeLabel}: ${catalogAngles
              .map((angle) => `${String(angle).replace('.', ',')}°`)
              .join(
                ', ',
              )}.${options.lockElbowAngles ? '' : ' Desligado: outros ângulos usam dimensões genéricas.'}`
          : options.lockElbowAngles
            ? `Não há joelho de catálogo para ${activeSpec.sizeLabel} nesta especificação: o traçado só prolonga em linha reta e a inserção de joelho é recusada.`
            : 'Não há joelho de catálogo para esta especificação: o ângulo é livre e a peça é genérica.'}
      </span>
    </>
  );

  const sizes = getSpecification(activeSpec.specificationId)?.sizes ?? [];
  const steps = GRID_STEPS.includes(gridStep) ? GRID_STEPS : [...GRID_STEPS, gridStep].sort();
  const isFittingTool =
    tool === 'elbow' || tool === 'tee' || tool === 'reducer' || tool === 'valve';
  const level = levels.find((l) => Math.abs(l.elevation - workPlaneZ) < 1e-9);

  return (
    <aside className="options" aria-label="Opções da ferramenta" data-testid="tool-options">
      <header className="options__header">
        <strong>{TOOL_LABELS[tool]}</strong>
        <span className="muted">
          {(viewMode === 'plan' ? PLAN_TOOL_HINTS[tool] : undefined) ?? TOOL_HINTS[tool]}
        </span>
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

      {tool === 'tank' && <TankOptions />}

      {tool === 'pipe' && pipeFamilies.length > 0 && (
        <div className="options__group" data-testid="pipe-ends-options">
          <span className="options__caption">Extremidades do tubo</span>
          <SelectField
            label="Configuração"
            value={options.pipeEnds.configuration}
            options={PIPE_END_CONFIGURATIONS.map((value) => ({
              value,
              label: PIPE_END_CONFIGURATION_LABELS[value],
            }))}
            onChange={(configuration) =>
              setToolOptions({ pipeEnds: { ...options.pipeEnds, configuration } })
            }
            testId="option-pipe-ends"
          />
          {options.pipeEnds.configuration !== 'plainPlain' && (
            <SelectField
              label="Flange"
              value={
                pipeFamilies.find((f) => f.id === options.pipeEnds.familyId)?.id ??
                pipeFamilies[0]?.id ??
                ''
              }
              options={pipeFamilies.map((f) => ({ value: f.id, label: f.pressureClass }))}
              onChange={(familyId) =>
                setToolOptions({ pipeEnds: { ...options.pipeEnds, familyId } })
              }
              testId="option-pipe-flange"
            />
          )}
          <span className="muted">
            O comprimento é o do trecho traçado, medido entre as portas (face do flange ou
            extremidade da ponta).
          </span>
        </div>
      )}

      {tool === 'pipe' && (
        <div className="options__group">
          <span className="options__caption">Mudança de direção</span>
          {angleLock}
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
            {(catalogAngles.length > 0 ? [...catalogAngles].reverse() : [90, 45, 22.5, 11.25]).map(
              (angle) => (
                <button
                  key={angle}
                  type="button"
                  className={options.elbowAngleDeg === angle ? 'chip is-active' : 'chip'}
                  data-testid={`option-elbow-chip-${angle}`}
                  onClick={() => setToolOptions({ elbowAngleDeg: angle })}
                >
                  {String(angle).replace('.', ',')}°
                </button>
              ),
            )}
          </div>
          <FamilySelect
            kind="elbow"
            onPick={(family) => {
              if (family?.angle) {
                setToolOptions({ elbowAngleDeg: Math.round(radToDeg(family.angle) * 100) / 100 });
              }
            }}
          />
          {angleLock}
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
          {catalogOnly}
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
          {catalogOnly}
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
          {catalogOnly}
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
          {tool === 'pipe' && (
            <>
              <NumberField
                label="Elevação do eixo"
                unit="m"
                value={pipeElevation}
                onCommit={(value) => useEditorStore.getState().setPipeElevation(value)}
                title="Altura do eixo das tubulações acima do nível"
                testId="option-pipe-elevation"
              />
              <span className="muted" data-testid="pipe-elevation-info">
                Eixo na cota Z {formatMeters(workPlaneZ + pipeElevation, 2)}.{' '}
                {drawing
                  ? 'Alterar a elevação agora cria a prumada a partir do último ponto.'
                  : 'A elevação acompanha a extremidade de onde o trecho parte.'}
              </span>
            </>
          )}
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
