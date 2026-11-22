import type { Architecture, Level, Point2, Roof, RoofShape, RoofType } from '../schema';
import { ringArea } from '../terrain/polygon';
import { add2, cross2, distance2, dot2, length2, scale2, sub2 } from './polygon2';
import { getArchType, layersThickness } from './walls';

/**
 * Telhados de uma e de duas águas sobre contorno retangular: regras e geometria DERIVADA.
 *
 * Convenções (as mesmas de `RoofSchema`, repetidas aqui porque toda a matemática depende delas):
 *  - o contorno é o retângulo de REFERÊNCIA em planta; o lado `eaveEdge` é beiral;
 *  - a cota de referência (nível + `offset`) é a da face INFERIOR sobre a linha do beiral do
 *    contorno;
 *  - o beiral (`overhang`) é medido na HORIZONTAL, para fora do contorno, nos quatro lados, e
 *    a água continua com a mesma inclinação (a borda do beiral fica abaixo da referência);
 *  - a espessura do tipo é medida PERPENDICULARMENTE à água; as bordas são cortadas a prumo,
 *    de modo que a espessura na vertical é `espessura ÷ cos(inclinação)`.
 *
 * Referencial local do telhado: origem no início do lado do beiral, na cota de referência;
 * `u` ao longo do beiral, `v` para dentro do contorno (subindo a água) e Z para cima.
 */

/** Menor lado de contorno aceito (m). */
export const MIN_ROOF_SIDE = 0.1;
/** Inclinação mínima: 1 %. Abaixo disso é cobertura plana, que não é modelada como telhado. */
export const MIN_ROOF_SLOPE = Math.atan(0.01);
/** Inclinação máxima aceita: 75°. */
export const MAX_ROOF_SLOPE = (75 * Math.PI) / 180;
/** Desvio admitido do ângulo reto nos cantos do contorno (produto escalar dos versores). */
const SQUARE_TOLERANCE = 1e-6;

export const ROOF_SHAPE_LABELS: Record<RoofShape, string> = {
  shed: 'Uma água',
  gable: 'Duas águas',
};

/** Tipo predefinido IFC (`IfcRoofTypeEnum`) de cada tipologia. */
export const ROOF_IFC_PREDEFINED: Record<RoofShape, string> = {
  shed: 'SHED_ROOF',
  gable: 'GABLE_ROOF',
};

/** Inclinação em percentual (100 × tangente) e a conversão inversa. */
export const slopeToPercent = (slope: number): number => Math.tan(slope) * 100;
export const percentToSlope = (percent: number): number => Math.atan(percent / 100);

export function roofTypeOf(architecture: Architecture, roof: Roof): RoofType | undefined {
  const type = getArchType(architecture, roof.typeId);
  return type?.category === 'roof' ? type : undefined;
}

/**
 * Por que o contorno não serve (mensagem em português) ou `null` se é um retângulo válido:
 * quatro cantos, lados de ao menos `MIN_ROOF_SIDE` e ângulos retos.
 */
export function roofBoundaryProblem(boundary: readonly Point2[]): string | null {
  if (boundary.length !== 4) {
    return 'o contorno do telhado precisa de quatro cantos (retângulo)';
  }
  if (boundary.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    return 'o contorno do telhado tem coordenadas inválidas';
  }
  for (let i = 0; i < 4; i += 1) {
    const a = boundary[i] as Point2;
    const b = boundary[(i + 1) % 4] as Point2;
    const c = boundary[(i + 2) % 4] as Point2;
    const side = sub2(b, a);
    const next = sub2(c, b);
    if (length2(side) < MIN_ROOF_SIDE) {
      return `o lado ${i + 1} do contorno é curto demais (mínimo de ${MIN_ROOF_SIDE * 100} cm)`;
    }
    if (length2(next) < MIN_ROOF_SIDE) continue; // acusado na volta seguinte
    const cosine = dot2(side, next) / (length2(side) * length2(next));
    if (Math.abs(cosine) > SQUARE_TOLERANCE) {
      return 'o contorno do telhado precisa ser retangular (só telhados de uma e de duas águas sobre retângulo são modelados)';
    }
  }
  if (Math.abs(ringArea(boundary)) < MIN_ROOF_SIDE * MIN_ROOF_SIDE) {
    return 'o contorno do telhado não delimita área';
  }
  return null;
}

/** Por que a inclinação não serve ou `null`. */
export function roofSlopeProblem(slope: number): string | null {
  if (!Number.isFinite(slope) || slope < MIN_ROOF_SLOPE - 1e-12) {
    return 'a inclinação mínima do telhado é de 1 % (cobertura plana não é modelada como telhado)';
  }
  if (slope > MAX_ROOF_SLOPE + 1e-12) {
    return 'a inclinação máxima do telhado é de 75°';
  }
  return null;
}

/**
 * Contorno em sentido anti-horário, com o índice do lado do beiral acompanhando a inversão:
 * o lado físico escolhido continua o mesmo.
 */
export function normalizeRoofBoundary(
  boundary: readonly Point2[],
  eaveEdge: number,
): { boundary: Point2[]; eaveEdge: number } {
  const points = boundary.map((p) => ({ x: p.x, y: p.y }));
  if (ringArea(points) >= 0) return { boundary: points, eaveEdge };
  // Anel invertido: o lado i (de p[i] a p[i+1]) passa a ser o lado n − 2 − i.
  return { boundary: points.reverse(), eaveEdge: (((2 - eaveEdge) % 4) + 4) % 4 };
}

/**
 * Retângulo por três pontos: `a`–`b` é o primeiro lado e `c` dá a largura — só conta a
 * distância de `c` à reta do primeiro lado (o terceiro clique não precisa estar em esquadro).
 * `null` quando o primeiro lado ou a largura não têm tamanho.
 */
export function rectangleFromThreePoints(a: Point2, b: Point2, c: Point2): Point2[] | null {
  const side = sub2(b, a);
  const size = length2(side);
  if (size < 1e-9) return null;
  const dir = scale2(side, 1 / size);
  const normal = { x: -dir.y, y: dir.x };
  const width = dot2(sub2(c, a), normal);
  if (Math.abs(width) < 1e-9) return null;
  const shift = scale2(normal, width);
  return [a, b, add2(b, shift), add2(a, shift)];
}

/**
 * Retângulo depois de arrastar o canto `index` até `point`: o canto oposto e a orientação dos
 * lados ficam; os dois cantos vizinhos acompanham. É o que mantém o contorno retangular na
 * edição direta.
 */
export function moveRectangleCorner(
  boundary: readonly Point2[],
  index: number,
  point: Point2,
): Point2[] | null {
  if (boundary.length !== 4) return null;
  const fixed = boundary[(index + 2) % 4] as Point2;
  const next = boundary[(index + 1) % 4] as Point2;
  const previous = boundary[(index + 3) % 4] as Point2;
  // Direções dos dois lados que saem do canto fixo.
  const toNext = sub2(next, fixed);
  const toPrevious = sub2(previous, fixed);
  if (length2(toNext) < 1e-9 || length2(toPrevious) < 1e-9) return null;
  const un = scale2(toNext, 1 / length2(toNext));
  const up = scale2(toPrevious, 1 / length2(toPrevious));
  const rel = sub2(point, fixed);
  const result = boundary.map((p) => ({ x: p.x, y: p.y }));
  result[index] = { x: point.x, y: point.y };
  result[(index + 1) % 4] = add2(fixed, scale2(un, dot2(rel, un)));
  result[(index + 3) % 4] = add2(fixed, scale2(up, dot2(rel, up)));
  return result;
}

/**
 * Retângulo depois de deslocar o lado `edge` (de `boundary[edge]` ao canto seguinte) até
 * passar por `point`, paralelo a si mesmo.
 */
export function moveRectangleEdge(
  boundary: readonly Point2[],
  edge: number,
  point: Point2,
): Point2[] | null {
  if (boundary.length !== 4) return null;
  const a = boundary[edge % 4] as Point2;
  const b = boundary[(edge + 1) % 4] as Point2;
  const side = sub2(b, a);
  const size = length2(side);
  if (size < 1e-9) return null;
  const normal = { x: -side.y / size, y: side.x / size };
  const shift = scale2(normal, dot2(sub2(point, a), normal));
  const result = boundary.map((p) => ({ x: p.x, y: p.y }));
  result[edge % 4] = add2(a, shift);
  result[(edge + 1) % 4] = add2(b, shift);
  return result;
}

/** Referencial e medidas de um telhado, em planta e em altura. */
export interface RoofFrame {
  readonly shape: RoofShape;
  /** Início do lado do beiral (origem local), em planta. */
  readonly origin: Point2;
  /** Versor ao longo do beiral (e da cumeeira). */
  readonly along: Point2;
  /** Versor para dentro do contorno, perpendicular ao beiral (sobe a água). */
  readonly inward: Point2;
  /** Comprimento do lado do beiral (m). */
  readonly length: number;
  /** Vão: distância entre o lado do beiral e o oposto (m). */
  readonly span: number;
  readonly overhang: number;
  readonly slope: number;
  /** Espessura perpendicular à água (soma das camadas) e a medida na vertical. */
  readonly thickness: number;
  readonly verticalThickness: number;
  /** Posição da cumeeira ao longo de `v` (duas águas); `null` em uma água. */
  readonly ridge: number | null;
}

export function roofFrame(roof: Roof, type: Pick<RoofType, 'shape' | 'layers'>): RoofFrame | null {
  if (roofBoundaryProblem(roof.boundary)) return null;
  const { boundary, eaveEdge } = normalizeRoofBoundary(roof.boundary, roof.eaveEdge);
  const a = boundary[eaveEdge % 4] as Point2;
  const b = boundary[(eaveEdge + 1) % 4] as Point2;
  const c = boundary[(eaveEdge + 2) % 4] as Point2;
  const length = distance2(a, b);
  const along = scale2(sub2(b, a), 1 / length);
  // Contorno anti-horário: o interior fica à esquerda de cada lado.
  const inward = { x: -along.y, y: along.x };
  const span = Math.abs(cross2(along, sub2(c, b)));
  const thickness = layersThickness(type);
  return {
    shape: type.shape,
    origin: a,
    along,
    inward,
    length,
    span,
    overhang: roof.overhang,
    slope: roof.slope,
    thickness,
    verticalThickness: thickness / Math.cos(roof.slope),
    ridge: type.shape === 'gable' ? span / 2 : null,
  };
}

/** Altura da face INFERIOR acima da cota de referência, na posição `v` (m a partir do beiral). */
export function roofUndersideAt(frame: RoofFrame, v: number): number {
  const rise = Math.tan(frame.slope);
  return (frame.ridge === null ? v : Math.min(v, frame.span - v)) * rise;
}

/** Ponto em planta da posição local (`u` ao longo do beiral, `v` para dentro). */
export const roofPlanPoint = (frame: RoofFrame, u: number, v: number): Point2 =>
  add2(frame.origin, add2(scale2(frame.along, u), scale2(frame.inward, v)));

/** Projeção horizontal do telhado com os beirais (anti-horário). */
export function roofFootprint(frame: RoofFrame): Point2[] {
  const o = frame.overhang;
  return [
    roofPlanPoint(frame, -o, -o),
    roofPlanPoint(frame, frame.length + o, -o),
    roofPlanPoint(frame, frame.length + o, frame.span + o),
    roofPlanPoint(frame, -o, frame.span + o),
  ];
}

/** Linha da cumeeira em planta (duas águas), de ponta a ponta do beiral lateral; senão `null`. */
export function roofRidgeLine(frame: RoofFrame): [Point2, Point2] | null {
  if (frame.ridge === null) return null;
  return [
    roofPlanPoint(frame, -frame.overhang, frame.ridge),
    roofPlanPoint(frame, frame.length + frame.overhang, frame.ridge),
  ];
}

/** Cotas mais baixa e mais alta do telhado (m): borda do beiral e topo da cumeeira (ou da água). */
export function roofVerticalRange(
  levels: readonly Level[],
  roof: Roof,
  type: Pick<RoofType, 'shape' | 'layers'>,
): { base: number; top: number; reference: number } | null {
  const frame = roofFrame(roof, type);
  if (!frame) return null;
  const reference =
    (levels.find((level) => level.id === roof.levelId)?.elevation ?? 0) + roof.offset;
  const high = frame.ridge ?? frame.span + frame.overhang;
  return {
    reference,
    base: reference + roofUndersideAt(frame, -frame.overhang),
    top: reference + roofUndersideAt(frame, high) + frame.verticalThickness,
  };
}

/**
 * Quantidades do telhado.
 *  - `projectedArea`: projeção horizontal, com os beirais;
 *  - `slopeArea`: área INCLINADA da face superior (a das telhas) = projeção ÷ cos(inclinação),
 *    exata para águas planas com bordas a prumo;
 *  - `volume`: área inclinada × espessura do tipo (igual a projeção × espessura na vertical).
 *    Cada telhado entra uma vez; não soma lajes, forros nem estrutura.
 * Não há aberturas em telhados: bruto e líquido coincidem.
 */
export interface RoofQuantities {
  readonly shape: RoofShape;
  readonly slope: number;
  readonly thickness: number;
  readonly projectedArea: number;
  readonly slopeArea: number;
  readonly volume: number;
  /** Perímetro da projeção horizontal, com os beirais (m). */
  readonly perimeter: number;
  /** Comprimento total de beiral baixo: um lado (uma água) ou dois (duas águas). */
  readonly eaveLength: number;
  /** Comprimento da cumeeira (duas águas); `null` em uma água. */
  readonly ridgeLength: number | null;
  /** Altura do ponto mais alto da face superior acima da cota de referência (m). */
  readonly rise: number;
}

export function roofQuantities(architecture: Architecture, roof: Roof): RoofQuantities | null {
  const type = roofTypeOf(architecture, roof);
  const frame = type ? roofFrame(roof, type) : null;
  if (!type || !frame) return null;
  const runLength = frame.length + 2 * frame.overhang;
  const runSpan = frame.span + 2 * frame.overhang;
  const projectedArea = runLength * runSpan;
  const slopeArea = projectedArea / Math.cos(frame.slope);
  const high = frame.ridge ?? frame.span + frame.overhang;
  return {
    shape: frame.shape,
    slope: frame.slope,
    thickness: frame.thickness,
    projectedArea,
    slopeArea,
    volume: slopeArea * frame.thickness,
    perimeter: 2 * (runLength + runSpan),
    eaveLength: frame.ridge === null ? runLength : 2 * runLength,
    ridgeLength: frame.ridge === null ? null : runLength,
    rise: roofUndersideAt(frame, high) + frame.verticalThickness,
  };
}
