import {
  degToRad,
  mmToM,
  pumpFlangeLabel,
  pumpParametersFromFamily,
  type Discipline,
  type EndTreatment,
  type FittingInput,
  type PumpFamily,
  type PumpSelection,
  type Result,
  type JointType,
  type Material,
  type PipeSpec,
} from '@hydrobim/core';
import { FLANGE_PRESSURE_CLASSES, flangeEnd, type FlangePressureClass } from './flanges';
import { coldBendRadiusM, jointDeflectionDegrees } from './jointDeflection';
import { SPECIFICATIONS, type CatalogSize, type PipeSpecification } from './specifications';

export { BUILTIN_FAMILIES } from './families';
export * from './flanges';
export * from './jointDeflection';
export * from './products';
export { getPumpFamily, PUMP_FAMILIES } from './pumps';
export { getTankFamily, TANK_FAMILIES } from './tanks';
export { SPECIFICATIONS, type CatalogSize, type PipeSpecification } from './specifications';

export const MATERIAL_LABELS: Record<Material, string> = {
  pvc: 'PVC',
  hdpe: 'PEAD',
  ductileIron: 'Ferro fundido dúctil',
  carbonSteel: 'Aço-carbono',
};

export const JOINT_TYPE_LABELS: Record<JointType, string> = {
  solventWeld: 'Soldável (adesivo)',
  socketSpigot: 'Ponta e bolsa com junta elástica',
  buttFusion: 'Termofusão de topo',
  buttWeld: 'Solda de topo',
  flanged: 'Flangeada',
  threaded: 'Roscada',
};

export function getSpecification(id: string): PipeSpecification | undefined {
  return SPECIFICATIONS.find((s) => s.id === id);
}

/** Especificações oferecidas em um ambiente (MEP/Infra), na ordem de preferência. */
export function listSpecifications(discipline?: Discipline): PipeSpecification[] {
  if (!discipline) return [...SPECIFICATIONS];
  return SPECIFICATIONS.filter((s) => s.disciplines.includes(discipline)).sort(
    (a, b) => a.disciplines.indexOf(discipline) - b.disciplines.indexOf(discipline),
  );
}

function toPipeSpec(specification: PipeSpecification, entry: CatalogSize): PipeSpec {
  const outerDiameter = mmToM(entry.outerDiameterMm);
  const wallThickness = mmToM(entry.wallThicknessMm);
  // DN fora das faixas da fonte fica sem o valor: a junta é tratada como rígida.
  const deflection = jointDeflectionDegrees(specification.jointDeflection, entry.dn);
  const bending = specification.coldBending;
  const bendRadius = coldBendRadiusM(bending, entry.dn, entry.outerDiameterMm);
  return {
    specificationId: specification.id,
    material: specification.material,
    standard: specification.standard,
    jointType: specification.jointType,
    pressureClass: specification.pressureClass,
    dn: entry.dn,
    sizeLabel: entry.label,
    outerDiameter,
    wallThickness,
    innerDiameter: outerDiameter - 2 * wallThickness,
    ...(deflection === undefined ? {} : { jointDeflection: degToRad(deflection) }),
    ...(bendRadius === undefined ? {} : { coldBendRadius: bendRadius }),
    ...(bendRadius === undefined || bending?.barLengthM === undefined
      ? {}
      : { coldBendSpan: bending.barLengthM }),
  };
}

/** Resolve (especificação, DN) em uma especificação dimensional em unidades SI. */
export function resolvePipeSpec(specificationId: string, dn: number): PipeSpec | undefined {
  const specification = getSpecification(specificationId);
  const entry = specification?.sizes.find((s) => s.dn === dn);
  return specification && entry ? toPipeSpec(specification, entry) : undefined;
}

/**
 * Resolve o diâmetro da nova especificação mais próximo de `dn` (usado ao trocar o
 * material mantendo, tanto quanto possível, o diâmetro nominal).
 */
export function resolveNearestPipeSpec(specificationId: string, dn: number): PipeSpec | undefined {
  const specification = getSpecification(specificationId);
  if (!specification) return undefined;
  let best: CatalogSize | undefined;
  for (const entry of specification.sizes) {
    if (!best || Math.abs(entry.dn - dn) < Math.abs(best.dn - dn)) best = entry;
  }
  return best ? toPipeSpec(specification, best) : undefined;
}

/** Especificação padrão de um ambiente (primeira especificação, diâmetro intermediário). */
export function defaultPipeSpec(discipline: Discipline): PipeSpec {
  // Infra: ferro fundido dúctil é o padrão de adutoras e redes principais.
  const preferred =
    discipline === 'infra' ? getSpecification('ferro-ductil-nbr7675-k9') : undefined;
  const specification = preferred ?? listSpecifications(discipline)[0] ?? SPECIFICATIONS[0];
  if (!specification) throw new Error('Catálogo de especificações vazio.');
  const preferredDn = discipline === 'infra' ? 150 : 25;
  const spec = resolveNearestPipeSpec(specification.id, preferredDn);
  if (!spec) throw new Error(`Especificação sem diâmetros: ${specification.id}.`);
  return spec;
}

// ---------------------------------------------------------------------------
// Bombas de catálogo
// ---------------------------------------------------------------------------

/**
 * Flange da tabela única para a classe de pressão (texto, ex.: `PN 40`) e o diâmetro de
 * `spec`. `undefined` quando a classe não existe ou a tabela não traz o diâmetro.
 */
export function flangeForClass(spec: PipeSpec, pressureClass: string): EndTreatment | undefined {
  const known = FLANGE_PRESSURE_CLASSES.find((item) => item === pressureClass);
  return known ? flangeEnd(known as FlangePressureClass, spec.dn) : undefined;
}

/**
 * Boca de uma bomba: a especificação de mesmo material que `base` no `dn` pedido e o flange
 * da classe na tabela única (usada ao reaplicar uma família às bombas do projeto).
 */
export function resolvePumpMouth(
  base: PipeSpec,
  dn: number,
  pressureClass: string,
): { spec: PipeSpec; end: EndTreatment } | undefined {
  const spec = resolvePipeSpec(base.specificationId, dn);
  const end = spec ? flangeForClass(spec, pressureClass) : undefined;
  return spec && end ? { spec, end } : undefined;
}

/** Sucção (especificação da porta `a`) e entrada da operação de inserção de uma bomba. */
export interface PumpPlacement {
  spec: PipeSpec;
  fitting: Extract<FittingInput, { kind: 'pump' }>;
}

/**
 * Resolve uma bomba de catálogo para a inserção. As bocas usam a especificação de tubo
 * ativa (`base`): numa linha da tabela, nos DN das colunas A e B; com cotas preenchidas pelo
 * usuário, no DN de `base` (sucção) e em `dischargeDn` (descarga; ausente = o mesmo). Os
 * flanges vêm da tabela única, na classe de cada boca. Nada é presumido: sem o diâmetro na
 * especificação, ou sem o flange na tabela, a inserção é recusada com o motivo.
 */
export function resolvePumpPlacement(
  family: PumpFamily,
  selection: PumpSelection,
  base: PipeSpec,
  dischargeDn?: number,
): Result<PumpPlacement> {
  const failure = (code: string, message: string): Result<PumpPlacement> => ({
    ok: false,
    error: { code, message },
  });
  const first = family.variants[0];
  const variant =
    'variantId' in selection
      ? family.variants.find((v) => v.id === selection.variantId)
      : undefined;
  if ('variantId' in selection && !variant) {
    return failure('PUMP_VARIANT_NOT_FOUND', 'Modelo inexistente nesta família.');
  }
  const custom = 'custom' in selection ? selection.custom : undefined;
  const suction = {
    dn: variant?.suction.dn ?? base.dn,
    pressureClass:
      variant?.suction.pressureClass ??
      custom?.suctionFlangeClass ??
      first?.suction.pressureClass ??
      'PN 10',
  };
  const discharge = {
    dn: variant?.discharge.dn ?? dischargeDn ?? base.dn,
    pressureClass:
      variant?.discharge.pressureClass ??
      custom?.dischargeFlangeClass ??
      first?.discharge.pressureClass ??
      'PN 10',
  };
  const ends: Record<string, EndTreatment> = {};
  const specs: PipeSpec[] = [];
  for (const [portId, side, flange] of [
    ['a', 'A (sucção)', suction],
    ['b', 'B (descarga)', discharge],
  ] as const) {
    const spec = resolvePipeSpec(base.specificationId, flange.dn);
    if (!spec) {
      return failure(
        'PUMP_NO_PIPE_SIZE',
        `A especificação "${base.standard}" não tem DN ${flange.dn}, o diâmetro da boca ${side} deste modelo. Escolha uma especificação de tubo que tenha esse diâmetro.`,
      );
    }
    const end = flangeForClass(spec, flange.pressureClass);
    if (!end) {
      return failure(
        'FLANGE_NOT_FOUND',
        `A tabela de flanges não traz ${pumpFlangeLabel(flange)} para a boca ${side}.`,
      );
    }
    specs.push(spec);
    ends[portId] = end;
  }
  const [spec, dischargeSpec] = specs;
  if (!spec || !dischargeSpec) return failure('PUMP_NO_PIPE_SIZE', 'Diâmetro não resolvido.');
  const parameters = pumpParametersFromFamily(
    family,
    variant
      ? selection
      : {
          custom: {
            ...custom,
            suctionFlangeClass: suction.pressureClass,
            dischargeFlangeClass: discharge.pressureClass,
          },
        },
    ends,
  );
  if (!parameters.ok) return parameters;
  return {
    ok: true,
    value: { spec, fitting: { kind: 'pump', dischargeSpec, parameters: parameters.value } },
  };
}
