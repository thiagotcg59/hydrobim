import { getSpecification, listSpecifications } from '@hydrobim/catalog';
import type { Discipline, PipeSpec } from '@hydrobim/core';
import { SelectField } from './fields';

interface Props {
  spec: PipeSpec;
  discipline: Discipline;
  onChange: (specificationId: string, dn: number) => void;
  /** Oculta a troca de especificação (ex.: extremidades de uma redução). */
  sizeOnly?: boolean;
  sizeLabel?: string;
  testIdPrefix: string;
}

/** Seleção de especificação (material/norma) e diâmetro a partir do catálogo. */
export function SpecSelector({
  spec,
  discipline,
  onChange,
  sizeOnly,
  sizeLabel = 'Diâmetro',
  testIdPrefix,
}: Props) {
  // Todas as especificações ficam disponíveis; as do ambiente atual aparecem primeiro.
  const preferred = listSpecifications(discipline);
  const others = listSpecifications().filter((s) => !preferred.some((p) => p.id === s.id));
  const specifications = [...preferred, ...others];
  const current = getSpecification(spec.specificationId);
  const sizes = current?.sizes ?? [];

  return (
    <>
      {!sizeOnly && (
        <SelectField
          label="Especificação"
          testId={`${testIdPrefix}-specification`}
          value={spec.specificationId}
          options={
            current
              ? specifications.map((s) => ({ value: s.id, label: s.name }))
              : [
                  { value: spec.specificationId, label: `${spec.standard} (fora do catálogo)` },
                  ...specifications.map((s) => ({ value: s.id, label: s.name })),
                ]
          }
          onChange={(id) => onChange(id, spec.dn)}
        />
      )}
      <SelectField
        label={sizeLabel}
        testId={`${testIdPrefix}-dn`}
        value={String(spec.dn)}
        options={
          sizes.length > 0
            ? sizes.map((s) => ({ value: String(s.dn), label: s.label }))
            : [{ value: String(spec.dn), label: spec.sizeLabel }]
        }
        onChange={(dn) => onChange(spec.specificationId, Number(dn))}
      />
    </>
  );
}
