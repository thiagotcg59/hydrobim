import { createProject, placeEquipment, vec3, type PipeSpec } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { exportIfc } from './export';

const spec: PipeSpec = {
  specificationId: 'aco',
  material: 'carbonSteel',
  standard: 'ASME B36.10M',
  jointType: 'buttWeld',
  pressureClass: 'SCH 40',
  dn: 100,
  sizeLabel: 'DN 100 (4")',
  outerDiameter: 0.1143,
  wallThickness: 0.00602,
  innerDiameter: 0.10226,
};

describe('filtro Y no IFC', () => {
  it('é exportado como IfcFilter/STRAINER, não como válvula', () => {
    const placed = placeEquipment(createProject('Filtro'), {
      spec,
      fitting: { kind: 'valve', valveType: 'strainer' },
      position: vec3(0, 0, 0),
    });
    if (!placed.ok) throw new Error(placed.error.message);
    const text = exportIfc(placed.value.project, { timestamp: new Date('2026-01-01T00:00:00Z') });
    const filters = text.split('\n').filter((line) => /=\s*IFCFILTER\(/.test(line));
    expect(filters).toHaveLength(1);
    expect(filters[0]).toContain('.STRAINER.');
    expect(text).not.toMatch(/IFCVALVE\(/);
    // Duas portas (montante e jusante), como as demais peças em linha.
    expect(text.match(/IFCDISTRIBUTIONPORT\(/g)).toHaveLength(2);
  });
});
