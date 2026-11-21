import { findConnection, isPortFree, resolvePort } from './connectivity';
import { requiredEndType, type FittingCatalog } from './families';
import { attachFitting, endMismatch } from './operations';
import { fail, ok, type Result } from './result';
import type { PortRef, Project } from './schema';
import { formatMeters } from './units';

export interface ConnectionReductionInput {
  from: PortRef;
  to: PortRef;
  catalog?: FittingCatalog;
}

export interface ConnectionReduction {
  readonly project: Project;
  /** Porta livre da redução, com o diâmetro do destino. */
  readonly from: PortRef;
  readonly createdIds: readonly string[];
  readonly summary: string;
  /** A própria redução pode preencher exatamente o espaço entre as portas. */
  readonly connects: boolean;
}

/**
 * Prepara a mudança de DN antes de traçar a ligação. A redução é sempre de catálogo:
 * escolher uma transição automática não autoriza presumir material, pressão ou dimensões.
 * Nenhum elemento existente é deslocado ou redimensionado.
 */
export function prepareConnectionReduction(
  project: Project,
  input: ConnectionReductionInput,
): Result<ConnectionReduction> {
  if (input.from.elementId === input.to.elementId) {
    return fail('SAME_ELEMENT', 'Escolha portas de dois elementos diferentes.');
  }
  const from = resolvePort(project, input.from);
  const to = resolvePort(project, input.to);
  if (!from || !to) return fail('PORT_NOT_FOUND', 'Porta de conexão inexistente.');
  if (!isPortFree(project, input.from) || !isPortFree(project, input.to)) {
    return fail('PORT_OCCUPIED', 'Uma das portas já está ligada.');
  }
  if (
    from.spec.specificationId !== to.spec.specificationId ||
    from.spec.material !== to.spec.material ||
    from.spec.standard !== to.spec.standard ||
    from.spec.jointType !== to.spec.jointType ||
    from.spec.pressureClass !== to.spec.pressureClass
  ) {
    return fail(
      'SPEC_MISMATCH',
      'A redução automática exige a mesma especificação, material, norma, junta e classe de pressão nas duas extremidades. Use uma peça de transição apropriada.',
    );
  }
  if (from.spec.dn === to.spec.dn) {
    return fail('REDUCER_SAME_DN', 'A redução deve ter dois diâmetros nominais diferentes.');
  }
  const dims = input.catalog?.reducer(from.spec, to.spec, undefined, requiredEndType(from.end));
  if (!dims?.familyId) {
    return fail(
      'NO_CATALOG_REDUCER',
      `Não há redução de catálogo compatível entre ${from.spec.sizeLabel} e ${to.spec.sizeLabel}. Insira uma redução apropriada antes de fechar.`,
    );
  }
  const mismatch = endMismatch(from.end, dims.ends['a'] ?? null);
  if (mismatch) return fail('END_MISMATCH', mismatch);
  const attached = attachFitting(project, {
    target: input.from,
    fitting: { kind: 'reducer', outletSpec: to.spec, familyId: dims.familyId },
    catalog: input.catalog,
  });
  if (!attached.ok) return attached;
  const outlet = { elementId: attached.value.elementId, portId: 'b' };
  const connection = findConnection(attached.value.project, outlet);
  const connects =
    connection !== undefined &&
    [connection.a, connection.b].some(
      (ref) => ref.elementId === input.to.elementId && ref.portId === input.to.portId,
    );
  if (connection && !connects) {
    return fail(
      'REDUCER_OUTLET_OCCUPIED',
      'A saída da redução coincide com outra porta da rede; escolha outra extremidade para traçar.',
    );
  }
  if (connects) {
    const targetMismatch = endMismatch(dims.ends['b'] ?? null, to.end);
    if (targetMismatch) return fail('END_MISMATCH', targetMismatch);
  }
  return ok({
    project: attached.value.project,
    from: outlet,
    createdIds: attached.value.createdIds,
    summary: `redução ${from.spec.sizeLabel} → ${to.spec.sizeLabel} de catálogo (${formatMeters(dims.length, 3)})`,
    connects,
  });
}
