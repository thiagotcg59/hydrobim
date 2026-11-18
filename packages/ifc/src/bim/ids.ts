import {
  IFC_CLASS_ENTITIES,
  IFC_PROPERTY_DEFINITIONS,
  type IfcElementClass,
  type IfcPropertyDefinition,
} from './definitions';
import { IFC_SCHEMA_ID } from './schemaData';

/**
 * Perfil de requisitos de informação do projeto, publicado como IDS (Information Delivery
 * Specification 1.0 da buildingSMART). Reúne as propriedades que o registro marca como
 * exigidas — requisitos ADICIONAIS do projeto, não do esquema IFC. A mesma lista alimenta
 * as pendências da aba BIM / IFC, de modo que o IDS e o painel nunca divergem.
 */
export interface IdsRequirement {
  readonly propertySet: string;
  readonly baseName: string;
  /** Tipo de valor IFC em maiúsculas, como pede o IDS (`IFCLABEL`). */
  readonly dataType: string;
  readonly label: string;
}

export interface IdsSpecification {
  readonly name: string;
  readonly entity: string;
  /** Tipos predefinidos a que se restringe; vazio = toda a entidade. */
  readonly predefinedTypes: readonly string[];
  readonly requirements: readonly IdsRequirement[];
}

const CLASS_LABELS: Record<IfcElementClass, string> = {
  pipe: 'Tubos',
  fitting: 'Conexões',
  valve: 'Válvulas e registros',
  strainer: 'Filtros',
  pump: 'Bombas',
  tank: 'Reservatórios',
};

/** Especificações do perfil: uma por classe e por restrição de tipo predefinido. */
export function idsSpecifications(
  definitions: readonly IfcPropertyDefinition[] = IFC_PROPERTY_DEFINITIONS,
): IdsSpecification[] {
  const groups = new Map<string, IdsSpecification & { requirements: IdsRequirement[] }>();
  for (const definition of definitions) {
    if (!definition.required) continue;
    for (const className of definition.classes) {
      const predefinedTypes = definition.predefinedTypes ?? [];
      const key = `${className}|${predefinedTypes.join(',')}`;
      const requirement: IdsRequirement = {
        propertySet: definition.set,
        baseName: definition.name,
        dataType: definition.ifcType.toUpperCase(),
        label: definition.label,
      };
      const group = groups.get(key);
      if (group) {
        if (
          !group.requirements.some(
            (r) => r.propertySet === requirement.propertySet && r.baseName === requirement.baseName,
          )
        )
          group.requirements.push(requirement);
      } else {
        groups.set(key, {
          name: `${CLASS_LABELS[className]}${predefinedTypes.length ? ` (${predefinedTypes.join(', ')})` : ''}`,
          entity: IFC_CLASS_ENTITIES[className],
          predefinedTypes,
          requirements: [requirement],
        });
      }
    }
  }
  return [...groups.values()];
}

const xml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const simple = (tag: string, value: string, indent: string): string =>
  `${indent}<${tag}>\n${indent}  <simpleValue>${xml(value)}</simpleValue>\n${indent}</${tag}>`;

const restriction = (tag: string, values: readonly string[], indent: string): string =>
  values.length === 1
    ? simple(tag, values[0] ?? '', indent)
    : [
        `${indent}<${tag}>`,
        `${indent}  <xs:restriction base="xs:string">`,
        ...values.map((value) => `${indent}    <xs:enumeration value="${xml(value)}"/>`),
        `${indent}  </xs:restriction>`,
        `${indent}</${tag}>`,
      ].join('\n');

export interface IdsOptions {
  title?: string;
  /** Data do documento (AAAA-MM-DD). */
  date?: string;
  author?: string;
}

/** Gera o arquivo IDS 1.0 do perfil de requisitos do projeto. */
export function exportIds(options: IdsOptions = {}): string {
  const title = options.title ?? 'HydroBIM — requisitos de informação para abastecimento de água';
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ids xmlns="http://standards.buildingsmart.org/IDS" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://standards.buildingsmart.org/IDS http://standards.buildingsmart.org/IDS/1.0/ids.xsd">',
    '  <info>',
    `    <title>${xml(title)}</title>`,
    '    <description>Requisitos adicionais do projeto (não normativos do IFC): propriedades exigidas por classe de elemento.</description>',
    ...(options.author ? [`    <author>${xml(options.author)}</author>`] : []),
    ...(options.date ? [`    <date>${xml(options.date)}</date>`] : []),
    '  </info>',
    '  <specifications>',
  ];
  for (const specification of idsSpecifications()) {
    lines.push(
      `    <specification name="${xml(specification.name)}" ifcVersion="${IFC_SCHEMA_ID}">`,
      '      <applicability minOccurs="0" maxOccurs="unbounded">',
      '        <entity>',
      simple('name', specification.entity.toUpperCase(), '          '),
      ...(specification.predefinedTypes.length
        ? [restriction('predefinedType', specification.predefinedTypes, '          ')]
        : []),
      '        </entity>',
      '      </applicability>',
      '      <requirements>',
    );
    for (const requirement of specification.requirements)
      lines.push(
        `        <property dataType="${requirement.dataType}" cardinality="required" instructions="${xml(requirement.label)}">`,
        simple('propertySet', requirement.propertySet, '          '),
        simple('baseName', requirement.baseName, '          '),
        '        </property>',
      );
    lines.push('      </requirements>', '    </specification>');
  }
  lines.push('  </specifications>', '</ids>', '');
  return lines.join('\n');
}
