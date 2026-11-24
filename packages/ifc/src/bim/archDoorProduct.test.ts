import { doorTypeFromProduct, getArchFamily } from '@hydrobim/catalog';
import { addArchType, addHosted, addWalls, createProject, type Project } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { exportIfc } from '../export';
import { archTypeProperties, buildArchIfcModel } from './archModel';
import { validateArchIfc } from './archValidate';
import type { IfcPropertyInfo } from './types';

/** Parede com uma porta Pormade Frizzatta FRI 004, 80 × 210, verniz, núcleo sólido. */
function sample(): { project: Project; typeId: string; door: string } {
  let project = createProject('Casa', 'architecture');
  const wallFamily = getArchFamily('arq-parede-alvenaria-ceramica');
  const doorFamily = getArchFamily('arq-porta-pormade-frizzatta-fri-004');
  if (!wallFamily || !doorFamily) throw new Error('famílias ausentes');
  const wallType = addArchType(project, {
    category: 'wall',
    name: 'Parede',
    familyId: wallFamily.id,
    generic: true,
    source: null,
    manufacturing: {},
    classifications: [],
    ifcPredefinedType: 'SOLIDWALL',
    ifc: {},
    layers: [{ id: 'a', material: 'Bloco', thickness: 0.15, function: 'structure', hatch: 'none' }],
  });
  if (!wallType.ok) throw new Error(wallType.error.message);
  const input = doorTypeFromProduct(doorFamily, { finishId: 'verniz', core: 'Sólido' });
  if (!input) throw new Error('tipo esperado');
  const doorType = addArchType(wallType.value.project, input);
  if (!doorType.ok) throw new Error(doorType.error.message);
  project = doorType.value.project;
  const walls = addWalls(project, {
    typeId: wallType.value.typeId,
    levelId: project.levels[0]?.id ?? '',
    points: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ],
    height: 2.8,
  });
  if (!walls.ok) throw new Error(walls.error.message);
  const door = addHosted(walls.value.project, {
    kind: 'door',
    typeId: doorType.value.typeId,
    hostId: walls.value.elementIds[0] ?? '',
    at: 2,
  });
  if (!door.ok) throw new Error(door.error.message);
  return {
    project: door.value.project,
    typeId: doorType.value.typeId,
    door: door.value.elementIds[0] ?? '',
  };
}

describe('porta de catálogo no modelo de informação IFC', () => {
  it('fabricante, modelo, acabamento, núcleo e frisos saem do tipo; o resto fica pendente', () => {
    const s = sample();
    const properties = new Map<string, IfcPropertyInfo>(
      archTypeProperties(s.project, s.typeId)
        .flatMap((set) => set.properties)
        .map((property) => [property.key, property]),
    );
    const valueOf = (key: string) => properties.get(key)?.value;
    expect(valueOf('Pset_ManufacturerTypeInformation.Manufacturer')).toBe('Pormade');
    expect(valueOf('Pset_ManufacturerTypeInformation.ModelLabel')).toBe('Frizzatta FRI 004');
    expect(valueOf('HydroBIM_Esquadria.Finish')).toBe('Verniz');
    expect(valueOf('HydroBIM_Esquadria.Core')).toBe('Sólido');
    expect(valueOf('HydroBIM_Esquadria.FriezeCount')).toBe(4);
    expect(valueOf('HydroBIM_Esquadria.FriezeWidth')).toBe(0.016);
    expect(valueOf('HydroBIM_Esquadria.PanelThickness')).toBe(0.035);
    // Derivados do desenho não são editáveis; o que o catálogo não traz continua pendente.
    expect(properties.get('HydroBIM_Esquadria.FriezeCount')?.editable).toBe(false);
    expect(properties.get('HydroBIM_Esquadria.Core')?.editable).toBe(true);
    expect(properties.get('HydroBIM_Esquadria.Hardware')?.origin).toBe('pending');
    expect(properties.get('Pset_DoorCommon.FireRating')?.origin).toBe('pending');
    expect(properties.get('Pset_ManufacturerTypeInformation.ArticleNumber')?.origin).toBe(
      'pending',
    );
  });

  it('a ocorrência leva o vão do catálogo e o arquivo IFC traz o produto e os frisos', () => {
    const s = sample();
    const model = buildArchIfcModel(s.project);
    const door = model.elements.find((element) => element.elementId === s.door);
    expect(door?.entity).toBe('IfcDoor');
    expect(door?.attributes).toMatchObject({ OverallWidth: 0.88, OverallHeight: 2.15 });
    expect(validateArchIfc(s.project).filter((issue) => issue.severity === 'error')).toEqual([]);

    const text = exportIfc(s.project, { timestamp: new Date(0) });
    expect(text).toContain('IFCDOORTYPE(');
    expect(text).toContain("'Pormade'");
    expect(text).toContain("'Frizzatta FRI 004'");
    expect(text).toContain("'FriezeCount'");
    expect(text).toContain("'Core'");
    // Os frisos têm estilo próprio na representação.
    expect(text).toContain('Friso de porta');
  });

  it('porta lisa de catálogo não ganha propriedades de friso', () => {
    const lisa = getArchFamily('arq-porta-pormade-lisa');
    const input = lisa ? doorTypeFromProduct(lisa, {}) : null;
    if (!input) throw new Error('tipo esperado');
    const added = addArchType(createProject('Casa', 'architecture'), input);
    if (!added.ok) throw new Error(added.error.message);
    const keys = archTypeProperties(added.value.project, added.value.typeId)
      .flatMap((set) => set.properties)
      .filter((property) => property.origin !== 'pending')
      .map((property) => property.key);
    expect(keys).toContain('HydroBIM_Esquadria.Finish');
    expect(keys).not.toContain('HydroBIM_Esquadria.FriezeCount');
  });
});
