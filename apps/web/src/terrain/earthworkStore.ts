import {
  addPlatform,
  addTerrainPoint,
  designSurfaceFor,
  moveTerrainPoint,
  nearestTerrainPoint,
  originalTerrainOf,
  pointInRing,
  removePlatform,
  removeTerrainPoint,
  restoreOriginalTerrain,
  retriangulateTerrain,
  setEarthworkSettings,
  setTerrain,
  setTerrainBoundary,
  setTerrainPointElevation,
  setTerrainProperties,
  terrainElevationAt,
  updatePlatform,
  type Earthworks,
  type PlatformInput,
  type Point2,
  type Project,
  type Result,
  type Terrain,
} from '@hydrobim/core';
import { create } from 'zustand';
import { useArchStore } from '../arch/archStore';
import { useEditorStore } from '../state/editorStore';
import { registerTerrainEditHandlers, useTerrainStore, type TerrainMode } from './terrainStore';

/**
 * Edição do terreno e terraplenagem na interface: o que está aberto, escolhido e à mostra
 * (estado de sessão) e os casos de uso, que chamam as operações do núcleo e gravam o resultado
 * no projeto pela store do editor — com desfazer. Nenhuma regra de modelagem fica aqui.
 */

/** Abas do painel: as quatro ferramentas da faixa. */
export type EarthworkTab = 'edit' | 'platforms' | 'cutfill' | 'volumes';

/**
 * Superfície à mostra na planta e no 3D: o terreno projetado (com os platôs), o natural, a
 * comparação (projetado com o corte em vermelho e o aterro em azul) ou a superfície original,
 * de antes das edições de pontos e de limite.
 */
export type SurfaceView = 'design' | 'natural' | 'compare' | 'original';

export type EarthworkSelection =
  { readonly kind: 'surface' } | { readonly kind: 'platform'; readonly id: string } | null;

/** Parâmetros do próximo platô (texto dos campos; a cota começa vazia: é dado do projeto). */
export interface PlatformDraft {
  readonly elevation: number | null;
  readonly cutSlope: number;
  readonly fillSlope: number;
}

interface EarthworkState {
  tab: EarthworkTab | null;
  view: SurfaceView;
  selection: EarthworkSelection;
  /** Índice do ponto da superfície escolhido para edição. */
  pointIndex: number | null;
  /** Posição clicada para o novo ponto, à espera da cota. */
  pending: Point2 | null;
  draft: PlatformDraft;
  /** Platô cujo perímetro está sendo redesenhado; `null` = o desenho cria um platô novo. */
  redrawId: string | null;

  open: (tab: EarthworkTab) => void;
  close: () => void;
  setView: (view: SurfaceView) => void;
  select: (selection: EarthworkSelection) => void;
  setDraft: (patch: Partial<PlatformDraft>) => void;
  setPointIndex: (index: number | null) => void;
  clearPending: () => void;
  startPlatform: (redrawId?: string | null) => void;
}

const editor = () => useEditorStore.getState();
const terrainUi = () => useTerrainStore.getState();

/** Modos da planta que pertencem a este módulo. */
const OWN_MODES: readonly TerrainMode[] = [
  'point-add',
  'point-edit',
  'point-move',
  'boundary',
  'platform',
  'pick',
];

export const useEarthworkStore = create<EarthworkState>()((set, get) => ({
  tab: null,
  view: 'design',
  selection: null,
  pointIndex: null,
  pending: null,
  // Taludes iniciais usuais (1H:1V no corte, 1,5H:1V no aterro): só um ponto de partida — a
  // inclinação estável depende do solo e é definida pelo projetista.
  draft: { elevation: null, cutSlope: 1, fillSlope: 1.5 },
  redrawId: null,

  open: (tab) => {
    // Um painel por vez sobre a planta.
    if (terrainUi().panelOpen) useTerrainStore.setState({ panelOpen: false });
    // O painel fica sobre a planta, onde também se desenha e se escolhe.
    if (editor().viewMode !== 'plan') editor().setViewMode('plan');
    set({ tab });
    if (tab === 'cutfill' && get().view !== 'compare') set({ view: 'compare' });
    if (tab === 'edit' && !get().selection && editor().project.terrain) {
      get().select({ kind: 'surface' });
    }
  },
  close: () => {
    set({ tab: null, pending: null });
    const mode = terrainUi().mode;
    if (mode && OWN_MODES.includes(mode)) terrainUi().setMode(null);
  },
  setView: (view) => set({ view }),
  select: (selection) => {
    // As propriedades de um elemento e as do terreno ocupam o mesmo painel.
    if (selection && (editor().selection.length > 0 || editor().annotationSelection)) {
      editor().select(null);
    }
    // A seleção é exclusiva: a da arquitetura também é limpa.
    if (selection && useArchStore.getState().selection.length > 0) {
      useArchStore.getState().select(null);
    }
    set({ selection });
  },
  setDraft: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } })),
  setPointIndex: (pointIndex) => set({ pointIndex }),
  clearPending: () => set({ pending: null }),
  startPlatform: (redrawId = null) => {
    set({ redrawId });
    terrainUi().setMode('platform');
  },
}));

const earthwork = () => useEarthworkStore.getState();

// ---------------------------------------------------------------------------
// Superfície à mostra
// ---------------------------------------------------------------------------

const originals = new WeakMap<Terrain, Terrain | null>();

/** Superfície que a planta e o 3D desenham, conforme a vista escolhida; `null` sem terreno. */
export function shownTerrain(project: Project, view: SurfaceView): Terrain | null {
  return project.terrain ? shownSurface(project.terrain, project.earthworks.platforms, view) : null;
}

export function shownSurface(
  terrain: Terrain,
  platforms: Earthworks['platforms'],
  view: SurfaceView,
): Terrain {
  if (view === 'natural') return terrain;
  if (view === 'original') {
    if (!originals.has(terrain)) originals.set(terrain, originalTerrainOf(terrain));
    return originals.get(terrain) ?? terrain;
  }
  return designSurfaceFor(terrain, platforms).terrain;
}

export const SURFACE_VIEW_LABELS: Record<SurfaceView, string> = {
  design: 'Projetado',
  natural: 'Natural',
  compare: 'Comparação',
  original: 'Original',
};

// ---------------------------------------------------------------------------
// Edição da superfície
// ---------------------------------------------------------------------------

/** Grava a superfície editada no projeto; devolve se a operação foi aceita. */
function commitTerrain(result: Result<Terrain>, message: string): boolean {
  const { project, applyOperation } = editor();
  return applyOperation(
    result.ok ? { ok: true, value: setTerrain(project, result.value) } : result,
    message,
  );
}

function currentTerrain(): Terrain | null {
  const { terrain } = editor().project;
  if (!terrain) editor().notify('error', 'O projeto não tem superfície de terreno.');
  return terrain;
}

const coordinates = (p: Point2): string =>
  `X ${p.x.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}; Y ${p.y.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`;

export function addSurfacePoint(point: Point2, elevation: number): boolean {
  const terrain = currentTerrain();
  if (!terrain) return false;
  const done = commitTerrain(
    addTerrainPoint(terrain, { x: point.x, y: point.y, z: elevation }),
    `Ponto acrescentado ao terreno em ${coordinates(point)}.`,
  );
  if (done) useEarthworkStore.setState({ pending: null, pointIndex: null });
  return done;
}

/** Aplica ao ponto escolhido a nova posição e a nova cota (o que tiver mudado). */
export function updateSurfacePoint(next: { x: number; y: number; z: number }): boolean {
  const terrain = currentTerrain();
  const index = earthwork().pointIndex;
  const current = terrain && index !== null ? terrain.points[index] : undefined;
  if (!terrain || index === null || !current) return false;
  const moved = Math.abs(current.x - next.x) > 1e-9 || Math.abs(current.y - next.y) > 1e-9;
  const done = commitTerrain(
    moved
      ? moveTerrainPoint(terrain, index, next)
      : setTerrainPointElevation(terrain, index, next.z),
    moved ? `Ponto do terreno movido para ${coordinates(next)}.` : 'Cota do ponto alterada.',
  );
  if (done) {
    // A triangulação refeita pode reordenar os pontos: o escolhido é reencontrado pela posição.
    const updated = editor().project.terrain;
    useEarthworkStore.setState({
      pointIndex: updated ? nearestTerrainPoint(updated, next.x, next.y, 1e-3) : null,
    });
  }
  return done;
}

export function removeSurfacePoint(): boolean {
  const terrain = currentTerrain();
  const index = earthwork().pointIndex;
  if (!terrain || index === null) return false;
  const done = commitTerrain(removeTerrainPoint(terrain, index), 'Ponto excluído do terreno.');
  if (done) useEarthworkStore.setState({ pointIndex: null });
  return done;
}

export function retriangulateSurface(): boolean {
  const terrain = currentTerrain();
  if (!terrain) return false;
  const done = commitTerrain(retriangulateTerrain(terrain), 'Triangulação do terreno regenerada.');
  if (done) useEarthworkStore.setState({ pointIndex: null });
  return done;
}

export function restoreSurface(): boolean {
  const terrain = currentTerrain();
  if (!terrain) return false;
  const done = commitTerrain(
    restoreOriginalTerrain(terrain),
    'Superfície original restaurada: as edições de pontos e de limite foram descartadas.',
  );
  if (done) useEarthworkStore.setState({ pointIndex: null, view: 'design' });
  return done;
}

export function renameSurface(patch: {
  name?: string;
  tag?: string;
  verticalAccuracy?: number | null;
}): boolean {
  const terrain = currentTerrain();
  if (!terrain) return false;
  return commitTerrain(setTerrainProperties(terrain, patch), 'Propriedades do terreno alteradas.');
}

// ---------------------------------------------------------------------------
// Platôs e parâmetros de volume
// ---------------------------------------------------------------------------

export function changePlatform(id: string, patch: Partial<PlatformInput>): boolean {
  const { project, applyOperation } = editor();
  return applyOperation(
    updatePlatform(project, id, patch),
    'Platô alterado: terreno e volumes recalculados.',
  );
}

export function deletePlatform(id: string): boolean {
  const { project, applyOperation } = editor();
  const name = project.earthworks.platforms.find((p) => p.id === id)?.name ?? 'Platô';
  const done = applyOperation(removePlatform(project, id), `"${name}" removido.`);
  if (done && earthwork().selection?.kind === 'platform') earthwork().select(null);
  return done;
}

export function changeEarthworkSettings(
  patch: Partial<Pick<Earthworks, 'swellPercent' | 'compactionFactor' | 'reusePercent'>>,
): boolean {
  const { project, applyOperation } = editor();
  return applyOperation(setEarthworkSettings(project, patch));
}

function createPlatformFrom(ring: Point2[]): boolean {
  const { project, applyOperation, notify } = editor();
  const { draft, redrawId } = earthwork();
  if (redrawId) {
    const done = changePlatform(redrawId, { outline: ring });
    if (done) useEarthworkStore.setState({ redrawId: null });
    return done;
  }
  if (draft.elevation === null) {
    notify('error', 'Informe a cota de implantação do platô antes de fechar o perímetro.');
    return false;
  }
  const created = addPlatform(project, {
    outline: ring,
    elevation: draft.elevation,
    cutSlope: draft.cutSlope,
    fillSlope: draft.fillSlope,
  });
  if (!created.ok) {
    notify('error', created.error.message);
    return false;
  }
  const name =
    created.value.project.earthworks.platforms.find((p) => p.id === created.value.platformId)
      ?.name ?? 'Platô';
  applyOperation(
    { ok: true, value: created.value.project },
    `"${name}" criado: terreno projetado e volumes atualizados.`,
  );
  earthwork().select({ kind: 'platform', id: created.value.platformId });
  return true;
}

// ---------------------------------------------------------------------------
// Cliques e anéis vindos da planta
// ---------------------------------------------------------------------------

/**
 * Seleciona o que há no ponto da planta: o platô sob ele (o mais recente primeiro, quando os
 * platôs estão desenhados) ou a superfície do terreno. Fora dos dois, limpa a seleção.
 * Devolve se algo ficou selecionado.
 */
export function selectEarthworkAt(point: Point2, platforms: boolean): boolean {
  const { project } = editor();
  const { terrain } = project;
  const platform =
    terrain && platforms
      ? [...project.earthworks.platforms]
          .reverse()
          .find((p) => pointInRing(p.outline, point.x, point.y))
      : undefined;
  if (platform) earthwork().select({ kind: 'platform', id: platform.id });
  else if (terrain && terrainElevationAt(terrain, point.x, point.y) !== null) {
    earthwork().select({ kind: 'surface' });
  } else if (earthwork().selection) earthwork().select(null);
  return earthwork().selection !== null;
}

registerTerrainEditHandlers({
  point: (mode, point, tolerance) => {
    const { project, notify } = editor();
    const { terrain } = project;
    if (!terrain) return;
    if (mode === 'point-add') {
      useEarthworkStore.setState({ pending: point, pointIndex: null });
      return;
    }
    if (mode === 'point-edit') {
      const index = nearestTerrainPoint(terrain, point.x, point.y, tolerance);
      if (index === null) notify('info', 'Nenhum ponto do terreno sob o cursor.');
      useEarthworkStore.setState({ pointIndex: index, pending: null });
      return;
    }
    if (mode === 'point-move') {
      const index = earthwork().pointIndex;
      const current = index !== null ? terrain.points[index] : undefined;
      if (!current) return;
      if (updateSurfacePoint({ x: point.x, y: point.y, z: current.z })) {
        terrainUi().setMode('point-edit');
      }
      return;
    }
    selectEarthworkAt(point, true);
  },
  ring: (mode, ring) => {
    if (mode === 'platform') return createPlatformFrom(ring);
    const terrain = currentTerrain();
    if (!terrain) return false;
    return commitTerrain(setTerrainBoundary(terrain, [ring]), 'Limite da superfície redefinido.');
  },
});

// ---------------------------------------------------------------------------
// Coerência com o restante do editor
// ---------------------------------------------------------------------------

useEditorStore.subscribe((state, previous) => {
  const current = earthwork();
  if (state.project.id !== previous.project.id) {
    useEarthworkStore.setState({
      selection: null,
      pointIndex: null,
      pending: null,
      redrawId: null,
      view: 'design',
      draft: { elevation: null, cutSlope: 1, fillSlope: 1.5 },
    });
    return;
  }
  // Um elemento selecionado toma o painel de propriedades.
  if (current.selection && (state.selection.length > 0 || state.annotationSelection)) {
    useEarthworkStore.setState({ selection: null });
  }
  if (state.project === previous.project) return;
  const { terrain, earthworks } = state.project;
  const patch: Partial<EarthworkState> = {};
  if (!terrain) {
    patch.selection = null;
    patch.pointIndex = null;
    patch.pending = null;
  } else {
    // Desfazer e refazer trocam a superfície: o índice do ponto pode não valer mais.
    if (
      terrain !== previous.project.terrain &&
      current.pointIndex !== null &&
      !terrain.points[current.pointIndex]
    ) {
      patch.pointIndex = null;
    }
    if (current.view === 'original' && !terrain.original) patch.view = 'design';
  }
  if (
    current.selection?.kind === 'platform' &&
    !earthworks.platforms.some((p) => p.id === (current.selection as { id: string }).id)
  ) {
    patch.selection = null;
  }
  if (Object.keys(patch).length > 0) useEarthworkStore.setState(patch);
});

// Um elemento da arquitetura selecionado também toma o painel de propriedades.
useArchStore.subscribe((state) => {
  if (state.selection.length > 0 && earthwork().selection) {
    useEarthworkStore.setState({ selection: null });
  }
});

// O painel de geração da superfície e o de terraplenagem ocupam o mesmo lugar.
useTerrainStore.subscribe((state, previous) => {
  if (state.panelOpen && !previous.panelOpen && earthwork().tab) earthwork().close();
  // Fim do desenho de um perímetro (concluído ou cancelado): o próximo cria um platô novo.
  if (previous.mode === 'platform' && state.mode !== 'platform' && earthwork().redrawId) {
    useEarthworkStore.setState({ redrawId: null });
  }
});
