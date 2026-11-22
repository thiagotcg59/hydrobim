import {
  archGroundElevationAt,
  archTypeSizeLabel,
  degToRad,
  formatMeters,
  getArchElement,
  hasDesignTerrain,
  MAX_ROOF_SLOPE,
  MIN_ROOF_SLOPE,
  percentToSlope,
  radToDeg,
  slopeToPercent,
  type Project,
  type WallLocationLine,
} from '@hydrobim/core';
import { Check, X } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { NumberField, ReadOnlyRow, Section, SelectField } from '../ui/fields';
import { ARCH_TRANSFORM_LABELS, ARCH_TRANSFORM_STEPS, contourOutcome } from './archEdit';
import { activeTypeIdOf, workLevelIdOf } from './archGeometry';
import { ARCH_MODIFY_HINTS, ARCH_MODIFY_LABELS, ARCH_MODIFY_STEPS } from './archModify';
import {
  ARCH_TOOL_CATEGORY,
  ARCH_TOOL_HINTS,
  ARCH_TOOL_LABELS,
  effectiveSeatOf,
  isDrawingTool,
  seatGroundLabel,
  useArchStore,
  type ArchSeat,
  type ArchTool,
} from './archStore';

/** Itens de "Assentar sobre": sem platôs, natural e projetado são a mesma superfície. */
export function seatOptionsOf(project: Project): { value: ArchSeat; label: string }[] {
  const level = { value: 'level' as const, label: 'Nível (plano de trabalho)' };
  if (!project.terrain) return [level];
  return hasDesignTerrain(project)
    ? [
        level,
        { value: 'design', label: 'Terreno projetado' },
        { value: 'natural', label: 'Terreno natural' },
      ]
    : [level, { value: 'design', label: 'Terreno' }];
}

export const LOCATION_LINE_OPTIONS: readonly { value: WallLocationLine; label: string }[] = [
  { value: 'center', label: 'Eixo da parede' },
  { value: 'faceLeft', label: 'Face esquerda' },
  { value: 'faceRight', label: 'Face direita' },
];

export const HAND_OPTIONS = [
  { value: 'left', label: 'Esquerda' },
  { value: 'right', label: 'Direita' },
] as const;

export const FACING_OPTIONS = [
  { value: '1', label: 'Face esquerda da parede' },
  { value: '-1', label: 'Face direita da parede' },
] as const;

/** Campo numérico opcional: vazio = não informado (`null`). */
export function OptionalNumberField({
  label,
  value,
  unit,
  placeholder,
  testId,
  onCommit,
}: {
  label: string;
  value: number | null;
  unit?: string;
  placeholder: string;
  testId: string;
  onCommit: (value: number | null) => void;
}) {
  const text = value === null ? '' : String(value).replace('.', ',');
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <span className="field__control">
        <input
          key={text}
          data-testid={testId}
          type="text"
          inputMode="decimal"
          placeholder={placeholder}
          defaultValue={text}
          onBlur={(event) => {
            const typed = event.target.value.trim();
            if (typed === text) return;
            if (typed === '') {
              onCommit(null);
              return;
            }
            const parsed = Number(typed.replace(',', '.'));
            if (Number.isFinite(parsed)) onCommit(parsed);
            else event.target.value = text;
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            event.stopPropagation();
          }}
        />
        {unit && <span className="field__unit">{unit}</span>}
      </span>
    </label>
  );
}

/**
 * Inclinação do telhado em percentual e em graus: os dois campos mostram o MESMO valor (o
 * modelo guarda o ângulo, em radianos). Fora da faixa aceita o valor é recusado, com o motivo.
 */
export function SlopeFields({
  slope,
  testId,
  onCommit,
}: {
  slope: number;
  testId: string;
  onCommit: (slope: number) => void;
}) {
  const commit = (value: number): void => {
    if (value >= MIN_ROOF_SLOPE - 1e-12 && value <= MAX_ROOF_SLOPE + 1e-12) onCommit(value);
    else {
      useEditorStore
        .getState()
        .notify(
          'error',
          'Inclinação fora da faixa: de 1 % a 75° (cobertura plana não é modelada como telhado).',
        );
    }
  };
  return (
    <div className="arch-fields">
      <NumberField
        label="Inclinação"
        unit="%"
        value={Math.round(slopeToPercent(slope) * 1000) / 1000}
        testId={`${testId}-percent`}
        onCommit={(percent) => commit(percentToSlope(percent))}
      />
      <NumberField
        label="Inclinação"
        unit="°"
        value={Math.round(radToDeg(slope) * 1000) / 1000}
        testId={`${testId}-degrees`}
        onCommit={(degrees) => commit(degToRad(degrees))}
      />
    </div>
  );
}

/** Aresta de referência das direções paralela e perpendicular, como está agora. */
function ReferenceStatus() {
  const reference = useArchStore((s) => s.reference);
  return (
    <ReadOnlyRow
      label="Aresta de referência"
      value={
        <span data-testid="arch-reference" data-pinned={reference?.pinned ?? false}>
          {reference
            ? `${reference.segment.sourceName}${reference.pinned ? ' · fixada (R solta)' : ' · última apontada (R fixa)'}`
            : 'nenhuma — aponte uma aresta'}
        </span>
      }
    />
  );
}

/**
 * Painel da operação em andamento que não cria elemento: mover, copiar, girar e espelhar por
 * pontos, e a edição de contorno. Mostra os passos, as opções e como concluir ou cancelar.
 */
export function ArchModePanel() {
  const project = useEditorStore((s) => s.project);
  const transform = useArchStore((s) => s.transform);
  const contour = useArchStore((s) => s.contour);
  const modify = useArchStore((s) => s.modify);
  const count = useArchStore((s) => s.selection.length);
  const arch = useArchStore.getState();
  if (modify) {
    const steps = ARCH_MODIFY_STEPS[modify.kind];
    return (
      <aside className="panel inspector" aria-label="Ferramenta" data-testid="arch-mode-panel">
        <header className="panel__header">
          <h2>{ARCH_MODIFY_LABELS[modify.kind]}</h2>
        </header>
        <div className="panel__scroll">
          <p className="panel__empty">{ARCH_MODIFY_HINTS[modify.kind]}</p>
          <Section title="Operação" testId="arch-modify-panel">
            <ol className="arch-steps" data-testid="arch-modify-steps">
              {steps.map((step, index) => (
                <li
                  key={step}
                  data-done={index < modify.picks.length}
                  aria-current={index === modify.picks.length ? 'step' : undefined}
                >
                  {step}
                  {modify.picks[index] ? ` — ${modify.picks[index].name}` : ''}
                </li>
              ))}
            </ol>
            <span className="muted">
              A prévia (em verde) é o resultado da operação; o motivo de uma recusa aparece junto ao
              cursor. Cada operação confirmada é um passo do histórico.
            </span>
            <div className="arch-actions">
              <button
                type="button"
                className="btn btn--compact"
                data-testid="arch-modify-cancel"
                onClick={() => arch.endModify()}
              >
                <X size={14} aria-hidden /> Encerrar
              </button>
            </div>
          </Section>
        </div>
      </aside>
    );
  }
  if (contour) {
    const element = getArchElement(project.architecture, contour.elementId);
    const outcome = contourOutcome(project, contour);
    return (
      <aside className="panel inspector" aria-label="Ferramenta" data-testid="arch-mode-panel">
        <header className="panel__header">
          <h2>Editar contorno</h2>
        </header>
        <div className="panel__scroll">
          <p className="panel__empty">
            {contour.rectangular
              ? 'Arraste os cantos na planta: o canto oposto fica e o contorno continua retangular.'
              : 'Arraste os vértices na planta; o ponto no meio de cada lado cria um vértice e Del remove o selecionado.'}{' '}
            As capturas valem. Nada é gravado até Concluir.
          </p>
          <Section title="Contorno em edição" testId="arch-contour-panel">
            <ReadOnlyRow label="Elemento" value={element?.name ?? '—'} />
            <ReadOnlyRow
              label="Vértices"
              value={<span data-testid="arch-contour-count">{contour.ring.length}</span>}
            />
            <ReadOnlyRow
              label="Situação"
              value={
                <span data-testid="arch-contour-status" data-valid={outcome.ok}>
                  {outcome.ok ? 'contorno válido' : outcome.error.message}
                </span>
              }
            />
            <ReferenceStatus />
            <div className="arch-actions">
              <button
                type="button"
                className="btn btn--compact btn--primary"
                data-testid="arch-contour-finish-panel"
                onClick={() => arch.finishContour()}
              >
                <Check size={14} aria-hidden /> Concluir
              </button>
              <button
                type="button"
                className="btn btn--compact"
                data-testid="arch-contour-cancel-panel"
                onClick={() => arch.cancelContour()}
              >
                <X size={14} aria-hidden /> Cancelar
              </button>
            </div>
          </Section>
        </div>
      </aside>
    );
  }
  if (!transform) return null;
  const steps = ARCH_TRANSFORM_STEPS[transform.kind];
  return (
    <aside className="panel inspector" aria-label="Ferramenta" data-testid="arch-mode-panel">
      <header className="panel__header">
        <h2>{ARCH_TRANSFORM_LABELS[transform.kind]}</h2>
      </header>
      <div className="panel__scroll">
        <p className="panel__empty">
          Indique os pontos na planta, com as capturas. A prévia (em verde) é o resultado da
          operação; o último clique confirma, em um passo do histórico. Esc volta um ponto e, sem
          pontos, encerra sem alterar o modelo.
        </p>
        <Section title="Operação" testId="arch-transform-panel">
          <ReadOnlyRow
            label="Seleção"
            value={`${count} ${count === 1 ? 'elemento' : 'elementos'}`}
          />
          <ol className="arch-steps" data-testid="arch-transform-steps">
            {steps.map((step, index) => (
              <li
                key={step}
                data-done={index < transform.points.length}
                aria-current={index === transform.points.length ? 'step' : undefined}
              >
                {step}
              </li>
            ))}
          </ol>
          {(transform.kind === 'rotate' || transform.kind === 'mirror') && (
            <label className="check" title="Mantém os originais e transforma uma cópia">
              <input
                type="checkbox"
                data-testid="arch-transform-copy"
                checked={transform.copy}
                onChange={(event) => arch.setTransformCopy(event.target.checked)}
              />
              Copiar (mantém os originais)
            </label>
          )}
          {transform.kind === 'rotate' && (
            <span className="muted">
              Com o centro indicado, digite o ângulo em graus no campo da planta (anti-horário
              positivo) em vez de clicar os raios.
            </span>
          )}
          {(transform.kind === 'move' || transform.kind === 'copy') && (
            <span className="muted">
              Com o ponto-base indicado, digite a distância (na direção do cursor),
              distância&lt;ângulo ou @ΔX;ΔY no campo da planta.
            </span>
          )}
          <ReferenceStatus />
          <div className="arch-actions">
            <button
              type="button"
              className="btn btn--compact"
              data-testid="arch-transform-cancel"
              onClick={() => {
                // Encerra de uma vez, qualquer que seja o número de pontos já indicados.
                useArchStore.setState({ transform: null, snap: null, cursor: null });
                useUiStore.getState().setPanelTab('properties');
              }}
            >
              <X size={14} aria-hidden /> Cancelar
            </button>
          </div>
        </Section>
      </div>
    </aside>
  );
}

/** Opções da ferramenta de arquitetura em uso: tipo ativo e parâmetros do próximo elemento. */
export function ArchToolOptions({ tool }: { tool: ArchTool }) {
  const project = useEditorStore((s) => s.project);
  const workPlaneZ = useEditorStore((s) => s.workPlaneZ);
  const options = useArchStore((s) => s.options);
  const activeTypes = useArchStore((s) => s.activeTypes);
  const openingTarget = useArchStore((s) => s.openingTarget);
  const { setOptions, setActiveType } = useArchStore.getState();
  const category = ARCH_TOOL_CATEGORY[tool];
  const types = category
    ? project.architecture.types.filter((type) => type.category === category)
    : [];
  const typeId = category ? activeTypeIdOf(project, activeTypes, category) : null;
  const levelId = workLevelIdOf(project, workPlaneZ);
  const level = project.levels.find((item) => item.id === levelId);
  const target = openingTarget ? getArchElement(project.architecture, openingTarget) : undefined;
  const firstPoint = useArchStore((s) => s.points[0]);
  const seatable = tool === 'wall' || tool === 'slab' || tool === 'flooring' || tool === 'space';
  const seatChoices = seatOptionsOf(project);
  const seat = effectiveSeatOf(project, options.seat);
  // Sem platôs só há "Terreno": a escolha "natural" guardada é a mesma superfície.
  const seatValue = seatChoices.some((item) => item.value === seat) ? seat : 'design';
  const onGround = seat !== 'level';
  const clearance =
    tool === 'wall' ? options.wallBaseOffset : tool === 'space' ? 0 : options.floorOffset;
  // Cota de referência do próximo elemento: a do nível ou a do terreno no primeiro ponto.
  const ground = onGround && firstPoint ? archGroundElevationAt(project, seat, firstPoint) : null;
  const reference = onGround ? ground : (level?.elevation ?? null);
  const referenceLabel = !onGround && tool === 'slab' ? 'Elevação do topo' : 'Elevação da base';

  return (
    <aside className="panel inspector" aria-label="Ferramenta" data-testid="arch-tool-options">
      <header className="panel__header">
        <h2>{ARCH_TOOL_LABELS[tool]}</h2>
      </header>
      <div className="panel__scroll">
        <p className="panel__empty">{ARCH_TOOL_HINTS[tool]}</p>
        <Section title="Próximo elemento" testId="arch-options">
          {category && typeId && (
            <SelectField
              label="Tipo"
              value={typeId}
              testId="arch-option-type"
              options={types.map((type) => ({
                value: type.id,
                label: `${type.name} · ${archTypeSizeLabel(type)}`,
              }))}
              onChange={(value) => setActiveType(category, value)}
            />
          )}
          {category && (
            <button
              type="button"
              className="btn btn--compact"
              data-testid="arch-option-catalog"
              onClick={() => useUiStore.getState().openDialog('archCatalog')}
            >
              Catálogo de arquitetura…
            </button>
          )}
          {tool !== 'door' && tool !== 'window' && tool !== 'floorOpening' && (
            <ReadOnlyRow
              label="Nível (plano de trabalho)"
              value={<span data-testid="arch-option-level">{level?.name ?? '—'}</span>}
            />
          )}
          {seatable && (
            <>
              <SelectField
                label="Assentar sobre"
                value={seatValue}
                testId="arch-option-seat"
                disabled={project.terrain === null}
                options={seatChoices}
                onChange={(value) => setOptions({ seat: value })}
              />
              <ReadOnlyRow
                label={referenceLabel}
                value={
                  <span data-testid="arch-option-elevation">
                    {reference !== null
                      ? formatMeters(reference + clearance, 3)
                      : firstPoint
                        ? 'fora da superfície: vale o nível'
                        : 'terreno no primeiro ponto'}
                  </span>
                }
              />
              <span className="muted" data-testid="arch-option-seat-note">
                {project.terrain === null
                  ? 'O projeto não tem superfície de terreno (Modelagem › Terreno): a base fica no nível do plano de trabalho.'
                  : onGround
                    ? `A base fica na cota do ${seatGroundLabel(project, seat)} no primeiro ponto ${tool === 'wall' ? 'do traçado' : 'do contorno'}${tool === 'space' ? '' : ', mais a folga abaixo'}. A base é horizontal: em terreno inclinado o restante fica acima ou abaixo da superfície.`
                    : 'A base fica no nível do plano de trabalho, mais o deslocamento abaixo.'}
              </span>
            </>
          )}
          {tool === 'wall' && (
            <>
              <NumberField
                label="Altura"
                unit="m"
                value={options.wallHeight}
                testId="arch-option-height"
                onCommit={(wallHeight) => {
                  if (wallHeight > 0) setOptions({ wallHeight });
                }}
              />
              <NumberField
                label={onGround ? 'Base acima do terreno' : 'Deslocamento da base'}
                unit="m"
                value={options.wallBaseOffset}
                testId="arch-option-base-offset"
                onCommit={(wallBaseOffset) => setOptions({ wallBaseOffset })}
              />
              <SelectField
                label="Linha de referência"
                value={options.locationLine}
                testId="arch-option-location-line"
                options={LOCATION_LINE_OPTIONS}
                onChange={(locationLine) => setOptions({ locationLine })}
              />
              <label
                className="check"
                title="Desligado: dois cliques criam a parede e encerram o trecho. Ligado: cada clique emenda um novo trecho, e Enter ou duplo clique conclui o traçado"
              >
                <input
                  type="checkbox"
                  data-testid="arch-option-chain"
                  checked={options.chain}
                  onChange={(event) => {
                    setOptions({ chain: event.target.checked });
                    // Um traçado começado na outra forma de desenhar não continua.
                    useArchStore.setState({ points: [] });
                  }}
                />
                Traçado contínuo (vários trechos)
              </label>
              {options.chain && (
                <label className="check" title="Liga o último ponto ao primeiro ao concluir">
                  <input
                    type="checkbox"
                    data-testid="arch-option-closed"
                    checked={options.closed}
                    onChange={(event) => setOptions({ closed: event.target.checked })}
                  />
                  Fechar o traçado ao concluir
                </label>
              )}
            </>
          )}
          {tool === 'roof' && (
            <>
              <SlopeFields
                slope={options.roofSlope}
                testId="arch-option-roof-slope"
                onCommit={(roofSlope) => setOptions({ roofSlope })}
              />
              <NumberField
                label="Beiral (na horizontal)"
                unit="m"
                value={options.roofOverhang}
                testId="arch-option-roof-overhang"
                onCommit={(roofOverhang) => {
                  if (roofOverhang >= 0) setOptions({ roofOverhang });
                }}
              />
              <NumberField
                label="Cota de referência (rel. ao nível)"
                unit="m"
                value={options.roofOffset}
                testId="arch-option-roof-offset"
                onCommit={(roofOffset) => setOptions({ roofOffset })}
              />
              <ReadOnlyRow
                label="Elevação de referência"
                value={
                  <span data-testid="arch-option-roof-elevation">
                    {level ? formatMeters(level.elevation + options.roofOffset, 3) : '—'}
                  </span>
                }
              />
              <span className="muted" data-testid="arch-option-roof-note">
                A cota de referência é a da face inferior do telhado sobre a linha do beiral do
                contorno. O beiral é medido na horizontal, para fora do contorno; a espessura do
                tipo, perpendicularmente à água. O primeiro lado desenhado é o beiral.
              </span>
            </>
          )}
          {isDrawingTool(tool) && <ReferenceStatus />}
          {(tool === 'slab' || tool === 'flooring') && (
            <NumberField
              label={
                onGround
                  ? 'Base acima do terreno'
                  : tool === 'slab'
                    ? 'Cota do topo (rel. ao nível)'
                    : 'Cota da base (rel. ao nível)'
              }
              unit="m"
              value={options.floorOffset}
              testId="arch-option-floor-offset"
              onCommit={(floorOffset) => setOptions({ floorOffset })}
            />
          )}
          {tool === 'window' && (
            <OptionalNumberField
              label="Peitoril"
              unit="m"
              value={options.sillHeight}
              placeholder="o do tipo"
              testId="arch-option-sill"
              onCommit={(sillHeight) => {
                if (sillHeight === null || sillHeight >= 0) setOptions({ sillHeight });
              }}
            />
          )}
          {(tool === 'door' || tool === 'window') && (
            <>
              <SelectField
                label={tool === 'door' ? 'Mão (dobradiças)' : 'Mão'}
                value={options.hand}
                testId="arch-option-hand"
                options={HAND_OPTIONS}
                onChange={(hand) => setOptions({ hand })}
              />
              <SelectField
                label="Abre para"
                value={options.facing === 1 ? '1' : '-1'}
                testId="arch-option-facing"
                options={FACING_OPTIONS}
                onChange={(facing) => setOptions({ facing: facing === '1' ? 1 : -1 })}
              />
            </>
          )}
          {tool === 'space' && (
            <OptionalNumberField
              label="Pé-direito"
              unit="m"
              value={options.spaceHeight}
              placeholder="não informado"
              testId="arch-option-space-height"
              onCommit={(spaceHeight) => {
                if (spaceHeight === null || spaceHeight > 0) setOptions({ spaceHeight });
              }}
            />
          )}
          {tool === 'floorOpening' && (
            <ReadOnlyRow
              label="Piso que recebe a abertura"
              value={<span data-testid="arch-option-target">{target?.name ?? '—'}</span>}
            />
          )}
        </Section>
      </div>
    </aside>
  );
}
