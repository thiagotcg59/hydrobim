import {
  fail,
  getElement,
  setElementIfcValue,
  setIfcTypeValue,
  type Project,
  type Result,
} from '@hydrobim/core';
import { definitionApplies, elementClass, findDefinition } from './definitions';
import { classifyElement, ifcTypeKey } from './model';
import type { IfcFamilyInfo, IfcScope, IfcValue } from './types';
import { checkIfcValue } from './values';

export interface IfcValueTarget {
  /** Elemento selecionado; nos valores de tipo, identifica o tipo a que pertence. */
  readonly elementId: string;
  readonly scope: IfcScope;
}

/**
 * Informa (ou limpa, com `null`) o valor de uma propriedade IFC editável.
 *
 * - `occurrence`: o valor fica no elemento (`element.ifc`);
 * - `type`: o valor fica no tipo (`project.ifcTypes`) e vale para todas as ocorrências do
 *   mesmo tipo, inclusive as criadas depois.
 *
 * Só altera dados cadastrais: propriedades ligadas à geometria ou ao catálogo não são
 * editáveis aqui, e nada na geometria muda. A chave `Description` (ocorrência) substitui a
 * descrição gerada do elemento.
 */
export function setIfcValue(
  project: Project,
  target: IfcValueTarget,
  key: string,
  value: IfcValue | null,
  families: readonly IfcFamilyInfo[] = [],
): Result<Project> {
  const element = getElement(project, target.elementId);
  if (!element) return fail('ELEMENT_NOT_FOUND', 'Elemento inexistente.');

  if (key === 'Description' && target.scope === 'occurrence') {
    if (value !== null && typeof value !== 'string')
      return fail('IFC_VALUE_INVALID', 'Descrição: o valor deve ser um texto.');
    const text = value?.trim() ?? '';
    return setElementIfcValue(project, element.id, key, text.length ? text : undefined);
  }

  const definition = findDefinition(key, target.scope, elementClass(element));
  const context = {
    element,
    classification: classifyElement(element),
    family: families.find((family) => family.id === element.familyId),
  };
  if (!definition || !definitionApplies(definition, context))
    return fail(
      'IFC_PROPERTY_NOT_APPLICABLE',
      `A propriedade ${key} não se aplica a "${element.name}".`,
    );
  if (!definition.editable)
    return fail(
      'IFC_PROPERTY_NOT_EDITABLE',
      `${definition.label} é derivada do modelo${definition.binding ? ` (${definition.binding})` : ''} e não pode ser editada aqui.`,
    );
  if (value !== null) {
    const stored = typeof value === 'string' ? value.trim() : value;
    const problem = checkIfcValue(definition, stored);
    if (problem) return fail('IFC_VALUE_INVALID', `${definition.label}: ${problem}.`);
    return target.scope === 'type'
      ? setIfcTypeValue(project, ifcTypeKey(element), key, stored)
      : setElementIfcValue(project, element.id, key, stored);
  }
  return target.scope === 'type'
    ? setIfcTypeValue(project, ifcTypeKey(element), key, undefined)
    : setElementIfcValue(project, element.id, key, undefined);
}
