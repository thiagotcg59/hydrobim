import {
  addIfcModel,
  applyIfcTransform,
  composeIfcTransforms,
  copyIfcObjects,
  fail,
  findIfcModel,
  findIfcObject,
  IFC_IDENTITY,
  IFC_IMPORT_LIMITS,
  ifcAlignTransform,
  ifcMoveTransform,
  ifcObjectTransform,
  ifcRotateTransform,
  invertIfcTransform,
  ok,
  removeIfcModels,
  removeIfcObjects,
  setIfcModelDisplay,
  transformIfcModels,
  transformIfcObjects,
  type IfcImportedModel,
  type IfcModelDisplayPatch,
  type IfcPlacementMode,
  type IfcSource,
  type IfcTransform,
  type Project,
  type Result,
  type Vec3,
} from '@hydrobim/core';
import {
  IFC_READ_STAGE_LABELS,
  IfcReadError,
  packIfcSource,
  sha256Hex,
  sniffIfc,
  unpackIfcSource,
  type IfcBounds,
  type IfcMeshGeometry,
  type IfcModelSummary,
  type IfcObjectMesh,
  type IfcObjectProperties,
  type IfcObjectSummary,
  type IfcReadProgress,
} from '@hydrobim/ifc-import';
import { create } from 'zustand';
import { useArchStore } from '../arch/archStore';
import { useEditorStore } from '../state/editorStore';
import { useEarthworkStore } from '../terrain/earthworkStore';
import { transformBounds, unionBounds, type IfcMeshIndex } from './ifcGeometry';
import { createIfcHost, type IfcHost } from './ifcHost';

/**
 * Sessão dos modelos IFC importados: leitura dos arquivos (fora da linha principal), o
 * assistente de importação, a seleção e a visibilidade dos objetos. Nada daqui é dado do
 * projeto — o projeto guarda a fonte, os objetos incluídos e as transformações, e toda
 * alteração confirmada passa por uma operação de `@hydrobim/core`, com um passo no histórico.
 */

// --- Fontes carregadas ----------------------------------------------------------------------

/** Um arquivo lido: resumo, malhas e o leitor que responde às consultas de propriedades. */
export interface IfcLoadedSource extends IfcMeshIndex {
  readonly sha256: string;
  readonly summary: IfcModelSummary;
  readonly objects: ReadonlyMap<number, IfcObjectSummary>;
}

// Malhas ficam fora da store reativa: são grandes e imutáveis depois de lidas.
const loaded = new Map<string, IfcLoadedSource>();
const hosts = new Map<string, IfcHost>();

export const ifcSourceOf = (sha256: string): IfcLoadedSource | null => loaded.get(sha256) ?? null;

async function loadSource(
  sha256: string,
  bytes: Uint8Array,
  onProgress: (progress: IfcReadProgress) => void,
): Promise<IfcLoadedSource> {
  const host = createIfcHost();
  hosts.set(sha256, host);
  try {
    const { summary, meshes } = await host.open(bytes, onProgress);
    // Descartado enquanto lia (cancelamento ou modelo removido): o resultado não vale.
    if (hosts.get(sha256) !== host)
      throw new IfcReadError('IFC_CANCELLED', 'Importação cancelada.');
    const source: IfcLoadedSource = {
      sha256,
      summary,
      objects: new Map(summary.objects.map((object) => [object.expressId, object])),
      objectMeshes: new Map<number, IfcObjectMesh>(meshes.objects.map((m) => [m.expressId, m])),
      geometries: new Map<number, IfcMeshGeometry>(meshes.geometries.map((g) => [g.id, g])),
    };
    loaded.set(sha256, source);
    return source;
  } catch (error) {
    if (hosts.get(sha256) === host) {
      hosts.delete(sha256);
      host.dispose();
    }
    throw error;
  }
}

const releaseListeners = new Set<(sha256: string) => void>();

/** Avisa quando uma fonte é solta (quem guarda recursos derivados dela os libera). */
export function onIfcSourceReleased(listener: (sha256: string) => void): () => void {
  releaseListeners.add(listener);
  return () => releaseListeners.delete(listener);
}

/** Encerra o leitor e solta as malhas de uma fonte (memória devolvida ao navegador). */
function releaseSource(sha256: string): void {
  hosts.get(sha256)?.dispose();
  hosts.delete(sha256);
  loaded.delete(sha256);
  for (const listener of releaseListeners) listener(sha256);
}

// --- Assistente de importação ---------------------------------------------------------------

export type IfcPickTarget = 'base' | 'target' | 'source1' | 'target1' | 'source2' | 'target2';

export interface IfcPlacementDraft {
  readonly mode: IfcPlacementMode;
  /** Deslocamento informado (modo "deslocamento e rotação"), em metros. */
  readonly offset: Vec3;
  /** Giro em graus, anti-horário visto de cima (modos "deslocamento" e "ponto-base"). */
  readonly rotationDeg: number;
  /** Ponto-base, no referencial do arquivo. */
  readonly basePoint: Vec3;
  /** Destino do ponto-base, no projeto. */
  readonly target: Vec3;
  /** Pares do alinhamento: origens no referencial do arquivo, destinos no projeto. */
  readonly sources: readonly [Vec3 | null, Vec3 | null];
  readonly targets: readonly [Vec3 | null, Vec3 | null];
}

export interface IfcWizard {
  readonly step: 'reading' | 'error' | 'preview' | 'placing';
  readonly fileName: string;
  readonly sha256: string | null;
  readonly source: IfcSource | null;
  readonly label: string;
  readonly fraction: number | null;
  readonly error: string | null;
  /** `expressId` dos objetos escolhidos. */
  readonly selected: ReadonlySet<number>;
  readonly placement: IfcPlacementDraft;
  readonly picking: IfcPickTarget | null;
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

const emptyPlacement = (): IfcPlacementDraft => ({
  mode: 'original',
  offset: ZERO,
  rotationDeg: 0,
  basePoint: ZERO,
  target: ZERO,
  sources: [null, null],
  targets: [null, null],
});

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Transformação que o posicionamento em edição produz — a mesma da prévia e da confirmação. */
export function placementTransform(placement: IfcPlacementDraft): Result<IfcTransform> {
  switch (placement.mode) {
    case 'original':
      return ok(IFC_IDENTITY);
    case 'offset':
      return ok(
        composeIfcTransforms(
          ifcMoveTransform(placement.offset),
          ifcRotateTransform(ZERO, radians(placement.rotationDeg)),
        ),
      );
    case 'basePoint':
      return ok(
        composeIfcTransforms(
          ifcMoveTransform({
            x: placement.target.x - placement.basePoint.x,
            y: placement.target.y - placement.basePoint.y,
            z: placement.target.z - placement.basePoint.z,
          }),
          ifcRotateTransform(placement.basePoint, radians(placement.rotationDeg)),
        ),
      );
    case 'aligned': {
      const [source1, source2] = placement.sources;
      const [target1, target2] = placement.targets;
      if (!source1 || !target1) {
        return fail(
          'IFC_ALIGN_INCOMPLETE',
          'Indique o 1º ponto do modelo importado e o destino dele no projeto.',
        );
      }
      return ifcAlignTransform(source1, target1, source2 && target2 ? source2 : null, target2);
    }
  }
}

/** Envoltória, no referencial do arquivo, dos objetos escolhidos. */
function selectedBounds(source: IfcLoadedSource, selected: ReadonlySet<number>): IfcBounds | null {
  let bounds: IfcBounds | null = null;
  for (const object of source.summary.objects) {
    if (selected.has(object.expressId)) bounds = unionBounds(bounds, object.bounds);
  }
  return bounds;
}

// --- Estado ------------------------------------------------------------------------------------

export type IfcSourceStatus =
  | { readonly status: 'loading'; readonly label: string; readonly fraction: number | null }
  | { readonly status: 'ready' }
  | { readonly status: 'missing' }
  | { readonly status: 'error'; readonly message: string };

export interface IfcFileInput {
  readonly name: string;
  readonly bytes: Uint8Array;
}

interface IfcState {
  /** Situação de cada fonte, por `sha256`. */
  sources: Record<string, IfcSourceStatus>;
  /** Muda a cada fonte carregada ou solta: as camadas de desenho relêem as malhas. */
  revision: number;
  wizard: IfcWizard | null;
  /** Objetos selecionados (identidades internas). */
  selection: string[];
  /** Modelo selecionado como um todo; exclui a seleção de objetos. */
  modelSelection: string | null;
  /** Objetos ocultos nesta sessão (não é dado do projeto). */
  hidden: string[];

  beginImport: (file: IfcFileInput) => Promise<void>;
  cancelImport: () => void;
  setWizardSelected: (selected: ReadonlySet<number>) => void;
  startPlacing: () => void;
  backToPreview: () => void;
  setPlacement: (patch: Partial<IfcPlacementDraft>) => void;
  setPlacementMode: (mode: IfcPlacementMode) => void;
  setPicking: (target: IfcPickTarget | null) => void;
  /** Ponto indicado em uma vista (coordenadas do projeto) para o campo em escolha. */
  pickPoint: (point: Vec3) => void;
  confirmImport: () => boolean;

  select: (id: string | null, additive?: boolean) => void;
  selectMany: (ids: readonly string[]) => void;
  selectModel: (id: string | null) => void;
  /** Esc: encerra a indicação de ponto ou limpa a seleção; `true` se havia o que cancelar. */
  cancel: () => boolean;
  setHidden: (ids: readonly string[], hidden: boolean) => void;
  isolate: (ids: readonly string[]) => void;
  showAll: () => void;

  moveSelection: (delta: Vec3) => boolean;
  rotateSelection: (degrees: number, pivot?: Vec3 | null) => boolean;
  copySelection: (delta: Vec3) => boolean;
  removeSelection: () => boolean;
  setModelDisplay: (modelId: string, patch: IfcModelDisplayPatch) => boolean;
  relinkSource: (modelId: string, file: IfcFileInput) => Promise<boolean>;
}

const editor = () => useEditorStore.getState();

let wizardToken = 0;

/** Solta as fontes que nem o projeto nem o assistente usam mais. */
function releaseUnused(): void {
  const state = useIfcStore.getState();
  const used = new Set(editor().project.ifcModels.map((model) => model.source.sha256));
  if (state.wizard?.sha256) used.add(state.wizard.sha256);
  const unused = [
    ...new Set([...hosts.keys(), ...loaded.keys(), ...Object.keys(state.sources)]),
  ].filter((sha) => !used.has(sha));
  if (unused.length === 0) return;
  for (const sha of unused) releaseSource(sha);
  useIfcStore.setState({
    sources: Object.fromEntries(Object.entries(state.sources).filter(([sha]) => used.has(sha))),
    revision: state.revision + 1,
  });
}

const setSource = (sha256: string, status: IfcSourceStatus): void =>
  useIfcStore.setState((state) => ({
    sources: { ...state.sources, [sha256]: status },
    revision: status.status === 'loading' ? state.revision : state.revision + 1,
  }));

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'Falha ao ler o arquivo IFC.';

/** Garante lidas as fontes dos modelos do projeto (ao abrir, desfazer, refazer…). */
function syncSources(project: Project): void {
  for (const model of project.ifcModels) {
    const sha = model.source.sha256;
    if (hosts.has(sha) || loaded.has(sha)) continue;
    if (model.source.data === '') {
      if (useIfcStore.getState().sources[sha]?.status !== 'missing') {
        setSource(sha, { status: 'missing' });
      }
      continue;
    }
    setSource(sha, { status: 'loading', label: 'Recuperando o arquivo-fonte', fraction: null });
    // Reserva a vaga já: outra passagem não inicia a mesma leitura.
    void (async () => {
      const bytes = await unpackIfcSource(model.source);
      if (!bytes.ok) {
        setSource(sha, { status: 'error', message: bytes.error.message });
        return;
      }
      if (hosts.has(sha) || loaded.has(sha)) return;
      try {
        await loadSource(sha, bytes.value, (progress) =>
          setSource(sha, {
            status: 'loading',
            label: IFC_READ_STAGE_LABELS[progress.stage],
            fraction: progress.fraction,
          }),
        );
        setSource(sha, { status: 'ready' });
      } catch (error) {
        if (error instanceof IfcReadError && error.code === 'IFC_CANCELLED') return;
        setSource(sha, { status: 'error', message: messageOf(error) });
      }
    })();
  }
  releaseUnused();
}

/** O que as operações de mover, girar, copiar e remover atingem. */
function targetsOf(state: IfcState): { modelIds: string[]; objectIds: string[] } {
  return state.modelSelection
    ? { modelIds: [state.modelSelection], objectIds: [] }
    : { modelIds: [], objectIds: state.selection };
}

/** Limpa as outras seleções: o painel de propriedades mostra uma coisa por vez. */
function claimSelection(): void {
  if (editor().selection.length > 0 || editor().annotationSelection) editor().select(null);
  if (useArchStore.getState().selection.length > 0) useArchStore.getState().select(null);
  if (useEarthworkStore.getState().selection) useEarthworkStore.getState().select(null);
}

export const useIfcStore = create<IfcState>((set, get) => ({
  sources: {},
  revision: 0,
  wizard: null,
  selection: [],
  modelSelection: null,
  hidden: [],

  beginImport: async ({ name, bytes }) => {
    wizardToken += 1;
    const token = wizardToken;
    const current = (): boolean => token === wizardToken;
    const base: IfcWizard = {
      step: 'reading',
      fileName: name,
      sha256: null,
      source: null,
      label: 'Verificando o arquivo',
      fraction: null,
      error: null,
      selected: new Set(),
      placement: emptyPlacement(),
      picking: null,
    };
    const failWith = (message: string): void => {
      if (current()) set({ wizard: { ...base, step: 'error', error: message } });
      releaseUnused();
    };
    set({ wizard: base });
    releaseUnused();

    if (bytes.byteLength > IFC_IMPORT_LIMITS.maxFileBytes) {
      failWith(
        `O arquivo tem ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB; a importação está limitada a ${Math.round(IFC_IMPORT_LIMITS.maxFileBytes / 1024 / 1024)} MB.`,
      );
      return;
    }
    const sniffed = sniffIfc(bytes);
    if (!sniffed.ok) {
      failWith(sniffed.error.message);
      return;
    }
    let source: IfcSource;
    try {
      source = await packIfcSource(name, bytes);
    } catch (error) {
      failWith(`Não foi possível preparar o arquivo para o projeto (${messageOf(error)}).`);
      return;
    }
    if (!current()) return;
    const sha = source.sha256;
    set({ wizard: { ...base, sha256: sha, source, label: IFC_READ_STAGE_LABELS.opening } });

    // O mesmo arquivo já lido (outro modelo do projeto) não é lido de novo.
    if (!loaded.has(sha)) {
      try {
        if (hosts.has(sha)) {
          // Já em leitura para o projeto: espera o fim dela.
          await new Promise<void>((resolve, reject) => {
            const unsubscribe = useIfcStore.subscribe((state) => {
              const status = state.sources[sha];
              if (loaded.has(sha)) {
                unsubscribe();
                resolve();
              } else if (!status || status.status === 'error') {
                unsubscribe();
                reject(
                  new Error(status?.status === 'error' ? status.message : 'Leitura cancelada.'),
                );
              }
            });
          });
        } else {
          await loadSource(sha, bytes, (progress) => {
            if (!current()) return;
            const wizard = get().wizard;
            if (!wizard) return;
            set({
              wizard: {
                ...wizard,
                label: IFC_READ_STAGE_LABELS[progress.stage],
                fraction: progress.fraction,
              },
            });
          });
        }
      } catch (error) {
        if (!(error instanceof IfcReadError && error.code === 'IFC_CANCELLED')) {
          failWith(messageOf(error));
        }
        return;
      }
    }
    if (!current()) {
      releaseUnused();
      return;
    }
    const read = loaded.get(sha);
    if (!read) return;
    if (read.summary.objects.length === 0) {
      failWith(
        'O arquivo foi lido, mas não tem objetos importáveis (nenhum IfcProduct com dados).',
      );
      return;
    }
    set((state) => ({
      revision: state.revision + 1,
      wizard: {
        ...base,
        step: 'preview',
        sha256: sha,
        source,
        label: '',
        selected: new Set(read.summary.objects.map((object) => object.expressId)),
      },
    }));
  },

  cancelImport: () => {
    wizardToken += 1;
    if (!get().wizard) return;
    set({ wizard: null });
    // Encerra o leitor em andamento; o projeto não foi tocado.
    releaseUnused();
  },

  setWizardSelected: (selected) => {
    const wizard = get().wizard;
    if (wizard) set({ wizard: { ...wizard, selected: new Set(selected) } });
  },

  startPlacing: () => {
    const wizard = get().wizard;
    if (!wizard || wizard.step !== 'preview' || wizard.selected.size === 0) return;
    set({ wizard: { ...wizard, step: 'placing', picking: null } });
  },

  backToPreview: () => {
    const wizard = get().wizard;
    if (wizard?.step === 'placing') set({ wizard: { ...wizard, step: 'preview', picking: null } });
  },

  setPlacement: (patch) => {
    const wizard = get().wizard;
    if (wizard) set({ wizard: { ...wizard, placement: { ...wizard.placement, ...patch } } });
  },

  setPlacementMode: (mode) => {
    const wizard = get().wizard;
    if (!wizard || wizard.placement.mode === mode) return;
    let placement: IfcPlacementDraft = { ...wizard.placement, mode };
    if (mode === 'basePoint') {
      // Ponto-base inicial: canto de menores X, Y e Z da envoltória do que foi escolhido. O
      // destino começa nele mesmo — nada se move até o usuário informar o destino.
      const source = wizard.sha256 ? loaded.get(wizard.sha256) : null;
      const bounds = source ? selectedBounds(source, wizard.selected) : null;
      const basePoint = bounds ? { x: bounds[0], y: bounds[1], z: bounds[2] } : ZERO;
      placement = { ...placement, basePoint, target: basePoint, rotationDeg: 0 };
    }
    set({ wizard: { ...wizard, placement, picking: null } });
  },

  setPicking: (target) => {
    const wizard = get().wizard;
    if (wizard?.step === 'placing') set({ wizard: { ...wizard, picking: target } });
  },

  pickPoint: (point) => {
    const wizard = get().wizard;
    if (!wizard || wizard.step !== 'placing' || !wizard.picking) return;
    const { placement, picking } = wizard;
    // Pontos do modelo importado são guardados no referencial do arquivo: desfaz a
    // transformação que a prévia está mostrando.
    const shown = placementTransform(placement);
    const toFile = (world: Vec3): Vec3 =>
      applyIfcTransform(invertIfcTransform(shown.ok ? shown.value : IFC_IDENTITY), world);
    let next: IfcPlacementDraft;
    let then: IfcPickTarget | null = null;
    if (picking === 'base') {
      const basePoint = toFile(point);
      // Trocar o ponto-base não desloca a prévia: o destino acompanha.
      next = { ...placement, basePoint, target: point };
      then = 'target';
    } else if (picking === 'target') {
      next = { ...placement, target: point };
    } else if (picking === 'source1') {
      next = { ...placement, sources: [toFile(point), null], targets: [null, null] };
      then = 'target1';
    } else if (picking === 'target1') {
      next = { ...placement, targets: [point, null] };
      then = 'source2';
    } else if (picking === 'source2') {
      next = { ...placement, sources: [placement.sources[0], toFile(point)] };
      then = 'target2';
    } else {
      next = { ...placement, targets: [placement.targets[0], point] };
    }
    set({ wizard: { ...wizard, placement: next, picking: then } });
  },

  confirmImport: () => {
    const wizard = get().wizard;
    const source = wizard?.sha256 ? loaded.get(wizard.sha256) : null;
    if (!wizard || !wizard.source || !source) return false;
    const transform = placementTransform(wizard.placement);
    if (!transform.ok) {
      editor().notify('error', transform.error.message);
      return false;
    }
    const objects = source.summary.objects.filter((object) =>
      wizard.selected.has(object.expressId),
    );
    const added = addIfcModel(editor().project, {
      name: wizard.fileName,
      source: wizard.source,
      schema: source.summary.header.schema,
      lengthUnit: source.summary.lengthUnit.label,
      unitScale: source.summary.lengthUnit.scale,
      importedAt: new Date().toISOString(),
      placementMode: wizard.placement.mode,
      placement: transform.value,
      objects: objects.map((object) => ({
        expressId: object.expressId,
        globalId: object.globalId,
      })),
    });
    if (!added.ok) {
      editor().notify('error', added.error.message);
      return false;
    }
    const without = objects.filter((object) => object.geometry !== 'ok').length;
    const applied = editor().applyOperation(
      ok(added.value.project),
      `Modelo IFC "${wizard.fileName}" importado: ${objects.length.toLocaleString('pt-BR')} objeto(s)${without > 0 ? `, ${without} sem geometria (ver relatório)` : ''}. Objetos importados são referência: não criam conexões hidráulicas.`,
    );
    if (!applied) return false;
    wizardToken += 1;
    set({ wizard: null });
    get().selectModel(added.value.modelId);
    return true;
  },

  select: (id, additive = false) => {
    if (id === null) {
      if (!additive && (get().selection.length > 0 || get().modelSelection)) {
        set({ selection: [], modelSelection: null });
      }
      return;
    }
    if (!findIfcObject(editor().project, id)) return;
    const { selection } = get();
    set({
      modelSelection: null,
      selection: additive
        ? selection.includes(id)
          ? selection.filter((other) => other !== id)
          : [...selection, id]
        : [id],
    });
    claimSelection();
  },

  selectMany: (ids) => {
    const project = editor().project;
    const valid = [...new Set(ids)].filter((id) => findIfcObject(project, id));
    set({ selection: valid, modelSelection: null });
    if (valid.length > 0) claimSelection();
  },

  selectModel: (id) => {
    if (id !== null && !findIfcModel(editor().project, id)) return;
    set({ modelSelection: id, selection: [] });
    if (id !== null) claimSelection();
  },

  cancel: () => {
    const { wizard, selection, modelSelection } = get();
    if (wizard?.step === 'placing' && wizard.picking) {
      set({ wizard: { ...wizard, picking: null } });
      return true;
    }
    if (selection.length > 0 || modelSelection) {
      set({ selection: [], modelSelection: null });
      return true;
    }
    return false;
  },

  setHidden: (ids, hidden) => {
    const current = new Set(get().hidden);
    for (const id of ids) {
      if (hidden) current.add(id);
      else current.delete(id);
    }
    set({ hidden: [...current] });
  },

  isolate: (ids) => {
    const keep = new Set(ids);
    set({
      hidden: editor()
        .project.ifcModels.flatMap((model) => model.objects)
        .map((object) => object.id)
        .filter((id) => !keep.has(id)),
    });
  },

  showAll: () => {
    if (get().hidden.length > 0) set({ hidden: [] });
  },

  moveSelection: (delta) => {
    const { modelIds, objectIds } = targetsOf(get());
    const transform = ifcMoveTransform(delta);
    const project = editor().project;
    if (modelIds.length > 0) {
      return editor().applyOperation(
        transformIfcModels(project, modelIds, transform),
        'Modelo IFC deslocado.',
      );
    }
    if (objectIds.length === 0) return false;
    return editor().applyOperation(
      transformIfcObjects(project, objectIds, transform),
      `${objectIds.length} objeto(s) importado(s) deslocado(s).`,
    );
  },

  rotateSelection: (degrees, pivot = null) => {
    const { modelIds, objectIds } = targetsOf(get());
    const project = editor().project;
    const bounds = ifcBoundsOf(project, { modelIds, objectIds });
    const centre =
      pivot ??
      (bounds
        ? { x: (bounds[0] + bounds[3]) / 2, y: (bounds[1] + bounds[4]) / 2, z: bounds[2] }
        : null);
    if (!centre) {
      editor().notify('error', 'A seleção não tem geometria para definir o centro do giro.');
      return false;
    }
    const transform = ifcRotateTransform(centre, radians(degrees));
    if (modelIds.length > 0) {
      return editor().applyOperation(
        transformIfcModels(project, modelIds, transform),
        'Modelo IFC girado.',
      );
    }
    if (objectIds.length === 0) return false;
    return editor().applyOperation(
      transformIfcObjects(project, objectIds, transform),
      `${objectIds.length} objeto(s) importado(s) girado(s).`,
    );
  },

  copySelection: (delta) => {
    const { objectIds } = targetsOf(get());
    if (objectIds.length === 0) {
      editor().notify(
        'info',
        'Selecione os componentes a copiar (o modelo inteiro é importado de novo pelo arquivo).',
      );
      return false;
    }
    const copied = copyIfcObjects(editor().project, objectIds, ifcMoveTransform(delta));
    if (!copied.ok) {
      editor().notify('error', copied.error.message);
      return false;
    }
    const applied = editor().applyOperation(
      ok(copied.value.project),
      `${copied.value.copyIds.length} cópia(s) criada(s), com identidades internas novas.`,
    );
    if (applied) get().selectMany(copied.value.copyIds);
    return applied;
  },

  removeSelection: () => {
    const { modelIds, objectIds } = targetsOf(get());
    const project = editor().project;
    if (modelIds.length > 0) {
      return editor().applyOperation(
        removeIfcModels(project, modelIds),
        'Modelo IFC removido do projeto.',
      );
    }
    if (objectIds.length === 0) return false;
    return editor().applyOperation(
      removeIfcObjects(project, objectIds),
      `${objectIds.length} objeto(s) importado(s) removido(s).`,
    );
  },

  setModelDisplay: (modelId, patch) =>
    editor().applyOperation(setIfcModelDisplay(editor().project, modelId, patch)),

  relinkSource: async (modelId, { name, bytes }) => {
    const model = findIfcModel(editor().project, modelId);
    if (!model) return false;
    if ((await sha256Hex(bytes)) !== model.source.sha256) {
      editor().notify(
        'error',
        `"${name}" não é o arquivo original deste modelo (o resumo SHA-256 é diferente).`,
      );
      return false;
    }
    const source = await packIfcSource(model.source.fileName, bytes);
    const project = editor().project;
    return editor().applyOperation(
      ok({
        ...project,
        ifcModels: project.ifcModels.map((candidate) =>
          candidate.source.sha256 === source.sha256 ? { ...candidate, source } : candidate,
        ),
      }),
      `Arquivo-fonte de "${model.name}" religado ao projeto.`,
    );
  },
}));

// --- Consultas ------------------------------------------------------------------------------

/** Envoltória, no projeto, de modelos e objetos importados (só o que tem geometria lida). */
export function ifcBoundsOf(
  project: Project,
  filter: { modelIds?: readonly string[]; objectIds?: readonly string[] } | null = null,
  options: { visibleOnly?: boolean } = {},
): IfcBounds | null {
  const models = filter?.modelIds ? new Set(filter.modelIds) : null;
  const objects = filter?.objectIds ? new Set(filter.objectIds) : null;
  const restricted = (models?.size ?? 0) + (objects?.size ?? 0) > 0;
  const hidden = options.visibleOnly ? new Set(useIfcStore.getState().hidden) : null;
  let bounds: IfcBounds | null = null;
  for (const model of project.ifcModels) {
    if (options.visibleOnly && !model.visible) continue;
    const source = loaded.get(model.source.sha256);
    if (!source) continue;
    const whole = !restricted || models?.has(model.id) === true;
    for (const object of model.objects) {
      if (!whole && objects?.has(object.id) !== true) continue;
      if (hidden?.has(object.id)) continue;
      const local = source.objects.get(object.expressId)?.bounds;
      if (local)
        bounds = unionBounds(bounds, transformBounds(local, ifcObjectTransform(model, object)));
    }
  }
  return bounds;
}

/** Envoltória da seleção atual de objetos importados. */
export function ifcSelectionBounds(): IfcBounds | null {
  const state = useIfcStore.getState();
  const { modelIds, objectIds } = targetsOf(state);
  if (modelIds.length + objectIds.length === 0) return null;
  return ifcBoundsOf(editor().project, { modelIds, objectIds });
}

/** Propriedades de um objeto importado, lidas da fonte. */
export async function fetchIfcProperties(
  model: IfcImportedModel,
  expressId: number,
): Promise<IfcObjectProperties | null> {
  const host = hosts.get(model.source.sha256);
  if (!host || !loaded.has(model.source.sha256)) return null;
  return host.properties(expressId);
}

/** Há objeto importado selecionado (modelo inteiro ou componentes)? */
export const hasIfcSelection = (state: Pick<IfcState, 'selection' | 'modelSelection'>): boolean =>
  state.selection.length > 0 || state.modelSelection !== null;

// --- Sincronia com o editor ----------------------------------------------------------------

useEditorStore.subscribe((state, previous) => {
  const ifc = useIfcStore.getState();
  // Seleção exclusiva: selecionar na rede (ou uma anotação) limpa a dos importados.
  if (
    hasIfcSelection(ifc) &&
    ((state.selection !== previous.selection && state.selection.length > 0) ||
      (state.annotationSelection !== null && previous.annotationSelection === null))
  ) {
    useIfcStore.setState({ selection: [], modelSelection: null });
  }
  if (state.project === previous.project) return;
  if (state.project.id !== previous.project.id) {
    // Outro projeto: o assistente em andamento e a sessão anterior não valem.
    wizardToken += 1;
    useIfcStore.setState({ wizard: null, selection: [], modelSelection: null, hidden: [] });
  }
  if (state.project.ifcModels === previous.project.ifcModels) return;
  syncSources(state.project);
  // Desfazer, refazer e remover podem levar embora o que estava selecionado ou oculto.
  const current = useIfcStore.getState();
  const objectIds = new Set(
    state.project.ifcModels.flatMap((model) => model.objects.map((object) => object.id)),
  );
  const selection = current.selection.filter((id) => objectIds.has(id));
  const hidden = current.hidden.filter((id) => objectIds.has(id));
  const modelSelection =
    current.modelSelection && findIfcModel(state.project, current.modelSelection)
      ? current.modelSelection
      : null;
  if (
    selection.length !== current.selection.length ||
    hidden.length !== current.hidden.length ||
    modelSelection !== current.modelSelection
  ) {
    useIfcStore.setState({ selection, hidden, modelSelection });
  }
});

useArchStore.subscribe((state) => {
  if (state.selection.length > 0 && hasIfcSelection(useIfcStore.getState())) {
    useIfcStore.setState({ selection: [], modelSelection: null });
  }
});

useEarthworkStore.subscribe((state) => {
  if (state.selection && hasIfcSelection(useIfcStore.getState())) {
    useIfcStore.setState({ selection: [], modelSelection: null });
  }
});

syncSources(editor().project);
