import { Check, CornerDownLeft, Undo2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { ARCH_TOOL_LABELS, useArchStore, type ArchTool } from './archStore';

/** Pontos que o traçado ou o contorno precisa ter para ser criado. */
const MIN_POINTS: Partial<Record<ArchTool, number>> = {
  wall: 2,
  slab: 3,
  flooring: 3,
  space: 3,
  floorOpening: 3,
};

/** Rótulo de "criar" de cada ferramenta de desenho por pontos. */
function createLabel(tool: ArchTool, points: number): string {
  if (tool === 'wall') return points > 2 ? 'Criar as paredes' : 'Criar a parede';
  if (tool === 'slab') return 'Criar a laje';
  if (tool === 'flooring') return 'Criar o piso';
  if (tool === 'space') return 'Criar o ambiente';
  return 'Criar a abertura';
}

/**
 * Menu do botão direito durante o desenho da arquitetura (parede em traçado contínuo, laje,
 * piso, ambiente e abertura): conclui o que está em rascunho sem depender do teclado. As ações
 * são as mesmas de Enter (criar), do clique no primeiro ponto (fechar), de Backspace (desfazer
 * o último ponto) e de Esc (cancelar o traçado).
 */
export function ArchDraftMenu() {
  const menu = useArchStore((s) => s.draftMenu);
  const tool = useArchStore((s) => s.tool);
  const count = useArchStore((s) => s.points.length);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (event: Event): void => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      useArchStore.getState().closeDraftMenu();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // Esc fecha só o menu: o traçado continua.
      event.stopImmediatePropagation();
      useArchStore.getState().closeDraftMenu();
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [menu]);

  const needed = tool ? MIN_POINTS[tool] : undefined;
  if (!menu || !tool || needed === undefined) return null;
  const arch = useArchStore.getState();
  const ready = count >= needed;
  const missing = `Faltam pontos: ${count} de ${needed} indicados`;
  /** Fecha o menu e executa: o resultado (ou a recusa) aparece na barra de estado. */
  const run = (action: () => void) => () => {
    arch.closeDraftMenu();
    action();
  };

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      data-testid="arch-draft-menu"
      style={{
        left: Math.min(menu.x, window.innerWidth - 240),
        top: Math.min(menu.y, window.innerHeight - 220),
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        className="context-menu__item"
        data-testid="arch-draft-create"
        disabled={!ready}
        onClick={run(() => arch.finish(tool === 'wall' ? false : undefined))}
      >
        <Check size={14} />
        <span>
          <strong>{createLabel(tool, count)}</strong>
          <small data-testid="arch-draft-create-hint">
            {!ready
              ? missing
              : tool === 'wall'
                ? `${count - 1} ${count === 2 ? 'trecho' : 'trechos'} · conclui o traçado (Enter)`
                : `${ARCH_TOOL_LABELS[tool]} com ${count} vértices (Enter)`}
          </small>
        </span>
      </button>
      {tool === 'wall' && (
        <button
          type="button"
          role="menuitem"
          className="context-menu__item"
          data-testid="arch-draft-close"
          disabled={count < 3}
          onClick={run(() => arch.finish(true))}
        >
          <CornerDownLeft size={14} />
          <span>
            <strong>Fechar e criar</strong>
            <small>
              {count < 3
                ? 'Precisa de ao menos três pontos'
                : 'Liga o último ponto ao primeiro e conclui'}
            </small>
          </span>
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className="context-menu__item"
        data-testid="arch-draft-undo"
        disabled={count === 0}
        onClick={run(() => arch.removeLastPoint())}
      >
        <Undo2 size={14} />
        <span>
          <strong>Desfazer o último ponto</strong>
          <small>Backspace</small>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="context-menu__item"
        data-testid="arch-draft-cancel"
        disabled={count === 0}
        onClick={run(() => useArchStore.setState({ points: [] }))}
      >
        <X size={14} />
        <span>
          <strong>Cancelar o traçado</strong>
          <small>Descarta os pontos indicados; nada é criado (Esc)</small>
        </span>
      </button>
    </div>
  );
}
