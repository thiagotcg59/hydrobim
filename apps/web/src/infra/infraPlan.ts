import {
  formatMeters,
  getPorts,
  pipeLength,
  terrainElevationAt,
  type GeoTransform,
  type HydroElement,
  type InfraSettings,
  type Point2,
  type Terrain,
} from '@hydrobim/core';
import type { ViewBounds } from '../map/tiles';

/**
 * Regras de apresentação da Planta Infra (funções puras, sem React): o que é desenhado em
 * detalhe ou simplificado, que rótulos cabem sem sobreposição, a barra de escala e a malha de
 * coordenadas. Nada aqui altera o modelo: a simplificação é só visual e os símbolos são sempre
 * identificados como fora de escala.
 */

/** Categoria de camada do elemento na Planta Infra. */
export function infraLayerOf(element: HydroElement): 'network' | 'equipment' {
  return element.kind === 'valve' || element.kind === 'pump' || element.kind === 'tank'
    ? 'equipment'
    : 'network';
}

/** Dimensão característica do elemento em planta (m), para decidir o nível de detalhe. */
function characteristicSize(element: HydroElement): number {
  if (element.kind === 'tank') return element.diameter;
  if (element.kind === 'pump') return element.length;
  return element.spec.outerDiameter;
}

/** Abaixo deste tamanho na tela (px) a geometria real não é legível e dá lugar ao símbolo. */
export const DETAIL_MIN_PX = 3;

/**
 * O elemento é desenhado simplificado (eixo ou símbolo de tamanho fixo na tela)? Só quando a
 * sua geometria real ocuparia menos de `DETAIL_MIN_PX` pixels.
 */
export function isSimplified(element: HydroElement, metersPerPixel: number): boolean {
  return characteristicSize(element) / metersPerPixel < DETAIL_MIN_PX;
}

/** Caixa envolvente barata do elemento em planta (portas e origem), para o recorte da vista. */
export function planBoxOf(element: HydroElement): ViewBounds {
  const pad = Math.max(characteristicSize(element), element.spec.outerDiameter);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  for (const port of getPorts(element)) include(port.position.x, port.position.y);
  if (element.kind !== 'pipe') include(element.placement.position.x, element.placement.position.y);
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export const intersects = (a: ViewBounds, b: ViewBounds): boolean =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/** Ponto de referência do elemento em planta: meio do tubo ou origem da peça. */
export function planAnchorOf(element: HydroElement): Point2 {
  if (element.kind === 'pipe') {
    return { x: (element.start.x + element.end.x) / 2, y: (element.start.y + element.end.y) / 2 };
  }
  return { x: element.placement.position.x, y: element.placement.position.y };
}

// ---------------------------------------------------------------------------
// Altimetria
// ---------------------------------------------------------------------------

export interface ElevationInfo {
  /** Cota do eixo do tubo (m). */
  readonly axis: number;
  /** Cota da geratriz superior externa (m). */
  readonly crown: number;
  /** Cota da geratriz inferior externa (m). */
  readonly invert: number;
  /** Cota do terreno (m); `null` = sem terreno ou ponto fora da cobertura do levantamento. */
  readonly ground: number | null;
  /** Recobrimento até a geratriz superior externa (m); `null` sem cota de terreno. */
  readonly cover: number | null;
  /**
   * Com platôs: cota do terreno natural e recobrimento sob ele. Aí `ground` e `cover` são os
   * do terreno projetado. `undefined` = só uma superfície (sem platôs).
   */
  readonly natural?: { readonly ground: number | null; readonly cover: number | null };
}

/**
 * Cotas no ponto (x, y) de um elemento cujo eixo está em `z`. A cota do terreno só existe
 * dentro do TIN importado — fora dele fica desconhecida, nunca extrapolada. `terrain` é o
 * terreno projetado (o natural, sem platôs); `natural`, quando informado, é o natural.
 */
export function elevationInfoAt(
  terrain: Terrain | null,
  point: { x: number; y: number; z: number },
  outerDiameter: number,
  natural: Terrain | null = null,
): ElevationInfo {
  const crown = point.z + outerDiameter / 2;
  const at = (surface: Terrain | null): { ground: number | null; cover: number | null } => {
    const ground = surface ? terrainElevationAt(surface, point.x, point.y) : null;
    return { ground, cover: ground === null ? null : ground - crown };
  };
  return {
    axis: point.z,
    crown,
    invert: point.z - outerDiameter / 2,
    ...at(terrain),
    ...(natural ? { natural: at(natural) } : {}),
  };
}

export function formatElevationInfo(info: ElevationInfo): string {
  const parts = [`eixo ${formatMeters(info.axis, 2)}`, `GS ${formatMeters(info.crown, 2)}`];
  const ground = (name: string, g: number | null, cover: number | null): string =>
    g === null || cover === null
      ? `${name}: sem dado`
      : `${name} ${formatMeters(g, 2)} · rec. ${formatMeters(cover, 2)}`;
  if (info.natural) {
    // TP = terreno projetado; TN = terreno natural.
    parts.push(ground('TP', info.ground, info.cover));
    parts.push(ground('TN', info.natural.ground, info.natural.cover));
  } else {
    parts.push(ground('terreno', info.ground, info.cover));
  }
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------

export interface PlanLabel {
  readonly id: string;
  /** Ponto de inserção no modelo (m). */
  readonly x: number;
  readonly y: number;
  readonly text: string;
  /** Maior = mais importante quando há disputa por espaço. */
  readonly priority: number;
}

/**
 * Rótulo do elemento conforme as opções da Planta Infra; `null` = nada a mostrar. `terrain` é
 * o terreno projetado (o natural, sem platôs); com `natural`, as cotas das duas superfícies.
 */
export function labelOf(
  element: HydroElement,
  labels: InfraSettings['labels'],
  terrain: Terrain | null,
  natural: Terrain | null = null,
): PlanLabel | null {
  const parts: string[] = [];
  if (labels.names) parts.push(element.name);
  if (element.kind === 'pipe') {
    if (labels.lengths) parts.push(formatMeters(pipeLength(element), 2));
    if (labels.elevations) {
      parts.push(`eixo ${formatMeters(element.start.z, 2)} → ${formatMeters(element.end.z, 2)}`);
    }
  } else if (labels.elevations) {
    const p = element.placement.position;
    parts.push(
      formatElevationInfo(elevationInfoAt(terrain, p, element.spec.outerDiameter, natural)),
    );
  }
  if (parts.length === 0) return null;
  const anchor = planAnchorOf(element);
  return {
    id: element.id,
    x: anchor.x,
    y: anchor.y,
    text: parts.join(' · '),
    // Nós (equipamentos e conexões) antes dos trechos; trechos longos antes dos curtos.
    priority: element.kind === 'pipe' ? Math.min(pipeLength(element), 1e5) : 1e6,
  };
}

/** Largura média de um caractere e altura da linha dos rótulos (px). */
export const LABEL_CHAR_PX = 6.4;
export const LABEL_HEIGHT_PX = 15;
/** Teto de rótulos por vista: acima disso o texto vira ruído e pesa na tela. */
export const MAX_LABELS = 250;

/**
 * Controle de sobreposição: aceita os rótulos por ordem de prioridade e descarta os que
 * cobririam um já aceito. O teste é feito em pixels de tela, então o conjunto muda com o zoom.
 */
export function placeLabels(
  candidates: readonly PlanLabel[],
  metersPerPixel: number,
  max = MAX_LABELS,
): PlanLabel[] {
  const ordered = [...candidates].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  const cell = LABEL_HEIGHT_PX * 8;
  const grid = new Map<string, { x0: number; y0: number; x1: number; y1: number }[]>();
  const accepted: PlanLabel[] = [];
  for (const label of ordered) {
    if (accepted.length >= max) break;
    const x0 = label.x / metersPerPixel + 8;
    const y0 = -label.y / metersPerPixel - LABEL_HEIGHT_PX;
    const box = { x0, y0, x1: x0 + label.text.length * LABEL_CHAR_PX, y1: y0 + LABEL_HEIGHT_PX };
    const cells: string[] = [];
    for (let cx = Math.floor(box.x0 / cell); cx <= Math.floor(box.x1 / cell); cx += 1) {
      for (let cy = Math.floor(box.y0 / cell); cy <= Math.floor(box.y1 / cell); cy += 1) {
        cells.push(`${cx},${cy}`);
      }
    }
    const blocked = cells.some((key) =>
      (grid.get(key) ?? []).some(
        (other) => box.x0 < other.x1 && box.x1 > other.x0 && box.y0 < other.y1 && box.y1 > other.y0,
      ),
    );
    if (blocked) continue;
    accepted.push(label);
    for (const key of cells) {
      const bucket = grid.get(key);
      if (bucket) bucket.push(box);
      else grid.set(key, [box]);
    }
  }
  return accepted;
}

// ---------------------------------------------------------------------------
// Barra de escala e malha de coordenadas
// ---------------------------------------------------------------------------

/** Maior valor "redondo" (1, 2 ou 5 × 10ⁿ) que não passa de `value`. */
export function roundDown125(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return 0;
  const power = 10 ** Math.floor(Math.log10(value));
  const mantissa = value / power;
  return (mantissa >= 5 ? 5 : mantissa >= 2 ? 2 : 1) * power;
}

export interface ScaleBar {
  /** Comprimento representado (m). */
  readonly meters: number;
  /** Comprimento na tela (px). */
  readonly pixels: number;
  readonly label: string;
}

/** Barra de escala gráfica da vista (zoom de navegação), com até `maxPixels` de largura. */
export function scaleBarFor(metersPerPixel: number, maxPixels = 140): ScaleBar {
  const meters = roundDown125(metersPerPixel * maxPixels);
  return {
    meters,
    pixels: meters / metersPerPixel,
    label:
      meters >= 1000 ? `${meters / 1000} km` : meters >= 1 ? `${meters} m` : `${meters * 100} cm`,
  };
}

/**
 * Escala numérica em que a vista aparece na tela, supondo 96 px por polegada (px do CSS). É
 * informativa: a escala de impressão é a escala de documentação, não o zoom.
 */
export function screenScaleOf(metersPerPixel: number): number {
  return metersPerPixel / (0.0254 / 96);
}

export interface GridLine {
  readonly axis: 'E' | 'N' | 'X' | 'Y';
  readonly value: number;
  /** Extremos da linha já recortados pela janela, em coordenadas locais (m). */
  readonly from: Point2;
  readonly to: Point2;
}

/** Recorta o segmento pela janela (Liang–Barsky); `null` = fora dela. */
function clip(a: Point2, b: Point2, bounds: ViewBounds): [Point2, Point2] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const tests: [number, number][] = [
    [-dx, a.x - bounds.minX],
    [dx, bounds.maxX - a.x],
    [-dy, a.y - bounds.minY],
    [dy, bounds.maxY - a.y],
  ];
  for (const [p, q] of tests) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      t0 = Math.max(t0, r);
    } else {
      if (r < t0) return null;
      t1 = Math.min(t1, r);
    }
  }
  return [
    { x: a.x + dx * t0, y: a.y + dy * t0 },
    { x: a.x + dx * t1, y: a.y + dy * t1 },
  ];
}

/**
 * Malha de coordenadas da janela: linhas de E e N constantes do sistema projetado quando o
 * projeto está georreferenciado (`transform`), ou de X e Y locais enquanto não está. O passo é
 * o valor redondo mais próximo de `targetPixels` na tela.
 */
export function coordinateGrid(
  bounds: ViewBounds,
  metersPerPixel: number,
  transform: GeoTransform | null,
  targetPixels = 160,
): { step: number; lines: GridLine[] } {
  const step = roundDown125(metersPerPixel * targetPixels);
  if (step <= 0) return { step: 0, lines: [] };
  const corners: Point2[] = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];
  const lines: GridLine[] = [];
  if (!transform) {
    for (let x = Math.ceil(bounds.minX / step) * step; x <= bounds.maxX; x += step) {
      lines.push({
        axis: 'X',
        value: x + 0,
        from: { x, y: bounds.minY },
        to: { x, y: bounds.maxY },
      });
    }
    for (let y = Math.ceil(bounds.minY / step) * step; y <= bounds.maxY; y += step) {
      lines.push({
        axis: 'Y',
        value: y + 0,
        from: { x: bounds.minX, y },
        to: { x: bounds.maxX, y },
      });
    }
    return { step, lines };
  }
  const projected = corners.map((corner) => transform.localToProjected(corner));
  const minE = Math.min(...projected.map((p) => p.e));
  const maxE = Math.max(...projected.map((p) => p.e));
  const minN = Math.min(...projected.map((p) => p.n));
  const maxN = Math.max(...projected.map((p) => p.n));
  for (let e = Math.ceil(minE / step) * step; e <= maxE; e += step) {
    const segment = clip(
      transform.projectedToLocal({ e, n: minN }),
      transform.projectedToLocal({ e, n: maxN }),
      bounds,
    );
    if (segment) lines.push({ axis: 'E', value: e, from: segment[0], to: segment[1] });
  }
  for (let n = Math.ceil(minN / step) * step; n <= maxN; n += step) {
    const segment = clip(
      transform.projectedToLocal({ e: minE, n }),
      transform.projectedToLocal({ e: maxE, n }),
      bounds,
    );
    if (segment) lines.push({ axis: 'N', value: n, from: segment[0], to: segment[1] });
  }
  return { step, lines };
}

/** Coordenada com separador de milhar e, abaixo de 1 m de passo, casas decimais. */
export function formatCoordinate(value: number, digits = 0): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * Interpreta "E; N" ou "X; Y" digitado para a navegação por coordenadas. Aceita vírgula
 * decimal, separador de milhar com ponto ou espaço e os separadores `;`, espaço ou tabulação.
 */
export function parseCoordinatePair(text: string): { a: number; b: number } | null {
  const tokens = text
    .trim()
    .split(/\s*;\s*|\s+(?=[-+]?\d)/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length !== 2) return null;
  const parse = (token: string): number => {
    const cleaned = token.replace(/\s/g, '');
    // "333.287,02" (milhar com ponto, decimal com vírgula) ou "333287.02".
    const normalized = cleaned.includes(',')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned;
    return /^[-+]?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
  };
  const a = parse(tokens[0] ?? '');
  const b = parse(tokens[1] ?? '');
  return Number.isFinite(a) && Number.isFinite(b) ? { a, b } : null;
}
