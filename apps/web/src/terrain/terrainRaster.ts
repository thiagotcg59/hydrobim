import { terrainStats, type Terrain } from '@hydrobim/core';
import { elevationColor, PLAIN_COLOR, slopeColor } from './terrainColors';
import type { TerrainColorMode } from './terrainStore';

/**
 * Superfície do terreno em planta, sem motor gráfico nem DOM: o contorno da área triangulada
 * e a imagem das faces com as MESMAS cores do modelo 3D (altitude, declividade ou lisa). A
 * planta desenha essa imagem recortada pelo contorno, de modo que o que se vê em planta é o
 * que se vê no 3D olhado de cima.
 */

type Mesh = Pick<Terrain, 'points' | 'triangles'>;

/**
 * Contornos da área triangulada, como anéis de índices de vértices: as arestas que pertencem a
 * um só triângulo, encadeadas. O contorno externo sai em sentido anti-horário e os furos
 * (lacunas do dado, furos do limite) em sentido horário, como os triângulos que os cercam.
 */
export function terrainBoundaryLoops(terrain: Mesh): number[][] {
  const { points, triangles } = terrain;
  const count = points.length;
  const directed = new Set<number>();
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    for (let e = 0; e < 3; e += 1) {
      const from = triangles[i + e] as number;
      const to = triangles[i + ((e + 1) % 3)] as number;
      directed.add(from * count + to);
    }
  }
  // Aresta de contorno: percorrida em um sentido só.
  const next = new Map<number, number[]>();
  for (const key of directed) {
    const from = Math.floor(key / count);
    const to = key % count;
    if (directed.has(to * count + from)) continue;
    const list = next.get(from);
    if (list) list.push(to);
    else next.set(from, [to]);
  }
  const loops: number[][] = [];
  for (const start of next.keys()) {
    // Um vértice tocado por dois contornos tem mais de uma saída: cada uma abre um anel.
    while ((next.get(start)?.length ?? 0) > 0) {
      const loop: number[] = [];
      let current = start;
      for (;;) {
        const target = next.get(current)?.pop();
        if (target === undefined) break;
        loop.push(current);
        current = target;
        if (current === start) break;
      }
      if (loop.length >= 3 && current === start) loops.push(loop);
    }
  }
  return loops;
}

const loopCache = new WeakMap<Mesh, number[][]>();

const n = (value: number): string => (Math.round(value * 1e3) / 1e3).toString();

/**
 * Contorno da área triangulada como caminho SVG da planta (coordenadas do projeto menos a
 * origem de desenho, eixo Y invertido). Com a regra par-ímpar, os furos ficam vazados.
 */
export function terrainFootprintPath(
  terrain: Mesh,
  origin: { readonly x: number; readonly y: number },
): string {
  let loops = loopCache.get(terrain);
  if (!loops) {
    loops = terrainBoundaryLoops(terrain);
    loopCache.set(terrain, loops);
  }
  const parts: string[] = [];
  for (const loop of loops) {
    let d = '';
    for (const index of loop) {
      const p = terrain.points[index];
      if (p) d += `${d ? 'L' : 'M'}${n(p.x - origin.x)} ${n(-(p.y - origin.y))}`;
    }
    if (d) parts.push(`${d}Z`);
  }
  return parts.join('');
}

export interface TerrainRaster {
  readonly width: number;
  readonly height: number;
  /** RGBA, linha a linha a partir do norte; alfa 0 fora da superfície. */
  readonly data: Uint8ClampedArray;
  /** Retângulo do modelo (m) coberto pela imagem. */
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Lado maior da imagem, em pixels: nítida no enquadramento do terreno sem pesar no navegador. */
export const TERRAIN_RASTER_SIZE = 1536;

const byte = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255);

/**
 * Imagem das faces da superfície vista de cima. Por altitude, a cor de cada pixel é a da cota
 * interpolada no plano do triângulo (a mesma interpolação entre vértices do modelo 3D); por
 * declividade e lisa, a cor é a da face. `null` quando a superfície não tem extensão.
 */
export function rasterizeTerrain(
  terrain: Terrain,
  colorMode: TerrainColorMode,
  maxSize = TERRAIN_RASTER_SIZE,
): TerrainRaster | null {
  const { points, triangles } = terrain;
  const stats = terrainStats(terrain);
  const spanX = stats.maxX - stats.minX;
  const spanY = stats.maxY - stats.minY;
  if (!(spanX > 0) || !(spanY > 0) || triangles.length < 3) return null;
  /** Pixels por metro, igual nas duas direções. */
  const scale = maxSize / Math.max(spanX, spanY);
  const width = Math.max(1, Math.ceil(spanX * scale));
  const height = Math.max(1, Math.ceil(spanY * scale));
  const data = new Uint8ClampedArray(width * height * 4);

  // Escala hipsométrica amostrada: evita recalcular a cor em cada pixel.
  const ramp = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i += 1) {
    const color = elevationColor(i / 255);
    ramp[3 * i] = byte(color[0]);
    ramp[3 * i + 1] = byte(color[1]);
    ramp[3 * i + 2] = byte(color[2]);
  }
  const range = Math.max(stats.maxZ - stats.minZ, 1e-9);
  // Tolerância nas arestas: o pixel sobre a aresta comum é pintado pelos dois triângulos, e
  // nenhum fica sem cor entre eles.
  const EPS = 1e-7;

  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const a = points[triangles[t] as number];
    const b = points[triangles[t + 1] as number];
    const c = points[triangles[t + 2] as number];
    if (!a || !b || !c) continue;
    // Posições em pixels, com a linha crescendo para o sul.
    const ax = (a.x - stats.minX) * scale;
    const ay = (stats.maxY - a.y) * scale;
    const bx = (b.x - stats.minX) * scale;
    const by = (stats.maxY - b.y) * scale;
    const cx = (c.x - stats.minX) * scale;
    const cy = (stats.maxY - c.y) * scale;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;

    let face: readonly [number, number, number] = PLAIN_COLOR;
    if (colorMode === 'slope') {
      const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
      const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
      const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      face = slopeColor(Math.hypot(nx, ny) / Math.abs(nz || 1e-12));
    }
    const fr = byte(face[0]);
    const fg = byte(face[1]);
    const fb = byte(face[2]);

    const i0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 0.5));
    const i1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx) - 0.5));
    const j0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 0.5));
    const j1 = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy) - 0.5));
    for (let j = j0; j <= j1; j += 1) {
      const py = j + 0.5;
      for (let i = i0; i <= i1; i += 1) {
        const px = i + 0.5;
        const wa = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
        const wb = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        const wc = 1 - wa - wb;
        if (wa < -EPS || wb < -EPS || wc < -EPS) continue;
        const o = (j * width + i) * 4;
        if (colorMode === 'elevation') {
          const z = wa * a.z + wb * b.z + wc * c.z;
          const k = 3 * Math.round(Math.min(1, Math.max(0, (z - stats.minZ) / range)) * 255);
          data[o] = ramp[k] as number;
          data[o + 1] = ramp[k + 1] as number;
          data[o + 2] = ramp[k + 2] as number;
        } else {
          data[o] = fr;
          data[o + 1] = fg;
          data[o + 2] = fb;
        }
        data[o + 3] = 255;
      }
    }
  }

  // A imagem é recortada pelo contorno exato: os pixels da borda cujo centro ficou fora ganham
  // a cor do vizinho, para não sobrar uma franja sem cor junto ao contorno.
  const fringe: number[] = [];
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      const o = (j * width + i) * 4;
      if (data[o + 3] !== 0) continue;
      const neighbor =
        i > 0 && data[o - 1] !== 0
          ? o - 4
          : i < width - 1 && data[o + 7] !== 0
            ? o + 4
            : j > 0 && data[o - width * 4 + 3] !== 0
              ? o - width * 4
              : j < height - 1 && data[o + width * 4 + 3] !== 0
                ? o + width * 4
                : -1;
      if (neighbor >= 0) fringe.push(o, neighbor);
    }
  }
  for (let k = 0; k < fringe.length; k += 2) {
    const o = fringe[k] as number;
    const from = fringe[k + 1] as number;
    data[o] = data[from] as number;
    data[o + 1] = data[from + 1] as number;
    data[o + 2] = data[from + 2] as number;
    data[o + 3] = 255;
  }

  return {
    width,
    height,
    data,
    minX: stats.minX,
    maxY: stats.maxY,
    maxX: stats.minX + width / scale,
    minY: stats.maxY - height / scale,
  };
}
