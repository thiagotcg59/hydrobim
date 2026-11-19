import {
  addPipe,
  attachFitting,
  createProject,
  drawPipe,
  getPorts,
  placeEquipment,
  validateProject,
  vec3,
  type PipeSpec,
  type Project,
  type Result,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { exportIfc } from '../export';
import { IFC_CLASS_ENTITIES, IFC_PROPERTY_DEFINITIONS } from './definitions';
import { exportIds, idsSpecifications } from './ids';
import { buildIfcModel, classifyElement, ifcTypeKey, typeOfElement } from './model';
import { setIfcValue } from './operations';
import { IFC_ENTITIES, IFC_PROPERTY_SETS } from './schemaData';
import type { IfcElementInfo, IfcModel, IfcPropertyInfo } from './types';
import { conformityOf, isSetApplicable, issuesOfElement, validateIfcModel } from './validate';

const spec: PipeSpec = {
  specificationId: 'teste',
  material: 'pvc',
  standard: 'Norma de teste',
  jointType: 'solventWeld',
  pressureClass: 'PN 10',
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

/** Dois tubos iguais em ângulo (com joelho), uma válvula de gaveta, bomba e reservatório. */
function sample(): { project: Project; pipeA: string; pipeB: string; valve: string; pump: string } {
  const a = unwrap(
    addPipe(createProject('Rede'), { spec, start: vec3(0, 0, 0), end: vec3(4, 0, 1) }),
  );
  const b = unwrap(
    drawPipe(a.project, {
      spec,
      start: vec3(4, 0, 1),
      end: vec3(4, 3, 1),
      fromPort: { elementId: a.elementId, portId: 'end' },
    }),
  );
  const valve = unwrap(
    attachFitting(b.project, {
      target: { elementId: b.elementId, portId: 'end' },
      fitting: { kind: 'valve', valveType: 'gate' },
    }),
  );
  const pump = unwrap(
    placeEquipment(valve.project, { spec, fitting: { kind: 'pump' }, position: vec3(10, 0, 0) }),
  );
  const tank = unwrap(
    placeEquipment(pump.project, { spec, fitting: { kind: 'tank' }, position: vec3(15, 0, 0) }),
  );
  expect(validateProject(tank.project)).toEqual([]);
  return {
    project: tank.project,
    pipeA: a.elementId,
    pipeB: b.elementId,
    valve: valve.elementId,
    pump: pump.elementId,
  };
}

const elementOf = (model: IfcModel, id: string): IfcElementInfo => {
  const found = model.elements.find((element) => element.elementId === id);
  if (!found) throw new Error(`Elemento ausente do modelo: ${id}`);
  return found;
};
const propertyOf = (
  sets: readonly { properties: readonly IfcPropertyInfo[] }[],
  key: string,
): IfcPropertyInfo | undefined => sets.flatMap((set) => set.properties).find((p) => p.key === key);

describe('registro de propriedades IFC', () => {
  it('só usa conjuntos padronizados aplicáveis à entidade (ou ao tipo) de cada classe', () => {
    for (const definition of IFC_PROPERTY_DEFINITIONS) {
      if (!definition.standard) {
        // Conjunto próprio nunca usa o nome de um conjunto padronizado.
        expect(IFC_PROPERTY_SETS[definition.set], definition.set).toBeUndefined();
        expect(definition.set.startsWith('HydroBIM_'), definition.set).toBe(true);
        continue;
      }
      for (const className of definition.classes) {
        const occurrence = IFC_CLASS_ENTITIES[className];
        const entity =
          definition.scope === 'type' ? IFC_ENTITIES[occurrence]?.typeEntity : occurrence;
        expect(entity, occurrence).toBeDefined();
        const predefinedTypes = definition.predefinedTypes ?? ['NOTDEFINED'];
        for (const predefined of predefinedTypes)
          expect(
            isSetApplicable(definition.set, entity ?? '', predefined),
            `${definition.set}.${definition.name} em ${entity}/${predefined}`,
          ).toBe(true);
      }
    }
  });

  it('não repete a mesma propriedade para a mesma classe e escopo', () => {
    const seen = new Set<string>();
    for (const definition of IFC_PROPERTY_DEFINITIONS)
      for (const className of definition.classes) {
        const key = `${className}|${definition.scope}|${definition.set}.${definition.name}`;
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      }
  });

  it('propriedades editáveis não estão ligadas à geometria nem ao catálogo', () => {
    for (const definition of IFC_PROPERTY_DEFINITIONS)
      if (definition.editable) expect(definition.binding, definition.name).toBeNull();
  });
});

describe('modelo de informação IFC', () => {
  it('classifica cada elemento com entidade e tipo predefinido do esquema', () => {
    const { project } = sample();
    const model = buildIfcModel(project);
    expect(model.schema).toBe('IFC4X3_ADD2');
    expect(model.elements.map((e) => `${e.entity}/${e.predefinedType}`).sort()).toEqual([
      'IfcPipeFitting/BEND',
      'IfcPipeSegment/RIGIDSEGMENT',
      'IfcPipeSegment/RIGIDSEGMENT',
      'IfcPump/ENDSUCTION',
      'IfcTank/STORAGE',
      'IfcValve/ISOLATING',
    ]);
    for (const element of project.elements) {
      const { entity, predefinedType } = classifyElement(element);
      expect(IFC_ENTITIES[entity]?.predefinedTypes).toContain(predefinedType);
      expect(entity).not.toBe('IfcBuildingElementProxy');
    }
  });

  it('cria um tipo por produto e o compartilha entre ocorrências iguais', () => {
    const { project, pipeA, pipeB } = sample();
    const model = buildIfcModel(project);
    const a = elementOf(model, pipeA);
    const b = elementOf(model, pipeB);
    expect(a.typeKey).toBe(b.typeKey);
    const type = typeOfElement(model, a);
    expect(type?.entity).toBe('IfcPipeSegmentType');
    expect(type?.memberIds).toEqual([pipeA, pipeB]);
    expect(model.types.map((t) => t.entity).sort()).toEqual([
      'IfcPipeFittingType',
      'IfcPipeSegmentType',
      'IfcPumpType',
      'IfcTankType',
      'IfcValveType',
    ]);
    // Parâmetros de tipo ficam no tipo; os de ocorrência, no elemento.
    expect(propertyOf(type?.psets ?? [], 'Pset_PipeSegmentTypeCommon.OuterDiameter')?.value).toBe(
      0.06,
    );
    expect(propertyOf(a.psets, 'Pset_PipeSegmentTypeCommon.OuterDiameter')).toBeUndefined();
    expect(propertyOf(a.psets, 'Pset_PipeSegmentTypeCommon.Length')?.origin).toBe('geometry');
  });

  it('deriva as propriedades e quantidades do tubo da geometria e da especificação', () => {
    const { project, pipeA, pipeB } = sample();
    const model = buildIfcModel(project);
    const a = elementOf(model, pipeA);
    const length = Math.hypot(4, 1);
    // O tubo foi aparado pelo joelho: confere com as portas, não com os pontos clicados.
    const source = project.elements.find((e) => e.id === pipeA);
    const [start, end] = source ? getPorts(source) : [];
    const real = Math.hypot(
      (end?.position.x ?? 0) - (start?.position.x ?? 0),
      (end?.position.z ?? 0) - (start?.position.z ?? 0),
    );
    expect(real).toBeLessThanOrEqual(length);
    expect(propertyOf(a.psets, 'Qto_PipeSegmentBaseQuantities.Length')?.value).toBeCloseTo(real);
    expect(
      propertyOf(a.psets, 'Qto_PipeSegmentBaseQuantities.OuterSurfaceArea')?.value,
    ).toBeCloseTo(Math.PI * 0.06 * real);
    expect(propertyOf(a.psets, 'Pset_PipeSegmentOccurrence.Gradient')?.value).toBeCloseTo(0.25);
    expect(propertyOf(a.psets, 'HydroBIM_Tracado.StartElevation')?.value).toBe(0);
    expect(propertyOf(a.psets, 'HydroBIM_Tracado.Slope')?.value).toBeCloseTo(0.25);
    expect(propertyOf(a.psets, 'Pset_PipeSegmentOccurrence.InvertElevation')?.value).toBeCloseTo(
      -0.027,
    );
    // Trecho horizontal: sem declividade (IfcPositiveRatioMeasure não aceita zero).
    const b = elementOf(model, pipeB);
    expect(propertyOf(b.psets, 'Pset_PipeSegmentOccurrence.Gradient')).toBeUndefined();
    expect(propertyOf(b.psets, 'HydroBIM_Tracado.Slope')?.value).toBe(0);
  });

  it('não inventa dados: o que não se conhece fica pendente e sem valor', () => {
    const { project, pipeA, valve, pump } = sample();
    const model = buildIfcModel(project);
    const pipeType = typeOfElement(model, elementOf(model, pipeA));
    const pressure = propertyOf(
      pipeType?.psets ?? [],
      'Pset_PipeSegmentTypeCommon.WorkingPressure',
    );
    expect(pressure).toMatchObject({ value: null, origin: 'pending', required: true });
    const maker = propertyOf(
      pipeType?.psets ?? [],
      'Pset_ManufacturerTypeInformation.Manufacturer',
    );
    expect(maker).toMatchObject({ value: null, origin: 'pending', editable: true });
    const valveType = typeOfElement(model, elementOf(model, valve));
    // Gaveta: o esquema distingue cunha e faces paralelas; o cadastro não sabe qual é.
    expect(
      propertyOf(valveType?.psets ?? [], 'Pset_ValveTypeCommon.ValveMechanism')?.value,
    ).toBeNull();
    expect(propertyOf(valveType?.psets ?? [], 'Pset_ValveTypeCommon.ValvePattern')?.value).toBe(
      'STRAIGHT_2_PORT',
    );
    const pumpType = typeOfElement(model, elementOf(model, pump));
    expect(propertyOf(pumpType?.psets ?? [], 'HydroBIM_Bomba.RatedPower')?.origin).toBe('pending');
  });

  it('descreve as portas com posição, diâmetro, tipo de conexão e elemento conectado', () => {
    const { project, pipeA } = sample();
    const model = buildIfcModel(project);
    const [start, end] = elementOf(model, pipeA).ports;
    expect(start?.connectedTo).toBeNull();
    expect(end?.connectedTo?.elementName).toBeTruthy();
    expect(
      propertyOf(end?.psets ?? [], 'Pset_DistributionPortTypePipe.ConnectionType')?.value,
    ).toBe('OTHER');
    expect(propertyOf(end?.psets ?? [], 'Pset_DistributionPortTypePipe.OuterDiameter')?.value).toBe(
      0.06,
    );
    expect(propertyOf(start?.psets ?? [], 'Pset_DistributionPortCommon.PortNumber')?.value).toBe(1);
  });
});

describe('validação IFC', () => {
  it('não acusa erros de esquema no modelo e separa pendências do projeto', () => {
    const { project, pipeA } = sample();
    const model = buildIfcModel(project);
    const issues = validateIfcModel(project, model);
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(issues.filter((issue) => issue.level === 'schema')).toEqual([]);
    const pipe = elementOf(model, pipeA);
    const own = issuesOfElement(issues, pipeA, pipe.typeKey);
    expect(own.map((issue) => issue.property)).toEqual(
      expect.arrayContaining([
        'Pset_ManufacturerTypeInformation.Manufacturer',
        'Pset_PipeSegmentTypeCommon.WorkingPressure',
      ]),
    );
    expect(own.every((issue) => issue.code === 'REQUIRED_MISSING')).toBe(true);
    expect(conformityOf(own)).toBe('pending');
    expect(conformityOf([])).toBe('conforming');
  });

  it('aponta valor guardado que deixou de ser válido e não o exporta', () => {
    const { project, pipeA } = sample();
    const key = 'Pset_PipeSegmentOccurrence.InteriorRoughnessCoefficient';
    const broken: Project = {
      ...project,
      elements: project.elements.map((e) =>
        e.id === pipeA ? { ...e, ifc: { [key]: -1, 'Pset_Inexistente.X': 'a' } } : e,
      ),
    };
    const model = buildIfcModel(broken);
    expect(propertyOf(elementOf(model, pipeA).psets, key)?.value).toBeNull();
    const codes = validateIfcModel(broken, model)
      .filter((issue) => issue.elementId === pipeA && issue.severity === 'warning')
      .map((issue) => issue.code);
    expect(codes.sort()).toEqual(['USER_VALUE_INVALID', 'USER_VALUE_NOT_APPLICABLE']);
  });

  it('acusa portas conectadas que não coincidem na geometria', () => {
    const { project, pipeB } = sample();
    const moved: Project = {
      ...project,
      elements: project.elements.map((e) =>
        e.id === pipeB && e.kind === 'pipe' ? { ...e, end: vec3(4, 9, 1) } : e,
      ),
    };
    const codes = validateIfcModel(moved, buildIfcModel(moved)).map((issue) => issue.code);
    expect(codes).toContain('PORTS_NOT_COINCIDENT');
  });
});

describe('edição de propriedades IFC', () => {
  const pressure = 'Pset_PipeSegmentTypeCommon.WorkingPressure';
  const roughness = 'Pset_PipeSegmentOccurrence.InteriorRoughnessCoefficient';

  it('valor de tipo vale para todas as ocorrências, inclusive as novas, e é exportado', () => {
    const { project, pipeA, pipeB } = sample();
    const before = structuredClone(project);
    const edited = unwrap(setIfcValue(project, { elementId: pipeA, scope: 'type' }, pressure, 6e5));
    expect(project).toEqual(before);
    expect(edited.elements).toBe(project.elements);
    expect(validateProject(edited)).toEqual([]);
    const model = buildIfcModel(edited);
    for (const id of [pipeA, pipeB]) {
      const type = typeOfElement(model, elementOf(model, id));
      expect(propertyOf(type?.psets ?? [], pressure)).toMatchObject({ value: 6e5, origin: 'user' });
    }
    // Novo tubo da mesma especificação: herda o valor do tipo sem nova edição.
    const added = unwrap(addPipe(edited, { spec, start: vec3(0, 5, 0), end: vec3(2, 5, 0) }));
    const next = buildIfcModel(added.project);
    const type = typeOfElement(next, elementOf(next, added.elementId));
    expect(propertyOf(type?.psets ?? [], pressure)?.value).toBe(6e5);
    expect(exportIfc(added.project)).toContain("'WorkingPressure',$,IFCPRESSUREMEASURE(600000.)");
    expect(validateIfcModel(added.project, next).some((issue) => issue.property === pressure)).toBe(
      false,
    );
  });

  it('valor de ocorrência fica só no elemento, sem alterar a geometria nem os GlobalIds', () => {
    const { project, pipeA, pipeB } = sample();
    const edited = unwrap(
      setIfcValue(project, { elementId: pipeA, scope: 'occurrence' }, roughness, 0.0001),
    );
    const before = buildIfcModel(project);
    const after = buildIfcModel(edited);
    expect(propertyOf(elementOf(after, pipeA).psets, roughness)).toMatchObject({
      value: 0.0001,
      origin: 'user',
    });
    expect(propertyOf(elementOf(after, pipeB).psets, roughness)?.value).toBeNull();
    expect(after.elements.map((e) => e.globalId)).toEqual(before.elements.map((e) => e.globalId));
    expect(after.types.map((t) => t.globalId)).toEqual(before.types.map((t) => t.globalId));
    expect(edited.elements.map(getPorts)).toEqual(project.elements.map(getPorts));
    expect(validateProject(edited)).toEqual([]);
    // Limpar devolve o campo a "não informado" e remove o registro do elemento.
    const cleared = unwrap(
      setIfcValue(edited, { elementId: pipeA, scope: 'occurrence' }, roughness, null),
    );
    expect(cleared.elements.find((e) => e.id === pipeA)?.ifc).toBeUndefined();
  });

  it('aceita enumerações e a descrição do elemento', () => {
    const { project, valve } = sample();
    const target = { elementId: valve, scope: 'occurrence' } as const;
    const status = unwrap(setIfcValue(project, target, 'Pset_ValveTypeCommon.Status', 'EXISTING'));
    const described = unwrap(setIfcValue(status, target, 'Description', '  Registro geral  '));
    const element = elementOf(buildIfcModel(described), valve);
    expect(element.description).toBe('Registro geral');
    expect(propertyOf(element.psets, 'Pset_ValveTypeCommon.Status')?.value).toBe('EXISTING');
    const text = exportIfc(described);
    expect(text).toContain("IFCPROPERTYENUMERATEDVALUE('Status',$,(IFCLABEL('EXISTING'))");
    expect(text).toContain("'Registro geral'");
  });

  it('recusa valores inválidos, propriedades derivadas e propriedades de outra categoria', () => {
    const { project, pipeA, valve } = sample();
    const occurrence = { elementId: pipeA, scope: 'occurrence' } as const;
    const type = { elementId: pipeA, scope: 'type' } as const;
    const code = (result: Result<Project>): string => (result.ok ? 'ok' : result.error.code);
    expect(code(setIfcValue(project, occurrence, roughness, -1))).toBe('IFC_VALUE_INVALID');
    expect(code(setIfcValue(project, occurrence, roughness, 'liso'))).toBe('IFC_VALUE_INVALID');
    expect(
      code(setIfcValue(project, occurrence, 'Pset_PipeSegmentTypeCommon.Status', 'NOVO')),
    ).toBe('IFC_VALUE_INVALID');
    expect(code(setIfcValue(project, type, 'Pset_PipeSegmentTypeCommon.OuterDiameter', 1))).toBe(
      'IFC_PROPERTY_NOT_EDITABLE',
    );
    // Propriedade de válvula em um tubo; propriedade de tipo no escopo errado.
    expect(code(setIfcValue(project, type, 'Pset_ValveTypeCommon.WorkingPressure', 1))).toBe(
      'IFC_PROPERTY_NOT_APPLICABLE',
    );
    expect(code(setIfcValue(project, occurrence, pressure, 1))).toBe('IFC_PROPERTY_NOT_APPLICABLE');
    // Normalmente aberta só existe para válvulas de bloqueio; a de gaveta é uma.
    expect(
      code(
        setIfcValue(
          project,
          { elementId: valve, scope: 'occurrence' },
          'Pset_ValveTypeIsolating.IsNormallyOpen',
          true,
        ),
      ),
    ).toBe('ok');
    expect(code(setIfcValue(project, { elementId: 'x', scope: 'type' }, pressure, 1))).toBe(
      'ELEMENT_NOT_FOUND',
    );
  });

  it('a chave do tipo ignora o que é da ocorrência', () => {
    const { project, pipeA, pipeB } = sample();
    const [a, b] = [pipeA, pipeB].map((id) => project.elements.find((e) => e.id === id));
    if (!a || !b) throw new Error('tubos ausentes');
    expect(ifcTypeKey(a)).toBe(ifcTypeKey(b));
    expect(ifcTypeKey({ ...a, name: 'Outro', systemId: 'x' })).toBe(ifcTypeKey(a));
    expect(ifcTypeKey({ ...a, spec: { ...a.spec, dn: 75 } })).not.toBe(ifcTypeKey(a));
    expect(ifcTypeKey({ ...a, manufacturing: { manufacturer: 'ACME' } })).not.toBe(ifcTypeKey(a));
  });
});

describe('IDS do perfil de requisitos', () => {
  it('gera uma especificação por classe com as propriedades exigidas', () => {
    const specifications = idsSpecifications();
    expect(specifications.map((s) => s.entity)).toEqual(
      expect.arrayContaining([
        'IfcPipeSegment',
        'IfcPipeFitting',
        'IfcValve',
        'IfcPump',
        'IfcTank',
      ]),
    );
    const pipes = specifications.find((s) => s.entity === 'IfcPipeSegment');
    expect(pipes?.requirements.map((r) => `${r.propertySet}.${r.baseName}`)).toEqual([
      'Pset_ManufacturerTypeInformation.Manufacturer',
      'Pset_PipeSegmentTypeCommon.WorkingPressure',
    ]);
    const xml = exportIds({ date: '2026-11-17' });
    expect(xml).toContain('xmlns="http://standards.buildingsmart.org/IDS"');
    expect(xml).toContain('ifcVersion="IFC4X3_ADD2"');
    expect(xml).toContain('<simpleValue>IFCPIPESEGMENT</simpleValue>');
    expect(xml).toContain('<property dataType="IFCPRESSUREMEASURE" cardinality="required"');
    expect(xml).toContain('<xs:enumeration value="ISOLATING"/>');
    expect(xml.match(/<specification /g)).toHaveLength(specifications.length);
    expect(xml.match(/<property /g)?.length).toBe(xml.match(/<\/property>/g)?.length);
  });
});
