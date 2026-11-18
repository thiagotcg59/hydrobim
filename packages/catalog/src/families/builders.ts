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

/**
 * Extremidade em mm: [profundidade da bolsa ou espessura do flange, diâmetro externo];
 * para flanges com furação tabulada, [..., círculo de furação, nº de furos, Ø do furo]; e,
 * com o ressalto tabulado, [..., Ø do ressalto, altura do ressalto] (a altura do ressalto
 * está incluída na espessura).
 */
export type EndMm =
  | readonly [length: number, outerDiameter: number]
  | readonly [
      length: number,
      outerDiameter: number,
      boltCircle: number,
      boltCount: number,
      boltHoleDiameter: number,
    ]
  | readonly [
      length: number,
      outerDiameter: number,
      boltCircle: number,
      boltCount: number,
      boltHoleDiameter: number,
      raisedFaceDiameter: number,
      raisedFaceHeight: number,
    ];

function end(value: EndMm | undefined): FamilyEnd | undefined {
  if (!value) return undefined;
  const [length, outerDiameter, boltCircle, boltCount, boltHoleDiameter, raisedD, raisedH] = value;
  return {
    length: mmToM(length),
    outerDiameter: mmToM(outerDiameter),
    ...(boltCircle !== undefined && boltCount !== undefined && boltHoleDiameter !== undefined
      ? { boltCircle: mmToM(boltCircle), boltCount, boltHoleDiameter: mmToM(boltHoleDiameter) }
      : {}),
    ...(raisedD !== undefined && raisedH !== undefined
      ? { raisedFaceDiameter: mmToM(raisedD), raisedFaceHeight: mmToM(raisedH) }
      : {}),
  };
}

export interface SizeMm {
  dn: number;
  dn2?: number;
  centerToEnd?: number;
  /** Curvas ponta e bolsa: vértice à porta `b` (ponta). */
  centerToEnd2?: number;
  /** Curvas com trechos retos: raio da linha de centro. */
  bendRadius?: number;
  centerToBranch?: number;
  length?: number;
  height?: number;
  handwheelDiameter?: number;
  width?: number;
  /** Gavetas de castelo retangular: dimensão do castelo ao longo do eixo do tubo. */
  bonnetLength?: number;
  end?: EndMm;
  end2?: EndMm;
}

function size(row: SizeMm): FamilySize {
  const out: FamilySize = { dn: row.dn };
  if (row.dn2 !== undefined) out.dn2 = row.dn2;
  if (row.centerToEnd !== undefined) out.centerToEnd = mmToM(row.centerToEnd);
  if (row.centerToEnd2 !== undefined) out.centerToEnd2 = mmToM(row.centerToEnd2);
  if (row.bendRadius !== undefined) out.bendRadius = mmToM(row.bendRadius);
  if (row.centerToBranch !== undefined) out.centerToBranch = mmToM(row.centerToBranch);
  if (row.length !== undefined) out.length = mmToM(row.length);
  if (row.height !== undefined) out.height = mmToM(row.height);
  if (row.handwheelDiameter !== undefined) out.handwheelDiameter = mmToM(row.handwheelDiameter);
  if (row.width !== undefined) out.width = mmToM(row.width);
  if (row.bonnetLength !== undefined) out.bonnetLength = mmToM(row.bonnetLength);
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
