import type {
  ArchElement,
  ArchType,
  ArchWindow,
  Architecture,
  Door,
  DoorType,
  HostedElement,
  LayeredArchType,
  Level,
  Point2,
  Wall,
  WallType,
  WindowType,
} from '../schema';
import { ringArea } from '../terrain/polygon';
import { add2, cross2, distance2, dot2, intersectLines, length2, scale2, sub2 } from './polygon2';

/**
 * Geometria DERIVADA das paredes: referencial, espessura, encontros em L e em T com as
 * vizinhas, contorno em planta e vãos das portas e janelas hospedadas. Nada disto é gravado:
 * mover ou editar uma parede atualiza, por construção, os encontros e os elementos hospedados.
 */

/** Extremidades mais próximas que isto (m) são o mesmo nó. */
export const WALL_NODE_TOLERANCE = 1e-3;
/** Menor comprimento de parede aceito (m). */
export const MIN_WALL_LENGTH = 0.05;
/** Um encontro em bisel não se estende além deste múltiplo da espessura. */
const MITER_LIMIT = 4;

export const getArchType = (
  architecture: Pick<Architecture, 'types'>,
  id: string,
): ArchType | undefined => architecture.types.find((type) => type.id === id);

export const getArchElement = (
  architecture: Pick<Architecture, 'elements'>,
  id: string,
): ArchElement | undefined => architecture.elements.find((element) => element.id === id);

/** Espessura de um tipo em camadas: a soma das camadas (m). */
export const layersThickness = (type: Pick<LayeredArchType, 'layers'>): number =>
  type.layers.reduce((sum, layer) => sum + layer.thickness, 0);

export const isHosted = (element: ArchElement): element is HostedElement =>
  element.kind === 'door' || element.kind === 'window';

export function wallTypeOf(architecture: Architecture, wall: Wall): WallType | undefined {
  const type = getArchType(architecture, wall.typeId);
  return type?.category === 'wall' ? type : undefined;
}

export function hostedTypeOf(
  architecture: Architecture,
  element: HostedElement,
): DoorType | WindowType | undefined {
  const type = getArchType(architecture, element.typeId);
  if (element.kind === 'door') return type?.category === 'door' ? type : undefined;
  return type?.category === 'window' ? type : undefined;
}

export const wallLength = (wall: Pick<Wall, 'start' | 'end'>): number =>
  distance2(wall.start, wall.end);

/** Direção unitária da parede (início → fim) e normal à esquerda. */
export function wallAxes(wall: Pick<Wall, 'start' | 'end'>): { dir: Point2; left: Point2 } {
  const delta = sub2(wall.end, wall.start);
  const size = length2(delta) || 1;
  const dir = { x: delta.x / size, y: delta.y / size };
  return { dir, left: { x: -dir.y, y: dir.x } };
}

/**
 * Posição das faces em relação à linha de referência, ao longo da normal à esquerda:
 * `lo` é a face direita e `hi` a face esquerda (hi − lo = espessura).
 */
export function wallFaceOffsets(
  wall: Pick<Wall, 'locationLine'>,
  thickness: number,
): { lo: number; hi: number } {
  if (wall.locationLine === 'faceLeft') return { lo: -thickness, hi: 0 };
  if (wall.locationLine === 'faceRight') return { lo: 0, hi: thickness };
  return { lo: -thickness / 2, hi: thickness / 2 };
}

/** Cotas da base e do topo da parede (m). */
export function wallVerticalRange(
  levels: readonly Level[],
  wall: Pick<Wall, 'levelId' | 'baseOffset' | 'height'>,
): { base: number; top: number } {
  const elevation = levels.find((level) => level.id === wall.levelId)?.elevation ?? 0;
  const base = elevation + wall.baseOffset;
  return { base, top: base + wall.height };
}

interface WallEndShape {
  /** Vértices da extremidade, do lado direito (`lo`) para o esquerdo (`hi`). */
  readonly points: readonly Point2[];
  readonly join: 'free' | 'corner' | 'tee';
}

interface WallBody {
  readonly wall: Wall;
  readonly thickness: number;
  readonly lo: number;
  readonly hi: number;
  readonly dir: Point2;
  readonly left: Point2;
}

function bodyOf(architecture: Architecture, wall: Wall): WallBody | null {
  const type = wallTypeOf(architecture, wall);
  if (!type || wallLength(wall) < 1e-9) return null;
  const thickness = layersThickness(type);
  return { wall, thickness, ...wallFaceOffsets(wall, thickness), ...wallAxes(wall) };
}

/** Ponto da face da parede (`offset` na normal) na altura do ponto de referência `at`. */
const facePoint = (body: WallBody, at: Point2, offset: number): Point2 =>
  add2(at, scale2(body.left, offset));

/**
 * Forma de uma extremidade da parede, considerando as vizinhas do mesmo nível:
 *  - outra parede com extremidade no mesmo nó → canto em bisel (L); com três ou mais, cada
 *    face encontra a face da vizinha seguinte em torno do nó;
 *  - extremidade apoiada no corpo de outra parede → topo na face próxima dela (T);
 *  - caso contrário, extremidade livre, em esquadro.
 */
function endShape(body: WallBody, atStart: boolean, neighbours: readonly WallBody[]): WallEndShape {
  const node = atStart ? body.wall.start : body.wall.end;
  // `away` aponta do nó para dentro da parede; `side` converte esquerda/direita da parede
  // em esquerda/direita de quem sai do nó.
  const away = atStart ? body.dir : scale2(body.dir, -1);
  const square: Point2[] = [facePoint(body, node, body.lo), facePoint(body, node, body.hi)];
  const limit = MITER_LIMIT * Math.max(body.thickness, 1e-6);

  interface Arm {
    readonly body: WallBody;
    readonly away: Point2;
    readonly node: Point2;
    readonly angle: number;
  }
  const arms: Arm[] = [];
  for (const other of neighbours) {
    if (other.wall.id === body.wall.id) continue;
    for (const end of [true, false]) {
      const point = end ? other.wall.start : other.wall.end;
      if (distance2(point, node) > WALL_NODE_TOLERANCE) continue;
      const otherAway = end ? other.dir : scale2(other.dir, -1);
      arms.push({
        body: other,
        away: otherAway,
        node: point,
        angle: Math.atan2(otherAway.y, otherAway.x),
      });
    }
  }

  // Face de um braço do lado anti-horário (+1) ou horário (−1) de quem sai do nó.
  const faceLine = (arm: Arm, sideSign: 1 | -1): { point: Point2; dir: Point2 } => {
    // A normal à esquerda de `away` é ±left, conforme o braço saia pelo início ou pelo fim.
    const sameSense = dot2(arm.away, arm.body.dir) > 0;
    const leftOfAway = sameSense ? 1 : -1;
    const offset = sideSign * leftOfAway > 0 ? arm.body.hi : arm.body.lo;
    return { point: facePoint(arm.body, arm.node, offset), dir: arm.away };
  };

  if (arms.length > 0) {
    const self: Arm = { body, away, node, angle: Math.atan2(away.y, away.x) };
    const turn = (arm: Arm): number => {
      let delta = arm.angle - self.angle;
      while (delta <= 1e-9) delta += Math.PI * 2;
      return delta;
    };
    // Vizinho seguinte no sentido anti-horário e no sentido horário.
    const ccw = arms.reduce((best, arm) => (turn(arm) < turn(best) ? arm : best));
    const cw = arms.reduce((best, arm) => (turn(arm) > turn(best) ? arm : best));
    const corner = (sideSign: 1 | -1, other: Arm): Point2 | null => {
      const mine = faceLine(self, sideSign);
      const theirs = faceLine(other, sideSign === 1 ? -1 : 1);
      const hit = intersectLines(mine.point, mine.dir, theirs.point, theirs.dir);
      return hit && distance2(hit, node) <= limit + Math.max(other.body.thickness, 0) ? hit : null;
    };
    const leftCorner = corner(1, ccw);
    const rightCorner = corner(-1, cw);
    if (leftCorner && rightCorner) {
      // Esquerda/direita de quem sai do nó → faces `hi`/`lo` da parede.
      const sameSense = atStart;
      const hiPoint = sameSense ? leftCorner : rightCorner;
      const loPoint = sameSense ? rightCorner : leftCorner;
      // Com três ou mais paredes o nó fecha a cunha entre os dois cantos.
      const points = arms.length >= 2 ? [loPoint, node, hiPoint] : [loPoint, hiPoint];
      return { points, join: 'corner' };
    }
    return { points: square, join: 'free' };
  }

  // Encontro em T: a extremidade está sobre o corpo de outra parede (fora das pontas dela).
  for (const other of neighbours) {
    if (other.wall.id === body.wall.id) continue;
    const rel = sub2(node, other.wall.start);
    const along = dot2(rel, other.dir);
    const across = dot2(rel, other.left);
    const length = wallLength(other.wall);
    if (along <= WALL_NODE_TOLERANCE || along >= length - WALL_NODE_TOLERANCE) continue;
    if (across < other.lo - WALL_NODE_TOLERANCE || across > other.hi + WALL_NODE_TOLERANCE) {
      continue;
    }
    const sine = cross2(other.dir, away);
    if (Math.abs(sine) < 0.05) continue; // quase paralelas: não há topo definido
    // A parede chega pelo lado esquerdo da outra quando `away` aponta para a esquerda dela.
    const faceOffset = sine > 0 ? other.hi : other.lo;
    const facePointOnOther = add2(other.wall.start, scale2(other.left, faceOffset));
    const lo = intersectLines(
      facePoint(body, node, body.lo),
      body.dir,
      facePointOnOther,
      other.dir,
    );
    const hi = intersectLines(
      facePoint(body, node, body.hi),
      body.dir,
      facePointOnOther,
      other.dir,
    );
    if (lo && hi) return { points: [lo, hi], join: 'tee' };
  }
  return { points: square, join: 'free' };
}

export interface WallFootprint {
  /** Contorno em planta (anti-horário), em coordenadas do projeto. */
  readonly polygon: Point2[];
  readonly startJoin: WallEndShape['join'];
  readonly endJoin: WallEndShape['join'];
  /**
   * Trecho do eixo (distância a partir de `start`) em que a seção é completa nas duas faces:
   * os vãos de portas e janelas têm de caber nele.
   */
  readonly clear: { from: number; to: number };
}

/** Paredes do mesmo nível, que podem formar encontro com a parede dada. */
function levelBodies(architecture: Architecture, wall: Wall): WallBody[] {
  const bodies: WallBody[] = [];
  for (const element of architecture.elements) {
    if (element.kind !== 'wall' || element.levelId !== wall.levelId) continue;
    const body = bodyOf(architecture, element);
    if (body) bodies.push(body);
  }
  return bodies;
}

/** Contorno em planta da parede, com os encontros resolvidos; `null` se o tipo não existe. */
export function wallFootprint(architecture: Architecture, wall: Wall): WallFootprint | null {
  const body = bodyOf(architecture, wall);
  if (!body) return null;
  const neighbours = levelBodies(architecture, wall);
  const startEnd = endShape(body, true, neighbours);
  const endEnd = endShape(body, false, neighbours);
  // Início: do lado `lo` para o `hi`; fim: percorrido ao contrário para fechar o anel.
  const ring = [...[...startEnd.points].reverse(), ...endEnd.points];
  // Ordem resultante: hi(início) … lo(início), lo(fim) … hi(fim) → horário quando `left`
  // está à esquerda; normaliza para anti-horário.
  const polygon = ringArea(ring) < 0 ? ring.reverse() : ring;
  const along = (p: Point2): number => dot2(sub2(p, wall.start), body.dir);
  const from = Math.max(0, ...startEnd.points.map(along));
  const to = Math.min(wallLength(wall), ...endEnd.points.map(along));
  return { polygon, startJoin: startEnd.join, endJoin: endEnd.join, clear: { from, to } };
}

/** Área do contorno em planta (m²): a base de `GrossFootPrintArea`. */
export const footprintArea = (footprint: WallFootprint): number =>
  Math.abs(ringArea(footprint.polygon));

// ---------------------------------------------------------------------------
// Elementos hospedados e vãos
// ---------------------------------------------------------------------------

export const hostedOf = (architecture: Architecture, wallId: string): HostedElement[] =>
  architecture.elements.filter(
    (element): element is HostedElement => isHosted(element) && element.hostId === wallId,
  );

/** Vão de uma porta ou janela na parede: intervalo ao longo do eixo e na altura (m). */
export interface WallOpening {
  readonly elementId: string;
  readonly kind: 'door' | 'window';
  /** Ao longo da linha de referência, a partir de `start`. */
  readonly from: number;
  readonly to: number;
  /** Acima da base da parede. */
  readonly bottom: number;
  readonly top: number;
}

export function openingOf(
  element: Pick<Door | ArchWindow, 'id' | 'kind' | 'offset' | 'sillHeight'>,
  type: Pick<DoorType | WindowType, 'width' | 'height'>,
): WallOpening {
  return {
    elementId: element.id,
    kind: element.kind,
    from: element.offset - type.width / 2,
    to: element.offset + type.width / 2,
    bottom: element.sillHeight,
    top: element.sillHeight + type.height,
  };
}

/** Vãos da parede, em ordem ao longo do eixo (elementos com tipo inexistente ficam fora). */
export function wallOpenings(architecture: Architecture, wall: Wall): WallOpening[] {
  const openings: WallOpening[] = [];
  for (const element of hostedOf(architecture, wall.id)) {
    const type = hostedTypeOf(architecture, element);
    if (type) openings.push(openingOf(element, type));
  }
  return openings.sort((a, b) => a.from - b.from);
}

/**
 * Por que o vão não cabe na parede (mensagem em português) ou `null` se cabe. Regras: dentro
 * do trecho de seção completa, dentro da altura e sem sobrepor outro vão.
 */
export function openingProblem(
  architecture: Architecture,
  wall: Wall,
  opening: WallOpening,
  ignoreId?: string,
): string | null {
  const footprint = wallFootprint(architecture, wall);
  if (!footprint) return 'a parede hospedeira não tem tipo válido';
  const eps = 1e-6;
  if (opening.from < footprint.clear.from - eps || opening.to > footprint.clear.to + eps) {
    return `o vão (${(opening.to - opening.from).toFixed(2).replace('.', ',')} m) não cabe no trecho livre da parede "${wall.name}"`;
  }
  if (opening.bottom < -eps || opening.top > wall.height + eps) {
    return `o vão ultrapassa a altura da parede "${wall.name}"`;
  }
  for (const other of wallOpenings(architecture, wall)) {
    if (other.elementId === opening.elementId || other.elementId === ignoreId) continue;
    const overlapsAlong = opening.from < other.to - eps && other.from < opening.to - eps;
    const overlapsHeight = opening.bottom < other.top - eps && other.bottom < opening.top - eps;
    if (overlapsAlong && overlapsHeight) return 'o vão se sobrepõe a outra porta ou janela';
  }
  return null;
}

/** Centro do vão na linha de referência da parede, em planta. */
export function hostedPoint(wall: Pick<Wall, 'start' | 'end'>, offset: number): Point2 {
  const { dir } = wallAxes(wall);
  return add2(wall.start, scale2(dir, offset));
}

/** Distância ao longo da parede do ponto mais próximo de `point` (sem limitar às pontas). */
export function offsetAlongWall(wall: Pick<Wall, 'start' | 'end'>, point: Point2): number {
  return dot2(sub2(point, wall.start), wallAxes(wall).dir);
}
