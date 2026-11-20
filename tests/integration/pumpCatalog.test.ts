import {
  getPumpFamily,
  PUMP_FAMILIES,
  resolvePipeSpec,
  resolvePumpPlacement,
} from '@hydrobim/catalog';
import {
  createProject,
  drawPipe,
  getElement,
  getPorts,
  parseProject,
  placeEquipment,
  serializeProject,
  updateFitting,
  validateProject,
  vec3,
  type Project,
  type Pump,
  type PumpFamily,
} from '@hydrobim/core';
import { buildElementGeometry, countOpenEdges, type MeshPart } from '@hydrobim/geometry';
import { exportIfc } from '@hydrobim/ifc';
import { describe, expect, it } from 'vitest';

const DUCTILE = 'ferro-ductil-nbr7675-k9';
const base = resolvePipeSpec(DUCTILE, 100)!;

function place(family: PumpFamily, variantId: string): { project: Project; pump: Pump } {
  const placement = resolvePumpPlacement(family, { variantId }, base);
  if (!placement.ok) throw new Error(`${variantId}: ${placement.error.message}`);
  const placed = placeEquipment(createProject('Bombas', 'infra'), {
    spec: placement.value.spec,
    fitting: placement.value.fitting,
    position: vec3(10, 20, 100),
  });
  if (!placed.ok) throw new Error(`${variantId}: ${placed.error.message}`);
  const pump = getElement(placed.value.project, placed.value.elementId);
  if (pump?.kind !== 'pump') throw new Error('Bomba não criada.');
  return { project: placed.value.project, pump };
}

function bounds(parts: readonly MeshPart[]) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const p = part.mesh.positions;
    for (let i = 0; i < p.length; i += 1) {
      const axis = i % 3;
      min[axis] = Math.min(min[axis]!, p[i]!);
      max[axis] = Math.max(max[axis]!, p[i]!);
    }
  }
  return { min, max };
}

describe('bombas anfíbias HIGRA: do catálogo ao modelo 3D e ao IFC', () => {
  it('a geometria de cada linha reproduz as cotas F, I e J e fica entre os flanges', () => {
    for (const family of PUMP_FAMILIES) {
      for (const variant of family.variants) {
        const { project, pump } = place(family, variant.id);
        expect(validateProject(project), variant.id).toEqual([]);
        const { parts } = buildElementGeometry(pump);
        const { min, max } = bounds(parts);
        const d = variant.dimensions;
        // Comprimento: da face do flange A (x = 0) à face do flange B (x = F).
        expect(min[0], variant.id).toBeCloseTo(0, 6);
        expect(max[0], variant.id).toBeCloseTo(d.length, 6);
        // Altura: base dos pés em −I e topo dos olhais em J − I.
        expect(min[2], variant.id).toBeCloseTo(-d.axisHeight, 6);
        expect(max[2], variant.id).toBeCloseTo(d.totalHeight - d.axisHeight, 6);
        // Largura: pelo menos a distância entre os furos dos pés (cota G).
        expect(max[1]! - min[1]!, variant.id).toBeGreaterThan(d.footWidth);
        // Corpo com o revestimento do fabricante; nada do corpo genérico de motobomba.
        const roles = new Set(parts.map((part) => part.role));
        expect([...roles].sort(), variant.id).toEqual(['coated', 'trim']);
        for (const part of parts) {
          expect(Array.from(part.mesh.positions).every(Number.isFinite), variant.id).toBe(true);
          expect(part.mesh.indices.length % 3).toBe(0);
          expect(countOpenEdges(part.mesh), variant.id).toBe(0);
        }
      }
    }
  });

  it('a bomba de múltiplos estágios tem mais anéis no lado da sucção que a de estágio único', () => {
    const single = getPumpFamily('higra-anfibia-estagio-unico-60hz')!;
    const multi = getPumpFamily('higra-anfibia-multiplos-estagios-60hz')!;
    const vertices = (family: PumpFamily, index: number): number =>
      buildElementGeometry(place(family, family.variants[index]!.id).pump).parts.reduce(
        (sum, part) => sum + part.mesh.positions.length,
        0,
      );
    // Mesma carcaça (132L, DN 80): R1-195 (1 estágio) e R2-155 (2 estágios).
    expect(vertices(multi, 0)).toBeGreaterThan(vertices(single, 0));
  });

  it('liga um tubo à descarga, edita uma cota e reabre o projeto', () => {
    const family = getPumpFamily('higra-anfibia-estagio-unico-60hz')!;
    const { project, pump } = place(family, family.variants[1]!.id);
    const discharge = getPorts(pump)[1]!;
    expect(discharge.spec.dn).toBe(200);
    const drawn = drawPipe(project, {
      fromPort: discharge.ref,
      start: discharge.position,
      end: vec3(discharge.position.x + 4, 20, 100),
      spec: discharge.spec,
    });
    if (!drawn.ok) throw new Error(drawn.error.message);
    expect(validateProject(drawn.value.project)).toEqual([]);

    const edited = updateFitting(drawn.value.project, pump.id, { length: 1.1 });
    if (!edited.ok) throw new Error(edited.error.message);
    expect(validateProject(edited.value)).toEqual([]);
    const reopened = parseProject(serializeProject(edited.value));
    if (!reopened.ok) throw new Error(reopened.error.message);
    const after = getElement(reopened.value, pump.id);
    expect(after?.kind === 'pump' && after.length).toBe(1.1);
    expect(after?.kind === 'pump' && after.variantId).toBeUndefined();
    expect(after?.familyId).toBe(family.id);
  });

  it('exporta a bomba anfíbia como IfcPump SUBMERSIBLEPUMP, com o modelo do fabricante', () => {
    const family = getPumpFamily('higra-anfibia-multiplos-estagios-60hz')!;
    const { project } = place(family, family.variants[1]!.id);
    const text = exportIfc(project, { timestamp: new Date('2026-01-01T00:00:00Z') });
    expect(text).toMatch(/=IFCPUMP\(.*\.SUBMERSIBLEPUMP\.\);/);
    expect(text).toMatch(/=IFCPUMPTYPE\(.*\.SUBMERSIBLEPUMP\.\);/);
    expect(text).not.toContain('.ENDSUCTION.');
    expect(text).toContain('R2-265/40B a R2-265/60B');
    expect(text).toContain('HIGRA');
  });
});
