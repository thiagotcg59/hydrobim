import type { HydroElement, Material } from '@hydrobim/core';
import { buildElementGeometry, type MeshData } from '@hydrobim/geometry';
import { memo, useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry } from 'three';

const MATERIAL_COLORS: Record<Material, string> = {
  pvc: '#8a6548',
  hdpe: '#2c3440',
  ductileIron: '#5b6f86',
  carbonSteel: '#9aa7b4',
};
const ACCENT_COLOR = '#d9534a';
const SELECTED_EMISSIVE = '#1f6fe0';
const HOVER_EMISSIVE = '#16406f';

function toBufferGeometry(mesh: MeshData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

interface ElementMeshProps {
  element: HydroElement;
  selected: boolean;
  hovered: boolean;
  /** Cor do sistema hidráulico; ausente = cor do material. */
  colorOverride?: string;
}

/**
 * Representação 3D de um elemento. A malha é regenerada sempre que o elemento (imutável)
 * é substituído — isto é, sempre que algum parâmetro muda.
 */
export const ElementMesh = memo(function ElementMesh({
  element,
  selected,
  hovered,
  colorOverride,
}: ElementMeshProps) {
  const { transform, parts } = useMemo(() => {
    const geometry = buildElementGeometry(element);
    return {
      transform: geometry.transform,
      parts: geometry.parts.map((part) => ({
        role: part.role,
        geometry: toBufferGeometry(part.mesh),
      })),
    };
  }, [element]);

  useEffect(
    () => () => {
      for (const part of parts) part.geometry.dispose();
    },
    [parts],
  );

  const { position, rotation } = transform;
  const emissive = selected ? SELECTED_EMISSIVE : hovered ? HOVER_EMISSIVE : '#000000';

  return (
    <group
      position={[position.x, position.y, position.z]}
      quaternion={[rotation.x, rotation.y, rotation.z, rotation.w]}
      userData={{ elementId: element.id }}
    >
      {parts.map((part, index) => (
        <mesh key={index} geometry={part.geometry}>
          <meshStandardMaterial
            color={
              part.role === 'accent'
                ? ACCENT_COLOR
                : (colorOverride ?? MATERIAL_COLORS[element.spec.material])
            }
            emissive={emissive}
            emissiveIntensity={selected ? 0.9 : hovered ? 0.7 : 0}
            roughness={0.55}
            metalness={element.spec.material === 'carbonSteel' ? 0.5 : 0.15}
          />
        </mesh>
      ))}
    </group>
  );
});
