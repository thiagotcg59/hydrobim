import { fail, type Result } from '../result';
import type { ArchElement, ArchElementKind, Point2, Project } from '../schema';
import { GROUND_SURFACE_LABELS, groundSurfaceOf, type GroundSurface } from '../terrain/earthworks';
import { terrainElevationAt } from '../terrain/surface';
import { ARCH_KIND_LABELS } from './derive';
import { updateArchElement } from './ops';
import { getArchElement, getArchType, layersThickness } from './walls';

/**
 * Assentamento da arquitetura sobre o terreno (natural ou projetado).
 *
 * Paredes, lajes, pisos e ambientes têm base HORIZONTAL: o assentamento leva a face inferior
 * do elemento à cota do terreno em UM ponto de referência — o primeiro ponto do traçado ou do
 * contorno (o início da parede). Em terreno inclinado o restante da base fica acima ou abaixo
 * da superfície; nada é inclinado nem recortado. O resultado é gravado como o deslocamento em
 * relação ao nível (o elemento não fica vinculado ao terreno: se a superfície mudar, assenta-se
 * de novo). Portas e janelas acompanham a parede hospedeira.
 */

export type SeatableArchKind = Exclude<ArchElementKind, 'door' | 'window' | 'roof'>;

const roundMm = (value: number): number => Math.round(value * 1000) / 1000;

/** Ponto de referência do assentamento; `null` em portas e janelas (seguem a hospedeira). */
export function archSeatPoint(element: ArchElement): Point2 | null {
  switch (element.kind) {
    case 'wall':
      return element.start;
    case 'slab':
    case 'flooring':
    case 'space':
      return element.boundary[0] ?? null;
    default:
      return null;
  }
}

/** Cota (mm) do terreno escolhido no ponto; `null` sem superfície ou fora dela. */
export function archGroundElevationAt(
  project: Project,
  surface: GroundSurface,
  point: Point2,
): number | null {
  const terrain = groundSurfaceOf(project, surface);
  if (!terrain) return null;
  const ground = terrainElevationAt(terrain, point.x, point.y);
  return ground === null ? null : roundMm(ground);
}

/**
 * Deslocamento em relação ao nível (`baseOffset` da parede, `offset` dos demais) que põe a
 * face INFERIOR do elemento na cota `base`. Na laje o parâmetro gravado é a cota do topo, por
 * isso soma a espessura do tipo. `null` quando faltam o nível ou o tipo.
 */
export function archOffsetForBase(
  project: Pick<Project, 'levels' | 'architecture'>,
  target: { kind: SeatableArchKind; levelId: string; typeId?: string },
  base: number,
): number | null {
  const level = project.levels.find((item) => item.id === target.levelId);
  if (!level) return null;
  let thickness = 0;
  if (target.kind === 'slab') {
    const type = target.typeId ? getArchType(project.architecture, target.typeId) : undefined;
    if (type?.category !== 'slab') return null;
    thickness = layersThickness(type);
  }
  return roundMm(base - level.elevation + thickness);
}

/**
 * Deslocamento de um elemento NOVO assentado no terreno: base = terreno no ponto de referência
 * + `clearance` (folga acima do terreno; negativa = enterrado). `null` sem superfície, fora
 * dela ou sem nível/tipo.
 */
export function archSeatOffset(
  project: Project,
  surface: GroundSurface,
  target: { kind: SeatableArchKind; levelId: string; typeId?: string },
  point: Point2,
  clearance = 0,
): { offset: number; ground: number; base: number } | null {
  const ground = archGroundElevationAt(project, surface, point);
  if (ground === null) return null;
  const base = roundMm(ground + clearance);
  const offset = archOffsetForBase(project, target, base);
  return offset === null ? null : { offset, ground, base };
}

/** Assenta um elemento existente: leva a base à cota do terreno no ponto de referência. */
export function seatArchElement(
  project: Project,
  id: string,
  surface: GroundSurface,
  clearance = 0,
): Result<Project> {
  const element = getArchElement(project.architecture, id);
  if (!element) return fail('ARCH_ELEMENT_NOT_FOUND', 'Elemento inexistente.');
  if (element.kind === 'door' || element.kind === 'window') {
    return fail(
      'ARCH_NOT_SEATABLE',
      `${ARCH_KIND_LABELS[element.kind]}: a cota acompanha a parede hospedeira; assente a parede.`,
    );
  }
  if (element.kind === 'roof') {
    return fail(
      'ARCH_NOT_SEATABLE',
      'Telhado: a cota de referência é a do nível mais o deslocamento; não assenta no terreno.',
    );
  }
  if (!groundSurfaceOf(project, surface)) {
    return fail('NO_TERRAIN', 'O projeto não tem superfície de terreno.');
  }
  const point = archSeatPoint(element);
  const seat = point
    ? archSeatOffset(
        project,
        surface,
        {
          kind: element.kind,
          levelId: element.levelId,
          ...(element.kind === 'space' ? {} : { typeId: element.typeId }),
        },
        point,
        clearance,
      )
    : null;
  if (!seat) {
    return fail(
      'OUTSIDE_TERRAIN',
      `O ponto de referência de "${element.name}" está fora da superfície do ${GROUND_SURFACE_LABELS[surface]}.`,
    );
  }
  return element.kind === 'wall'
    ? updateArchElement(project, id, { baseOffset: seat.offset })
    : updateArchElement(project, id, { offset: seat.offset });
}
