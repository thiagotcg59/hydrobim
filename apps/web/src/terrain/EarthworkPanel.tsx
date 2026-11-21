import {
  formatMeters,
  projectEarthworks,
  terrainElevationAt,
  terrainStats,
  type EarthworkQuantities,
  type EarthworkSummary,
  type Project,
  type Terrain,
} from '@hydrobim/core';
import {
  Download,
  Hexagon,
  MapPin,
  Move,
  PenLine,
  RefreshCw,
  RotateCcw,
  Shovel,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { downloadText, projectFileBase } from '../persistence/fileIO';
import { useEditorStore } from '../state/editorStore';
import { formatDecimal, parseDecimal } from '../ui/fields';
import {
  addSurfacePoint,
  changeEarthworkSettings,
  changePlatform,
  deletePlatform,
  removeSurfacePoint,
  restoreSurface,
  retriangulateSurface,
  SURFACE_VIEW_LABELS,
  updateSurfacePoint,
  useEarthworkStore,
  type EarthworkTab,
  type SurfaceView,
} from './earthworkStore';
import { useTerrainStore, type TerrainMode } from './terrainStore';

/**
 * Painel de edição do terreno e de terraplenagem, sobre a Planta Infra: Editar Terreno, Criar
 * Platô, Corte/Aterro e Volumes. Só apresenta e coleta valores — as operações são do núcleo.
 */

export const CUT_COLOR = '#dc2626';
export const FILL_COLOR = '#2563eb';

const TABS: [EarthworkTab, string][] = [
  ['edit', 'Editar Terreno'],
  ['platforms', 'Platôs'],
  ['cutfill', 'Corte/Aterro'],
  ['volumes', 'Volumes'],
];

const nf = (value: number, digits = 2): string =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const m3 = (value: number | null): string => (value === null ? '—' : `${nf(value)} m³`);

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="terrain__row">
      <span className="terrain__key">{label}</span>
      <span className="terrain__value" data-testid={testId}>
        {children}
      </span>
    </div>
  );
}

interface NumberInputProps {
  label: string;
  value: number | null;
  /** `null` = campo vazio (valor não informado). */
  onCommit: (value: number | null) => void;
  testId: string;
  digits?: number;
  placeholder?: string;
  title?: string;
}

/** Campo numérico que aceita vazio (não informado) e confirma ao sair ou com Enter. */
function NumberInput({
  label,
  value,
  onCommit,
  testId,
  digits = 3,
  placeholder,
  title,
}: NumberInputProps) {
  const shown = value === null ? '' : formatDecimal(value, digits);
  const [text, setText] = useState(shown);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setText(shown), [shown, attempt]);
  const commit = (): void => {
    if (text.trim() === shown) return;
    if (text.trim().length === 0) onCommit(null);
    else {
      const parsed = parseDecimal(text);
      if (Number.isFinite(parsed)) onCommit(parsed);
    }
    // Se o valor foi recusado, o campo volta a mostrar o vigente.
    setAttempt((n) => n + 1);
  };
  return (
    <label className="plan__field plan__field--block" title={title}>
      <span>{label}</span>
      <input
        data-testid={testId}
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          event.stopPropagation();
        }}
      />
    </label>
  );
}

function ModeButton({
  mode,
  label,
  icon,
  testId,
  title,
  disabled,
  onStart,
}: {
  mode: TerrainMode;
  label: string;
  icon: ReactNode;
  testId: string;
  title: string;
  disabled?: boolean;
  onStart?: () => void;
}) {
  const active = useTerrainStore((s) => s.mode === mode);
  return (
    <button
      type="button"
      className={active ? 'btn btn--compact is-active' : 'btn btn--compact'}
      data-testid={testId}
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={() => {
        if (active) useTerrainStore.getState().setMode(null);
        else if (onStart) onStart();
        else useTerrainStore.getState().setMode(mode);
      }}
    >
      {icon} {label}
    </button>
  );
}

function FinishDraft() {
  const mode = useTerrainStore((s) => s.mode);
  const count = useTerrainStore((s) => s.draft.length);
  if (mode !== 'boundary' && mode !== 'platform') return null;
  return (
    <button
      type="button"
      className="btn btn--compact"
      data-testid="earthwork-draft-finish"
      disabled={count < 3}
      onClick={() => useTerrainStore.getState().finishDraft()}
    >
      Fechar ({count})
    </button>
  );
}

// ---------------------------------------------------------------------------
// Editar Terreno
// ---------------------------------------------------------------------------

function PendingPoint({ terrain }: { terrain: Terrain }) {
  const pending = useEarthworkStore((s) => s.pending);
  const ground = pending ? terrainElevationAt(terrain, pending.x, pending.y) : null;
  const [z, setZ] = useState<number | null>(null);
  useEffect(
    () => setZ(ground === null ? null : Math.round(ground * 1000) / 1000),
    [ground, pending],
  );
  if (!pending) return null;
  return (
    <div className="terrain__token" data-testid="earthwork-pending-point">
      <Row label="Posição">
        X {nf(pending.x)}; Y {nf(pending.y)}
      </Row>
      <Row label="Superfície no local">
        {ground === null ? 'fora da superfície' : formatMeters(ground, 3)}
      </Row>
      <NumberInput
        label="Cota do novo ponto (m)"
        value={z}
        onCommit={setZ}
        testId="earthwork-point-new-z"
      />
      <div className="terrain__actions">
        <button
          type="button"
          className="btn btn--compact btn--primary"
          data-testid="earthwork-point-add-confirm"
          disabled={z === null}
          onClick={() => z !== null && addSurfacePoint(pending, z)}
        >
          Adicionar ponto
        </button>
        <button
          type="button"
          className="btn btn--compact"
          onClick={() => useEarthworkStore.getState().clearPending()}
        >
          Descartar
        </button>
      </div>
    </div>
  );
}

function SelectedPoint({ terrain }: { terrain: Terrain }) {
  const index = useEarthworkStore((s) => s.pointIndex);
  const point = index !== null ? terrain.points[index] : undefined;
  if (!point) return null;
  return (
    <div className="terrain__token" data-testid="earthwork-selected-point">
      <NumberInput
        label="X (m)"
        value={point.x}
        digits={4}
        testId="earthwork-point-x"
        onCommit={(x) => x !== null && updateSurfacePoint({ ...point, x })}
      />
      <NumberInput
        label="Y (m)"
        value={point.y}
        digits={4}
        testId="earthwork-point-y"
        onCommit={(y) => y !== null && updateSurfacePoint({ ...point, y })}
      />
      <NumberInput
        label="Cota Z (m)"
        value={point.z}
        digits={4}
        testId="earthwork-point-z"
        onCommit={(z) => z !== null && updateSurfacePoint({ ...point, z })}
      />
      <div className="terrain__actions">
        <ModeButton
          mode="point-move"
          label="Mover na planta"
          icon={<Move size={14} />}
          testId="earthwork-point-move"
          title="Clique a nova posição do ponto na planta (a cota é mantida)"
        />
        <button
          type="button"
          className="btn btn--compact"
          data-testid="earthwork-point-remove"
          title="Exclui o ponto e refaz a triangulação em volta"
          onClick={() => removeSurfacePoint()}
        >
          <Trash2 size={14} /> Excluir
        </button>
      </div>
    </div>
  );
}

function EditTab({ terrain }: { terrain: Terrain }) {
  const stats = terrainStats(terrain);
  const mode = useTerrainStore((s) => s.mode);
  return (
    <>
      <section className="terrain__section" data-testid="earthwork-edit-surface">
        <h4>Superfície</h4>
        <Row label="Nome">{terrain.name}</Row>
        <Row label="Vértices · triângulos" testId="earthwork-surface-counts">
          {stats.vertexCount.toLocaleString('pt-BR')} ·{' '}
          {stats.triangleCount.toLocaleString('pt-BR')}
        </Row>
        <Row label="Situação" testId="earthwork-surface-state">
          {terrain.original
            ? `editada (original guardada: ${terrain.original.points.length.toLocaleString('pt-BR')} vértices)`
            : 'como importada'}
        </Row>
        <div className="terrain__actions">
          <ModeButton
            mode="pick"
            label="Selecionar na planta"
            icon={<MapPin size={14} />}
            testId="earthwork-pick"
            title="Clique a superfície ou um platô na planta para ver as propriedades no painel à direita"
          />
          <button
            type="button"
            className="btn btn--compact"
            data-testid="earthwork-select-surface"
            onClick={() => useEarthworkStore.getState().select({ kind: 'surface' })}
          >
            Propriedades da superfície
          </button>
        </div>
      </section>
      <section className="terrain__section" data-testid="earthwork-edit-points">
        <h4>Pontos cotados</h4>
        <div className="terrain__actions">
          <ModeButton
            mode="point-add"
            label="Adicionar"
            icon={<MapPin size={14} />}
            testId="earthwork-point-add"
            title="Clique a posição do novo ponto na planta e confirme a cota"
          />
          <ModeButton
            mode="point-edit"
            label="Editar / mover / excluir"
            icon={<PenLine size={14} />}
            testId="earthwork-point-edit"
            title="Clique um ponto da superfície para alterar a cota, a posição ou excluí-lo"
          />
        </div>
        {(mode === 'point-add' || mode === 'point-edit' || mode === 'point-move') && (
          <p className="muted">
            Os pontos da superfície aparecem na planta. A triangulação é refeita a cada alteração de
            posição; trocar só a cota não muda a malha.
          </p>
        )}
        <PendingPoint terrain={terrain} />
        <SelectedPoint terrain={terrain} />
      </section>
      <section className="terrain__section" data-testid="earthwork-edit-boundary">
        <h4>Limite e triangulação</h4>
        <div className="terrain__actions">
          <ModeButton
            mode="boundary"
            label="Redesenhar limite"
            icon={<Hexagon size={14} />}
            testId="earthwork-boundary"
            title="Desenhe o novo limite dentro da superfície; ele é cotado pela triangulação atual"
          />
          <FinishDraft />
          <button
            type="button"
            className="btn btn--compact"
            data-testid="earthwork-retriangulate"
            title="Refaz a triangulação com os pontos, o limite e as linhas de quebra atuais"
            onClick={() => retriangulateSurface()}
          >
            <RefreshCw size={14} /> Regenerar triangulação
          </button>
          <button
            type="button"
            className="btn btn--compact"
            data-testid="earthwork-restore"
            disabled={!terrain.original}
            title={
              terrain.original
                ? 'Volta à superfície como foi importada (as edições podem ser recuperadas com Desfazer)'
                : 'A superfície não foi editada'
            }
            onClick={() => restoreSurface()}
          >
            <RotateCcw size={14} /> Restaurar original
          </button>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Platôs
// ---------------------------------------------------------------------------

const slopeTitle =
  'Inclinação H:V — metros na horizontal por metro na vertical (1,5 = 1,5H:1V). A inclinação estável depende do solo: é definida pelo projetista.';

function PlatformsTab({ project, summary }: { project: Project; summary: EarthworkSummary }) {
  const draft = useEarthworkStore((s) => s.draft);
  const selection = useEarthworkStore((s) => s.selection);
  const redrawId = useEarthworkStore((s) => s.redrawId);
  const { setDraft, select, startPlatform } = useEarthworkStore.getState();
  const selectedId = selection?.kind === 'platform' ? selection.id : null;
  return (
    <>
      <section className="terrain__section" data-testid="earthwork-platform-new">
        <h4>Novo platô</h4>
        <NumberInput
          label="Cota de implantação Z (m)"
          value={draft.elevation}
          placeholder="informe a cota"
          testId="earthwork-platform-elevation"
          onCommit={(elevation) => setDraft({ elevation })}
        />
        <NumberInput
          label="Talude de corte (H:V)"
          value={draft.cutSlope}
          title={slopeTitle}
          testId="earthwork-platform-cut"
          onCommit={(value) => value !== null && value > 0 && setDraft({ cutSlope: value })}
        />
        <NumberInput
          label="Talude de aterro (H:V)"
          value={draft.fillSlope}
          title={slopeTitle}
          testId="earthwork-platform-fill"
          onCommit={(value) => value !== null && value > 0 && setDraft({ fillSlope: value })}
        />
        <div className="terrain__actions">
          <ModeButton
            mode="platform"
            label={redrawId ? 'Redesenhando perímetro…' : 'Desenhar perímetro'}
            icon={<PenLine size={14} />}
            testId="earthwork-platform-draw"
            title="Clique os vértices do platô sobre o terreno; feche no primeiro ponto ou com Enter"
            onStart={() => startPlatform(null)}
          />
          <FinishDraft />
        </div>
      </section>
      <section className="terrain__section" data-testid="earthwork-platform-list">
        <h4>Platôs do projeto ({project.earthworks.platforms.length})</h4>
        {summary.platforms.length === 0 && (
          <p className="muted">
            Nenhum platô. Informe a cota, os taludes e desenhe o perímetro sobre o terreno.
          </p>
        )}
        {summary.platforms.map(({ platform, quantities, error, area }) => {
          const open = platform.id === selectedId;
          return (
            <div
              key={platform.id}
              className="terrain__token"
              data-testid="earthwork-platform-item"
              data-platform-id={platform.id}
              data-selected={open}
            >
              <div className="terrain__row">
                <button
                  type="button"
                  className={open ? 'chip is-active' : 'chip'}
                  data-testid="earthwork-platform-select"
                  onClick={() => select(open ? null : { kind: 'platform', id: platform.id })}
                >
                  {platform.name}
                </button>
                <span className="terrain__value">
                  Z {formatMeters(platform.elevation, 2)} · {nf(area, 0)} m²
                </span>
              </div>
              {error ? (
                <span className="terrain__error" data-testid="earthwork-platform-error">
                  Não gerado: {error.message}
                </span>
              ) : (
                quantities && (
                  <span className="muted" data-testid="earthwork-platform-volumes">
                    corte {m3(quantities.cut)} · aterro {m3(quantities.fill)}
                  </span>
                )
              )}
              {open && (
                <>
                  <NumberInput
                    label="Cota de implantação Z (m)"
                    value={platform.elevation}
                    testId="earthwork-platform-edit-elevation"
                    onCommit={(elevation) =>
                      elevation !== null && changePlatform(platform.id, { elevation })
                    }
                  />
                  <NumberInput
                    label="Talude de corte (H:V)"
                    value={platform.cutSlope}
                    title={slopeTitle}
                    testId="earthwork-platform-edit-cut"
                    onCommit={(cutSlope) =>
                      cutSlope !== null && changePlatform(platform.id, { cutSlope })
                    }
                  />
                  <NumberInput
                    label="Talude de aterro (H:V)"
                    value={platform.fillSlope}
                    title={slopeTitle}
                    testId="earthwork-platform-edit-fill"
                    onCommit={(fillSlope) =>
                      fillSlope !== null && changePlatform(platform.id, { fillSlope })
                    }
                  />
                  <div className="terrain__actions">
                    <button
                      type="button"
                      className="btn btn--compact"
                      data-testid="earthwork-platform-redraw"
                      title="Desenha um novo perímetro para este platô (a cota e os taludes são mantidos)"
                      onClick={() => startPlatform(platform.id)}
                    >
                      <PenLine size={14} /> Redesenhar perímetro
                    </button>
                    <button
                      type="button"
                      className="btn btn--compact"
                      data-testid="earthwork-platform-remove"
                      onClick={() => deletePlatform(platform.id)}
                    >
                      <Trash2 size={14} /> Remover
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Corte / Aterro
// ---------------------------------------------------------------------------

export function CutFillLegend() {
  return (
    <div className="terrain__legend" data-testid="earthwork-legend">
      <span className="earthwork__swatch" style={{ background: CUT_COLOR }} /> corte
      <span className="earthwork__swatch" style={{ background: FILL_COLOR }} /> aterro
    </div>
  );
}

function ViewSwitch({ terrain }: { terrain: Terrain }) {
  const view = useEarthworkStore((s) => s.view);
  const views: SurfaceView[] = ['natural', 'design', 'compare'];
  if (terrain.original) views.push('original');
  return (
    <div className="terrain__tabs" role="radiogroup" aria-label="Superfície à mostra">
      {views.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={view === id}
          data-testid={`earthwork-view-${id}`}
          className={view === id ? 'chip is-active' : 'chip'}
          title={
            id === 'natural'
              ? 'Terreno natural, sem os platôs'
              : id === 'design'
                ? 'Terreno projetado: o natural modificado pelos platôs e taludes'
                : id === 'compare'
                  ? 'Terreno projetado com as regiões de corte e de aterro destacadas'
                  : 'Superfície como foi importada, antes das edições de pontos e de limite'
          }
          onClick={() => useEarthworkStore.getState().setView(id)}
        >
          {SURFACE_VIEW_LABELS[id]}
        </button>
      ))}
    </div>
  );
}

function CutFillTab({ terrain, summary }: { terrain: Terrain; summary: EarthworkSummary }) {
  const { total } = summary;
  return (
    <>
      <section className="terrain__section" data-testid="earthwork-cutfill-view">
        <h4>Superfície à mostra (planta e 3D)</h4>
        <ViewSwitch terrain={terrain} />
        <CutFillLegend />
        <p className="muted">
          A comparação é entre o terreno natural e o projetado. A linha em volta de cada platô é o
          encontro dos taludes com o terreno (crista do corte ou pé do aterro).
        </p>
      </section>
      <section className="terrain__section" data-testid="earthwork-cutfill-summary">
        <h4>Regiões</h4>
        <Row label="Área em corte" testId="earthwork-cut-area">
          {nf(total.cutArea, 1)} m²
        </Row>
        <Row label="Área em aterro" testId="earthwork-fill-area">
          {nf(total.fillArea, 1)} m²
        </Row>
        <Row label="Corte (in situ)" testId="earthwork-cut-volume">
          {m3(total.cut)}
        </Row>
        <Row label="Aterro (compactado)" testId="earthwork-fill-volume">
          {m3(total.fill)}
        </Row>
        {summary.design.failures.length > 0 && (
          <span className="terrain__error" data-testid="earthwork-failures">
            {summary.design.failures.length} platô(s) não gerado(s): veja a aba Platôs.
          </span>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Volumes
// ---------------------------------------------------------------------------

const QUANTITY_ROWS: [keyof EarthworkQuantities, string, string][] = [
  ['cut', 'Corte', 'in situ'],
  ['fill', 'Aterro', 'compactado'],
  ['loose', 'Escavado solto', 'solto'],
  ['reusable', 'Aproveitável', 'in situ'],
  ['fillFromCut', 'Aterro com material do corte', 'compactado'],
  ['balance', 'Saldo (+ sobra, − falta)', 'compactado'],
  ['borrow', 'Empréstimo', 'compactado'],
  ['borrowInSitu', 'Empréstimo na jazida', 'in situ'],
  ['surplus', 'Excedente (bota-fora)', 'in situ'],
  ['surplusLoose', 'Excedente a transportar', 'solto'],
];

function quantitiesCsv(project: Project, summary: EarthworkSummary): string {
  const columns = [
    ...summary.platforms.map((p) => ({ name: p.platform.name, q: p.quantities })),
    { name: 'Total', q: summary.total },
  ];
  const cell = (value: number | null | undefined): string =>
    value === null || value === undefined ? '' : value.toFixed(3).replace('.', ',');
  const { swellPercent, compactionFactor, reusePercent } = project.earthworks;
  const lines = [
    ['Quantidade (m³)', 'Estado', ...columns.map((c) => c.name)].join(';'),
    ...QUANTITY_ROWS.map(([key, label, state]) =>
      [label, state, ...columns.map((c) => cell(c.q?.[key]))].join(';'),
    ),
    '',
    `Empolamento (%);${cell(swellPercent)}`,
    `Fator de conversão (m³ de aterro compactado por m³ de corte in situ);${cell(compactionFactor)}`,
    `Aproveitamento do material escavado (%);${cell(reusePercent)}`,
  ];
  return `${lines.join('\r\n')}\r\n`;
}

function VolumesTab({ project, summary }: { project: Project; summary: EarthworkSummary }) {
  const { swellPercent, compactionFactor, reusePercent } = project.earthworks;
  const missing = swellPercent === null || compactionFactor === null || reusePercent === null;
  const columns = [
    ...summary.platforms.map((p) => ({
      id: p.platform.id,
      name: p.platform.name,
      q: p.quantities,
    })),
    { id: 'total', name: 'Total', q: summary.total as EarthworkQuantities | null },
  ];
  return (
    <>
      <section className="terrain__section" data-testid="earthwork-settings">
        <h4>Parâmetros do material</h4>
        <NumberInput
          label="Empolamento (%)"
          value={swellPercent}
          digits={2}
          placeholder="não informado"
          title="V solto = V corte in situ × (1 + empolamento ÷ 100)"
          testId="earthwork-swell"
          onCommit={(value) => changeEarthworkSettings({ swellPercent: value })}
        />
        <NumberInput
          label="Fator de conversão corte → aterro"
          value={compactionFactor}
          digits={3}
          placeholder="não informado"
          title="m³ de aterro COMPACTADO obtidos de 1 m³ de corte IN SITU (ex.: 0,90). Não é o grau de compactação."
          testId="earthwork-factor"
          onCommit={(value) => changeEarthworkSettings({ compactionFactor: value })}
        />
        <NumberInput
          label="Aproveitamento do material escavado (%)"
          value={reusePercent}
          digits={1}
          placeholder="não informado"
          title="Parcela do corte que serve para os aterros"
          testId="earthwork-reuse"
          onCommit={(value) => changeEarthworkSettings({ reusePercent: value })}
        />
        {missing && (
          <span className="terrain__warning" data-testid="earthwork-settings-missing">
            Informe os três parâmetros para o material solto, o balanço, o empréstimo e o excedente.
            Eles dependem do solo e não são presumidos.
          </span>
        )}
      </section>
      <section className="terrain__section" data-testid="earthwork-quantities">
        <h4>Quadro de quantitativos (m³)</h4>
        <div className="earthwork__table-wrap">
          <table className="earthwork__table" data-testid="earthwork-table">
            <thead>
              <tr>
                <th>Quantidade</th>
                {columns.map((c) => (
                  <th key={c.id}>{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {QUANTITY_ROWS.map(([key, label, state]) => (
                <tr key={key} data-row={key}>
                  <th title={`Volume ${state}`}>
                    {label} <small>({state})</small>
                  </th>
                  {columns.map((c) => {
                    const value = c.q ? (c.q[key] as number | null) : null;
                    return (
                      <td
                        key={c.id}
                        data-testid={`earthwork-q-${key}-${c.id === 'total' ? 'total' : 'platform'}`}
                      >
                        {value === null ? '—' : nf(value)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          Corte medido no terreno natural (in situ); aterro medido na geometria acabada
          (compactado). O balanço é feito em m³ compactados; volumes em estados diferentes não são
          somados sem conversão. O empréstimo na jazida supõe para ele o mesmo fator do corte.
        </p>
        <div className="terrain__actions">
          <button
            type="button"
            className="btn btn--compact"
            data-testid="earthwork-export-csv"
            disabled={summary.platforms.length === 0}
            onClick={() =>
              downloadText(
                `${projectFileBase(project)}-terraplenagem.csv`,
                quantitiesCsv(project, summary),
                'text/csv',
              )
            }
          >
            <Download size={14} /> CSV
          </button>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

export function EarthworkPanel() {
  const tab = useEarthworkStore((s) => s.tab);
  const project = useEditorStore((s) => s.project);
  const summary = useMemo(() => (tab ? projectEarthworks(project) : null), [tab, project]);
  if (!tab) return null;
  const { terrain } = project;
  return (
    <aside className="terrain earthwork" data-testid="earthwork-panel" aria-label="Terraplenagem">
      <header className="terrain__header">
        <strong>
          <Shovel size={15} /> Terreno e terraplenagem
        </strong>
        <button
          type="button"
          className="btn btn--icon"
          data-testid="earthwork-panel-close"
          aria-label="Fechar o painel de terraplenagem"
          onClick={() => useEarthworkStore.getState().close()}
        >
          <X size={14} />
        </button>
      </header>
      <div className="terrain__body">
        <div className="terrain__tabs earthwork__tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              data-testid={`earthwork-tab-${id}`}
              className={tab === id ? 'chip is-active' : 'chip'}
              onClick={() => useEarthworkStore.getState().open(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {!terrain || !summary ? (
          <p className="muted" data-testid="earthwork-no-terrain">
            O projeto ainda não tem superfície de terreno. Gere-a em Modelagem › Terreno ›
            Superfície, a partir de um DEM, de um GeoTIFF ou de um levantamento.
          </p>
        ) : (
          <>
            {tab === 'edit' && <EditTab terrain={terrain} />}
            {tab === 'platforms' && <PlatformsTab project={project} summary={summary} />}
            {tab === 'cutfill' && <CutFillTab terrain={terrain} summary={summary} />}
            {tab === 'volumes' && <VolumesTab project={project} summary={summary} />}
          </>
        )}
      </div>
    </aside>
  );
}
