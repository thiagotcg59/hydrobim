import { DRAWING_SCALES, type DimensionMode } from '@hydrobim/core';
import { ChevronDown, ChevronUp, Minus, Search, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { commandState, getCommand, type CommandContext } from '../commands/commands';
import { useCommandContext } from '../commands/useCommands';
import { InfraControls } from '../infra/InfraPanel';
import { DIMENSION_MODE_LABELS } from '../plan/AnnotationInspector';
import { TerrainDisplayControls } from '../terrain/TerrainDisplayControls';
import { useEditorStore, type PlanTheme } from '../state/editorStore';
import { useIfcState } from '../state/ifcModel';
import { TASK_LABELS, TASKS, useUiStore, type TaskId } from '../state/uiStore';
import { CommandButton } from './CommandButton';
import { ElbowIcon, PumpIcon } from './EngineeringIcons';

/**
 * Faixa de comandos: uma aba por tarefa, com os comandos agrupados. Trocar de aba só muda os
 * comandos à mostra — não altera o ambiente, o modelo, a vista nem a operação em andamento
 * (a exceção, declarada, é a consulta BIM / IFC, que suspende a modelagem enquanto aberta).
 */

type Item =
  | {
      readonly command: string;
      /** Comando secundário: só o ícone em telas estreitas (o nome fica na dica). */
      readonly compact?: boolean;
      readonly label?: string;
      readonly testId?: string;
    }
  | {
      /** Botão com seta: abre os comandos relacionados (ex.: tipos de conexão). */
      readonly menu: string;
      readonly label: string;
      readonly description: string;
      readonly icon: LucideIcon;
      readonly commands: readonly string[];
    }
  | {
      readonly widget: (context: CommandContext) => ReactNode;
      readonly key: string;
      /** Controles empilhados, para grupos estreitos. */
      readonly column?: boolean;
    };

interface Group {
  readonly id: string;
  readonly label: string;
  readonly items: readonly Item[];
  /** Grupo contextual: só aparece quando faz sentido (ex.: mapa, no ambiente Infra). */
  readonly when?: (context: CommandContext) => boolean;
}

const isInfra = (context: CommandContext): boolean => context.project.discipline === 'infra';

/** Escala de documentação da planta do ambiente (cada ambiente tem a sua). */
function ScaleField() {
  const infra = useEditorStore((s) => s.project.discipline === 'infra');
  const drawingScale = useEditorStore((s) => s.project.drawingScale);
  if (infra) return <InfraControls part="scale" />;
  const scales = (DRAWING_SCALES as readonly number[]).includes(drawingScale)
    ? DRAWING_SCALES
    : [...DRAWING_SCALES, drawingScale].sort((a, b) => a - b);
  return (
    <label className="plan__field">
      <span>Escala</span>
      <select
        data-testid="plan-scale"
        value={drawingScale}
        onChange={(event) =>
          useEditorStore.getState().changeDrawingScale(Number(event.target.value))
        }
        title="Escala do desenho: define o tamanho de textos e cotas em relação ao modelo"
      >
        {scales.map((scale) => (
          <option key={scale} value={scale}>
            1:{scale}
          </option>
        ))}
      </select>
    </label>
  );
}

function DimensionModeField() {
  const dimensionMode = useEditorStore((s) => s.dimensionMode);
  return (
    <label className="plan__field">
      <span>Tipo de cota</span>
      <select
        data-testid="plan-dimension-mode"
        value={dimensionMode}
        title="Tipo das próximas cotas criadas com a ferramenta Cota"
        onChange={(event) =>
          useEditorStore.getState().setDimensionMode(event.target.value as DimensionMode)
        }
      >
        {(Object.keys(DIMENSION_MODE_LABELS) as DimensionMode[]).map((mode) => (
          <option key={mode} value={mode}>
            {DIMENSION_MODE_LABELS[mode]}
          </option>
        ))}
      </select>
    </label>
  );
}

function PlanAppearance() {
  const theme = useEditorStore((s) => s.planTheme);
  const thinLines = useEditorStore((s) => s.planThinLines);
  return (
    <>
      <label className="plan__field">
        <span>Tema</span>
        <select
          data-testid="plan-theme"
          value={theme}
          onChange={(event) =>
            useEditorStore.getState().setPlanTheme(event.target.value as PlanTheme)
          }
          title="Tema da planta: colorido (as cores do modelo 3D: material, partes e sistema) ou preto e branco. Vale também para a exportação em SVG"
        >
          <option value="color">Colorido</option>
          <option value="mono">Preto e branco</option>
        </select>
      </label>
      <button
        type="button"
        className={thinLines ? 'btn btn--compact is-active' : 'btn btn--compact'}
        data-testid="plan-thin-lines"
        aria-pressed={thinLines}
        onClick={() => useEditorStore.getState().setPlanThinLines(!thinLines)}
        title="Linhas finas: todo traço com 1 px na tela, em qualquer zoom, para enxergar a geometria das peças. Desligue para ver as espessuras de plotagem na escala do desenho. Não altera a exportação"
      >
        <Minus size={14} /> Linhas finas
      </button>
    </>
  );
}

/** Situação do modelo de informação: o que a consulta BIM / IFC está mostrando. */
function BimSummary() {
  const { model, conformity } = useIfcState();
  const count = (status: string): number =>
    [...conformity.values()].filter((value) => value === status).length;
  return (
    <div className="ribbon__info" data-testid="bim-summary">
      <span>
        <strong>{model.schema}</strong> · {model.elements.length} elementos · {model.types.length}{' '}
        tipos
      </span>
      <span>
        {count('conforming')} conformes · {count('pending')} com pendências · {count('invalid')} não
        conformes
      </span>
      <span className="muted">
        Árvore à esquerda; tipo, ocorrência, origem dos valores e pendências à direita.
      </span>
    </div>
  );
}

const RIBBON: Record<TaskId, readonly Group[]> = {
  model: [
    {
      id: 'create',
      label: 'Criar',
      items: [
        { command: 'tool.pipe', label: 'Tubos' },
        {
          menu: 'fittings',
          label: 'Conexões',
          description: 'Joelho, tê e redução',
          icon: ElbowIcon,
          commands: ['tool.elbow', 'tool.tee', 'tool.reducer'],
        },
        { command: 'tool.valve', label: 'Válvulas' },
        {
          menu: 'equipment',
          label: 'Equipamentos',
          description: 'Bomba e reservatório',
          icon: PumpIcon,
          commands: ['tool.pump', 'tool.tank'],
        },
      ],
    },
    {
      id: 'modify',
      label: 'Modificar',
      items: [
        { command: 'tool.select' },
        { command: 'modify.move' },
        { command: 'modify.copy' },
        { command: 'modify.elevation' },
        { command: 'modify.length', compact: true },
        { command: 'modify.rotate', compact: true },
        { command: 'modify.delete', compact: true },
      ],
    },
    {
      id: 'connect',
      label: 'Conectar',
      items: [
        // "Desconectar" fica em cada porta do painel de propriedades e na busca (Ctrl+K): a
        // faixa a 1920 px não comporta mais um botão sem quebrar a linha.
        { command: 'tool.connect', compact: true },
        { command: 'connect.pipe', compact: true },
        { command: 'connect.close', compact: true },
      ],
    },
    { id: 'measure', label: 'Medir', items: [{ command: 'tool.measure', compact: true }] },
    { id: 'catalog', label: 'Biblioteca', items: [{ command: 'catalog.open' }] },
    {
      id: 'terrain',
      label: 'Terreno (Planta Infra)',
      when: isInfra,
      items: [
        { command: 'terrain.panel', label: 'Superfície' },
        { command: 'terrain.area', compact: true },
        { command: 'terrain.profile', compact: true },
        { command: 'terrain.query', compact: true },
      ],
    },
  ],
  document: [
    {
      id: 'annotate',
      label: 'Anotar na planta',
      items: [
        { command: 'tool.dimension' },
        { command: 'tool.text' },
        { command: 'tool.leader' },
        { command: 'tool.tag' },
      ],
    },
    {
      id: 'settings',
      label: 'Escala e cotas',
      items: [
        { key: 'scale', widget: () => <ScaleField /> },
        { key: 'dimension-mode', widget: () => <DimensionModeField /> },
      ],
    },
    {
      id: 'future',
      label: 'Previstos',
      items: [{ command: 'doc.sheets' }, { command: 'doc.levelDimensions' }],
    },
  ],
  view: [
    {
      id: 'camera',
      label: 'Câmera (Modelo 3D)',
      items: [
        { command: 'view.iso', compact: true, testId: 'ribbon-view-iso' },
        { command: 'view.isometric', compact: true, testId: 'ribbon-view-isometric' },
        { command: 'view.ortho', compact: true, testId: 'ribbon-view-ortho' },
        { command: 'view.top', compact: true, testId: 'ribbon-view-top' },
        { command: 'view.front', compact: true, testId: 'ribbon-view-front' },
      ],
    },
    {
      id: 'frame',
      label: 'Enquadrar',
      items: [
        { command: 'view.fit', compact: true, label: 'Projeto', testId: 'ribbon-view-fit' },
        {
          command: 'view.fitSelection',
          compact: true,
          label: 'Seleção',
          testId: 'ribbon-view-fit-selection',
        },
      ],
    },
    {
      id: 'plan',
      label: 'Aparência da planta',
      items: [{ key: 'plan-appearance', column: true, widget: () => <PlanAppearance /> }],
    },
    {
      id: 'map',
      label: 'Mapa e camadas (Planta Infra)',
      when: isInfra,
      items: [{ key: 'infra-map', widget: () => <InfraControls part="map" /> }],
    },
    {
      id: 'navigation',
      label: 'Localização (Planta Infra)',
      when: isInfra,
      items: [
        {
          key: 'infra-navigation',
          column: true,
          widget: () => <InfraControls part="navigation" />,
        },
      ],
    },
    {
      id: 'terrain-display',
      label: 'Terreno (planta e 3D)',
      items: [{ key: 'terrain-display', widget: () => <TerrainDisplayControls /> }],
    },
    {
      id: 'panels',
      label: 'Vistas e painéis',
      items: [
        { command: 'view.split', compact: true },
        { command: 'layout.nav', compact: true },
        { command: 'layout.panel', compact: true },
        { command: 'layout.reset', compact: true },
      ],
    },
  ],
  analysis: [
    {
      id: 'check',
      label: 'Verificação',
      items: [{ command: 'analysis.validation' }, { command: 'analysis.clashes' }],
    },
    { id: 'quantities', label: 'Quantitativos', items: [{ command: 'analysis.quantities' }] },
    {
      id: 'profile',
      label: 'Perfil e recobrimento',
      items: [{ command: 'analysis.profile' }],
    },
    { id: 'measure', label: 'Medição', items: [{ command: 'tool.measure' }] },
    {
      id: 'terrain',
      label: 'Terreno (Planta Infra)',
      when: isInfra,
      items: [
        { command: 'terrain.profile', testId: 'analysis-terrain-profile' },
        { command: 'terrain.query', testId: 'analysis-terrain-query' },
      ],
    },
  ],
  bim: [
    {
      id: 'summary',
      label: 'Modelo de informação',
      items: [{ key: 'bim', widget: () => <BimSummary /> }],
    },
    {
      id: 'visibility',
      label: 'Visibilidade',
      items: [{ command: 'bim.isolate' }, { command: 'bim.hide' }],
    },
    { id: 'classification', label: 'Classificação', items: [{ command: 'bim.library' }] },
    {
      id: 'delivery',
      label: 'Entrega',
      items: [
        { command: 'export.ifc', testId: 'bim-export-ifc' },
        { command: 'export.ids', testId: 'bim-export-ids' },
      ],
    },
  ],
  export: [
    {
      id: 'model',
      label: 'Modelo',
      items: [{ command: 'export.ifc' }, { command: 'export.dxfModel' }],
    },
    {
      id: 'plan',
      label: 'Planta',
      items: [{ command: 'export.dxfPlan' }, { command: 'export.svgPlan' }],
    },
    {
      id: 'data',
      label: 'Dados',
      items: [{ command: 'export.csv' }, { command: 'export.epanet' }, { command: 'export.ids' }],
    },
    { id: 'help', label: 'Conteúdo e requisitos', items: [{ command: 'export.details' }] },
  ],
  manage: [
    {
      id: 'project',
      label: 'Projeto',
      items: [{ command: 'manage.levels' }, { command: 'manage.systems' }],
    },
    {
      id: 'families',
      label: 'Famílias',
      items: [{ command: 'catalog.open', label: 'Famílias e catálogo' }],
    },
    {
      id: 'site',
      label: 'Local',
      items: [{ command: 'manage.georeference' }, { command: 'manage.terrain' }],
    },
    {
      id: 'interface',
      label: 'Preferências da interface',
      items: [
        { command: 'layout.nav', compact: true },
        { command: 'layout.panel', compact: true },
        { command: 'layout.ribbon', compact: true },
        { command: 'layout.reset' },
      ],
    },
  ],
};

/** Onde cada comando aparece na faixa (para a busca de comandos). */
export function ribbonLocationOf(commandId: string): string | null {
  // A consulta BIM / IFC repete atalhos de entrega: o lugar próprio da saída vem primeiro.
  const order: TaskId[] = [...TASKS.filter((task) => task !== 'bim'), 'bim'];
  for (const task of order) {
    for (const group of RIBBON[task]) {
      for (const item of group.items) {
        if ('command' in item && item.command === commandId) {
          return `${TASK_LABELS[task]} › ${group.label}`;
        }
        if ('menu' in item && item.commands.includes(commandId)) {
          return `${TASK_LABELS[task]} › ${group.label} › ${item.label}`;
        }
      }
    }
  }
  return null;
}

/**
 * Botão com seta da faixa: reúne comandos relacionados (tipos de conexão, de equipamento) em
 * uma lista com nome, finalidade e atalho. O botão mostra o símbolo do comando em uso.
 */
function RibbonMenu({
  item,
  context,
}: {
  item: Extract<Item, { menu: string }>;
  context: CommandContext;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const commands = item.commands.map(getCommand);
  const states = commands.map((command) => commandState(command, context));
  const activeIndex = states.findIndex((state) => state.active);
  const active = activeIndex >= 0 ? commands[activeIndex] : undefined;
  const enabled = states.some((state) => state.enabled);
  const Icon = active?.icon ?? item.icon;

  useEffect(() => {
    if (!open) return;
    const close = (event: Event): void => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // Esc fecha só a lista: não cancela a operação em andamento nem limpa a seleção.
      event.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="menu ribbon__menu" ref={ref}>
      <button
        type="button"
        className={`cmd cmd--large cmd--dropdown${active ? ' is-active' : ''}`}
        data-testid={`ribbon-menu-${item.menu}`}
        data-active-command={active?.id ?? ''}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!enabled}
        title={
          enabled
            ? `${item.label}: ${item.description}${active ? `\nEm uso: ${active.label}` : ''}`
            : `${item.label}\nIndisponível: ${states[0]?.reason ?? ''}`
        }
        onClick={() => setOpen((value) => !value)}
      >
        <Icon size={20} className="cmd__icon" aria-hidden />
        <span className="cmd__label">{item.label}</span>
        <ChevronDown size={12} className="cmd__caret" aria-hidden />
      </button>
      {open && (
        <div
          className="menu__list ribbon__menu-list"
          role="menu"
          aria-label={item.label}
          data-testid={`ribbon-menu-${item.menu}-list`}
        >
          {item.commands.map((id) => (
            <CommandButton
              key={id}
              id={id}
              context={context}
              variant="menu"
              onRun={() => setOpen(false)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function renderItems(items: readonly Item[], context: CommandContext): ReactNode[] {
  return items.map((item) => {
    if ('widget' in item) {
      return (
        <div
          key={item.key}
          className={item.column ? 'ribbon__widget ribbon__widget--column' : 'ribbon__widget'}
        >
          {item.widget(context)}
        </div>
      );
    }
    if ('menu' in item) return <RibbonMenu key={item.menu} item={item} context={context} />;
    return (
      <CommandButton
        key={item.command}
        id={item.command}
        context={context}
        variant={item.compact ? 'compact' : 'large'}
        label={item.label}
        testId={item.testId}
      />
    );
  });
}

export function ToolBar() {
  const context = useCommandContext();
  const { task, ribbonCollapsed: collapsed } = context;
  const { setTask, setRibbonCollapsed, openDialog } = useUiStore.getState();
  const groups = RIBBON[task].filter((group) => group.when?.(context) ?? true);

  return (
    <nav
      className={collapsed ? 'ribbon is-collapsed' : 'ribbon'}
      aria-label="Comandos"
      data-testid="ribbon"
      data-task={task}
      data-collapsed={collapsed}
    >
      <div className="ribbon__tabs" role="tablist" aria-label="Tarefas">
        {TASKS.map((id) => (
          <button
            key={id}
            id={`task-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={task === id}
            aria-controls={collapsed ? undefined : 'ribbon-panel'}
            data-testid={`task-${id}`}
            className={task === id ? 'ribbon__tab is-active' : 'ribbon__tab'}
            title={
              id === 'bim'
                ? 'BIM / IFC: consulta e cadastro sobre o Modelo 3D. A modelagem fica suspensa enquanto esta aba estiver aberta e é retomada ao sair.'
                : `${TASK_LABELS[id]}: mostra os comandos desta tarefa, sem mudar a vista nem a operação em andamento.`
            }
            onClick={() => setTask(id)}
            onDoubleClick={() => setRibbonCollapsed(!collapsed)}
          >
            {TASK_LABELS[id]}
          </button>
        ))}
        <span className="ribbon__spacer" />
        <button
          type="button"
          className="ribbon__search"
          data-testid="command-search"
          title="Buscar comando (Ctrl+K)"
          onClick={() => openDialog('commands')}
        >
          <Search size={13} aria-hidden /> Buscar comando <kbd>Ctrl+K</kbd>
        </button>
        <button
          type="button"
          className="btn btn--icon ribbon__collapse"
          data-testid="ribbon-collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Mostrar a faixa de comandos' : 'Recolher a faixa de comandos'}
          title={
            collapsed
              ? 'Mostrar a faixa de comandos'
              : 'Recolher a faixa de comandos para ampliar a área de desenho'
          }
          onClick={() => setRibbonCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>
      {!collapsed && (
        <div
          id="ribbon-panel"
          className="ribbon__body"
          role="tabpanel"
          aria-labelledby={`task-tab-${task}`}
          data-testid="ribbon-body"
        >
          {groups.map((group) => (
            <section
              key={group.id}
              className="ribbon__group"
              data-testid={`ribbon-group-${group.id}`}
              data-group={group.id}
              aria-label={group.label}
            >
              <div className="ribbon__items">{renderItems(group.items, context)}</div>
              <span className="ribbon__caption">{group.label}</span>
            </section>
          ))}
        </div>
      )}
    </nav>
  );
}
