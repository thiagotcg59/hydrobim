import {
  defaultBendRadius,
  defaultReducerLength,
  defaultTeeDimensions,
  defaultValveLength,
} from './dimensions';
import type {
  EndTreatment,
  EndType,
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
  /** Trechos retos entre o arco e as portas (curvas ponta e bolsa). */
  straight?: { a: number; b: number };
}
export interface TeeDimensions extends ResolvedBase {
  runLength: number;
  branchLength: number;
}
/** Cruzeta: a mesma leitura do tê, com `branchLength` valendo para as duas derivações. */
export type CrossDimensions = TeeDimensions;
export interface ReducerDimensions extends ResolvedBase {
  length: number;
}
export interface ValveDimensions extends ResolvedBase {
  length: number;
  height?: number;
  handwheelDiameter?: number;
  width?: number;
  bonnetLength?: number;
}

/**
 * `endType`, quando informado, restringe a busca às famílias com esse acabamento nas
 * extremidades: uma porta flangeada só recebe peça flangeada (flange × flange). Sem família
 * com o acabamento pedido, o resultado é genérico (`familyId: null`).
 */
export interface FittingCatalog {
  elbow(
    spec: PipeSpec,
    angle: number,
    preferredFamilyId?: string | null,
    endType?: EndType,
  ): ElbowDimensions;
  tee(
    spec: PipeSpec,
    branchSpec: PipeSpec,
    preferredFamilyId?: string | null,
    endType?: EndType,
  ): TeeDimensions;
  cross(
    spec: PipeSpec,
    branchSpec: PipeSpec,
    preferredFamilyId?: string | null,
    endType?: EndType,
  ): CrossDimensions;
  /**
   * Famílias de `kind` (tê, cruzeta) que atendem a passagem `spec` com a derivação
   * `branchSpec`, na ordem de preferência; com `endType`, só as desse acabamento. Serve para
   * oferecer a escolha da família e para explicar a indisponibilidade.
   */
  junctionFamilies?(
    kind: 'tee' | 'cross',
    spec: PipeSpec,
    branchSpec: PipeSpec,
    endType?: EndType,
  ): readonly FittingFamily[];
  /**
   * Famílias de tubos com flanges da especificação (identificadores), para dar flange à face
   * de um tubo que encosta numa peça flangeada. Ausente = nenhuma.
   */
  flangedPipeFamilies?(specificationId: string): readonly string[];
  /** `a` e `b` são as especificações das portas `a` e `b`, em qualquer ordem de diâmetro. */
  reducer(
    a: PipeSpec,
    b: PipeSpec,
    preferredFamilyId?: string | null,
    endType?: EndType,
  ): ReducerDimensions;
  valve(
    spec: PipeSpec,
    valveType: ValveType,
    preferredFamilyId?: string | null,
    endType?: EndType,
  ): ValveDimensions;
  /**
   * Flange de um tubo da família de tubos flangeados `familyId`, para o diâmetro de `spec`.
   * `undefined` quando a família não atende a especificação ou não tabula o diâmetro.
   * Ausente no catálogo genérico: sem tabela, não há flange a oferecer.
   */
  pipeFlange?(spec: PipeSpec, familyId: string): EndTreatment | undefined;
  /**
   * Flange da classe de pressão `pressureClass` (ex.: `PN 40`) para o diâmetro de `spec`, pela
   * tabela única de flanges. `undefined` quando a tabela não traz a classe ou o diâmetro.
   */
  flange?(spec: PipeSpec, pressureClass: string): EndTreatment | undefined;
}

/** Recursos do catálogo que não são famílias de conexões (tubos com flanges, flanges PN). */
export interface CatalogExtensions {
  pipeFlange?: (spec: PipeSpec, familyId: string) => EndTreatment | undefined;
  flange?: (spec: PipeSpec, pressureClass: string) => EndTreatment | undefined;
  flangedPipeFamilies?: (specificationId: string) => readonly string[];
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
  // Proporções genéricas da cruzeta: as do tê (identificadas por `familyId: null`).
  cross: (spec, branchSpec) => GENERIC_CATALOG.tee(spec, branchSpec),
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
  // A furação só existe em flanges; bolsas e pontas ignoram esses campos.
  const { length, outerDiameter, ...drilling } = end;
  return {
    type: family.endType,
    length,
    outerDiameter,
    ...(family.endType === 'flange' ? drilling : {}),
  };
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
  extensions: CatalogExtensions = {},
): FittingCatalog {
  function candidates(
    kind: FamilyKind,
    spec: PipeSpec,
    preferredId: string | null | undefined,
    endType: EndType | undefined,
    accept: (family: FittingFamily) => boolean,
  ): FittingFamily[] {
    const matching = families.filter(
      (f) =>
        f.kind === kind &&
        f.specificationId === spec.specificationId &&
        (endType === undefined || f.endType === endType) &&
        accept(f),
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

  const junctionSize = (s: FamilySize, spec: PipeSpec, branchSpec: PipeSpec): boolean =>
    s.dn === spec.dn && (s.dn2 ?? s.dn) === branchSpec.dn && s.centerToEnd !== undefined;

  /** Tê e cruzeta: passagem pelo centro, derivação(ões) a `centerToBranch` do centro. */
  function junction(
    kind: 'tee' | 'cross',
    spec: PipeSpec,
    branchSpec: PipeSpec,
    preferredId: string | null | undefined,
    endType: EndType | undefined,
  ): TeeDimensions {
    const hit = find(
      candidates(kind, spec, preferredId, endType, () => true),
      (s) => junctionSize(s, spec, branchSpec),
    );
    if (!hit?.size.centerToEnd) return GENERIC_CATALOG[kind](spec, branchSpec);
    const end = toEnd(hit.family, hit.size.end);
    const branchEnd = toEnd(hit.family, hit.size.end2 ?? hit.size.end);
    return {
      familyId: hit.family.id,
      runLength: 2 * hit.size.centerToEnd,
      branchLength: hit.size.centerToBranch ?? hit.size.centerToEnd,
      ends: buildEnds([
        ['a', end],
        ['b', end],
        ['branch', branchEnd],
        ...(kind === 'cross'
          ? ([['branch2', branchEnd]] as [string, EndTreatment | undefined][])
          : []),
      ]),
    };
  }

  return {
    ...(extensions.pipeFlange ? { pipeFlange: extensions.pipeFlange } : {}),
    ...(extensions.flange ? { flange: extensions.flange } : {}),

    elbow(spec, angle, preferredId, endType) {
      const hit = find(
        candidates('elbow', spec, preferredId, endType, (f) =>
          f.angle === undefined ? false : Math.abs(f.angle - angle) <= ANGLE_MATCH,
        ),
        (s) => s.dn === spec.dn && s.centerToEnd !== undefined,
      );
      if (!hit?.size.centerToEnd) return GENERIC_CATALOG.elbow(spec, angle);
      const end = toEnd(hit.family, hit.size.end);
      const { centerToEnd, centerToEnd2, bendRadius } = hit.size;
      if (bendRadius !== undefined) {
        // Curva com trechos retos: cada porta fica a uma distância própria do vértice e
        // `end` descreve só a porta `a` (ponta e bolsa).
        const leg = bendRadius * Math.tan(angle / 2);
        return {
          familyId: hit.family.id,
          bendRadius,
          straight: {
            a: Math.max(0, centerToEnd - leg),
            b: Math.max(0, (centerToEnd2 ?? centerToEnd) - leg),
          },
          ends: buildEnds([
            ['a', end],
            ['b', toEnd(hit.family, hit.size.end2)],
          ]),
        };
      }
      return {
        familyId: hit.family.id,
        bendRadius: centerToEnd / Math.tan(angle / 2),
        ends: buildEnds([
          ['a', end],
          ['b', end],
        ]),
      };
    },

    tee: (spec, branchSpec, preferredId, endType) =>
      junction('tee', spec, branchSpec, preferredId, endType),
    cross: (spec, branchSpec, preferredId, endType) =>
      junction('cross', spec, branchSpec, preferredId, endType),

    junctionFamilies(kind, spec, branchSpec, endType) {
      return candidates(kind, spec, null, endType, () => true).filter((family) =>
        family.sizes.some((s) => junctionSize(s, spec, branchSpec)),
      );
    },
    ...(extensions.flangedPipeFamilies
      ? { flangedPipeFamilies: extensions.flangedPipeFamilies }
      : {}),

    reducer(a, b, preferredId, endType) {
      const aIsLarge = a.dn >= b.dn;
      const large = aIsLarge ? a : b;
      const small = aIsLarge ? b : a;
      const hit = find(
        candidates('reducer', large, preferredId, endType, () => true),
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

    valve(spec, valveType, preferredId, endType) {
      const hit = find(
        candidates('valve', spec, preferredId, endType, (f) => f.valveType === valveType),
        (s) => s.dn === spec.dn && s.length !== undefined,
      );
      if (!hit?.size.length) return GENERIC_CATALOG.valve(spec, valveType);
      const end = toEnd(hit.family, hit.size.end);
      return {
        familyId: hit.family.id,
        length: hit.size.length,
        height: hit.size.height,
        handwheelDiameter: hit.size.handwheelDiameter,
        width: hit.size.width,
        bonnetLength: hit.size.bonnetLength,
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

/**
 * Acabamento que uma peça ligada às portas `ports` precisa ter: porta flangeada exige peça
 * flangeada (flange × flange, sem presumir adaptador). `undefined` = sem restrição.
 */
export function requiredEndType(
  ...ends: readonly (EndTreatment | null | undefined)[]
): EndType | undefined {
  return ends.some((end) => end?.type === 'flange') ? 'flange' : undefined;
}

/** Une famílias embutidas e as do projeto; as do projeto prevalecem pelo `id`. */
export function mergeFamilies(
  builtin: readonly FittingFamily[],
  overrides: readonly FittingFamily[],
): FittingFamily[] {
  const overridden = new Set(overrides.map((f) => f.id));
  return [...overrides, ...builtin.filter((f) => !overridden.has(f.id))];
}
