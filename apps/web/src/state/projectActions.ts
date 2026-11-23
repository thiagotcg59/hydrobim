import { FLANGED_PIPE_FAMILIES } from '@hydrobim/catalog';
import {
  computeQuantities,
  createTerrain,
  exportEpanet,
  parseProject,
  parseTerrainPoints,
  quantitiesToCsv,
  surveySource,
  type Project,
} from '@hydrobim/core';
import { encodeDxf, exportModelDxf } from '@hydrobim/dxf';
import { exportIds, exportIfc } from '@hydrobim/ifc';
import { createBuildingDemoProject } from '../demo/buildingDemo';
import { createDemoProject } from '../demo/demoProject';
import {
  downloadProject,
  downloadText,
  projectFileBase,
  readFileAsText,
} from '../persistence/fileIO';
import { createDefaultIfcSourceStore, withIfcSources } from '../persistence/ifcSourceStore';
import { createDefaultRepository } from '../persistence/LocalStorageProjectRepository';
import type { ProjectRepository } from '../persistence/ProjectRepository';
import { familiesOf, ifcOptionsOf, selectIsDirty, useEditorStore } from './editorStore';

/**
 * Casos de uso de projeto (novo, abrir, salvar, exportar), ligando a store do editor
 * ao repositório de persistência.
 */

// Os arquivos-fonte IFC dos modelos importados não cabem no armazenamento do documento:
// vão para o IndexedDB e voltam ao abrir (o arquivo baixado sempre os leva embutidos).
export const repository: ProjectRepository = withIfcSources(
  createDefaultRepository(),
  createDefaultIfcSourceStore(),
);

/** Aviso das exportações que não levam os objetos IFC importados. */
export function importedIfcNote(project: Project): string {
  const count = project.ifcModels.length;
  return count === 0
    ? ''
    : ` Atenção: ${count === 1 ? 'o modelo IFC importado não entra' : `os ${count} modelos IFC importados não entram`} nesta exportação (só o arquivo do projeto os leva).`;
}

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
    `Projeto "${result.value.name}" importado (${result.value.elements.length} elementos${
      result.value.ifcModels.length > 0
        ? `, ${result.value.ifcModels.length} modelo(s) IFC importado(s)`
        : ''
    }).`,
  );
  return true;
}

export function exportCurrentProject(): void {
  try {
    downloadProject(store().project);
    const models = store().project.ifcModels.length;
    store().notify(
      'success',
      models > 0
        ? `Arquivo do projeto exportado, com ${models} modelo(s) IFC importado(s) e os arquivos-fonte embutidos.`
        : 'Arquivo JSON do projeto exportado.',
    );
  } catch (error) {
    console.error('[HydroBIM] Falha ao exportar.', error);
    store().notify('error', 'Não foi possível exportar o projeto.');
  }
}

/** Exporta o modelo em IFC 4.3 (gerado no navegador, sem servidor). */
export function exportIfcFile(): void {
  const { project } = store();
  if (project.elements.length + project.architecture.elements.length === 0) {
    store().notify('error', 'O projeto não tem elementos para exportar.');
    return;
  }
  try {
    // As mesmas famílias da aba BIM / IFC: o arquivo grava o que o painel mostra.
    const text = exportIfc(project, {
      timestamp: new Date(),
      application: 'HydroBIM',
      ...ifcOptionsOf(project),
    });
    downloadText(`${projectFileBase(project)}.ifc`, text, 'application/x-step');
    store().notify(
      'success',
      `IFC 4.3 exportado (${project.elements.length + project.architecture.elements.length} elementos).${importedIfcNote(project)}`,
    );
  } catch (error) {
    console.error('[HydroBIM] Falha na exportação IFC.', error);
    store().notify('error', 'Não foi possível exportar o IFC.');
  }
}

/** Exporta o perfil de requisitos de informação do projeto em IDS 1.0 (buildingSMART). */
export function exportIdsFile(): void {
  const { project } = store();
  try {
    downloadText(
      `${projectFileBase(project)}-requisitos.ids`,
      exportIds({ date: new Date().toISOString().slice(0, 10) }),
      'application/xml',
    );
    store().notify('success', 'Requisitos de informação exportados em IDS 1.0.');
  } catch (error) {
    console.error('[HydroBIM] Falha na exportação IDS.', error);
    store().notify('error', 'Não foi possível exportar o IDS.');
  }
}

/** Exporta o modelo 3D em DXF (malhas em metros, uma camada por sistema). */
export function exportModelDxfFile(): void {
  const { project } = store();
  if (project.elements.length === 0) {
    store().notify('error', 'O projeto não tem elementos para exportar.');
    return;
  }
  try {
    downloadText(
      `${projectFileBase(project)}-3d.dxf`,
      encodeDxf(exportModelDxf(project)),
      'application/dxf',
    );
    store().notify(
      'success',
      `Modelo 3D exportado em DXF (${project.elements.length} elementos, unidades em metros).${importedIfcNote(project)}`,
    );
  } catch (error) {
    console.error('[HydroBIM] Falha na exportação DXF.', error);
    store().notify('error', 'Não foi possível exportar o DXF.');
  }
}

/** Exporta o quantitativo (lista de materiais) em CSV. */
export function exportQuantitiesFile(): void {
  const { project } = store();
  const rows = computeQuantities(project, [...familiesOf(project), ...FLANGED_PIPE_FAMILIES]);
  if (rows.length === 0) {
    store().notify('error', 'O projeto não tem elementos para quantificar.');
    return;
  }
  downloadText(`${projectFileBase(project)}-quantitativo.csv`, quantitiesToCsv(rows), 'text/csv');
  store().notify(
    'success',
    `Quantitativo exportado (${rows.length} linhas).${importedIfcNote(project)}`,
  );
}

/** Exporta a rede no formato INP do EPANET. */
export function exportEpanetFile(): void {
  const { project } = store();
  if (project.elements.length === 0) {
    store().notify('error', 'O projeto não tem elementos para exportar.');
    return;
  }
  const { inp, warnings } = exportEpanet(project);
  downloadText(`${projectFileBase(project)}.inp`, inp, 'text/plain');
  store().notify(
    'info',
    `EPANET exportado. Atenção: ${warnings.join(' ')}${importedIfcNote(project)}`,
  );
}

/** Importa um terreno a partir de um arquivo de pontos "X Y Z". */
export async function importTerrainFile(file: File): Promise<boolean> {
  let text: string;
  try {
    text = await readFileAsText(file);
  } catch (error) {
    console.error('[HydroBIM] Falha ao ler o arquivo de terreno.', error);
    store().notify('error', 'Não foi possível ler o arquivo selecionado.');
    return false;
  }
  const points = parseTerrainPoints(text);
  if (!points.ok) {
    store().notify('error', `${file.name}: ${points.error.message}`);
    return false;
  }
  const terrain = createTerrain(
    file.name.replace(/\.[^.]+$/, ''),
    points.value,
    surveySource(file.name, new Date().toISOString()),
  );
  if (!terrain.ok) {
    store().notify('error', `${file.name}: ${terrain.error.message}`);
    return false;
  }
  store().setTerrain(terrain.value);
  return true;
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

/** Demonstração da arquitetura: edificação simples com uma prumada de água fria. */
export function openBuildingDemoProject(): void {
  try {
    store().loadProject(createBuildingDemoProject());
    store().notify('info', 'Demonstração "Edificação simples" carregada.');
  } catch (error) {
    console.error('[HydroBIM] Falha ao criar a edificação de demonstração.', error);
    store().notify('error', 'Não foi possível criar a edificação de demonstração.');
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
