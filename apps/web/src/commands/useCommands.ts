import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useArchStore } from '../arch/archStore';
import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { useEarthworkStore } from '../terrain/earthworkStore';
import { useTerrainStore } from '../terrain/terrainStore';
import { useViewStore } from '../views/viewStore';
import { useVrStore } from '../vr/vrStore';
import { isWalkKey } from '../walk/walkMotion';
import {
  commandForKey,
  GLOBAL_SHORTCUTS,
  runCommand,
  viewContextOf,
  type CommandContext,
} from './commands';

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
      inlineClearances: s.inlineClearances,
      bimWalk: s.bimWalk,
      maximizedView: s.maximizedView,
    })),
  );
  const terrainMode = useTerrainStore((s) => s.mode);
  const terrainPanelOpen = useTerrainStore((s) => s.panelOpen);
  const earthworkTab = useEarthworkStore((s) => s.tab);
  const views = useViewStore(
    useShallow((s) => ({
      open2d: s.open2d,
      open3d: s.open3d,
      tool: s.tool,
      marker: s.marker,
      detailSelection: s.detailSelection,
    })),
  );
  const archTool = useArchStore((s) => s.tool);
  const archSelection = useArchStore((s) => s.selection);
  const archTransform = useArchStore((s) => s.transform?.kind ?? null);
  const archContour = useArchStore((s) => s.contour !== null);
  const vrOpen = useVrStore((s) => s.open);
  return useMemo(
    () => ({
      ...editor,
      ...layout,
      vrOpen,
      terrainMode,
      terrainPanelOpen,
      earthworkTab,
      ...viewContextOf(editor.project, views),
      archTool,
      archSelection,
      archTransform,
      archContour,
    }),
    [
      editor,
      layout,
      vrOpen,
      terrainMode,
      terrainPanelOpen,
      earthworkTab,
      views,
      archTool,
      archSelection,
      archTransform,
      archContour,
    ],
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
        // O desenho 2D em andamento (ou a seleção de detalhes) é o primeiro a ser desfeito.
        else if (!useArchStore.getState().cancel() && !useViewStore.getState().cancel()) {
          useEditorStore.getState().cancelInteraction();
        }
        return;
      }
      if (!id) return;
      // No percurso, W A S D, E, Q e F são do observador: não trocam de ferramenta.
      if (useUiStore.getState().bimWalk && isWalkKey(event.key)) return;
      if (event.key === ' ') {
        // Espaço sobre um botão o aciona: não gira a seleção ao mesmo tempo.
        const target = event.target;
        if (target instanceof Element && target.closest('button, a, summary, [role="menuitem"]')) {
          return;
        }
        event.preventDefault();
      }
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
