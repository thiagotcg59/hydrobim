import { formatMeters, validateProject } from '@hydrobim/core';
import {
  AlertTriangle,
  ArrowUpToLine,
  CheckCircle2,
  Crosshair,
  Move3d,
  Ruler,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { getCommand } from '../commands/commands';
import { describeSnap } from '../editor/snapLabel';
import { drawElevationOf, isAnnotationTool, useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { TOOL_LABELS } from './labels';

/**
 * Barra de status: ferramenta ativa e o seu estado, captura de pontos, coordenadas do cursor,
 * unidades, mensagens da operação e acesso às pendências de validação. A instrução da
 * operação e os controles de referência ficam na barra junto da área de desenho.
 */
export function StatusBar() {
  const cursor = useEditorStore((s) => s.cursor);
  const tool = useEditorStore((s) => s.tool);
  const anchor = useEditorStore((s) => s.anchor);
  const message = useEditorStore((s) => s.message);
  const project = useEditorStore((s) => s.project);
  const drawZ = useEditorStore(drawElevationOf);
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
  const ToolIcon = getCommand(`tool.${tool}`).icon;
  const capture = cursor ? (cursor.note ?? describeSnap(project, cursor)) : '—';

  return (
    <footer className="statusbar">
      <span className="statusbar__tool" title="Ferramenta ativa e o que ela aguarda">
        <ToolIcon size={16} aria-hidden />
        <strong data-testid="status-mode">
          {TOOL_LABELS[tool]}: {mode}
        </strong>
      </span>

      <span
        className="statusbar__item statusbar__capture"
        title={`Captura de pontos: ${capture === '—' ? 'aponte para a área de desenho' : capture}`}
      >
        <Crosshair size={15} aria-hidden />
        <span data-testid="status-snap">{capture}</span>
      </span>

      <span className="statusbar__item" title="Coordenadas do cursor no modelo">
        <Move3d size={15} aria-hidden />
        <span className="statusbar__coords" data-testid="status-coords">
          {cursor
            ? `X ${formatMeters(cursor.point.x)}   Y ${formatMeters(cursor.point.y)}   Z ${formatMeters(cursor.point.z)}`
            : 'X —   Y —   Z —'}
        </span>
      </span>
      {modeling && (
        <span
          className="statusbar__item"
          data-testid="status-elevation"
          title="Cota em que os pontos da ferramenta são criados (nível + elevação do eixo)"
        >
          <ArrowUpToLine size={15} aria-hidden />
          Cota de desenho {formatMeters(drawZ, 2)}
        </span>
      )}
      <span
        className="statusbar__item"
        data-testid="status-units"
        title="Unidades de apresentação: comprimentos e coordenadas em metros, diâmetros e dimensões de peças em milímetros, ângulos em graus. Internamente o modelo usa metros e radianos."
      >
        <Ruler size={15} aria-hidden />
        Unidades: m · mm · °
      </span>

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
            <XCircle size={15} className="icon--error" />
          ) : warnings > 0 ? (
            <AlertTriangle size={15} className="icon--warning" />
          ) : (
            <CheckCircle2 size={15} className="icon--ok" />
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
