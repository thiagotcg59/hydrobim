import { getElement, type Point2 } from '@hydrobim/core';
import { create } from 'zustand';
import { isAnnotationTool, useEditorStore, type DrawAnchor, type ToolId } from './editorStore';

/**
 * Estado da interface que não é dado de engenharia: aba de tarefa, painéis, diálogos e pedidos
 * entre regiões da tela. Fica fora da store do editor de propósito — recolher um painel ou
 * trocar de aba não marca o projeto como alterado nem entra no histórico de modelagem.
 */

export const TASKS = ['model', 'document', 'view', 'analysis', 'bim', 'export', 'manage'] as const;
export type TaskId = (typeof TASKS)[number];

export const TASK_LABELS: Record<TaskId, string> = {
  model: 'Modelagem',
  document: 'Documentação',
  view: 'Visualizar',
  analysis: 'Análise',
  bim: 'BIM / IFC',
  export: 'Exportação',
  manage: 'Gerenciar',
};

export type DialogId = 'open' | 'families' | 'ifcLibrary' | 'export' | 'commands' | 'options';
/** `view`: configuração da vista de projeto aberta e do detalhe 2D selecionado. */
export type PanelTab = 'tool' | 'properties' | 'view';
export type WorkspaceView = 'plan' | '3d';

/** Pedido a ser atendido pela planta (que guarda a janela visível e o desenho). */
export type PlanCommand =
  { readonly kind: 'exportSvg' } | { readonly kind: 'goTo'; readonly point: Point2 };

export interface LayoutPrefs {
  readonly ribbonCollapsed: boolean;
  readonly navOpen: boolean;
  readonly panelOpen: boolean;
  /** Larguras dos painéis laterais, em pixels. */
  readonly navWidth: number;
  readonly panelWidth: number;
  readonly workspaceLayout: 'single' | 'split';
  /** Fração da área de desenho ocupada pela planta. */
  readonly splitRatio: number;
}

export const DEFAULT_LAYOUT: LayoutPrefs = {
  ribbonCollapsed: false,
  navOpen: true,
  panelOpen: true,
  navWidth: 240,
  panelWidth: 340,
  // Planta e modelo 3D lado a lado: o mesmo projeto visto de cima e em volume.
  workspaceLayout: 'split',
  splitRatio: 0.5,
};

export const PANEL_LIMITS = {
  nav: { min: 180, max: 420 },
  panel: { min: 280, max: 560 },
} as const;

const STORAGE_KEY = 'hydrobim.layout.v1';

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(value)));

/** Lê as preferências gravadas, descartando o que não for válido. */
export function parseLayout(text: string | null): LayoutPrefs {
  if (!text) return DEFAULT_LAYOUT;
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null) return DEFAULT_LAYOUT;
    const data = raw as Record<string, unknown>;
    const flag = (key: keyof LayoutPrefs): boolean =>
      typeof data[key] === 'boolean' ? data[key] : (DEFAULT_LAYOUT[key] as boolean);
    const width = (key: 'navWidth' | 'panelWidth', limits: { min: number; max: number }): number =>
      typeof data[key] === 'number' && Number.isFinite(data[key])
        ? clamp(data[key], limits.min, limits.max)
        : DEFAULT_LAYOUT[key];
    return {
      ribbonCollapsed: flag('ribbonCollapsed'),
      navOpen: flag('navOpen'),
      panelOpen: flag('panelOpen'),
      navWidth: width('navWidth', PANEL_LIMITS.nav),
      panelWidth: width('panelWidth', PANEL_LIMITS.panel),
      workspaceLayout: data.workspaceLayout === 'single' ? 'single' : 'split',
      splitRatio:
        typeof data.splitRatio === 'number' && Number.isFinite(data.splitRatio)
          ? Math.min(0.75, Math.max(0.25, data.splitRatio))
          : DEFAULT_LAYOUT.splitRatio,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function readLayout(): LayoutPrefs {
  try {
    return parseLayout(globalThis.localStorage?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function writeLayout(layout: LayoutPrefs): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Sem armazenamento local (modo privado, cota): a preferência vale só nesta sessão.
  }
}

/** Operação de modelagem suspensa enquanto a consulta BIM / IFC está aberta. */
interface Suspended {
  readonly viewMode: '3d' | 'plan';
  readonly tool: ToolId;
  readonly anchor: DrawAnchor | null;
  readonly measure: ReturnType<typeof useEditorStore.getState>['measure'];
}

interface UiState extends LayoutPrefs {
  task: TaskId;
  /** Aba de tarefa a retomar quando a consulta BIM / IFC é encerrada pela troca de vista. */
  returnTask: TaskId;
  suspended: Suspended | null;
  dialog: DialogId | null;
  panelTab: PanelTab;
  validationOpen: boolean;
  planRequest: { command: PlanCommand; nonce: number } | null;
  /** Campo ou seção do painel de propriedades a mostrar (`data-testid`). */
  reveal: { target: string; nonce: number } | null;
  /** Maximização temporária: as duas vistas continuam montadas e conservam suas câmeras. */
  maximizedView: WorkspaceView | null;
  /**
   * Cotas das peças na linha: com uma válvula, tê, cruzeta ou outra peça selecionada, as vistas
   * mostram o tubo de cada extremidade até o próximo elemento. Estado de exibição, não do projeto.
   */
  inlineClearances: boolean;
  /**
   * Percurso em primeira pessoa da consulta BIM / IFC (no lugar da órbita do Modelo 3D). Só vale
   * com a consulta aberta: sair dela encerra o percurso.
   */
  bimWalk: boolean;

  setTask: (task: TaskId) => void;
  setInlineClearances: (shown: boolean) => void;
  /** Abre (entrando na consulta BIM / IFC, se preciso) ou encerra o percurso. */
  setBimWalk: (walking: boolean) => void;
  setRibbonCollapsed: (collapsed: boolean) => void;
  setNavOpen: (open: boolean) => void;
  setPanelOpen: (open: boolean) => void;
  setPanelWidth: (side: 'nav' | 'panel', width: number) => void;
  resetLayout: () => void;
  setWorkspaceLayout: (layout: 'single' | 'split') => void;
  setSplitRatio: (ratio: number) => void;
  maximizeView: (view: WorkspaceView) => void;
  activateWorkspaceView: (view: WorkspaceView) => void;
  openDialog: (dialog: DialogId) => void;
  /** Fecha o diálogo indicado (um diálogo que se fecha não derruba o que abriu em seguida). */
  closeDialog: (dialog: DialogId) => void;
  setPanelTab: (tab: PanelTab) => void;
  setValidationOpen: (open: boolean) => void;
  requestPlan: (command: PlanCommand) => void;
  clearPlanRequest: () => void;
  revealProperty: (target: string) => void;
}

const layoutOf = (state: LayoutPrefs): LayoutPrefs => ({
  ribbonCollapsed: state.ribbonCollapsed,
  navOpen: state.navOpen,
  panelOpen: state.panelOpen,
  navWidth: state.navWidth,
  panelWidth: state.panelWidth,
  workspaceLayout: state.workspaceLayout,
  splitRatio: state.splitRatio,
});

export const useUiStore = create<UiState>()((set, get) => {
  /** Altera preferências de layout e as grava no navegador. */
  const setLayout = (patch: Partial<LayoutPrefs>): void => {
    set(patch);
    writeLayout(layoutOf(get()));
  };

  return {
    ...readLayout(),
    task: 'model',
    returnTask: 'model',
    suspended: null,
    dialog: null,
    panelTab: 'properties',
    validationOpen: false,
    planRequest: null,
    reveal: null,
    maximizedView: null,
    inlineClearances: true,
    bimWalk: false,

    setInlineClearances: (inlineClearances) => set({ inlineClearances }),
    setBimWalk: (walking) => {
      if (walking && get().task !== 'bim') get().setTask('bim');
      set({ bimWalk: walking && useEditorStore.getState().viewMode === 'bim' });
    },
    setTask: (task) => {
      const previous = get().task;
      // Escolher uma aba sempre mostra os seus comandos, mesmo com a faixa recolhida.
      if (get().ribbonCollapsed) setLayout({ ribbonCollapsed: false });
      if (task === previous) return;
      const editor = useEditorStore.getState();
      if (task === 'bim') {
        // A consulta BIM / IFC trabalha sobre o Modelo 3D e não modela. O que estava em
        // andamento (ferramenta, trecho, medição) fica suspenso e volta ao sair.
        const viewMode = editor.viewMode === 'plan' ? 'plan' : '3d';
        const busy = editor.tool !== 'select' && !isAnnotationTool(editor.tool);
        set({
          task,
          returnTask: previous,
          suspended: busy
            ? { viewMode, tool: editor.tool, anchor: editor.anchor, measure: editor.measure }
            : { viewMode, tool: 'select', anchor: null, measure: { a: null, b: null } },
        });
        editor.setViewMode('bim');
        if (busy) {
          editor.notify(
            'info',
            'Consulta BIM / IFC: a operação de modelagem fica suspensa e é retomada ao sair desta aba.',
          );
        }
        return;
      }
      set({ task });
      if (editor.viewMode === 'bim') editor.setViewMode(get().suspended?.viewMode ?? '3d');
    },

    setRibbonCollapsed: (ribbonCollapsed) => setLayout({ ribbonCollapsed }),
    setNavOpen: (navOpen) => setLayout({ navOpen }),
    setPanelOpen: (panelOpen) => setLayout({ panelOpen }),
    setPanelWidth: (side, width) =>
      setLayout(
        side === 'nav'
          ? { navWidth: clamp(width, PANEL_LIMITS.nav.min, PANEL_LIMITS.nav.max) }
          : { panelWidth: clamp(width, PANEL_LIMITS.panel.min, PANEL_LIMITS.panel.max) },
      ),
    resetLayout: () => {
      set({ maximizedView: null });
      setLayout(DEFAULT_LAYOUT);
    },
    setWorkspaceLayout: (workspaceLayout) => {
      const editor = useEditorStore.getState();
      if (editor.viewMode === 'bim') return;
      const entering = workspaceLayout === 'split' && get().workspaceLayout !== 'split';
      set({ maximizedView: null });
      setLayout({ workspaceLayout });
      // A vista combinada abre com uma orientação técnica; a navegação seguinte é independente.
      if (entering) editor.requestIsometric();
    },
    setSplitRatio: (ratio) => {
      if (Number.isFinite(ratio)) setLayout({ splitRatio: Math.min(0.75, Math.max(0.25, ratio)) });
    },
    maximizeView: (view) => {
      const maximizedView = get().maximizedView === view ? null : view;
      set({ maximizedView });
      if (maximizedView) get().activateWorkspaceView(view);
    },
    activateWorkspaceView: (view) => {
      const editor = useEditorStore.getState();
      if (editor.viewMode !== 'bim' && editor.viewMode !== view) editor.setViewMode(view);
    },

    openDialog: (dialog) => set({ dialog }),
    closeDialog: (dialog) => {
      if (get().dialog === dialog) set({ dialog: null });
    },
    setPanelTab: (panelTab) => set({ panelTab }),
    setValidationOpen: (validationOpen) => set({ validationOpen }),
    requestPlan: (command) =>
      set((state) => ({ planRequest: { command, nonce: (state.planRequest?.nonce ?? 0) + 1 } })),
    clearPlanRequest: () => set({ planRequest: null }),
    revealProperty: (target) => {
      if (!get().panelOpen) setLayout({ panelOpen: true });
      set((state) => ({
        panelTab: 'properties',
        reveal: { target, nonce: (state.reveal?.nonce ?? 0) + 1 },
      }));
    },
  };
});

// A store do editor não conhece a interface: esta ligação acompanha o que acontece nela.
useEditorStore.subscribe((state, previous) => {
  const ui = useUiStore.getState();

  // Saída da consulta BIM / IFC (por outra aba de tarefa ou pela troca de vista): retoma a
  // aba anterior e a operação suspensa, se o ponto de partida ainda existir no modelo.
  if (previous.viewMode === 'bim' && state.viewMode !== 'bim') {
    const { suspended } = ui;
    useUiStore.setState({
      suspended: null,
      bimWalk: false,
      ...(ui.task === 'bim' ? { task: ui.returnTask === 'bim' ? 'model' : ui.returnTask } : {}),
    });
    if (suspended && suspended.tool !== 'select' && state.tool === 'select') {
      const port = suspended.anchor?.port ?? null;
      const pipeId = suspended.anchor?.pipeId ?? null;
      const valid =
        (!port || getElement(state.project, port.elementId) !== undefined) &&
        (!pipeId || getElement(state.project, pipeId) !== undefined);
      useEditorStore.setState({
        tool: suspended.tool,
        anchor: valid ? suspended.anchor : null,
        measure: suspended.measure,
      });
    }
  }
  // Entrada na consulta por outro caminho que não a aba (ex.: testes, comandos futuros).
  if (previous.viewMode !== 'bim' && state.viewMode === 'bim' && ui.task !== 'bim') {
    useUiStore.setState({ task: 'bim', returnTask: ui.task });
  }

  // Vista maximizada: escolher a outra vista (aba, navegador, comando) troca a que ocupa a área.
  if (
    ui.maximizedView &&
    state.viewMode !== previous.viewMode &&
    state.viewMode !== 'bim' &&
    state.viewMode !== ui.maximizedView
  ) {
    useUiStore.setState({ maximizedView: state.viewMode });
  }

  // O painel direito acompanha a ferramenta: opções ao criar, propriedades ao selecionar.
  if (state.tool !== previous.tool) {
    const creating = state.tool !== 'select' && !isAnnotationTool(state.tool);
    useUiStore.setState({ panelTab: creating ? 'tool' : 'properties' });
  }
});
