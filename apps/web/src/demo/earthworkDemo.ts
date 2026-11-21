import { resolvePipeSpec } from '@hydrobim/catalog';
import {
  addPipe,
  addPlatform,
  buildTerrainSurface,
  createProject,
  setEarthworkSettings,
  setTerrain,
  surveySource,
  terrainElevationAt,
  vec3,
  type Project,
  type Result,
  type Vec3,
} from '@hydrobim/core';

/**
 * Cenário de terraplenagem (`examples/terraplenagem-platos`): superfície de terreno, dois
 * platôs e um trecho de adutora, para a edição do terreno, o corte/aterro, o quadro de
 * volumes e a exportação IFC (`IfcGeographicElement`, `IfcEarthworksCut`, `IfcEarthworksFill`).
 *
 * A superfície é SINTÉTICA — uma encosta suave com ondulação, gerada por fórmula — e está
 * identificada assim no nome e na procedência: não é levantamento de lugar nenhum, e o projeto
 * não tem georreferência. Os parâmetros de volume (empolamento, fator de conversão e
 * aproveitamento) são valores ilustrativos do exemplo, não recomendações.
 */

const PBA = 'pvc-pba-nbr5647-cl15';

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`Exemplo de terraplenagem inválido: ${result.error.message}`);
  return result.value;
}

const ground = (x: number, y: number): number =>
  100 + 0.06 * x + 0.03 * y + 1.5 * Math.sin(x / 18) * Math.cos(y / 22);

export function createEarthworkDemoProject(): Project {
  let project = createProject('Terraplenagem — platôs', 'infra');

  const points: Vec3[] = [];
  for (let x = 0; x <= 120; x += 5) {
    for (let y = 0; y <= 120; y += 5) points.push(vec3(x, y, ground(x, y)));
  }
  const terrain = must(
    buildTerrainSurface({
      name: 'Terreno sintético de exemplo',
      tag: 'TN-EXEMPLO',
      points,
      boundary: null,
      breaklines: [],
      source: {
        ...surveySource('superfície gerada por fórmula (não é levantamento)', null),
        provider: 'Superfície sintética de exemplo',
        notes: 'Encosta com ondulação gerada por fórmula, só para demonstração.',
      },
    }),
  ).terrain;
  project = setTerrain(project, terrain);

  // Platô a meia encosta: parte em corte, parte em aterro.
  project = must(
    addPlatform(project, {
      name: 'Platô A — meia encosta',
      outline: [
        { x: 32, y: 34 },
        { x: 66, y: 38 },
        { x: 63, y: 62 },
        { x: 30, y: 58 },
      ],
      elevation: 104.5,
      cutSlope: 1,
      fillSlope: 1.5,
    }),
  ).project;
  // Platô elevado: todo em aterro.
  project = must(
    addPlatform(project, {
      name: 'Platô B — aterro',
      outline: [
        { x: 80, y: 76 },
        { x: 100, y: 76 },
        { x: 100, y: 94 },
        { x: 80, y: 94 },
      ],
      elevation: 109.5,
      cutSlope: 1,
      fillSlope: 1.5,
    }),
  ).project;
  project = must(
    setEarthworkSettings(project, { swellPercent: 25, compactionFactor: 0.9, reusePercent: 80 }),
  );

  // Trecho de adutora ao lado dos platôs, 0,80 m abaixo do terreno natural nas pontas.
  const spec = resolvePipeSpec(PBA, 100);
  if (!spec) throw new Error('DN 100 ausente na especificação PBA.');
  const axis = (x: number, y: number): Vec3 =>
    vec3(x, y, (terrainElevationAt(terrain, x, y) ?? ground(x, y)) - 0.8 - spec.outerDiameter / 2);
  project = must(
    addPipe(project, { start: axis(10, 15), end: axis(22, 15), spec, name: 'Adutora — trecho 1' }),
  ).project;
  return project;
}
