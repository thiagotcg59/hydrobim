import { attachIfcSources, fail, stripIfcSources, type Project, type Result } from '@hydrobim/core';
import type { ProjectRepository, ProjectSummary } from './ProjectRepository';

/**
 * Arquivos-fonte IFC no armazenamento do navegador.
 *
 * O arquivo do projeto baixado (`.hydrobim.json`) sempre leva as fontes embutidas — é ele o
 * formato portátil. Já a cópia de trabalho "salva no navegador" fica no `localStorage`, que
 * não comporta arquivos de dezenas de megabytes: nela as fontes saem do documento e vão para
 * o IndexedDB, identificadas pelo SHA-256, e voltam ao abrir. Se o IndexedDB tiver sido
 * limpo, o projeto abre mesmo assim e o modelo pede o arquivo original para ser religado.
 */
export interface IfcSourceStore {
  put(sha256: string, data: string): Promise<void>;
  get(sha256: string): Promise<string | null>;
}

const DATABASE = 'hydrobim-ifc-sources';
const STORE = 'sources';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB indisponível.'));
    request.onblocked = () => reject(new Error('IndexedDB bloqueado por outra aba.'));
  });
}

export class IndexedDbIfcSourceStore implements IfcSourceStore {
  async put(sha256: string, data: string): Promise<void> {
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE, 'readwrite');
        transaction.objectStore(STORE).put(data, sha256);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Falha ao gravar.'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Gravação cancelada.'));
      });
    } finally {
      database.close();
    }
  }

  async get(sha256: string): Promise<string | null> {
    const database = await openDatabase();
    try {
      return await new Promise<string | null>((resolve, reject) => {
        const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(sha256);
        request.onsuccess = () =>
          resolve(typeof request.result === 'string' ? request.result : null);
        request.onerror = () => reject(request.error ?? new Error('Falha ao ler.'));
      });
    } finally {
      database.close();
    }
  }
}

/** Armazenamento em memória (testes e navegadores sem IndexedDB). */
export class MemoryIfcSourceStore implements IfcSourceStore {
  private readonly data = new Map<string, string>();
  async put(sha256: string, data: string): Promise<void> {
    this.data.set(sha256, data);
  }
  async get(sha256: string): Promise<string | null> {
    return this.data.get(sha256) ?? null;
  }
}

export function createDefaultIfcSourceStore(): IfcSourceStore {
  return typeof indexedDB === 'undefined'
    ? new MemoryIfcSourceStore()
    : new IndexedDbIfcSourceStore();
}

/**
 * Repositório que guarda as fontes IFC à parte: o documento do projeto vai sem elas ao
 * repositório interno e as recebe de volta ao abrir.
 */
export function withIfcSources(
  inner: ProjectRepository,
  sources: IfcSourceStore,
): ProjectRepository {
  return {
    list: () => inner.list(),
    remove: (id) => inner.remove(id),
    getLastOpenedId: () => inner.getLastOpenedId(),
    setLastOpenedId: (id) => inner.setLastOpenedId(id),

    async save(project: Project): Promise<Result<ProjectSummary>> {
      const pending = new Map<string, string>();
      for (const model of project.ifcModels) {
        if (model.source.data !== '') pending.set(model.source.sha256, model.source.data);
      }
      try {
        for (const [sha256, data] of pending) await sources.put(sha256, data);
      } catch (error) {
        console.error('[HydroBIM] Falha ao guardar o arquivo-fonte IFC.', error);
        return fail(
          'STORAGE_ERROR',
          'Não foi possível guardar os arquivos-fonte IFC no navegador (armazenamento cheio ou bloqueado). Use "Baixar arquivo": ele leva os modelos importados completos.',
        );
      }
      return inner.save(stripIfcSources(project));
    },

    async load(id: string): Promise<Result<Project>> {
      const loaded = await inner.load(id);
      if (!loaded.ok) return loaded;
      const found = new Map<string, string>();
      for (const model of loaded.value.ifcModels) {
        const sha256 = model.source.sha256;
        if (model.source.data !== '' || found.has(sha256)) continue;
        try {
          const data = await sources.get(sha256);
          if (data) found.set(sha256, data);
        } catch (error) {
          // Sem a fonte o projeto abre do mesmo jeito; o modelo fica pedindo o arquivo original.
          console.warn('[HydroBIM] Arquivo-fonte IFC não recuperado do navegador.', error);
        }
      }
      return { ok: true, value: attachIfcSources(loaded.value, found) };
    },
  };
}
