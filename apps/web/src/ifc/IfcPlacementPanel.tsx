import {
  applyIfcTransform,
  formatMeters,
  IFC_PLACEMENT_MODES,
  type IfcPlacementMode,
  type Vec3,
} from '@hydrobim/core';
import { Check, MousePointerClick, X } from 'lucide-react';
import { useMemo } from 'react';
import { NumberField, Section } from '../ui/fields';
import { transformBounds, unionBounds } from './ifcGeometry';
import {
  ifcSourceOf,
  placementTransform,
  useIfcStore,
  type IfcPickTarget,
  type IfcPlacementDraft,
} from './ifcStore';

/**
 * Posicionamento do modelo em importação, no painel direito. A prévia desenhada nas vistas
 * usa a mesma transformação que a confirmação grava (`placementTransform`): o que se vê é o
 * que será inserido. Cancelar não altera o projeto.
 */

const MODE_LABELS: Record<IfcPlacementMode, { title: string; hint: string }> = {
  original: {
    title: 'Manter as coordenadas originais',
    hint: 'O modelo entra onde o arquivo o coloca (em metros, Z para cima), sem deslocar nem recentralizar.',
  },
  basePoint: {
    title: 'Posicionar por ponto-base',
    hint: 'Um ponto do modelo importado é levado a um ponto do projeto; o giro é em torno do ponto-base.',
  },
  offset: {
    title: 'Informar deslocamento e rotação',
    hint: 'Giro em torno da origem do arquivo, seguido do deslocamento.',
  },
  aligned: {
    title: 'Alinhar por referências',
    hint: 'Dois pontos do modelo são levados a dois pontos existentes do projeto (desloca e gira em planta, sem escala).',
  },
};

const PICK_LABELS: Record<IfcPickTarget, string> = {
  base: 'Clique o ponto-base sobre a prévia do modelo importado',
  target: 'Clique o destino do ponto-base no projeto',
  source1: 'Clique o 1º ponto sobre a prévia do modelo importado',
  target1: 'Clique o destino do 1º ponto no projeto',
  source2: 'Clique o 2º ponto sobre a prévia do modelo importado',
  target2: 'Clique o destino do 2º ponto (define a direção)',
};

const point = (value: Vec3 | null): string =>
  value
    ? `${formatMeters(value.x, 3)}; ${formatMeters(value.y, 3)}; ${formatMeters(value.z, 3)}`
    : 'não indicado';

function VecFields({
  value,
  onChange,
  prefix,
  testId,
}: {
  value: Vec3;
  onChange: (next: Vec3) => void;
  prefix: string;
  testId: string;
}) {
  return (
    <>
      {(['x', 'y', 'z'] as const).map((axis) => (
        <NumberField
          key={axis}
          label={`${prefix}${axis.toUpperCase()}`}
          unit="m"
          value={value[axis]}
          onCommit={(next) => onChange({ ...value, [axis]: next })}
          testId={`${testId}-${axis}`}
        />
      ))}
    </>
  );
}

function PickButton({ target, label }: { target: IfcPickTarget; label: string }) {
  const picking = useIfcStore((s) => s.wizard?.picking ?? null);
  const active = picking === target;
  return (
    <button
      type="button"
      className={active ? 'btn is-active' : 'btn'}
      data-testid={`ifc-pick-${target}`}
      aria-pressed={active}
      title={PICK_LABELS[target]}
      onClick={() => useIfcStore.getState().setPicking(active ? null : target)}
    >
      <MousePointerClick size={14} /> {label}
    </button>
  );
}

export function IfcPlacementPanel() {
  const wizard = useIfcStore((s) => s.wizard);
  const revision = useIfcStore((s) => s.revision);
  const sha = wizard?.sha256 ?? null;
  const source = useMemo(
    () => (sha ? ifcSourceOf(sha) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sha, revision],
  );
  if (!wizard || wizard.step !== 'placing') return null;
  const { placement, picking } = wizard;
  const set = (patch: Partial<IfcPlacementDraft>): void =>
    useIfcStore.getState().setPlacement(patch);
  const transform = placementTransform(placement);

  // Envoltória resultante, pela mesma transformação da prévia e da confirmação.
  let bounds = null;
  if (source && transform.ok) {
    for (const object of source.summary.objects) {
      if (wizard.selected.has(object.expressId) && object.bounds) {
        bounds = unionBounds(bounds, transformBounds(object.bounds, transform.value));
      }
    }
  }
  const [source1, source2] = placement.sources;
  const [target1, target2] = placement.targets;
  const shown = (value: Vec3 | null): Vec3 | null =>
    value && transform.ok ? applyIfcTransform(transform.value, value) : value;

  return (
    <aside className="panel inspector" data-testid="ifc-placement" data-mode={placement.mode}>
      <header className="panel__header inspector__header">
        <div className="inspector__identity">
          <span className="inspector__type">Importar IFC · posicionamento</span>
          <h2>{wizard.fileName}</h2>
        </div>
      </header>
      <div className="panel__scroll">
        <Section title="Como posicionar" testId="ifc-placement-mode">
          <div
            className="ifc-placement__modes"
            role="radiogroup"
            aria-label="Modo de posicionamento"
          >
            {IFC_PLACEMENT_MODES.map((mode) => (
              <label key={mode} title={MODE_LABELS[mode].hint}>
                <input
                  type="radio"
                  name="ifc-placement-mode"
                  data-testid={`ifc-mode-${mode}`}
                  checked={placement.mode === mode}
                  onChange={() => useIfcStore.getState().setPlacementMode(mode)}
                />
                {MODE_LABELS[mode].title}
              </label>
            ))}
          </div>
          <p className="ifc-note">{MODE_LABELS[placement.mode].hint}</p>
        </Section>

        {placement.mode === 'offset' && (
          <Section title="Deslocamento e rotação" testId="ifc-placement-offset">
            <VecFields
              value={placement.offset}
              onChange={(offset) => set({ offset })}
              prefix="Δ"
              testId="ifc-offset"
            />
            <NumberField
              label="Giro"
              unit="°"
              digits={4}
              value={placement.rotationDeg}
              onCommit={(rotationDeg) => set({ rotationDeg })}
              testId="ifc-offset-rotation"
              title="Anti-horário visto de cima, em torno da origem do arquivo"
            />
          </Section>
        )}

        {placement.mode === 'basePoint' && (
          <Section title="Ponto-base e destino" testId="ifc-placement-base">
            <div className="ifc-placement__pick">
              <PickButton target="base" label="Ponto-base" />
              <code title="No referencial do arquivo">{point(placement.basePoint)}</code>
            </div>
            <p className="ifc-note">
              Ponto-base no referencial do arquivo. Começa no canto de menores X, Y e Z do que foi
              escolhido.
            </p>
            <div className="ifc-placement__pick">
              <PickButton target="target" label="Destino" />
            </div>
            <VecFields
              value={placement.target}
              onChange={(target) => set({ target })}
              prefix="Destino "
              testId="ifc-target"
            />
            <NumberField
              label="Giro"
              unit="°"
              digits={4}
              value={placement.rotationDeg}
              onCommit={(rotationDeg) => set({ rotationDeg })}
              testId="ifc-base-rotation"
              title="Anti-horário visto de cima, em torno do ponto-base"
            />
          </Section>
        )}

        {placement.mode === 'aligned' && (
          <Section title="Pares de pontos" testId="ifc-placement-align">
            <div className="ifc-placement__pick">
              <PickButton target="source1" label="1º ponto" />
              <code>{point(shown(source1))}</code>
            </div>
            <div className="ifc-placement__pick">
              <PickButton target="target1" label="Destino 1" />
              <code>{point(target1)}</code>
            </div>
            <div className="ifc-placement__pick">
              <PickButton target="source2" label="2º ponto" />
              <code>{point(shown(source2))}</code>
            </div>
            <div className="ifc-placement__pick">
              <PickButton target="target2" label="Destino 2" />
              <code>{point(target2)}</code>
            </div>
            <p className="ifc-note">
              Os pontos do modelo são capturados nos vértices da prévia; os destinos, em vértices de
              modelos já importados, portas, elementos, grade ou plano de trabalho. Sem o 2º par, o
              modelo só é deslocado.
            </p>
          </Section>
        )}

        <Section title="Resultado" testId="ifc-placement-result">
          {picking && (
            <p className="ifc-note" data-testid="ifc-picking" role="status">
              <strong>{PICK_LABELS[picking]}.</strong> Esc cancela a indicação.
            </p>
          )}
          {!transform.ok && (
            <p className="ifc-note" data-testid="ifc-placement-pending">
              {transform.error.message}
            </p>
          )}
          {transform.ok && (
            <dl className="ifc-import__facts" data-testid="ifc-placement-summary">
              <dt>Deslocamento</dt>
              <dd data-testid="ifc-placement-translation">{point(transform.value.translation)}</dd>
              <dt>Giro</dt>
              <dd data-testid="ifc-placement-rotation">
                {((transform.value.rotation * 180) / Math.PI).toLocaleString('pt-BR', {
                  maximumFractionDigits: 4,
                })}
                °
              </dd>
              <dt>Envoltória mín.</dt>
              <dd data-testid="ifc-placement-min">
                {bounds ? point({ x: bounds[0], y: bounds[1], z: bounds[2] }) : '—'}
              </dd>
              <dt>Envoltória máx.</dt>
              <dd data-testid="ifc-placement-max">
                {bounds ? point({ x: bounds[3], y: bounds[4], z: bounds[5] }) : '—'}
              </dd>
              <dt>Objetos</dt>
              <dd>{wizard.selected.size.toLocaleString('pt-BR')}</dd>
            </dl>
          )}
          <p className="ifc-note">
            A prévia tracejada (planta) e translúcida (Modelo 3D) mostra exatamente esta posição.
            Nada entra no projeto antes de confirmar.
          </p>
          <div className="ifc-placement__actions">
            <button
              type="button"
              className="btn btn--primary"
              data-testid="ifc-placement-confirm"
              disabled={!transform.ok}
              onClick={() => useIfcStore.getState().confirmImport()}
            >
              <Check size={14} /> Confirmar e inserir
            </button>
            <button
              type="button"
              className="btn"
              data-testid="ifc-placement-back"
              onClick={() => useIfcStore.getState().backToPreview()}
            >
              Voltar à seleção
            </button>
            <button
              type="button"
              className="btn"
              data-testid="ifc-placement-cancel"
              onClick={() => useIfcStore.getState().cancelImport()}
            >
              <X size={14} /> Cancelar
            </button>
          </div>
        </Section>
      </div>
    </aside>
  );
}
