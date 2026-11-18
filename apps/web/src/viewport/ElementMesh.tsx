import type { HydroElement, Material } from '@hydrobim/core';
import { buildElementGeometry, type MeshData, type MeshPart } from '@hydrobim/geometry';
import { memo, useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry } from 'three';
import { partFinish } from './materials';

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

interface PartMeshesProps {
  parts: readonly MeshPart[];
  material: Material;
  selected?: boolean;
  hovered?: boolean;
  /** Cor do sistema hidráulico; ausente = cor do material. */
  colorOverride?: string;
}

/** Malhas de um conjunto de partes, com a cor de cada papel. */
export const PartMeshes = memo(function PartMeshes({
  parts,
  material,
  selected = false,
  hovered = false,
  colorOverride,
}: PartMeshesProps) {
  const geometries = useMemo(
    () => parts.map((part) => ({ role: part.role, geometry: toBufferGeometry(part.mesh) })),
    [parts],
  );
  useEffect(
    () => () => {
      for (const part of geometries) part.geometry.dispose();
    },
    [geometries],
  );
  const emissive = selected ? SELECTED_EMISSIVE : hovered ? HOVER_EMISSIVE : '#000000';
  return (
    <>
      {geometries.map((part, index) => {
        const finish = partFinish(part.role, material, colorOverride);
        return (
          <mesh key={index} geometry={part.geometry}>
            <meshStandardMaterial
              color={finish.color}
              emissive={emissive}
              emissiveIntensity={selected ? 0.9 : hovered ? 0.7 : 0}
              roughness={finish.roughness}
              metalness={finish.metalness}
            />
          </mesh>
        );
      })}
    </>
  );
});

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
  const { transform, parts } = useMemo(() => buildElementGeometry(element), [element]);
  const { position, rotation } = transform;

  return (
    <group
      position={[position.x, position.y, position.z]}
      quaternion={[rotation.x, rotation.y, rotation.z, rotation.w]}
      userData={{ elementId: element.id }}
    >
      <PartMeshes
        parts={parts}
        material={element.spec.material}
        selected={selected}
        hovered={hovered}
        colorOverride={colorOverride}
      />
    </group>
  );
});
