import {
  defaultPipeSpec,
  getSpecification,
  resolveNearestPipeSpec,
  resolvePipeSpec,
} from '@hydrobim/catalog';
import {
  applySpec,
  attachFitting,
  createProject,
  degToRad,
  deleteElements,
  disconnect,
  distance,
  drawPipe,
  elementKindLabel,
  formatMeters,
  getElement,
  getFreePorts,
  insertInline,
  isPortFree,
  POSITION_TOLERANCE,
  renameElement,
  resolvePort,
  rollFitting,
  setElementProperty,
  setPipeEndpoint,
  setPipeLength,
  updateFitting,
  updateProjectInfo,
  type Discipline,
  type FittingInput,
  type FittingKind,
  type FittingPatch,
  type PipeSpec,
  type Port,
  type PortRef,
  type Project,
  type PropertyValue,
  type Result,
  type ValveType,
  type Vec3,
} from '@hydrobim/core';
import { create } from 'zustand';
import { distanceAlongPipe, type SnapKind } from '../editor/picking';

export type ToolId = 'select' | 'pipe' | 'elbow' | 'tee' | 'reducer' | 'valve' | 'measure';
export type ViewPreset = 'fit' | 'top' | 'front' | 'iso';
export type MessageLevel = 'info' | 'success' | 'error';

export interface EditorMessage {
  readonly level: MessageLevel;
  readonly text: string;
  readonly at: number;
}

export interface DrawAnchor {
  readonly point: Vec3;
  /** Porta livre de onde o tubo parte, quando o ponto inicial foi capturado em uma porta. */
  readonly port: PortRef | null;
  /** Eixo obrigatório do próximo ponto (saída de conexões). */
  readonly lockAxis: Vec3 | null;
}

export interface CursorInfo {
  readonly point: Vec3;
  readonly snap: SnapKind;
  readonly port: PortRef | null;
}

export interface ToolOptions {
  readonly elbowAngleDeg: number;
  readonly valveType: ValveType;
  /** DN de saída da redução; `null` = diâmetro imediatamente menor da especificação. */
  readonly reducerDn: number | null;
  /** Aplica alterações de material/diâmetro a todo o trecho conectado. */
  readonly propagateSpec: boolean;
}

/** Clique no viewport já resolvido para o domínio. */
export interface ViewportClick {
  readonly point: Vec3 | null;
  readonly port: PortRef | null;
  readonly hit: { elementId: string; point: Vec3 } | null;
}

const HISTORY_LIMIT = 100;

interface EditorState {
  project: Project;
  /** Projeto no momento em que foi carregado ou salvo (base para detectar alterações). */
  savedProject: Project | null;
  /** Indica se o projeto atual já foi gravado no repositório. */
  persisted: boolean;
  past: Project[];
  future: Project[];
  selectedId: string | null;
  tool: ToolId;
  activeSpec: PipeSpec;
  toolOptions: ToolOptions;
  workPlaneZ: number;
  gridStep: number;
  snapToGrid: boolean;
  anchor: DrawAnchor | null;
  measure: { a: Vec3 | null; b: Vec3 | null };
  cursor: CursorInfo | null;
  message: EditorMessage | null;
  viewRequest: { preset: ViewPreset; nonce: number } | null;

  notify: (level: MessageLevel, text: string) => void;
  loadProject: (project: Project, options?: { saved?: boolean }) => void;
  newProject: (discipline?: Discipline) => void;
  markSaved: () => void;
  setProjectName: (name: string) => void;
  setDiscipline: (discipline: Discipline) => void;
  setTool: (tool: ToolId) => void;
  select: (id: string | null) => void;
  setActiveSpec: (specificationId: string, dn: number) => void;
  setToolOptions: (patch: Partial<ToolOptions>) => void;
  setWorkPlaneZ: (z: number) => void;
  setGridStep: (step: number) => void;
  setSnapToGrid: (enabled: boolean) => void;
  setCursor: (cursor: CursorInfo | null) => void;
  requestView: (preset: ViewPreset) => void;
  cancelInteraction: () => void;

  handleViewportClick: (click: ViewportClick) => void;
  /** Informa um ponto por coordenadas (ferramentas de tubo e de medição). */
  commitPoint: (point: Vec3, port?: PortRef | null) => void;
  insertFittingAtPort: (kind: FittingKind, target: PortRef) => void;
  insertFittingInline: (kind: 'tee' | 'valve', pipeId: string, distanceFromStart: number) => void;

  changeSpec: (elementId: string, specificationId: string, dn: number, portId?: 'a' | 'b') => void;
  rename: (elementId: string, name: string) => void;
  movePipeEnd: (pipeId: string, which: 'start' | 'end', point: Vec3) => void;
  changePipeLength: (pipeId: string, length: number) => void;
  changeFitting: (elementId: string, patch: FittingPatch) => void;
  roll: (elementId: string, axisPortId: string, angleDeg: number) => void;
  setProperty: (elementId: string, key: string, value: PropertyValue | undefined) => void;
  disconnectPort: (ref: PortRef) => void;
  deleteSelected: () => void;
  undo: () => void;
  redo: () => void;
}

function gridStepFor(discipline: Discipline): number {
  return discipline === 'infra' ? 1 : 0.1;
}

function findPortAt(project: Project, point: Vec3): Port | null {
  return (
    getFreePorts(project).find((p) => distance(p.position, point) <= POSITION_TOLERANCE) ?? null
  );
}

function anchorFromPort(project: Project, port: Port): DrawAnchor {
  const host = getElement(project, port.ref.elementId);
  return {
    point: port.position,
    port: port.ref,
    lockAxis: host && host.kind !== 'pipe' ? port.direction : null,
  };
}

const initialProject = createProject('Projeto sem título', 'mep');

export const useEditorStore = create<EditorState>()((set, get) => {
  /** Aplica o resultado de uma operação de domínio, registrando histórico e mensagens. */
  function commit(result: Result<Project>, success?: string): boolean {
    if (!result.ok) {
      set({ message: { level: 'error', text: result.error.message, at: Date.now() } });
      return false;
    }
    const { project, past } = get();
    if (result.value === project) return true;
    set({
      project: result.value,
      past: [...past, project].slice(-HISTORY_LIMIT),
      future: [],
      ...(success ? { message: { level: 'success', text: success, at: Date.now() } } : {}),
    });
    return true;
  }

  function fittingInput(kind: FittingKind, port: Port): Result<FittingInput> {
    const { toolOptions } = get();
    switch (kind) {
      case 'elbow':
        return { ok: true, value: { kind, angle: degToRad(toolOptions.elbowAngleDeg) } };
      case 'tee':
        return { ok: true, value: { kind } };
      case 'valve':
        return { ok: true, value: { kind, valveType: toolOptions.valveType } };
      case 'reducer': {
        const specification = getSpecification(port.spec.specificationId);
        const sizes = specification?.sizes ?? [];
        let dn = toolOptions.reducerDn;
        if (dn === null) {
          const smaller = sizes.filter((s) => s.dn < port.spec.dn).pop();
          const larger = sizes.find((s) => s.dn > port.spec.dn);
          dn = smaller?.dn ?? larger?.dn ?? null;
        }
        const outletSpec = dn === null ? undefined : resolvePipeSpec(port.spec.specificationId, dn);
        if (!outletSpec) {
          return {
            ok: false,
            error: {
              code: 'NO_REDUCER_SIZE',
              message: `A especificação "${port.spec.standard}" não possui o diâmetro de saída escolhido para a redução.`,
            },
          };
        }
        return { ok: true, value: { kind, outletSpec } };
      }
    }
  }

  return {
    project: initialProject,
    savedProject: initialProject,
    persisted: false,
    past: [],
    future: [],
    selectedId: null,
    tool: 'select',
    activeSpec: defaultPipeSpec('mep'),
    toolOptions: { elbowAngleDeg: 90, valveType: 'gate', reducerDn: null, propagateSpec: true },
    workPlaneZ: 0,
    gridStep: 0.1,
    snapToGrid: true,
    anchor: null,
    measure: { a: null, b: null },
    cursor: null,
    message: null,
    viewRequest: null,

    notify: (level, text) => set({ message: { level, text, at: Date.now() } }),

    loadProject: (project, options) =>
      set((state) => ({
        project,
        savedProject: project,
        persisted: options?.saved ?? false,
        message: null,
        past: [],
        future: [],
        selectedId: null,
        anchor: null,
        measure: { a: null, b: null },
        tool: 'select',
        activeSpec: defaultPipeSpec(project.discipline),
        gridStep: gridStepFor(project.discipline),
        viewRequest: { preset: 'fit', nonce: (state.viewRequest?.nonce ?? 0) + 1 },
      })),

    newProject: (discipline = 'mep') =>
      get().loadProject(createProject('Projeto sem título', discipline)),

    markSaved: () => set((state) => ({ savedProject: state.project, persisted: true })),

    setProjectName: (name) => {
      const { project } = get();
      if (name === project.name) return;
      commit({ ok: true, value: updateProjectInfo(project, { name }) });
    },

    setDiscipline: (discipline) => {
      const { project } = get();
      if (discipline === project.discipline) return;
      commit({ ok: true, value: updateProjectInfo(project, { discipline }) });
      set({
        activeSpec: defaultPipeSpec(discipline),
        gridStep: gridStepFor(discipline),
        message: {
          level: 'info',
          text:
            discipline === 'infra'
              ? 'Ambiente Infra: especificação e grade ajustadas para redes. Terreno, perfil e georreferenciamento são etapas futuras.'
              : 'Ambiente MEP: especificação e grade ajustadas para instalações prediais.',
          at: Date.now(),
        },
      });
    },

    setTool: (tool) => set({ tool, anchor: null, measure: { a: null, b: null } }),

    select: (id) => set({ selectedId: id }),

    setActiveSpec: (specificationId, dn) => {
      const spec =
        resolvePipeSpec(specificationId, dn) ?? resolveNearestPipeSpec(specificationId, dn);
      if (spec) set({ activeSpec: spec });
    },

    setToolOptions: (patch) =>
      set((state) => ({ toolOptions: { ...state.toolOptions, ...patch } })),

    setWorkPlaneZ: (z) => {
      if (Number.isFinite(z)) set({ workPlaneZ: z });
    },
    setGridStep: (step) => {
      if (Number.isFinite(step) && step > 0) set({ gridStep: step });
    },
    setSnapToGrid: (enabled) => set({ snapToGrid: enabled }),
    setCursor: (cursor) => set({ cursor }),

    requestView: (preset) =>
      set((state) => ({ viewRequest: { preset, nonce: (state.viewRequest?.nonce ?? 0) + 1 } })),

    cancelInteraction: () => {
      const { anchor, measure, tool } = get();
      if (anchor || measure.a) set({ anchor: null, measure: { a: null, b: null } });
      else if (tool !== 'select') set({ tool: 'select' });
      else set({ selectedId: null });
    },

    handleViewportClick: (click) => {
      const state = get();
      const { tool, project } = state;
      const port = click.port ? resolvePort(project, click.port) : undefined;

      if (tool === 'select') {
        set({ selectedId: click.hit?.elementId ?? null });
        return;
      }
      if (tool === 'pipe' || tool === 'measure') {
        if (click.point) state.commitPoint(click.point, click.port);
        return;
      }
      if (port) {
        state.insertFittingAtPort(tool, port.ref);
        return;
      }
      const hit = click.hit ? getElement(project, click.hit.elementId) : undefined;
      if ((tool === 'tee' || tool === 'valve') && hit?.kind === 'pipe' && click.hit) {
        const along = distanceAlongPipe(hit.start, hit.end, click.hit.point);
        state.insertFittingInline(tool, hit.id, Math.round(along * 1000) / 1000);
        return;
      }
      state.notify(
        'info',
        tool === 'tee' || tool === 'valve'
          ? 'Clique em uma extremidade livre ou sobre um tubo para inserir em linha.'
          : 'Clique em uma extremidade livre (marcadores ciano) para inserir a conexão.',
      );
    },

    commitPoint: (point, portRef) => {
      const state = get();
      const { project, tool } = state;

      if (tool === 'measure') {
        const { a, b } = state.measure;
        if (!a || b) {
          set({ measure: { a: point, b: null } });
        } else {
          set({
            measure: { a, b: point },
            message: {
              level: 'info',
              text: `Distância: ${formatMeters(distance(a, point))}  (ΔX ${formatMeters(point.x - a.x)}, ΔY ${formatMeters(point.y - a.y)}, ΔZ ${formatMeters(point.z - a.z)})`,
              at: Date.now(),
            },
          });
        }
        return;
      }
      if (tool !== 'pipe') return;

      const port =
        (portRef ? resolvePort(project, portRef) : undefined) ?? findPortAt(project, point);
      const freePort = port && isPortFree(project, port.ref) ? port : null;

      if (!state.anchor) {
        set({
          anchor: freePort
            ? anchorFromPort(project, freePort)
            : { point, port: null, lockAxis: null },
        });
        return;
      }

      const result = drawPipe(project, {
        fromPort: state.anchor.port ?? undefined,
        start: state.anchor.point,
        end: point,
        spec: state.activeSpec,
      });
      if (!result.ok) {
        state.notify('error', result.error.message);
        return;
      }
      const created = result.value;
      const withElbow = created.createdIds.length > 1;
      commit(
        { ok: true, value: created.project },
        withElbow ? 'Tubo criado com joelho automático.' : 'Tubo criado.',
      );
      // Continua a polilinha a partir da extremidade final, se ela permanecer livre.
      const next = resolvePort(created.project, { elementId: created.elementId, portId: 'end' });
      set({
        selectedId: created.elementId,
        anchor:
          next && isPortFree(created.project, next.ref)
            ? anchorFromPort(created.project, next)
            : null,
      });
    },

    insertFittingAtPort: (kind, target) => {
      const { project } = get();
      const port = resolvePort(project, target);
      if (!port) {
        get().notify('error', 'Porta de conexão inexistente.');
        return;
      }
      const input = fittingInput(kind, port);
      if (!input.ok) {
        get().notify('error', input.error.message);
        return;
      }
      const result = attachFitting(project, { target, fitting: input.value });
      if (!result.ok) {
        get().notify('error', result.error.message);
        return;
      }
      commit({ ok: true, value: result.value.project }, `${elementKindLabel(kind)} inserido(a).`);
      set({ selectedId: result.value.elementId });
    },

    insertFittingInline: (kind, pipeId, distanceFromStart) => {
      const { project, toolOptions } = get();
      const result = insertInline(project, {
        pipeId,
        distanceFromStart,
        fitting: kind === 'valve' ? { kind, valveType: toolOptions.valveType } : { kind },
      });
      if (!result.ok) {
        get().notify('error', result.error.message);
        return;
      }
      commit(
        { ok: true, value: result.value.project },
        `${elementKindLabel(kind)} inserido(a) em linha; o tubo foi dividido em dois trechos.`,
      );
      set({ selectedId: result.value.elementId });
    },

    changeSpec: (elementId, specificationId, dn, portId) => {
      const { project, toolOptions } = get();
      const spec =
        resolvePipeSpec(specificationId, dn) ?? resolveNearestPipeSpec(specificationId, dn);
      if (!spec) {
        get().notify('error', 'Especificação inexistente no catálogo.');
        return;
      }
      commit(
        applySpec(project, elementId, spec, { propagate: toolOptions.propagateSpec, portId }),
        `Especificação alterada para ${spec.sizeLabel}.`,
      );
    },

    rename: (elementId, name) => {
      commit(renameElement(get().project, elementId, name));
    },
    movePipeEnd: (pipeId, which, point) => {
      commit(setPipeEndpoint(get().project, pipeId, which, point));
    },
    changePipeLength: (pipeId, length) => {
      commit(setPipeLength(get().project, pipeId, length));
    },
    changeFitting: (elementId, patch) => {
      commit(updateFitting(get().project, elementId, patch));
    },
    roll: (elementId, axisPortId, angleDeg) => {
      commit(rollFitting(get().project, elementId, axisPortId, degToRad(angleDeg)));
    },
    setProperty: (elementId, key, value) => {
      commit(setElementProperty(get().project, elementId, key, value));
    },

    disconnectPort: (ref) => {
      const { project } = get();
      const connection = project.connections.find(
        (c) =>
          (c.a.elementId === ref.elementId && c.a.portId === ref.portId) ||
          (c.b.elementId === ref.elementId && c.b.portId === ref.portId),
      );
      if (!connection) return;
      commit(disconnect(project, connection.id), 'Porta desconectada.');
    },

    deleteSelected: () => {
      const { project, selectedId } = get();
      const element = selectedId ? getElement(project, selectedId) : undefined;
      if (!element) return;
      commit(
        { ok: true, value: deleteElements(project, [element.id]) },
        `"${element.name}" excluído.`,
      );
      set({ selectedId: null, anchor: null });
    },

    undo: () => {
      const { past, future, project } = get();
      const previous = past[past.length - 1];
      if (!previous) return;
      set({
        project: previous,
        past: past.slice(0, -1),
        future: [project, ...future],
        anchor: null,
      });
    },

    redo: () => {
      const { past, future, project } = get();
      const next = future[0];
      if (!next) return;
      set({ project: next, past: [...past, project], future: future.slice(1), anchor: null });
    },
  };
});

/** Há alterações desde o carregamento ou o último salvamento. */
export const selectIsDirty = (state: EditorState): boolean => state.savedProject !== state.project;
