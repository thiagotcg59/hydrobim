import { describe, expect, it } from 'vitest';
import { catalogViolation, offCatalogFittings, setElbowCatalogAngle } from './catalogPolicy';
import { createFamilyCatalog } from './families';
import { vec3 } from './math';
import { addPipe, attachFitting, createProject, drawPipe, updateFitting } from './operations';
import type { FittingFamily, Project } from './schema';
import { testSpec } from './testSupport';
import { degToRad } from './units';
import { validateProject } from './validation';

const spec = testSpec(50);

function elbowFamily(id: string, angleDeg: number, centerToEnd: number): FittingFamily {
  return {
    id,
    name: `Joelho ${angleDeg}°`,
    kind: 'elbow',
    specificationId: spec.specificationId,
    endType: 'plain',
    angle: degToRad(angleDeg),
    manufacturer: null,
    standard: 'Teste',
    source: 'Família de teste',
    origin: 'builtin',
    sizes: [{ dn: 50, centerToEnd }],
  };
}

const catalog = createFamilyCatalog([elbowFamily('j90', 90, 0.08), elbowFamily('j45', 45, 0.04)]);

function basePipe(): { project: Project; pipeId: string } {
  const result = addPipe(createProject('Teste'), {
    start: vec3(0, 0, 0),
    end: vec3(2, 0, 0),
    spec,
  });
  if (!result.ok) throw new Error(result.error.message);
  return { project: result.value.project, pipeId: result.value.elementId };
}

function withElbow(angleDeg: number, useCatalog = true): { before: Project; after: Project } {
  const { project, pipeId } = basePipe();
  const result = attachFitting(project, {
    target: { elementId: pipeId, portId: 'end' },
    fitting: { kind: 'elbow', angle: degToRad(angleDeg) },
    ...(useCatalog ? { catalog } : {}),
  });
  if (!result.ok) throw new Error(result.error.message);
  return { before: project, after: result.value.project };
}

describe('política de peças de catálogo', () => {
  it('aceita a conexão criada a partir de uma família', () => {
    const { before, after } = withElbow(90);
    expect(offCatalogFittings(before, after)).toEqual([]);
    expect(catalogViolation(before, after)).toBeNull();
  });

  it('aponta a conexão criada com dimensões genéricas', () => {
    const odd = withElbow(60);
    expect(offCatalogFittings(odd.before, odd.after)).toHaveLength(1);
    expect(catalogViolation(odd.before, odd.after)).toContain('Não há joelho de catálogo');

    const noCatalog = withElbow(90, false);
    expect(catalogViolation(noCatalog.before, noCatalog.after)).toContain('DN 50');
  });

  it('aponta o joelho automático fora de catálogo ao desenhar', () => {
    const { project, pipeId } = basePipe();
    const drawn = drawPipe(project, {
      fromPort: { elementId: pipeId, portId: 'end' },
      start: vec3(2, 0, 0),
      end: vec3(3, 2, 0),
      spec,
      catalog,
    });
    expect(drawn.ok).toBe(true);
    if (!drawn.ok) return;
    expect(catalogViolation(project, drawn.value.project)).toContain('Não há joelho de catálogo');
  });

  it('aponta a peça de catálogo cuja dimensão é alterada, mas não a que já era genérica', () => {
    const { after } = withElbow(90);
    const elbow = after.elements.find((e) => e.kind === 'elbow')!;
    const edited = updateFitting(after, elbow.id, { bendRadius: 0.2 });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(catalogViolation(after, edited.value)).toContain('deixaria de corresponder');

    const again = updateFitting(edited.value, elbow.id, { bendRadius: 0.25 });
    expect(again.ok && catalogViolation(edited.value, again.value)).toBeNull();
  });

  it('troca o ângulo do joelho por outro de catálogo, mantendo o vínculo e o identificador', () => {
    const { after } = withElbow(90);
    const elbow = after.elements.find((e) => e.kind === 'elbow')!;
    const changed = setElbowCatalogAngle(after, elbow.id, degToRad(45), catalog);
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    const updated = changed.value.elements.find((e) => e.id === elbow.id);
    expect(updated?.familyId).toBe('j45');
    expect(updated?.kind === 'elbow' && updated.angle).toBeCloseTo(degToRad(45));
    expect(updated?.kind === 'elbow' && updated.bendRadius).toBeCloseTo(
      0.04 / Math.tan(degToRad(45) / 2),
    );
    expect(catalogViolation(after, changed.value)).toBeNull();
    expect(validateProject(changed.value)).toEqual([]);

    const refused = setElbowCatalogAngle(after, elbow.id, degToRad(60), catalog);
    expect(!refused.ok && refused.error.code).toBe('NO_CATALOG_ELBOW');
    const notElbow = setElbowCatalogAngle(after, after.elements[0]!.id, degToRad(45), catalog);
    expect(!notElbow.ok && notElbow.error.code).toBe('NOT_AN_ELBOW');
  });
});
