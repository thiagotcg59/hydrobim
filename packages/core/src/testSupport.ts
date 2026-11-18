import type { PipeSpec } from './schema';

/** Especificação fictícia e coerente para testes: DE = DN + 10 mm, parede = 5 % do DE. */
export function testSpec(dn: number, specificationId = 'test-spec'): PipeSpec {
  const outerDiameter = (dn + 10) / 1000;
  const wallThickness = outerDiameter * 0.05;
  return {
    specificationId,
    material: 'pvc',
    standard: `Norma ${specificationId}`,
    jointType: 'solventWeld',
    pressureClass: null,
    dn,
    sizeLabel: `DN ${dn}`,
    outerDiameter,
    wallThickness,
    innerDiameter: outerDiameter - 2 * wallThickness,
  };
}
