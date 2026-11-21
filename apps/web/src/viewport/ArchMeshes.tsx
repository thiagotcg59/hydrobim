import { archViewCategoryOf, type ArchElement, type ViewCategory } from '@hydrobim/core';
import { buildArchGeometry, type ElementGeometry, type MeshData } from '@hydrobim/geometry';
import { memo, useContext, useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide, FrontSide } from 'three';
import { useArchStore } from '../arch/archStore';
import { useEditorStore } from '../state/editorStore';
import { ModelDisplayContext } from '../views/clipContext';
import { partFinish } from './materials';

// O mesmo destaque de seleção dos elementos da rede (ver `ElementMesh.tsx`).
const SELECTED_COLOR = '#19b6cf';
const SELECTED_EMISSIVE = '#006f85';

function toBufferGeometry(mesh: MeshData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

interface MeshProps {
  element: ArchElement;
  geometry: ElementGeometry;
  selected: boolean;
}

/**
 * Malha de um elemento arquitetônico, no referencial local dele. O acabamento vem do papel de
 * cada parte (parede, laje, piso, folha, marco, vidro) — o vidro é translúcido.
 */
const ArchMesh = memo(function ArchMesh({ element, geometry, selected }: MeshProps) {
  const parts = useMemo(
    () =>
      geometry.parts.map((part) => ({ role: part.role, geometry: toBufferGeometry(part.mesh) })),
    [geometry],
  );
  useEffect(
    () => () => {
      for (const part of parts) part.geometry.dispose();
    },
    [parts],
  );
  const display = useContext(ModelDisplayContext);
  const { position, rotation } = geometry.transform;
  return (
    <group
      position={[position.x, position.y, position.z]}
      quaternion={[rotation.x, rotation.y, rotation.z, rotation.w]}
      userData={{ archId: element.id }}
    >
      {parts.map((part, index) => {
        // As partes de arquitetura têm cor própria do papel: o material do tubo não interfere.
        const finish = partFinish(part.role, 'pvc');
        const opacity = finish.opacity ?? 1;
        return (
          <mesh key={index} geometry={part.geometry}>
            <meshStandardMaterial
              color={selected ? SELECTED_COLOR : finish.color}
              emissive={selected ? SELECTED_EMISSIVE : '#000000'}
              emissiveIntensity={selected ? 0.55 : 0}
              roughness={finish.roughness}
              metalness={finish.metalness}
              transparent={opacity < 1}
              opacity={opacity}
              depthWrite={opacity >= 1}
              clippingPlanes={display.planes}
              side={display.planes || opacity < 1 ? DoubleSide : FrontSide}
              wireframe={display.wireframe}
            />
          </mesh>
        );
      })}
    </group>
  );
});

/**
 * Elementos arquitetônicos no Modelo 3D: as malhas de `buildArchGeometry`, regeneradas quando a
 * arquitetura (imutável) é substituída. Ambientes não têm malha. `hiddenCategories` é a
 * visibilidade por categoria da vista 3D aberta.
 */
export function ArchElements({
  hiddenCategories,
}: {
  hiddenCategories?: ReadonlySet<ViewCategory> | null;
}) {
  const levels = useEditorStore((s) => s.project.levels);
  const architecture = useEditorStore((s) => s.project.architecture);
  const selection = useArchStore((s) => s.selection);
  const built = useMemo(
    () =>
      architecture.elements.flatMap((element) => {
        const geometry = buildArchGeometry({ levels, architecture }, element);
        return geometry ? [{ element, geometry }] : [];
      }),
    [levels, architecture],
  );
  return (
    <>
      {built
        .filter(({ element }) => !hiddenCategories?.has(archViewCategoryOf(element)))
        .map(({ element, geometry }) => (
          <ArchMesh
            key={element.id}
            element={element}
            geometry={geometry}
            selected={selection.includes(element.id)}
          />
        ))}
    </>
  );
}
