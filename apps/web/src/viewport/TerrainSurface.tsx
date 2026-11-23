import {
  georeferenceStatus,
  projectEarthworks,
  terrainStats,
  type EarthworkSolid,
} from '@hydrobim/core';
import { useContext, useEffect, useMemo, useState } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  LinearFilter,
  SRGBColorSpace,
} from 'three';
import { findBasemapProvider } from '../map/providers';
import { HIGHLIGHT } from '../plan/planDrawing';
import { useEditorStore } from '../state/editorStore';
import { drapeMosaic, drapeUvs, loadDrapeCanvas } from '../terrain/drape';
import { CUT_COLOR, FILL_COLOR } from '../terrain/EarthworkPanel';
import { shownSurface, useEarthworkStore } from '../terrain/earthworkStore';
import { buildTerrainMesh, contourSegments, terrainEdges } from '../terrain/terrainColors';
import { contourIntervalOf } from '../terrain/TerrainLayers';
import { terrainBoundaryLoops } from '../terrain/terrainRaster';
import { useTerrainStore } from '../terrain/terrainStore';
import { ModelDisplayContext } from '../views/clipContext';

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
  const visible = useTerrainStore((s) => s.display.show3d);
  // Oculta, a superfície nem é montada: nada de malha, curvas nem download do mapa.
  return visible ? <TerrainSurfaceMesh /> : null;
}

/** Sólidos de corte (vermelho) e de aterro (azul) sobre o terreno projetado, na comparação. */
function CutFillSolids({ base }: { base: { x: number; y: number; z: number } }) {
  const project = useEditorStore((s) => s.project);
  const { planes } = useContext(ModelDisplayContext);
  const geometries = useMemo(() => {
    const summary = projectEarthworks(project);
    if (!summary) return null;
    const build = (solids: (EarthworkSolid | null)[]): BufferGeometry | null => {
      const positions: number[] = [];
      for (const solid of solids) {
        if (!solid) continue;
        for (const index of solid.triangles) {
          const p = solid.points[index];
          if (p) positions.push(p.x - base.x, p.y - base.y, p.z - base.z);
        }
      }
      if (positions.length === 0) return null;
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
      geometry.computeVertexNormals();
      return geometry;
    };
    return {
      cut: build(summary.platforms.map((p) => p.volumes?.cutSolid ?? null)),
      fill: build(summary.platforms.map((p) => p.volumes?.fillSolid ?? null)),
    };
  }, [project, base]);
  useEffect(
    () => () => {
      geometries?.cut?.dispose();
      geometries?.fill?.dispose();
    },
    [geometries],
  );
  if (!geometries) return null;
  const material = (color: string) => (
    <meshBasicMaterial
      color={color}
      side={DoubleSide}
      transparent
      opacity={0.55}
      depthWrite={false}
      clippingPlanes={planes}
      polygonOffset
      polygonOffsetFactor={-2}
      polygonOffsetUnits={-2}
    />
  );
  return (
    <group userData={{ earthwork: true }}>
      {geometries.cut && (
        <mesh geometry={geometries.cut} raycast={() => null} userData={{ earthwork: 'cut' }}>
          {material(CUT_COLOR)}
        </mesh>
      )}
      {geometries.fill && (
        <mesh geometry={geometries.fill} raycast={() => null} userData={{ earthwork: 'fill' }}>
          {material(FILL_COLOR)}
        </mesh>
      )}
    </group>
  );
}

function TerrainSurfaceMesh() {
  // Superfície à mostra: o terreno projetado (com os platôs), o natural ou o original.
  const natural = useEditorStore((s) => s.project.terrain);
  const platforms = useEditorStore((s) => s.project.earthworks.platforms);
  const surfaceView = useEarthworkStore((s) => s.view);
  const terrain = useMemo(
    () => (natural ? shownSurface(natural, platforms, surfaceView) : null),
    [natural, platforms, surfaceView],
  );
  // Caixa de corte da vista 3D aberta: a superfície é cortada com os elementos.
  const { planes } = useContext(ModelDisplayContext);
  const display = useTerrainStore((s) => s.display);

  const georeference = useEditorStore((s) => s.project.georeference);
  const customBasemap = useEditorStore((s) => s.customBasemap);
  // Memorizada: a fonte personalizada é um objeto novo a cada chamada, e uma identidade nova
  // refaria o mosaico e o download a cada renderização (o aviso de carregamento não sairia).
  const provider = useMemo(
    () => findBasemapProvider(display.drapeSourceId, customBasemap),
    [display.drapeSourceId, customBasemap],
  );
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
  // Selecionada como elemento: o contorno da área triangulada é realçado.
  const selected = useEarthworkStore((s) => s.selection?.kind === 'surface');
  const outline = useMemo(() => {
    if (!terrain || !mesh || !selected) return null;
    const { base } = mesh;
    const positions: number[] = [];
    for (const loop of terrainBoundaryLoops(terrain)) {
      for (let i = 0; i < loop.length; i += 1) {
        const p = terrain.points[loop[i] as number];
        const q = terrain.points[loop[(i + 1) % loop.length] as number];
        if (!p || !q) continue;
        positions.push(p.x - base.x, p.y - base.y, p.z - base.z);
        positions.push(q.x - base.x, q.y - base.y, q.z - base.z);
      }
    }
    return positions.length > 0 ? linesGeometry(new Float32Array(positions)) : null;
  }, [terrain, mesh, selected]);
  useEffect(() => () => outline?.dispose(), [outline]);
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
        selected,
        surfaceView,
        triangles: mesh.triangleCount,
      }}
    >
      {surfaceView === 'compare' && platforms.length > 0 && <CutFillSolids base={base} />}
      <mesh geometry={geometry} raycast={() => null}>
        <meshStandardMaterial
          // Trocar entre cor por vértice e imagem exige recompilar o material.
          key={draped ? 'map' : 'color'}
          vertexColors={!draped}
          map={draped ? texture : null}
          side={DoubleSide}
          clippingPlanes={planes}
          roughness={0.95}
          metalness={0}
          // Selecionada, a superfície ganha o tom do realce (como os demais elementos).
          emissive={selected ? HIGHLIGHT : '#000000'}
          emissiveIntensity={selected ? 0.12 : 0}
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
          <lineBasicMaterial color="#3f5a33" transparent opacity={0.45} clippingPlanes={planes} />
        </lineSegments>
      )}
      {outline && (
        <lineSegments geometry={outline} raycast={() => null} renderOrder={3}>
          <lineBasicMaterial color={HIGHLIGHT} depthTest={false} clippingPlanes={planes} />
        </lineSegments>
      )}
      {contours && (
        <>
          <lineSegments geometry={contours.minor} raycast={() => null}>
            <lineBasicMaterial color="#6b4423" transparent opacity={0.7} clippingPlanes={planes} />
          </lineSegments>
          <lineSegments geometry={contours.major} raycast={() => null}>
            <lineBasicMaterial color="#4a2c12" clippingPlanes={planes} />
          </lineSegments>
        </>
      )}
    </group>
  );
}
