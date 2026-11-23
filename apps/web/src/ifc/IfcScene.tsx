import {
  IFC_IDENTITY,
  ifcObjectTransform,
  ifcTransformMatrix,
  type IfcImportedModel,
  type ViewCategory,
} from '@hydrobim/core';
import type { IfcBounds, IfcMeshGeometry } from '@hydrobim/ifc-import';
import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useContext, useEffect, useMemo } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Plane,
} from 'three';
import { useEditorStore } from '../state/editorStore';
import { ModelDisplayContext } from '../views/clipContext';
import {
  ifcSourceOf,
  onIfcSourceReleased,
  placementTransform,
  useIfcStore,
  type IfcLoadedSource,
} from './ifcStore';

/**
 * Modelos IFC importados no Modelo 3D. As malhas são as lidas do arquivo: cada peça usa a
 * geometria compartilhada (instâncias do arquivo continuam instâncias) e a própria matriz, em
 * dupla precisão; a transformação do objeto no projeto fica no grupo dele. Nada é gravado —
 * tudo se refaz a partir da fonte.
 */

const SELECTED_COLOR = '#19b6cf';
const SELECTED_EMISSIVE = '#006f85';
/** Ambientes (IfcSpace) são volumes de ar: translúcidos para não esconder o que contêm. */
const SPACE_ALPHA = 0.25;
/** Opacidade da prévia do posicionamento. */
const GHOST_OPACITY = 0.55;

// Uma geometria na placa de vídeo por geometria do arquivo, enquanto a fonte estiver carregada.
const gpuGeometries = new Map<string, Map<number, BufferGeometry>>();

function bufferGeometryOf(sha256: string, geometry: IfcMeshGeometry): BufferGeometry {
  let bySource = gpuGeometries.get(sha256);
  if (!bySource) {
    bySource = new Map();
    gpuGeometries.set(sha256, bySource);
  }
  let buffer = bySource.get(geometry.id);
  if (!buffer) {
    buffer = new BufferGeometry();
    buffer.setAttribute('position', new BufferAttribute(geometry.positions, 3));
    buffer.setAttribute('normal', new BufferAttribute(geometry.normals, 3));
    buffer.setIndex(new BufferAttribute(geometry.indices, 1));
    buffer.computeBoundingSphere();
    bySource.set(geometry.id, buffer);
  }
  return buffer;
}

// Fonte solta (modelo removido, importação cancelada): a memória de vídeo vai junto.
onIfcSourceReleased((sha256) => {
  for (const buffer of gpuGeometries.get(sha256)?.values() ?? []) buffer.dispose();
  gpuGeometries.delete(sha256);
});

interface BuiltEntry {
  /** Identidade interna do objeto; `null` na prévia. */
  readonly id: string | null;
  readonly expressId: number;
}

interface Built {
  readonly group: Group;
  readonly objects: Map<string, Group>;
  readonly byExpressId: Map<number, Group[]>;
  readonly materials: { material: MeshStandardMaterial; alpha: number }[];
  readonly selectedMaterial: MeshStandardMaterial;
  dispose(): void;
}

function build(source: IfcLoadedSource, entries: readonly BuiltEntry[], ghost: boolean): Built {
  const group = new Group();
  const objects = new Map<string, Group>();
  const byExpressId = new Map<number, Group[]>();
  const byColor = new Map<string, { material: MeshStandardMaterial; alpha: number }>();
  const selectedMaterial = new MeshStandardMaterial({
    color: SELECTED_COLOR,
    emissive: SELECTED_EMISSIVE,
    emissiveIntensity: 0.55,
    roughness: 0.6,
    metalness: 0,
    side: DoubleSide,
  });
  const matrix = new Matrix4();
  for (const entry of entries) {
    const mesh = source.objectMeshes.get(entry.expressId);
    // Objeto sem geometria no arquivo: fica na árvore e nas propriedades, sem desenho.
    if (!mesh) continue;
    const space = source.objects.get(entry.expressId)?.entity === 'IfcSpace';
    const holder = new Group();
    holder.matrixAutoUpdate = false;
    if (ghost) holder.userData.ifcGhost = true;
    else holder.userData.ifcObjectId = entry.id;
    for (const part of mesh.parts) {
      const geometry = source.geometries.get(part.geometryId);
      if (!geometry) continue;
      const alpha = space ? Math.min(part.color[3], SPACE_ALPHA) : part.color[3];
      const key = `${part.color[0]},${part.color[1]},${part.color[2]},${alpha}`;
      let shared = byColor.get(key);
      if (!shared) {
        const material = new MeshStandardMaterial({
          roughness: 0.75,
          metalness: 0,
          // Malhas de terceiros nem sempre trazem as faces orientadas.
          side: DoubleSide,
        });
        // A cor do arquivo é sRGB de apresentação.
        material.color.setRGB(part.color[0], part.color[1], part.color[2], 'srgb');
        shared = { material, alpha };
        byColor.set(key, shared);
      }
      const piece = new Mesh(bufferGeometryOf(source.sha256, geometry), shared.material);
      piece.matrixAutoUpdate = false;
      piece.matrix.copy(matrix.fromArray(part.matrix as number[]));
      piece.userData.baseMaterial = shared.material;
      holder.add(piece);
    }
    group.add(holder);
    if (entry.id !== null) objects.set(entry.id, holder);
    const list = byExpressId.get(entry.expressId);
    if (list) list.push(holder);
    else byExpressId.set(entry.expressId, [holder]);
  }
  return {
    group,
    objects,
    byExpressId,
    materials: [...byColor.values()],
    selectedMaterial,
    dispose() {
      for (const { material } of byColor.values()) material.dispose();
      selectedMaterial.dispose();
    },
  };
}

function applyAppearance(
  built: Built,
  opacity: number,
  planes: Plane[] | null,
  wireframe: boolean,
): void {
  for (const { material, alpha } of built.materials) {
    const value = Math.max(0.02, Math.min(1, alpha * opacity));
    material.opacity = value;
    material.transparent = value < 1;
    material.depthWrite = value >= 1;
    material.clippingPlanes = planes;
    material.wireframe = wireframe;
    material.needsUpdate = true;
  }
  // O realce da seleção acompanha a transparência do modelo (senão ela sumiria ao selecionar).
  const selectedOpacity = Math.max(0.02, Math.min(1, opacity));
  built.selectedMaterial.opacity = selectedOpacity;
  built.selectedMaterial.transparent = selectedOpacity < 1;
  built.selectedMaterial.depthWrite = selectedOpacity >= 1;
  built.selectedMaterial.clippingPlanes = planes;
  built.selectedMaterial.wireframe = wireframe;
  built.selectedMaterial.needsUpdate = true;
}

function setMaterial(holder: Group, selected: MeshStandardMaterial | null): void {
  for (const child of holder.children) {
    if (!(child instanceof Mesh)) continue;
    child.material = selected ?? (child.userData.baseMaterial as MeshStandardMaterial);
  }
}

interface ModelProps {
  model: IfcImportedModel;
  source: IfcLoadedSource;
  selection: ReadonlySet<string>;
  whole: boolean;
  hidden: ReadonlySet<string>;
}

function IfcModelView({ model, source, selection, whole, hidden }: ModelProps) {
  const display = useContext(ModelDisplayContext);
  const built = useMemo(
    () =>
      build(
        source,
        model.objects.map((object) => ({ id: object.id, expressId: object.expressId })),
        false,
      ),
    [source, model.objects],
  );
  useEffect(() => () => built.dispose(), [built]);

  // Posição de cada objeto: transformação do modelo composta com a do componente.
  useEffect(() => {
    const matrix = new Matrix4();
    for (const object of model.objects) {
      const holder = built.objects.get(object.id);
      if (!holder) continue;
      holder.matrix.copy(matrix.fromArray(ifcTransformMatrix(ifcObjectTransform(model, object))));
      holder.matrixWorldNeedsUpdate = true;
    }
  }, [built, model]);

  useEffect(() => {
    applyAppearance(built, model.opacity, display.planes, display.wireframe);
  }, [built, model.opacity, display]);

  useEffect(() => {
    for (const [id, holder] of built.objects) {
      setMaterial(holder, whole || selection.has(id) ? built.selectedMaterial : null);
    }
  }, [built, selection, whole]);

  useEffect(() => {
    for (const [id, holder] of built.objects) holder.visible = !hidden.has(id);
  }, [built, hidden]);

  return <primitive object={built.group} />;
}

/** Prévia do posicionamento: os objetos escolhidos, com a transformação que será confirmada. */
function IfcGhost() {
  const wizard = useIfcStore((s) => s.wizard);
  const revision = useIfcStore((s) => s.revision);
  const display = useContext(ModelDisplayContext);
  const placing = wizard?.step === 'placing' ? wizard : null;
  const source = useMemo(
    () => (placing?.sha256 ? ifcSourceOf(placing.sha256) : null),
    // A revisão muda quando a fonte termina de carregar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placing?.sha256, revision],
  );
  const selected = placing?.selected;
  const built = useMemo(
    () =>
      source && selected
        ? build(
            source,
            [...selected].map((expressId) => ({ id: null, expressId })),
            true,
          )
        : null,
    [source, selected],
  );
  useEffect(() => () => built?.dispose(), [built]);
  useEffect(() => {
    if (built) applyAppearance(built, GHOST_OPACITY, display.planes, display.wireframe);
  }, [built, display]);

  const placement = placing?.placement;
  useEffect(() => {
    if (!built || !placement) return;
    const transform = placementTransform(placement);
    // Alinhamento ainda sem pontos: a prévia fica no lugar original até o 1º par.
    const matrix = ifcTransformMatrix(transform.ok ? transform.value : IFC_IDENTITY);
    built.group.matrixAutoUpdate = false;
    built.group.matrix.fromArray(matrix);
    built.group.matrixWorldNeedsUpdate = true;
  }, [built, placement]);

  return built ? <primitive object={built.group} /> : null;
}

/** Todos os modelos importados visíveis e a prévia do assistente. */
export function IfcModels({
  hiddenCategories,
}: {
  hiddenCategories?: ReadonlySet<ViewCategory> | null;
}) {
  const models = useEditorStore((s) => s.project.ifcModels);
  const revision = useIfcStore((s) => s.revision);
  const selectionIds = useIfcStore((s) => s.selection);
  const modelSelection = useIfcStore((s) => s.modelSelection);
  const hiddenIds = useIfcStore((s) => s.hidden);
  const selection = useMemo(() => new Set(selectionIds), [selectionIds]);
  const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const shown = hiddenCategories?.has('ifcModels') ? [] : models.filter((model) => model.visible);
  return (
    <>
      {shown.map((model) => {
        const source = ifcSourceOf(model.source.sha256);
        return source ? (
          <IfcModelView
            // A revisão entra na chave: fonte recarregada → malhas novas.
            key={`${model.id}:${revision}`}
            model={model}
            source={source}
            selection={selection}
            whole={modelSelection === model.id}
            hidden={hidden}
          />
        ) : null;
      })}
      <IfcGhost />
    </>
  );
}

/**
 * Prévia do diálogo de importação: os objetos escolhidos, como estão no arquivo. A cena é
 * desenhada em torno do centro da envoltória (os números grandes ficam fora da placa de
 * vídeo); as coordenadas mostradas ao usuário continuam as do arquivo.
 */
export function IfcPreviewCanvas({
  source,
  selected,
}: {
  source: IfcLoadedSource;
  selected: ReadonlySet<number>;
}) {
  const built = useMemo(
    () =>
      build(
        source,
        [...selected].map((expressId) => ({ id: null, expressId })),
        false,
      ),
    [source, selected],
  );
  useEffect(() => {
    applyAppearance(built, 1, null, false);
    return () => built.dispose();
  }, [built]);
  const bounds = useMemo(() => {
    let total: IfcBounds | null = null;
    for (const object of source.summary.objects) {
      if (!selected.has(object.expressId) || !object.bounds) continue;
      const b: IfcBounds = object.bounds;
      total = total
        ? [
            Math.min(total[0], b[0]),
            Math.min(total[1], b[1]),
            Math.min(total[2], b[2]),
            Math.max(total[3], b[3]),
            Math.max(total[4], b[4]),
            Math.max(total[5], b[5]),
          ]
        : b;
    }
    return total;
  }, [source, selected]);
  const centre = bounds
    ? ([
        (bounds[0] + bounds[3]) / 2,
        (bounds[1] + bounds[4]) / 2,
        (bounds[2] + bounds[5]) / 2,
      ] as const)
    : ([0, 0, 0] as const);
  const radius = bounds
    ? Math.max(
        Math.hypot(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]) / 2,
        0.5,
      )
    : 5;
  const distance = radius * 2.6;
  return (
    <Canvas
      data-testid="ifc-import-preview"
      // A chave refaz a câmera quando a seleção muda de tamanho.
      key={`${radius.toFixed(3)}:${centre.join(',')}`}
      camera={{
        position: [distance * 0.62, -distance * 0.62, distance * 0.5],
        up: [0, 0, 1],
        fov: 40,
        near: Math.max(radius / 500, 0.001),
        far: radius * 50,
      }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      dpr={[1, 2]}
    >
      <ambientLight intensity={1.1} />
      <directionalLight position={[3, -4, 6]} intensity={1.6} />
      <directionalLight position={[-4, 3, 2]} intensity={0.6} />
      <group position={[-centre[0], -centre[1], -centre[2]]}>
        <primitive object={built.group} />
      </group>
      <OrbitControls makeDefault target={[0, 0, 0]} />
    </Canvas>
  );
}
