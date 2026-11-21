import { describe, expect, it } from 'vitest';
import { pinchWindow, type PlanWindow, type ScreenPoint } from './touchGestures';

const modelAt = (w: PlanWindow, p: ScreenPoint) => ({
  x: w.cx + p.x * w.mpp,
  y: w.cy - p.y * w.mpp,
});

describe('pinça na planta', () => {
  const start: PlanWindow = { mpp: 0.1, cx: 500, cy: 200 };

  it('afastar os dedos aproxima, mantendo o ponto entre eles no lugar', () => {
    const a0 = { x: -50, y: 20 };
    const b0 = { x: 50, y: 20 };
    const next = pinchWindow(start, a0, b0, { x: -100, y: 20 }, { x: 100, y: 20 }, 200);
    expect(next.mpp).toBeCloseTo(0.05, 12);
    const before = modelAt(start, { x: 0, y: 20 });
    const after = modelAt(next, { x: 0, y: 20 });
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('mover os dois dedos juntos desloca a vista sem mudar a escala', () => {
    const next = pinchWindow(
      start,
      { x: -40, y: 0 },
      { x: 40, y: 0 },
      { x: -10, y: 30 },
      { x: 70, y: 30 },
      200,
    );
    expect(next.mpp).toBeCloseTo(0.1, 12);
    // O ponto do modelo que estava sob (0; 0) está agora sob (30; 30).
    const point = modelAt(next, { x: 30, y: 30 });
    expect(point.x).toBeCloseTo(500, 9);
    expect(point.y).toBeCloseTo(200, 9);
  });

  it('respeita o afastamento máximo e não salta com os dedos juntos', () => {
    const far = pinchWindow(
      start,
      { x: -200, y: 0 },
      { x: 200, y: 0 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      1,
    );
    expect(far.mpp).toBe(1);
    const close = pinchWindow(
      start,
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      200,
    );
    expect(Number.isFinite(close.mpp)).toBe(true);
    expect(close.mpp).toBeCloseTo(0.1, 12);
  });
});
