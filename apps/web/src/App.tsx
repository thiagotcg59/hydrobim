import { useEffect, useState, type CSSProperties } from 'react';
import { ArchCatalogDialog } from './arch/ArchCatalogDialog';
import { ArchProperties } from './arch/ArchProperties';
import { ArchQuantitiesDialog } from './arch/ArchQuantitiesDialog';
import { ARCH_TOOL_LABELS, useArchStore } from './arch/archStore';
import { ArchToolOptions } from './arch/ArchToolOptions';
import { BimTree } from './bim/BimTree';
import { IfcLibraryDialog } from './bim/IfcLibraryDialog';
import { IfcPanel } from './bim/IfcPanel';
import { useKeyboardShortcuts } from './commands/useCommands';
import { isAnnotationTool, selectIsDirty, useEditorStore } from './state/editorStore';
import { restoreSession } from './state/projectActions';
import { useUiStore, type DialogId } from './state/uiStore';
import { CommandPalette } from './ui/CommandPalette';
import { useCompactLayout } from './ui/compactLayout';
import { ContextMenu } from './ui/ContextMenu';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { ExportDialog } from './ui/ExportDialog';
import { FamiliesDialog } from './ui/FamiliesDialog';
import { TOOL_LABELS } from './ui/labels';
import { OpenProjectDialog } from './ui/OpenProjectDialog';
import { ProjectBrowser } from './ui/ProjectBrowser';
import { ProjectDialog } from './ui/ProjectDialog';
import { ProjectOptionsDialog } from './ui/ProjectOptionsDialog';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { SidePanel } from './ui/SidePanel';
import { StatusBar } from './ui/StatusBar';
import { ToolBar } from './ui/ToolBar';
import { ToolOptions } from './ui/ToolOptions';
import { TopBar } from './ui/TopBar';
import { ViewPanel } from './views/ViewPanel';
import { Workspace } from './ui/Workspace';

/** Largura da régua de um painel recolhido. */
const RAIL = 28;

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

/**
 * Painel direito. Duas abas separam o que vale para o **próximo** elemento (opções da
 * ferramenta ativa) do que pertence aos elementos **já selecionados** (propriedades). Na
 * consulta BIM / IFC o painel mostra as propriedades IFC.
 */
function RightPanel() {
  const tool = useEditorStore((s) => s.tool);
  const bim = useEditorStore((s) => s.viewMode === 'bim');
  const archTool = useArchStore((s) => s.tool);
  const archSelected = useArchStore((s) => s.selection.length);
  const selectionSize = useEditorStore((s) => s.selection.length) + archSelected;
  const tab = useUiStore((s) => s.panelTab);
  const setTab = useUiStore((s) => s.setPanelTab);
  if (bim) return archSelected > 0 ? <ArchProperties /> : <IfcPanel />;
  const creating = archTool !== null || (tool !== 'select' && !isAnnotationTool(tool));
  const toolLabel = archTool ? ARCH_TOOL_LABELS[archTool] : TOOL_LABELS[tool];
  const showTool = creating && tab === 'tool';
  // Aba "Vista": configuração da vista de projeto em uso e do detalhe 2D selecionado.
  const showView = tab === 'view' && !creating;
  return (
    <div
      className="rightpanel"
      data-testid="right-panel"
      data-tab={showTool ? 'tool' : showView ? 'view' : 'properties'}
    >
      <div className="rightpanel__tabs" role="tablist" aria-label="Painel">
        <button
          type="button"
          role="tab"
          data-testid="panel-tab-tool"
          aria-selected={showTool}
          className={showTool ? 'rightpanel__tab is-active is-tool' : 'rightpanel__tab'}
          disabled={!creating}
          title={
            creating
              ? `Opções da ferramenta ${toolLabel}: parâmetros do próximo elemento a criar`
              : 'Sem ferramenta de criação ativa. Escolha uma em Modelagem › Criar para ver as suas opções.'
          }
          onClick={() => setTab('tool')}
        >
          Ferramenta{creating ? ` · ${toolLabel}` : ''}
        </button>
        <button
          type="button"
          role="tab"
          data-testid="panel-tab-properties"
          aria-selected={!showTool && !showView}
          className={!showTool && !showView ? 'rightpanel__tab is-active' : 'rightpanel__tab'}
          title="Propriedades dos elementos já selecionados"
          onClick={() => setTab('properties')}
        >
          Propriedades{selectionSize > 0 ? ` · ${selectionSize}` : ''}
        </button>
        <button
          type="button"
          role="tab"
          data-testid="panel-tab-view"
          aria-selected={showView}
          className={showView ? 'rightpanel__tab is-active' : 'rightpanel__tab'}
          disabled={creating}
          title="Vista de projeto em uso: escala, orientação, corte, recorte, visibilidade e estilo; e o detalhe 2D selecionado"
          onClick={() => setTab('view')}
        >
          Vista
        </button>
      </div>
      {showTool ? (
        archTool ? (
          <ArchToolOptions tool={archTool} />
        ) : (
          <ToolOptions />
        )
      ) : showView ? (
        <ViewPanel />
      ) : (
        <PropertiesPanel />
      )}
    </div>
  );
}

export function App() {
  const [ready, setReady] = useState(false);
  const [projectDialog, setProjectDialog] = useState(false);
  const viewMode = useEditorStore((s) => s.viewMode);
  const dialog = useUiStore((s) => s.dialog);
  const closeDialog = (id: DialogId) => (): void => useUiStore.getState().closeDialog(id);
  const navOpen = useUiStore((s) => s.navOpen);
  const panelOpen = useUiStore((s) => s.panelOpen);
  const navWidth = useUiStore((s) => s.navWidth);
  const panelWidth = useUiStore((s) => s.panelWidth);
  // As vistas e a faixa pedem o diálogo de projeto em uma aba (georreferência, perfil) pela store.
  const projectRequest = useEditorStore((s) => s.projectDialogRequest);
  useEffect(() => {
    if (projectRequest) setProjectDialog(true);
  }, [projectRequest]);
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

  const compact = useCompactLayout();
  // Ao entrar na tela compacta (abertura no dobrável, janela estreitada), a área de desenho
  // fica com toda a largura: painéis recolhidos e uma vista por vez. Reabri-los é um toque.
  useEffect(() => {
    if (!compact) return;
    const ui = useUiStore.getState();
    ui.setNavOpen(false);
    ui.setPanelOpen(false);
    if (ui.workspaceLayout === 'split') ui.setWorkspaceLayout('single');
  }, [compact]);

  const bim = viewMode === 'bim';
  // A árvore e as propriedades IFC pedem mais largura que as listas de modelagem. Na tela
  // compacta os painéis abertos flutuam sobre a área de desenho: a coluna fica só com a régua.
  const columns = {
    '--nav-width': `${navOpen && !compact ? Math.max(navWidth, bim ? 300 : 0) : RAIL}px`,
    '--panel-width': `${panelOpen && !compact ? Math.max(panelWidth, bim ? 380 : 0) : RAIL}px`,
  } as CSSProperties;

  return (
    <ErrorBoundary
      title="O HydroBIM encontrou um erro inesperado"
      hint="Tente novamente. Se o problema persistir, recarregue a página."
    >
      <div
        className={bim ? 'app app--bim' : 'app'}
        style={columns}
        data-ready={ready}
        data-compact={compact}
        data-view-mode={viewMode}
        data-testid="app"
      >
        <TopBar />
        <ToolBar />
        <SidePanel side="nav" title="Navegador do projeto">
          {bim ? <BimTree /> : <ProjectBrowser />}
        </SidePanel>
        <Workspace ready={ready} />
        <SidePanel side="panel" title="Propriedades">
          <RightPanel />
        </SidePanel>
        <StatusBar />
        <ContextMenu />
        <OpenProjectDialog open={dialog === 'open'} onClose={closeDialog('open')} />
        <FamiliesDialog open={dialog === 'families'} onClose={closeDialog('families')} />
        <IfcLibraryDialog open={dialog === 'ifcLibrary'} onClose={closeDialog('ifcLibrary')} />
        <ExportDialog open={dialog === 'export'} onClose={closeDialog('export')} />
        <CommandPalette open={dialog === 'commands'} onClose={closeDialog('commands')} />
        <ProjectOptionsDialog open={dialog === 'options'} onClose={closeDialog('options')} />
        {dialog === 'archCatalog' && (
          <ArchCatalogDialog
            onClose={closeDialog('archCatalog')}
            onUseType={(typeId, category) => {
              useUiStore.getState().closeDialog('archCatalog');
              useArchStore.getState().activateType(typeId, category);
            }}
          />
        )}
        {dialog === 'archQuantities' && (
          <ArchQuantitiesDialog onClose={closeDialog('archQuantities')} />
        )}
        <ProjectDialog
          open={projectDialog}
          onClose={() => setProjectDialog(false)}
          request={projectRequest}
        />
      </div>
    </ErrorBoundary>
  );
}
