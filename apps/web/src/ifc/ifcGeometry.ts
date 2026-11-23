import {
  applyIfcTransform,
  ifcTransformMatrix,
  type IfcTransform,
  type Point2,
  type Vec3,
} from '@hydrobim/core';
import {
  featureEdges,
  projectEdges,
  sectionSegments,
  type OutlineClipPlane,
  type OutlineFrame,
} from '@hydrobim/geometry';
import type { IfcBounds, IfcMeshGeometry, IfcObjectMesh } from '@hydrobim/ifc-import';

/**
 * Geometria derivada dos objetos importados (funções puras): posição no projeto, arestas
 * vivas e traços nas vistas 2D. Tudo é recalculado da malha lida do arquivo e da
 * transformação registrada no projeto — nada disto é gravado.
 *
 * As contas de posição são feitas em dupla precisão: a geometria fica no referencial próprio
 * (números pequenos) e a matriz carrega as coordenadas grandes.
 */

/** Malhas de um arquivo, indexadas para consulta por objeto. */
export interface IfcMeshIndex {
  readonly objectMeshes: ReadonlyMap<number, IfcObjectMesh>;
  readonly geometries: ReadonlyMap<number, IfcMeshGeometry>;
}

/** Produto a · b de matrizes 4×4 em ordem de colunas. */
export function multiplyMatrices(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += (a[k * 4 + row] ?? 0) * (b[column * 4 + k] ?? 0);
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

export function transformBounds(bounds: IfcBounds, transform: IfcTransform): IfcBounds {
  const out: [number, number, number, number, number, number] = [
    Infinity,
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
    -Infinity,
  ];
  for (let corner = 0; corner < 8; corner += 1) {
    const p = applyIfcTransform(transform, {
      x: bounds[corner & 1 ? 3 : 0],
      y: bounds[corner & 2 ? 4 : 1],
      z: bounds[corner & 4 ? 5 : 2],
    });
    out[0] = Math.min(out[0], p.x);
    out[1] = Math.min(out[1], p.y);
    out[2] = Math.min(out[2], p.z);
    out[3] = Math.max(out[3], p.x);
    out[4] = Math.max(out[4], p.y);
    out[5] = Math.max(out[5], p.z);
  }
  return out;
}

export function unionBounds(a: IfcBounds | null, b: IfcBounds | null): IfcBounds | null {
  if (!a) return b;
  if (!b) return a;
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.max(a[3], b[3]),
    Math.max(a[4], b[4]),
    Math.max(a[5], b[5]),
  ];
}

// As arestas vivas dependem só da geometria: uma conta por geometria compartilhada.
const localEdges = new WeakMap<IfcMeshGeometry, Float32Array>();

function edgesOf(geometry: IfcMeshGeometry): Float32Array {
  let edges = localEdges.get(geometry);
  if (!edges) {
    edges = featureEdges(geometry.positions, geometry.indices);
    localEdges.set(geometry, edges);
  }
  return edges;
}

function transformInto(
  out: Float64Array,
  offset: number,
  source: ArrayLike<number>,
  m: readonly number[],
): void {
  for (let i = 0; i + 2 < source.length; i += 3) {
    const x = source[i] ?? 0;
    const y = source[i + 1] ?? 0;
    const z = source[i + 2] ?? 0;
    out[offset + i] = (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0);
    out[offset + i + 1] = (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0);
    out[offset + i + 2] = (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0);
  }
}

/** Arestas vivas do objeto no referencial do projeto (6 números por aresta). */
export function objectEdges(
  index: IfcMeshIndex,
  expressId: number,
  transform: IfcTransform,
): Float64Array {
  const mesh = index.objectMeshes.get(expressId);
  if (!mesh) return new Float64Array(0);
  const world = ifcTransformMatrix(transform);
  const chunks: { edges: Float32Array; matrix: number[] }[] = [];
  let total = 0;
  for (const part of mesh.parts) {
    const geometry = index.geometries.get(part.geometryId);
    if (!geometry) continue;
    const edges = edgesOf(geometry);
    chunks.push({ edges, matrix: multiplyMatrices(world, part.matrix) });
    total += edges.length;
  }
  const out = new Float64Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    transformInto(out, offset, chunk.edges, chunk.matrix);
    offset += chunk.edges.length;
  }
  return out;
}

export interface ObjectTriangles {
  readonly positions: Float64Array;
  readonly indices: Uint32Array;
}

/** Triângulos do objeto no referencial do projeto (para o contorno de seção). */
export function objectTriangles(
  index: IfcMeshIndex,
  expressId: number,
  transform: IfcTransform,
): ObjectTriangles {
  const mesh = index.objectMeshes.get(expressId);
  const world = ifcTransformMatrix(transform);
  let vertexTotal = 0;
  let indexTotal = 0;
  const parts: { geometry: IfcMeshGeometry; matrix: number[] }[] = [];
  for (const part of mesh?.parts ?? []) {
    const geometry = index.geometries.get(part.geometryId);
    if (!geometry) continue;
    parts.push({ geometry, matrix: multiplyMatrices(world, part.matrix) });
    vertexTotal += geometry.positions.length;
    indexTotal += geometry.indices.length;
  }
  const positions = new Float64Array(vertexTotal);
  const indices = new Uint32Array(indexTotal);
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const { geometry, matrix } of parts) {
    transformInto(positions, vertexOffset, geometry.positions, matrix);
    const base = vertexOffset / 3;
    for (let i = 0; i < geometry.indices.length; i += 1) {
      indices[indexOffset + i] = (geometry.indices[i] ?? 0) + base;
    }
    vertexOffset += geometry.positions.length;
    indexOffset += geometry.indices.length;
  }
  return { positions, indices };
}

/** Traços de um objeto em uma vista 2D. */
export interface IfcOutline {
  /** Arestas projetadas: 4 números por segmento, em coordenadas da vista. */
  readonly lines: Float64Array;
  /** Contorno da seção nos planos de corte. */
  readonly cut: Float64Array;
  readonly min: Point2;
  readonly max: Point2;
}

/** Planta de trabalho: X e Y do projeto, vista de cima, sem corte. */
export const TOP_FRAME: OutlineFrame = {
  origin: { x: 0, y: 0, z: 0 },
  u: { x: 1, y: 0, z: 0 },
  v: { x: 0, y: 1, z: 0 },
  w: { x: 0, y: 0, z: 1 },
};

export function ifcOutline(
  index: IfcMeshIndex,
  expressId: number,
  transform: IfcTransform,
  frame: OutlineFrame,
  clip: readonly OutlineClipPlane[],
): IfcOutline | null {
  const lines = projectEdges(objectEdges(index, expressId, transform), frame, clip);
  let cut: Float64Array = new Float64Array(0);
  if (clip.length > 0) {
    const triangles = objectTriangles(index, expressId, transform);
    cut = sectionSegments(triangles.positions, triangles.indices, frame, clip);
  }
  if (lines.length === 0 && cut.length === 0) return null;
  const min = { x: Infinity, y: Infinity };
  const max = { x: -Infinity, y: -Infinity };
  for (const set of [lines, cut]) {
    for (let i = 0; i + 1 < set.length; i += 2) {
      const x = set[i] ?? 0;
      const y = set[i + 1] ?? 0;
      if (x < min.x) min.x = x;
      if (y < min.y) min.y = y;
      if (x > max.x) max.x = x;
      if (y > max.y) max.y = y;
    }
  }
  return { lines, cut, min, max };
}

const f = (value: number): string => (Math.round(value * 1e4) / 1e4).toString();

/** Caminho SVG dos segmentos, relativo a `anchor` (Y do SVG para baixo). */
export function segmentsPath(lines: Float64Array, anchor: Point2): string {
  const path: string[] = [];
  for (let i = 0; i + 3 < lines.length; i += 4) {
    path.push(
      `M${f((lines[i] ?? 0) - anchor.x)} ${f(-((lines[i + 1] ?? 0) - anchor.y))}L${f(
        (lines[i + 2] ?? 0) - anchor.x,
      )} ${f(-((lines[i + 3] ?? 0) - anchor.y))}`,
    );
  }
  return path.join('');
}

/** Vértice de aresta mais próximo de `point` em planta, dentro de `tolerance`. */
export function nearestEdgeVertex(
  edges: Float64Array,
  point: Point2,
  tolerance: number,
): Vec3 | null {
  let best: Vec3 | null = null;
  let bestDistance = tolerance;
  for (let i = 0; i + 2 < edges.length; i += 3) {
    const d = Math.hypot((edges[i] ?? 0) - point.x, (edges[i + 1] ?? 0) - point.y);
    if (d > bestDistance) continue;
    // No empate em planta (vértices na mesma vertical) fica o mais alto: o que se vê de cima.
    if (d < bestDistance - 1e-9 || !best || (edges[i + 2] ?? 0) > best.z) {
      best = { x: edges[i] ?? 0, y: edges[i + 1] ?? 0, z: edges[i + 2] ?? 0 };
    }
    bestDistance = d;
  }
  return best;
}
