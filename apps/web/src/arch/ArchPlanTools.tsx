import { Check, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { ARCH_TRANSFORM_LABELS, ARCH_TRANSFORM_STEPS } from './archEdit';
import { ARCH_TOOL_LABELS, isDrawingTool, useArchStore } from './archStore';

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName);

/**
 * Teclado e entrada numérica das operações de arquitetura na planta.
 *
 * - Desenho (parede, contornos, telhado) e mover/copiar/girar/espelhar: o campo recebe o valor
 *   exato do próximo ponto — comprimento na direção do cursor (com a captura de direção já
 *   aplicada), `comprimento<ângulo`, `@ΔX;ΔY`, `X;Y` ou, no girar, o ângulo em graus. Digitar
 *   um número na planta leva o foco ao campo.
 * - Enter (campo vazio) conclui o traçado ou o contorno em edição; Backspace desfaz o último
 *   ponto; Tab alterna entre capturas sobrepostas; R fixa ou solta a aresta de referência; Del
 *   remove o vértice selecionado do contorno em edição.
 * - Editar contorno: barra com Concluir e Cancelar.
 * - Aparar, alinhar e dividir: só o Tab, que alterna entre arestas sobrepostas no alinhar.
 */
export function ArchLengthEntry() {
  const tool = useArchStore((s) => s.tool);
  const count = useArchStore((s) => s.points.length);
  const transform = useArchStore((s) => s.transform);
  const contour = useArchStore((s) => s.contour !== null);
  const modifying = useArchStore((s) => s.modify !== null);
  const rectangular = useArchStore((s) => s.contour?.rectangular ?? false);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const drawing = isDrawingTool(tool);
  const entering = drawing || transform !== null;
  const active = entering || contour || modifying;
  const steps = transform ? ARCH_TRANSFORM_STEPS[transform.kind] : [];
  const indicated = transform ? transform.points.length : count;

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent): void => {
      if (isTyping(event.target) || useUiStore.getState().dialog !== null) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (useEditorStore.getState().viewMode !== 'plan') return;
      const arch = useArchStore.getState();
      if (arch.modify) {
        // Aparar, alinhar e dividir: só o Tab é daqui (arestas sobrepostas no alinhar).
        if (event.key === 'Tab' && (arch.modifyHover?.count ?? 0) > 1) {
          event.preventDefault();
          arch.cycleModify(event.shiftKey ? -1 : 1);
        }
        return;
      }
      if (event.key === 'Tab') {
        // Só quando há o que alternar: senão o Tab segue a sua função no navegador.
        if ((arch.snap?.count ?? 0) > 1) {
          event.preventDefault();
          arch.cycleSnap(event.shiftKey ? -1 : 1);
        }
      } else if (event.key === 'r' || event.key === 'R') {
        event.preventDefault();
        event.stopImmediatePropagation();
        arch.pinReference();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (arch.contour) arch.finishContour();
        else if (arch.tool) arch.finish();
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        if (arch.tool) arch.removeLastPoint();
        else if (arch.transform) arch.cancel();
      } else if (event.key === 'Delete' && arch.contour) {
        event.preventDefault();
        event.stopImmediatePropagation();
        arch.removeContourVertex();
      } else if (/^[0-9.,@-]$/.test(event.key) && (arch.tool || arch.transform)) {
        // O caractere digitado cai no campo, que passa a ter o foco. Os atalhos de ferramenta
        // não são letras numéricas, então nada mais é acionado.
        inputRef.current?.focus();
      }
    };
    // Na fase de captura: R e Del valem para a operação em andamento, não para os atalhos.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);

  // Ponto confirmado ou operação encerrada: o campo recomeça vazio.
  useEffect(() => setText(''), [indicated, tool, transform?.kind]);

  if (!active || (modifying && !entering && !contour)) return null;
  if (contour) {
    return (
      <div className="arch-entry arch-entry--bar" data-testid="arch-contour-bar" role="toolbar">
        <span>
          Editar contorno ·{' '}
          {rectangular
            ? 'arraste os cantos'
            : 'arraste os vértices; o ponto no meio do lado cria um vértice; Del remove'}
        </span>
        <button
          type="button"
          className="btn btn--compact btn--primary"
          data-testid="arch-contour-finish"
          title="Grava o contorno em um passo do histórico (Enter). Um contorno inválido não é gravado."
          onClick={() => useArchStore.getState().finishContour()}
        >
          <Check size={14} aria-hidden /> Concluir
        </button>
        <button
          type="button"
          className="btn btn--compact"
          data-testid="arch-contour-cancel"
          title="Descarta a edição: o modelo não é alterado (Esc)"
          onClick={() => useArchStore.getState().cancelContour()}
        >
          <X size={14} aria-hidden /> Cancelar
        </button>
      </div>
    );
  }

  const rotating = transform?.kind === 'rotate' && indicated >= 1;
  const title = transform
    ? ARCH_TRANSFORM_LABELS[transform.kind]
    : tool
      ? ARCH_TOOL_LABELS[tool]
      : '';
  const prompt = transform
    ? (steps[Math.min(indicated, steps.length - 1)] ?? '')
    : tool === 'roof'
      ? (['clique o início do beiral', 'comprimento do beiral', 'largura'][Math.min(count, 2)] ??
        '')
      : count === 0
        ? 'clique o 1º ponto'
        : 'comprimento';
  return (
    <label
      className="arch-entry"
      data-testid="arch-entry"
      data-mode={transform ? transform.kind : (tool ?? '')}
      title={
        rotating
          ? 'Ângulo do giro, em graus (anti-horário positivo). Enter confirma.'
          : 'Valor exato do próximo ponto: comprimento em metros na direção do cursor, comprimento<ângulo, @ΔX;ΔY ou X;Y. Enter confirma; com o campo vazio, Enter conclui o traçado.'
      }
    >
      <span>
        {title} · {prompt}
      </span>
      <input
        ref={inputRef}
        data-testid="arch-length-entry"
        type="text"
        inputMode="decimal"
        placeholder={rotating ? '°' : 'm'}
        value={text}
        disabled={indicated === 0}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          const arch = useArchStore.getState();
          if (event.key === 'Enter') {
            event.preventDefault();
            if (text.trim() === '') {
              if (arch.tool) arch.finish();
            } else if (arch.submitEntry(text)) setText('');
          } else if (event.key === 'Escape') {
            // Esc no campo devolve o teclado à planta; o seguinte cancela o traçado.
            setText('');
            event.currentTarget.blur();
          }
          event.stopPropagation();
        }}
      />
      <span className="arch-entry__unit">{rotating ? '°' : 'm'}</span>
    </label>
  );
}
