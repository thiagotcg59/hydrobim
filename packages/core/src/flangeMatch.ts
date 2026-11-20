import type { FittingCatalog } from './families';
import { fail, ok, type Result } from './result';
import type { EndTreatment, Pipe, PipeSpec } from './schema';
import { formatMillimeters } from './units';

/**
 * Acoplamento de flanges. Dois flanges só se aparafusam quando a furação é a mesma (círculo,
 * número e diâmetro dos furos): é o que define o padrão e a classe na prática. Sem a furação
 * tabulada nos dois lados, a compatibilidade não pode ser confirmada e a ligação é recusada.
 */

/** Tolerância (m) ao comparar cotas de flanges vindas de tabelas diferentes. */
const FLANGE_TOLERANCE = 0.5e-3;

const close = (a: number | undefined, b: number | undefined): boolean =>
  a !== undefined && b !== undefined && Math.abs(a - b) <= FLANGE_TOLERANCE;

/** Os dois flanges se aparafusam (mesma furação)? */
export function flangesMate(a: EndTreatment, b: EndTreatment): boolean {
  if (a.type !== 'flange' || b.type !== 'flange') return false;
  return (
    close(a.boltCircle, b.boltCircle) &&
    a.boltCount !== undefined &&
    a.boltCount === b.boltCount &&
    close(a.boltHoleDiameter, b.boltHoleDiameter)
  );
}

/** Descrição curta da furação, para as mensagens: "8 furos Ø 19 mm em Ø 180 mm". */
export function describeDrilling(end: EndTreatment): string {
  if (end.boltCircle === undefined || end.boltCount === undefined) return 'furação não tabulada';
  const hole =
    end.boltHoleDiameter === undefined ? '' : ` Ø ${formatMillimeters(end.boltHoleDiameter)}`;
  return `${end.boltCount} furos${hole} em Ø ${formatMillimeters(end.boltCircle)}`;
}

/** Flange dado à face de um tubo, com a família de tubos flangeados que o fornece. */
export interface PipeFlange {
  readonly end: EndTreatment;
  readonly familyId: string;
}

/**
 * Família de tubos com flanges cujo flange casa com todos os de `mates` (as duas faces de um
 * tubo novo flange e flange). Recusa com o motivo quando nenhuma serve.
 */
export function newPipeFlange(
  catalog: FittingCatalog,
  spec: PipeSpec,
  mates: readonly EndTreatment[],
): Result<PipeFlange> {
  const [first, ...others] = mates;
  if (!first) return fail('NO_PIPE_FLANGE', 'Nenhum flange pedido.');
  const found = pipeFlangeFor(catalog, { spec, familyId: null, name: 'Tubo novo' }, first);
  if (!found.ok) return found;
  for (const mate of others) {
    if (!flangesMate(found.value.end, mate)) {
      return fail(
        'FLANGE_MISMATCH',
        `As duas faces do tubo exigem flanges de furações diferentes (${describeDrilling(first)} × ${describeDrilling(mate)}): é necessária peça de transição.`,
      );
    }
  }
  return found;
}

/**
 * Flange para a face de um tubo que encosta em `mate` (flange de uma peça ou equipamento):
 *  - tubo com flanges: o da sua própria família, que precisa casar com `mate`;
 *  - tubo de ponta lisa: o de uma família de tubos com flanges da especificação que case.
 * Recusa quando não há família, a tabela não traz o DN ou a furação difere — dividir ou
 * prolongar um tubo não cria flange onde o catálogo não o fornece.
 */
export function pipeFlangeFor(
  catalog: FittingCatalog,
  pipe: Pick<Pipe, 'spec' | 'familyId' | 'name'> & { ends?: Pipe['ends'] },
  mate: EndTreatment,
): Result<PipeFlange> {
  const spec: PipeSpec = pipe.spec;
  const flanged = pipe.ends && Object.values(pipe.ends).some((end) => end.type === 'flange');
  if (flanged && pipe.familyId) {
    const own = catalog.pipeFlange?.(spec, pipe.familyId);
    if (own && flangesMate(own, mate)) return ok({ end: own, familyId: pipe.familyId });
    return fail(
      'FLANGE_MISMATCH',
      own
        ? `O flange de "${pipe.name}" (${describeDrilling(own)}) não casa com o da peça (${describeDrilling(mate)}): classes ou padrões de flange diferentes exigem peça de transição.`
        : `A família de "${pipe.name}" não traz flange para ${spec.sizeLabel}.`,
    );
  }
  const families = catalog.flangedPipeFamilies?.(spec.specificationId) ?? [];
  for (const familyId of families) {
    const end = catalog.pipeFlange?.(spec, familyId);
    if (end && flangesMate(end, mate)) return ok({ end, familyId });
  }
  return fail(
    'NO_PIPE_FLANGE',
    families.length === 0
      ? `A peça é flangeada e ${spec.standard} não tem tubo com flanges no catálogo: a face do tubo é ponta lisa e não se liga a flange sem uma peça de transição.`
      : `Nenhuma família de tubos com flanges de ${spec.standard} tem, em ${spec.sizeLabel}, flange com a furação da peça (${describeDrilling(mate)}).`,
  );
}
