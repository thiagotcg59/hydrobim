import { addPipe, createProject, vec3, type EndTreatment, type PipeSpec } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { buildElementGeometry } from './elements';
import { flangeDisc, flangeHubRadius, looseFlange } from './flange';
import { countOpenEdges } from './skin';
import type { MeshData } from './sweep';

/** Volume delimitado pela malha (positivo quando as faces apontam para fora). */
function volume(mesh: MeshData): number {
  const p = mesh.positions;
  let sum = 0;
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t]! * 3, mesh.indices[t + 1]! * 3, mesh.indices[t + 2]! * 3];
    sum +=
      p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) -
      p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) +
      p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!);
  }
  return sum / 6;
}

/** Faixa de X e maior raio (em torno do eixo X) dos vértices das malhas. */
function span(meshes: readonly MeshData[]): { minX: number; maxX: number; radius: number } {
  let [minX, maxX, radius] = [Infinity, -Infinity, 0];
  for (const mesh of meshes) {
    const p = mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      minX = Math.min(minX, p[i]!);
      maxX = Math.max(maxX, p[i]!);
      radius = Math.max(radius, Math.hypot(p[i + 1]!, p[i + 2]!));
    }
  }
  return { minX, maxX, radius };
}

// Ferro dúctil K9 DN 150 e flange PN 10 DN 150 do Catálogo Geral, p. 246 (valores em m).
const di150: PipeSpec = {
  specificationId: 'ferro-ductil-nbr7675-k9',
  material: 'ductileIron',
  standard: 'ABNT NBR 7675 / ISO 2531',
  jointType: 'socketSpigot',
  pressureClass: 'K9',
  dn: 150,
  sizeLabel: 'DN 150',
  outerDiameter: 0.17,
  wallThickness: 0.006,
  innerDiameter: 0.158,
};
const pn10: EndTreatment = {
  type: 'flange',
  length: 0.019,
  outerDiameter: 0.285,
  boltCircle: 0.24,
  boltCount: 8,
  boltHoleDiameter: 0.023,
  raisedFaceDiameter: 0.211,
  raisedFaceHeight: 0.003,
};
const ORIGIN = vec3(0, 0, 0);
const OUT = vec3(1, 0, 0);

describe('disco de flange padronizado', () => {
  it('com furação e ressalto: disco furado e anel do ressalto, ambos fechados', () => {
    const [disc, raised, ...rest] = flangeDisc(ORIGIN, OUT, pn10, 0.079);
    expect(rest).toHaveLength(0);
    expect(countOpenEdges(disc!)).toBe(0);
    expect(countOpenEdges(raised!)).toBe(0);
    // Disco: da face de trás (−a) até o início do ressalto (−c), com o Ø D do catálogo.
    const d = span([disc!]);
    expect(d.minX).toBeCloseTo(-0.019, 6);
    expect(d.maxX).toBeCloseTo(-0.003, 6);
    expect(d.radius).toBeCloseTo(0.1425, 6);
    // Ressalto: os últimos 3 mm até a face de vedação (a porta), com o Ø g.
    const r = span([raised!]);
    expect(r.minX).toBeCloseTo(-0.003, 6);
    expect(r.maxX).toBeCloseTo(0, 6);
    expect(r.radius).toBeCloseTo(0.1055, 6);
    // Volumes: coroa do disco menos os oito furos; coroa do ressalto.
    const discExact = Math.PI * (0.1425 ** 2 - 0.079 ** 2 - 8 * 0.0115 ** 2) * 0.016;
    expect(volume(disc!) / discExact).toBeGreaterThan(0.97);
    expect(volume(disc!) / discExact).toBeLessThan(1.01);
    const raisedExact = Math.PI * (0.1055 ** 2 - 0.079 ** 2) * 0.003;
    expect(volume(raised!) / raisedExact).toBeGreaterThan(0.98);
    expect(volume(raised!) / raisedExact).toBeLessThan(1.001);
  });

  it('sem ressalto tabulado o disco ocupa toda a espessura; sem furação, sai liso', () => {
    const { raisedFaceDiameter: _g, raisedFaceHeight: _c, ...flat } = pn10;
    const drilled = flangeDisc(ORIGIN, OUT, flat, 0.079);
    expect(drilled).toHaveLength(1);
    expect(span(drilled).maxX).toBeCloseTo(0, 6);
    const plain = flangeDisc(ORIGIN, OUT, { length: 0.019, outerDiameter: 0.285 }, 0.079);
    expect(plain).toHaveLength(1);
    expect(countOpenEdges(plain[0]!)).toBe(0);
    const exact = Math.PI * (0.1425 ** 2 - 0.079 ** 2) * 0.019;
    expect(volume(plain[0]!) / exact).toBeGreaterThan(0.98);
    // Ressalto incoerente (maior que o disco) é ignorado, sem deformar a peça.
    const odd = flangeDisc(ORIGIN, OUT, { ...pn10, raisedFaceDiameter: 0.4 }, 0.079);
    expect(odd).toHaveLength(1);
  });

  it('o cubo é limitado pela furação e nunca é menor que o tubo', () => {
    const hub = flangeHubRadius(pn10, 0.085);
    expect(hub).toBeGreaterThan(0.085);
    // Não invade os furos: fica aquém da borda interna deles.
    expect(hub).toBeLessThanOrEqual(0.12 - 0.0115);
    expect(flangeHubRadius({ length: 0.02, outerDiameter: 0.1 }, 0.085)).toBe(0.085);
  });

  it('flange avulso: disco, ressalto e cubo, com a face de vedação na origem', () => {
    const meshes = looseFlange(pn10, 0.085);
    expect(meshes).toHaveLength(3);
    for (const mesh of meshes) expect(countOpenEdges(mesh)).toBe(0);
    const s = span(meshes);
    expect(s.minX).toBeCloseTo(0, 6);
    expect(s.radius).toBeCloseTo(0.1425, 6);
    // O cubo fica atrás do disco (representação).
    expect(s.maxX).toBeGreaterThan(0.019);
  });
});

describe('tubo com flanges', () => {
  const build = (ends: { start: EndTreatment | null; end: EndTreatment | null }) => {
    const created = addPipe(createProject('g'), {
      start: vec3(0, 0, 0),
      end: vec3(0.8, 0, 0),
      spec: di150,
      ends: { ...ends, familyId: 'tubo-fofo-flanges-pn10' },
    });
    if (!created.ok) throw new Error(created.error.message);
    const element = created.value.project.elements[0]!;
    return buildElementGeometry(element).parts.map((part) => part.mesh);
  };

  it('flange e flange: nada ultrapassa as faces; o maior raio é o do flange', () => {
    const meshes = build({ start: pn10, end: pn10 });
    // Corpo + (disco e ressalto) em cada extremidade.
    expect(meshes).toHaveLength(5);
    for (const mesh of meshes) expect(countOpenEdges(mesh)).toBe(0);
    const s = span(meshes);
    expect(s.minX).toBeCloseTo(0, 6);
    expect(s.maxX).toBeCloseTo(0.8, 6);
    expect(s.radius).toBeCloseTo(0.1425, 6);
  });

  it('flange e ponta: só a extremidade flangeada recebe o disco', () => {
    const meshes = build({ start: pn10, end: null });
    expect(meshes).toHaveLength(3);
    const s = span(meshes);
    expect(s.minX).toBeCloseTo(0, 6);
    expect(s.maxX).toBeCloseTo(0.8, 6);
    // Junto à ponta lisa (x > 0,7) o raio é o do tubo.
    let tip = 0;
    for (const mesh of meshes) {
      const p = mesh.positions;
      for (let i = 0; i < p.length; i += 3) {
        if (p[i]! > 0.7) tip = Math.max(tip, Math.hypot(p[i + 1]!, p[i + 2]!));
      }
    }
    expect(tip).toBeCloseTo(0.085, 6);
  });

  it('ponta e ponta continua sendo o cilindro simples', () => {
    expect(build({ start: null, end: null })).toHaveLength(1);
  });
});
