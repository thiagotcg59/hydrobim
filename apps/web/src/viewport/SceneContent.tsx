import {
  computeBounds,
  formatMeters,
  getFreePorts,
  distance,
  lerp,
  type Vec3,
} from '@hydrobim/core';
import { Grid, Html, Line, OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Group, PerspectiveCamera } from 'three';
import { Vector3 } from 'three';
import { useEditorStore, type ViewPreset } from '../state/editorStore';
import { ElementMesh } from './ElementMesh';
import { InteractionController } from './InteractionController';

const tuple = (v: Vec3): [number, number, number] => [v.x, v.y, v.z];

function Elements({ hoveredId }: { hoveredId: string | null }) {
  const elements = useEditorStore((s) => s.project.elements);
  const selection = useEditorStore((s) => s.selection);
  return (
    <>
      {elements.map((element) => (
        <ElementMesh
          key={element.id}
          element={element}
          selected={selection.includes(element.id)}
          hovered={element.id === hoveredId}
        />
      ))}
    </>
  );
}

/** Marcadores dos terminais livres (alvos de conexão) nas ferramentas de modelagem. */
function FreePortMarkers() {
  const project = useEditorStore((s) => s.project);
  const tool = useEditorStore((s) => s.tool);
  const snappedPort = useEditorStore((s) => s.cursor?.port ?? null);
  const ports = useMemo(() => getFreePorts(project), [project]);
  if (tool === 'select' || tool === 'measure') return null;
  return (
    <>
      {ports.map((port) => {
        const active =
          snappedPort?.elementId === port.ref.elementId && snappedPort.portId === port.ref.portId;
        const radius = Math.max(port.spec.outerDiameter * 0.62, 0.02) * (active ? 1.5 : 1);
        return (
          <mesh key={`${port.ref.elementId}#${port.ref.portId}`} position={tuple(port.position)}>
            <sphereGeometry args={[radius, 16, 12]} />
            <meshBasicMaterial
              color={active ? '#ffd166' : '#35d0e0'}
              transparent
              opacity={active ? 0.95 : 0.6}
              depthTest={false}
            />
          </mesh>
        );
      })}
    </>
  );
}

function DrawingOverlay() {
  const anchor = useEditorStore((s) => s.anchor);
  const cursor = useEditorStore((s) => s.cursor);
  const tool = useEditorStore((s) => s.tool);
  const measure = useEditorStore((s) => s.measure);
  const showCursor = cursor && tool !== 'select';

  const measureEnd = measure.b ?? (measure.a && tool === 'measure' ? cursor?.point : null) ?? null;

  return (
    <>
      {showCursor && (
        <mesh position={tuple(cursor.point)}>
          <sphereGeometry args={[0.025, 12, 8]} />
          <meshBasicMaterial color="#ffd166" depthTest={false} />
        </mesh>
      )}
      {tool === 'pipe' && anchor && cursor && distance(anchor.point, cursor.point) > 1e-6 && (
        <>
          <Line
            points={[tuple(anchor.point), tuple(cursor.point)]}
            color="#ffd166"
            lineWidth={2}
            dashed
            dashSize={0.1}
            gapSize={0.06}
            depthTest={false}
          />
          <Html position={tuple(lerp(anchor.point, cursor.point, 0.5))} center pointerEvents="none">
            <span className="viewport-label">
              {formatMeters(distance(anchor.point, cursor.point))}
            </span>
          </Html>
        </>
      )}
      {measure.a && measureEnd && distance(measure.a, measureEnd) > 1e-6 && (
        <>
          <Line
            points={[tuple(measure.a), tuple(measureEnd)]}
            color="#7ee0c3"
            lineWidth={2}
            depthTest={false}
          />
          <Html position={tuple(lerp(measure.a, measureEnd, 0.5))} center pointerEvents="none">
            <span className="viewport-label viewport-label--measure">
              {formatMeters(distance(measure.a, measureEnd))}
            </span>
          </Html>
        </>
      )}
    </>
  );
}

const VIEW_DIRECTIONS: Record<ViewPreset, [number, number, number]> = {
  fit: [0, 0, 0],
  iso: [1, -1.25, 0.9],
  top: [0, -0.0001, 1],
  front: [0, -1, 0],
};

/** Parte dos controles de órbita usada pelo enquadramento. */
interface OrbitLike {
  target: Vector3;
  update: () => void;
}

/** Enquadra o modelo e aplica as vistas predefinidas. */
function CameraRig() {
  const viewRequest = useEditorStore((s) => s.viewRequest);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const controls = useThree((s) => s.controls) as OrbitLike | null;

  useEffect(() => {
    if (!viewRequest || !controls) return;
    const { project } = useEditorStore.getState();
    const bounds = computeBounds(project.elements);
    const center = bounds
      ? new Vector3(
          (bounds.min.x + bounds.max.x) / 2,
          (bounds.min.y + bounds.max.y) / 2,
          (bounds.min.z + bounds.max.z) / 2,
        )
      : new Vector3(0, 0, 0);
    const size = bounds ? distance(bounds.min, bounds.max) : 10;
    const radius = Math.max(size / 2, 0.5);
    const fov = (camera.fov * Math.PI) / 180;
    const range = (radius / Math.sin(fov / 2)) * 1.15;

    const direction =
      viewRequest.preset === 'fit'
        ? camera.position.clone().sub(controls.target)
        : new Vector3(...VIEW_DIRECTIONS[viewRequest.preset]);
    if (direction.lengthSq() < 1e-9) direction.set(...VIEW_DIRECTIONS.iso);
    direction.normalize();

    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(direction, range);
    camera.near = Math.max(range / 1000, 0.005);
    camera.far = Math.max(range * 100, 2000);
    camera.updateProjectionMatrix();
    controls.update();
  }, [viewRequest, camera, controls]);

  return null;
}

export function SceneContent() {
  const elementsRef = useRef<Group>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const gridStep = useEditorStore((s) => s.gridStep);
  const workPlaneZ = useEditorStore((s) => s.workPlaneZ);

  return (
    <>
      <color attach="background" args={['#10161f']} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[8, -6, 14]} intensity={1.6} />
      <directionalLight position={[-9, 7, 5]} intensity={0.55} />

      <Grid
        position={[0, 0, workPlaneZ]}
        rotation={[Math.PI / 2, 0, 0]}
        infiniteGrid
        cellSize={gridStep}
        sectionSize={gridStep * 10}
        cellColor="#2a3646"
        sectionColor="#3f5470"
        cellThickness={0.6}
        sectionThickness={1.1}
        fadeDistance={gridStep * 400}
        fadeStrength={1.5}
        followCamera={false}
        side={2}
      />
      <axesHelper args={[1]} position={[0, 0, workPlaneZ]} />

      <group ref={elementsRef}>
        <Elements hoveredId={hoveredId} />
      </group>
      <FreePortMarkers />
      <DrawingOverlay />

      <OrbitControls makeDefault enableDamping={false} maxPolarAngle={Math.PI} />
      <CameraRig />
      <InteractionController elementsRef={elementsRef} onHover={setHoveredId} />

      <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
        <GizmoViewport axisColors={['#e5484d', '#46a758', '#3e8fff']} labelColor="#0c1118" />
      </GizmoHelper>
    </>
  );
}
