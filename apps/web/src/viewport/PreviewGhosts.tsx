import { add, scale, type HydroElement, type Vec3 } from '@hydrobim/core';
import { buildElementGeometry } from '@hydrobim/geometry';
import { Html, Line } from '@react-three/drei';
import { memo, useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry } from 'three';
import { useEditorStore } from '../state/editorStore';
import { guidesText, RELATION_LABELS, useViewPreview } from '../state/viewPreview';

const PREVIEW_COLOR = '#2f9e44';
const GUIDE_COLOR = '#7048e8';

const tuple = (v: Vec3): [number, number, number] => [v.x, v.y, v.z];

/** Fantasma translúcido de um elemento da prévia (fora do grupo que recebe o clique). */
const Ghost = memo(function Ghost({ element }: { element: HydroElement }) {
  const { transform, parts } = useMemo(() => buildElementGeometry(element), [element]);
  const geometries = useMemo(
    () =>
      parts.map((part) => {
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(part.mesh.positions, 3));
        geometry.setAttribute('normal', new BufferAttribute(part.mesh.normals, 3));
        geometry.setIndex(new BufferAttribute(part.mesh.indices, 1));
        return geometry;
      }),
    [parts],
  );
  useEffect(() => () => geometries.forEach((geometry) => geometry.dispose()), [geometries]);
  const { position, rotation } = transform;
  return (
    <group
      position={[position.x, position.y, position.z]}
      quaternion={[rotation.x, rotation.y, rotation.z, rotation.w]}
      userData={{ preview: true }}
    >
      {geometries.map((geometry, index) => (
        <mesh key={index} geometry={geometry} renderOrder={2}>
          <meshStandardMaterial
            color={PREVIEW_COLOR}
            transparent
            opacity={0.5}
            depthWrite={false}
            emissive={PREVIEW_COLOR}
            emissiveIntensity={0.25}
          />
        </mesh>
      ))}
    </group>
  );
});

/**
 * Prévia no modelo 3D: elementos criados e alterados pela operação, símbolo da peça de
 * derivação e guias de alinhamento (eixos das portas, projeção, encontro e desvios). A mesma
 * prévia da planta (`useViewPreview`).
 */
export function PreviewGhosts() {
  const preview = useViewPreview();
  const cursor = useEditorStore((s) => s.cursor);
  if (!preview) return null;
  const { guides } = preview;
  const reach = guides ? Math.max(guides.distance * 1.2, 1) : 0;
  return (
    <>
      {preview.ghosts.map((element) => (
        <Ghost key={element.id} element={element} />
      ))}
      {preview.junctions.map(({ element, label }) =>
        element.kind === 'pipe' ? null : (
          <Html key={`j-${element.id}`} position={tuple(element.placement.position)} center>
            <span
              className="viewport-label viewport-label--preview"
              data-testid="viewport-preview-junction"
              data-kind={element.kind}
            >
              {label}
            </span>
          </Html>
        ),
      )}
      {guides && (
        <>
          {[guides.from, guides.to].map((port, index) => (
            <Line
              key={index}
              points={[
                tuple(port.position),
                tuple(add(port.position, scale(port.direction, reach))),
              ]}
              color={GUIDE_COLOR}
              lineWidth={1.5}
              dashed
              dashSize={0.12}
              gapSize={0.06}
              depthTest={false}
            />
          ))}
          <Line
            points={[tuple(guides.from.position), tuple(guides.footOnTarget)]}
            color={GUIDE_COLOR}
            lineWidth={1}
            dashed
            dashSize={0.04}
            gapSize={0.04}
            depthTest={false}
          />
          {guides.meet && (
            <mesh position={tuple(guides.meet.onTo)}>
              <sphereGeometry args={[0.03, 12, 8]} />
              <meshBasicMaterial color={GUIDE_COLOR} depthTest={false} />
            </mesh>
          )}
          <Html position={tuple(guides.footOnTarget)} pointerEvents="none">
            <span className="viewport-label" data-testid="viewport-guides-text">
              {`${RELATION_LABELS[guides.relation]} — ${guidesText(guides)}`}
            </span>
          </Html>
        </>
      )}
      {preview.error && cursor && (
        <Html position={tuple(cursor.point)} pointerEvents="none">
          <span
            className="viewport-label viewport-label--error"
            data-testid="viewport-preview-error"
            style={{ transform: 'translateY(28px)' }}
          >
            {preview.error}
          </span>
        </Html>
      )}
    </>
  );
}
