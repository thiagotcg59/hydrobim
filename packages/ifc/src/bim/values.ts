import { standardTemplate, unitOfIfcType } from './definitions';
import type { IfcEnumeration, IfcPropertyInfo, IfcUnit, IfcValue, IfcValueOrigin } from './types';

const STRING_TYPES = new Set(['IfcLabel', 'IfcText', 'IfcIdentifier']);
const INTEGER_TYPES = new Set(['IfcInteger', 'IfcCountMeasure']);

export const isIntegerIfcType = (ifcType: string): boolean => INTEGER_TYPES.has(ifcType);

/**
 * Confere um valor contra o tipo de valor IFC da propriedade. Devolve a mensagem do
 * problema (em português) ou `null` quando o valor é aceitável.
 */
export function checkIfcValue(
  property: { kind: IfcPropertyInfo['kind']; ifcType: string; enumeration?: IfcEnumeration },
  value: IfcValue,
): string | null {
  if (property.kind === 'enumerated') {
    return typeof value === 'string' && property.enumeration?.values.includes(value)
      ? null
      : `o valor deve ser um dos itens de ${property.enumeration?.name ?? 'sua enumeração'}`;
  }
  const type = property.ifcType;
  if (type === 'IfcDate') {
    // Data ISO 8601 (AAAA-MM-DD), como o IFC a grava.
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return 'a data deve estar no formato AAAA-MM-DD';
    }
    return Number.isNaN(Date.parse(value)) ? 'a data não existe' : null;
  }
  if (type === 'IfcBoolean')
    return typeof value === 'boolean' ? null : 'o valor deve ser sim ou não';
  if (STRING_TYPES.has(type)) {
    if (typeof value !== 'string' || value.trim().length === 0) return 'o valor deve ser um texto';
    return type !== 'IfcText' && value.length > 255 ? 'o texto excede 255 caracteres' : null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'o valor deve ser um número';
  if (INTEGER_TYPES.has(type) && !Number.isInteger(value)) return 'o valor deve ser inteiro';
  if (type === 'IfcCountMeasure' && value < 0) return 'o valor não pode ser negativo';
  if (type.startsWith('IfcPositive') && value <= 0) return 'o valor deve ser maior que zero';
  if (type.startsWith('IfcNonNegative') && value < 0) return 'o valor não pode ser negativo';
  if (type === 'IfcNormalisedRatioMeasure' && (value < 0 || value > 1))
    return 'o valor deve estar entre 0 e 1';
  if (property.kind === 'quantity' && value < 0) return 'a quantidade não pode ser negativa';
  return null;
}

interface Extra {
  kind?: IfcPropertyInfo['kind'];
  unit?: IfcUnit;
  enumeration?: IfcEnumeration;
  required?: boolean;
  editable?: boolean;
  binding?: string | null;
}

/** Monta uma propriedade de conjunto próprio (`HydroBIM_*`). */
export function ownProperty(
  set: string,
  name: string,
  label: string,
  ifcType: string,
  value: IfcValue | null | undefined,
  origin: IfcValueOrigin,
  extra: Extra = {},
): IfcPropertyInfo {
  const present = value !== null && value !== undefined;
  return {
    key: `${set}.${name}`,
    set,
    name,
    label,
    kind: extra.kind ?? 'single',
    ifcType,
    unit: extra.unit ?? unitOfIfcType(ifcType),
    ...(extra.enumeration ? { enumeration: extra.enumeration } : {}),
    value: present ? value : null,
    origin: present ? origin : 'pending',
    required: extra.required ?? false,
    editable: extra.editable ?? false,
    binding: extra.binding ?? null,
  };
}

/** Monta uma propriedade de conjunto padronizado: tipo e enumeração vêm do esquema. */
export function standardProperty(
  set: string,
  name: string,
  label: string,
  value: IfcValue | null | undefined,
  origin: IfcValueOrigin,
  extra: Pick<Extra, 'required' | 'editable' | 'binding'> = {},
): IfcPropertyInfo {
  const template = standardTemplate(set, name);
  return ownProperty(set, name, label, template.ifcType, value, origin, { ...template, ...extra });
}
