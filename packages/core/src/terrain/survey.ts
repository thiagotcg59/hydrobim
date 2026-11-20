import { localToProjected } from '../geo/transform';
import type { Vec3 } from '../math';
import { fail, ok, type Result } from '../result';
import type { Georeference, Terrain, TerrainSource } from '../schema';
import type { Ring } from './polygon';
import { terrainProfile } from './profile';
import { buildTerrainSurface, type BuiltSurface } from './surface';

/**
 * Levantamento topográfico: pontos cotados e linhas de quebra medidos em campo. É a fonte de
 * maior precisão e substitui a superfície vinda de um DEM.
 */

/**
 * Lê linhas de quebra de um texto: cada linha de quebra é um bloco de linhas "X Y Z" (mesmos
 * separadores do arquivo de pontos); uma linha em branco ou iniciada por `#` separa uma linha
 * de quebra da seguinte.
 */
export function parseBreaklines(text: string): Result<Vec3[][]> {
  const lines: Vec3[][] = [];
  let current: Vec3[] = [];
  const flush = (): void => {
    if (current.length >= 2) lines.push(current);
    current = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) {
      flush();
      continue;
    }
    const separator = /[;\t]/.test(line) ? /[;\t]+/ : /[\s,]+/;
    const fields = line
      .split(separator)
      .map((field) => Number(field.trim().replace(',', '.')))
      .filter((value) => !Number.isNaN(value));
    if (fields.length < 3) {
      // Texto sem três números (um rótulo, por exemplo) também separa as linhas de quebra.
      flush();
      continue;
    }
    const [x, y, z] = fields.slice(-3) as [number, number, number];
    const previous = current[current.length - 1];
    if (previous && previous.x === x && previous.y === y) continue;
    current.push({ x, y, z });
  }
  flush();
  if (lines.length === 0) {
    return fail(
      'BREAKLINES_EMPTY',
      'Nenhuma linha de quebra encontrada: cada uma precisa de ao menos dois pontos "X Y Z" em linhas seguidas, com uma linha em branco entre uma e outra.',
    );
  }
  return ok(lines);
}

export interface SurveyInput {
  readonly name: string;
  readonly points: readonly Vec3[];
  readonly breaklines: readonly (readonly Vec3[])[];
  /** Área de recorte (contorno e furos, já validados); `null` = envoltória dos pontos. */
  readonly rings: readonly Ring[] | null;
  readonly source: TerrainSource;
}

/**
 * Superfície de um levantamento. Com área de recorte, o limite é cotado pela própria
 * triangulação do levantamento (interseção exata do contorno com as arestas do TIN); se o
 * contorno sair da região levantada, a operação é recusada — não há cota fora dos dados.
 */
export function buildSurveySurface(input: SurveyInput): Result<BuiltSurface> {
  const whole = buildTerrainSurface({
    name: input.name,
    points: input.points,
    boundary: null,
    breaklines: input.breaklines,
    source: input.source,
  });
  if (!whole.ok || !input.rings) return whole;

  const boundary: Vec3[][] = [];
  for (const ring of input.rings) {
    const first = ring[0];
    if (!first) continue;
    const profile = terrainProfile(whole.value.terrain, [...ring, first]);
    const gap = profile.ok ? profile.value.stations.find((s) => s.elevation === null) : null;
    if (!profile.ok || gap) {
      return fail(
        'SURVEY_BOUNDARY_OUTSIDE',
        gap
          ? `A área ultrapassa a região levantada perto de X ${gap.x.toFixed(2)}; Y ${gap.y.toFixed(2)}. Ajuste o contorno para dentro dos pontos do levantamento: não há cota fora deles.`
          : 'A área não está sobre a região levantada.',
      );
    }
    const stations = profile.value.stations.slice(0, -1);
    boundary.push(stations.map((s) => ({ x: s.x, y: s.y, z: s.elevation as number })));
  }
  return buildTerrainSurface({
    name: input.name,
    points: input.points,
    boundary,
    breaklines: input.breaklines,
    source: input.source,
  });
}

// ---------------------------------------------------------------------------
// Estrutura de intercâmbio (DXF 3D, LandXML, IFC)
// ---------------------------------------------------------------------------

export interface TerrainExchange {
  readonly name: string;
  /** Sistema de referência horizontal das coordenadas; `null` = coordenadas locais. */
  readonly crs: { readonly name: string; readonly epsg: number | null } | null;
  /** Referência altimétrica das cotas; `null` = não informada. */
  readonly verticalDatum: string | null;
  readonly source: TerrainSource;
  /**
   * Vértices: E, N e altitude quando há georreferência; X, Y e cota local caso contrário. A
   * ordem é a de `terrain.points` (os índices das faces valem para os dois).
   */
  readonly points: Vec3[];
  /** Faces: três índices de vértice (base 0), em sentido anti-horário. */
  readonly faces: [number, number, number][];
  readonly boundary: Vec3[][] | null;
  readonly breaklines: Vec3[][];
}

/**
 * Superfície pronta para exportação: pontos numerados, faces por índices, limite e linhas de
 * quebra — o conteúdo de `<Surface><Definition surfType="TIN">` do LandXML (`Pnts`, `Faces`,
 * `Breaklines`, `Boundaries`), de um `IfcTriangulatedIrregularNetwork` (`Coordinates`,
 * `CoordIndex`) e das faces 3D de um DXF. Com georreferência, as coordenadas saem no sistema
 * projetado do projeto (a mesma conversão do `IfcMapConversion`).
 */
export function terrainExchange(
  terrain: Terrain,
  georeference: Georeference | null,
): TerrainExchange {
  const convert = (p: Vec3): Vec3 => {
    if (!georeference) return { x: p.x, y: p.y, z: p.z };
    const projected = localToProjected(georeference, p);
    return { x: projected.e, y: projected.n, z: p.z + georeference.orthogonalHeight };
  };
  const faces: [number, number, number][] = [];
  for (let i = 0; i + 2 < terrain.triangles.length; i += 3) {
    faces.push([
      terrain.triangles[i] as number,
      terrain.triangles[i + 1] as number,
      terrain.triangles[i + 2] as number,
    ]);
  }
  return {
    name: terrain.name,
    crs: georeference ? { name: georeference.crsName, epsg: georeference.epsg } : null,
    verticalDatum: georeference?.verticalDatum ?? null,
    source: terrain.source,
    points: terrain.points.map(convert),
    faces,
    boundary: terrain.boundary?.map((ring) => ring.map(convert)) ?? null,
    breaklines: terrain.breaklines.map((line) => line.map(convert)),
  };
}
