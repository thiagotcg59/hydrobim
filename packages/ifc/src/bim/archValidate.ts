import { buildArchIfcModel, type ArchIfcModel } from './archModel';
import { IFC_ENTITIES, IFC_PROPERTY_SETS } from './schemaData';
import type { IfcPropertySetInfo } from './types';
import { isSetApplicable, type IfcIssue } from './validate';
import { checkIfcValue } from './values';

/**
 * Validação do modelo de informação IFC da ARQUITETURA contra o esquema IFC 4.3: entidade e
 * tipo predefinido existentes, atributos enumerados válidos, conjuntos padronizados
 * aplicáveis à entidade, propriedades e tipos de valor do esquema, valores coerentes.
 *
 * Só há requisitos NORMATIVOS (`schema`): a arquitetura não exige nenhuma propriedade por
 * padrão — propriedade sem valor é dado pendente, não erro. A integridade geométrica (vãos
 * dentro das paredes, contornos válidos) é do núcleo (`validateProject`).
 */

const QUANTITY_KINDS: Record<string, string> = {
  IfcQuantityLength: 'Q_LENGTH',
  IfcQuantityArea: 'Q_AREA',
  IfcQuantityVolume: 'Q_VOLUME',
  IfcQuantityCount: 'Q_COUNT',
  IfcQuantityWeight: 'Q_WEIGHT',
};

export function validateArchIfcModel(model: ArchIfcModel): IfcIssue[] {
  const issues: IfcIssue[] = [];
  const issue = (
    code: string,
    message: string,
    elementId: string | null,
    typeKey: string | null,
    property: string | null = null,
  ): void => {
    issues.push({
      level: 'schema',
      severity: 'error',
      code,
      message,
      elementId,
      typeKey,
      property,
    });
  };

  const checkSets = (
    sets: readonly IfcPropertySetInfo[],
    entity: string,
    predefinedType: string,
    label: string,
    elementId: string | null,
    typeKey: string | null,
  ): void => {
    for (const set of sets) {
      if (!set.standard) {
        if (!set.name.startsWith('HydroBIM_'))
          issue(
            'IFC_SET_PREFIX',
            `${label}: o conjunto próprio ${set.name} deve usar o prefixo HydroBIM_.`,
            elementId,
            typeKey,
          );
        continue;
      }
      const template = IFC_PROPERTY_SETS[set.name];
      if (!template) {
        issue(
          'IFC_SET_UNKNOWN',
          `${label}: ${set.name} não existe no IFC 4.3.`,
          elementId,
          typeKey,
        );
        continue;
      }
      if (!isSetApplicable(set.name, entity, predefinedType))
        issue(
          'IFC_SET_NOT_APPLICABLE',
          `${label}: ${set.name} não se aplica a ${entity}.`,
          elementId,
          typeKey,
        );
      for (const property of set.properties) {
        const expected = template.properties[property.name];
        if (!expected) {
          issue(
            'IFC_PROPERTY_UNKNOWN',
            `${label}: ${property.key} não existe no IFC 4.3.`,
            elementId,
            typeKey,
            property.key,
          );
          continue;
        }
        const matches =
          property.kind === 'quantity'
            ? QUANTITY_KINDS[property.ifcType] === expected.kind
            : expected.type === property.ifcType;
        if (!matches)
          issue(
            'IFC_PROPERTY_TYPE',
            `${label}: ${property.key} tem tipo de valor diferente do esquema.`,
            elementId,
            typeKey,
            property.key,
          );
        if (property.value !== null) {
          const problem = checkIfcValue(property, property.value);
          if (problem)
            issue(
              'IFC_VALUE_INVALID',
              `${label}: ${property.label} — ${problem}.`,
              elementId,
              typeKey,
              property.key,
            );
        }
      }
    }
  };

  const checkClassification = (
    entity: string,
    predefinedType: string,
    attributes: Readonly<Record<string, unknown>>,
    label: string,
    elementId: string | null,
    typeKey: string | null,
  ): void => {
    const definition = IFC_ENTITIES[entity];
    if (!definition) {
      issue('IFC_ENTITY_UNKNOWN', `${label}: ${entity} não existe no IFC 4.3.`, elementId, typeKey);
      return;
    }
    if (!definition.predefinedTypes.includes(predefinedType))
      issue(
        'IFC_PREDEFINED_TYPE',
        `${label}: ${predefinedType} não é um tipo predefinido de ${entity}.`,
        elementId,
        typeKey,
      );
    for (const [name, values] of Object.entries(definition.attributeEnumerations ?? {})) {
      const value = attributes[name];
      if (value !== undefined && !values.includes(String(value)))
        issue(
          'IFC_ATTRIBUTE_VALUE',
          `${label}: ${String(value)} não é um valor de ${name} em ${entity}.`,
          elementId,
          typeKey,
        );
      if (value === 'USERDEFINED' && attributes[`UserDefined${name}`] === undefined)
        issue(
          'IFC_USERDEFINED_WITHOUT_TEXT',
          `${label}: ${name} USERDEFINED exige a descrição em UserDefined${name}.`,
          elementId,
          typeKey,
        );
    }
  };

  for (const element of model.elements) {
    const label = `"${element.name}"`;
    checkClassification(
      element.entity,
      element.predefinedType,
      element.attributes,
      label,
      element.elementId,
      null,
    );
    checkSets(
      element.psets,
      element.entity,
      element.predefinedType,
      label,
      element.elementId,
      null,
    );
  }
  for (const type of model.types) {
    const label = `tipo "${type.name}"`;
    checkClassification(type.entity, type.predefinedType, type.attributes, label, null, type.key);
    checkSets(type.psets, type.entity, type.predefinedType, label, null, type.key);
  }
  return issues;
}

/** Validação direta a partir do projeto. */
export const validateArchIfc = (project: Parameters<typeof buildArchIfcModel>[0]): IfcIssue[] =>
  validateArchIfcModel(buildArchIfcModel(project));
