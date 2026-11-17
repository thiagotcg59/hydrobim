import {
  defaultBendRadius,
  defaultReducerLength,
  defaultTeeDimensions,
  defaultValveLength,
} from './dimensions';
import type {
  EndTreatment,
  FamilyEnd,
  FamilyKind,
  FamilySize,
  FittingFamily,
  PipeSpec,
  ValveType,
} from './schema';
import { degToRad } from './units';

/**
 * Resolução das dimensões de conexões. As operações de domínio não conhecem o catálogo:
 * recebem um `FittingCatalog`, que devolve as dimensões de uma família (quando existir
 * para a especificação e o diâmetro pedidos) ou proporções genéricas identificadas por
 * `familyId: null`.
 */

export type Ends = Record<string, EndTreatment>;

interface ResolvedBase {
  /** Família de origem; `null` quando as dimensões são genéricas (fora de catálogo). */
  familyId: string | null;
  ends: Ends;
}
export interface ElbowDimensions extends ResolvedBase {
  bendRadius: number;
}
export interface TeeDimensions extends ResolvedBase {
  runLength: number;
  branchLength: number;
}
export interface ReducerDimensions extends ResolvedBase {
  length: number;
}
export interface ValveDimensions extends ResolvedBase {
  length: number;
  height?: number;
  handwheelDiameter?: number;
}

export interface FittingCatalog {
  elbow(spec: PipeSpec, angle: number, preferredFamilyId?: string | null): ElbowDimensions;
  tee(spec: PipeSpec, branchSpec: PipeSpec, preferredFamilyId?: string | null): TeeDimensions;
  /** `a` e `b` são as especificações das portas `a` e `b`, em qualquer ordem de diâmetro. */
  reducer(a: PipeSpec, b: PipeSpec, preferredFamilyId?: string | null): ReducerDimensions;
  valve(spec: PipeSpec, valveType: ValveType, preferredFamilyId?: string | null): ValveDimensions;
}

/** Proporções genéricas em função do diâmetro externo (não representam produtos reais). */
export const GENERIC_CATALOG: FittingCatalog = {
  elbow: (spec) => ({ familyId: null, ends: {}, bendRadius: defaultBendRadius(spec) }),
  tee: (spec, branchSpec) => {
    const dims = defaultTeeDimensions(spec);
    return {
      familyId: null,
      ends: {},
      runLength: Math.max(dims.runLength, 3 * branchSpec.outerDiameter),
      branchLength: dims.branchLength,
    };
  },
  reducer: (a, b) => ({ familyId: null, ends: {}, length: defaultReducerLength(a, b) }),
  valve: (spec, valveType) => ({
    familyId: null,
    ends: {},
    length: valveType === 'airRelease' ? 3 * spec.outerDiameter : defaultValveLength(spec),
  }),
};

const ANGLE_MATCH = degToRad(0.5);

function toEnd(family: FittingFamily, end: FamilyEnd | undefined): EndTreatment | undefined {
  if (!end || family.endType === 'plain') return undefined;
  return { type: family.endType, length: end.length, outerDiameter: end.outerDiameter };
}

function buildEnds(entries: [string, EndTreatment | undefined][]): Ends {
  const ends: Ends = {};
  for (const [port, end] of entries) if (end) ends[port] = end;
  return ends;
}

/**
 * Catálogo baseado em famílias. `preferred` indica a família preferida por tipo (escolha
 * do usuário); sem preferência válida, usa-se a primeira família compatível.
 */
export function createFamilyCatalog(
  families: readonly FittingFamily[],
  preferred: Partial<Record<FamilyKind, string | null>> = {},
): FittingCatalog {
  function candidates(
    kind: FamilyKind,
    spec: PipeSpec,
    preferredId: string | null | undefined,
    accept: (family: FittingFamily) => boolean,
  ): FittingFamily[] {
    const matching = families.filter(
      (f) => f.kind === kind && f.specificationId === spec.specificationId && accept(f),
    );
    const wanted = preferredId ?? preferred[kind];
    // A família preferida vem primeiro; as demais servem de alternativa para o diâmetro.
    return matching.sort((a, b) => Number(b.id === wanted) - Number(a.id === wanted));
  }

  function find(
    list: FittingFamily[],
    match: (size: FamilySize) => boolean,
  ): { family: FittingFamily; size: FamilySize } | undefined {
    for (const family of list) {
      const size = family.sizes.find(match);
      if (size) return { family, size };
    }
    return undefined;
  }

  return {
    elbow(spec, angle, preferredId) {
      const hit = find(
        candidates('elbow', spec, preferredId, (f) =>
          f.angle === undefined ? false : Math.abs(f.angle - angle) <= ANGLE_MATCH,
        ),
        (s) => s.dn === spec.dn && s.centerToEnd !== undefined,
      );
      if (!hit?.size.centerToEnd) return GENERIC_CATALOG.elbow(spec, angle);
      const end = toEnd(hit.family, hit.size.end);
      return {
        familyId: hit.family.id,
        bendRadius: hit.size.centerToEnd / Math.tan(angle / 2),
        ends: buildEnds([
          ['a', end],
          ['b', end],
        ]),
      };
    },

    tee(spec, branchSpec, preferredId) {
      const hit = find(
        candidates('tee', spec, preferredId, () => true),
        (s) => s.dn === spec.dn && (s.dn2 ?? s.dn) === branchSpec.dn && s.centerToEnd !== undefined,
      );
      if (!hit?.size.centerToEnd) return GENERIC_CATALOG.tee(spec, branchSpec);
      const end = toEnd(hit.family, hit.size.end);
      return {
        familyId: hit.family.id,
        runLength: 2 * hit.size.centerToEnd,
        branchLength: hit.size.centerToBranch ?? hit.size.centerToEnd,
        ends: buildEnds([
          ['a', end],
          ['b', end],
          ['branch', toEnd(hit.family, hit.size.end2 ?? hit.size.end)],
        ]),
      };
    },

    reducer(a, b, preferredId) {
      const aIsLarge = a.dn >= b.dn;
      const large = aIsLarge ? a : b;
      const small = aIsLarge ? b : a;
      const hit = find(
        candidates('reducer', large, preferredId, () => true),
        (s) => s.dn === large.dn && s.dn2 === small.dn && s.length !== undefined,
      );
      if (!hit?.size.length) return GENERIC_CATALOG.reducer(a, b);
      const largeEnd = toEnd(hit.family, hit.size.end);
      const smallEnd = toEnd(hit.family, hit.size.end2);
      return {
        familyId: hit.family.id,
        length: hit.size.length,
        ends: buildEnds([
          ['a', aIsLarge ? largeEnd : smallEnd],
          ['b', aIsLarge ? smallEnd : largeEnd],
        ]),
      };
    },

    valve(spec, valveType, preferredId) {
      const hit = find(
        candidates('valve', spec, preferredId, (f) => f.valveType === valveType),
        (s) => s.dn === spec.dn && s.length !== undefined,
      );
      if (!hit?.size.length) return GENERIC_CATALOG.valve(spec, valveType);
      const end = toEnd(hit.family, hit.size.end);
      return {
        familyId: hit.family.id,
        length: hit.size.length,
        height: hit.size.height,
        handwheelDiameter: hit.size.handwheelDiameter,
        ends: buildEnds(
          valveType === 'airRelease'
            ? [['a', end]]
            : [
                ['a', end],
                ['b', end],
              ],
        ),
      };
    },
  };
}

/** Une famílias embutidas e as do projeto; as do projeto prevalecem pelo `id`. */
export function mergeFamilies(
  builtin: readonly FittingFamily[],
  overrides: readonly FittingFamily[],
): FittingFamily[] {
  const overridden = new Set(overrides.map((f) => f.id));
  return [...overrides, ...builtin.filter((f) => !overridden.has(f.id))];
}
