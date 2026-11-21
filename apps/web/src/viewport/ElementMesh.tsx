import type { HydroElement, Material } from '@hydrobim/core';
import { buildElementGeometry, type MeshData, type MeshPart } from '@hydrobim/geometry';
import { memo, useContext, useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide, FrontSide } from 'three';
import { ModelDisplayContext } from '../views/clipContext';
import { partFinish } from './materials';

// Ciano: o mesmo destaque da seleção na planta. A cor da peça é trocada (e não só somada à
// do material) para que o destaque seja o mesmo em PVC marrom, ferro preto ou aço.
const SELECTED_COLOR = '#19b6cf';
const SELECTED_EMISSIVE = '#006f85';
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
  // Vista 3D aberta: caixa de corte e estilo aramado (só apresentação).
  const display = useContext(ModelDisplayContext);
  return (
    <>
      {geometries.map((part, index) => {
        const finish = partFinish(part.role, material, colorOverride);
        return (
          <mesh key={index} geometry={part.geometry}>
            <meshStandardMaterial
              color={selected ? SELECTED_COLOR : finish.color}
              emissive={emissive}
              emissiveIntensity={selected ? 0.55 : hovered ? 0.7 : 0}
              roughness={finish.roughness}
              metalness={finish.metalness}
              clippingPlanes={display.planes}
              // Cortado, o interior da peça fica à vista: as faces de dentro também são desenhadas.
              side={display.planes ? DoubleSide : FrontSide}
              wireframe={display.wireframe}
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
