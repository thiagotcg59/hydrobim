import { resolvePipeSpec } from '@hydrobim/catalog';
import {
  buildFitting,
  createFamilyCatalog,
  type FamilySize,
  type Fitting,
  type FittingFamily,
  type FittingInput,
  type Project,
} from '@hydrobim/core';

export type FamilyPreview = { ok: true; element: Fitting } | { ok: false; reason: string };

const unavailable = (reason: string): FamilyPreview => ({ ok: false, reason });

/**
 * Monta, na origem, a peça que uma linha da família produz — a mesma operação de domínio
 * usada na inserção (`buildFitting`), com um catálogo restrito a essa linha. O elemento
 * serve apenas à pré-visualização: não é inserido no projeto.
 */
export function buildFamilyPreview(
  project: Project,
  family: FittingFamily,
  size: FamilySize,
): FamilyPreview {
  const spec = resolvePipeSpec(family.specificationId, size.dn);
  if (!spec) return unavailable(`O DN ${size.dn} não existe na especificação de tubo.`);

  let input: FittingInput;
  switch (family.kind) {
    case 'elbow':
      if (family.angle === undefined) return unavailable('A família não tem ângulo definido.');
      input = { kind: 'elbow', angle: family.angle, familyId: family.id };
      break;
    case 'tee': {
      const branchSpec = resolvePipeSpec(family.specificationId, size.dn2 ?? size.dn);
      if (!branchSpec) {
        return unavailable(`O DN ${size.dn2} da derivação não existe na especificação de tubo.`);
      }
      input = { kind: 'tee', branchSpec, familyId: family.id };
      break;
    }
    case 'reducer': {
      if (size.dn2 === undefined) return unavailable('Informe o DN menor da redução.');
      const outletSpec = resolvePipeSpec(family.specificationId, size.dn2);
      if (!outletSpec) {
        return unavailable(`O DN ${size.dn2} não existe na especificação de tubo.`);
      }
      input = { kind: 'reducer', outletSpec, familyId: family.id };
      break;
    }
    case 'valve':
      if (family.valveType === undefined) {
        return unavailable('A família não tem tipo de válvula definido.');
      }
      input = { kind: 'valve', valveType: family.valveType, familyId: family.id };
      break;
  }

  // Apenas esta linha no catálogo: linhas repetidas do mesmo DN não se confundem.
  const catalog = createFamilyCatalog([{ ...family, sizes: [size] }]);
  const built = buildFitting(project, input, spec, project.systems[0]?.id ?? '', catalog);
  if (!built.ok) return unavailable(built.error.message);
  // Sem as dimensões obrigatórias o domínio recorre a proporções genéricas, que não
  // representam a família — nesse caso não há modelo a mostrar.
  if (built.value.familyId !== family.id) {
    return unavailable('Preencha as dimensões desta linha para gerar o modelo.');
  }
  return { ok: true, element: built.value };
}
