import { dimensionGeometry } from './annotations';
import { archViewCategoryOf, computeArchBounds } from './architecture/derive';
import { computeBounds } from './bounds';
import { newId } from './ids';
import { now } from './internal';
import { add, dot, scale, sub, vec3, type Vec3 } from './math';
import { fail, ok, type Result } from './result';
import {
  defaultArchCutHeight,
  ProjectViewSchema,
  ViewDetailSchema,
  type ArchElement,
  type ElevationDirection,
  type HydroElement,
  type ModelProjectView,
  type PlanProjectView,
  type Point2,
  type Project,
  type ProjectView,
  type ProjectView2d,
  type ProjectViewKind,
  type SectionBox,
  type SectionProjectView,
  type ElevationProjectView,
  type ViewCamera,
  type ViewCategory,
  type ViewDetail,
  type ViewVisibility,
} from './schema';

/**
 * Vistas de projeto: plantas por nível, cortes, elevações e vistas 3D.
 *
 * Uma vista é só uma forma de MOSTRAR o modelo: posição do observador, faixa ou caixa de
 * corte, recorte, escala, visibilidade e estilo. Nenhuma operação daqui altera elementos ou
 * conexões — cortar uma vista não corta um tubo. Os detalhes 2D pertencem à vista em que
 * foram desenhados e ficam nas coordenadas dela.
 */

/** Menor extensão aceita para linhas de corte, recortes e caixas (m). */
export const MIN_VIEW_EXTENT = 0.01;

export const VIEW_KIND_LABELS: Record<ProjectViewKind, string> = {
  plan: 'Planta',
  section: 'Corte',
  elevation: 'Elevação',
  '3d': 'Vista 3D',
};

export const ELEVATION_LABELS: Record<ElevationDirection, string> = {
  north: 'Norte',
  south: 'Sul',
  east: 'Leste',
  west: 'Oeste',
};

const CATEGORY_OF: Record<HydroElement['kind'], ViewCategory> = {
  pipe: 'pipes',
  elbow: 'fittings',
  tee: 'fittings',
  cross: 'fittings',
  reducer: 'fittings',
  valve: 'valves',
  pump: 'equipment',
  tank: 'tanks',
};

export const viewCategoryOf = (element: HydroElement): ViewCategory => CATEGORY_OF[element.kind];

export const isView2d = (view: ProjectView): view is ProjectView2d => view.kind !== '3d';

export function getView(project: Project, id: string | null | undefined): ProjectView | undefined {
  return id ? project.views.find((view) => view.id === id) : undefined;
}

/**
 * Elementos que a vista mostra: os visíveis no projeto (sistema à mostra), menos os sistemas
 * e as categorias que a própria vista oculta.
 */
export function viewElementsOf(project: Project, view: ProjectView): HydroElement[] {
  const hiddenSystems = new Set([
    ...project.systems.filter((system) => system.visible === false).map((system) => system.id),
    ...view.visibility.hiddenSystemIds,
  ]);
  const hiddenCategories = new Set(view.visibility.hiddenCategories);
  return project.elements.filter(
    (element) =>
      !hiddenSystems.has(element.systemId) && !hiddenCategories.has(viewCategoryOf(element)),
  );
}

/**
 * Elementos de arquitetura que a vista mostra: todos, menos as categorias que a vista oculta
 * (paredes, pisos, portas, janelas, ambientes). Não pertencem a sistemas hidráulicos.
 */
export function viewArchElementsOf(project: Project, view: ProjectView): ArchElement[] {
  const hidden = new Set(view.visibility.hiddenCategories);
  if (hidden.size === 0) return project.architecture.elements;
  return project.architecture.elements.filter(
    (element) => !hidden.has(archViewCategoryOf(element)),
  );
}

// ---------------------------------------------------------------------------
// Referencial das vistas 2D
// ---------------------------------------------------------------------------

/**
 * Referencial de uma vista 2D: `u` aponta para a direita do desenho, `v` para cima e `w` para
 * o observador. As coordenadas da vista são (p − origin)·u e (p − origin)·v, em metros.
 */
export interface ViewFrame {
  readonly origin: Vec3;
  readonly u: Vec3;
  readonly v: Vec3;
  readonly w: Vec3;
}

/** Semiespaço de corte: fica o que satisfaz (p − point)·normal ≥ 0. */
export interface ViewClipPlane {
  readonly point: Vec3;
  readonly normal: Vec3;
}

const ELEVATION_LOOK: Record<ElevationDirection, Vec3> = {
  // Direção do olhar: da fachada indicada para dentro do modelo.
  south: vec3(0, 1, 0),
  north: vec3(0, -1, 0),
  west: vec3(1, 0, 0),
  east: vec3(-1, 0, 0),
};

/** Direção horizontal do olhar de um corte (unitária). */
export function sectionLookOf(view: Pick<SectionProjectView, 'a' | 'b' | 'side'>): Vec3 {
  const dx = view.b.x - view.a.x;
  const dy = view.b.y - view.a.y;
  const size = Math.hypot(dx, dy) || 1;
  // Normal à esquerda de a→b, com o sinal do lado escolhido.
  return vec3((-dy / size) * view.side, (dx / size) * view.side, 0);
}

export const sectionLengthOf = (view: Pick<SectionProjectView, 'a' | 'b'>): number =>
  Math.hypot(view.b.x - view.a.x, view.b.y - view.a.y);

/** Referencial com o olhar horizontal `look`: direita = look × Z, para cima = Z. */
function uprightFrame(origin: Vec3, look: Vec3): ViewFrame {
  return { origin, u: vec3(look.y, -look.x, 0), v: vec3(0, 0, 1), w: scale(look, -1) };
}

export function viewFrameOf(view: ProjectView2d): ViewFrame {
  if (view.kind === 'plan') {
    const cos = Math.cos(view.rotation);
    const sin = Math.sin(view.rotation);
    return { origin: vec3(0, 0, 0), u: vec3(cos, sin, 0), v: vec3(-sin, cos, 0), w: vec3(0, 0, 1) };
  }
  if (view.kind === 'elevation') return uprightFrame(vec3(0, 0, 0), ELEVATION_LOOK[view.direction]);
  const look = sectionLookOf(view);
  const u = vec3(look.y, -look.x, 0);
  const a = vec3(view.a.x, view.a.y, 0);
  const b = vec3(view.b.x, view.b.y, 0);
  // A origem é a ponta da linha mais à esquerda do desenho: a linha ocupa x de 0 a L.
  return uprightFrame(dot(a, u) <= dot(b, u) ? a : b, look);
}

export function toViewPoint(frame: ViewFrame, point: Vec3): Point2 {
  const d = sub(point, frame.origin);
  return { x: dot(d, frame.u), y: dot(d, frame.v) };
}

/** Distância do ponto ao plano da vista, positiva para o lado do observador. */
export const viewDepthOf = (frame: ViewFrame, point: Vec3): number =>
  dot(sub(point, frame.origin), frame.w);

export function fromViewPoint(frame: ViewFrame, point: Point2, depth = 0): Vec3 {
  return add(
    frame.origin,
    add(add(scale(frame.u, point.x), scale(frame.v, point.y)), scale(frame.w, depth)),
  );
}

/** Cotas do plano de corte e do fundo da faixa de uma planta (nível ausente = cota 0). */
export function planRangeOf(
  project: Pick<Project, 'levels'>,
  view: Pick<PlanProjectView, 'levelId' | 'cutHeight' | 'depth'>,
): { top: number; bottom: number } {
  const elevation = project.levels.find((level) => level.id === view.levelId)?.elevation ?? 0;
  const top = elevation + view.cutHeight;
  return { top, bottom: top - view.depth };
}

/**
 * Cota do plano em que a planta corta a arquitetura (nível + `archCutHeight`), nunca acima
 * do topo da faixa da vista.
 */
export function planArchCutOf(
  project: Pick<Project, 'levels'>,
  view: Pick<PlanProjectView, 'levelId' | 'cutHeight' | 'depth' | 'archCutHeight'>,
): number {
  const { top, bottom } = planRangeOf(project, view);
  const elevation = project.levels.find((level) => level.id === view.levelId)?.elevation ?? 0;
  return Math.max(bottom, Math.min(top, elevation + view.archCutHeight));
}

/**
 * Planos de corte da ARQUITETURA na vista: como os da rede, mas a planta corta no plano da
 * arquitetura (o primeiro plano devolvido é sempre o de corte — o da seção hachurada).
 */
export function viewArchClipPlanesOf(
  project: Pick<Project, 'levels'>,
  view: ProjectView2d,
): ViewClipPlane[] {
  if (view.kind !== 'plan') return viewClipPlanesOf(project, view);
  const { bottom } = planRangeOf(project, view);
  return [
    { point: vec3(0, 0, planArchCutOf(project, view)), normal: vec3(0, 0, -1) },
    { point: vec3(0, 0, bottom), normal: vec3(0, 0, 1) },
  ];
}

/**
 * Planos que delimitam o que a vista mostra: a faixa de corte da planta; no corte, o plano da
 * linha, o alcance (`depth`) e as duas pontas da linha. A elevação não corta nada.
 */
export function viewClipPlanesOf(
  project: Pick<Project, 'levels'>,
  view: ProjectView2d,
): ViewClipPlane[] {
  if (view.kind === 'plan') {
    const { top, bottom } = planRangeOf(project, view);
    return [
      { point: vec3(0, 0, top), normal: vec3(0, 0, -1) },
      { point: vec3(0, 0, bottom), normal: vec3(0, 0, 1) },
    ];
  }
  if (view.kind === 'elevation') return [];
  const frame = viewFrameOf(view);
  const look = scale(frame.w, -1);
  return [
    { point: frame.origin, normal: look },
    { point: add(frame.origin, scale(look, view.depth)), normal: scale(look, -1) },
    { point: frame.origin, normal: frame.u },
    { point: add(frame.origin, scale(frame.u, sectionLengthOf(view))), normal: scale(frame.u, -1) },
  ];
}

/**
 * Lado e alcance de um corte a partir de um terceiro ponto em planta: o lado em que o ponto
 * está em relação à linha a→b e a distância dele até ela.
 */
export function sectionFromPoints(
  a: Point2,
  b: Point2,
  sidePoint: Point2,
): { side: 1 | -1; depth: number } {
  const turn = (b.x - a.x) * (sidePoint.y - a.y) - (b.y - a.y) * (sidePoint.x - a.x);
  const size = Math.hypot(b.x - a.x, b.y - a.y);
  return { side: turn >= 0 ? 1 : -1, depth: size > 0 ? Math.abs(turn) / size : 0 };
}

/** Caixa de corte inicial: a envoltória dos elementos com folga (ou um cubo junto à origem). */
export function defaultSectionBox(
  project: Pick<Project, 'elements'> & Partial<Pick<Project, 'levels' | 'architecture'>>,
): SectionBox {
  const network = computeBounds(project.elements);
  const arch =
    project.levels && project.architecture
      ? computeArchBounds({ levels: project.levels, architecture: project.architecture })
      : null;
  const bounds =
    network && arch
      ? {
          min: vec3(
            Math.min(network.min.x, arch.min.x),
            Math.min(network.min.y, arch.min.y),
            Math.min(network.min.z, arch.min.z),
          ),
          max: vec3(
            Math.max(network.max.x, arch.max.x),
            Math.max(network.max.y, arch.max.y),
            Math.max(network.max.z, arch.max.z),
          ),
        }
      : (network ?? arch);
  if (!bounds) return { enabled: true, min: vec3(-5, -5, -1), max: vec3(5, 5, 3) };
  const pad = 0.5;
  return {
    enabled: true,
    min: vec3(bounds.min.x - pad, bounds.min.y - pad, bounds.min.z - pad),
    max: vec3(bounds.max.x + pad, bounds.max.y + pad, bounds.max.z + pad),
  };
}

// ---------------------------------------------------------------------------
// Criar, alterar, duplicar, ordenar e excluir vistas
// ---------------------------------------------------------------------------

export const DEFAULT_VIEW_VISIBILITY: ViewVisibility = {
  hiddenSystemIds: [],
  hiddenCategories: [],
  details: true,
};

const sameName = (a: string, b: string): boolean =>
  a.trim().toLocaleLowerCase('pt-BR') === b.trim().toLocaleLowerCase('pt-BR');

/** Nome livre a partir de `base`: "Corte 1", "Corte 2"… ou "Planta — Térreo (2)". */
export function uniqueViewName(
  project: Pick<Project, 'views'>,
  base: string,
  numbered = false,
): string {
  const taken = (name: string): boolean => project.views.some((view) => sameName(view.name, name));
  if (!numbered && !taken(base)) return base;
  for (let n = numbered ? 1 : 2; ; n += 1) {
    const name = numbered ? `${base} ${n}` : `${base} (${n})`;
    if (!taken(name)) return name;
  }
}

export type ViewInput =
  | { kind: 'plan'; levelId: string; name?: string }
  | { kind: 'section'; a: Point2; b: Point2; side: 1 | -1; depth: number; name?: string }
  | { kind: 'elevation'; direction: ElevationDirection; name?: string }
  | { kind: '3d'; camera?: ViewCamera | null; sectionBox?: SectionBox | null; name?: string };

const defaultScaleOf = (project: Project): number =>
  project.discipline === 'infra' ? project.infra.drawingScale : project.drawingScale;

function base2d(project: Project) {
  return {
    visibility: DEFAULT_VIEW_VISIBILITY,
    scale: defaultScaleOf(project),
    style: { theme: 'color' as const, thinLines: true },
    crop: null,
    frame: null,
    details: [],
  };
}

function check(project: Project, view: ProjectView): Result<ProjectView> {
  const named = { ...view, name: view.name.trim() };
  if (named.name.length === 0) {
    return fail('INVALID_VIEW_NAME', 'O nome da vista não pode ser vazio.');
  }
  if (project.views.some((other) => other.id !== view.id && sameName(other.name, named.name))) {
    return fail('VIEW_NAME_TAKEN', `Já existe uma vista chamada "${named.name}".`);
  }
  const parsed = ProjectViewSchema.safeParse(named);
  if (!parsed.success) {
    const where = parsed.error.issues[0]?.path.join('.') ?? '';
    return fail(
      'INVALID_VIEW',
      `Vista inválida${where ? ` em "${where}"` : ''}: confira os valores.`,
    );
  }
  const value = parsed.data;
  if (value.kind === 'plan' && !project.levels.some((level) => level.id === value.levelId)) {
    return fail('LEVEL_NOT_FOUND', 'A planta precisa de um nível existente.');
  }
  if (value.kind === 'section' && sectionLengthOf(value) < MIN_VIEW_EXTENT) {
    return fail('SECTION_TOO_SHORT', 'A linha de corte precisa de dois pontos distintos.');
  }
  if (value.kind !== '3d' && value.crop) {
    const { min, max } = value.crop;
    if (max.x - min.x < MIN_VIEW_EXTENT || max.y - min.y < MIN_VIEW_EXTENT) {
      return fail('INVALID_CROP', 'A região de recorte precisa ter largura e altura.');
    }
  }
  if (value.kind === '3d' && value.sectionBox) {
    const { min, max } = value.sectionBox;
    if (
      max.x - min.x < MIN_VIEW_EXTENT ||
      max.y - min.y < MIN_VIEW_EXTENT ||
      max.z - min.z < MIN_VIEW_EXTENT
    ) {
      return fail(
        'INVALID_SECTION_BOX',
        'A caixa de corte precisa de extensão nos três eixos (mínimo menor que o máximo).',
      );
    }
  }
  if (value.kind === '3d' && value.camera) {
    const { direction } = value.camera;
    if (Math.hypot(direction.x, direction.y, direction.z) < 1e-9) {
      return fail('INVALID_CAMERA', 'A câmera da vista não tem direção.');
    }
  }
  return ok(value);
}

export function addView(
  project: Project,
  input: ViewInput,
): Result<{ project: Project; viewId: string }> {
  const id = newId();
  let view: ProjectView;
  if (input.kind === 'plan') {
    const level = project.levels.find((entry) => entry.id === input.levelId);
    if (!level) return fail('LEVEL_NOT_FOUND', 'A planta precisa de um nível existente.');
    // Sem outro nível acima, adota-se um pé-direito de 3 m; a faixa vai até 30 cm abaixo do
    // nível, para não cortar ao meio o que está assentado na cota dele.
    const above = project.levels.find((entry) => entry.elevation > level.elevation + 1e-6);
    const cutHeight = above ? above.elevation - level.elevation : 3;
    view = {
      ...base2d(project),
      id,
      kind: 'plan',
      name: input.name ?? uniqueViewName(project, `Planta — ${level.name}`),
      levelId: level.id,
      cutHeight,
      depth: cutHeight + 0.3,
      archCutHeight: defaultArchCutHeight(cutHeight),
      rotation: 0,
    };
  } else if (input.kind === 'section') {
    view = {
      ...base2d(project),
      id,
      kind: 'section',
      name: input.name ?? uniqueViewName(project, 'Corte', true),
      a: input.a,
      b: input.b,
      side: input.side,
      depth: input.depth,
    };
  } else if (input.kind === 'elevation') {
    view = {
      ...base2d(project),
      id,
      kind: 'elevation',
      name: input.name ?? uniqueViewName(project, `Elevação ${ELEVATION_LABELS[input.direction]}`),
      direction: input.direction,
    };
  } else {
    view = {
      id,
      kind: '3d',
      name: input.name ?? uniqueViewName(project, 'Vista 3D', true),
      visibility: DEFAULT_VIEW_VISIBILITY,
      camera: input.camera ?? null,
      sectionBox: input.sectionBox ?? null,
      display: 'shaded',
    };
  }
  if (input.kind === 'section' && !(input.depth >= MIN_VIEW_EXTENT)) {
    return fail(
      'SECTION_NO_DEPTH',
      'Indique o lado do corte afastado da linha: a distância define a profundidade da vista.',
    );
  }
  const checked = check(project, view);
  if (!checked.ok) return checked;
  return ok({
    project: { ...project, updatedAt: now(), views: [...project.views, checked.value] },
    viewId: id,
  });
}

type Editable<T> = Partial<Omit<T, 'id' | 'kind' | 'details'>>;
/** Campos alteráveis de uma vista; os que não existem no tipo dela são recusados. */
export type ViewPatch = Editable<PlanProjectView> &
  Editable<SectionProjectView> &
  Editable<ElevationProjectView> &
  Editable<ModelProjectView>;

function replaceView(project: Project, view: ProjectView): Project {
  return {
    ...project,
    updatedAt: now(),
    views: project.views.map((other) => (other.id === view.id ? view : other)),
  };
}

export function updateView(project: Project, id: string, patch: ViewPatch): Result<Project> {
  const current = getView(project, id);
  if (!current) return fail('VIEW_NOT_FOUND', 'Vista inexistente.');
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  for (const [key] of entries) {
    if (!(key in current) || key === 'id' || key === 'kind' || key === 'details') {
      return fail(
        'INVALID_VIEW_PATCH',
        `"${key}" não se aplica a uma vista do tipo ${VIEW_KIND_LABELS[current.kind]}.`,
      );
    }
  }
  if (entries.length === 0) return ok(project);
  const checked = check(project, { ...current, ...Object.fromEntries(entries) } as ProjectView);
  if (!checked.ok) return checked;
  return ok(replaceView(project, checked.value));
}

export const renameView = (project: Project, id: string, name: string): Result<Project> =>
  updateView(project, id, { name });

/** Cópia independente da vista (com os detalhes), logo abaixo da original. */
export function duplicateView(
  project: Project,
  id: string,
): Result<{ project: Project; viewId: string }> {
  const index = project.views.findIndex((view) => view.id === id);
  const source = project.views[index];
  if (!source) return fail('VIEW_NOT_FOUND', 'Vista inexistente.');
  const viewId = newId();
  const name = uniqueViewName(project, `${source.name} — cópia`);
  const copy: ProjectView =
    source.kind === '3d'
      ? { ...source, id: viewId, name }
      : {
          ...source,
          id: viewId,
          name,
          details: source.details.map((detail) => ({ ...detail, id: newId() })),
        };
  const views = [...project.views];
  views.splice(index + 1, 0, copy);
  return ok({ project: { ...project, updatedAt: now(), views }, viewId });
}

export function deleteView(project: Project, id: string): Result<Project> {
  if (!getView(project, id)) return fail('VIEW_NOT_FOUND', 'Vista inexistente.');
  return ok({
    ...project,
    updatedAt: now(),
    views: project.views.filter((view) => view.id !== id),
  });
}

/**
 * Reordena a vista entre as do mesmo tipo (o navegador agrupa por tipo): `offset` −1 sobe uma
 * posição, +1 desce. Nos extremos nada muda.
 */
export function moveView(project: Project, id: string, offset: number): Result<Project> {
  const view = getView(project, id);
  if (!view) return fail('VIEW_NOT_FOUND', 'Vista inexistente.');
  const peers = project.views.filter((other) => other.kind === view.kind);
  const from = peers.indexOf(view);
  const to = Math.min(peers.length - 1, Math.max(0, from + Math.trunc(offset)));
  if (to === from) return ok(project);
  const reordered = [...peers];
  reordered.splice(from, 1);
  reordered.splice(to, 0, view);
  // As vistas do tipo ocupam as mesmas posições de antes, na nova ordem.
  let next = 0;
  const views = project.views.map((other) =>
    other.kind === view.kind ? (reordered[next++] ?? other) : other,
  );
  return ok({ ...project, updatedAt: now(), views });
}

// ---------------------------------------------------------------------------
// Detalhes 2D da vista
// ---------------------------------------------------------------------------

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
export type DetailInput = WithoutId<ViewDetail>;

export const DETAIL_KIND_LABELS: Record<ViewDetail['kind'], string> = {
  line: 'Linha',
  polyline: 'Polilinha',
  rect: 'Retângulo',
  circle: 'Círculo',
  text: 'Texto',
  dimension: 'Cota',
};

const moved = (p: Point2, delta: Point2): Point2 => ({ x: p.x + delta.x, y: p.y + delta.y });

/** O detalhe deslocado de `delta` (m, coordenadas da vista). */
export function translateDetail(detail: ViewDetail, delta: Point2): ViewDetail {
  switch (detail.kind) {
    case 'line':
    case 'rect':
    case 'dimension':
      return { ...detail, a: moved(detail.a, delta), b: moved(detail.b, delta) };
    case 'polyline':
      return { ...detail, points: detail.points.map((p) => moved(p, delta)) };
    case 'circle':
      return { ...detail, center: moved(detail.center, delta) };
    case 'text':
      return {
        ...detail,
        position: moved(detail.position, delta),
        ...(detail.leader ? { leader: moved(detail.leader, delta) } : {}),
      };
  }
}

/** Pontos notáveis do detalhe: vértices, cantos, centro e quadrantes (captura e enquadramento). */
export function detailPointsOf(detail: ViewDetail): Point2[] {
  switch (detail.kind) {
    case 'line':
      return [
        detail.a,
        detail.b,
        { x: (detail.a.x + detail.b.x) / 2, y: (detail.a.y + detail.b.y) / 2 },
      ];
    case 'polyline':
      return [...detail.points];
    case 'rect':
      return [
        detail.a,
        { x: detail.b.x, y: detail.a.y },
        detail.b,
        { x: detail.a.x, y: detail.b.y },
      ];
    case 'circle':
      return [
        detail.center,
        { x: detail.center.x + detail.radius, y: detail.center.y },
        { x: detail.center.x, y: detail.center.y + detail.radius },
        { x: detail.center.x - detail.radius, y: detail.center.y },
        { x: detail.center.x, y: detail.center.y - detail.radius },
      ];
    case 'text':
      return detail.leader ? [detail.position, detail.leader] : [detail.position];
    case 'dimension': {
      const g = dimensionGeometry(detail);
      return g ? [detail.a, detail.b, g.start, g.end] : [detail.a, detail.b];
    }
  }
}

function checkDetail(detail: ViewDetail): Result<ViewDetail> {
  const parsed = ViewDetailSchema.safeParse(detail);
  if (!parsed.success) {
    if (detail.kind === 'text' && detail.text.trim().length === 0) {
      return fail('EMPTY_TEXT', 'O texto não pode ser vazio.');
    }
    if (detail.kind === 'circle') return fail('CIRCLE_NO_RADIUS', 'O círculo precisa de raio.');
    return fail('INVALID_DETAIL', 'Detalhe inválido: verifique os valores informados.');
  }
  const value = parsed.data;
  const far = (a: Point2, b: Point2): boolean => Math.hypot(b.x - a.x, b.y - a.y) >= 1e-6;
  if (value.kind === 'line' && !far(value.a, value.b)) {
    return fail('DETAIL_ZERO', 'A linha precisa de dois pontos distintos.');
  }
  if (value.kind === 'polyline') {
    const points = value.points.filter((p, i, list) => i === 0 || far(list[i - 1] ?? p, p));
    if (points.length < 2) {
      return fail('DETAIL_ZERO', 'A polilinha precisa de ao menos dois pontos distintos.');
    }
    return ok({ ...value, points, closed: value.closed && points.length >= 3 });
  }
  if (
    value.kind === 'rect' &&
    (Math.abs(value.b.x - value.a.x) < 1e-6 || Math.abs(value.b.y - value.a.y) < 1e-6)
  ) {
    return fail('DETAIL_ZERO', 'O retângulo precisa de largura e altura.');
  }
  if (value.kind === 'text' && value.text.trim().length === 0) {
    return fail('EMPTY_TEXT', 'O texto não pode ser vazio.');
  }
  if (value.kind === 'dimension' && !dimensionGeometry(value)) {
    return fail(
      'DIMENSION_ZERO',
      'Os dois pontos da cota coincidem na direção cotada; escolha pontos distintos.',
    );
  }
  return ok(value);
}

function view2dOf(project: Project, viewId: string): Result<ProjectView2d> {
  const view = getView(project, viewId);
  if (!view) return fail('VIEW_NOT_FOUND', 'Vista inexistente.');
  if (!isView2d(view)) {
    return fail('VIEW_NOT_2D', 'Detalhes 2D são desenhados em plantas, cortes e elevações.');
  }
  return ok(view);
}

const withDetails = (project: Project, view: ProjectView2d, details: ViewDetail[]): Project =>
  replaceView(project, { ...view, details });

export function getViewDetail(
  project: Project,
  viewId: string,
  detailId: string,
): ViewDetail | undefined {
  const view = getView(project, viewId);
  return view && isView2d(view) ? view.details.find((d) => d.id === detailId) : undefined;
}

export function addViewDetail(
  project: Project,
  viewId: string,
  input: DetailInput,
): Result<{ project: Project; detailId: string }> {
  const view = view2dOf(project, viewId);
  if (!view.ok) return view;
  const checked = checkDetail({ ...input, id: newId() } as ViewDetail);
  if (!checked.ok) return checked;
  return ok({
    project: withDetails(project, view.value, [...view.value.details, checked.value]),
    detailId: checked.value.id,
  });
}

/** Campos alteráveis de um detalhe; `leader: null` remove a linha de chamada do texto. */
export type DetailPatch = {
  a?: Point2;
  b?: Point2;
  points?: Point2[];
  closed?: boolean;
  center?: Point2;
  radius?: number;
  position?: Point2;
  text?: string;
  rotation?: number;
  leader?: Point2 | null;
  offset?: number;
  mode?: 'aligned' | 'horizontal' | 'vertical';
};

export function updateViewDetail(
  project: Project,
  viewId: string,
  detailId: string,
  patch: DetailPatch,
): Result<Project> {
  const view = view2dOf(project, viewId);
  if (!view.ok) return view;
  const current = view.value.details.find((detail) => detail.id === detailId);
  if (!current) return fail('DETAIL_NOT_FOUND', 'Detalhe inexistente.');
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  for (const [key] of entries) {
    if (!(key in current) && !(key === 'leader' && current.kind === 'text')) {
      return fail(
        'INVALID_DETAIL_PATCH',
        `"${key}" não se aplica a ${DETAIL_KIND_LABELS[current.kind].toLowerCase()}.`,
      );
    }
  }
  const merged: Record<string, unknown> = { ...current, ...Object.fromEntries(entries) };
  if (merged.leader === null) delete merged.leader;
  const checked = checkDetail(merged as ViewDetail);
  if (!checked.ok) return checked;
  return ok(
    withDetails(
      project,
      view.value,
      view.value.details.map((detail) => (detail.id === detailId ? checked.value : detail)),
    ),
  );
}

export function moveViewDetails(
  project: Project,
  viewId: string,
  ids: readonly string[],
  delta: Point2,
): Result<Project> {
  const view = view2dOf(project, viewId);
  if (!view.ok) return view;
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    return fail('INVALID_VALUE', 'Deslocamento inválido.');
  }
  const chosen = new Set(ids);
  if (!view.value.details.some((detail) => chosen.has(detail.id))) {
    return fail('DETAIL_NOT_FOUND', 'Nenhum detalhe selecionado nesta vista.');
  }
  if (Math.hypot(delta.x, delta.y) < 1e-9) return ok(project);
  return ok(
    withDetails(
      project,
      view.value,
      view.value.details.map((detail) =>
        chosen.has(detail.id) ? translateDetail(detail, delta) : detail,
      ),
    ),
  );
}

/** Copia os detalhes, deslocados de `delta`, na mesma vista; devolve os novos identificadores. */
export function copyViewDetails(
  project: Project,
  viewId: string,
  ids: readonly string[],
  delta: Point2,
): Result<{ project: Project; detailIds: string[] }> {
  const view = view2dOf(project, viewId);
  if (!view.ok) return view;
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    return fail('INVALID_VALUE', 'Deslocamento inválido.');
  }
  const chosen = new Set(ids);
  const copies = view.value.details
    .filter((detail) => chosen.has(detail.id))
    .map((detail) => ({ ...translateDetail(detail, delta), id: newId() }));
  if (copies.length === 0) {
    return fail('DETAIL_NOT_FOUND', 'Nenhum detalhe selecionado nesta vista.');
  }
  return ok({
    project: withDetails(project, view.value, [...view.value.details, ...copies]),
    detailIds: copies.map((copy) => copy.id),
  });
}

export function deleteViewDetails(
  project: Project,
  viewId: string,
  ids: readonly string[],
): Result<Project> {
  const view = view2dOf(project, viewId);
  if (!view.ok) return view;
  const chosen = new Set(ids);
  if (!view.value.details.some((detail) => chosen.has(detail.id))) return ok(project);
  return ok(
    withDetails(
      project,
      view.value,
      view.value.details.filter((detail) => !chosen.has(detail.id)),
    ),
  );
}
