import type { Vec3 } from '@hydrobim/core';

/**
 * Coordenadas da realidade virtual. O projeto usa Z para cima (sistema destro, metros); a WebXR
 * usa Y para cima, com −Z à frente do usuário. A conversão é um giro de −90° em torno de X —
 * uma rotação própria (determinante +1), sem espelhamento e sem escala: 1 m do projeto é 1 m no
 * espaço físico.
 *
 *     projeto (X, Y, Z)  →  WebXR (X, Z, −Y)
 *
 * É só apresentação: o que anda é a cena em volta do usuário (a âncora e o giro abaixo), nunca
 * as coordenadas do projeto, que seguem intactas na persistência e nas exportações.
 */

/** Vetor do projeto (Z para cima) → vetor da WebXR (Y para cima). */
export const toVr = (p: Vec3): Vec3 => ({ x: p.x, y: p.z, z: -p.y });

/** Vetor da WebXR (Y para cima) → vetor do projeto (Z para cima). */
export const fromVr = (p: Vec3): Vec3 => ({ x: p.x, y: -p.z, z: p.y });

/**
 * Posição do modelo no espaço de referência da sessão (origem no piso físico).
 *
 * - `anchor`: ponto do projeto que fica na origem horizontal do espaço de referência, na cota
 *   do piso físico. A diferença `ponto − âncora` é feita em precisão dupla antes de chegar à
 *   placa de vídeo: é a origem local que mantém os milímetros em redes com coordenadas UTM.
 * - `yaw`: giro do modelo em torno da vertical (rad), positivo no sentido anti-horário visto
 *   de cima.
 * - `floorY`: altura do piso no espaço de referência. É 0 com `local-floor`; sem piso
 *   rastreado (`local`, origem na cabeça), é a altura estimada dos olhos com sinal negativo.
 */
export interface VrPlacement {
  readonly anchor: Vec3;
  readonly yaw: number;
  readonly floorY: number;
}

/** Posição horizontal e direção do olhar da cabeça no espaço de referência. */
export interface VrHead {
  readonly x: number;
  readonly z: number;
  /** Direção horizontal do olhar (não precisa ser unitária). Ausente = −Z. */
  readonly forward?: { readonly x: number; readonly z: number };
}

/** Giro em torno de +Y (regra da mão direita), como o `rotation.y` do Three.js. */
function rotateY(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

/** Ponto do projeto → ponto no espaço de referência da sessão. */
export function projectToXr(placement: VrPlacement, point: Vec3): Vec3 {
  const { anchor } = placement;
  const local = toVr({ x: point.x - anchor.x, y: point.y - anchor.y, z: point.z - anchor.z });
  const turned = rotateY(local, placement.yaw);
  return { x: turned.x, y: turned.y + placement.floorY, z: turned.z };
}

/** Ponto no espaço de referência da sessão → ponto do projeto. */
export function xrToProject(placement: VrPlacement, point: Vec3): Vec3 {
  const local = fromVr(
    rotateY({ x: point.x, y: point.y - placement.floorY, z: point.z }, -placement.yaw),
  );
  const { anchor } = placement;
  return { x: local.x + anchor.x, y: local.y + anchor.y, z: local.z + anchor.z };
}

/** Direção (sem translação) no espaço de referência → direção do projeto. */
export function xrDirectionToProject(placement: VrPlacement, direction: Vec3): Vec3 {
  return fromVr(rotateY(direction, -placement.yaw));
}

/**
 * Leva o ponto `target` do projeto para baixo da cabeça do usuário, na cota do piso físico. A
 * cabeça não precisa estar no centro da área rastreada: o deslocamento físico dela é
 * preservado, e o giro não muda.
 */
export function teleportPlacement(placement: VrPlacement, target: Vec3, head: VrHead): VrPlacement {
  const offset = fromVr(rotateY({ x: head.x, y: 0, z: head.z }, -placement.yaw));
  return {
    ...placement,
    anchor: { x: target.x - offset.x, y: target.y - offset.y, z: target.z },
  };
}

/** Ponto do projeto sob a cabeça do usuário, na cota do piso. */
export function feetOf(placement: VrPlacement, head: VrHead): Vec3 {
  return xrToProject(placement, { x: head.x, y: placement.floorY, z: head.z });
}

/**
 * Giro por etapas: o usuário vira `angle` radianos para a direita (negativo = esquerda) sem
 * sair do lugar — o ponto do projeto sob a cabeça continua sob ela.
 */
export function snapTurn(placement: VrPlacement, head: VrHead, angle: number): VrPlacement {
  const feet = feetOf(placement, head);
  // Virar à direita (horário visto de cima) equivale a girar o modelo no sentido anti-horário.
  return teleportPlacement({ ...placement, yaw: placement.yaw + angle }, feet, head);
}

/**
 * Coloca o usuário em `feet` (projeto), com o rumo `heading` do projeto (ângulo em planta a
 * partir de +X, anti-horário) bem à frente da direção em que a cabeça está voltada.
 */
export function placeAt(feet: Vec3, heading: number, head: VrHead, floorY: number): VrPlacement {
  const fx = head.forward?.x ?? 0;
  const fz = head.forward?.z ?? -1;
  // Ângulo em planta de um vetor da WebXR, na mesma convenção do projeto: +X = 0, −Z = 90°.
  const facing = Math.hypot(fx, fz) < 1e-9 ? Math.PI / 2 : Math.atan2(-fz, fx);
  return teleportPlacement(
    { anchor: { x: 0, y: 0, z: 0 }, yaw: facing - heading, floorY },
    feet,
    head,
  );
}

/** Rumo em planta (projeto) para o qual a cabeça está voltada. */
export function headingOf(placement: VrPlacement, head: VrHead): number {
  const fx = head.forward?.x ?? 0;
  const fz = head.forward?.z ?? -1;
  return Math.atan2(-fz, fx) - placement.yaw;
}
