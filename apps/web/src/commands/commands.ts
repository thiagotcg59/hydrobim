import { connectedPortRef, getElement, getPorts, type Project } from '@hydrobim/core';
import {
  Activity,
  ArrowUpDown,
  Box,
  Boxes,
  ClipboardList,
  Columns2,
  Copy,
  Crosshair,
  Eye,
  EyeOff,
  FileBox,
  FileCheck2,
  FileDown,
  FilePlus2,
  FileSpreadsheet,
  FileType2,
  Focus,
  FolderOpen,
  Globe2,
  Grid3x3,
  HardDriveDownload,
  Hexagon,
  Layers,
  LayoutPanelLeft,
  Library,
  Link2,
  ListChecks,
  Map as MapIcon,
  Maximize,
  MessageSquare,
  Mountain,
  MousePointer2,
  Move,
  MoveHorizontal,
  PanelLeft,
  PanelRight,
  PanelTop,
  Redo2,
  RotateCw,
  Ruler,
  Save,
  ScanSearch,
  Search,
  Spline,
  SquareArrowUp,
  Table2,
  Tag,
  Trash2,
  TrendingUp,
  Type,
  Undo2,
  Unlink,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import { ISO_LABELS, isIsoQuadrant } from '../editor/viewPresets';
import { exportPlanDxfFile } from '../plan/planExport';
import {
  isAnnotationTool,
  useEditorStore,
  type ProjectDialogTab,
  type ToolId,
  type ViewMode,
  type ViewPreset,
} from '../state/editorStore';
import {
  confirmDiscard,
  exportCurrentProject,
  exportEpanetFile,
  exportIdsFile,
  exportIfcFile,
  exportModelDxfFile,
  exportQuantitiesFile,
  saveCurrentProject,
} from '../state/projectActions';
import { useUiStore, type TaskId } from '../state/uiStore';
import { useTerrainStore, type TerrainMode } from '../terrain/terrainStore';
import { TOOL_HINTS, TOOL_LABELS } from '../ui/labels';
import { ELEMENT_ICONS } from '../ui/EngineeringIcons';

/**
 * Registro único dos comandos da interface. A faixa de comandos, os atalhos de teclado, o
 * menu Arquivo e a busca de comandos leem daqui: rótulo, atalho, disponibilidade (com o
 * motivo) e execução têm uma só definição.
 */

/** Retrato do estado de que a disponibilidade dos comandos depende. */
export interface CommandContext {
  readonly project: Project;
  readonly tool: ToolId;
  readonly viewMode: ViewMode;
  readonly selection: readonly string[];
  readonly annotationSelection: string | null;
  readonly orthographic: boolean;
  readonly viewPreset: ViewPreset | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly bimHiddenCount: number;
  readonly task: TaskId;
  readonly navOpen: boolean;
  readonly panelOpen: boolean;
  readonly ribbonCollapsed: boolean;
  readonly validationOpen: boolean;
  /** Disposição da área de desenho: uma vista por vez ou planta e modelo 3D lado a lado. */
  readonly workspaceLayout?: 'single' | 'split';
  /** Vista que ocupa sozinha a área de desenho, quando uma delas está maximizada. */
  readonly maximizedView?: 'plan' | '3d' | null;
  /** Operação do terreno em andamento na Planta Infra e painel do terreno aberto. */
  readonly terrainMode?: TerrainMode | null;
  readonly terrainPanelOpen?: boolean;
}

export interface CommandState {
  readonly enabled: boolean;
  /** Por que o comando está indisponível (mostrado na dica e na busca). */
  readonly reason?: string;
  /** Comando em uso (ferramenta ativa, opção ligada). */
  readonly active?: boolean;
  /** Estado exposto como atributos `data-*` do botão (ex.: quadrante da isométrica). */
  readonly data?: Readonly<Record<string, string>>;
}

/** O que uma saída de exportação contém e exige (aba Exportação). */
export interface ExportDetails {
  readonly kind: 'Modelo' | 'Planta' | 'Dados';
  readonly format: string;
  readonly content: string;
  readonly options: string;
  readonly requirements: string;
}

export interface Command {
  readonly id: string;
  readonly label: string;
  /** Finalidade, em uma frase. */
  readonly description: string;
  readonly icon: LucideIcon;
  /** Atalho como aparece ao usuário (ex.: "T", "Ctrl+S"). */
  readonly shortcut?: string;
  readonly testId: string;
  /** Recurso ainda não implementado: aparece desabilitado, com a fase do roadmap. */
  readonly phase?: string;
  readonly details?: ExportDetails;
  readonly state?: (context: CommandContext) => CommandState;
  readonly run: () => void;
}

const editor = () => useEditorStore.getState();
const ui = () => useUiStore.getState();

const ENABLED: CommandState = { enabled: true };
const off = (reason: string): CommandState => ({ enabled: false, reason });

const BIM_REASON =
  'A consulta BIM / IFC não modela: escolha outra aba de tarefa para voltar à modelagem.';
const NO_ELEMENTS = 'O projeto ainda não tem elementos.';

function selected(context: CommandContext) {
  return context.selection
    .map((id) => getElement(context.project, id))
    .filter((element) => element !== undefined);
}

/** Único elemento selecionado, ou o motivo de não haver um. */
function single(context: CommandContext) {
  const elements = selected(context);
  return elements.length === 1 ? elements[0] : undefined;
}

function freePortsOf(context: CommandContext) {
  const element = single(context);
  if (!element) return [];
  return getPorts(element).filter((port) => !connectedPortRef(context.project, port.ref));
}

const modeling = (context: CommandContext): CommandState | null =>
  context.viewMode === 'bim' ? off(BIM_REASON) : null;

/**
 * O modelo 3D está fora da tela: a planta ocupa a área de desenho (uma vista por vez ou
 * maximizada). Lado a lado, os comandos de câmera valem mesmo com a planta ativa.
 */
const modelHidden = (context: CommandContext): boolean =>
  context.viewMode === 'plan' && !(context.workspaceLayout === 'split' && !context.maximizedView);

const TOOL_ICONS: Record<ToolId, LucideIcon> = {
  select: MousePointer2,
  ...ELEMENT_ICONS,
  measure: Ruler,
  connect: Waypoints,
  move: Move,
  dimension: MoveHorizontal,
  text: Type,
  leader: MessageSquare,
  tag: Tag,
};

// "Mover" não é ferramenta da faixa: começa pelo comando Modificar › Mover ou pelo menu do
// botão direito, sempre com elementos a deslocar.
const TOOL_KEYS: Record<Exclude<ToolId, 'move'>, string> = {
  select: 'S',
  pipe: 'T',
  elbow: 'J',
  tee: 'E',
  reducer: 'R',
  valve: 'V',
  pump: 'B',
  tank: 'Q',
  measure: 'M',
  connect: 'A',
  dimension: 'C',
  text: 'X',
  leader: 'L',
  tag: 'I',
};

function toolCommand(tool: Exclude<ToolId, 'move'>): Command {
  return {
    id: `tool.${tool}`,
    label: TOOL_LABELS[tool],
    description: isAnnotationTool(tool)
      ? `${TOOL_HINTS[tool]} Atua na planta (a vista é aberta ao escolher a ferramenta).`
      : TOOL_HINTS[tool],
    icon: TOOL_ICONS[tool],
    shortcut: TOOL_KEYS[tool],
    testId: `tool-${tool}`,
    state: (context) => {
      if (context.viewMode === 'bim' && tool !== 'select') return off(BIM_REASON);
      return { enabled: true, active: context.tool === tool };
    },
    run: () => editor().setTool(tool),
  };
}

function viewCommand(
  preset: Exclude<ViewPreset, 'fit'>,
  label: string,
  description: string,
  icon: LucideIcon,
  testId: string,
): Command {
  return {
    id: `view.${preset}`,
    label,
    description,
    icon,
    testId,
    state: (context) =>
      modelHidden(context)
        ? off('Disponível no Modelo 3D: a planta é sempre vista de cima.')
        : ENABLED,
    run: () => editor().requestView(preset),
  };
}

/** Mostra, no painel de propriedades, o campo que executa a modificação. */
function revealCommand(
  id: string,
  label: string,
  description: string,
  icon: LucideIcon,
  target: string,
  state: (context: CommandContext) => CommandState,
): Command {
  return {
    id,
    label,
    description: `${description} O campo fica no painel de propriedades.`,
    icon,
    testId: id.replace('.', '-'),
    state: (context) => modeling(context) ?? state(context),
    run: () => ui().revealProperty(target),
  };
}

function projectDialogCommand(
  id: string,
  label: string,
  description: string,
  icon: LucideIcon,
  tab: ProjectDialogTab,
): Command {
  return {
    id,
    label,
    description,
    icon,
    testId: id.replace('.', '-'),
    run: () => editor().openProjectDialog(tab),
  };
}

const terrain = () => useTerrainStore.getState();

/** As operações do terreno existem na Planta Infra. */
const infraOnly = (context: CommandContext): CommandState | null =>
  context.viewMode === 'bim'
    ? off(BIM_REASON)
    : context.project.discipline !== 'infra'
      ? off('Disponível no ambiente Infra (seletor "Ambiente", no cabeçalho).')
      : null;

function terrainModeCommand(
  mode: TerrainMode,
  label: string,
  description: string,
  icon: LucideIcon,
  needsSurface: boolean,
): Command {
  return {
    id: `terrain.${mode}`,
    label,
    description: `${description} Atua na Planta Infra (a vista é aberta ao escolher o comando).`,
    icon,
    testId: `terrain-cmd-${mode}`,
    state: (context) =>
      infraOnly(context) ??
      (needsSurface && !context.project.terrain
        ? off('O projeto ainda não tem superfície de terreno (Superfície do terreno).')
        : { enabled: true, active: context.terrainMode === mode }),
    run: () => {
      const active = terrain().mode === mode;
      if (mode === 'area' && !active) terrain().setPanelOpen(true);
      terrain().setMode(active ? null : mode);
    },
  };
}

const hasElements = (context: CommandContext): CommandState =>
  context.project.elements.length > 0 ? ENABLED : off(NO_ELEMENTS);

const TOOLS: Exclude<ToolId, 'move'>[] = [
  'select',
  'pipe',
  'elbow',
  'tee',
  'reducer',
  'valve',
  'pump',
  'tank',
  'measure',
  'connect',
  'dimension',
  'text',
  'leader',
  'tag',
];

export const COMMANDS: readonly Command[] = [
  // ----- Arquivo -----
  {
    id: 'file.new',
    label: 'Novo projeto',
    description: 'Começa um projeto vazio no ambiente atual.',
    icon: FilePlus2,
    testId: 'action-new',
    run: () => {
      if (confirmDiscard()) editor().newProject(editor().project.discipline);
    },
  },
  {
    id: 'file.open',
    label: 'Abrir projeto…',
    description:
      'Projetos salvos neste navegador, arquivo .hydrobim.json ou o projeto de demonstração.',
    icon: FolderOpen,
    testId: 'action-open',
    run: () => ui().openDialog('open'),
  },
  {
    id: 'file.save',
    label: 'Salvar',
    description:
      'Salva no navegador: o projeto fica guardado neste computador e neste navegador, e reabre sozinho na próxima visita.',
    icon: Save,
    shortcut: 'Ctrl+S',
    testId: 'action-save',
    run: () => void saveCurrentProject(),
  },
  {
    id: 'file.download',
    label: 'Baixar arquivo .hydrobim.json',
    description:
      'Baixa o projeto como arquivo nativo, para guardar cópia, enviar a outra pessoa ou abrir em outro computador.',
    icon: HardDriveDownload,
    testId: 'action-export',
    run: exportCurrentProject,
  },
  {
    id: 'edit.undo',
    label: 'Desfazer',
    description: 'Desfaz a última alteração do modelo.',
    icon: Undo2,
    shortcut: 'Ctrl+Z',
    testId: 'action-undo',
    state: (context) => (context.canUndo ? ENABLED : off('Não há alteração a desfazer.')),
    run: () => editor().undo(),
  },
  {
    id: 'edit.redo',
    label: 'Refazer',
    description: 'Refaz a alteração desfeita.',
    icon: Redo2,
    shortcut: 'Ctrl+Y',
    testId: 'action-redo',
    state: (context) => (context.canRedo ? ENABLED : off('Não há alteração a refazer.')),
    run: () => editor().redo(),
  },

  // ----- Ferramentas -----
  ...TOOLS.map(toolCommand),

  // ----- Modificar -----
  {
    id: 'modify.move',
    label: 'Mover',
    description:
      'Desloca a seleção indicando o ponto-base e o destino na vista, com a prévia do resultado (também no botão direito sobre o elemento). O deslocamento numérico ΔX, ΔY e ΔZ fica no painel de propriedades.',
    icon: Move,
    testId: 'modify-move',
    state: (context) =>
      modeling(context) ??
      (selected(context).length > 0
        ? { enabled: true, active: context.tool === 'move' }
        : off('Selecione um ou mais elementos para mover.')),
    run: () => editor().startMove(),
  },
  revealCommand(
    'modify.copy',
    'Copiar',
    'Copia a seleção a um deslocamento ΔX, ΔY e ΔZ.',
    Copy,
    'move-dx',
    (context) =>
      selected(context).length > 0 ? ENABLED : off('Selecione um ou mais elementos para copiar.'),
  ),
  {
    id: 'modify.delete',
    label: 'Excluir',
    description: 'Exclui os elementos ou a anotação selecionados.',
    icon: Trash2,
    shortcut: 'Del',
    testId: 'modify-delete',
    state: (context) =>
      modeling(context) ??
      (context.selection.length > 0 || context.annotationSelection !== null
        ? ENABLED
        : off('Nada selecionado.')),
    run: () => editor().deleteSelected(),
  },
  revealCommand(
    'modify.length',
    'Comprimento',
    'Ajusta o comprimento do tubo selecionado.',
    Ruler,
    'prop-length',
    (context) => (single(context)?.kind === 'pipe' ? ENABLED : off('Selecione um único tubo.')),
  ),
  revealCommand(
    'modify.elevation',
    'Elevação',
    'Altera a cota do elemento; tubos e conexões levam junto o que estiver conectado.',
    ArrowUpDown,
    'prop-elevation',
    (context) => (single(context) ? ENABLED : off('Selecione um único elemento.')),
  ),
  revealCommand(
    'modify.rotate',
    'Girar',
    'Gira a peça em torno do eixo de uma de suas portas.',
    RotateCw,
    'prop-roll-port',
    (context) => {
      const element = single(context);
      if (!element) return off('Selecione uma única conexão, válvula ou equipamento.');
      return element.kind === 'pipe'
        ? off('Tubos não giram em torno do eixo: selecione uma conexão, válvula ou equipamento.')
        : ENABLED;
    },
  ),

  // ----- Conectar -----
  {
    id: 'connect.pipe',
    label: 'Tubo da extremidade',
    description:
      'Aciona a ferramenta Tubulação partindo da extremidade livre do elemento selecionado (o mesmo comando do botão direito).',
    icon: Spline,
    testId: 'connect-pipe',
    state: (context) => {
      const blocked = modeling(context);
      if (blocked) return blocked;
      if (!single(context)) return off('Selecione um único elemento com extremidade livre.');
      return freePortsOf(context).length > 0
        ? ENABLED
        : off('O elemento selecionado não tem extremidade livre.');
    },
    run: () => {
      const state = editor();
      const element = state.selection.length === 1 ? state.selection[0] : undefined;
      const target = element ? getElement(state.project, element) : undefined;
      const port = target
        ? getPorts(target).find((item) => !connectedPortRef(state.project, item.ref))
        : undefined;
      if (port) state.startPipeFromPort(port.ref);
    },
  },
  revealCommand(
    'connect.close',
    'Ligar extremidades',
    'Fechamento assistido: liga as extremidades livres de dois elementos com tubos e joelhos da especificação.',
    Link2,
    'section-close',
    (context) =>
      selected(context).length === 2
        ? ENABLED
        : off('Selecione exatamente dois elementos com extremidades livres.'),
  ),
  {
    id: 'connect.junction',
    label: 'Converter tê ⇄ cruzeta',
    description:
      'Troca o tê selecionado por cruzeta (quarta porta livre) ou a cruzeta por tê (só com uma derivação livre), mantendo o elemento e as ligações. Mostra a prévia antes de confirmar.',
    icon: Crosshair,
    testId: 'connect-junction',
    state: (context) => {
      const blocked = modeling(context);
      if (blocked) return blocked;
      const element = single(context);
      return element?.kind === 'tee' || element?.kind === 'cross'
        ? ENABLED
        : off('Selecione um único tê ou cruzeta.');
    },
    run: () => {
      const state = editor();
      const id = state.selection.length === 1 ? state.selection[0] : undefined;
      if (!id) return;
      state.previewJunction(id, null);
      ui().revealProperty('section-junction');
    },
  },
  revealCommand(
    'connect.disconnect',
    'Desconectar',
    'Desfaz a conexão de uma porta do elemento selecionado.',
    Unlink,
    'section-ports',
    (context) => {
      const element = single(context);
      if (!element) return off('Selecione um único elemento.');
      return getPorts(element).some((port) => connectedPortRef(context.project, port.ref))
        ? ENABLED
        : off('O elemento selecionado não tem portas conectadas.');
    },
  ),

  // ----- Catálogo -----
  {
    id: 'catalog.open',
    label: 'Catálogo',
    description:
      'Famílias de conexões e válvulas, flanges e tubos flangeados, reservatórios e biblioteca de produtos.',
    icon: Library,
    testId: 'action-families',
    run: () => ui().openDialog('families'),
  },

  // ----- Documentação (recursos futuros) -----
  {
    id: 'doc.sheets',
    label: 'Pranchas',
    description: 'Pranchas com carimbo e exportação em PDF.',
    icon: LayoutPanelLeft,
    testId: 'doc-sheets',
    phase: 'Fase 4',
    run: () => undefined,
  },
  {
    id: 'doc.levelDimensions',
    label: 'Cotas de nível',
    description: 'Cotas de nível, angulares e em cadeia.',
    icon: ArrowUpDown,
    testId: 'doc-level-dimensions',
    phase: 'Fase 4',
    run: () => undefined,
  },

  // ----- Vistas -----
  {
    id: 'view.model',
    label: 'Modelo 3D',
    description: 'Vista do modelo 3D. A ferramenta e o trecho em andamento continuam.',
    icon: Box,
    testId: 'view-mode-3d',
    state: (context) => ({ enabled: true, active: context.viewMode !== 'plan' }),
    run: () => editor().setViewMode('3d'),
  },
  {
    id: 'view.plan',
    label: 'Planta',
    description:
      'Planta do ambiente atual (MEP ou Infra). A ferramenta e o trecho em andamento continuam.',
    icon: MapIcon,
    testId: 'view-mode-plan',
    state: (context) => ({ enabled: true, active: context.viewMode === 'plan' }),
    run: () => editor().setViewMode('plan'),
  },
  {
    id: 'view.fit',
    label: 'Enquadrar',
    description: 'Enquadra os elementos selecionados ou, sem seleção, todo o projeto.',
    icon: Maximize,
    testId: 'view-fit',
    // Com seleção, enquadrar o projeto inteiro tiraria de vista justamente o que se está editando.
    run: () =>
      editor().selection.length > 0
        ? editor().requestView('fit', { selection: true })
        : editor().requestView('fit'),
  },
  {
    id: 'view.fitSelection',
    label: 'Enquadrar seleção',
    description: 'Enquadra os elementos selecionados.',
    icon: Focus,
    testId: 'view-fit-selection',
    state: (context) =>
      context.selection.length > 0 ? ENABLED : off('Selecione um ou mais elementos.'),
    run: () => editor().requestView('fit', { selection: true }),
  },
  viewCommand('iso', 'Perspectiva', 'Vista em perspectiva de três quartos.', Box, 'view-iso'),
  {
    id: 'view.isometric',
    label: 'Isométrica',
    description:
      'Isométrica ortográfica verdadeira (eixos a 120°, mesma escala nos três). Repita para girar de quadrante.',
    icon: Boxes,
    testId: 'view-isometric',
    state: (context) => {
      if (modelHidden(context))
        return off('Disponível no Modelo 3D: a planta é sempre vista de cima.');
      const quadrant =
        context.orthographic && isIsoQuadrant(context.viewPreset) ? context.viewPreset : null;
      return { enabled: true, active: quadrant !== null, data: { quadrant: quadrant ?? 'none' } };
    },
    run: () => editor().requestIsometric(),
  },
  viewCommand('top', 'Topo', 'Vista de cima.', SquareArrowUp, 'view-top'),
  viewCommand('front', 'Elevação', 'Vista frontal (elevação).', Eye, 'view-front'),
  {
    id: 'view.ortho',
    label: 'Ortográfica',
    description: 'Projeção ortográfica: plantas e elevações em verdadeira grandeza.',
    icon: Grid3x3,
    testId: 'view-ortho',
    state: (context) =>
      modelHidden(context)
        ? off('Disponível no Modelo 3D: a planta já é ortográfica.')
        : { enabled: true, active: context.orthographic },
    run: () => editor().setOrthographic(!editor().orthographic),
  },

  // ----- Painéis e layout -----
  {
    id: 'view.split',
    label: 'Lado a lado',
    description:
      'Planta à esquerda e Modelo 3D à direita, com divisor ajustável: o mesmo projeto, a mesma seleção. Desligado, a área de desenho mostra uma vista por vez.',
    icon: Columns2,
    testId: 'view-split',
    state: (context) =>
      context.viewMode === 'bim'
        ? off('A consulta BIM / IFC usa só o Modelo 3D.')
        : { enabled: true, active: context.workspaceLayout === 'split' },
    run: () => ui().setWorkspaceLayout(ui().workspaceLayout === 'split' ? 'single' : 'split'),
  },
  {
    id: 'layout.nav',
    label: 'Navegador',
    description: 'Mostra ou recolhe o navegador do projeto, à esquerda.',
    icon: PanelLeft,
    testId: 'layout-nav',
    state: (context) => ({ enabled: true, active: context.navOpen }),
    run: () => ui().setNavOpen(!ui().navOpen),
  },
  {
    id: 'layout.panel',
    label: 'Propriedades',
    description: 'Mostra ou recolhe o painel de propriedades, à direita.',
    icon: PanelRight,
    testId: 'layout-panel',
    state: (context) => ({ enabled: true, active: context.panelOpen }),
    run: () => ui().setPanelOpen(!ui().panelOpen),
  },
  {
    id: 'layout.ribbon',
    label: 'Faixa de comandos',
    description: 'Recolhe ou mostra a faixa de comandos, para ampliar a área de desenho.',
    icon: PanelTop,
    testId: 'layout-ribbon',
    state: (context) => ({ enabled: true, active: !context.ribbonCollapsed }),
    run: () => ui().setRibbonCollapsed(!ui().ribbonCollapsed),
  },
  {
    id: 'layout.reset',
    label: 'Restaurar layout',
    description: 'Volta painéis, larguras e faixa de comandos à disposição padrão.',
    icon: LayoutPanelLeft,
    testId: 'layout-reset',
    run: () => {
      ui().resetLayout();
      editor().notify('info', 'Layout padrão restaurado.');
    },
  },
  {
    id: 'help.commands',
    label: 'Buscar comando',
    description: 'Localiza um comando pelo nome e mostra onde ele fica.',
    icon: Search,
    shortcut: 'Ctrl+K',
    testId: 'command-search',
    run: () => ui().openDialog('commands'),
  },

  // ----- Análise -----
  {
    id: 'analysis.validation',
    label: 'Pendências',
    description:
      'Lista as pendências de validação do modelo (conectividade, compatibilidade, peças genéricas).',
    icon: ListChecks,
    testId: 'analysis-validation',
    state: (context) => ({ enabled: true, active: context.validationOpen }),
    run: () => ui().setValidationOpen(!ui().validationOpen),
  },
  projectDialogCommand(
    'analysis.clashes',
    'Interferências',
    'Tubos cujas paredes se interpenetram. Limite: conexões, válvulas e equipamentos ainda não são analisados.',
    ScanSearch,
    'clashes',
  ),
  projectDialogCommand(
    'analysis.quantities',
    'Quantitativo',
    'Lista de materiais do modelo: tubos por comprimento, conexões, válvulas e equipamentos por unidade.',
    Table2,
    'quantities',
  ),
  projectDialogCommand(
    'analysis.profile',
    'Perfil longitudinal',
    'Perfil do trecho selecionado: eixo, geratriz superior, terreno e recobrimento. Abre em diálogo (ainda não é uma vista sincronizada).',
    Activity,
    'profile',
  ),

  // ----- BIM / IFC -----
  {
    id: 'bim.isolate',
    label: 'Isolar seleção',
    description: 'Mostra no visualizador só os elementos selecionados.',
    icon: Focus,
    testId: 'bim-isolate-selection',
    state: (context) =>
      context.selection.length > 0 ? ENABLED : off('Selecione um ou mais elementos.'),
    run: () => editor().isolateBim(editor().selection),
  },
  {
    id: 'bim.hide',
    label: 'Ocultar seleção',
    description: 'Oculta no visualizador os elementos selecionados.',
    icon: EyeOff,
    testId: 'bim-hide-selection',
    state: (context) =>
      context.selection.length > 0 ? ENABLED : off('Selecione um ou mais elementos.'),
    run: () => editor().setBimHidden(editor().selection, true),
  },
  {
    id: 'bim.library',
    label: 'Classificação da biblioteca',
    description: 'Entidade e tipo IFC de todas as famílias da biblioteca.',
    icon: Library,
    testId: 'bim-library',
    run: () => ui().openDialog('ifcLibrary'),
  },

  // ----- Exportação -----
  {
    id: 'export.ifc',
    label: 'IFC 4.3',
    description: 'Exporta o modelo em IFC 4.3, com o modelo de informação da aba BIM / IFC.',
    icon: FileBox,
    testId: 'action-export-ifc',
    details: {
      kind: 'Modelo',
      format: '.ifc (IFC4X3_ADD2)',
      content:
        'Estrutura espacial, elementos com tipos (Ifc…Type), portas e conexões, sistemas, materiais, conjuntos de propriedades e de quantidades.',
      options: 'Georreferência incluída só quando informada em Gerenciar › Georreferência.',
      requirements: 'Ao menos um elemento no projeto.',
    },
    state: hasElements,
    run: exportIfcFile,
  },
  {
    id: 'export.dxfModel',
    label: 'DXF do modelo 3D',
    description: 'Exporta o modelo 3D em DXF (malhas em metros, uma camada por sistema).',
    icon: FileType2,
    testId: 'action-export-dxf',
    details: {
      kind: 'Modelo',
      format: '.dxf (R12, malhas poliface)',
      content: 'Geometria 3D de todos os elementos, em metros, nas coordenadas do projeto.',
      options: 'Uma camada por sistema hidráulico.',
      requirements: 'Ao menos um elemento no projeto.',
    },
    state: hasElements,
    run: exportModelDxfFile,
  },
  {
    id: 'export.dxfPlan',
    label: 'DXF da planta',
    description:
      'Exporta a planta em DXF: desenho em metros, camadas REDE_* por categoria, cotas como DIMENSION e conexões como blocos.',
    icon: FileType2,
    testId: 'plan-export-dxf',
    details: {
      kind: 'Planta',
      format: '.dxf (R2000)',
      content:
        'Planta com linhas ocultas removidas, cotas, textos, chamadas e etiquetas, em metros e nas coordenadas do projeto.',
      options:
        'Anotações dimensionadas pela escala de documentação do ambiente (Documentação › Escala).',
      requirements: 'Ao menos um elemento visível ou uma anotação. Não depende da vista aberta.',
    },
    state: hasElements,
    run: exportPlanDxfFile,
  },
  {
    id: 'export.svgPlan',
    label: 'SVG da planta',
    description:
      'Exporta a planta em SVG, no tamanho físico da escala de documentação. Abre a planta, se ela não estiver aberta.',
    icon: FileDown,
    testId: 'plan-export-svg',
    details: {
      kind: 'Planta',
      format: '.svg',
      content:
        'O desenho da planta como está na tela. No MEP, o desenho todo; no Infra, a janela visível, com o sistema de referência na legenda e sem a imagem de fundo.',
      options: 'Escala de documentação e tema (colorido ou preto e branco) da planta.',
      requirements:
        'Ao menos um elemento visível ou uma anotação. O desenho vem da vista: a planta é aberta para gerar o arquivo.',
    },
    state: hasElements,
    run: () => {
      // O SVG é o desenho da planta: sem ela aberta não há o que copiar.
      if (editor().viewMode !== 'plan') {
        if (ui().task === 'bim') ui().setTask('export');
        editor().setViewMode('plan');
      }
      ui().requestPlan({ kind: 'exportSvg' });
    },
  },
  {
    id: 'export.csv',
    label: 'Quantitativo CSV',
    description: 'Exporta o quantitativo (lista de materiais) em CSV.',
    icon: FileSpreadsheet,
    testId: 'action-export-csv',
    details: {
      kind: 'Dados',
      format: '.csv',
      content:
        'Uma linha por sistema, categoria, especificação e diâmetro: tubos em metros, peças em unidades, com a família de catálogo.',
      options: 'Nenhuma.',
      requirements: 'Ao menos um elemento no projeto.',
    },
    state: hasElements,
    run: exportQuantitiesFile,
  },
  {
    id: 'export.epanet',
    label: 'EPANET INP',
    description: 'Exporta a rede no formato INP do EPANET.',
    icon: Waypoints,
    testId: 'action-export-epanet',
    details: {
      kind: 'Dados',
      format: '.inp',
      content: 'Nós e trechos da rede com cotas, comprimentos e diâmetros internos.',
      options: 'Nenhuma.',
      requirements:
        'Ao menos um elemento. Demandas, padrões e perdas localizadas não são exportados: complete-os no EPANET.',
    },
    state: hasElements,
    run: exportEpanetFile,
  },
  {
    id: 'export.ids',
    label: 'Requisitos IDS',
    description:
      'Exporta o perfil de requisitos de informação do projeto em IDS 1.0 (buildingSMART).',
    icon: FileCheck2,
    testId: 'action-export-ids',
    details: {
      kind: 'Dados',
      format: '.ids (IDS 1.0)',
      content:
        'Requisitos de informação do perfil do HydroBIM: propriedades exigidas por classe IFC.',
      options: 'Perfil fixo (o do registro de propriedades); ainda não é editável.',
      requirements: 'Nenhum. Ainda não conferido com ferramenta externa (ifctester).',
    },
    run: exportIdsFile,
  },
  {
    id: 'export.details',
    label: 'Sobre as saídas',
    description: 'Conteúdo, opções e requisitos de cada formato de exportação.',
    icon: ClipboardList,
    testId: 'export-details',
    run: () => ui().openDialog('export'),
  },

  // ----- Gerenciar -----
  projectDialogCommand(
    'manage.levels',
    'Níveis',
    'Níveis e pavimentos: planos de trabalho e pavimentos da exportação IFC.',
    Layers,
    'levels',
  ),
  projectDialogCommand(
    'manage.systems',
    'Sistemas',
    'Sistemas hidráulicos: nome, tipo, cor e visibilidade.',
    Waypoints,
    'systems',
  ),
  projectDialogCommand(
    'manage.georeference',
    'Georreferência',
    'Sistema de referência e coordenadas da origem do modelo.',
    Globe2,
    'georeference',
  ),
  projectDialogCommand(
    'manage.terrain',
    'Terreno',
    'Resumo e procedência do terreno do projeto; importação simples de pontos XYZ. A geração por área, DEM, GeoTIFF e levantamento com linhas de quebra fica em Superfície do terreno (ambiente Infra).',
    Mountain,
    'terrain',
  ),

  // ----- Terreno (ambiente Infra) -----
  {
    id: 'terrain.panel',
    label: 'Superfície do terreno',
    description:
      'Gera a superfície do terreno (TIN) dentro de uma área: DEM online, GeoTIFF ou levantamento com pontos e linhas de quebra. Abre o painel sobre a Planta Infra.',
    icon: Mountain,
    testId: 'terrain-cmd-panel',
    state: (context) =>
      infraOnly(context) ?? { enabled: true, active: context.terrainPanelOpen === true },
    run: () => terrain().setPanelOpen(!terrain().panelOpen),
  },
  terrainModeCommand(
    'area',
    'Área do terreno',
    'Desenha na planta o contorno da área em que a superfície será gerada.',
    Hexagon,
    false,
  ),
  terrainModeCommand(
    'profile',
    'Corte do terreno',
    'Traça um corte longitudinal na planta e mostra o perfil topográfico ao longo dele.',
    TrendingUp,
    true,
  ),
  terrainModeCommand(
    'query',
    'Consultar cota',
    'Fixa um ponto sobre a superfície e mostra a cota e a declividade do terreno nele.',
    Crosshair,
    true,
  ),
];

const BY_ID = new Map(COMMANDS.map((command) => [command.id, command]));

export function getCommand(id: string): Command {
  const command = BY_ID.get(id);
  if (!command) throw new Error(`Comando desconhecido: ${id}`);
  return command;
}

/** Estado de um comando: recursos futuros ficam sempre indisponíveis, com a fase. */
export function commandState(command: Command, context: CommandContext): CommandState {
  if (command.phase) return off(`Recurso previsto para a ${command.phase} do roadmap.`);
  return command.state?.(context) ?? ENABLED;
}

/** Texto da dica: nome, finalidade, atalho e, se for o caso, por que está indisponível. */
export function commandTitle(command: Command, state: CommandState): string {
  const head = command.shortcut ? `${command.label} (${command.shortcut})` : command.label;
  const lines = [head, command.description];
  if (state.active && command.id === 'view.isometric') {
    const preset = editor().viewRequest?.preset;
    if (isIsoQuadrant(preset)) lines.push(`Observador a ${ISO_LABELS[preset]}.`);
  }
  if (!state.enabled && state.reason) lines.push(`Indisponível: ${state.reason}`);
  return lines.join('\n');
}

/** Executa o comando se estiver disponível; caso contrário, informa o motivo. */
export function runCommand(id: string, context: CommandContext = commandContext()): boolean {
  const command = getCommand(id);
  const state = commandState(command, context);
  if (!state.enabled) {
    if (state.reason) editor().notify('info', `${command.label}: ${state.reason}`);
    return false;
  }
  command.run();
  return true;
}

export function commandContext(): CommandContext {
  const state = editor();
  const layout = ui();
  return {
    project: state.project,
    tool: state.tool,
    viewMode: state.viewMode,
    selection: state.selection,
    annotationSelection: state.annotationSelection,
    orthographic: state.orthographic,
    viewPreset: state.viewRequest?.preset ?? null,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    bimHiddenCount: state.bimHidden.length,
    task: layout.task,
    navOpen: layout.navOpen,
    panelOpen: layout.panelOpen,
    ribbonCollapsed: layout.ribbonCollapsed,
    validationOpen: layout.validationOpen,
    workspaceLayout: layout.workspaceLayout,
    maximizedView: layout.maximizedView,
    terrainMode: terrain().mode,
    terrainPanelOpen: terrain().panelOpen,
  };
}

interface KeyStroke {
  readonly key: string;
  readonly ctrl: boolean;
  readonly shift: boolean;
}

function parseShortcut(shortcut: string): KeyStroke {
  const parts = shortcut.toLowerCase().split('+');
  const key = parts[parts.length - 1] ?? '';
  return {
    key: key === 'del' ? 'delete' : key,
    ctrl: parts.includes('ctrl'),
    shift: parts.includes('shift'),
  };
}

const SHORTCUTS = COMMANDS.filter((command) => command.shortcut !== undefined).map((command) => ({
  id: command.id,
  stroke: parseShortcut(command.shortcut ?? ''),
}));

/** Comando do atalho pressionado (Ctrl+Shift+Z também refaz). */
export function commandForKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): string | null {
  if (event.altKey) return null;
  const key = event.key.toLowerCase();
  const ctrl = event.ctrlKey || event.metaKey;
  if (ctrl && event.shiftKey && key === 'z') return 'edit.redo';
  const match = SHORTCUTS.find(
    ({ stroke }) => stroke.key === key && stroke.ctrl === ctrl && stroke.shift === event.shiftKey,
  );
  return match?.id ?? null;
}

/** Comandos que valem mesmo com o foco em um campo de texto. */
export const GLOBAL_SHORTCUTS: ReadonlySet<string> = new Set(['file.save', 'help.commands']);
