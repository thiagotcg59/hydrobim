import { getElement, resolvePort } from '@hydrobim/core';
import { Crosshair, Spline } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';

/**
 * Menu do botão direito junto a uma extremidade de tubo ou a uma conexão. "Criar tubo" aciona
 * a ferramenta Tubo já partindo da porta livre apontada; sem porta livre, a opção aparece
 * desabilitada com o motivo.
 */
export function ContextMenu() {
  const menu = useEditorStore((s) => s.contextMenu);
  const project = useEditorStore((s) => s.project);
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
      ? `${element.name}: extremidade já conectada`
      : `${element.name}: sem extremidade livre`;

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      data-testid="context-menu"
      // Mantém o menu dentro da janela quando o clique é junto à borda.
      style={{
        left: Math.min(menu.x, window.innerWidth - 240),
        top: Math.min(menu.y, window.innerHeight - 130),
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
