import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { ARCH_TOOL_LABELS, useArchStore } from './archStore';

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName);

/**
 * Entrada numérica do trecho em desenho (parede ou contorno): o valor digitado é o comprimento
 * a partir do último ponto, na direção do cursor. Digitar um número na planta leva o foco ao
 * campo. Enter (com o campo vazio) conclui o traçado; Backspace desfaz o último ponto.
 */
export function ArchLengthEntry() {
  const tool = useArchStore((s) => s.tool);
  const count = useArchStore((s) => s.points.length);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const drawing = tool !== null && tool !== 'door' && tool !== 'window';

  useEffect(() => {
    if (!drawing) return;
    const onKey = (event: KeyboardEvent): void => {
      if (isTyping(event.target) || useUiStore.getState().dialog !== null) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (useEditorStore.getState().viewMode !== 'plan') return;
      const arch = useArchStore.getState();
      if (event.key === 'Enter') {
        event.preventDefault();
        arch.finish();
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        arch.removeLastPoint();
      } else if (/^[0-9.,]$/.test(event.key)) {
        // O caractere digitado cai no campo, que passa a ter o foco. Os atalhos de ferramenta
        // não são letras numéricas, então nada mais é acionado.
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawing]);

  // Trecho confirmado ou traçado encerrado: o campo recomeça vazio.
  useEffect(() => setText(''), [count, tool]);

  if (!drawing || !tool) return null;
  return (
    <label
      className="arch-entry"
      data-testid="arch-entry"
      title="Comprimento do trecho, em metros, a partir do último ponto e na direção do cursor. Enter confirma; com o campo vazio, Enter conclui o traçado."
    >
      <span>
        {ARCH_TOOL_LABELS[tool]} · {count === 0 ? 'clique o 1º ponto' : 'comprimento'}
      </span>
      <input
        ref={inputRef}
        data-testid="arch-length-entry"
        type="text"
        inputMode="decimal"
        placeholder="m"
        value={text}
        disabled={count === 0}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          const arch = useArchStore.getState();
          if (event.key === 'Enter') {
            event.preventDefault();
            if (text.trim() === '') arch.finish();
            else if (arch.submitLength(text)) setText('');
          } else if (event.key === 'Escape') {
            // Esc no campo devolve o teclado à planta; o seguinte cancela o traçado.
            setText('');
            event.currentTarget.blur();
          }
          event.stopPropagation();
        }}
      />
      <span className="arch-entry__unit">m</span>
    </label>
  );
}
