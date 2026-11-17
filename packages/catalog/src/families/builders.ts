import {
  degToRad,
  mmToM,
  type FamilyEnd,
  type FamilySize,
  type FittingFamily,
} from '@hydrobim/core';

/**
 * Utilitários para declarar famílias com as dimensões em MILÍMETROS, como nos catálogos,
 * convertendo para as unidades internas (metros, radianos).
 */

/** Extremidade em mm: [profundidade da bolsa ou espessura do flange, diâmetro externo]. */
export type EndMm = readonly [length: number, outerDiameter: number];

const end = (value: EndMm | undefined): FamilyEnd | undefined =>
  value ? { length: mmToM(value[0]), outerDiameter: mmToM(value[1]) } : undefined;

export interface SizeMm {
  dn: number;
  dn2?: number;
  centerToEnd?: number;
  centerToBranch?: number;
  length?: number;
  height?: number;
  handwheelDiameter?: number;
  width?: number;
  end?: EndMm;
  end2?: EndMm;
}

function size(row: SizeMm): FamilySize {
  const out: FamilySize = { dn: row.dn };
  if (row.dn2 !== undefined) out.dn2 = row.dn2;
  if (row.centerToEnd !== undefined) out.centerToEnd = mmToM(row.centerToEnd);
  if (row.centerToBranch !== undefined) out.centerToBranch = mmToM(row.centerToBranch);
  if (row.length !== undefined) out.length = mmToM(row.length);
  if (row.height !== undefined) out.height = mmToM(row.height);
  if (row.handwheelDiameter !== undefined) out.handwheelDiameter = mmToM(row.handwheelDiameter);
  if (row.width !== undefined) out.width = mmToM(row.width);
  const e1 = end(row.end);
  const e2 = end(row.end2);
  if (e1) out.end = e1;
  if (e2) out.end2 = e2;
  return out;
}

export interface FamilyMm extends Omit<FittingFamily, 'sizes' | 'origin' | 'angle'> {
  /** Ângulo de deflexão em graus (joelhos e curvas). */
  angleDeg?: number;
  sizes: readonly SizeMm[];
}

export function family(definition: FamilyMm): FittingFamily {
  const { angleDeg, sizes, ...rest } = definition;
  return {
    ...rest,
    ...(angleDeg !== undefined ? { angle: degToRad(angleDeg) } : {}),
    origin: 'builtin',
    sizes: sizes.map(size),
  };
}

/** Replica uma família para várias especificações de tubo que usam as mesmas conexões. */
export function forSpecifications(
  specificationIds: readonly string[],
  definition: Omit<FamilyMm, 'specificationId'>,
): FittingFamily[] {
  return specificationIds.map((specificationId) =>
    family({ ...definition, id: `${definition.id}@${specificationId}`, specificationId }),
  );
}
