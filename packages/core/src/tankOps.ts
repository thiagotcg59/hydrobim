import { getElement, isPortFree } from './connectivity';
import { newId } from './ids';
import { putElement, touch } from './internal';
import { reconcile } from './reconcile';
import { fail, ok, type Result } from './result';
import {
  TankFamilySchema,
  type PipeSpec,
  type Project,
  type Tank,
  type TankAccessories,
  type TankFamily,
  type TankNozzle,
  type TankNozzleRole,
  type TankSupportType,
} from './schema';
import {
  estimateTankShape,
  tankLayout,
  tankParametersFromFamily,
  tankProblem,
  tankTypeOf,
  type TankParameters,
} from './tanks';

/**
 * Operações específicas de reservatórios: troca de modelo comercial, configuração (apoio,
 * células, acessórios, espessura, nível máximo) e bocais adicionais. Todas são puras,
 * preservam o `id` do elemento e reajustam os tubos conectados.
 */

function findTank(project: Project, id: string): Result<Tank> {
  const element = getElement(project, id);
  return element?.kind === 'tank'
    ? ok(element)
    : fail('NOT_A_TANK', 'Elemento não é um reservatório.');
}

function commit(project: Project, tank: Tank): Result<Project> {
  const problem = tankProblem(tank);
  if (problem) return fail('INVALID_VALUE', problem);
  return reconcile(putElement(project, touch(tank)), [tank.id]);
}

/**
 * Aplica outro modelo (ou dimensões personalizadas) a um reservatório existente. Bocais
 * adicionais, espessura, células e propriedades são mantidos; as alturas da entrada e da
 * saída só são trocadas pelas da nova forma quando deixam de caber no costado.
 */
export function setTankModel(
  project: Project,
  id: string,
  parameters: TankParameters,
): Result<Project> {
  const found = findTank(project, id);
  if (!found.ok) return found;
  const current = found.value;
  const next: Tank = {
    id: current.id,
    name: current.name,
    systemId: current.systemId,
    spec: current.spec,
    properties: current.properties,
    meta: current.meta,
    kind: 'tank',
    placement: current.placement,
    ends: current.ends,
    ...parameters,
    manufacturing: { ...current.manufacturing, ...parameters.manufacturing },
    ...(current.shellThickness !== undefined ? { shellThickness: current.shellThickness } : {}),
    ...(current.compartments !== undefined ? { compartments: current.compartments } : {}),
    ...(current.nozzles ? { nozzles: current.nozzles } : {}),
    // Os acessórios configurados valem enquanto a forma construtiva for a mesma.
    ...(current.accessories && tankTypeOf(current) === parameters.tankType
      ? { accessories: current.accessories }
      : {}),
  };
  const layout = tankLayout(next);
  const fits = (height: number): boolean =>
    height >= layout.shellBottom - 1e-9 && height <= layout.top + 1e-9;
  const sameShape = tankTypeOf(current) === tankTypeOf(next);
  const kept: Tank = {
    ...next,
    ...(sameShape && fits(current.outletHeight) ? { outletHeight: current.outletHeight } : {}),
    ...(sameShape && fits(current.inletHeight) ? { inletHeight: current.inletHeight } : {}),
    ...(current.maxWaterLevel !== undefined && current.maxWaterLevel <= layout.top
      ? { maxWaterLevel: current.maxWaterLevel }
      : {}),
  };
  return commit(project, kept);
}

export interface TankSettingsPatch {
  /** Horizontal: tipo de apoio (recalcula a altura do apoio e a altura total). */
  supportType?: TankSupportType;
  compartments?: number;
  accessories?: Partial<TankAccessories>;
  /** `null` remove o valor informado. */
  shellThickness?: number | null;
  maxWaterLevel?: number | null;
}

/** Altera a configuração do reservatório que não é uma dimensão de catálogo. */
export function updateTankSettings(
  project: Project,
  id: string,
  patch: TankSettingsPatch,
): Result<Project> {
  const found = findTank(project, id);
  if (!found.ok) return found;
  let tank = found.value;
  const type = tankTypeOf(tank);
  if (type === 'generic') {
    return fail(
      'INVALID_FIELD',
      'O reservatório genérico não tem essa configuração; escolha uma família de catálogo.',
    );
  }

  if (patch.supportType !== undefined) {
    if (type !== 'horizontal') {
      return fail('INVALID_FIELD', 'O tipo de apoio só se aplica ao reservatório horizontal.');
    }
    const { supportHeight = 0 } = estimateTankShape({
      type,
      diameter: tank.diameter,
      height: tank.height,
      supportType: patch.supportType,
    });
    // Os bocais acompanham o corpo, que sobe ou desce com o apoio.
    const shift = supportHeight - (tank.supportHeight ?? 0);
    tank = {
      ...tank,
      supportType: patch.supportType,
      supportHeight,
      height: supportHeight + tank.diameter,
      outletHeight: tank.outletHeight + shift,
      inletHeight: tank.inletHeight + shift,
      ...(tank.nozzles
        ? { nozzles: tank.nozzles.map((n) => ({ ...n, height: n.height + shift })) }
        : {}),
    };
  }
  if (patch.compartments !== undefined) {
    if (!Number.isInteger(patch.compartments) || patch.compartments < 1) {
      return fail('INVALID_VALUE', 'A quantidade de células deve ser um número inteiro positivo.');
    }
    tank = { ...tank, compartments: patch.compartments };
  }
  for (const key of ['shellThickness', 'maxWaterLevel'] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null) {
      const { [key]: _removed, ...rest } = tank;
      tank = rest as Tank;
    } else if (!Number.isFinite(value) || value <= 0) {
      return fail('INVALID_VALUE', 'Valor inválido: informe um número positivo.');
    } else {
      tank = { ...tank, [key]: value };
    }
  }
  if (patch.accessories) {
    if (!tank.accessories) return fail('INVALID_FIELD', 'Este reservatório não tem acessórios.');
    const accessories = { ...tank.accessories, ...patch.accessories };
    if (!Number.isFinite(accessories.ladderAzimuth) || !(accessories.guardrailHeight > 0)) {
      return fail('INVALID_VALUE', 'Posição da escada ou altura do guarda-corpo inválida.');
    }
    tank = { ...tank, accessories };
  }
  return commit(project, tank);
}

export interface TankNozzleInput {
  role: TankNozzleRole;
  /** Altura do eixo acima da base (m). */
  height: number;
  /** Direção em planta a partir do eixo X local (rad). */
  azimuth: number;
  /** Especificação do tubo que o bocal recebe — sempre informada, nunca presumida. */
  spec: PipeSpec;
}

const validNozzle = (nozzle: Pick<TankNozzle, 'height' | 'azimuth'>): boolean =>
  Number.isFinite(nozzle.height) && nozzle.height >= 0 && Number.isFinite(nozzle.azimuth);

/** Acrescenta um bocal (porta) ao reservatório. */
export function addTankNozzle(
  project: Project,
  id: string,
  input: TankNozzleInput,
): Result<{ project: Project; portId: string }> {
  const found = findTank(project, id);
  if (!found.ok) return found;
  if (!validNozzle(input)) return fail('INVALID_VALUE', 'Altura ou direção do bocal inválida.');
  const nozzle: TankNozzle = { id: newId(), ...input };
  const next = commit(project, {
    ...found.value,
    nozzles: [...(found.value.nozzles ?? []), nozzle],
  });
  return next.ok ? ok({ project: next.value, portId: nozzle.id }) : next;
}

/** Altera função, posição ou diâmetro de um bocal adicional. */
export function updateTankNozzle(
  project: Project,
  id: string,
  nozzleId: string,
  patch: Partial<TankNozzleInput>,
): Result<Project> {
  const found = findTank(project, id);
  if (!found.ok) return found;
  const current = found.value.nozzles?.find((n) => n.id === nozzleId);
  if (!current) return fail('PORT_NOT_FOUND', 'Bocal inexistente.');
  const updated: TankNozzle = { ...current, ...patch };
  if (!validNozzle(updated)) return fail('INVALID_VALUE', 'Altura ou direção do bocal inválida.');
  if (
    patch.spec &&
    patch.spec !== current.spec &&
    !isPortFree(project, { elementId: id, portId: nozzleId })
  ) {
    return fail(
      'PORT_OCCUPIED',
      'O bocal está conectado: desconecte-o antes de alterar o diâmetro.',
    );
  }
  return commit(project, {
    ...found.value,
    nozzles: (found.value.nozzles ?? []).map((n) => (n.id === nozzleId ? updated : n)),
  });
}

/** Remove um bocal adicional (que precisa estar livre). */
export function removeTankNozzle(project: Project, id: string, nozzleId: string): Result<Project> {
  const found = findTank(project, id);
  if (!found.ok) return found;
  if (!found.value.nozzles?.some((n) => n.id === nozzleId)) {
    return fail('PORT_NOT_FOUND', 'Bocal inexistente.');
  }
  if (!isPortFree(project, { elementId: id, portId: nozzleId })) {
    return fail('PORT_OCCUPIED', 'O bocal está conectado: desconecte-o antes de removê-lo.');
  }
  return commit(project, {
    ...found.value,
    nozzles: found.value.nozzles.filter((n) => n.id !== nozzleId),
  });
}

// ---------------------------------------------------------------------------
// Famílias de reservatórios personalizadas no projeto
// ---------------------------------------------------------------------------

/** Famílias disponíveis: catálogo embutido mais as personalizadas do projeto. */
export function tankFamiliesOf(project: Project, builtin: readonly TankFamily[]): TankFamily[] {
  return [...builtin, ...project.tankFamilies];
}

/**
 * Duplica uma família (de catálogo ou personalizada) como família personalizada do projeto,
 * com a mesma forma construtiva e a mesma tabela — que passa a ser editável. A cópia deixa
 * de ser dado de fabricante: o fabricante vira "Personalizado" e a fonte registra a origem.
 */
export function duplicateTankFamily(
  project: Project,
  family: TankFamily,
): Result<{ project: Project; familyId: string }> {
  const id = `custom-tank-${newId()}`;
  const copy: TankFamily = {
    ...family,
    id,
    name: `${family.name} (personalizado)`,
    manufacturer: 'Personalizado',
    origin: 'custom',
    basedOn: family.basedOn ?? family.id,
    source: `Família personalizada neste projeto a partir de "${family.name}"${family.manufacturer ? ` (${family.manufacturer})` : ''}. As dimensões da tabela são do usuário, não do fabricante. Origem: ${family.source}`,
    remarks: [],
    variants: family.variants.map((variant) => {
      const { mark: _mark, ...rest } = variant;
      return { ...rest, id: `${id}/${variant.id.slice(variant.id.indexOf('/') + 1)}` };
    }),
  };
  const saved = upsertTankFamily(project, copy);
  return saved.ok ? ok({ project: saved.value, familyId: id }) : saved;
}

/** Problema de uma família personalizada, ou `null` se ela puder ser gravada. */
export function tankFamilyProblem(family: TankFamily): string | null {
  const parsed = TankFamilySchema.safeParse(family);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const row = issue?.path[0] === 'variants' ? Number(issue.path[1]) + 1 : null;
    return row
      ? `Linha ${row}: valor inválido — informe números positivos.`
      : 'Família inválida: confira o nome e as dimensões.';
  }
  const ids = new Set<string>();
  for (const [index, variant] of family.variants.entries()) {
    if (ids.has(variant.id)) return `Linha ${index + 1}: identificador de modelo repetido.`;
    ids.add(variant.id);
    const parameters = tankParametersFromFamily(family, { variantId: variant.id });
    if (!parameters.ok) return `Linha ${index + 1}: ${parameters.error.message}`;
  }
  const initial = tankParametersFromFamily(family, { custom: {} });
  return initial.ok ? null : `Dimensões iniciais: ${initial.error.message}`;
}

/** Grava (cria ou substitui) uma família personalizada no projeto. */
export function upsertTankFamily(project: Project, family: TankFamily): Result<Project> {
  if (family.origin !== 'custom') {
    return fail(
      'TANK_FAMILY_READONLY',
      'As famílias do catálogo são somente leitura: duplique-a para editar as dimensões.',
    );
  }
  const problem = tankFamilyProblem(family);
  if (problem) return fail('INVALID_VALUE', problem);
  const exists = project.tankFamilies.some((f) => f.id === family.id);
  return ok({
    ...project,
    tankFamilies: exists
      ? project.tankFamilies.map((f) => (f.id === family.id ? family : f))
      : [...project.tankFamilies, family],
  });
}

/**
 * Reaplica a tabela da família aos reservatórios do projeto que usam um de seus modelos.
 * Se a linha do modelo foi removida, o reservatório mantém as dimensões e passa a
 * "dimensões personalizadas". Falha inteira se algum não puder ser ajustado.
 */
export function applyTankFamilyToInstances(
  project: Project,
  family: TankFamily,
): Result<{ project: Project; updated: number }> {
  let next = project;
  let updated = 0;
  for (const element of project.elements) {
    if (element.kind !== 'tank' || element.familyId !== family.id || !element.variantId) continue;
    if (!family.variants.some((v) => v.id === element.variantId)) {
      const { variantId: _removed, ...rest } = element;
      next = putElement(next, touch(rest));
      updated += 1;
      continue;
    }
    const parameters = tankParametersFromFamily(family, { variantId: element.variantId });
    if (!parameters.ok) return parameters;
    const applied = setTankModel(next, element.id, parameters.value);
    if (!applied.ok) {
      return fail(applied.error.code, `"${element.name}": ${applied.error.message}`);
    }
    next = applied.value;
    updated += 1;
  }
  return ok({ project: next, updated });
}

/**
 * Exclui uma família personalizada. Os reservatórios que a usavam mantêm forma e dimensões,
 * sem vínculo com família ou modelo.
 */
export function removeTankFamily(project: Project, familyId: string): Result<Project> {
  if (!project.tankFamilies.some((f) => f.id === familyId)) {
    return fail('TANK_FAMILY_NOT_FOUND', 'Família de reservatórios inexistente no projeto.');
  }
  let next: Project = {
    ...project,
    tankFamilies: project.tankFamilies.filter((f) => f.id !== familyId),
  };
  for (const element of project.elements) {
    if (element.kind !== 'tank' || element.familyId !== familyId) continue;
    const { variantId: _removed, ...rest } = element;
    next = putElement(next, touch({ ...rest, familyId: null }));
  }
  return ok(next);
}
