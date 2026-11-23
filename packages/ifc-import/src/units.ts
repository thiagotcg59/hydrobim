import { numberOf, refOf, refsOf, textOf, type LineReader, type Raw } from './raw';
import type { IfcUnitInfo } from './types';

/**
 * Unidades declaradas no arquivo (`IfcUnitAssignment`). Nada é presumido: uma unidade que o
 * arquivo não declara fica sem símbolo, e o valor é mostrado sem unidade.
 */

const SI_SYMBOLS: Record<string, string> = {
  METRE: 'm',
  SQUARE_METRE: 'm²',
  CUBIC_METRE: 'm³',
  RADIAN: 'rad',
  STERADIAN: 'sr',
  GRAM: 'g',
  SECOND: 's',
  KELVIN: 'K',
  DEGREE_CELSIUS: '°C',
  PASCAL: 'Pa',
  WATT: 'W',
  NEWTON: 'N',
  JOULE: 'J',
  HERTZ: 'Hz',
  AMPERE: 'A',
  VOLT: 'V',
  OHM: 'Ω',
  LUX: 'lx',
  LUMEN: 'lm',
  CANDELA: 'cd',
  MOLE: 'mol',
};

const PREFIXES: Record<string, { symbol: string; factor: number }> = {
  EXA: { symbol: 'E', factor: 1e18 },
  PETA: { symbol: 'P', factor: 1e15 },
  TERA: { symbol: 'T', factor: 1e12 },
  GIGA: { symbol: 'G', factor: 1e9 },
  MEGA: { symbol: 'M', factor: 1e6 },
  KILO: { symbol: 'k', factor: 1e3 },
  HECTO: { symbol: 'h', factor: 1e2 },
  DECA: { symbol: 'da', factor: 10 },
  DECI: { symbol: 'd', factor: 1e-1 },
  CENTI: { symbol: 'c', factor: 1e-2 },
  MILLI: { symbol: 'm', factor: 1e-3 },
  MICRO: { symbol: 'µ', factor: 1e-6 },
  NANO: { symbol: 'n', factor: 1e-9 },
  PICO: { symbol: 'p', factor: 1e-12 },
};

const CONVERSION_SYMBOLS: Record<string, string> = {
  DEGREE: '°',
  FOOT: 'ft',
  INCH: 'in',
  YARD: 'yd',
  MILE: 'mi',
  'SQUARE FOOT': 'ft²',
  'SQUARE INCH': 'in²',
  'CUBIC FOOT': 'ft³',
  'CUBIC INCH': 'in³',
  LITRE: 'L',
  POUND: 'lb',
  MINUTE: 'min',
  HOUR: 'h',
  DAY: 'd',
};

/** O prefixo vale para a unidade de base: em área e volume entra elevado à dimensão. */
const POWER: Record<string, number> = { SQUARE_METRE: 2, CUBIC_METRE: 3 };

const SUPERSCRIPT: Record<string, string> = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};

const superscript = (exponent: number): string =>
  String(exponent)
    .split('')
    .map((char) => SUPERSCRIPT[char] ?? char)
    .join('');

const enumOf = (value: unknown): string | null => {
  const text = textOf(value);
  return text === null ? null : text.replace(/^\.|\.$/g, '');
};

export function describeUnit(
  read: LineReader,
  unitId: number,
  entityOf: (id: number) => string,
): IfcUnitInfo | null {
  const line = read(unitId);
  if (!line) return null;
  const entity = entityOf(unitId);
  const type = enumOf(line.UnitType) ?? '';
  if (entity === 'IfcSIUnit') {
    const name = enumOf(line.Name) ?? '';
    const prefixName = enumOf(line.Prefix);
    const prefix = prefixName ? PREFIXES[prefixName] : undefined;
    const base = SI_SYMBOLS[name];
    const power = POWER[name] ?? 1;
    const symbol = base
      ? power > 1 && prefix
        ? `${prefix.symbol}${base}`
        : `${prefix?.symbol ?? ''}${base}`
      : name.toLowerCase();
    return {
      type,
      label: `${prefixName ?? ''}${name}`,
      symbol,
      toSi: (prefix?.factor ?? 1) ** power,
    };
  }
  if (entity === 'IfcConversionBasedUnit' || entity === 'IfcConversionBasedUnitWithOffset') {
    const name = (textOf(line.Name) ?? '').toUpperCase();
    const factorLine = readRef(read, line.ConversionFactor);
    const value = factorLine ? numberOf(factorLine.ValueComponent) : null;
    const baseId = factorLine ? refOf(factorLine.UnitComponent) : null;
    const base = baseId === null ? null : describeUnit(read, baseId, entityOf);
    return {
      type,
      label: name,
      symbol: CONVERSION_SYMBOLS[name] ?? name.toLowerCase(),
      toSi: value !== null && base !== null && base.toSi !== null ? value * base.toSi : null,
    };
  }
  if (entity === 'IfcDerivedUnit') {
    const parts: string[] = [];
    for (const elementId of refsOf(line.Elements)) {
      const element = read(elementId);
      const partId = element ? refOf(element.Unit) : null;
      const part = partId === null ? null : describeUnit(read, partId, entityOf);
      const exponent = element ? (numberOf(element.Exponent) ?? 1) : 1;
      if (part) parts.push(exponent === 1 ? part.symbol : `${part.symbol}${superscript(exponent)}`);
    }
    return {
      type: type === 'USERDEFINED' ? (textOf(line.UserDefinedType) ?? type) : type,
      label: type,
      symbol: parts.join('·'),
      toSi: null,
    };
  }
  if (entity === 'IfcMonetaryUnit') {
    const currency = textOf(line.Currency) ?? '';
    return { type: 'MONETARYUNIT', label: currency, symbol: currency, toSi: null };
  }
  if (entity === 'IfcContextDependentUnit') {
    const name = textOf(line.Name) ?? '';
    return { type, label: name, symbol: name, toSi: null };
  }
  return null;
}

function readRef(read: LineReader, value: unknown): Raw | null {
  const id = refOf(value);
  return id === null ? null : read(id);
}

/**
 * `UnitType` que rege um tipo de medida: `IFCPOSITIVELENGTHMEASURE` → `LENGTHUNIT`,
 * `IFCTHERMALTRANSMITTANCEMEASURE` → `THERMALTRANSMITTANCEUNIT`.
 */
export function unitTypeOfMeasure(valueType: string): string | null {
  const upper = valueType.toUpperCase();
  if (!upper.startsWith('IFC') || !upper.endsWith('MEASURE')) return null;
  const core = upper.slice(3, -'MEASURE'.length).replace(/^(POSITIVE|NONNEGATIVE|NORMALISED)/, '');
  if (core === 'RATIO' || core === 'COUNT' || core === 'NUMERIC' || core === '') return null;
  return `${core}UNIT`;
}

/** Tipo da quantidade → `UnitType` (`IfcQuantityLength` → `LENGTHUNIT`). */
export const QUANTITY_UNIT_TYPES: Record<string, string> = {
  IfcQuantityLength: 'LENGTHUNIT',
  IfcQuantityArea: 'AREAUNIT',
  IfcQuantityVolume: 'VOLUMEUNIT',
  IfcQuantityWeight: 'MASSUNIT',
  IfcQuantityTime: 'TIMEUNIT',
};
