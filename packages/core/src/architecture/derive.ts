import type {
  ArchCategory,
  ArchElement,
  ArchElementKind,
  ArchType,
  Architecture,
  DoorOperation,
  FloorElement,
  HostedElement,
  Level,
  Point2,
  Project,
  Space,
  ViewCategory,
  Wall,
  WindowOperation,
} from '../schema';
import { polygonArea, ringArea } from '../terrain/polygon';
import { ringPerimeter } from './polygon2';
import {
  footprintArea,
  getArchElement,
  getArchType,
  hostedTypeOf,
  layersThickness,
  wallFootprint,
  wallLength,
  wallOpenings,
  wallTypeOf,
  wallVerticalRange,
} from './walls';

/**
 * Valores DERIVADOS dos elementos arquitetônicos: cotas, quantidades e rótulos. Nada aqui é
 * persistido — geometria calculada fica separada dos dados cadastrais do tipo e da ocorrência.
 */

export const ARCH_KIND_LABELS: Record<ArchElementKind, string> = {
  wall: 'Parede',
  slab: 'Laje',
  flooring: 'Piso',
  door: 'Porta',
  window: 'Janela',
  space: 'Ambiente',
};

export const ARCH_CATEGORY_LABELS: Record<ArchCategory, string> = {
  wall: 'Paredes',
  slab: 'Lajes de piso',
  flooring: 'Revestimentos de piso',
  door: 'Portas',
  window: 'Janelas',
};

export const DOOR_OPERATION_LABELS: Record<DoorOperation, string> = {
  singleSwing: 'Giro, uma folha',
  doubleSwing: 'Giro, duas folhas',
  sliding: 'Correr',
  pivot: 'Pivotante',
};

export const WINDOW_OPERATION_LABELS: Record<WindowOperation, string> = {
  fixed: 'Fixa',
  sliding: 'Correr',
  casement: 'Abrir',
  pivotHorizontal: 'Basculante',
  topHung: 'Maxim-ar',
};

const VIEW_CATEGORY: Record<ArchElementKind, ViewCategory> = {
  wall: 'walls',
  slab: 'floors',
  flooring: 'floors',
  door: 'doors',
  window: 'windows',
  space: 'spaces',
};

export const archViewCategoryOf = (element: ArchElement): ViewCategory =>
  VIEW_CATEGORY[element.kind];

/** Categoria de tipo exigida por cada ocorrência (ambientes não têm tipo). */
export const ARCH_KIND_CATEGORY: Record<Exclude<ArchElementKind, 'space'>, ArchCategory> = {
  wall: 'wall',
  slab: 'slab',
  flooring: 'flooring',
  door: 'door',
  window: 'window',
};

const levelElevation = (levels: readonly Level[], id: string): number =>
  levels.find((level) => level.id === id)?.elevation ?? 0;

/** Parede hospedeira de uma porta ou janela. */
export function hostWallOf(architecture: Architecture, element: HostedElement): Wall | undefined {
  const host = getArchElement(architecture, element.hostId);
  return host?.kind === 'wall' ? host : undefined;
}

/** Nível do elemento; portas e janelas herdam o da parede hospedeira. */
export function archLevelIdOf(architecture: Architecture, element: ArchElement): string | null {
  if (element.kind === 'door' || element.kind === 'window') {
    return hostWallOf(architecture, element)?.levelId ?? null;
  }
  return element.levelId;
}

/** Tipo do elemento (qualquer categoria); `undefined` em ambientes. */
export function archTypeOf(architecture: Architecture, element: ArchElement): ArchType | undefined {
  return element.kind === 'space' ? undefined : getArchType(architecture, element.typeId);
}

/** Cotas inferior e superior do elemento (m); `null` quando faltam o tipo ou a hospedeira. */
export function archVerticalRange(
  project: Pick<Project, 'levels' | 'architecture'>,
  element: ArchElement,
): { base: number; top: number } | null {
  const { levels, architecture } = project;
  switch (element.kind) {
    case 'wall':
      return wallVerticalRange(levels, element);
    case 'slab': {
      const type = getArchType(architecture, element.typeId);
      if (type?.category !== 'slab') return null;
      const top = levelElevation(levels, element.levelId) + element.offset;
      return { base: top - layersThickness(type), top };
    }
    case 'flooring': {
      const type = getArchType(architecture, element.typeId);
      if (type?.category !== 'flooring') return null;
      const base = levelElevation(levels, element.levelId) + element.offset;
      return { base, top: base + layersThickness(type) };
    }
    case 'door':
    case 'window': {
      const host = hostWallOf(architecture, element);
      const type = hostedTypeOf(architecture, element);
      if (!host || !type) return null;
      const base = wallVerticalRange(levels, host).base + element.sillHeight;
      return { base, top: base + type.height };
    }
    case 'space': {
      const base = levelElevation(levels, element.levelId) + element.offset;
      // Sem pé-direito informado a região não tem altura: a cota superior é a do piso.
      return { base, top: base + (element.height ?? 0) };
    }
  }
}

/** Pontos do elemento em planta (contorno, eixo ou vão): enquadramento e seleção. */
export function archPlanPoints(architecture: Architecture, element: ArchElement): Point2[] {
  switch (element.kind) {
    case 'wall':
      return wallFootprint(architecture, element)?.polygon ?? [element.start, element.end];
    case 'slab':
    case 'flooring':
    case 'space':
      return element.boundary;
    case 'door':
    case 'window': {
      const host = hostWallOf(architecture, element);
      const type = hostedTypeOf(architecture, element);
      if (!host || !type) return [];
      const length = wallLength(host) || 1;
      const dir = {
        x: (host.end.x - host.start.x) / length,
        y: (host.end.y - host.start.y) / length,
      };
      const at = (s: number): Point2 => ({
        x: host.start.x + dir.x * s,
        y: host.start.y + dir.y * s,
      });
      return [at(element.offset - type.width / 2), at(element.offset + type.width / 2)];
    }
  }
}

/** Caixa envolvente dos elementos arquitetônicos (m); `null` sem elementos. */
export function computeArchBounds(
  project: Pick<Project, 'levels' | 'architecture'>,
): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const element of project.architecture.elements) {
    const range = archVerticalRange(project, element);
    if (!range) continue;
    for (const p of archPlanPoints(project.architecture, element)) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    minZ = Math.min(minZ, range.base);
    maxZ = Math.max(maxZ, range.top);
  }
  if (!Number.isFinite(minX)) return null;
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

// ---------------------------------------------------------------------------
// Quantidades (critérios dos conjuntos Qto_*BaseQuantities do IFC 4.3)
// ---------------------------------------------------------------------------

/**
 * Quantidades da parede. Bruto = sem descontar vãos; líquido = descontados os vãos de portas
 * e janelas. O comprimento é o do plano médio (área do contorno ÷ espessura), que já
 * considera os encontros em bisel e em T.
 */
export interface WallQuantities {
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly grossFootprintArea: number;
  readonly netFootprintArea: number;
  readonly grossSideArea: number;
  readonly netSideArea: number;
  readonly grossVolume: number;
  readonly netVolume: number;
}

export function wallQuantities(architecture: Architecture, wall: Wall): WallQuantities | null {
  const type = wallTypeOf(architecture, wall);
  const footprint = wallFootprint(architecture, wall);
  if (!type || !footprint) return null;
  const width = layersThickness(type);
  const grossFootprintArea = footprintArea(footprint);
  const length = width > 0 ? grossFootprintArea / width : wallLength(wall);
  let openingArea = 0;
  let footprintCut = 0;
  for (const opening of wallOpenings(architecture, wall)) {
    const from = Math.max(opening.from, 0);
    const to = Math.min(opening.to, wallLength(wall));
    const bottom = Math.max(opening.bottom, 0);
    const top = Math.min(opening.top, wall.height);
    if (to <= from || top <= bottom) continue;
    openingArea += (to - from) * (top - bottom);
    // Só o vão que chega à base (porta) reduz a área de apoio da parede.
    if (bottom <= 1e-9) footprintCut += (to - from) * width;
  }
  const grossSideArea = length * wall.height;
  const grossVolume = grossFootprintArea * wall.height;
  return {
    length,
    width,
    height: wall.height,
    grossFootprintArea,
    netFootprintArea: Math.max(0, grossFootprintArea - footprintCut),
    grossSideArea,
    netSideArea: Math.max(0, grossSideArea - openingArea),
    grossVolume,
    netVolume: Math.max(0, grossVolume - openingArea * width),
  };
}

/** Quantidades de laje e de revestimento: bruto = contorno; líquido = contorno − aberturas. */
export interface FloorQuantities {
  readonly depth: number;
  readonly perimeter: number;
  readonly grossArea: number;
  readonly netArea: number;
  readonly grossVolume: number;
  readonly netVolume: number;
}

export function floorQuantities(
  architecture: Architecture,
  element: FloorElement,
): FloorQuantities | null {
  const type = getArchType(architecture, element.typeId);
  if (!type || (type.category !== 'slab' && type.category !== 'flooring')) return null;
  const depth = layersThickness(type);
  const grossArea = Math.abs(ringArea(element.boundary));
  const netArea = Math.max(
    0,
    polygonArea([element.boundary, ...element.openings.map((opening) => opening.boundary)]),
  );
  return {
    depth,
    perimeter: ringPerimeter(element.boundary),
    grossArea,
    netArea,
    grossVolume: grossArea * depth,
    netVolume: netArea * depth,
  };
}

export interface HostedQuantities {
  readonly width: number;
  readonly height: number;
  readonly perimeter: number;
  readonly area: number;
}

export function hostedQuantities(
  architecture: Architecture,
  element: HostedElement,
): HostedQuantities | null {
  const type = hostedTypeOf(architecture, element);
  if (!type) return null;
  return {
    width: type.width,
    height: type.height,
    perimeter: 2 * (type.width + type.height),
    area: type.width * type.height,
  };
}

/**
 * Quantidades do ambiente, pelo contorno desenhado: a área é a da região delimitada e não
 * soma paredes, lajes nem revestimentos (cada um tem o seu quantitativo, sem dupla contagem).
 * O volume só existe com o pé-direito informado.
 */
export interface SpaceQuantities {
  readonly area: number;
  readonly perimeter: number;
  readonly height: number | null;
  readonly volume: number | null;
}

export function spaceQuantities(space: Space): SpaceQuantities {
  const area = Math.abs(ringArea(space.boundary));
  return {
    area,
    perimeter: ringPerimeter(space.boundary),
    height: space.height,
    volume: space.height === null ? null : area * space.height,
  };
}

/** Ocorrências de um tipo. */
export const archTypeUsage = (architecture: Architecture, typeId: string): ArchElement[] =>
  architecture.elements.filter((element) => element.kind !== 'space' && element.typeId === typeId);

/** Dimensão característica do tipo, para listas e etiquetas (ex.: "15 cm", "0,80 × 2,10 m"). */
export function archTypeSizeLabel(type: ArchType): string {
  const fmt = (value: number, digits: number): string =>
    value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (type.category === 'door' || type.category === 'window') {
    return `${fmt(type.width, 2)} × ${fmt(type.height, 2)} m`;
  }
  return `${fmt(layersThickness(type) * 100, 1).replace(/,0$/, '')} cm`;
}
