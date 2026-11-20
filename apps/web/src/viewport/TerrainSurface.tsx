import { georeferenceStatus, terrainStats } from '@hydrobim/core';
import { useEffect, useMemo, useState } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  LinearFilter,
  SRGBColorSpace,
} from 'three';
import { findBasemapProvider } from '../map/providers';
import { useEditorStore } from '../state/editorStore';
import { drapeMosaic, drapeUvs, loadDrapeCanvas } from '../terrain/drape';
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

  const georeference = useEditorStore((s) => s.project.georeference);
  const customBasemap = useEditorStore((s) => s.customBasemap);
  const provider = findBasemapProvider(display.drapeSourceId, customBasemap);
  const geo = useMemo(() => georeferenceStatus(georeference), [georeference]);
  const transform = geo.state === 'ready' ? geo.transform : null;

  const mesh = useMemo(
    () => (terrain ? buildTerrainMesh(terrain, display.colorMode) : null),
    [terrain, display.colorMode],
  );
  // Mapa sobre o terreno: mosaico de ladrilhos que cobre a superfície.
  const mosaic = useMemo(
    () =>
      terrain && provider && transform
        ? drapeMosaic(transform, provider, terrainStats(terrain))
        : null,
    [terrain, provider, transform],
  );
  const [texture, setTexture] = useState<CanvasTexture | null>(null);
  useEffect(() => {
    const report = useTerrainStore.setState;
    if (!display.drapeSourceId) {
      report({ drape: null });
      return;
    }
    if (!provider || !transform || !mosaic) {
      report({
        drape: {
          state: 'blocked',
          message: !provider
            ? 'A fonte de mapa escolhida não está cadastrada neste navegador.'
            : !transform
              ? `Mapa sobre o terreno indisponível: ${geo.message}`
              : 'A superfície é ampla demais para esta fonte de mapa.',
        },
      });
      return;
    }
    const controller = new AbortController();
    let created: CanvasTexture | null = null;
    report({ drape: { state: 'loading', message: 'Carregando o mapa sobre o terreno…' } });
    void loadDrapeCanvas(mosaic, provider.tileSize, controller.signal).then((result) => {
      if (!result || controller.signal.aborted) return;
      if (result.state === 'unavailable') {
        report({
          drape: {
            state: 'unavailable',
            message:
              'Mapa indisponível: o serviço não respondeu ou não permite o uso das imagens no 3D. A superfície segue com a cor escolhida.',
          },
        });
        return;
      }
      created = new CanvasTexture(result.canvas);
      created.colorSpace = SRGBColorSpace;
      created.minFilter = LinearFilter;
      created.generateMipmaps = false;
      setTexture(created);
      report({
        drape: {
          state: result.state,
          message:
            result.state === 'partial'
              ? 'Mapa incompleto: parte das imagens não pôde ser carregada.'
              : mosaic.overzoom
                ? 'Imagem ampliada além da resolução da fonte.'
                : '',
        },
      });
    });
    return () => {
      controller.abort();
      created?.dispose();
      setTexture(null);
    };
  }, [display.drapeSourceId, provider, transform, mosaic, geo.message]);
  useEffect(() => () => useTerrainStore.setState({ drape: null }), []);
  const draped = texture !== null && mosaic !== null && transform !== null;
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
    // Posição de cada vértice na imagem do mapa, pela cadeia de referenciais do projeto.
    if (mosaic && transform) {
      g.setAttribute(
        'uv',
        new BufferAttribute(drapeUvs(transform, mosaic, mesh.positions, mesh.base), 2),
      );
    }
    g.computeBoundingSphere();
    return g;
  }, [mesh, mosaic, transform]);
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
      display.contourSmoothing,
    );
    return segments
      ? { minor: linesGeometry(segments.minor), major: linesGeometry(segments.major) }
      : null;
  }, [terrain, mesh, display.contours, display.contourInterval, display.contourSmoothing]);

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
      userData={{
        terrain: true,
        exaggeration: display.exaggeration,
        opacity: display.opacity,
        draped,
      }}
    >
      <mesh geometry={geometry} raycast={() => null}>
        <meshStandardMaterial
          // Trocar entre cor por vértice e imagem exige recompilar o material.
          key={draped ? 'map' : 'color'}
          vertexColors={!draped}
          map={draped ? texture : null}
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
