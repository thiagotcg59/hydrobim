import type { FittingFamily } from '@hydrobim/core';
import { BERMAD_FAMILIES } from './bermad';
import { DUCTILE_IRON_FAMILIES } from './ductileIron';
import { EURO_20_FAMILIES } from './euro20';
import { PVC_FAMILIES } from './pvc';
import { SPIRAX_SARCO_FAMILIES } from './spiraxSarco';
import { STEEL_FAMILIES } from './steel';
import { VALVE_FAMILIES } from './valves';

/**
 * Famílias de conexões embutidas, transcritas de catálogos de fabricantes e de tabelas
 * normativas. Cada família registra a fonte em `source`.
 *
 * Sem família embutida (dimensões genéricas): conexões de PEAD. As curvas de PVC PBA têm
 * família, com o raio derivado por hipótese declarada na fonte (docs/CATALOGS.md).
 */
export const BUILTIN_FAMILIES: readonly FittingFamily[] = [
  ...PVC_FAMILIES,
  ...DUCTILE_IRON_FAMILIES,
  ...VALVE_FAMILIES,
  ...EURO_20_FAMILIES,
  ...BERMAD_FAMILIES,
  ...SPIRAX_SARCO_FAMILIES,
  ...STEEL_FAMILIES,
];
