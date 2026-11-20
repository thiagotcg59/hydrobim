import {
  degToRad,
  mmToM,
  type Discipline,
  type JointType,
  type Material,
  type PipeSpec,
} from '@hydrobim/core';
import { coldBendRadiusM, jointDeflectionDegrees } from './jointDeflection';
import { SPECIFICATIONS, type CatalogSize, type PipeSpecification } from './specifications';

export { BUILTIN_FAMILIES } from './families';
export * from './flanges';
export * from './jointDeflection';
export * from './products';
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
