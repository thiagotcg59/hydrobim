import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { useTerrainStore } from '../terrain/terrainStore';
import { commandForKey, GLOBAL_SHORTCUTS, runCommand, type CommandContext } from './commands';

/** Estado de que os comandos dependem, sem reagir a cada movimento do cursor. */
export function useCommandContext(): CommandContext {
  const editor = useEditorStore(
    useShallow((s) => ({
      project: s.project,
      tool: s.tool,
      viewMode: s.viewMode,
      selection: s.selection,
      annotationSelection: s.annotationSelection,
      orthographic: s.orthographic,
      viewPreset: s.viewRequest?.preset ?? null,
      canUndo: s.past.length > 0,
      canRedo: s.future.length > 0,
      bimHiddenCount: s.bimHidden.length,
    })),
  );
  const layout = useUiStore(
    useShallow((s) => ({
      task: s.task,
      navOpen: s.navOpen,
      panelOpen: s.panelOpen,
      ribbonCollapsed: s.ribbonCollapsed,
      validationOpen: s.validationOpen,
      workspaceLayout: s.workspaceLayout,
      maximizedView: s.maximizedView,
    })),
  );
  const terrainMode = useTerrainStore((s) => s.mode);
  const terrainPanelOpen = useTerrainStore((s) => s.panelOpen);
  return useMemo(
    () => ({ ...editor, ...layout, terrainMode, terrainPanelOpen }),
    [editor, layout, terrainMode, terrainPanelOpen],
  );
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'SELECT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable)
  );
}

/**
 * Atalhos de teclado, lidos do registro de comandos: valem as mesmas regras de disponibilidade
 * dos botões. Com o foco em um campo, menu ou diálogo, só os atalhos globais (salvar, buscar)
 * são atendidos — digitar "T" em um campo não troca de ferramenta.
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    // Os campos interrompem a propagação das teclas (para que digitar não acione ferramentas):
    // os atalhos globais são atendidos antes, na fase de captura.
    const onGlobalKeyDown = (event: KeyboardEvent): void => {
      const id = commandForKey(event);
      if (!id || !GLOBAL_SHORTCUTS.has(id)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // Salvar com um campo em edição grava o valor digitado: sair do campo o confirma.
      if (id === 'file.save' && isTyping(event.target) && event.target instanceof HTMLElement) {
        event.target.blur();
      }
      runCommand(id);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      const id = commandForKey(event);
      const typing = isTyping(event.target);
      if (typing || useUiStore.getState().dialog !== null) return;
      if (event.key === 'Escape') {
        const ui = useUiStore.getState();
        if (ui.validationOpen) ui.setValidationOpen(false);
        else useEditorStore.getState().cancelInteraction();
        return;
      }
      if (!id) return;
      // Ctrl+Z e Ctrl+Y não devem acionar o histórico do navegador.
      if (event.ctrlKey || event.metaKey) event.preventDefault();
      runCommand(id);
    };
    window.addEventListener('keydown', onGlobalKeyDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onGlobalKeyDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
