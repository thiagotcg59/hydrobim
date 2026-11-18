import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { PMREMGenerator } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** Fundo branco das vistas 3D (modelo e pré-visualização de famílias). */
export const VIEW_BACKGROUND = '#ffffff';

/**
 * Fundo e iluminação comuns das vistas 3D.
 *
 * Os metais (aço, inox, galvanizado) só parecem metal se houver algo para refletir: sem mapa
 * de ambiente, um material metálico fica quase preto. O ambiente é um estúdio procedural
 * (sem arquivo HDR nem rede), pré-filtrado uma única vez na montagem; depois disso custa
 * apenas uma consulta de textura por fragmento — sem sombras nem pós-processamento, para
 * a navegação continuar leve.
 */
export function SceneLighting() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const generator = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = generator.fromScene(room, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.55;
    room.dispose();
    generator.dispose();
    invalidate();
    return () => {
      scene.environment = null;
      target.dispose();
    };
  }, [gl, scene, invalidate]);

  return (
    <>
      <color attach="background" args={[VIEW_BACKGROUND]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[8, -6, 14]} intensity={1.5} />
      <directionalLight position={[-9, 7, 5]} intensity={0.45} />
    </>
  );
}
