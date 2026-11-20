import { Matrix4, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { orbitPivotShift, targetAtPivotDepth } from './orbitPivot';

/** Gira a câmera em torno do alvo, como fazem os controles de órbita (Z para cima). */
function orbit(camera: PerspectiveCamera, target: Vector3, azimuth: number, lift: number): void {
  const offset = camera.position.clone().sub(target);
  offset.applyAxisAngle(new Vector3(0, 0, 1), azimuth);
  const side = new Vector3(0, 0, 1).cross(offset).normalize();
  offset.applyAxisAngle(side, lift);
  camera.position.copy(target).add(offset);
  camera.lookAt(target);
  camera.updateMatrixWorld();
}

function setup(): { camera: PerspectiveCamera; target: Vector3 } {
  const camera = new PerspectiveCamera(50, 1.5, 0.1, 1000);
  camera.up.set(0, 0, 1);
  const target = new Vector3(2, 1, 0);
  camera.position.set(12, -9, 7);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  return { camera, target };
}

describe('orbitPivotShift', () => {
  it('mantém o pivô parado na tela e à mesma distância da câmera', () => {
    const { camera, target } = setup();
    const pivot = new Vector3(6, 4, 1.5);
    const before = pivot.clone().project(camera);
    const range = camera.position.distanceTo(pivot);
    const previous = new Matrix4().copy(camera.matrixWorld);

    orbit(camera, target, 0.6, -0.2);
    const shift = orbitPivotShift(previous, camera.matrixWorld, pivot);
    camera.position.add(shift);
    target.add(shift);
    camera.updateMatrixWorld();

    const after = pivot.clone().project(camera);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(camera.position.distanceTo(pivot)).toBeCloseTo(range, 9);
  });

  it('preserva a distância da câmera ao alvo dos controles', () => {
    const { camera, target } = setup();
    const range = camera.position.distanceTo(target);
    const previous = new Matrix4().copy(camera.matrixWorld);

    orbit(camera, target, -1.1, 0.3);
    const shift = orbitPivotShift(previous, camera.matrixWorld, new Vector3(-3, 8, 2));
    camera.position.add(shift);
    target.add(shift);

    expect(camera.position.distanceTo(target)).toBeCloseTo(range, 9);
  });

  it('não desloca nada quando o pivô é o próprio alvo', () => {
    const { camera, target } = setup();
    const previous = new Matrix4().copy(camera.matrixWorld);
    orbit(camera, target, 0.8, 0.1);
    expect(orbitPivotShift(previous, camera.matrixWorld, target).length()).toBeLessThan(1e-9);
  });

  it('não desloca nada sem giro (pan ou zoom)', () => {
    const { camera } = setup();
    const previous = new Matrix4().copy(camera.matrixWorld);
    expect(
      orbitPivotShift(previous, camera.matrixWorld, new Vector3(6, 4, 1.5)).length(),
    ).toBeLessThan(1e-12);
  });
});

describe('zoom em torno do pivô', () => {
  it('em perspectiva, aproxima a câmera do pivô sem tirá-lo do lugar na tela', () => {
    const { camera, target } = setup();
    const pivot = new Vector3(6, 4, 1.5);
    const before = pivot.clone().project(camera);
    const range = camera.position.distanceTo(pivot);
    const previous = new Matrix4().copy(camera.matrixWorld);

    // Zoom dos controles: a distância ao alvo cai para 80 %.
    camera.position.sub(target).multiplyScalar(0.8).add(target);
    camera.updateMatrixWorld();
    const shift = orbitPivotShift(previous, camera.matrixWorld, pivot, 0.8, 0.8);
    camera.position.add(shift);
    camera.updateMatrixWorld();

    const after = pivot.clone().project(camera);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(camera.position.distanceTo(pivot)).toBeCloseTo(range * 0.8, 9);
  });

  it('na ortográfica, mantém o pivô no lugar ao mudar o zoom', () => {
    const camera = new OrthographicCamera(-8, 8, 5, -5, 0.1, 1000);
    camera.up.set(0, 0, 1);
    camera.position.set(40, -40, 40);
    camera.lookAt(new Vector3(0, 0, 0));
    camera.zoom = 2;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const pivot = new Vector3(3, 1, 0.5);
    const before = pivot.clone().project(camera);
    const previous = new Matrix4().copy(camera.matrixWorld);

    camera.zoom = 5;
    camera.updateProjectionMatrix();
    camera.position.add(orbitPivotShift(previous, camera.matrixWorld, pivot, 2 / 5, 1));
    camera.updateMatrixWorld();

    const after = pivot.clone().project(camera);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
});

describe('targetAtPivotDepth', () => {
  it('põe o alvo no eixo de visada, na profundidade do pivô', () => {
    const { camera, target } = setup();
    const forward = target.clone().sub(camera.position).normalize();
    const pivot = new Vector3(6, 4, 1.5);
    const moved = targetAtPivotDepth(camera.position, forward, pivot);
    if (!moved) throw new Error('Pivô à frente da câmera deveria ter alvo.');
    // Continua sobre o eixo de visada: a vista não muda.
    const along = moved.clone().sub(camera.position);
    expect(along.clone().normalize().distanceTo(forward)).toBeLessThan(1e-12);
    expect(along.length()).toBeCloseTo(pivot.clone().sub(camera.position).dot(forward), 12);
  });

  it('não há alvo quando o pivô está atrás da câmera', () => {
    const { camera, target } = setup();
    const forward = target.clone().sub(camera.position).normalize();
    const behind = camera.position.clone().addScaledVector(forward, -3);
    expect(targetAtPivotDepth(camera.position, forward, behind)).toBeNull();
  });
});
