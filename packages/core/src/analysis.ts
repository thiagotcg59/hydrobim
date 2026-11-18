import { connectionsOfElement, findConnection, getElement, oppositeRef } from './connectivity';
import { add, dot, scale, sub, type Vec3 } from './math';
import { getPorts } from './ports';
import { fail, ok, type Result } from './result';
import type { HydroElement, Pipe, Project, Terrain } from './schema';

/** Análises derivadas do modelo: interferências, terreno e perfil longitudinal. */

// ---------------------------------------------------------------------------
// Interferências entre tubos
// ---------------------------------------------------------------------------

export interface Clash {
  readonly elementIds: readonly [string, string];
  /** Sobreposição das paredes externas (m): raio A + raio B − distância entre eixos. */
  readonly overlap: number;
  /** Ponto médio entre os eixos no local da interferência. */
  readonly point: Vec3;
}

/** Menor distância entre dois segmentos e os pontos mais próximos em cada um. */
export function segmentDistance(
  p1: Vec3,
  q1: Vec3,
  p2: Vec3,
  q2: Vec3,
): { distance: number; a: Vec3; b: Vec3 } {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s = 0;
  let t = 0;
  const clamp = (v: number): number => Math.min(1, Math.max(0, v));
  if (a <= 1e-12 && e <= 1e-12) {
    s = 0;
    t = 0;
  } else if (a <= 1e-12) {
    t = clamp(f / e);
  } else {
    const c = dot(d1, r);
    if (e <= 1e-12) {
      s = clamp(-c / a);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > 1e-12 ? clamp((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a);
      }
    }
  }
  const ca = add(p1, scale(d1, s));
  const cb = add(p2, scale(d2, t));
  const delta = sub(ca, cb);
  return { distance: Math.hypot(delta.x, delta.y, delta.z), a: ca, b: cb };
}

/** Elementos a até `hops` conexões de distância (inclui a origem). */
function neighborhood(project: Project, id: string, hops: number): Set<string> {
  const seen = new Set([id]);
  let frontier = [id];
  for (let i = 0; i < hops; i += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const c of connectionsOfElement(project, current)) {
        const other = c.a.elementId === current ? c.b.elementId : c.a.elementId;
        if (!seen.has(other)) {
          seen.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

/**
 * Detecta tubos cujas paredes externas se interpenetram. Tubos vizinhos na rede (até
 * duas conexões de distância, isto é, unidos por uma mesma peça) são ignorados.
 * Verificação entre eixos de tubos; conexões e equipamentos não são analisados.
 */
export function detectClashes(project: Project, tolerance = 1e-4): Clash[] {
  const pipes = project.elements.filter((e): e is Pipe => e.kind === 'pipe');
  const clashes: Clash[] = [];
  for (let i = 0; i < pipes.length; i += 1) {
    const a = pipes[i];
    if (!a) continue;
    const near = neighborhood(project, a.id, 2);
    for (let j = i + 1; j < pipes.length; j += 1) {
      const b = pipes[j];
      if (!b || near.has(b.id)) continue;
      const result = segmentDistance(a.start, a.end, b.start, b.end);
      const overlap = a.spec.outerDiameter / 2 + b.spec.outerDiameter / 2 - result.distance;
      if (overlap > tolerance) {
        clashes.push({
          elementIds: [a.id, b.id],
          overlap,
          point: scale(add(result.a, result.b), 0.5),
        });
      }
    }
  }
  return clashes.sort((x, y) => y.overlap - x.overlap);
}

// ---------------------------------------------------------------------------
// Terreno (TIN)
// ---------------------------------------------------------------------------

export const MAX_TERRAIN_POINTS = 4000;

/** Lê pontos "X Y Z" (separados por espaço, tabulação, vírgula ou ponto e vírgula). */
export function parseTerrainPoints(text: string): Result<Vec3[]> {
  const points: Vec3[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    // Com `;` ou tabulação como separador, a vírgula é decimal.
    const separator = /[;\t]/.test(line) ? /[;\t]+/ : /[\s,]+/;
    const fields = line
      .split(separator)
      .map((f) => Number(f.trim().replace(',', '.')))
      .filter((n) => !Number.isNaN(n));
    if (fields.length < 3) continue; // cabeçalhos e linhas incompletas
    // Aceita "id X Y Z": usam-se as três últimas colunas numéricas.
    const [x, y, z] = fields.slice(-3) as [number, number, number];
    const key = `${x.toFixed(4)}|${y.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ x, y, z });
  }
  if (points.length < 3) {
    return fail('TERRAIN_TOO_FEW', 'O arquivo precisa de ao menos três pontos "X Y Z" distintos.');
  }
  if (points.length > MAX_TERRAIN_POINTS) {
    return fail(
      'TERRAIN_TOO_MANY',
      `O arquivo tem ${points.length} pontos; o limite atual é ${MAX_TERRAIN_POINTS}. Reduza a densidade do levantamento.`,
    );
  }
  return ok(points);
}

/** Triangulação de Delaunay em planta (Bowyer–Watson). */
export function triangulate(points: readonly Vec3[]): number[] {
  const n = points.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const span = Math.max(maxX - minX, maxY - minY, 1e-9) * 20;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // Super-triângulo (índices n, n+1, n+2).
  const xs = [...points.map((p) => p.x), cx - span, cx, cx + span];
  const ys = [...points.map((p) => p.y), cy - span, cy + span, cy - span];

  interface Triangle {
    a: number;
    b: number;
    c: number;
    x: number;
    y: number;
    r2: number;
  }
  const make = (a: number, b: number, c: number): Triangle | null => {
    const ax = xs[a] as number;
    const ay = ys[a] as number;
    const bx = xs[b] as number;
    const by = ys[b] as number;
    const qx = xs[c] as number;
    const qy = ys[c] as number;
    const d = 2 * (ax * (by - qy) + bx * (qy - ay) + qx * (ay - by));
    if (Math.abs(d) < 1e-14) return null;
    const a2 = ax * ax + ay * ay;
    const b2 = bx * bx + by * by;
    const c2 = qx * qx + qy * qy;
    const x = (a2 * (by - qy) + b2 * (qy - ay) + c2 * (ay - by)) / d;
    const y = (a2 * (qx - bx) + b2 * (ax - qx) + c2 * (bx - ax)) / d;
    return { a, b, c, x, y, r2: (ax - x) ** 2 + (ay - y) ** 2 };
  };

  let triangles: Triangle[] = [];
  const root = make(n, n + 1, n + 2);
  if (root) triangles.push(root);
  for (let i = 0; i < n; i += 1) {
    const px = xs[i] as number;
    const py = ys[i] as number;
    const edges = new Map<string, [number, number]>();
    const kept: Triangle[] = [];
    for (const t of triangles) {
      if ((px - t.x) ** 2 + (py - t.y) ** 2 < t.r2 * (1 + 1e-12)) {
        for (const [u, v] of [
          [t.a, t.b],
          [t.b, t.c],
          [t.c, t.a],
        ] as [number, number][]) {
          const key = u < v ? `${u}|${v}` : `${v}|${u}`;
          // Arestas compartilhadas por dois triângulos removidos são internas.
          if (edges.has(key)) edges.delete(key);
          else edges.set(key, [u, v]);
        }
      } else kept.push(t);
    }
    for (const [u, v] of edges.values()) {
      const t = make(u, v, i);
      if (t) kept.push(t);
    }
    triangles = kept;
  }
  const out: number[] = [];
  for (const t of triangles) {
    if (t.a >= n || t.b >= n || t.c >= n) continue;
    // Orienta em sentido anti-horário (normal para cima).
    const cross =
      ((xs[t.b] as number) - (xs[t.a] as number)) * ((ys[t.c] as number) - (ys[t.a] as number)) -
      ((ys[t.b] as number) - (ys[t.a] as number)) * ((xs[t.c] as number) - (xs[t.a] as number));
    if (cross > 0) out.push(t.a, t.b, t.c);
    else out.push(t.a, t.c, t.b);
  }
  return out;
}

export function createTerrain(name: string, points: readonly Vec3[]): Result<Terrain> {
  const triangles = triangulate(points);
  if (triangles.length === 0) {
    return fail('TERRAIN_DEGENERATE', 'Não foi possível triangular os pontos (são colineares?).');
  }
  return ok({ name, points: [...points], triangles });
}

/** Cota do terreno em (x, y); `null` fora da superfície. */
export function terrainElevationAt(terrain: Terrain, x: number, y: number): number | null {
  const { points, triangles } = terrain;
  for (let i = 0; i < triangles.length; i += 3) {
    const a = points[triangles[i] as number];
    const b = points[triangles[i + 1] as number];
    const c = points[triangles[i + 2] as number];
    if (!a || !b || !c) continue;
    const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(d) < 1e-14) continue;
    const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / d;
    const v = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / d;
    const w = 1 - u - v;
    if (u >= -1e-9 && v >= -1e-9 && w >= -1e-9) return u * a.z + v * b.z + w * c.z;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Perfil longitudinal
// ---------------------------------------------------------------------------

export interface ProfileStation {
  /** Distância acumulada em planta (m). */
  readonly chainage: number;
  readonly position: Vec3;
  /** Cota do eixo da tubulação (m). */
  readonly axisElevation: number;
  /** Cota da geratriz superior externa (m). */
  readonly crownElevation: number;
  /** Cota do terreno (m); `null` sem terreno ou fora dele. */
  readonly groundElevation: number | null;
  /** Recobrimento: terreno − geratriz superior (m). */
  readonly cover: number | null;
  readonly elementId: string;
  readonly elementName: string;
}

export interface Profile {
  readonly stations: ProfileStation[];
  /** Elementos percorridos, na ordem. */
  readonly elementIds: string[];
  readonly length: number;
}

/** Porta pela qual o caminho continua ao entrar em `element` por `inPort`. */
function exitPort(element: HydroElement, inPort: string): string | null {
  const ids = getPorts(element).map((p) => p.ref.portId);
  if (element.kind === 'tee') {
    // Segue pela passagem; entrando pela derivação, o caminho termina.
    return inPort === 'a' ? 'b' : inPort === 'b' ? 'a' : null;
  }
  if (element.kind === 'tank' || element.kind === 'pump') return null;
  return ids.find((id) => id !== inPort) ?? null;
}

/**
 * Perfil longitudinal do caminho que passa pelo elemento indicado, seguindo a rede nos
 * dois sentidos (pela passagem dos tês) até extremidades livres, derivações, bombas ou
 * reservatórios. As distâncias são medidas em planta.
 */
export function buildProfile(
  project: Project,
  elementId: string,
  samplesPerPipe = 8,
): Result<Profile> {
  const origin = getElement(project, elementId);
  if (!origin) return fail('ELEMENT_NOT_FOUND', 'Elemento inexistente.');
  const originPorts = getPorts(origin).map((p) => p.ref.portId);
  const startPort = originPorts[0];
  if (!startPort) return fail('NO_PORTS', 'Elemento sem portas.');

  /** Caminha a partir de `element`, saindo por `outPort`. Devolve [elemento, porta de entrada]. */
  const walk = (from: HydroElement, outPort: string | null): [HydroElement, string][] => {
    const path: [HydroElement, string][] = [];
    const seen = new Set([from.id]);
    let current = from;
    let out = outPort;
    while (out) {
      const connection = findConnection(project, { elementId: current.id, portId: out });
      if (!connection) break;
      const next = oppositeRef(connection, { elementId: current.id, portId: out });
      const element = getElement(project, next.elementId);
      if (!element || seen.has(element.id)) break;
      seen.add(element.id);
      path.push([element, next.portId]);
      current = element;
      out = exitPort(element, next.portId);
    }
    return path;
  };

  const forwardOut = exitPort(origin, startPort) ?? originPorts[1] ?? null;
  const backward = walk(origin, startPort).reverse();
  const forward = walk(origin, forwardOut);
  // Sequência ordenada: [elemento, porta de entrada no sentido do percurso].
  const ordered: [HydroElement, string][] = [
    ...backward.map(([element, inPort]): [HydroElement, string] => [
      element,
      exitPort(element, inPort) ?? inPort,
    ]),
    [origin, startPort],
    ...forward,
  ];

  const stations: ProfileStation[] = [];
  let chainage = 0;
  let previous: Vec3 | null = null;
  const push = (element: HydroElement, position: Vec3): void => {
    if (previous) chainage += Math.hypot(position.x - previous.x, position.y - previous.y);
    previous = position;
    const crown = position.z + element.spec.outerDiameter / 2;
    const ground = project.terrain
      ? terrainElevationAt(project.terrain, position.x, position.y)
      : null;
    stations.push({
      chainage,
      position,
      axisElevation: position.z,
      crownElevation: crown,
      groundElevation: ground,
      cover: ground === null ? null : ground - crown,
      elementId: element.id,
      elementName: element.name,
    });
  };

  for (const [element, inPort] of ordered) {
    const ports = getPorts(element);
    const entry = ports.find((p) => p.ref.portId === inPort);
    const exitId = exitPort(element, inPort);
    const exit = ports.find((p) => p.ref.portId === exitId);
    if (!entry) continue;
    if (element.kind === 'pipe' && exit) {
      for (let i = 0; i <= samplesPerPipe; i += 1) {
        push(
          element,
          add(entry.position, scale(sub(exit.position, entry.position), i / samplesPerPipe)),
        );
      }
    } else {
      push(element, entry.position);
      if (exit) push(element, exit.position);
    }
  }
  if (stations.length < 2) return fail('PROFILE_EMPTY', 'Não há trecho suficiente para o perfil.');
  return ok({ stations, elementIds: ordered.map(([e]) => e.id), length: chainage });
}
