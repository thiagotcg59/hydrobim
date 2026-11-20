import { connectedPortRef, getElement } from './connectivity';
import { newId } from './ids';
import { putElement, touch } from './internal';
import {
  pumpParametersFromFamily,
  pumpProblem,
  pumpTypeOf,
  unlinkPumpVariant,
  type PumpParameters,
} from './pumps';
import { reconcile } from './reconcile';
import { fail, ok, type Result } from './result';
import {
  PumpFamilySchema,
  type EndTreatment,
  type PipeSpec,
  type Project,
  type Pump,
  type PumpFamily,
} from './schema';

/**
 * Operações específicas de bombas de catálogo e das famílias de bombas personalizadas. São
 * puras, preservam o `id` do elemento e reajustam os tubos conectados.
 */

/**
 * Define a classe de pressão do flange de sucção (`a`) ou de descarga (`b`). O flange
 * (`end`) vem resolvido pelo chamador, da tabela única de flanges, para o diâmetro da boca;
 * `null` = a tabela não traz essa classe para o diâmetro, e a alteração é recusada.
 */
export function setPumpFlange(
  project: Project,
  id: string,
  portId: 'a' | 'b',
  pressureClass: string,
  end: EndTreatment | null,
): Result<Project> {
  const pump = getElement(project, id);
  if (pump?.kind !== 'pump' || pumpTypeOf(pump) === 'generic') {
    return fail('NOT_A_CATALOG_PUMP', 'Elemento não é uma bomba de catálogo.');
  }
  const spec = portId === 'a' ? pump.spec : pump.dischargeSpec;
  if (!end) {
    return fail(
      'FLANGE_NOT_FOUND',
      `A tabela de flanges não traz ${pressureClass} para ${spec.sizeLabel}.`,
    );
  }
  const updated = unlinkPumpVariant({
    ...pump,
    ...(portId === 'a'
      ? { suctionFlangeClass: pressureClass }
      : { dischargeFlangeClass: pressureClass }),
    ends: { ...pump.ends, [portId]: end },
  });
  const problem = pumpProblem(updated);
  if (problem) return fail('INVALID_VALUE', problem);
  return reconcile(putElement(project, touch(updated)), [id]);
}

// ---------------------------------------------------------------------------
// Famílias de bombas personalizadas
// ---------------------------------------------------------------------------

/** Prefixo do identificador das famílias personalizadas (as do catálogo não o usam). */
export const CUSTOM_PUMP_FAMILY_PREFIX = 'custom-pump-';

export const isCustomPumpFamilyId = (id: string | null | undefined): boolean =>
  id?.startsWith(CUSTOM_PUMP_FAMILY_PREFIX) ?? false;

/** Famílias disponíveis: catálogo embutido mais as personalizadas do projeto. */
export function pumpFamiliesOf(project: Project, builtin: readonly PumpFamily[]): PumpFamily[] {
  return [...builtin, ...project.pumpFamilies];
}

/**
 * Resolve uma boca da bomba: a especificação de tubo de mesmo material que `base` no `dn`
 * pedido e o flange da classe `pressureClass` na tabela única. Vem do catálogo (o domínio
 * não o conhece); `undefined` = diâmetro ou flange inexistente.
 */
export type PumpMouthResolver = (
  base: PipeSpec,
  dn: number,
  pressureClass: string,
) => { spec: PipeSpec; end: EndTreatment } | undefined;

/**
 * Duplica uma família (de catálogo ou personalizada) como família personalizada do projeto,
 * com a mesma forma construtiva e a mesma tabela — que passa a ser editável. A cópia deixa
 * de ser dado de fabricante: o fabricante vira "Personalizado" e a fonte registra a origem.
 */
export function duplicatePumpFamily(
  project: Project,
  family: PumpFamily,
): Result<{ project: Project; familyId: string }> {
  const id = `${CUSTOM_PUMP_FAMILY_PREFIX}${newId()}`;
  const copy: PumpFamily = {
    ...family,
    id,
    name: `${family.name} (personalizado)`,
    manufacturer: 'Personalizado',
    origin: 'custom',
    basedOn: family.basedOn ?? family.id,
    source: `Família personalizada neste projeto a partir de "${family.name}"${family.manufacturer ? ` (${family.manufacturer})` : ''}. As cotas da tabela são do usuário, não do fabricante. Origem: ${family.source}`,
    remarks: [],
    variants: family.variants.map((variant) => ({
      ...variant,
      id: `${id}/${variant.id.slice(variant.id.indexOf('/') + 1)}`,
    })),
  };
  const saved = upsertPumpFamily(project, copy);
  return saved.ok ? ok({ project: saved.value, familyId: id }) : saved;
}

/** Problema de uma família personalizada, ou `null` se ela puder ser gravada. */
export function pumpFamilyProblem(family: PumpFamily): string | null {
  const parsed = PumpFamilySchema.safeParse(family);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const row = issue?.path[0] === 'variants' ? Number(issue.path[1]) + 1 : null;
    if (row) {
      return issue?.path[2] === 'models'
        ? `Linha ${row}: informe ao menos um modelo.`
        : `Linha ${row}: valor inválido — informe números positivos (estágios inteiros).`;
    }
    return 'Família inválida: confira o nome e as cotas.';
  }
  if (family.variants.length === 0) return 'A família precisa de ao menos uma linha na tabela.';
  const ids = new Set<string>();
  for (const [index, variant] of family.variants.entries()) {
    if (ids.has(variant.id)) return `Linha ${index + 1}: identificador de linha repetido.`;
    ids.add(variant.id);
    const parameters = pumpParametersFromFamily(family, { variantId: variant.id }, {});
    if (!parameters.ok) return `Linha ${index + 1}: ${parameters.error.message}`;
    // As mesmas regras de coerência da bomba inserida (pés dentro de F, eixo abaixo de J).
    const problem = pumpProblem({ ...parameters.value, pumpType: family.pumpType } as Pump);
    if (problem) return `Linha ${index + 1}: ${problem}`;
  }
  return null;
}

/** Grava (cria ou substitui) uma família personalizada no projeto. */
export function upsertPumpFamily(project: Project, family: PumpFamily): Result<Project> {
  if (family.origin !== 'custom') {
    return fail(
      'PUMP_FAMILY_READONLY',
      'As famílias do catálogo são somente leitura: duplique-a para editar as cotas.',
    );
  }
  const problem = pumpFamilyProblem(family);
  if (problem) return fail('INVALID_VALUE', problem);
  const exists = project.pumpFamilies.some((f) => f.id === family.id);
  return ok({
    ...project,
    pumpFamilies: exists
      ? project.pumpFamilies.map((f) => (f.id === family.id ? family : f))
      : [...project.pumpFamilies, family],
  });
}

/**
 * Aplica parâmetros de família a uma bomba existente (troca de linha da tabela), mantendo
 * identificador, nome, sistema, posição e dados nominais. Recusa quando uma boca conectada
 * mudaria de diâmetro: o tubo ligado a ela deixaria de acoplar.
 */
export function setPumpModel(
  project: Project,
  id: string,
  input: { spec: PipeSpec; dischargeSpec: PipeSpec; parameters: PumpParameters },
): Result<Project> {
  const current = getElement(project, id);
  if (current?.kind !== 'pump') return fail('NOT_A_PUMP', 'Elemento não é uma bomba.');
  for (const [portId, before, after] of [
    ['a', current.spec, input.spec],
    ['b', current.dischargeSpec, input.dischargeSpec],
  ] as const) {
    if (before.dn !== after.dn && connectedPortRef(project, { elementId: id, portId })) {
      return fail(
        'PUMP_PORT_CONNECTED',
        `A boca ${portId === 'a' ? 'A (sucção)' : 'B (descarga)'} passaria de ${before.sizeLabel} para ${after.sizeLabel} e há tubo conectado a ela.`,
      );
    }
  }
  const {
    dischargeOffset: _offset,
    dischargeHeight: _height,
    variantId: _variant,
    ...kept
  } = current;
  const next: Pump = {
    ...kept,
    spec: input.spec,
    dischargeSpec: input.dischargeSpec,
    ...input.parameters,
  };
  const problem = pumpProblem(next);
  if (problem) return fail('INVALID_VALUE', problem);
  return reconcile(putElement(project, touch(next)), [id]);
}

/**
 * Reaplica a tabela da família às bombas do projeto que usam uma de suas linhas. Se a linha
 * foi removida, a bomba mantém as cotas e passa a "cotas preenchidas pelo usuário". Falha
 * inteira se alguma não puder ser ajustada.
 */
export function applyPumpFamilyToInstances(
  project: Project,
  family: PumpFamily,
  resolveMouth: PumpMouthResolver,
): Result<{ project: Project; updated: number }> {
  let next = project;
  let updated = 0;
  for (const element of project.elements) {
    if (element.kind !== 'pump' || element.familyId !== family.id || !element.variantId) continue;
    const variant = family.variants.find((v) => v.id === element.variantId);
    if (!variant) {
      next = putElement(next, touch(unlinkPumpVariant(element)));
      updated += 1;
      continue;
    }
    const suction = resolveMouth(element.spec, variant.suction.dn, variant.suction.pressureClass);
    const discharge = resolveMouth(
      element.spec,
      variant.discharge.dn,
      variant.discharge.pressureClass,
    );
    if (!suction || !discharge) {
      return fail(
        'FLANGE_NOT_FOUND',
        `"${element.name}": a especificação ${element.spec.standard} ou a tabela de flanges não traz as bocas da linha (A DN ${variant.suction.dn} ${variant.suction.pressureClass}, B DN ${variant.discharge.dn} ${variant.discharge.pressureClass}).`,
      );
    }
    const parameters = pumpParametersFromFamily(
      family,
      { variantId: variant.id },
      { a: suction.end, b: discharge.end },
    );
    if (!parameters.ok) return parameters;
    const applied = setPumpModel(next, element.id, {
      spec: suction.spec,
      dischargeSpec: discharge.spec,
      parameters: parameters.value,
    });
    if (!applied.ok) {
      return fail(applied.error.code, `"${element.name}": ${applied.error.message}`);
    }
    next = applied.value;
    updated += 1;
  }
  return ok({ project: next, updated });
}

/**
 * Exclui uma família personalizada. As bombas que a usavam mantêm a forma e as cotas, sem
 * vínculo com família ou linha da tabela.
 */
export function removePumpFamily(project: Project, familyId: string): Result<Project> {
  if (!project.pumpFamilies.some((f) => f.id === familyId)) {
    return fail('PUMP_FAMILY_NOT_FOUND', 'Família de bombas inexistente no projeto.');
  }
  let next: Project = {
    ...project,
    pumpFamilies: project.pumpFamilies.filter((f) => f.id !== familyId),
  };
  for (const element of project.elements) {
    if (element.kind !== 'pump' || element.familyId !== familyId) continue;
    next = putElement(next, touch({ ...unlinkPumpVariant(element), familyId: null }));
  }
  return ok(next);
}
