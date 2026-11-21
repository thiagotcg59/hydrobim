import { formatMeters } from '@hydrobim/core';
import { Check, Info } from 'lucide-react';
import { isAnnotationTool, useEditorStore } from '../state/editorStore';
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

/**
 * Barra de referências, junto da área de desenho: o que o cursor captura ao desenhar (grade,
 * extremidades, eixos) e a instrução da operação em andamento. A grade é a única captura que
 * se liga e desliga; as demais são mostradas como estão — sempre ativas ou ainda previstas.
 */
export function ReferenceBar() {
  const tool = useEditorStore((s) => s.tool);
  const viewMode = useEditorStore((s) => s.viewMode);
  const snapToGrid = useEditorStore((s) => s.snapToGrid);
  const gridStep = useEditorStore((s) => s.gridStep);
  const catalogOnly = useEditorStore((s) => s.toolOptions.lockElbowAngles);
  const walking = useUiStore((s) => s.bimWalk);
  const modeling = tool !== 'select' && !isAnnotationTool(tool);
  const steps = GRID_STEPS.includes(gridStep)
    ? GRID_STEPS
    : [...GRID_STEPS, gridStep].sort((a, b) => a - b);
  const instruction =
    viewMode === 'bim'
      ? walking
        ? WALK_HINT
        : BIM_HINT
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
          title={`${label}: captura prevista no roadmap (núcleo testado, ainda não ligado às vistas).`}
        >
          {label} <span className="badge">previsto</span>
        </span>
      ))}
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
