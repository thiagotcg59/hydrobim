import { useSyncExternalStore } from 'react';

/**
 * Tela compacta: largura de até 1023 px — dobráveis abertos (Galaxy Z Fold, ~850 a 990 px
 * nas duas orientações), tablets em retrato e janelas estreitas. Nela o navegador e o painel
 * de propriedades flutuam sobre a área de desenho em vez de ocupar colunas, a faixa de
 * comandos vira uma linha só, rolável, e a área de desenho mostra uma vista por vez.
 *
 * O CSS desse modo segue o atributo `data-compact` do `.app` (fonte única: esta consulta),
 * e não uma media query própria, para o comportamento e a aparência não divergirem.
 */
export const COMPACT_QUERY = '(max-width: 1023px)';

function media(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(COMPACT_QUERY)
    : null;
}

export function isCompactViewport(): boolean {
  return media()?.matches ?? false;
}

function subscribe(onChange: () => void): () => void {
  const list = media();
  if (!list) return () => undefined;
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

export function useCompactLayout(): boolean {
  return useSyncExternalStore(subscribe, isCompactViewport, () => false);
}
