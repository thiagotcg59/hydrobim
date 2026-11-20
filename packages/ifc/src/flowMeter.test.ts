import { createProject, placeEquipment, vec3, type PipeSpec } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { exportIfc } from './export';

const spec: PipeSpec = {
  specificationId: 'fofo',
  material: 'ductileIron',
  standard: 'ABNT NBR 7675',
  jointType: 'flanged',
  pressureClass: 'K9',
  dn: 150,
  sizeLabel: 'DN 150',
  outerDiameter: 0.17,
  wallThickness: 0.006,
  innerDiameter: 0.158,
};

describe('medidor de vazão no IFC', () => {
  it('é exportado como IfcFlowMeter/WATERMETER, não como válvula', () => {
    const placed = placeEquipment(createProject('Medidor'), {
      spec,
      fitting: { kind: 'valve', valveType: 'flowMeter' },
      position: vec3(0, 0, 0),
    });
    if (!placed.ok) throw new Error(placed.error.message);
    const text = exportIfc(placed.value.project, { timestamp: new Date('2026-01-01T00:00:00Z') });
    const meters = text.split('\n').filter((line) => /=\s*IFCFLOWMETER\(/.test(line));
    expect(meters).toHaveLength(1);
    expect(meters[0]).toContain('.WATERMETER.');
    expect(text).not.toMatch(/IFCVALVE\(/);
    expect(text).toContain('HydroBIM_Medidor');
    // Duas portas (montante e jusante), como as demais peças em linha.
    expect(text.match(/IFCDISTRIBUTIONPORT\(/g)).toHaveLength(2);
  });
});
