import { listArchFamilies } from '@hydrobim/catalog';
import { updateArchType, type ArchType, type Project } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { createBuildingDemoProject } from '../demo/buildingDemo';
import { catalogGroups } from './ArchCatalogDialog';
import {
  archDraftProblem,
  archTypeAffected,
  archTypeDirty,
  archTypePatchOf,
  occurrencesText,
  predefinedTypesOf,
} from './ArchTypeEditor';

const demo = createBuildingDemoProject();

function typeNamed(project: Project, name: string): ArchType {
  const type = project.architecture.types.find((entry) => entry.name === name);
  if (!type) throw new Error(`tipo ausente: ${name}`);
  return type;
}

describe('gravação do tipo', () => {
  const door = typeNamed(demo, 'Porta de giro 80 × 210');

  it('o rascunho igual ao gravado não está alterado', () => {
    expect(archTypeDirty(door, { ...door })).toBe(false);
    expect(archTypeDirty(door, { ...door, name: 'Outra' })).toBe(true);
    if (door.category !== 'door') throw new Error('tipo inesperado');
    expect(archTypeDirty(door, { ...door, width: 0.9 })).toBe(true);
    // Valores IFC têm gravação própria: não contam como alteração do formulário.
    expect(archTypeDirty(door, { ...door, ifc: { 'Pset_DoorCommon.FireRating': 'x' } })).toBe(
      false,
    );
  });

  it('não grava id, categoria, família nem valores IFC', () => {
    const patch = archTypePatchOf(door);
    expect(Object.keys(patch).sort()).toEqual(
      [
        'classifications',
        'frameWidth',
        'generic',
        'height',
        'ifcPredefinedType',
        'manufacturing',
        'name',
        'operation',
        'panelThickness',
        'source',
        'width',
      ].sort(),
    );
  });

  it('textos vazios viram ausência de valor', () => {
    const patch = archTypePatchOf({
      ...door,
      generic: false,
      source: '   ',
      manufacturing: { manufacturer: ' ', model: ' M1 ' },
      classifications: [
        { system: 'nbr15965', table: ' 3E ', code: ' 04 10 ', description: '' },
        { system: 'sinapi', table: 'ignorada', code: '12345' },
      ],
    });
    expect(patch.source).toBeNull();
    expect(patch.manufacturing).toEqual({ model: 'M1' });
    expect(patch.classifications).toEqual([
      { system: 'nbr15965', table: '3E', code: '04 10' },
      { system: 'sinapi', code: '12345' },
    ]);
  });

  it('modelo genérico não leva fonte', () => {
    expect(archTypePatchOf({ ...door, generic: true, source: 'Catálogo X' }).source).toBeNull();
  });

  it('o núcleo recusa produto sem fonte e aceita com ela', () => {
    const without = updateArchType(
      demo,
      door.id,
      archTypePatchOf({ ...door, generic: false, source: '' }),
    );
    expect(without.ok).toBe(false);
    if (!without.ok) expect(without.error.code).toBe('ARCH_SOURCE_REQUIRED');
    const withSource = updateArchType(
      demo,
      door.id,
      archTypePatchOf({ ...door, generic: false, source: 'Fabricante, catálogo 2026, p. 12' }),
    );
    expect(withSource.ok).toBe(true);
  });

  it('porta mais larga que o trecho livre é recusada por inteiro', () => {
    if (door.category !== 'door') throw new Error('tipo inesperado');
    const result = updateArchType(demo, door.id, archTypePatchOf({ ...door, width: 9 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('OPENING_DOES_NOT_FIT');
  });

  it('alteração possível informa as ocorrências afetadas', () => {
    if (door.category !== 'door') throw new Error('tipo inesperado');
    const result = updateArchType(demo, door.id, archTypePatchOf({ ...door, width: 0.9 }));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.affected).toHaveLength(1);
    expect(archTypeAffected(demo, door.id)).toEqual({ count: 1, names: ['Porta 1'] });
  });

  it('confere o preenchimento antes de chamar o núcleo', () => {
    expect(archDraftProblem(door)).toBeNull();
    expect(archDraftProblem({ ...door, name: '  ' })).toMatch(/nome/);
    expect(
      archDraftProblem({ ...door, classifications: [{ system: 'sinapi', code: ' ' }] }),
    ).toMatch(/código/);
  });
});

describe('apoio do editor', () => {
  it('tipo predefinido vem da enumeração oficial da entidade', () => {
    expect(predefinedTypesOf('wall')).toEqual(expect.arrayContaining(['SOLIDWALL', 'NOTDEFINED']));
    expect(predefinedTypesOf('slab')).toContain('FLOOR');
    expect(predefinedTypesOf('flooring')).toContain('FLOORING');
    expect(predefinedTypesOf('door')).toContain('DOOR');
    expect(predefinedTypesOf('window')).toContain('WINDOW');
    // Um valor gravado fora da enumeração continua à mostra.
    expect(predefinedTypesOf('door', 'ANTIGO')[0]).toBe('ANTIGO');
  });

  it('texto das ocorrências', () => {
    expect(occurrencesText(0)).toBe('nenhuma ocorrência');
    expect(occurrencesText(1)).toBe('1 ocorrência');
    expect(occurrencesText(3)).toBe('3 ocorrências');
  });
});

describe('lista do catálogo', () => {
  const families = listArchFamilies();

  it('mostra as famílias por categoria com os tipos do projeto', () => {
    const groups = catalogGroups(families, demo.architecture, '', null);
    expect(groups.map((group) => group.category)).toEqual([
      'wall',
      'slab',
      'flooring',
      'roof',
      'door',
      'window',
    ]);
    const walls = groups[0];
    expect(walls?.families).toHaveLength(3);
    const masonry = walls?.families.find(
      (entry) => entry.family.id === 'arq-parede-alvenaria-ceramica',
    );
    expect(masonry?.types.map((type) => type.name)).toEqual(['Alvenaria cerâmica 18 cm']);
  });

  it('filtra por categoria e busca sem acentos', () => {
    const doors = catalogGroups(families, demo.architecture, '', 'door');
    expect(doors).toHaveLength(1);
    expect(doors[0]?.families).toHaveLength(4);
    const found = catalogGroups(families, demo.architecture, 'ceramica', null);
    expect(found.flatMap((group) => group.families.map((entry) => entry.family.id)).sort()).toEqual(
      ['arq-parede-alvenaria-ceramica', 'arq-piso-ceramica-porcelanato'],
    );
    expect(catalogGroups(families, demo.architecture, 'inexistente', null)).toHaveLength(0);
  });

  it('a busca alcança o nome dos tipos do projeto', () => {
    const found = catalogGroups(families, demo.architecture, '80 × 210', null);
    expect(found).toHaveLength(1);
    expect(found[0]?.families[0]?.types.map((type) => type.name)).toEqual([
      'Porta de giro 80 × 210',
    ]);
  });

  it('tipos sem família do catálogo aparecem à parte', () => {
    const door = typeNamed(demo, 'Porta de giro 80 × 210');
    const types = demo.architecture.types.map((type) =>
      type.id === door.id ? { ...type, familyId: null } : type,
    );
    const groups = catalogGroups(families, { types }, '', 'door');
    expect(groups[0]?.orphans.map((type) => type.name)).toEqual(['Porta de giro 80 × 210']);
  });
});
