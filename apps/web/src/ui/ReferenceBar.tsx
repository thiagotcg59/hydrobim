import { formatMeters } from '@hydrobim/core';
import { Check, ChevronUp, Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ARCH_TOOL_HINTS, useArchStore } from '../arch/archStore';
import { SNAP_TOGGLE_LABELS, SNAP_TOGGLES } from '../editor/planSnaps';
import { isAnnotationTool, useEditorStore } from '../state/editorStore';
import { useSnapStore } from '../state/snapStore';
import { useUiStore } from '../state/uiStore';
import { PLAN_TOOL_HINTS, TOOL_HINTS } from './labels';

const PLAN_SELECT_HINT =
  'Clique para selecionar. Arraste o fundo para mover a vista, uma anotação para reposicioná-la e a alça de um tubo para esticá-lo. Setas: deslizam a peça na linha. Botão direito numa extremidade: criar tubo. Roda do mouse: zoom.';
const BIM_HINT =
  'Consulta BIM / IFC: selecione um elemento na vista ou na árvore para ver e completar as suas propriedades IFC. A modelagem fica suspensa nesta aba.';
const WALK_HINT =
  'Percurso: W A S D andam, E e Q sobem e descem a vista, arraste para olhar (F trava o mouse), Shift corre, a roda muda a velocidade. Clique em um elemento para ver as propriedades IFC.';

const GRID_STEPS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 5, 10];

/** Capturas que as ferramentas de traçado aplicam sempre, nas duas vistas. */
const ALWAYS_ON = [
  {
    label: 'Extremidades',
    title: 'Extremidades livres de tubos, conexões e equipamentos: sempre capturadas.',
  },
  {
    label: 'Sobre o tubo',
    title: 'Ponto sobre o eixo de um tubo: o tê é inserido automaticamente. Sempre capturado.',
  },
] as const;

/** Capturas com o núcleo pronto e testado, ainda não ligadas às vistas (ver o roadmap). */
const PLANNED = ['Ponto médio', 'Alinhamento'] as const;

const ARCH_SELECT_HINT =
  'Arquitetura: clique para selecionar; arraste a alça de uma extremidade de parede ou de um canto de telhado para editá-los; duplo clique em laje, piso, ambiente ou telhado edita o contorno. Mover, Copiar, Girar e Espelhar pedem os pontos na planta.';
const ARCH_TRANSFORM_HINT =
  'Indique os pontos de referência na planta: as capturas valem (Tab alterna as sobrepostas, R fixa a aresta de referência, Shift trava de 45° em 45°). A prévia em verde é o resultado; Esc volta um ponto.';
const ARCH_CONTOUR_HINT =
  'Editar contorno: arraste os vértices; o ponto no meio de um lado cria um vértice; Del remove o selecionado. Concluir (Enter) grava em um passo; Cancelar (Esc) não altera o modelo.';

/**
 * Capturas de desenho da arquitetura: um botão compacto com a contagem das ligadas e, ao abrir,
 * a lista com o liga/desliga e a descrição de cada uma. A lista abre para cima, em posição
 * fixa, porque a barra recorta o que passa dela.
 */
function SnapMenu() {
  const snaps = useSnapStore((s) => s.snaps);
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const on = SNAP_TOGGLES.filter((toggle) => snaps[toggle]).length;

  useEffect(() => {
    if (!anchor) return;
    const onPointer = (event: PointerEvent): void => {
      if (!(event.target instanceof Element && event.target.closest('[data-snap-menu]'))) {
        setAnchor(null);
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // Esc fecha só a lista: a operação em andamento na planta continua.
      event.stopImmediatePropagation();
      setAnchor(null);
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [anchor]);

  return (
    <>
      <button
        type="button"
        className={on > 0 ? 'chip is-active' : 'chip'}
        data-testid="snap-menu"
        data-snap-menu
        data-on={on}
        aria-haspopup="true"
        aria-expanded={anchor !== null}
        title="Capturas de desenho da arquitetura (extremidade, meio, interseção, perpendicular, paralela, ortogonal, alinhamento, sobre a aresta): abre a lista para ligar e desligar cada uma"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchor(anchor ? null : { left: rect.left, bottom: window.innerHeight - rect.top + 4 });
        }}
      >
        Capturas {on}/{SNAP_TOGGLES.length}
        <ChevronUp size={12} aria-hidden />
      </button>
      {anchor && (
        <div
          className="snapmenu"
          data-snap-menu
          data-testid="snap-toggles"
          role="group"
          aria-label="Capturas"
          style={{ left: anchor.left, bottom: anchor.bottom }}
        >
          {SNAP_TOGGLES.map((toggle) => (
            <label key={toggle} className="snapmenu__item">
              <input
                type="checkbox"
                data-testid={`snap-toggle-${toggle}`}
                checked={snaps[toggle]}
                onChange={(event) => useSnapStore.getState().setSnap(toggle, event.target.checked)}
              />
              <span>
                <strong>{SNAP_TOGGLE_LABELS[toggle].label}</strong>
                <small>{SNAP_TOGGLE_LABELS[toggle].title}</small>
              </span>
            </label>
          ))}
          <p className="snapmenu__note">
            Tab alterna entre capturas sobrepostas; R fixa a aresta de referência; Shift trava de
            45° em 45°.
          </p>
        </div>
      )}
    </>
  );
}

/**
 * Barra de referências, junto da área de desenho: o que o cursor captura ao desenhar e a
 * instrução da operação em andamento. Na rede hidráulica só a grade se liga e desliga (as
 * demais capturas são fixas ou ainda previstas); na arquitetura cada captura tem o seu
 * liga/desliga (menu "Capturas"), além do filtro de nível da planta de trabalho.
 */
export function ReferenceBar() {
  const tool = useEditorStore((s) => s.tool);
  const viewMode = useEditorStore((s) => s.viewMode);
  const snapToGrid = useEditorStore((s) => s.snapToGrid);
  const gridStep = useEditorStore((s) => s.gridStep);
  const catalogOnly = useEditorStore((s) => s.toolOptions.lockElbowAngles);
  const walking = useUiStore((s) => s.bimWalk);
  const architecture = useEditorStore((s) => s.project.discipline === 'architecture');
  const archTool = useArchStore((s) => s.tool);
  const archTransform = useArchStore((s) => s.transform !== null);
  const archContour = useArchStore((s) => s.contour !== null);
  const activeLevelOnly = useSnapStore((s) => s.activeLevelOnly);
  // As capturas da arquitetura aparecem no ambiente Arquitetura e durante as operações dela.
  const archSnaps =
    viewMode !== 'bim' && (architecture || archTool || archTransform || archContour);
  const modeling = tool !== 'select' && !isAnnotationTool(tool);
  const steps = GRID_STEPS.includes(gridStep)
    ? GRID_STEPS
    : [...GRID_STEPS, gridStep].sort((a, b) => a - b);
  const instruction =
    viewMode === 'bim'
      ? walking
        ? WALK_HINT
        : BIM_HINT
      : archContour
        ? ARCH_CONTOUR_HINT
        : archTransform
          ? ARCH_TRANSFORM_HINT
          : archTool
            ? ARCH_TOOL_HINTS[archTool]
            : viewMode === 'plan' && tool === 'select' && architecture
              ? ARCH_SELECT_HINT
              : viewMode === 'plan' && tool === 'select'
                ? PLAN_SELECT_HINT
                : ((viewMode === 'plan' ? PLAN_TOOL_HINTS[tool] : undefined) ?? TOOL_HINTS[tool]);

  return (
    <div className="refbar" data-testid="reference-bar" role="group" aria-label="Referências">
      <strong className="refbar__title">Referências</strong>
      <button
        type="button"
        role="switch"
        className={snapToGrid ? 'switch is-on' : 'switch'}
        data-testid="status-grid"
        aria-checked={snapToGrid}
        aria-pressed={snapToGrid}
        title={`Ajustar à grade (passo ${formatMeters(gridStep, 2)}): os pontos clicados caem nos nós da grade.`}
        onClick={() => useEditorStore.getState().setSnapToGrid(!snapToGrid)}
      >
        <span className="switch__track" aria-hidden>
          <span className="switch__thumb" />
        </span>
        Grade {formatMeters(gridStep, 2)}
      </button>
      <label className="refbar__step" title="Passo da grade de captura">
        <span className="visually-hidden">Passo da grade</span>
        <select
          data-testid="reference-grid-step"
          value={String(gridStep)}
          disabled={!snapToGrid}
          onChange={(event) => useEditorStore.getState().setGridStep(Number(event.target.value))}
        >
          {steps.map((step) => (
            <option key={step} value={String(step)}>
              {formatMeters(step, 2)}
            </option>
          ))}
        </select>
      </label>
      {archSnaps ? (
        <span className="refbar__snaps">
          <SnapMenu />
          <button
            type="button"
            className={activeLevelOnly ? 'chip is-active' : 'chip'}
            data-testid="arch-level-filter"
            aria-pressed={activeLevelOnly}
            title="Planta de trabalho: desenhar, selecionar e capturar só a arquitetura do nível do plano de trabalho. Desligado, todos os níveis ficam sobrepostos."
            onClick={() => useSnapStore.getState().setActiveLevelOnly(!activeLevelOnly)}
          >
            {activeLevelOnly && <Check size={12} aria-hidden />}
            Só o nível ativo
          </button>
        </span>
      ) : (
        <>
          {ALWAYS_ON.map((item) => (
            <span key={item.label} className="refbar__fixed" title={item.title}>
              <Check size={13} aria-hidden />
              {item.label}
            </span>
          ))}
          {PLANNED.map((label) => (
            <span
              key={label}
              className="refbar__planned"
              aria-disabled
              title={`${label}: captura prevista no roadmap para a rede (núcleo testado, ainda não ligado às vistas); na arquitetura já está disponível.`}
            >
              {label} <span className="badge">previsto</span>
            </span>
          ))}
        </>
      )}
      {modeling && (
        <span
          className="refbar__fixed"
          data-testid="status-restriction"
          title="Restrição das peças criadas pela ferramenta; altere nas opções da ferramenta"
        >
          {catalogOnly ? 'Somente catálogo' : 'Peças genéricas permitidas'}
        </span>
      )}
      <span className="refbar__hint" data-testid="status-instruction" title={instruction}>
        <Info size={14} aria-hidden />
        <span>{instruction}</span>
      </span>
    </div>
  );
}
