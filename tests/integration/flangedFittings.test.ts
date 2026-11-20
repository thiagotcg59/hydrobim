import {
  BUILTIN_FAMILIES,
  flangeForClass,
  pipeFlangeEnd,
  resolvePipeEnds,
  resolvePipeSpec,
} from '@hydrobim/catalog';
import {
  addPipe,
  availableElbowAngles,
  createFamilyCatalog,
  createProject,
  drawPipe,
  getElement,
  validateProject,
  vec3,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';

/**
 * Tubulação flangeada de ferro fundido dúctil com o catálogo real: a mudança de direção
 * recebe a curva PAM com flanges PN 10 (flange × flange), nunca a curva com bolsas.
 */
describe('tubulação flangeada com o catálogo embutido', () => {
  const catalog = createFamilyCatalog(
    BUILTIN_FAMILIES,
    {},
    { pipeFlange: pipeFlangeEnd, flange: flangeForClass },
  );
  const spec = resolvePipeSpec('ferro-ductil-nbr7675-k9', 150)!;
  const pipeFamily = 'tubo-fofo-flanges-pn10';
  const ends = { ...resolvePipeEnds(spec, pipeFamily, 'flangeFlange')!, familyId: pipeFamily };

  it('o joelho automático entre tubos flange × flange é a curva flangeada', () => {
    const first = addPipe(createProject('Flanges'), {
      start: vec3(0, 0, 0),
      end: vec3(3, 0, 0),
      spec,
      ends,
    });
    if (!first.ok) throw new Error(first.error.message);
    const result = drawPipe(first.value.project, {
      fromPort: { elementId: first.value.elementId, portId: 'end' },
      start: vec3(3, 0, 0),
      end: vec3(3, 3, 0),
      spec,
      ends,
      catalog,
    });
    if (!result.ok) throw new Error(result.error.message);
    const elbow = getElement(result.value.project, result.value.createdIds[0] ?? '');
    if (elbow?.kind !== 'elbow') throw new Error('joelho ausente');
    expect(elbow.familyId).toMatch(/flanges/);
    expect(elbow.ends.a?.type).toBe('flange');
    expect(elbow.ends.b?.type).toBe('flange');
    expect(validateProject(result.value.project)).toEqual([]);
  });

  it('os ângulos disponíveis a partir de um flange são os das curvas flangeadas', () => {
    const flanged = availableElbowAngles(BUILTIN_FAMILIES, spec, 'flange');
    expect(flanged.length).toBeGreaterThan(0);
    for (const angle of flanged) {
      expect(catalog.elbow(spec, angle, null, 'flange').familyId).toMatch(/flanges/);
    }
  });
});
