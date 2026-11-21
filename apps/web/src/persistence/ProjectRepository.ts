import type { Discipline, Project, Result } from '@hydrobim/core';

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly discipline: Discipline;
  readonly updatedAt: string;
  readonly elementCount: number;
}

/**
 * Abstração de persistência de projetos. A implementação atual usa o armazenamento
 * local do navegador; uma implementação sobre a API (PostgreSQL) poderá substituí-la
 * sem alterar a interface do editor.
 */
export interface ProjectRepository {
  list(): Promise<ProjectSummary[]>;
  load(id: string): Promise<Result<Project>>;
  save(project: Project): Promise<Result<ProjectSummary>>;
  remove(id: string): Promise<void>;
  /** Identificador do último projeto aberto/salvo, se houver. */
  getLastOpenedId(): Promise<string | null>;
  setLastOpenedId(id: string | null): Promise<void>;
}

export function summarize(project: Project): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    discipline: project.discipline,
    updatedAt: project.updatedAt,
    // Elementos da rede e da arquitetura: o mesmo projeto guarda os dois.
    elementCount: project.elements.length + project.architecture.elements.length,
  };
}
