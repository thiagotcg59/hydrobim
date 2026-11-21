import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { PANEL_LIMITS, useUiStore } from '../state/uiStore';
import { useCompactLayout } from './compactLayout';

interface Props {
  side: 'nav' | 'panel';
  title: string;
  children: ReactNode;
}

/**
 * Moldura dos painéis laterais: recolhe para uma régua estreita e é redimensionável pela
 * borda (arrastar ou setas do teclado). Só cuida do layout; o conteúdo vem dos componentes
 * funcionais. Largura e estado são preferências da interface, não dados do projeto.
 */
export function SidePanel({ side, title, children }: Props) {
  const open = useUiStore((s) => (side === 'nav' ? s.navOpen : s.panelOpen));
  const width = useUiStore((s) => (side === 'nav' ? s.navWidth : s.panelWidth));
  const drag = useRef<{ x: number; width: number } | null>(null);
  // Tela compacta: o painel aberto flutua sobre a área de desenho, e só um por vez.
  const compact = useCompactLayout();
  const setOpen = (value: boolean): void => {
    const ui = useUiStore.getState();
    if (side === 'nav') ui.setNavOpen(value);
    else ui.setPanelOpen(value);
    if (value && compact) {
      if (side === 'nav') ui.setPanelOpen(false);
      else ui.setNavOpen(false);
    }
  };
  const resize = (value: number): void => useUiStore.getState().setPanelWidth(side, value);
  // O navegador cresce para a direita; o painel de propriedades, para a esquerda.
  const direction = side === 'nav' ? 1 : -1;
  const limits = PANEL_LIMITS[side];
  const Collapse = side === 'nav' ? ChevronLeft : ChevronRight;
  const Expand = side === 'nav' ? ChevronRight : ChevronLeft;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    drag.current = { x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    resize(drag.current.width + direction * (event.clientX - drag.current.x));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  if (!open) {
    return (
      <aside
        className={`dock dock--${side} is-collapsed`}
        data-testid={`dock-${side}`}
        data-open="false"
      >
        <button
          type="button"
          className="dock__rail"
          data-testid={`dock-${side}-toggle`}
          aria-expanded={false}
          title={`Mostrar ${title.toLowerCase()}`}
          onClick={() => setOpen(true)}
        >
          <Expand size={14} aria-hidden />
          <span>{title}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      className={`dock dock--${side}${compact ? ' dock--overlay' : ''}`}
      data-testid={`dock-${side}`}
      data-open="true"
      data-overlay={compact}
      data-width={width}
      aria-label={title}
      style={compact ? ({ '--dock-width': `${width}px` } as CSSProperties) : undefined}
    >
      <button
        type="button"
        className="dock__collapse"
        data-testid={`dock-${side}-toggle`}
        aria-expanded
        aria-label={`Recolher ${title.toLowerCase()}`}
        title={`Recolher ${title.toLowerCase()} para ampliar a área de desenho`}
        onClick={() => setOpen(false)}
      >
        <Collapse size={14} aria-hidden />
      </button>
      <div className="dock__content">{children}</div>
      <div
        className="dock__resizer"
        data-testid={`dock-${side}-resizer`}
        role="separator"
        aria-orientation="vertical"
        aria-label={`Largura de ${title.toLowerCase()}`}
        aria-valuenow={width}
        aria-valuemin={limits.min}
        aria-valuemax={limits.max}
        tabIndex={0}
        title="Arraste para redimensionar (ou use as setas ← →)"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          event.stopPropagation();
          resize(width + direction * (event.key === 'ArrowRight' ? 16 : -16));
        }}
      />
    </aside>
  );
}
