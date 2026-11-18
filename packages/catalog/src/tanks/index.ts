import type { TankFamily } from '@hydrobim/core';
import { TRAMEC_TANK_FAMILIES } from './tramec';

/** Famílias de reservatórios embutidas (catálogos de fabricantes, com fonte). */
export const TANK_FAMILIES: readonly TankFamily[] = [...TRAMEC_TANK_FAMILIES];

export function getTankFamily(id: string | null | undefined): TankFamily | undefined {
  return id ? TANK_FAMILIES.find((family) => family.id === id) : undefined;
}
