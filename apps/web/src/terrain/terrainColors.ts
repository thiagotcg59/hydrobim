import { terrainContours, terrainStats, type Terrain, type Vec3 } from '@hydrobim/core';
import type { TerrainColorMode } from './terrainStore';

/**
 * Malha de desenho do terreno para o 3D, sem motor gráfico: posições, normais e cores prontas
 * para um `BufferGeometry`. Cada triângulo tem os seus três vértices e a normal do seu plano —
 * um TIN é uma superfície de faces planas, e suavizar as normais esconderia as linhas de
 * quebra e sugeriria um relevo que os dados não descrevem.
 */

type Rgb = readonly [number, number, number];

/** Escala hipsométrica (verde nas cotas baixas, ocre e castanho, cinza-claro no alto). */
const ELEVATION_RAMP: readonly Rgb[] = [
  [0.31, 0.55, 0.36],
  [0.62, 0.74, 0.42],
  [0.89, 0.83, 0.52],
  [0.74, 0.56, 0.36],
  [0.55, 0.4, 0.31],
  [0.9, 0.89, 0.87],
];

/** Classes de declividade (limite superior em m/m) — faixas usuais de aptidão do terreno. */
export const SLOPE_CLASSES: readonly { limit: number; label: string; color: Rgb }[] = [
  { limit: 0.03, label: 'até 3 %', color: [0.36, 0.62, 0.42] },
  { limit: 0.08, label: '3 a 8 %', color: [0.66, 0.78, 0.4] },
  { limit: 0.2, label: '8 a 20 %', color: [0.94, 0.8, 0.36] },
  { limit: 0.45, label: '20 a 45 %', color: [0.91, 0.55, 0.26] },
  { limit: Infinity, label: 'acima de 45 %', color: [0.78, 0.26, 0.22] },
];

export const PLAIN_COLOR: Rgb = [0.5, 0.63, 0.42];

/** Cor da escala hipsométrica para `t` de 0 (cota mínima) a 1 (máxima). */
export function elevationColor(t: number): Rgb {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const scaled = clamped * (ELEVATION_RAMP.length - 1);
  const index = Math.min(ELEVATION_RAMP.length - 2, Math.floor(scaled));
  const f = scaled - index;
  const a = ELEVATION_RAMP[index] as Rgb;
  const b = ELEVATION_RAMP[index + 1] as Rgb;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function slopeColor(slope: number): Rgb {
  return (
    (SLOPE_CLASSES.find((entry) => slope <= entry.limit) ?? SLOPE_CLASSES[4])?.color ?? PLAIN_COLOR
  );
}

export interface TerrainMeshData {
  /**
   * Origem local da malha (coordenadas do projeto): as posições são relativas a ela, para que
   * a placa de vídeo, em precisão simples, não perca os centímetros em coordenadas UTM. A cota
   * da origem é a mínima da superfície: o exagero vertical, quando ligado, parte dela.
   */
  readonly base: Vec3;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly triangleCount: number;
}

export function buildTerrainMesh(terrain: Terrain, colorMode: TerrainColorMode): TerrainMeshData {
  const { points, triangles } = terrain;
  const stats = terrainStats(terrain);
  const base: Vec3 = {
    x: (stats.minX + stats.maxX) / 2,
    y: (stats.minY + stats.maxY) / 2,
    z: stats.minZ,
  };
  const range = Math.max(stats.maxZ - stats.minZ, 1e-9);
  const count = Math.floor(triangles.length / 3);
  const positions = new Float32Array(count * 9);
  const normals = new Float32Array(count * 9);
  const colors = new Float32Array(count * 9);
  let used = 0;
  for (let t = 0; t < count; t += 1) {
    const a = points[triangles[3 * t] as number];
    const b = points[triangles[3 * t + 1] as number];
    const c = points[triangles[3 * t + 2] as number];
    if (!a || !b || !c) continue;
    let nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
    let ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    let nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-12) continue;
    const slope = Math.hypot(nx, ny) / Math.abs(nz || 1e-12);
    nx /= length;
    ny /= length;
    nz /= length;
    const face = colorMode === 'slope' ? slopeColor(slope) : PLAIN_COLOR;
    const corners = [a, b, c];
    for (let k = 0; k < 3; k += 1) {
      const p = corners[k] as Vec3;
      const o = used * 9 + k * 3;
      positions[o] = p.x - base.x;
      positions[o + 1] = p.y - base.y;
      positions[o + 2] = p.z - base.z;
      normals[o] = nx;
      normals[o + 1] = ny;
      normals[o + 2] = nz;
      const color = colorMode === 'elevation' ? elevationColor((p.z - stats.minZ) / range) : face;
      colors[o] = color[0];
      colors[o + 1] = color[1];
      colors[o + 2] = color[2];
    }
    used += 1;
  }
  return {
    base,
    positions: positions.subarray(0, used * 9),
    normals: normals.subarray(0, used * 9),
    colors: colors.subarray(0, used * 9),
    triangleCount: used,
  };
}

/** Arestas únicas da triangulação, como pares de pontos relativos a `base`. */
export function terrainEdges(terrain: Terrain, base: Vec3): Float32Array {
  const { points, triangles } = terrain;
  const seen = new Set<number>();
  const out: number[] = [];
  const edge = (i: number, j: number): void => {
    const key = i < j ? i * points.length + j : j * points.length + i;
    if (seen.has(key)) return;
    seen.add(key);
    const p = points[i];
    const q = points[j];
    if (!p || !q) return;
    out.push(p.x - base.x, p.y - base.y, p.z - base.z, q.x - base.x, q.y - base.y, q.z - base.z);
  };
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const a = triangles[i] as number;
    const b = triangles[i + 1] as number;
    const c = triangles[i + 2] as number;
    edge(a, b);
    edge(b, c);
    edge(c, a);
  }
  return new Float32Array(out);
}

/** Curvas de nível como segmentos 3D relativos a `base`, separadas em comuns e mestras. */
export function contourSegments(
  terrain: Terrain,
  interval: number,
  base: Vec3,
): { minor: Float32Array; major: Float32Array } | null {
  const contours = terrainContours(terrain, interval);
  if (!contours.ok) return null;
  const minor: number[] = [];
  const major: number[] = [];
  for (const contour of contours.value) {
    const target = contour.major ? major : minor;
    const z = contour.elevation - base.z;
    for (const line of contour.lines) {
      for (let i = 1; i < line.length; i += 1) {
        const p = line[i - 1];
        const q = line[i];
        if (!p || !q) continue;
        target.push(p.x - base.x, p.y - base.y, z, q.x - base.x, q.y - base.y, z);
      }
    }
  }
  return { minor: new Float32Array(minor), major: new Float32Array(major) };
}
