import { getElement } from './connectivity';
import { requiredEndType, type FittingCatalog } from './families';
import { elementKindLabel, putElement } from './internal';
import { updateFitting } from './operations';
import { fail, ok, type Result } from './result';
import type { HydroElement, Project } from './schema';
import { formatDegrees } from './units';

/**
 * Política "somente peças de catálogo": joelhos, tês, reduções e válvulas só entram no
 * modelo com as dimensões de uma família (`familyId`). Uma peça de dimensões genéricas não
 * corresponde a produto fabricado e, com a política ativa, a operação que a criaria é
 * recusada. Bombas e o reservatório genérico são equipamentos e ficam fora da política.
 */

const CATALOG_KINDS: ReadonlySet<string> = new Set(['elbow', 'tee', 'cross', 'reducer', 'valve']);

/**
 * Conexões que a passagem de `before` para `after` deixaria fora de catálogo: as criadas
 * com dimensões genéricas e as que eram de catálogo e perderiam o vínculo com a família.
 * Peças que já eram genéricas (projetos antigos, política desligada) não são apontadas.
 */
export function offCatalogFittings(before: Project, after: Project): HydroElement[] {
  if (before === after) return [];
  const previous = new Map(before.elements.map((element) => [element.id, element]));
  return after.elements.filter((element) => {
    if (!CATALOG_KINDS.has(element.kind) || element.familyId !== null) return false;
    const old = previous.get(element.id);
    return !old || old.familyId !== null;
  });
}

/** Mensagem da violação da política, ou `null` quando a alteração só usa peças de catálogo. */
export function catalogViolation(before: Project, after: Project): string | null {
  const [first, ...others] = offCatalogFittings(before, after);
  if (!first) return null;
  const more = others.length > 0 ? ` (e outras ${others.length} peça(s))` : '';
  const piece = elementKindLabel(first.kind).toLowerCase();
  if (getElement(before, first.id)) {
    return `"${first.name}" deixaria de corresponder à peça de catálogo${more}: com "Somente peças de catálogo" ativo, as dimensões das conexões não podem sair do catálogo.`;
  }
  return `Não há ${piece} de catálogo para ${first.spec.standard}, ${first.spec.sizeLabel}${more}: a operação criaria uma peça de dimensões genéricas e foi recusada.`;
}

/**
 * Troca o ângulo de um joelho por outro ângulo de catálogo, assumindo as dimensões e o
 * vínculo da família correspondente (o identificador do elemento é preservado).
 */
export function setElbowCatalogAngle(
  project: Project,
  id: string,
  angle: number,
  catalog: FittingCatalog,
  preferredFamilyId?: string | null,
): Result<Project> {
  const element = getElement(project, id);
  if (!element || element.kind !== 'elbow') {
    return fail('NOT_AN_ELBOW', 'Elemento não é um joelho.');
  }
  const dims = catalog.elbow(
    element.spec,
    angle,
    preferredFamilyId,
    // Joelho flangeado continua flangeado com o novo ângulo.
    requiredEndType(...Object.values(element.ends)),
  );
  if (dims.familyId === null) {
    return fail(
      'NO_CATALOG_ELBOW',
      `Não há joelho de ${formatDegrees(angle, 2)} no catálogo para ${element.spec.standard}, ${element.spec.sizeLabel}.`,
    );
  }
  const updated = updateFitting(project, id, { angle, bendRadius: dims.bendRadius });
  if (!updated.ok) return updated;
  const current = getElement(updated.value, id);
  if (!current || current.kind !== 'elbow') return updated;
  const { straight: _previous, ...rest } = current;
  return ok(
    putElement(updated.value, {
      ...rest,
      familyId: dims.familyId,
      ends: dims.ends,
      ...(dims.straight ? { straight: dims.straight } : {}),
    }),
  );
}
