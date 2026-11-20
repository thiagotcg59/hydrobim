import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three';
import { useEditorStore } from '../state/editorStore';
import { buildTerrainMesh, contourSegments, terrainEdges } from '../terrain/terrainColors';
import { contourIntervalOf } from '../terrain/TerrainLayers';
import { useTerrainStore } from '../terrain/terrainStore';

function linesGeometry(positions: Float32Array): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  return geometry;
}

/**
 * Superfície do terreno (TIN) no modelo 3D: faces planas com a normal de cada triângulo, cor
 * por altitude, por declividade ou lisa, curvas de nível e, opcionalmente, as arestas da
 * triangulação.
 *
 * A malha é desenhada em relação a uma origem própria (o centro da superfície) dentro do grupo
 * que já aplica a origem de renderização do modelo. O fator vertical é 1 por padrão — terreno
 * natural, escala real 1:1; quando o usuário o altera, só o desenho do terreno é esticado a
 * partir da cota mínima, e a interface avisa que a rede deixa de coincidir com ele.
 */
export function TerrainSurface() {
  const terrain = useEditorStore((s) => s.project.terrain);
  const display = useTerrainStore((s) => s.display);

  const mesh = useMemo(
    () => (terrain ? buildTerrainMesh(terrain, display.colorMode) : null),
    [terrain, display.colorMode],
  );
  const geometry = useMemo(() => {
    if (!mesh) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    g.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
    // As cores da escala são definidas em sRGB; o renderizador trabalha em espaço linear.
    const linear = new Float32Array(mesh.colors.length);
    for (let i = 0; i < linear.length; i += 1) {
      const c = mesh.colors[i] ?? 0;
      linear[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }
    g.setAttribute('color', new BufferAttribute(linear, 3));
    g.computeBoundingSphere();
    return g;
  }, [mesh]);
  const edges = useMemo(
    () =>
      terrain && mesh && display.triangulation
        ? linesGeometry(terrainEdges(terrain, mesh.base))
        : null,
    [terrain, mesh, display.triangulation],
  );
  const contours = useMemo(() => {
    if (!terrain || !mesh || !display.contours) return null;
    const segments = contourSegments(
      terrain,
      contourIntervalOf(terrain, display.contourInterval),
      mesh.base,
    );
    return segments
      ? { minor: linesGeometry(segments.minor), major: linesGeometry(segments.major) }
      : null;
  }, [terrain, mesh, display.contours, display.contourInterval]);

  useEffect(() => () => geometry?.dispose(), [geometry]);
  useEffect(() => () => edges?.dispose(), [edges]);
  useEffect(
    () => () => {
      contours?.minor.dispose();
      contours?.major.dispose();
    },
    [contours],
  );

  if (!terrain || !mesh || !geometry) return null;
  const { base } = mesh;
  return (
    <group
      position={[base.x, base.y, base.z]}
      scale={[1, 1, display.exaggeration]}
      userData={{ terrain: true, exaggeration: display.exaggeration, opacity: display.opacity }}
    >
      <mesh geometry={geometry} raycast={() => null}>
        <meshStandardMaterial
          vertexColors
          side={DoubleSide}
          roughness={0.95}
          metalness={0}
          // Translúcida, sem gravar profundidade: a rede enterrada continua visível através
          // da superfície. Com opacidade total ela volta a encobrir o que está abaixo.
          transparent={display.opacity < 1}
          opacity={display.opacity}
          depthWrite={display.opacity >= 1}
          // As curvas e as arestas ficam sobre as faces sem disputar a profundidade com elas.
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      {edges && (
        <lineSegments geometry={edges} raycast={() => null}>
          <lineBasicMaterial color="#3f5a33" transparent opacity={0.45} />
        </lineSegments>
      )}
      {contours && (
        <>
          <lineSegments geometry={contours.minor} raycast={() => null}>
            <lineBasicMaterial color="#6b4423" transparent opacity={0.7} />
          </lineSegments>
          <lineSegments geometry={contours.major} raycast={() => null}>
            <lineBasicMaterial color="#4a2c12" />
          </lineSegments>
        </>
      )}
    </group>
  );
}
