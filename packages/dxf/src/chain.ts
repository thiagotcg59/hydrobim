/**
 * Encadeia segmentos soltos em polilinhas.
 *
 * A projeção em planta produz arestas independentes (4 números por segmento). No CAD, um
 * contorno contínuo deve ser uma única polilinha — seleciona-se e edita-se como um objeto —,
 * e não dezenas de linhas. Segmentos que se tocam pelas pontas são unidos enquanto o caminho
 * não se bifurca; vértices intermediários de trechos retos são eliminados. Antes disso, os
 * segmentos colineares sobrepostos são fundidos (`mergeCollinear`).
 */

export interface Chain {
  /** x, y por vértice. */
  readonly points: number[];
  readonly closed: boolean;
}

/** Pontas a menos desta distância (m) são o mesmo vértice. */
const JOIN = 1e-5;
/** Afastamento máximo (m) de um vértice intermediário para o trecho ser considerado reto. */
const STRAIGHT = 2e-6;

/**
 * Funde segmentos colineares que se sobrepõem ou se tocam.
 *
 * A projeção de uma aresta circular vista de perfil (a boca de um tubo, um flange) são
 * vários segmentos sobre a mesma reta, uns por cima dos outros. Sem a fusão, o CAD recebe
 * linhas duplicadas e o contorno do tubo fica partido em pedaços em vez de fechar.
 */
export function mergeCollinear(lines: ArrayLike<number>): number[] {
  interface Segment {
    x: number;
    y: number;
    /** Direção unitária e intervalo [0, length] ao longo dela, a partir de (x, y). */
    dx: number;
    dy: number;
    from: number;
    to: number;
    bucket: number;
  }
  const BUCKETS = 360;
  const source: Segment[] = [];
  for (let i = 0; i + 3 < lines.length; i += 4) {
    const x = lines[i] ?? 0;
    const y = lines[i + 1] ?? 0;
    const ex = (lines[i + 2] ?? 0) - x;
    const ey = (lines[i + 3] ?? 0) - y;
    const length = Math.hypot(ex, ey);
    if (length < JOIN) continue;
    let angle = Math.atan2(ey, ex);
    if (angle < 0) angle += Math.PI;
    const bucket = Math.floor((angle / Math.PI) * BUCKETS) % BUCKETS;
    source.push({ x, y, dx: ex / length, dy: ey / length, from: 0, to: length, bucket });
  }
  // Os mais longos primeiro: a direção deles é a mais precisa e passa a valer para a fusão.
  source.sort((a, b) => b.to - b.from - (a.to - a.from));

  const byBucket = new Map<number, Segment[]>();
  /** Intervalo de `s` sobre a reta de `base`, ou `null` se `s` não está sobre ela. */
  const project = (base: Segment, s: Segment): [number, number] | null => {
    const ends: number[] = [];
    for (const t of [s.from, s.to]) {
      const px = s.x + s.dx * t - base.x;
      const py = s.y + s.dy * t - base.y;
      if (Math.abs(px * base.dy - py * base.dx) > JOIN) return null;
      ends.push(px * base.dx + py * base.dy);
    }
    const [p = 0, q = 0] = ends;
    return p < q ? [p, q] : [q, p];
  };
  /** Segmento já aceito, vizinho em direção, que se sobrepõe a `s` (ou o toca). */
  const host = (s: Segment): Segment | null => {
    for (const offset of [0, -1, 1]) {
      const list = byBucket.get((s.bucket + offset + BUCKETS) % BUCKETS);
      if (!list) continue;
      for (const base of list) {
        if (base === s) continue;
        const span = project(base, s);
        if (!span || span[0] > base.to + JOIN || span[1] < base.from - JOIN) continue;
        base.from = Math.min(base.from, span[0]);
        base.to = Math.max(base.to, span[1]);
        return base;
      }
    }
    return null;
  };
  const accepted = new Set<Segment>();
  for (const s of source) {
    let grown = host(s);
    if (!grown) {
      accepted.add(s);
      const list = byBucket.get(s.bucket);
      if (list) list.push(s);
      else byBucket.set(s.bucket, [s]);
      continue;
    }
    // O segmento que cresceu pode ter alcançado outro já aceito: funde em cadeia.
    for (;;) {
      const next = host(grown);
      if (!next) break;
      accepted.delete(grown);
      const list = byBucket.get(grown.bucket);
      list?.splice(list.indexOf(grown), 1);
      grown = next;
    }
  }
  const out: number[] = [];
  for (const s of accepted) {
    out.push(s.x + s.dx * s.from, s.y + s.dy * s.from, s.x + s.dx * s.to, s.y + s.dy * s.to);
  }
  return out;
}

export function chainSegments(segments: ArrayLike<number>): Chain[] {
  const lines = mergeCollinear(segments);
  const total = Math.floor(lines.length / 4);
  const nodes = new Map<string, number[]>();
  // Vértices: pontas a menos de JOIN umas das outras, procuradas nas células vizinhas.
  const cells = new Map<string, { key: string; x: number; y: number }[]>();
  const keyOf = (x: number, y: number): string => {
    const cx = Math.floor(x / (JOIN * 2));
    const cy = Math.floor(y / (JOIN * 2));
    for (let ix = cx - 1; ix <= cx + 1; ix += 1) {
      for (let iy = cy - 1; iy <= cy + 1; iy += 1) {
        for (const node of cells.get(`${ix},${iy}`) ?? []) {
          if (Math.hypot(node.x - x, node.y - y) <= JOIN) return node.key;
        }
      }
    }
    const cell = `${cx},${cy}`;
    const node = { key: `${x},${y}`, x, y };
    const list = cells.get(cell);
    if (list) list.push(node);
    else cells.set(cell, [node]);
    return node.key;
  };
  const ends: [string, string][] = [];
  for (let i = 0; i < total; i += 1) {
    const from = keyOf(lines[i * 4] ?? 0, lines[i * 4 + 1] ?? 0);
    const to = keyOf(lines[i * 4 + 2] ?? 0, lines[i * 4 + 3] ?? 0);
    ends.push([from, to]);
    if (from === to) continue; // segmento degenerado
    for (const key of [from, to]) {
      const list = nodes.get(key);
      if (list) list.push(i);
      else nodes.set(key, [i]);
    }
  }

  const used = new Uint8Array(total);
  const chains: Chain[] = [];
  /** Segue o caminho a partir de `node` pelo segmento `first`, até uma ponta ou bifurcação. */
  const walk = (node: string, first: number): Chain => {
    const points: number[] = [];
    let current = node;
    let segment: number | undefined = first;
    let closed = false;
    while (segment !== undefined) {
      used[segment] = 1;
      const forward = ends[segment]?.[0] === current;
      const base = segment * 4;
      if (points.length === 0) {
        points.push(lines[base + (forward ? 0 : 2)] ?? 0, lines[base + (forward ? 1 : 3)] ?? 0);
      }
      points.push(lines[base + (forward ? 2 : 0)] ?? 0, lines[base + (forward ? 3 : 1)] ?? 0);
      current = ends[segment]?.[forward ? 1 : 0] ?? current;
      if (current === node) {
        closed = true;
        break;
      }
      const around: number[] = nodes.get(current) ?? [];
      segment = around.length === 2 ? around.find((s) => !used[s]) : undefined;
    }
    if (closed) points.length -= 2; // o último vértice repete o primeiro
    return { points: simplify(points, closed), closed };
  };

  // Primeiro os caminhos abertos (começam em pontas e bifurcações), depois os anéis.
  for (const [key, around] of nodes) {
    if (around.length === 2) continue;
    for (const segment of around) if (!used[segment]) chains.push(walk(key, segment));
  }
  for (const [key, around] of nodes) {
    for (const segment of around) if (!used[segment]) chains.push(walk(key, segment));
  }
  return chains.filter((chain) => chain.points.length >= 4);
}

/** Remove os vértices intermediários de trechos retos. */
function simplify(points: number[], closed: boolean): number[] {
  const count = points.length / 2;
  if (count < 3) return points;
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (!closed && (i === 0 || i === count - 1)) {
      out.push(points[i * 2] ?? 0, points[i * 2 + 1] ?? 0);
      continue;
    }
    const x = points[i * 2] ?? 0;
    const y = points[i * 2 + 1] ?? 0;
    // Vizinho anterior já aceito (ou o último, em um anel) e o próximo do traçado original.
    const hasPrevious = out.length >= 2;
    const px = hasPrevious ? (out[out.length - 2] ?? 0) : (points[(count - 1) * 2] ?? 0);
    const py = hasPrevious ? (out[out.length - 1] ?? 0) : (points[(count - 1) * 2 + 1] ?? 0);
    const next = (i + 1) % count;
    const nx = points[next * 2] ?? 0;
    const ny = points[next * 2 + 1] ?? 0;
    const span = Math.hypot(nx - px, ny - py);
    const forward = (x - px) * (nx - x) + (y - py) * (ny - y) > 0;
    const offset =
      span < 1e-12 ? Infinity : Math.abs((x - px) * (ny - py) - (y - py) * (nx - px)) / span;
    if (forward && offset < STRAIGHT) continue;
    out.push(x, y);
  }
  return out.length >= 4 ? out : points;
}
