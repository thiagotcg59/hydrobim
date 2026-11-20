import { fail, ok, type Result } from './result';
import type {
  EndTreatment,
  Manufacturing,
  Pump,
  PumpDimensions,
  PumpFamily,
  PumpFlangeRef,
  PumpType,
  PumpVariant,
} from './schema';

/**
 * Bombas: forma construtiva, famílias de catálogo e o que é DERIVADO dos parâmetros.
 *
 * Bomba anfíbia — referencial local: a porta `a` (sucção, flange A) fica na origem, voltada
 * para −X; a porta `b` (descarga, flange B) fica em x = F, voltada para +X. O eixo da bomba é
 * o X local; a base dos pés fica em z = −I e o topo, em z = J − I.
 */

export const PUMP_TYPE_LABELS: Record<PumpType, string> = {
  generic: 'Conjunto motobomba genérico',
  amphibious: 'Bomba anfíbia',
};

export const pumpTypeOf = (pump: Pick<Pump, 'pumpType'>): PumpType => pump.pumpType ?? 'generic';

/** Cotas do dimensional do fabricante, na ordem das colunas da tabela. */
export const PUMP_DIMENSION_KEYS = [
  'footOffset',
  'footSpan',
  'rearLength',
  'length',
  'footWidth',
  'footHoleDiameter',
  'axisHeight',
  'totalHeight',
] as const satisfies readonly (keyof PumpDimensions)[];
export type PumpDimensionKey = (typeof PUMP_DIMENSION_KEYS)[number];

/**
 * Letra de cada cota no dimensional do fabricante e o que ela mede. A interface mostra a
 * letra, para o usuário saber qual coluna do catálogo transcrever.
 */
export const PUMP_DIMENSION_LABELS: Record<
  PumpDimensionKey,
  { letter: string; description: string }
> = {
  footOffset: { letter: 'C', description: 'face do flange B ao 1º par de pés' },
  footSpan: { letter: 'D', description: 'entre os dois pares de pés' },
  rearLength: { letter: 'E', description: '2º par de pés à face do flange A' },
  length: { letter: 'F', description: 'comprimento total, de face a face dos flanges' },
  footWidth: { letter: 'G', description: 'entre os furos dos pés (transversal)' },
  footHoleDiameter: { letter: 'ØH', description: 'diâmetro dos furos dos pés' },
  axisHeight: { letter: 'I', description: 'da base dos pés ao eixo' },
  totalHeight: { letter: 'J', description: 'altura total, da base ao topo' },
};

/** Faixa de modelos da linha: "R1-195/15B a R1-195/30B". */
export function pumpModelRange(variant: Pick<PumpVariant, 'models'>): string {
  const first = variant.models[0] ?? '';
  const last = variant.models[variant.models.length - 1] ?? first;
  return first === last ? first : `${first} a ${last}`;
}

const mm = (meters: number): string => String(Math.round(meters * 10000) / 10);

export const pumpFlangeLabel = (flange: PumpFlangeRef): string =>
  `DN ${flange.dn} ${flange.pressureClass}`;

export function pumpVariantLabel(variant: PumpVariant): string {
  return `${pumpModelRange(variant)} · ${variant.frame} · A ${pumpFlangeLabel(variant.suction)} · B ${pumpFlangeLabel(variant.discharge)} · F ${mm(variant.dimensions.length)} mm`;
}

/**
 * Diferença entre a cota F e a soma C + D + E (m). O catálogo traz linhas em que as duas não
 * conferem; o modelo usa F para as portas e C e D para os pés, e E fica só registrada.
 */
export const pumpLengthMismatch = (dimensions: PumpDimensions): number =>
  dimensions.length - (dimensions.footOffset + dimensions.footSpan + dimensions.rearLength);

/** Parâmetros de bomba prontos para a operação de inserção. */
export type PumpParameters = Pick<
  Pump,
  | 'pumpType'
  | 'variantId'
  | 'stages'
  | 'suctionFlangeClass'
  | 'dischargeFlangeClass'
  | PumpDimensionKey
> & {
  familyId: string | null;
  manufacturing: Manufacturing;
  ends: Record<string, EndTreatment>;
};

/** Cotas e flanges preenchidos pelo usuário (o que faltar parte da 1ª linha da família). */
export interface PumpCustomInput {
  dimensions?: Partial<PumpDimensions>;
  stages?: number;
  suctionFlangeClass?: string;
  dischargeFlangeClass?: string;
}

export type PumpSelection = { variantId: string } | { custom: PumpCustomInput };

/** Texto do modelo de uma bomba cujas cotas não são mais as de uma linha da tabela. */
export const pumpCustomModel = (familyName: string): string =>
  `${familyName} (cotas preenchidas pelo usuário)`;

/**
 * Desfaz o vínculo com a linha da tabela (cota, flange ou diâmetro alterado): a forma da
 * família permanece e o modelo passa a indicar que as cotas são do usuário.
 */
export function unlinkPumpVariant(pump: Pump): Pump {
  if (pump.variantId === undefined) return pump;
  const { variantId: _variant, ...rest } = pump;
  const family = (rest.manufacturing.model ?? '').split(' — ')[0] ?? '';
  return {
    ...rest,
    manufacturing: {
      ...rest.manufacturing,
      model: pumpCustomModel(family || PUMP_TYPE_LABELS[pumpTypeOf(rest)]),
    },
  };
}

/** Devolve a mensagem do primeiro problema dos parâmetros, ou `null` se forem coerentes. */
export function pumpProblem(pump: Pump): string | null {
  if (pumpTypeOf(pump) === 'generic') {
    return pump.dischargeOffset === undefined || pump.dischargeHeight === undefined
      ? 'A bomba genérica exige a posição do recalque (distância da sucção e altura).'
      : null;
  }
  const missing = PUMP_DIMENSION_KEYS.filter((key) => pump[key] === undefined);
  if (missing.length > 0) {
    return `Bomba anfíbia sem a(s) cota(s) ${missing.map((key) => PUMP_DIMENSION_LABELS[key].letter).join(', ')}.`;
  }
  const { footOffset = 0, footSpan = 0, axisHeight = 0, totalHeight = 0 } = pump;
  if (footOffset + footSpan >= pump.length) {
    return 'As cotas C e D (posição dos pés) devem caber dentro do comprimento total F.';
  }
  if (axisHeight >= totalHeight) {
    return 'A altura total J deve ser maior que a altura do eixo I.';
  }
  return null;
}

/**
 * Monta os parâmetros de uma bomba da família: de uma linha da tabela ou de cotas
 * preenchidas pelo usuário. Os flanges (`ends`) vêm resolvidos pelo chamador, a partir da
 * tabela única de flanges — o domínio não conhece o catálogo.
 */
export function pumpParametersFromFamily(
  family: PumpFamily,
  selection: PumpSelection,
  ends: Record<string, EndTreatment>,
): Result<PumpParameters> {
  const first = family.variants[0];
  let variant: PumpVariant | undefined;
  let dimensions: PumpDimensions;
  let stages: number;
  let classes: { a: string; b: string };
  if ('variantId' in selection) {
    variant = family.variants.find((v) => v.id === selection.variantId);
    if (!variant) return fail('PUMP_VARIANT_NOT_FOUND', 'Modelo inexistente nesta família.');
    dimensions = variant.dimensions;
    stages = variant.stages;
    classes = { a: variant.suction.pressureClass, b: variant.discharge.pressureClass };
  } else {
    if (!first) return fail('PUMP_FAMILY_EMPTY', 'A família não tem linhas na tabela.');
    const custom = selection.custom;
    dimensions = { ...first.dimensions, ...custom.dimensions };
    stages = custom.stages ?? first.stages;
    classes = {
      a: custom.suctionFlangeClass ?? first.suction.pressureClass,
      b: custom.dischargeFlangeClass ?? first.discharge.pressureClass,
    };
  }
  if (Object.values(dimensions).some((v) => !(Number.isFinite(v) && v > 0))) {
    return fail('INVALID_VALUE', 'Cotas da bomba inválidas: informe números positivos.');
  }
  if (!Number.isInteger(stages) || stages < 1) {
    return fail('INVALID_VALUE', 'Número de estágios inválido.');
  }
  return ok({
    familyId: family.id,
    manufacturing: {
      manufacturer: family.manufacturer,
      model: variant ? `${family.name} — ${pumpModelRange(variant)}` : pumpCustomModel(family.name),
    },
    pumpType: family.pumpType,
    ...(variant ? { variantId: variant.id } : {}),
    stages,
    suctionFlangeClass: classes.a,
    dischargeFlangeClass: classes.b,
    ...dimensions,
    ends,
  });
}

/**
 * Cotas características da bomba anfíbia no referencial local (derivadas, nunca
 * persistidas). `null` para a bomba genérica ou com cotas faltando.
 */
export interface AmphibiousLayout {
  /** Posição, no eixo X, dos pares de pés do lado da sucção e do lado da descarga. */
  readonly rearFootX: number;
  readonly frontFootX: number;
  /** Cota Z da base dos pés e do topo (negativa e positiva, em relação ao eixo). */
  readonly baseZ: number;
  readonly topZ: number;
  readonly footHalfWidth: number;
}

export function amphibiousLayout(pump: Pump): AmphibiousLayout | null {
  if (pumpTypeOf(pump) !== 'amphibious' || pumpProblem(pump)) return null;
  const { footOffset = 0, footSpan = 0, footWidth = 0, axisHeight = 0, totalHeight = 0 } = pump;
  // Os pés são posicionados a partir da face do flange B (cotas C e D), como no desenho.
  const frontFootX = pump.length - footOffset;
  return {
    frontFootX,
    rearFootX: frontFootX - footSpan,
    baseZ: -axisHeight,
    topZ: totalHeight - axisHeight,
    footHalfWidth: footWidth / 2,
  };
}
