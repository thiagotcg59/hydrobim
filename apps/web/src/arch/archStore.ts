import {
  addFloor,
  addFloorOpening,
  addHosted,
  addSpace,
  addWalls,
  ARCH_KIND_LABELS,
  archSeatOffset,
  archTypeUsage,
  copyArchElements,
  deleteArchElements,
  getArchElement,
  getArchType,
  GROUND_SURFACE_LABELS,
  hasDesignTerrain,
  formatMeters,
  mirrorArchElements,
  moveArchElements,
  removeFloorOpening,
  rotateArchElements,
  seatArchElement,
  updateArchElement,
  type ArchCategory,
  type ArchElementPatch,
  type GroundSurface,
  type SeatableArchKind,
  type Point2,
  type Project,
  type Result,
  type WallLocationLine,
} from '@hydrobim/core';
import { setArchIfcValue, type IfcScope, type IfcValue } from '@hydrobim/ifc';
import { create } from 'zustand';
import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { useTerrainStore } from '../terrain/terrainStore';
import { useViewStore } from '../views/viewStore';
import {
  activeTypeIdOf,
  hostedCarriedBy,
  hostedPlacementAt,
  parseLength,
  pointAtLength,
  workLevelIdOf,
} from './archGeometry';

/**
 * Sessão da arquitetura: ferramenta em uso, pontos já indicados, tipo ativo por categoria,
 * opções do próximo elemento e seleção de elementos arquitetônicos. Nada daqui é dado do
 * projeto nem entra no histórico: os elementos vivem em `project.architecture` e toda alteração
 * passa pelas operações de `@hydrobim/core`, em um passo do histórico da store do editor.
 */

export const ARCH_TOOLS = [
  'wall',
  'slab',
  'flooring',
  'door',
  'window',
  'space',
  'floorOpening',
] as const;
export type ArchTool = (typeof ARCH_TOOLS)[number];

export const ARCH_TOOL_LABELS: Record<ArchTool, string> = {
  wall: 'Parede',
  slab: 'Laje',
  flooring: 'Piso',
  door: 'Porta',
  window: 'Janela',
  space: 'Ambiente',
  floorOpening: 'Abertura no piso',
};

export const ARCH_TOOL_HINTS: Record<ArchTool, string> = {
  wall: 'Parede: clique os pontos do traçado na planta (extremidades e faces das paredes existentes e a grade são capturadas). Digite um valor para definir o comprimento do trecho na direção do cursor. Shift trava o trecho de 45° em 45°. Enter ou duplo clique conclui; Backspace desfaz o último ponto; Esc cancela.',
  slab: 'Laje: clique os vértices do contorno na planta. Shift trava o lado de 45° em 45°. Enter (ou o clique no primeiro ponto) fecha o contorno; Backspace desfaz o último ponto; Esc cancela.',
  flooring:
    'Piso (revestimento): clique os vértices do contorno na planta. Shift trava o lado de 45° em 45°. Enter (ou o clique no primeiro ponto) fecha o contorno; Backspace desfaz o último ponto; Esc cancela.',
  door: 'Porta: clique sobre uma parede na planta. A prévia mostra o vão (em vermelho, quando não cabe). A posição, a mão e a face são refinadas no painel de propriedades. Esc encerra.',
  window:
    'Janela: clique sobre uma parede na planta. A prévia mostra o vão (em vermelho, quando não cabe). A posição e o peitoril são refinados no painel de propriedades. Esc encerra.',
  space:
    'Ambiente: clique os vértices do contorno da região na planta. Enter (ou o clique no primeiro ponto) fecha o contorno; Esc cancela.',
  floorOpening:
    'Abertura no piso: clique os vértices do contorno da abertura, dentro da laje ou do piso selecionado. Enter fecha o contorno; Esc cancela.',
};

/** Categoria de tipo exigida por cada ferramenta (ambiente e abertura não têm tipo). */
export const ARCH_TOOL_CATEGORY: Partial<Record<ArchTool, ArchCategory>> = {
  wall: 'wall',
  slab: 'slab',
  flooring: 'flooring',
  door: 'door',
  window: 'window',
};

/**
 * Onde a base do próximo elemento assenta: no nível do plano de trabalho ou sobre o terreno
 * (natural ou projetado), na cota do primeiro ponto do traçado ou do contorno.
 */
export type ArchSeat = 'level' | GroundSurface;

/** Assentamento que vale agora: sem superfície de terreno, sempre o nível. */
export const effectiveSeatOf = (project: Pick<Project, 'terrain'>, seat: ArchSeat): ArchSeat =>
  project.terrain ? seat : 'level';

/** Nome da superfície nas mensagens; sem platôs natural e projetado coincidem: "terreno". */
export const seatGroundLabel = (project: Project, surface: GroundSurface): string =>
  hasDesignTerrain(project) ? GROUND_SURFACE_LABELS[surface] : 'terreno';

/** Opções do próximo elemento (parâmetros de desenho, não dados cadastrais). */
export interface ArchOptions {
  /**
   * Referência vertical de paredes, lajes, pisos e ambientes. Sobre o terreno, os
   * deslocamentos abaixo (`wallBaseOffset`, `floorOffset`) passam a ser a folga da BASE acima
   * do terreno.
   */
  seat: ArchSeat;
  /** Altura das próximas paredes (m). */
  wallHeight: number;
  /** Deslocamento da base das próximas paredes em relação ao nível (m). */
  wallBaseOffset: number;
  locationLine: WallLocationLine;
  /** Traçado fechado: o último ponto é ligado ao primeiro ao concluir. */
  closed: boolean;
  /** Laje: cota do topo; piso: cota da base — em relação ao nível (m). */
  floorOffset: number;
  /** Peitoril das próximas janelas; `null` = o do tipo. */
  sillHeight: number | null;
  hand: 'left' | 'right';
  facing: 1 | -1;
  /** Pé-direito dos próximos ambientes; `null` = não informado. */
  spaceHeight: number | null;
}

const DEFAULT_OPTIONS: ArchOptions = {
  seat: 'level',
  wallHeight: 2.8,
  wallBaseOffset: 0,
  locationLine: 'center',
  closed: false,
  floorOffset: 0,
  sillHeight: null,
  hand: 'left',
  facing: 1,
  spaceHeight: null,
};

interface ArchState {
  tool: ArchTool | null;
  /** Pontos já indicados do traçado ou do contorno (planta, coordenadas do projeto). */
  points: Point2[];
  /** Ponto capturado sob o cursor. */
  cursor: Point2 | null;
  activeTypes: Partial<Record<ArchCategory, string>>;
  options: ArchOptions;
  /** Elementos arquitetônicos selecionados (exclusiva com a seleção da rede). */
  selection: string[];
  /** Laje ou piso que recebe a abertura em desenho. */
  openingTarget: string | null;

  setTool: (tool: ArchTool | null) => void;
  /** Categoria em que o catálogo de arquitetura abre (`null` = todas). */
  catalogCategory: ArchCategory | null;
  /** Abre o catálogo de arquitetura, opcionalmente já filtrado por uma categoria. */
  openCatalog: (category?: ArchCategory | null) => void;
  setCursor: (cursor: Point2 | null) => void;
  setOptions: (patch: Partial<ArchOptions>) => void;
  setActiveType: (category: ArchCategory, typeId: string) => void;
  /** "Usar este tipo" (catálogo): define o tipo ativo e aciona a ferramenta da categoria. */
  activateType: (typeId: string, category: ArchCategory) => void;
  /** Clique na planta; `tolerance` (m) é o raio de captura da parede sob o cursor. */
  clickPoint: (point: Point2, tolerance?: number) => void;
  /** Conclui o traçado de paredes ou fecha o contorno em andamento. */
  finish: (closed?: boolean) => boolean;
  removeLastPoint: () => void;
  /** Comprimento digitado do trecho, na direção do cursor. */
  submitLength: (text: string) => boolean;
  /** Esc: desfaz o que estiver em andamento; devolve `false` quando não havia nada. */
  cancel: () => boolean;
  select: (id: string | null, additive?: boolean) => void;
  selectMany: (ids: readonly string[]) => void;
  deleteSelected: () => boolean;
  update: (id: string, patch: ArchElementPatch) => boolean;
  /** Leva a base do elemento à cota do terreno no seu ponto de referência. */
  seat: (id: string, surface: GroundSurface) => boolean;
  /** Informa (ou limpa, com `null`) um valor IFC do tipo ou da ocorrência do elemento. */
  setIfcValue: (elementId: string, scope: IfcScope, key: string, value: IfcValue | null) => boolean;
  removeOpening: (floorId: string, openingId: string) => boolean;
  move: (delta: Point2, dz?: number) => boolean;
  copy: (delta: Point2, dz?: number) => boolean;
  rotate: (center: Point2, angle: number, copy?: boolean) => boolean;
  mirror: (a: Point2, b: Point2, copy?: boolean) => boolean;
}

const editor = () => useEditorStore.getState();
const apply = (result: Result<Project>, message?: string): boolean =>
  editor().applyOperation(result, message);
const done = (project: Project): Result<Project> => ({ ok: true, value: project });
const same = (a: Point2, b: Point2): boolean => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

const NO_TYPE: Record<ArchCategory, string> = {
  wall: 'Nenhum tipo de parede no projeto: abra o Catálogo de arquitetura e adicione um.',
  slab: 'Nenhum tipo de laje no projeto: abra o Catálogo de arquitetura e adicione um.',
  flooring:
    'Nenhum tipo de revestimento de piso no projeto: abra o Catálogo de arquitetura e adicione um.',
  door: 'Nenhum tipo de porta no projeto: abra o Catálogo de arquitetura e adicione um.',
  window: 'Nenhum tipo de janela no projeto: abra o Catálogo de arquitetura e adicione um.',
};

/**
 * Por que a ferramenta não pode ser usada agora (mensagem pronta) ou `null` se pode: falta de
 * tipo da categoria, de parede hospedeira ou de piso selecionado. Função pura, usada também
 * pela disponibilidade dos comandos.
 */
export function archToolBlocker(
  project: Pick<Project, 'architecture' | 'levels'>,
  tool: ArchTool,
  selection: readonly string[],
  active: Partial<Record<ArchCategory, string>> = {},
): string | null {
  if (project.levels.length === 0) {
    return 'O projeto não tem níveis: crie um em Gerenciar › Níveis.';
  }
  const category = ARCH_TOOL_CATEGORY[tool];
  if ((tool === 'door' || tool === 'window') && !hasWall(project)) {
    return 'O projeto ainda não tem paredes: portas e janelas são hospedadas em uma parede.';
  }
  if (category && !activeTypeIdOf(project, active, category)) return NO_TYPE[category];
  if (tool === 'floorOpening' && !floorTargetOf(project, selection)) {
    return 'Selecione uma laje ou um piso (um só) para receber a abertura.';
  }
  return null;
}

/**
 * Categoria cujo tipo falta para a ferramenta, quando esse é o único impedimento: a
 * ferramenta não fica bloqueada — leva ao catálogo, já na categoria, para criar o tipo.
 */
export function archMissingTypeCategory(
  project: Pick<Project, 'architecture' | 'levels'>,
  tool: ArchTool,
  selection: readonly string[],
  active: Partial<Record<ArchCategory, string>> = {},
): ArchCategory | null {
  const category = ARCH_TOOL_CATEGORY[tool];
  if (!category) return null;
  return archToolBlocker(project, tool, selection, active) === NO_TYPE[category] ? category : null;
}

const hasWall = (project: Pick<Project, 'architecture'>): boolean =>
  project.architecture.elements.some((element) => element.kind === 'wall');

function floorTargetOf(
  project: Pick<Project, 'architecture'>,
  selection: readonly string[],
): string | null {
  if (selection.length !== 1 || !selection[0]) return null;
  const element = getArchElement(project.architecture, selection[0]);
  return element && (element.kind === 'slab' || element.kind === 'flooring') ? element.id : null;
}

export const useArchStore = create<ArchState>()((set, get) => {
  /** Aplica uma operação que devolve o projeto e os elementos criados; seleciona os criados. */
  const created = (
    result: Result<{ project: Project; elementIds: string[] }>,
    message: (ids: string[]) => string,
  ): boolean => {
    if (!result.ok) {
      editor().notify('error', result.error.message);
      return false;
    }
    apply(done(result.value.project), message(result.value.elementIds));
    get().selectMany(result.value.elementIds);
    return true;
  };

  /** Nível e tipo do próximo elemento; avisa e devolve `null` quando falta algum. */
  const context = (
    category: ArchCategory | null,
  ): { project: Project; levelId: string; typeId: string } | null => {
    const state = editor();
    const levelId = workLevelIdOf(state.project, state.workPlaneZ);
    if (!levelId) {
      state.notify('error', 'O projeto não tem níveis: crie um em Gerenciar › Níveis.');
      return null;
    }
    const typeId = category ? activeTypeIdOf(state.project, get().activeTypes, category) : '';
    if (typeId === null) {
      if (category) state.notify('error', NO_TYPE[category]);
      return null;
    }
    return { project: state.project, levelId, typeId };
  };

  /**
   * Deslocamento (rel. ao nível) do próximo elemento e o complemento da mensagem: no nível, a
   * própria folga; sobre o terreno, a regra do núcleo (`archSeatOffset`) no primeiro ponto.
   * Fora da superfície vale o nível, e a mensagem diz.
   */
  const seated = (
    project: Project,
    target: { kind: SeatableArchKind; levelId: string; typeId?: string },
    point: Point2 | undefined,
    clearance: number,
  ): { offset: number; note: string } => {
    const seat = effectiveSeatOf(project, get().options.seat);
    if (seat === 'level' || !point) return { offset: clearance, note: '' };
    const label = seatGroundLabel(project, seat);
    const result = archSeatOffset(project, seat, target, point, clearance);
    if (!result) {
      return {
        offset: clearance,
        note: ` O primeiro ponto está fora da superfície do ${label}: usado o nível do plano de trabalho.`,
      };
    }
    return {
      offset: result.offset,
      note: ` Base assentada sobre o ${label}, na cota ${formatMeters(result.base, 3)}.`,
    };
  };

  const placeHosted = (kind: 'door' | 'window', point: Point2, tolerance: number): void => {
    const ready = context(kind);
    if (!ready) return;
    const state = editor();
    const { options } = get();
    const placement = hostedPlacementAt(ready.project, kind, ready.typeId, point, {
      tolerance,
      gridStep: state.snapToGrid ? state.gridStep : 0,
      sillHeight: kind === 'window' ? options.sillHeight : null,
    });
    if (!placement) {
      state.notify('info', `${ARCH_KIND_LABELS[kind]}: clique sobre uma parede.`);
      return;
    }
    created(
      addHosted(ready.project, {
        kind,
        typeId: ready.typeId,
        hostId: placement.wall.id,
        at: placement.offset,
        ...(kind === 'window' && options.sillHeight !== null
          ? { sillHeight: options.sillHeight }
          : {}),
        hand: options.hand,
        facing: options.facing,
      }),
      () =>
        `${ARCH_KIND_LABELS[kind]} inserida em "${placement.wall.name}". Refine a posição no painel de propriedades.`,
    );
  };

  /** Operação sobre a seleção que devolve só o projeto. */
  const onSelection = (
    run: (project: Project, ids: string[]) => Result<Project>,
    message: string,
  ): boolean => {
    const { selection } = get();
    if (selection.length === 0) return false;
    return apply(run(editor().project, selection), message);
  };

  return {
    tool: null,
    points: [],
    cursor: null,
    activeTypes: {},
    options: DEFAULT_OPTIONS,
    selection: [],
    openingTarget: null,

    catalogCategory: null,
    openCatalog: (category = null) => {
      set({ catalogCategory: category });
      useUiStore.getState().openDialog('archCatalog');
    },
    setTool: (tool) => {
      if (tool === null) {
        if (get().tool === null) return;
        set({ tool: null, points: [], cursor: null, openingTarget: null });
        if (editor().tool === 'select') useUiStore.getState().setPanelTab('properties');
        return;
      }
      const state = editor();
      const blocker = archToolBlocker(state.project, tool, get().selection, get().activeTypes);
      const missing = archMissingTypeCategory(
        state.project,
        tool,
        get().selection,
        get().activeTypes,
      );
      if (missing) {
        // Sem tipo da categoria: o caminho é criar um no catálogo ("Usar este tipo" volta à ferramenta).
        state.notify('info', `${ARCH_TOOL_LABELS[tool]}: ${NO_TYPE[missing]}`);
        get().openCatalog(missing);
        return;
      }
      if (blocker) {
        state.notify('info', `${ARCH_TOOL_LABELS[tool]}: ${blocker}`);
        return;
      }
      const openingTarget =
        tool === 'floorOpening' ? floorTargetOf(state.project, get().selection) : null;
      // As ferramentas de arquitetura atuam na planta de trabalho, com Selecionar na rede.
      const views = useViewStore.getState();
      if (views.open2d) views.closeView('2d');
      if (views.tool !== 'select') views.setTool('select');
      if (useTerrainStore.getState().mode) useTerrainStore.getState().setMode(null);
      if (state.tool !== 'select') state.setTool('select');
      if (editor().viewMode !== 'plan') editor().setViewMode('plan');
      set({ tool, points: [], cursor: null, openingTarget });
      useUiStore.getState().setPanelTab('tool');
      editor().notify('info', ARCH_TOOL_HINTS[tool]);
    },

    setCursor: (cursor) => set({ cursor }),
    setOptions: (patch) => set((state) => ({ options: { ...state.options, ...patch } })),
    setActiveType: (category, typeId) =>
      set((state) => ({ activeTypes: { ...state.activeTypes, [category]: typeId } })),
    activateType: (typeId, category) => {
      const type = getArchType(editor().project.architecture, typeId);
      if (!type || type.category !== category) {
        editor().notify('error', 'Tipo inexistente no projeto.');
        return;
      }
      get().setActiveType(category, typeId);
      get().setTool(category);
    },

    clickPoint: (point, tolerance = 0.05) => {
      const { tool, points } = get();
      if (!tool) return;
      if (tool === 'door' || tool === 'window') {
        placeHosted(tool, point, tolerance);
        return;
      }
      const last = points[points.length - 1];
      // O segundo clique de um duplo clique cai no mesmo ponto: não vira vértice.
      if (last && same(last, point)) return;
      const first = points[0];
      if (first && points.length >= 3 && same(first, point)) {
        get().finish(true);
        return;
      }
      set({ points: [...points, point] });
    },

    finish: (closed) => {
      const { tool, points, options, openingTarget } = get();
      if (!tool || tool === 'door' || tool === 'window') return false;
      if (tool === 'wall') {
        if (points.length < 2) {
          editor().notify('info', 'Parede: indique ao menos dois pontos.');
          return false;
        }
        const ready = context('wall');
        if (!ready) return false;
        const base = seated(
          ready.project,
          { kind: 'wall', levelId: ready.levelId, typeId: ready.typeId },
          points[0],
          options.wallBaseOffset,
        );
        const ok = created(
          addWalls(ready.project, {
            typeId: ready.typeId,
            levelId: ready.levelId,
            points,
            height: options.wallHeight,
            baseOffset: base.offset,
            locationLine: options.locationLine,
            closed: closed ?? options.closed,
          }),
          (ids) => `${plural(ids.length, 'parede criada', 'paredes criadas')}.${base.note}`,
        );
        if (ok) set({ points: [] });
        return ok;
      }
      if (points.length < 3) {
        editor().notify('info', `${ARCH_TOOL_LABELS[tool]}: o contorno precisa de três pontos.`);
        return false;
      }
      let ok = false;
      if (tool === 'slab' || tool === 'flooring') {
        const ready = context(tool);
        if (!ready) return false;
        const base = seated(
          ready.project,
          { kind: tool, levelId: ready.levelId, typeId: ready.typeId },
          points[0],
          options.floorOffset,
        );
        ok = created(
          addFloor(ready.project, {
            kind: tool,
            typeId: ready.typeId,
            levelId: ready.levelId,
            boundary: points,
            offset: base.offset,
          }),
          () => `${ARCH_KIND_LABELS[tool]} criad${tool === 'slab' ? 'a' : 'o'}.${base.note}`,
        );
      } else if (tool === 'space') {
        const ready = context(null);
        if (!ready) return false;
        const base = seated(ready.project, { kind: 'space', levelId: ready.levelId }, points[0], 0);
        ok = created(
          addSpace(ready.project, {
            levelId: ready.levelId,
            boundary: points,
            height: options.spaceHeight,
            offset: base.offset,
          }),
          () => `Ambiente criado. Informe o nome e o número no painel de propriedades.${base.note}`,
        );
      } else {
        const result = addFloorOpening(editor().project, openingTarget ?? '', points);
        if (!result.ok) editor().notify('error', result.error.message);
        else ok = apply(done(result.value.project), 'Abertura criada no piso.');
      }
      if (ok) set({ points: [] });
      return ok;
    },

    removeLastPoint: () => set((state) => ({ points: state.points.slice(0, -1) })),

    submitLength: (text) => {
      const { tool, points, cursor } = get();
      const last = points[points.length - 1];
      const length = parseLength(text);
      if (!tool || tool === 'door' || tool === 'window') return false;
      if (length === null) {
        editor().notify('error', 'Comprimento inválido: digite um valor positivo, em metros.');
        return false;
      }
      const next = last && cursor ? pointAtLength(last, cursor, length) : null;
      if (!next) {
        editor().notify(
          'info',
          'Indique o primeiro ponto e aponte a direção com o cursor antes de digitar o comprimento.',
        );
        return false;
      }
      set({ points: [...points, next] });
      return true;
    },

    cancel: () => {
      const { tool, points, selection } = get();
      if (points.length > 0) {
        set({ points: [] });
        return true;
      }
      if (tool) {
        get().setTool(null);
        return true;
      }
      if (selection.length > 0) {
        set({ selection: [] });
        return true;
      }
      return false;
    },

    select: (id, additive = false) => {
      if (id === null) {
        if (!additive && get().selection.length > 0) set({ selection: [] });
        return;
      }
      if (!getArchElement(editor().project.architecture, id)) return;
      const { selection } = get();
      set({
        selection: additive
          ? selection.includes(id)
            ? selection.filter((other) => other !== id)
            : [...selection, id]
          : [id],
      });
      // Seleção exclusiva: a da rede (e a das anotações) é limpa.
      if (editor().selection.length > 0 || editor().annotationSelection) editor().select(null);
    },

    selectMany: (ids) => {
      const { architecture } = editor().project;
      const valid = [...new Set(ids)].filter((id) => getArchElement(architecture, id));
      set({ selection: valid });
      if (valid.length > 0 && (editor().selection.length > 0 || editor().annotationSelection)) {
        editor().select(null);
      }
    },

    deleteSelected: () => {
      const { selection } = get();
      if (selection.length === 0) return false;
      const { project } = editor();
      const carried = hostedCarriedBy(project.architecture, selection);
      const result = deleteArchElements(project, selection);
      if (result.removed.length === 0) return false;
      const chosen = result.removed.length - carried;
      apply(
        done(result.project),
        `${plural(chosen, 'elemento excluído', 'elementos excluídos')}` +
          (carried > 0
            ? `, com ${plural(carried, 'porta ou janela hospedada', 'portas e janelas hospedadas')} nas paredes excluídas.`
            : '.'),
      );
      set({ selection: [] });
      return true;
    },

    update: (id, patch) => apply(updateArchElement(editor().project, id, patch)),

    seat: (id, surface) => {
      const { project } = editor();
      return apply(
        seatArchElement(project, id, surface),
        `Base assentada sobre o ${seatGroundLabel(project, surface)}.`,
      );
    },

    setIfcValue: (elementId, scope, key, value) => {
      const { project } = editor();
      const result = setArchIfcValue(project, { elementId, scope }, key, value);
      if (scope !== 'type' || !result.ok) return apply(result);
      // Valor do tipo: vale para todas as ocorrências dele — o aviso diz quantas são.
      const element = getArchElement(project.architecture, elementId);
      const type =
        element && element.kind !== 'space'
          ? getArchType(project.architecture, element.typeId)
          : undefined;
      const usage = type ? archTypeUsage(project.architecture, type.id).length : 0;
      return apply(
        result,
        type
          ? `Valor do tipo "${type.name}" alterado: vale para ${plural(usage, 'ocorrência', 'ocorrências')}.`
          : undefined,
      );
    },

    removeOpening: (floorId, openingId) =>
      apply(removeFloorOpening(editor().project, floorId, openingId), 'Abertura removida.'),

    move: (delta, dz = 0) =>
      onSelection((project, ids) => moveArchElements(project, ids, delta, dz), 'Seleção movida.'),
    copy: (delta, dz = 0) => {
      const { selection } = get();
      if (selection.length === 0) return false;
      return created(
        copyArchElements(editor().project, selection, delta, dz),
        (ids) => `${plural(ids.length, 'elemento copiado', 'elementos copiados')}.`,
      );
    },
    rotate: (center, angle, copy = false) => {
      const { selection } = get();
      if (selection.length === 0) return false;
      return created(rotateArchElements(editor().project, selection, center, angle, copy), () =>
        copy ? 'Cópia girada criada.' : 'Seleção girada.',
      );
    },
    mirror: (a, b, copy = false) => {
      const { selection } = get();
      if (selection.length === 0) return false;
      return created(mirrorArchElements(editor().project, selection, a, b, copy), () =>
        copy ? 'Cópia espelhada criada.' : 'Seleção espelhada.',
      );
    },
  };
});

// A sessão acompanha a store do editor, que não conhece a arquitetura.
useEditorStore.subscribe((state, previous) => {
  const arch = useArchStore.getState();
  // Seleção exclusiva: selecionar na rede (ou uma anotação) limpa a seleção da arquitetura.
  if (
    arch.selection.length > 0 &&
    ((state.selection !== previous.selection && state.selection.length > 0) ||
      (state.annotationSelection !== null && previous.annotationSelection === null))
  ) {
    useArchStore.setState({ selection: [] });
  }
  // Uma ferramenta da rede, a consulta BIM ou a saída da planta encerram a de arquitetura.
  if (
    arch.tool &&
    ((state.tool !== previous.tool && state.tool !== 'select') ||
      (state.viewMode !== previous.viewMode && state.viewMode === 'bim'))
  ) {
    arch.setTool(null);
  }
  if (state.project === previous.project) return;
  if (state.project.id !== previous.project.id) {
    // Outro projeto: nada da sessão anterior vale.
    useArchStore.setState({
      tool: null,
      points: [],
      cursor: null,
      selection: [],
      activeTypes: {},
      openingTarget: null,
    });
    return;
  }
  // Desfazer, refazer ou excluir: a seleção só guarda o que ainda existe.
  const { architecture } = state.project;
  const current = useArchStore.getState();
  const kept = current.selection.filter((id) => getArchElement(architecture, id));
  if (kept.length !== current.selection.length) useArchStore.setState({ selection: kept });
  if (current.openingTarget && !getArchElement(architecture, current.openingTarget)) {
    current.setTool(null);
  }
});

// O desenho 2D de uma vista salva (ou a linha de corte) encerra a ferramenta de arquitetura.
useViewStore.subscribe((state, previous) => {
  if (state.tool !== previous.tool && state.tool !== 'select' && useArchStore.getState().tool) {
    useArchStore.getState().setTool(null);
  }
});
