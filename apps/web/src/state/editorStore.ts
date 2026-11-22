import {
  BUILTIN_FAMILIES,
  defaultPipeSpec,
  FLANGED_PIPE_FAMILIES,
  getSpecification,
  flangedPipeFamiliesFor,
  flangeForClass,
  PUMP_FAMILIES,
  resolvePumpMouth,
  resolvePumpPlacement,
  TANK_FAMILIES,
  pipeFlangeEnd,
  resolveNearestPipeSpec,
  resolvePipeEnds,
  resolvePipeSpec,
  type PipeEndConfiguration,
} from '@hydrobim/catalog';
import {
  add,
  addAnnotation,
  addLevel,
  ANGLE_TOLERANCE,
  angleBetween,
  deflectionAllowance,
  describeAllowance,
  addSystem,
  addTankNozzle,
  applyFamilyToInstances,
  applyTankFamilyToInstances,
  duplicateTankFamily,
  removeTankFamily,
  tankFamiliesOf as mergeTankFamilies,
  upsertTankFamily,
  applySpec,
  attachFitting,
  availableElbowAngles,
  catalogViolation,
  closePorts,
  connectedComponent,
  convertCrossToTee,
  convertTeeToCross,
  copyElements,
  drawPipeFromJunction,
  drawPipeToJunction,
  planConnection,
  type ConnectionCandidate,
  type ConnectionPlan,
  type JunctionChange,
  type JunctionChoice,
  createFamilyCatalog,
  createProject,
  degToRad,
  deleteAnnotations,
  deleteElements,
  disconnect,
  distance,
  drawPipe,
  drawPipeFromPipe,
  drawPipeToPipe,
  elementKindLabel,
  formatAngleList,
  formatDegrees,
  formatMeters,
  getElement,
  getFreePorts,
  insertInline,
  isPortFree,
  jointDeflectionLimit,
  pipeRunOf,
  matchElbowAngle,
  mergeFamilies,
  MIN_PIPE_LENGTH,
  pipeBranchPoint,
  placeEquipment,
  removeTankNozzle,
  setPumpFlange,
  applyPumpFamilyToInstances,
  duplicatePumpFamily,
  pumpFamiliesOf as mergePumpFamilies,
  removePumpFamily,
  upsertPumpFamily,
  setTankModel,
  tankLayout,
  tankParametersFromFamily,
  updateTankNozzle,
  updateTankSettings,
  POSITION_TOLERANCE,
  projectOntoPipeNormal,
  removeFamily,
  removeLevel,
  removeSystem,
  renameElement,
  resizeWithReducers,
  requiredEndType,
  resolvePort,
  rollFitting,
  rotateElements,
  getPorts,
  copyRotatedElements,
  scale,
  setElementElevation,
  setElementProperty,
  setDrawingScale,
  setElbowCatalogAngle,
  setElementsSystem,
  setGeoreference,
  setInfraSettings,
  setPipeEndpoint,
  setPipeEnds,
  setPipeLength,
  setTerrain,
  GROUND_SURFACE_LABELS,
  groundSurfaceOf,
  hasDesignTerrain,
  inlineClearancesOf,
  setInlineClearance,
  slideAxesOf,
  slideElements,
  stretchPipe,
  sub,
  terrainElevationAt,
  translateElements,
  updateAnnotation,
  updateFitting,
  updateLevel,
  updateProjectInfo,
  updateSystem,
  upsertFamily,
  vec3,
  type AnnotationInput,
  type AnnotationPatch,
  type DimensionMode,
  type Discipline,
  type EndTreatment,
  type FamilyKind,
  type FittingCatalog,
  type FittingFamily,
  type FittingInput,
  type FittingKind,
  type FittingPatch,
  type Georeference,
  type GroundSurface,
  type HydraulicSystem,
  type InfraSettingsPatch,
  type Pipe,
  type PipeSpec,
  type Point2,
  type Port,
  type PortRef,
  type Project,
  type PropertyValue,
  type Result,
  type SystemKind,
  type PumpCustomInput,
  type PumpFamily,
  type TankCustomDimensions,
  type TankFamily,
  type TankNozzleInput,
  type TankNozzleRole,
  type TankSelection,
  type TankSettingsPatch,
  type Terrain,
  type ValveType,
  type Vec3,
} from '@hydrobim/core';
import {
  setIfcValue as applyIfcValue,
  type IfcModelOptions,
  type IfcScope,
  type IfcValue,
} from '@hydrobim/ifc';
import { create } from 'zustand';
import { chooseSlideDirection, snapStretchLength, stretchLengthAt } from '../editor/directEdit';
import { inlineSlideTarget } from '../editor/inlineSlide';
import { distanceAlongPipe, type SnapKind } from '../editor/picking';
import { nextRenderOrigin, NO_RENDER_ORIGIN } from '../editor/renderOrigin';
import { loadCustomSource, storeCustomSource, type CustomBasemapSource } from '../map/customSource';
import {
  clearViewFocus,
  ISO_LABELS,
  nextIsoQuadrant,
  type ViewPreset,
} from '../editor/viewPresets';
import { precision } from './precisionStore';
import { alignAngleOf, alignStepOf, alignTargetOf, planAlign, type AlignState } from './alignTool';

export type { ViewPreset };

/** Ferramentas de documentação, disponíveis na planta baixa. */
export const ANNOTATION_TOOLS = ['dimension', 'text', 'leader', 'tag'] as const;
export type AnnotationToolId = (typeof ANNOTATION_TOOLS)[number];
export type ModelToolId =
  | 'select'
  | 'pipe'
  | 'elbow'
  | 'tee'
  | 'reducer'
  | 'valve'
  | 'pump'
  | 'tank'
  | 'measure'
  | 'connect'
  | 'move'
  | 'rotate'
  | 'align';
export type ToolId = ModelToolId | AnnotationToolId;

/**
 * Mover interativo: os elementos a deslocar, o ponto-base já indicado (`null` = falta
 * indicá-lo) e se a rede ligada a eles vai junto (deslocamento rígido do conjunto).
 */
export interface MoveState {
  readonly ids: readonly string[];
  readonly from: Vec3 | null;
  readonly withConnected: boolean;
}

/**
 * Girar interativo em planta (eixo vertical), no fluxo do Revit: o centro começa no meio da
 * seleção (`null` = o usuário escolhe outro), o primeiro clique indica o raio inicial
 * (`reference`, ângulo a partir de +X) e o segundo o raio final; o giro é o ângulo entre os
 * dois. `withConnected`: a rede ligada gira junto (padrão). `copy`: gira uma cópia e mantém
 * os originais.
 */
export interface RotateState {
  readonly ids: readonly string[];
  readonly center: Vec3 | null;
  readonly reference: number | null;
  readonly withConnected: boolean;
  readonly copy: boolean;
}

/** Passo de captura do ângulo pelo cursor; ângulos quaisquer entram pelo campo numérico. */
export const ROTATE_SNAP = degToRad(15);

/** Passo do girar pelo cursor: o passo angular da precisão, se ligada; senão, 15°. */
export const rotateStepOf = (): number => {
  const settings = precision();
  return settings.enabled ? settings.angleStep : ROTATE_SNAP;
};

/**
 * Ângulo do giro indicado pelo cursor, medido a partir de +X (leste) no sentido anti-horário,
 * como no comando girar dos programas de CAD, arredondado a `step`. `null` = cursor no centro.
 */
export function rotationAngleOf(center: Vec3, point: Vec3, step = ROTATE_SNAP): number | null {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  if (Math.hypot(dx, dy) < 1e-6) return null;
  const angle = Math.atan2(dy, dx);
  return step > 0 ? Math.round(angle / step) * step : angle;
}

/**
 * Giro entre o raio inicial (`reference`) e o raio pelo cursor, no intervalo (−180°, 180°],
 * arredondado a `step`. `null` = cursor no centro.
 */
export function rotationSweepOf(
  center: Vec3,
  reference: number,
  point: Vec3,
  step = ROTATE_SNAP,
): number | null {
  const direction = rotationAngleOf(center, point, 0);
  if (direction === null) return null;
  let sweep = direction - reference;
  while (sweep <= -Math.PI) sweep += 2 * Math.PI;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  return step > 0 ? Math.round(sweep / step) * step : sweep;
}

/** Centro da seleção em planta (meio da envoltória das portas e origens), como no Revit. */
export function selectionCenterOf(project: Project, ids: readonly string[]): Vec3 | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const id of ids) {
    const element = getElement(project, id);
    if (!element) continue;
    const points = getPorts(element).map((port) => port.position);
    if (element.kind !== 'pipe') points.push(element.placement.position);
    for (const p of points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return vec3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
}

/** Resultado do giro (ou da cópia girada) — o mesmo para a prévia e para a confirmação. */
export function planRotate(
  project: Project,
  rotation: RotateState,
  angle: number,
): Result<Project> | null {
  if (!rotation.center) return null;
  const ids = moveIdsOf(project, rotation);
  if (!rotation.copy) return rotateElements(project, ids, rotation.center, angle);
  const copied = copyRotatedElements(project, ids, rotation.center, angle);
  return copied.ok ? success(copied.value.project) : copied;
}

/** Origem de referência do elemento: meio do tubo ou origem da peça/equipamento. */
export function elementOriginOf(project: Project, id: string): Vec3 | null {
  const element = getElement(project, id);
  if (!element) return null;
  return element.kind === 'pipe'
    ? scale(add(element.start, element.end), 0.5)
    : element.placement.position;
}

/** Elementos efetivamente deslocados: a seleção ou, com a rede junto, os conjuntos ligados. */
export function moveIdsOf(
  project: Project,
  move: { readonly ids: readonly string[]; readonly withConnected: boolean },
): string[] {
  const ids = move.ids.filter((id) => getElement(project, id));
  if (!move.withConnected) return ids;
  return [...new Set(ids.flatMap((id) => connectedComponent(project, id)))];
}

/**
 * Destino do ponto-base. Sobre uma porta ou em trecho vertical (Shift, no 3D), o ponto
 * capturado vale inteiro; nos demais casos (plano de trabalho, grade, planta) o deslocamento
 * é horizontal — a cota do elemento só muda de propósito, nunca pela cota do plano.
 */
export function moveTargetOf(from: Vec3, point: Vec3, snap: string | null): Vec3 {
  return snap === 'port' || snap === 'vertical' ? point : vec3(point.x, point.y, from.z);
}

/** Resultado do deslocamento até `target` — o mesmo para a prévia e para a confirmação. */
export function planMove(project: Project, move: MoveState, target: Vec3): Result<Project> | null {
  if (!move.from) return null;
  const delta = sub(target, move.from);
  if (Math.hypot(delta.x, delta.y, delta.z) < 1e-9) return null;
  return translateElements(project, moveIdsOf(project, move), delta);
}
export const isAnnotationTool = (tool: ToolId): tool is AnnotationToolId =>
  (ANNOTATION_TOOLS as readonly string[]).includes(tool);
/** Área de trabalho: modelo 3D ou planta baixa (documentação técnica). */
/** `bim` = aba BIM / IFC: visualizador 3D, árvore de elementos e painel de propriedades IFC. */
export type ViewMode = '3d' | 'plan' | 'bim';

/** Pontos já informados da anotação em criação na planta. */
/**
 * Tema da planta: `color` usa as cores do modelo 3D (material, papel de cada parte e cor do
 * sistema); `mono` desenha em preto sobre branco, para impressão monocromática.
 */
export type PlanTheme = 'color' | 'mono';

export interface PlanDraft {
  readonly points: readonly Point2[];
  /** Elemento escolhido para a etiqueta. */
  readonly elementId: string | null;
}
const EMPTY_DRAFT: PlanDraft = { points: [], elementId: null };
export type MessageLevel = 'info' | 'success' | 'error';
/** Abas do diálogo "Projeto e análises". */
export type ProjectDialogTab =
  'levels' | 'systems' | 'georeference' | 'terrain' | 'profile' | 'clashes' | 'quantities';
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
  /**
   * Tubo existente sobre o qual o trecho começa: `point` fica no eixo dele e o tê é inserido
   * ali quando o ponto seguinte define o lado da derivação.
   */
  readonly pipeId: string | null;
  /**
   * Tê ou cruzeta existentes de onde o trecho parte: o ramal sai pela porta voltada para o
   * ponto seguinte (no lado oposto à derivação de um tê, com a conversão em cruzeta).
   */
  readonly junctionId?: string | null;
}

/** "Alinhar e conectar": extremidade de partida, porta de referência e alternativa escolhida. */
export interface ConnectState {
  readonly from: PortRef | null;
  readonly to: PortRef | null;
  /** Chave da alternativa escolhida; `null` = a primeira. */
  readonly choice: string | null;
  /** Alternativas calculadas sobre `base`; a confirmação grava exatamente a escolhida. */
  readonly plan: { readonly base: Project; readonly result: Result<ConnectionPlan> } | null;
}
const EMPTY_CONNECT: ConnectState = { from: null, to: null, choice: null, plan: null };

/** Conversão tê ⇄ cruzeta aguardando confirmação (prévia no painel e nas vistas). */
export interface JunctionPreview {
  readonly elementId: string;
  readonly target: 'cross' | 'tee';
  readonly familyId: string | null;
  readonly base: Project;
  readonly result: Result<JunctionChange>;
}

export interface CursorInfo {
  readonly point: Vec3;
  readonly snap: SnapKind;
  readonly port: PortRef | null;
  /** Elemento capturado: dono da porta ou tubo que receberá o tê automático. */
  readonly elementId?: string | null;
  /** Portas livres sob o cursor (mais de uma: Tab alterna). */
  readonly stacked?: number;
  /** Aviso da captura, ex.: tubo em outra cota tratado só como referência. */
  readonly note?: string | null;
}

/** Reservatório a inserir: família de catálogo e modelo comercial ou dimensões próprias. */
export interface TankToolOptions {
  /** `null` = reservatório cilíndrico genérico (sem catálogo). */
  readonly familyId: string | null;
  /** `null` = dimensões personalizadas. */
  readonly variantId: string | null;
  readonly custom: TankCustomDimensions;
}

/** Famílias de reservatórios: catálogo embutido mais as personalizadas do projeto. */
export function tankFamiliesOf(project: Project): TankFamily[] {
  return mergeTankFamilies(project, TANK_FAMILIES);
}

export function tankFamilyOf(
  project: Project,
  id: string | null | undefined,
): TankFamily | undefined {
  return id ? tankFamiliesOf(project).find((family) => family.id === id) : undefined;
}

/** Entrada da operação de inserção para as opções da ferramenta Reservatório. */
export function tankFittingInput(project: Project, options: TankToolOptions): Result<FittingInput> {
  const family = tankFamilyOf(project, options.familyId);
  if (!family) return { ok: true, value: { kind: 'tank' } };
  const parameters = tankParametersFromFamily(
    family,
    options.variantId ? { variantId: options.variantId } : { custom: options.custom },
  );
  return parameters.ok
    ? { ok: true, value: { kind: 'tank', parameters: parameters.value } }
    : parameters;
}

/** Famílias de bombas: catálogo embutido mais as personalizadas do projeto. */
export function pumpFamiliesOf(project: Project): PumpFamily[] {
  return mergePumpFamilies(project, PUMP_FAMILIES);
}

export function pumpFamilyOf(
  project: Project,
  id: string | null | undefined,
): PumpFamily | undefined {
  return id ? pumpFamiliesOf(project).find((family) => family.id === id) : undefined;
}

/** Bomba a inserir: família de catálogo e linha da tabela, ou cotas preenchidas à mão. */
export interface PumpToolOptions {
  /** `null` = conjunto motobomba genérico (sem catálogo). */
  readonly familyId: string | null;
  /** `null` = outro modelo: cotas preenchidas pelo usuário, com as letras do dimensional. */
  readonly variantId: string | null;
  readonly custom: PumpCustomInput;
  /** Cotas preenchidas: DN da descarga (B); `null` = o mesmo da sucção. */
  readonly dischargeDn: number | null;
}

/**
 * Especificação da sucção e entrada da operação de inserção para as opções da ferramenta
 * Bomba. `base` é a especificação de tubo ativa (ou a da extremidade a acoplar).
 */
export function pumpPlacementOf(
  project: Project,
  options: PumpToolOptions,
  base: PipeSpec,
): Result<{ spec: PipeSpec; fitting: FittingInput }> {
  const family = pumpFamilyOf(project, options.familyId);
  if (!family) return { ok: true, value: { spec: base, fitting: { kind: 'pump' } } };
  return resolvePumpPlacement(
    family,
    options.variantId ? { variantId: options.variantId } : { custom: options.custom },
    base,
    options.dischargeDn ?? undefined,
  );
}

/** Extremidades dos tubos novos: configuração e família de tubos flangeados (classe PN). */
export interface PipeEndsToolOptions {
  readonly configuration: PipeEndConfiguration;
  /** `null` = primeira família oferecida para a especificação ativa. */
  readonly familyId: string | null;
}

/**
 * Acabamento das extremidades de um tubo novo com a especificação `spec`, conforme as
 * opções da ferramenta. `undefined` = pontas lisas (configuração padrão, ou especificação
 * sem família de tubos com flanges, ou diâmetro sem flange tabulado).
 */
export function pipeEndsInputOf(options: PipeEndsToolOptions, spec: PipeSpec) {
  if (options.configuration === 'plainPlain') return undefined;
  const families = flangedPipeFamiliesFor(spec.specificationId);
  const family = families.find((f) => f.id === options.familyId) ?? families[0];
  const ends = family ? resolvePipeEnds(spec, family.id, options.configuration) : null;
  return family && ends ? { ...ends, familyId: family.id } : undefined;
}

export interface ToolOptions {
  readonly tank: TankToolOptions;
  readonly pump: PumpToolOptions;
  readonly pipeEnds: PipeEndsToolOptions;
  readonly elbowAngleDeg: number;
  readonly valveType: ValveType;
  /** DN de saída da redução; `null` = diâmetro imediatamente menor da especificação. */
  readonly reducerDn: number | null;
  /** DN da derivação do tê; `null` = igual à passagem. */
  readonly teeBranchDn: number | null;
  /**
   * Peça da derivação criada pela Tubulação: `auto` (tê sobre tubo simples; no lado oposto à
   * derivação de um tê, converte-o em cruzeta), `tee` ou `cross` (quarta porta livre).
   */
  readonly junction: JunctionChoice;
  /**
   * `reducers`: altera só o elemento e insere/ajusta reduções junto aos vizinhos;
   * `propagate`: aplica a todo o trecho conectado.
   */
  readonly sizeMode: SizeMode;
  /** Família preferida por tipo de conexão (`null`/ausente = primeira compatível). */
  readonly families: Partial<Record<FamilyKind, string | null>>;
  /**
   * Somente peças de catálogo: as mudanças de direção travam nos ângulos dos joelhos da
   * especificação e qualquer operação que criaria joelho, tê, redução ou válvula de
   * dimensões genéricas (sem família) é recusada. Desligado: peças genéricas são aceitas e
   * identificadas como tal.
   */
  readonly lockElbowAngles: boolean;
  /**
   * Assentamento por recobrimento (ferramenta Tubulação, Planta Infra): com a opção ligada, a
   * cota do eixo de cada ponto clicado vem do terreno — geratriz superior `cover` metros
   * abaixo dele. O valor é decisão de projeto do usuário, não um mínimo de norma.
   */
  readonly terrainCover: { readonly enabled: boolean; readonly cover: number };
  /**
   * Assentamento de equipamentos (Bomba, Reservatório) sobre o terreno: com a opção ligada e o
   * projeto com superfície, a cota de referência do elemento (base do reservatório, eixo de
   * sucção da bomba) é a do terreno no ponto clicado mais `offset` metros. Fora da superfície,
   * vale a cota do plano de trabalho.
   */
  readonly terrainPlacement: { readonly enabled: boolean; readonly offset: number };
  /**
   * Superfície de onde vêm as cotas de terreno do assentamento (recobrimento dos tubos e
   * equipamentos sobre o terreno): o terreno projetado (o natural modificado pelos platôs, o
   * terreno acabado) ou o natural. Sem platôs as duas coincidem.
   */
  readonly groundSurface: GroundSurface;
}

/** Superfície de assentamento escolhida nas opções da ferramenta; `null` sem terreno. */
export function placementGroundOf(state: {
  project: Project;
  toolOptions: ToolOptions;
}): Terrain | null {
  return groundSurfaceOf(state.project, state.toolOptions.groundSurface);
}

/**
 * Nome da superfície de assentamento nas mensagens ("terreno projetado", "terreno natural");
 * sem platôs, só "terreno".
 */
export function placementGroundLabel(state: {
  project: Project;
  toolOptions: ToolOptions;
}): string {
  return hasDesignTerrain(state.project)
    ? GROUND_SURFACE_LABELS[state.toolOptions.groundSurface]
    : 'terreno';
}

/** Clique no viewport já resolvido para o domínio. */
export interface ViewportClick {
  readonly point: Vec3 | null;
  readonly port: PortRef | null;
  readonly hit: { elementId: string; point: Vec3 } | null;
  /** Ctrl/Shift pressionado: adiciona ou remove da seleção. */
  readonly additive?: boolean;
}

/** Arrasto de uma alça de tubo (esticar/encolher) em andamento. */
export interface PipeStretch {
  readonly pipeId: string;
  readonly which: 'start' | 'end';
  /** Projeto no início do arrasto: base de cada prévia e do registro único no histórico. */
  readonly base: Project;
}

/** Arrasto de uma peça ao longo da linha (alça da válvula, tê, cruzeta...). */
export interface InlineSlide {
  readonly elementId: string;
  /** Ponto agarrado, sobre o eixo da peça, no início do arrasto. */
  readonly grab: Vec3;
  /** Projeto no início do arrasto: base de cada prévia e do registro único no histórico. */
  readonly base: Project;
}

/** Menu de contexto do botão direito, junto a uma extremidade de tubo ou a uma conexão. */
export interface ContextMenuState {
  /** Posição na janela (px). */
  readonly x: number;
  readonly y: number;
  /** Porta livre de onde o tubo pode partir; `null` = não há extremidade livre ali. */
  readonly port: PortRef | null;
  /** Elemento apontado (dono da porta). */
  readonly elementId: string;
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
  viewMode: ViewMode;
  /** Aba BIM / IFC: elementos ocultos no visualizador (estado de exibição, não persistido). */
  bimHidden: string[];
  /** Aba BIM / IFC: entidade IFC a exibir (`null` = todas). */
  bimClassFilter: string | null;
  /** Anotação selecionada na planta. */
  annotationSelection: string | null;
  planDraft: PlanDraft;
  /** Tipo das novas cotas. */
  dimensionMode: DimensionMode;
  /**
   * Planta em linhas finas: todo traço com 1 px na tela, em qualquer zoom. É o padrão, porque
   * na espessura de papel o traço encobre as peças pequenas (0,25 mm em 1:50 são 12,5 mm).
   * É um modo de visualização — a exportação mantém as espessuras de papel.
   */
  planThinLines: boolean;
  /** Tema da planta; vale também para a exportação em SVG. */
  planTheme: PlanTheme;
  tool: ToolId;
  activeSpec: PipeSpec;
  toolOptions: ToolOptions;
  workPlaneZ: number;
  /**
   * Elevação do eixo das tubulações (m) acima do plano de trabalho (nível). Acompanha a cota
   * do ponto de partida do trecho; alterá-la durante o traçado cria a prumada.
   */
  pipeElevation: number;
  gridStep: number;
  snapToGrid: boolean;
  orthographic: boolean;
  anchor: DrawAnchor | null;
  connect: ConnectState;
  junctionPreview: JunctionPreview | null;
  measure: { a: Vec3 | null; b: Vec3 | null };
  cursor: CursorInfo | null;
  stretch: PipeStretch | null;
  /** Peça sendo arrastada ao longo da linha. */
  inlineSlide: InlineSlide | null;
  /** Mover interativo em andamento (ferramenta `move`). */
  move: MoveState | null;
  /** Girar interativo em andamento (ferramenta `rotate`). */
  rotate: RotateState | null;
  /** Alinhar por pontos em andamento (ferramenta `align`). */
  align: AlignState | null;
  /**
   * "Ponto livre" do alinhar: os pontos não se ajustam à grade. Preferência da sessão — vale
   * para os próximos alinhamentos, sem mexer no "Ajustar à grade" das outras ferramentas.
   */
  alignFreePoint: boolean;
  contextMenu: ContextMenuState | null;
  message: EditorMessage | null;
  /** selection: enquadra só os elementos selecionados. */
  viewRequest: { preset: ViewPreset; nonce: number; selection?: boolean } | null;
  /**
   * Origem de renderização das vistas (estado de sessão, não persistido): o desenho é feito em
   * relação a ela para preservar a precisão com coordenadas grandes. Nunca altera o projeto.
   */
  renderOrigin: Vec3;
  /** Pedido de abertura do diálogo "Projeto e análises" em uma aba (vindo das vistas). */
  projectDialogRequest: { tab: ProjectDialogTab; nonce: number } | null;
  /** Seletor de georreferência pelo mapa aberto sobre a Planta Infra (estado de sessão). */
  geoPicker: boolean;
  /**
   * Fonte de mapa personalizada do usuário (pode conter a chave dele): preferência deste
   * navegador, nunca gravada no projeto.
   */
  customBasemap: CustomBasemapSource | null;

  notify: (level: MessageLevel, text: string) => void;
  /**
   * Aplica o resultado de uma operação de domínio calculada fora desta store (vistas de
   * projeto e detalhes 2D), com o mesmo histórico de desfazer/refazer e as mesmas mensagens.
   */
  applyOperation: (result: Result<Project>, successMessage?: string) => boolean;
  loadProject: (project: Project, options?: { saved?: boolean }) => void;
  newProject: (discipline?: Discipline) => void;
  markSaved: () => void;
  setProjectName: (name: string) => void;
  setDiscipline: (discipline: Discipline) => void;
  setTool: (tool: ToolId) => void;
  setViewMode: (mode: ViewMode) => void;
  /** Oculta ou volta a exibir elementos no visualizador da aba BIM / IFC. */
  setBimHidden: (ids: readonly string[], hidden: boolean) => void;
  /** Isola os elementos indicados (oculta os demais). */
  isolateBim: (ids: readonly string[]) => void;
  showAllBim: () => void;
  setBimClassFilter: (entity: string | null) => void;
  /** Informa (ou limpa, com `null`) uma propriedade IFC editável do tipo ou da ocorrência. */
  setIfcValue: (elementId: string, scope: IfcScope, key: string, value: IfcValue | null) => boolean;
  selectAnnotation: (id: string | null) => void;
  setPlanDraft: (draft: PlanDraft) => void;
  setDimensionMode: (mode: DimensionMode) => void;
  setPlanThinLines: (enabled: boolean) => void;
  setPlanTheme: (theme: PlanTheme) => void;
  createAnnotation: (input: AnnotationInput) => string | null;
  changeAnnotation: (id: string, patch: AnnotationPatch) => boolean;
  changeDrawingScale: (scale: number) => void;
  /** Altera a configuração da Planta Infra (escala, mapa de fundo, camadas e rótulos). */
  changeInfraSettings: (patch: InfraSettingsPatch) => void;
  /** Reposiciona a origem de renderização quando o ponto observado se afasta dela. */
  rebaseRenderOrigin: (focus: Vec3) => void;
  openProjectDialog: (tab: ProjectDialogTab) => void;
  /** Abre ou fecha o seletor de georreferência pelo mapa (abre a Planta Infra, se preciso). */
  setGeoPicker: (open: boolean) => void;
  setCustomBasemap: (source: CustomBasemapSource | null) => void;
  select: (id: string | null, additive?: boolean) => void;
  selectMany: (ids: string[]) => void;
  setActiveSpec: (specificationId: string, dn: number) => void;
  setToolOptions: (patch: Partial<ToolOptions>) => void;
  setPreferredFamily: (kind: FamilyKind, familyId: string | null) => void;
  setWorkPlaneZ: (z: number) => void;
  /** Define a elevação do eixo; com um trecho em andamento, cria a prumada até a nova cota. */
  setPipeElevation: (elevation: number) => void;
  setGridStep: (step: number) => void;
  setSnapToGrid: (enabled: boolean) => void;
  setOrthographic: (enabled: boolean) => void;
  setCursor: (cursor: CursorInfo | null) => void;
  requestView: (preset: ViewPreset, options?: { selection?: boolean }) => void;
  /** Isométrica ortográfica verdadeira; repetir o comando gira para o quadrante seguinte. */
  requestIsometric: () => void;
  cancelInteraction: () => void;

  handleViewportClick: (click: ViewportClick) => void;
  /** Informa um ponto por coordenadas (tubo, medição, bomba e reservatório). */
  commitPoint: (point: Vec3, port?: PortRef | null) => void;
  /** Termina o trecho em andamento sobre um tubo existente, com tê automático. */
  finishPipeOnPipe: (pipeId: string) => void;
  insertFittingAtPort: (kind: FittingKind, target: PortRef) => void;
  insertFittingInline: (kind: 'tee' | 'valve', pipeId: string, distanceFromStart: number) => void;

  changeSpec: (elementId: string, specificationId: string, dn: number, portId?: string) => void;
  rename: (elementId: string, name: string) => void;
  movePipeEnd: (pipeId: string, which: 'start' | 'end', point: Vec3) => void;
  changePipeLength: (pipeId: string, length: number) => void;
  /** Define as extremidades do tubo (flange/ponta) pela família de tubos flangeados. */
  changePipeEnds: (
    pipeId: string,
    configuration: PipeEndConfiguration,
    familyId: string | null,
  ) => void;
  /** Define a cota Z do elemento; tubos e conexões levam junto os elementos conectados. */
  changeElevation: (elementId: string, elevation: number) => void;
  changeFitting: (elementId: string, patch: FittingPatch) => void;
  /** Duplica a família como personalizada do projeto; devolve o id da cópia. */
  duplicateTankFamily: (family: TankFamily) => string | null;
  saveTankFamily: (family: TankFamily, applyToInstances: boolean) => boolean;
  deleteTankFamily: (familyId: string) => void;
  /** Aplica outra família/modelo comercial (ou dimensões personalizadas) ao reservatório. */
  changeTankModel: (elementId: string, familyId: string, selection: TankSelection) => void;
  changeTankSettings: (elementId: string, patch: TankSettingsPatch) => void;
  /** Duplica a família de bombas como personalizada do projeto; devolve o id da cópia. */
  duplicatePumpFamily: (family: PumpFamily) => string | null;
  savePumpFamily: (family: PumpFamily, applyToInstances: boolean) => boolean;
  deletePumpFamily: (familyId: string) => void;
  /** Troca a classe de pressão do flange de sucção (`a`) ou de descarga (`b`) da bomba. */
  changePumpFlange: (elementId: string, portId: 'a' | 'b', pressureClass: string) => void;
  /** Acrescenta um bocal com a especificação ativa, em posição inicial editável. */
  addTankNozzle: (elementId: string, role: TankNozzleRole) => void;
  changeTankNozzle: (elementId: string, nozzleId: string, patch: Partial<TankNozzleInput>) => void;
  removeTankNozzle: (elementId: string, nozzleId: string) => void;
  roll: (elementId: string, axisPortId: string, angleDeg: number) => void;
  setProperty: (elementId: string, key: string, value: PropertyValue | undefined) => void;
  disconnectPort: (ref: PortRef) => void;
  deleteSelected: () => void;
  moveSelection: (delta: Vec3) => void;
  /**
   * Começa o mover interativo dos elementos indicados (padrão: a seleção): ponto-base e,
   * depois, o destino, com a prévia do resultado. Um único passo no histórico.
   */
  startMove: (ids?: readonly string[]) => void;
  /** Leva junto (rigidamente) os elementos ligados aos que se movem. */
  setMoveWithConnected: (enabled: boolean) => void;
  /**
   * Começa o girar em planta dos elementos indicados (padrão: a seleção), com a rede ligada
   * junto: centro e, depois, a direção (cursor) ou o ângulo digitado. Um passo no histórico.
   */
  startRotate: (ids?: readonly string[]) => void;
  setRotateCenter: (center: Vec3 | null) => void;
  setRotateWithConnected: (enabled: boolean) => void;
  /** Girar uma cópia (os originais ficam), como a opção "Copiar" do Revit. */
  setRotateCopy: (enabled: boolean) => void;
  /** Gira a seleção 90° em torno do próprio centro, com a rede ligada (Espaço, como no Revit). */
  rotateSelectionQuarter: () => boolean;
  /** Aplica o giro de `angle` radianos (anti-horário) em torno do centro indicado. */
  applyRotation: (angle: number) => boolean;
  /**
   * Começa o alinhar por pontos dos elementos indicados (padrão: a seleção), como o ALIGN do
   * AutoCAD: origem 1 → destino 1 e origem 2 → destino 2. Um passo no histórico.
   */
  startAlign: (ids?: readonly string[]) => void;
  setAlignWithConnected: (enabled: boolean) => void;
  setAlignCopy: (enabled: boolean) => void;
  setAlignFreePoint: (enabled: boolean) => void;
  /**
   * Aplica o alinhamento com o destino 2 indicado; `null` aplica só o primeiro par (desloca).
   * Recusado, o alinhar continua.
   */
  applyAlign: (target2: Vec3 | null) => boolean;
  /**
   * Desliza a seleção um passo ao longo da linha (setas do teclado). `preferences` são as
   * direções da seta no modelo, em ordem de prioridade (ver `chooseSlideDirection`).
   */
  nudgeSelection: (preferences: readonly Vec3[], step: number) => void;
  /** Começa a esticar/encolher um tubo pela alça da extremidade `which`. */
  beginStretch: (pipeId: string, which: 'start' | 'end') => void;
  /** Prévia do arrasto: a extremidade vai para o ponto do eixo mais próximo de `point`. */
  stretchTo: (point: Vec3) => void;
  /** Encerra o arrasto; `apply` falso restaura o projeto do início. */
  endStretch: (apply: boolean) => void;
  /** Começa a deslizar a peça `elementId` entre os tubos, agarrada em `grab` (eixo da peça). */
  beginInlineSlide: (elementId: string, grab: Vec3) => void;
  /** Prévia do arrasto: a peça vai para a cota que corresponde a `point` (sobre o eixo). */
  inlineSlideTo: (point: Vec3) => void;
  /** Encerra o arrasto; `apply` falso restaura o projeto do início. */
  endInlineSlide: (apply: boolean) => void;
  /** Posiciona a peça com a cota `value` (m) na extremidade `portId` (painel de propriedades). */
  setInlineClearanceOf: (elementId: string, portId: string, value: number) => void;
  openContextMenu: (menu: ContextMenuState) => void;
  closeContextMenu: () => void;
  /** Aciona a ferramenta Tubo já partindo da porta livre indicada. */
  startPipeFromPort: (ref: PortRef) => void;
  copySelection: (delta: Vec3) => void;
  /**
   * Liga duas extremidades livres com tubos e joelhos (fechamento assistido). ngle escolhe
   * o ângulo dos joelhos no desvio paralelo; 
ull = primeira solução disponível.
   */
  closeFreeEnds: (a: PortRef, b: PortRef, angle: number | null) => boolean;
  /** "Alinhar e conectar": indica a extremidade de partida e, depois, a porta de referência. */
  pickConnectPort: (ref: PortRef) => void;
  setConnectChoice: (key: string) => void;
  /** Grava a alternativa escolhida, exatamente como na prévia; devolve se gravou. */
  confirmConnection: () => boolean;
  resetConnection: () => void;
  /** Prévia da troca tê ⇄ cruzeta (a peça alvo decorre do tipo atual). */
  previewJunction: (elementId: string, familyId: string | null) => void;
  confirmJunction: () => boolean;
  cancelJunction: () => void;
  /** Termina o trecho em andamento num tê ou cruzeta existentes. */
  finishPipeOnJunction: (junctionId: string) => void;
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
    pipeId: null,
  };
}

/** Famílias disponíveis: catálogo embutido + personalizações do projeto. */
export function familiesOf(project: Project): FittingFamily[] {
  return mergeFamilies(BUILTIN_FAMILIES, project.families);
}

/** Deflexões (rad) com joelho de catálogo para a especificação; vazio = ângulo livre. */
/**
 * Famílias (catálogo + projeto) que alimentam a camada IFC: os tipos, a referência do
 * catálogo e a origem dos parâmetros. Usadas pela aba BIM / IFC e pela exportação.
 */
export function ifcOptionsOf(project: Project): Required<IfcModelOptions> {
  return {
    families: [...familiesOf(project), ...FLANGED_PIPE_FAMILIES],
    tankFamilies: tankFamiliesOf(project),
  };
}

/**
 * Ângulos de joelho de catálogo para a especificação. Com `ends` flangeado (a porta de onde
 * o traçado sai), só contam as curvas flangeadas: flange liga com flange.
 */
export function elbowAnglesOf(
  project: Project,
  spec: PipeSpec,
  ...ends: readonly (EndTreatment | null | undefined)[]
): number[] {
  return availableElbowAngles(familiesOf(project), spec, requiredEndType(...ends));
}

/** Cota Z (m) dos pontos livres da ferramenta: o eixo dos tubos fica acima do nível. */
export function drawElevationOf(state: {
  tool: ToolId;
  workPlaneZ: number;
  pipeElevation: number;
}): number {
  return state.tool === 'pipe' ? state.workPlaneZ + state.pipeElevation : state.workPlaneZ;
}

/**
 * Cota de assentamento de um equipamento sobre o terreno em (x, y), arredondada ao milímetro;
 * `null` quando a ferramenta não é de equipamento, a opção está desligada, o projeto não tem
 * superfície ou o ponto está fora dela (nenhuma cota é presumida).
 */
export function equipmentGroundElevation(
  state: { tool: ToolId; project: Project; toolOptions: ToolOptions },
  x: number,
  y: number,
): number | null {
  if (state.tool !== 'pump' && state.tool !== 'tank') return null;
  const { enabled, offset } = state.toolOptions.terrainPlacement;
  const terrain = placementGroundOf(state);
  if (!enabled || !terrain) return null;
  const ground = terrainElevationAt(terrain, x, y);
  return ground === null ? null : Math.round((ground + offset) * 1000) / 1000;
}

/**
 * Trava de ângulo do trecho em criação: saindo da extremidade de um tubo, a mudança de
 * direção recebe um joelho automático, que precisa existir no catálogo. `null` = sem trava.
 */
export function deflectionConstraintOf(state: {
  project: Project;
  tool: ToolId;
  anchor: DrawAnchor | null;
  toolOptions: ToolOptions;
}): { origin: Vec3; axis: Vec3; angles: number[]; jointLimit: number } | null {
  const { anchor } = state;
  if (state.tool !== 'pipe' || !anchor?.port || anchor.lockAxis) return null;
  if (!state.toolOptions.lockElbowAngles) return null;
  const port = resolvePort(state.project, anchor.port);
  if (!port) return null;
  // Sem joelho de catálogo a lista é vazia: só o prolongamento reto é possível.
  return {
    origin: port.position,
    axis: port.direction,
    angles: elbowAnglesOf(state.project, port.spec, port.end),
    // Desvio admitido sem peça, pela junta ou pela curvatura a frio do tubo. O trecho novo
    // sai de ponta lisa e ainda não tem comprimento: o núcleo confere ao confirmar.
    jointLimit: jointDeflectionLimit(port, { spec: port.spec, end: null, run: Infinity }),
  };
}

/**
 * Tipo de válvula inicial da ferramenta: mantém o atual se houver família para a
 * especificação; senão, o primeiro tipo com família (para a ferramenta funcionar de saída
 * com "somente peças de catálogo").
 */
function catalogValveType(project: Project, spec: PipeSpec, current: ValveType): ValveType {
  const types = familiesOf(project)
    .filter(
      (family) =>
        family.kind === 'valve' &&
        family.specificationId === spec.specificationId &&
        family.sizes.some((size) => size.dn === spec.dn && size.length !== undefined),
    )
    .map((family) => family.valveType)
    .filter((type): type is ValveType => type !== undefined && type !== 'airRelease');
  return types.includes(current) ? current : (types[0] ?? current);
}

/**
 * Trecho em criação apontado para um tubo existente: ponto onde o tê automático será inserido
 * (pé da perpendicular da âncora sobre o eixo do tubo). `null` quando não se aplica.
 */
export function pipeJunctionOf(state: JunctionState, elementId: string | null): Vec3 | null {
  const candidate = junctionCandidate(state, elementId);
  return candidate && !candidate.offLevel ? candidate.point : null;
}

/**
 * Desnível máximo (m) entre a cota do traçado e o pé da perpendicular para que, na planta,
 * o tubo sob o cursor seja destino de um tê automático.
 */
export const LEVEL_TOLERANCE = 1e-3;

type JunctionState = {
  project: Project;
  tool: ToolId;
  anchor: DrawAnchor | null;
  /** Ausente = modelo 3D (o tubo é apontado em três dimensões). */
  viewMode?: ViewMode;
};

/**
 * Pé da perpendicular da âncora sobre o tubo indicado. Na planta o cursor só informa X e Y:
 * um tubo em outra cota que apenas cruza o traçado em projeção é referência geométrica, não
 * destino de conexão (`offLevel`) — senão o clique criaria um tê e um trecho inclinado que
 * ninguém pediu. No modelo 3D o tubo é apontado diretamente e a ligação é sempre intencional.
 */
function junctionCandidate(
  state: JunctionState,
  elementId: string | null,
): { pipe: Pipe; point: Vec3; offLevel: boolean } | null {
  const { anchor } = state;
  if (state.tool !== 'pipe' || !anchor || !elementId) return null;
  // O tubo de onde o trecho parte não pode ser também o destino.
  if (anchor.port?.elementId === elementId || anchor.pipeId === elementId) return null;
  const target = getElement(state.project, elementId);
  if (!target || target.kind !== 'pipe') return null;
  const point = pipeBranchPoint(target, anchor.point).point;
  const offLevel =
    state.viewMode === 'plan' && Math.abs(point.z - anchor.point.z) > LEVEL_TOLERANCE;
  return { pipe: target, point, offLevel };
}

/**
 * Tubo sob o cursor, na planta, que o traçado cruza em outra cota: é só referência e não
 * recebe conexão. Devolve o aviso a mostrar junto ao cursor; `null` quando não se aplica.
 */
export function pipeCrossingOf(state: JunctionState, elementId: string | null): string | null {
  const candidate = junctionCandidate(state, elementId);
  if (!candidate?.offLevel || !state.anchor) return null;
  const dz = candidate.point.z - state.anchor.point.z;
  return `"${candidate.pipe.name}" está ${formatMeters(Math.abs(dz), 2)} ${
    dz > 0 ? 'acima' : 'abaixo'
  } do traçado — cruzamento sem conexão`;
}

type PipeSnapState = {
  project: Project;
  tool: ToolId;
  anchor: DrawAnchor | null;
  viewMode?: ViewMode;
  snapToGrid: boolean;
  gridStep: number;
};
/** Elemento sob o cursor e, quando conhecido, o ponto indicado sobre ele. */
type PipeSnapHit = { readonly elementId: string; readonly point: Vec3 | null };

/**
 * Início do trecho sobre um tubo existente: ponto do eixo do tubo mais próximo do indicado
 * (ajustado à grade), onde o tê automático será inserido. `null` quando não se aplica.
 */
export function pipeStartOf(state: PipeSnapState, hit: PipeSnapHit | null): Vec3 | null {
  if (state.tool !== 'pipe' || state.anchor || !hit?.point) return null;
  const pipe = getElement(state.project, hit.elementId);
  if (!pipe || pipe.kind !== 'pipe') return null;
  const length = distance(pipe.start, pipe.end);
  const along = (p: Vec3): number =>
    Math.min(length, Math.max(0, distanceAlongPipe(pipe.start, pipe.end, p)));
  const at = (t: number): Vec3 => add(pipe.start, scale(sub(pipe.end, pipe.start), t / length));
  const onAxis = at(along(hit.point));
  const step = state.snapToGrid ? state.gridStep : 0;
  if (step <= 0) return onAxis;
  const snap = (v: number): number => Math.round(v / step) * step;
  return at(along(vec3(snap(onAxis.x), snap(onAxis.y), snap(onAxis.z))));
}

/**
 * Ajuste do cursor da ferramenta de tubo junto a tubos existentes, para que a prévia mostre
 * onde o tê automático ficará: início sobre um tubo, término sobre um tubo ou, partindo de
 * um tubo, ponto final na perpendicular a ele. `null` = cursor sem ajuste.
 */
export function pipeSnapOf(
  state: PipeSnapState,
  hit: PipeSnapHit | null,
  point: Vec3 | null,
): Vec3 | null {
  if (state.tool !== 'pipe') return null;
  const { anchor } = state;
  if (!anchor) return pipeStartOf(state, hit);
  const junction = pipeJunctionOf(state, hit?.elementId ?? null);
  if (junction) return junction;
  const source = anchor.pipeId ? getElement(state.project, anchor.pipeId) : undefined;
  return source?.kind === 'pipe' && point
    ? projectOntoPipeNormal(source, anchor.point, point)
    : null;
}

/** Evita ruído de ponto flutuante na elevação apresentada (resolução de 1 µm). */
const roundElevation = (value: number): number => Math.round(value * 1e6) / 1e6;

/** Catálogo de conexões efetivo (famílias do projeto + preferências do usuário). */
export function catalogOf(
  project: Project,
  preferred: ToolOptions['families'] = {},
): FittingCatalog {
  return createFamilyCatalog(familiesOf(project), preferred, {
    pipeFlange: pipeFlangeEnd,
    flange: flangeForClass,
    flangedPipeFamilies: (specificationId) =>
      flangedPipeFamiliesFor(specificationId).map((family) => family.id),
  });
}

/** O que as operações do traçado leem do estado (confirmação e prévia usam o mesmo). */
export interface PipeOperationState {
  readonly project: Project;
  readonly anchor: DrawAnchor | null;
  readonly activeSpec: PipeSpec;
  readonly toolOptions: ToolOptions;
  /** Ausente = modelo 3D. */
  readonly viewMode?: ViewMode;
}

/** Resultado de uma operação do traçado, com a mensagem de sucesso. */
export interface PipeOperation {
  readonly project: Project;
  /** Elemento a selecionar (o trecho criado ou prolongado). */
  readonly elementId: string;
  readonly message: string;
  /** O trecho terminou acoplado: a polilinha se encerra. */
  readonly closes: boolean;
}

const junctionOptions = (state: PipeOperationState) => ({
  catalog: catalogOf(state.project, state.toolOptions.families),
  teeFamilyId: state.toolOptions.families.tee,
  crossFamilyId: state.toolOptions.families.cross,
  junction: state.toolOptions.junction,
});

const junctionLabel = (choice: JunctionChoice): string => (choice === 'cross' ? 'cruzeta' : 'tê');

/**
 * Termina o trecho em andamento sobre o tubo, tê ou cruzeta `elementId`. Na planta, uma peça em
 * outra cota não recebe a ligação (é só cruzamento em projeção).
 */
export function pipeTargetOperation(
  state: PipeOperationState,
  elementId: string,
): Result<PipeOperation> {
  const { project, anchor } = state;
  const target = getElement(project, elementId);
  if (!anchor || !target)
    return { ok: false, error: { code: 'NO_ANCHOR', message: 'Indique o ponto inicial.' } };
  const origin = anchor.port ? resolvePort(project, anchor.port) : undefined;
  const elbowAngles =
    origin && state.toolOptions.lockElbowAngles
      ? elbowAnglesOf(project, origin.spec, origin.end)
      : undefined;
  const options = junctionOptions(state);
  if (target.kind === 'tee' || target.kind === 'cross') {
    if (
      state.viewMode === 'plan' &&
      Math.abs(target.placement.position.z - anchor.point.z) > LEVEL_TOLERANCE
    ) {
      const dz = target.placement.position.z - anchor.point.z;
      return {
        ok: false,
        error: {
          code: 'OFF_LEVEL',
          message: `"${target.name}" está ${formatMeters(Math.abs(dz), 2)} ${dz > 0 ? 'acima' : 'abaixo'} do traçado — cruzamento sem conexão.`,
        },
      };
    }
    const drawn = drawPipeToJunction(project, {
      fromPort: anchor.port ?? undefined,
      start: anchor.point,
      spec: state.activeSpec,
      junctionId: target.id,
      elbowAngles,
      catalog: options.catalog,
      familyId: target.kind === 'tee' ? options.crossFamilyId : undefined,
      // "Tê" não converte: o lado oposto à derivação é recusado com o motivo.
      convert: state.toolOptions.junction !== 'tee',
    });
    if (!drawn.ok) return drawn;
    return {
      ok: true,
      value: {
        project: drawn.value.project,
        elementId: drawn.value.elementId,
        closes: true,
        message: drawn.value.converted
          ? `"${target.name}" convertido em cruzeta (mesmo elemento) e ramal ligado à quarta porta.`
          : `Ramal ligado a "${target.name}".`,
      },
    };
  }
  if (target.kind !== 'pipe') {
    return {
      ok: false,
      error: { code: 'NOT_A_PIPE', message: 'Termine o trecho sobre um tubo, tê ou cruzeta.' },
    };
  }
  const source = anchor.pipeId ? getElement(project, anchor.pipeId) : undefined;
  const piece = junctionLabel(state.toolOptions.junction);
  const result =
    source?.kind === 'pipe'
      ? drawPipeFromPipe(project, {
          sourcePipeId: source.id,
          distanceFromStart: distanceAlongPipe(source.start, source.end, anchor.point),
          end: pipeBranchPoint(target, anchor.point).point,
          targetPipeId: target.id,
          spec: state.activeSpec,
          ...options,
        })
      : drawPipeToPipe(project, {
          fromPort: anchor.port ?? undefined,
          start: anchor.point,
          targetPipeId: target.id,
          spec: state.activeSpec,
          elbowAngles,
          ...options,
        });
  if (!result.ok) return result;
  return {
    ok: true,
    value: {
      project: result.value.project,
      elementId: result.value.elementId,
      closes: true,
      message: source
        ? `Tubo ligado de "${source.name}" a "${target.name}" com ${piece}s automáticos; os dois tubos foram divididos.`
        : `Tubo ligado a "${target.name}" com ${piece} automático(a); o tubo foi dividido em dois trechos.`,
    },
  };
}

/**
 * Trecho em andamento até o ponto livre `point`: a partir de porta ou ponto (`drawPipe`), de um
 * tubo existente (derivação com tê ou cruzeta) ou de um tê/cruzeta existentes.
 */
export function pipeSegmentOperation(
  state: PipeOperationState,
  point: Vec3,
): Result<{ project: Project; elementId: string; createdIds: readonly string[] }> {
  const { project, anchor } = state;
  if (!anchor)
    return { ok: false, error: { code: 'NO_ANCHOR', message: 'Indique o ponto inicial.' } };
  const origin = anchor.port ? resolvePort(project, anchor.port) : undefined;
  const source = anchor.pipeId ? getElement(project, anchor.pipeId) : undefined;
  const options = junctionOptions(state);
  if (anchor.junctionId) {
    const junction = getElement(project, anchor.junctionId);
    return drawPipeFromJunction(project, {
      junctionId: anchor.junctionId,
      end: point,
      catalog: options.catalog,
      familyId: junction?.kind === 'tee' ? options.crossFamilyId : undefined,
      convert: state.toolOptions.junction !== 'tee',
    });
  }
  return source?.kind === 'pipe'
    ? drawPipeFromPipe(project, {
        sourcePipeId: source.id,
        distanceFromStart: distanceAlongPipe(source.start, source.end, anchor.point),
        end: point,
        spec: state.activeSpec,
        ...options,
      })
    : drawPipe(project, {
        fromPort: anchor.port ?? undefined,
        start: anchor.point,
        end: point,
        spec: state.activeSpec,
        // A partir de uma porta, o tubo herda a especificação dela.
        ends: pipeEndsInputOf(state.toolOptions.pipeEnds, origin?.spec ?? state.activeSpec),
        catalog: options.catalog,
        elbowFamilyId: state.toolOptions.families.elbow,
        elbowAngles:
          origin && state.toolOptions.lockElbowAngles
            ? elbowAnglesOf(project, origin.spec, origin.end)
            : undefined,
      });
}

/** Alternativas de "Alinhar e conectar", sem as que violam "somente peças de catálogo". */
export function connectionPlanOf(
  state: Pick<PipeOperationState, 'project' | 'toolOptions'>,
  from: PortRef,
  to: PortRef,
): Result<ConnectionPlan> {
  const port = resolvePort(state.project, from);
  const planned = planConnection(state.project, {
    from,
    to,
    catalog: catalogOf(state.project, state.toolOptions.families),
    elbowAngles:
      port && state.toolOptions.lockElbowAngles
        ? elbowAnglesOf(state.project, port.spec, port.end)
        : undefined,
  });
  if (!planned.ok || !state.toolOptions.lockElbowAngles) return planned;
  const refusals = [...planned.value.refusals];
  const candidates = planned.value.candidates.filter((candidate) => {
    const problem = catalogViolation(state.project, candidate.project);
    if (problem && !refusals.includes(problem)) refusals.push(problem);
    return !problem;
  });
  return { ok: true, value: { ...planned.value, candidates, refusals } };
}

/** Alternativa escolhida no plano (a primeira, sem escolha). */
export function chosenCandidate(connect: ConnectState): ConnectionCandidate | null {
  const result = connect.plan?.result;
  if (!result?.ok) return null;
  return (
    result.value.candidates.find((candidate) => candidate.key === connect.choice) ??
    result.value.candidates[0] ??
    null
  );
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

  /**
   * Com "somente peças de catálogo", informa por que o resultado de uma operação não pode
   * ser aceito (criaria conexão de dimensões genéricas); `null` = pode ser aplicado.
   */
  /**
   * Tipo de válvula a inserir em uma tubulação: o escolhido na ferramenta ou, com "somente
   * peças de catálogo" e sem família desse tipo para a especificação do tubo, o primeiro
   * tipo que o catálogo oferece para ela (a mensagem de sucesso informa o ajuste).
   */
  function valveTypeFor(spec: PipeSpec): ValveType {
    const { project, toolOptions } = get();
    if (!toolOptions.lockElbowAngles || toolOptions.valveType === 'airRelease') {
      return toolOptions.valveType;
    }
    return catalogValveType(project, spec, toolOptions.valveType);
  }

  function catalogProblem(after: Project): string | null {
    const { project, toolOptions } = get();
    return toolOptions.lockElbowAngles ? catalogViolation(project, after) : null;
  }

  function fittingInput(kind: FittingKind, port: Port): Result<FittingInput> {
    const { toolOptions } = get();
    switch (kind) {
      case 'elbow':
        return success({
          kind,
          angle: degToRad(toolOptions.elbowAngleDeg),
          familyId: toolOptions.families.elbow,
        });
      case 'tee':
      case 'cross': {
        const familyId = toolOptions.families[kind];
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
          valveType: valveTypeFor(port.spec),
          familyId: toolOptions.families.valve,
        });
      case 'pump': {
        // Acoplada a uma extremidade: a sucção tem de ter o diâmetro dessa extremidade.
        const placement = pumpPlacementOf(get().project, toolOptions.pump, port.spec);
        if (!placement.ok) return placement;
        if (placement.value.spec.dn !== port.spec.dn) {
          return {
            ok: false,
            error: {
              code: 'PUMP_SUCTION_MISMATCH',
              message: `A sucção (A) deste modelo é ${placement.value.spec.sizeLabel} e a extremidade é ${port.spec.sizeLabel}: use uma redução ou escolha outro modelo.`,
            },
          };
        }
        return success(placement.value.fitting);
      }
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
    viewMode: '3d',
    bimHidden: [],
    bimClassFilter: null,
    annotationSelection: null,
    planDraft: EMPTY_DRAFT,
    dimensionMode: 'aligned',
    planThinLines: true,
    planTheme: 'color',
    tool: 'select',
    activeSpec: defaultPipeSpec('mep'),
    toolOptions: {
      tank: { familyId: null, variantId: null, custom: {} },
      pump: { familyId: null, variantId: null, custom: {}, dischargeDn: null },
      pipeEnds: { configuration: 'plainPlain', familyId: null },
      elbowAngleDeg: 90,
      valveType: catalogValveType(initialProject, defaultPipeSpec('mep'), 'gate'),
      reducerDn: null,
      teeBranchDn: null,
      junction: 'auto',
      sizeMode: 'reducers',
      families: {},
      lockElbowAngles: true,
      terrainCover: { enabled: false, cover: 0.8 },
      terrainPlacement: { enabled: true, offset: 0 },
      // O terreno acabado: depois da terraplenagem é nele que a rede e os equipamentos assentam.
      groundSurface: 'design',
    },
    workPlaneZ: 0,
    pipeElevation: 0,
    gridStep: 0.1,
    snapToGrid: true,
    orthographic: false,
    anchor: null,
    connect: EMPTY_CONNECT,
    junctionPreview: null,
    measure: { a: null, b: null },
    cursor: null,
    stretch: null,
    inlineSlide: null,
    move: null,
    rotate: null,
    align: null,
    alignFreePoint: false,
    contextMenu: null,
    message: null,
    viewRequest: null,
    renderOrigin: NO_RENDER_ORIGIN,
    projectDialogRequest: null,
    geoPicker: false,
    customBasemap: loadCustomSource(),

    notify: (level, text) => set({ message: { level, text, at: Date.now() } }),
    applyOperation: (result, successMessage) => commit(result, successMessage),

    loadProject: (project, options) => {
      // Outro projeto: o ponto de interesse anterior não vale mais.
      clearViewFocus();
      set((state) => ({
        project,
        renderOrigin: NO_RENDER_ORIGIN,
        geoPicker: false,
        savedProject: project,
        persisted: options?.saved ?? false,
        message: null,
        past: [],
        future: [],
        selection: [],
        bimHidden: [],
        bimClassFilter: null,
        annotationSelection: null,
        planDraft: EMPTY_DRAFT,
        anchor: null,
        stretch: null,
        inlineSlide: null,
        move: null,
        rotate: null,
        align: null,
        connect: EMPTY_CONNECT,
        junctionPreview: null,
        contextMenu: null,
        measure: { a: null, b: null },
        tool: 'select',
        activeSpec: defaultPipeSpec(project.discipline),
        toolOptions: {
          ...state.toolOptions,
          valveType: catalogValveType(
            project,
            defaultPipeSpec(project.discipline),
            state.toolOptions.valveType,
          ),
        },
        gridStep: gridStepFor(project.discipline),
        workPlaneZ: 0,
        pipeElevation: 0,
        viewRequest: { preset: 'fit', nonce: (state.viewRequest?.nonce ?? 0) + 1 },
      }));
    },

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
              : discipline === 'architecture'
                ? 'Ambiente Arquitetura: paredes, pisos, esquadrias e ambientes. O projeto, as coordenadas e os elementos são os mesmos.'
                : 'Ambiente MEP: especificação e grade ajustadas para instalações prediais.',
          at: Date.now(),
        },
      });
    },

    // As ferramentas de documentação só existem na planta; as de modelagem funcionam nas
    // duas vistas e mantêm a que estiver aberta.
    setTool: (tool) =>
      set((state) => {
        // A aba BIM / IFC é de consulta e cadastro: modelar leva de volta ao modelo 3D.
        const viewMode: ViewMode = isAnnotationTool(tool)
          ? 'plan'
          : state.viewMode === 'bim' && tool !== 'select'
            ? '3d'
            : state.viewMode;
        return {
          tool,
          anchor: null,
          connect: EMPTY_CONNECT,
          move: null,
          rotate: null,
          align: null,
          contextMenu: null,
          measure: { a: null, b: null },
          planDraft: EMPTY_DRAFT,
          viewMode,
          ...(viewMode === state.viewMode
            ? {}
            : { viewRequest: { preset: 'fit', nonce: (state.viewRequest?.nonce ?? 0) + 1 } }),
        };
      }),

    setViewMode: (mode) =>
      set((state) => {
        if (mode === state.viewMode) return {};
        // Entre a planta e o modelo 3D a operação continua: ferramenta de modelagem, trecho
        // em andamento e medição são os mesmos, e cada vista retoma o ponto de interesse da
        // outra (sem reenquadrar). A aba BIM / IFC é de consulta: entra e sai em Selecionar.
        const modeling = mode !== 'bim' && state.viewMode !== 'bim';
        const keepTool = modeling && !isAnnotationTool(state.tool);
        return {
          viewMode: mode,
          tool: keepTool ? state.tool : 'select',
          anchor: keepTool ? state.anchor : null,
          measure: keepTool ? state.measure : { a: null, b: null },
          planDraft: EMPTY_DRAFT,
          cursor: null,
          ...(modeling
            ? {}
            : { viewRequest: { preset: 'fit', nonce: (state.viewRequest?.nonce ?? 0) + 1 } }),
        };
      }),

    setBimHidden: (ids, hidden) =>
      set((state) => {
        const target = new Set(ids);
        return {
          bimHidden: hidden
            ? [...new Set([...state.bimHidden, ...ids])]
            : state.bimHidden.filter((id) => !target.has(id)),
        };
      }),
    isolateBim: (ids) =>
      set((state) => {
        const keep = new Set(ids);
        return {
          bimHidden: state.project.elements.map((e) => e.id).filter((id) => !keep.has(id)),
        };
      }),
    showAllBim: () => set({ bimHidden: [], bimClassFilter: null }),
    setBimClassFilter: (entity) => set({ bimClassFilter: entity }),
    setIfcValue: (elementId, scope, key, value) => {
      const { project } = get();
      return commit(
        applyIfcValue(project, { elementId, scope }, key, value, ifcOptionsOf(project).families),
      );
    },

    selectAnnotation: (id) =>
      set((state) => ({ annotationSelection: id, selection: id ? [] : state.selection })),
    setPlanDraft: (draft) => set({ planDraft: draft }),
    setDimensionMode: (mode) => set({ dimensionMode: mode }),
    setPlanThinLines: (enabled) => set({ planThinLines: enabled }),
    setPlanTheme: (theme) => set({ planTheme: theme }),

    createAnnotation: (input) => {
      const result = addAnnotation(get().project, input);
      if (!result.ok) {
        get().notify('error', result.error.message);
        return null;
      }
      commit(success(result.value.project));
      set({
        annotationSelection: result.value.annotationId,
        selection: [],
        planDraft: EMPTY_DRAFT,
      });
      return result.value.annotationId;
    },
    changeAnnotation: (id, patch) => commit(updateAnnotation(get().project, id, patch)),
    changeDrawingScale: (scale) => {
      commit(setDrawingScale(get().project, scale));
    },
    changeInfraSettings: (patch) => {
      commit(setInfraSettings(get().project, patch));
    },
    setCustomBasemap: (source) => {
      storeCustomSource(source);
      set({ customBasemap: source });
    },
    setGeoPicker: (open) =>
      set((state) => ({ geoPicker: open, viewMode: open ? 'plan' : state.viewMode })),
    openProjectDialog: (tab) =>
      set((state) => ({
        projectDialogRequest: { tab, nonce: (state.projectDialogRequest?.nonce ?? 0) + 1 },
      })),
    rebaseRenderOrigin: (focus) => {
      const current = get().renderOrigin;
      const next = nextRenderOrigin(current, focus);
      if (next !== current) set({ renderOrigin: next });
    },

    select: (id, additive = false) =>
      set((state) => {
        if (id === null) return additive ? {} : { selection: [], annotationSelection: null };
        // Tubos ligados direto uns aos outros, sem peça entre eles, são selecionados como um
        // tubo só. Um trecho isolado é escolhido no painel de propriedades (`selectMany`).
        const run = pipeRunOf(state.project, id);
        const ids = run.length > 0 ? run : [id];
        if (!additive) return { selection: ids, annotationSelection: null };
        return {
          annotationSelection: null,
          selection: state.selection.includes(id)
            ? state.selection.filter((s) => !ids.includes(s))
            : [...state.selection, ...ids.filter((s) => !state.selection.includes(s))],
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
    setPipeElevation: (elevation) => {
      if (!Number.isFinite(elevation)) return;
      const state = get();
      const { anchor } = state;
      const z = state.workPlaneZ + elevation;
      if (state.tool !== 'pipe' || !anchor || Math.abs(anchor.point.z - z) < MIN_PIPE_LENGTH) {
        set({ pipeElevation: roundElevation(elevation) });
        return;
      }
      // Trecho em andamento: a mudança de elevação é a prumada, no ponto atual. Se ela não
      // puder ser criada, a elevação permanece a do ponto de partida.
      state.commitPoint(vec3(anchor.point.x, anchor.point.y, z));
    },
    setGridStep: (step) => {
      if (Number.isFinite(step) && step > 0) set({ gridStep: step });
    },
    setSnapToGrid: (enabled) => set({ snapToGrid: enabled }),
    // Trocar a projeção não reenquadra: a câmera nova assume o mesmo ponto de interesse.
    setOrthographic: (enabled) => set({ orthographic: enabled }),
    setCursor: (cursor) => set({ cursor }),

    requestView: (preset, options) =>
      set((state) => ({
        // "Perspectiva" é um comando próprio: sai da projeção ortográfica.
        ...(preset === 'iso' ? { orthographic: false } : {}),
        viewRequest: {
          preset,
          nonce: (state.viewRequest?.nonce ?? 0) + 1,
          ...(options?.selection ? { selection: true } : {}),
        },
      })),

    requestIsometric: () =>
      set((state) => {
        const preset = nextIsoQuadrant(state.orthographic ? state.viewRequest?.preset : null);
        return {
          orthographic: true,
          viewRequest: { preset, nonce: (state.viewRequest?.nonce ?? 0) + 1 },
          message: {
            level: 'info',
            text: `Isométrica ortográfica — observador a ${ISO_LABELS[preset]}. Repita o comando para girar ao próximo quadrante.`,
            at: Date.now(),
          },
        };
      }),

    cancelInteraction: () => {
      const { anchor, measure, tool, planDraft, stretch, contextMenu } = get();
      if (contextMenu) set({ contextMenu: null });
      else if (stretch) get().endStretch(false);
      else if (get().inlineSlide) get().endInlineSlide(false);
      else if (planDraft.points.length > 0 || planDraft.elementId) set({ planDraft: EMPTY_DRAFT });
      else if (get().junctionPreview) set({ junctionPreview: null });
      else if (get().connect.from) set({ connect: EMPTY_CONNECT });
      else if (get().align?.source1) {
        // Cada Esc desfaz o último ponto indicado; sem pontos, o seguinte encerra o alinhar.
        const align = get().align;
        if (align) {
          set({
            align: align.source2
              ? { ...align, source2: null }
              : align.target1
                ? { ...align, target1: null }
                : { ...align, source1: null },
          });
        }
      } else if ((get().rotate?.reference ?? null) !== null) {
        // Primeiro Esc: volta a pedir o raio inicial; o segundo encerra o girar.
        const rotation = get().rotate;
        if (rotation) set({ rotate: { ...rotation, reference: null } });
      } else if (get().move?.from) {
        // Primeiro Esc: volta a pedir o ponto-base; o segundo encerra o mover.
        const move = get().move;
        if (move) set({ move: { ...move, from: null } });
      } else if (anchor || measure.a) set({ anchor: null, measure: { a: null, b: null } });
      else if (tool !== 'select') set({ tool: 'select', move: null, rotate: null, align: null });
      else set({ selection: [], annotationSelection: null });
    },

    handleViewportClick: (click) => {
      const state = get();
      const { tool, project } = state;
      const port = click.port ? resolvePort(project, click.port) : undefined;

      // Ferramentas de documentação são tratadas pela planta baixa.
      if (isAnnotationTool(tool)) return;
      if (tool === 'select') {
        state.select(click.hit?.elementId ?? null, click.additive);
        return;
      }
      if (tool === 'connect') {
        if (port && isPortFree(project, port.ref)) state.pickConnectPort(port.ref);
        else {
          state.notify(
            'info',
            state.connect.from
              ? 'Indique a porta de referência (bocal do equipamento ou porta de outro elemento), nos marcadores ciano.'
              : 'Indique a extremidade livre do trecho a ligar (marcadores ciano).',
          );
        }
        return;
      }
      if (tool === 'rotate') {
        if (click.point) state.commitPoint(click.point);
        return;
      }
      if (tool === 'align') {
        if (!click.point) return;
        const align = state.align;
        // O destino 1 segue a mesma regra da prévia (`alignTargetOf`); os demais pontos valem
        // como capturados (do ponto 2 só a direção em planta importa).
        const snap = click.port ? 'port' : (state.cursor?.snap ?? null);
        state.commitPoint(
          align?.source1 && !align.target1
            ? alignTargetOf(align.source1, click.point, snap)
            : click.point,
        );
        return;
      }
      if (tool === 'move') {
        if (!click.point) return;
        const from = state.move?.from;
        // O clique segue a mesma regra da prévia (`moveTargetOf`); coordenadas digitadas
        // entram por `commitPoint` e valem como informadas.
        const snap = click.port ? 'port' : (state.cursor?.snap ?? null);
        state.commitPoint(from ? moveTargetOf(from, click.point, snap) : click.point);
        return;
      }
      // Tê ou cruzeta existentes como início ou fim do trecho: o ramal usa a porta livre
      // voltada para ele (no lado oposto à derivação de um tê, com a conversão em cruzeta).
      const junction = click.hit ? getElement(project, click.hit.elementId) : undefined;
      if (
        tool === 'pipe' &&
        !click.port &&
        (junction?.kind === 'tee' || junction?.kind === 'cross')
      ) {
        if (state.anchor) {
          state.finishPipeOnJunction(junction.id);
          return;
        }
        set({
          anchor: {
            point: junction.placement.position,
            port: null,
            lockAxis: null,
            pipeId: null,
            junctionId: junction.id,
          },
          pipeElevation: roundElevation(junction.placement.position.z - state.workPlaneZ),
        });
        return;
      }
      if (tool === 'pipe' || tool === 'measure') {
        // Terminar o trecho sobre um tubo existente insere o tê, em vez de sobrepor os tubos.
        if (!click.port && click.hit && pipeJunctionOf(state, click.hit.elementId)) {
          state.finishPipeOnPipe(click.hit.elementId);
          return;
        }
        // Começar sobre um tubo existente: o tê entra ali quando o lado for indicado.
        const start = click.port ? null : pipeStartOf(state, click.hit);
        if (start && click.hit) {
          set({
            anchor: { point: start, port: null, lockAxis: null, pipeId: click.hit.elementId },
            pipeElevation: roundElevation(start.z - state.workPlaneZ),
          });
          return;
        }
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

      if (tool === 'align') {
        const align = state.align;
        if (!align) return;
        const step = alignStepOf(align);
        if (step === 'target2') {
          state.applyAlign(point);
          return;
        }
        const next: AlignState =
          step === 'source1'
            ? { ...align, source1: point }
            : step === 'target1'
              ? { ...align, target1: point }
              : { ...align, source2: point };
        set({
          align: next,
          message: {
            level: 'info',
            text:
              step === 'source1'
                ? 'Indique o 1º ponto de destino (para onde vai o 1º ponto de origem).'
                : step === 'target1'
                  ? 'Indique o 2º ponto de origem (define a direção a alinhar) ou "Aplicar só o 1º par" para apenas deslocar.'
                  : 'Indique o 2º ponto de destino: a direção origem 1 → 2 passa a apontar para ele. Esc: desfaz o último ponto.',
            at: Date.now(),
          },
        });
        return;
      }

      if (tool === 'rotate') {
        const rotation = state.rotate;
        if (!rotation) return;
        if (!rotation.center) {
          state.setRotateCenter(point);
          return;
        }
        if (rotation.reference === null) {
          const reference = rotationAngleOf(rotation.center, point, 0);
          if (reference === null) {
            state.notify('info', 'Indique o raio inicial afastado do centro de giro.');
            return;
          }
          set({
            rotate: { ...rotation, reference },
            message: {
              level: 'info',
              text: `Indique o raio final (de ${formatDegrees(rotateStepOf())} em ${formatDegrees(rotateStepOf())}) ou digite o ângulo. Esc: outro raio inicial.`,
              at: Date.now(),
            },
          });
          return;
        }
        const angle = rotationSweepOf(rotation.center, rotation.reference, point, rotateStepOf());
        if (angle === null) {
          state.notify('info', 'Indique o raio final afastado do centro de giro.');
          return;
        }
        state.applyRotation(angle);
        return;
      }

      if (tool === 'move') {
        const { move } = state;
        if (!move) return;
        if (!move.from) {
          set({
            move: { ...move, from: point },
            message: {
              level: 'info',
              text: 'Indique o destino do ponto-base (clique ou coordenadas). Esc: escolher outro ponto-base.',
              at: Date.now(),
            },
          });
          return;
        }
        const result = planMove(project, move, point);
        if (!result) {
          state.notify('info', 'O destino coincide com o ponto-base: nada a mover.');
          return;
        }
        const delta = sub(point, move.from);
        const moved = moveIdsOf(project, move);
        // Recusado (ex.: os tubos ligados não absorvem o deslocamento): o mover continua,
        // para outro destino ou com "levar a rede ligada".
        if (
          commit(
            result,
            `${moved.length === 1 ? `"${getElement(project, moved[0] ?? '')?.name ?? ''}" movido` : `${moved.length} elementos movidos`}: ΔX ${formatMeters(delta.x, 3)}, ΔY ${formatMeters(delta.y, 3)}, ΔZ ${formatMeters(delta.z, 3)}.`,
          )
        ) {
          set({ tool: 'select', move: null, selection: [...move.ids] });
        }
        return;
      }

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
        // Bomba de catálogo: as bocas usam a especificação ativa, nos diâmetros do modelo.
        const pump =
          tool === 'pump'
            ? pumpPlacementOf(project, state.toolOptions.pump, state.activeSpec)
            : null;
        if (pump && !pump.ok) {
          state.notify('error', pump.error.message);
          return;
        }
        const fitting = pump?.ok
          ? success(pump.value.fitting)
          : tankFittingInput(project, state.toolOptions.tank);
        if (!fitting.ok) {
          state.notify('error', fitting.error.message);
          return;
        }
        // Sobre o terreno, a cota vem da superfície no ponto clicado (nas duas vistas).
        const ground = equipmentGroundElevation(state, point.x, point.y);
        const seated = state.toolOptions.terrainPlacement.enabled && project.terrain !== null;
        const result = placeEquipment(project, {
          fitting: fitting.value,
          spec: pump?.ok ? pump.value.spec : state.activeSpec,
          position: ground === null ? point : vec3(point.x, point.y, ground),
        });
        if (!result.ok) {
          state.notify('error', result.error.message);
          return;
        }
        commit(
          success(result.value.project),
          ground !== null
            ? `${elementKindLabel(tool)} posicionado(a) sobre o ${placementGroundLabel(state)}, na cota ${formatMeters(ground, 3)}.`
            : seated
              ? `${elementKindLabel(tool)} posicionado(a) fora da superfície do ${placementGroundLabel(state)}: usada a cota do plano de trabalho (${formatMeters(point.z, 3)}).`
              : `${elementKindLabel(tool)} posicionado(a).`,
        );
        set({ selection: [result.value.elementId] });
        return;
      }
      if (tool !== 'pipe') return;

      const port =
        (portRef ? resolvePort(project, portRef) : undefined) ?? findPortAt(project, point);
      const freePort = port && isPortFree(project, port.ref) ? port : null;

      if (!state.anchor) {
        const anchor: DrawAnchor = freePort
          ? anchorFromPort(project, freePort)
          : { point, port: null, lockAxis: null, pipeId: null };
        // O trecho segue na cota do ponto de partida (elevação herdada).
        set({ anchor, pipeElevation: roundElevation(anchor.point.z - state.workPlaneZ) });
        return;
      }

      const origin = state.anchor.port ? resolvePort(project, state.anchor.port) : undefined;
      const source = state.anchor.pipeId ? getElement(project, state.anchor.pipeId) : undefined;
      const junction = state.anchor.junctionId
        ? getElement(project, state.anchor.junctionId)
        : undefined;
      const result = pipeSegmentOperation(state, point);
      if (!result.ok) {
        state.notify('error', result.error.message);
        return;
      }
      // Desvio admitido sem peça neste vértice (junta ou curvatura a frio do tubo).
      const allowance =
        origin && !source
          ? deflectionAllowance(origin, {
              spec: origin.spec,
              end: null,
              run: distance(state.anchor.point, point),
            })
          : null;
      const problem = catalogProblem(result.value.project);
      if (problem) {
        state.notify(
          'error',
          allowance && allowance.limit > 0
            ? `${problem} Sem peça, ${describeAllowance(allowance)}.`
            : problem,
        );
        return;
      }
      const created = result.value;
      const withElbow = created.createdIds.length > 1;
      // Sem joelho e fora do eixo da porta: a mudança de direção ficou na junta.
      const turn =
        origin && !source && !withElbow
          ? angleBetween(origin.direction, sub(point, state.anchor.point))
          : 0;

      const deflected =
        allowance && turn > ANGLE_TOLERANCE
          ? `Tubo criado com ${
              allowance.kind === 'bend' ? 'curvatura a frio' : 'deflexão'
            } de ${formatDegrees(turn, 2)} ${
              allowance.kind === 'bend' ? 'no vértice' : 'na junta'
            } (admitida: ${formatDegrees(allowance.limit, 2)}).`
          : null;
      const converted =
        junction?.kind === 'tee' && getElement(created.project, junction.id)?.kind === 'cross';
      commit(
        success(created.project),
        junction
          ? converted
            ? `"${junction.name}" convertido em cruzeta (mesmo elemento); o ramal sai da quarta porta.`
            : `Ramal criado a partir de "${junction.name}".`
          : source
            ? `Tubo derivado de "${source.name}" com ${junctionLabel(state.toolOptions.junction)} automático(a); o tubo foi dividido em dois trechos.`
            : withElbow
              ? 'Tubo criado com joelho automático.'
              : (deflected ?? 'Tubo criado.'),
      );
      // Continua a polilinha a partir da extremidade final, se ela permanecer livre.
      const next = resolvePort(created.project, { elementId: created.elementId, portId: 'end' });
      set({
        selection: [created.elementId],
        anchor:
          next && isPortFree(created.project, next.ref)
            ? anchorFromPort(created.project, next)
            : null,
        // Partindo de um tubo, o ponto final é o projetado na perpendicular, não o indicado.
        pipeElevation: roundElevation((next?.position.z ?? point.z) - state.workPlaneZ),
      });
    },

    finishPipeOnPipe: (pipeId) => {
      const state = get();
      if (!state.anchor || !getElement(state.project, pipeId)) return;
      const result = pipeTargetOperation(state, pipeId);
      if (!result.ok) {
        state.notify('error', result.error.message);
        return;
      }
      const problem = catalogProblem(result.value.project);
      if (problem) {
        state.notify('error', problem);
        return;
      }
      commit(success(result.value.project), result.value.message);
      // O trecho termina acoplado à derivação: a polilinha se encerra.
      set({ selection: [result.value.elementId], anchor: null });
    },

    finishPipeOnJunction: (junctionId) => get().finishPipeOnPipe(junctionId),

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
      const { toolOptions } = get();
      if (kind === 'elbow' && toolOptions.lockElbowAngles) {
        const angles = elbowAnglesOf(project, port.spec, port.end);
        const angle = degToRad(toolOptions.elbowAngleDeg);
        if (angles.length > 0 && matchElbowAngle(angles, angle) === null) {
          get().notify(
            'error',
            `Não há joelho de ${formatDegrees(angle, 2)} no catálogo para ${port.spec.sizeLabel}. Ângulos disponíveis: ${formatAngleList(angles)}.`,
          );
          return;
        }
      }
      const result = attachFitting(project, { target, fitting: input.value, catalog: catalog() });
      if (!result.ok) {
        get().notify('error', result.error.message);
        return;
      }
      const problem = catalogProblem(result.value.project);
      if (problem) {
        get().notify('error', problem);
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
            ? {
                kind,
                valveType: pipe ? valveTypeFor(pipe.spec) : toolOptions.valveType,
                familyId: toolOptions.families.valve,
              }
            : { kind, familyId: toolOptions.families.tee, ...(branchSpec ? { branchSpec } : {}) },
        catalog: catalog(),
      });
      if (!result.ok) {
        get().notify('error', result.error.message);
        return;
      }
      const problem = catalogProblem(result.value.project);
      if (problem) {
        get().notify('error', problem);
        return;
      }
      const adjusted =
        kind === 'valve' && pipe && valveTypeFor(pipe.spec) !== toolOptions.valveType
          ? ` O tipo escolhido não existe no catálogo de ${pipe.spec.standard}: foi usado o tipo disponível.`
          : '';
      commit(
        success(result.value.project),
        `${elementKindLabel(kind)} inserido(a) em linha; o tubo foi dividido em dois trechos.${adjusted}`,
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
        const problem = catalogProblem(result.value.project);
        if (problem) {
          get().notify('error', problem);
          return;
        }
        const { createdIds, removedIds, stubIds } = result.value;
        const details = [
          createdIds.length > 0 ? `${createdIds.length} redução(ões) inserida(s)` : '',
          stubIds.length > 0 ? `${stubIds.length} toco(s) de tubo entre bolsas` : '',
          removedIds.length > 0 ? `${removedIds.length} redução(ões) removida(s)` : '',
        ].filter(Boolean);
        commit(
          success(result.value.project),
          `Diâmetro alterado para ${spec.sizeLabel}${details.length ? ` — ${details.join(', ')}` : ''}.`,
        );
        return;
      }
      const applied = applySpec(project, elementId, spec, {
        propagate: true,
        portId,
        catalog: catalog(),
      });
      // Trocar para uma especificação sem as mesmas peças tornaria as conexões genéricas.
      const problem = applied.ok ? catalogProblem(applied.value) : null;
      if (problem) {
        get().notify('error', problem);
        return;
      }
      commit(applied, `Especificação alterada para ${spec.sizeLabel} em todo o trecho conectado.`);
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
    changePipeEnds: (pipeId, configuration, familyId) => {
      const { project } = get();
      const pipe = getElement(project, pipeId);
      if (!pipe || pipe.kind !== 'pipe') return;
      const input = pipeEndsInputOf({ configuration, familyId }, pipe.spec);
      if (configuration !== 'plainPlain' && !input) {
        get().notify(
          'error',
          `Não há flange tabulado para ${pipe.spec.sizeLabel} nas famílias de tubos com flanges desta especificação.`,
        );
        return;
      }
      commit(
        setPipeEnds(project, pipeId, input ?? { start: null, end: null, familyId: null }),
        'Extremidades do tubo alteradas.',
      );
    },
    changeElevation: (elementId, elevation) => {
      commit(setElementElevation(get().project, elementId, elevation), 'Elevação alterada.');
    },
    duplicateTankFamily: (family) => {
      const result = duplicateTankFamily(get().project, family);
      if (!result.ok) {
        get().notify('error', result.error.message);
        return null;
      }
      commit(
        success(result.value.project),
        `Família "${family.name}" duplicada: a tabela da cópia pode ser editada.`,
      );
      return result.value.familyId;
    },
    saveTankFamily: (family, applyToInstances) => {
      const saved = upsertTankFamily(get().project, family);
      if (!saved.ok) {
        get().notify('error', saved.error.message);
        return false;
      }
      if (!applyToInstances) {
        return commit(saved, `Família "${family.name}" salva no projeto.`);
      }
      const applied = applyTankFamilyToInstances(saved.value, family);
      if (!applied.ok) {
        get().notify('error', `Família não aplicada: ${applied.error.message}`);
        return false;
      }
      return commit(
        success(applied.value.project),
        `Família "${family.name}" salva e aplicada a ${applied.value.updated} reservatório(s) do projeto.`,
      );
    },
    deleteTankFamily: (familyId) => {
      commit(removeTankFamily(get().project, familyId), 'Família de reservatórios excluída.');
    },
    changeTankModel: (elementId, familyId, selection) => {
      const family = tankFamilyOf(get().project, familyId);
      if (!family) {
        get().notify('error', 'Família de reservatório inexistente no catálogo.');
        return;
      }
      const parameters = tankParametersFromFamily(family, selection);
      if (!parameters.ok) {
        get().notify('error', parameters.error.message);
        return;
      }
      commit(
        setTankModel(get().project, elementId, parameters.value),
        `Reservatório alterado para "${parameters.value.manufacturing.model ?? family.name}".`,
      );
    },
    changeTankSettings: (elementId, patch) => {
      commit(updateTankSettings(get().project, elementId, patch));
    },
    duplicatePumpFamily: (family) => {
      const result = duplicatePumpFamily(get().project, family);
      if (!result.ok) {
        get().notify('error', result.error.message);
        return null;
      }
      commit(
        success(result.value.project),
        `Família "${family.name}" duplicada: a tabela da cópia pode ser editada.`,
      );
      return result.value.familyId;
    },
    savePumpFamily: (family, applyToInstances) => {
      const saved = upsertPumpFamily(get().project, family);
      if (!saved.ok) {
        get().notify('error', saved.error.message);
        return false;
      }
      if (!applyToInstances) {
        return commit(saved, `Família "${family.name}" salva no projeto.`);
      }
      const applied = applyPumpFamilyToInstances(saved.value, family, resolvePumpMouth);
      if (!applied.ok) {
        get().notify('error', `Família não aplicada: ${applied.error.message}`);
        return false;
      }
      return commit(
        success(applied.value.project),
        `Família "${family.name}" salva e aplicada a ${applied.value.updated} bomba(s) do projeto.`,
      );
    },
    deletePumpFamily: (familyId) => {
      commit(removePumpFamily(get().project, familyId), 'Família de bombas excluída.');
    },
    changePumpFlange: (elementId, portId, pressureClass) => {
      const { project } = get();
      const pump = getElement(project, elementId);
      if (pump?.kind !== 'pump') return;
      const spec = portId === 'a' ? pump.spec : pump.dischargeSpec;
      commit(
        setPumpFlange(
          project,
          elementId,
          portId,
          pressureClass,
          flangeForClass(spec, pressureClass) ?? null,
        ),
        `Flange ${portId === 'a' ? 'de sucção (A)' : 'de descarga (B)'}: ${pressureClass}.`,
      );
    },
    addTankNozzle: (elementId, role) => {
      const { project, activeSpec } = get();
      const tank = getElement(project, elementId);
      if (tank?.kind !== 'tank') return;
      // Posição inicial: extravasor e entrada junto ao topo; descarga e saída junto ao fundo.
      const layout = tankLayout(tank);
      const high = role === 'overflow' || role === 'inlet';
      const span = layout.top - layout.shellBottom;
      const height = high
        ? layout.top - Math.min(0.3, span / 4)
        : layout.shellBottom + Math.min(0.2, span / 4);
      const result = addTankNozzle(project, elementId, {
        role,
        height,
        azimuth: -Math.PI / 2,
        spec: activeSpec,
      });
      if (!result.ok) {
        get().notify('error', result.error.message);
        return;
      }
      commit(success(result.value.project), 'Bocal acrescentado; ajuste a altura e a direção.');
    },
    changeTankNozzle: (elementId, nozzleId, patch) => {
      commit(updateTankNozzle(get().project, elementId, nozzleId, patch));
    },
    removeTankNozzle: (elementId, nozzleId) => {
      commit(removeTankNozzle(get().project, elementId, nozzleId), 'Bocal removido.');
    },
    changeFitting: (elementId, patch) => {
      const { project, toolOptions } = get();
      const element = getElement(project, elementId);
      // Alterar o ângulo de um joelho segue a mesma trava do traçado: só ângulos com peça.
      if (patch.angle !== undefined && element?.kind === 'elbow' && toolOptions.lockElbowAngles) {
        const angles = elbowAnglesOf(project, element.spec, ...Object.values(element.ends));
        if (matchElbowAngle(angles, patch.angle) === null) {
          get().notify(
            'error',
            angles.length > 0
              ? `Não há joelho de ${formatDegrees(patch.angle, 2)} no catálogo para ${element.spec.sizeLabel}. Ângulos disponíveis: ${formatAngleList(angles)}.`
              : `Não há joelho de catálogo para ${element.spec.standard}, ${element.spec.sizeLabel}.`,
          );
          return;
        }
        // Outro ângulo de catálogo: a peça assume as dimensões e o vínculo da família.
        const { angle, ...rest } = patch;
        const relinked = setElbowCatalogAngle(
          project,
          elementId,
          angle,
          catalog(),
          toolOptions.families.elbow,
        );
        if (!relinked.ok || Object.keys(rest).length === 0) {
          commit(relinked);
          return;
        }
      }
      const result = updateFitting(project, elementId, patch);
      const problem = result.ok ? catalogProblem(result.value) : null;
      if (problem) {
        get().notify('error', problem);
        return;
      }
      commit(result);
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
      const { project, selection, annotationSelection } = get();
      if (annotationSelection) {
        commit(success(deleteAnnotations(project, [annotationSelection])), 'Anotação excluída.');
        set({ annotationSelection: null });
        return;
      }
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

    startMove: (ids) => {
      const { project, selection } = get();
      const targets = (ids ?? selection).filter((id) => getElement(project, id));
      if (targets.length === 0) {
        get().notify('info', 'Selecione um ou mais elementos para mover.');
        return;
      }
      get().setTool('move');
      set({
        move: { ids: targets, from: null, withConnected: false },
        selection: targets,
        annotationSelection: null,
        contextMenu: null,
        message: {
          level: 'info',
          text: 'Mover: indique o ponto-base (uma porta ou um ponto) e, em seguida, o destino.',
          at: Date.now(),
        },
      });
    },

    setMoveWithConnected: (enabled) => {
      const { move } = get();
      if (move) set({ move: { ...move, withConnected: enabled } });
    },

    startRotate: (ids) => {
      const { project, selection } = get();
      const targets = (ids ?? selection).filter((id) => getElement(project, id));
      if (targets.length === 0) {
        get().notify('info', 'Selecione um ou mais elementos para girar.');
        return;
      }
      get().setTool('rotate');
      set({
        rotate: {
          ids: targets,
          center: selectionCenterOf(project, targets),
          reference: null,
          withConnected: true,
          copy: false,
        },
        selection: targets,
        annotationSelection: null,
        contextMenu: null,
        message: {
          level: 'info',
          text: 'Girar: o centro está no meio da seleção (ou escolha outro). Indique o raio inicial e o final, ou digite o ângulo.',
          at: Date.now(),
        },
      });
    },

    setRotateCenter: (center) => {
      const { rotate: rotation } = get();
      if (!rotation) return;
      if (center && !Number.isFinite(center.x + center.y + center.z)) return;
      set({
        rotate: { ...rotation, center, reference: null },
        message: {
          level: 'info' as const,
          text: center
            ? 'Indique o raio inicial e, depois, o final, ou digite o ângulo.'
            : 'Indique o novo centro de giro.',
          at: Date.now(),
        },
      });
    },

    setRotateWithConnected: (enabled) => {
      const { rotate: rotation } = get();
      if (rotation) set({ rotate: { ...rotation, withConnected: enabled } });
    },

    setRotateCopy: (enabled) => {
      const { rotate: rotation } = get();
      if (rotation) set({ rotate: { ...rotation, copy: enabled } });
    },

    rotateSelectionQuarter: () => {
      const { project, selection, tool } = get();
      if (tool !== 'select' || selection.length === 0) return false;
      const rotation: RotateState = {
        ids: selection,
        center: selectionCenterOf(project, selection),
        reference: null,
        withConnected: true,
        copy: false,
      };
      const result = planRotate(project, rotation, Math.PI / 2);
      if (!result) return false;
      const count = moveIdsOf(project, rotation).length;
      return commit(
        result,
        count === 1
          ? `"${getElement(project, selection[0] ?? '')?.name ?? ''}" girado 90°.`
          : `${count} elementos girados 90° (rede ligada junto).`,
      );
    },

    applyRotation: (angle) => {
      const { project, rotate: rotation } = get();
      if (!rotation?.center) {
        get().notify('info', 'Indique primeiro o centro de giro.');
        return false;
      }
      const result = planRotate(project, rotation, angle);
      if (!result) return false;
      if (result.ok && result.value === project) {
        get().notify('info', 'Giro nulo: nada a alterar.');
        return false;
      }
      const ids = moveIdsOf(project, rotation);
      const degrees = formatDegrees(angle);
      const done = commit(
        result,
        rotation.copy
          ? `${ids.length} elemento(s) copiado(s) e girado(s) ${degrees}.`
          : ids.length === 1
            ? `"${getElement(project, ids[0] ?? '')?.name ?? ''}" girado ${degrees}.`
            : `${ids.length} elementos girados ${degrees} (tubos, conexões e acessórios ligados juntos).`,
      );
      // Recusado: o girar continua, para outro ângulo ou com a rede ligada. Na cópia, as
      // peças novas ficam selecionadas.
      if (done) {
        const known = new Set(project.elements.map((element) => element.id));
        const created = get()
          .project.elements.filter((element) => !known.has(element.id))
          .map((element) => element.id);
        set({
          tool: 'select',
          rotate: null,
          selection: rotation.copy ? created : [...rotation.ids],
        });
      }
      return done;
    },

    startAlign: (ids) => {
      const { project, selection } = get();
      const targets = (ids ?? selection).filter((id) => getElement(project, id));
      if (targets.length === 0) {
        get().notify('info', 'Selecione um ou mais elementos para alinhar.');
        return;
      }
      get().setTool('align');
      set({
        align: {
          ids: targets,
          source1: null,
          target1: null,
          source2: null,
          withConnected: true,
          copy: false,
        },
        selection: targets,
        annotationSelection: null,
        contextMenu: null,
        message: {
          level: 'info',
          text: 'Alinhar: indique o 1º ponto de origem (uma porta ou um ponto do elemento), depois o destino dele; em seguida o 2º par.',
          at: Date.now(),
        },
      });
    },

    setAlignWithConnected: (enabled) => {
      const { align } = get();
      if (align) set({ align: { ...align, withConnected: enabled } });
    },

    setAlignCopy: (enabled) => {
      const { align } = get();
      if (align) set({ align: { ...align, copy: enabled } });
    },

    setAlignFreePoint: (enabled) => set({ alignFreePoint: enabled }),

    applyAlign: (target2) => {
      const { project, align } = get();
      if (!align?.source1 || !align.target1) {
        get().notify('info', 'Indique primeiro o 1º ponto de origem e o seu destino.');
        return false;
      }
      // Sem destino 2, aplica só o primeiro par (desloca), como o Enter do ALIGN do AutoCAD.
      const applied: AlignState = target2 ? align : { ...align, source2: null };
      const ids = moveIdsOf(project, applied);
      const result = planAlign(project, applied, ids, target2);
      if (!result) return false;
      if (result.ok && result.value === project) {
        get().notify('info', 'Os pontos de origem já estão nos destinos: nada a alterar.');
        return false;
      }
      const angle = alignAngleOf(applied, target2) ?? 0;
      const turn = Math.abs(angle) > 1e-9 ? ` e girados ${formatDegrees(angle)}` : '';
      const done = commit(
        result,
        applied.copy
          ? `${ids.length} elemento(s) copiado(s) e alinhado(s)${turn}.`
          : ids.length === 1
            ? `"${getElement(project, ids[0] ?? '')?.name ?? ''}" alinhado${turn}.`
            : `${ids.length} elementos alinhados${turn}.`,
      );
      if (done) {
        const known = new Set(project.elements.map((element) => element.id));
        const created = get()
          .project.elements.filter((element) => !known.has(element.id))
          .map((element) => element.id);
        set({ tool: 'select', align: null, selection: applied.copy ? created : [...align.ids] });
      }
      return done;
    },

    nudgeSelection: (preferences, step) => {
      const { project, selection } = get();
      const primary = selection[0];
      if (!primary || !Number.isFinite(step) || step <= 0) return;
      const direction = chooseSlideDirection(slideAxesOf(project, primary), preferences);
      if (!direction) return;
      const element = getElement(project, primary);
      commit(
        slideElements(project, selection, scale(direction, step)),
        selection.length === 1 && element
          ? `"${element.name}" deslocado ${formatMeters(step, 3)} ao longo da linha.`
          : `${selection.length} elementos deslocados ${formatMeters(step, 3)} ao longo da linha.`,
      );
    },

    beginStretch: (pipeId, which) => {
      const { project } = get();
      const pipe = getElement(project, pipeId);
      if (pipe?.kind !== 'pipe') return;
      set({ stretch: { pipeId, which, base: project }, contextMenu: null });
    },

    stretchTo: (point) => {
      const state = get();
      const { stretch } = state;
      const pipe = stretch ? getElement(stretch.base, stretch.pipeId) : undefined;
      if (!stretch || pipe?.kind !== 'pipe') return;
      const settings = precision();
      const raw = stretchLengthAt(pipe, stretch.which, point);
      // Com a precisão ligada, o comprimento anda pelo passo (5 cm em 5 cm, por padrão);
      // sem ela, a extremidade segue a grade.
      const length = settings.enabled
        ? Math.round(raw / settings.lengthStep) * settings.lengthStep
        : snapStretchLength(pipe, stretch.which, raw, state.snapToGrid ? state.gridStep : 0);
      // Aquém da extremidade oposta não há tubo: a prévia permanece como está.
      if (length < MIN_PIPE_LENGTH) return;
      // Cada prévia parte do projeto do início do arrasto; o histórico só é registrado no fim.
      const result = stretchPipe(stretch.base, stretch.pipeId, stretch.which, length);
      if (!result.ok) {
        if (state.message?.text !== result.error.message) {
          state.notify('error', result.error.message);
        }
        return;
      }
      if (result.value !== state.project) set({ project: result.value });
    },

    endStretch: (apply) => {
      const { stretch, project, past } = get();
      if (!stretch) return;
      if (!apply || project === stretch.base) {
        set({ stretch: null, project: stretch.base });
        return;
      }
      const pipe = getElement(project, stretch.pipeId);
      set({
        stretch: null,
        past: [...past, stretch.base].slice(-HISTORY_LIMIT),
        future: [],
        message: {
          level: 'success',
          text:
            pipe?.kind === 'pipe'
              ? `Comprimento de "${pipe.name}": ${formatMeters(distance(pipe.start, pipe.end), 3)}.`
              : 'Comprimento alterado.',
          at: Date.now(),
        },
      });
    },

    beginInlineSlide: (elementId, grab) => {
      const { project } = get();
      const element = getElement(project, elementId);
      if (!element || element.kind === 'pipe') return;
      set({ inlineSlide: { elementId, grab, base: project }, contextMenu: null });
    },

    inlineSlideTo: (point) => {
      const state = get();
      const { inlineSlide } = state;
      if (!inlineSlide) return;
      const target = inlineSlideTarget(
        inlineSlide.base,
        inlineSlide.elementId,
        inlineSlide.grab,
        point,
        state.snapToGrid ? state.gridStep : 0,
      );
      if (!target) return;
      // Cada prévia parte do projeto do início do arrasto; o histórico só é registrado no fim.
      const result = setInlineClearance(
        inlineSlide.base,
        inlineSlide.elementId,
        target.portId,
        target.value,
      );
      if (!result.ok) {
        if (state.message?.text !== result.error.message) {
          state.notify('error', result.error.message);
        }
        return;
      }
      if (result.value !== state.project) set({ project: result.value });
    },

    endInlineSlide: (apply) => {
      const { inlineSlide, project, past } = get();
      if (!inlineSlide) return;
      if (!apply || project === inlineSlide.base) {
        set({ inlineSlide: null, project: inlineSlide.base });
        return;
      }
      const element = getElement(project, inlineSlide.elementId);
      const sides = inlineClearancesOf(project, inlineSlide.elementId)
        .filter((c) => c.pipeIds.length > 0)
        .map((c) => formatMeters(c.length, 3))
        .join(' | ');
      set({
        inlineSlide: null,
        past: [...past, inlineSlide.base].slice(-HISTORY_LIMIT),
        future: [],
        message: {
          level: 'success',
          text: `"${element?.name ?? ''}" reposicionado na linha${sides ? `: ${sides}` : ''}.`,
          at: Date.now(),
        },
      });
    },

    setInlineClearanceOf: (elementId, portId, value) => {
      const { project } = get();
      const element = getElement(project, elementId);
      commit(
        setInlineClearance(project, elementId, portId, value),
        `"${element?.name ?? ''}" a ${formatMeters(value, 3)} do elemento vizinho.`,
      );
    },

    openContextMenu: (menu) => set({ contextMenu: menu }),
    closeContextMenu: () => {
      if (get().contextMenu) set({ contextMenu: null });
    },

    startPipeFromPort: (ref) => {
      const { project } = get();
      const port = resolvePort(project, ref);
      const host = getElement(project, ref.elementId);
      if (!port || !host || !isPortFree(project, ref)) {
        get().notify('error', 'Esta extremidade já está conectada: não há de onde partir o tubo.');
        return;
      }
      get().setTool('pipe');
      const anchor = anchorFromPort(project, port);
      set((state) => ({
        anchor,
        selection: [],
        annotationSelection: null,
        // O trecho segue na cota do ponto de partida (elevação herdada).
        pipeElevation: roundElevation(anchor.point.z - state.workPlaneZ),
        message: {
          level: 'info',
          text: `Tubo a partir de "${host.name}" (${port.spec.sizeLabel}): indique o próximo ponto.`,
          at: Date.now(),
        },
      }));
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

    closeFreeEnds: (a, b, angle) => {
      const { project, toolOptions } = get();
      const port = resolvePort(project, a);
      const result = closePorts(project, {
        a,
        b,
        catalog: catalog(),
        elbowAngles:
          port && toolOptions.lockElbowAngles
            ? elbowAnglesOf(project, port.spec, port.end)
            : undefined,
        ...(angle === null ? {} : { offsetAngle: angle }),
      });
      if (!result.ok) {
        get().notify('error', result.error.message);
        return false;
      }
      const problem = catalogProblem(result.value.project);
      if (problem) {
        get().notify('error', problem);
        return false;
      }
      commit(success(result.value.project), `Extremidades ligadas: ${result.value.summary}.`);
      set({ selection: [...result.value.createdIds] });
      return true;
    },

    pickConnectPort: (ref) => {
      const state = get();
      const { connect, project } = state;
      // Sem partida (ou recomeçando depois de uma escolha completa), a porta é a partida.
      if (!connect.from || connect.to) {
        set({ connect: { ...EMPTY_CONNECT, from: ref } });
        return;
      }
      if (connect.from.elementId === ref.elementId) {
        state.notify('info', 'A porta de referência deve ser de outro elemento.');
        return;
      }
      const result = connectionPlanOf(state, connect.from, ref);
      set({
        connect: { from: connect.from, to: ref, choice: null, plan: { base: project, result } },
      });
      if (!result.ok) state.notify('error', result.error.message);
      else if (!result.value.candidates.some((candidate) => candidate.connects)) {
        state.notify(
          'error',
          `Não há montagem possível: ${result.value.refusals[0] ?? 'sem peças compatíveis.'}`,
        );
      }
    },

    setConnectChoice: (key) => set((state) => ({ connect: { ...state.connect, choice: key } })),

    confirmConnection: () => {
      const state = get();
      const { connect, project } = state;
      const candidate = chosenCandidate(connect);
      // A prévia foi calculada sobre este projeto: grava-se exatamente o que foi mostrado.
      if (!candidate || connect.plan?.base !== project) {
        state.notify('error', 'Escolha novamente a extremidade e a porta: o projeto mudou.');
        set({ connect: EMPTY_CONNECT });
        return false;
      }
      commit(
        success(candidate.project),
        `${candidate.label}${candidate.connects ? '' : ' (sem ligação)'}: ${candidate.summary}.`,
      );
      set({
        connect: EMPTY_CONNECT,
        selection:
          candidate.createdIds.length > 0
            ? [...candidate.createdIds]
            : [connect.from?.elementId ?? ''].filter(Boolean),
      });
      return true;
    },

    resetConnection: () => set({ connect: EMPTY_CONNECT }),

    previewJunction: (elementId, familyId) => {
      const { project, toolOptions } = get();
      const element = getElement(project, elementId);
      if (!element || (element.kind !== 'tee' && element.kind !== 'cross')) return;
      const input = {
        catalog: catalogOf(project, toolOptions.families),
        familyId,
        allowGeneric: !toolOptions.lockElbowAngles,
      };
      const result =
        element.kind === 'tee'
          ? convertTeeToCross(project, elementId, input)
          : convertCrossToTee(project, elementId, input);
      set({
        junctionPreview: {
          elementId,
          target: element.kind === 'tee' ? 'cross' : 'tee',
          familyId,
          base: project,
          result,
        },
      });
    },

    confirmJunction: () => {
      const state = get();
      const preview = state.junctionPreview;
      if (!preview) return false;
      if (preview.base !== state.project) {
        state.notify('error', 'O projeto mudou desde a prévia: gere a prévia novamente.');
        set({ junctionPreview: null });
        return false;
      }
      if (!preview.result.ok) {
        state.notify('error', preview.result.error.message);
        return false;
      }
      const notes = preview.result.value.notes;
      const ok = commit(
        success(preview.result.value.project),
        `${preview.target === 'cross' ? 'Tê convertido em cruzeta' : 'Cruzeta convertida em tê'} (mesmo elemento, ligações mantidas).${notes.length ? ` ${notes.join(' ')}` : ''}`,
      );
      set({ junctionPreview: null });
      return ok;
    },

    cancelJunction: () => set({ junctionPreview: null }),

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
      // Desfazer no meio de um arrasto de alça abandona o arrasto.
      get().endStretch(false);
      get().endInlineSlide(false);
      const { past, future, project } = get();
      const previous = past[past.length - 1];
      if (!previous) return;
      set({
        project: previous,
        past: past.slice(0, -1),
        future: [project, ...future],
        anchor: null,
        connect: EMPTY_CONNECT,
        junctionPreview: null,
        annotationSelection: null,
        planDraft: EMPTY_DRAFT,
      });
    },

    redo: () => {
      const { past, future, project } = get();
      const next = future[0];
      if (!next) return;
      set({
        project: next,
        past: [...past, project],
        future: future.slice(1),
        anchor: null,
        connect: EMPTY_CONNECT,
        junctionPreview: null,
        annotationSelection: null,
        planDraft: EMPTY_DRAFT,
      });
    },
  };
});

/** Há alterações desde o carregamento ou o último salvamento. */
export const selectIsDirty = (state: EditorState): boolean => state.savedProject !== state.project;

/** Elemento principal da seleção (para o painel de propriedades). */
export const selectPrimaryId = (state: EditorState): string | null => state.selection[0] ?? null;
