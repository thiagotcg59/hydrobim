/**
 * Acesso às linhas cruas do web-ifc (`GetLine` sem achatamento). Os atributos chegam como
 * `{ type, value }`; referências têm `type === 5`; reais trazem `_representationValue`;
 * valores de tipos definidos trazem `name` com o tipo em maiúsculas (ex.: `IFCLABEL`).
 */

export type Raw = Record<string, unknown>;
export type LineReader = (expressId: number) => Raw | null;
export type Scalar = string | number | boolean;

const REF = 5;

export const isRaw = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function refOf(value: unknown): number | null {
  return isRaw(value) && value.type === REF && typeof value.value === 'number' ? value.value : null;
}

export function refsOf(value: unknown): number[] {
  if (Array.isArray(value)) {
    const refs: number[] = [];
    for (const item of value) {
      const ref = refOf(item);
      if (ref !== null) refs.push(ref);
    }
    return refs;
  }
  const single = refOf(value);
  return single === null ? [] : [single];
}

const asScalar = (value: unknown): Scalar | null =>
  typeof value === 'string' || typeof value === 'boolean'
    ? value
    : typeof value === 'number' && Number.isFinite(value)
      ? value
      : null;

export function scalarOf(value: unknown): Scalar | null {
  if (!isRaw(value)) return asScalar(value);
  if (value.type === REF) return null;
  if ('_representationValue' in value) return asScalar(value._representationValue);
  return asScalar(value.value);
}

export function textOf(value: unknown): string | null {
  const scalar = scalarOf(value);
  return typeof scalar === 'string' && scalar.trim() !== '' ? scalar : null;
}

export function numberOf(value: unknown): number | null {
  const scalar = scalarOf(value);
  return typeof scalar === 'number' ? scalar : null;
}

/** Nome do tipo definido do valor, em maiúsculas (ex.: `IFCLENGTHMEASURE`), se houver. */
export function valueTypeOf(value: unknown): string | null {
  return isRaw(value) && typeof value.name === 'string' && value.name !== '' ? value.name : null;
}
