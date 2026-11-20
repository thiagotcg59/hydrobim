import { pipeLength } from './ports';
import { PUMP_TYPE_LABELS, pumpTypeOf } from './pumps';
import type { FittingFamily, HydroElement, Project } from './schema';
import { TANK_TYPE_LABELS, tankTypeOf } from './tanks';
import { radToDeg } from './units';

/** Linha do quantitativo (lista de materiais). */
export interface QuantityRow {
  category: 'Tubo' | 'Conexão' | 'Válvula' | 'Equipamento';
  description: string;
  /** Material e norma. */
  specification: string;
  size: string;
  unit: 'm' | 'un';
  quantity: number;
  /** Família de catálogo, ou indicação de dimensões genéricas. */
  family: string;
  system: string;
}

const MATERIAL: Record<string, string> = {
  pvc: 'PVC',
  hdpe: 'PEAD',
  ductileIron: 'Ferro fundido dúctil',
  carbonSteel: 'Aço-carbono',
};
const VALVE: Record<string, string> = {
  gate: 'gaveta',
  globe: 'globo',
  ball: 'esfera',
  butterfly: 'borboleta',
  check: 'retenção',
  airRelease: 'ventosa',
  pressureReducing: 'redutora de pressão',
  strainer: 'filtro Y',
  flowMeter: 'medidor de vazão',
};

function describe(element: HydroElement): Pick<QuantityRow, 'category' | 'description' | 'size'> {
  const size = element.spec.sizeLabel;
  switch (element.kind) {
    case 'pipe': {
      const start = element.ends?.start?.type === 'flange';
      const end = element.ends?.end?.type === 'flange';
      return {
        category: 'Tubo',
        description:
          start && end ? 'Tubo flange e flange' : start || end ? 'Tubo flange e ponta' : 'Tubo',
        size,
      };
    }
    case 'elbow': {
      const angle = Math.round(radToDeg(element.angle) * 100) / 100;
      return {
        category: 'Conexão',
        description: `Joelho/curva ${String(angle).replace('.', ',')}°`,
        size,
      };
    }
    case 'tee':
      return element.branchSpec
        ? {
            category: 'Conexão',
            description: 'Tê de redução',
            size: `${size} × ${element.branchSpec.sizeLabel}`,
          }
        : { category: 'Conexão', description: 'Tê', size };
    case 'reducer':
      return {
        category: 'Conexão',
        description: 'Redução',
        size: `${size} × ${element.outletSpec.sizeLabel}`,
      };
    case 'valve':
      return {
        category: 'Válvula',
        description:
          element.valveType === 'airRelease'
            ? 'Ventosa'
            : element.valveType === 'strainer'
              ? 'Filtro Y'
              : element.valveType === 'flowMeter'
                ? 'Medidor de vazão'
                : `Válvula de ${VALVE[element.valveType]}`,
        size,
      };
    case 'pump':
      return {
        category: 'Equipamento',
        // Bomba de catálogo: o modelo identifica o produto (fabricante e linha da tabela).
        description:
          pumpTypeOf(element) === 'generic'
            ? 'Conjunto motobomba'
            : (element.manufacturing.model ?? PUMP_TYPE_LABELS[pumpTypeOf(element)]),
        size: `${size} × ${element.dischargeSpec.sizeLabel}`,
      };
    case 'tank': {
      const fmt = (v: number): string => v.toLocaleString('pt-BR');
      const type = tankTypeOf(element);
      const capacity =
        element.nominalCapacity === undefined
          ? ''
          : ` ${fmt(Math.round(element.nominalCapacity * 1000))} L —`;
      const dims =
        type === 'horizontal'
          ? `Ø ${fmt(element.diameter)} m × ${fmt(element.length ?? 0)} m`
          : `Ø ${fmt(element.diameter)} m × ${fmt(element.height)} m`;
      const maker = element.manufacturing.manufacturer;
      return {
        category: 'Equipamento',
        description:
          type === 'generic'
            ? `Reservatório ${dims}`
            : `${TANK_TYPE_LABELS[type]}${maker ? ` ${maker}` : ''} —${capacity} ${dims}`,
        size,
      };
    }
  }
}

/**
 * Quantitativo do projeto: tubos somados por especificação e diâmetro (em metros) e
 * demais elementos contados por tipo, dimensões e família.
 */
export function computeQuantities(
  project: Project,
  families: readonly Pick<FittingFamily, 'id' | 'name'>[] = [],
): QuantityRow[] {
  const rows = new Map<string, QuantityRow>();
  const systems = new Map(project.systems.map((s) => [s.id, s.name]));
  const familyNames = new Map(families.map((f) => [f.id, f.name]));

  for (const element of project.elements) {
    const base = describe(element);
    const family =
      element.kind === 'pump' ||
      element.kind === 'tank' ||
      (element.kind === 'pipe' && element.familyId === null)
        ? '—'
        : element.familyId
          ? (familyNames.get(element.familyId) ?? element.familyId)
          : 'Dimensões genéricas (fora de catálogo)';
    const row: QuantityRow = {
      ...base,
      specification: `${MATERIAL[element.spec.material] ?? element.spec.material} — ${element.spec.standard}${element.spec.pressureClass ? ` — ${element.spec.pressureClass}` : ''}`,
      unit: element.kind === 'pipe' ? 'm' : 'un',
      quantity: element.kind === 'pipe' ? pipeLength(element) : 1,
      family,
      system: systems.get(element.systemId) ?? '—',
    };
    const key = [
      row.system,
      row.category,
      row.description,
      row.specification,
      row.size,
      row.family,
    ].join('|');
    const existing = rows.get(key);
    if (existing) existing.quantity += row.quantity;
    else rows.set(key, row);
  }

  const order = ['Tubo', 'Conexão', 'Válvula', 'Equipamento'];
  return [...rows.values()].sort(
    (a, b) =>
      a.system.localeCompare(b.system, 'pt-BR') ||
      order.indexOf(a.category) - order.indexOf(b.category) ||
      a.description.localeCompare(b.description, 'pt-BR') ||
      a.size.localeCompare(b.size, 'pt-BR', { numeric: true }),
  );
}

/** CSV com separador `;` e vírgula decimal (abre diretamente no Excel em pt-BR). */
export function quantitiesToCsv(rows: readonly QuantityRow[]): string {
  const cell = (value: string): string => `"${value.replaceAll('"', '""')}"`;
  const lines = [
    [
      'Sistema',
      'Categoria',
      'Descrição',
      'Especificação',
      'Diâmetro',
      'Família',
      'Unidade',
      'Quantidade',
    ]
      .map(cell)
      .join(';'),
    ...rows.map((row) =>
      [
        cell(row.system),
        cell(row.category),
        cell(row.description),
        cell(row.specification),
        cell(row.size),
        cell(row.family),
        cell(row.unit),
        row.unit === 'm' ? row.quantity.toFixed(2).replace('.', ',') : String(row.quantity),
      ].join(';'),
    ),
  ];
  // BOM UTF-8 para o Excel reconhecer a acentuação.
  return `${String.fromCharCode(0xfeff)}${lines.join('\r\n')}\r\n`;
}
