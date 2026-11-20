import { fail, ok, type Result } from '../result';
import type { Point2, Terrain } from '../schema';
import { terrainStats } from './surface';

/**
 * Curvas de nível da superfície triangulada. Cada curva é a interseção exata do plano
 * horizontal com os triângulos do TIN: os vértices das curvas ficam sobre arestas da malha,
 * interpolados linearmente entre os dois vértices da aresta. Não há suavização — uma curva
 * suavizada sugeriria um relevo que os dados não descrevem.
 */

export interface ContourLine {
  readonly elevation: number;
  /** Curva mestra (múltipla do intervalo mestre). */
  readonly major: boolean;
  /** Trechos contínuos; um trecho fechado repete o primeiro ponto no fim. */
  readonly lines: Point2[][];
}

/** Limite de níveis por superfície: abaixo disso o intervalo é fino demais para o relevo. */
export const MAX_CONTOUR_LEVELS = 400;

const NICE_INTERVALS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500] as const;

/** Intervalo que dá cerca de quinze curvas no desnível da superfície. */
export function suggestContourInterval(terrain: Terrain): number {
  const { minZ, maxZ } = terrainStats(terrain);
  const target = Math.max(maxZ - minZ, 0) / 15;
  return NICE_INTERVALS.find((value) => value >= target) ?? 500;
}

/**
 * Curvas de nível a cada `interval` metros (cotas múltiplas do intervalo). `majorEvery` marca
 * as curvas mestras (5 = uma mestra a cada cinco).
 */
export function terrainContours(
  terrain: Terrain,
  interval: number,
  majorEvery = 5,
): Result<ContourLine[]> {
  if (!Number.isFinite(interval) || interval <= 0) {
    return fail('CONTOUR_INTERVAL', 'O intervalo das curvas de nível deve ser positivo.');
  }
  const { points, triangles } = terrain;
  const { minZ, maxZ } = terrainStats(terrain);
  const first = Math.ceil(minZ / interval - 1e-9);
  const last = Math.floor(maxZ / interval + 1e-9);
  if (last - first + 1 > MAX_CONTOUR_LEVELS) {
    return fail(
      'CONTOUR_TOO_DENSE',
      `O intervalo de ${interval} m daria ${last - first + 1} curvas para um desnível de ${(maxZ - minZ).toFixed(1)} m. Use um intervalo maior.`,
    );
  }
  const vertexCount = points.length;
  // Segmentos por nível; cada ponta é identificada pela aresta da malha em que está.
  const segments = new Map<number, { keys: number[]; xy: number[] }>();
  const levelOf = (k: number): { keys: number[]; xy: number[] } => {
    let entry = segments.get(k);
    if (!entry) {
      entry = { keys: [], xy: [] };
      segments.set(k, entry);
    }
    return entry;
  };

  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const ia = triangles[i] as number;
    const ib = triangles[i + 1] as number;
    const ic = triangles[i + 2] as number;
    const a = points[ia];
    const b = points[ib];
    const c = points[ic];
    if (!a || !b || !c) continue;
    const low = Math.min(a.z, b.z, c.z);
    const high = Math.max(a.z, b.z, c.z);
    const k0 = Math.max(first, Math.ceil(low / interval - 1e-9));
    const k1 = Math.min(last, Math.floor(high / interval + 1e-9));
    for (let k = k0; k <= k1; k += 1) {
      const level = k * interval;
      // Vértice exatamente na cota conta como acima: a curva passa por ele sem duplicar.
      const sa = a.z >= level;
      const sb = b.z >= level;
      const sc = c.z >= level;
      if (sa === sb && sb === sc) continue;
      const entry = levelOf(k);
      const cut = (i1: number, i2: number, p1: typeof a, p2: typeof a): void => {
        // Sempre do vértice de menor índice para o de maior: os dois triângulos vizinhos
        // calculam exatamente o mesmo ponto sobre a aresta comum.
        const [lo, hi, p, q] = i1 < i2 ? [i1, i2, p1, p2] : [i2, i1, p2, p1];
        const t = (level - p.z) / (q.z - p.z);
        entry.keys.push(lo * vertexCount + hi);
        entry.xy.push(p.x + t * (q.x - p.x), p.y + t * (q.y - p.y));
      };
      if (sa !== sb) cut(ia, ib, a, b);
      if (sb !== sc) cut(ib, ic, b, c);
      if (sc !== sa) cut(ic, ia, c, a);
    }
  }

  const contours: ContourLine[] = [];
  for (const k of [...segments.keys()].sort((x, y) => x - y)) {
    const { keys, xy } = segments.get(k) as { keys: number[]; xy: number[] };
    const count = keys.length / 2;
    // Pontas por aresta: cada aresta interna recebe duas (uma de cada triângulo vizinho).
    const ends = new Map<number, number[]>();
    for (let e = 0; e < keys.length; e += 1) {
      const key = keys[e] as number;
      const list = ends.get(key);
      if (list) list.push(e);
      else ends.set(key, [e]);
    }
    const used = new Uint8Array(count);
    const point = (e: number): Point2 => ({ x: xy[2 * e] as number, y: xy[2 * e + 1] as number });
    /** Outra ponta, em outro segmento, sobre a mesma aresta. */
    const partner = (e: number): number => {
      const list = ends.get(keys[e] as number);
      if (!list) return -1;
      for (const other of list) {
        if (other !== e && used[other >> 1] === 0) return other;
      }
      return -1;
    };
    const lines: Point2[][] = [];
    for (let s = 0; s < count; s += 1) {
      if (used[s] !== 0) continue;
      used[s] = 1;
      const line: Point2[] = [point(2 * s), point(2 * s + 1)];
      // Estende para a frente e depois para trás.
      for (let direction = 0; direction < 2; direction += 1) {
        let tip = direction === 0 ? 2 * s + 1 : 2 * s;
        for (;;) {
          const next = partner(tip);
          if (next < 0) break;
          used[next >> 1] = 1;
          tip = next ^ 1;
          if (direction === 0) line.push(point(tip));
          else line.unshift(point(tip));
        }
      }
      // Uma curva que só toca um vértice (cume ou canto na cota exata) não tem extensão.
      let extent = 0;
      for (let i = 1; i < line.length; i += 1) {
        const p = line[i - 1] as Point2;
        const q = line[i] as Point2;
        extent += Math.hypot(q.x - p.x, q.y - p.y);
      }
      if (extent > 1e-9) lines.push(line);
    }
    if (lines.length === 0) continue;
    contours.push({
      elevation: k * interval,
      major: majorEvery > 0 && k % majorEvery === 0,
      lines,
    });
  }
  return ok(contours);
}

/**
 * Suavização VISUAL de uma curva de nível. A curva é reamostrada em passos uniformes e filtrada
 * por uma média gaussiana ao longo do comprimento, com alcance de alguns lados da malha: assim
 * somem os "degraus" que a curva faz ao atravessar a triangulação célula a célula (típicos de
 * MDT em grade ou de cotas arredondadas), e não só os cantos isolados. A curva suavizada deixa
 * de passar exatamente pelos pontos em que o plano horizontal corta as arestas da
 * triangulação: é um recurso de desenho, não um dado do terreno.
 *
 * Curvas abertas mantêm as pontas (no limite da superfície), com o alcance do filtro reduzido
 * perto delas; curvas fechadas continuam fechadas. O alcance é limitado pelo tamanho da curva
 * para que anéis pequenos (topos e fundos) não encolham de forma visível.
 *
 * `strength` é o desvio-padrão do filtro em múltiplos do lado típico da curva (mediana dos
 * segmentos originais).
 */
export function smoothContourLine(line: readonly Point2[], strength = 2.5): Point2[] {
  const source = line.map((p) => ({ x: p.x, y: p.y }));
  if (source.length < 3) return source;
  const first = source[0] as Point2;
  const last = source[source.length - 1] as Point2;
  const closed = source.length > 3 && first.x === last.x && first.y === last.y;

  // Comprimentos acumulados e lado típico.
  const lengths: number[] = [];
  const cumulative = [0];
  for (let i = 1; i < source.length; i += 1) {
    const p = source[i - 1] as Point2;
    const q = source[i] as Point2;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    lengths.push(d);
    cumulative.push((cumulative[i - 1] as number) + d);
  }
  const total = cumulative[cumulative.length - 1] as number;
  const positive = lengths.filter((d) => d > 1e-12).sort((a, b) => a - b);
  if (total <= 1e-9 || positive.length === 0) return source;
  const typical = positive[Math.floor(positive.length / 2)] as number;

  // Alcance do filtro: proporcional ao lado da malha, limitado pelo tamanho da curva. Num anel
  // de raio r, a média gaussiana de desvio s o reduz por exp(-s²/2r²); com s ≤ P/25 (P = 2πr)
  // a redução fica abaixo de 2 %.
  const sigma = Math.min(strength * typical, total / (closed ? 25 : 8));
  // Reamostragem uniforme fina o bastante para o filtro e para o desenho parecer contínuo.
  const step = Math.max(Math.min(typical / 2, sigma / 2), total / 20000);
  const segments = Math.max(closed ? 8 : 2, Math.round(total / step));
  const samples: Point2[] = [];
  let index = 1;
  const count = closed ? segments : segments + 1;
  for (let k = 0; k < count; k += 1) {
    const s = (k / segments) * total;
    while (index < cumulative.length - 1 && (cumulative[index] as number) < s) index += 1;
    const s0 = cumulative[index - 1] as number;
    const s1 = cumulative[index] as number;
    const p = source[index - 1] as Point2;
    const q = source[index] as Point2;
    const t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    samples.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
  }
  if (!closed) samples[samples.length - 1] = { ...last };

  const sigmaSamples = sigma / (total / segments);
  if (sigmaSamples < 0.5) return closed ? [...samples, { ...(samples[0] as Point2) }] : samples;
  const radius = Math.ceil(3 * sigmaSamples);
  const weights: number[] = [];
  for (let j = 0; j <= radius; j += 1) weights.push(Math.exp(-(j * j) / (2 * sigmaSamples ** 2)));

  const n = samples.length;
  const result: Point2[] = [];
  for (let i = 0; i < n; i += 1) {
    // Curva aberta: janela simétrica truncada na ponta mais próxima, que portanto não se move.
    const reach = closed
      ? Math.min(radius, Math.floor((n - 1) / 2))
      : Math.min(radius, i, n - 1 - i);
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let j = -reach; j <= reach; j += 1) {
      const w = weights[Math.abs(j)] as number;
      const p = samples[closed ? (((i + j) % n) + n) % n : i + j] as Point2;
      sx += w * p.x;
      sy += w * p.y;
      sw += w;
    }
    result.push({ x: sx / sw, y: sy / sw });
  }
  if (closed) result.push({ ...(result[0] as Point2) });
  return result;
}
