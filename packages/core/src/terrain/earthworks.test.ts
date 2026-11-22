import { describe, expect, it } from 'vitest';
import { buildProfile } from '../analysis';
import { vec3, type Vec3 } from '../math';
import { addPipe, createProject } from '../operations';
import { setTerrain } from '../projectOps';
import type { Result } from '../result';
import {
  surveySource,
  type PipeSpec,
  type Platform,
  type Point2,
  type Project,
  type Terrain,
} from '../schema';
import { parseProject, serializeProject } from '../serialization';
import { validateProject } from '../validation';
import {
  addPlatform,
  groundSurfaceOf,
  hasDesignTerrain,
  projectEarthworks,
  removePlatform,
  setEarthworkSettings,
  updatePlatform,
} from './earthworks';
import { buildDesignSurface } from './grading';
import { distanceToRings, pointInRing } from './polygon';
import { buildTerrainSurface, terrainElevationAt, terrainStats } from './surface';
import { earthworkQuantities, earthworkVolumes, sumCutFill, type EarthworkSolid } from './volumes';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
const codeOf = (result: Result<unknown>): string => (result.ok ? 'ok' : result.error.code);

const SOURCE = surveySource('teste.xyz', '2026-11-21T00:00:00.000Z');

/** Superfície em grade sobre [0, size]², com a cota dada por `z`. */
function gridTerrain(size: number, step: number, z: (x: number, y: number) => number): Terrain {
  const points: Vec3[] = [];
  for (let x = 0; x <= size + 1e-9; x += step) {
    for (let y = 0; y <= size + 1e-9; y += step) points.push({ x, y, z: z(x, y) });
  }
  return unwrap(
    buildTerrainSurface({ name: 'Teste', points, boundary: null, breaklines: [], source: SOURCE }),
  ).terrain;
}

const square = (x0: number, y0: number, side: number): Point2[] => [
  { x: x0, y: y0 },
  { x: x0 + side, y: y0 },
  { x: x0 + side, y: y0 + side },
  { x: x0, y: y0 + side },
];

function platform(outline: Point2[], elevation: number, cutSlope = 1, fillSlope = 1.5): Platform {
  return {
    id: `p-${elevation}-${outline.length}`,
    name: 'Platô',
    outline,
    elevation,
    cutSlope,
    fillSlope,
  };
}

function totals(natural: Terrain, platforms: Platform[]) {
  const design = buildDesignSurface(natural, platforms);
  expect(design.failures).toEqual([]);
  const volumes = earthworkVolumes(natural, design, { solids: true });
  return { design, volumes, total: sumCutFill(volumes) };
}

/** Volume de um sólido fechado pelo teorema da divergência. */
function solidVolume(solid: EarthworkSolid): number {
  let sum = 0;
  for (let i = 0; i + 2 < solid.triangles.length; i += 3) {
    const a = solid.points[solid.triangles[i] as number] as Vec3;
    const b = solid.points[solid.triangles[i + 1] as number] as Vec3;
    const c = solid.points[solid.triangles[i + 2] as number] as Vec3;
    sum +=
      a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x);
  }
  return Math.abs(sum) / 6;
}

/**
 * Integração independente (regra do ponto médio em grade fina) da definição do terreno
 * projetado em um plano: dentro do platô vale a cota; fora, o terreno é limitado pelos cones
 * de corte e de aterro que saem do perímetro.
 */
function referenceVolumes(
  z: (x: number, y: number) => number,
  ring: Point2[],
  level: number,
  cutSlope: number,
  fillSlope: number,
  box: [number, number, number, number],
  cell: number,
): { cut: number; fill: number } {
  let cut = 0;
  let fill = 0;
  for (let x = box[0] + cell / 2; x < box[2]; x += cell) {
    for (let y = box[1] + cell / 2; y < box[3]; y += cell) {
      const natural = z(x, y);
      let design = level;
      if (!pointInRing(ring, x, y)) {
        const d = distanceToRings([ring], x, y);
        design = Math.min(Math.max(natural, level - d / fillSlope), level + d / cutSlope);
      }
      if (design > natural) fill += (design - natural) * cell * cell;
      else cut += (natural - design) * cell * cell;
    }
  }
  return { cut, fill };
}

describe('terreno projetado e volumes — resultados analíticos', () => {
  it('aterro sobre terreno plano: tronco de pirâmide com cantos em cone', () => {
    const natural = gridTerrain(100, 10, () => 10);
    const { design, total, volumes } = totals(natural, [platform(square(40, 40, 20), 12, 1, 1.5)]);
    // a²h + 4·a·r·h/2 + cone completo (quatro quartos), com r = 1,5 × 2 = 3 m.
    const expected = 400 * 2 + (4 * 20 * 3 * 2) / 2 + (Math.PI * 9 * 2) / 3;
    expect(total.cut).toBe(0);
    expect(total.fill).toBeCloseTo(expected, 0);
    expect(Math.abs(total.fill - expected)).toBeLessThan(0.1);
    expect(total.fillArea).toBeCloseTo(400 + 240 + Math.PI * 9, 0);
    // Cota no platô, no meio do talude e fora da área alterada.
    expect(terrainElevationAt(design.terrain, 50, 50)).toBeCloseTo(12, 6);
    expect(terrainElevationAt(design.terrain, 61.5, 50)).toBeCloseTo(11, 6);
    expect(terrainElevationAt(design.terrain, 63, 50)).toBeCloseTo(10, 6);
    expect(terrainElevationAt(design.terrain, 80, 20)).toBeCloseTo(10, 9);
    // A superfície continua cobrindo a mesma área: nada sobreposto, nada aberto.
    expect(terrainStats(design.terrain).planArea).toBeCloseTo(terrainStats(natural).planArea, 6);
    // O sólido de aterro é fechado e tem o volume integrado.
    const solid = volumes[0]?.fillSolid as EarthworkSolid;
    expect(solid.closed).toBe(true);
    expect(solidVolume(solid)).toBeCloseTo(total.fill, 2);
    expect(volumes[0]?.cutSolid).toBeNull();
  });

  it('corte em terreno plano: cava com taludes 1:1', () => {
    const natural = gridTerrain(100, 10, () => 10);
    const { design, total, volumes } = totals(natural, [platform(square(40, 40, 20), 7, 1, 1.5)]);
    const expected = 400 * 3 + (4 * 20 * 3 * 3) / 2 + (Math.PI * 9 * 3) / 3;
    expect(total.fill).toBe(0);
    expect(Math.abs(total.cut - expected)).toBeLessThan(0.1);
    expect(terrainElevationAt(design.terrain, 50, 50)).toBeCloseTo(7, 6);
    expect(terrainElevationAt(design.terrain, 38.5, 50)).toBeCloseTo(8.5, 6);
    const solid = volumes[0]?.cutSolid as EarthworkSolid;
    expect(solid.closed).toBe(true);
    expect(solidVolume(solid)).toBeCloseTo(total.cut, 2);
  });

  it('platô fora do alinhamento da malha dá o mesmo volume', () => {
    const natural = gridTerrain(100, 10, () => 10);
    const { total } = totals(natural, [platform(square(37.3, 41.7, 20), 12, 1, 1.5)]);
    const expected = 400 * 2 + (4 * 20 * 3 * 2) / 2 + (Math.PI * 9 * 2) / 3;
    expect(Math.abs(total.fill - expected)).toBeLessThan(0.1);
    expect(total.cut).toBeLessThan(1e-9);
  });

  it('terreno inclinado, platô a meia encosta: corte e aterro separados na linha de passagem', () => {
    const z = (x: number): number => 10 + 0.1 * x;
    const natural = gridTerrain(100, 5, z);
    const ring = square(40, 40, 20);
    const { design, total } = totals(natural, [platform(ring, 15, 1, 1)]);
    // Dentro do platô: cunha de 0,1 × (x − 50) sobre metade da área, de cada lado.
    expect(total.cut).toBeGreaterThan(100);
    // Com taludes iguais, a figura é antissimétrica em torno de x = 50.
    expect(total.cut).toBeCloseTo(total.fill, 3);
    const reference = referenceVolumes(z, ring, 15, 1, 1, [30, 30, 70, 70], 0.05);
    expect(Math.abs(total.cut - reference.cut) / reference.cut).toBeLessThan(0.005);
    expect(Math.abs(total.fill - reference.fill) / reference.fill).toBeLessThan(0.005);
    // Linha de passagem: em x = 50 o terreno não muda.
    expect(terrainElevationAt(design.terrain, 50, 65)).toBeCloseTo(15, 6);
    expect(terrainElevationAt(design.terrain, 58, 50)).toBeCloseTo(15, 6);
    expect(terrainElevationAt(design.terrain, 42, 50)).toBeCloseTo(15, 6);
  });

  it('terreno inclinado com taludes diferentes confere com a integração de referência', () => {
    const z = (x: number, y: number): number => 20 + 0.08 * x - 0.05 * y;
    const natural = gridTerrain(120, 6, z);
    const ring: Point2[] = [
      { x: 45, y: 40 },
      { x: 78, y: 46 },
      { x: 72, y: 75 },
      { x: 41, y: 68 },
    ];
    const { total } = totals(natural, [platform(ring, 22, 1, 2)]);
    const reference = referenceVolumes(z, ring, 22, 1, 2, [20, 20, 100, 100], 0.05);
    expect(total.cut).toBeGreaterThan(10);
    expect(total.fill).toBeGreaterThan(10);
    expect(Math.abs(total.cut - reference.cut) / reference.cut).toBeLessThan(0.01);
    expect(Math.abs(total.fill - reference.fill) / reference.fill).toBeLessThan(0.01);
  });

  it('platô em L: no canto reentrante os taludes se encontram na bissetriz', () => {
    const natural = gridTerrain(100, 10, () => 10);
    const ring: Point2[] = [
      { x: 30, y: 30 },
      { x: 60, y: 30 },
      { x: 60, y: 45 },
      { x: 45, y: 45 },
      { x: 45, y: 60 },
      { x: 30, y: 60 },
    ];
    const { design, total } = totals(natural, [platform(ring, 12, 1, 1.5)]);
    // ∫ h (1 − d/r) × comprimento da paralela a d: P + (5 π/2 − 2) d, com r = 3 m.
    const expected = 675 * 2 + 2 * ((120 * 3) / 2 + ((2.5 * Math.PI - 2) * 9) / 6);
    expect(Math.abs(total.fill - expected)).toBeLessThan(0.2);
    // Sobre a bissetriz do canto reentrante, a 1,5 m de cada lado: metade da altura.
    expect(terrainElevationAt(design.terrain, 46.5, 46.5)).toBeCloseTo(11, 6);
  });

  it('relevo irregular: volumes não negativos, superfície íntegra e sólidos coerentes', () => {
    let seed = 7;
    const noise = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const heights = new Map<string, number>();
    const z = (x: number, y: number): number => {
      const key = `${x}|${y}`;
      let value = heights.get(key);
      if (value === undefined) {
        value = 30 + 0.05 * x + 3 * Math.sin(x / 9) * Math.cos(y / 7) + noise();
        heights.set(key, value);
      }
      return value;
    };
    const natural = gridTerrain(120, 4, z);
    const ring: Point2[] = [
      { x: 43.3, y: 41.1 },
      { x: 81.7, y: 44.9 },
      { x: 77.2, y: 79.6 },
      { x: 40.4, y: 72.3 },
    ];
    const { design, total, volumes } = totals(natural, [platform(ring, 34, 1, 1.5)]);
    expect(total.cut).toBeGreaterThan(0);
    expect(total.fill).toBeGreaterThan(0);
    expect(terrainStats(design.terrain).planArea).toBeCloseTo(terrainStats(natural).planArea, 5);
    expect(terrainElevationAt(design.terrain, 60, 60)).toBeCloseTo(34, 6);
    // Fora da linha de encontro o terreno é o natural.
    for (const [x, y] of [
      [10, 10],
      [110, 15],
      [15, 105],
      [100, 100],
    ] as const) {
      expect(terrainElevationAt(design.terrain, x, y)).toBeCloseTo(
        terrainElevationAt(natural, x, y) as number,
        9,
      );
    }
    // Em relevo irregular a casca pode ter lascas submilimétricas abertas (`closed` informa);
    // o volume do sólido tem de conferir com o integrado.
    expect(solidVolume(volumes[0]?.cutSolid as EarthworkSolid)).toBeCloseTo(total.cut, 1);
    expect(solidVolume(volumes[0]?.fillSolid as EarthworkSolid)).toBeCloseTo(total.fill, 1);
  });

  it('dois platôs: o segundo encontra o terreno já modificado, e o total é a soma', () => {
    const natural = gridTerrain(100, 10, () => 10);
    const a = { ...platform(square(20, 20, 20), 12), id: 'a' };
    const b = { ...platform(square(60, 60, 20), 8), id: 'b' };
    const design = buildDesignSurface(natural, [a, b]);
    expect(design.failures).toEqual([]);
    const volumes = earthworkVolumes(natural, design);
    expect(volumes).toHaveLength(2);
    expect(volumes[0]?.fill).toBeGreaterThan(800);
    expect(volumes[0]?.cut).toBe(0);
    expect(volumes[1]?.cut).toBeGreaterThan(800);
    expect(volumes[1]?.fill).toBe(0);
    expect(terrainElevationAt(design.terrain, 30, 30)).toBeCloseTo(12, 6);
    expect(terrainElevationAt(design.terrain, 70, 70)).toBeCloseTo(8, 6);
    // A superfície natural não foi alterada.
    expect(terrainElevationAt(natural, 30, 30)).toBeCloseTo(10, 9);
  });

  it('recusa o que não pode ser gerado, com o motivo', () => {
    const natural = gridTerrain(100, 10, () => 10);
    const failure = (p: Platform): string =>
      buildDesignSurface(natural, [p]).failures[0]?.error.code ?? 'ok';
    expect(failure(platform(square(90, 90, 20), 12))).toBe('PLATFORM_OUTSIDE_TERRAIN');
    // Aterro de 20 m com talude 1,5: o pé cai a 30 m, fora da superfície.
    expect(failure(platform(square(70, 40, 20), 30))).toBe('PLATFORM_SLOPE_OUTSIDE');
    expect(
      failure(
        platform(
          [
            { x: 40, y: 40 },
            { x: 60, y: 60 },
            { x: 60, y: 40 },
            { x: 40, y: 60 },
          ],
          12,
        ),
      ),
    ).toBe('POLYGON_SELF_INTERSECTION');
  });
});

describe('quantidades de terraplenagem', () => {
  it('converte os estados de volume antes de somar', () => {
    const q = earthworkQuantities(
      { cut: 1000, fill: 600, cutArea: 0, fillArea: 0 },
      { swellPercent: 25, compactionFactor: 0.9, reusePercent: 80 },
    );
    expect(q.loose).toBeCloseTo(1250, 9);
    expect(q.reusable).toBeCloseTo(800, 9);
    expect(q.fillFromCut).toBeCloseTo(720, 9);
    expect(q.balance).toBeCloseTo(120, 9);
    expect(q.borrow).toBe(0);
    // Não aproveitável (200) + sobra do aproveitável de volta ao estado in situ (120 ÷ 0,9).
    expect(q.surplus).toBeCloseTo(200 + 120 / 0.9, 9);
    expect(q.surplusLoose).toBeCloseTo((200 + 120 / 0.9) * 1.25, 9);
  });

  it('falta de material vira empréstimo', () => {
    const q = earthworkQuantities(
      { cut: 100, fill: 600, cutArea: 0, fillArea: 0 },
      { swellPercent: 30, compactionFactor: 0.8, reusePercent: 100 },
    );
    expect(q.balance).toBeCloseTo(-520, 9);
    expect(q.borrow).toBeCloseTo(520, 9);
    expect(q.borrowInSitu).toBeCloseTo(650, 9);
    expect(q.surplus).toBeCloseTo(0, 9);
  });

  it('parâmetro não informado deixa a quantidade pendente', () => {
    const q = earthworkQuantities(
      { cut: 100, fill: 50, cutArea: 0, fillArea: 0 },
      { swellPercent: null, compactionFactor: null, reusePercent: null },
    );
    expect(q.cut).toBe(100);
    expect(q.fill).toBe(50);
    expect(q.loose).toBeNull();
    expect(q.balance).toBeNull();
    expect(q.borrow).toBeNull();
    expect(q.surplus).toBeNull();
  });
});

describe('platôs no projeto', () => {
  const withTerrain = (): Project =>
    setTerrain(
      createProject('Terraplenagem', 'infra'),
      gridTerrain(100, 10, () => 10),
    );

  it('cria, altera e remove platôs; o quadro acompanha', () => {
    const created = unwrap(
      addPlatform(withTerrain(), {
        outline: square(40, 40, 20),
        elevation: 12,
        cutSlope: 1,
        fillSlope: 1.5,
      }),
    );
    let project = created.project;
    expect(project.earthworks.platforms[0]?.name).toBe('Platô 1');
    const first = projectEarthworks(project);
    expect(first?.platforms[0]?.quantities?.fill).toBeGreaterThan(1000);
    expect(first?.total.fill).toBeCloseTo(first?.platforms[0]?.quantities?.fill as number, 9);
    expect(projectEarthworks(project)).toBe(first);

    project = unwrap(updatePlatform(project, created.platformId, { elevation: 8 }));
    const second = projectEarthworks(project);
    expect(second?.total.fill).toBe(0);
    expect(second?.total.cut).toBeGreaterThan(800);
    expect(project.earthworks.platforms[0]?.id).toBe(created.platformId);

    project = unwrap(
      setEarthworkSettings(project, { swellPercent: 30, compactionFactor: 0.9, reusePercent: 50 }),
    );
    const third = projectEarthworks(project);
    expect(third?.total.loose).toBeCloseTo((third?.total.cut as number) * 1.3, 6);
    expect(codeOf(setEarthworkSettings(project, { reusePercent: 120 }))).toBe(
      'EARTHWORKS_SETTINGS',
    );

    expect(validateProject(project).filter((issue) => issue.severity === 'error')).toEqual([]);
    const reopened = unwrap(parseProject(serializeProject(project)));
    expect(reopened.earthworks).toEqual(project.earthworks);
    expect(projectEarthworks(reopened)?.total.cut).toBeCloseTo(third?.total.cut as number, 6);

    project = unwrap(removePlatform(project, created.platformId));
    expect(project.earthworks.platforms).toEqual([]);
    expect(projectEarthworks(project)?.design.terrain).toBe(project.terrain);
  });

  it('recusa platô sem terreno, fora dele ou com parâmetros inválidos', () => {
    const input = { outline: square(40, 40, 20), elevation: 12, cutSlope: 1, fillSlope: 1.5 };
    expect(codeOf(addPlatform(createProject('Vazio', 'infra'), input))).toBe(
      'EARTHWORKS_NO_TERRAIN',
    );
    expect(codeOf(addPlatform(withTerrain(), { ...input, outline: square(95, 95, 20) }))).toBe(
      'PLATFORM_OUTSIDE_TERRAIN',
    );
    expect(codeOf(addPlatform(withTerrain(), { ...input, cutSlope: 0 }))).toBe(
      'PLATFORM_PARAMETERS',
    );
    expect(codeOf(updatePlatform(withTerrain(), 'nada', { elevation: 1 }))).toBe(
      'PLATFORM_UNKNOWN',
    );
    expect(codeOf(removePlatform(withTerrain(), 'nada'))).toBe('PLATFORM_UNKNOWN');
  });

  it('superfície de referência e perfil da rede com o terreno natural e o projetado', () => {
    const natural = gridTerrain(100, 10, () => 10);
    let project = setTerrain(createProject('Perfil', 'infra'), natural);
    expect(hasDesignTerrain(project)).toBe(false);
    expect(groundSurfaceOf(project, 'design')).toBe(project.terrain);
    project = unwrap(
      addPlatform(project, {
        outline: square(40, 40, 20),
        elevation: 12,
        cutSlope: 1,
        fillSlope: 1.5,
      }),
    ).project;
    expect(hasDesignTerrain(project)).toBe(true);
    const design = groundSurfaceOf(project, 'design') as Terrain;
    expect(groundSurfaceOf(project, 'natural')).toBe(project.terrain);
    expect(terrainElevationAt(design, 50, 50)).toBeCloseTo(12, 6);

    // Tubo a 1 m sob o terreno natural, atravessando o platô de aterro de 2 m.
    const spec: PipeSpec = {
      specificationId: 'teste',
      material: 'pvc',
      standard: 'Norma de teste',
      jointType: 'solventWeld',
      pressureClass: null,
      dn: 50,
      sizeLabel: 'DE 60',
      outerDiameter: 0.06,
      innerDiameter: 0.054,
      wallThickness: 0.003,
    };
    const created = unwrap(
      addPipe(project, { start: vec3(20, 50, 8.97), end: vec3(80, 50, 8.97), spec }),
    );
    const profile = unwrap(buildProfile(created.project, created.elementId));
    const middle = profile.stations.find((s) => Math.abs(s.position.x - 50) < 1e-6);
    expect(middle?.naturalGroundElevation).toBeCloseTo(10, 6);
    expect(middle?.naturalCover).toBeCloseTo(1, 6);
    expect(middle?.groundElevation).toBeCloseTo(12, 6);
    expect(middle?.cover).toBeCloseTo(3, 6);
    // Fora do platô e dos taludes as duas superfícies coincidem.
    const edge = profile.stations[0];
    expect(edge?.groundElevation).toBeCloseTo(edge?.naturalGroundElevation as number, 9);
  });

  it('platô que deixa de caber no terreno vira pendência de validação', () => {
    const created = unwrap(
      addPlatform(withTerrain(), {
        outline: square(40, 40, 20),
        elevation: 12,
        cutSlope: 1,
        fillSlope: 1.5,
      }),
    ).project;
    expect(validateProject(created)).toEqual([]);
    // O terreno é trocado por um menor: o platô fica fora dele.
    const smaller = setTerrain(
      created,
      gridTerrain(30, 10, () => 10),
    );
    const issues = validateProject(smaller);
    expect(issues.map((issue) => issue.code)).toEqual(['PLATFORM_NOT_GENERATED']);
    expect(issues[0]?.severity).toBe('warning');
    expect(projectEarthworks(smaller)?.platforms[0]?.error?.code).toBe('PLATFORM_OUTSIDE_TERRAIN');
    expect(projectEarthworks(smaller)?.total.fill).toBe(0);
    expect(validateProject(setTerrain(created, null)).map((issue) => issue.code)).toEqual([
      'EARTHWORKS_NO_TERRAIN',
    ]);
  });

  it('migra um projeto v16: sem platôs, superfície com identificador e nunca editada', () => {
    const project = withTerrain();
    const document = JSON.parse(serializeProject(project)) as Record<string, unknown>;
    const terrain = { ...(document.terrain as Record<string, unknown>) };
    delete terrain.id;
    delete terrain.tag;
    delete terrain.original;
    delete document.earthworks;
    const migrated = unwrap(
      parseProject(JSON.stringify({ ...document, schemaVersion: 16, terrain })),
    );
    expect(migrated.earthworks).toEqual({
      platforms: [],
      swellPercent: null,
      compactionFactor: null,
      reusePercent: null,
    });
    expect(migrated.terrain?.id).toBe('terreno');
    expect(migrated.terrain?.original).toBeNull();
  });
});
