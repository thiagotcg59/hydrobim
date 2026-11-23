import type { OutlineClipPlane, OutlineFrame } from './viewOutline';

/**
 * Traços de uma malha triangulada qualquer (objetos importados) nas vistas 2D: arestas vivas
 * projetadas e o contorno da seção nos planos de corte. Custo linear no número de triângulos
 * — sem remoção de linhas ocultas —, para servir a malhas de terceiros de qualquer porte.
 * Funções puras; nada aqui inventa geometria: toda linha vem de uma aresta ou de um corte da
 * malha recebida.
 */

/** Ângulo entre faces a partir do qual a aresta comum é desenhada (30°). */
export const DEFAULT_CREASE_ANGLE = Math.PI / 6;

/**
 * Arestas vivas da malha: bordas livres, arestas com mais de duas faces e arestas cujo
 * ângulo entre as faces passa de `creaseAngle`. Vértices coincidentes são soldados (malhas de
 * IFC repetem os vértices a cada face). Devolve 6 números por aresta (ax, ay, az, bx, by, bz),
 * no mesmo referencial de `positions`.
 */
export function featureEdges(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  creaseAngle: number = DEFAULT_CREASE_ANGLE,
): Float32Array {
  const vertexCount = Math.floor(positions.length / 3);
  // Solda por posição arredondada à precisão relativa do tamanho da malha.
  let extent = 0;
  for (let i = 0; i < positions.length; i += 1) {
    extent = Math.max(extent, Math.abs(positions[i] ?? 0));
  }
  const quantum = Math.max(extent, 1e-9) * 1e-6;
  const welded = new Uint32Array(vertexCount);
  const byKey = new Map<string, number>();
  for (let v = 0; v < vertexCount; v += 1) {
    const key = `${Math.round((positions[v * 3] ?? 0) / quantum)},${Math.round(
      (positions[v * 3 + 1] ?? 0) / quantum,
    )},${Math.round((positions[v * 3 + 2] ?? 0) / quantum)}`;
    let id = byKey.get(key);
    if (id === undefined) {
      id = v;
      byKey.set(key, id);
    }
    welded[v] = id;
  }

  interface EdgeFaces {
    a: number;
    b: number;
    count: number;
    nx: number;
    ny: number;
    nz: number;
    sharp: boolean;
  }
  const edges = new Map<number, EdgeFaces>();
  const cosLimit = Math.cos(creaseAngle);
  const px = (v: number): number => positions[v * 3] ?? 0;
  const py = (v: number): number => positions[v * 3 + 1] ?? 0;
  const pz = (v: number): number => positions[v * 3 + 2] ?? 0;

  for (let t = 0; t + 2 < indices.length; t += 3) {
    const i0 = welded[indices[t] ?? 0] ?? 0;
    const i1 = welded[indices[t + 1] ?? 0] ?? 0;
    const i2 = welded[indices[t + 2] ?? 0] ?? 0;
    if (i0 === i1 || i1 === i2 || i0 === i2) continue;
    const ux = px(i1) - px(i0);
    const uy = py(i1) - py(i0);
    const uz = pz(i1) - pz(i0);
    const vx = px(i2) - px(i0);
    const vy = py(i2) - py(i0);
    const vz = pz(i2) - pz(i0);
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const size = Math.hypot(nx, ny, nz);
    if (size < 1e-20) continue;
    nx /= size;
    ny /= size;
    nz /= size;
    const corners: [number, number, number] = [i0, i1, i2];
    for (let e = 0; e < 3; e += 1) {
      const a = corners[e] ?? 0;
      const b = corners[(e + 1) % 3] ?? 0;
      const low = Math.min(a, b);
      const high = Math.max(a, b);
      const key = low * vertexCount + high;
      const edge = edges.get(key);
      if (!edge) {
        edges.set(key, { a: low, b: high, count: 1, nx, ny, nz, sharp: false });
        continue;
      }
      edge.count += 1;
      // O sinal não importa: malhas de terceiros nem sempre têm faces orientadas.
      if (Math.abs(edge.nx * nx + edge.ny * ny + edge.nz * nz) < cosLimit) edge.sharp = true;
    }
  }

  const out: number[] = [];
  for (const edge of edges.values()) {
    if (edge.count === 2 && !edge.sharp) continue;
    out.push(px(edge.a), py(edge.a), pz(edge.a), px(edge.b), py(edge.b), pz(edge.b));
  }
  return new Float32Array(out);
}

const side = (plane: OutlineClipPlane, x: number, y: number, z: number): number =>
  (x - plane.point.x) * plane.normal.x +
  (y - plane.point.y) * plane.normal.y +
  (z - plane.point.z) * plane.normal.z;

/** Recorta o segmento pelos semiespaços; devolve `false` quando nada sobra. */
function clipSegment(segment: Float64Array, clip: readonly OutlineClipPlane[], skip = -1): boolean {
  for (let index = 0; index < clip.length; index += 1) {
    if (index === skip) continue;
    const plane = clip[index];
    if (!plane) continue;
    const da = side(plane, segment[0] ?? 0, segment[1] ?? 0, segment[2] ?? 0);
    const db = side(plane, segment[3] ?? 0, segment[4] ?? 0, segment[5] ?? 0);
    if (da < 0 && db < 0) return false;
    if (da >= 0 && db >= 0) continue;
    const t = da / (da - db);
    const x = (segment[0] ?? 0) + ((segment[3] ?? 0) - (segment[0] ?? 0)) * t;
    const y = (segment[1] ?? 0) + ((segment[4] ?? 0) - (segment[1] ?? 0)) * t;
    const z = (segment[2] ?? 0) + ((segment[5] ?? 0) - (segment[2] ?? 0)) * t;
    if (da < 0) segment.set([x, y, z], 0);
    else segment.set([x, y, z], 3);
  }
  return true;
}

function pushProjected(out: number[], segment: Float64Array, frame: OutlineFrame): void {
  const { origin, u, v } = frame;
  const ax = (segment[0] ?? 0) - origin.x;
  const ay = (segment[1] ?? 0) - origin.y;
  const az = (segment[2] ?? 0) - origin.z;
  const bx = (segment[3] ?? 0) - origin.x;
  const by = (segment[4] ?? 0) - origin.y;
  const bz = (segment[5] ?? 0) - origin.z;
  const u1 = ax * u.x + ay * u.y + az * u.z;
  const v1 = ax * v.x + ay * v.y + az * v.z;
  const u2 = bx * u.x + by * u.y + bz * u.z;
  const v2 = bx * v.x + by * v.y + bz * v.z;
  // Aresta vista de topo (perpendicular à vista) não é traço.
  if (Math.hypot(u2 - u1, v2 - v1) < 1e-7) return;
  out.push(u1, v1, u2, v2);
}

/**
 * Projeta arestas (6 números cada, no referencial do projeto) na vista, recortadas pelos
 * planos de corte. Devolve 4 números por segmento (u1, v1, u2, v2).
 */
export function projectEdges(
  edges: ArrayLike<number>,
  frame: OutlineFrame,
  clip: readonly OutlineClipPlane[] = [],
): Float64Array {
  const out: number[] = [];
  const segment = new Float64Array(6);
  for (let i = 0; i + 5 < edges.length; i += 6) {
    for (let k = 0; k < 6; k += 1) segment[k] = edges[i + k] ?? 0;
    if (!clipSegment(segment, clip)) continue;
    pushProjected(out, segment, frame);
  }
  return new Float64Array(out);
}

/**
 * Contorno da seção: interseção de cada triângulo com cada plano de corte, limitada pelos
 * demais planos, projetada na vista. `positions` no referencial do projeto.
 */
export function sectionSegments(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  frame: OutlineFrame,
  clip: readonly OutlineClipPlane[],
): Float64Array {
  const out: number[] = [];
  const segment = new Float64Array(6);
  const distances = [0, 0, 0];
  const corners = [0, 0, 0];
  for (let planeIndex = 0; planeIndex < clip.length; planeIndex += 1) {
    const plane = clip[planeIndex];
    if (!plane) continue;
    for (let t = 0; t + 2 < indices.length; t += 3) {
      let below = 0;
      let above = 0;
      for (let c = 0; c < 3; c += 1) {
        const v = (indices[t + c] ?? 0) * 3;
        corners[c] = v;
        const d = side(plane, positions[v] ?? 0, positions[v + 1] ?? 0, positions[v + 2] ?? 0);
        distances[c] = d;
        if (d < 0) below += 1;
        else above += 1;
      }
      if (below === 0 || above === 0) continue;
      let filled = 0;
      for (let c = 0; c < 3 && filled < 2; c += 1) {
        const n = (c + 1) % 3;
        const da = distances[c] ?? 0;
        const db = distances[n] ?? 0;
        if (da < 0 === db < 0) continue;
        const k = da / (da - db);
        const a = corners[c] ?? 0;
        const b = corners[n] ?? 0;
        for (let axis = 0; axis < 3; axis += 1) {
          const from = positions[a + axis] ?? 0;
          segment[filled * 3 + axis] = from + ((positions[b + axis] ?? 0) - from) * k;
        }
        filled += 1;
      }
      if (filled < 2) continue;
      if (!clipSegment(segment, clip, planeIndex)) continue;
      pushProjected(out, segment, frame);
    }
  }
  return new Float64Array(out);
}
