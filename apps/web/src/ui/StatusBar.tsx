import { formatMeters, validateProject } from '@hydrobim/core';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useEditorStore } from '../state/editorStore';
import { describeSnap } from '../editor/snapLabel';
import { TOOL_LABELS } from './labels';

export function StatusBar() {
  const cursor = useEditorStore((s) => s.cursor);
  const tool = useEditorStore((s) => s.tool);
  const anchor = useEditorStore((s) => s.anchor);
  const message = useEditorStore((s) => s.message);
  const project = useEditorStore((s) => s.project);
  const [open, setOpen] = useState(false);

  const issues = useMemo(() => validateProject(project), [project]);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;

  const mode =
    tool === 'pipe' ? (anchor ? 'aguardando ponto final' : 'aguardando ponto inicial') : 'pronto';

  return (
    <footer className="statusbar">
      <span className="statusbar__coords" data-testid="status-coords">
        {cursor
          ? `X ${formatMeters(cursor.point.x)}   Y ${formatMeters(cursor.point.y)}   Z ${formatMeters(cursor.point.z)}`
          : 'X —   Y —   Z —'}
      </span>
      <span className="statusbar__item" data-testid="status-snap">
        {cursor ? (cursor.note ?? describeSnap(project, cursor)) : '—'}
      </span>
      <span className="statusbar__item" data-testid="status-mode">
        {TOOL_LABELS[tool]}: {mode}
      </span>

      <span
        className={`statusbar__message statusbar__message--${message?.level ?? 'info'}`}
        data-testid="status-message"
        data-level={message?.level ?? 'none'}
        role="status"
        aria-live="polite"
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
          onClick={() => setOpen((value) => !value)}
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
          <div className="issues" data-testid="validation-list">
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
