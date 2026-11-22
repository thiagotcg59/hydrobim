import {
  angleBetween,
  createProject,
  radToDeg,
  sub,
  validateProject,
  vec3,
  type Pipe,
  type Vec3,
} from '@hydrobim/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../state/editorStore';
import type { PickResult, Ray } from './picking';
import { polarLockedPoint, polarLockPlan, polarLockPoint, shiftPick } from './polarLock';

const state = () => useEditorStore.getState();
const degreesFrom = (axis: Vec3, origin: Vec3, point: Vec3): number =>
  radToDeg(angleBetween(axis, sub(point, origin)));

describe('polarLockPoint', () => {
  const origin = vec3(1, 1, 0.3);

  it('primeiro trecho: trava nos eixos do projeto, de 45° em 45°', () => {
    // 10° acima do eixo X: fica em X, com o comprimento da projeção.
    expect(polarLockPoint(origin, null, vec3(4, 1.5, 0.3))).toEqual(vec3(4, 1, 0.3));
    // Perto da diagonal: 45°.
    const diagonal = polarLockPoint(origin, null, vec3(3, 3.3, 0.3));
    expect(diagonal.x - origin.x).toBeCloseTo(diagonal.y - origin.y);
    // Para trás e para baixo também.
    expect(polarLockPoint(origin, null, vec3(-2, 1.2, 0.3)).y).toBeCloseTo(1);
    expect(polarLockPoint(origin, null, vec3(1.2, -3, 0.3)).x).toBeCloseTo(1);
  });

  it('mantém a cota do ponto pedido e arredonda o comprimento ao passo', () => {
    const point = polarLockPoint(origin, null, vec3(4.04, 1.3, 0.8), 0.1);
    expect(point).toEqual(vec3(4, 1, 0.8));
    // Ponto sobre a origem: devolvido sem alteração.
    const same = vec3(1, 1, 0.3);
    expect(polarLockPoint(origin, null, same)).toBe(same);
  });

  it('em planta (paredes, contornos, cotas): 45° em 45°, sem resíduo nos eixos', () => {
    const from = { x: 0.1, y: 0.2 };
    // Para os lados, para cima e para baixo: a outra coordenada é exatamente a de partida.
    expect(polarLockPlan(from, { x: 3, y: 0.5 })).toEqual({ x: 3, y: 0.2 });
    expect(polarLockPlan(from, { x: -3, y: 0.1 })).toEqual({ x: -3, y: 0.2 });
    expect(polarLockPlan(from, { x: 0.4, y: 5 })).toEqual({ x: 0.1, y: 5 });
    expect(polarLockPlan(from, { x: -0.2, y: -5 })).toEqual({ x: 0.1, y: -5 });
    // Diagonais: ΔX e ΔY iguais em módulo.
    const diagonal = polarLockPlan(from, { x: -2, y: 2.6 });
    expect(diagonal.x - from.x).toBeCloseTo(-(diagonal.y - from.y));
    expect(diagonal.x).toBeLessThan(from.x);
    // Com passo, o comprimento do trecho é arredondado.
    expect(polarLockPlan(from, { x: 3.04, y: 0.5 }, 0.5).x).toBeCloseTo(3.1);
  });

  it('partindo de um tubo: 0°, 45° ou 90° em relação a ele, para qualquer lado', () => {
    // Tubo de partida inclinado em planta: a referência é o tubo, não os eixos do projeto.
    const axis = vec3(Math.cos(0.3), Math.sin(0.3), 0);
    const toward = (degrees: number): Vec3 => {
      const a = 0.3 + (degrees * Math.PI) / 180;
      return vec3(origin.x + 2 * Math.cos(a), origin.y + 2 * Math.sin(a), origin.z);
    };
    expect(degreesFrom(axis, origin, polarLockPoint(origin, axis, toward(12)))).toBeCloseTo(0);
    expect(degreesFrom(axis, origin, polarLockPoint(origin, axis, toward(35)))).toBeCloseTo(45);
    expect(degreesFrom(axis, origin, polarLockPoint(origin, axis, toward(-50)))).toBeCloseTo(45);
    expect(degreesFrom(axis, origin, polarLockPoint(origin, axis, toward(80)))).toBeCloseTo(90);
    // Sem peça maior que 90° na trava: 130° cai em 90°.
    expect(degreesFrom(axis, origin, polarLockPoint(origin, axis, toward(130)))).toBeCloseTo(90);
  });
});

describe('trava com Shift no traçado', () => {
  beforeEach(() => {
    state().loadProject(createProject('Teste', 'mep'));
    state().setToolOptions({ sizeMode: 'reducers', families: {}, lockElbowAngles: true });
    state().setTool('pipe');
  });

  const pipes = (): Pipe[] => state().project.elements.filter((e): e is Pipe => e.kind === 'pipe');

  it('não se aplica sem trecho em andamento nem fora da ferramenta de tubo', () => {
    expect(polarLockedPoint(state(), vec3(2, 0.4, 0))).toBeNull();
    state().commitPoint(vec3(0, 0, 0));
    expect(polarLockedPoint(state(), vec3(2, 0.4, 0))).toEqual(vec3(2, 0, 0));
    state().setTool('select');
    expect(polarLockedPoint(state(), vec3(2, 0.4, 0))).toBeNull();
  });

  it('primeiro trecho ortogonal e os seguintes a 45° e 90°, com joelhos de catálogo', () => {
    state().commitPoint(vec3(0, 0, 0));
    const commitLocked = (point: Vec3): void => {
      const locked = polarLockedPoint(state(), point);
      if (!locked) throw new Error('trava inativa');
      state().commitPoint(locked);
    };
    commitLocked(vec3(3, 0.4, 0));
    expect(pipes()[0]?.end).toEqual(vec3(3, 0, 0));
    // Cursor a ~40° do tubo: joelho de 45°.
    commitLocked(vec3(5, 1.7, 0));
    // Cursor a ~80° do segundo trecho: joelho de 90°.
    const end = pipes().at(-1)?.end ?? vec3(0, 0, 0);
    commitLocked(vec3(end.x - 1.6, end.y + 2.4, 0));

    const elbows = state().project.elements.filter((e) => e.kind === 'elbow');
    expect(elbows.map((e) => (e.kind === 'elbow' ? Math.round(radToDeg(e.angle)) : 0))).toEqual([
      45, 90,
    ]);
    expect(elbows.every((e) => e.familyId !== null)).toBe(true);
    expect(pipes()).toHaveLength(3);
    expect(validateProject(state().project)).toEqual([]);
  });
});

describe('shiftPick (vista 3D)', () => {
  beforeEach(() => {
    state().loadProject(createProject('Teste', 'mep'));
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 0));
  });

  const pick = (point: Vec3, snap: PickResult['snap']): PickResult => ({
    point,
    snap,
    port: null,
    stacked: 1,
  });
  /** Raio que sai do olho e passa pelo ponto indicado. */
  const rayThrough = (eye: Vec3, point: Vec3): Ray => ({ origin: eye, direction: sub(point, eye) });
  const eye = vec3(6, -8, 6);

  it('apontando para o lado, o trecho fica no plano, travado', () => {
    const flat = pick(vec3(3, 0.5, 0), 'plane');
    const up = pick(vec3(0, 0, 0.2), 'vertical');
    const chosen = shiftPick(state(), rayThrough(eye, flat.point), flat, up);
    expect(chosen?.snap).toBe('angle');
    expect(chosen?.point).toEqual(vec3(3, 0, 0));
  });

  it('apontando para cima do ponto de partida, o trecho é vertical', () => {
    const up = pick(vec3(0, 0, 2.5), 'vertical');
    // O mesmo raio atinge o plano de trabalho longe, atrás do ponto de partida.
    const flat = pick(vec3(-4.3, 5.7, 0), 'plane');
    const chosen = shiftPick(state(), rayThrough(eye, up.point), flat, up);
    expect(chosen?.snap).toBe('vertical');
    expect(chosen?.point).toEqual(vec3(0, 0, 2.5));
  });

  it('porta capturada prevalece sobre a trava', () => {
    const port = state().project.elements.length; // sem elementos: usa um pick com porta fictícia
    expect(port).toBe(0);
    const flat: PickResult = {
      ...pick(vec3(3, 0.5, 0), 'port'),
      port: { ref: { elementId: 'x', portId: 'end' } } as PickResult['port'],
    };
    expect(shiftPick(state(), rayThrough(eye, flat.point), flat, null)).toBe(flat);
  });
});
