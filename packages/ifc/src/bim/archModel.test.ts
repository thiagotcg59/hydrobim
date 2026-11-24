import { archTypeFromFamily, ARCH_FAMILIES, getArchFamily } from '@hydrobim/catalog';
import {
  addArchType,
  addFloor,
  addFloorOpening,
  addHosted,
  addSpace,
  addWalls,
  createProject,
  updateArchElement,
  updateArchType,
  type Point2,
  type Project,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { exportIfc } from '../export';
import { ARCH_PROPERTY_DEFINITIONS } from './archDefinitions';
import { archTypeProperties, buildArchIfcModel, setArchIfcValue } from './archModel';
import { validateArchIfc } from './archValidate';
import { IFC_ENTITIES, IFC_PROPERTY_SETS } from './schemaData';
import type { IfcPropertyInfo } from './types';

const p = (x: number, y: number): Point2 => ({ x, y });

interface Sample {
  project: Project;
  wall: string;
  door: string;
  window: string;
  slab: string;
  space: string;
  types: Record<string, string>;
}

function sample(): Sample {
  let project = createProject('Casa', 'architecture');
  const levelId = project.levels[0]?.id ?? '';
  const types: Record<string, string> = {};
  for (const id of [
    'arq-parede-alvenaria-ceramica',
    'arq-laje-concreto',
    'arq-piso-vinilico',
    'arq-porta-giro-1',
    'arq-porta-pivotante',
    'arq-janela-abrir',
  ]) {
    const family = getArchFamily(id);
    if (!family) throw new Error(id);
    const added = addArchType(project, archTypeFromFamily(family));
    if (!added.ok) throw new Error(added.error.message);
    project = added.value.project;
    types[id] = added.value.typeId;
  }
  const must = <T>(
    result: { ok: true; value: T } | { ok: false; error: { message: string } },
  ): T => {
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
  const walls = must(
    addWalls(project, {
      typeId: types['arq-parede-alvenaria-ceramica'] ?? '',
      levelId,
      points: [p(0, 0), p(6, 0)],
      height: 2.8,
    }),
  );
  const wall = walls.elementIds[0] ?? '';
  const door = must(
    addHosted(walls.project, {
      kind: 'door',
      typeId: types['arq-porta-giro-1'] ?? '',
      hostId: wall,
      at: 1.5,
      hand: 'right',
    }),
  );
  const window = must(
    addHosted(door.project, {
      kind: 'window',
      typeId: types['arq-janela-abrir'] ?? '',
      hostId: wall,
      at: 4,
    }),
  );
  const slab = must(
    addFloor(window.project, {
      kind: 'slab',
      typeId: types['arq-laje-concreto'] ?? '',
      levelId,
      boundary: [p(0, 0), p(6, 0), p(6, 4), p(0, 4)],
    }),
  );
  const opened = must(
    addFloorOpening(slab.project, slab.elementIds[0] ?? '', [p(1, 1), p(2, 1), p(2, 2), p(1, 2)]),
  );
  const space = must(
    addSpace(opened.project, {
      levelId,
      name: 'Sala',
      boundary: [p(0, 0), p(6, 0), p(6, 4), p(0, 4)],
    }),
  );
  return {
    project: space.project,
    wall,
    door: door.elementIds[0] ?? '',
    window: window.elementIds[0] ?? '',
    slab: slab.elementIds[0] ?? '',
    space: space.elementIds[0] ?? '',
    types,
  };
}

const propertyOf = (
  sets: readonly { name: string; properties: readonly IfcPropertyInfo[] }[],
  key: string,
): IfcPropertyInfo | undefined =>
  sets.flatMap((set) => set.properties).find((property) => property.key === key);

describe('registro de propriedades da arquitetura', () => {
  it('toda propriedade padronizada existe no esquema, com o tipo de valor do esquema', () => {
    const standard = ARCH_PROPERTY_DEFINITIONS.filter((definition) => definition.standard);
    expect(standard.length).toBeGreaterThan(100);
    for (const definition of standard) {
      const template = IFC_PROPERTY_SETS[definition.set]?.properties[definition.name];
      expect(template, `${definition.set}.${definition.name}`).toBeDefined();
      if (definition.kind !== 'quantity') expect(definition.ifcType).toBe(template?.type);
    }
    for (const definition of ARCH_PROPERTY_DEFINITIONS.filter((item) => !item.standard)) {
      expect(definition.set.startsWith('HydroBIM_')).toBe(true);
    }
  });

  it('os conjuntos comuns de cada categoria vêm completos do esquema', () => {
    const names = (set: string): string[] =>
      ARCH_PROPERTY_DEFINITIONS.filter((definition) => definition.set === set).map((d) => d.name);
    expect(names('Pset_WallCommon').sort()).toEqual(
      Object.keys(IFC_PROPERTY_SETS.Pset_WallCommon?.properties ?? {}).sort(),
    );
    expect(names('Pset_DoorCommon').sort()).toEqual(
      Object.keys(IFC_PROPERTY_SETS.Pset_DoorCommon?.properties ?? {}).sort(),
    );
    expect(names('Pset_WindowCommon')).toContain('GlazingAreaFraction');
    expect(names('Pset_CoveringFlooring')).toEqual(['HasNonSkidSurface', 'HasAntiStaticSurface']);
  });

  it('as famílias do catálogo têm entidade, tipo e tipo predefinido do esquema', () => {
    for (const family of ARCH_FAMILIES) {
      const entity = IFC_ENTITIES[family.ifc.entity];
      expect(entity?.typeEntity, family.id).toBe(family.ifc.typeEntity);
      expect(entity?.predefinedTypes, family.id).toContain(family.ifc.predefinedType);
      // Genérica não tem fonte; produto de fabricante só entra com a fonte citada.
      if (family.generic) expect(family.source, family.id).toBeNull();
      else expect(family.source, family.id).toMatch(/p\. \d+/);
    }
    expect(ARCH_FAMILIES.some((family) => !family.generic)).toBe(true);
  });
});

describe('modelo de informação IFC da arquitetura', () => {
  it('cada elemento nasce com a classificação da família e sem valores presumidos', () => {
    const s = sample();
    const model = buildArchIfcModel(s.project);
    const byId = new Map(model.elements.map((element) => [element.elementId, element]));
    expect(byId.get(s.wall)).toMatchObject({ entity: 'IfcWall', predefinedType: 'SOLIDWALL' });
    expect(byId.get(s.slab)).toMatchObject({ entity: 'IfcSlab', predefinedType: 'FLOOR' });
    expect(byId.get(s.space)).toMatchObject({ entity: 'IfcSpace', predefinedType: 'SPACE' });
    expect(byId.get(s.door)?.attributes).toMatchObject({
      OverallWidth: 0.8,
      OverallHeight: 2.1,
      OperationType: 'SINGLE_SWING_RIGHT',
    });
    expect(byId.get(s.window)?.attributes).toMatchObject({
      PartitioningType: 'DOUBLE_PANEL_VERTICAL',
    });

    const wallType = model.types.find(
      (type) => type.archTypeId === s.types['arq-parede-alvenaria-ceramica'],
    );
    expect(wallType).toMatchObject({
      entity: 'IfcWallType',
      predefinedType: 'SOLIDWALL',
      generic: true,
    });
    expect(wallType?.layers.map((layer) => layer.thickness)).toEqual([0.02, 0.14, 0.02]);
    // Desempenho: campos disponíveis, todos pendentes.
    for (const key of [
      'Pset_WallCommon.FireRating',
      'Pset_WallCommon.AcousticRating',
      'Pset_WallCommon.ThermalTransmittance',
    ]) {
      expect(propertyOf(wallType?.psets ?? [], key)).toMatchObject({
        value: null,
        origin: 'pending',
        editable: true,
      });
    }
    for (const key of ['Pset_WallCommon.IsExternal', 'Pset_WallCommon.LoadBearing']) {
      expect(propertyOf(byId.get(s.wall)?.psets ?? [], key)).toMatchObject({
        value: null,
        origin: 'pending',
      });
    }
    expect(propertyOf(wallType?.psets ?? [], 'Pset_WallCommon.Reference')).toMatchObject({
      value: 'Parede de alvenaria cerâmica',
      editable: false,
    });
    expect(validateArchIfc(s.project)).toEqual([]);
  });

  it('quantitativos calculados no grupo próprio; ambiente sem pé-direito não tem altura nem volume', () => {
    const s = sample();
    const model = buildArchIfcModel(s.project);
    const wall = model.elements.find((element) => element.elementId === s.wall);
    const net = propertyOf(wall?.psets ?? [], 'Qto_WallBaseQuantities.NetSideArea');
    expect(net).toMatchObject({
      origin: 'geometry',
      group: 'quantities',
      ifcType: 'IfcQuantityArea',
    });
    expect(net?.value).toBeCloseTo(6 * 2.8 - 0.8 * 2.1 - 1.2 * 1.0, 9);
    const slab = model.elements.find((element) => element.elementId === s.slab);
    expect(propertyOf(slab?.psets ?? [], 'Qto_SlabBaseQuantities.NetArea')?.value).toBeCloseTo(
      23,
      9,
    );
    expect(propertyOf(slab?.psets ?? [], 'Qto_SlabBaseQuantities.Length')).toBeUndefined();
    const space = model.elements.find((element) => element.elementId === s.space);
    expect(
      propertyOf(space?.psets ?? [], 'Qto_SpaceBaseQuantities.GrossFloorArea')?.value,
    ).toBeCloseTo(24, 9);
    expect(propertyOf(space?.psets ?? [], 'Qto_SpaceBaseQuantities.Height')).toBeUndefined();
    expect(propertyOf(space?.psets ?? [], 'Qto_SpaceBaseQuantities.GrossVolume')).toBeUndefined();
  });

  it('valor do tipo vale para todas as ocorrências; o da ocorrência, só para ela', () => {
    const s = sample();
    const typed = setArchIfcValue(
      s.project,
      { elementId: s.wall, scope: 'type' },
      'Pset_WallCommon.FireRating',
      'TRRF 120',
    );
    expect(typed.ok).toBe(true);
    if (!typed.ok) return;
    const typeId = s.types['arq-parede-alvenaria-ceramica'] ?? '';
    expect(
      propertyOf(archTypeProperties(typed.value, typeId), 'Pset_WallCommon.FireRating'),
    ).toMatchObject({
      value: 'TRRF 120',
      origin: 'user',
    });
    const external = setArchIfcValue(
      typed.value,
      { elementId: s.wall, scope: 'occurrence' },
      'Pset_WallCommon.IsExternal',
      true,
    );
    expect(external.ok).toBe(true);
    if (!external.ok) return;
    const wall = buildArchIfcModel(external.value).elements.find(
      (element) => element.elementId === s.wall,
    );
    expect(propertyOf(wall?.psets ?? [], 'Pset_WallCommon.IsExternal')?.value).toBe(true);
    const cleared = setArchIfcValue(
      external.value,
      { typeId, scope: 'type' },
      'Pset_WallCommon.FireRating',
      null,
    );
    expect(
      cleared.ok &&
        propertyOf(archTypeProperties(cleared.value, typeId), 'Pset_WallCommon.FireRating')?.origin,
    ).toBe('pending');
  });

  it('recusa propriedade derivada, valor de tipo errado, enumeração e data inválidas', () => {
    const s = sample();
    const set = (
      key: string,
      value: string | number | boolean,
      scope: 'type' | 'occurrence' = 'occurrence',
    ) => setArchIfcValue(s.project, { elementId: s.wall, scope }, key, value);
    const derived = set('Qto_WallBaseQuantities.Length', 3);
    expect(derived.ok ? '' : derived.error.code).toBe('IFC_PROPERTY_NOT_EDITABLE');
    const wrong = set('Pset_WallCommon.IsExternal', 'sim');
    expect(wrong.ok ? '' : wrong.error.code).toBe('IFC_VALUE_INVALID');
    const status = set('Pset_WallCommon.Status', 'NOVO');
    expect(status.ok ? '' : status.error.code).toBe('IFC_VALUE_INVALID');
    expect(set('Pset_WallCommon.Status', 'NEW').ok).toBe(true);
    const date = set('Pset_InstallationOccurrence.InstallationDate', '21/11/2026');
    expect(date.ok ? '' : date.error.code).toBe('IFC_VALUE_INVALID');
    expect(set('Pset_InstallationOccurrence.InstallationDate', '2026-11-21').ok).toBe(true);
    const foreign = set('Pset_DoorCommon.FireExit', true);
    expect(foreign.ok ? '' : foreign.error.code).toBe('IFC_PROPERTY_NOT_APPLICABLE');
    const ambient = setArchIfcValue(
      s.project,
      { elementId: s.space, scope: 'occurrence' },
      'Pset_SpaceCommon.IsExternal',
      false,
    );
    expect(
      ambient.ok &&
        buildArchIfcModel(ambient.value).elements.find((e) => e.elementId === s.space)
          ?.predefinedType,
    ).toBe('INTERNAL');
  });

  it('porta pivotante usa USERDEFINED com a descrição; a mão separa os tipos IFC', () => {
    const s = sample();
    const pivot = addHosted(s.project, {
      kind: 'door',
      typeId: s.types['arq-porta-pivotante'] ?? '',
      hostId: s.wall,
      at: 5.3,
    });
    expect(pivot.ok).toBe(true);
    if (!pivot.ok) return;
    const left = addHosted(pivot.value.project, {
      kind: 'door',
      typeId: s.types['arq-porta-giro-1'] ?? '',
      hostId: s.wall,
      at: 2.7,
      hand: 'left',
    });
    expect(left.ok).toBe(true);
    if (!left.ok) return;
    const model = buildArchIfcModel(left.value.project);
    const pivotInfo = model.elements.find(
      (element) => element.elementId === pivot.value.elementIds[0],
    );
    expect(pivotInfo?.attributes).toMatchObject({
      OperationType: 'USERDEFINED',
      UserDefinedOperationType: 'PIVOT',
    });
    const swingTypes = model.types.filter(
      (type) => type.archTypeId === s.types['arq-porta-giro-1'],
    );
    expect(swingTypes.map((type) => type.attributes.OperationType).sort()).toEqual([
      'SINGLE_SWING_LEFT',
      'SINGLE_SWING_RIGHT',
    ]);
    expect(new Set(swingTypes.map((type) => type.globalId)).size).toBe(2);
    expect(validateArchIfc(left.value.project)).toEqual([]);
  });

  it('editar o modelo atualiza propriedades e arquivo; GlobalIds não mudam', () => {
    const s = sample();
    const before = buildArchIfcModel(s.project);
    const taller = updateArchElement(s.project, s.wall, { height: 3.2 });
    const wider = taller.ok
      ? updateArchType(taller.value, s.types['arq-porta-giro-1'] ?? '', { width: 0.9 })
      : taller;
    expect(wider.ok).toBe(true);
    if (!wider.ok) return;
    const after = buildArchIfcModel(wider.value.project);
    expect(after.elements.map((element) => element.globalId)).toEqual(
      before.elements.map((element) => element.globalId),
    );
    expect(after.types.map((type) => type.globalId).sort()).toEqual(
      before.types.map((type) => type.globalId).sort(),
    );
    const wall = after.elements.find((element) => element.elementId === s.wall);
    expect(propertyOf(wall?.psets ?? [], 'Qto_WallBaseQuantities.Height')?.value).toBe(3.2);
    expect(propertyOf(wall?.psets ?? [], 'Qto_WallBaseQuantities.NetSideArea')?.value).toBeCloseTo(
      6 * 3.2 - 0.9 * 2.1 - 1.2,
      9,
    );
    expect(
      after.elements.find((element) => element.elementId === s.door)?.attributes.OverallWidth,
    ).toBe(0.9);
    const text = exportIfc(wider.value.project, { timestamp: new Date(0) });
    expect(text).toContain('IFCWALL(');
    expect(text.match(/IFCOPENINGELEMENT\(/g)).toHaveLength(3);
    expect(text.match(/IFCRELVOIDSELEMENT\(/g)).toHaveLength(3);
    expect(text.match(/IFCRELFILLSELEMENT\(/g)).toHaveLength(2);
    expect(text).toContain('IFCMATERIALLAYERSETUSAGE(');
    expect(text).toContain('IFCSPACE(');
    expect(exportIfc(wider.value.project, { timestamp: new Date(0) })).toBe(text);
  });

  it('classificações externas e materiais informados vão para o tipo, sem substituir a entidade', () => {
    const s = sample();
    const typeId = s.types['arq-porta-giro-1'] ?? '';
    const classified = updateArchType(s.project, typeId, {
      classifications: [
        { system: 'nbr15965', table: '3E', code: '04 30 10', description: 'Portas' },
        { system: 'sinapi', code: '90843' },
      ],
      materials: { frame: 'Madeira', panel: 'Madeira' },
    });
    expect(classified.ok).toBe(true);
    if (!classified.ok) return;
    const type = buildArchIfcModel(classified.value.project).types.find(
      (item) => item.archTypeId === typeId,
    );
    expect(type?.entity).toBe('IfcDoorType');
    expect(type?.classifications).toHaveLength(2);
    expect(type?.constituents).toEqual([
      { name: 'Frame', material: 'Madeira' },
      { name: 'Panel', material: 'Madeira' },
    ]);
    const text = exportIfc(classified.value.project, { timestamp: new Date(0) });
    expect(text).toContain("IFCCLASSIFICATION('ABNT',$,$,'ABNT NBR 15965'");
    expect(text).toContain("IFCCLASSIFICATIONREFERENCE($,'3E 04 30 10','Portas'");
    expect(text).toContain('IFCMATERIALCONSTITUENTSET(');
  });
});
