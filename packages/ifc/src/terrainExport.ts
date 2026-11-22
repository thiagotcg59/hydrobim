import {
  projectEarthworks,
  terrainStats,
  type EarthworkSolid,
  type Project,
  type Vec3,
} from '@hydrobim/core';
import { buildTerrainIfcInfo } from './bim/terrainModel';
import { derivedGuid } from './guid';
import { list, real, stepString as str, type StepWriter } from './step';

/**
 * Terreno e terraplenagem no IFC 4.3 (entidades, tipos predefinidos e conjuntos conferidos em
 * `schemaData.ts`, gerado do esquema):
 *
 *  - superfície topográfica NATURAL → `IfcGeographicElement` / `TERRAIN`, com a malha em um
 *    `IfcTriangulatedFaceSet` aberto;
 *  - corte de cada platô → `IfcEarthworksCut` / `CUT`, que abre um vazio no terreno
 *    (`IfcRelVoidsElement`), com `Qto_EarthworksCutBaseQuantities`;
 *  - aterro de cada platô → `IfcEarthworksFill` / `EMBANKMENT`, com
 *    `Qto_EarthworksFillBaseQuantities`.
 *
 * O terreno projetado não é uma entidade à parte: é o terreno natural menos os cortes mais os
 * aterros, como no modelo do HydroBIM. As coordenadas são as locais do projeto; a posição no
 * sistema projetado é a do `IfcMapConversion` do contexto.
 */

export interface TerrainExportContext {
  readonly project: Project;
  readonly writer: StepWriter;
  readonly root: (
    type: string,
    guid: string,
    name: string | null,
    description: string | null,
    ...attributes: string[]
  ) => string;
  readonly relation: (type: string, seed: string, ...attributes: string[]) => string;
  readonly placement: (parent: string, position: Vec3) => string;
  readonly vector: (v: Vec3) => string;
  /** Subcontexto `Body` das representações. */
  readonly body: string;
  readonly site: { readonly ref: string; readonly placement: string };
  /** Estilo de superfície para uma cor (`#rrggbb`) e opacidade. */
  readonly style: (label: string, color: string, opacity: number) => string;
}

const TERRAIN_COLOR = '#8a9a5b';
const CUT_COLOR = '#dc2626';
const FILL_COLOR = '#2563eb';

/** Casca fechada e orientada: cada aresta em exatamente duas faces, uma em cada sentido. */
function isClosedShell(triangles: readonly number[]): boolean {
  const edges = new Map<string, { count: number; balance: number }>();
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    for (let e = 0; e < 3; e += 1) {
      const from = triangles[i + e] as number;
      const to = triangles[i + ((e + 1) % 3)] as number;
      const key = `${Math.min(from, to)},${Math.max(from, to)}`;
      const edge = edges.get(key) ?? { count: 0, balance: 0 };
      edge.count += 1;
      edge.balance += from < to ? 1 : -1;
      edges.set(key, edge);
    }
  }
  return triangles.length > 0 && [...edges.values()].every((e) => e.count === 2 && e.balance === 0);
}

/** Escreve o terreno e a terraplenagem; devolve as referências a conter no terreno (`IfcSite`). */
export function writeTerrain(context: TerrainExportContext): void {
  const { project, writer, root, relation, placement, vector, body, site, style } = context;
  const { terrain } = project;
  if (!terrain || terrain.triangles.length < 3) return;

  const stats = terrainStats(terrain);
  // Malhas relativas ao canto da superfície: coordenadas pequenas na representação.
  const base: Vec3 = { x: stats.minX, y: stats.minY, z: stats.minZ };
  const localPlacement = placement(site.placement, base);
  const relative = (p: Vec3): Vec3 => ({ x: p.x - base.x, y: p.y - base.y, z: p.z - base.z });

  const shape = (
    points: readonly Vec3[],
    triangles: readonly number[],
    closed: boolean,
    surfaceStyle: string,
  ): string => {
    const faces: string[] = [];
    for (let i = 0; i + 2 < triangles.length; i += 3) {
      faces.push(
        list([
          String((triangles[i] as number) + 1),
          String((triangles[i + 1] as number) + 1),
          String((triangles[i + 2] as number) + 1),
        ]),
      );
    }
    const coordinates = writer.entity(
      'IfcCartesianPointList3D',
      list(points.map((p) => vector(relative(p)))),
      '$',
    );
    const item = writer.entity(
      'IfcTriangulatedFaceSet',
      coordinates,
      '$',
      closed ? '.T.' : '.F.',
      list(faces),
      '$',
    );
    writer.entity('IfcStyledItem', item, list([surfaceStyle]), '$');
    const representation = writer.entity(
      'IfcShapeRepresentation',
      body,
      str('Body'),
      str('Tessellation'),
      list([item]),
    );
    return writer.entity('IfcProductDefinitionShape', '$', '$', list([representation]));
  };

  const single = (name: string, type: string, value: string | number | boolean | null): string =>
    writer.entity(
      'IfcPropertySingleValue',
      str(name),
      '$',
      value === null
        ? '$'
        : `${type.toUpperCase()}(${
            typeof value === 'string'
              ? str(value)
              : typeof value === 'boolean'
                ? value
                  ? '.T.'
                  : '.F.'
                : real(value)
          })`,
      '$',
    );
  const quantity = (entity: string, name: string, value: number): string =>
    writer.entity(entity, str(name), '$', '$', real(value), '$');
  const define = (owner: string, target: string, name: string, definition: string): void => {
    relation('IfcRelDefinesByProperties', `${owner}:${name}:relation`, list([target]), definition);
  };
  const propertySet = (owner: string, target: string, name: string, properties: string[]): void =>
    define(
      owner,
      target,
      name,
      root('IfcPropertySet', derivedGuid(`${owner}:${name}`), name, null, list(properties)),
    );
  const quantitySet = (owner: string, target: string, name: string, quantities: string[]): void =>
    define(
      owner,
      target,
      name,
      root(
        'IfcElementQuantity',
        derivedGuid(`${owner}:${name}`),
        name,
        null,
        '$',
        list(quantities),
      ),
    );

  // ---- Superfície topográfica natural: classificação, atributos e conjuntos vêm do modelo
  // de informação (`buildTerrainIfcInfo`), o mesmo que o painel de propriedades mostra.
  const info = buildTerrainIfcInfo(project);
  if (!info) return;
  const terrainRef = root(
    info.entity,
    info.globalId,
    info.name,
    info.description,
    str(info.objectType),
    localPlacement,
    shape(terrain.points, terrain.triangles, false, style('Terreno', TERRAIN_COLOR, 1)),
    info.tag ? str(info.tag) : '$',
    `.${info.predefinedType}.`,
  );
  for (const set of info.psets) {
    if (set.kind === 'qto') {
      quantitySet(
        terrain.id,
        terrainRef,
        set.name,
        set.properties.flatMap((property) =>
          typeof property.value === 'number'
            ? [quantity(property.ifcType, property.name, property.value)]
            : [],
        ),
      );
    } else {
      // Valor que a fonte não declara fica sem valor (pendente), nunca preenchido.
      propertySet(
        terrain.id,
        terrainRef,
        set.name,
        set.properties.map((property) => single(property.name, property.ifcType, property.value)),
      );
    }
  }
  const contained = [terrainRef];

  // ---- Terraplenagem: um corte e um aterro por platô (quando existem).
  const summary = projectEarthworks(project);
  const { swellPercent, compactionFactor } = project.earthworks;
  const swell = swellPercent === null ? null : 1 + swellPercent / 100;
  for (const entry of summary?.platforms ?? []) {
    const { platform, volumes } = entry;
    if (!volumes) continue;
    const solidShape = (solid: EarthworkSolid, label: string, color: string): string =>
      shape(
        solid.points,
        solid.triangles,
        isClosedShell(solid.triangles),
        style(label, color, 0.6),
      );
    const parameters = (owner: string, target: string): void =>
      propertySet(owner, target, 'HydroBIM_Plato', [
        single('PlatformName', 'IfcLabel', platform.name),
        single('PlatformElevation', 'IfcLengthMeasure', platform.elevation),
        single('CutSlopeHorizontalToVertical', 'IfcPositiveRatioMeasure', platform.cutSlope),
        single('FillSlopeHorizontalToVertical', 'IfcPositiveRatioMeasure', platform.fillSlope),
        single('SwellPercent', 'IfcReal', swellPercent),
        single('CompactedFillPerUndisturbedCut', 'IfcPositiveRatioMeasure', compactionFactor),
        single('ReusePercent', 'IfcReal', project.earthworks.reusePercent),
      ]);

    if (volumes.cutSolid && volumes.cut > 0) {
      const owner = `${platform.id}:cut`;
      const cutRef = root(
        'IfcEarthworksCut',
        derivedGuid(owner),
        `${platform.name} — corte`,
        'Volume de corte entre o terreno natural e o projetado',
        '$',
        localPlacement,
        solidShape(volumes.cutSolid, 'Corte', CUT_COLOR),
        '$',
        '.CUT.',
      );
      relation('IfcRelVoidsElement', `${owner}:voids`, terrainRef, cutRef);
      parameters(owner, cutRef);
      quantitySet(owner, cutRef, 'Qto_EarthworksCutBaseQuantities', [
        quantity('IfcQuantityVolume', 'UndisturbedVolume', volumes.cut),
        ...(swell === null
          ? []
          : [quantity('IfcQuantityVolume', 'LooseVolume', volumes.cut * swell)]),
      ]);
      quantitySet(owner, cutRef, 'HydroBIM_TerraplenagemQuantidades', [
        quantity('IfcQuantityArea', 'ProjectedArea', volumes.cutArea),
      ]);
    }
    if (volumes.fillSolid && volumes.fill > 0) {
      const owner = `${platform.id}:fill`;
      const fillRef = root(
        'IfcEarthworksFill',
        derivedGuid(owner),
        `${platform.name} — aterro`,
        'Volume de aterro entre o terreno natural e o projetado',
        '$',
        localPlacement,
        solidShape(volumes.fillSolid, 'Aterro', FILL_COLOR),
        '$',
        '.EMBANKMENT.',
      );
      parameters(owner, fillRef);
      // Volume solto necessário para o aterro: o compactado de volta ao estado in situ e daí
      // ao solto — só com os dois parâmetros informados.
      const loose =
        swell === null || compactionFactor === null
          ? null
          : (volumes.fill / compactionFactor) * swell;
      quantitySet(owner, fillRef, 'Qto_EarthworksFillBaseQuantities', [
        quantity('IfcQuantityVolume', 'CompactedVolume', volumes.fill),
        ...(loose === null ? [] : [quantity('IfcQuantityVolume', 'LooseVolume', loose)]),
      ]);
      quantitySet(owner, fillRef, 'HydroBIM_TerraplenagemQuantidades', [
        quantity('IfcQuantityArea', 'ProjectedArea', volumes.fillArea),
      ]);
      contained.push(fillRef);
    }
  }

  relation(
    'IfcRelContainedInSpatialStructure',
    `${terrain.id}:site-containment`,
    list(contained),
    site.ref,
  );
}
