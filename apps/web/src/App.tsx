import { useEffect, useState } from 'react';
import { isAnnotationTool, selectIsDirty, useEditorStore } from './state/editorStore';
import { restoreSession, saveCurrentProject } from './state/projectActions';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { PlanView } from './plan/PlanView';
import { FamiliesDialog } from './ui/FamiliesDialog';
import { OpenProjectDialog } from './ui/OpenProjectDialog';
import { ProjectDialog } from './ui/ProjectDialog';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { StatusBar } from './ui/StatusBar';
import { ToolBar, TOOL_SHORTCUTS } from './ui/ToolBar';
import { ToolOptions } from './ui/ToolOptions';
import { TopBar } from './ui/TopBar';
import { Viewport } from './viewport/Viewport';

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'SELECT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable)
  );
}

function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const state = useEditorStore.getState();
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && key === 's') {
        event.preventDefault();
        void saveCurrentProject();
        return;
      }
      if (isTyping(event.target)) return;
      if (modifier && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) state.redo();
        else state.undo();
      } else if (modifier && key === 'y') {
        event.preventDefault();
        state.redo();
      } else if (event.key === 'Escape') {
        state.cancelInteraction();
      } else if (event.key === 'Delete') {
        state.deleteSelected();
      } else if (!modifier && !event.altKey) {
        const tool = TOOL_SHORTCUTS[key];
        if (tool) state.setTool(tool);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** Avisa antes de fechar a página com alterações não salvas. */
function useUnsavedChangesGuard(): void {
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      const state = useEditorStore.getState();
      if (selectIsDirty(state)) event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
}

export function App() {
  const [ready, setReady] = useState(false);
  const [openDialog, setOpenDialog] = useState(false);
  const [familiesDialog, setFamiliesDialog] = useState(false);
  const [projectDialog, setProjectDialog] = useState(false);
  const tool = useEditorStore((s) => s.tool);
  const viewMode = useEditorStore((s) => s.viewMode);
  useKeyboardShortcuts();
  useUnsavedChangesGuard();

  useEffect(() => {
    let cancelled = false;
    restoreSession()
      .catch((error: unknown) => {
        console.error('[HydroBIM] Falha ao restaurar a sessão.', error);
        useEditorStore.getState().notify('error', 'Não foi possível restaurar a última sessão.');
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ErrorBoundary
      title="O HydroBIM encontrou um erro inesperado"
      hint="Tente novamente. Se o problema persistir, recarregue a página."
    >
      <div className="app" data-ready={ready} data-testid="app">
        <TopBar
          onOpen={() => setOpenDialog(true)}
          onFamilies={() => setFamiliesDialog(true)}
          onProject={() => setProjectDialog(true)}
        />
        <ToolBar />
        <main className="workspace">
          {!ready ? (
            <div className="viewport-fallback">Carregando projeto…</div>
          ) : viewMode === 'plan' ? (
            <PlanView />
          ) : (
            <Viewport />
          )}
          {tool !== 'select' && !isAnnotationTool(tool) && <ToolOptions />}
          <div className="segmented viewmode" role="group" aria-label="Área de trabalho">
            {(['3d', 'plan'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                data-testid={`view-mode-${mode}`}
                className={viewMode === mode ? 'segmented__item is-active' : 'segmented__item'}
                aria-pressed={viewMode === mode}
                onClick={() => useEditorStore.getState().setViewMode(mode)}
                title={
                  mode === '3d'
                    ? 'Modelo 3D: modelagem da rede'
                    : 'Planta baixa: documentação técnica com cotas, textos e etiquetas'
                }
              >
                {mode === '3d' ? 'Modelo 3D' : 'Planta baixa'}
              </button>
            ))}
          </div>
        </main>
        <PropertiesPanel />
        <StatusBar />
        <OpenProjectDialog open={openDialog} onClose={() => setOpenDialog(false)} />
        <FamiliesDialog open={familiesDialog} onClose={() => setFamiliesDialog(false)} />
        <ProjectDialog open={projectDialog} onClose={() => setProjectDialog(false)} />
      </div>
    </ErrorBoundary>
  );
}
