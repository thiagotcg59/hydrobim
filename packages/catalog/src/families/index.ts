import type { FittingFamily } from '@hydrobim/core';
import { DUCTILE_IRON_FAMILIES } from './ductileIron';
import { PVC_FAMILIES } from './pvc';
import { STEEL_FAMILIES } from './steel';
import { VALVE_FAMILIES } from './valves';

/**
 * Famílias de conexões embutidas, transcritas de catálogos de fabricantes e de tabelas
 * normativas. Cada família registra a fonte em `source`.
 *
 * Sem família embutida (dimensões genéricas): conexões de PEAD e curvas de PVC PBA — as
 * tabelas encontradas tinham significado de colunas ambíguo e não foram usadas.
 */
export const BUILTIN_FAMILIES: readonly FittingFamily[] = [
  ...PVC_FAMILIES,
  ...DUCTILE_IRON_FAMILIES,
  ...VALVE_FAMILIES,
  ...STEEL_FAMILIES,
];
