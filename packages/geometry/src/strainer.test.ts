import {
  addPipe,
  attachFitting,
  createFamilyCatalog,
  createProject,
  vec3,
  type FittingFamily,
  type PipeSpec,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { buildElementGeometry } from './elements';
import { drilledFlange } from './flange';
import { planOutline } from './plan';
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

// Tubo de aço 4" SCH 40 e flange ASME B16.1 classe 125 de 4" (valores do catálogo embutido).
const steel4: PipeSpec = {
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
const flange4 = {
  length: 0.0239,
  outerDiameter: 0.2286,
  boltCircle: 0.1905,
  boltCount: 8,
  boltHoleDiameter: 0.01905,
};

function strainer(spec: PipeSpec, size: FittingFamily['sizes'][number]) {
  const family: FittingFamily = {
    id: 'filtro-y',
    name: 'Filtro Y',
    kind: 'valve',
    valveType: 'strainer',
    specificationId: spec.specificationId,
    endType: 'flange',
    manufacturer: null,
    standard: 'Teste',
    source: 'Teste',
    origin: 'builtin',
    sizes: [size],
  };
  const pipe = addPipe(createProject('g'), { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec });
  if (!pipe.ok) throw new Error(pipe.error.message);
  const attached = attachFitting(pipe.value.project, {
    target: { elementId: pipe.value.elementId, portId: 'end' },
    fitting: { kind: 'valve', valveType: 'strainer' },
    catalog: createFamilyCatalog([family]),
  });
  if (!attached.ok) throw new Error(attached.error.message);
  const element = attached.value.project.elements.find((e) => e.kind === 'valve')!;
  return { element, project: attached.value.project };
}

describe('flange com furação', () => {
  const base = {
    back: vec3(0, 0, 0),
    axis: vec3(1, 0, 0),
    thickness: flange4.length,
    innerRadius: steel4.innerDiameter / 2,
    outerRadius: flange4.outerDiameter / 2,
    boltCircleRadius: flange4.boltCircle / 2,
    boltCount: flange4.boltCount,
    boltHoleRadius: flange4.boltHoleDiameter / 2,
  };

  it('gera um sólido fechado com o volume do disco menos o furo central e os furos', () => {
    for (const boltCount of [4, 8, 12, 16]) {
      const mesh = drilledFlange({ ...base, boltCount })!;
      expect(countOpenEdges(mesh), `${boltCount} furos`).toBe(0);
      const exact =
        Math.PI *
        (base.outerRadius ** 2 - base.innerRadius ** 2 - boltCount * base.boltHoleRadius ** 2) *
        base.thickness;
      // Círculos facetados: o volume fica pouco abaixo do exato.
      expect(volume(mesh) / exact, `${boltCount} furos`).toBeGreaterThan(0.97);
      expect(volume(mesh) / exact, `${boltCount} furos`).toBeLessThan(1.01);
    }
  });

  it('respeita as dimensões e deixa os furos simétricos aos eixos principais', () => {
    const mesh = drilledFlange(base)!;
    const p = mesh.positions;
    let maxRadius = 0;
    let minRadius = Infinity;
    for (let i = 0; i < p.length; i += 3) {
      expect(p[i]!).toBeGreaterThanOrEqual(-1e-9);
      expect(p[i]!).toBeLessThanOrEqual(base.thickness + 1e-7);
      const radius = Math.hypot(p[i + 1]!, p[i + 2]!);
      maxRadius = Math.max(maxRadius, radius);
      minRadius = Math.min(minRadius, radius);
    }
    expect(maxRadius).toBeCloseTo(base.outerRadius, 6);
    expect(minRadius).toBeCloseTo(base.innerRadius, 6);
    // Nenhum furo sobre o eixo vertical: ali o disco é maciço entre o furo central e a borda.
    const onAxis: number[] = [];
    for (let i = 0; i < p.length; i += 3) {
      if (Math.abs(p[i + 1]!) < 1e-7 && p[i + 2]! > 0) onAxis.push(p[i + 2]!);
    }
    expect(Math.min(...onAxis)).toBeCloseTo(base.innerRadius, 6);
    expect(Math.max(...onAxis)).toBeCloseTo(base.outerRadius, 6);
  });

  it('recusa furação que não cabe no disco', () => {
    expect(drilledFlange({ ...base, boltCircleRadius: base.outerRadius })).toBeNull();
    expect(drilledFlange({ ...base, boltCircleRadius: base.innerRadius })).toBeNull();
    expect(drilledFlange({ ...base, boltCount: 2 })).toBeNull();
    expect(drilledFlange({ ...base, boltCount: 40 })).toBeNull();
  });
});

describe('filtro Y', () => {
  // Spirax Sarco CI 4": A = 370 mm, B = 265 mm.
  const { element, project } = strainer(steel4, {
    dn: 100,
    length: 0.37,
    height: 0.265,
    end: flange4,
  });
  const geometry = buildElementGeometry({
    ...element,
    placement: { position: vec3(0, 0, 0), rotation: { x: 0, y: 0, z: 0, w: 1 } },
  } as typeof element);

  it('recebe do catálogo o face a face, a profundidade do bojo e a furação dos flanges', () => {
    expect(element.kind === 'valve' && element.valveType).toBe('strainer');
    expect(element.kind === 'valve' && element.length).toBeCloseTo(0.37);
    expect(element.kind === 'valve' && element.height).toBeCloseTo(0.265);
    expect(element.kind === 'valve' && element.ends.a).toEqual({ type: 'flange', ...flange4 });
    expect(project.elements).toHaveLength(2);
  });

  it('usa a pintura do ferro fundido no corpo e inox nos parafusos, sem acionamento', () => {
    const roles = new Set(geometry.parts.map((part) => part.role));
    expect([...roles].sort()).toEqual(['castIron', 'seal', 'trim']);
  });

  it('cabe entre as faces dos flanges e desce exatamente até a cota B do catálogo', () => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let maxY = 0;
    for (const part of geometry.parts) {
      const p = part.mesh.positions;
      for (let i = 0; i < p.length; i += 3) {
        expect(
          Number.isFinite(p[i]!) && Number.isFinite(p[i + 1]!) && Number.isFinite(p[i + 2]!),
        ).toBe(true);
        minX = Math.min(minX, p[i]!);
        maxX = Math.max(maxX, p[i]!);
        minZ = Math.min(minZ, p[i + 2]!);
        maxZ = Math.max(maxZ, p[i + 2]!);
        maxY = Math.max(maxY, Math.abs(p[i + 1]!));
      }
    }
    expect(minX).toBeCloseTo(-0.185, 6);
    expect(maxX).toBeCloseTo(0.185, 6);
    // Acima do eixo e para os lados, o maior raio é o do flange (Ø 228,6 mm).
    expect(maxZ).toBeCloseTo(0.1143, 4);
    expect(maxY).toBeCloseTo(0.1143, 4);
    // Ponto mais baixo: 265 mm abaixo do eixo.
    expect(minZ).toBeGreaterThanOrEqual(-0.265 - 1e-6);
    expect(minZ).toBeLessThan(-0.2649);
  });

  it('o bojo fica a jusante: abaixo do corpo, o conjunto pende para a porta b', () => {
    let sum = 0;
    let count = 0;
    let minX = Infinity;
    for (const part of geometry.parts) {
      const p = part.mesh.positions;
      for (let i = 0; i < p.length; i += 3) {
        if (p[i + 2]! > -0.12) continue;
        sum += p[i]!;
        count += 1;
        minX = Math.min(minX, p[i]!);
      }
    }
    expect(count).toBeGreaterThan(0);
    expect(sum / count).toBeGreaterThan(0);
    // O bojo não invade o flange de montante.
    expect(minX).toBeGreaterThan(-0.185 + flange4.length);
  });

  it('mostra os furos dos flanges na projeção em planta', () => {
    // Sem os furos a planta do flange teria só o retângulo do disco visto de cima.
    const plain = strainer(steel4, {
      dn: 100,
      length: 0.37,
      height: 0.265,
      end: { length: flange4.length, outerDiameter: flange4.outerDiameter },
    });
    const drilled = planOutline(buildElementGeometry(element)).lines.length;
    expect(drilled).toBeGreaterThan(0);
    expect(planOutline(buildElementGeometry(plain.element)).lines.length).toBeGreaterThan(0);
    const triangles = (target: typeof element): number =>
      buildElementGeometry(target).parts.reduce((sum, part) => sum + part.mesh.indices.length, 0);
    expect(triangles(element)).toBeGreaterThan(triangles(plain.element));
  });

  it('mantém a cota B nos demais diâmetros da tabela (2" e 12")', () => {
    const cases = [
      // [DE do tubo, parede, A, B, flange]
      [0.0603, 0.00391, 0.23, 0.159, [0.0157, 0.1524, 0.12065, 4, 0.01905]],
      [0.3238, 0.01031, 0.858, 0.61, [0.0318, 0.4826, 0.4318, 12, 0.0254]],
    ] as const;
    for (const [od, wall, a, b, [thickness, flangeOd, circle, count, hole]] of cases) {
      const spec = {
        ...steel4,
        outerDiameter: od,
        wallThickness: wall,
        innerDiameter: od - 2 * wall,
      };
      const built = strainer(spec, {
        dn: 100,
        length: a,
        height: b,
        end: {
          length: thickness,
          outerDiameter: flangeOd,
          boltCircle: circle,
          boltCount: count,
          boltHoleDiameter: hole,
        },
      });
      const parts = buildElementGeometry({
        ...built.element,
        placement: { position: vec3(0, 0, 0), rotation: { x: 0, y: 0, z: 0, w: 1 } },
      } as typeof built.element).parts;
      let minZ = Infinity;
      let minX = Infinity;
      let maxX = -Infinity;
      for (const part of parts) {
        const p = part.mesh.positions;
        for (let i = 0; i < p.length; i += 3) {
          minZ = Math.min(minZ, p[i + 2]!);
          minX = Math.min(minX, p[i]!);
          maxX = Math.max(maxX, p[i]!);
        }
      }
      expect(minZ, `A = ${a}`).toBeGreaterThanOrEqual(-b - 1e-6);
      expect(minZ, `A = ${a}`).toBeLessThan(-b + 1e-4);
      expect(minX, `A = ${a}`).toBeCloseTo(-a / 2, 6);
      expect(maxX, `A = ${a}`).toBeCloseTo(a / 2, 6);
    }
  });
});
