import { newId } from '../ids';
import { now } from '../internal';
import { fail, ok, type DomainError, type Result } from '../result';
import {
  EarthworksSchema,
  type Earthworks,
  type Platform,
  type Point2,
  type Project,
  type Terrain,
} from '../schema';
import { designSurfaceFor, type DesignSurface, type PlatformFootprint } from './grading';
import { ringArea, validatePolygon } from './polygon';
import {
  earthworkQuantities,
  earthworkVolumes,
  sumCutFill,
  type EarthworkQuantities,
  type PlatformVolumes,
} from './volumes';

/**
 * Terraplenagem do projeto: operações sobre os platôs e os parâmetros de volume, e o quadro de
 * quantidades. O projeto guarda só os parâmetros (`project.earthworks`); o terreno projetado,
 * os taludes e os volumes são derivados deles e da superfície natural.
 */

export interface PlatformInput {
  readonly name?: string;
  readonly outline: readonly Point2[];
  readonly elevation: number;
  readonly cutSlope: number;
  readonly fillSlope: number;
}

const NO_TERRAIN = fail(
  'EARTHWORKS_NO_TERRAIN',
  'O projeto não tem superfície de terreno: gere ou importe o terreno antes de criar platôs.',
);

function nextPlatformName(platforms: readonly Platform[]): string {
  const used = new Set(platforms.map((p) => p.name));
  for (let i = platforms.length + 1; ; i += 1) {
    const name = `Platô ${i}`;
    if (!used.has(name)) return name;
  }
}

function checkPlatform(input: PlatformInput): Result<Point2[]> {
  if (!Number.isFinite(input.elevation)) {
    return fail('PLATFORM_PARAMETERS', 'Informe a cota de implantação do platô.');
  }
  if (!(input.cutSlope > 0) || !(input.fillSlope > 0)) {
    return fail(
      'PLATFORM_PARAMETERS',
      'Os taludes de corte e de aterro (H:V) devem ser maiores que zero.',
    );
  }
  const checked = validatePolygon([input.outline]);
  if (!checked.ok) return checked;
  return ok(checked.value[0] as Point2[]);
}

/** Grava os platôs se o platô `id` puder ser gerado sobre o terreno (com os anteriores). */
function commit(
  project: Project,
  terrain: Terrain,
  platforms: Platform[],
  id: string,
): Result<Project> {
  const design = designSurfaceFor(terrain, platforms);
  const failure = design.failures.find((f) => f.platformId === id);
  if (failure) return { ok: false, error: failure.error };
  return ok({ ...project, updatedAt: now(), earthworks: { ...project.earthworks, platforms } });
}

export function addPlatform(
  project: Project,
  input: PlatformInput,
): Result<{ project: Project; platformId: string }> {
  const terrain = project.terrain;
  if (!terrain) return NO_TERRAIN;
  const outline = checkPlatform(input);
  if (!outline.ok) return outline;
  const platform: Platform = {
    id: newId(),
    name: input.name?.trim() || nextPlatformName(project.earthworks.platforms),
    outline: outline.value,
    elevation: input.elevation,
    cutSlope: input.cutSlope,
    fillSlope: input.fillSlope,
  };
  const next = commit(project, terrain, [...project.earthworks.platforms, platform], platform.id);
  return next.ok ? ok({ project: next.value, platformId: platform.id }) : next;
}

export function updatePlatform(
  project: Project,
  id: string,
  patch: Partial<PlatformInput>,
): Result<Project> {
  const terrain = project.terrain;
  if (!terrain) return NO_TERRAIN;
  const current = project.earthworks.platforms.find((p) => p.id === id);
  if (!current) return fail('PLATFORM_UNKNOWN', 'O platô não existe mais no projeto.');
  const merged = {
    name: patch.name ?? current.name,
    outline: patch.outline ?? current.outline,
    elevation: patch.elevation ?? current.elevation,
    cutSlope: patch.cutSlope ?? current.cutSlope,
    fillSlope: patch.fillSlope ?? current.fillSlope,
  };
  const outline = checkPlatform(merged);
  if (!outline.ok) return outline;
  const name = merged.name.trim();
  if (name.length === 0) return fail('PLATFORM_NAME', 'Dê um nome ao platô.');
  const platform: Platform = { ...current, ...merged, name, outline: outline.value };
  return commit(
    project,
    terrain,
    project.earthworks.platforms.map((p) => (p.id === id ? platform : p)),
    id,
  );
}

export function removePlatform(project: Project, id: string): Result<Project> {
  const platforms = project.earthworks.platforms.filter((p) => p.id !== id);
  if (platforms.length === project.earthworks.platforms.length) {
    return fail('PLATFORM_UNKNOWN', 'O platô não existe mais no projeto.');
  }
  return ok({ ...project, updatedAt: now(), earthworks: { ...project.earthworks, platforms } });
}

/** Empolamento, fator de conversão e aproveitamento (`null` = não informado). */
export function setEarthworkSettings(
  project: Project,
  patch: Partial<Pick<Earthworks, 'swellPercent' | 'compactionFactor' | 'reusePercent'>>,
): Result<Project> {
  const parsed = EarthworksSchema.safeParse({ ...project.earthworks, ...patch });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return fail(
      'EARTHWORKS_SETTINGS',
      field === 'swellPercent'
        ? 'O empolamento deve ficar entre 0 e 200 %.'
        : field === 'reusePercent'
          ? 'O aproveitamento deve ficar entre 0 e 100 %.'
          : 'O fator de conversão (aterro compactado por corte in situ) deve ser maior que zero e no máximo 2.',
    );
  }
  return ok({ ...project, updatedAt: now(), earthworks: parsed.data });
}

export interface PlatformEarthwork {
  readonly platform: Platform;
  /** `null` quando o platô não pôde ser gerado (ver `error`). */
  readonly footprint: PlatformFootprint | null;
  readonly volumes: PlatformVolumes | null;
  readonly quantities: EarthworkQuantities | null;
  /** Área em planta do platô (m²). */
  readonly area: number;
  readonly error: DomainError | null;
}

export interface EarthworkSummary {
  readonly design: DesignSurface;
  readonly platforms: readonly PlatformEarthwork[];
  /** Total do projeto (soma dos platôs gerados). */
  readonly total: EarthworkQuantities;
}

const summaryCache = new WeakMap<DesignSurface, WeakMap<Earthworks, EarthworkSummary>>();

/**
 * Terreno projetado e quadro de quantidades do projeto; `null` sem superfície de terreno. O
 * resultado é guardado enquanto o terreno e a terraplenagem do projeto forem os mesmos.
 */
export function projectEarthworks(project: Project): EarthworkSummary | null {
  const { terrain, earthworks } = project;
  if (!terrain) return null;
  const design = designSurfaceFor(terrain, earthworks.platforms);
  let bySettings = summaryCache.get(design);
  if (!bySettings) {
    bySettings = new WeakMap();
    summaryCache.set(design, bySettings);
  }
  const cached = bySettings.get(earthworks);
  if (cached) return cached;
  const volumes = earthworkVolumes(terrain, design, { solids: true });
  const platforms = earthworks.platforms.map((platform, index): PlatformEarthwork => {
    const footprint = design.footprints.find((f) => f.index === index) ?? null;
    const own = volumes.find((v) => v.index === index) ?? null;
    return {
      platform,
      footprint,
      volumes: own,
      quantities: own ? earthworkQuantities(own, earthworks) : null,
      area: Math.abs(ringArea(platform.outline)),
      error: design.failures.find((f) => f.platformId === platform.id)?.error ?? null,
    };
  });
  const summary: EarthworkSummary = {
    design,
    platforms,
    total: earthworkQuantities(sumCutFill(volumes), earthworks),
  };
  bySettings.set(earthworks, summary);
  return summary;
}

/** Terreno projetado do projeto (o natural, quando não há platôs); `null` sem superfície. */
export function designTerrainOf(project: Project): Terrain | null {
  return project.terrain
    ? designSurfaceFor(project.terrain, project.earthworks.platforms).terrain
    : null;
}

/**
 * Superfície de referência das cotas de terreno: o terreno NATURAL (como levantado) ou o
 * PROJETADO (o natural modificado pelos platôs — o terreno acabado). Sem platôs gerados as
 * duas são a mesma superfície.
 */
export type GroundSurface = 'natural' | 'design';

export const GROUND_SURFACES: readonly GroundSurface[] = ['design', 'natural'];

export const GROUND_SURFACE_LABELS: Record<GroundSurface, string> = {
  natural: 'terreno natural',
  design: 'terreno projetado',
};

/** Abreviaturas usadas em rótulos, perfis e camadas: TN (natural) e TP (projetado). */
export const GROUND_SURFACE_SHORT: Record<GroundSurface, string> = {
  natural: 'TN',
  design: 'TP',
};

export function groundSurfaceOf(project: Project, which: GroundSurface): Terrain | null {
  return which === 'natural' ? project.terrain : designTerrainOf(project);
}

/**
 * O terreno projetado difere do natural (há ao menos um platô gerado)? Sem isso não há o que
 * distinguir, e a interface mostra uma só cota de terreno.
 */
export function hasDesignTerrain(project: Project): boolean {
  if (!project.terrain || project.earthworks.platforms.length === 0) return false;
  return designSurfaceFor(project.terrain, project.earthworks.platforms).footprints.length > 0;
}
