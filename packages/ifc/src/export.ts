import {
  AXIS_X,
  AXIS_Y,
  AXIS_Z,
  ZERO,
  dot,
  getPorts,
  normalize,
  pipeLength,
  rotate,
  scale,
  sub,
  type HydroElement,
  type Material,
  type Project,
  type PropertyValue,
  type SystemKind,
  type Vec3,
} from '@hydrobim/core';
import { buildElementGeometry, type ElementGeometry } from '@hydrobim/geometry';
import { derivedGuid, persistentGuid } from './guid';
import { weldMesh } from './mesh';
import { enumeration as en, list, real, StepWriter, stepString as str } from './step';

export interface IfcExportOptions {
  timestamp?: Date;
  author?: string;
  organization?: string;
  application?: string;
}

const SYSTEM_TYPES: Record<SystemKind, string> = {
  domesticColdWater: 'DOMESTICCOLDWATER',
  domesticHotWater: 'DOMESTICHOTWATER',
  fireProtection: 'FIREPROTECTION',
  waterSupply: 'WATERSUPPLY',
  other: 'USERDEFINED',
};
const MATERIAL_NAMES: Record<Material, string> = {
  pvc: 'PVC',
  hdpe: 'PEAD',
  ductileIron: 'Ferro fundido dúctil',
  carbonSteel: 'Aço-carbono',
};

function elementType(element: HydroElement): [string, string] {
  switch (element.kind) {
    case 'pipe':
      return ['IfcPipeSegment', 'RIGIDSEGMENT'];
    case 'elbow':
      return ['IfcPipeFitting', 'BEND'];
    case 'tee':
      return ['IfcPipeFitting', 'JUNCTION'];
    case 'reducer':
      return ['IfcPipeFitting', 'TRANSITION'];
    case 'pump':
      return ['IfcPump', 'ENDSUCTION'];
    case 'tank':
      return ['IfcTank', 'STORAGE'];
    case 'valve':
      return [
        'IfcValve',
        {
          gate: 'ISOLATING',
          ball: 'ISOLATING',
          butterfly: 'ISOLATING',
          globe: 'REGULATING',
          check: 'CHECK',
          airRelease: 'AIRRELEASE',
          pressureReducing: 'PRESSUREREDUCING',
        }[element.valveType],
      ];
  }
}

interface Container {
  id: string;
  ref: string;
  placement: string;
  elevation: number;
  elements: string[];
}

/**
 * Exporta um projeto válido sem mutá-lo ou acessar relógio, rede e armazenamento.
 * A ordem dos atributos foi conferida no esquema do IfcOpenShell IFC4X3_ADD2.
 */
export function exportIfc(project: Project, options: IfcExportOptions = {}): string {
  const writer = new StepWriter();
  const usedGuids = new Set<string>();
  const root = (
    type: string,
    guid: string,
    name: string | null,
    description: string | null,
    ...attributes: string[]
  ): string => {
    if (usedGuids.has(guid)) throw new Error(`GlobalId IFC duplicado: ${guid}.`);
    usedGuids.add(guid);
    return writer.entity(
      type,
      str(guid),
      '$',
      name === null ? '$' : str(name),
      description === null ? '$' : str(description),
      ...attributes,
    );
  };
  const relation = (type: string, seed: string, ...attributes: string[]): string =>
    root(type, derivedGuid(seed), null, null, ...attributes);
  const vector = (v: Vec3): string => list([real(v.x), real(v.y), real(v.z)]);
  const direction = (v: Vec3): string => writer.entity('IfcDirection', vector(v));
  const axis = (position: Vec3, z = AXIS_Z, x = AXIS_X): string =>
    writer.entity(
      'IfcAxis2Placement3D',
      writer.entity('IfcCartesianPoint', vector(position)),
      direction(z),
      direction(x),
    );
  const placement = (parent: string, position: Vec3, z = AXIS_Z, x = AXIS_X): string =>
    writer.entity('IfcLocalPlacement', parent, axis(position, z, x));

  const metre = writer.entity('IfcSIUnit', '*', '.LENGTHUNIT.', '$', '.METRE.');
  const units = writer.entity(
    'IfcUnitAssignment',
    list([
      metre,
      writer.entity('IfcSIUnit', '*', '.AREAUNIT.', '$', '.SQUARE_METRE.'),
      writer.entity('IfcSIUnit', '*', '.VOLUMEUNIT.', '$', '.CUBIC_METRE.'),
      writer.entity('IfcSIUnit', '*', '.PLANEANGLEUNIT.', '$', '.RADIAN.'),
    ]),
  );
  const context = writer.entity(
    'IfcGeometricRepresentationContext',
    str('Model'),
    str('Model'),
    '3',
    real(1e-5),
    axis(ZERO),
    '$',
  );
  const body = writer.entity(
    'IfcGeometricRepresentationSubContext',
    str('Body'),
    str('Model'),
    '*',
    '*',
    '*',
    '*',
    context,
    '$',
    '.MODEL_VIEW.',
    '$',
  );
  const projectRef = root(
    'IfcProject',
    persistentGuid(project.id),
    project.name,
    null,
    '$',
    '$',
    '$',
    list([context]),
    units,
  );

  if (project.georeference) {
    const geo = project.georeference;
    const crs = writer.entity(
      'IfcProjectedCRS',
      str(geo.epsg === null ? geo.crsName : `EPSG:${geo.epsg}`),
      str(geo.crsName),
      '$',
      '$',
      '$',
      '$',
      metre,
    );
    writer.entity(
      'IfcMapConversion',
      context,
      crs,
      real(geo.eastings),
      real(geo.northings),
      real(geo.orthogonalHeight),
      real(Math.cos(geo.rotation)),
      real(Math.sin(geo.rotation)),
      real(1),
    );
  }

  const sitePlacement = placement('$', ZERO);
  const siteRef = root(
    'IfcSite',
    derivedGuid(`${project.id}:site`),
    project.name,
    null,
    '$',
    sitePlacement,
    '$',
    '$',
    '.ELEMENT.',
    '$',
    '$',
    '$',
    '$',
    '$',
  );
  relation('IfcRelAggregates', `${project.id}:project-site`, projectRef, list([siteRef]));
  let fallback: Container = {
    id: `${project.id}:site`,
    ref: siteRef,
    placement: sitePlacement,
    elevation: 0,
    elements: [],
  };
  const storeys: Container[] = [];
  if (project.discipline === 'mep') {
    const buildingPlacement = placement(sitePlacement, ZERO);
    const building = root(
      'IfcBuilding',
      derivedGuid(`${project.id}:building`),
      project.name,
      null,
      '$',
      buildingPlacement,
      '$',
      '$',
      '.ELEMENT.',
      '$',
      '$',
      '$',
    );
    relation('IfcRelAggregates', `${project.id}:site-building`, siteRef, list([building]));
    fallback = {
      id: `${project.id}:building`,
      ref: building,
      placement: buildingPlacement,
      elevation: 0,
      elements: [],
    };
    for (const level of [...project.levels].sort(
      (a, b) => a.elevation - b.elevation || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )) {
      const levelPlacement = placement(buildingPlacement, { x: 0, y: 0, z: level.elevation });
      const ref = root(
        'IfcBuildingStorey',
        derivedGuid(`${level.id}:storey`),
        level.name,
        null,
        '$',
        levelPlacement,
        '$',
        '$',
        '.ELEMENT.',
        real(level.elevation),
      );
      storeys.push({
        id: level.id,
        ref,
        placement: levelPlacement,
        elevation: level.elevation,
        elements: [],
      });
    }
    if (storeys.length)
      relation(
        'IfcRelAggregates',
        `${project.id}:building-storeys`,
        building,
        list(storeys.map((s) => s.ref)),
      );
  }

  const representation = (element: HydroElement, geometry: ElementGeometry): string => {
    const items: string[] = [];
    if (element.kind === 'pipe') {
      const profile = writer.entity(
        'IfcCircleHollowProfileDef',
        '.AREA.',
        '$',
        '$',
        real(element.spec.outerDiameter / 2),
        real(element.spec.wallThickness),
      );
      // O perfil XY do sólido é colocado no plano YZ do elemento; seu +Z vira +X.
      items.push(
        writer.entity(
          'IfcExtrudedAreaSolid',
          profile,
          axis(ZERO, AXIS_X, AXIS_Y),
          direction(AXIS_Z),
          real(pipeLength(element)),
        ),
      );
    } else {
      for (const part of geometry.parts) {
        const mesh = weldMesh(part.mesh);
        if (mesh.triangles.length === 0)
          throw new Error(`Malha sem faces válidas em "${element.name}".`);
        const points = writer.entity('IfcCartesianPointList3D', list(mesh.points.map(vector)), '$');
        items.push(
          writer.entity(
            'IfcTriangulatedFaceSet',
            points,
            '$',
            mesh.closed ? '.T.' : '.F.',
            list(mesh.triangles.map((face) => list(face.map(String)))),
            '$',
          ),
        );
      }
    }
    const shape = writer.entity(
      'IfcShapeRepresentation',
      body,
      str('Body'),
      str(element.kind === 'pipe' ? 'SweptSolid' : 'Tessellation'),
      list(items),
    );
    return writer.entity('IfcProductDefinitionShape', '$', '$', list([shape]));
  };

  const property = (name: string, type: string, value: PropertyValue | null): string =>
    writer.entity(
      'IfcPropertySingleValue',
      str(name),
      '$',
      value === null
        ? '$'
        : `${type.toUpperCase()}(${typeof value === 'string' ? str(value) : typeof value === 'boolean' ? (value ? '.T.' : '.F.') : real(value)})`,
      '$',
    );
  const properties = (element: HydroElement, elementRef: string): void => {
    const spec = element.spec;
    const values = [
      property('NominalDiameter', 'IfcLabel', spec.sizeLabel),
      property('DN', 'IfcReal', spec.dn),
      property('OuterDiameter', 'IfcPositiveLengthMeasure', spec.outerDiameter),
      property('InnerDiameter', 'IfcPositiveLengthMeasure', spec.innerDiameter),
      property('WallThickness', 'IfcPositiveLengthMeasure', spec.wallThickness),
      property('Standard', 'IfcLabel', spec.standard),
      property('PressureClass', 'IfcLabel', spec.pressureClass),
      property('JointType', 'IfcLabel', spec.jointType),
      property('Material', 'IfcLabel', MATERIAL_NAMES[spec.material]),
    ];
    if (element.familyId !== null) values.push(property('FamilyId', 'IfcLabel', element.familyId));
    if (element.kind === 'reducer')
      values.push(
        property('OutletNominalDiameter', 'IfcLabel', element.outletSpec.sizeLabel),
        property(
          'OutletOuterDiameter',
          'IfcPositiveLengthMeasure',
          element.outletSpec.outerDiameter,
        ),
      );
    if (element.kind === 'pipe')
      values.push(property('Length', 'IfcPositiveLengthMeasure', pipeLength(element)));
    if (element.kind === 'elbow')
      values.push(
        property('Angle', 'IfcPlaneAngleMeasure', element.angle),
        property('BendRadius', 'IfcPositiveLengthMeasure', element.bendRadius),
      );
    const pset = (name: string, members: string[]): void => {
      const ref = root(
        'IfcPropertySet',
        derivedGuid(`${element.id}:${name}`),
        name,
        null,
        list(members),
      );
      relation(
        'IfcRelDefinesByProperties',
        `${element.id}:${name}:relation`,
        list([elementRef]),
        ref,
      );
    };
    pset('HydroBIM_Especificacao', values);
    const free = Object.entries(element.properties).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    if (free.length)
      pset(
        'HydroBIM_Propriedades',
        free.map(([name, value]) =>
          property(
            name,
            typeof value === 'string'
              ? 'IfcText'
              : typeof value === 'boolean'
                ? 'IfcBoolean'
                : 'IfcReal',
            value,
          ),
        ),
      );
  };

  const elementRefs = new Map<string, string>();
  const portRefs = new Map<string, string>();
  const portKey = (elementId: string, portId: string): string =>
    JSON.stringify([elementId, portId]);
  const systemKinds = new Map(project.systems.map((system) => [system.id, system.kind]));
  for (const element of project.elements) {
    const ports = getPorts(element);
    const minZ = Math.min(...ports.map((port) => port.position.z));
    let container = storeys[0] ?? fallback;
    for (const storey of storeys) if (storey.elevation <= minZ) container = storey;
    const geometry = buildElementGeometry(element);
    const frame = geometry.transform;
    const localPlacement = placement(
      container.placement,
      sub(frame.position, { x: 0, y: 0, z: container.elevation }),
      rotate(frame.rotation, AXIS_Z),
      rotate(frame.rotation, AXIS_X),
    );
    const [type, predefined] = elementType(element);
    const description =
      element.kind === 'pipe'
        ? null
        : element.familyId === null
          ? 'Geometria genérica; dimensões livres, sem identificação de produto comercial.'
          : 'Geometria simplificada; dimensões principais da família de catálogo.';
    const elementRef = root(
      type,
      persistentGuid(element.id),
      element.name,
      description,
      str(element.kind === 'valve' ? element.valveType : element.kind),
      localPlacement,
      representation(element, geometry),
      str(element.id),
      en(predefined),
    );
    elementRefs.set(element.id, elementRef);
    container.elements.push(elementRef);
    properties(element, elementRef);
    const kind = systemKinds.get(element.systemId);
    if (!kind) throw new Error(`Sistema inexistente em "${element.name}".`);
    const nested = ports.map((port) => {
      const z = port.localDirection;
      const reference = Math.abs(dot(z, AXIS_Z)) > 0.9 ? AXIS_X : AXIS_Z;
      const x = normalize(sub(reference, scale(z, dot(reference, z))));
      const ref = root(
        'IfcDistributionPort',
        derivedGuid(`${element.id}:port:${port.ref.portId}`),
        port.label,
        null,
        kind === 'other' ? str('other') : '$',
        placement(localPlacement, port.localPosition, z, x),
        '$',
        '.NOTDEFINED.',
        '.PIPE.',
        en(SYSTEM_TYPES[kind]),
      );
      portRefs.set(portKey(element.id, port.ref.portId), ref);
      return ref;
    });
    relation('IfcRelNests', `${element.id}:ports`, elementRef, list(nested));
  }
  for (const container of [fallback, ...storeys]) {
    if (container.elements.length)
      relation(
        'IfcRelContainedInSpatialStructure',
        `${container.id}:containment`,
        list(container.elements),
        container.ref,
      );
  }
  for (const connection of project.connections) {
    const a = portRefs.get(portKey(connection.a.elementId, connection.a.portId));
    const b = portRefs.get(portKey(connection.b.elementId, connection.b.portId));
    if (!a || !b) throw new Error('Conexão referencia porta inexistente na exportação IFC.');
    relation('IfcRelConnectsPorts', `${connection.id}:connection`, a, b, '$');
  }
  for (const system of project.systems) {
    const members = project.elements
      .filter((element) => element.systemId === system.id)
      .map((element) => elementRefs.get(element.id) ?? '$');
    if (!members.length) continue;
    const ref = root(
      'IfcDistributionSystem',
      derivedGuid(`${system.id}:system`),
      system.name,
      null,
      system.kind === 'other' ? str(system.kind) : '$',
      '$',
      en(SYSTEM_TYPES[system.kind]),
    );
    relation('IfcRelAssignsToGroup', `${system.id}:elements`, list(members), '$', ref);
  }
  for (const material of Object.keys(MATERIAL_NAMES) as Material[]) {
    const members = project.elements
      .filter((element) => element.spec.material === material)
      .map((element) => elementRefs.get(element.id) ?? '$');
    if (!members.length) continue;
    const ref = writer.entity('IfcMaterial', str(MATERIAL_NAMES[material]), '$', '$');
    relation('IfcRelAssociatesMaterial', `${project.id}:material:${material}`, list(members), ref);
  }

  const updatedAt = Date.parse(project.updatedAt);
  const timestamp = options.timestamp ?? new Date(Number.isFinite(updatedAt) ? updatedAt : 0);
  const application = options.application ?? 'HydroBIM';
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');",
    `FILE_NAME(${str(`${project.name}.ifc`)},${str(timestamp.toISOString())},${list([str(options.author ?? '')])},${list([str(options.organization ?? '')])},${str(application)},${str(application)},'');`,
    "FILE_SCHEMA(('IFC4X3_ADD2'));",
    'ENDSEC;',
    'DATA;',
    writer.toString(),
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}
