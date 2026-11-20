import { Matrix4, type Vector3 } from 'three';

/**
 * Navegação focada na seleção. Os controles de órbita giram e aproximam a câmera em relação ao
 * próprio alvo (o centro da tela); para que o giro e o zoom aconteçam em torno de outro ponto
 * sem a vista saltar, a câmera e o alvo recebem, a cada movimento, o deslocamento que devolve o
 * pivô à mesma posição na tela.
 *
 * `previousWorld` e `currentWorld` são as matrizes da câmera antes e depois do movimento. No
 * giro puro o pivô volta à mesma posição em relação à câmera. No zoom, a posição do pivô em
 * relação à câmera é escalada: em perspectiva, inteira (`lateral` = `depth` = razão entre as
 * distâncias ao alvo, o que mantém a direção em que o pivô é visto); na ortográfica, só no
 * plano da tela (`lateral` = zoom anterior / zoom atual, `depth` = 1).
 *
 * O resultado é o deslocamento a somar à posição da câmera e ao alvo dos controles.
 */
export function orbitPivotShift(
  previousWorld: Matrix4,
  currentWorld: Matrix4,
  pivot: Vector3,
  lateral = 1,
  depth = 1,
): Vector3 {
  const local = pivot.clone().applyMatrix4(new Matrix4().copy(previousWorld).invert());
  local.set(local.x * lateral, local.y * lateral, local.z * depth);
  return pivot.clone().sub(local.applyMatrix4(currentWorld));
}

/**
 * Alvo dos controles levado à profundidade do pivô, sobre o eixo de visada (a vista não muda).
 * O pan e o zoom dos controles são proporcionais à distância da câmera ao alvo: com o alvo na
 * profundidade da seleção, ela acompanha o cursor no pan e o zoom avança em relação a ela — em
 * vez de arrastar devagar demais ou de travar em um alvo que ficou à frente da seleção.
 *
 * `forward` é a direção de visada (unitária). Devolve `null` quando o pivô não está à frente
 * da câmera.
 */
export function targetAtPivotDepth(
  cameraPosition: Vector3,
  forward: Vector3,
  pivot: Vector3,
): Vector3 | null {
  const depth = pivot.clone().sub(cameraPosition).dot(forward);
  if (!(depth > 1e-6)) return null;
  return cameraPosition.clone().addScaledVector(forward, depth);
}
