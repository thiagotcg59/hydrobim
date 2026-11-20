/**
 * Triangulação de Delaunay com restrições (CDT) em planta.
 *
 * Inserção incremental com trocas de aresta (Lawson) e recuperação das arestas obrigatórias
 * pelo método de Sloan. As arestas obrigatórias são de dois tipos: limite (contorno externo e
 * furos) e linha de quebra. Depois de todas inseridas, os triângulos são classificados por
 * paridade a partir do exterior: só ficam os que estão dentro do limite e fora dos furos — é
 * isso que impede triângulos atravessando uma reentrância do polígono.
 *
 * Só matemática: não conhece cotas, projeto nem unidades.
 */

export const EDGE_BOUNDARY = 1;
export const EDGE_BREAKLINE = 2;

export interface ConstraintEdge {
  readonly a: number;
  readonly b: number;
  readonly kind: typeof EDGE_BOUNDARY | typeof EDGE_BREAKLINE;
}

/** Aresta obrigatória que não pôde ser inserida por cruzar outra já fixada. */
export interface ConstraintConflict {
  readonly a: number;
  readonly b: number;
  /** Tipo da aresta que não entrou. */
  readonly kind: number;
  /** Tipo da aresta fixada que ela cruza (0 = falha numérica, sem aresta identificada). */
  readonly crossedKind: number;
  /** Ponto aproximado do cruzamento, nas coordenadas de entrada. */
  readonly x: number;
  readonly y: number;
}

export interface CdtResult {
  /** Índices dos pontos de entrada, três por triângulo, em sentido anti-horário. */
  readonly triangles: number[];
  /** `alias[i]` = ponto que representa `i` (pontos coincidentes são fundidos). */
  readonly alias: Int32Array;
  readonly conflicts: ConstraintConflict[];
}

/**
 * Triangula os pontos respeitando as arestas obrigatórias. Sem nenhuma aresta de limite, o
 * limite é a envoltória convexa dos pontos.
 */
export function constrainedDelaunay(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  constraints: readonly ConstraintEdge[] = [],
): CdtResult {
  const n = xs.length;
  const alias = new Int32Array(n);
  for (let i = 0; i < n; i += 1) alias[i] = i;
  if (n < 3) return { triangles: [], alias, conflicts: [] };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const x = xs[i] as number;
    const y = ys[i] as number;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  // Coordenadas relativas ao centro: os produtos das contas ficam pequenos mesmo em UTM.
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const span = Math.max(maxX - minX, maxY - minY, 1e-9);
  const px = new Float64Array(n + 3);
  const py = new Float64Array(n + 3);
  for (let i = 0; i < n; i += 1) {
    px[i] = (xs[i] as number) - cx;
    py[i] = (ys[i] as number) - cy;
  }
  // Super-triângulo (vértices n, n+1, n+2), anti-horário.
  const R = span * 20;
  px[n] = -4 * R;
  py[n] = -3 * R;
  px[n + 1] = 4 * R;
  py[n + 1] = -3 * R;
  px[n + 2] = 0;
  py[n + 2] = 4 * R;

  /** Distância (nas unidades de entrada) abaixo da qual um ponto está "sobre" uma aresta. */
  const tolDist = span * 1e-9;
  const dupTol2 = tolDist * tolDist;

  // Triângulo t: vértices tv[3t..], vizinho pela aresta i (v[i] → v[i+1]) em ta[3t+i] e
  // marca de aresta obrigatória em tf[3t+i].
  const tv: number[] = [n, n + 1, n + 2];
  const ta: number[] = [-1, -1, -1];
  const tf: number[] = [0, 0, 0];
  const vertTri = new Int32Array(n + 3).fill(-1);
  vertTri[n] = 0;
  vertTri[n + 1] = 0;
  vertTri[n + 2] = 0;

  const orient = (a: number, b: number, x: number, y: number): number =>
    ((px[b] as number) - (px[a] as number)) * (y - (py[a] as number)) -
    ((py[b] as number) - (py[a] as number)) * (x - (px[a] as number));
  const orientV = (a: number, b: number, c: number): number =>
    orient(a, b, px[c] as number, py[c] as number);
  const edgeLength = (a: number, b: number): number =>
    Math.hypot((px[b] as number) - (px[a] as number), (py[b] as number) - (py[a] as number));

  /** Positivo quando `d` está dentro do círculo de (a, b, c) anti-horário, além da tolerância. */
  const inCircle = (a: number, b: number, c: number, d: number): boolean => {
    const dx = px[d] as number;
    const dy = py[d] as number;
    const adx = (px[a] as number) - dx;
    const ady = (py[a] as number) - dy;
    const bdx = (px[b] as number) - dx;
    const bdy = (py[b] as number) - dy;
    const cdx = (px[c] as number) - dx;
    const cdy = (py[c] as number) - dy;
    const al = adx * adx + ady * ady;
    const bl = bdx * bdx + bdy * bdy;
    const cl = cdx * cdx + cdy * cdy;
    const det =
      al * (bdx * cdy - cdx * bdy) + bl * (cdx * ady - adx * cdy) + cl * (adx * bdy - bdx * ady);
    // Tolerância relativa: pontos cocirculares (malhas regulares de DEM) não entram em ciclo
    // de trocas por ruído de arredondamento.
    const bound =
      al * (Math.abs(bdx * cdy) + Math.abs(cdx * bdy)) +
      bl * (Math.abs(cdx * ady) + Math.abs(adx * cdy)) +
      cl * (Math.abs(adx * bdy) + Math.abs(bdx * ady));
    return det > 1e-12 * bound;
  };

  const indexOf = (t: number, v: number): number =>
    tv[3 * t] === v ? 0 : tv[3 * t + 1] === v ? 1 : tv[3 * t + 2] === v ? 2 : -1;

  const replaceAdj = (t: number, from: number, to: number): void => {
    if (t < 0) return;
    for (let k = 0; k < 3; k += 1) {
      if (ta[3 * t + k] === from) {
        ta[3 * t + k] = to;
        return;
      }
    }
  };

  /** Índice, em `u`, da aresta b → a (a gêmea de a → b). */
  const twinIndex = (u: number, a: number, b: number): number => {
    for (let j = 0; j < 3; j += 1) {
      if (tv[3 * u + j] === b && tv[3 * u + ((j + 1) % 3)] === a) return j;
    }
    return -1;
  };

  /**
   * Troca a diagonal a–b (aresta `i` de `t`, vizinho `u` pela aresta `j`) por p–d. Depois da
   * troca, `t` = (a, d, p) e `u` = (d, b, p): a aresta 0 de cada um é a oposta a `p`.
   */
  const flip = (t: number, i: number, u: number, j: number): void => {
    const a = tv[3 * t + i] as number;
    const b = tv[3 * t + ((i + 1) % 3)] as number;
    const p = tv[3 * t + ((i + 2) % 3)] as number;
    const d = tv[3 * u + ((j + 2) % 3)] as number;
    const nBp = ta[3 * t + ((i + 1) % 3)] as number;
    const fBp = tf[3 * t + ((i + 1) % 3)] as number;
    const nPa = ta[3 * t + ((i + 2) % 3)] as number;
    const fPa = tf[3 * t + ((i + 2) % 3)] as number;
    const nAd = ta[3 * u + ((j + 1) % 3)] as number;
    const fAd = tf[3 * u + ((j + 1) % 3)] as number;
    const nDb = ta[3 * u + ((j + 2) % 3)] as number;
    const fDb = tf[3 * u + ((j + 2) % 3)] as number;
    tv[3 * t] = a;
    tv[3 * t + 1] = d;
    tv[3 * t + 2] = p;
    ta[3 * t] = nAd;
    ta[3 * t + 1] = u;
    ta[3 * t + 2] = nPa;
    tf[3 * t] = fAd;
    tf[3 * t + 1] = 0;
    tf[3 * t + 2] = fPa;
    tv[3 * u] = d;
    tv[3 * u + 1] = b;
    tv[3 * u + 2] = p;
    ta[3 * u] = nDb;
    ta[3 * u + 1] = nBp;
    ta[3 * u + 2] = t;
    tf[3 * u] = fDb;
    tf[3 * u + 1] = fBp;
    tf[3 * u + 2] = 0;
    replaceAdj(nAd, u, t);
    replaceAdj(nBp, t, u);
    vertTri[a] = t;
    vertTri[d] = t;
    vertTri[p] = t;
    vertTri[b] = u;
  };

  /** Restaura Delaunay a partir de triângulos cuja aresta 0 é a oposta ao ponto inserido. */
  const stack: number[] = [];
  const legalize = (): void => {
    // Cada troca melhora a triangulação e o processo termina; a guarda existe para que um
    // erro de arredondamento nunca vire um laço sem fim.
    for (let guard = tv.length * 4 + 64; stack.length > 0 && guard > 0; guard -= 1) {
      const t = stack.pop() as number;
      if (tf[3 * t] !== 0) continue;
      const u = ta[3 * t] as number;
      if (u < 0) continue;
      const a = tv[3 * t] as number;
      const b = tv[3 * t + 1] as number;
      const p = tv[3 * t + 2] as number;
      const j = twinIndex(u, a, b);
      if (j < 0) continue;
      const d = tv[3 * u + ((j + 2) % 3)] as number;
      if (inCircle(a, b, p, d)) {
        flip(t, 0, u, j);
        stack.push(t, u);
      }
    }
  };

  /** Triângulo que contém (x, y), caminhando a partir de `start`. */
  const locate = (x: number, y: number, start: number): number => {
    let t = start;
    const limit = tv.length / 3 + 64;
    for (let guard = 0; guard < limit; guard += 1) {
      let moved = false;
      for (let k = 0; k < 3; k += 1) {
        const i = (k + guard) % 3;
        const a = tv[3 * t + i] as number;
        const b = tv[3 * t + ((i + 1) % 3)] as number;
        if (orient(a, b, x, y) < -tolDist * edgeLength(a, b)) {
          const u = ta[3 * t + i] as number;
          if (u >= 0) {
            t = u;
            moved = true;
            break;
          }
        }
      }
      if (!moved) return t;
    }
    // Caminhada sem fim (configuração degenerada): busca direta.
    const count = tv.length / 3;
    for (let s = 0; s < count; s += 1) {
      let inside = true;
      for (let i = 0; i < 3 && inside; i += 1) {
        const a = tv[3 * s + i] as number;
        const b = tv[3 * s + ((i + 1) % 3)] as number;
        if (orient(a, b, x, y) < -tolDist * edgeLength(a, b)) inside = false;
      }
      if (inside) return s;
    }
    return -1;
  };

  let last = 0;
  const insert = (p: number): void => {
    const x = px[p] as number;
    const y = py[p] as number;
    const t = locate(x, y, last);
    if (t < 0) return;
    last = t;
    // Coincide com um vértice existente: fundido.
    for (let k = 0; k < 3; k += 1) {
      const v = tv[3 * t + k] as number;
      const dx = (px[v] as number) - x;
      const dy = (py[v] as number) - y;
      if (dx * dx + dy * dy <= dupTol2 && v < n) {
        alias[p] = v;
        return;
      }
    }
    // Aresta sobre a qual o ponto está (a mais próxima, dentro da tolerância).
    let onEdge = -1;
    let nearest = Infinity;
    for (let i = 0; i < 3; i += 1) {
      const a = tv[3 * t + i] as number;
      const b = tv[3 * t + ((i + 1) % 3)] as number;
      const length = edgeLength(a, b);
      const gap = length > 0 ? orient(a, b, x, y) / length : Infinity;
      if (gap <= tolDist && gap < nearest) {
        nearest = gap;
        onEdge = i;
      }
    }
    const u = onEdge >= 0 ? (ta[3 * t + onEdge] as number) : -1;
    if (onEdge >= 0 && u >= 0) {
      // Ponto sobre a aresta a–b: os dois triângulos viram quatro e a aresta, se obrigatória,
      // continua obrigatória nas duas metades.
      const i = onEdge;
      const a = tv[3 * t + i] as number;
      const b = tv[3 * t + ((i + 1) % 3)] as number;
      const c = tv[3 * t + ((i + 2) % 3)] as number;
      const j = twinIndex(u, a, b);
      const d = tv[3 * u + ((j + 2) % 3)] as number;
      const fAb = tf[3 * t + i] as number;
      const nBc = ta[3 * t + ((i + 1) % 3)] as number;
      const fBc = tf[3 * t + ((i + 1) % 3)] as number;
      const nCa = ta[3 * t + ((i + 2) % 3)] as number;
      const fCa = tf[3 * t + ((i + 2) % 3)] as number;
      const nAd = ta[3 * u + ((j + 1) % 3)] as number;
      const fAd = tf[3 * u + ((j + 1) % 3)] as number;
      const nDb = ta[3 * u + ((j + 2) % 3)] as number;
      const fDb = tf[3 * u + ((j + 2) % 3)] as number;
      const A = t;
      const B = tv.length / 3;
      const C = u;
      const D = B + 1;
      tv[3 * A] = c;
      tv[3 * A + 1] = a;
      tv[3 * A + 2] = p;
      ta[3 * A] = nCa;
      ta[3 * A + 1] = D;
      ta[3 * A + 2] = B;
      tf[3 * A] = fCa;
      tf[3 * A + 1] = fAb;
      tf[3 * A + 2] = 0;
      tv.push(b, c, p);
      ta.push(nBc, A, C);
      tf.push(fBc, 0, fAb);
      tv[3 * C] = d;
      tv[3 * C + 1] = b;
      tv[3 * C + 2] = p;
      ta[3 * C] = nDb;
      ta[3 * C + 1] = B;
      ta[3 * C + 2] = D;
      tf[3 * C] = fDb;
      tf[3 * C + 1] = fAb;
      tf[3 * C + 2] = 0;
      tv.push(a, d, p);
      ta.push(nAd, C, A);
      tf.push(fAd, 0, fAb);
      replaceAdj(nBc, t, B);
      replaceAdj(nAd, u, D);
      vertTri[a] = A;
      vertTri[b] = B;
      vertTri[c] = A;
      vertTri[d] = C;
      vertTri[p] = A;
      stack.push(A, B, C, D);
    } else {
      const a = tv[3 * t] as number;
      const b = tv[3 * t + 1] as number;
      const c = tv[3 * t + 2] as number;
      const n1 = ta[3 * t + 1] as number;
      const f1 = tf[3 * t + 1] as number;
      const n2 = ta[3 * t + 2] as number;
      const f2 = tf[3 * t + 2] as number;
      const T1 = tv.length / 3;
      const T2 = T1 + 1;
      tv[3 * t + 2] = p;
      ta[3 * t + 1] = T1;
      ta[3 * t + 2] = T2;
      tf[3 * t + 1] = 0;
      tf[3 * t + 2] = 0;
      tv.push(b, c, p);
      ta.push(n1, T2, t);
      tf.push(f1, 0, 0);
      tv.push(c, a, p);
      ta.push(n2, t, T1);
      tf.push(f2, 0, 0);
      replaceAdj(n1, t, T1);
      replaceAdj(n2, t, T2);
      vertTri[a] = t;
      vertTri[b] = t;
      vertTri[c] = T1;
      vertTri[p] = t;
      stack.push(t, T1, T2);
    }
    legalize();
  };

  // Ordem de inserção em serpentina sobre uma grade: pontos vizinhos entram em sequência e a
  // localização caminha poucos triângulos.
  const grid = Math.max(1, Math.ceil(Math.sqrt(n / 2)));
  const keys = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const col = Math.min(grid - 1, Math.floor((((px[i] as number) + span / 2) / span) * grid));
    const row = Math.min(grid - 1, Math.floor((((py[i] as number) + span / 2) / span) * grid));
    keys[i] = row * grid + (row % 2 === 0 ? col : grid - 1 - col);
  }
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => (keys[a] as number) - (keys[b] as number) || a - b,
  );
  for (const p of order) insert(p);

  /**
   * Triângulo e índice da aresta dirigida a → b. A busca gira em torno de um vértice; em torno
   * de um vértice do super-triângulo o giro não é completo, por isso tenta-se também pelo
   * outro extremo (devolvendo a aresta gêmea convertida).
   */
  const findEdge = (a: number, b: number): [number, number] | null => {
    const direct = findEdgeFrom(a, b);
    if (direct) return direct;
    const reverse = findEdgeFrom(b, a);
    if (!reverse) return null;
    const u = ta[3 * reverse[0] + reverse[1]] as number;
    if (u < 0) return null;
    const j = twinIndex(u, b, a);
    return j < 0 ? null : [u, j];
  };
  const findEdgeFrom = (a: number, b: number): [number, number] | null => {
    const start = vertTri[a] as number;
    if (start < 0) return null;
    let t = start;
    const limit = tv.length / 3 + 8;
    for (let guard = 0; guard < limit; guard += 1) {
      const k = indexOf(t, a);
      if (k < 0) return null;
      if (tv[3 * t + ((k + 1) % 3)] === b) return [t, k];
      t = ta[3 * t + ((k + 2) % 3)] as number;
      if (t < 0 || t === start) return null;
    }
    return null;
  };

  const markEdge = (t: number, i: number, kind: number): void => {
    tf[3 * t + i] = (tf[3 * t + i] as number) | kind;
    const u = ta[3 * t + i] as number;
    if (u < 0) return;
    const j = twinIndex(u, tv[3 * t + i] as number, tv[3 * t + ((i + 1) % 3)] as number);
    if (j >= 0) tf[3 * u + j] = (tf[3 * u + j] as number) | kind;
  };

  const conflicts: ConstraintConflict[] = [];
  const conflict = (a: number, b: number, kind: number, crossedKind: number, v: number): void => {
    conflicts.push({
      a,
      b,
      kind,
      crossedKind,
      x: (v >= 0 ? (px[v] as number) : ((px[a] as number) + (px[b] as number)) / 2) + cx,
      y: (v >= 0 ? (py[v] as number) : ((py[a] as number) + (py[b] as number)) / 2) + cy,
    });
  };

  /** Insere a aresta obrigatória a–b (método de Sloan). */
  const insertConstraint = (from: number, to: number, kind: number): void => {
    let a = from;
    const b = to;
    for (let outer = 0; a !== b && outer < n + 8; outer += 1) {
      const start = vertTri[a] as number;
      if (start < 0) return conflict(a, b, kind, 0, -1);
      const abLength = edgeLength(a, b);
      const tol = tolDist * abLength;
      let t = start;
      let crossT = -1;
      let crossE = -1;
      let advanced = false;
      const around = tv.length / 3 + 8;
      for (let guard = 0; guard < around; guard += 1) {
        const k = indexOf(t, a);
        if (k < 0) break;
        const v1 = tv[3 * t + ((k + 1) % 3)] as number;
        const v2 = tv[3 * t + ((k + 2) % 3)] as number;
        if (v1 === b) {
          markEdge(t, k, kind);
          return;
        }
        const o1 = orientV(a, b, v1);
        const dot1 =
          ((px[v1] as number) - (px[a] as number)) * ((px[b] as number) - (px[a] as number)) +
          ((py[v1] as number) - (py[a] as number)) * ((py[b] as number) - (py[a] as number));
        if (Math.abs(o1) <= tol && dot1 > 0 && v1 < n) {
          // Vértice sobre o segmento: a aresta obrigatória passa por ele.
          markEdge(t, k, kind);
          a = v1;
          advanced = true;
          break;
        }
        if (o1 < -tol && orientV(a, b, v2) > tol) {
          crossT = t;
          crossE = (k + 1) % 3;
          break;
        }
        t = ta[3 * t + ((k + 2) % 3)] as number;
        if (t < 0 || t === start) break;
      }
      if (advanced) continue;
      if (crossT < 0) return conflict(a, b, kind, 0, -1);

      // Arestas atravessadas pelo segmento, da origem ao destino.
      const crossed: [number, number][] = [];
      let target = b;
      let tt = crossT;
      let e = crossE;
      let r = tv[3 * tt + e] as number;
      let l = tv[3 * tt + ((e + 1) % 3)] as number;
      let failed = false;
      for (let guard = 0; guard < tv.length; guard += 1) {
        const fixed = tf[3 * tt + e] as number;
        if (fixed !== 0) {
          conflict(a, b, kind, fixed, r);
          failed = true;
          break;
        }
        crossed.push([r, l]);
        const u = ta[3 * tt + e] as number;
        if (u < 0) {
          conflict(a, b, kind, 0, -1);
          failed = true;
          break;
        }
        const j = twinIndex(u, r, l);
        const w = tv[3 * u + ((j + 2) % 3)] as number;
        if (w === b) break;
        const ow = orientV(a, b, w);
        if (Math.abs(ow) <= tol && w < n) {
          target = w;
          break;
        }
        tt = u;
        if (ow > 0) {
          e = (j + 1) % 3;
          l = w;
        } else {
          e = (j + 2) % 3;
          r = w;
        }
      }
      if (failed) return;

      // Troca as diagonais atravessadas até a aresta a–target existir.
      const created: [number, number][] = [];
      let stall = 0;
      while (crossed.length > 0) {
        const [p0, q0] = crossed.shift() as [number, number];
        const found = findEdge(p0, q0);
        if (!found) continue;
        const [ft, fi] = found;
        const fu = ta[3 * ft + fi] as number;
        if (fu < 0) continue;
        const fj = twinIndex(fu, p0, q0);
        const p = tv[3 * ft + ((fi + 2) % 3)] as number;
        const q = tv[3 * fu + ((fj + 2) % 3)] as number;
        const pq = tolDist * edgeLength(p, q);
        const s1 = orientV(p, q, p0);
        const s2 = orientV(p, q, q0);
        const convex = (s1 > pq && s2 < -pq) || (s1 < -pq && s2 > pq);
        if (!convex) {
          crossed.push([p0, q0]);
          stall += 1;
          if (stall > crossed.length * 4 + 16) {
            conflict(a, target, kind, 0, -1);
            return;
          }
          continue;
        }
        stall = 0;
        flip(ft, fi, fu, fj);
        const sp = orientV(a, target, p);
        const sq = orientV(a, target, q);
        const still =
          p !== a &&
          p !== target &&
          q !== a &&
          q !== target &&
          ((sp > tol && sq < -tol) || (sp < -tol && sq > tol));
        if (still) crossed.push([p, q]);
        else created.push([p, q]);
      }
      const edge = findEdge(a, target);
      if (!edge) return conflict(a, target, kind, 0, -1);
      markEdge(edge[0], edge[1], kind);

      // As diagonais novas voltam a respeitar Delaunay, sem tocar nas obrigatórias.
      for (let pass = 0; pass < 8; pass += 1) {
        let flips = 0;
        for (let k = 0; k < created.length; k += 1) {
          const [p, q] = created[k] as [number, number];
          const found = findEdge(p, q);
          if (!found) continue;
          const [ft, fi] = found;
          if (tf[3 * ft + fi] !== 0) continue;
          const fu = ta[3 * ft + fi] as number;
          if (fu < 0) continue;
          const fj = twinIndex(fu, p, q);
          const c = tv[3 * ft + ((fi + 2) % 3)] as number;
          const d = tv[3 * fu + ((fj + 2) % 3)] as number;
          if (inCircle(p, q, c, d)) {
            flip(ft, fi, fu, fj);
            created[k] = [c, d];
            flips += 1;
          }
        }
        if (flips === 0) break;
      }
      a = target;
    }
  };

  const resolve = (i: number): number => alias[i] as number;
  let bounded = false;
  for (const c of constraints) {
    if (c.kind === EDGE_BOUNDARY) bounded = true;
    const a = resolve(c.a);
    const b = resolve(c.b);
    if (a !== b) insertConstraint(a, b, c.kind);
  }
  if (!bounded) {
    // Sem limite informado: a envoltória convexa é o limite. Isso também corrige as
    // reentrâncias que o super-triângulo finito pode deixar na borda.
    const hull = convexHull(px, py, alias, n);
    for (let i = 0; i < hull.length; i += 1) {
      insertConstraint(hull[i] as number, hull[(i + 1) % hull.length] as number, EDGE_BOUNDARY);
    }
  }

  // Paridade a partir do exterior: cada aresta de limite atravessada troca dentro/fora.
  const count = tv.length / 3;
  const depth = new Int32Array(count).fill(-1);
  const seed = vertTri[n] as number;
  const queue: number[] = [seed];
  depth[seed] = 0;
  for (let head = 0; head < queue.length; head += 1) {
    const t = queue[head] as number;
    for (let i = 0; i < 3; i += 1) {
      const u = ta[3 * t + i] as number;
      if (u < 0 || (depth[u] as number) >= 0) continue;
      depth[u] = (depth[t] as number) + (((tf[3 * t + i] as number) & EDGE_BOUNDARY) !== 0 ? 1 : 0);
      queue.push(u);
    }
  }
  const triangles: number[] = [];
  for (let t = 0; t < count; t += 1) {
    const a = tv[3 * t] as number;
    const b = tv[3 * t + 1] as number;
    const c = tv[3 * t + 2] as number;
    if (a >= n || b >= n || c >= n) continue;
    if ((depth[t] as number) % 2 !== 1) continue;
    triangles.push(a, b, c);
  }
  return { triangles, alias, conflicts };
}

/** Envoltória convexa (cadeia monótona), anti-horária, sem pontos colineares. */
function convexHull(px: Float64Array, py: Float64Array, alias: Int32Array, n: number): number[] {
  const ids: number[] = [];
  for (let i = 0; i < n; i += 1) if (alias[i] === i) ids.push(i);
  ids.sort(
    (a, b) => (px[a] as number) - (px[b] as number) || (py[a] as number) - (py[b] as number),
  );
  const cross = (o: number, a: number, b: number): number =>
    ((px[a] as number) - (px[o] as number)) * ((py[b] as number) - (py[o] as number)) -
    ((py[a] as number) - (py[o] as number)) * ((px[b] as number) - (px[o] as number));
  const lower: number[] = [];
  for (const p of ids) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2] as number, lower[lower.length - 1] as number, p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: number[] = [];
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    const p = ids[i] as number;
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2] as number, upper[upper.length - 1] as number, p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}
