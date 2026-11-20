import { DRAWING_SCALES, type DimensionMode } from '@hydrobim/core';
import { ChevronDown, ChevronUp, Minus, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CommandContext } from '../commands/commands';
import { useCommandContext } from '../commands/useCommands';
import { InfraControls } from '../infra/InfraPanel';
import { DIMENSION_MODE_LABELS } from '../plan/AnnotationInspector';
import { TerrainDisplayControls } from '../terrain/TerrainDisplayControls';
import { useEditorStore, type PlanTheme } from '../state/editorStore';
import { useIfcState } from '../state/ifcModel';
import { TASK_LABELS, TASKS, useUiStore, type TaskId } from '../state/uiStore';
import { CommandButton } from './CommandButton';

/**
 * Faixa de comandos: uma aba por tarefa, com os comandos agrupados. Trocar de aba só muda os
 * comandos à mostra — não altera o ambiente, o modelo, a vista nem a operação em andamento
 * (a exceção, declarada, é a consulta BIM / IFC, que suspende a modelagem enquanto aberta).
 */

type Item =
  | {
      readonly command: string;
      readonly small?: boolean;
      readonly label?: string;
      readonly testId?: string;
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
      id: 'general',
      label: 'Geral',
      items: [{ command: 'tool.select' }, { command: 'tool.measure' }],
    },
    {
      id: 'create',
      label: 'Criar',
      items: [
        { command: 'tool.pipe' },
        { command: 'tool.elbow' },
        { command: 'tool.tee' },
        { command: 'tool.reducer' },
        { command: 'tool.valve' },
        { command: 'tool.pump' },
        { command: 'tool.tank' },
      ],
    },
    {
      id: 'modify',
      label: 'Modificar (seleção)',
      items: [
        { command: 'modify.move', small: true },
        { command: 'modify.copy', small: true },
        { command: 'modify.delete', small: true },
        { command: 'modify.length', small: true },
        { command: 'modify.elevation', small: true },
        { command: 'modify.rotate', small: true },
      ],
    },
    {
      id: 'connect',
      label: 'Conectar',
      items: [
        { command: 'connect.pipe', small: true },
        { command: 'connect.close', small: true },
        { command: 'connect.disconnect', small: true },
      ],
    },
    { id: 'catalog', label: 'Catálogo', items: [{ command: 'catalog.open' }] },
    {
      id: 'terrain',
      label: 'Terreno (Planta Infra)',
      when: isInfra,
      items: [
        { command: 'terrain.panel' },
        { command: 'terrain.area', small: true },
        { command: 'terrain.profile', small: true },
        { command: 'terrain.query', small: true },
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
      items: [
        { command: 'doc.sheets', small: true },
        { command: 'doc.levelDimensions', small: true },
      ],
    },
  ],
  view: [
    {
      id: 'camera',
      label: 'Câmera (Modelo 3D)',
      items: [
        { command: 'view.iso', small: true, testId: 'ribbon-view-iso' },
        { command: 'view.isometric', small: true, testId: 'ribbon-view-isometric' },
        { command: 'view.ortho', small: true, testId: 'ribbon-view-ortho' },
        { command: 'view.top', small: true, testId: 'ribbon-view-top' },
        { command: 'view.front', small: true, testId: 'ribbon-view-front' },
      ],
    },
    {
      id: 'frame',
      label: 'Enquadrar',
      items: [
        { command: 'view.fit', small: true, label: 'Projeto', testId: 'ribbon-view-fit' },
        {
          command: 'view.fitSelection',
          small: true,
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
      when: isInfra,
      items: [{ key: 'terrain-display', widget: () => <TerrainDisplayControls /> }],
    },
    {
      id: 'panels',
      label: 'Painéis',
      items: [
        { command: 'layout.nav', small: true },
        { command: 'layout.panel', small: true },
        { command: 'layout.reset', small: true },
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
      items: [
        { command: 'bim.isolate', small: true },
        { command: 'bim.hide', small: true },
      ],
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
        { command: 'layout.nav', small: true },
        { command: 'layout.panel', small: true },
        { command: 'layout.ribbon', small: true },
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
      if (group.items.some((item) => 'command' in item && item.command === commandId)) {
        return `${TASK_LABELS[task]} › ${group.label}`;
      }
    }
  }
  return null;
}

function renderItems(items: readonly Item[], context: CommandContext): ReactNode[] {
  const nodes: ReactNode[] = [];
  let stack: ReactNode[] = [];
  const flush = (): void => {
    if (stack.length === 0) return;
    nodes.push(
      <div key={`stack-${nodes.length}`} className="ribbon__stack">
        {stack}
      </div>,
    );
    stack = [];
  };
  for (const item of items) {
    if ('widget' in item) {
      flush();
      nodes.push(
        <div
          key={item.key}
          className={item.column ? 'ribbon__widget ribbon__widget--column' : 'ribbon__widget'}
        >
          {item.widget(context)}
        </div>,
      );
    } else if (item.small) {
      stack.push(
        <CommandButton
          key={item.command}
          id={item.command}
          context={context}
          variant="small"
          label={item.label}
          testId={item.testId}
        />,
      );
    } else {
      flush();
      nodes.push(
        <CommandButton
          key={item.command}
          id={item.command}
          context={context}
          label={item.label}
          testId={item.testId}
        />,
      );
    }
  }
  flush();
  return nodes;
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
            type="button"
            role="tab"
            aria-selected={task === id}
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
        <div className="ribbon__body" role="tabpanel" data-testid="ribbon-body">
          {groups.map((group) => (
            <section
              key={group.id}
              className="ribbon__group"
              data-testid={`ribbon-group-${group.id}`}
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
