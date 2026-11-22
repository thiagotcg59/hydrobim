import {
  addFloor,
  addFloorOpening,
  addHosted,
  addRoof,
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
  moveWallEndpoint,
  percentToSlope,
  rectangleFromThreePoints,
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
import { resolveSnap, segmentNear, type SnapResult, type SnapSegment } from '../editor/planSnaps';
import { isPolarLockHeld } from '../editor/polarLock';
import { useEditorStore } from '../state/editorStore';
import { snapPreferences } from '../state/snapStore';
import { useUiStore } from '../state/uiStore';
import { useTerrainStore } from '../terrain/terrainStore';
import { entryPoint, parseEntry } from '../views/entry';
import { useViewStore } from '../views/viewStore';
import {
  ARCH_TRANSFORM_LABELS,
  ARCH_TRANSFORM_STEPS,
  contourDirty,
  contourOf,
  contourOutcome,
  gripOutcome,
  gripSnapFrame,
  insertContourVertex,
  moveContourVertex,
  removeContourVertex,
  transformOutcome,
  type ArchContour,
  type ArchGrip,
  type ArchTransform,
  type ArchTransformKind,
} from './archEdit';
import {
  ARCH_MODIFY_HINTS,
  ARCH_MODIFY_LABELS,
  ARCH_MODIFY_STEPS,
  archModifyBlocker,
  modifyOutcome,
  modifyPickAt,
  type ArchModify,
  type ArchModifyKind,
  type ArchPick,
} from './archModify';
import {
  activeTypeIdOf,
  archSnapSegments,
  hostedCarriedBy,
  hostedPlacementAt,
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
  'roof',
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
  roof: 'Telhado',
  door: 'Porta',
  window: 'Janela',
  space: 'Ambiente',
  floorOpening: 'Abertura no piso',
};

export const ARCH_TOOL_HINTS: Record<ArchTool, string> = {
  wall: 'Parede: dois cliques na planta criam a parede e encerram o trecho — a ferramenta continua pronta para a próxima. Com "Traçado contínuo" (opções da ferramenta), cada clique emenda um novo trecho e Enter ou duplo clique conclui. As capturas ligadas na barra de referências valem (extremidade, meio, interseção, perpendicular, paralela, ortogonal, alinhamento); Tab alterna entre capturas sobrepostas e R fixa a aresta de referência. Digite o comprimento do trecho (ou comprimento<ângulo, @ΔX;ΔY, X;Y). Shift trava o trecho de 45° em 45°. Backspace desfaz o último ponto; Esc cancela.',
  roof: 'Telhado: três cliques na planta — os dois primeiros dão o lado do beiral (a água cai para ele; em duas águas, a cumeeira é paralela a ele) e o terceiro, a largura do retângulo, medida na perpendicular. Digite o comprimento ou a largura. Inclinação, beiral e lado do beiral são ajustados nas propriedades. Esc cancela.',
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
  roof: 'roof',
  door: 'door',
  window: 'window',
};

/** Ferramentas que desenham por pontos (as demais inserem com um clique na parede). */
export const isDrawingTool = (tool: ArchTool | null): boolean =>
  tool !== null && tool !== 'door' && tool !== 'window';

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
  /**
   * Paredes em traçado contínuo: cada clique emenda um trecho e o traçado só é gravado ao
   * concluir (Enter ou duplo clique). Desligado, o segundo clique cria a parede e encerra.
   */
  chain: boolean;
  /** Traçado contínuo fechado: o último ponto é ligado ao primeiro ao concluir. */
  closed: boolean;
  /** Laje: cota do topo; piso: cota da base — em relação ao nível (m). */
  floorOffset: number;
  /** Peitoril das próximas janelas; `null` = o do tipo. */
  sillHeight: number | null;
  hand: 'left' | 'right';
  facing: 1 | -1;
  /** Pé-direito dos próximos ambientes; `null` = não informado. */
  spaceHeight: number | null;
  /** Telhados: inclinação (rad), beiral (m) e cota de referência em relação ao nível (m). */
  roofSlope: number;
  roofOverhang: number;
  roofOffset: number;
}

const DEFAULT_OPTIONS: ArchOptions = {
  seat: 'level',
  wallHeight: 2.8,
  wallBaseOffset: 0,
  locationLine: 'center',
  chain: false,
  closed: false,
  floorOffset: 0,
  sillHeight: null,
  hand: 'left',
  facing: 1,
  spaceHeight: null,
  // Valores iniciais de edição (como a altura das paredes): não vêm de catálogo nem de norma.
  roofSlope: percentToSlope(30),
  roofOverhang: 0.5,
  roofOffset: 2.8,
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

  /** Captura resolvida sob o cursor (o que a planta desenha: guias, realce, rótulo). */
  snap: SnapResult | null;
  /** Escolha entre capturas sobrepostas (Tab) e o ponto do cursor em que foi feita. */
  snapCycle: number;
  snapCycleAt: Point2 | null;
  /** Aresta de referência das direções paralela e perpendicular; `pinned` = fixada com R. */
  reference: { segment: SnapSegment; pinned: boolean } | null;
  /** Mover, copiar, girar ou espelhar a seleção por pontos, em andamento. */
  transform: ArchTransform | null;
  /** Alça sendo arrastada e o ponto para onde foi levada. */
  grip: { grip: ArchGrip; point: Point2 | null } | null;
  /** Contorno em edição ("Editar contorno") e o vértice sendo arrastado. */
  contour: ArchContour | null;
  contourDrag: number | null;
  /**
   * Aparar/estender, alinhar ou dividir em andamento: atuam sobre o que é indicado na planta
   * (não sobre a seleção). `modifyHover` é o que o cursor indica agora.
   */
  modify: ArchModify | null;
  modifyHover: ArchPick | null;
  /** Alinhar: escolha entre arestas sobrepostas (Tab) e o ponto do cursor em que foi feita. */
  modifyCycle: number;
  modifyCycleAt: Point2 | null;

  /** Tab no alinhar: próxima (ou anterior) aresta sob o cursor. */
  cycleModify: (step: 1 | -1) => void;
  /** Aciona aparar/estender para canto, aparar/estender até parede, alinhar ou dividir. */
  startModify: (kind: ArchModifyKind) => void;
  /** Encerra a ferramenta de modificação; o modelo fica como está. */
  endModify: () => void;
  /**
   * Cursor das ferramentas de modificação: resolve o que está indicado (parede ou aresta) e
   * devolve o ponto que o clique confirma. Só o dividir usa as capturas — nas demais conta o
   * ponto do cursor, que diz qual lado da parede fica.
   */
  pointModify: (raw: Point2, tolerance: number) => Point2;

  /**
   * Resolve a captura do ponto `raw` do cursor (`tolerance` = raio de captura em metros) com
   * o que estiver em andamento — a mesma função atende a prévia e o clique.
   */
  resolvePointer: (raw: Point2, tolerance: number) => SnapResult;
  clearPointer: () => void;
  /** Refaz a captura no mesmo ponto do cursor (tecla pressionada com o cursor parado). */
  refreshPointer: () => SnapResult | null;
  /** Tab: próxima (ou anterior) captura sob o cursor. */
  cycleSnap: (step: 1 | -1) => void;
  /** R: fixa como referência a aresta sob o cursor; fora de arestas, solta a referência. */
  pinReference: () => void;
  startTransform: (kind: ArchTransformKind, copy?: boolean) => void;
  setTransformCopy: (copy: boolean) => void;
  /** Girar: aplica o ângulo digitado (graus, anti-horário) em torno do centro já indicado. */
  submitAngle: (degrees: number) => boolean;
  beginGrip: (grip: ArchGrip) => void;
  /** Leva a alça (ou o vértice do contorno em edição) ao ponto. */
  dragTo: (point: Point2) => void;
  /** Encerra o arrasto; `apply` falso descarta. */
  endDrag: (apply: boolean) => void;
  /** Leva uma extremidade da parede ao ponto, preservando as portas e janelas no lugar. */
  moveWallEnd: (id: string, end: 'start' | 'end', point: Point2) => boolean;
  /** "Editar contorno" do elemento selecionado (ou do indicado). */
  beginContour: (id?: string) => boolean;
  beginContourDrag: (index: number) => void;
  insertContourVertex: (edge: number) => void;
  removeContourVertex: (index?: number) => void;
  /** Concluir: grava o contorno em um passo do histórico (recusa o inválido, sem gravar). */
  finishContour: () => boolean;
  cancelContour: () => void;

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
  /**
   * Entrada numérica exata do próximo ponto: um valor (comprimento na direção do cursor, já
   * com a captura de direção), `comprimento<ângulo`, `@ΔX;ΔY` ou `X;Y`. No girar, o valor é o
   * ângulo em graus. O número digitado nunca é arredondado pela grade nem pelas capturas.
   */
  submitEntry: (text: string) => boolean;
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
/** Comprimento pedido por uma entrada de valor único ou polar. */
const lengthOf = (entry: { kind: string; value?: number; distance?: number }): number =>
  entry.kind === 'polar' ? (entry.distance ?? 0) : (entry.value ?? 0);
const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/** Há uma operação da arquitetura recebendo os cliques da planta? */
export const archBusy = (
  state: Pick<ArchState, 'tool' | 'transform' | 'contour' | 'modify'>,
): boolean =>
  state.tool !== null ||
  state.transform !== null ||
  state.contour !== null ||
  state.modify !== null;

const NO_TYPE: Record<ArchCategory, string> = {
  wall: 'Nenhum tipo de parede no projeto: abra o Catálogo de arquitetura e adicione um.',
  slab: 'Nenhum tipo de laje no projeto: abra o Catálogo de arquitetura e adicione um.',
  flooring:
    'Nenhum tipo de revestimento de piso no projeto: abra o Catálogo de arquitetura e adicione um.',
  roof: 'Nenhum tipo de telhado no projeto: abra o Catálogo de arquitetura e adicione um.',
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

  /** As operações da arquitetura atuam na planta de trabalho, com Selecionar na rede. */
  const enterPlan = (): void => {
    const views = useViewStore.getState();
    if (views.open2d) views.closeView('2d');
    if (views.tool !== 'select') views.setTool('select');
    if (useTerrainStore.getState().mode) useTerrainStore.getState().setMode(null);
    if (editor().tool !== 'select') editor().setTool('select');
    if (editor().viewMode !== 'plan') editor().setViewMode('plan');
  };

  /** Último ponto bruto do cursor e o raio de captura (Tab, R e Shift não trazem a posição). */
  let lastRaw: Point2 | null = null;
  let lastTolerance = 0;
  /** Último ponto do cursor nas ferramentas de modificação (Tab não traz a posição). */
  let lastModifyRaw: Point2 | null = null;
  let lastModifyTolerance = 0;
  /** Contorno como estava ao começar o arrasto de um vértice (Esc o devolve). */
  let ringBeforeDrag: ArchContour | null = null;

  /**
   * De onde sai o trecho em andamento, para as capturas de direção: último ponto, ponto
   * anterior, vértices já indicados e o elemento que não deve capturar a si mesmo.
   */
  const snapScene = (): {
    anchor: Point2 | null;
    previous: Point2 | null;
    points: Point2[];
    exclude: string[];
  } => {
    const { tool, points, transform, grip, contour, contourDrag } = get();
    const none = { anchor: null, previous: null, points: [], exclude: [] };
    if (grip) {
      const frame = gripSnapFrame(editor().project, grip.grip);
      return {
        anchor: frame?.anchor ?? null,
        previous: frame?.previous ?? null,
        points: [],
        exclude: [grip.grip.elementId],
      };
    }
    if (contour && contourDrag !== null) {
      const n = contour.ring.length;
      // Retangular: o canto oposto é o que fica. Livre: o lado que chega do vértice anterior.
      const anchor = contour.rectangular
        ? contour.ring[(contourDrag + 2) % n]
        : contour.ring[(contourDrag - 1 + n) % n];
      const previous = contour.rectangular ? null : contour.ring[(contourDrag - 2 + n) % n];
      return {
        anchor: anchor ?? null,
        previous: previous ?? null,
        points: contour.ring.filter((_, index) => index !== contourDrag),
        exclude: [contour.elementId],
      };
    }
    if (transform) {
      // Girar: os raios saem do centro. Demais: do último ponto indicado.
      const from =
        transform.kind === 'rotate'
          ? transform.points[0]
          : transform.points[transform.points.length - 1];
      return { ...none, anchor: from ?? null };
    }
    if (isDrawingTool(tool)) {
      return {
        anchor: points[points.length - 1] ?? null,
        previous: points[points.length - 2] ?? null,
        points: points.slice(0, -1),
        exclude: [],
      };
    }
    return none;
  };

  /** Arestas capturáveis agora: as do nível do plano de trabalho, salvo com o filtro desligado. */
  const snapSegments = (exclude: readonly string[]): SnapSegment[] => {
    const state = editor();
    const levelId = snapPreferences().activeLevelOnly
      ? workLevelIdOf(state.project, state.workPlaneZ)
      : null;
    return archSnapSegments(state.project.architecture, { levelId, exclude });
  };

  /** Nível em que as ferramentas de modificação procuram paredes e arestas. */
  const pickLevelId = (): string | null => {
    const state = editor();
    return snapPreferences().activeLevelOnly
      ? workLevelIdOf(state.project, state.workPlaneZ)
      : null;
  };

  const endTransform = (): void => {
    set({ transform: null, snap: null, cursor: null });
    if (editor().tool === 'select') useUiStore.getState().setPanelTab('properties');
  };

  /** Aplica o resultado de mover, copiar, girar ou espelhar: um passo no histórico. */
  const applyTransform = (
    outcome: ReturnType<typeof transformOutcome>,
    transform: ArchTransform,
  ): boolean => {
    if (!outcome) return false;
    if (!outcome.ok) {
      editor().notify('error', outcome.error.message);
      return false;
    }
    const count = outcome.value.elementIds.length;
    const copied = transform.kind === 'copy' || transform.copy;
    const message =
      transform.kind === 'move'
        ? 'Seleção movida.'
        : transform.kind === 'copy'
          ? `${plural(count, 'elemento copiado', 'elementos copiados')}.`
          : transform.kind === 'rotate'
            ? copied
              ? 'Cópia girada criada.'
              : 'Seleção girada.'
            : copied
              ? 'Cópia espelhada criada.'
              : 'Seleção espelhada.';
    apply(done(outcome.value.project), message);
    endTransform();
    // As cópias ficam selecionadas; mover, girar e espelhar mantêm a seleção.
    if (copied) get().selectMany(outcome.value.elementIds);
    return true;
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
    snap: null,
    snapCycle: 0,
    snapCycleAt: null,
    reference: null,
    transform: null,
    grip: null,
    contour: null,
    contourDrag: null,
    modify: null,
    modifyHover: null,
    modifyCycle: 0,
    modifyCycleAt: null,

    cycleModify: (step) => {
      if (!get().modify || !lastModifyRaw) return;
      set((state) => ({ modifyCycle: state.modifyCycle + step, modifyCycleAt: lastModifyRaw }));
      get().pointModify(lastModifyRaw, lastModifyTolerance);
    },

    startModify: (kind) => {
      const blocker = archModifyBlocker(editor().project, kind);
      if (blocker) {
        editor().notify('info', `${ARCH_MODIFY_LABELS[kind]}: ${blocker}`);
        return;
      }
      enterPlan();
      set({
        tool: null,
        points: [],
        cursor: null,
        openingTarget: null,
        transform: null,
        contour: null,
        contourDrag: null,
        grip: null,
        snap: null,
        // A ferramenta atua sobre o que é indicado: a seleção (e as alças dela) sai de cena.
        selection: [],
        modify: { kind, picks: [] },
        modifyHover: null,
        modifyCycle: 0,
        modifyCycleAt: null,
      });
      useUiStore.getState().setPanelTab('tool');
      editor().notify('info', ARCH_MODIFY_HINTS[kind]);
    },

    endModify: () => {
      if (!get().modify) return;
      set({ modify: null, modifyHover: null, snap: null, cursor: null });
      if (editor().tool === 'select') useUiStore.getState().setPanelTab('properties');
    },

    pointModify: (raw, tolerance) => {
      const { modify } = get();
      if (!modify) return raw;
      lastModifyRaw = raw;
      lastModifyTolerance = tolerance;
      // A escolha por Tab vale enquanto o cursor fica onde ela foi feita.
      let { modifyCycle, modifyCycleAt } = get();
      if (
        modifyCycle !== 0 &&
        (!modifyCycleAt || Math.hypot(raw.x - modifyCycleAt.x, raw.y - modifyCycleAt.y) > tolerance)
      ) {
        modifyCycle = 0;
        modifyCycleAt = null;
      }
      // Dividir: o ponto exato vem das capturas (meio, interseção, extremidade de outra parede).
      const point = modify.kind === 'split' ? get().resolvePointer(raw, tolerance).point : raw;
      const modifyHover = modifyPickAt(
        editor().project,
        modify,
        point,
        tolerance,
        pickLevelId(),
        modifyCycle,
      );
      if (modify.kind === 'split') set({ modifyHover, modifyCycle, modifyCycleAt });
      else set({ modifyHover, modifyCycle, modifyCycleAt, cursor: point, snap: null });
      return point;
    },

    resolvePointer: (raw, tolerance) => {
      lastRaw = raw;
      lastTolerance = tolerance;
      const state = editor();
      const preferences = snapPreferences();
      const scene = snapScene();
      const segments = snapSegments(scene.exclude);
      let { reference, snapCycle, snapCycleAt } = get();
      // A escolha por Tab vale enquanto o cursor fica onde ela foi feita.
      if (
        snapCycle !== 0 &&
        (!snapCycleAt || Math.hypot(raw.x - snapCycleAt.x, raw.y - snapCycleAt.y) > tolerance)
      ) {
        snapCycle = 0;
        snapCycleAt = null;
      }
      const referenceId = reference?.segment.sourceId;
      if (referenceId && !segments.some((segment) => segment.sourceId === referenceId)) {
        reference = null;
      }
      // Sem referência fixada, a última aresta apontada é a referência.
      if (!reference?.pinned && preferences.snaps.direction) {
        const hovered = segmentNear(raw, segments, tolerance);
        if (hovered) reference = { segment: hovered, pinned: false };
      }
      const snap = resolveSnap({
        raw,
        tolerance,
        segments,
        points: scene.points,
        anchor: scene.anchor,
        previous: scene.previous,
        reference: reference?.segment ?? null,
        settings: preferences.snaps,
        gridStep: state.snapToGrid ? state.gridStep : 0,
        polar: isPolarLockHeld(),
        cycle: snapCycle,
      });
      set({ snap, cursor: snap.point, reference, snapCycle, snapCycleAt });
      return snap;
    },

    clearPointer: () => {
      lastRaw = null;
      set({ snap: null, cursor: null, modifyHover: null });
    },

    refreshPointer: () => (lastRaw ? get().resolvePointer(lastRaw, lastTolerance) : null),

    cycleSnap: (step) => {
      set((state) => ({ snapCycle: state.snapCycle + step, snapCycleAt: lastRaw }));
      get().refreshPointer();
    },

    pinReference: () => {
      const hovered = lastRaw
        ? segmentNear(lastRaw, snapSegments(snapScene().exclude), lastTolerance)
        : null;
      set({ reference: hovered ? { segment: hovered, pinned: true } : null });
      editor().notify(
        'info',
        hovered
          ? `Aresta de referência fixada: ${hovered.sourceName}. As direções paralela e perpendicular seguem essa aresta; R fora de uma aresta solta.`
          : 'Aresta de referência solta: volta a valer a última aresta apontada.',
      );
      get().refreshPointer();
    },

    startTransform: (kind, copy = false) => {
      if (get().selection.length === 0) {
        editor().notify(
          'info',
          `${ARCH_TRANSFORM_LABELS[kind]}: selecione um ou mais elementos de arquitetura.`,
        );
        return;
      }
      enterPlan();
      set({
        tool: null,
        points: [],
        cursor: null,
        openingTarget: null,
        contour: null,
        contourDrag: null,
        grip: null,
        snap: null,
        modify: null,
        modifyHover: null,
        transform: { kind, points: [], copy },
      });
      useUiStore.getState().setPanelTab('tool');
      editor().notify(
        'info',
        `${ARCH_TRANSFORM_LABELS[kind]}: ${ARCH_TRANSFORM_STEPS[kind].join('; ')}. As capturas valem; Esc volta um ponto e, sem pontos, encerra.`,
      );
    },

    setTransformCopy: (copy) =>
      set((state) => (state.transform ? { transform: { ...state.transform, copy } } : {})),

    submitAngle: (degrees) => {
      const { transform, selection } = get();
      if (transform?.kind !== 'rotate' || transform.points.length === 0) {
        editor().notify('info', 'Girar: indique o centro do giro antes de digitar o ângulo.');
        return false;
      }
      if (!Number.isFinite(degrees)) return false;
      return applyTransform(
        transformOutcome(editor().project, selection, transform, null, (degrees * Math.PI) / 180),
        transform,
      );
    },

    beginGrip: (grip) => set({ grip: { grip, point: null }, snapCycle: 0 }),

    dragTo: (point) => {
      const { grip, contour, contourDrag } = get();
      if (grip) set({ grip: { ...grip, point } });
      else if (contour && contourDrag !== null) {
        set({ contour: moveContourVertex(contour, contourDrag, point) });
      }
    },

    endDrag: (apply) => {
      const { grip, contourDrag } = get();
      if (grip) {
        set({ grip: null, snap: null, cursor: null });
        if (!apply || !grip.point) return;
        const { project } = editor();
        const outcome = gripOutcome(project, grip.grip, grip.point);
        if (!outcome.ok) editor().notify('error', outcome.error.message);
        else {
          const element = getArchElement(project.architecture, grip.grip.elementId);
          editor().applyOperation(
            outcome,
            grip.grip.kind === 'wallEnd'
              ? `Extremidade de "${element?.name ?? ''}" movida; portas e janelas hospedadas ficaram no lugar.`
              : `Contorno de "${element?.name ?? ''}" atualizado.`,
          );
        }
        return;
      }
      if (contourDrag !== null) {
        set({
          contourDrag: null,
          snap: null,
          cursor: null,
          ...(apply || !ringBeforeDrag ? {} : { contour: ringBeforeDrag }),
        });
        ringBeforeDrag = null;
      }
    },

    moveWallEnd: (id, end, point) => apply(moveWallEndpoint(editor().project, id, end, point)),

    beginContour: (id) => {
      const { selection } = get();
      const targetId = id ?? (selection.length === 1 ? selection[0] : undefined);
      const { project } = editor();
      const element = targetId ? getArchElement(project.architecture, targetId) : undefined;
      const contour = contourOf(element);
      if (!element || !contour) {
        editor().notify(
          'info',
          'Editar contorno: selecione uma laje, um piso, um ambiente ou um telhado (um só).',
        );
        return false;
      }
      enterPlan();
      set({
        tool: null,
        points: [],
        cursor: null,
        openingTarget: null,
        transform: null,
        grip: null,
        snap: null,
        modify: null,
        modifyHover: null,
        contour,
        contourDrag: null,
        selection: [element.id],
      });
      useUiStore.getState().setPanelTab('tool');
      editor().notify(
        'info',
        contour.rectangular
          ? `Editar contorno de "${element.name}": arraste os cantos (o contorno continua retangular). Concluir grava; Cancelar ou Esc descarta.`
          : `Editar contorno de "${element.name}": arraste os vértices, clique o ponto no meio de um lado para criar um vértice e Del para remover o selecionado. Concluir grava; Cancelar ou Esc descarta.`,
      );
      return true;
    },

    beginContourDrag: (index) => {
      const { contour } = get();
      if (!contour || !contour.ring[index]) return;
      ringBeforeDrag = contour;
      set({ contourDrag: index, contour: { ...contour, active: index }, snapCycle: 0 });
    },

    insertContourVertex: (edge) =>
      set((state) => (state.contour ? { contour: insertContourVertex(state.contour, edge) } : {})),

    removeContourVertex: (index) => {
      const { contour } = get();
      const target = index ?? contour?.active ?? null;
      if (!contour || target === null) return;
      const next = removeContourVertex(contour, target);
      if (next === contour) {
        editor().notify(
          'info',
          contour.rectangular
            ? 'O contorno do telhado é retangular: não perde cantos.'
            : 'O contorno precisa de ao menos três vértices.',
        );
        return;
      }
      set({ contour: next });
    },

    finishContour: () => {
      const { contour } = get();
      if (!contour) return false;
      const { project } = editor();
      const element = getArchElement(project.architecture, contour.elementId);
      if (!contourDirty(project, contour)) {
        set({ contour: null, contourDrag: null, snap: null });
        useUiStore.getState().setPanelTab('properties');
        editor().notify('info', 'Contorno sem alterações.');
        return true;
      }
      const outcome = contourOutcome(project, contour);
      if (!outcome.ok) {
        // O contorno inválido não é gravado: a edição continua, com o motivo à vista.
        editor().notify('error', outcome.error.message);
        return false;
      }
      apply(outcome, `Contorno de "${element?.name ?? ''}" atualizado.`);
      set({ contour: null, contourDrag: null, snap: null });
      useUiStore.getState().setPanelTab('properties');
      return true;
    },

    cancelContour: () => {
      if (!get().contour) return;
      ringBeforeDrag = null;
      set({ contour: null, contourDrag: null, snap: null, cursor: null });
      useUiStore.getState().setPanelTab('properties');
      editor().notify('info', 'Edição do contorno cancelada: nada foi alterado.');
    },

    catalogCategory: null,
    openCatalog: (category = null) => {
      set({ catalogCategory: category });
      useUiStore.getState().openDialog('archCatalog');
    },
    setTool: (tool) => {
      if (tool === null) {
        if (get().tool === null) return;
        set({ tool: null, points: [], cursor: null, openingTarget: null, snap: null });
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
      enterPlan();
      set({
        tool,
        points: [],
        cursor: null,
        openingTarget,
        snap: null,
        transform: null,
        contour: null,
        contourDrag: null,
        grip: null,
        modify: null,
        modifyHover: null,
      });
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
      const { tool, points, transform, selection, modify } = get();
      if (modify) {
        const pick = modifyPickAt(
          editor().project,
          modify,
          point,
          tolerance,
          pickLevelId(),
          get().modifyCycle,
        );
        set({ modifyCycle: 0, modifyCycleAt: null });
        if (!pick) {
          const step = ARCH_MODIFY_STEPS[modify.kind][modify.picks.length] ?? '';
          editor().notify('info', `${ARCH_MODIFY_LABELS[modify.kind]}: ${step}.`);
          return;
        }
        // Enquanto faltam cliques, este é mais um; o último confirma, em um passo do histórico.
        const outcome = modifyOutcome(editor().project, modify, pick);
        if (outcome === null) {
          set({ modify: { ...modify, picks: [...modify.picks, pick] }, modifyHover: null });
        } else if (!outcome.ok) {
          editor().notify('error', outcome.error.message);
        } else {
          apply(done(outcome.value.project), outcome.value.message);
          // A ferramenta continua ativa para a próxima operação.
          set({ modify: { ...modify, picks: [] }, modifyHover: null, snap: null });
        }
        return;
      }
      if (transform) {
        // Enquanto faltam pontos, o clique é mais um ponto de referência; o último confirma.
        const outcome = transformOutcome(editor().project, selection, transform, point);
        if (outcome === null) {
          set({ transform: { ...transform, points: [...transform.points, point] }, snapCycle: 0 });
        } else applyTransform(outcome, transform);
        return;
      }
      if (!tool) return;
      if (tool === 'door' || tool === 'window') {
        placeHosted(tool, point, tolerance);
        return;
      }
      const last = points[points.length - 1];
      // O segundo clique de um duplo clique cai no mesmo lugar (a captura pode devolver um ponto
      // a poucos pixels do primeiro): não vira vértice.
      if (last && Math.hypot(last.x - point.x, last.y - point.y) <= Math.max(tolerance, 1e-6)) {
        return;
      }
      if (tool === 'wall' && !get().options.chain) {
        // Parede por dois pontos: o segundo clique cria a parede e encerra o trecho. Recusada
        // (curta demais, por exemplo), o primeiro ponto continua indicado.
        set({ points: [...points, point], snapCycle: 0 });
        if (points.length >= 1 && !get().finish(false)) set({ points: points.slice(0, 1) });
        return;
      }
      if (tool === 'roof') {
        // Três pontos: lado do beiral (dois) e largura; o terceiro cria o telhado.
        set({ points: [...points, point], snapCycle: 0 });
        if (points.length >= 2) get().finish();
        return;
      }
      const first = points[0];
      if (first && points.length >= 3 && same(first, point)) {
        get().finish(true);
        return;
      }
      set({ points: [...points, point], snapCycle: 0 });
    },

    finish: (closed) => {
      const { tool, points, options, openingTarget } = get();
      if (!tool || tool === 'door' || tool === 'window') return false;
      if (tool === 'wall') {
        if (points.length < 2) {
          // Sem traçado contínuo não há o que concluir: o duplo clique no fim de uma parede só
          // descarta o início que ele deixaria indicado.
          if (options.chain) editor().notify('info', 'Parede: indique ao menos dois pontos.');
          else set({ points: [] });
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
      if (tool === 'roof') {
        const [a, b, c] = points;
        if (!a || !b || !c) {
          editor().notify(
            'info',
            'Telhado: indique o lado do beiral (dois pontos) e a largura (terceiro ponto).',
          );
          return false;
        }
        const boundary = rectangleFromThreePoints(a, b, c);
        const ready = boundary ? context('roof') : null;
        if (!boundary) {
          editor().notify(
            'error',
            'Telhado: o terceiro ponto precisa ficar fora da reta do lado do beiral, para dar a largura.',
          );
        }
        const made =
          boundary && ready
            ? created(
                addRoof(ready.project, {
                  typeId: ready.typeId,
                  levelId: ready.levelId,
                  boundary,
                  eaveEdge: 0,
                  offset: options.roofOffset,
                  slope: options.roofSlope,
                  overhang: options.roofOverhang,
                }),
                () =>
                  'Telhado criado. Inclinação, beiral e lado do beiral são ajustados no painel de propriedades.',
              )
            : false;
        // Recusado: o lado do beiral continua indicado, para escolher outra largura.
        set({ points: made ? [] : points.slice(0, 2) });
        return made;
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

    submitEntry: (text) => {
      const { tool, points, cursor, transform } = get();
      if (!transform && !isDrawingTool(tool)) return false;
      const entry = parseEntry(text);
      if (!entry) {
        editor().notify(
          'error',
          'Entrada inválida: digite um comprimento em metros, comprimento<ângulo, @ΔX;ΔY ou X;Y.',
        );
        return false;
      }
      if (transform?.kind === 'rotate' && transform.points.length > 0 && entry.kind === 'value') {
        return get().submitAngle(entry.value);
      }
      if ((entry.kind === 'value' || entry.kind === 'polar') && !(lengthOf(entry) > 0)) {
        editor().notify('error', 'Comprimento inválido: digite um valor positivo, em metros.');
        return false;
      }
      const indicated = transform ? transform.points : points;
      const last = indicated[indicated.length - 1] ?? null;
      let next: Point2 | null;
      const [a, b] = points;
      if (tool === 'roof' && a && b && entry.kind === 'value') {
        // Largura do telhado: na perpendicular ao lado do beiral, para o lado do cursor.
        const size = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const normal = { x: -(b.y - a.y) / size, y: (b.x - a.x) / size };
        const side =
          cursor && (cursor.x - b.x) * normal.x + (cursor.y - b.y) * normal.y < 0 ? -1 : 1;
        next = { x: b.x + normal.x * side * entry.value, y: b.y + normal.y * side * entry.value };
      } else {
        // Um valor só segue a direção do cursor JÁ capturada (perpendicular, paralela…): o
        // comprimento é exatamente o digitado.
        next = entryPoint(entry, last, cursor);
      }
      if (!next) {
        editor().notify(
          'info',
          'Indique o primeiro ponto e aponte a direção com o cursor antes de digitar o comprimento.',
        );
        return false;
      }
      // O valor digitado é exato: não passa pelo filtro de pontos repetidos do clique.
      get().clickPoint(next, 0);
      return true;
    },

    cancel: () => {
      const { tool, points, selection, transform, contour, grip, contourDrag, modify } = get();
      if (grip || contourDrag !== null) {
        get().endDrag(false);
        return true;
      }
      if (modify) {
        // Cada Esc desfaz o último clique; sem cliques, encerra — o modelo não foi tocado.
        if (modify.picks.length > 0) {
          set({ modify: { ...modify, picks: modify.picks.slice(0, -1) }, modifyHover: null });
        } else get().endModify();
        return true;
      }
      if (contour) {
        get().cancelContour();
        return true;
      }
      if (transform) {
        // Cada Esc desfaz o último ponto; sem pontos, encerra — o modelo não foi tocado.
        if (transform.points.length > 0) {
          set({ transform: { ...transform, points: transform.points.slice(0, -1) } });
        } else endTransform();
        return true;
      }
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
    (state.tool !== previous.tool && state.tool !== 'select') ||
    (state.viewMode !== previous.viewMode && state.viewMode === 'bim')
  ) {
    if (arch.tool) arch.setTool(null);
    // Mover/girar por pontos e a edição de contorno também: nada foi gravado.
    if (arch.transform || arch.contour || arch.grip || arch.modify) {
      useArchStore.setState({
        transform: null,
        contour: null,
        contourDrag: null,
        grip: null,
        modify: null,
        modifyHover: null,
      });
    }
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
      snap: null,
      reference: null,
      transform: null,
      grip: null,
      contour: null,
      contourDrag: null,
      modify: null,
      modifyHover: null,
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
  // Desfazer ou refazer no meio de uma operação: ela só continua se o alvo ainda existe.
  if (current.contour && !getArchElement(architecture, current.contour.elementId)) {
    useArchStore.setState({ contour: null, contourDrag: null });
  }
  if (current.grip && !getArchElement(architecture, current.grip.grip.elementId)) {
    useArchStore.setState({ grip: null });
  }
  if (current.transform && kept.length === 0) useArchStore.setState({ transform: null });
  // Os cliques já feitos de uma ferramenta de modificação só valem se os elementos existem.
  if (current.modify?.picks.some((pick) => !getArchElement(architecture, pick.elementId))) {
    useArchStore.setState({ modify: { ...current.modify, picks: [] }, modifyHover: null });
  }
});

// O desenho 2D de uma vista salva (ou a linha de corte) encerra a ferramenta de arquitetura.
useViewStore.subscribe((state, previous) => {
  if (state.tool !== previous.tool && state.tool !== 'select') {
    const arch = useArchStore.getState();
    if (arch.tool) arch.setTool(null);
    if (arch.transform || arch.contour || arch.modify) {
      useArchStore.setState({
        transform: null,
        contour: null,
        contourDrag: null,
        modify: null,
        modifyHover: null,
      });
    }
  }
});
