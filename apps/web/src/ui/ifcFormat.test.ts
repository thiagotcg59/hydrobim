import type { IfcPropertyInfo } from '@hydrobim/ifc';
import { describe, expect, it } from 'vitest';
import { displayOf, editTextOf, formatIfcValue, parseIfcInput } from './ifcFormat';

const property = (patch: Partial<IfcPropertyInfo>): IfcPropertyInfo => ({
  key: 'Pset.Nome',
  set: 'Pset',
  name: 'Nome',
  label: 'Nome',
  kind: 'single',
  ifcType: 'IfcLabel',
  unit: 'none',
  value: null,
  origin: 'pending',
  required: false,
  editable: true,
  binding: null,
  ...patch,
});

describe('apresentação dos valores IFC', () => {
  it('converte pressão, vazão, potência, rotação, ângulo e razão para as unidades de projeto', () => {
    const cases: [Partial<IfcPropertyInfo>, string][] = [
      [{ unit: 'pressure', ifcType: 'IfcPressureMeasure', value: 600000 }, '0,6 MPa'],
      [{ unit: 'flow', ifcType: 'IfcVolumetricFlowRateMeasure', value: 0.0125 }, '12,5 L/s'],
      [{ unit: 'power', ifcType: 'IfcPowerMeasure', value: 7500 }, '7,5 kW'],
      [{ unit: 'frequency', ifcType: 'IfcRotationalFrequencyMeasure', value: 29.5 }, '1770 rpm'],
      [{ unit: 'angle', ifcType: 'IfcPlaneAngleMeasure', value: Math.PI / 2 }, '90 °'],
      [{ unit: 'ratio', ifcType: 'IfcPositiveRatioMeasure', value: 0.005 }, '0,5 %'],
      [{ unit: 'length', ifcType: 'IfcPositiveLengthMeasure', value: 12.345 }, '12,345 m'],
      [{ unit: 'area', ifcType: 'IfcQuantityArea', kind: 'quantity', value: 2.5 }, '2,5 m²'],
    ];
    for (const [patch, expected] of cases) expect(formatIfcValue(property(patch))).toBe(expected);
  });

  it('mostra diâmetros, espessuras e rugosidade em milímetros', () => {
    const length = { unit: 'length', ifcType: 'IfcPositiveLengthMeasure' } as const;
    expect(formatIfcValue(property({ ...length, name: 'OuterDiameter', value: 0.06 }))).toBe(
      '60 mm',
    );
    expect(displayOf(property({ ...length, name: 'InteriorRoughnessCoefficient' })).unit).toBe(
      'mm',
    );
    expect(displayOf(property({ ...length, name: 'Length' })).unit).toBe('m');
  });

  it('formata textos, booleanos e valores não informados', () => {
    expect(formatIfcValue(property({ value: 'ACME' }))).toBe('ACME');
    expect(formatIfcValue(property({ ifcType: 'IfcBoolean', value: true }))).toBe('Sim');
    expect(formatIfcValue(property({ ifcType: 'IfcBoolean', value: false }))).toBe('Não');
    expect(formatIfcValue(property({}))).toBeNull();
    expect(editTextOf(property({}))).toBe('');
  });

  it('interpreta o texto digitado na unidade de apresentação e devolve SI', () => {
    const pressure = property({ unit: 'pressure', ifcType: 'IfcPressureMeasure' });
    expect(parseIfcInput(pressure, '0,6')).toBe(600000);
    expect(parseIfcInput(pressure, ' 1.0 ')).toBe(1000000);
    expect(parseIfcInput(pressure, '')).toBeNull();
    expect(parseIfcInput(pressure, 'alta')).toBeUndefined();
    const roughness = property({
      unit: 'length',
      ifcType: 'IfcPositiveLengthMeasure',
      name: 'InteriorRoughnessCoefficient',
    });
    expect(parseIfcInput(roughness, '0,1')).toBe(0.0001);
    expect(parseIfcInput(property({}), '  ACME  ')).toBe('ACME');
    const enumerated = property({
      kind: 'enumerated',
      enumeration: { name: 'PEnum', values: ['NEW'] },
    });
    expect(parseIfcInput(enumerated, 'NEW')).toBe('NEW');
    // Ida e volta: o texto do campo reproduz o valor guardado.
    expect(parseIfcInput(pressure, editTextOf({ ...pressure, value: 750000 }))).toBe(750000);
  });
});
