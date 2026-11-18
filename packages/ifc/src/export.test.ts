import {
  addPipe,
  attachFitting,
  createProject,
  drawPipe,
  getPorts,
  insertInline,
  placeEquipment,
  validateProject,
  vec3,
  type PipeSpec,
  type Project,
  type Result,
  type ValveType,
} from '@hydrobim/core';
import { buildElementGeometry } from '@hydrobim/geometry';
import { describe, expect, it } from 'vitest';
import { exportIfc } from './export';
import { derivedGuid, toIfcGuid } from './guid';

const timestamp = new Date('2026-01-01T00:00:00Z');
const spec: PipeSpec = {
  specificationId: 'teste',
  material: 'pvc',
  standard: 'Norma de teste',
  jointType: 'solventWeld',
  pressureClass: null,
  dn: 50,
  sizeLabel: 'DN 50',
  outerDiameter: 0.06,
  innerDiameter: 0.054,
  wallThickness: 0.003,
};
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function sample(): Project {
  const pipe = unwrap(
    addPipe(createProject("Instalação d'água"), { spec, start: vec3(0, 0, 0), end: vec3(4, 0, 0) }),
  );
  const turn = unwrap(
    drawPipe(pipe.project, {
      spec,
      start: vec3(4, 0, 0),
      end: vec3(4, 3, 0),
      fromPort: { elementId: pipe.elementId, portId: 'end' },
    }),
  );
  const tee = unwrap(
    insertInline(turn.project, {
      pipeId: pipe.elementId,
      distanceFromStart: 1.5,
      fitting: { kind: 'tee' },
    }),
  );
  const valve = unwrap(
    attachFitting(tee.project, {
      target: { elementId: tee.elementId, portId: 'branch' },
      fitting: { kind: 'valve', valveType: 'airRelease' },
    }),
  );
  const reducer = unwrap(
    attachFitting(valve.project, {
      target: { elementId: turn.elementId, portId: 'end' },
      fitting: {
        kind: 'reducer',
        outletSpec: {
          ...spec,
          dn: 25,
          sizeLabel: 'DN 25',
          outerDiameter: 0.032,
          innerDiameter: 0.028,
          wallThickness: 0.002,
        },
      },
    }),
  );
  const pump = unwrap(
    placeEquipment(reducer.project, {
      spec,
      fitting: { kind: 'pump' },
      position: vec3(10, 0, 3),
      rotationZ: Math.PI / 3,
    }),
  );
  const tank = unwrap(
    placeEquipment(pump.project, { spec, fitting: { kind: 'tank' }, position: vec3(15, 0, 0) }),
  );
  expect(validateProject(tank.project)).toEqual([]);
  return tank.project;
}

interface Entity {
  ref: string;
  type: string;
  args: string[];
}
/** Leitor mínimo de argumentos STEP para conferir referências e hierarquia nos testes. */
function entities(text: string): Entity[] {
  return [...text.matchAll(/^(#\d+)=(\w+)\((.*)\);$/gm)].map((match) => {
    const args: string[] = [];
    let depth = 0;
    let quoted = false;
    let start = 0;
    const source = match[3]!;
    for (let i = 0; i < source.length; i += 1) {
      if (source[i] === "'") {
        if (quoted && source[i + 1] === "'") {
          i += 1;
          continue;
        }
        quoted = !quoted;
      }
      if (quoted) continue;
      if (source[i] === '(') depth += 1;
      if (source[i] === ')') depth -= 1;
      if (source[i] === ',' && depth === 0) {
        args.push(source.slice(start, i));
        start = i + 1;
      }
    }
    args.push(source.slice(start));
    return { ref: match[1]!, type: match[2]!, args };
  });
}
const byType = (all: Entity[], type: string): Entity[] =>
  all.filter((e) => e.type === type.toUpperCase());
const byRef = (all: Entity[], ref: string): Entity => all.find((e) => e.ref === ref)!;
const forId = (all: Entity[], id: string): Entity =>
  all.find((e) => e.args[0] === `'${toIfcGuid(id)}'`)!;

describe('exportação IFC 4.3', () => {
  it('é determinística, pura e inclui metadados e contexto corretos', () => {
    const project = sample();
    const before = structuredClone(project);
    const options = {
      timestamp,
      author: "João d'Ávila",
      organization: 'Engenharia',
      application: 'HydroBIM teste',
    };
    const text = exportIfc(project, options);
    expect(exportIfc(project, options)).toBe(text);
    expect(exportIfc(project)).toBe(exportIfc(project));
    expect(project).toEqual(before);
    expect(text).toContain("FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');");
    expect(text).toContain("FILE_SCHEMA(('IFC4X3_ADD2'));");
    expect(text).toContain('2026-01-01T00:00:00.000Z');
    expect(text).toContain('HydroBIM teste');
    expect([...text].every((character) => character.charCodeAt(0) <= 127)).toBe(true);
    const all = entities(text);
    expect(byType(all, 'IfcProject')[0]?.args[0]).toBe(`'${toIfcGuid(project.id)}'`);
    expect(byType(all, 'IfcGeometricRepresentationContext')[0]?.args.slice(0, 4)).toEqual([
      "'Model'",
      "'Model'",
      '3',
      '0.00001',
    ]);
    expect(byType(all, 'IfcGeometricRepresentationSubContext')[0]?.args[8]).toBe('.MODEL_VIEW.');
    expect(byType(all, 'IfcSIUnit').map((e) => e.args[3])).toEqual([
      '.METRE.',
      '.SQUARE_METRE.',
      '.CUBIC_METRE.',
      '.RADIAN.',
    ]);
  });

  it('exporta elementos, partes locais, propriedades, portas, conexões, sistemas e materiais', () => {
    const project = sample();
    project.elements[0]!.properties = { texto: "D'água", real: 2.5, ativo: true, inativo: false };
    project.elements[0]!.familyId = 'familia-teste';
    const all = entities(exportIfc(project, { timestamp }));
    expect(byType(all, 'IfcPipeSegment')).toHaveLength(3);
    expect(
      byType(all, 'IfcPipeFitting')
        .map((e) => e.args[8])
        .sort(),
    ).toEqual(['.BEND.', '.JUNCTION.', '.TRANSITION.']);
    expect(byType(all, 'IfcValve')).toHaveLength(1);
    expect(byType(all, 'IfcPump')[0]?.args[8]).toBe('.ENDSUCTION.');
    expect(byType(all, 'IfcTank')[0]?.args[8]).toBe('.STORAGE.');
    expect(byType(all, 'IfcDistributionPort')).toHaveLength(
      project.elements.flatMap(getPorts).length,
    );
    // Só os bocais do reservatório têm sentido definido: saída (SOURCE) e entrada (SINK).
    const flows = byType(all, 'IfcDistributionPort').map((e) => e.args.slice(7).join());
    expect(flows.every((flow) => flow.endsWith('.PIPE.,.DOMESTICCOLDWATER.'))).toBe(true);
    expect(flows.filter((flow) => !flow.startsWith('.NOTDEFINED.')).sort()).toEqual([
      '.SINK.,.PIPE.,.DOMESTICCOLDWATER.',
      '.SOURCE.,.PIPE.,.DOMESTICCOLDWATER.',
    ]);
    expect(byType(all, 'IfcRelNests')).toHaveLength(project.elements.length);
    expect(byType(all, 'IfcRelConnectsPorts')).toHaveLength(project.connections.length);
    expect(byType(all, 'IfcDistributionSystem')).toHaveLength(1);
    expect(byType(all, 'IfcRelAssignsToGroup')).toHaveLength(1);
    expect(byType(all, 'IfcMaterial')[0]?.args[0]).toBe("'PVC'");
    expect(byType(all, 'IfcRelAssociatesMaterial')).toHaveLength(1);
    // Um conjunto por elemento, as propriedades livres do 1º e dois por bocal do reservatório.
    expect(byType(all, 'IfcPropertySet')).toHaveLength(project.elements.length + 1 + 4);
    const props = byType(all, 'IfcPropertySingleValue');
    expect(props.find((p) => p.args[0] === "'texto'")?.args[2]).toContain('IFCTEXT(');
    expect(props.find((p) => p.args[0] === "'real'")?.args[2]).toBe('IFCREAL(2.5)');
    expect(props.find((p) => p.args[0] === "'ativo'")?.args[2]).toBe('IFCBOOLEAN(.T.)');
    expect(props.find((p) => p.args[0] === "'inativo'")?.args[2]).toBe('IFCBOOLEAN(.F.)');
    expect(props.find((p) => p.args[0] === "'FamilyId'")?.args[2]).toBe(
      "IFCLABEL('familia-teste')",
    );
    for (const name of [
      'NominalDiameter',
      'DN',
      'OuterDiameter',
      'InnerDiameter',
      'WallThickness',
      'Standard',
      'PressureClass',
      'JointType',
      'Material',
      'Length',
      'Angle',
      'BendRadius',
      'OutletNominalDiameter',
      'OutletOuterDiameter',
    ]) {
      expect(props.some((p) => p.args[0] === `'${name}'`)).toBe(true);
    }
    expect(byType(all, 'IfcTriangulatedFaceSet')).toHaveLength(
      project.elements
        .filter((e) => e.kind !== 'pipe')
        .reduce((sum, element) => sum + buildElementGeometry(element).parts.length, 0),
    );
    for (const element of project.elements) expect(forId(all, element.id)).toBeDefined();
    const guids = all
      .filter((e) => /^'[0-3][0-9A-Za-z_$]{21}'$/.test(e.args[0]!))
      .map((e) => e.args[0]);
    expect(new Set(guids).size).toBe(guids.length);
    for (const connection of project.connections) {
      const relation = all.find(
        (e) => e.args[0] === `'${derivedGuid(`${connection.id}:connection`)}'`,
      )!;
      expect(byRef(all, relation.args[4]!).args[0]).toBe(
        `'${derivedGuid(`${connection.a.elementId}:port:${connection.a.portId}`)}'`,
      );
      expect(byRef(all, relation.args[5]!).args[0]).toBe(
        `'${derivedGuid(`${connection.b.elementId}:port:${connection.b.portId}`)}'`,
      );
    }
  });

  it.each<[ValveType, string]>([
    ['gate', 'ISOLATING'],
    ['ball', 'ISOLATING'],
    ['butterfly', 'ISOLATING'],
    ['globe', 'REGULATING'],
    ['check', 'CHECK'],
    ['airRelease', 'AIRRELEASE'],
  ])('mapeia válvula %s', (valveType, expected) => {
    const project = unwrap(
      placeEquipment(createProject('Válvula'), {
        spec,
        fitting: { kind: 'valve', valveType },
        position: vec3(0, 0, 0),
      }),
    ).project;
    const all = entities(exportIfc(project, { timestamp }));
    expect(byType(all, 'IfcValve')[0]?.args[8]).toBe(`.${expected}.`);
    expect(byType(all, 'IfcDistributionPort')).toHaveLength(valveType === 'airRelease' ? 1 : 2);
  });

  it('tubo com flanges é exportado como malha, com as dimensões do flange', () => {
    const flange = {
      type: 'flange' as const,
      length: 0.019,
      outerDiameter: 0.165,
      boltCircle: 0.125,
      boltCount: 4,
      boltHoleDiameter: 0.019,
      raisedFaceDiameter: 0.099,
      raisedFaceHeight: 0.003,
    };
    const flanged = unwrap(
      addPipe(createProject('Flanges'), {
        spec,
        start: vec3(0, 0, 0),
        end: vec3(1, 0, 0),
        ends: { start: flange, end: null, familyId: 'tubo-flangeado' },
      }),
    ).project;
    expect(validateProject(flanged)).toEqual([]);
    const ifc = exportIfc(flanged, { timestamp });
    // Sem o perfil extrudado do tubo liso: corpo, disco e ressalto em malha.
    expect(ifc).not.toContain('IFCEXTRUDEDAREASOLID');
    expect(ifc.match(/IFCTRIANGULATEDFACESET/g)).toHaveLength(3);
    expect(ifc).toContain("'Tessellation'");
    expect(ifc).toContain("IFCPROPERTYSINGLEVALUE('StartFlangeOuterDiameter'");
    expect(ifc).toContain("IFCPROPERTYSINGLEVALUE('StartFlangeBoltCount',$,IFCINTEGER(4)");
    expect(ifc).toContain("IFCPROPERTYSINGLEVALUE('FamilyId',$,IFCLABEL('tubo-flangeado')");
    expect(ifc).not.toContain('EndFlange');
    // O tubo liso continua sendo um sólido extrudado.
    expect(exportIfc(sample(), { timestamp })).toContain('IFCEXTRUDEDAREASOLID');
  });

  it('usa a menor cota das portas para conter elementos e subtrai a origem do pavimento', () => {
    let project = createProject('Níveis');
    project.levels = [
      { id: 'alto', name: 'Alto', elevation: 3 },
      { id: 'baixo', name: 'Baixo', elevation: -2 },
    ];
    for (const [z0, z1] of [
      [4, 5],
      [2, 6],
      [-4, -3],
      [3, 4],
    ]) {
      project = unwrap(
        addPipe(project, { spec, start: vec3(0, 0, z0!), end: vec3(1, 1, z1!) }),
      ).project;
    }
    const all = entities(exportIfc(project, { timestamp }));
    expect(byType(all, 'IfcBuildingStorey')).toHaveLength(2);
    const expectedElevations = [3, -2, -2, 3];
    project.elements.forEach((element, index) => {
      const ref = forId(all, element.id);
      const containment = byType(all, 'IfcRelContainedInSpatialStructure').find((r) =>
        r.args[4]!.match(/#\d+/g)?.includes(ref.ref),
      )!;
      const storey = byRef(all, containment.args[5]!);
      expect(Number(storey.args[9])).toBe(expectedElevations[index]);
      const localPlacement = byRef(all, ref.args[5]!);
      expect(localPlacement.args[0]).toBe(storey.args[5]);
      const axis = byRef(all, localPlacement.args[1]!);
      const point = byRef(all, axis.args[0]!);
      expect(Number(point.args[0]!.slice(1, -1).split(',')[2])).toBe(
        buildElementGeometry(element).transform.position.z - expectedElevations[index]!,
      );
      // A direção do perfil deve ser +X do elemento, mesmo com tubo inclinado.
      const shape = byRef(all, ref.args[6]!);
      const body = byRef(all, shape.args[2]!.slice(1, -1));
      const solid = byRef(all, body.args[3]!.slice(1, -1));
      expect(byRef(all, byRef(all, solid.args[1]!).args[1]!).args[0]).toBe('(1.,0.,0.)');
    });
  });

  it('contém Infra no site e omite georreferência ausente', () => {
    const project = { ...sample(), discipline: 'infra' as const };
    const all = entities(exportIfc(project, { timestamp }));
    expect(byType(all, 'IfcBuilding')).toHaveLength(0);
    expect(byType(all, 'IfcBuildingStorey')).toHaveLength(0);
    expect(byType(all, 'IfcProjectedCRS')).toHaveLength(0);
    expect(byType(all, 'IfcMapConversion')).toHaveLength(0);
    expect(byType(all, 'IfcRelContainedInSpatialStructure')[0]?.args[5]).toBe(
      byType(all, 'IfcSite')[0]?.ref,
    );
  });

  it.each([31983, null])('exporta somente a georreferência explícita (EPSG %s)', (epsg) => {
    const project = sample();
    project.georeference = {
      crsName: 'SIRGAS 2000 / UTM zone 23S',
      epsg,
      eastings: 500000,
      northings: 7800000,
      orthogonalHeight: 123,
      rotation: Math.PI / 3,
    };
    const all = entities(exportIfc(project, { timestamp }));
    expect(byType(all, 'IfcProjectedCRS')[0]?.args.slice(0, 2)).toEqual([
      `'${epsg ? `EPSG:${epsg}` : project.georeference.crsName}'`,
      `'${project.georeference.crsName}'`,
    ]);
    const conversion = byType(all, 'IfcMapConversion')[0]!;
    expect(conversion.args[0]).toBe(byType(all, 'IfcGeometricRepresentationContext')[0]?.ref);
    expect(conversion.args.slice(2, 5)).toEqual(['500000.', '7800000.', '123.']);
    expect(Number(conversion.args[5])).toBeCloseTo(0.5);
    expect(Number(conversion.args[6])).toBeCloseTo(Math.sqrt(3) / 2);
    expect(conversion.args[7]).toBe('1.');
  });

  it('não gera relações vazias e mantém sistemas personalizados com ObjectType', () => {
    const project = sample();
    project.systems[0]!.kind = 'other';
    project.systems.push({ id: 'vazio', kind: 'waterSupply', name: 'Vazio' });
    project.levels = [];
    const all = entities(exportIfc(project, { timestamp }));
    expect(byType(all, 'IfcDistributionSystem')).toHaveLength(1);
    expect(byType(all, 'IfcDistributionSystem')[0]?.args.slice(4)).toEqual([
      "'other'",
      '$',
      '.USERDEFINED.',
    ]);
    expect(byType(all, 'IfcRelContainedInSpatialStructure')[0]?.args[5]).toBe(
      byType(all, 'IfcBuilding')[0]?.ref,
    );
    const empty = entities(exportIfc(createProject('Vazio'), { timestamp }));
    expect(byType(empty, 'IfcRelContainedInSpatialStructure')).toHaveLength(0);
    expect(byType(empty, 'IfcDistributionSystem')).toHaveLength(0);
  });
});
