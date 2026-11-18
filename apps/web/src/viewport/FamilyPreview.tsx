import {
  add,
  formatMillimeters,
  length,
  lerp,
  normalize,
  scale,
  sub,
  type HydroElement,
  type Material,
  type Vec3,
} from '@hydrobim/core';
import { Line, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { Box3, Sphere, Vector3, type Group, type PerspectiveCamera } from 'three';
import type { CatalogDimension } from '../editor/familyDimensions';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import type { MeshPart } from '@hydrobim/geometry';
import { ElementMesh, PartMeshes } from './ElementMesh';
import { SceneLighting } from './SceneLighting';

const ISO_DIRECTION: [number, number, number] = [1, -1.25, 0.9];

function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

interface OrbitLike {
  target: Vector3;
  update: () => void;
}

/** Laranja escuro: legível sobre o fundo branco e sobre as peças. */
const DIMENSION_COLOR = '#d9480f';
const tuple = (v: Vec3): [number, number, number] => [v.x, v.y, v.z];

/** Traçado de uma cota: extremos da linha de cota, direções e tamanho dos traços. */
function layout(dimension: CatalogDimension) {
  const { a, b, offset } = dimension;
  const along = normalize(sub(b, a));
  const away = normalize(offset);
  const tick = Math.max(length(offset) * 0.12, dimension.value * 0.03);
  const start = add(a, offset);
  const end = add(b, offset);
  return {
    along,
    away,
    tick,
    start,
    end,
    label: add(lerp(start, end, 0.5), scale(away, tick * 1.5)),
  };
}

/** Cota de catálogo: linhas de chamada e linha de cota com traços. */
function DimensionLine({ dimension }: { dimension: CatalogDimension }) {
  const { a, b } = dimension;
  const { along, away, tick, start, end } = layout(dimension);
  const slash = scale(add(along, away), tick / Math.SQRT2);
  const line = (key: string, p: Vec3, q: Vec3, width = 1.2) => (
    <Line
      key={key}
      points={[tuple(p), tuple(q)]}
      color={DIMENSION_COLOR}
      lineWidth={width}
      depthTest={false}
      transparent
      renderOrder={10}
    />
  );
  return (
    <>
      {line('ext-a', a, add(start, scale(away, tick)))}
      {line('ext-b', b, add(end, scale(away, tick)))}
      {line('line', start, end, 1.8)}
      {line('tick-a', sub(start, slash), add(start, slash), 1.8)}
      {line('tick-b', sub(end, slash), add(end, slash), 1.8)}
    </>
  );
}

interface LabelProps {
  dimensions: readonly CatalogDimension[];
  /** Camada HTML sobre o canvas, com um rótulo por cota, na mesma ordem. */
  overlay: RefObject<HTMLDivElement | null>;
}

/** Posiciona os rótulos HTML das cotas sobre o canvas a cada quadro desenhado. */
function LabelProjector({ dimensions, overlay }: LabelProps) {
  const anchors = useMemo(
    () =>
      dimensions.map((dimension) => {
        const { label } = layout(dimension);
        return new Vector3(label.x, label.y, label.z);
      }),
    [dimensions],
  );
  const projected = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    const node = overlay.current;
    if (!node) return;
    camera.updateMatrixWorld();
    anchors.forEach((anchor, i) => {
      const label = node.children[i];
      if (!(label instanceof HTMLElement)) return;
      projected.copy(anchor).project(camera);
      const x = (projected.x * 0.5 + 0.5) * size.width;
      const y = (-projected.y * 0.5 + 0.5) * size.height;
      label.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      label.style.visibility = projected.z < 1 ? 'visible' : 'hidden';
    });
  });
  return null;
}

interface SceneProps extends LabelProps {
  element?: HydroElement;
  parts?: readonly MeshPart[];
  material: Material;
}

/** Enquadra a peça a cada troca, preservando a direção de observação escolhida. */
function Scene({ element, parts, material, dimensions, overlay }: SceneProps) {
  const groupRef = useRef<Group>(null);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const controls = useThree((s) => s.controls) as OrbitLike | null;
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const group = groupRef.current;
    if (!group || !controls) return;
    const sphere = new Box3().setFromObject(group).getBoundingSphere(new Sphere());
    const radius = Math.max(sphere.radius, 0.005);
    const range = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.1;
    const direction = camera.position.clone().sub(controls.target);
    if (direction.lengthSq() < 1e-12) direction.set(...ISO_DIRECTION);
    direction.normalize();

    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(direction, range);
    camera.near = range / 200;
    camera.far = range * 50;
    camera.updateProjectionMatrix();
    controls.update();
    invalidate();
  }, [element, parts, dimensions, camera, controls, invalidate]);

  return (
    <>
      <SceneLighting />
      <group ref={groupRef}>
        {element && <ElementMesh element={element} selected={false} hovered={false} />}
        {parts && <PartMeshes parts={parts} material={material} />}
        {dimensions.map((dimension) => (
          <DimensionLine key={dimension.key} dimension={dimension} />
        ))}
      </group>
      <LabelProjector dimensions={dimensions} overlay={overlay} />
      <OrbitControls makeDefault enableDamping={false} enablePan={Boolean(parts)} />
    </>
  );
}

const NO_DIMENSIONS: readonly CatalogDimension[] = [];

interface Props {
  /** Peça da rede (famílias de conexões). */
  element?: HydroElement;
  /** Partes de um produto da biblioteca, no referencial da própria peça. */
  parts?: readonly MeshPart[];
  /** Material usado na cor das partes avulsas (`parts`). */
  material?: Material;
  /** Cotas de catálogo desenhadas sobre o modelo. */
  dimensions?: readonly CatalogDimension[];
}

/** Modelo 3D de uma única peça, com órbita e zoom — usado na seção de famílias. */
export function FamilyPreview({
  element,
  parts,
  material = 'pvc',
  dimensions = NO_DIMENSIONS,
}: Props) {
  const webgl = useMemo(isWebGLAvailable, []);
  const overlay = useRef<HTMLDivElement>(null);
  if (!webgl) {
    return (
      <div className="viewport-fallback" role="alert">
        <span>WebGL indisponível: não é possível exibir o modelo 3D.</span>
      </div>
    );
  }
  return (
    <ErrorBoundary title="Falha ao gerar o modelo 3D da família">
      <div className="family-preview">
        <Canvas
          data-testid="family-preview-canvas"
          frameloop="demand"
          camera={{ position: ISO_DIRECTION, up: [0, 0, 1], fov: 35 }}
          gl={{ antialias: true }}
          dpr={[1, 2]}
        >
          <Scene
            element={element}
            parts={parts}
            material={material}
            dimensions={dimensions}
            overlay={overlay}
          />
        </Canvas>
        <div className="family-preview__labels" ref={overlay}>
          {dimensions.map((dimension) => (
            <span
              key={dimension.key}
              className="viewport-label viewport-label--dimension"
              data-testid="family-dimension"
              data-dimension={dimension.key}
            >
              {dimension.label} <strong>{formatMillimeters(dimension.value)}</strong>
            </span>
          ))}
        </div>
      </div>
    </ErrorBoundary>
  );
}
