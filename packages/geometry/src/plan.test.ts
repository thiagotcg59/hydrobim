import { addPipe, createProject, QUAT_IDENTITY, vec3, ZERO } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { buildElementGeometry } from './elements';
import { box } from './loft';
import { planOutline } from './plan';

const spec = {
  specificationId: 'teste',
  material: 'pvc',
  standard: 'Norma de teste',
  jointType: 'solventWeld',
  pressureClass: null,
  dn: 100,
  sizeLabel: 'DN 100',
  outerDiameter: 0.1,
  wallThickness: 0.005,
  innerDiameter: 0.09,
} as const;

const identity = { position: ZERO, rotation: QUAT_IDENTITY };

function segments(lines: Float64Array): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (let i = 0; i < lines.length; i += 4) {
    out.push([lines[i] ?? 0, lines[i + 1] ?? 0, lines[i + 2] ?? 0, lines[i + 3] ?? 0]);
  }
  return out;
}

const totalLength = (lines: Float64Array): number =>
  segments(lines).reduce((sum, [x1, y1, x2, y2]) => sum + Math.hypot(x2 - x1, y2 - y1), 0);

function fillArea(fill: Float64Array): number {
  let area = 0;
  for (let i = 0; i < fill.length; i += 6) {
    const [ax, ay, bx, by, cx, cy] = [0, 1, 2, 3, 4, 5].map((k) => fill[i + k] ?? 0);
    area +=
      Math.abs(
        ((bx ?? 0) - (ax ?? 0)) * ((cy ?? 0) - (ay ?? 0)) -
          ((cx ?? 0) - (ax ?? 0)) * ((by ?? 0) - (ay ?? 0)),
      ) / 2;
  }
  return area;
}

describe('projeção em planta', () => {
  it('caixa: contorno retangular, sem as arestas de baixo nem diagonais', () => {
    const outline = planOutline({
      transform: identity,
      parts: [{ role: 'body', mesh: box(vec3(0, 0, 0), vec3(2, 1, 0.5)) }],
    });
    expect(fillArea(outline.fill)).toBeCloseTo(2, 5);
    // Perímetro do topo: as arestas do fundo coincidem em planta com o contorno aparente.
    expect(totalLength(outline.lines)).toBeCloseTo(6, 4);
    expect([outline.minX, outline.minY, outline.maxX, outline.maxY]).toEqual([0, 0, 2, 1]);
    expect(outline.maxZ).toBeCloseTo(0.5, 6);
  });

  it('parte mais alta esconde as linhas da parte de baixo', () => {
    const below = { role: 'body' as const, mesh: box(vec3(0, 0, 0), vec3(4, 1, 0.2)) };
    const above = { role: 'body' as const, mesh: box(vec3(1, -1, 0.5), vec3(3, 2, 0.8)) };
    const alone = totalLength(planOutline({ transform: identity, parts: [below] }).lines);
    const both = totalLength(planOutline({ transform: identity, parts: [below, above] }).lines);
    // Some o trecho de 2 m de cada lado longo da caixa de baixo; entra o perímetro da de cima.
    expect(alone).toBeCloseTo(10, 4);
    // O corte entre o trecho visível e o oculto é localizado por bisseção (erro abaixo de 1 mm).
    expect(both).toBeCloseTo(10 - 4 + 10, 2);
  });

  it('separa preenchimento e linhas pelo papel da parte, de baixo para cima', () => {
    const below = { role: 'body' as const, mesh: box(vec3(0, 0, 0), vec3(4, 1, 0.2)) };
    const above = { role: 'accent' as const, mesh: box(vec3(1, -1, 0.5), vec3(3, 2, 0.8)) };
    // A ordem das partes na malha não define a ordem de desenho: vale a cota.
    const outline = planOutline({ transform: identity, parts: [above, below] });
    expect(outline.shading.map((shade) => shade.role)).toEqual(['body', 'accent']);
    expect(outline.shading.map((shade) => fillArea(shade.fill))).toEqual([
      expect.closeTo(4, 5),
      expect.closeTo(6, 5),
    ]);
    const byRole = new Map(outline.lineGroups.map((group) => [group.role, group.lines]));
    expect(totalLength(byRole.get('body') ?? new Float64Array(0))).toBeCloseTo(6, 2);
    expect(totalLength(byRole.get('accent') ?? new Float64Array(0))).toBeCloseTo(10, 2);
    // Os grupos são uma partição de `lines`.
    expect(outline.lineGroups.reduce((sum, group) => sum + group.lines.length, 0)).toBe(
      outline.lines.length,
    );
  });

  it('tubo horizontal: duas geratrizes na largura do diâmetro externo', () => {
    const created = addPipe(createProject('Planta'), {
      start: vec3(0, 0, 1),
      end: vec3(2, 0, 1),
      spec,
    });
    if (!created.ok) throw new Error(created.error.message);
    const pipe = created.value.project.elements[0];
    if (!pipe) throw new Error('sem tubo');
    const outline = planOutline(buildElementGeometry(pipe));
    expect(outline.minY).toBeCloseTo(-0.05, 3);
    expect(outline.maxY).toBeCloseTo(0.05, 3);
    expect(outline.minX).toBeCloseTo(0, 6);
    expect(outline.maxX).toBeCloseTo(2, 6);
    const long = segments(outline.lines).filter(([x1, , x2]) => Math.abs(x2 - x1) > 1.9);
    expect(long.map(([, y]) => Math.abs(y)).every((y) => Math.abs(y - 0.05) < 2e-3)).toBe(true);
    expect(long.length).toBeGreaterThanOrEqual(2);
    // O tubo é oco: a parede interna voltada para cima também entra na máscara.
    expect(fillArea(outline.fill)).toBeGreaterThan(0.199);
  });
});
