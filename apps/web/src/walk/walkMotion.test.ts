import { createTerrain, vec3 } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import {
  adjustSpeed,
  EYE_HEIGHT,
  EYE_HEIGHT_MAX,
  EYE_HEIGHT_MIN,
  follow,
  groundAt,
  initialPose,
  isWalkKey,
  lookDirection,
  PITCH_LIMIT,
  pitchToward,
  RUN_FACTOR,
  stepWalk,
  turn,
  WALK_SPEED_MAX,
  WALK_SPEED_MIN,
  walkActionOf,
  type WalkAction,
  type WalkPose,
} from './walkMotion';

const keys = (...actions: WalkAction[]): ReadonlySet<WalkAction> => new Set(actions);

/** Olhando para o norte (+Y), em pé. */
const NORTH: WalkPose = { x: 10, y: 20, yaw: Math.PI / 2, pitch: 0, eyeHeight: EYE_HEIGHT };

describe('teclas do percurso', () => {
  it('W A S D andam, E e Q mudam a altura da vista', () => {
    expect(walkActionOf('w')).toBe('forward');
    expect(walkActionOf('S')).toBe('back');
    expect(walkActionOf('a')).toBe('left');
    expect(walkActionOf('D')).toBe('right');
    expect(walkActionOf('e')).toBe('up');
    expect(walkActionOf('q')).toBe('down');
    expect(walkActionOf('Shift')).toBe('run');
    expect(walkActionOf('t')).toBeNull();
  });

  it('as teclas do percurso (e F, que trava o mouse) não são atalhos de comando', () => {
    for (const key of ['w', 'a', 's', 'd', 'e', 'q', 'f', 'ArrowLeft']) {
      expect(isWalkKey(key)).toBe(true);
    }
    expect(isWalkKey('t')).toBe(false);
    expect(isWalkKey('Delete')).toBe(false);
  });
});

describe('stepWalk', () => {
  it('W anda para onde o observador olha; S volta', () => {
    const ahead = stepWalk(NORTH, keys('forward'), 0.5, 4);
    expect(ahead.x).toBeCloseTo(10);
    expect(ahead.y).toBeCloseTo(22);
    const back = stepWalk(NORTH, keys('back'), 0.5, 4);
    expect(back.y).toBeCloseTo(18);
  });

  it('D anda para a direita e A para a esquerda de quem olha', () => {
    // Olhando para o norte, a direita é o leste (+X).
    expect(stepWalk(NORTH, keys('right'), 1, 2).x).toBeCloseTo(12);
    expect(stepWalk(NORTH, keys('left'), 1, 2).x).toBeCloseTo(8);
    expect(stepWalk(NORTH, keys('right'), 1, 2).y).toBeCloseTo(20);
  });

  it('o deslocamento é horizontal mesmo olhando para cima ou para baixo', () => {
    const down = stepWalk({ ...NORTH, pitch: -1.2 }, keys('forward'), 1, 3);
    expect(down.y).toBeCloseTo(23);
    expect(down.eyeHeight).toBe(EYE_HEIGHT);
  });

  it('a diagonal não é mais rápida que a frente', () => {
    const diagonal = stepWalk(NORTH, keys('forward', 'right'), 1, 5);
    expect(Math.hypot(diagonal.x - NORTH.x, diagonal.y - NORTH.y)).toBeCloseTo(5);
  });

  it('teclas opostas se anulam', () => {
    const still = stepWalk(NORTH, keys('forward', 'back', 'left', 'right'), 1, 5);
    expect(still.x).toBeCloseTo(NORTH.x);
    expect(still.y).toBeCloseTo(NORTH.y);
  });

  it('Shift corre', () => {
    const run = stepWalk(NORTH, keys('forward', 'run'), 1, 2);
    expect(run.y - NORTH.y).toBeCloseTo(2 * RUN_FACTOR);
  });

  it('E sobe e Q desce a altura da vista, dentro dos limites', () => {
    expect(stepWalk(NORTH, keys('up'), 0.5, 4).eyeHeight).toBeCloseTo(EYE_HEIGHT + 2);
    expect(stepWalk(NORTH, keys('down'), 0.5, 4).eyeHeight).toBeCloseTo(EYE_HEIGHT - 2);
    expect(stepWalk(NORTH, keys('up'), 1e6, 4).eyeHeight).toBe(EYE_HEIGHT_MAX);
    expect(stepWalk(NORTH, keys('down'), 1e6, 4).eyeHeight).toBe(EYE_HEIGHT_MIN);
    // Subir e descer a vista não desloca o observador em planta.
    expect(stepWalk(NORTH, keys('up'), 1, 4).y).toBe(NORTH.y);
  });

  it('as setas giram o olhar; sem teclas nada muda', () => {
    expect(stepWalk(NORTH, keys('turnLeft'), 1, 4).yaw).toBeGreaterThan(NORTH.yaw);
    expect(stepWalk(NORTH, keys('turnRight'), 1, 4).yaw).toBeLessThan(NORTH.yaw);
    expect(stepWalk(NORTH, keys('lookUp'), 0.1, 4).pitch).toBeGreaterThan(0);
    expect(stepWalk(NORTH, keys(), 1, 4)).toEqual(NORTH);
  });
});

describe('olhar', () => {
  it('a inclinação não passa do limite', () => {
    expect(turn(NORTH, 0, 10).pitch).toBe(PITCH_LIMIT);
    expect(turn(NORTH, 0, -10).pitch).toBe(-PITCH_LIMIT);
  });

  it('a direção do olhar é unitária e segue o rumo', () => {
    const north = lookDirection(Math.PI / 2, 0);
    expect(north.x).toBeCloseTo(0);
    expect(north.y).toBeCloseTo(1);
    const up = lookDirection(0, Math.PI / 4);
    expect(Math.hypot(up.x, up.y, up.z)).toBeCloseTo(1);
    expect(up.z).toBeCloseTo(Math.SQRT1_2);
  });

  it('pitchToward aponta para o alvo, sem olhar para o chão', () => {
    expect(pitchToward(vec3(0, 0, 0), vec3(0, 10, 10))).toBeCloseTo(Math.PI / 4);
    expect(pitchToward(vec3(0, 0, 0), vec3(0, 10, 0))).toBeCloseTo(0);
    expect(pitchToward(vec3(0, 0, 100), vec3(0, 1, 0))).toBeCloseTo(-Math.PI / 3);
    expect(pitchToward(vec3(0, 0, 0), vec3(0, 0, 5))).toBe(0);
  });
});

describe('velocidade', () => {
  it('a roda acelera e freia em passos, dentro dos limites', () => {
    expect(adjustSpeed(4, -100)).toBeCloseTo(5);
    expect(adjustSpeed(4, 100)).toBeCloseTo(3.2);
    expect(adjustSpeed(WALK_SPEED_MAX, -100)).toBe(WALK_SPEED_MAX);
    expect(adjustSpeed(WALK_SPEED_MIN, 100)).toBe(WALK_SPEED_MIN);
  });
});

describe('apoio no terreno', () => {
  // Rampa: a cota cresce 1 m a cada 10 m para o leste, de 100 m a 110 m.
  const built = createTerrain('Rampa', [
    vec3(0, 0, 100),
    vec3(100, 0, 110),
    vec3(100, 100, 110),
    vec3(0, 100, 100),
  ]);
  if (!built.ok) throw new Error(built.error.message);
  const terrain = built.value;

  it('o observador fica na cota da superfície sob ele', () => {
    expect(groundAt(terrain, 50, 50)?.elevation).toBeCloseTo(105);
    expect(groundAt(terrain, 50, 50)?.drawn).toBeCloseTo(105);
    expect(groundAt(terrain, 20, 80)?.elevation).toBeCloseTo(102);
  });

  it('fora da superfície, ou sem terreno, não há apoio', () => {
    expect(groundAt(terrain, 500, 50)).toBeNull();
    expect(groundAt(null, 50, 50)).toBeNull();
  });

  it('com exagero vertical, anda sobre a superfície desenhada e informa a cota real', () => {
    const ground = groundAt(terrain, 50, 50, 3);
    expect(ground?.elevation).toBeCloseTo(105);
    // Desenho esticado a partir da cota mínima (100 m): 100 + 5 × 3.
    expect(ground?.drawn).toBeCloseTo(115);
  });

  it('follow aproxima a cota sem ultrapassar o alvo', () => {
    const next = follow(100, 101, 0.016);
    expect(next).toBeGreaterThan(100);
    expect(next).toBeLessThan(101);
    expect(follow(100, 101, 10)).toBeCloseTo(101);
    expect(follow(100, 100, 0.016)).toBe(100);
  });
});

describe('initialPose', () => {
  it('parte ao sul do que se vai ver, olhando para o norte, em pé', () => {
    const pose = initialPose({ min: vec3(0, 0, 0), max: vec3(10, 6, 3) });
    expect(pose.x).toBeCloseTo(5);
    expect(pose.y).toBeLessThan(0);
    expect(pose.yaw).toBeCloseTo(Math.PI / 2);
    expect(pose.eyeHeight).toBe(EYE_HEIGHT);
  });

  it('não se afasta demais em redes extensas nem cola em peças pequenas', () => {
    const far = initialPose({ min: vec3(0, 0, 0), max: vec3(5000, 3000, 0) });
    expect(far.y).toBeCloseTo(-60);
    const near = initialPose({ min: vec3(0, 0, 0), max: vec3(0.2, 0.2, 0.2) });
    expect(near.y).toBeCloseTo(-3);
  });

  it('sem nada para ver, parte da origem', () => {
    expect(initialPose(null)).toMatchObject({ x: 0, y: 0, eyeHeight: EYE_HEIGHT });
  });
});
