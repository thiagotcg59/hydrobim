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
  TANK_NOZZLE_ROLE_LABELS,
  TANK_ORIGIN_LABELS,
  TANK_TYPE_LABELS,
  tankBottomType,
  tankGeometricVolume,
  tankInstallationType,
  tankLayout,
  tankNozzlePorts,
  tankParameterOrigins,
  tankTypeOf,
  type HydroElement,
  type Material,
  type Project,
  type PropertyValue,
  type SystemKind,
  type Tank,
  type TankFamily,
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
  /**
   * Famílias de reservatórios do catálogo. Com elas, a exportação registra a referência do
   * catálogo e a origem de cada parâmetro (catálogo, derivado, estimado ou do usuário).
   */
  tankFamilies?: readonly TankFamily[];
}

/** "Fabricados em aço carbono estrutural" — material dos reservatórios metálicos de catálogo. */
const STRUCTURAL_STEEL = 'Aço-carbono estrutural';
/** Tipos de valor IFC que são inteiros (não levam ponto decimal no arquivo). */
const INTEGER_TYPES = new Set(['IFCINTEGER', 'IFCCOUNTMEASURE']);
// Enumerações dos conjuntos de propriedades padrão (IFC 4.3), conferidas no IfcOpenShell.
const PENUM_TANK_ACCESS = [
  'LOOSECOVER',
  'MANHOLE',
  'NONE',
  'SECUREDCOVER',
  'SECUREDCOVERWITHMANHOLE',
  'OTHER',
  'NOTKNOWN',
  'UNSET',
];
const PENUM_TANK_PATTERN = [
  'HORIZONTALCYLINDER',
  'RECTANGULAR',
  'VERTICALCYLINDER',
  'OTHER',
  'NOTKNOWN',
  'UNSET',
];
const PENUM_END_SHAPE = [
  'CONCAVECONVEX',
  'CONCAVEFLAT',
  'CONVEXCONVEX',
  'FLATCONVEX',
  'FLATFLAT',
  'OTHER',
  'NOTKNOWN',
  'UNSET',
];
const PENUM_TANK_COMPOSITION = ['COMPLEX', 'ELEMENT', 'PARTIAL', 'OTHER', 'NOTKNOWN', 'UNSET'];
const PENUM_ASSEMBLY_PLACE = ['FACTORY', 'OFFSITE', 'SITE', 'OTHER', 'NOTKNOWN', 'UNSET'];

/** Reservatório de família de catálogo (forma construtiva definida). */
const isCatalogTank = (element: HydroElement): element is Tank =>
  element.kind === 'tank' && tankTypeOf(element) !== 'generic';

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
      // O filtro Y é um tipo interno de "válvula" (peça em linha), mas no IFC é IfcFilter.
      if (element.valveType === 'strainer') return ['IfcFilter', 'STRAINER'];
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
          strainer: 'NOTDEFINED',
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

  // Tubo liso: sólido extrudado. Tubo com flanges: malha, como as conexões (o perfil
  // extrudado não representa os flanges).
  const isSweptPipe = (element: HydroElement): boolean =>
    element.kind === 'pipe' && Object.keys(element.ends ?? {}).length === 0;

  const representation = (element: HydroElement, geometry: ElementGeometry): string => {
    const items: string[] = [];
    if (element.kind === 'pipe' && isSweptPipe(element)) {
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
      str(isSweptPipe(element) ? 'SweptSolid' : 'Tessellation'),
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
        : `${type.toUpperCase()}(${typeof value === 'string' ? str(value) : typeof value === 'boolean' ? (value ? '.T.' : '.F.') : INTEGER_TYPES.has(type.toUpperCase()) ? String(Math.round(value)) : real(value)})`,
      '$',
    );
  const enumerations = new Map<string, string>();
  /** Propriedade enumerada de um conjunto padrão (`PEnum_*`). */
  const enumerated = (
    name: string,
    enumeration: string,
    values: readonly string[],
    value: string,
  ): string => {
    let reference = enumerations.get(enumeration);
    if (!reference) {
      reference = writer.entity(
        'IfcPropertyEnumeration',
        str(enumeration),
        list(values.map((item) => `IFCLABEL(${str(item)})`)),
        '$',
      );
      enumerations.set(enumeration, reference);
    }
    return writer.entity(
      'IfcPropertyEnumeratedValue',
      str(name),
      '$',
      list([`IFCLABEL(${str(value)})`]),
      reference,
    );
  };
  const propertySet = (owner: string, name: string, members: string[]): string =>
    root('IfcPropertySet', derivedGuid(`${owner}:${name}`), name, null, list(members));
  const defineBy = (owner: string, name: string, target: string, definition: string): void => {
    relation('IfcRelDefinesByProperties', `${owner}:${name}:relation`, list([target]), definition);
  };

  /** Tipos de reservatório (`IfcTankType`): um por modelo comercial ou conjunto personalizado. */
  const tankTypes = new Map<string, { sample: Tank; members: string[] }>();
  const tankFamilyOf = (tank: Tank): TankFamily | undefined =>
    options.tankFamilies?.find((family) => family.id === tank.familyId);

  /** Propriedades, quantidades e tipo de um reservatório de catálogo. */
  const tankData = (tank: Tank, tankRef: string): void => {
    const layout = tankLayout(tank);
    const type = tankTypeOf(tank);
    const family = tankFamilyOf(tank);
    const base = tank.placement.position.z;
    const maker = tank.manufacturing.manufacturer ?? 'HydroBIM';
    const name = `Pset_${maker.replace(/[^A-Za-z0-9]/g, '')}_Reservatorio`;
    defineBy(
      tank.id,
      name,
      tankRef,
      propertySet(tank.id, name, [
        property('Manufacturer', 'IfcLabel', tank.manufacturing.manufacturer ?? null),
        property('Model', 'IfcLabel', tank.manufacturing.model ?? null),
        property('ReservoirType', 'IfcLabel', TANK_TYPE_LABELS[type]),
        property('NominalCapacity', 'IfcVolumeMeasure', tank.nominalCapacity ?? null),
        property('TotalHeight', 'IfcPositiveLengthMeasure', layout.top),
        property('Diameter', 'IfcPositiveLengthMeasure', tank.diameter),
        property('Length', 'IfcPositiveLengthMeasure', tank.length ?? null),
        property('ColumnHeight', 'IfcPositiveLengthMeasure', tank.columnHeight ?? null),
        property('ColumnDiameter', 'IfcPositiveLengthMeasure', tank.columnDiameter ?? null),
        property('ConeHeight', 'IfcPositiveLengthMeasure', tank.coneHeight ?? null),
        property('SupportHeight', 'IfcNonNegativeLengthMeasure', tank.supportHeight ?? null),
        // Sem valor quando o usuário não informou: o catálogo não tabula a espessura.
        property('ShellThickness', 'IfcPositiveLengthMeasure', tank.shellThickness ?? null),
        property('NumberOfCompartments', 'IfcInteger', tank.compartments ?? 1),
        property('BottomType', 'IfcLabel', tankBottomType(type)),
        property('InstallationType', 'IfcLabel', tankInstallationType(tank)),
        property('Material', 'IfcLabel', family?.material ?? STRUCTURAL_STEEL),
        property('CatalogReference', 'IfcText', family?.source ?? null),
        property('BaseElevation', 'IfcLengthMeasure', base),
        property(
          'MaxWaterLevelElevation',
          'IfcLengthMeasure',
          tank.maxWaterLevel === undefined ? null : base + tank.maxWaterLevel,
        ),
      ]),
    );
    defineBy(
      tank.id,
      'Pset_TankOccurrence',
      tankRef,
      propertySet(tank.id, 'Pset_TankOccurrence', [
        enumerated('TankComposition', 'PEnum_TankComposition', PENUM_TANK_COMPOSITION, 'ELEMENT'),
        property('HasLadder', 'IfcBoolean', tank.accessories?.ladder ?? false),
      ]),
    );
    if (family) {
      const origins = Object.entries(tankParameterOrigins(tank, family)).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      );
      defineBy(
        tank.id,
        'HydroBIM_Reservatorio_OrigemDosParametros',
        tankRef,
        propertySet(
          tank.id,
          'HydroBIM_Reservatorio_OrigemDosParametros',
          origins.map(([key, origin]) =>
            property(
              `${key.charAt(0).toUpperCase()}${key.slice(1)}`,
              'IfcLabel',
              TANK_ORIGIN_LABELS[origin],
            ),
          ),
        ),
      );
    }

    const quantity = (entity: string, label: string, value: number): string =>
      writer.entity(entity, str(label), '$', '$', real(value), '$');
    const horizontal = type === 'horizontal';
    const quantities = root(
      'IfcElementQuantity',
      derivedGuid(`${tank.id}:HydroBIM_Reservatorio_Quantidades`),
      'HydroBIM_Reservatorio_Quantidades',
      null,
      str('Dimensões externas, sem descontar chapas nem borda livre'),
      list([
        ...(tank.nominalCapacity === undefined
          ? []
          : [quantity('IfcQuantityVolume', 'NominalCapacity', tank.nominalCapacity)]),
        quantity('IfcQuantityVolume', 'GeometricVolume', tankGeometricVolume(tank)),
        quantity('IfcQuantityLength', 'TotalHeight', layout.top),
        quantity('IfcQuantityLength', 'Diameter', tank.diameter),
        ...(horizontal ? [quantity('IfcQuantityLength', 'Length', tank.length ?? 0)] : []),
        quantity(
          'IfcQuantityArea',
          'ProjectedArea',
          horizontal ? tank.diameter * (tank.length ?? 0) : Math.PI * layout.radius ** 2,
        ),
      ]),
    );
    defineBy(tank.id, 'HydroBIM_Reservatorio_Quantidades', tankRef, quantities);

    // Reservatórios do mesmo modelo comercial e mesma configuração compartilham o tipo.
    const key = tank.variantId
      ? JSON.stringify([
          tank.familyId,
          tank.variantId,
          tank.compartments ?? 1,
          tank.accessories?.manhole ?? false,
        ])
      : JSON.stringify(['custom', tank.id]);
    const entry = tankTypes.get(key);
    if (entry) entry.members.push(tankRef);
    else tankTypes.set(key, { sample: tank, members: [tankRef] });
  };

  const tankTypeObjects = (): string[] => {
    const refs: string[] = [];
    for (const [key, { sample, members }] of tankTypes) {
      const type = tankTypeOf(sample);
      const layout = tankLayout(sample);
      const horizontal = type === 'horizontal';
      const seed = `${project.id}:tank-type:${key}`;
      const psets = [
        propertySet(seed, 'Pset_TankTypeCommon', [
          property('Reference', 'IfcIdentifier', sample.variantId ?? sample.familyId ?? null),
          enumerated(
            'AccessType',
            'PEnum_TankAccessType',
            PENUM_TANK_ACCESS,
            sample.accessories?.manhole ? 'MANHOLE' : 'NONE',
          ),
          property(
            'NominalLengthOrDiameter',
            'IfcPositiveLengthMeasure',
            horizontal ? (sample.length ?? null) : sample.diameter,
          ),
          property('NominalWidthOrDiameter', 'IfcPositiveLengthMeasure', sample.diameter),
          property(
            'NominalDepth',
            'IfcNonNegativeLengthMeasure',
            horizontal ? sample.diameter : layout.top,
          ),
          property('TankNominalCapacity', 'IfcVolumeMeasure', sample.nominalCapacity ?? null),
          enumerated(
            'PatternType',
            'PEnum_TankPatternType',
            PENUM_TANK_PATTERN,
            horizontal ? 'HORIZONTALCYLINDER' : 'VERTICALCYLINDER',
          ),
          enumerated(
            'EndShapeType',
            'PEnum_EndShapeType',
            PENUM_END_SHAPE,
            horizontal
              ? 'CONVEXCONVEX'
              : layout.coneHeight > 0 || type === 'australian'
                ? 'OTHER'
                : 'FLATFLAT',
          ),
          property('NumberOfSections', 'IfcCountMeasure', sample.compartments ?? 1),
        ]),
        propertySet(seed, 'Pset_ManufacturerTypeInformation', [
          property('Manufacturer', 'IfcLabel', sample.manufacturing.manufacturer ?? null),
          property('ModelLabel', 'IfcLabel', sample.manufacturing.model ?? null),
          property('ModelReference', 'IfcLabel', sample.variantId ?? null),
          enumerated(
            'AssemblyPlace',
            'PEnum_AssemblyPlace',
            PENUM_ASSEMBLY_PLACE,
            type === 'fieldErected' ? 'SITE' : 'FACTORY',
          ),
        ]),
      ];
      const ref = root(
        'IfcTankType',
        derivedGuid(seed),
        sample.manufacturing.model ?? TANK_TYPE_LABELS[type],
        TANK_TYPE_LABELS[type],
        '$',
        list(psets),
        '$',
        '$',
        str(type),
        '.STORAGE.',
      );
      relation('IfcRelDefinesByType', `${seed}:occurrences`, list(members), ref);
      refs.push(ref);
    }
    return refs;
  };
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
    if (element.kind === 'pipe') {
      values.push(property('Length', 'IfcPositiveLengthMeasure', pipeLength(element)));
      // Tubo com flanges: acabamento de cada extremidade e dimensões do flange de catálogo.
      for (const [portId, end] of Object.entries(element.ends ?? {}).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      )) {
        const prefix = portId === 'start' ? 'StartFlange' : 'EndFlange';
        values.push(
          property(`${prefix}OuterDiameter`, 'IfcPositiveLengthMeasure', end.outerDiameter),
          property(`${prefix}Thickness`, 'IfcPositiveLengthMeasure', end.length),
        );
        if (end.boltCircle !== undefined && end.boltCount !== undefined)
          values.push(
            property(`${prefix}BoltCircle`, 'IfcPositiveLengthMeasure', end.boltCircle),
            property(`${prefix}BoltCount`, 'IfcInteger', end.boltCount),
          );
      }
    }
    if (element.kind === 'elbow')
      values.push(
        property('Angle', 'IfcPlaneAngleMeasure', element.angle),
        property('BendRadius', 'IfcPositiveLengthMeasure', element.bendRadius),
      );
    const pset = (name: string, members: string[]): void =>
      defineBy(element.id, name, elementRef, propertySet(element.id, name, members));
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
        : isCatalogTank(element)
          ? 'Geometria paramétrica da forma construtiva da família; dimensões principais do catálogo ou do usuário. Chapas, acessórios e bocais são representação ou configuração do usuário.'
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
    if (isCatalogTank(element)) tankData(element, elementRef);
    const nozzles =
      element.kind === 'tank'
        ? new Map(tankNozzlePorts(element).map((nozzle) => [nozzle.id, nozzle]))
        : null;
    const kind = systemKinds.get(element.systemId);
    if (!kind) throw new Error(`Sistema inexistente em "${element.name}".`);
    const nested = ports.map((port) => {
      const z = port.localDirection;
      const reference = Math.abs(dot(z, AXIS_Z)) > 0.9 ? AXIS_X : AXIS_Z;
      const x = normalize(sub(reference, scale(z, dot(reference, z))));
      // Bocais de reservatório têm função definida: a entrada recebe o escoamento (SINK);
      // saída, extravasor e descarga o entregam (SOURCE).
      const nozzle = nozzles?.get(port.ref.portId);
      const owner = `${element.id}:port:${port.ref.portId}`;
      const ref = root(
        'IfcDistributionPort',
        derivedGuid(owner),
        port.label,
        nozzle ? `Bocal: ${TANK_NOZZLE_ROLE_LABELS[nozzle.role].toLowerCase()}` : null,
        kind === 'other' ? str('other') : '$',
        placement(localPlacement, port.localPosition, z, x),
        '$',
        nozzle ? (nozzle.role === 'inlet' ? '.SINK.' : '.SOURCE.') : '.NOTDEFINED.',
        '.PIPE.',
        en(SYSTEM_TYPES[kind]),
      );
      if (nozzle) {
        // NominalDiameter é a designação DN expressa como comprimento (convenção do IFC);
        // os diâmetros físicos vêm da especificação de tubo escolhida para o bocal.
        defineBy(
          owner,
          'Pset_DistributionPortTypePipe',
          ref,
          propertySet(owner, 'Pset_DistributionPortTypePipe', [
            property('NominalDiameter', 'IfcPositiveLengthMeasure', port.spec.dn / 1000),
            property('InnerDiameter', 'IfcPositiveLengthMeasure', port.spec.innerDiameter),
            property('OuterDiameter', 'IfcPositiveLengthMeasure', port.spec.outerDiameter),
          ]),
        );
        defineBy(
          owner,
          'HydroBIM_Bocal',
          ref,
          propertySet(owner, 'HydroBIM_Bocal', [
            property('Function', 'IfcLabel', TANK_NOZZLE_ROLE_LABELS[nozzle.role]),
            property('NominalDiameterLabel', 'IfcLabel', port.spec.sizeLabel),
            property('HeightAboveBase', 'IfcLengthMeasure', nozzle.height),
            property('Azimuth', 'IfcPlaneAngleMeasure', nozzle.azimuth),
            property('Specification', 'IfcLabel', port.spec.standard),
          ]),
        );
      }
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
    // O material de um reservatório de catálogo é o do corpo, não o da tubulação dos bocais.
    const members = project.elements
      .filter((element) => element.spec.material === material && !isCatalogTank(element))
      .map((element) => elementRefs.get(element.id) ?? '$');
    if (!members.length) continue;
    const ref = writer.entity('IfcMaterial', str(MATERIAL_NAMES[material]), '$', '$');
    relation('IfcRelAssociatesMaterial', `${project.id}:material:${material}`, list(members), ref);
  }

  const typeRefs = tankTypeObjects();
  const steelTanks = project.elements
    .filter(isCatalogTank)
    .map((element) => elementRefs.get(element.id) ?? '$');
  if (steelTanks.length) {
    const steel = writer.entity('IfcMaterial', str(STRUCTURAL_STEEL), '$', str('steel'));
    relation(
      'IfcRelAssociatesMaterial',
      `${project.id}:material:structural-steel`,
      list([...steelTanks, ...typeRefs]),
      steel,
    );
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
