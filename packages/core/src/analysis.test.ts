import { describe, expect, it } from 'vitest';
import {
  buildProfile,
  createTerrain,
  detectClashes,
  parseTerrainPoints,
  segmentDistance,
  triangulate,
} from './analysis';
import { terrainElevationAt } from './terrain/surface';
import { exportEpanet } from './epanet';
import { getElement } from './connectivity';
import { vec3 } from './math';
import {
  addPipe,
  attachFitting,
  createProject,
  drawPipe,
  insertInline,
  placeEquipment,
  updateFitting,
} from './operations';
import { getPort } from './ports';
import { setTerrain } from './projectOps';
import { computeQuantities, quantitiesToCsv } from './quantities';
import type { Result } from './result';
import { testSpec } from './testSupport';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

describe('interferências', () => {
  it('calcula a distância entre segmentos', () => {
    const crossing = segmentDistance(
      vec3(0, 0, 0),
      vec3(2, 0, 0),
      vec3(1, -1, 0.5),
      vec3(1, 1, 0.5),
    );
    expect(crossing.distance).toBeCloseTo(0.5);
    const apart = segmentDistance(vec3(0, 0, 0), vec3(1, 0, 0), vec3(3, 0, 0), vec3(4, 0, 0));
    expect(apart.distance).toBeCloseTo(2);
    const parallel = segmentDistance(
      vec3(0, 0, 0),
      vec3(4, 0, 0),
      vec3(1, 0.3, 0),
      vec3(2, 0.3, 0),
    );
    expect(parallel.distance).toBeCloseTo(0.3);
  });

  it('detecta tubos que se cruzam e ignora tubos unidos por uma conexão', () => {
    const p0 = createProject('Interferências');
    const a = unwrap(
      addPipe(p0, { start: vec3(0, 0, 0), end: vec3(4, 0, 0), spec: testSpec(100) }),
    );
    const b = unwrap(
      drawPipe(a.project, {
        fromPort: { elementId: a.elementId, portId: 'end' },
        start: vec3(0, 0, 0),
        end: vec3(4, 3, 0),
        spec: testSpec(100),
      }),
    );
    expect(detectClashes(b.project)).toEqual([]);
    // Tubo independente atravessando o primeiro, 5 cm acima do eixo (raios de 5,5 cm).
    const c = unwrap(
      addPipe(b.project, { start: vec3(2, -1, 0.05), end: vec3(2, 1, 0.05), spec: testSpec(100) }),
    );
    const clashes = detectClashes(c.project);
    expect(clashes).toHaveLength(1);
    expect(new Set(clashes[0]?.elementIds)).toEqual(new Set([a.elementId, c.elementId]));
    expect(clashes[0]?.overlap).toBeCloseTo(0.11 - 0.05);
    // Afastado além da soma dos raios não há interferência.
    const d = unwrap(
      addPipe(b.project, { start: vec3(2, -1, 0.2), end: vec3(2, 1, 0.2), spec: testSpec(100) }),
    );
    expect(detectClashes(d.project)).toEqual([]);
  });
});

describe('terreno e perfil', () => {
  const text = `# X Y Z
0 0 10
10 0 10
0 10 12
10 10 12
5;5;11,5
cabeçalho inválido
5 5 11.5
`;

  it('lê pontos, triangula e interpola cotas', () => {
    const points = unwrap(parseTerrainPoints(text));
    expect(points).toHaveLength(5); // duplicado descartado
    expect(points[4]).toEqual(vec3(5, 5, 11.5));
    const triangles = triangulate(points);
    expect(triangles.length / 3).toBe(4);
    const terrain = unwrap(createTerrain('Levantamento', points));
    expect(terrainElevationAt(terrain, 0, 0)).toBeCloseTo(10);
    expect(terrainElevationAt(terrain, 5, 5)).toBeCloseTo(11.5);
    expect(terrainElevationAt(terrain, 5, 0)).toBeCloseTo(10);
    expect(terrainElevationAt(terrain, 50, 50)).toBeNull();
    expect(parseTerrainPoints('1 2 3').ok).toBe(false);
  });

  it('gera o perfil longitudinal com recobrimento ao longo do caminho', () => {
    const terrain = unwrap(createTerrain('T', unwrap(parseTerrainPoints(text))));
    const spec = testSpec(100);
    let project = createProject('Adutora', 'infra');
    const a = unwrap(addPipe(project, { start: vec3(1, 1, 9), end: vec3(6, 1, 9), spec }));
    const b = unwrap(
      drawPipe(a.project, {
        fromPort: { elementId: a.elementId, portId: 'end' },
        start: vec3(0, 0, 0),
        end: vec3(6, 8, 9),
        spec,
      }),
    );
    const tee = unwrap(
      insertInline(b.project, {
        pipeId: a.elementId,
        distanceFromStart: 2,
        fitting: { kind: 'tee' },
      }),
    );
    project = setTerrain(tee.project, terrain);

    // Partindo de qualquer elemento do caminho, o perfil é o mesmo.
    const fromStart = unwrap(buildProfile(project, a.elementId));
    const fromEnd = unwrap(buildProfile(project, b.elementId));
    expect(fromStart.elementIds).toEqual(fromEnd.elementIds);
    expect(fromStart.elementIds).toHaveLength(5); // tubo, tê, tubo, joelho, tubo
    // O joelho encurta o percurso em relação ao vértice teórico (5 + 7 m).
    expect(Math.abs(fromStart.length - 12)).toBeLessThan(0.2);
    const first = fromStart.stations[0]!;
    expect(first.chainage).toBe(0);
    expect(first.axisElevation).toBe(9);
    expect(first.groundElevation).toBeCloseTo(10.3);
    expect(first.cover).toBeCloseTo(10.3 - 9 - 0.055);
    for (let i = 1; i < fromStart.stations.length; i += 1) {
      expect(fromStart.stations[i]!.chainage).toBeGreaterThanOrEqual(
        fromStart.stations[i - 1]!.chainage,
      );
    }
    // Sem terreno, o perfil existe mas sem cotas de terreno.
    const bare = unwrap(buildProfile(tee.project, a.elementId));
    expect(bare.stations.every((s) => s.groundElevation === null && s.cover === null)).toBe(true);
  });
});

describe('quantitativo e EPANET', () => {
  function plant() {
    const spec = testSpec(100);
    const tank = unwrap(
      placeEquipment(createProject('Elevatória', 'infra'), {
        fitting: { kind: 'tank', diameter: 4, height: 3 },
        spec,
        position: vec3(0, 0, 0),
      }),
    );
    const suction = unwrap(
      drawPipe(tank.project, {
        fromPort: { elementId: tank.elementId, portId: 'a' },
        start: vec3(0, 0, 0),
        end: vec3(8, 0, 0.2),
        spec,
      }),
    );
    const valve = unwrap(
      insertInline(suction.project, {
        pipeId: suction.elementId,
        distanceFromStart: 2,
        fitting: { kind: 'valve', valveType: 'gate' },
      }),
    );
    const pump = unwrap(
      attachFitting(valve.project, {
        target: { elementId: valve.createdIds[1]!, portId: 'end' },
        fitting: { kind: 'pump' },
      }),
    );
    const outlet = getPort(getElement(pump.project, pump.elementId)!, 'b')!;
    const discharge = unwrap(
      drawPipe(pump.project, {
        fromPort: outlet.ref,
        start: vec3(0, 0, 0),
        end: vec3(outlet.position.x, outlet.position.y, 6),
        spec,
      }),
    );
    return { project: discharge.project, pumpId: pump.elementId };
  }

  it('soma tubos por diâmetro e conta as demais peças', () => {
    const { project } = plant();
    const rows = computeQuantities(project);
    const pipes = rows.filter((r) => r.category === 'Tubo');
    expect(pipes).toHaveLength(1);
    expect(pipes[0]?.unit).toBe('m');
    expect(pipes[0]?.quantity).toBeGreaterThan(8);
    expect(rows.find((r) => r.description === 'Válvula de gaveta')?.quantity).toBe(1);
    expect(rows.find((r) => r.description === 'Conjunto motobomba')?.quantity).toBe(1);
    expect(rows.find((r) => r.category === 'Válvula')?.family).toContain('genéricas');
    const csv = quantitiesToCsv(rows);
    expect(csv.startsWith(`${String.fromCharCode(0xfeff)}"Sistema";"Categoria"`)).toBe(true);
    expect(csv.split('\r\n').length).toBe(rows.length + 2);
    expect(csv).toMatch(/"m";\d+,\d{2}/);
  });

  it('exporta a rede no formato INP do EPANET', () => {
    const { project, pumpId } = plant();
    const without = exportEpanet(project);
    expect(without.warnings.some((w) => w.includes('não foi exportada'))).toBe(true);
    expect(without.inp).not.toMatch(/HEAD C1/);

    const rated = unwrap(updateFitting(project, pumpId, { ratedFlow: 0.02, ratedHead: 35 }));
    const { inp, warnings } = exportEpanet(rated);
    for (const section of [
      '[JUNCTIONS]',
      '[TANKS]',
      '[PIPES]',
      '[PUMPS]',
      '[CURVES]',
      '[OPTIONS]',
      '[COORDINATES]',
      '[END]',
    ]) {
      expect(inp).toContain(section);
    }
    const lines = (name: string): string[] => {
      const start = inp.indexOf(`[${name}]`);
      const end = inp.indexOf('\n[', start + 1);
      return inp
        .slice(start, end)
        .split('\n')
        .slice(1)
        .filter((l) => l.trim() !== '' && !l.startsWith(';'));
    };
    expect(lines('TANKS')).toHaveLength(1);
    // Três tubos (dois trechos de sucção e o recalque) e a válvula como trecho curto.
    expect(lines('PIPES')).toHaveLength(4);
    expect(lines('PUMPS')[0]).toMatch(/HEAD C1/);
    expect(lines('CURVES')[0]).toMatch(/20\.000\s+35\.00/);
    // Diâmetro interno em mm e unidades LPS.
    expect(lines('PIPES')[0]).toContain((testSpec(100).innerDiameter * 1000).toFixed(1));
    expect(inp).toContain('Units              LPS');
    // Nós: tanque, 2 da válvula, sucção e recalque da bomba, extremidade livre.
    expect(lines('JUNCTIONS').length + lines('TANKS').length).toBe(lines('COORDINATES').length);
    expect(warnings.some((w) => w.includes('reservatório'))).toBe(false);
    expect(warnings.some((w) => w.includes('Demandas'))).toBe(true);
  });
});
