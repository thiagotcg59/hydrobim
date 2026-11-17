import { parseProject } from '@hydrobim/core';
import { createDemoProject } from '../demo/demoProject';
import { downloadProject, readFileAsText } from '../persistence/fileIO';
import { createDefaultRepository } from '../persistence/LocalStorageProjectRepository';
import type { ProjectRepository } from '../persistence/ProjectRepository';
import { selectIsDirty, useEditorStore } from './editorStore';

/**
 * Casos de uso de projeto (novo, abrir, salvar, exportar), ligando a store do editor
 * ao repositório de persistência.
 */

export const repository: ProjectRepository = createDefaultRepository();

const store = () => useEditorStore.getState();

export function confirmDiscard(): boolean {
  if (!selectIsDirty(store())) return true;
  return window.confirm('Há alterações não salvas neste projeto. Deseja descartá-las?');
}

export async function saveCurrentProject(): Promise<boolean> {
  const { project } = store();
  const result = await repository.save(project);
  if (!result.ok) {
    store().notify('error', result.error.message);
    return false;
  }
  store().markSaved();
  store().notify('success', `Projeto "${project.name}" salvo no navegador.`);
  return true;
}

export async function openStoredProject(id: string): Promise<boolean> {
  const result = await repository.load(id);
  if (!result.ok) {
    store().notify('error', result.error.message);
    return false;
  }
  store().loadProject(result.value, { saved: true });
  await repository.setLastOpenedId(id);
  store().notify('success', `Projeto "${result.value.name}" aberto.`);
  return true;
}

export async function importProjectFile(file: File): Promise<boolean> {
  let text: string;
  try {
    text = await readFileAsText(file);
  } catch (error) {
    console.error('[HydroBIM] Falha ao ler o arquivo.', error);
    store().notify('error', 'Não foi possível ler o arquivo selecionado.');
    return false;
  }
  const result = parseProject(text);
  if (!result.ok) {
    store().notify('error', `${file.name}: ${result.error.message}`);
    return false;
  }
  if (!confirmDiscard()) return false;
  store().loadProject(result.value);
  store().notify(
    'success',
    `Projeto "${result.value.name}" importado (${result.value.elements.length} elementos).`,
  );
  return true;
}

export function exportCurrentProject(): void {
  try {
    downloadProject(store().project);
    store().notify('success', 'Arquivo JSON do projeto exportado.');
  } catch (error) {
    console.error('[HydroBIM] Falha ao exportar.', error);
    store().notify('error', 'Não foi possível exportar o projeto.');
  }
}

export function openDemoProject(): void {
  try {
    store().loadProject(createDemoProject());
    store().notify('info', 'Projeto de demonstração carregado.');
  } catch (error) {
    console.error('[HydroBIM] Falha ao criar o projeto de demonstração.', error);
    store().notify('error', 'Não foi possível criar o projeto de demonstração.');
  }
}

/** Na inicialização: reabre o último projeto salvo ou carrega a demonstração. */
export async function restoreSession(): Promise<void> {
  const lastId = await repository.getLastOpenedId();
  if (lastId) {
    const result = await repository.load(lastId);
    if (result.ok) {
      store().loadProject(result.value, { saved: true });
      store().notify('info', `Projeto "${result.value.name}" reaberto.`);
      return;
    }
    console.warn('[HydroBIM] Último projeto não pôde ser reaberto:', result.error.message);
  }
  openDemoProject();
}
