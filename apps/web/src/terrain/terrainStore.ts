import { validatePolygon, type Point2 } from '@hydrobim/core';
import { create } from 'zustand';
import { useEditorStore } from '../state/editorStore';
import type { DrapeState } from './drape';

/**
 * Estado de sessão do módulo de terreno: área de recorte em edição, corte longitudinal, ponto
 * consultado, opções de visualização e andamento da geração. Não é dado de engenharia — a
 * superfície gerada é que vai para o projeto (`project.terrain`), pela store do editor, com
 * desfazer. Nada daqui entra no arquivo nem no histórico.
 */

/** Operação do terreno em andamento na Planta Infra. */
export type TerrainMode = 'area' | 'hole' | 'profile' | 'query';

export type TerrainColorMode = 'elevation' | 'slope' | 'plain';

export interface TerrainDisplay {
  readonly colorMode: TerrainColorMode;
  /** Arestas da triangulação à mostra (planta e 3D). */
  readonly triangulation: boolean;
  readonly contours: boolean;
  /** Intervalo das curvas de nível (m); `null` = sugerido pelo desnível da superfície. */
  readonly contourInterval: number | null;
  /**
   * Suaviza o DESENHO das curvas de nível. A superfície, as cotas e os cortes não mudam; a
   * curva suavizada deixa de passar exatamente pelas interseções com a triangulação.
   */
  readonly contourSmoothing: boolean;
  /**
   * Fator vertical aplicado SÓ ao desenho do terreno no 3D. 1 = terreno natural, escala real
   * 1:1 (o padrão). Acima de 1 o terreno deixa de coincidir com a rede e a interface avisa.
   */
  readonly exaggeration: number;
  /** Opacidade da superfície no modelo 3D, de 0,1 a 1 (abaixo de 1 a rede enterrada aparece). */
  readonly opacity: number;
  /**
   * Fonte de mapa (ruas, satélite) desenhada sobre a superfície no modelo 3D, acompanhando o
   * relevo; `null` = cor pela opção `colorMode`.
   */
  readonly drapeSourceId: string | null;
  /** Superfície à mostra no modelo 3D (MEP e Infra). */
  readonly show3d: boolean;
  /**
   * Superfície à mostra na planta do MEP. No Infra a planta segue a camada Terreno do
   * ambiente (`project.infra.layers.terrain`).
   */
  readonly mepPlan: boolean;
}

export const DEFAULT_DISPLAY: TerrainDisplay = {
  colorMode: 'elevation',
  triangulation: false,
  contours: true,
  contourInterval: null,
  contourSmoothing: false,
  exaggeration: 1,
  opacity: 0.6,
  drapeSourceId: null,
  show3d: true,
  mepPlan: false,
};

export const EXAGGERATIONS = [1, 2, 3, 5, 10] as const;

export type TerrainJobState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'running';
      readonly label: string;
      /** Fração concluída (0 a 1); `null` = etapa sem medida de andamento. */
      readonly progress: number | null;
    }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'done'; readonly message: string; readonly warnings: readonly string[] };

interface TerrainState {
  panelOpen: boolean;
  mode: TerrainMode | null;
  /** Contorno externo da área de recorte (coordenadas locais); `null` = não definida. */
  area: Point2[] | null;
  holes: Point2[][];
  /** Vértices do anel ou da poligonal em desenho. */
  draft: Point2[];
  /** Corte longitudinal traçado. */
  profilePath: Point2[] | null;
  /** Ponto fixado pela consulta de cota. */
  query: Point2 | null;
  display: TerrainDisplay;
  job: TerrainJobState;
  /** Situação do mapa sobre o terreno no 3D (`null` = desligado ou ainda não pedido). */
  drape: { readonly state: DrapeState | 'blocked'; readonly message: string } | null;

  setPanelOpen: (open: boolean) => void;
  setMode: (mode: TerrainMode | null) => void;
  /** Clique na planta durante uma operação; `tolerance` é o raio de captura, em metros. */
  click: (point: Point2, tolerance: number) => void;
  finishDraft: () => void;
  undoDraftPoint: () => void;
  cancel: () => void;
  setArea: (rings: Point2[][] | null) => void;
  removeHole: (index: number) => void;
  clearProfile: () => void;
  clearQuery: () => void;
  setDisplay: (patch: Partial<TerrainDisplay>) => void;
  setJob: (job: TerrainJobState) => void;
  reset: () => void;
}

const notify = (level: 'info' | 'error' | 'success', text: string): void =>
  useEditorStore.getState().notify(level, text);

export const MODE_HINTS: Record<TerrainMode, string> = {
  area: 'Área do terreno: clique os vértices do contorno; clique no primeiro ponto (ou Enter) para fechar. Esc cancela, Backspace desfaz o último ponto.',
  hole: 'Furo na área: clique os vértices dentro do contorno; clique no primeiro ponto (ou Enter) para fechar.',
  profile:
    'Corte longitudinal: clique os pontos do eixo do corte; clique de novo no último ponto (ou Enter) para gerar o perfil.',
  query: 'Consulta de cota: clique sobre a superfície para fixar o ponto. Esc encerra.',
};

export const useTerrainStore = create<TerrainState>()((set, get) => ({
  panelOpen: false,
  mode: null,
  area: null,
  holes: [],
  draft: [],
  profilePath: null,
  query: null,
  display: DEFAULT_DISPLAY,
  job: { status: 'idle' },
  drape: null,

  setPanelOpen: (panelOpen) => {
    set({ panelOpen });
    if (panelOpen) {
      const editor = useEditorStore.getState();
      if (editor.viewMode !== 'plan') editor.setViewMode('plan');
    }
  },

  setMode: (mode) => {
    if (mode === null) {
      set({ mode: null, draft: [] });
      return;
    }
    if (mode === 'hole' && !get().area) {
      notify('info', 'Defina primeiro o contorno da área; o furo é desenhado dentro dele.');
      return;
    }
    // As operações do terreno acontecem na planta, com a ferramenta de seleção: nenhuma
    // ferramenta de modelagem disputa o clique.
    const editor = useEditorStore.getState();
    if (editor.tool !== 'select') editor.setTool('select');
    if (editor.viewMode !== 'plan') useEditorStore.getState().setViewMode('plan');
    set({ mode, draft: [] });
    notify('info', MODE_HINTS[mode]);
  },

  click: (point, tolerance) => {
    const { mode, draft } = get();
    if (!mode) return;
    if (mode === 'query') {
      set({ query: point });
      return;
    }
    const near = (p: Point2 | undefined): boolean =>
      p !== undefined && Math.hypot(p.x - point.x, p.y - point.y) <= tolerance;
    const closing = mode !== 'profile' && draft.length >= 3 && near(draft[0]);
    if (closing || (draft.length >= 2 && near(draft[draft.length - 1]))) {
      get().finishDraft();
      return;
    }
    if (near(draft[draft.length - 1])) return;
    set({ draft: [...draft, point] });
  },

  finishDraft: () => {
    const { mode, draft, area, holes } = get();
    if (!mode || mode === 'query') return;
    if (mode === 'profile') {
      if (draft.length < 2) {
        notify('info', 'O corte precisa de ao menos dois pontos.');
        return;
      }
      set({ profilePath: draft, draft: [], mode: null });
      return;
    }
    const rings = mode === 'area' ? [draft] : [area ?? [], ...holes, draft];
    const checked = validatePolygon(rings);
    if (!checked.ok) {
      notify('error', checked.error.message);
      return;
    }
    const [outer, ...rest] = checked.value;
    // Um contorno novo descarta os furos do anterior: eles pertenciam à outra área.
    set({ area: outer ?? null, holes: mode === 'area' ? [] : rest, draft: [], mode: null });
    notify(
      'success',
      mode === 'area'
        ? 'Área do terreno definida. Escolha a fonte de elevação e gere a superfície.'
        : 'Furo acrescentado à área.',
    );
  },

  undoDraftPoint: () => set((state) => ({ draft: state.draft.slice(0, -1) })),
  cancel: () => {
    if (get().draft.length > 0) set({ draft: [] });
    else set({ mode: null });
  },

  setArea: (rings) => {
    if (!rings || rings.length === 0) {
      set({ area: null, holes: [], draft: [] });
      return;
    }
    const [outer, ...rest] = rings;
    set({ area: outer ?? null, holes: rest, draft: [] });
  },
  removeHole: (index) => set((state) => ({ holes: state.holes.filter((_, i) => i !== index) })),
  clearProfile: () => set({ profilePath: null }),
  clearQuery: () => set({ query: null }),
  setDisplay: (patch) => set((state) => ({ display: { ...state.display, ...patch } })),
  setJob: (job) => set({ job }),
  reset: () =>
    set({
      mode: null,
      area: null,
      holes: [],
      draft: [],
      profilePath: null,
      query: null,
      job: { status: 'idle' },
    }),
}));

/** Anéis da área em edição: contorno e furos; `null` sem contorno. */
export function areaRings(state: Pick<TerrainState, 'area' | 'holes'>): Point2[][] | null {
  return state.area ? [state.area, ...state.holes] : null;
}

// A store do editor não conhece o terreno: esta ligação acompanha o que acontece nela.
useEditorStore.subscribe((state, previous) => {
  const terrain = useTerrainStore.getState();
  // Outro projeto: área, corte e consulta eram do projeto anterior.
  if (state.project.id !== previous.project.id) {
    terrain.reset();
    return;
  }
  // Uma ferramenta de modelagem ou a saída da planta encerram a operação do terreno.
  if (terrain.mode && (state.tool !== 'select' || state.viewMode !== 'plan')) {
    useTerrainStore.setState({ mode: null, draft: [] });
  }
  // Sem superfície não há perfil nem ponto consultado.
  if (previous.project.terrain && !state.project.terrain) {
    useTerrainStore.setState({ profilePath: null, query: null });
  }
});
