import {
  AXIS_X,
  AXIS_Y,
  AXIS_Z,
  ZERO,
  findProjectedCrs,
  pipeLength,
  rotate,
  sub,
  type HydroElement,
  type Project,
  type Vec3,
} from '@hydrobim/core';
import {
  buildElementGeometry,
  partFinish,
  type ElementGeometry,
  type PartRole,
  type SurfaceFinish,
} from '@hydrobim/geometry';
import { buildIfcModel, type IfcModelOptions } from './bim/model';
import type { IfcPropertyInfo, IfcPropertySetInfo, IfcValue } from './bim/types';
import { isIntegerIfcType } from './bim/values';
import { derivedGuid, persistentGuid } from './guid';
import { weldMesh } from './mesh';
import { enumeration as en, list, real, StepWriter, stepString as str } from './step';

/**
 * Opções da exportação. As famílias (catálogo + projeto) alimentam os
 * tipos IFC: referência do catálogo, fabricante e origem de cada parâmetro.
 */
export interface IfcExportOptions extends IfcModelOptions {
  timestamp?: Date;
  author?: string;
  organization?: string;
  application?: string;
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

  const si = (type: string, name: string): string =>
    writer.entity('IfcSIUnit', '*', en(type), '$', en(name));
  const metre = si('LENGTHUNIT', 'METRE');
  const cubicMetre = si('VOLUMEUNIT', 'CUBIC_METRE');
  const second = si('TIMEUNIT', 'SECOND');
  const power = (unit: string, exponent: number): string =>
    writer.entity('IfcDerivedUnitElement', unit, String(exponent));
  // Unidades SI de todas as grandezas usadas nas propriedades (pressão em pascal, vazão em
  // m³/s, potência em watt, rotação em s⁻¹).
  const units = writer.entity(
    'IfcUnitAssignment',
    list([
      metre,
      si('AREAUNIT', 'SQUARE_METRE'),
      cubicMetre,
      si('PLANEANGLEUNIT', 'RADIAN'),
      second,
      si('PRESSUREUNIT', 'PASCAL'),
      si('POWERUNIT', 'WATT'),
      writer.entity(
        'IfcDerivedUnit',
        list([power(cubicMetre, 1), power(second, -1)]),
        '.VOLUMETRICFLOWRATEUNIT.',
        '$',
        '$',
      ),
      writer.entity(
        'IfcDerivedUnit',
        list([power(second, -1)]),
        '.ROTATIONALFREQUENCYUNIT.',
        '$',
        '$',
      ),
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
    // Datum, projeção e fuso só são escritos quando o EPSG está no registro do HydroBIM
    // (parâmetros conferidos); a referência altimétrica, só quando o usuário a informou.
    const known = geo.epsg === null ? null : findProjectedCrs(geo.epsg);
    const crs = writer.entity(
      'IfcProjectedCRS',
      str(geo.epsg === null ? geo.crsName : `EPSG:${geo.epsg}`),
      str(geo.crsName),
      known ? str(known.datum) : '$',
      geo.verticalDatum === null ? '$' : str(geo.verticalDatum),
      known ? str('UTM') : '$',
      known ? str(`${known.zone}${known.hemisphere}`) : '$',
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

  // Aparência: cada item geométrico recebe o acabamento que a vista 3D usa na parte
  // (cor do material ou do sistema, rugosidade e metalicidade). Sem estilo, os
  // visualizadores mostram tudo em branco. Acabamentos iguais compartilham o estilo.
  const systemColors = new Map(project.systems.map((system) => [system.id, system.color]));
  const styles = new Map<string, string>();
  const surfaceStyle = (finish: SurfaceFinish): string => {
    const key = `${finish.color}|${finish.roughness}|${finish.metalness}`;
    let style = styles.get(key);
    if (!style) {
      const channel = (offset: number): string =>
        real(Number.parseInt(finish.color.slice(offset, offset + 2), 16) / 255);
      const colour = writer.entity('IfcColourRgb', '$', channel(1), channel(3), channel(5));
      // Método PHYSICAL do IFC 4.3: DiffuseColour é a cor base, SpecularColour o fator
      // metálico e SpecularHighlight a rugosidade — os parâmetros do material da vista 3D.
      const rendering = writer.entity(
        'IfcSurfaceStyleRendering',
        colour,
        real(0),
        colour,
        '$',
        '$',
        '$',
        `IFCNORMALISEDRATIOMEASURE(${real(finish.metalness)})`,
        `IFCSPECULARROUGHNESS(${real(finish.roughness)})`,
        '.PHYSICAL.',
      );
      style = writer.entity('IfcSurfaceStyle', str(finish.label), '.BOTH.', list([rendering]));
      styles.set(key, style);
    }
    return style;
  };

  const representation = (element: HydroElement, geometry: ElementGeometry): string => {
    const items: string[] = [];
    const systemColor = systemColors.get(element.systemId);
    const styled = (item: string, role: PartRole): string => {
      const style = surfaceStyle(partFinish(role, element.spec.material, systemColor));
      writer.entity('IfcStyledItem', item, list([style]), '$');
      return item;
    };
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
        styled(
          writer.entity(
            'IfcExtrudedAreaSolid',
            profile,
            axis(ZERO, AXIS_X, AXIS_Y),
            direction(AXIS_Z),
            real(pipeLength(element)),
          ),
          'body',
        ),
      );
    } else {
      for (const part of geometry.parts) {
        const mesh = weldMesh(part.mesh);
        if (mesh.triangles.length === 0)
          throw new Error(`Malha sem faces válidas em "${element.name}".`);
        const points = writer.entity('IfcCartesianPointList3D', list(mesh.points.map(vector)), '$');
        items.push(
          styled(
            writer.entity(
              'IfcTriangulatedFaceSet',
              points,
              '$',
              mesh.closed ? '.T.' : '.F.',
              list(mesh.triangles.map((face) => list(face.map(String)))),
              '$',
            ),
            part.role,
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

  // O modelo de informação é a fonte única: o que a aba BIM / IFC mostra é o que se grava.
  const model = buildIfcModel(project, options);

  const typed = (type: string, value: IfcValue): string =>
    `${type.toUpperCase()}(${typeof value === 'string' ? str(value) : typeof value === 'boolean' ? (value ? '.T.' : '.F.') : isIntegerIfcType(type) ? String(Math.round(value)) : real(value)})`;
  const enumerations = new Map<string, string>();
  /** Propriedade (valor simples ou enumerado); sem valor = dado não informado. */
  const property = (info: IfcPropertyInfo): string => {
    if (info.kind !== 'enumerated' || !info.enumeration)
      return writer.entity(
        'IfcPropertySingleValue',
        str(info.name),
        '$',
        info.value === null ? '$' : typed(info.ifcType, info.value),
        '$',
      );
    let reference = enumerations.get(info.enumeration.name);
    if (!reference) {
      reference = writer.entity(
        'IfcPropertyEnumeration',
        str(info.enumeration.name),
        list(info.enumeration.values.map((item) => `IFCLABEL(${str(item)})`)),
        '$',
      );
      enumerations.set(info.enumeration.name, reference);
    }
    return writer.entity(
      'IfcPropertyEnumeratedValue',
      str(info.name),
      '$',
      info.value === null ? '$' : list([`IFCLABEL(${str(String(info.value))})`]),
      reference,
    );
  };
  const QUANTITY_ENTITIES = new Set([
    'IfcQuantityLength',
    'IfcQuantityArea',
    'IfcQuantityVolume',
    'IfcQuantityCount',
    'IfcQuantityWeight',
  ]);
  /** Conjunto de propriedades (`IfcPropertySet`) ou de quantidades (`IfcElementQuantity`). */
  const definitionSet = (owner: string, set: IfcPropertySetInfo): string => {
    const guid = derivedGuid(`${owner}:${set.name}`);
    if (set.kind === 'pset')
      return root(
        'IfcPropertySet',
        guid,
        set.name,
        set.description,
        list(set.properties.map(property)),
      );
    return root(
      'IfcElementQuantity',
      guid,
      set.name,
      null,
      set.description === null ? '$' : str(set.description),
      list(
        set.properties.map((info) => {
          if (!QUANTITY_ENTITIES.has(info.ifcType) || typeof info.value !== 'number')
            throw new Error(`Quantidade inválida: ${set.name}.${info.name}.`);
          const value =
            info.ifcType === 'IfcQuantityCount' ? String(Math.round(info.value)) : real(info.value);
          return writer.entity(info.ifcType, str(info.name), '$', '$', value, '$');
        }),
      ),
    );
  };
  const define = (owner: string, target: string, sets: readonly IfcPropertySetInfo[]): void => {
    for (const set of sets)
      relation(
        'IfcRelDefinesByProperties',
        `${owner}:${set.name}:relation`,
        list([target]),
        definitionSet(owner, set),
      );
  };

  const elementRefs = new Map<string, string>();
  const portRefs = new Map<string, string>();
  const portKey = (elementId: string, portId: string): string =>
    JSON.stringify([elementId, portId]);
  const sources = new Map(project.elements.map((element) => [element.id, element]));
  for (const info of model.elements) {
    const element = sources.get(info.elementId);
    if (!element) throw new Error(`Elemento inexistente na exportação IFC: ${info.elementId}.`);
    const minZ = Math.min(...info.ports.map((port) => port.position.z));
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
    const elementRef = root(
      info.entity,
      info.globalId,
      info.name,
      info.description,
      str(info.objectType),
      localPlacement,
      representation(element, geometry),
      str(info.tag),
      en(info.predefinedType),
    );
    elementRefs.set(info.elementId, elementRef);
    container.elements.push(elementRef);
    define(info.elementId, elementRef, info.psets);
    const nested = info.ports.map((port) => {
      const owner = `${info.elementId}:port:${port.portId}`;
      const ref = root(
        'IfcDistributionPort',
        port.globalId,
        port.name,
        port.description,
        port.systemType === 'USERDEFINED' ? str('other') : '$',
        placement(localPlacement, port.localPosition, port.localDirection, port.localReference),
        '$',
        en(port.flowDirection),
        '.PIPE.',
        en(port.systemType),
      );
      define(owner, ref, port.psets);
      portRefs.set(portKey(info.elementId, port.portId), ref);
      return ref;
    });
    relation('IfcRelNests', `${info.elementId}:ports`, elementRef, list(nested));
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
  const refsOf = (ids: readonly string[]): string[] => ids.map((id) => elementRefs.get(id) ?? '$');
  for (const system of model.systems) {
    if (!system.memberIds.length) continue;
    const ref = root(
      'IfcDistributionSystem',
      system.globalId,
      system.name,
      null,
      system.objectType === null ? '$' : str(system.objectType),
      '$',
      en(system.predefinedType),
    );
    relation(
      'IfcRelAssignsToGroup',
      `${system.systemId}:elements`,
      list(refsOf(system.memberIds)),
      '$',
      ref,
    );
  }

  // Tipos (`Ifc…Type`): dados da família, compartilhados pelas ocorrências do mesmo tipo.
  const typeRefs = new Map<string, string>();
  for (const type of model.types) {
    const ref = root(
      type.entity,
      type.globalId,
      type.name,
      type.description,
      '$',
      type.psets.length ? list(type.psets.map((set) => definitionSet(type.seed, set))) : '$',
      '$',
      '$',
      str(type.elementType),
      en(type.predefinedType),
    );
    relation('IfcRelDefinesByType', `${type.seed}:occurrences`, list(refsOf(type.memberIds)), ref);
    typeRefs.set(type.key, ref);
  }

  // Materiais: associados às ocorrências e aos tipos.
  const materials = new Map<string, { category: string | null; members: string[] }>();
  const associate = (name: string, category: string | null, ref: string): void => {
    const entry = materials.get(name);
    if (entry) entry.members.push(ref);
    else materials.set(name, { category, members: [ref] });
  };
  for (const info of model.elements)
    associate(info.material.name, info.material.category, elementRefs.get(info.elementId) ?? '$');
  for (const type of model.types)
    associate(type.material.name, type.material.category, typeRefs.get(type.key) ?? '$');
  for (const [name, { category, members }] of materials) {
    const ref = writer.entity(
      'IfcMaterial',
      str(name),
      '$',
      category === null ? '$' : str(category),
    );
    relation('IfcRelAssociatesMaterial', `${project.id}:material:${name}`, list(members), ref);
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
