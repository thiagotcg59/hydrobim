import {
  FLANGE_PRESSURE_CLASSES,
  flangedPipeFamiliesFor,
  getSpecification,
  jointDeflectionDegrees,
  PIPE_END_CONFIGURATION_LABELS,
  PIPE_END_CONFIGURATIONS,
} from '@hydrobim/catalog';
import {
  degToRad,
  formatDegrees,
  formatMeters,
  getElement,
  GROUND_SURFACES,
  hasDesignTerrain,
  MAX_BEND_VERTEX,
  australianDiameter,
  mmToM,
  mToMm,
  PUMP_DIMENSION_KEYS,
  PUMP_DIMENSION_LABELS,
  pumpFlangeLabel,
  pumpVariantLabel,
  radToDeg,
  tankVariantLabel,
  VALVE_TYPES,
  vec3,
  type FamilyKind,
  type FittingFamily,
  type JunctionChoice,
  type Vec3,
} from '@hydrobim/core';
import { useState } from 'react';
import { ALIGN_STEP_LABELS, alignAngleOf, alignStepOf } from '../state/alignTool';
import { ConnectPanel } from './ConnectPanel';
import {
  drawElevationOf,
  elbowAnglesOf,
  elementOriginOf,
  familiesOf,
  moveIdsOf,
  placementGroundLabel,
  pumpFamiliesOf,
  rotationSweepOf,
  rotateStepOf,
  selectionCenterOf,
  tankFamiliesOf,
  useEditorStore,
} from '../state/editorStore';
import { NumberField, SelectField } from './fields';
import { PLAN_TOOL_HINTS, TOOL_HINTS, TOOL_LABELS, VALVE_TYPE_LABELS } from './labels';
import { SegmentEntry } from './SegmentEntry';
import { SpecSelector } from './SpecSelector';

const POINT_TOOLS = new Set(['pipe', 'measure', 'pump', 'tank', 'move', 'rotate', 'align']);

/**
 * Superfície de referência do assentamento: terreno projetado (padrão) ou natural. Só aparece
 * quando os dois diferem (há platôs gerados); sem platôs a cota é a mesma.
 */
function GroundSurfaceChoice({ disabled }: { disabled: boolean }) {
  const project = useEditorStore((s) => s.project);
  const surface = useEditorStore((s) => s.toolOptions.groundSurface);
  if (!hasDesignTerrain(project)) return null;
  const { setToolOptions } = useEditorStore.getState();
  return (
    <div
      className="chips"
      role="radiogroup"
      aria-label="Superfície de referência"
      data-testid="option-ground-surface"
      title="Superfície de onde vem a cota do terreno: o projetado (natural modificado pelos platôs, o terreno acabado) ou o natural (como levantado)"
    >
      {GROUND_SURFACES.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={surface === value}
          disabled={disabled}
          className={surface === value ? 'chip is-active' : 'chip'}
          data-testid={`option-ground-${value}`}
          onClick={() => setToolOptions({ groundSurface: value })}
        >
          {value === 'design' ? 'Terreno projetado' : 'Terreno natural'}
        </button>
      ))}
    </div>
  );
}

const ROTATE_CHIPS = [90, -90, 180, 45, -45] as const;

/**
 * Girar em planta, no fluxo do Revit: centro no meio da seleção (ou outro), raio inicial e
 * raio final pelo cursor, ou ângulo digitado; a rede ligada gira junto e "Copiar" mantém os
 * originais.
 */
function RotatePanel() {
  const project = useEditorStore((s) => s.project);
  const rotation = useEditorStore((s) => s.rotate);
  const cursor = useEditorStore((s) => s.cursor);
  const [degrees, setDegrees] = useState(90);
  if (!rotation) {
    return (
      <div className="options__group" data-testid="rotate-panel">
        <span className="muted">Selecione elementos e use Girar (faixa, G ou botão direito).</span>
      </div>
    );
  }
  const store = () => useEditorStore.getState();
  const ids = moveIdsOf(project, rotation);
  const first = getElement(project, ids[0] ?? '');
  const origin = elementOriginOf(project, rotation.ids[0] ?? '');
  const middle = selectionCenterOf(project, rotation.ids);
  const { center, reference } = rotation;
  const live =
    center && reference !== null && cursor
      ? rotationSweepOf(center, reference, cursor.point, rotateStepOf())
      : null;
  const step = !center ? 'center' : reference === null ? 'reference' : 'angle';
  return (
    <div className="options__group" data-testid="rotate-panel" data-step={step}>
      <span className="options__caption">
        {ids.length === 1 && first ? first.name : `${ids.length} elementos`}
      </span>
      <span className="muted" data-testid="rotate-step">
        {!center
          ? 'Indique o centro de giro.'
          : `Centro: ${formatMeters(center.x, 2)}; ${formatMeters(center.y, 2)}. ${
              reference === null
                ? 'Indique o raio inicial ou digite o ângulo.'
                : `Indique o raio final${live === null ? '' : ` (giro: ${formatDegrees(live)})`} ou digite o ângulo.`
            }`}
      </span>
      <div className="chips">
        {center ? (
          <button
            type="button"
            className="btn btn--compact"
            data-testid="rotate-pick-center"
            onClick={() => store().setRotateCenter(null)}
          >
            Escolher outro centro
          </button>
        ) : (
          middle && (
            <button
              type="button"
              className="btn btn--compact"
              data-testid="rotate-center-middle"
              onClick={() => store().setRotateCenter(middle)}
            >
              Centro da seleção
            </button>
          )
        )}
        {origin && (
          <button
            type="button"
            className="btn btn--compact"
            data-testid="rotate-center-origin"
            onClick={() => store().setRotateCenter(origin)}
          >
            Origem do elemento
          </button>
        )}
      </div>
      <NumberField
        label="Ângulo"
        unit="°"
        digits={2}
        value={degrees}
        onCommit={setDegrees}
        title="Positivo: anti-horário, visto de cima"
        testId="rotate-angle"
      />
      <div className="chips">
        {ROTATE_CHIPS.map((value) => (
          <button
            key={value}
            type="button"
            className={degrees === value ? 'chip is-active' : 'chip'}
            data-testid={`rotate-chip-${value}`}
            onClick={() => setDegrees(value)}
          >
            {value > 0 ? `+${value}` : value}°
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn btn--compact btn--confirm"
        data-testid="rotate-apply"
        disabled={!center || degrees % 360 === 0}
        title={center ? undefined : 'Indique primeiro o centro de giro'}
        onClick={() => store().applyRotation(degToRad(degrees))}
      >
        {rotation.copy ? 'Copiar e girar' : 'Girar'} {String(degrees).replace('.', ',')}°
      </button>
      <label
        className="check"
        title="Tubos, conexões e acessórios ligados aos elementos giram junto, como um conjunto rígido"
      >
        <input
          type="checkbox"
          data-testid="rotate-with-connected"
          checked={rotation.withConnected}
          onChange={(event) => store().setRotateWithConnected(event.target.checked)}
        />
        Girar a rede ligada
      </label>
      <label className="check" title="Gira uma cópia; os elementos originais ficam onde estão">
        <input
          type="checkbox"
          data-testid="rotate-copy"
          checked={rotation.copy}
          onChange={(event) => store().setRotateCopy(event.target.checked)}
        />
        Copiar
      </label>
      <span className="muted">
        {rotation.copy
          ? 'A cópia sai girada, com as ligações internas; os originais não mudam.'
          : rotation.withConnected
            ? 'Tubos, conexões e acessórios ligados giram junto; comprimentos, ligações e cotas se mantêm.'
            : 'Só a seleção gira: recusado se romper uma ligação com o restante da rede.'}
      </span>
    </div>
  );
}

const formatPoint = (p: Vec3): string =>
  `${formatMeters(p.x, 2)}; ${formatMeters(p.y, 2)}; ${formatMeters(p.z, 2)}`;

/**
 * Alinhar por pontos (ALIGN do AutoCAD): a etapa, os pontos já indicados, o giro que o cursor
 * produziria, "Aplicar só o 1º par" (apenas desloca), rede ligada e cópia.
 */
function AlignPanel() {
  const project = useEditorStore((s) => s.project);
  const align = useEditorStore((s) => s.align);
  const cursor = useEditorStore((s) => s.cursor);
  const freePoint = useEditorStore((s) => s.alignFreePoint);
  const snapToGrid = useEditorStore((s) => s.snapToGrid);
  const gridStep = useEditorStore((s) => s.gridStep);
  if (!align) {
    return (
      <div className="options__group" data-testid="align-panel">
        <span className="muted">
          Selecione elementos e use Alinhar por pontos (faixa, N ou botão direito).
        </span>
      </div>
    );
  }
  const store = () => useEditorStore.getState();
  const ids = moveIdsOf(project, align);
  const first = getElement(project, ids[0] ?? '');
  const step = alignStepOf(align);
  const angle = step === 'target2' && cursor ? alignAngleOf(align, cursor.point) : null;
  const done: [string, Vec3 | null][] = [
    ['Origem 1', align.source1],
    ['Destino 1', align.target1],
    ['Origem 2', align.source2],
  ];
  return (
    <div className="options__group" data-testid="align-panel" data-step={step}>
      <span className="options__caption">
        {ids.length === 1 && first ? first.name : `${ids.length} elementos`}
      </span>
      {done.map(
        ([label, point]) =>
          point && (
            <span key={label} className="muted">
              {label}: {formatPoint(point)}
            </span>
          ),
      )}
      <span className="muted" data-testid="align-step">
        Indique o {ALIGN_STEP_LABELS[step]}
        {angle === null ? '' : ` (giro: ${formatDegrees(angle)})`}.
      </span>
      {(step === 'source2' || step === 'target2') && (
        <button
          type="button"
          className="btn btn--compact btn--confirm"
          data-testid="align-apply-first"
          title="Leva o 1º ponto de origem ao 1º destino, sem girar (como o Enter do ALIGN do AutoCAD)"
          onClick={() => store().applyAlign(null)}
        >
          {align.copy ? 'Copiar só com o 1º par' : 'Aplicar só o 1º par'}
        </button>
      )}
      <label
        className="check"
        title="Tubos, conexões e acessórios ligados aos elementos vão junto, como um conjunto rígido"
      >
        <input
          type="checkbox"
          data-testid="align-with-connected"
          checked={align.withConnected}
          onChange={(event) => store().setAlignWithConnected(event.target.checked)}
        />
        Levar a rede ligada
      </label>
      <label
        className="check"
        title="Os pontos ficam exatamente onde você clica, sem ajuste à grade. As extremidades das peças continuam sendo capturadas"
      >
        <input
          type="checkbox"
          data-testid="align-free-point"
          checked={freePoint}
          onChange={(event) => store().setAlignFreePoint(event.target.checked)}
        />
        Ponto livre (sem ajuste à grade)
      </label>
      <span className="muted" data-testid="align-snap-note">
        {freePoint
          ? 'Ponto livre: o ponto fica onde você clicar; perto de uma extremidade, ela é capturada.'
          : snapToGrid
            ? `Os pontos caem nos nós da grade (${formatMeters(gridStep, 2)}). Marque "Ponto livre" para clicar em qualquer lugar.`
            : 'Ajuste à grade desligado: o ponto fica onde você clicar.'}
      </span>
      <label className="check" title="Alinha uma cópia; os elementos originais ficam onde estão">
        <input
          type="checkbox"
          data-testid="align-copy"
          checked={align.copy}
          onChange={(event) => store().setAlignCopy(event.target.checked)}
        />
        Copiar
      </label>
      <span className="muted">
        Giro só em torno do eixo vertical e sem escala: a cota do 2º par não inclina o conjunto.
        {align.withConnected
          ? ' A rede ligada vai junto; comprimentos e ligações se mantêm.'
          : ' Só a seleção se alinha: com giro, recusado se romper uma ligação com o restante da rede.'}
      </span>
    </div>
  );
}

/** Mover interativo: o que se move, a etapa atual e a opção de levar a rede ligada. */
function MovePanel() {
  const project = useEditorStore((s) => s.project);
  const move = useEditorStore((s) => s.move);
  if (!move) {
    return (
      <div className="options__group" data-testid="move-panel">
        <span className="muted">Selecione elementos e use Mover (faixa ou botão direito).</span>
      </div>
    );
  }
  const ids = moveIdsOf(project, move);
  const first = getElement(project, ids[0] ?? '');
  return (
    <div className="options__group" data-testid="move-panel" data-step={move.from ? 'to' : 'from'}>
      <span className="options__caption">
        {ids.length === 1 && first ? first.name : `${ids.length} elementos`}
      </span>
      <span className="muted" data-testid="move-step">
        {move.from
          ? `Ponto-base: ${formatMeters(move.from.x, 2)}; ${formatMeters(move.from.y, 2)}; ${formatMeters(move.from.z, 2)}. Indique o destino.`
          : 'Indique o ponto-base.'}
      </span>
      <label
        className="check"
        title="Desloca rigidamente, junto, tudo o que estiver ligado aos elementos (a rede inteira até as extremidades livres)"
      >
        <input
          type="checkbox"
          data-testid="move-with-connected"
          checked={move.withConnected}
          onChange={(event) => useEditorStore.getState().setMoveWithConnected(event.target.checked)}
        />
        Levar a rede ligada
      </label>
      <span className="muted">
        {move.withConnected
          ? 'A rede ligada vai junto, sem alterar comprimentos nem ligações.'
          : 'Só a seleção se move; os tubos ligados se ajustam quando o deslocamento segue o eixo deles, senão o destino é recusado.'}
      </span>
    </div>
  );
}

/** Entrada de pontos por coordenadas exatas. */
function CoordinateEntry() {
  const workPlaneZ = useEditorStore(drawElevationOf);
  const anchor = useEditorStore((s) => s.anchor);
  const tool = useEditorStore((s) => s.tool);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [z, setZ] = useState<number | null>(null);
  const effectiveZ = z ?? workPlaneZ;
  const moveFrom = useEditorStore((s) => s.move?.from ?? null);
  const rotateCenter = useEditorStore((s) => s.rotate?.center ?? null);
  const rotateReference = useEditorStore((s) => s.rotate?.reference ?? null);
  const align = useEditorStore((s) => s.align);
  const caption =
    tool === 'pipe'
      ? anchor
        ? 'Ponto final'
        : 'Ponto inicial'
      : tool === 'measure'
        ? 'Ponto'
        : tool === 'move'
          ? moveFrom
            ? 'Destino'
            : 'Ponto-base'
          : tool === 'rotate'
            ? rotateCenter
              ? rotateReference === null
                ? 'Raio inicial'
                : 'Raio final'
              : 'Centro de giro'
            : tool === 'align' && align
              ? ALIGN_STEP_LABELS[alignStepOf(align)].replace(/^./, (c) => c.toUpperCase())
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

const JUNCTION_CHOICES: readonly (readonly [JunctionChoice, string])[] = [
  ['auto', 'Automática'],
  ['tee', 'Tê'],
  ['cross', 'Cruzeta'],
];
const JUNCTION_NOTES: Record<JunctionChoice, string> = {
  auto: 'Tê sobre tubo simples. Ramal no lado oposto à derivação de um tê: o tê é convertido em cruzeta (mesmo elemento). Porta livre de cruzeta: o ramal a usa.',
  tee: 'Sempre tê. No lado oposto à derivação de um tê existente, a ligação é recusada.',
  cross:
    'Cruzeta: com três ligações, a quarta porta fica livre (aviso na validação) — só um acessório real a fecharia.',
};
/** A família tem a peça para a passagem `dn` (qualquer derivação)? */
const offersSize = (family: FittingFamily, dn: number): boolean =>
  family.sizes.some((size) => size.dn === dn);

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
  const project = useEditorStore((s) => s.project);
  const families = tankFamiliesOf(project);
  const family = families.find((f) => f.id === tank.familyId);
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
          ...families.map((f) => ({ value: f.id, label: `${f.name} — ${f.manufacturer}` })),
        ]}
        onChange={(id) => {
          const next = families.find((f) => f.id === id);
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

/** Família, modelo e cotas da bomba a inserir (letras do dimensional do fabricante). */
function PumpOptions() {
  const pump = useEditorStore((s) => s.toolOptions.pump);
  const activeSpec = useEditorStore((s) => s.activeSpec);
  const project = useEditorStore((s) => s.project);
  const { setToolOptions } = useEditorStore.getState();
  const families = pumpFamiliesOf(project);
  const family = families.find((f) => f.id === pump.familyId);
  const variant = family?.variants.find((v) => v.id === pump.variantId);
  const first = family?.variants[0];
  const set = (patch: Partial<typeof pump>): void =>
    setToolOptions({ pump: { ...pump, ...patch } });
  const setCustom = (patch: Partial<typeof pump.custom>): void =>
    set({ custom: { ...pump.custom, ...patch } });
  const sizes = getSpecification(activeSpec.specificationId)?.sizes ?? [];
  const classes = FLANGE_PRESSURE_CLASSES.map((c) => ({ value: c as string, label: c }));

  return (
    <div className="options__group" data-testid="pump-options">
      <span className="options__caption">Bomba</span>
      <SelectField
        label="Família"
        testId="option-pump-family"
        value={family?.id ?? 'generic'}
        options={[
          { value: 'generic', label: 'Genérica (sem catálogo)' },
          ...families.map((f) => ({
            value: f.id,
            label: `${f.name}${f.origin === 'custom' ? ' (personalizada)' : ''}`,
          })),
        ]}
        onChange={(id) => {
          const next = families.find((f) => f.id === id);
          set({
            familyId: next?.id ?? null,
            variantId: next?.variants[0]?.id ?? null,
            custom: {},
            dischargeDn: null,
          });
        }}
      />
      {!family && (
        <span className="muted">
          Conjunto motobomba de representação, com dimensões genéricas (fora de catálogo).
        </span>
      )}
      {family && (
        <SelectField
          label="Modelo"
          testId="option-pump-variant"
          value={pump.variantId ?? 'custom'}
          options={[
            ...family.variants.map((v) => ({ value: v.id, label: pumpVariantLabel(v) })),
            { value: 'custom', label: 'Outro modelo (preencher as cotas)' },
          ]}
          onChange={(id) => set({ variantId: id === 'custom' ? null : id })}
        />
      )}
      {family && variant && (
        <span className="muted" data-testid="option-pump-ports">
          A — sucção: {pumpFlangeLabel(variant.suction)} · B — descarga:{' '}
          {pumpFlangeLabel(variant.discharge)}. As bocas usam a especificação de tubo ativa nesses
          diâmetros.
        </span>
      )}
      {family && first && !variant && (
        <>
          <span className="muted" data-testid="option-pump-custom-note">
            Preencha com os valores do dimensional do fabricante (mesmas letras da tabela). A —
            sucção: {activeSpec.sizeLabel} (especificação ativa).
          </span>
          <SelectField
            label="A — classe do flange de sucção"
            testId="option-pump-class-a"
            value={pump.custom.suctionFlangeClass ?? first.suction.pressureClass}
            options={classes}
            onChange={(v) => setCustom({ suctionFlangeClass: v })}
          />
          <SelectField
            label="B — DN da descarga"
            testId="option-pump-dn-b"
            value={String(pump.dischargeDn ?? activeSpec.dn)}
            options={sizes.map((s) => ({ value: String(s.dn), label: s.label }))}
            onChange={(v) => set({ dischargeDn: Number(v) })}
          />
          <SelectField
            label="B — classe do flange de descarga"
            testId="option-pump-class-b"
            value={pump.custom.dischargeFlangeClass ?? first.discharge.pressureClass}
            options={classes}
            onChange={(v) => setCustom({ dischargeFlangeClass: v })}
          />
          {PUMP_DIMENSION_KEYS.map((key) => (
            <NumberField
              key={key}
              label={`${PUMP_DIMENSION_LABELS[key].letter} — ${PUMP_DIMENSION_LABELS[key].description}`}
              unit="mm"
              digits={1}
              value={mToMm(pump.custom.dimensions?.[key] ?? first.dimensions[key])}
              onCommit={(v) =>
                setCustom({ dimensions: { ...pump.custom.dimensions, [key]: mmToM(v) } })
              }
              testId={`option-pump-${key}`}
            />
          ))}
          <NumberField
            label="Estágios"
            digits={0}
            value={pump.custom.stages ?? first.stages}
            onCommit={(v) => setCustom({ stages: Math.round(v) })}
            testId="option-pump-stages"
          />
        </>
      )}
      {family && (
        <span className="muted families__source" data-testid="option-pump-source">
          Fonte: {family.source}. Carcaça, tirantes, pés e olhais são representação; os flanges vêm
          da tabela única de flanges.
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
  const viewMode = useEditorStore((s) => s.viewMode);
  const pipeElevation = useEditorStore((s) => s.pipeElevation);
  const drawing = useEditorStore((s) => s.anchor !== null);
  const project = useEditorStore((s) => s.project);
  const { setActiveSpec, setToolOptions, setWorkPlaneZ } = useEditorStore.getState();
  const pipeFamilies = flangedPipeFamiliesFor(activeSpec.specificationId);
  const catalogAngles = elbowAnglesOf(project, activeSpec).map(
    (angle) => Math.round(radToDeg(angle) * 100) / 100,
  );
  const jointTable = getSpecification(activeSpec.specificationId)?.jointDeflection;
  const jointDegrees = jointDeflectionDegrees(jointTable, activeSpec.dn);
  // Curvatura a frio do tubo: desvio por vértice para a barra inteira ou, em tubo contínuo
  // (PEAD), para trechos de 1 m — sempre limitado ao máximo por vértice do núcleo.
  const bendRadius = activeSpec.coldBendRadius;
  const bendSpan = activeSpec.coldBendSpan;
  const bendDegrees =
    bendRadius === undefined
      ? undefined
      : Math.round(radToDeg(Math.min((bendSpan ?? 1) / bendRadius, MAX_BEND_VERTEX)) * 10) / 10;
  const deflectionSource =
    jointDegrees !== undefined
      ? jointTable
      : bendRadius !== undefined
        ? getSpecification(activeSpec.specificationId)?.coldBending
        : undefined;
  const degreesText = (degrees: number): string => `${String(degrees).replace('.', ',')}°`;
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
      <span
        className="muted"
        data-testid="option-joint-deflection"
        data-kind={
          jointDegrees !== undefined ? 'joint' : bendRadius !== undefined ? 'bend' : 'none'
        }
        data-degrees={jointDegrees ?? bendDegrees ?? 0}
        title={
          deflectionSource
            ? `Fonte: ${deflectionSource.source}${deflectionSource.remarks ? ` — ${deflectionSource.remarks}` : ''}`
            : 'A especificação não traz deflexão na junta nem curvatura a frio do tubo (junta colada ou soldada, ou sem dado de fabricante).'
        }
      >
        {jointDegrees !== undefined
          ? `Junta elástica: até ${degreesText(jointDegrees)} de deflexão por junta em ${activeSpec.sizeLabel}, sem peça. Acima disso, joelho.`
          : bendRadius !== undefined && bendSpan !== undefined
            ? `Curvatura a frio do tubo: até ${degreesText(bendDegrees ?? 0)} entre barras de ${formatMeters(bendSpan, 0)} em ${activeSpec.sizeLabel}, sem peça e com as juntas alinhadas (trecho mais curto, desvio proporcional). Acima disso, curva.`
            : bendRadius !== undefined
              ? `Curvatura a frio do tubo: raio mínimo de ${formatMeters(bendRadius, 2)} em ${activeSpec.sizeLabel}. Cada vértice admite o comprimento do trecho mais curto dividido pelo raio (trechos de 1 m: ${degreesText(bendDegrees ?? 0)}), até 22,5°.`
              : 'Junta rígida nesta especificação: mudança de direção só com joelho.'}
      </span>
    </>
  );

  const sizes = getSpecification(activeSpec.specificationId)?.sizes ?? [];
  const isFittingTool =
    tool === 'elbow' || tool === 'tee' || tool === 'reducer' || tool === 'valve';
  const level = levels.find((l) => Math.abs(l.elevation - workPlaneZ) < 1e-9);

  return (
    <aside className="options" aria-label="Opções da ferramenta" data-testid="tool-options">
      <header className="options__header">
        <span className="options__badge">Próximo elemento</span>
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
      {tool === 'pump' && <PumpOptions />}

      {(tool === 'pump' || tool === 'tank') && (
        <div className="options__group" data-testid="terrain-placement-options">
          <span className="options__caption">Assentamento no terreno</span>
          <label
            className="check"
            title="A cota do elemento passa a vir da superfície do terreno no ponto clicado, no modelo 3D e na planta"
          >
            <input
              type="checkbox"
              data-testid="option-terrain-placement"
              checked={options.terrainPlacement.enabled && project.terrain !== null}
              disabled={project.terrain === null}
              onChange={(event) =>
                setToolOptions({
                  terrainPlacement: { ...options.terrainPlacement, enabled: event.target.checked },
                })
              }
            />
            Assentar sobre o terreno
          </label>
          <NumberField
            label="Altura sobre o terreno"
            unit="m"
            digits={2}
            value={options.terrainPlacement.offset}
            disabled={project.terrain === null || !options.terrainPlacement.enabled}
            title={`Distância vertical do terreno à cota de referência do elemento (${tool === 'tank' ? 'base do reservatório' : 'eixo de sucção da bomba'}). Negativa = abaixo do terreno`}
            onCommit={(value) =>
              setToolOptions({ terrainPlacement: { ...options.terrainPlacement, offset: value } })
            }
            testId="option-terrain-placement-offset"
          />
          <GroundSurfaceChoice disabled={!options.terrainPlacement.enabled} />
          <span className="muted" data-testid="option-terrain-placement-note">
            {project.terrain === null
              ? 'O projeto não tem superfície de terreno: o elemento fica na cota do plano de trabalho.'
              : options.terrainPlacement.enabled
                ? `${tool === 'tank' ? 'Base do reservatório' : 'Eixo de sucção da bomba'} = ${placementGroundLabel({ project, toolOptions: options })} no ponto clicado${options.terrainPlacement.offset !== 0 ? ` ${options.terrainPlacement.offset > 0 ? '+' : '−'} ${formatMeters(Math.abs(options.terrainPlacement.offset), 2)}` : ''}. Fora da superfície, vale a cota do plano de trabalho. A elevação pode ser alterada depois em Propriedades.`
                : 'Desligado: o elemento fica na cota do plano de trabalho.'}
          </span>
        </div>
      )}

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
          <span className="options__caption">Restrições de direção</span>
          {angleLock}
        </div>
      )}

      {tool === 'pipe' && (
        <div className="options__group" data-testid="junction-options">
          <span className="options__caption">Conexão da derivação</span>
          <div className="chips" role="radiogroup" aria-label="Conexão da derivação">
            {JUNCTION_CHOICES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={options.junction === value}
                className={options.junction === value ? 'chip is-active' : 'chip'}
                data-testid={`option-junction-${value}`}
                onClick={() => setToolOptions({ junction: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="muted" data-testid="option-junction-note">
            {JUNCTION_NOTES[options.junction]}
          </span>
          <FamilySelect kind="tee" accept={(f) => offersSize(f, activeSpec.dn)} />
          <FamilySelect kind="cross" accept={(f) => offersSize(f, activeSpec.dn)} />
        </div>
      )}

      {tool === 'connect' && <ConnectPanel />}

      {tool === 'pipe' && discipline === 'infra' && (
        <div className="options__group" data-testid="terrain-cover-options">
          <span className="options__caption">Assentamento no terreno</span>
          <label
            className="check"
            title="Na Planta Infra, a cota do eixo de cada ponto clicado passa a vir do terreno: a geratriz superior do tubo fica o recobrimento abaixo da superfície"
          >
            <input
              type="checkbox"
              data-testid="option-terrain-cover"
              checked={options.terrainCover.enabled && project.terrain !== null}
              disabled={project.terrain === null}
              onChange={(event) =>
                setToolOptions({
                  terrainCover: { ...options.terrainCover, enabled: event.target.checked },
                })
              }
            />
            Seguir o terreno pelo recobrimento
          </label>
          <NumberField
            label="Recobrimento"
            unit="m"
            digits={2}
            value={options.terrainCover.cover}
            disabled={project.terrain === null}
            title="Distância vertical do terreno à geratriz superior externa do tubo. É uma decisão de projeto: o editor não traz mínimos de norma"
            onCommit={(value) =>
              setToolOptions({
                terrainCover: { ...options.terrainCover, cover: Math.max(0, value) },
              })
            }
            testId="option-terrain-cover-value"
          />
          <GroundSurfaceChoice disabled={!options.terrainCover.enabled} />
          <span className="muted" data-testid="option-terrain-cover-note">
            {project.terrain === null
              ? 'O projeto não tem superfície de terreno (Modelagem › Terreno › Superfície do terreno).'
              : options.terrainCover.enabled
                ? `Eixo = ${placementGroundLabel({ project, toolOptions: options })} − ${options.terrainCover.cover.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} m − meio diâmetro externo (${activeSpec.sizeLabel}: ${(activeSpec.outerDiameter * 500).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mm). Vale nos pontos clicados na Planta Infra; entre eles o tubo é reto, e o recobrimento real do trecho é informado ao criá-lo. Fora da superfície o ponto é recusado.`
                : 'Desligado: os pontos usam a elevação do eixo acima do nível.'}
          </span>
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

      {tool === 'move' && <MovePanel />}
      {tool === 'rotate' && <RotatePanel />}
      {tool === 'align' && <AlignPanel />}

      {tool !== 'select' &&
        tool !== 'connect' &&
        tool !== 'move' &&
        tool !== 'rotate' &&
        tool !== 'align' && (
          <div className="options__group">
            <span className="options__caption">Nível e elevação</span>
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
          </div>
        )}

      {tool === 'pipe' && <SegmentEntry />}
      {POINT_TOOLS.has(tool) && <CoordinateEntry />}
    </aside>
  );
}
