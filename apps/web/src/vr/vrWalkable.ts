import {
  archVerticalRange,
  archViewCategoryOf,
  computeArchBounds,
  computeBounds,
  pointOnFloor,
  terrainStats,
  type Project,
  type Terrain,
  type Vec3,
  type ViewCategory,
} from '@hydrobim/core';
import { visibleElementsOf } from '../editor/visibility';
import { groundAt, initialPose } from '../walk/walkMotion';

/**
 * Onde o usuário pode pisar na realidade virtual, em coordenadas do projeto. Só o que o modelo
 * declara como piso é caminhável: a superfície do terreno e as lajes e pisos da arquitetura.
 * Uma malha horizontal qualquer (o topo de um reservatório, um flange) não é piso. Projeto sem
 * nenhum dos dois recebe um piso virtual de navegação, que não entra no modelo.
 */

export interface WalkSurface {
  readonly id: string;
  readonly kind: 'terrain' | 'floor' | 'virtual';
  readonly label: string;
  /** Cota da superfície em (x, y), ou `null` fora dela. */
  heightAt(x: number, y: number): number | null;
}

/** Declividade máxima do terreno em que se aceita o teletransporte (rad): 35°. */
export const MAX_WALK_SLOPE = (35 * Math.PI) / 180;

export interface WalkSurfaceOptions {
  /** Superfície do terreno à mostra (natural ou projetada), ou `null` se oculta. */
  readonly terrain: Terrain | null;
  readonly exaggeration?: number;
  readonly hiddenCategories?: ReadonlySet<ViewCategory>;
  /** Cota do piso virtual, usado quando o projeto não tem terreno nem pisos à mostra. */
  readonly virtualElevation: number;
}

export function walkSurfacesOf(
  project: Pick<Project, 'levels' | 'architecture'>,
  options: WalkSurfaceOptions,
): WalkSurface[] {
  const surfaces: WalkSurface[] = [];
  const { terrain, exaggeration = 1 } = options;
  if (terrain) {
    surfaces.push({
      id: 'terrain',
      kind: 'terrain',
      label: 'Terreno',
      heightAt: (x, y) => groundAt(terrain, x, y, exaggeration)?.drawn ?? null,
    });
  }
  for (const element of project.architecture.elements) {
    if (element.kind !== 'slab' && element.kind !== 'flooring') continue;
    if (options.hiddenCategories?.has(archViewCategoryOf(element))) continue;
    const range = archVerticalRange(project, element);
    if (!range) continue;
    surfaces.push({
      id: element.id,
      kind: 'floor',
      label: element.name,
      heightAt: (x, y) => (pointOnFloor(element, { x, y }) ? range.top : null),
    });
  }
  if (surfaces.length === 0) {
    surfaces.push({
      id: 'virtual',
      kind: 'virtual',
      label: 'Piso virtual de navegação',
      heightAt: () => options.virtualElevation,
    });
  }
  return surfaces;
}

/** Cota de apoio em (x, y): a superfície mais alta que não passa de `below` (com folga). */
export function supportAt(
  surfaces: readonly WalkSurface[],
  x: number,
  y: number,
  below = Infinity,
): number | null {
  let best: number | null = null;
  for (const surface of surfaces) {
    const height = surface.heightAt(x, y);
    if (height === null || height > below + 0.3) continue;
    if (best === null || height > best) best = height;
  }
  return best;
}

/** `none`: o arco não chega a nenhuma superfície caminhável. `steep`: terreno íngreme demais. */
export type TeleportRejection = 'none' | 'steep';

export interface TeleportTarget {
  readonly valid: boolean;
  /** Ponto de chegada (projeto); `null` quando o arco não encontra superfície caminhável. */
  readonly point: Vec3 | null;
  readonly surface: WalkSurface | null;
  /** Índice do último ponto do arco antes da chegada (para desenhar só até ali). */
  readonly segment: number;
  readonly reason: TeleportRejection | null;
}

/** Declividade da superfície em torno de (x, y), por diferenças finitas (rad). */
export function slopeAt(surface: WalkSurface, x: number, y: number, step = 0.5): number {
  const sample = (dx: number, dy: number): number | null => surface.heightAt(x + dx, y + dy);
  const pair = (a: number | null, b: number | null, span: number): number =>
    a !== null && b !== null ? (b - a) / span : 0;
  const center = surface.heightAt(x, y);
  // Na borda da superfície usa-se o ponto central no lugar do vizinho que falta.
  const gx = pair(sample(-step, 0) ?? center, sample(step, 0) ?? center, 2 * step);
  const gy = pair(sample(0, -step) ?? center, sample(0, step) ?? center, 2 * step);
  return Math.atan(Math.hypot(gx, gy));
}

/**
 * Onde o arco do teletransporte (pontos em coordenadas do projeto, na ordem do percurso) chega
 * a uma superfície caminhável, descendo sobre ela. A primeira superfície encontrada vale; um
 * ponto em terreno íngreme é recusado, com o motivo.
 */
export function findTeleportTarget(
  arc: readonly Vec3[],
  surfaces: readonly WalkSurface[],
): TeleportTarget {
  for (let i = 0; i + 1 < arc.length; i += 1) {
    const a = arc[i];
    const b = arc[i + 1];
    if (!a || !b) continue;
    let hit: { t: number; surface: WalkSurface } | null = null;
    for (const surface of surfaces) {
      const ha = surface.heightAt(a.x, a.y);
      const hb = surface.heightAt(b.x, b.y);
      if (hb === null) continue;
      // Só conta a travessia de cima para baixo: o arco não atravessa o piso por baixo.
      const above = ha === null ? a.z - hb : a.z - ha;
      const below = b.z - hb;
      if (above < 0 || below >= 0) continue;
      // Refino por bisseção: a superfície do terreno não é plana entre os dois pontos.
      let lo = 0;
      let hi = 1;
      for (let step = 0; step < 6; step += 1) {
        const mid = (lo + hi) / 2;
        const x = a.x + (b.x - a.x) * mid;
        const y = a.y + (b.y - a.y) * mid;
        const h = surface.heightAt(x, y);
        if (h === null || a.z + (b.z - a.z) * mid - h < 0) hi = mid;
        else lo = mid;
      }
      if (!hit || hi < hit.t) hit = { t: hi, surface };
    }
    if (!hit) continue;
    const x = a.x + (b.x - a.x) * hit.t;
    const y = a.y + (b.y - a.y) * hit.t;
    const z = hit.surface.heightAt(x, y) ?? a.z + (b.z - a.z) * hit.t;
    const steep = hit.surface.kind === 'terrain' && slopeAt(hit.surface, x, y) > MAX_WALK_SLOPE;
    return {
      valid: !steep,
      point: { x, y, z },
      surface: hit.surface,
      segment: i,
      reason: steep ? 'steep' : null,
    };
  }
  return { valid: false, point: null, surface: null, segment: arc.length - 1, reason: 'none' };
}

/** Arco balístico do teletransporte, no espaço de referência da sessão (Y para cima). */
export function teleportArc(
  origin: Vec3,
  direction: Vec3,
  options: { speed?: number; gravity?: number; step?: number; count?: number } = {},
): Vec3[] {
  const { speed = 9, gravity = 9.8, step = 0.05, count = 40 } = options;
  const points: Vec3[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i * step;
    points.push({
      x: origin.x + direction.x * speed * t,
      y: origin.y + direction.y * speed * t - 0.5 * gravity * t * t,
      z: origin.z + direction.z * speed * t,
    });
  }
  return points;
}

export interface VrStart {
  /** Ponto de partida (projeto), na cota do apoio. */
  readonly feet: Vec3;
  /** Rumo em planta para onde o usuário começa olhando (rad a partir de +X). */
  readonly heading: number;
  /** Centro do que há para ver, usado ao recentrar; `null` em projeto vazio. */
  readonly focus: Vec3 | null;
  /** Cota do piso virtual, para projetos sem terreno nem pisos. */
  readonly virtualElevation: number;
}

/**
 * Ponto de partida da sessão: ao sul do modelo, olhando para o norte (o mesmo critério do
 * Percurso), apoiado no terreno ou no piso sob o ponto — ou no piso virtual.
 */
export function vrStartOf(
  project: Project,
  options: {
    terrain: Terrain | null;
    exaggeration?: number;
    workPlaneZ: number;
    hiddenCategories?: ReadonlySet<ViewCategory>;
  },
): VrStart {
  let bounds = computeBounds(visibleElementsOf(project));
  const arch = computeArchBounds(project);
  if (arch) {
    bounds = bounds
      ? {
          min: {
            x: Math.min(bounds.min.x, arch.min.x),
            y: Math.min(bounds.min.y, arch.min.y),
            z: Math.min(bounds.min.z, arch.min.z),
          },
          max: {
            x: Math.max(bounds.max.x, arch.max.x),
            y: Math.max(bounds.max.y, arch.max.y),
            z: Math.max(bounds.max.z, arch.max.z),
          },
        }
      : arch;
  }
  let pose = initialPose(bounds);
  let focus: Vec3 | null = null;
  let virtualElevation = options.workPlaneZ;
  if (bounds) {
    focus = {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2,
    };
    // O plano de trabalho só serve de piso virtual se estiver junto do modelo.
    if (options.workPlaneZ < bounds.min.z - 5 || options.workPlaneZ > bounds.max.z + 5) {
      virtualElevation = bounds.min.z;
    }
  } else if (options.terrain) {
    const stats = terrainStats(options.terrain);
    const center = { x: (stats.minX + stats.maxX) / 2, y: (stats.minY + stats.maxY) / 2 };
    pose = { ...pose, x: center.x, y: center.y };
    focus = { x: center.x, y: center.y + 10, z: stats.minZ };
  }
  const surfaces = walkSurfacesOf(project, {
    terrain: options.terrain,
    exaggeration: options.exaggeration,
    hiddenCategories: options.hiddenCategories,
    virtualElevation,
  });
  // Fora de qualquer superfície (ao lado da edificação, além do terreno): a cota do apoio mais
  // próximo do modelo, ou o piso virtual.
  const support =
    supportAt(surfaces, pose.x, pose.y) ??
    (focus ? supportAt(surfaces, focus.x, focus.y) : null) ??
    virtualElevation;
  return {
    feet: { x: pose.x, y: pose.y, z: support },
    heading: pose.yaw,
    focus,
    virtualElevation,
  };
}
