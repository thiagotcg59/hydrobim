import { getView, VIEW_KIND_LABELS, type ProjectView } from '@hydrobim/core';
import { Maximize2, Minimize2, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { CommandContext } from '../commands/commands';
import { useCommandContext } from '../commands/useCommands';
import { isIsoQuadrant, nextIsoQuadrant } from '../editor/viewPresets';
import { PlanView } from '../plan/PlanView';
import { isAnnotationTool, useEditorStore } from '../state/editorStore';
import { useUiStore, type WorkspaceView } from '../state/uiStore';
import { useTerrainStore } from '../terrain/terrainStore';
import { DocView } from '../views/DocView';
import { VIEW_ICONS } from '../views/viewIcons';
import { openView2dOf, useViewStore } from '../views/viewStore';
import { Viewport } from '../viewport/Viewport';
import { WalkView } from '../walk/WalkView';
import { CommandButton } from './CommandButton';
import { ReferenceBar } from './ReferenceBar';

/**
 * Área de desenho. Duas disposições, escolhidas em "Lado a lado": uma vista por vez ou a planta
 * à esquerda e o modelo 3D à direita, com divisor ajustável. As duas vistas mostram o mesmo
 * projeto e a mesma seleção; cada uma guarda a própria navegação. A vista **ativa** (a que o
 * cursor aponta) é a que recebe os comandos de vista e o teclado.
 */

const PANE_TITLES: Record<WorkspaceView, string> = { plan: 'planta', '3d': 'modelo 3D' };

function projectionLabel(context: CommandContext): string {
  if (!context.orthographic) return 'Perspectiva';
  return isIsoQuadrant(context.viewPreset) ? 'Isométrica' : 'Ortográfica';
}

/**
 * Vista de projeto aberta na área: o nome dela ao lado do título, com o botão de fechar (que
 * volta à planta de trabalho ou ao modelo 3D padrão; a vista continua salva no projeto).
 */
function OpenViewChip({ view, active }: { view: ProjectView; active: boolean }) {
  const Icon = VIEW_ICONS[view.kind];
  const pane = view.kind === '3d' ? '3d' : '2d';
  return (
    <span
      className={active ? 'pane__open is-active' : 'pane__open'}
      data-testid={`open-view-${pane}`}
      data-view-id={view.id}
      data-view-name={view.name}
    >
      <button
        type="button"
        className="pane__open-name"
        data-testid={`open-view-${pane}-name`}
        aria-pressed={active}
        title={`${VIEW_KIND_LABELS[view.kind]} "${view.name}" (vista salva no projeto)`}
        onClick={() => useEditorStore.getState().setViewMode(pane === '3d' ? '3d' : 'plan')}
      >
        <Icon size={14} aria-hidden />
        <span>{view.name}</span>
      </button>
      <button
        type="button"
        className="pane__open-close"
        data-testid={`open-view-${pane}-close`}
        aria-label={`Fechar ${view.name}`}
        title={
          pane === '3d'
            ? 'Fechar a vista e voltar ao Modelo 3D padrão (a vista continua salva)'
            : 'Fechar a vista e voltar à planta de trabalho (a vista continua salva)'
        }
        onClick={() => useViewStore.getState().closeView(pane)}
      >
        <X size={13} aria-hidden />
      </button>
    </span>
  );
}

interface HeaderProps {
  pane: WorkspaceView;
  /** A vista ocupa sozinha a área de desenho: o cabeçalho traz as abas de todas as vistas. */
  solo: boolean;
  split: boolean;
  maximized: boolean;
  context: CommandContext;
}

/** Cabeçalho discreto de uma vista: título (ou abas), enquadramento, orientação e maximizar. */
function PaneHeader({ pane, solo, split, maximized, context }: HeaderProps) {
  const infra = context.project.discipline === 'infra';
  const drawingScale = useEditorStore((s) => s.project.drawingScale);
  const bim = context.viewMode === 'bim';
  const walking = bim && context.bimWalk === true;
  const planLabel = infra ? 'Planta Infra' : 'Planta MEP';
  const show3dControls = solo || pane === '3d';
  // Vistas de projeto abertas nesta área (a consulta BIM / IFC usa o modelo padrão).
  const open2d = useViewStore((s) => s.open2d);
  const open3d = useViewStore((s) => s.open3d);
  const sheet = bim ? null : openView2dOf(context.project, open2d);
  const saved3d = bim ? undefined : getView(context.project, open3d);

  return (
    <header className="pane__header" data-testid={solo ? 'view-tabs' : `pane-${pane}-header`}>
      <div className="pane__tabs" role="group" aria-label="Vistas">
        {(solo || pane === 'plan') && (
          <CommandButton id="view.plan" context={context} variant="small" label={planLabel} />
        )}
        {(solo || pane === 'plan') && sheet && (
          <OpenViewChip view={sheet} active={context.viewMode === 'plan'} />
        )}
        {(solo || pane === '3d') && (
          <CommandButton id="view.model" context={context} variant="small" />
        )}
        {(solo || pane === '3d') && saved3d?.kind === '3d' && (
          <OpenViewChip view={saved3d} active={context.viewMode === '3d'} />
        )}
        {solo && infra && (
          // O perfil ainda é um diálogo de análise, não uma vista sincronizada: o botão o abre.
          <CommandButton
            id="analysis.profile"
            context={context}
            variant="small"
            label="Perfil…"
            testId="view-mode-profile"
          />
        )}
        {bim && (
          // Aba de vista da consulta: o mesmo modelo, percorrido em primeira pessoa.
          <CommandButton
            id="bim.walk"
            context={context}
            variant="small"
            label="Percurso"
            testId="view-mode-walk"
          />
        )}
        {bim && (
          <span
            className="pane__mode"
            data-testid="bim-mode-badge"
            title="A consulta BIM / IFC usa o Modelo 3D. Escolher a planta ou outra aba de tarefa encerra a consulta e retoma a modelagem."
          >
            Consulta BIM / IFC
          </span>
        )}
        {!solo && pane === '3d' && (
          <span className="pane__info" data-testid="pane-3d-projection">
            {projectionLabel(context)}
          </span>
        )}
        {!solo && pane === 'plan' && !infra && (
          <span
            className="pane__info"
            data-testid="pane-plan-scale"
            title="Escala de documentação da planta (Documentação › Escala e cotas)"
          >
            1:{sheet ? sheet.scale : drawingScale}
          </span>
        )}
      </div>
      <div className="pane__nav" role="group" aria-label="Navegação da vista">
        {walking ? null : show3dControls ? (
          <>
            <CommandButton id="view.fit" context={context} variant="icon" />
            <CommandButton id="view.fitSelection" context={context} variant="icon" />
            <span className="pane__sep" aria-hidden />
            <CommandButton id="view.top" context={context} variant="icon" />
            <CommandButton id="view.front" context={context} variant="icon" />
            <CommandButton id="view.iso" context={context} variant="icon" />
            <CommandButton id="view.isometric" context={context} variant="icon" />
            <CommandButton id="view.ortho" context={context} variant="icon" />
          </>
        ) : (
          <CommandButton id="view.fit" context={context} variant="icon" testId="plan-view-fit" />
        )}
        {!bim && <span className="pane__sep" aria-hidden />}
        {!bim && !split && (
          <CommandButton id="view.split" context={context} variant="icon" testId="pane-split" />
        )}
        {!bim && split && (
          <button
            type="button"
            className={maximized ? 'cmd cmd--icon is-active' : 'cmd cmd--icon'}
            data-testid={`pane-${pane}-maximize`}
            aria-pressed={maximized}
            aria-label={maximized ? 'Restaurar as duas vistas' : `Maximizar a ${PANE_TITLES[pane]}`}
            title={
              maximized
                ? 'Restaurar as duas vistas lado a lado'
                : `Maximizar a ${PANE_TITLES[pane]}\nA outra vista continua aberta e conserva a navegação.`
            }
            onClick={() => useUiStore.getState().maximizeView(pane)}
          >
            {maximized ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}
          </button>
        )}
      </div>
    </header>
  );
}

export function Workspace({ ready }: { ready: boolean }) {
  const context = useCommandContext();
  const { viewMode } = context;
  const layout = useUiStore((s) => s.workspaceLayout);
  const ratio = useUiStore((s) => s.splitRatio);
  const maximizedView = useUiStore((s) => s.maximizedView);
  const viewsRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const bim = viewMode === 'bim';
  const walking = bim && context.bimWalk === true;
  // A consulta BIM / IFC só existe sobre o Modelo 3D.
  const split = layout === 'split' && !bim;
  const maximized = split ? maximizedView : null;
  const active: WorkspaceView = viewMode === 'plan' ? 'plan' : '3d';
  const mounted = (pane: WorkspaceView): boolean => split || active === pane;
  const sideBySide = split && !maximized;

  // A vista combinada abre com a isométrica técnica; depois disso a navegação é do usuário.
  const opened = useRef(false);
  useEffect(() => {
    if (!ready || opened.current) return;
    opened.current = true;
    const state = useEditorStore.getState();
    if (useUiStore.getState().workspaceLayout !== 'split' || state.orthographic) return;
    useEditorStore.setState({
      orthographic: true,
      viewRequest: { preset: nextIsoQuadrant(null), nonce: (state.viewRequest?.nonce ?? 0) + 1 },
    });
  }, [ready]);

  /** A vista apontada passa a ser a ativa (sem interromper o que só existe na planta). */
  const activate = (pane: WorkspaceView, hover: boolean): void => {
    if (!sideBySide || active === pane) return;
    if (hover) {
      const editor = useEditorStore.getState();
      // Anotações, operações do terreno e a escolha da origem só existem na planta: passar o
      // cursor sobre o modelo 3D não as encerra. Um clique lá, sim.
      if (isAnnotationTool(editor.tool) || editor.geoPicker || useTerrainStore.getState().mode) {
        return;
      }
      // O desenho 2D e a linha de corte também: o cursor pode passar pelo modelo sem encerrá-los.
      if (useViewStore.getState().tool !== 'select') return;
    }
    useUiStore.getState().activateWorkspaceView(pane);
  };

  const onDividerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const rect = viewsRef.current?.getBoundingClientRect();
    if (!dragging.current || !rect || rect.width <= 0) return;
    useUiStore.getState().setSplitRatio((event.clientX - rect.left) / rect.width);
  };

  // Vista 2D de projeto aberta na área da planta (no lugar da planta de trabalho).
  const open2d = useViewStore((s) => s.open2d);
  const sheet = openView2dOf(context.project, open2d);

  const pane = (id: WorkspaceView) => {
    if (!mounted(id)) return null;
    const hidden = maximized !== null && maximized !== id;
    const solo = !split || maximized === id;
    return (
      <section
        key={id}
        className={[
          'pane',
          `pane--${id}`,
          active === id ? 'is-active' : '',
          hidden ? 'is-hidden' : '',
          solo ? 'is-solo' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        data-testid={`pane-${id}`}
        data-active={active === id}
        aria-label={id === 'plan' ? 'Planta' : 'Modelo 3D'}
        aria-hidden={hidden || undefined}
        onPointerEnter={(event) => {
          if (event.buttons === 0) activate(id, true);
        }}
        onPointerDownCapture={() => activate(id, false)}
      >
        {!hidden && (
          <PaneHeader
            pane={id}
            solo={solo}
            split={split}
            maximized={maximized === id}
            context={context}
          />
        )}
        <div className="pane__view">
          {id === 'plan' ? (
            sheet ? (
              <DocView key={sheet.id} view={sheet} />
            ) : (
              <PlanView />
            )
          ) : walking ? (
            <WalkView />
          ) : (
            <Viewport />
          )}
        </div>
      </section>
    );
  };

  return (
    <main
      className="workspace"
      data-testid="workspace"
      data-layout={split ? 'split' : 'single'}
      data-maximized={maximized ?? ''}
    >
      <div
        className="workspace__view"
        data-testid="workspace-view"
        ref={viewsRef}
        style={{ '--split': ratio } as CSSProperties}
      >
        {!ready ? (
          <div className="viewport-fallback">Carregando projeto…</div>
        ) : (
          <>
            {pane('plan')}
            {sideBySide && (
              <div
                key="divider"
                className="workspace__divider"
                data-testid="workspace-divider"
                role="separator"
                aria-orientation="vertical"
                aria-label="Divisão entre a planta e o modelo 3D"
                aria-valuenow={Math.round(ratio * 100)}
                aria-valuemin={25}
                aria-valuemax={75}
                tabIndex={0}
                title="Arraste para redimensionar as vistas (ou use as setas ← →)"
                onPointerDown={(event) => {
                  dragging.current = true;
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={onDividerMove}
                onPointerUp={(event) => {
                  dragging.current = false;
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                  event.preventDefault();
                  event.stopPropagation();
                  useUiStore
                    .getState()
                    .setSplitRatio(ratio + (event.key === 'ArrowRight' ? 0.02 : -0.02));
                }}
              />
            )}
            {pane('3d')}
          </>
        )}
      </div>
      <ReferenceBar />
    </main>
  );
}
