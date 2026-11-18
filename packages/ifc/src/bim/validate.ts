import { distance, dot, POSITION_TOLERANCE, type Project } from '@hydrobim/core';
import { elementClass, findDefinition } from './definitions';
import { IFC_ENTITIES, IFC_PROPERTY_SETS } from './schemaData';
import type { IfcModel, IfcPropertySetInfo } from './types';
import { checkIfcValue } from './values';

/**
 * Validação do modelo de informação IFC.
 *
 * - `schema`: requisito NORMATIVO do IFC 4.3 (entidades, tipos predefinidos, conjuntos
 *   padronizados, tipos de valor, identificadores, conectividade);
 * - `project`: requisito ADICIONAL do perfil do projeto (propriedades exigidas, valores
 *   informados pelo usuário que deixaram de se aplicar, coerência das quantidades).
 */
export type IfcIssueLevel = 'schema' | 'project';
/** `pending` = informação exigida ainda não informada (não é erro do modelo). */
export type IfcIssueSeverity = 'error' | 'warning' | 'pending';

export interface IfcIssue {
  readonly level: IfcIssueLevel;
  readonly severity: IfcIssueSeverity;
  /** Código estável (testes e filtros). */
  readonly code: string;
  readonly message: string;
  readonly elementId: string | null;
  /** Problema do tipo: vale para todas as ocorrências com esta chave. */
  readonly typeKey: string | null;
  /** `Conjunto.Propriedade`, quando o problema é de uma propriedade. */
  readonly property: string | null;
}

export type IfcConformity = 'conforming' | 'pending' | 'invalid';

export const IFC_CONFORMITY_LABELS: Record<IfcConformity, string> = {
  conforming: 'Conforme',
  pending: 'Com pendências',
  invalid: 'Não conforme',
};

const GUID = /^[0-3][0-9A-Za-z_$]{21}$/;

/** O conjunto padronizado é aplicável à entidade (ou a um supertipo) e ao tipo predefinido. */
export function isSetApplicable(set: string, entity: string, predefinedType: string): boolean {
  const template = IFC_PROPERTY_SETS[set];
  const definition = IFC_ENTITIES[entity];
  if (!template || !definition) return false;
  const lineage = [entity, ...definition.ancestors];
  return template.applicable.some((item) => {
    const [name, required] = item.split('/');
    return (
      name !== undefined && lineage.includes(name) && (!required || required === predefinedType)
    );
  });
}

const QUANTITY_KINDS: Record<string, string> = {
  IfcQuantityLength: 'Q_LENGTH',
  IfcQuantityArea: 'Q_AREA',
  IfcQuantityVolume: 'Q_VOLUME',
  IfcQuantityCount: 'Q_COUNT',
  IfcQuantityWeight: 'Q_WEIGHT',
};

interface Owner {
  elementId: string | null;
  typeKey: string | null;
  entity: string;
  predefinedType: string;
  label: string;
}

function checkSets(sets: readonly IfcPropertySetInfo[], owner: Owner, issues: IfcIssue[]): void {
  const issue = (
    level: IfcIssueLevel,
    severity: IfcIssueSeverity,
    code: string,
    message: string,
    property: string | null,
  ): void => {
    issues.push({
      level,
      severity,
      code,
      message,
      elementId: owner.elementId,
      typeKey: owner.typeKey,
      property,
    });
  };
  for (const set of sets) {
    const template = IFC_PROPERTY_SETS[set.name];
    if (set.standard) {
      if (!template) {
        issue('schema', 'error', 'PSET_UNKNOWN', `${set.name} não existe no IFC 4.3.`, null);
        continue;
      }
      if (!isSetApplicable(set.name, owner.entity, owner.predefinedType))
        issue(
          'schema',
          'error',
          'PSET_NOT_APPLICABLE',
          `${set.name} não se aplica a ${owner.entity}/${owner.predefinedType}.`,
          null,
        );
    } else if (template) {
      issue(
        'schema',
        'error',
        'PSET_RESERVED_NAME',
        `${set.name} é um conjunto padronizado e não pode nomear um conjunto próprio.`,
        null,
      );
    }
    for (const property of set.properties) {
      if (set.standard && template) {
        const expected = template.properties[property.name];
        if (!expected) {
          issue(
            'schema',
            'error',
            'PROPERTY_UNKNOWN',
            `${property.key} não existe no IFC 4.3.`,
            property.key,
          );
        } else if (
          property.kind === 'quantity'
            ? QUANTITY_KINDS[property.ifcType] !== expected.kind
            : expected.type !== property.ifcType
        ) {
          issue(
            'schema',
            'error',
            'PROPERTY_TYPE_MISMATCH',
            `${property.key}: tipo de valor ${property.ifcType} difere do esquema (${expected.type ?? expected.kind}).`,
            property.key,
          );
        }
      }
      if (property.value !== null) {
        const problem = checkIfcValue(property, property.value);
        if (problem)
          issue(
            'schema',
            'error',
            'VALUE_INVALID',
            `${property.label} (${property.key}): ${problem}.`,
            property.key,
          );
      } else if (property.required) {
        issue(
          'project',
          'pending',
          'REQUIRED_MISSING',
          `${property.label} (${property.key}) é exigida pelo perfil do projeto e não foi informada.`,
          property.key,
        );
      }
    }
  }
}

/** Valida o modelo de informação contra o esquema IFC 4.3 e o perfil do projeto. */
export function validateIfcModel(project: Project, model: IfcModel): IfcIssue[] {
  const issues: IfcIssue[] = [];
  const guids = new Map<string, string>();
  const guid = (value: string, label: string, elementId: string | null): void => {
    if (!GUID.test(value))
      issues.push({
        level: 'schema',
        severity: 'error',
        code: 'GLOBALID_INVALID',
        message: `GlobalId inválido em ${label}.`,
        elementId,
        typeKey: null,
        property: null,
      });
    const previous = guids.get(value);
    if (previous !== undefined)
      issues.push({
        level: 'schema',
        severity: 'error',
        code: 'GLOBALID_DUPLICATE',
        message: `GlobalId duplicado: ${label} e ${previous}.`,
        elementId,
        typeKey: null,
        property: null,
      });
    else guids.set(value, label);
  };
  const classification = (
    entity: string,
    predefinedType: string,
    objectType: string | null,
    label: string,
    elementId: string | null,
    typeKey: string | null,
  ): void => {
    const push = (code: string, message: string): void => {
      issues.push({
        level: 'schema',
        severity: 'error',
        code,
        message,
        elementId,
        typeKey,
        property: null,
      });
    };
    const definition = IFC_ENTITIES[entity];
    if (!definition) {
      push('ENTITY_UNKNOWN', `${label}: a entidade ${entity} não foi conferida no IFC 4.3.`);
      return;
    }
    if (!definition.predefinedTypes.includes(predefinedType))
      push(
        'PREDEFINED_TYPE_INVALID',
        `${label}: ${predefinedType} não é um tipo predefinido de ${entity}.`,
      );
    if (predefinedType === 'USERDEFINED' && !objectType)
      push(
        'USERDEFINED_WITHOUT_OBJECTTYPE',
        `${label}: tipo USERDEFINED exige a identificação em ObjectType.`,
      );
  };

  const sources = new Map(project.elements.map((element) => [element.id, element]));
  for (const element of model.elements) {
    const label = `"${element.name}"`;
    guid(element.globalId, label, element.elementId);
    classification(
      element.entity,
      element.predefinedType,
      element.objectType,
      label,
      element.elementId,
      null,
    );
    checkSets(
      element.psets,
      {
        elementId: element.elementId,
        typeKey: null,
        entity: element.entity,
        predefinedType: element.predefinedType,
        label,
      },
      issues,
    );
    for (const port of element.ports) {
      guid(port.globalId, `porta ${port.name} de ${label}`, element.elementId);
      checkSets(
        port.psets,
        {
          elementId: element.elementId,
          typeKey: null,
          entity: 'IfcDistributionPort',
          predefinedType: 'PIPE',
          label,
        },
        issues,
      );
    }

    // Valores do usuário guardados na ocorrência que deixaram de valer.
    const source = sources.get(element.elementId);
    for (const [key, value] of Object.entries(source?.ifc ?? {})) {
      if (key === 'Description' || !source) continue;
      const definition = findDefinition(key, 'occurrence', elementClass(source));
      const shown = element.psets.some((set) => set.properties.some((p) => p.key === key));
      if (!definition || !definition.editable || !shown)
        issues.push({
          level: 'project',
          severity: 'warning',
          code: 'USER_VALUE_NOT_APPLICABLE',
          message: `${label}: o valor informado para ${key} não se aplica mais a este elemento e não é exportado.`,
          elementId: element.elementId,
          typeKey: null,
          property: key,
        });
      else if (checkIfcValue(definition, value) !== null)
        issues.push({
          level: 'project',
          severity: 'warning',
          code: 'USER_VALUE_INVALID',
          message: `${label}: o valor informado para ${definition.label} (${key}) é inválido e não é exportado.`,
          elementId: element.elementId,
          typeKey: null,
          property: key,
        });
    }

    // Quantidades coerentes com a geometria: o comprimento do tubo é a distância entre portas.
    const start = element.ports[0];
    const end = element.ports[1];
    if (element.entity === 'IfcPipeSegment' && start && end) {
      const measured = distance(start.position, end.position);
      for (const set of element.psets)
        for (const property of set.properties)
          if (
            property.name === 'Length' &&
            typeof property.value === 'number' &&
            Math.abs(property.value - measured) > 1e-6
          )
            issues.push({
              level: 'project',
              severity: 'error',
              code: 'QUANTITY_MISMATCH',
              message: `${label}: ${property.key} difere do comprimento entre as portas.`,
              elementId: element.elementId,
              typeKey: null,
              property: property.key,
            });
    }
    const quantities = element.psets.find(
      (set) => set.name === 'HydroBIM_Reservatorio_Quantidades',
    );
    const capacity = quantities?.properties.find((p) => p.name === 'NominalCapacity')?.value;
    const volume = quantities?.properties.find((p) => p.name === 'GeometricVolume')?.value;
    if (typeof capacity === 'number' && typeof volume === 'number' && capacity > volume * 1.001)
      issues.push({
        level: 'project',
        severity: 'warning',
        code: 'CAPACITY_EXCEEDS_VOLUME',
        message: `${label}: a capacidade nominal (${capacity.toLocaleString('pt-BR')} m³) é maior que o volume geométrico da representação (${volume.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m³).`,
        elementId: element.elementId,
        typeKey: null,
        property: 'HydroBIM_Reservatorio_Quantidades.NominalCapacity',
      });
  }

  for (const type of model.types) {
    const label = `tipo "${type.name}"`;
    guid(type.globalId, label, null);
    classification(type.entity, type.predefinedType, type.elementType, label, null, type.key);
    checkSets(
      type.psets,
      {
        elementId: null,
        typeKey: type.key,
        entity: type.entity,
        predefinedType: type.predefinedType,
        label,
      },
      issues,
    );
    const sample = sources.get(type.memberIds[0] ?? '');
    for (const [key, value] of Object.entries(project.ifcTypes[type.key] ?? {})) {
      const definition = sample ? findDefinition(key, 'type', elementClass(sample)) : undefined;
      const shown = type.psets.some((set) => set.properties.some((p) => p.key === key));
      if (
        !definition ||
        !definition.editable ||
        !shown ||
        checkIfcValue(definition, value) !== null
      )
        issues.push({
          level: 'project',
          severity: 'warning',
          code: definition && shown ? 'USER_VALUE_INVALID' : 'USER_VALUE_NOT_APPLICABLE',
          message: `${label}: o valor informado para ${key} não é válido para este tipo e não é exportado.`,
          elementId: null,
          typeKey: type.key,
          property: key,
        });
    }
  }
  for (const system of model.systems) {
    guid(system.globalId, `sistema "${system.name}"`, null);
    classification(
      'IfcDistributionSystem',
      system.predefinedType,
      system.objectType,
      `sistema "${system.name}"`,
      null,
      null,
    );
  }

  // Conectividade: cada conexão liga duas portas existentes, coincidentes e opostas.
  const ports = new Map(
    model.elements.flatMap((element) =>
      element.ports.map((port) => [JSON.stringify([element.elementId, port.portId]), port]),
    ),
  );
  for (const connection of project.connections) {
    const a = ports.get(JSON.stringify([connection.a.elementId, connection.a.portId]));
    const b = ports.get(JSON.stringify([connection.b.elementId, connection.b.portId]));
    const push = (code: string, severity: IfcIssueSeverity, message: string): void => {
      issues.push({
        level: 'schema',
        severity,
        code,
        message,
        elementId: connection.a.elementId,
        typeKey: null,
        property: null,
      });
    };
    if (!a || !b) {
      push(
        'CONNECTION_PORT_MISSING',
        'error',
        'Há uma conexão que referencia uma porta inexistente.',
      );
      continue;
    }
    if (distance(a.position, b.position) > 2 * POSITION_TOLERANCE)
      push(
        'PORTS_NOT_COINCIDENT',
        'error',
        `As portas conectadas "${a.name}" e "${b.name}" não coincidem na geometria.`,
      );
    else if (dot(a.direction, b.direction) > -0.99)
      push(
        'PORTS_NOT_OPPOSED',
        'warning',
        `As portas conectadas "${a.name}" e "${b.name}" não estão alinhadas.`,
      );
    if (a.systemType !== b.systemType)
      push(
        'PORT_SYSTEM_MISMATCH',
        'warning',
        `As portas conectadas "${a.name}" e "${b.name}" pertencem a sistemas de tipos diferentes.`,
      );
  }
  return issues;
}

/** Problemas de um elemento: os da ocorrência e os do tipo a que pertence. */
export function issuesOfElement(
  issues: readonly IfcIssue[],
  elementId: string,
  typeKey: string,
): IfcIssue[] {
  return issues.filter((issue) => issue.elementId === elementId || issue.typeKey === typeKey);
}

export function conformityOf(issues: readonly IfcIssue[]): IfcConformity {
  if (issues.some((issue) => issue.severity === 'error')) return 'invalid';
  return issues.length ? 'pending' : 'conforming';
}
