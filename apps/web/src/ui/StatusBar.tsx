import { formatMeters, validateProject } from '@hydrobim/core';
import { AlertTriangle, CheckCircle2, Magnet, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { describeSnap } from '../editor/snapLabel';
import { drawElevationOf, isAnnotationTool, useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { PLAN_TOOL_HINTS, TOOL_HINTS, TOOL_LABELS } from './labels';

const PLAN_SELECT_HINT =
  'Clique para selecionar. Arraste o fundo para mover a vista, uma anotação para reposicioná-la e a alça de um tubo para esticá-lo. Setas: deslizam a peça na linha. Botão direito numa extremidade: criar tubo. Roda do mouse: zoom.';
const BIM_HINT =
  'Consulta BIM / IFC: selecione um elemento na vista ou na árvore para ver e completar as suas propriedades IFC. A modelagem fica suspensa nesta aba.';

/**
 * Barra de status: instrução da operação em andamento, coordenadas e elevação, estado da
 * captura e das restrições, mensagens e acesso às pendências de validação.
 */
export function StatusBar() {
  const cursor = useEditorStore((s) => s.cursor);
  const tool = useEditorStore((s) => s.tool);
  const anchor = useEditorStore((s) => s.anchor);
  const message = useEditorStore((s) => s.message);
  const project = useEditorStore((s) => s.project);
  const viewMode = useEditorStore((s) => s.viewMode);
  const drawZ = useEditorStore(drawElevationOf);
  const snapToGrid = useEditorStore((s) => s.snapToGrid);
  const gridStep = useEditorStore((s) => s.gridStep);
  const catalogOnly = useEditorStore((s) => s.toolOptions.lockElbowAngles);
  const open = useUiStore((s) => s.validationOpen);
  const setOpen = useUiStore((s) => s.setValidationOpen);
  const listRef = useRef<HTMLDivElement>(null);

  const issues = useMemo(() => validateProject(project), [project]);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;

  // Aberta por um comando (Análise › Pendências), a lista recebe o foco do teclado.
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  const mode =
    tool === 'pipe' ? (anchor ? 'aguardando ponto final' : 'aguardando ponto inicial') : 'pronto';
  const modeling = tool !== 'select' && !isAnnotationTool(tool);
  const instruction =
    viewMode === 'bim'
      ? BIM_HINT
      : viewMode === 'plan' && tool === 'select'
        ? PLAN_SELECT_HINT
        : ((viewMode === 'plan' ? PLAN_TOOL_HINTS[tool] : undefined) ?? TOOL_HINTS[tool]);

  return (
    <footer className="statusbar">
      <span className="statusbar__instruction" data-testid="status-instruction" title={instruction}>
        <strong data-testid="status-mode">
          {TOOL_LABELS[tool]}: {mode}
        </strong>
        <span>{instruction}</span>
      </span>

      <span className="statusbar__coords" data-testid="status-coords">
        {cursor
          ? `X ${formatMeters(cursor.point.x)}   Y ${formatMeters(cursor.point.y)}   Z ${formatMeters(cursor.point.z)}`
          : 'X —   Y —   Z —'}
      </span>
      {modeling && (
        <span
          className="statusbar__item"
          data-testid="status-elevation"
          title="Cota em que os pontos da ferramenta são criados (nível + elevação do eixo)"
        >
          Cota de desenho {formatMeters(drawZ, 2)}
        </span>
      )}
      <span className="statusbar__item" data-testid="status-snap">
        {cursor ? (cursor.note ?? describeSnap(project, cursor)) : '—'}
      </span>
      <button
        type="button"
        className={snapToGrid ? 'statusbar__button is-active' : 'statusbar__button'}
        data-testid="status-grid"
        aria-pressed={snapToGrid}
        title={`Ajustar à grade (passo ${formatMeters(gridStep, 2)}). O passo é escolhido nas opções da ferramenta.`}
        onClick={() => useEditorStore.getState().setSnapToGrid(!snapToGrid)}
      >
        <Magnet size={13} /> Grade {formatMeters(gridStep, 2)}
      </button>
      {modeling && (
        <span
          className="statusbar__item"
          data-testid="status-restriction"
          title="Restrição das peças criadas pela ferramenta; altere nas opções da ferramenta"
        >
          {catalogOnly ? 'Somente catálogo' : 'Peças genéricas permitidas'}
        </span>
      )}

      <span
        className={`statusbar__message statusbar__message--${message?.level ?? 'info'}`}
        data-testid="status-message"
        data-level={message?.level ?? 'none'}
        role="status"
        aria-live="polite"
        title={message?.text ?? ''}
      >
        {message?.text ?? ''}
      </span>

      <div className="statusbar__validation">
        <button
          type="button"
          className="statusbar__button"
          data-testid="validation-toggle"
          data-errors={errors}
          data-warnings={warnings}
          aria-expanded={open}
          title="Pendências de validação do modelo"
          onClick={() => setOpen(!open)}
        >
          {errors > 0 ? (
            <XCircle size={14} className="icon--error" />
          ) : warnings > 0 ? (
            <AlertTriangle size={14} className="icon--warning" />
          ) : (
            <CheckCircle2 size={14} className="icon--ok" />
          )}
          {issues.length === 0 ? 'Modelo consistente' : `${errors} erro(s), ${warnings} aviso(s)`}
        </button>
        {open && (
          <div className="issues" data-testid="validation-list" ref={listRef} tabIndex={-1}>
            {issues.length === 0 && <span className="muted">Nenhuma pendência de validação.</span>}
            {issues.map((issue, index) => (
              <button
                key={`${issue.code}-${index}`}
                type="button"
                className={`issue issue--${issue.severity}`}
                onClick={() => {
                  const first = issue.elementIds[0];
                  if (first) useEditorStore.getState().select(first);
                }}
              >
                <strong>{issue.severity === 'error' ? 'Erro' : 'Aviso'}</strong> {issue.message}
              </button>
            ))}
          </div>
        )}
      </div>
    </footer>
  );
}
