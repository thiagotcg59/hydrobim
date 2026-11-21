import { terrainElevationAt, terrainStats, type Bounds, type Terrain } from '@hydrobim/core';

/**
 * Movimento do percurso em primeira pessoa (aba BIM / IFC). Funções puras, em coordenadas do
 * projeto (metros, Z para cima): o que anda é o observador, nunca o modelo.
 *
 * O observador caminha no plano: W/S seguem a direção para onde ele olha projetada na
 * horizontal, A/D andam de lado. A cota dos pés vem do apoio (a superfície do terreno, ou o
 * plano de trabalho quando não há terreno sob ele); E/Q mudam a altura da vista sobre o apoio.
 */

/** Altura dos olhos de uma pessoa em pé (m). */
export const EYE_HEIGHT = 1.7;
/** Limites da altura da vista sobre o apoio (m): abaixo do terreno, para ver a rede enterrada. */
export const EYE_HEIGHT_MIN = -30;
export const EYE_HEIGHT_MAX = 500;
/** Velocidade de caminhada padrão e limites do ajuste pela roda do mouse (m/s). */
export const WALK_SPEED = 4;
export const WALK_SPEED_MIN = 0.5;
export const WALK_SPEED_MAX = 200;
/** Shift: corre. */
export const RUN_FACTOR = 4;
/** Giro pelas setas (rad/s) e pelo mouse (rad/pixel). */
export const TURN_RATE = 1.6;
export const LOOK_SENSITIVITY = 0.0025;
/** O olhar não chega à vertical: a direção "para a frente" continuaria definida, mas a câmera não. */
export const PITCH_LIMIT = (85 * Math.PI) / 180;

export type WalkAction =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'turnLeft'
  | 'turnRight'
  | 'lookUp'
  | 'lookDown'
  | 'run';

const KEY_ACTIONS: Readonly<Record<string, WalkAction>> = {
  w: 'forward',
  s: 'back',
  a: 'left',
  d: 'right',
  e: 'up',
  q: 'down',
  arrowleft: 'turnLeft',
  arrowright: 'turnRight',
  arrowup: 'lookUp',
  arrowdown: 'lookDown',
  shift: 'run',
};

/** Ação da tecla no percurso, ou `null` se a tecla não é dele. */
export function walkActionOf(key: string): WalkAction | null {
  return KEY_ACTIONS[key.toLowerCase()] ?? null;
}

/** Tecla que trava e solta o mouse no percurso. */
export const POINTER_LOCK_KEY = 'f';

/** Teclas que o percurso consome: os atalhos de comando (S, E, Q…) não disparam com elas. */
export function isWalkKey(key: string): boolean {
  return walkActionOf(key) !== null || key.toLowerCase() === POINTER_LOCK_KEY;
}

export interface WalkPose {
  /** Posição em planta, em coordenadas do projeto. */
  readonly x: number;
  readonly y: number;
  /** Rumo em planta: ângulo a partir de +X, anti-horário visto de cima (rad). */
  readonly yaw: number;
  /** Inclinação do olhar: positivo para cima (rad). */
  readonly pitch: number;
  /** Altura da vista sobre o apoio (m). */
  readonly eyeHeight: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Direção do olhar (unitária). */
export function lookDirection(yaw: number, pitch: number): { x: number; y: number; z: number } {
  const c = Math.cos(pitch);
  return { x: c * Math.cos(yaw), y: c * Math.sin(yaw), z: Math.sin(pitch) };
}

/** Gira o olhar (mouse ou setas), mantendo a inclinação dentro do limite. */
export function turn(pose: WalkPose, deltaYaw: number, deltaPitch: number): WalkPose {
  return {
    ...pose,
    yaw: pose.yaw + deltaYaw,
    pitch: clamp(pose.pitch + deltaPitch, -PITCH_LIMIT, PITCH_LIMIT),
  };
}

/**
 * Avança o observador por `dt` segundos com as ações ativas. O deslocamento é horizontal
 * (andar olhando para o chão não afunda) e a diagonal não é mais rápida que a frente.
 */
export function stepWalk(
  pose: WalkPose,
  active: ReadonlySet<WalkAction>,
  dt: number,
  speed: number,
): WalkPose {
  const has = (action: WalkAction): number => (active.has(action) ? 1 : 0);
  const ahead = has('forward') - has('back');
  const side = has('right') - has('left');
  const rise = has('up') - has('down');
  const pace = speed * (active.has('run') ? RUN_FACTOR : 1) * dt;
  const length = Math.hypot(ahead, side);
  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  // À frente: (cos, sin). À direita, com Z para cima: (sin, −cos).
  const dx = length > 0 ? ((ahead * cos + side * sin) / length) * pace : 0;
  const dy = length > 0 ? ((ahead * sin - side * cos) / length) * pace : 0;
  const turned = turn(
    pose,
    (has('turnLeft') - has('turnRight')) * TURN_RATE * dt,
    (has('lookUp') - has('lookDown')) * TURN_RATE * dt,
  );
  return {
    ...turned,
    x: pose.x + dx,
    y: pose.y + dy,
    // A vista sobe e desce na velocidade da caminhada, sem o fator de corrida.
    eyeHeight: clamp(pose.eyeHeight + rise * speed * dt, EYE_HEIGHT_MIN, EYE_HEIGHT_MAX),
  };
}

/** Passo da roda do mouse na velocidade: cada passo muda 25 %. */
export function adjustSpeed(speed: number, wheelDelta: number): number {
  const factor = wheelDelta < 0 ? 1.25 : 0.8;
  return clamp(speed * factor, WALK_SPEED_MIN, WALK_SPEED_MAX);
}

export interface Ground {
  /** Cota real do terreno sob o observador (m). */
  readonly elevation: number;
  /** Cota em que a superfície está desenhada (difere da real com exagero vertical). */
  readonly drawn: number;
}

/**
 * Apoio do observador: a superfície do terreno em (x, y), ou `null` fora dela. Com exagero
 * vertical, o desenho do terreno é esticado a partir da cota mínima — o observador anda sobre
 * a superfície como ela aparece, e a cota informada continua sendo a real.
 */
export function groundAt(
  terrain: Terrain | null,
  x: number,
  y: number,
  exaggeration = 1,
): Ground | null {
  if (!terrain) return null;
  const elevation = terrainElevationAt(terrain, x, y);
  if (elevation === null) return null;
  const base = terrainStats(terrain).minZ;
  return { elevation, drawn: base + (elevation - base) * exaggeration };
}

/** Aproxima `current` de `target` com constante de tempo curta: sem degraus nas arestas do TIN. */
export function follow(current: number, target: number, dt: number, rate = 12): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/**
 * Ponto de partida: ao sul do que se quer ver (a seleção, o modelo ou o terreno), olhando para
 * o norte, a uma distância que o põe inteiro à vista sem afastar demais em redes extensas.
 */
export function initialPose(bounds: Bounds | null): WalkPose {
  if (!bounds) return { x: 0, y: 0, yaw: Math.PI / 2, pitch: 0, eyeHeight: EYE_HEIGHT };
  const cx = (bounds.min.x + bounds.max.x) / 2;
  const radius = Math.hypot(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y) / 2;
  return {
    x: cx,
    y: bounds.min.y - clamp(radius * 1.2, 3, 60),
    yaw: Math.PI / 2,
    pitch: 0,
    eyeHeight: EYE_HEIGHT,
  };
}

/** Inclinação do olhar que aponta do olho para um alvo, limitada para não olhar para o chão. */
export function pitchToward(
  eye: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
): number {
  const reach = Math.hypot(target.x - eye.x, target.y - eye.y);
  if (reach < 1e-6) return 0;
  return clamp(Math.atan2(target.z - eye.z, reach), -Math.PI / 3, Math.PI / 3);
}
