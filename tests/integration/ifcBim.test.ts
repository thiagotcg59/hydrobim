import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUILTIN_FAMILIES,
  FLANGED_PIPE_FAMILIES,
  PRODUCT_FAMILIES,
  TANK_FAMILIES,
} from '@hydrobim/catalog';
import { mergeFamilies, parseProject, type Project } from '@hydrobim/core';
import {
  buildIfcModel,
  classifyLibrary,
  exportIfc,
  IFC_ENTITIES,
  validateIfcModel,
  type IfcPropertySetInfo,
} from '@hydrobim/ifc';
import { describe, expect, it } from 'vitest';

const examples = join(import.meta.dirname, '..', '..', 'examples');

function load(name: string): Project {
  const result = parseProject(readFileSync(join(examples, name), 'utf8'));
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const optionsOf = (project: Project) => ({
  families: [...mergeFamilies(BUILTIN_FAMILIES, project.families), ...FLANGED_PIPE_FAMILIES],
  tankFamilies: [...TANK_FAMILIES, ...project.tankFamilies],
});

describe('classificação IFC da biblioteca de famílias', () => {
  const library = classifyLibrary({
    fittingFamilies: BUILTIN_FAMILIES,
    flangedPipeFamilies: FLANGED_PIPE_FAMILIES,
    tankFamilies: TANK_FAMILIES,
    productFamilies: PRODUCT_FAMILIES,
  });

  it('classifica todas as famílias com entidade específica e tipo predefinido do esquema', () => {
    expect(library).toHaveLength(
      BUILTIN_FAMILIES.length +
        FLANGED_PIPE_FAMILIES.length +
        TANK_FAMILIES.length +
        PRODUCT_FAMILIES.length,
    );
    for (const entry of library) {
      const definition = IFC_ENTITIES[entry.entity];
      expect(definition, `${entry.name}: ${entry.entity}`).toBeDefined();
      expect(definition?.predefinedTypes, entry.name).toContain(entry.predefinedType);
      expect(entry.typeEntity).toBe(`${entry.entity}Type`);
      // Nada genérico: nem proxy, nem a superclasse abstrata de conexões.
      expect(['IfcBuildingElementProxy', 'IfcFlowFitting']).not.toContain(entry.entity);
      // USERDEFINED só com a identificação em ObjectType.
      if (entry.predefinedType === 'USERDEFINED') expect(entry.objectType).toBeTruthy();
      expect(entry.source.length, entry.name).toBeGreaterThan(0);
    }
  });

  it('distingue as categorias funcionais', () => {
    const entities = (group: string): string[] => [
      ...new Set(library.filter((e) => e.group === group).map((e) => e.entity)),
    ];
    expect(entities('Reservatórios')).toEqual(['IfcTank']);
    expect(entities('Tubos com flanges')).toEqual(['IfcPipeSegment']);
    expect(entities('Conexões e válvulas').sort()).toEqual([
      'IfcFilter',
      'IfcPipeFitting',
      'IfcValve',
    ]);
    expect(entities('Biblioteca de produtos').sort()).toEqual([
      'IfcDiscreteAccessory',
      'IfcPipeFitting',
      'IfcPipeSegment',
    ]);
  });
});

describe.each(['demo-barrilete.hydrobim.json', 'reservatorios-tramec.hydrobim.json'])(
  'modelo de informação IFC de %s',
  (name) => {
    const project = load(name);
    const model = buildIfcModel(project, optionsOf(project));

    it('não tem erros de esquema; só pendências do perfil do projeto', () => {
      const issues = validateIfcModel(project, model);
      expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
      expect(issues.filter((issue) => issue.level === 'schema')).toEqual([]);
      // Além das pendências, só o aviso de coerência entre capacidade nominal e volume
      // geométrico (o volume de alguns reservatórios é estimado pela representação).
      const codes = new Set(issues.map((issue) => issue.code));
      codes.delete('REQUIRED_MISSING');
      codes.delete('CAPACITY_EXCEEDS_VOLUME');
      expect([...codes]).toEqual([]);
    });

    it('todo elemento tem tipo, material, portas e sistema', () => {
      expect(model.elements).toHaveLength(project.elements.length);
      for (const element of model.elements) {
        const type = model.types.find((t) => t.key === element.typeKey);
        expect(type?.memberIds).toContain(element.elementId);
        expect(element.material.name.length).toBeGreaterThan(0);
        expect(element.ports.length).toBeGreaterThan(0);
        expect(model.systems.some((s) => s.memberIds.includes(element.elementId))).toBe(true);
      }
    });

    it('o arquivo exportado grava os conjuntos e as propriedades do modelo', () => {
      const text = exportIfc(project, optionsOf(project));
      const sets: IfcPropertySetInfo[] = [
        ...model.elements.flatMap((e) => [...e.psets, ...e.ports.flatMap((p) => p.psets)]),
        ...model.types.flatMap((t) => t.psets),
      ];
      const count = (pattern: RegExp): number => text.match(pattern)?.length ?? 0;
      expect(count(/=IFCPROPERTYSET\(/g)).toBe(sets.filter((s) => s.kind === 'pset').length);
      expect(count(/=IFCELEMENTQUANTITY\(/g)).toBe(sets.filter((s) => s.kind === 'qto').length);
      const properties = sets.filter((s) => s.kind === 'pset').flatMap((s) => s.properties);
      expect(count(/=IFCPROPERTY(SINGLE|ENUMERATED)VALUE\(/g)).toBe(properties.length);
      for (const type of model.types) expect(text).toContain(`'${type.globalId}'`);
      expect(count(/=IFCRELDEFINESBYTYPE\(/g)).toBe(model.types.length);
    });
  },
);

describe('famílias de catálogo no modelo IFC', () => {
  it('conexão de catálogo traz família, fabricante, referência e fonte no tipo', () => {
    const demo = load('demo-barrilete.hydrobim.json');
    const family = BUILTIN_FAMILIES.find((f) => f.kind === 'elbow' && f.manufacturer);
    if (!family) throw new Error('Catálogo sem família de joelhos com fabricante.');
    const elbow = demo.elements.find((e) => e.kind === 'elbow');
    if (!elbow) throw new Error('Exemplo sem joelho.');
    const project: Project = {
      ...demo,
      elements: demo.elements.map((e) => (e.id === elbow.id ? { ...e, familyId: family.id } : e)),
    };
    const model = buildIfcModel(project, optionsOf(project));
    const type = model.types.find((t) => t.memberIds.includes(elbow.id));
    expect(type?.familyName).toBe(family.name);
    expect(type?.catalogReference).toBe(family.source);
    expect(type?.description).toContain('Fonte:');
    const properties = type?.psets.flatMap((set) => set.properties) ?? [];
    expect(properties.find((p) => p.name === 'Manufacturer')).toMatchObject({
      value: family.manufacturer,
      origin: 'catalog',
    });
    expect(properties.find((p) => p.name === 'ModelReference')?.value).toBe(family.id);
    expect(
      validateIfcModel(project, model).some(
        (issue) => issue.typeKey === type?.key && issue.property?.endsWith('.Manufacturer'),
      ),
    ).toBe(false);
  });

  it('reservatórios de catálogo trazem a família e a referência do catálogo', () => {
    const project = load('reservatorios-tramec.hydrobim.json');
    const model = buildIfcModel(project, optionsOf(project));
    const tanks = model.types.filter((type) => type.entity === 'IfcTankType');
    expect(tanks).toHaveLength(8);
    for (const type of tanks) {
      expect(type.familyName).toBeTruthy();
      expect(type.catalogReference).toContain('tramec');
    }
  });
});
