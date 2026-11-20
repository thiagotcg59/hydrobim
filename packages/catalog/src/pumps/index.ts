import type { PumpFamily } from '@hydrobim/core';
import { HIGRA_PUMP_FAMILIES } from './higra';

/** Famílias de bombas embutidas (catálogos de fabricantes, com fonte). */
export const PUMP_FAMILIES: readonly PumpFamily[] = [...HIGRA_PUMP_FAMILIES];

export function getPumpFamily(id: string | null | undefined): PumpFamily | undefined {
  return id ? PUMP_FAMILIES.find((family) => family.id === id) : undefined;
}
