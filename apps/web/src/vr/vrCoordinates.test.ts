import { cross, distance, vec3, type Vec3 } from '@hydrobim/core';
import { Group, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  feetOf,
  fromVr,
  headingOf,
  placeAt,
  projectToXr,
  snapTurn,
  teleportPlacement,
  toVr,
  xrToProject,
  type VrPlacement,
} from './vrCoordinates';

const close = (a: Vec3, b: Vec3, digits = 9): void => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
  expect(a.z).toBeCloseTo(b.z, digits);
};

/** Rede modelada em UTM: coordenadas de centenas de quilômetros. */
const UTM: VrPlacement = { anchor: vec3(512_345.678, 7_456_789.123, 812.5), yaw: 0.7, floorY: 0 };

describe('Z para cima → Y para cima', () => {
  it('leva (X, Y, Z) a (X, Z, −Y): leste segue à direita, o norte fica à frente, Z vira altura', () => {
    close(toVr(vec3(1, 0, 0)), vec3(1, 0, 0));
    close(toVr(vec3(0, 1, 0)), vec3(0, 0, -1));
    close(toVr(vec3(0, 0, 1)), vec3(0, 1, 0));
    close(toVr(vec3(3, 4, 5)), vec3(3, 5, -4));
  });

  it('é invertível', () => {
    const p = vec3(12.5, -7.25, 3.125);
    close(fromVr(toVr(p)), p);
    close(toVr(fromVr(p)), p);
  });

  it('preserva a escala: distâncias iguais nos dois sistemas (1 m = 1 m)', () => {
    const a = vec3(2, 9, -4);
    const b = vec3(-6.5, 1.25, 7);
    expect(distance(toVr(a), toVr(b))).toBeCloseTo(distance(a, b), 12);
  });

  it('não espelha: o produto vetorial se conserva (sistema destro nos dois lados)', () => {
    const a = vec3(1, 2, 3);
    const b = vec3(-4, 0.5, 2);
    close(toVr(cross(a, b)), cross(toVr(a), toVr(b)));
    // X × Y = Z no projeto; na WebXR, a imagem de X × a imagem de Y dá a imagem de Z (+Y).
    close(cross(toVr(vec3(1, 0, 0)), toVr(vec3(0, 1, 0))), vec3(0, 1, 0));
  });
});

describe('posição do modelo em volta do usuário', () => {
  it('coincide com a cadeia de grupos da cena (giro, eixo vertical, âncora)', () => {
    const yaw = new Group();
    yaw.rotation.y = UTM.yaw;
    yaw.position.y = UTM.floorY;
    const up = new Group();
    up.rotation.x = -Math.PI / 2;
    const shift = new Group();
    shift.position.set(-UTM.anchor.x, -UTM.anchor.y, -UTM.anchor.z);
    yaw.add(up);
    up.add(shift);
    yaw.updateMatrixWorld(true);

    const point = vec3(512_351.2, 7_456_780.4, 815.75);
    const scene = new Vector3(point.x, point.y, point.z).applyMatrix4(shift.matrixWorld);
    close(projectToXr(UTM, point), vec3(scene.x, scene.y, scene.z), 6);
  });

  it('vai e volta sem perder os milímetros em coordenadas UTM', () => {
    const point = vec3(512_351.2345, 7_456_780.4321, 815.7501);
    const back = xrToProject(UTM, projectToXr(UTM, point));
    expect(Math.abs(back.x - point.x)).toBeLessThan(1e-6);
    expect(Math.abs(back.y - point.y)).toBeLessThan(1e-6);
    expect(Math.abs(back.z - point.z)).toBeLessThan(1e-6);
    // Junto da âncora, o que vai para a placa de vídeo são números pequenos.
    const near = projectToXr(UTM, point);
    expect(Math.hypot(near.x, near.y, near.z)).toBeLessThan(20);
  });

  it('preserva as posições relativas entre elementos', () => {
    const a = vec3(512_350, 7_456_790, 813);
    const b = vec3(512_356, 7_456_782, 816.5);
    expect(distance(projectToXr(UTM, a), projectToXr(UTM, b))).toBeCloseTo(distance(a, b), 6);
    // A cota vira altura sobre o piso físico, sem giro que a incline.
    expect(projectToXr(UTM, b).y - projectToXr(UTM, a).y).toBeCloseTo(3.5, 9);
  });

  it('sem piso rastreado, o piso do modelo fica abaixo da origem (altura estimada)', () => {
    const estimated: VrPlacement = { anchor: vec3(0, 0, 100), yaw: 0, floorY: -1.6 };
    expect(projectToXr(estimated, vec3(0, 0, 100)).y).toBeCloseTo(-1.6);
    close(xrToProject(estimated, vec3(0, -1.6, 0)), vec3(0, 0, 100));
  });
});

describe('teletransporte', () => {
  it('leva o destino para baixo da cabeça, na cota do piso físico', () => {
    const head = { x: 0.6, z: -0.4 };
    const target = vec3(512_400, 7_456_800, 820);
    const moved = teleportPlacement(UTM, target, head);
    close(projectToXr(moved, target), vec3(0.6, 0, -0.4), 6);
    close(feetOf(moved, head), target, 6);
    expect(moved.yaw).toBe(UTM.yaw);
  });

  it('preserva o deslocamento físico da cabeça dentro da área rastreada', () => {
    const target = vec3(10, 20, 3);
    const start: VrPlacement = { anchor: vec3(0, 0, 0), yaw: 0, floorY: 0 };
    const atCenter = teleportPlacement(start, target, { x: 0, z: 0 });
    const offCenter = teleportPlacement(start, target, { x: 1, z: 0 });
    // Com a cabeça 1 m a leste do centro, a âncora fica 1 m a oeste do destino.
    close(atCenter.anchor, vec3(10, 20, 3));
    close(offCenter.anchor, vec3(9, 20, 3));
  });
});

describe('giro por etapas', () => {
  const head = { x: 0.3, z: 0.2 };
  const start: VrPlacement = { anchor: vec3(5, 5, 0), yaw: 0, floorY: 0 };

  it('gira sem tirar o usuário do lugar', () => {
    const before = feetOf(start, head);
    const turned = snapTurn(start, head, Math.PI / 6);
    close(feetOf(turned, head), before);
    expect(turned.yaw).toBeCloseTo(Math.PI / 6);
  });

  it('virar 90° à direita põe à frente o que estava à direita', () => {
    const origin: VrPlacement = { anchor: vec3(0, 0, 0), yaw: 0, floorY: 0 };
    const east = vec3(4, 0, 0);
    close(projectToXr(origin, east), vec3(4, 0, 0));
    const turned = snapTurn(origin, { x: 0, z: 0 }, Math.PI / 2);
    close(projectToXr(turned, east), vec3(0, 0, -4));
  });

  it('doze giros de 30° voltam à orientação inicial', () => {
    let placement = start;
    for (let i = 0; i < 12; i += 1) placement = snapTurn(placement, head, Math.PI / 6);
    const probe = vec3(8, 1, 2);
    close(projectToXr(placement, probe), projectToXr(start, probe), 9);
  });
});

describe('ponto de partida e recentrar', () => {
  it('põe o usuário no ponto, com o rumo pedido à frente do olhar', () => {
    const feet = vec3(100, 200, 10);
    // Rumo norte (+Y), cabeça voltada para −Z.
    const north = placeAt(feet, Math.PI / 2, { x: 0, z: 0 }, 0);
    close(projectToXr(north, vec3(100, 205, 10)), vec3(0, 0, -5));
    // Rumo leste (+X): o que está a leste aparece à frente.
    const east = placeAt(feet, 0, { x: 0, z: 0 }, 0);
    close(projectToXr(east, vec3(105, 200, 10)), vec3(0, 0, -5));
  });

  it('respeita para onde a cabeça está voltada e onde ela está', () => {
    const feet = vec3(100, 200, 10);
    const head = { x: 0.5, z: 0.25, forward: { x: 1, z: 0 } };
    const placement = placeAt(feet, Math.PI / 2, head, 0);
    close(feetOf(placement, head), feet);
    // 5 m ao norte do ponto aparecem 5 m adiante na direção do olhar (+X da sala).
    close(projectToXr(placement, vec3(100, 205, 10)), vec3(5.5, 0, 0.25));
    expect(Math.cos(headingOf(placement, head) - Math.PI / 2)).toBeCloseTo(1);
  });
});
