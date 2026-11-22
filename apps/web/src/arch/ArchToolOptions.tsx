import {
  archGroundElevationAt,
  archTypeSizeLabel,
  formatMeters,
  getArchElement,
  hasDesignTerrain,
  type Project,
  type WallLocationLine,
} from '@hydrobim/core';
import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { NumberField, ReadOnlyRow, Section, SelectField } from '../ui/fields';
import { activeTypeIdOf, workLevelIdOf } from './archGeometry';
import {
  ARCH_TOOL_CATEGORY,
  ARCH_TOOL_HINTS,
  ARCH_TOOL_LABELS,
  effectiveSeatOf,
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
              <label className="check" title="Liga o último ponto ao primeiro ao concluir">
                <input
                  type="checkbox"
                  data-testid="arch-option-closed"
                  checked={options.closed}
                  onChange={(event) => setOptions({ closed: event.target.checked })}
                />
                Fechar o traçado ao concluir
              </label>
            </>
          )}
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
