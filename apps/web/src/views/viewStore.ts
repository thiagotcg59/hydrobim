import {
  addView,
  addViewDetail,
  copyViewDetails,
  defaultSectionBox,
  deleteView,
  deleteViewDetails,
  dimensionOffsetAt,
  duplicateView,
  getView,
  isView2d,
  moveView,
  moveViewDetails,
  renameView,
  sectionFromPoints,
  updateView,
  updateViewDetail,
  VIEW_KIND_LABELS,
  type DetailInput,
  type DetailPatch,
  type ElevationDirection,
  type Point2,
  type Project,
  type ProjectView,
  type ProjectView2d,
  type Result,
  type ViewCamera,
  type ViewPatch,
} from '@hydrobim/core';
import { create } from 'zustand';
import { getViewDirection, getViewFocus } from '../editor/viewPresets';
import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { entryPoint, parseEntry } from './entry';

/**
 * Sessão das vistas de projeto: qual vista está aberta em cada área de desenho, a ferramenta
 * de desenho 2D em uso, os pontos já informados e a seleção de detalhes. Nada daqui é dado do
 * projeto: as vistas e os detalhes vivem em `project.views` e toda alteração passa pelas
 * operações de `@hydrobim/core`, com o histórico de desfazer/refazer da store do editor.
 */

export const DETAIL_TOOLS = ['line', 'polyline', 'rect', 'circle', 'text', 'dimension'] as const;
export type DetailTool = (typeof DETAIL_TOOLS)[number];
/** `section` desenha a linha de um corte em planta; as demais criam detalhes na vista aberta. */
export type ViewTool = 'select' | DetailTool | 'section';

export const VIEW_TOOL_LABELS: Record<ViewTool, string> = {
  select: 'Selecionar',
  line: 'Linha',
  polyline: 'Polilinha',
  rect: 'Retângulo',
  circle: 'Círculo',
  text: 'Texto',
  dimension: 'Cota',
  section: 'Corte',
};

const DEFAULT_TEXT = 'TEXTO';

/** O que a vista 2D aberta está mostrando agora (para salvar o enquadramento e o recorte). */
export interface LiveView {
  readonly viewId: string;
  readonly center: Point2;
  /** Altura e largura visíveis (m). */
  readonly height: number;
  readonly width: number;
  /** Envoltória do que está desenhado, nas coordenadas da vista. */
  readonly content: { min: Point2; max: Point2 } | null;
}

let liveView: LiveView | null = null;
export const setLiveView = (next: LiveView | null): void => {
  liveView = next;
};
export const getLiveView = (): LiveView | null => liveView;

/** Câmera do Modelo 3D como está agora; `null` enquanto o modelo ainda não foi navegado. */
export function captureCamera(): ViewCamera | null {
  const focus = getViewFocus();
  const direction = getViewDirection();
  if (!focus || !direction) return null;
  return {
    target: focus.center,
    direction,
    halfHeight: focus.halfHeight,
    projection: useEditorStore.getState().orthographic ? 'orthographic' : 'perspective',
  };
}

interface ViewState {
  /** Vista 2D aberta na área da planta (`null` = planta de trabalho). */
  open2d: string | null;
  /** Vista 3D aberta na área do modelo (`null` = modelo 3D padrão, sem caixa de corte). */
  open3d: string | null;
  tool: ViewTool;
  /** Pontos já informados: coordenadas da vista; no corte, coordenadas do projeto em planta. */
  draft: Point2[];
  /** Ponto capturado sob o cursor (mesmas coordenadas de `draft`). */
  cursor: Point2 | null;
  detailSelection: string[];
  /** Corte selecionado pelo marcador em planta. */
  marker: string | null;
  /** Texto recém-criado, cujo campo recebe o foco no painel. */
  focusDetail: string | null;
  /** Pedido para o Modelo 3D assumir a câmera salva (`null` = enquadrar o modelo). */
  cameraRequest: { camera: ViewCamera | null; nonce: number } | null;
  /** Vista em renomeação no navegador. */
  renaming: string | null;

  openView: (id: string, options?: { keepCamera?: boolean }) => void;
  closeView: (pane: '2d' | '3d') => void;
  setTool: (tool: ViewTool) => void;
  setCursor: (cursor: Point2 | null) => void;
  /** Esc: desfaz o que estiver em andamento; devolve `false` quando não havia nada. */
  cancel: () => boolean;
  clickPoint: (point: Point2) => void;
  /** Conclui a polilinha em andamento (fechada ou aberta). */
  finishDraft: (closed?: boolean) => void;
  /** Entrada numérica (ver `entry.ts`); devolve `false` se não pôde ser aplicada. */
  submitEntry: (text: string) => boolean;
  selectDetail: (id: string | null, additive?: boolean) => void;
  selectMarker: (id: string | null) => void;
  setRenaming: (id: string | null) => void;
  deleteDetails: () => boolean;
  moveDetails: (delta: Point2) => boolean;
  copyDetails: (delta: Point2) => boolean;
  changeDetail: (id: string, patch: DetailPatch) => boolean;
  createPlan: (levelId?: string) => string | null;
  createElevation: (direction: ElevationDirection) => string | null;
  create3d: () => string | null;
  duplicate: (id: string) => string | null;
  remove: (id: string) => boolean;
  rename: (id: string, name: string) => boolean;
  reorder: (id: string, offset: number) => void;
  change: (id: string, patch: ViewPatch, message?: string) => boolean;
  saveFrame: () => void;
  toggleCrop: () => void;
  toggleSectionBox: () => void;
}

const editor = () => useEditorStore.getState();
const apply = (result: Result<Project>, message?: string): boolean =>
  editor().applyOperation(result, message);
const done = (project: Project): Result<Project> => ({ ok: true, value: project });

/** Vista 2D aberta, se ainda existir no projeto. */
export function openView2dOf(project: Project, id: string | null): ProjectView2d | null {
  const view = getView(project, id);
  return view && isView2d(view) ? view : null;
}

/** Vista sobre a qual os comandos de vista atuam: o marcador, senão a da área ativa. */
export function currentViewOf(
  project: Project,
  state: Pick<ViewState, 'open2d' | 'open3d' | 'marker'>,
  viewMode: string,
): ProjectView | null {
  const order =
    viewMode === 'plan'
      ? [state.marker, state.open2d, state.open3d]
      : [state.marker, state.open3d, state.open2d];
  for (const id of order) {
    const view = getView(project, id);
    if (view) return view;
  }
  return null;
}

export const useViewStore = create<ViewState>()((set, get) => {
  /** Cria um detalhe na vista 2D aberta. */
  const addDetail = (input: DetailInput): string | null => {
    const { open2d } = get();
    if (!open2d) return null;
    const result = addViewDetail(editor().project, open2d, input);
    if (!result.ok) {
      editor().notify('error', result.error.message);
      return null;
    }
    apply(done(result.value.project));
    return result.value.detailId;
  };

  const created = (
    result: Result<{ project: Project; viewId: string }>,
    message: (view: ProjectView) => string,
  ): string | null => {
    if (!result.ok) {
      editor().notify('error', result.error.message);
      return null;
    }
    const view = getView(result.value.project, result.value.viewId);
    apply(done(result.value.project), view ? message(view) : undefined);
    return result.value.viewId;
  };

  const sectionPoint = (point: Point2): void => {
    const { draft } = get();
    const [a, b] = draft;
    if (!a) {
      set({ draft: [point] });
      return;
    }
    if (!b) {
      if (Math.hypot(point.x - a.x, point.y - a.y) < 1e-6) {
        editor().notify(
          'info',
          'Escolha o segundo ponto da linha de corte, diferente do primeiro.',
        );
        return;
      }
      set({ draft: [a, point] });
      return;
    }
    const { side, depth } = sectionFromPoints(a, b, point);
    const id = created(
      addView(editor().project, { kind: 'section', a, b, side, depth }),
      (view) =>
        `${view.name} criado: o duplo clique no marcador (ou o navegador) abre a vista do corte.`,
    );
    if (!id) return;
    set({ tool: 'select', draft: [], marker: id, detailSelection: [] });
    useUiStore.getState().setPanelTab('view');
  };

  return {
    open2d: null,
    open3d: null,
    tool: 'select',
    draft: [],
    cursor: null,
    detailSelection: [],
    marker: null,
    focusDetail: null,
    cameraRequest: null,
    renaming: null,

    openView: (id, options) => {
      const view = getView(editor().project, id);
      if (!view) return;
      if (isView2d(view)) {
        set({ open2d: id, tool: 'select', draft: [], detailSelection: [], marker: null });
        if (editor().tool !== 'select') editor().setTool('select');
        editor().setViewMode('plan');
      } else {
        set((state) => ({
          open3d: id,
          marker: null,
          ...(options?.keepCamera
            ? {}
            : {
                cameraRequest: {
                  camera: view.camera,
                  nonce: (state.cameraRequest?.nonce ?? 0) + 1,
                },
              }),
        }));
        editor().setViewMode('3d');
      }
      useUiStore.getState().setPanelTab('view');
    },

    closeView: (pane) => {
      if (pane === '3d') {
        set({ open3d: null });
        return;
      }
      // A linha de corte também é desenhada na planta de trabalho: essa ferramenta continua.
      set((state) => ({
        open2d: null,
        tool: state.tool === 'section' ? 'section' : 'select',
        draft: [],
        detailSelection: [],
      }));
    },

    setTool: (tool) => {
      if (tool !== 'select') {
        // As ferramentas de desenho trabalham na área da planta, com a seleção livre.
        if (editor().tool !== 'select') editor().setTool('select');
        if (editor().viewMode !== 'plan') editor().setViewMode('plan');
      }
      set({ tool, draft: [], cursor: null, ...(tool === 'select' ? {} : { marker: null }) });
    },

    setCursor: (cursor) => set({ cursor }),

    cancel: () => {
      const { draft, tool, detailSelection, marker, renaming } = get();
      if (renaming) set({ renaming: null });
      else if (draft.length > 0) {
        // A polilinha já tem trechos indicados: Esc a conclui em vez de descartá-la.
        if (tool === 'polyline' && draft.length >= 2) get().finishDraft(false);
        else set({ draft: [] });
      } else if (tool !== 'select') set({ tool: 'select' });
      else if (detailSelection.length > 0 || marker) set({ detailSelection: [], marker: null });
      else return false;
      return true;
    },

    clickPoint: (point) => {
      const { tool, draft } = get();
      const [first, second] = draft;
      switch (tool) {
        case 'select':
          return;
        case 'section':
          sectionPoint(point);
          return;
        case 'line':
          if (!first) set({ draft: [point] });
          // Como no comando de linha dos programas de CAD, a próxima parte do último ponto.
          else if (addDetail({ kind: 'line', a: first, b: point })) set({ draft: [point] });
          return;
        case 'polyline': {
          const last = draft[draft.length - 1];
          if (last && Math.hypot(point.x - last.x, point.y - last.y) < 1e-6) return;
          set({ draft: [...draft, point] });
          return;
        }
        case 'rect':
          if (!first) set({ draft: [point] });
          else if (addDetail({ kind: 'rect', a: first, b: point })) set({ draft: [] });
          return;
        case 'circle':
          if (!first) set({ draft: [point] });
          else if (
            addDetail({
              kind: 'circle',
              center: first,
              radius: Math.hypot(point.x - first.x, point.y - first.y),
            })
          ) {
            set({ draft: [] });
          }
          return;
        case 'text': {
          const id = addDetail({ kind: 'text', position: point, text: DEFAULT_TEXT, rotation: 0 });
          if (!id) return;
          get().selectDetail(id);
          set({ focusDetail: id, draft: [] });
          return;
        }
        case 'dimension': {
          if (!first) set({ draft: [point] });
          else if (!second) {
            if (Math.hypot(point.x - first.x, point.y - first.y) < 1e-6) {
              editor().notify('info', 'Escolha um segundo ponto diferente do primeiro.');
              return;
            }
            set({ draft: [first, point] });
          } else {
            const mode = editor().dimensionMode;
            const offset = dimensionOffsetAt({ a: first, b: second, mode }, point);
            if (addDetail({ kind: 'dimension', a: first, b: second, mode, offset })) {
              set({ draft: [] });
            }
          }
        }
      }
    },

    finishDraft: (closed = false) => {
      const { tool, draft } = get();
      if (tool !== 'polyline' || draft.length < 2) return;
      if (addDetail({ kind: 'polyline', points: draft, closed })) set({ draft: [] });
    },

    submitEntry: (text) => {
      const { tool, draft, cursor } = get();
      const refuse = (message: string): boolean => {
        editor().notify('error', message);
        return false;
      };
      if (tool === 'select' || tool === 'text') {
        return refuse('Escolha uma ferramenta de desenho antes de digitar o valor.');
      }
      const entry = parseEntry(text);
      if (!entry) {
        return refuse(
          'Entrada não reconhecida. Use "X;Y", "@ΔX;ΔY", "distância<ângulo" ou um valor (ex.: 2,5).',
        );
      }
      const [first, second] = draft;
      const last = draft[draft.length - 1] ?? null;
      if (entry.kind === 'value') {
        if (tool === 'circle' && first) {
          if (!addDetail({ kind: 'circle', center: first, radius: entry.value })) return false;
          set({ draft: [] });
          return true;
        }
        if (tool === 'dimension' && first && second) {
          const mode = editor().dimensionMode;
          const side = cursor
            ? Math.sign(dimensionOffsetAt({ a: first, b: second, mode }, cursor))
            : 1;
          const offset = entry.value * (side === 0 ? 1 : side);
          if (!addDetail({ kind: 'dimension', a: first, b: second, mode, offset })) return false;
          set({ draft: [] });
          return true;
        }
        if (tool === 'section' && first && second) {
          // Um valor depois da linha é a profundidade; o lado é o do cursor.
          const side = cursor ? sectionFromPoints(first, second, cursor).side : 1;
          const dx = second.x - first.x;
          const dy = second.y - first.y;
          const size = Math.hypot(dx, dy);
          sectionPoint({
            x: first.x + (-dy / size) * side * entry.value,
            y: first.y + (dx / size) * side * entry.value,
          });
          return true;
        }
      }
      const point = entryPoint(entry, last, cursor);
      if (!point) {
        return refuse(
          last
            ? 'Para um valor único, aponte a direção com o cursor sobre a vista.'
            : 'Indique o primeiro ponto (clique ou "X;Y") antes de um valor relativo.',
        );
      }
      get().clickPoint(point);
      return true;
    },

    selectDetail: (id, additive = false) => {
      if (id === null) {
        if (!additive) set({ detailSelection: [], focusDetail: null });
        return;
      }
      set((state) => ({
        marker: null,
        focusDetail: null,
        detailSelection: !additive
          ? [id]
          : state.detailSelection.includes(id)
            ? state.detailSelection.filter((other) => other !== id)
            : [...state.detailSelection, id],
      }));
      if (editor().selection.length > 0 || editor().annotationSelection) editor().select(null);
      useUiStore.getState().setPanelTab('view');
    },

    selectMarker: (id) => {
      set({ marker: id, detailSelection: [] });
      if (!id) return;
      if (editor().selection.length > 0 || editor().annotationSelection) editor().select(null);
      useUiStore.getState().setPanelTab('view');
    },

    setRenaming: (renaming) => set({ renaming }),

    deleteDetails: () => {
      const { open2d, detailSelection } = get();
      if (!open2d || detailSelection.length === 0) return false;
      const count = detailSelection.length;
      const ok = apply(
        deleteViewDetails(editor().project, open2d, detailSelection),
        count === 1 ? 'Detalhe excluído.' : `${count} detalhes excluídos.`,
      );
      if (ok) set({ detailSelection: [] });
      return ok;
    },

    moveDetails: (delta) => {
      const { open2d, detailSelection } = get();
      if (!open2d || detailSelection.length === 0) return false;
      return apply(moveViewDetails(editor().project, open2d, detailSelection, delta));
    },

    copyDetails: (delta) => {
      const { open2d, detailSelection } = get();
      if (!open2d || detailSelection.length === 0) return false;
      const result = copyViewDetails(editor().project, open2d, detailSelection, delta);
      if (!result.ok) {
        editor().notify('error', result.error.message);
        return false;
      }
      const count = result.value.detailIds.length;
      apply(
        done(result.value.project),
        count === 1 ? 'Detalhe copiado.' : `${count} detalhes copiados.`,
      );
      // As cópias ficam selecionadas, prontas para o próximo deslocamento.
      set({ detailSelection: result.value.detailIds });
      return true;
    },

    changeDetail: (id, patch) => {
      const { open2d } = get();
      if (!open2d) return false;
      return apply(updateViewDetail(editor().project, open2d, id, patch));
    },

    createPlan: (levelId) => {
      const { project, workPlaneZ } = editor();
      // Sem nível indicado: o do plano de trabalho atual, senão o primeiro.
      const level =
        project.levels.find((entry) => entry.id === levelId) ??
        project.levels.find((entry) => Math.abs(entry.elevation - workPlaneZ) < 1e-6) ??
        project.levels[0];
      if (!level) {
        editor().notify('error', 'O projeto não tem níveis: crie um em Gerenciar › Níveis.');
        return null;
      }
      const id = created(
        addView(project, { kind: 'plan', levelId: level.id }),
        (view) => `${view.name} criada: faixa de corte e escala no painel "Vista".`,
      );
      if (id) get().openView(id);
      return id;
    },

    createElevation: (direction) => {
      const id = created(
        addView(editor().project, { kind: 'elevation', direction }),
        (view) => `${view.name} criada.`,
      );
      if (id) get().openView(id);
      return id;
    },

    create3d: () => {
      const camera = captureCamera();
      const id = created(addView(editor().project, { kind: '3d', camera }), (view) =>
        camera
          ? `${view.name} criada com a câmera atual do Modelo 3D.`
          : `${view.name} criada; navegue no Modelo 3D e use "Salvar enquadramento" para guardar a câmera.`,
      );
      if (id) get().openView(id, { keepCamera: true });
      return id;
    },

    duplicate: (id) => {
      const result = duplicateView(editor().project, id);
      return created(result, (view) => `Vista duplicada: ${view.name}.`);
    },

    remove: (id) => {
      const view = getView(editor().project, id);
      if (!view) return false;
      return apply(
        deleteView(editor().project, id),
        `${VIEW_KIND_LABELS[view.kind]} "${view.name}" excluída do projeto (o modelo não muda).`,
      );
    },

    rename: (id, name) => {
      const ok = apply(renameView(editor().project, id, name));
      if (ok) set({ renaming: null });
      return ok;
    },

    reorder: (id, offset) => {
      apply(moveView(editor().project, id, offset));
    },

    change: (id, patch, message) => apply(updateView(editor().project, id, patch), message),

    saveFrame: () => {
      const { project, viewMode } = editor();
      const view = currentViewOf(project, { ...get(), marker: null }, viewMode);
      if (!view) {
        editor().notify(
          'info',
          'Abra uma vista salva (navegador › Vistas) para guardar o enquadramento dela.',
        );
        return;
      }
      if (isView2d(view)) {
        const live = getLiveView();
        if (!live || live.viewId !== view.id) return;
        get().change(
          view.id,
          { frame: { center: live.center, height: live.height } },
          `Enquadramento salvo em "${view.name}".`,
        );
        return;
      }
      const camera = captureCamera();
      if (!camera) {
        editor().notify('info', 'Navegue no Modelo 3D antes de salvar a câmera da vista.');
        return;
      }
      get().change(view.id, { camera }, `Câmera salva em "${view.name}".`);
    },

    toggleCrop: () => {
      const view = openView2dOf(editor().project, get().open2d);
      if (!view) return;
      if (view.crop) {
        get().change(
          view.id,
          { crop: { ...view.crop, enabled: !view.crop.enabled } },
          view.crop.enabled ? 'Região de recorte desligada.' : 'Região de recorte ligada.',
        );
        return;
      }
      // Primeira vez: o recorte começa em torno do que está desenhado (ou da janela visível).
      const live = getLiveView();
      const box =
        live?.viewId === view.id
          ? (live.content ?? {
              min: { x: live.center.x - live.width / 4, y: live.center.y - live.height / 4 },
              max: { x: live.center.x + live.width / 4, y: live.center.y + live.height / 4 },
            })
          : { min: { x: -5, y: -5 }, max: { x: 5, y: 5 } };
      const pad = Math.max(0.25, 0.05 * Math.max(box.max.x - box.min.x, box.max.y - box.min.y));
      get().change(
        view.id,
        {
          crop: {
            enabled: true,
            min: { x: box.min.x - pad, y: box.min.y - pad },
            max: { x: box.max.x + pad, y: box.max.y + pad },
          },
        },
        'Região de recorte ligada: arraste as alças ou informe os limites no painel "Vista".',
      );
    },

    toggleSectionBox: () => {
      const { project } = editor();
      const view = getView(project, get().open3d);
      if (view?.kind === '3d') {
        const box = view.sectionBox;
        get().change(
          view.id,
          { sectionBox: box ? { ...box, enabled: !box.enabled } : defaultSectionBox(project) },
          box?.enabled
            ? 'Caixa de corte desligada.'
            : 'Caixa de corte ligada: arraste as alças das faces ou informe X, Y e Z no painel "Vista".',
        );
        return;
      }
      // Sem vista 3D aberta: a caixa pertence a uma vista, criada com a câmera atual.
      const id = created(
        addView(project, {
          kind: '3d',
          camera: captureCamera(),
          sectionBox: defaultSectionBox(project),
        }),
        (created3d) =>
          `${created3d.name} criada com a caixa de corte: arraste as alças das faces ou informe X, Y e Z no painel "Vista".`,
      );
      if (id) get().openView(id, { keepCamera: true });
    },
  };
});

// A store do editor não conhece as vistas: esta ligação acompanha o que acontece nela.
useEditorStore.subscribe((state, previous) => {
  const views = useViewStore.getState();
  // Uma ferramenta de modelagem encerra o desenho 2D em andamento.
  if (state.tool !== previous.tool && state.tool !== 'select' && views.tool !== 'select') {
    useViewStore.setState({ tool: 'select', draft: [] });
  }
  // Selecionar um elemento troca o assunto: sai a seleção de detalhes e o painel da vista.
  if (state.selection !== previous.selection && state.selection.length > 0) {
    if (views.detailSelection.length > 0 || views.marker) {
      useViewStore.setState({ detailSelection: [], marker: null });
    }
    if (useUiStore.getState().panelTab === 'view') useUiStore.getState().setPanelTab('properties');
  }
  // Vista excluída, desfeita ou de outro projeto: nada fica apontando para o que não existe.
  if (state.project.views !== previous.project.views) {
    const { project } = state;
    const open2d = openView2dOf(project, views.open2d);
    const open3d = getView(project, views.open3d);
    const marker = getView(project, views.marker);
    const details = new Set(open2d?.details.map((detail) => detail.id));
    const selection = views.detailSelection.filter((id) => details.has(id));
    useViewStore.setState({
      open2d: open2d?.id ?? null,
      open3d: open3d?.kind === '3d' ? open3d.id : null,
      marker: marker?.kind === 'section' ? marker.id : null,
      ...(selection.length === views.detailSelection.length ? {} : { detailSelection: selection }),
      ...(open2d || views.tool === 'select' || views.tool === 'section'
        ? {}
        : { tool: 'select', draft: [] }),
    });
  }
});
