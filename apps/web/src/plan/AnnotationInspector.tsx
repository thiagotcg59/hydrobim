import {
  degToRad,
  dimensionGeometry,
  formatDimension,
  getAnnotation,
  getElement,
  radToDeg,
  tagText,
  type DimensionMode,
} from '@hydrobim/core';
import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../state/editorStore';

export const DIMENSION_MODE_LABELS: Record<DimensionMode, string> = {
  aligned: 'Alinhada',
  horizontal: 'Horizontal (ΔX)',
  vertical: 'Vertical (ΔY)',
};

interface Props {
  /** Anotação recém-criada cujo texto deve receber o foco. */
  focusId: string | null;
}

/** Propriedades da anotação selecionada na planta. */
export function AnnotationInspector({ focusId }: Props) {
  const id = useEditorStore((s) => s.annotationSelection);
  const project = useEditorStore((s) => s.project);
  const annotation = id ? getAnnotation(project, id) : undefined;
  const { changeAnnotation, deleteSelected } = useEditorStore.getState();

  const sourceText = annotation?.kind === 'text' ? annotation.text : '';
  const sourceRotation = annotation?.kind === 'text' ? radToDeg(annotation.rotation) : 0;
  const [text, setText] = useState(sourceText);
  const [rotation, setRotation] = useState(String(sourceRotation));
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setText(sourceText);
    setRotation(String(Math.round(sourceRotation * 100) / 100));
  }, [id, sourceText, sourceRotation]);
  useEffect(() => {
    if (id && id === focusId) {
      field.current?.focus();
      field.current?.select();
    }
  }, [id, focusId]);

  if (!annotation) return null;

  const commitText = (): void => {
    if (annotation.kind !== 'text' || text === annotation.text) return;
    if (!changeAnnotation(annotation.id, { text })) setText(annotation.text);
  };
  const commitRotation = (): void => {
    if (annotation.kind !== 'text') return;
    const value = Number(rotation.replace(',', '.'));
    if (!Number.isFinite(value)) {
      setRotation(String(sourceRotation));
      return;
    }
    if (Math.abs(value - sourceRotation) > 1e-9) {
      changeAnnotation(annotation.id, { rotation: degToRad(value) });
    }
  };

  const title =
    annotation.kind === 'dimension'
      ? 'Cota'
      : annotation.kind === 'tag'
        ? 'Etiqueta'
        : annotation.leader
          ? 'Chamada'
          : 'Texto';
  const element = annotation.kind === 'tag' ? getElement(project, annotation.elementId) : undefined;

  return (
    <aside
      className="plan__inspector"
      aria-label="Propriedades da anotação"
      data-testid="annotation-inspector"
    >
      <header>
        <strong>{title}</strong>
        <button
          type="button"
          className="btn btn--icon btn--danger"
          data-testid="annotation-delete"
          title="Excluir anotação (Delete)"
          aria-label="Excluir anotação"
          onClick={deleteSelected}
        >
          <Trash2 size={15} />
        </button>
      </header>

      {annotation.kind === 'dimension' && (
        <>
          <label className="plan__field">
            <span>Tipo</span>
            <select
              data-testid="annotation-dimension-mode"
              value={annotation.mode}
              onChange={(event) =>
                changeAnnotation(annotation.id, { mode: event.target.value as DimensionMode })
              }
            >
              {(Object.keys(DIMENSION_MODE_LABELS) as DimensionMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {DIMENSION_MODE_LABELS[mode]}
                </option>
              ))}
            </select>
          </label>
          <p className="muted" data-testid="annotation-dimension-value">
            Valor medido: {formatDimension(dimensionGeometry(annotation)?.value ?? 0)} m
          </p>
          <p className="muted">Arraste a cota para reposicionar a linha.</p>
        </>
      )}

      {annotation.kind === 'text' && (
        <>
          <label className="plan__field plan__field--block">
            <span>Texto</span>
            <textarea
              ref={field}
              data-testid="annotation-text"
              rows={3}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onBlur={commitText}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
          <p className="muted">Enter confirma; Shift+Enter quebra a linha.</p>
          <label className="plan__field">
            <span>Rotação (°)</span>
            <input
              data-testid="annotation-rotation"
              inputMode="decimal"
              value={rotation}
              onChange={(event) => setRotation(event.target.value)}
              onBlur={commitRotation}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
          </label>
        </>
      )}

      {annotation.kind === 'tag' && (
        <p className="muted" data-testid="annotation-tag-text">
          {element ? tagText(element) : 'Elemento inexistente.'}
          <br />O conteúdo acompanha o elemento (designação e comprimento).
        </p>
      )}
    </aside>
  );
}
