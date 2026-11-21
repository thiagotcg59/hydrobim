import type { ArchCategory, ArchType, Project } from '../schema';
import {
  ARCH_CATEGORY_LABELS,
  archLevelIdOf,
  archTypeSizeLabel,
  floorQuantities,
  hostedQuantities,
  spaceQuantities,
  wallQuantities,
} from './derive';
import { getArchType } from './walls';

/**
 * Quantitativo da arquitetura, extraído do modelo: uma linha por pavimento, categoria e tipo.
 * Cada elemento entra uma única vez, na sua categoria — o ambiente não soma paredes, lajes
 * nem revestimentos, e o revestimento não soma a laje.
 */
export interface ArchQuantityRow {
  level: string;
  category: string;
  type: string;
  /** Dimensão característica do tipo (espessura ou vão). */
  size: string;
  /** Códigos informados no tipo; "NC" (não classificado) quando não há. */
  nbr15965: string;
  sinapi: string;
  count: number;
  /** Paredes: comprimento no plano médio (m). */
  length: number | null;
  /** Bruta: sem descontar vãos e aberturas. Líquida: descontados. */
  grossArea: number | null;
  netArea: number | null;
  grossVolume: number | null;
  netVolume: number | null;
}

const NOT_CLASSIFIED = 'NC';

function classification(type: ArchType, system: 'nbr15965' | 'sinapi'): string {
  const codes = type.classifications
    .filter((entry) => entry.system === system)
    .map((entry) => (entry.table ? `${entry.table} ${entry.code}` : entry.code));
  return codes.length > 0 ? codes.join('; ') : NOT_CLASSIFIED;
}

const CATEGORY_ORDER: ArchCategory[] = ['wall', 'slab', 'flooring', 'door', 'window'];

export function computeArchQuantities(
  project: Pick<Project, 'levels' | 'architecture'>,
): ArchQuantityRow[] {
  const { architecture } = project;
  const levels = new Map(project.levels.map((level) => [level.id, level]));
  const rows = new Map<string, ArchQuantityRow & { order: number; elevation: number }>();
  const sum = (a: number | null, b: number | undefined): number | null =>
    b === undefined ? a : (a ?? 0) + b;

  for (const element of architecture.elements) {
    if (element.kind === 'space') continue;
    const type = getArchType(architecture, element.typeId);
    if (!type) continue;
    const level = levels.get(archLevelIdOf(architecture, element) ?? '');
    const key = `${level?.id ?? ''}|${type.id}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        level: level?.name ?? '—',
        category: ARCH_CATEGORY_LABELS[type.category],
        type: type.name,
        size: archTypeSizeLabel(type),
        nbr15965: classification(type, 'nbr15965'),
        sinapi: classification(type, 'sinapi'),
        count: 0,
        length: null,
        grossArea: null,
        netArea: null,
        grossVolume: null,
        netVolume: null,
        order: CATEGORY_ORDER.indexOf(type.category),
        elevation: level?.elevation ?? 0,
      };
      rows.set(key, row);
    }
    row.count += 1;
    if (element.kind === 'wall') {
      const q = wallQuantities(architecture, element);
      row.length = sum(row.length, q?.length);
      row.grossArea = sum(row.grossArea, q?.grossSideArea);
      row.netArea = sum(row.netArea, q?.netSideArea);
      row.grossVolume = sum(row.grossVolume, q?.grossVolume);
      row.netVolume = sum(row.netVolume, q?.netVolume);
    } else if (element.kind === 'slab' || element.kind === 'flooring') {
      const q = floorQuantities(architecture, element);
      row.grossArea = sum(row.grossArea, q?.grossArea);
      row.netArea = sum(row.netArea, q?.netArea);
      row.grossVolume = sum(row.grossVolume, q?.grossVolume);
      row.netVolume = sum(row.netVolume, q?.netVolume);
    } else {
      const q = hostedQuantities(architecture, element);
      row.grossArea = sum(row.grossArea, q?.area);
      row.netArea = sum(row.netArea, q?.area);
    }
  }

  return [...rows.values()]
    .sort(
      (a, b) =>
        a.elevation - b.elevation ||
        a.order - b.order ||
        a.type.localeCompare(b.type, 'pt-BR', { numeric: true }),
    )
    .map(({ order: _order, elevation: _elevation, ...row }) => row);
}

/** Quadro de ambientes: área, perímetro, pé-direito e volume, por pavimento. */
export interface SpaceScheduleRow {
  level: string;
  number: string;
  name: string;
  area: number;
  perimeter: number;
  /** `null` = pé-direito não informado (e, por isso, sem volume). */
  height: number | null;
  volume: number | null;
}

export function computeSpaceSchedule(
  project: Pick<Project, 'levels' | 'architecture'>,
): SpaceScheduleRow[] {
  const levels = new Map(project.levels.map((level) => [level.id, level]));
  return project.architecture.elements
    .filter((element) => element.kind === 'space')
    .map((space) => {
      const level = levels.get(space.levelId);
      const q = spaceQuantities(space);
      return {
        row: {
          level: level?.name ?? '—',
          number: space.number ?? '',
          name: space.name,
          area: q.area,
          perimeter: q.perimeter,
          height: q.height,
          volume: q.volume,
        },
        elevation: level?.elevation ?? 0,
      };
    })
    .sort(
      (a, b) =>
        a.elevation - b.elevation ||
        a.row.number.localeCompare(b.row.number, 'pt-BR', { numeric: true }) ||
        a.row.name.localeCompare(b.row.name, 'pt-BR', { numeric: true }),
    )
    .map((entry) => entry.row);
}

const cell = (value: string): string => `"${value.replaceAll('"', '""')}"`;
const num = (value: number | null, digits = 2): string =>
  value === null ? '' : value.toFixed(digits).replace('.', ',');

/** CSV (`;` e vírgula decimal) do quantitativo de arquitetura e do quadro de ambientes. */
export function archQuantitiesToCsv(
  rows: readonly ArchQuantityRow[],
  spaces: readonly SpaceScheduleRow[] = [],
): string {
  const lines = [
    [
      'Pavimento',
      'Categoria',
      'Tipo',
      'Dimensão',
      'NBR 15965',
      'SINAPI',
      'Quantidade',
      'Comprimento (m)',
      'Área bruta (m²)',
      'Área líquida (m²)',
      'Volume bruto (m³)',
      'Volume líquido (m³)',
    ]
      .map(cell)
      .join(';'),
    ...rows.map((row) =>
      [
        cell(row.level),
        cell(row.category),
        cell(row.type),
        cell(row.size),
        cell(row.nbr15965),
        cell(row.sinapi),
        String(row.count),
        num(row.length),
        num(row.grossArea),
        num(row.netArea),
        num(row.grossVolume, 3),
        num(row.netVolume, 3),
      ].join(';'),
    ),
  ];
  if (spaces.length > 0) {
    lines.push(
      '',
      [
        'Pavimento',
        'Número',
        'Ambiente',
        'Área (m²)',
        'Perímetro (m)',
        'Pé-direito (m)',
        'Volume (m³)',
      ]
        .map(cell)
        .join(';'),
      ...spaces.map((row) =>
        [
          cell(row.level),
          cell(row.number),
          cell(row.name),
          num(row.area),
          num(row.perimeter),
          num(row.height),
          num(row.volume, 3),
        ].join(';'),
      ),
    );
  }
  return `${String.fromCharCode(0xfeff)}${lines.join('\r\n')}\r\n`;
}
