import type { Project } from '@hydrobim/core';
import {
  buildIfcModel,
  conformityOf,
  issuesOfElement,
  validateIfcModel,
  type IfcConformity,
  type IfcIssue,
  type IfcModel,
} from '@hydrobim/ifc';
import { ifcOptionsOf, useEditorStore } from './editorStore';

export interface IfcState {
  readonly model: IfcModel;
  readonly issues: readonly IfcIssue[];
  /** Situação de cada elemento (problemas da ocorrência e do tipo a que pertence). */
  readonly conformity: ReadonlyMap<string, IfcConformity>;
}

/**
 * O modelo IFC é derivado do projeto (imutável): calculado uma vez por versão do projeto e
 * compartilhado pela árvore, pelo painel e pela barra de status.
 */
const cache = new WeakMap<Project, IfcState>();

export function ifcStateOf(project: Project): IfcState {
  const cached = cache.get(project);
  if (cached) return cached;
  const model = buildIfcModel(project, ifcOptionsOf(project));
  const issues = validateIfcModel(project, model);
  const conformity = new Map(
    model.elements.map((element) => [
      element.elementId,
      conformityOf(issuesOfElement(issues, element.elementId, element.typeKey)),
    ]),
  );
  const state: IfcState = { model, issues, conformity };
  cache.set(project, state);
  return state;
}

/** Modelo de informação IFC do projeto aberto. */
export function useIfcState(): IfcState {
  return ifcStateOf(useEditorStore((s) => s.project));
}
