import { createProject, degToRad, vec3, type Pipe } from '@hydrobim/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../state/editorStore';
import { DEFAULT_PRECISION, sanitizePrecision, usePrecisionStore } from '../state/precisionStore';
import { lengthStepOf, precisePipePoint, precisePoint } from './precision';

const state = () => useEditorStore.getState();
const STEPS = { lengthStep: 0.05, angleStep: degToRad(1) };

beforeEach(() => {
  usePrecisionStore.getState().resetPrecision();
  state().loadProject(createProject('Teste', 'mep'));
  state().setToolOptions({ sizeMode: 'reducers', families: {}, lockElbowAngles: false });
});

describe('precisão da modelagem', () => {
  it('comprimento de 5 em 5 cm e direção de 1 em 1 grau, mantendo a cota pedida', () => {
    const p = precisePoint(vec3(0, 0, 0), vec3(2.03, 0.31, 0.4), 0, STEPS);
    const length = Math.hypot(p.x, p.y);
    const angle = Math.atan2(p.y, p.x);
    expect(length).toBeCloseTo(2.05);
    expect(angle).toBeCloseTo(degToRad(9));
    expect(p.z).toBe(0.4);
  });

  it('ângulos contados a partir do eixo de referência; trecho vertical só arredonda o desnível', () => {
    const reference = degToRad(33.3);
    const p = precisePoint(
      vec3(1, 1, 0),
      vec3(1 + Math.cos(reference), 1 + Math.sin(reference), 0),
      reference,
      STEPS,
    );
    expect(Math.atan2(p.y - 1, p.x - 1)).toBeCloseTo(reference);
    expect(Math.hypot(p.x - 1, p.y - 1)).toBeCloseTo(1);
    const up = precisePoint(vec3(0, 0, 0), vec3(0, 0, 1.27), 0, STEPS);
    expect(up.z).toBeCloseTo(1.25);
    // Bem junto à origem, o trecho não fica nulo: vale um passo.
    expect(
      Math.hypot(
        ...Object.values(precisePoint(vec3(0, 0, 0), vec3(0.01, 0, 0), 0, STEPS)).slice(0, 2),
      ),
    ).toBeCloseTo(0.05);
  });

  it('só vale no traçado do tubo com ponto de partida e com a precisão ligada', () => {
    const settings = usePrecisionStore.getState();
    expect(precisePipePoint(state(), vec3(1, 1, 0), settings)).toBeNull();
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 0));
    const p = precisePipePoint(state(), vec3(1.02, 0.004, 0), settings);
    expect(p?.x).toBeCloseTo(1);
    expect(p?.y).toBeCloseTo(0);
    expect(precisePipePoint(state(), vec3(1, 1, 0), { ...settings, enabled: false })).toBeNull();
    expect(lengthStepOf(state(), settings)).toBe(0.05);
    expect(lengthStepOf({ snapToGrid: true, gridStep: 0.1 }, { ...settings, enabled: false })).toBe(
      0.1,
    );
  });

  it('preferências: padrão 5 cm e 1°, valores inválidos voltam ao padrão, limites aplicados', () => {
    expect(DEFAULT_PRECISION.lengthStep).toBe(0.05);
    expect(DEFAULT_PRECISION.angleStep).toBeCloseTo(degToRad(1));
    expect(sanitizePrecision({ lengthStep: -1, angleStep: 'x' })).toEqual(DEFAULT_PRECISION);
    expect(sanitizePrecision({ lengthStep: 50 }).lengthStep).toBe(10);
    usePrecisionStore.getState().setPrecision({ lengthStep: 0.1, enabled: false });
    expect(usePrecisionStore.getState()).toMatchObject({ lengthStep: 0.1, enabled: false });
  });

  it('esticar o tubo anda de 5 em 5 cm', () => {
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(1, 0, 0));
    state().setTool('select');
    const pipe = state().project.elements.find((e): e is Pipe => e.kind === 'pipe');
    if (!pipe) throw new Error('tubo ausente');
    state().beginStretch(pipe.id, 'end');
    state().stretchTo(vec3(1.37, 0, 0));
    state().endStretch(true);
    const stretched = state().project.elements.find((e): e is Pipe => e.id === pipe.id);
    expect(stretched?.end.x).toBeCloseTo(1.35);
  });

  it('girar pelo cursor anda de 1 em 1 grau', () => {
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(1, 0, 0));
    state().setTool('select');
    const pipe = state().project.elements.find((e): e is Pipe => e.kind === 'pipe');
    if (!pipe) throw new Error('tubo ausente');
    state().startRotate([pipe.id]);
    state().setRotateCenter(vec3(0, 0, 0));
    state().commitPoint(vec3(1, 0, 0));
    const a = degToRad(37.3);
    state().commitPoint(vec3(Math.cos(a), Math.sin(a), 0));
    const turned = state().project.elements.find((e): e is Pipe => e.id === pipe.id);
    if (!turned) throw new Error('tubo ausente');
    expect(Math.atan2(turned.end.y, turned.end.x)).toBeCloseTo(degToRad(37));
  });
});
