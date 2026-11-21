import type { Vec3 } from '../math';
import type { Earthworks, Terrain } from '../schema';
import type { DesignSurface } from './grading';
import { terrainTrianglesIn } from './surface';

/**
 * Volumes de terraplenagem: integração exata entre o terreno natural e o projetado.
 *
 * As duas superfícies são malhas de faces planas. Cada triângulo do terreno projetado é
 * recortado pelos triângulos do terreno natural que ele cobre; em cada pedaço as duas
 * superfícies são planos, e a diferença de cota é linear. O pedaço é então dividido pela
 * linha em que a diferença é zero — de um lado é corte, do outro é aterro — e o volume de
 * cada parte é a área em planta vezes a média das diferenças nos vértices (exato para uma
 * função linear). Não há amostragem em grade: onde as superfícies se cruzam, corte e aterro
 * são separados na linha de cruzamento, e nenhum dos dois pode sair negativo.
 */

/** Diferença de cota (m) tratada como zero. */
const LEVEL = 1e-9;

interface Corner {
  readonly x: number;
  readonly y: number;
  /** Cota do terreno natural. */
  readonly natural: number;
  /** Cota do terreno projetado. */
  readonly design: number;
}

export interface CutFill {
  /** Volume de corte (m³), medido no terreno natural (in situ). */
  cut: number;
  /** Volume de aterro (m³), medido na geometria acabada (compactado). */
  fill: number;
  /** Área em planta em corte (m²). */
  cutArea: number;
  /** Área em planta em aterro (m²). */
  fillArea: number;
}

/** Sólido triangulado entre as duas superfícies (corte ou aterro). */
export interface EarthworkSolid {
  readonly points: Vec3[];
  /** Três índices por face, normais para fora. */
  readonly triangles: number[];
  /** Cada aresta é compartilhada por exatamente duas faces (casca fechada). */
  readonly closed: boolean;
}

class SolidBuilder {
  private readonly points: Vec3[] = [];
  private readonly triangles: number[] = [];
  /** Posições em planta já vistas, por célula de 0,1 mm. */
  private readonly columns = new Map<string, number>();
  private columnCount = 0;
  private readonly byColumn = new Map<string, number>();

  /**
   * Vértice em (x, y, z), fundido com um já existente a menos de 0,1 mm. O mesmo ponto chega
   * aqui calculado a partir de triângulos diferentes, com ruído de arredondamento: a busca
   * olha as células vizinhas, porque arredondar cada coordenada separaria pontos iguais que
   * caem dos dois lados de uma divisa de célula.
   */
  private vertex(x: number, y: number, z: number): number {
    const qx = Math.round(x * 1e4);
    const qy = Math.round(y * 1e4);
    const qz = Math.round(z * 1e4);
    let column: number | undefined;
    for (let dx = -1; dx <= 1 && column === undefined; dx += 1) {
      for (let dy = -1; dy <= 1 && column === undefined; dy += 1) {
        column = this.columns.get(`${qx + dx}|${qy + dy}`);
      }
    }
    if (column === undefined) {
      column = this.columnCount;
      this.columnCount += 1;
      this.columns.set(`${qx}|${qy}`, column);
    }
    for (let dz = -1; dz <= 1; dz += 1) {
      const found = this.byColumn.get(`${column}|${qz + dz}`);
      if (found !== undefined) return found;
    }
    const index = this.points.length;
    this.byColumn.set(`${column}|${qz}`, index);
    this.points.push({ x: qx / 1e4, y: qy / 1e4, z: qz / 1e4 });
    return index;
  }

  /** Prisma entre `top` e `bottom` sobre o triângulo a, b, c (anti-horário em planta). */
  add(a: Corner, b: Corner, c: Corner, top: 'natural' | 'design'): void {
    const bottom = top === 'natural' ? 'design' : 'natural';
    // Onde as duas superfícies estão a menos de 1 mm, a tampa e o fundo usam o mesmo
    // vértice: é ali (na linha de encontro) que a casca se fecha.
    const level = (p: Corner, key: 'natural' | 'design'): number =>
      Math.abs(p.design - p.natural) < 1e-3 ? p.natural : p[key];
    const ids = (key: 'natural' | 'design'): [number, number, number] => [
      this.vertex(a.x, a.y, level(a, key)),
      this.vertex(b.x, b.y, level(b, key)),
      this.vertex(c.x, c.y, level(c, key)),
    ];
    const [i, j, k] = ids(top);
    const [l, m, n] = ids(bottom);
    if (i === j || j === k || k === i) return;
    // Pedaço de altura nula (as duas faces coincidem): não faz parte do sólido.
    if (i === l && j === m && k === n) return;
    this.triangles.push(i, j, k, l, n, m);
  }

  build(): EarthworkSolid | null {
    if (this.triangles.length === 0) return null;
    // A tampa e o fundo se encontram na linha de diferença zero, sem parede lateral: a casca
    // é fechada quando toda aresta pertence a exatamente duas faces.
    const uses = new Map<string, number>();
    const count = this.points.length;
    for (let i = 0; i + 2 < this.triangles.length; i += 3) {
      for (let e = 0; e < 3; e += 1) {
        const u = this.triangles[i + e] as number;
        const v = this.triangles[i + ((e + 1) % 3)] as number;
        const key = u < v ? `${u * count + v}` : `${v * count + u}`;
        uses.set(key, (uses.get(key) ?? 0) + 1);
      }
    }
    let closed = true;
    for (const value of uses.values()) {
      if (value !== 2) {
        closed = false;
        break;
      }
    }
    return { points: this.points, triangles: this.triangles, closed };
  }
}

export interface PlatformVolumes extends CutFill {
  /** Posição do platô em `earthworks.platforms`. */
  readonly index: number;
  readonly cutSolid: EarthworkSolid | null;
  readonly fillSolid: EarthworkSolid | null;
}

/** Recorta o polígono convexo pelo semiplano à esquerda de a → b. */
function clipLeft(polygon: Corner[], a: Corner, b: Corner): Corner[] {
  const side = (p: Corner): number => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  return clipBy(polygon, side);
}

/** Parte do polígono em que `value` ≥ 0, interpolando as cotas nos pontos de corte. */
function clipBy(polygon: Corner[], value: (p: Corner) => number): Corner[] {
  const out: Corner[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const p = polygon[i] as Corner;
    const q = polygon[(i + 1) % polygon.length] as Corner;
    const vp = value(p);
    const vq = value(q);
    if (vp >= 0) out.push(p);
    if ((vp > 0 && vq < 0) || (vp < 0 && vq > 0)) {
      const t = vp / (vp - vq);
      out.push({
        x: p.x + t * (q.x - p.x),
        y: p.y + t * (q.y - p.y),
        natural: p.natural + t * (q.natural - p.natural),
        design: p.design + t * (q.design - p.design),
      });
    }
  }
  return out;
}

const area2 = (a: Corner, b: Corner, c: Corner): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/**
 * Corte e aterro de cada platô: integração do terreno projetado contra o natural sobre os
 * triângulos de cada platô (`design.tags`). Com `solids`, devolve também os sólidos de corte
 * e de aterro (para a exportação e o desenho).
 */
export function earthworkVolumes(
  natural: Terrain,
  design: DesignSurface,
  options: { readonly solids?: boolean } = {},
): PlatformVolumes[] {
  const groups = new Map<
    number,
    { totals: CutFill; cut: SolidBuilder | null; fill: SolidBuilder | null }
  >();
  for (const footprint of design.footprints) {
    groups.set(footprint.index, {
      totals: { cut: 0, fill: 0, cutArea: 0, fillArea: 0 },
      cut: options.solids ? new SolidBuilder() : null,
      fill: options.solids ? new SolidBuilder() : null,
    });
  }
  const { points, triangles } = design.terrain;
  const base = natural.points;
  const baseTriangles = natural.triangles;
  const stamp = new Int32Array(Math.floor(baseTriangles.length / 3)).fill(-1);

  for (let t = 0; 3 * t + 2 < triangles.length; t += 1) {
    const group = groups.get(design.tags[t] as number);
    if (!group) continue;
    const A = points[triangles[3 * t] as number];
    const B = points[triangles[3 * t + 1] as number];
    const C = points[triangles[3 * t + 2] as number];
    if (!A || !B || !C) continue;
    // Coordenadas relativas ao primeiro vértice: os produtos ficam pequenos mesmo em UTM.
    const ox = A.x;
    const oy = A.y;
    const dA: Corner = { x: 0, y: 0, natural: 0, design: A.z };
    const dB: Corner = { x: B.x - ox, y: B.y - oy, natural: 0, design: B.z };
    const dC: Corner = { x: C.x - ox, y: C.y - oy, natural: 0, design: C.z };
    const det = area2(dA, dB, dC);
    if (det < 1e-12) continue;
    const gx = ((dB.design - A.z) * dC.y - (dC.design - A.z) * dB.y) / det;
    const gy = ((dC.design - A.z) * dB.x - (dB.design - A.z) * dC.x) / det;
    const designAt = (x: number, y: number): number => A.z + gx * x + gy * y;

    terrainTrianglesIn(
      natural,
      Math.min(A.x, B.x, C.x),
      Math.min(A.y, B.y, C.y),
      Math.max(A.x, B.x, C.x),
      Math.max(A.y, B.y, C.y),
      (n) => {
        if (stamp[n] === t) return;
        stamp[n] = t;
        const a = base[baseTriangles[3 * n] as number];
        const b = base[baseTriangles[3 * n + 1] as number];
        const c = base[baseTriangles[3 * n + 2] as number];
        if (!a || !b || !c) return;
        const at = (p: Vec3): Corner => {
          const x = p.x - ox;
          const y = p.y - oy;
          return { x, y, natural: p.z, design: designAt(x, y) };
        };
        let polygon: Corner[] = [at(a), at(b), at(c)];
        if (area2(polygon[0] as Corner, polygon[1] as Corner, polygon[2] as Corner) < 0) {
          polygon.reverse();
        }
        polygon = clipLeft(polygon, dA, dB);
        if (polygon.length >= 3) polygon = clipLeft(polygon, dB, dC);
        if (polygon.length >= 3) polygon = clipLeft(polygon, dC, dA);
        if (polygon.length < 3) return;

        const emit = (part: Corner[], fill: boolean): void => {
          const first = part[0];
          if (!first) return;
          for (let i = 1; i + 1 < part.length; i += 1) {
            const p = part[i] as Corner;
            const q = part[i + 1] as Corner;
            const area = area2(first, p, q) / 2;
            if (area <= 1e-14) continue;
            const mean =
              (first.design - first.natural + (p.design - p.natural) + (q.design - q.natural)) / 3;
            const volume = area * Math.abs(mean);
            if (volume <= 0) continue;
            if (fill) {
              group.totals.fill += volume;
              group.totals.fillArea += area;
            } else {
              group.totals.cut += volume;
              group.totals.cutArea += area;
            }
            const builder = fill ? group.fill : group.cut;
            if (builder) {
              const abs = (v: Corner): Corner => ({ ...v, x: v.x + ox, y: v.y + oy });
              builder.add(abs(first), abs(p), abs(q), fill ? 'design' : 'natural');
            }
          }
        };
        const difference = (p: Corner): number => {
          const d = p.design - p.natural;
          return Math.abs(d) < LEVEL ? 0 : d;
        };
        let above = false;
        let below = false;
        for (const p of polygon) {
          const d = difference(p);
          if (d > 0) above = true;
          else if (d < 0) below = true;
        }
        if (above && below) {
          emit(clipBy(polygon, difference), true);
          emit(
            clipBy(polygon, (p) => -difference(p)),
            false,
          );
        } else if (above) emit(polygon, true);
        else if (below) emit(polygon, false);
      },
    );
  }

  return design.footprints.map((footprint) => {
    const group = groups.get(footprint.index);
    return {
      index: footprint.index,
      ...(group?.totals ?? { cut: 0, fill: 0, cutArea: 0, fillArea: 0 }),
      cutSolid: group?.cut?.build() ?? null,
      fillSolid: group?.fill?.build() ?? null,
    };
  });
}

/**
 * Quantidades de terraplenagem a partir dos volumes geométricos e dos parâmetros do
 * projetista. Cada volume está em um estado, e estados diferentes nunca são somados sem
 * conversão:
 *
 *  - corte: **in situ** (no terreno natural);
 *  - aterro: **compactado** (na geometria acabada);
 *  - solto: corte in situ × (1 + empolamento ÷ 100) — o que se transporta;
 *  - conversão corte → aterro: 1 m³ de corte in situ rende `compactionFactor` m³ de aterro
 *    compactado.
 *
 * O balanço é feito em m³ compactados: aterro que o material aproveitável rende menos o
 * aterro necessário. Quantidade que depende de um parâmetro não informado fica `null`.
 */
export interface EarthworkQuantities extends CutFill {
  /** Material escavado solto (m³). */
  readonly loose: number | null;
  /** Parcela do corte que serve para aterro (m³ in situ). */
  readonly reusable: number | null;
  /** Aterro que o material aproveitável rende (m³ compactados). */
  readonly fillFromCut: number | null;
  /**
   * Saldo (m³ compactados): positivo = sobra material aproveitável; negativo = falta, a
   * cobrir com empréstimo.
   */
  readonly balance: number | null;
  /** Empréstimo necessário (m³ compactados de aterro a cobrir com material de fora). */
  readonly borrow: number | null;
  /**
   * Empréstimo medido na jazida (m³ in situ), supondo para o material de empréstimo o mesmo
   * fator de conversão do corte.
   */
  readonly borrowInSitu: number | null;
  /**
   * Excedente (m³ in situ): o material não aproveitável mais a sobra do aproveitável — o que
   * sai para bota-fora.
   */
  readonly surplus: number | null;
  /** Excedente solto (m³): o volume a transportar para o bota-fora. */
  readonly surplusLoose: number | null;
}

export function earthworkQuantities(
  volumes: CutFill,
  settings: Pick<Earthworks, 'swellPercent' | 'compactionFactor' | 'reusePercent'>,
): EarthworkQuantities {
  const { cut, fill, cutArea, fillArea } = volumes;
  const swell = settings.swellPercent === null ? null : 1 + settings.swellPercent / 100;
  const factor = settings.compactionFactor;
  const reusable = settings.reusePercent === null ? null : (cut * settings.reusePercent) / 100;
  const fillFromCut = reusable === null || factor === null ? null : reusable * factor;
  const balance = fillFromCut === null ? null : fillFromCut - fill;
  const borrow = balance === null ? null : Math.max(0, -balance);
  const borrowInSitu = borrow === null || factor === null ? null : borrow / factor;
  // Sobra do aproveitável, de volta ao estado in situ, mais o que não serve para aterro.
  const surplus =
    balance === null || factor === null || reusable === null
      ? null
      : cut - reusable + Math.max(0, balance) / factor;
  return {
    cut,
    fill,
    cutArea,
    fillArea,
    loose: swell === null ? null : cut * swell,
    reusable,
    fillFromCut,
    balance,
    borrow,
    borrowInSitu,
    surplus,
    surplusLoose: surplus === null || swell === null ? null : surplus * swell,
  };
}

export function sumCutFill(items: readonly CutFill[]): CutFill {
  const total: CutFill = { cut: 0, fill: 0, cutArea: 0, fillArea: 0 };
  for (const item of items) {
    total.cut += item.cut;
    total.fill += item.fill;
    total.cutArea += item.cutArea;
    total.fillArea += item.fillArea;
  }
  return total;
}
