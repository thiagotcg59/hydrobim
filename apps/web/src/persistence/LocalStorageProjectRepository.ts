import {
  fail,
  ok,
  parseProject,
  serializeProject,
  type Project,
  type Result,
} from '@hydrobim/core';
import { summarize, type ProjectRepository, type ProjectSummary } from './ProjectRepository';

const INDEX_KEY = 'hydrobim:projects:index';
const LAST_KEY = 'hydrobim:projects:last';
const projectKey = (id: string): string => `hydrobim:project:${id}`;

/** Subconjunto de `Storage` necessário (permite injetar um armazenamento de teste). */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isSummary(value: unknown): value is ProjectSummary {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.updatedAt === 'string' &&
    typeof v.elementCount === 'number' &&
    (v.discipline === 'mep' || v.discipline === 'infra')
  );
}

export class LocalStorageProjectRepository implements ProjectRepository {
  constructor(private readonly storage: KeyValueStorage) {}

  private readIndex(): ProjectSummary[] {
    try {
      const raw = this.storage.getItem(INDEX_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isSummary) : [];
    } catch (error) {
      console.error('[HydroBIM] Índice de projetos ilegível; será recriado.', error);
      return [];
    }
  }

  async list(): Promise<ProjectSummary[]> {
    return this.readIndex().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async load(id: string): Promise<Result<Project>> {
    let raw: string | null;
    try {
      raw = this.storage.getItem(projectKey(id));
    } catch (error) {
      console.error('[HydroBIM] Falha ao ler o armazenamento local.', error);
      return fail('STORAGE_ERROR', 'Não foi possível ler o armazenamento local do navegador.');
    }
    if (raw === null) return fail('NOT_FOUND', 'Projeto não encontrado no armazenamento local.');
    return parseProject(raw);
  }

  async save(project: Project): Promise<Result<ProjectSummary>> {
    const summary = summarize(project);
    try {
      this.storage.setItem(projectKey(project.id), serializeProject(project));
      const index = this.readIndex().filter((p) => p.id !== project.id);
      this.storage.setItem(INDEX_KEY, JSON.stringify([...index, summary]));
      this.storage.setItem(LAST_KEY, project.id);
    } catch (error) {
      console.error('[HydroBIM] Falha ao salvar o projeto.', error);
      return fail(
        'STORAGE_ERROR',
        'Não foi possível salvar no navegador (armazenamento cheio ou bloqueado). Use "Exportar JSON".',
      );
    }
    return ok(summary);
  }

  async remove(id: string): Promise<void> {
    try {
      this.storage.removeItem(projectKey(id));
      this.storage.setItem(INDEX_KEY, JSON.stringify(this.readIndex().filter((p) => p.id !== id)));
      if (this.storage.getItem(LAST_KEY) === id) this.storage.removeItem(LAST_KEY);
    } catch (error) {
      console.error('[HydroBIM] Falha ao remover o projeto.', error);
    }
  }

  async getLastOpenedId(): Promise<string | null> {
    try {
      return this.storage.getItem(LAST_KEY);
    } catch {
      return null;
    }
  }

  async setLastOpenedId(id: string | null): Promise<void> {
    try {
      if (id === null) this.storage.removeItem(LAST_KEY);
      else this.storage.setItem(LAST_KEY, id);
    } catch (error) {
      console.error('[HydroBIM] Falha ao registrar o último projeto.', error);
    }
  }
}

/** Armazenamento em memória, usado quando o `localStorage` não está disponível. */
export class MemoryStorage implements KeyValueStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

export function createDefaultRepository(): ProjectRepository {
  try {
    const storage = globalThis.localStorage;
    storage.setItem('hydrobim:probe', '1');
    storage.removeItem('hydrobim:probe');
    return new LocalStorageProjectRepository(storage);
  } catch {
    console.warn('[HydroBIM] localStorage indisponível; os projetos não serão persistidos.');
    return new LocalStorageProjectRepository(new MemoryStorage());
  }
}
