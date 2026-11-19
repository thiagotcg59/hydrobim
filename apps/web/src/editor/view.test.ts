import { vec3 } from '@hydrobim/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { formatSegment, segmentReadout } from './segment';
import {
  clearViewFocus,
  getViewDirection,
  getViewFocus,
  ISO_QUADRANTS,
  nextIsoQuadrant,
  orthographicZoomFor,
  perspectiveDistanceFor,
  planScaleFor,
  setViewFocus,
  VIEW_DIRECTIONS,
} from './viewPresets';

describe('vistas isométricas', () => {
  it('olham pela diagonal do cubo: os três eixos com o mesmo encurtamento', () => {
    const seen = new Set<string>();
    for (const quadrant of ISO_QUADRANTS) {
      const [x, y, z] = VIEW_DIRECTIONS[quadrant];
      expect(Math.abs(x)).toBe(1);
      expect(Math.abs(y)).toBe(1);
      expect(z).toBe(1);
      // Elevação da câmera: atan(1/√2) ≈ 35,264°.
      expect((Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI).toBeCloseTo(35.264, 3);
      seen.add(`${x},${y}`);
    }
    expect(seen.size).toBe(4);
  });

  it('percorre os quatro quadrantes e começa pelo sudeste', () => {
    expect(nextIsoQuadrant(null)).toBe('isoSE');
    expect(nextIsoQuadrant('top')).toBe('isoSE');
    expect(nextIsoQuadrant('isoSE')).toBe('isoSW');
    expect(nextIsoQuadrant('isoSW')).toBe('isoNW');
    expect(nextIsoQuadrant('isoNW')).toBe('isoNE');
    expect(nextIsoQuadrant('isoNE')).toBe('isoSE');
  });
});

describe('ponto de interesse entre as vistas', () => {
  beforeEach(clearViewFocus);

  it('guarda centro, ampliação e direção; ignora ampliação inválida', () => {
    expect(getViewFocus()).toBeNull();
    setViewFocus({ center: vec3(4, 2, 1), halfHeight: 3 }, vec3(1, -1, 1));
    setViewFocus({ center: vec3(0, 0, 0), halfHeight: 0 });
    setViewFocus({ center: vec3(0, 0, 0), halfHeight: Number.NaN });
    expect(getViewFocus()).toEqual({ center: vec3(4, 2, 1), halfHeight: 3 });
    // Sem direção informada (planta), a do modelo 3D é preservada.
    setViewFocus({ center: vec3(5, 2, 1), halfHeight: 2 });
    expect(getViewDirection()).toEqual(vec3(1, -1, 1));
    clearViewFocus();
    expect(getViewFocus()).toBeNull();
    expect(getViewDirection()).toBeNull();
  });

  it('converte a mesma altura visível entre planta, perspectiva e ortográfica', () => {
    // 3 m de meia altura em uma vista de 600 px: 1 cm por pixel, 100 px por metro.
    expect(planScaleFor(3, 600)).toBeCloseTo(0.01);
    expect(orthographicZoomFor(3, 600)).toBeCloseTo(100);
    const fov = Math.PI / 4;
    const dist = perspectiveDistanceFor(3, fov);
    expect(dist * Math.tan(fov / 2)).toBeCloseTo(3);
  });
});

describe('leitura do trecho', () => {
  it('separa comprimento real, projeção horizontal e desnível', () => {
    const readout = segmentReadout(vec3(0, 0, 1), vec3(3, 4, 13));
    expect(readout.length).toBeCloseTo(13);
    expect(readout.horizontal).toBeCloseTo(5);
    expect(readout.rise).toBeCloseTo(12);
  });

  it('formata conforme o trecho: horizontal, inclinado e prumada', () => {
    expect(formatSegment(vec3(0, 0, 0), vec3(2.4, 0, 0))).toBe('2,40 m');
    expect(formatSegment(vec3(0, 0, 0), vec3(2.4, 0, 0), Math.PI / 2)).toBe('2,40 m · 90°');
    expect(formatSegment(vec3(0, 0, 1), vec3(1.5, 0, 0))).toBe(
      'L 1,80 m · proj. 1,50 m · ΔZ -1,00 m',
    );
    expect(formatSegment(vec3(0, 0, 0.3), vec3(0, 0, 3))).toBe('L 2,70 m · ΔZ 2,70 m');
  });
});
