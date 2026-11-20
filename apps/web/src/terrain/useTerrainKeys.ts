import { useEffect } from 'react';
import { useUiStore } from '../state/uiStore';
import { useTerrainStore } from './terrainStore';

/**
 * Teclado das operações do terreno na planta: Enter conclui o contorno ou o corte, Backspace
 * desfaz o último ponto e Esc cancela (primeiro o desenho, depois a operação). Atendido na
 * fase de captura, para que o Esc não cancele também outra interação do editor; com o foco em
 * um campo ou com um diálogo aberto, as teclas não são interceptadas.
 */
export function useTerrainKeys(): void {
  const active = useTerrainStore((s) => s.mode !== null);
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;
      if (target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (useUiStore.getState().dialog !== null) return;
      const terrain = useTerrainStore.getState();
      if (event.key === 'Escape') terrain.cancel();
      else if (event.key === 'Enter') terrain.finishDraft();
      else if (event.key === 'Backspace') terrain.undoDraftPoint();
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);
}
