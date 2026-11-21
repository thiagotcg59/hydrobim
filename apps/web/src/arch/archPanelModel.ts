import {
  ARCH_PROPERTY_GROUPS,
  type ArchIfcElementInfo,
  type ArchIfcTypeInfo,
  type ArchPropertyGroup,
  type IfcPropertyInfo,
  type IfcScope,
} from '@hydrobim/ifc';

/**
 * Organização do painel de propriedades da arquitetura: as propriedades do elemento e do tipo
 * (vindas de `buildArchIfcModel`) por grupo, e a natureza de cada valor. Funções puras.
 */

/** Natureza de um valor no painel. */
export type ArchNature = 'type' | 'occurrence' | 'calculated' | 'pending';

export const ARCH_NATURE_LABELS: Record<ArchNature, string> = {
  type: 'Tipo',
  occurrence: 'Ocorrência',
  calculated: 'Calculada',
  pending: 'Pendente',
};

/** Marca textual de cada natureza: distingue os indicadores sem depender de cor. */
export const ARCH_NATURE_MARKS: Record<ArchNature, string> = {
  type: 'T',
  occurrence: 'O',
  calculated: 'ƒ',
  pending: '?',
};

export const ARCH_NATURE_HINTS: Record<ArchNature, string> = {
  type: 'Valor do tipo: vale para todas as ocorrências do mesmo tipo.',
  occurrence: 'Valor desta ocorrência.',
  calculated: 'Calculada da geometria do modelo: não é digitada.',
  pending: 'Ainda não informado. Nenhum valor é presumido.',
};

/**
 * Natureza do valor: sem valor é pendente; derivado da geometria é calculado; os demais são do
 * tipo ou da ocorrência, conforme o conjunto a que pertencem.
 */
export function archNatureOf(
  property: Pick<IfcPropertyInfo, 'origin' | 'value'>,
  scope: IfcScope,
): ArchNature {
  if (property.origin === 'pending' || property.value === null) return 'pending';
  if (property.origin === 'geometry') return 'calculated';
  return scope;
}

export interface ArchPanelRow {
  readonly property: IfcPropertyInfo;
  readonly scope: IfcScope;
  readonly nature: ArchNature;
}

const isGroup = (value: string | undefined): value is ArchPropertyGroup =>
  (ARCH_PROPERTY_GROUPS as readonly string[]).includes(value ?? '');

/** Propriedades do elemento e do seu tipo, por grupo do painel (tipo primeiro). */
export function archPanelRows(
  element: Pick<ArchIfcElementInfo, 'psets'>,
  type: Pick<ArchIfcTypeInfo, 'psets'> | undefined,
): Record<ArchPropertyGroup, ArchPanelRow[]> {
  const rows = Object.fromEntries(
    ARCH_PROPERTY_GROUPS.map((group) => [group, [] as ArchPanelRow[]]),
  ) as Record<ArchPropertyGroup, ArchPanelRow[]>;
  for (const set of [...(type?.psets ?? []), ...element.psets]) {
    for (const property of set.properties) {
      const group = isGroup(property.group) ? property.group : 'identification';
      rows[group].push({
        property,
        scope: set.scope,
        nature: archNatureOf(property, set.scope),
      });
    }
  }
  return rows;
}
