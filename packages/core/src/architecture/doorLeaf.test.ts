import { describe, expect, it } from 'vitest';
import { createProject } from '../operations';
import { SCHEMA_VERSION, type DoorType } from '../schema';
import { parseProject, serializeProject } from '../serialization';
import { validateProject } from '../validation';
import { addArchType, duplicateArchType, getArchType, updateArchType } from './index';

const DOOR: Omit<DoorType, 'id'> = {
  category: 'door',
  name: 'Porta com frisos',
  familyId: 'arq-porta-exemplo',
  generic: false,
  source: 'Fabricante, catálogo, p. 1',
  manufacturing: { manufacturer: 'Fabricante', model: 'Modelo' },
  classifications: [],
  ifcPredefinedType: 'DOOR',
  ifc: {},
  operation: 'singleSwing',
  width: 0.88,
  height: 2.15,
  frameWidth: 0.04,
  panelThickness: 0.035,
  materials: {},
  leaf: {
    friezes: [
      { orientation: 'horizontal', position: 0.5 },
      { orientation: 'vertical', position: 0.2 },
    ],
    friezeWidth: 0.016,
    schematic: true,
  },
};

const withDoor = () => {
  const added = addArchType(createProject('Casa', 'architecture'), DOOR);
  if (!added.ok) throw new Error(added.error.message);
  return added.value;
};

describe('desenho da folha no tipo de porta (esquema v20)', () => {
  it('o tipo guarda os frisos e o projeto fica sem pendências', () => {
    const { project, typeId } = withDoor();
    const type = getArchType(project.architecture, typeId);
    expect(type?.category === 'door' && type.leaf).toEqual(DOOR.leaf);
    expect(validateProject(project).filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('friso fora da folha, sem frisos ou de largura nula é recusado', () => {
    const project = createProject('Casa', 'architecture');
    const leaf = DOOR.leaf;
    if (!leaf) throw new Error('desenho esperado');
    for (const bad of [
      { ...leaf, friezes: [{ orientation: 'horizontal' as const, position: 0 }] },
      { ...leaf, friezes: [{ orientation: 'vertical' as const, position: 1 }] },
      { ...leaf, friezes: [] },
      { ...leaf, friezeWidth: 0 },
    ]) {
      const result = addArchType(project, { ...DOOR, leaf: bad });
      expect(!result.ok && result.error.code).toBe('INVALID_ARCH_TYPE');
    }
  });

  it('alterar ou duplicar o tipo mantém o desenho da folha', () => {
    const { project, typeId } = withDoor();
    const renamed = updateArchType(project, typeId, { name: 'Porta renomeada' });
    if (!renamed.ok) throw new Error(renamed.error.message);
    const kept = getArchType(renamed.value.project.architecture, typeId);
    expect(kept?.category === 'door' && kept.leaf).toEqual(DOOR.leaf);
    const copy = duplicateArchType(project, typeId);
    if (!copy.ok) throw new Error(copy.error.message);
    const copied = getArchType(copy.value.project.architecture, copy.value.typeId);
    expect(copied?.category === 'door' && copied.leaf).toEqual(DOOR.leaf);
  });

  it('grava e reabre com o desenho; documento v19 migra sem alteração de conteúdo', () => {
    const { project, typeId } = withDoor();
    const reopened = parseProject(serializeProject(project));
    if (!reopened.ok) throw new Error(reopened.error.message);
    expect(reopened.value.schemaVersion).toBe(SCHEMA_VERSION);
    const type = getArchType(reopened.value.architecture, typeId);
    expect(type?.category === 'door' && type.leaf).toEqual(DOOR.leaf);

    const plain = createProject('Antigo', 'architecture');
    const legacy = parseProject(JSON.stringify({ ...plain, schemaVersion: 19 }));
    if (!legacy.ok) throw new Error(legacy.error.message);
    expect(legacy.value.schemaVersion).toBe(20);
    expect({ ...legacy.value, schemaVersion: 19 }).toEqual({ ...plain, schemaVersion: 19 });
  });
});
