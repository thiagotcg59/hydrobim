import {
  defaultSectionBox,
  degToRad,
  DETAIL_KIND_LABELS,
  DRAWING_SCALES,
  ELEVATION_DIRECTIONS,
  ELEVATION_LABELS,
  isView2d,
  radToDeg,
  VIEW_CATEGORIES,
  VIEW_KIND_LABELS,
  type ElevationDirection,
  type ModelProjectView,
  type Point2,
  type ProjectView,
  type ProjectView2d,
  type Vec3,
  type ViewCategory,
  type ViewDetail,
} from '@hydrobim/core';
import { Copy, Crop, Focus, FolderOpen, Move, Scissors, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DIMENSION_MODE_LABELS } from '../plan/AnnotationInspector';
import { useEditorStore } from '../state/editorStore';
import { NumberField, ReadOnlyRow, Section, SelectField, TextField } from '../ui/fields';
import { captureCamera, currentViewOf, openView2dOf, useViewStore } from './viewStore';

/**
 * Painel "Vista": configuração da vista de projeto em uso (ou do corte selecionado pelo
 * marcador) e edição do detalhe 2D selecionado. Cada campo chama uma operação do núcleo; a
 * configuração é independente por vista e entra no histórico de desfazer/refazer.
 */

const CATEGORY_LABELS: Record<ViewCategory, string> = {
  pipes: 'Tubos',
  fittings: 'Conexões',
  valves: 'Válvulas',
  equipment: 'Equipamentos (bombas)',
  tanks: 'Reservatórios',
  walls: 'Paredes',
  floors: 'Pisos e lajes',
  doors: 'Portas',
  windows: 'Janelas',
  spaces: 'Ambientes',
  roofs: 'Telhados',
  ifcModels: 'Modelos IFC importados',
};

function Check({
  label,
  checked,
  onChange,
  testId,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId?: string;
  title?: string;
}) {
  return (
    <label className="viewpanel__check" title={title}>
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

/** Deslocamento numérico para mover ou copiar os detalhes selecionados. */
function OffsetTools() {
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const views = useViewStore.getState();
  const delta = { x: dx, y: dy };
  return (
    <Section title="Mover e copiar" testId="detail-offset">
      <div className="viewpanel__pair">
        <NumberField label="ΔX" value={dx} onCommit={setDx} unit="m" testId="detail-dx" />
        <NumberField label="ΔY" value={dy} onCommit={setDy} unit="m" testId="detail-dy" />
      </div>
      <div className="viewpanel__actions">
        <button
          type="button"
          className="btn btn--compact"
          data-testid="detail-move"
          title="Desloca os detalhes selecionados (também: arrastar na vista ou as setas do teclado)"
          onClick={() => views.moveDetails(delta)}
        >
          <Move size={14} aria-hidden /> Mover
        </button>
        <button
          type="button"
          className="btn btn--compact"
          data-testid="detail-copy"
          title="Copia os detalhes selecionados com o deslocamento (também: Ctrl + arrastar na vista)"
          onClick={() => views.copyDetails(delta)}
        >
          <Copy size={14} aria-hidden /> Copiar
        </button>
        <button
          type="button"
          className="btn btn--compact"
          data-testid="detail-delete"
          title="Exclui os detalhes selecionados (Del)"
          onClick={() => views.deleteDetails()}
        >
          <Trash2 size={14} aria-hidden /> Excluir
        </button>
      </div>
    </Section>
  );
}

function PointFields({
  label,
  point,
  onCommit,
  testId,
}: {
  label: string;
  point: Point2;
  onCommit: (point: Point2) => void;
  testId: string;
}) {
  return (
    <div className="viewpanel__pair">
      <NumberField
        label={`${label} X`}
        value={point.x}
        unit="m"
        testId={`${testId}-x`}
        onCommit={(x) => onCommit({ x, y: point.y })}
      />
      <NumberField
        label={`${label} Y`}
        value={point.y}
        unit="m"
        testId={`${testId}-y`}
        onCommit={(y) => onCommit({ x: point.x, y })}
      />
    </div>
  );
}

function DetailText({
  detail,
  focus,
}: {
  detail: Extract<ViewDetail, { kind: 'text' }>;
  focus: boolean;
}) {
  const [text, setText] = useState(detail.text);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(detail.text), [detail.id, detail.text]);
  useEffect(() => {
    if (!focus) return;
    field.current?.focus();
    field.current?.select();
  }, [focus, detail.id]);
  const commit = (): void => {
    if (text === detail.text) return;
    if (!useViewStore.getState().changeDetail(detail.id, { text })) setText(detail.text);
  };
  return (
    <label className="plan__field plan__field--block">
      <span>Conteúdo</span>
      <textarea
        ref={field}
        data-testid="detail-text-content"
        rows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) event.currentTarget.blur();
          event.stopPropagation();
        }}
      />
    </label>
  );
}

function DetailEditor({ detail }: { detail: ViewDetail }) {
  const focusDetail = useViewStore((s) => s.focusDetail);
  const change = useViewStore.getState().changeDetail;
  const id = detail.id;
  return (
    <Section title={`Detalhe · ${DETAIL_KIND_LABELS[detail.kind]}`} testId="detail-editor">
      <p className="viewpanel__note muted">
        Detalhe da vista: não é tubulação nem geometria do modelo e só aparece nesta vista.
      </p>
      {(detail.kind === 'line' || detail.kind === 'rect' || detail.kind === 'dimension') && (
        <>
          <PointFields
            label={detail.kind === 'rect' ? 'Canto 1' : 'Ponto 1'}
            point={detail.a}
            testId="detail-a"
            onCommit={(a) => change(id, { a })}
          />
          <PointFields
            label={detail.kind === 'rect' ? 'Canto 2' : 'Ponto 2'}
            point={detail.b}
            testId="detail-b"
            onCommit={(b) => change(id, { b })}
          />
        </>
      )}
      {detail.kind === 'line' && (
        <ReadOnlyRow
          label="Comprimento"
          value={`${Math.hypot(detail.b.x - detail.a.x, detail.b.y - detail.a.y).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} m`}
        />
      )}
      {detail.kind === 'rect' && (
        <div className="viewpanel__pair">
          <NumberField
            label="Largura"
            value={Math.abs(detail.b.x - detail.a.x)}
            unit="m"
            testId="detail-width"
            onCommit={(width) =>
              change(id, {
                b: {
                  x: detail.a.x + Math.sign(detail.b.x - detail.a.x || 1) * width,
                  y: detail.b.y,
                },
              })
            }
          />
          <NumberField
            label="Altura"
            value={Math.abs(detail.b.y - detail.a.y)}
            unit="m"
            testId="detail-height"
            onCommit={(height) =>
              change(id, {
                b: {
                  x: detail.b.x,
                  y: detail.a.y + Math.sign(detail.b.y - detail.a.y || 1) * height,
                },
              })
            }
          />
        </div>
      )}
      {detail.kind === 'circle' && (
        <>
          <PointFields
            label="Centro"
            point={detail.center}
            testId="detail-center"
            onCommit={(center) => change(id, { center })}
          />
          <NumberField
            label="Raio"
            value={detail.radius}
            unit="m"
            testId="detail-radius"
            onCommit={(radius) => change(id, { radius })}
          />
        </>
      )}
      {detail.kind === 'polyline' && (
        <>
          <ReadOnlyRow label="Vértices" value={detail.points.length} />
          <Check
            label="Fechada"
            checked={detail.closed}
            testId="detail-closed"
            onChange={(closed) => change(id, { closed })}
          />
          {detail.points.slice(0, 12).map((point, index) => (
            <PointFields
              key={index}
              label={`P${index + 1}`}
              point={point}
              testId={`detail-p${index}`}
              onCommit={(next) =>
                change(id, { points: detail.points.map((p, i) => (i === index ? next : p)) })
              }
            />
          ))}
        </>
      )}
      {detail.kind === 'text' && (
        <>
          <DetailText detail={detail} focus={focusDetail === id} />
          <PointFields
            label="Posição"
            point={detail.position}
            testId="detail-position"
            onCommit={(position) => change(id, { position })}
          />
          <NumberField
            label="Rotação"
            value={radToDeg(detail.rotation)}
            unit="°"
            digits={2}
            testId="detail-rotation"
            onCommit={(degrees) => change(id, { rotation: degToRad(degrees) })}
          />
        </>
      )}
      {detail.kind === 'dimension' && (
        <>
          <SelectField
            label="Tipo"
            value={detail.mode}
            testId="detail-mode"
            options={(['aligned', 'horizontal', 'vertical'] as const).map((mode) => ({
              value: mode,
              label: DIMENSION_MODE_LABELS[mode],
            }))}
            onChange={(mode) => change(id, { mode })}
          />
          <NumberField
            label="Afastamento"
            value={detail.offset}
            unit="m"
            testId="detail-offset-value"
            onCommit={(offset) => change(id, { offset })}
          />
        </>
      )}
    </Section>
  );
}

function VisibilitySection({ view }: { view: ProjectView }) {
  const systems = useEditorStore((s) => s.project.systems);
  const { change } = useViewStore.getState();
  const { visibility } = view;
  const toggle = <T extends string>(list: readonly T[], item: T, shown: boolean): T[] =>
    shown
      ? list.filter((other) => other !== item)
      : [...list.filter((other) => other !== item), item];
  return (
    <Section title="Visibilidade nesta vista" testId="view-visibility">
      <p className="viewpanel__note muted">
        Vale só para esta vista. Um sistema oculto no projeto (navegador) não aparece em nenhuma.
      </p>
      <span className="viewpanel__group">Categorias</span>
      {VIEW_CATEGORIES.map((category) => (
        <Check
          key={category}
          label={CATEGORY_LABELS[category]}
          testId={`view-category-${category}`}
          checked={!visibility.hiddenCategories.includes(category)}
          onChange={(shown) =>
            change(view.id, {
              visibility: {
                ...visibility,
                hiddenCategories: toggle(visibility.hiddenCategories, category, shown),
              },
            })
          }
        />
      ))}
      <span className="viewpanel__group">Sistemas</span>
      {systems.map((system) => (
        <Check
          key={system.id}
          label={system.visible === false ? `${system.name} (oculto no projeto)` : system.name}
          testId="view-system"
          checked={!visibility.hiddenSystemIds.includes(system.id)}
          onChange={(shown) =>
            change(view.id, {
              visibility: {
                ...visibility,
                hiddenSystemIds: toggle(visibility.hiddenSystemIds, system.id, shown),
              },
            })
          }
        />
      ))}
      {isView2d(view) && (
        <>
          <span className="viewpanel__group">Documentação</span>
          <Check
            label="Detalhes e marcadores de corte"
            testId="view-details-visible"
            checked={visibility.details}
            onChange={(details) => change(view.id, { visibility: { ...visibility, details } })}
          />
        </>
      )}
    </Section>
  );
}

function View2dSettings({ view }: { view: ProjectView2d }) {
  const levels = useEditorStore((s) => s.project.levels);
  const { change, toggleCrop, saveFrame } = useViewStore.getState();
  const open = useViewStore((s) => s.open2d === view.id);
  const scales = (DRAWING_SCALES as readonly number[]).includes(view.scale)
    ? [...DRAWING_SCALES]
    : [...DRAWING_SCALES, view.scale].sort((a, b) => a - b);
  const crop = view.crop;
  const setCrop = (patch: { min?: Partial<Point2>; max?: Partial<Point2> }): void => {
    if (!crop) return;
    change(view.id, {
      crop: { ...crop, min: { ...crop.min, ...patch.min }, max: { ...crop.max, ...patch.max } },
    });
  };
  return (
    <>
      <Section title="Escala e estilo gráfico" testId="view-graphics">
        <SelectField
          label="Escala"
          value={String(view.scale)}
          testId="view-scale"
          options={scales.map((scale) => ({ value: String(scale), label: `1:${scale}` }))}
          onChange={(value) => change(view.id, { scale: Number(value) })}
        />
        <SelectField
          label="Tema"
          value={view.style.theme}
          testId="view-theme"
          options={[
            { value: 'color', label: 'Colorido (cores do modelo)' },
            { value: 'mono', label: 'Preto e branco' },
          ]}
          onChange={(theme) => change(view.id, { style: { ...view.style, theme } })}
        />
        <Check
          label="Linhas finas na tela"
          testId="view-thin-lines"
          title="Traço de 1 px em qualquer zoom; desligado, valem as espessuras de papel da escala"
          checked={view.style.thinLines}
          onChange={(thinLines) => change(view.id, { style: { ...view.style, thinLines } })}
        />
      </Section>

      {view.kind === 'plan' && (
        <Section title="Nível e faixa de corte" testId="view-range">
          <SelectField
            label="Nível"
            value={view.levelId}
            testId="view-level"
            options={levels.map((level) => ({
              value: level.id,
              label: `${level.name} (${level.elevation.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} m)`,
            }))}
            onChange={(levelId) => change(view.id, { levelId })}
          />
          <NumberField
            label="Plano de corte acima do nível"
            value={view.cutHeight}
            unit="m"
            testId="view-cut-height"
            title="Altura do plano de corte em relação à cota do nível: acima dele nada é desenhado"
            onCommit={(cutHeight) => change(view.id, { cutHeight })}
          />
          <NumberField
            label="Plano de corte da arquitetura"
            value={view.archCutHeight}
            unit="m"
            testId="view-arch-cut-height"
            title="Altura, acima do nível, em que paredes, portas e janelas são cortadas (seção com traço forte e hachura). A rede continua visível até o topo da faixa."
            onCommit={(archCutHeight) => change(view.id, { archCutHeight })}
          />
          <p className="viewpanel__note muted" data-testid="view-arch-cut-note">
            A arquitetura é cortada nesta altura (nunca acima do topo da faixa); a rede continua
            visível até o plano de corte da faixa, para que a tubulação junto ao teto não suma.
          </p>
          <NumberField
            label="Profundidade abaixo do corte"
            value={view.depth}
            unit="m"
            testId="view-depth"
            title="Alcance da vista para baixo do plano de corte: além dele nada é desenhado"
            onCommit={(depth) => change(view.id, { depth })}
          />
          <NumberField
            label="Orientação (giro da vista)"
            value={radToDeg(view.rotation)}
            unit="°"
            digits={2}
            testId="view-rotation"
            title="Giro do eixo horizontal do desenho em relação a +X, anti-horário"
            onCommit={(degrees) => change(view.id, { rotation: degToRad(degrees) })}
          />
        </Section>
      )}

      {view.kind === 'section' && (
        <Section title="Linha, direção e profundidade" testId="view-section-line">
          <PointFields
            label="Início"
            point={view.a}
            testId="view-section-a"
            onCommit={(a) => change(view.id, { a })}
          />
          <PointFields
            label="Fim"
            point={view.b}
            testId="view-section-b"
            onCommit={(b) => change(view.id, { b })}
          />
          <NumberField
            label="Profundidade"
            value={view.depth}
            unit="m"
            testId="view-depth"
            title="Alcance da vista a partir da linha de corte"
            onCommit={(depth) => change(view.id, { depth })}
          />
          <div className="viewpanel__actions">
            <button
              type="button"
              className="btn btn--compact"
              data-testid="view-section-flip"
              title="Inverte o sentido do olhar: a vista passa a mostrar o outro lado da linha"
              onClick={() =>
                change(view.id, { side: view.side === 1 ? -1 : 1 }, 'Sentido do corte invertido.')
              }
            >
              <Scissors size={14} aria-hidden /> Inverter o sentido
            </button>
          </div>
        </Section>
      )}

      {view.kind === 'elevation' && (
        <Section title="Orientação" testId="view-elevation">
          <SelectField
            label="Fachada"
            value={view.direction}
            testId="view-direction"
            options={ELEVATION_DIRECTIONS.map((direction: ElevationDirection) => ({
              value: direction,
              label: `${ELEVATION_LABELS[direction]} (vista de fora)`,
            }))}
            onChange={(direction) => change(view.id, { direction })}
          />
        </Section>
      )}

      <Section title="Região de recorte" testId="view-crop">
        <Check
          label="Recortar a vista"
          testId="view-crop-enabled"
          title="Só o que está dentro do retângulo é desenhado; arraste as alças na vista"
          checked={crop?.enabled ?? false}
          onChange={() =>
            crop || open
              ? toggleCrop()
              : useEditorStore
                  .getState()
                  .notify('info', 'Abra a vista para definir a região de recorte.')
          }
        />
        {crop && (
          <>
            <div className="viewpanel__pair">
              <NumberField
                label="X mín."
                value={crop.min.x}
                unit="m"
                testId="view-crop-min-x"
                onCommit={(x) => setCrop({ min: { x } })}
              />
              <NumberField
                label="X máx."
                value={crop.max.x}
                unit="m"
                testId="view-crop-max-x"
                onCommit={(x) => setCrop({ max: { x } })}
              />
            </div>
            <div className="viewpanel__pair">
              <NumberField
                label="Y mín."
                value={crop.min.y}
                unit="m"
                testId="view-crop-min-y"
                onCommit={(y) => setCrop({ min: { y } })}
              />
              <NumberField
                label="Y máx."
                value={crop.max.y}
                unit="m"
                testId="view-crop-max-y"
                onCommit={(y) => setCrop({ max: { y } })}
              />
            </div>
          </>
        )}
      </Section>

      <Section title="Enquadramento" testId="view-frame">
        <ReadOnlyRow
          label="Salvo"
          value={
            view.frame
              ? `centro ${view.frame.center.x.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}; ${view.frame.center.y.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} · altura ${view.frame.height.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m`
              : 'não — a vista abre enquadrando o desenho'
          }
        />
        <div className="viewpanel__actions">
          <button
            type="button"
            className="btn btn--compact"
            data-testid="view-save-frame"
            disabled={!open}
            title={
              open
                ? 'Guarda o centro e a ampliação atuais: a vista reabre assim'
                : 'Abra a vista para salvar o enquadramento'
            }
            onClick={() => saveFrame()}
          >
            <Focus size={14} aria-hidden /> Salvar o atual
          </button>
          <button
            type="button"
            className="btn btn--compact"
            data-testid="view-clear-frame"
            disabled={!view.frame}
            onClick={() => change(view.id, { frame: null }, 'Enquadramento salvo removido.')}
          >
            Limpar
          </button>
        </div>
      </Section>
    </>
  );
}

function BoxFields({ view }: { view: ModelProjectView }) {
  const box = view.sectionBox;
  const { change } = useViewStore.getState();
  if (!box) return null;
  const set = (side: 'min' | 'max', axis: keyof Vec3, value: number): void => {
    change(view.id, { sectionBox: { ...box, [side]: { ...box[side], [axis]: value } } });
  };
  return (
    <>
      {(['x', 'y', 'z'] as const).map((axis) => (
        <div className="viewpanel__pair" key={axis}>
          <NumberField
            label={`${axis.toUpperCase()} mín.`}
            value={box.min[axis]}
            unit="m"
            testId={`section-box-min-${axis}`}
            onCommit={(value) => set('min', axis, value)}
          />
          <NumberField
            label={`${axis.toUpperCase()} máx.`}
            value={box.max[axis]}
            unit="m"
            testId={`section-box-max-${axis}`}
            onCommit={(value) => set('max', axis, value)}
          />
        </div>
      ))}
    </>
  );
}

function View3dSettings({ view }: { view: ModelProjectView }) {
  const { change, toggleSectionBox, openView } = useViewStore.getState();
  const open = useViewStore((s) => s.open3d === view.id);
  const camera = view.camera;
  return (
    <>
      <Section title="Câmera" testId="view-camera">
        <ReadOnlyRow
          label="Salva"
          value={
            camera
              ? camera.projection === 'orthographic'
                ? 'isométrica / ortográfica'
                : 'perspectiva'
              : 'não — a vista abre enquadrando o modelo'
          }
        />
        <div className="viewpanel__actions">
          <button
            type="button"
            className="btn btn--compact"
            data-testid="view-save-camera"
            disabled={!open}
            title={
              open
                ? 'Guarda a posição, a direção, a ampliação e a projeção atuais do Modelo 3D'
                : 'Abra a vista para salvar a câmera'
            }
            onClick={() => {
              const current = captureCamera();
              if (current) change(view.id, { camera: current }, `Câmera salva em "${view.name}".`);
              else
                useEditorStore
                  .getState()
                  .notify('info', 'Navegue no Modelo 3D antes de salvar a câmera da vista.');
            }}
          >
            <Focus size={14} aria-hidden /> Salvar a atual
          </button>
          <button
            type="button"
            className="btn btn--compact"
            data-testid="view-apply-camera"
            disabled={!camera}
            title="Leva o Modelo 3D de volta à câmera salva"
            onClick={() => openView(view.id)}
          >
            Aplicar
          </button>
        </div>
        <SelectField
          label="Estilo gráfico"
          value={view.display}
          testId="view-display"
          options={[
            { value: 'shaded', label: 'Sombreado' },
            { value: 'wireframe', label: 'Aramado' },
          ]}
          onChange={(display) => change(view.id, { display })}
        />
      </Section>
      <Section title="Caixa de corte" testId="view-section-box">
        <Check
          label="Cortar o modelo pela caixa"
          testId="section-box-enabled"
          title="Fora da caixa nada é desenhado; o modelo não é alterado"
          checked={view.sectionBox?.enabled ?? false}
          onChange={() => {
            if (open) toggleSectionBox();
            else {
              const box = view.sectionBox;
              change(view.id, {
                sectionBox: box
                  ? { ...box, enabled: !box.enabled }
                  : defaultSectionBox(useEditorStore.getState().project),
              });
            }
          }}
        />
        <BoxFields view={view} />
        {view.sectionBox && (
          <div className="viewpanel__actions">
            <button
              type="button"
              className="btn btn--compact"
              data-testid="section-box-fit"
              title="Volta a caixa à envoltória do modelo, com folga"
              onClick={() =>
                change(view.id, {
                  sectionBox: {
                    ...defaultSectionBox(useEditorStore.getState().project),
                    enabled: view.sectionBox?.enabled ?? true,
                  },
                })
              }
            >
              <Crop size={14} aria-hidden /> Ajustar ao modelo
            </button>
          </div>
        )}
      </Section>
    </>
  );
}

export function ViewPanel() {
  const project = useEditorStore((s) => s.project);
  const viewMode = useEditorStore((s) => s.viewMode);
  const open2d = useViewStore((s) => s.open2d);
  const open3d = useViewStore((s) => s.open3d);
  const marker = useViewStore((s) => s.marker);
  const detailSelection = useViewStore((s) => s.detailSelection);
  const store = useViewStore.getState();
  const view = currentViewOf(project, { open2d, open3d, marker }, viewMode);
  const sheet = openView2dOf(project, open2d);
  const details = sheet
    ? sheet.details.filter((detail) => detailSelection.includes(detail.id))
    : [];

  if (details.length > 0) {
    const [only] = details;
    return (
      <div className="viewpanel" data-testid="view-panel" data-mode="details">
        <header className="viewpanel__head">
          <strong>
            {details.length === 1 && only
              ? DETAIL_KIND_LABELS[only.kind]
              : `${details.length} detalhes selecionados`}
          </strong>
          <span className="muted">em {sheet?.name}</span>
        </header>
        {details.length === 1 && only && <DetailEditor detail={only} />}
        <OffsetTools />
      </div>
    );
  }

  if (!view) {
    return (
      <div className="viewpanel" data-testid="view-panel" data-mode="empty">
        <p className="viewpanel__note">
          Nenhuma vista salva em uso. A planta de trabalho e o Modelo 3D padrão não têm configuração
          própria.
        </p>
        <p className="viewpanel__note muted">
          Crie plantas por nível, cortes, elevações e vistas 3D em Visualizar › Vistas do projeto;
          elas ficam no navegador, em Vistas, e são gravadas com o projeto.
        </p>
      </div>
    );
  }

  const isOpen = view.id === open2d || view.id === open3d;
  return (
    <div
      className="viewpanel"
      data-testid="view-panel"
      data-mode="view"
      data-view-id={view.id}
      data-view-kind={view.kind}
    >
      <Section title={`${VIEW_KIND_LABELS[view.kind]} · identificação`} testId="view-identity">
        <TextField
          label="Nome"
          value={view.name}
          testId="view-name"
          onCommit={(name) => store.rename(view.id, name)}
        />
        <ReadOnlyRow label="Tipo" value={VIEW_KIND_LABELS[view.kind]} />
        <ReadOnlyRow label="Situação" value={isOpen ? 'aberta' : 'selecionada pelo marcador'} />
        <div className="viewpanel__actions">
          {!isOpen && (
            <button
              type="button"
              className="btn btn--compact"
              data-testid="view-open-selected"
              onClick={() => store.openView(view.id)}
            >
              <FolderOpen size={14} aria-hidden /> Abrir a vista
            </button>
          )}
          <button
            type="button"
            className="btn btn--compact"
            data-testid="view-panel-duplicate"
            onClick={() => store.duplicate(view.id)}
          >
            <Copy size={14} aria-hidden /> Duplicar
          </button>
          <button
            type="button"
            className="btn btn--compact"
            data-testid="view-panel-delete"
            title="Exclui a vista; o modelo não muda (Ctrl+Z desfaz)"
            onClick={() => store.remove(view.id)}
          >
            <Trash2 size={14} aria-hidden /> Excluir
          </button>
        </div>
      </Section>
      {isView2d(view) ? <View2dSettings view={view} /> : <View3dSettings view={view} />}
      <VisibilitySection view={view} />
    </div>
  );
}
