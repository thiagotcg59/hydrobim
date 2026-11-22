import type { Point2 } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import {
  ALL_SNAPS_ON,
  perpendicularFoot,
  resolveSnap,
  segmentIntersection,
  segmentNear,
  type SnapContext,
  type SnapSegment,
} from './planSnaps';

const p = (x: number, y: number): Point2 => ({ x, y });
const deg = (value: number): number => (value * Math.PI) / 180;
const segment = (
  a: Point2,
  b: Point2,
  name = 'Parede 1',
  role: SnapSegment['role'] = 'face',
): SnapSegment => ({ a, b, sourceId: name, sourceName: name, role });

const base: SnapContext = {
  raw: p(0, 0),
  tolerance: 0.1,
  segments: [],
  anchor: null,
  previous: null,
  reference: null,
  settings: ALL_SNAPS_ON,
  gridStep: 0,
  polar: false,
  cycle: 0,
};

/** Ângulo (rad) entre dois vetores. */
// (pelo arco tangente: bem condicionado também perto de 0° e de 180°)
const angleBetween = (u: Point2, v: Point2): number =>
  Math.atan2(Math.abs(u.x * v.y - u.y * v.x), u.x * v.x + u.y * v.y);

describe('perpendicularidade em paredes oblíquas', () => {
  // Parede a 23°, de (0,0) a 5 m.
  const start = p(0, 0);
  const end = p(5 * Math.cos(deg(23)), 5 * Math.sin(deg(23)));
  const along = { x: Math.cos(deg(23)), y: Math.sin(deg(23)) };
  const normal = { x: -along.y, y: along.x };

  it('o trecho seguinte sai a exatos 90° do trecho anterior a 23°', () => {
    // Cursor a ~3 m na perpendicular, 4 cm fora dela (dentro da tolerância de 10 cm).
    const raw = p(end.x + normal.x * 3 + along.x * 0.04, end.y + normal.y * 3 + along.y * 0.04);
    const snap = resolveSnap({ ...base, raw, anchor: end, previous: start });
    expect(snap.kind).toBe('perpendicularPrevious');
    expect(snap.label).toBe('Perpendicular ao trecho anterior · 90°');
    const drawn = { x: snap.point.x - end.x, y: snap.point.y - end.y };
    const previous = { x: end.x - start.x, y: end.y - start.y };
    // Conferência numérica: ângulo reto com erro abaixo de um bilionésimo de radiano.
    expect(Math.abs(angleBetween(drawn, previous) - Math.PI / 2)).toBeLessThan(1e-9);
    // A direção resultante é 113° (23° + 90°), não um eixo do plano de trabalho.
    expect((Math.atan2(drawn.y, drawn.x) * 180) / Math.PI).toBeCloseTo(113, 6);
    expect(Math.hypot(drawn.x, drawn.y)).toBeCloseTo(3, 9);
    expect(snap.rightAngle?.at).toEqual(end);
    expect(snap.direction).not.toBeNull();
  });

  it('perpendicular e paralela a uma aresta de referência escolhida (parede a 23°)', () => {
    const reference = segment(start, end, 'Parede oblíqua');
    const anchor = p(8, 1);
    const toward = p(
      anchor.x + normal.x * 2 + along.x * 0.03,
      anchor.y + normal.y * 2 + along.y * 0.03,
    );
    const perpendicular = resolveSnap({ ...base, raw: toward, anchor, reference });
    expect(perpendicular.kind).toBe('perpendicularReference');
    expect(perpendicular.label).toContain('Perpendicular · 90°');
    expect(perpendicular.segment).toBe(reference);
    const drawn = { x: perpendicular.point.x - anchor.x, y: perpendicular.point.y - anchor.y };
    expect(Math.abs(angleBetween(drawn, along) - Math.PI / 2)).toBeLessThan(1e-9);

    const beside = p(
      anchor.x + along.x * 2 - normal.x * 0.03,
      anchor.y + along.y * 2 - normal.y * 0.03,
    );
    const parallel = resolveSnap({ ...base, raw: beside, anchor, reference });
    expect(parallel.kind).toBe('parallelReference');
    const run = { x: parallel.point.x - anchor.x, y: parallel.point.y - anchor.y };
    expect(angleBetween(run, along)).toBeLessThan(1e-9);
  });

  it('pé da perpendicular: projeção do ponto inicial sobre a aresta oblíqua', () => {
    const wall = segment(start, end, 'Parede oblíqua');
    const anchor = p(-1, 3);
    const foot = perpendicularFoot(anchor, start, end);
    if (!foot) throw new Error('sem pé');
    const snap = resolveSnap({
      ...base,
      raw: p(foot.x + 0.03, foot.y - 0.02),
      anchor,
      segments: [wall],
    });
    expect(snap.kind).toBe('perpendicular');
    expect(snap.point.x).toBeCloseTo(foot.x, 12);
    expect(snap.point.y).toBeCloseTo(foot.y, 12);
    const drawn = { x: snap.point.x - anchor.x, y: snap.point.y - anchor.y };
    expect(Math.abs(angleBetween(drawn, along) - Math.PI / 2)).toBeLessThan(1e-9);
    expect(snap.rightAngle?.at).toEqual(snap.point);
    expect(snap.guides).toHaveLength(1);
    expect(snap.segment).toBe(wall);
  });

  it('diferencia ortogonal aos eixos de perpendicular ao trecho anterior', () => {
    // Trecho anterior a 23°; o cursor segue o eixo Y do plano de trabalho.
    const vertical = resolveSnap({
      ...base,
      raw: p(end.x + 0.02, end.y + 3),
      anchor: end,
      previous: start,
    });
    expect(vertical.kind).toBe('ortho');
    expect(vertical.label).toBe('Ortogonal · eixo Y');
    expect(vertical.point.x).toBe(end.x);
    // Com o trecho anterior ortogonal, as duas relações coincidem: vale a do trecho anterior.
    const square = resolveSnap({
      ...base,
      raw: p(4.02, 3),
      anchor: p(4, 0),
      previous: p(0, 0),
    });
    expect(square.kind).toBe('perpendicularPrevious');
    expect(square.point).toEqual(p(4, 3));
  });
});

describe('capturas de ponto', () => {
  const horizontal = segment(p(0, 0), p(6, 0), 'Parede 1');
  const vertical = segment(p(2, -3), p(2, 3), 'Parede 2');

  it('extremidade, interseção, ponto médio e ponto sobre a aresta, nessa ordem de prioridade', () => {
    const segments = [horizontal, vertical];
    expect(resolveSnap({ ...base, raw: p(0.04, 0.03), segments }).kind).toBe('endpoint');
    const crossing = resolveSnap({ ...base, raw: p(2.04, 0.03), segments });
    expect(crossing.kind).toBe('intersection');
    expect(crossing.point).toEqual(p(2, 0));
    const middle = resolveSnap({ ...base, raw: p(3.03, 0.02), segments });
    expect(middle.kind).toBe('midpoint');
    expect(middle.point).toEqual(p(3, 0));
    const on = resolveSnap({ ...base, raw: p(4.5, 0.04), segments });
    expect(on.kind).toBe('nearest');
    expect(on.point.x).toBeCloseTo(4.5, 12);
    expect(on.point.y).toBe(0);
    expect(segmentIntersection(horizontal, segment(p(0, 1), p(6, 1)))).toBeNull();
  });

  it('alinhamento com extremidades: mesmo X, mesmo Y e o cruzamento das duas guias', () => {
    const segments = [segment(p(0, 0), p(6, 0)), segment(p(9, 4), p(9, 8))];
    const aligned = resolveSnap({ ...base, raw: p(6.03, 5), segments });
    expect(aligned.kind).toBe('alignment');
    expect(aligned.point).toEqual(p(6, 5));
    const both = resolveSnap({ ...base, raw: p(6.03, 4.02), segments });
    expect(both.label).toBe('Alinhamento · X e Y');
    expect(both.point).toEqual(p(6, 4));
    expect(both.guides).toHaveLength(2);
  });

  it('grade e ponto livre são o último recurso', () => {
    expect(resolveSnap({ ...base, raw: p(1.23, 4.56), gridStep: 0.5 })).toMatchObject({
      kind: 'grid',
      point: p(1, 4.5),
    });
    expect(resolveSnap({ ...base, raw: p(1.23, 4.56) })).toMatchObject({
      kind: 'free',
      point: p(1.23, 4.56),
    });
  });

  it('a direção travada termina na aresta que ela cruza junto ao cursor', () => {
    // Aresta oblíqua: o eixo X que sai de (0, 2) a cruza em x = 5 + 2 × 4 ÷ 11.
    const target = segment(p(5, -2), p(7, 9), 'Parede 3');
    const snap = resolveSnap({
      ...base,
      raw: p(5.7, 2.03),
      anchor: p(0, 2),
      segments: [target],
    });
    expect(snap.kind).toBe('ortho');
    expect(snap.point.x).toBeCloseTo(5 + 8 / 11, 12);
    expect(snap.point.y).toBe(2);
    expect(snap.label).toContain('até face de Parede 3');
    // Em aresta perpendicular ao eixo, o mesmo ponto é o pé da perpendicular: vale essa captura.
    const square = resolveSnap({
      ...base,
      raw: p(4.96, 2.03),
      anchor: p(0, 2),
      segments: [segment(p(5, -2), p(5, 9), 'Parede 4')],
    });
    expect(square.kind).toBe('perpendicular');
    expect(square.point).toEqual(p(5, 2));
  });
});

describe('tolerância, prioridade e alternância', () => {
  it('a tolerância é em metros convertidos de pixels: o mesmo desvio na tela em qualquer zoom', () => {
    const wall = segment(p(0, 0), p(6, 0));
    const pixels = 10;
    for (const mpp of [0.002, 0.01, 0.05, 0.2]) {
      const tolerance = pixels * mpp;
      // 8 px da extremidade captura; 12 px, não — em qualquer ampliação.
      const inside = resolveSnap({ ...base, tolerance, raw: p(0, 8 * mpp), segments: [wall] });
      const outside = resolveSnap({ ...base, tolerance, raw: p(0, 12 * mpp), segments: [wall] });
      expect(inside.kind).toBe('endpoint');
      expect(outside.kind).not.toBe('endpoint');
    }
  });

  it('com referências sobrepostas a escolha é determinística e Tab percorre as alternativas', () => {
    // Duas paredes com extremidades a 3 cm uma da outra e uma terceira cruzando ali.
    const segments = [
      segment(p(0, 0), p(4, 0), 'Parede A'),
      segment(p(4.03, 0), p(8, 0), 'Parede B'),
      segment(p(4.01, -2), p(4.01, 2), 'Parede C'),
    ];
    const context = { ...base, raw: p(4.02, 0.01), segments };
    const first = resolveSnap(context);
    const again = resolveSnap({ ...context, segments: [...segments].reverse() });
    // A ordem em que as arestas chegam não muda o resultado.
    expect(again.point).toEqual(first.point);
    expect(again.kind).toBe(first.kind);
    expect(first.count).toBeGreaterThan(2);
    const seen = new Set<string>();
    for (let cycle = 0; cycle < first.count; cycle += 1) {
      const snap = resolveSnap({ ...context, cycle });
      expect(snap.index).toBe(cycle);
      seen.add(`${snap.point.x};${snap.point.y}`);
    }
    // Cada alternativa é um ponto distinto, e a volta completa retorna à primeira.
    expect(seen.size).toBe(first.count);
    expect(resolveSnap({ ...context, cycle: first.count }).point).toEqual(first.point);
    expect(resolveSnap({ ...context, cycle: -1 }).index).toBe(first.count - 1);
  });

  it('capturas desligadas não entram', () => {
    const wall = segment(p(0, 0), p(6, 0));
    const off = { ...ALL_SNAPS_ON, endpoint: false, nearest: false, alignment: false };
    expect(resolveSnap({ ...base, raw: p(0.02, 0.02), segments: [wall], settings: off }).kind).toBe(
      'free',
    );
    const noDirection = { ...ALL_SNAPS_ON, direction: false, ortho: false };
    const snap = resolveSnap({
      ...base,
      raw: p(4.02, 3),
      anchor: p(4, 0),
      previous: p(0, 0),
      settings: noDirection,
    });
    expect(snap.kind).toBe('free');
  });
});

describe('Shift, grade e aresta de referência', () => {
  it('a trava de ângulo substitui as direções, mas um ponto notável prevalece', () => {
    const snap = resolveSnap({ ...base, raw: p(3, 0.4), anchor: p(0, 0), polar: true });
    expect(snap.kind).toBe('polar');
    expect(snap.point.y).toBe(0);
    expect(snap.label).toBe('Trava de ângulo · 0°');
    const diagonal = resolveSnap({ ...base, raw: p(3, 2.6), anchor: p(0, 0), polar: true });
    expect(diagonal.label).toBe('Trava de ângulo · 45°');
    expect(diagonal.point.x).toBeCloseTo(diagonal.point.y, 12);
    const wall = segment(p(3, 1), p(3, 5));
    const endpoint = resolveSnap({
      ...base,
      raw: p(3.02, 1.03),
      anchor: p(0, 0),
      polar: true,
      segments: [wall],
    });
    expect(endpoint.kind).toBe('endpoint');
  });

  it('com a grade, o comprimento do trecho travado anda pelo passo', () => {
    const snap = resolveSnap({
      ...base,
      raw: p(0.03, 2.37),
      anchor: p(0, 0),
      gridStep: 0.25,
    });
    expect(snap.kind).toBe('ortho');
    expect(snap.point).toEqual(p(0, 2.25));
  });

  it('escolhe a aresta mais próxima como referência', () => {
    const a = segment(p(0, 0), p(6, 0), 'A');
    const b = segment(p(0, 0.15), p(6, 0.15), 'B');
    expect(segmentNear(p(3, 0.05), [a, b], 0.1)).toBe(a);
    expect(segmentNear(p(3, 0.11), [a, b], 0.1)).toBe(b);
    expect(segmentNear(p(3, 2), [a, b], 0.1)).toBeNull();
  });
});
