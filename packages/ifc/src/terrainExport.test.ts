import {
  addPlatform,
  buildTerrainSurface,
  createProject,
  projectEarthworks,
  setEarthworkSettings,
  setTerrain,
  surveySource,
  type Project,
  type Result,
  type Vec3,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { IFC_ENTITIES, IFC_PROPERTY_SETS } from './bim/schemaData';
import { exportIfc } from './export';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** Terreno inclinado (z = 10 + 0,1 x) com um platô a meia encosta na cota 15. */
function earthworkProject(): Project {
  const points: Vec3[] = [];
  for (let x = 0; x <= 100; x += 10) {
    for (let y = 0; y <= 100; y += 10) points.push({ x, y, z: 10 + 0.1 * x });
  }
  const terrain = unwrap(
    buildTerrainSurface({
      id: 'terreno-teste',
      tag: 'TN-01',
      name: 'Terreno natural',
      points,
      boundary: null,
      breaklines: [],
      source: surveySource('levantamento.xyz', '2026-11-21T00:00:00.000Z'),
    }),
  ).terrain;
  const project = setTerrain(createProject('Terraplenagem', 'infra'), terrain);
  return unwrap(
    addPlatform(project, {
      name: 'Platô 1',
      outline: [
        { x: 40, y: 40 },
        { x: 60, y: 40 },
        { x: 60, y: 60 },
        { x: 40, y: 60 },
      ],
      elevation: 15,
      cutSlope: 1,
      fillSlope: 1,
    }),
  ).project;
}

const options = { timestamp: new Date('2026-01-01T00:00:00Z') };
const linesOf = (ifc: string, entity: string): string[] =>
  ifc.split('\n').filter((line) => line.includes(`=${entity}(`));
const volumeOf = (ifc: string, name: string): number[] =>
  [...ifc.matchAll(new RegExp(`IFCQUANTITYVOLUME\\('${name}',\\$,\\$,([-0-9.E+]+),`, 'g'))].map(
    (match) => Number(match[1]),
  );

describe('terreno e terraplenagem no IFC', () => {
  it('as classes, os tipos e os conjuntos usados existem no esquema', () => {
    expect(IFC_ENTITIES.IfcGeographicElement?.predefinedTypes).toContain('TERRAIN');
    expect(IFC_ENTITIES.IfcEarthworksCut?.predefinedTypes).toContain('CUT');
    expect(IFC_ENTITIES.IfcEarthworksCut?.ancestors).toContain('IfcFeatureElementSubtraction');
    expect(IFC_ENTITIES.IfcEarthworksFill?.predefinedTypes).toContain('EMBANKMENT');
    expect(
      Object.keys(IFC_PROPERTY_SETS.Qto_EarthworksCutBaseQuantities?.properties ?? {}),
    ).toEqual(expect.arrayContaining(['UndisturbedVolume', 'LooseVolume']));
    expect(
      Object.keys(IFC_PROPERTY_SETS.Qto_EarthworksFillBaseQuantities?.properties ?? {}),
    ).toEqual(expect.arrayContaining(['CompactedVolume', 'LooseVolume']));
  });

  it('exporta o terreno natural, o corte (vazio no terreno) e o aterro, com os volumes', () => {
    const project = earthworkProject();
    const ifc = exportIfc(project, options);
    const summary = projectEarthworks(project);
    const terrain = linesOf(ifc, 'IFCGEOGRAPHICELEMENT');
    expect(terrain).toHaveLength(1);
    expect(terrain[0]).toContain("'Terreno natural'");
    expect(terrain[0]).toContain("'TN-01'");
    expect(terrain[0]).toContain('.TERRAIN.');
    const cuts = linesOf(ifc, 'IFCEARTHWORKSCUT');
    const fills = linesOf(ifc, 'IFCEARTHWORKSFILL');
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toContain('.CUT.');
    expect(fills).toHaveLength(1);
    expect(fills[0]).toContain('.EMBANKMENT.');
    // O corte abre um vazio no terreno; o terreno e o aterro ficam contidos no IfcSite.
    const terrainRef = terrain[0]?.split('=')[0];
    const cutRef = cuts[0]?.split('=')[0];
    const voids = linesOf(ifc, 'IFCRELVOIDSELEMENT');
    expect(voids).toHaveLength(1);
    expect(voids[0]).toContain(`${terrainRef},${cutRef})`);
    expect(ifc).toContain("'Qto_EarthworksCutBaseQuantities'");
    expect(ifc).toContain("'Qto_EarthworksFillBaseQuantities'");
    expect(volumeOf(ifc, 'UndisturbedVolume')[0]).toBeCloseTo(summary?.total.cut as number, 6);
    expect(volumeOf(ifc, 'CompactedVolume')[0]).toBeCloseTo(summary?.total.fill as number, 6);
    // Sem empolamento informado, o volume solto não é escrito (não é presumido).
    expect(volumeOf(ifc, 'LooseVolume')).toEqual([]);
    // Em terreno plano inclinado os sólidos são cascas fechadas.
    const closed = linesOf(ifc, 'IFCTRIANGULATEDFACESET').map((line) => line.includes(',.T.,'));
    expect(closed.filter(Boolean).length).toBeGreaterThanOrEqual(2);
  });

  it('com empolamento e fator informados, grava os volumes soltos convertidos', () => {
    const project = unwrap(
      setEarthworkSettings(earthworkProject(), {
        swellPercent: 25,
        compactionFactor: 0.8,
        reusePercent: 100,
      }),
    );
    const ifc = exportIfc(project, options);
    const summary = projectEarthworks(project);
    const loose = volumeOf(ifc, 'LooseVolume');
    expect(loose).toHaveLength(2);
    expect(loose[0]).toBeCloseTo((summary?.total.cut as number) * 1.25, 6);
    expect(loose[1]).toBeCloseTo(((summary?.total.fill as number) / 0.8) * 1.25, 6);
  });

  it('sem platôs exporta só o terreno; sem terreno, nada', () => {
    const withTerrain = { ...earthworkProject() };
    const onlyTerrain = exportIfc(
      { ...withTerrain, earthworks: { ...withTerrain.earthworks, platforms: [] } },
      options,
    );
    expect(linesOf(onlyTerrain, 'IFCGEOGRAPHICELEMENT')).toHaveLength(1);
    expect(linesOf(onlyTerrain, 'IFCEARTHWORKSCUT')).toHaveLength(0);
    const empty = exportIfc(createProject('Vazio', 'infra'), options);
    expect(linesOf(empty, 'IFCGEOGRAPHICELEMENT')).toHaveLength(0);
  });

  it('a exportação é determinística (mesmo projeto, mesmo arquivo)', () => {
    const project = earthworkProject();
    expect(exportIfc(project, options)).toBe(exportIfc(project, options));
  });
});
