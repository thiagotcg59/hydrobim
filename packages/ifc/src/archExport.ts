import {
  AXIS_X,
  AXIS_Z,
  getArchElement,
  getArchType,
  hostWallOf,
  layersThickness,
  rotate,
  sub,
  vec3,
  wallAxes,
  wallFaceOffsets,
  wallFootprint,
  wallOpenings,
  wallTypeOf,
  wallVerticalRange,
  type ArchElement,
  type Point2,
  type Project,
  type Vec3,
} from '@hydrobim/core';
import { buildArchGeometry, partFinish, type SurfaceFinish } from '@hydrobim/geometry';
import { buildArchIfcModel, type ArchIfcTypeInfo } from './bim/archModel';
import type { IfcPropertySetInfo, IfcValue } from './bim/types';
import { derivedGuid } from './guid';
import { weldMesh } from './mesh';
import { enumeration as en, list, real, stepString as str, type StepWriter } from './step';

/**
 * Exportação IFC da arquitetura. Entidades e ordem dos atributos conferidas no esquema
 * IFC4X3_ADD2 do IfcOpenShell:
 *  - parede, laje e revestimento: sólido extrudado do contorno BRUTO; cada vão é um
 *    `IfcOpeningElement` ligado por `IfcRelVoidsElement` (e por `IfcRelFillsElement` à porta ou
 *    janela que o preenche) — o visualizador subtrai o vão, e bruto/líquido ficam coerentes
 *    com os conjuntos de quantidades;
 *  - porta e janela: malha das partes, com `OverallWidth`/`OverallHeight` e o modo de abertura;
 *  - ambiente: `IfcSpace`, elemento ESPACIAL agregado ao pavimento (não contido nele);
 *  - materiais: `IfcMaterialLayerSet` no tipo e `IfcMaterialLayerSetUsage` na ocorrência;
 *  - classificações externas: `IfcClassificationReference`, sem substituir a entidade IFC.
 */

export interface ArchContainer {
  readonly id: string;
  readonly ref: string;
  readonly placement: string;
  readonly elevation: number;
  readonly elements: string[];
}

export interface ArchExportContext {
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
  readonly placement: (parent: string, position: Vec3, z?: Vec3, x?: Vec3) => string;
  readonly direction: (v: Vec3) => string;
  readonly vector: (v: Vec3) => string;
  /** Subcontextos de representação: corpo 3D e contorno em planta. */
  readonly body: string;
  readonly footprint: () => string;
  readonly surfaceStyle: (finish: SurfaceFinish) => string;
  readonly define: (owner: string, target: string, sets: readonly IfcPropertySetInfo[]) => void;
  readonly definitionSet: (owner: string, set: IfcPropertySetInfo) => string;
  readonly material: (name: string, category: string | null) => string;
  /** Pavimento do nível, ou o contêiner geral quando não há pavimentos. */
  readonly containerOf: (levelId: string | null) => ArchContainer;
}

/** Folga (m) do sólido do vão além das faces: evita faces coincidentes na subtração. */
const VOID_MARGIN = 0.005;

export function writeArchitecture(context: ArchExportContext): void {
  const { project, writer, root, relation } = context;
  const { architecture } = project;
  if (architecture.elements.length === 0 && architecture.types.length === 0) return;
  const model = buildArchIfcModel(project);

  const point2 = (p: Point2): string =>
    writer.entity('IfcCartesianPoint', list([real(p.x), real(p.y)]));
  const profile = (ring: readonly Point2[]): string => {
    const first = ring[0];
    if (!first) throw new Error('Contorno vazio na exportação IFC.');
    const curve = writer.entity('IfcPolyline', list([...ring, first].map(point2)));
    return writer.entity('IfcArbitraryClosedProfileDef', '.AREA.', '$', curve);
  };
  const extrusion = (profileRef: string, origin: Vec3, depth: number, up = true): string =>
    writer.entity(
      'IfcExtrudedAreaSolid',
      profileRef,
      writer.entity(
        'IfcAxis2Placement3D',
        writer.entity('IfcCartesianPoint', context.vector(origin)),
        '$',
        '$',
      ),
      context.direction(up ? AXIS_Z : vec3(0, 0, -1)),
      real(depth),
    );
  const styled = (item: string, finish: SurfaceFinish): string => {
    writer.entity('IfcStyledItem', item, list([context.surfaceStyle(finish)]), '$');
    return item;
  };
  const shape = (identifier: string, type: string, items: string[], subcontext = context.body) =>
    writer.entity('IfcShapeRepresentation', subcontext, str(identifier), str(type), list(items));
  const product = (...representations: string[]): string =>
    writer.entity('IfcProductDefinitionShape', '$', '$', list(representations));
  const finishOf = (role: Parameters<typeof partFinish>[0]): SurfaceFinish =>
    partFinish(role, 'pvc');

  /** Vão: sólido de subtração no referencial do elemento que ele atravessa. */
  const opening = (
    seed: string,
    name: string,
    parentPlacement: string,
    solid: string,
    hostRef: string,
  ): string => {
    const ref = root(
      'IfcOpeningElement',
      derivedGuid(`${seed}:opening`),
      name,
      null,
      '$',
      context.placement(parentPlacement, vec3(0, 0, 0)),
      product(shape('Body', 'SweptSolid', [solid])),
      '$',
      '.OPENING.',
    );
    relation('IfcRelVoidsElement', `${seed}:voids`, hostRef, ref);
    return ref;
  };

  const refs = new Map<string, string>();
  const placements = new Map<string, string>();
  const openingRefs = new Map<string, string>();
  const spacesByContainer = new Map<string, { container: ArchContainer; refs: string[] }>();
  const sources = new Map(architecture.elements.map((element) => [element.id, element]));
  const attribute = (value: IfcValue | undefined): string =>
    value === undefined ? '$' : typeof value === 'number' ? real(value) : str(String(value));

  // Hospedeiras antes das hospedadas: o vão precisa da parede já escrita.
  const ordered = [...model.elements].sort(
    (a, b) => Number(a.hostId !== null) - Number(b.hostId !== null),
  );
  for (const info of ordered) {
    const element = sources.get(info.elementId) as ArchElement;
    const container = context.containerOf(info.levelId);
    const local = (position: Vec3, z = AXIS_Z, x = AXIS_X): string =>
      context.placement(container.placement, sub(position, vec3(0, 0, container.elevation)), z, x);
    let ref: string;

    if (element.kind === 'wall') {
      const type = wallTypeOf(architecture, element);
      const footprint = wallFootprint(architecture, element);
      if (!type || !footprint)
        throw new Error(`Parede sem tipo na exportação IFC: ${element.name}.`);
      const { dir, left } = wallAxes(element);
      const { base } = wallVerticalRange(project.levels, element);
      const placement = local(
        vec3(element.start.x, element.start.y, base),
        AXIS_Z,
        vec3(dir.x, dir.y, 0),
      );
      const toLocal = (p: Point2): Point2 => {
        const dx = p.x - element.start.x;
        const dy = p.y - element.start.y;
        return { x: dx * dir.x + dy * dir.y, y: dx * left.x + dy * left.y };
      };
      const solid = styled(
        extrusion(profile(footprint.polygon.map(toLocal)), vec3(0, 0, 0), element.height),
        finishOf('wall'),
      );
      ref = root(
        info.entity,
        info.globalId,
        info.name,
        info.description,
        str(info.objectType),
        placement,
        product(shape('Body', 'SweptSolid', [solid])),
        str(info.elementId),
        en(info.predefinedType),
      );
      placements.set(element.id, placement);
      // Um vão por porta ou janela, com folga além das duas faces.
      const thickness = layersThickness(type);
      const { lo, hi } = wallFaceOffsets(element, thickness);
      for (const gap of wallOpenings(architecture, element)) {
        const hosted = getArchElement(architecture, gap.elementId);
        const rectangle = writer.entity(
          'IfcRectangleProfileDef',
          '.AREA.',
          '$',
          '$',
          real(gap.to - gap.from),
          real(thickness + 2 * VOID_MARGIN),
        );
        const solidVoid = extrusion(
          rectangle,
          vec3((gap.from + gap.to) / 2, (lo + hi) / 2, gap.bottom),
          gap.top - gap.bottom,
        );
        openingRefs.set(
          gap.elementId,
          opening(
            gap.elementId,
            `Vão de ${hosted?.name ?? 'esquadria'}`,
            placement,
            solidVoid,
            ref,
          ),
        );
      }
    } else if (element.kind === 'slab' || element.kind === 'flooring') {
      const type = getArchType(architecture, element.typeId);
      const origin = element.boundary[0];
      if (!type || !('layers' in type) || !origin)
        throw new Error(`Piso sem tipo na exportação IFC: ${element.name}.`);
      const thickness = layersThickness(type);
      const elevation =
        (project.levels.find((level) => level.id === element.levelId)?.elevation ?? 0) +
        element.offset;
      const placement = local(vec3(origin.x, origin.y, elevation));
      const toLocal = (ring: readonly Point2[]): Point2[] =>
        ring.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y }));
      // Laje: do topo (z = 0) para baixo. Revestimento: da base (z = 0) para cima.
      const down = element.kind === 'slab';
      const solid = styled(
        extrusion(profile(toLocal(element.boundary)), vec3(0, 0, 0), thickness, !down),
        finishOf(element.kind),
      );
      ref = root(
        info.entity,
        info.globalId,
        info.name,
        info.description,
        str(info.objectType),
        placement,
        product(shape('Body', 'SweptSolid', [solid])),
        str(info.elementId),
        en(info.predefinedType),
      );
      placements.set(element.id, placement);
      element.openings.forEach((gap, index) => {
        const solidVoid = extrusion(
          profile(toLocal(gap.boundary)),
          vec3(0, 0, down ? VOID_MARGIN : -VOID_MARGIN),
          thickness + 2 * VOID_MARGIN,
          !down,
        );
        opening(
          `${element.id}:${gap.id}`,
          `Abertura ${index + 1} de ${element.name}`,
          placement,
          solidVoid,
          ref,
        );
      });
    } else if (element.kind === 'door' || element.kind === 'window') {
      const geometry = buildArchGeometry(project, element);
      const host = hostWallOf(architecture, element);
      if (!geometry || !host)
        throw new Error(`Esquadria sem parede ou tipo na exportação IFC: ${element.name}.`);
      const items = geometry.parts.map((part) => {
        const mesh = weldMesh(part.mesh);
        const points = writer.entity(
          'IfcCartesianPointList3D',
          list(mesh.points.map(context.vector)),
          '$',
        );
        return styled(
          writer.entity(
            'IfcTriangulatedFaceSet',
            points,
            '$',
            mesh.closed ? '.T.' : '.F.',
            list(mesh.triangles.map((face) => list(face.map(String)))),
            '$',
          ),
          finishOf(part.role),
        );
      });
      const frame = geometry.transform;
      ref = root(
        info.entity,
        info.globalId,
        info.name,
        info.description,
        str(info.objectType),
        local(frame.position, rotate(frame.rotation, AXIS_Z), rotate(frame.rotation, AXIS_X)),
        product(shape('Body', 'Tessellation', items)),
        str(info.elementId),
        attribute(info.attributes.OverallHeight),
        attribute(info.attributes.OverallWidth),
        en(info.predefinedType),
        element.kind === 'door'
          ? en(String(info.attributes.OperationType ?? 'NOTDEFINED'))
          : en(String(info.attributes.PartitioningType ?? 'NOTDEFINED')),
        attribute(
          element.kind === 'door'
            ? info.attributes.UserDefinedOperationType
            : info.attributes.UserDefinedPartitioningType,
        ),
      );
      const gap = openingRefs.get(element.id);
      if (gap) relation('IfcRelFillsElement', `${element.id}:fills`, gap, ref);
    } else {
      // Ambiente: contorno em planta sempre; volume só com o pé-direito informado.
      const origin = element.boundary[0] as Point2;
      const elevation =
        (project.levels.find((level) => level.id === element.levelId)?.elevation ?? 0) +
        element.offset;
      const ring = element.boundary.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y }));
      const first = ring[0] as Point2;
      const outline = writer.entity('IfcPolyline', list([...ring, first].map(point2)));
      const representations = [
        shape(
          'FootPrint',
          'GeometricCurveSet',
          [writer.entity('IfcGeometricCurveSet', list([outline]))],
          context.footprint(),
        ),
      ];
      if (element.height !== null) {
        representations.push(
          shape('Body', 'SweptSolid', [extrusion(profile(ring), vec3(0, 0, 0), element.height)]),
        );
      }
      ref = root(
        info.entity,
        info.globalId,
        String(info.attributes.Name ?? info.name),
        info.description,
        '$',
        local(vec3(origin.x, origin.y, elevation)),
        product(...representations),
        str(info.name),
        '.ELEMENT.',
        en(info.predefinedType),
        real(elevation),
      );
      const entry = spacesByContainer.get(container.id);
      if (entry) entry.refs.push(ref);
      else spacesByContainer.set(container.id, { container, refs: [ref] });
    }

    refs.set(info.elementId, ref);
    if (element.kind !== 'space') container.elements.push(ref);
    context.define(info.elementId, ref, info.psets);
  }

  // Ambientes são elementos espaciais: decompõem o pavimento.
  for (const { container, refs: spaces } of spacesByContainer.values()) {
    relation('IfcRelAggregates', `${container.id}:spaces`, container.ref, list(spaces));
  }

  // Tipos, com os conjuntos do tipo e as associações de material e de classificação.
  const refsOf = (ids: readonly string[]): string[] =>
    ids.map((id) => refs.get(id)).filter((ref): ref is string => ref !== undefined);
  const classifications = new Map<string, string>();
  const classification = (system: string, table: string | undefined): string => {
    const name =
      system === 'nbr15965'
        ? 'ABNT NBR 15965'
        : system === 'sinapi'
          ? 'SINAPI'
          : (table ?? 'Outra');
    let ref = classifications.get(name);
    if (!ref) {
      ref = writer.entity(
        'IfcClassification',
        system === 'nbr15965'
          ? str('ABNT')
          : system === 'sinapi'
            ? str('Caixa Econômica Federal')
            : '$',
        '$',
        '$',
        str(name),
        '$',
        '$',
        '$',
      );
      classifications.set(name, ref);
    }
    return ref;
  };

  for (const type of model.types) {
    const sets = type.psets.map((set) => context.definitionSet(type.seed, set));
    type.windowPanels.forEach((panel, index) => {
      sets.push(
        root(
          'IfcWindowPanelProperties',
          derivedGuid(`${type.seed}:panel:${index}`),
          `Folha ${index + 1}`,
          null,
          en(panel.operation),
          en(panel.position),
          '$',
          '$',
          '$',
        ),
      );
    });
    const common = [
      '$',
      sets.length ? list(sets) : '$',
      '$',
      '$',
      str(type.elementType),
      en(type.predefinedType),
    ];
    const extra = typeAttributes(type);
    const ref = root(type.entity, type.globalId, type.name, type.description, ...common, ...extra);
    const members = refsOf(type.memberIds);
    if (members.length)
      relation('IfcRelDefinesByType', `${type.seed}:occurrences`, list(members), ref);

    if (type.layers.length > 0) {
      const layerSet = writer.entity(
        'IfcMaterialLayerSet',
        list(
          type.layers.map((layer) =>
            writer.entity(
              'IfcMaterialLayer',
              context.material(layer.material, null),
              real(layer.thickness),
              '$',
              str(layer.material),
              '$',
              str(layer.category),
              '$',
            ),
          ),
        ),
        str(type.name),
        '$',
      );
      relation('IfcRelAssociatesMaterial', `${type.seed}:layers`, list([ref]), layerSet);
      // Uso por ocorrência: eixo e sentido em que as camadas se sucedem a partir da referência.
      for (const id of type.memberIds) {
        const element = sources.get(id);
        const member = refs.get(id);
        if (!element || !member) continue;
        const total = type.layers.reduce((sum, layer) => sum + layer.thickness, 0);
        // Parede: da face esquerda (y = hi) para a direita. Laje: do topo (z = 0) para baixo.
        // Revestimento: do topo (z = espessura) para baixo.
        const offset =
          element.kind === 'wall'
            ? wallFaceOffsets(element, total).hi
            : element.kind === 'flooring'
              ? total
              : 0;
        const usage = writer.entity(
          'IfcMaterialLayerSetUsage',
          layerSet,
          element.kind === 'wall' ? '.AXIS2.' : '.AXIS3.',
          '.NEGATIVE.',
          real(offset),
          '$',
        );
        relation('IfcRelAssociatesMaterial', `${id}:layer-usage`, list([member]), usage);
      }
    }
    if (type.constituents.length > 0) {
      const set = writer.entity(
        'IfcMaterialConstituentSet',
        str(type.name),
        '$',
        list(
          type.constituents.map((item) =>
            writer.entity(
              'IfcMaterialConstituent',
              str(item.name),
              '$',
              context.material(item.material, null),
              '$',
              '$',
            ),
          ),
        ),
      );
      relation(
        'IfcRelAssociatesMaterial',
        `${type.seed}:constituents`,
        list([ref, ...members]),
        set,
      );
    }
    type.classifications.forEach((entry, index) => {
      const reference = writer.entity(
        'IfcClassificationReference',
        '$',
        str(
          entry.system === 'nbr15965' && entry.table ? `${entry.table} ${entry.code}` : entry.code,
        ),
        entry.description ? str(entry.description) : '$',
        classification(entry.system, entry.table),
        '$',
        '$',
      );
      relation(
        'IfcRelAssociatesClassification',
        `${type.seed}:classification:${index}`,
        list([ref, ...members]),
        reference,
      );
    });
  }
}

/** Atributos do tipo além dos comuns a todo `IfcElementType`. */
function typeAttributes(type: ArchIfcTypeInfo): string[] {
  const text = (value: IfcValue | undefined): string =>
    value === undefined ? '$' : str(String(value));
  if (type.entity === 'IfcDoorType')
    return [
      en(String(type.attributes.OperationType ?? 'NOTDEFINED')),
      '$',
      text(type.attributes.UserDefinedOperationType),
    ];
  if (type.entity === 'IfcWindowType')
    return [
      en(String(type.attributes.PartitioningType ?? 'NOTDEFINED')),
      '$',
      text(type.attributes.UserDefinedPartitioningType),
    ];
  return [];
}
