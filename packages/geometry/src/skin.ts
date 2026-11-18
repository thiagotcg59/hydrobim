import { add, cross, dot, normalize, scale, sub, vec3, type Vec3 } from '@hydrobim/core';
import type { MeshData } from './sweep';

/**
 * Malhas por anéis explícitos. Complementa `loft.ts` nos casos em que os anéis não são
 * círculos planos igualmente divididos: a boca de uma derivação que nasce sobre outro
 * cilindro (curva de interseção em sela) e o furo correspondente na parede da passagem.
 *
 * Convenção de orientação (a mesma de `loft`): os pontos de cada anel giram no sentido
 * direto em torno do sentido de AVANÇO da trajetória. Percorrendo a parede externa para a
 * frente e o furo de volta, as normais saem do material.
 */

export interface Ring {
  readonly points: readonly Vec3[];
  /** Aresta viva: encerra o grupo de suavização neste anel e inicia outro. */
  readonly crease?: boolean;
}

/** Nó de um perfil de revolução: posição `s` ao longo do eixo, raio e aresta viva. */
export type ProfileNode = readonly [s: number, radius: number, crease?: boolean];

/** Eixo (reto ou curvo) ao longo do qual um perfil é revolvido. */
export interface Axis {
  /** Vetor de referência, não paralelo às tangentes, que fixa a origem dos ângulos. */
  readonly up: Vec3;
  at(s: number): { center: Vec3; tangent: Vec3 };
}

export function straightAxis(origin: Vec3, direction: Vec3, up: Vec3): Axis {
  const tangent = normalize(direction);
  return { up, at: (s) => ({ center: add(origin, scale(tangent, s)), tangent }) };
}

export function uniformAngles(count: number): number[] {
  return Array.from({ length: count }, (_, j) => (j / count) * Math.PI * 2);
}

/** Pontos de um círculo normal a `tangent`, nos ângulos dados a partir de `up`. */
export function circle(
  center: Vec3,
  tangent: Vec3,
  up: Vec3,
  radius: number,
  angles: readonly number[],
): Vec3[] {
  const t = normalize(tangent);
  const n = normalize(sub(up, scale(t, dot(up, t))));
  const b = cross(t, n);
  return angles.map((angle) =>
    add(center, add(scale(n, radius * Math.cos(angle)), scale(b, radius * Math.sin(angle)))),
  );
}

const FLAT = 1e-18;

/**
 * Superfície que une anéis consecutivos (todos com o mesmo número de pontos, fechados em
 * torno do eixo). Normais por média das faces dentro de cada grupo de suavização.
 */
export function skin(rings: readonly Ring[]): MeshData {
  const count = rings[0]?.points.length ?? 0;
  if (rings.length < 2 || count < 3) throw new Error('A superfície exige ao menos dois anéis.');
  if (rings.some((ring) => ring.points.length !== count)) {
    throw new Error('Os anéis de uma superfície precisam ter o mesmo número de pontos.');
  }

  const groups: Ring[][] = [];
  let current: Ring[] = [];
  rings.forEach((ring, index) => {
    current.push(ring);
    if (ring.crease && index > 0 && index < rings.length - 1) {
      groups.push(current);
      current = [ring];
    }
  });
  groups.push(current);

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (const group of groups) {
    if (group.length < 2) continue;
    const base = positions.length / 3;
    const flat = group.flatMap((ring) => ring.points);
    for (const p of flat) positions.push(p.x, p.y, p.z);
    const sums = new Float64Array(flat.length * 3);

    const face = (a: number, b: number, c: number): void => {
      const pa = flat[a] as Vec3;
      const normal = cross(sub(flat[b] as Vec3, pa), sub(flat[c] as Vec3, pa));
      // Triângulos degenerados (anel de raio nulo, pontos coincidentes) não entram.
      if (Math.hypot(normal.x, normal.y, normal.z) < FLAT) return;
      indices.push(base + a, base + b, base + c);
      for (const v of [a, b, c]) {
        sums[v * 3] = (sums[v * 3] as number) + normal.x;
        sums[v * 3 + 1] = (sums[v * 3 + 1] as number) + normal.y;
        sums[v * 3 + 2] = (sums[v * 3 + 2] as number) + normal.z;
      }
    };
    for (let i = 0; i < group.length - 1; i += 1) {
      for (let j = 0; j < count; j += 1) {
        const a = i * count + j;
        const b = i * count + ((j + 1) % count);
        const c = a + count;
        const d = b + count;
        face(a, b, c);
        face(b, d, c);
      }
    }

    for (let v = 0; v < flat.length; v += 1) {
      const x = sums[v * 3] as number;
      const y = sums[v * 3 + 1] as number;
      const z = sums[v * 3 + 2] as number;
      const length = Math.hypot(x, y, z);
      // Vértice sem face (faixa degenerada): normal qualquer, apenas para manter a malha válida.
      if (length > FLAT) normals.push(x / length, y / length, z / length);
      else normals.push(0, 0, 1);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

/** Elimina nós consecutivos coincidentes, preservando a marca de aresta viva. */
function dedupe(nodes: readonly ProfileNode[]): ProfileNode[] {
  const out: ProfileNode[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - node[0]) < 1e-12 && Math.abs(last[1] - node[1]) < 1e-12) {
      out[out.length - 1] = [last[0], last[1], Boolean(last[2]) || Boolean(node[2])];
    } else out.push(node);
  }
  return out;
}

export function profileRings(
  axis: Axis,
  nodes: readonly ProfileNode[],
  angles: readonly number[],
): Ring[] {
  return nodes.map(([s, radius, crease]) => {
    const { center, tangent } = axis.at(s);
    return { points: circle(center, tangent, axis.up, radius, angles), crease: Boolean(crease) };
  });
}

/** Revolve os nós na ordem dada (faixa aberta nas duas pontas). */
export function strip(
  axis: Axis,
  nodes: readonly ProfileNode[],
  angles: readonly number[],
): MeshData {
  return skin(profileRings(axis, dedupe(nodes), angles));
}

/**
 * Casca fechada: parede externa para a frente, face da extremidade, furo de volta e face
 * inicial. `outer` e `inner` são dados com `s` crescente.
 */
export function shell(
  axis: Axis,
  outer: readonly ProfileNode[],
  inner: readonly ProfileNode[],
  angles: readonly number[],
): MeshData {
  const first = outer[0];
  const lastOuter = outer[outer.length - 1];
  const firstInner = inner[0];
  const lastInner = inner[inner.length - 1];
  if (!first || !lastOuter || !firstInner || !lastInner) throw new Error('Perfil vazio.');
  const nodes: ProfileNode[] = [
    ...outer.slice(0, -1),
    [lastOuter[0], lastOuter[1], true],
    [lastInner[0], lastInner[1], true],
    ...inner.slice(1, -1).reverse(),
    [firstInner[0], firstInner[1], true],
    [first[0], first[1], true],
  ];
  return strip(axis, nodes, angles);
}

/**
 * Malha de uma grade de pontos sobre uma superfície de normal conhecida. Os triângulos são
 * orientados pela normal analítica, o que mantém o sombreamento contínuo entre retalhos
 * vizinhos da mesma superfície.
 */
export function patch(
  grid: readonly (readonly Vec3[])[],
  normalAt: (point: Vec3) => Vec3,
  wrap: boolean,
): MeshData {
  const rows = grid.length;
  const columns = grid[0]?.length ?? 0;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const flat: Vec3[] = [];
  const flatNormals: Vec3[] = [];
  for (const row of grid) {
    for (const p of row) {
      const n = normalize(normalAt(p));
      flat.push(p);
      flatNormals.push(n);
      positions.push(p.x, p.y, p.z);
      normals.push(n.x, n.y, n.z);
    }
  }
  const face = (a: number, b: number, c: number): void => {
    const pa = flat[a] as Vec3;
    const normal = cross(sub(flat[b] as Vec3, pa), sub(flat[c] as Vec3, pa));
    if (Math.hypot(normal.x, normal.y, normal.z) < FLAT) return;
    const reference = add(
      add(flatNormals[a] as Vec3, flatNormals[b] as Vec3),
      flatNormals[c] as Vec3,
    );
    if (dot(normal, reference) >= 0) indices.push(a, b, c);
    else indices.push(a, c, b);
  };
  const last = wrap ? rows : rows - 1;
  for (let i = 0; i < last; i += 1) {
    const next = (i + 1) % rows;
    for (let j = 0; j < columns - 1; j += 1) {
      const a = i * columns + j;
      const b = next * columns + j;
      face(a, b, a + 1);
      face(b, b + 1, a + 1);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

export function mergeMeshes(meshes: readonly MeshData[]): MeshData {
  const vertexCount = meshes.reduce((sum, m) => sum + m.positions.length, 0);
  const indexCount = meshes.reduce((sum, m) => sum + m.indices.length, 0);
  const positions = new Float32Array(vertexCount);
  const normals = new Float32Array(vertexCount);
  const indices = new Uint32Array(indexCount);
  let v = 0;
  let i = 0;
  for (const mesh of meshes) {
    positions.set(mesh.positions, v);
    normals.set(mesh.normals, v);
    const base = v / 3;
    for (let k = 0; k < mesh.indices.length; k += 1) indices[i + k] = (mesh.indices[k] ?? 0) + base;
    v += mesh.positions.length;
    i += mesh.indices.length;
  }
  return { positions, normals, indices };
}

/** Aplica uma transformação rígida (rotação/translação) a posições e normais. */
export function mapMesh(
  mesh: MeshData,
  point: (p: Vec3) => Vec3,
  direction: (d: Vec3) => Vec3,
): MeshData {
  const positions = new Float32Array(mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length);
  for (let k = 0; k < mesh.positions.length; k += 3) {
    const p = point(
      vec3(mesh.positions[k] ?? 0, mesh.positions[k + 1] ?? 0, mesh.positions[k + 2] ?? 0),
    );
    const n = direction(
      vec3(mesh.normals[k] ?? 0, mesh.normals[k + 1] ?? 0, mesh.normals[k + 2] ?? 0),
    );
    positions.set([p.x, p.y, p.z], k);
    normals.set([n.x, n.y, n.z], k);
  }
  return { positions, normals, indices: mesh.indices };
}

// ---------------------------------------------------------------------------
// Derivação sobre um cilindro (interseção em sela)
// ---------------------------------------------------------------------------

/**
 * A passagem é um cilindro de eixo X; a derivação sai em ±Y. No referencial da derivação
 * (`d` = sentido, `n` = X, `b` = d × X), o ponto de ângulo θ e raio r fica em
 * `h·d + r·(cos θ·X + sin θ·b)`; ele toca o cilindro de raio R quando `h = √(R² − r²sin²θ)`.
 */
export type BranchSide = 1 | -1;

const sideFrame = (side: BranchSide): { d: Vec3; b: Vec3 } => ({
  d: vec3(0, side, 0),
  b: vec3(0, 0, -side),
});

/**
 * Ângulos dos pontos da boca da derivação. Não são uniformes: cada um corresponde a um
 * ponto do contorno do retalho da passagem (arcos divididos como os anéis da passagem),
 * de modo que as malhas vizinhas compartilham exatamente os mesmos vértices.
 */
export function saddleAngles(ringSegments: number, straightSegments: number): number[] {
  return boundary(ringSegments, straightSegments).map(([u, v]) => Math.atan2(v, u));
}

/** Contorno do retalho em coordenadas normalizadas (u = x/a, v = ψ/(π/2)), sentido direto. */
function boundary(ringSegments: number, straightSegments: number): [number, number][] {
  if (ringSegments % 4 !== 0) throw new Error('O número de segmentos deve ser múltiplo de 4.');
  const half = ringSegments / 2;
  const points: [number, number][] = [];
  for (let i = 0; i < half; i += 1) points.push([1, -1 + (2 * i) / half]);
  for (let i = 0; i < straightSegments; i += 1) points.push([1 - (2 * i) / straightSegments, 1]);
  for (let i = 0; i < half; i += 1) points.push([-1, 1 - (2 * i) / half]);
  for (let i = 0; i < straightSegments; i += 1) points.push([-1 + (2 * i) / straightSegments, -1]);
  return points;
}

/** Anel da derivação (raio `radius`) à altura `height` sobre o eixo da passagem. */
export function branchRing(
  side: BranchSide,
  height: number,
  radius: number,
  angles: readonly number[],
): Vec3[] {
  const { d, b } = sideFrame(side);
  return angles.map((angle) =>
    add(
      scale(d, height),
      add(vec3(radius * Math.cos(angle), 0, 0), scale(b, radius * Math.sin(angle))),
    ),
  );
}

/** Curva de interseção da derivação (raio `radius`) com o cilindro de raio `cylinder`. */
export function saddleRing(
  side: BranchSide,
  cylinder: number,
  radius: number,
  angles: readonly number[],
): Vec3[] {
  const { d, b } = sideFrame(side);
  const r = Math.min(radius, cylinder);
  return angles.map((angle) => {
    const lateral = r * Math.sin(angle);
    const height = Math.sqrt(Math.max(0, cylinder * cylinder - lateral * lateral));
    return add(scale(d, height), add(vec3(r * Math.cos(angle), 0, 0), scale(b, lateral)));
  });
}

export interface BranchHole {
  readonly side: BranchSide;
  readonly radius: number;
}

/**
 * Parede cilíndrica de eixo X (raio `cylinder`, x ∈ [−half, half]) com os furos das
 * derivações. `inward` gera a superfície do furo da passagem (normais para o eixo).
 */
export function holedCylinder(
  cylinder: number,
  half: number,
  holes: readonly BranchHole[],
  inward: boolean,
  ringSegments: number,
  straightSegments: number,
): MeshData {
  const sign = inward ? -1 : 1;
  const normalAt = (p: Vec3): Vec3 => vec3(0, sign * p.y, sign * p.z);
  const radialSteps = 4;
  const meshes: MeshData[] = [];

  for (const side of [1, -1] as const) {
    const { d, b } = sideFrame(side);
    const at = (x: number, psi: number): Vec3 =>
      add(
        vec3(x, 0, 0),
        add(scale(d, cylinder * Math.cos(psi)), scale(b, cylinder * Math.sin(psi))),
      );
    const hole = holes.find((h) => h.side === side);
    if (!hole) {
      // Metade sem derivação: grade regular, com as mesmas divisões do contorno.
      const grid: Vec3[][] = [];
      for (let k = 0; k <= straightSegments; k += 1) {
        const x = half - (2 * half * k) / straightSegments;
        const row: Vec3[] = [];
        for (let i = 0; i <= ringSegments / 2; i += 1) {
          row.push(at(x, -Math.PI / 2 + (Math.PI * i) / (ringSegments / 2)));
        }
        grid.push(row);
      }
      meshes.push(patch(grid, normalAt, false));
      continue;
    }
    const r = Math.min(hole.radius, cylinder);
    if (r >= half) throw new Error('A derivação não cabe no trecho da passagem.');
    const grid = boundary(ringSegments, straightSegments).map(([u, v]) => {
      const theta = Math.atan2(v, u);
      const holeX = r * Math.cos(theta);
      const holePsi = Math.asin(Math.min(1, Math.max(-1, (r * Math.sin(theta)) / cylinder)));
      const edgeX = half * u;
      const edgePsi = (v * Math.PI) / 2;
      const row: Vec3[] = [];
      for (let j = 0; j <= radialSteps; j += 1) {
        const t = j / radialSteps;
        row.push(at(holeX + (edgeX - holeX) * t, holePsi + (edgePsi - holePsi) * t));
      }
      return row;
    });
    meshes.push(patch(grid, normalAt, true));
  }
  return mergeMeshes(meshes);
}

/**
 * Número de arestas que não são compartilhadas por exatamente dois triângulos de sentidos
 * opostos, após soldar os vértices coincidentes. Zero = malha fechada e bem orientada.
 */
export function countOpenEdges(mesh: MeshData, tolerance = 2e-6): number {
  const welded = new Map<string, number>();
  const remap: number[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const key = [0, 1, 2]
      .map((k) => Math.round((mesh.positions[i + k] ?? 0) / tolerance))
      .join(',');
    let index = welded.get(key);
    if (index === undefined) {
      index = welded.size;
      welded.set(key, index);
    }
    remap.push(index);
  }
  const edges = new Map<string, number>();
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const a = remap[mesh.indices[t] ?? 0] ?? 0;
    const b = remap[mesh.indices[t + 1] ?? 0] ?? 0;
    const c = remap[mesh.indices[t + 2] ?? 0] ?? 0;
    if (a === b || b === c || a === c) continue;
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      edges.set(`${u}>${v}`, (edges.get(`${u}>${v}`) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const [key, count] of edges) {
    const [u, v] = key.split('>');
    if (count !== 1 || edges.get(`${v}>${u}`) !== 1) open += 1;
  }
  return open;
}
