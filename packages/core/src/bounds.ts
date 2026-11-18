import type { Vec3 } from './math';
import { getPorts } from './ports';
import type { HydroElement } from './schema';

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** Caixa envolvente aproximada (portas e origem, expandidas pelo diâmetro externo). */
export function computeBounds(elements: readonly HydroElement[]): Bounds | null {
  let min: [number, number, number] = [Infinity, Infinity, Infinity];
  let max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const include = (p: Vec3, pad: number): void => {
    min = [Math.min(min[0], p.x - pad), Math.min(min[1], p.y - pad), Math.min(min[2], p.z - pad)];
    max = [Math.max(max[0], p.x + pad), Math.max(max[1], p.y + pad), Math.max(max[2], p.z + pad)];
  };
  for (const element of elements) {
    const pad = element.spec.outerDiameter;
    for (const port of getPorts(element)) include(port.position, pad);
    if (element.kind !== 'pipe') include(element.placement.position, pad);
  }
  if (!Number.isFinite(min[0])) return null;
  return {
    min: { x: min[0], y: min[1], z: min[2] },
    max: { x: max[0], y: max[1], z: max[2] },
  };
}
