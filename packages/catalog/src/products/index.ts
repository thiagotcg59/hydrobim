import type { ProductFamily } from './types';
import { WAVIN_PBA_PRODUCTS } from './wavinPba';

export * from './types';
export {
  PBA_INJECTED_SOCKET_DEPTH_MM,
  PBA_JERI_MM,
  PBA_PIPE_MM,
  PBA_SADDLE_OUTLET_MM,
  pbaBendGeometryMm,
} from './wavinPba';

/** Biblioteca de produtos embutida (modelos 3D de catálogo). */
export const PRODUCT_FAMILIES: readonly ProductFamily[] = [...WAVIN_PBA_PRODUCTS];
