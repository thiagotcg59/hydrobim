import {
  BUILTIN_FAMILIES,
  defaultPipeSpec,
  getSpecification,
  resolveNearestPipeSpec,
  resolvePipeSpec,
} from '@hydrobim/catalog';
import {
  addLevel,
  addSystem,
  applyFamilyToInstances,
  applySpec,
  attachFitting,
  copyElements,
  createFamilyCatalog,
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
  mergeFamilies,
  placeEquipment,
  POSITION_TOLERANCE,
  removeFamily,
  removeLevel,
  removeSystem,
  renameElement,
  resizeWithReducers,
  resolvePort,
  rollFitting,
  setElementProperty,
  setElementsSystem,
  setGeoreference,
  setPipeEndpoint,
  setPipeLength,
  setTerrain,
  translateElements,
  updateFitting,
  updateLevel,
  updateProjectInfo,
  updateSystem,
  upsertFamily,
  type Discipline,
  type FamilyKind,
  type FittingCatalog,
  type FittingFamily,
  type FittingInput,
  type FittingKind,
  type FittingPatch,
  type Georeference,
  type HydraulicSystem,
  type PipeSpec,
  type Port,
  type PortRef,
  type Project,
  type PropertyValue,
  type Result,
  type SystemKind,
  type Terrain,
  type ValveType,
  type Vec3,
} from '@hydrobim/core';
import { create } from 'zustand';
import { distanceAlongPipe, type SnapKind } from '../editor/picking';

export type ToolId =
  'select' | 'pipe' | 'elbow' | 'tee' | 'reducer' | 'valve' | 'pump' | 'tank' | 'measure';
export type ViewPreset = 'fit' | 'top' | 'front' | 'iso';
export type MessageLevel = 'info' | 'success' | 'error';
/** Como aplicar uma troca de diâmetro. */
export type SizeMode = 'reducers' | 'propagate';

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
  /** DN da derivação do tê; `null` = igual à passagem. */
  readonly teeBranchDn: number | null;
  /**
   * `reducers`: altera só o elemento e insere/ajusta reduções junto aos vizinhos;
   * `propagate`: aplica a todo o trecho conectado.
   */
  readonly sizeMode: SizeMode;
  /** Família preferida por tipo de conexão (`null`/ausente = primeira compatível). */
  readonly families: Partial<Record<FamilyKind, string | null>>;
}

/** Clique no viewport já resolvido para o domínio. */
export interface ViewportClick {
  readonly point: Vec3 | null;
  readonly port: PortRef | null;
  readonly hit: { elementId: string; point: Vec3 } | null;
  /** Ctrl/Shift pressionado: adiciona ou remove da seleção. */
  readonly additive?: boolean;
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
  /** Elementos selecionados; o primeiro é o principal (painel de propriedades). */
  selection: string[];
  tool: ToolId;
  activeSpec: PipeSpec;
  toolOptions: ToolOptions;
  workPlaneZ: number;
  gridStep: number;
  snapToGrid: boolean;
  orthographic: boolean;
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
  select: (id: string | null, additive?: boolean) => void;
  selectMany: (ids: string[]) => void;
  setActiveSpec: (specificationId: string, dn: number) => void;
  setToolOptions: (patch: Partial<ToolOptions>) => void;
  setPreferredFamily: (kind: FamilyKind, familyId: string | null) => void;
  setWorkPlaneZ: (z: number) => void;
  setGridStep: (step: number) => void;
  setSnapToGrid: (enabled: boolean) => void;
  setOrthographic: (enabled: boolean) => void;
  setCursor: (cursor: CursorInfo | null) => void;
  requestView: (preset: ViewPreset) => void;
  cancelInteraction: () => void;

  handleViewportClick: (click: ViewportClick) => void;
  /** Informa um ponto por coordenadas (tubo, medição, bomba e reservatório). */
  commitPoint: (point: Vec3, port?: PortRef | null) => void;
  insertFittingAtPort: (kind: FittingKind, target: PortRef) => void;
  insertFittingInline: (kind: 'tee' | 'valve', pipeId: string, distanceFromStart: number) => void;

  changeSpec: (elementId: string, specificationId: string, dn: number, portId?: string) => void;
  rename: (elementId: string, name: string) => void;
  movePipeEnd: (pipeId: string, which: 'start' | 'end', point: Vec3) => void;
  changePipeLength: (pipeId: string, length: number) => void;
  changeFitting: (elementId: string, patch: FittingPatch) => void;
  roll: (elementId: string, axisPortId: string, angleDeg: number) => void;
  setProperty: (elementId: string, key: string, value: PropertyValue | undefined) => void;
  disconnectPort: (ref: PortRef) => void;
  deleteSelected: () => void;
  moveSelection: (delta: Vec3) => void;
  copySelection: (delta: Vec3) => void;
  assignSystem: (systemId: string) => void;

  addLevel: (name: string, elevation: number) => void;
  updateLevel: (id: string, patch: { name?: string; elevation?: number }) => void;
  removeLevel: (id: string) => void;
  addSystem: (name: string, kind: SystemKind) => void;
  updateSystem: (id: string, patch: Partial<Omit<HydraulicSystem, 'id'>>) => void;
  removeSystem: (id: string) => void;
  saveFamily: (family: FittingFamily, applyToInstances: boolean) => boolean;
  resetFamily: (familyId: string) => void;
  setGeoreference: (georeference: Georeference | null) => void;
  setTerrain: (terrain: Terrain | null) => void;

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

/** Famílias disponíveis: catálogo embutido + personalizações do projeto. */
export function familiesOf(project: Project): FittingFamily[] {
  return mergeFamilies(BUILTIN_FAMILIES, project.families);
}

/** Catálogo de conexões efetivo (famílias do projeto + preferências do usuário). */
export function catalogOf(
  project: Project,
  preferred: ToolOptions['families'] = {},
): FittingCatalog {
  return createFamilyCatalog(familiesOf(project), preferred);
}

const initialProject = createProject('Projeto sem título', 'mep');
const success = <T>(value: T): Result<T> => ({ ok: true, value });

export const useEditorStore = create<EditorState>()((set, get) => {
  /** Aplica o resultado de uma operação de domínio, registrando histórico e mensagens. */
  function commit(result: Result<Project>, successMessage?: string): boolean {
    if (!result.ok) {
      set({ message: { level: 'error', text: result.error.message, at: Date.now() } });
      return false;
    }
    const { project, past } = get();
    if (result.value !== project) {
      set({
        project: result.value,
        past: [...past, project].slice(-HISTORY_LIMIT),
        future: [],
      });
    }
    if (successMessage) {
      set({ message: { level: 'success', text: successMessage, at: Date.now() } });
    }
    return true;
  }

  const catalog = (): FittingCatalog => catalogOf(get().project, get().toolOptions.families);

  function fittingInput(kind: FittingKind, port: Port): Result<FittingInput> {
    const { toolOptions } = get();
    switch (kind) {
      case 'elbow':
        return success({
          kind,
          angle: degToRad(toolOptions.elbowAngleDeg),
          familyId: toolOptions.families.elbow,
        });
      case 'tee': {
        const familyId = toolOptions.families.tee;
        const dn = toolOptions.teeBranchDn;
        if (dn === null || dn === port.spec.dn) return success({ kind, familyId });
        const branchSpec = resolvePipeSpec(port.spec.specificationId, dn);
        if (!branchSpec) {
          return {
            ok: false,
            error: {
              code: 'NO_BRANCH_SIZE',
              message: `A especificação "${port.spec.standard}" não possui o diâmetro escolhido para a derivação.`,
            },
          };
        }
        return success({ kind, branchSpec, familyId });
      }
      case 'valve':
        return success({
          kind,
          valveType: toolOptions.valveType,
          familyId: toolOptions.families.valve,
        });
      case 'pump':
      case 'tank':
        return success({ kind });
      case 'reducer': {
        const sizes = getSpecification(port.spec.specificationId)?.sizes ?? [];
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
        return success({ kind, outletSpec, familyId: toolOptions.families.reducer });
      }
    }
  }

  return {
    project: initialProject,
    savedProject: initialProject,
    persisted: false,
    past: [],
    future: [],
    selection: [],
    tool: 'select',
    activeSpec: defaultPipeSpec('mep'),
    toolOptions: {
      elbowAngleDeg: 90,
      valveType: 'gate',
      reducerDn: null,
      teeBranchDn: null,
      sizeMode: 'reducers',
      families: {},
    },
    workPlaneZ: 0,
    gridStep: 0.1,
    snapToGrid: true,
    orthographic: false,
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
        selection: [],
        anchor: null,
        measure: { a: null, b: null },
        tool: 'select',
        activeSpec: defaultPipeSpec(project.discipline),
        gridStep: gridStepFor(project.discipline),
        workPlaneZ: 0,
        viewRequest: { preset: 'fit', nonce: (state.viewRequest?.nonce ?? 0) + 1 },
      })),

    newProject: (discipline = 'mep') =>
      get().loadProject(createProject('Projeto sem título', discipline)),

    markSaved: () => set((state) => ({ savedProject: state.project, persisted: true })),

    setProjectName: (name) => {
      const { project } = get();
      if (name === project.name) return;
      commit(success(updateProjectInfo(project, { name })));
    },

    setDiscipline: (discipline) => {
      const { project } = get();
      if (discipline === project.discipline) return;
      commit(success(updateProjectInfo(project, { discipline })));
      set({
        activeSpec: defaultPipeSpec(discipline),
        gridStep: gridStepFor(discipline),
        message: {
          level: 'info',
          text:
            discipline === 'infra'
              ? 'Ambiente Infra: especificação e grade ajustadas para redes e adutoras.'
              : 'Ambiente MEP: especificação e grade ajustadas para instalações prediais.',
          at: Date.now(),
        },
      });
    },

    setTool: (tool) => set({ tool, anchor: null, measure: { a: null, b: null } }),

    select: (id, additive = false) =>
      set((state) => {
        if (id === null) return { selection: additive ? state.selection : [] };
        if (!additive) return { selection: [id] };
        return {
          selection: state.selection.includes(id)
            ? state.selection.filter((s) => s !== id)
            : [...state.selection, id],
        };
      }),

    selectMany: (ids) => set({ selection: [...new Set(ids)] }),

    setActiveSpec: (specificationId, dn) => {
      const spec =
        resolvePipeSpec(specificationId, dn) ?? resolveNearestPipeSpec(specificationId, dn);
      if (spec) set({ activeSpec: spec });
    },

    setToolOptions: (patch) =>
      set((state) => ({ toolOptions: { ...state.toolOptions, ...patch } })),

    setPreferredFamily: (kind, familyId) =>
      set((state) => ({
        toolOptions: {
          ...state.toolOptions,
          families: { ...state.toolOptions.families, [kind]: familyId },
        },
      })),

    setWorkPlaneZ: (z) => {
      if (Number.isFinite(z)) set({ workPlaneZ: z });
    },
    setGridStep: (step) => {
      if (Number.isFinite(step) && step > 0) set({ gridStep: step });
    },
    setSnapToGrid: (enabled) => set({ snapToGrid: enabled }),
    setOrthographic: (enabled) =>
      set((state) => ({
        orthographic: enabled,
        viewRequest: { preset: 'fit', nonce: (state.viewRequest?.nonce ?? 0) + 1 },
      })),
    setCursor: (cursor) => set({ cursor }),

    requestView: (preset) =>
      set((state) => ({ viewRequest: { preset, nonce: (state.viewRequest?.nonce ?? 0) + 1 } })),

    cancelInteraction: () => {
      const { anchor, measure, tool } = get();
      if (anchor || measure.a) set({ anchor: null, measure: { a: null, b: null } });
      else if (tool !== 'select') set({ tool: 'select' });
      else set({ selection: [] });
    },

    handleViewportClick: (click) => {
      const state = get();
      const { tool, project } = state;
      const port = click.port ? resolvePort(project, click.port) : undefined;

      if (tool === 'select') {
        state.select(click.hit?.elementId ?? null, click.additive);
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
      if (tool === 'pump' || tool === 'tank') {
        if (click.point) state.commitPoint(click.point);
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

      if (tool === 'pump' || tool === 'tank') {
        const result = placeEquipment(project, {
          fitting: { kind: tool },
          spec: state.activeSpec,
          position: point,
        });
        if (!result.ok) {
          state.notify('error', result.error.message);
          return;
        }
        commit(success(result.value.project), `${elementKindLabel(tool)} posicionado(a).`);
        set({ selection: [result.value.elementId] });
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
        catalog: catalog(),
      });
      if (!result.ok) {
        state.notify('error', result.error.message);
        return;
      }
      const created = result.value;
      const withElbow = created.createdIds.length > 1;
      commit(
        success(created.project),
        withElbow ? 'Tubo criado com joelho automático.' : 'Tubo criado.',
      );
      // Continua a polilinha a partir da extremidade final, se ela permanecer livre.
      const next = resolvePort(created.project, { elementId: created.elementId, portId: 'end' });
      set({
        selection: [created.elementId],
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
      const result = attachFitting(project, { target, fitting: input.value, catalog: catalog() });
      if (!result.ok) {
        get().notify('error', result.error.message);
        return;
      }
      commit(success(result.value.project), `${elementKindLabel(kind)} inserido(a).`);
      set({ selection: [result.value.elementId] });
    },

    insertFittingInline: (kind, pipeId, distanceFromStart) => {
      const { project, toolOptions } = get();
      const pipe = getElement(project, pipeId);
      const branchDn = toolOptions.teeBranchDn;
      const branchSpec =
        kind === 'tee' && pipe && branchDn !== null && branchDn !== pipe.spec.dn
          ? resolvePipeSpec(pipe.spec.specificationId, branchDn)
          : undefined;
      const result = insertInline(project, {
        pipeId,
        distanceFromStart,
        fitting:
          kind === 'valve'
            ? { kind, valveType: toolOptions.valveType, familyId: toolOptions.families.valve }
            : { kind, familyId: toolOptions.families.tee, ...(branchSpec ? { branchSpec } : {}) },
        catalog: catalog(),
      });
      if (!result.ok) {
        get().notify('error', result.error.message);
        return;
      }
      commit(
        success(result.value.project),
        `${elementKindLabel(kind)} inserido(a) em linha; o tubo foi dividido em dois trechos.`,
      );
      set({ selection: [result.value.elementId] });
    },

    changeSpec: (elementId, specificationId, dn, portId) => {
      const { project, toolOptions } = get();
      const element = getElement(project, elementId);
      const spec =
        resolvePipeSpec(specificationId, dn) ?? resolveNearestPipeSpec(specificationId, dn);
      if (!element || !spec) {
        get().notify('error', 'Especificação inexistente no catálogo.');
        return;
      }
      const current = resolvePort(project, {
        elementId,
        portId: portId ?? (element.kind === 'pipe' ? 'start' : 'a'),
      })?.spec;
      const sameSpecification = current?.specificationId === spec.specificationId;
      // Troca de material e reduções sempre se aplicam ao trecho; o modo "reduções" só
      // faz sentido para mudar o diâmetro de uma peça dentro da mesma especificação.
      const useReducers =
        toolOptions.sizeMode === 'reducers' && sameSpecification && element.kind !== 'reducer';

      if (useReducers) {
        const result = resizeWithReducers(project, elementId, spec, { portId, catalog: catalog() });
        if (!result.ok) {
          get().notify('error', result.error.message);
          return;
        }
        const { createdIds, removedIds } = result.value;
        const details = [
          createdIds.length > 0 ? `${createdIds.length} redução(ões) inserida(s)` : '',
          removedIds.length > 0 ? `${removedIds.length} redução(ões) removida(s)` : '',
        ].filter(Boolean);
        commit(
          success(result.value.project),
          `Diâmetro alterado para ${spec.sizeLabel}${details.length ? ` — ${details.join(', ')}` : ''}.`,
        );
        return;
      }
      commit(
        applySpec(project, elementId, spec, { propagate: true, portId, catalog: catalog() }),
        `Especificação alterada para ${spec.sizeLabel} em todo o trecho conectado.`,
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
      const { project, selection } = get();
      const existing = selection.filter((id) => getElement(project, id));
      if (existing.length === 0) return;
      const first = getElement(project, existing[0] ?? '');
      commit(
        success(deleteElements(project, existing)),
        existing.length === 1
          ? `"${first?.name}" excluído.`
          : `${existing.length} elementos excluídos.`,
      );
      set({ selection: [], anchor: null });
    },

    moveSelection: (delta) => {
      const { project, selection } = get();
      if (selection.length === 0) return;
      commit(
        translateElements(project, selection, delta),
        `${selection.length} elemento(s) movido(s).`,
      );
    },

    copySelection: (delta) => {
      const { project, selection } = get();
      if (selection.length === 0) return;
      const result = copyElements(project, selection, delta);
      if (!result.ok) {
        get().notify('error', result.error.message);
        return;
      }
      commit(
        success(result.value.project),
        `${result.value.createdIds.length} elemento(s) copiado(s).`,
      );
      set({ selection: result.value.createdIds });
    },

    assignSystem: (systemId) => {
      const { project, selection } = get();
      commit(setElementsSystem(project, selection, systemId), 'Sistema alterado.');
    },

    addLevel: (name, elevation) => {
      commit(addLevel(get().project, name, elevation), 'Nível criado.');
    },
    updateLevel: (id, patch) => {
      commit(updateLevel(get().project, id, patch));
    },
    removeLevel: (id) => {
      commit(removeLevel(get().project, id), 'Nível excluído.');
    },
    addSystem: (name, kind) => {
      commit(addSystem(get().project, name, kind), 'Sistema criado.');
    },
    updateSystem: (id, patch) => {
      commit(updateSystem(get().project, id, patch));
    },
    removeSystem: (id) => {
      commit(removeSystem(get().project, id), 'Sistema excluído.');
    },

    saveFamily: (family, applyToInstances) => {
      const saved = upsertFamily(get().project, family);
      if (!saved.ok) {
        get().notify('error', saved.error.message);
        return false;
      }
      if (!applyToInstances) {
        return commit(saved, `Família "${family.name}" salva no projeto.`);
      }
      const applied = applyFamilyToInstances(
        saved.value,
        family.id,
        catalogOf(saved.value, get().toolOptions.families),
      );
      if (!applied.ok) {
        get().notify('error', `Família não aplicada: ${applied.error.message}`);
        return false;
      }
      return commit(
        success(applied.value.project),
        `Família "${family.name}" salva e aplicada a ${applied.value.updated} peça(s) do projeto.`,
      );
    },

    resetFamily: (familyId) => {
      commit(success(removeFamily(get().project, familyId)), 'Família restaurada ao catálogo.');
    },

    setGeoreference: (georeference) => {
      commit(
        setGeoreference(get().project, georeference),
        georeference ? 'Georreferência definida.' : 'Georreferência removida.',
      );
    },

    setTerrain: (terrain) => {
      commit(
        success(setTerrain(get().project, terrain)),
        terrain ? `Terreno "${terrain.name}" importado.` : 'Terreno removido.',
      );
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

/** Elemento principal da seleção (para o painel de propriedades). */
export const selectPrimaryId = (state: EditorState): string | null => state.selection[0] ?? null;
