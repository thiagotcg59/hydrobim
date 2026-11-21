import { useArchStore } from '../arch/archStore';

/**
 * Ponte entre as vistas 2D e a sessão da arquitetura (`arch/archStore.ts`): a seleção de
 * paredes, pisos, esquadrias e ambientes é da store de sessão da arquitetura, não das vistas.
 * Ela mesma limpa a seleção da rede quando um elemento arquitetônico é selecionado.
 */

/** Seleciona um elemento arquitetônico (ou limpa, com `null`); `additive` soma à seleção. */
export function selectArchElement(id: string | null, additive = false): void {
  const store = useArchStore.getState();
  // Limpar o que já está vazio não deve mexer na sessão (nem encerrar ferramentas).
  if (id === null && store.selection.length === 0) return;
  store.select(id, additive);
}

/** Seleção da arquitetura, acompanhando a store de sessão. */
export const useArchSelection = (): readonly string[] => useArchStore((s) => s.selection);
