import type { Vec3 } from '../math';
import { fail, ok, type Result } from '../result';
import type { Point2, Terrain, TerrainMesh } from '../schema';
import { pointInPolygon, polygonArea, validatePolygon, type Ring } from './polygon';
import { terrainProfile } from './profile';
import { buildTerrainSurface, terrainHitAt, terrainStats } from './surface';

/**
 * Edição da superfície do terreno: pontos cotados (acrescentar, mover, excluir, trocar a
 * cota), limite e triangulação. Cada operação devolve uma superfície nova — o identificador,
 * o nome e a procedência são os mesmos — e guarda a malha original na primeira edição, para
 * comparação e para desfazer tudo de uma vez (`restoreOriginalTerrain`).
 *
 * A triangulação é sempre refeita pelo mesmo construtor da importação (Delaunay com
 * restrições): as cotas continuam sendo dados informados, nada é interpolado nem suavizado.
 * Os índices dos pontos valem para a superfície recebida; depois de uma operação que refaz a
 * triangulação, os pontos podem estar em outra ordem.
 */

/** Mesmo arredondamento das coordenadas gravadas (0,1 mm). */
const round = (value: number): number => Math.round(value * 1e4) / 1e4;
const keyOf = (p: { x: number; y: number }): string => `${round(p.x)}|${round(p.y)}`;

export function terrainMeshOf(terrain: Terrain): TerrainMesh {
  return {
    points: terrain.points,
    triangles: terrain.triangles,
    boundary: terrain.boundary,
    breaklines: terrain.breaklines,
  };
}

/** A superfície tem regiões sem dado dentro do limite (lacunas do DEM)? */
function hasGaps(terrain: Terrain): boolean {
  if (!terrain.boundary) return false;
  const inside = polygonArea(terrain.boundary);
  return terrainStats(terrain).planArea < inside * (1 - 1e-6) - 1e-6;
}

interface Parts {
  readonly points: readonly Vec3[];
  readonly boundary: readonly (readonly Vec3[])[] | null;
  readonly breaklines: readonly (readonly Vec3[])[];
}

/**
 * Refaz a triangulação com os dados dados. Lacunas da superfície anterior continuam abertas:
 * um triângulo novo só entra se estiver sobre a região que já tinha dado ou se tiver o ponto
 * editado (`touched`) como vértice — um ponto cotado posto na lacuna a preenche em volta dele.
 */
function rebuild(terrain: Terrain, parts: Parts, touched: Point2 | null): Result<Terrain> {
  const gaps = hasGaps(terrain);
  const touchedKey = touched ? keyOf(touched) : null;
  const built = buildTerrainSurface({
    id: terrain.id,
    tag: terrain.tag,
    name: terrain.name,
    points: parts.points,
    boundary: parts.boundary,
    breaklines: parts.breaklines,
    source: terrain.source,
    ...(gaps
      ? {
          keepTriangle: (x: number, y: number, corners: readonly [Vec3, Vec3, Vec3]) =>
            terrainHitAt(terrain, x, y) !== null ||
            (touchedKey !== null && corners.some((corner) => keyOf(corner) === touchedKey)),
        }
      : {}),
  });
  if (!built.ok) return built;
  return ok({ ...built.value.terrain, original: terrain.original ?? terrainMeshOf(terrain) });
}

const pointAt = (terrain: Terrain, index: number): Vec3 | null =>
  Number.isInteger(index) && index >= 0 ? (terrain.points[index] ?? null) : null;

const NO_POINT = fail('TERRAIN_POINT_UNKNOWN', 'O ponto escolhido não existe mais na superfície.');

function finiteCoordinates(...values: number[]): boolean {
  return values.every((value) => Number.isFinite(value));
}

/** Índice do ponto da superfície mais próximo de (x, y) dentro de `tolerance` metros. */
export function nearestTerrainPoint(
  terrain: Terrain,
  x: number,
  y: number,
  tolerance: number,
): number | null {
  let best = -1;
  let distance = tolerance;
  for (let i = 0; i < terrain.points.length; i += 1) {
    const p = terrain.points[i] as Vec3;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= distance) {
      distance = d;
      best = i;
    }
  }
  return best < 0 ? null : best;
}

/** Acrescenta um ponto cotado. Dentro do limite, se houver; sem limite, a superfície cresce. */
export function addTerrainPoint(terrain: Terrain, point: Vec3): Result<Terrain> {
  if (!finiteCoordinates(point.x, point.y, point.z)) {
    return fail('TERRAIN_POINT_INVALID', 'Informe X, Y e a cota do ponto.');
  }
  const key = keyOf(point);
  if (terrain.points.some((p) => keyOf(p) === key)) {
    return fail(
      'TERRAIN_POINT_DUPLICATE',
      'Já existe um ponto nessa posição. Para mudar a cota, edite o ponto existente.',
    );
  }
  if (terrain.boundary && !pointInPolygon(terrain.boundary, point.x, point.y)) {
    return fail(
      'TERRAIN_POINT_OUTSIDE',
      'O ponto está fora do limite da superfície. Amplie o limite ou escolha um ponto dentro dele.',
    );
  }
  return rebuild(
    terrain,
    {
      points: [...terrain.points, point],
      boundary: terrain.boundary,
      breaklines: terrain.breaklines,
    },
    point,
  );
}

/** Troca a cota de um ponto. A triangulação não muda (ela depende só da posição em planta). */
export function setTerrainPointElevation(
  terrain: Terrain,
  index: number,
  elevation: number,
): Result<Terrain> {
  const target = pointAt(terrain, index);
  if (!target) return NO_POINT;
  if (!Number.isFinite(elevation)) {
    return fail('TERRAIN_POINT_INVALID', 'Informe a cota do ponto.');
  }
  const z = round(elevation);
  const key = keyOf(target);
  const lift = (p: Vec3): Vec3 => (keyOf(p) === key ? { x: p.x, y: p.y, z } : p);
  return ok({
    ...terrain,
    points: terrain.points.map((p, i) => (i === index ? { x: p.x, y: p.y, z } : p)),
    boundary: terrain.boundary?.map((ring) => ring.map(lift)) ?? null,
    breaklines: terrain.breaklines.map((line) => line.map(lift)),
    original: terrain.original ?? terrainMeshOf(terrain),
  });
}

/**
 * Move um ponto em planta (e, se informada, troca a cota). Um vértice do limite ou de uma
 * linha de quebra leva o limite ou a linha junto.
 */
export function moveTerrainPoint(
  terrain: Terrain,
  index: number,
  to: { readonly x: number; readonly y: number; readonly z?: number },
): Result<Terrain> {
  const target = pointAt(terrain, index);
  if (!target) return NO_POINT;
  const moved: Vec3 = { x: to.x, y: to.y, z: to.z ?? target.z };
  if (!finiteCoordinates(moved.x, moved.y, moved.z)) {
    return fail('TERRAIN_POINT_INVALID', 'Informe a nova posição do ponto.');
  }
  const from = keyOf(target);
  const movedKey = keyOf(moved);
  if (movedKey !== from && terrain.points.some((p) => keyOf(p) === movedKey)) {
    return fail('TERRAIN_POINT_DUPLICATE', 'Já existe um ponto nessa posição.');
  }
  const onBoundary = terrain.boundary?.some((ring) => ring.some((p) => keyOf(p) === from)) ?? false;
  if (terrain.boundary && !onBoundary && !pointInPolygon(terrain.boundary, moved.x, moved.y)) {
    return fail('TERRAIN_POINT_OUTSIDE', 'A nova posição está fora do limite da superfície.');
  }
  const shift = (p: Vec3): Vec3 => (keyOf(p) === from ? moved : p);
  return rebuild(
    terrain,
    {
      points: terrain.points.map((p, i) => (i === index ? moved : p)),
      boundary: terrain.boundary?.map((ring) => ring.map(shift)) ?? null,
      breaklines: terrain.breaklines.map((line) => line.map(shift)),
    },
    moved,
  );
}

/** Exclui um ponto; o limite ou a linha de quebra que passavam por ele perdem o vértice. */
export function removeTerrainPoint(terrain: Terrain, index: number): Result<Terrain> {
  const target = pointAt(terrain, index);
  if (!target) return NO_POINT;
  const key = keyOf(target);
  const boundary = terrain.boundary?.map((ring) => ring.filter((p) => keyOf(p) !== key)) ?? null;
  if (boundary?.some((ring) => ring.length < 3)) {
    return fail(
      'TERRAIN_BOUNDARY_INVALID',
      'O ponto é vértice do limite, que ficaria com menos de três vértices. Redefina o limite antes de excluí-lo.',
    );
  }
  return rebuild(
    terrain,
    {
      points: terrain.points.filter((_, i) => i !== index),
      boundary,
      breaklines: terrain.breaklines
        .map((line) => line.filter((p) => keyOf(p) !== key))
        .filter((line) => line.length >= 2),
    },
    null,
  );
}

/**
 * Novo limite (contorno e furos), dentro da superfície atual: os vértices do limite são cotados
 * pela própria triangulação (interseção exata com as arestas), e os pontos que ficam de fora
 * saem da superfície. Um limite que ultrapassa a região com dado é recusado — não há cota lá.
 */
export function setTerrainBoundary(terrain: Terrain, rings: readonly Ring[]): Result<Terrain> {
  const checked = validatePolygon(rings);
  if (!checked.ok) return checked;
  const boundary: Vec3[][] = [];
  for (const ring of checked.value) {
    const first = ring[0] as Point2;
    const profile = terrainProfile(terrain, [...ring, first]);
    const gap = profile.ok ? profile.value.stations.find((s) => s.elevation === null) : null;
    if (!profile.ok || gap) {
      return fail(
        'TERRAIN_BOUNDARY_OUTSIDE',
        gap
          ? `O limite ultrapassa a superfície perto de X ${gap.x.toFixed(2)}; Y ${gap.y.toFixed(2)}. Mantenha-o dentro da região com dado: não há cota fora dela.`
          : 'O limite não está sobre a superfície.',
      );
    }
    boundary.push(
      profile.value.stations
        .slice(0, -1)
        .map((s) => ({ x: s.x, y: s.y, z: s.elevation as number })),
    );
  }
  return rebuild(
    terrain,
    { points: terrain.points, boundary, breaklines: terrain.breaklines },
    null,
  );
}

/** Refaz a triangulação com os pontos, o limite e as linhas de quebra atuais. */
export function retriangulateTerrain(terrain: Terrain): Result<Terrain> {
  const rebuilt = rebuild(terrain, terrainMeshOf(terrain), null);
  // Regenerar não é uma edição dos dados: não cria a cópia original.
  return rebuilt.ok ? ok({ ...rebuilt.value, original: terrain.original }) : rebuilt;
}

/** Volta à superfície como foi importada, descartando as edições de pontos e de limite. */
export function restoreOriginalTerrain(terrain: Terrain): Result<Terrain> {
  if (!terrain.original) {
    return fail('TERRAIN_NOT_EDITED', 'A superfície não foi editada: não há o que restaurar.');
  }
  return ok({ ...terrain, ...terrain.original, original: null });
}

/** A superfície original (para comparação), com a identificação da atual; `null` sem edição. */
export function originalTerrainOf(terrain: Terrain): Terrain | null {
  return terrain.original ? { ...terrain, ...terrain.original, original: null } : null;
}

/** Nome e identificação da superfície. */
export function setTerrainProperties(
  terrain: Terrain,
  patch: {
    readonly name?: string;
    readonly tag?: string;
    /**
     * Exatidão altimétrica (m) declarada para os dados — a do relatório do levantamento ou da
     * documentação da fonte; `null` volta a deixá-la sem valor. Nunca é presumida.
     */
    readonly verticalAccuracy?: number | null;
  },
): Result<Terrain> {
  const name = patch.name?.trim() ?? terrain.name;
  if (name.length === 0) return fail('TERRAIN_NAME', 'Dê um nome à superfície.');
  const { verticalAccuracy } = patch;
  if (
    verticalAccuracy !== undefined &&
    verticalAccuracy !== null &&
    !(Number.isFinite(verticalAccuracy) && verticalAccuracy > 0)
  ) {
    return fail(
      'TERRAIN_ACCURACY',
      'A exatidão altimétrica é um valor positivo, em metros; deixe o campo vazio se a fonte não a declara.',
    );
  }
  return ok({
    ...terrain,
    name,
    tag: patch.tag?.trim() ?? terrain.tag,
    source:
      verticalAccuracy === undefined ? terrain.source : { ...terrain.source, verticalAccuracy },
  });
}
