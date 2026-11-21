import { getElement, resolvePort } from '@hydrobim/core';
import { AlignStartVertical, Crosshair, Move, RotateCw, Spline } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';

/**
 * Menu do botão direito sobre um elemento. "Criar tubo" aciona a ferramenta Tubo já partindo
 * da porta livre apontada (sem porta livre, a opção aparece desabilitada com o motivo);
 * "Mover", "Girar" e "Alinhar por pontos" começam o mover, o girar e o alinhar interativos do
 * elemento ou da seleção que o contém (no girar e no alinhar, a rede ligada vai junto).
 */
export function ContextMenu() {
  const menu = useEditorStore((s) => s.contextMenu);
  const project = useEditorStore((s) => s.project);
  const selection = useEditorStore((s) => s.selection);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (event: Event): void => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      useEditorStore.getState().closeContextMenu();
    };
    // Qualquer clique fora, rolagem ou perda de foco da janela fecha o menu.
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  if (!menu) return null;
  const element = getElement(project, menu.elementId);
  if (!element) return null;
  const port = menu.port ? resolvePort(project, menu.port) : undefined;
  const hint = port
    ? `A partir de ${element.name} · ${port.spec.sizeLabel}`
    : element.kind === 'pipe'
      ? `${element.name}: sem extremidade livre neste ponto`
      : `${element.name}: sem extremidade livre`;
  // Sobre um elemento da seleção, move a seleção inteira; fora dela, só o elemento apontado
  // (no tubo, o trecho contínuo, como no clique de seleção).
  const inSelection = selection.includes(element.id);
  const moveHint =
    inSelection && selection.length > 1
      ? `${selection.length} elementos selecionados · ponto-base e destino`
      : `${element.name} · ponto-base e destino`;

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      data-testid="context-menu"
      // Mantém o menu dentro da janela quando o clique é junto à borda.
      style={{
        left: Math.min(menu.x, window.innerWidth - 240),
        top: Math.min(menu.y, window.innerHeight - 300),
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        className="context-menu__item"
        data-testid="context-create-pipe"
        disabled={!port}
        onClick={() => {
          if (menu.port) useEditorStore.getState().startPipeFromPort(menu.port);
        }}
      >
        <Spline size={14} />
        <span>
          <strong>Criar tubo</strong>
          <small data-testid="context-create-pipe-hint">{hint}</small>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="context-menu__item"
        data-testid="context-move"
        onClick={() => {
          const state = useEditorStore.getState();
          if (!inSelection) state.select(element.id);
          useEditorStore.getState().startMove();
        }}
      >
        <Move size={14} />
        <span>
          <strong>Mover</strong>
          <small data-testid="context-move-hint">{moveHint}</small>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="context-menu__item"
        data-testid="context-rotate"
        onClick={() => {
          const state = useEditorStore.getState();
          if (!inSelection) state.select(element.id);
          useEditorStore.getState().startRotate();
        }}
      >
        <RotateCw size={14} />
        <span>
          <strong>Girar</strong>
          <small data-testid="context-rotate-hint">
            {moveHint.replace('ponto-base e destino', 'com a rede ligada')}
          </small>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="context-menu__item"
        data-testid="context-align"
        onClick={() => {
          const state = useEditorStore.getState();
          if (!inSelection) state.select(element.id);
          useEditorStore.getState().startAlign();
        }}
      >
        <AlignStartVertical size={14} />
        <span>
          <strong>Alinhar por pontos</strong>
          <small>{moveHint.replace('ponto-base e destino', 'dois pares origem → destino')}</small>
        </span>
      </button>
      {(element.kind === 'tee' || element.kind === 'cross') && (
        <button
          type="button"
          role="menuitem"
          className="context-menu__item"
          data-testid="context-convert-junction"
          onClick={() => {
            // A conversão abre com a prévia no painel; só a confirmação grava.
            const state = useEditorStore.getState();
            state.select(element.id);
            state.previewJunction(element.id, null);
            state.closeContextMenu();
            useUiStore.getState().revealProperty('section-junction');
          }}
        >
          <Crosshair size={14} />
          <span>
            <strong>{element.kind === 'tee' ? 'Converter em cruzeta' : 'Converter em tê'}</strong>
            <small>Prévia no painel de propriedades antes de confirmar</small>
          </span>
        </button>
      )}
    </div>
  );
}
