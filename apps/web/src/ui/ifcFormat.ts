import type { IfcPropertyInfo, IfcUnit, IfcValue } from '@hydrobim/ifc';
import { formatDecimal, parseDecimal } from './fields';

/**
 * Apresentação dos valores IFC. No modelo e no arquivo tudo está em SI (m, Pa, m³/s, W,
 * s⁻¹, rad); a conversão para as unidades usuais de projeto acontece só aqui.
 */
interface Display {
  /** Valor de apresentação = valor SI × fator. */
  factor: number;
  unit: string;
  digits: number;
}

const DISPLAY: Record<IfcUnit, Display> = {
  none: { factor: 1, unit: '', digits: 4 },
  length: { factor: 1, unit: 'm', digits: 3 },
  area: { factor: 1, unit: 'm²', digits: 4 },
  volume: { factor: 1, unit: 'm³', digits: 3 },
  angle: { factor: 180 / Math.PI, unit: '°', digits: 2 },
  pressure: { factor: 1e-6, unit: 'MPa', digits: 4 },
  flow: { factor: 1000, unit: 'L/s', digits: 3 },
  power: { factor: 1e-3, unit: 'kW', digits: 3 },
  frequency: { factor: 60, unit: 'rpm', digits: 1 },
  ratio: { factor: 100, unit: '%', digits: 3 },
  thermalTransmittance: { factor: 1, unit: 'W/(m²·K)', digits: 3 },
};

/** Diâmetros, espessuras e rugosidade são lidos em milímetros. */
const MILLIMETRES = /Diameter|Thickness|Roughness|BoltholePitch|BoltCircle|^Size$|ConnectionSize/;

export function displayOf(property: Pick<IfcPropertyInfo, 'unit' | 'name'>): Display {
  if (property.unit === 'length' && MILLIMETRES.test(property.name))
    return { factor: 1000, unit: 'mm', digits: 3 };
  return DISPLAY[property.unit];
}

const isText = (ifcType: string): boolean =>
  ifcType === 'IfcLabel' || ifcType === 'IfcText' || ifcType === 'IfcIdentifier';

/** Texto do valor para leitura (com unidade); `null` quando não informado. */
export function formatIfcValue(property: IfcPropertyInfo): string | null {
  const { value } = property;
  if (value === null) return null;
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'string') return value;
  const display = displayOf(property);
  const text = formatDecimal(value * display.factor, display.digits);
  return display.unit ? `${text} ${display.unit}` : text;
}

/** Texto do valor no campo de edição (na unidade de apresentação, sem o sufixo). */
export function editTextOf(property: IfcPropertyInfo): string {
  const { value } = property;
  if (value === null || typeof value === 'boolean') return '';
  if (typeof value === 'string') return value;
  const display = displayOf(property);
  return formatDecimal(value * display.factor, display.digits + 2);
}

/**
 * Interpreta o texto digitado: `null` = limpar o campo; `undefined` = texto inválido.
 * Números são convertidos da unidade de apresentação para SI.
 */
export function parseIfcInput(
  property: IfcPropertyInfo,
  text: string,
): IfcValue | null | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (property.kind === 'enumerated' || isText(property.ifcType)) return trimmed;
  const parsed = parseDecimal(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  // 12 algarismos significativos: 0,6 MPa vira 600000 Pa, não 600000,0000000001.
  return Number((parsed / displayOf(property).factor).toPrecision(12));
}
