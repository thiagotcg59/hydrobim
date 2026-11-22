import {
  viewCategoryOf,
  type HydroElement,
  type Project,
  type Vec3,
  type ViewCategory,
} from '@hydrobim/core';
import { buildElementGeometry, partFinish, type MeshData } from '@hydrobim/geometry';
import {
  BatchedMesh,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Intersection,
  type Material,
} from 'three';
import { visibleElementsOf } from '../editor/visibility';

/**
 * Cena da rede hidráulica para a realidade virtual. A geometria é a mesma do Modelo 3D — vem de
 * `buildElementGeometry`, a partir dos parâmetros de cada elemento —, mas é desenhada em lotes:
 * todas as partes com o mesmo acabamento (rugosidade, metalicidade) vão em um `BatchedMesh`, com
 * a cor e a posição por parte. Malhas idênticas (peças iguais do catálogo) são guardadas uma só
 * vez. O resultado são poucas chamadas de desenho para a rede inteira, com descarte por parte
 * fora do campo de visão — o que o Quest 2 precisa para manter a taxa de quadros.
 *
 * Nada aqui altera o modelo: cada parte desenhada guarda o `id` do elemento de origem.
 */

export interface VrModelStats {
  readonly elements: number;
  /** Partes desenhadas (uma por parte de elemento). */
  readonly instances: number;
  /** Malhas distintas guardadas na placa de vídeo, depois de reunir as idênticas. */
  readonly geometries: number;
  readonly triangles: number;
  /** Lotes: o número de chamadas de desenho da rede, por olho. */
  readonly batches: number;
}

export interface VrModel {
  /** Raiz da cena, em coordenadas do projeto relativas a `origin`. */
  readonly root: Group;
  /** Origem local (projeto) subtraída das posições antes de irem à placa de vídeo. */
  readonly origin: Vec3;
  readonly stats: VrModelStats;
  /** Elemento do projeto atingido por um raio, ou `null`. */
  elementIdOf(hit: Intersection): string | null;
  /** Oculta as categorias indicadas (as demais ficam à mostra). */
  setHiddenCategories(hidden: ReadonlySet<ViewCategory>): void;
  /** Destaca um elemento (o mesmo ciano da seleção nas outras vistas); `null` limpa. */
  highlight(elementId: string | null): void;
  dispose(): void;
}

export interface VrModelOptions {
  readonly origin: Vec3;
  /**
   * Acima deste número de triângulos a rede usa sombreamento difuso, mais barato, no lugar do
   * físico. Ausente = sempre o físico (os mesmos acabamentos do Modelo 3D).
   */
  readonly cheapShadingAbove?: number;
}

const SELECTED_COLOR = '#19b6cf';

/** FNV-1a sobre os bytes das posições e dos índices: identifica malhas idênticas. */
function meshHash(mesh: MeshData): string {
  let hash = 0x811c9dc5;
  const feed = (bytes: Uint8Array): void => {
    for (let i = 0; i < bytes.length; i += 1) {
      hash ^= bytes[i] ?? 0;
      hash = Math.imul(hash, 0x01000193);
    }
  };
  feed(new Uint8Array(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength));
  feed(new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength));
  return `${mesh.positions.length}:${mesh.indices.length}:${(hash >>> 0).toString(16)}`;
}

function sameMesh(a: MeshData, b: MeshData): boolean {
  if (a === b) return true;
  if (a.positions.length !== b.positions.length || a.indices.length !== b.indices.length) {
    return false;
  }
  for (let i = 0; i < a.positions.length; i += 1) {
    if (a.positions[i] !== b.positions[i]) return false;
  }
  for (let i = 0; i < a.indices.length; i += 1) {
    if (a.indices[i] !== b.indices[i]) return false;
  }
  return true;
}

function toBufferGeometry(mesh: MeshData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  return geometry;
}

interface PendingInstance {
  readonly elementId: string;
  readonly category: ViewCategory;
  readonly geometry: number;
  readonly matrix: Matrix4;
  readonly color: string;
}

interface PendingBatch {
  readonly roughness: number;
  readonly metalness: number;
  readonly opacity: number;
  readonly meshes: MeshData[];
  readonly byHash: Map<string, number[]>;
  readonly instances: PendingInstance[];
}

interface BuiltBatch {
  readonly mesh: BatchedMesh;
  /** Elemento e categoria de cada parte, pelo índice da instância no lote. */
  readonly elementIds: string[];
  readonly categories: ViewCategory[];
}

/** Monta a cena da rede visível do projeto (sistemas ocultos ficam de fora). */
export function buildVrModel(
  project: Pick<Project, 'elements' | 'systems'>,
  options: VrModelOptions,
): VrModel {
  const { origin } = options;
  const elements = visibleElementsOf(project);
  const byId = new Map<string, HydroElement>(elements.map((element) => [element.id, element]));
  const systemColor = new Map(project.systems.map((system) => [system.id, system.color]));

  const pending = new Map<string, PendingBatch>();
  const position = new Vector3();
  const rotation = new Quaternion();
  const unit = new Vector3(1, 1, 1);
  let triangles = 0;

  for (const element of elements) {
    const { transform, parts } = buildElementGeometry(element);
    // A origem local é subtraída em precisão dupla: a placa de vídeo recebe números pequenos.
    position.set(
      transform.position.x - origin.x,
      transform.position.y - origin.y,
      transform.position.z - origin.z,
    );
    rotation.set(
      transform.rotation.x,
      transform.rotation.y,
      transform.rotation.z,
      transform.rotation.w,
    );
    const matrix = new Matrix4().compose(position, rotation, unit);
    const category = viewCategoryOf(element);
    for (const part of parts) {
      if (part.mesh.indices.length === 0) continue;
      const finish = partFinish(
        part.role,
        element.spec.material,
        systemColor.get(element.systemId),
      );
      const opacity = finish.opacity ?? 1;
      const key = `${finish.roughness}|${finish.metalness}|${opacity}`;
      let batch = pending.get(key);
      if (!batch) {
        batch = {
          roughness: finish.roughness,
          metalness: finish.metalness,
          opacity,
          meshes: [],
          byHash: new Map(),
          instances: [],
        };
        pending.set(key, batch);
      }
      const hash = meshHash(part.mesh);
      const candidates = batch.byHash.get(hash) ?? [];
      const known = batch.meshes;
      let geometry = candidates.find((index) => {
        const other = known[index];
        return other !== undefined && sameMesh(other, part.mesh);
      });
      if (geometry === undefined) {
        geometry = batch.meshes.length;
        batch.meshes.push(part.mesh);
        batch.byHash.set(hash, [...candidates, geometry]);
      }
      batch.instances.push({
        elementId: element.id,
        category,
        geometry,
        matrix,
        color: finish.color,
      });
      triangles += part.mesh.indices.length / 3;
    }
  }

  const root = new Group();
  root.name = 'vr-model';
  const batches: BuiltBatch[] = [];
  const materials: Material[] = [];
  const color = new Color();
  let geometries = 0;
  let instances = 0;
  const cheap = options.cheapShadingAbove !== undefined && triangles > options.cheapShadingAbove;

  for (const batch of pending.values()) {
    const vertexCount = batch.meshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0);
    const indexCount = batch.meshes.reduce((sum, mesh) => sum + mesh.indices.length, 0);
    const transparent = batch.opacity < 1;
    const material = cheap
      ? new MeshLambertMaterial({ transparent, opacity: batch.opacity })
      : new MeshStandardMaterial({
          roughness: batch.roughness,
          metalness: batch.metalness,
          transparent,
          opacity: batch.opacity,
        });
    if (transparent) {
      material.depthWrite = false;
      material.side = DoubleSide;
    }
    materials.push(material);
    const mesh = new BatchedMesh(batch.instances.length, vertexCount, indexCount, material);
    // A ordenação por distância a cada quadro só é necessária para partes translúcidas.
    mesh.sortObjects = transparent;
    const geometryIds = batch.meshes.map((data) => {
      const geometry = toBufferGeometry(data);
      const id = mesh.addGeometry(geometry);
      geometry.dispose();
      return id;
    });
    const elementIds: string[] = [];
    const categories: ViewCategory[] = [];
    for (const instance of batch.instances) {
      const geometryId = geometryIds[instance.geometry];
      if (geometryId === undefined) continue;
      const id = mesh.addInstance(geometryId);
      mesh.setMatrixAt(id, instance.matrix);
      mesh.setColorAt(id, color.set(instance.color));
      elementIds[id] = instance.elementId;
      categories[id] = instance.category;
    }
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    root.add(mesh);
    batches.push({ mesh, elementIds, categories });
    geometries += batch.meshes.length;
    instances += batch.instances.length;
  }

  const highlightMaterial = new MeshBasicMaterial({
    color: SELECTED_COLOR,
    transparent: true,
    opacity: 0.85,
    // Fica sobre a peça sem disputar a profundidade com ela.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  let highlighted: Group | null = null;
  const clearHighlight = (): void => {
    if (!highlighted) return;
    root.remove(highlighted);
    highlighted.traverse((object) => {
      if (object instanceof Mesh) (object.geometry as BufferGeometry).dispose();
    });
    highlighted = null;
  };

  return {
    root,
    origin,
    stats: { elements: elements.length, instances, geometries, triangles, batches: batches.length },
    elementIdOf(hit) {
      const batch = batches.find((candidate) => candidate.mesh === hit.object);
      if (!batch || hit.batchId === undefined) return null;
      return batch.elementIds[hit.batchId] ?? null;
    },
    setHiddenCategories(hidden) {
      for (const batch of batches) {
        batch.categories.forEach((category, id) => {
          batch.mesh.setVisibleAt(id, !hidden.has(category));
        });
      }
    },
    highlight(elementId) {
      clearHighlight();
      const element = elementId === null ? undefined : byId.get(elementId);
      if (!element) return;
      const { transform, parts } = buildElementGeometry(element);
      const group = new Group();
      group.position.set(
        transform.position.x - origin.x,
        transform.position.y - origin.y,
        transform.position.z - origin.z,
      );
      group.quaternion.set(
        transform.rotation.x,
        transform.rotation.y,
        transform.rotation.z,
        transform.rotation.w,
      );
      for (const part of parts) {
        const mesh = new Mesh(toBufferGeometry(part.mesh), highlightMaterial);
        // O destaque não é alvo do raio: quem responde é a parte do lote, com o `id` do elemento.
        mesh.raycast = () => undefined;
        group.add(mesh);
      }
      highlighted = group;
      root.add(group);
    },
    dispose() {
      clearHighlight();
      highlightMaterial.dispose();
      for (const batch of batches) {
        root.remove(batch.mesh);
        batch.mesh.dispose();
      }
      for (const material of materials) material.dispose();
      batches.length = 0;
    },
  };
}
