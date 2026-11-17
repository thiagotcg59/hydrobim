import { describe, expect, it } from 'vitest';
import { createDemoProject } from '../demo/demoProject';
import {
  LocalStorageProjectRepository,
  MemoryStorage,
  type KeyValueStorage,
} from './LocalStorageProjectRepository';

describe('repositório local de projetos', () => {
  it('salva, lista, reabre e remove projetos sem perda', async () => {
    const repository = new LocalStorageProjectRepository(new MemoryStorage());
    const project = createDemoProject();
    expect(await repository.list()).toEqual([]);

    const saved = await repository.save(project);
    expect(saved.ok).toBe(true);
    expect(await repository.getLastOpenedId()).toBe(project.id);
    const list = await repository.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.elementCount).toBe(project.elements.length);

    const loaded = await repository.load(project.id);
    expect(loaded.ok && loaded.value).toEqual(project);

    // Salvar novamente substitui a entrada, sem duplicar.
    await repository.save({ ...project, name: 'Renomeado' });
    expect((await repository.list()).map((p) => p.name)).toEqual(['Renomeado']);

    await repository.remove(project.id);
    expect(await repository.list()).toEqual([]);
    expect(await repository.getLastOpenedId()).toBeNull();
    const missing = await repository.load(project.id);
    expect(missing.ok ? '' : missing.error.code).toBe('NOT_FOUND');
  });

  it('recusa conteúdo corrompido e tolera índice ilegível', async () => {
    const storage = new MemoryStorage();
    storage.setItem('hydrobim:project:x', '{ corrompido');
    storage.setItem('hydrobim:projects:index', 'isto não é JSON');
    const repository = new LocalStorageProjectRepository(storage);
    const loaded = await repository.load('x');
    expect(loaded.ok ? '' : loaded.error.code).toBe('INVALID_JSON');
    expect(await repository.list()).toEqual([]);
  });

  it('informa falha de armazenamento (cota excedida) sem lançar exceção', async () => {
    const full: KeyValueStorage = {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const result = await new LocalStorageProjectRepository(full).save(createDemoProject());
    expect(result.ok ? '' : result.error.code).toBe('STORAGE_ERROR');
  });
});
