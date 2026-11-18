import { vec3, type Vec3 } from './math';
import { fail, ok, type Result } from './result';
import type {
  Manufacturing,
  PipeSpec,
  Tank,
  TankAccessories,
  TankFamily,
  TankNozzleRole,
  TankSupportType,
  TankType,
  TankVariant,
} from './schema';

/**
 * Reservatórios: forma construtiva, famílias de catálogo e tudo o que é DERIVADO dos
 * parâmetros (cotas características, volume, bocais, origem de cada parâmetro).
 *
 * Referencial local: base na cota z = 0, eixo vertical em Z. Nos reservatórios verticais o
 * eixo do corpo é o Z local; no horizontal, o eixo do cilindro é o X local.
 */

export const TANK_TYPE_LABELS: Record<TankType, string> = {
  generic: 'Reservatório cilíndrico genérico',
  gobletWet: 'Reservatório tipo taça com água na coluna',
  gobletDry: 'Reservatório tipo taça sem água na coluna',
  tubular: 'Reservatório tubular alto',
  australian: 'Reservatório tipo australiano',
  verticalGround: 'Reservatório vertical apoiado',
  verticalConeLegs: 'Reservatório vertical de fundo cônico com pés',
  fieldErected: 'Reservatório vertical apoiado montado na obra',
  horizontal: 'Reservatório cilíndrico horizontal',
};

export const TANK_NOZZLE_ROLE_LABELS: Record<TankNozzleRole, string> = {
  inlet: 'Entrada',
  outlet: 'Saída',
  overflow: 'Extravasor',
  drain: 'Descarga',
};

export const tankTypeOf = (tank: Pick<Tank, 'tankType'>): TankType => tank.tankType ?? 'generic';

// ---------------------------------------------------------------------------
// Proporções de REPRESENTAÇÃO (não tabuladas pelos catálogos)
// ---------------------------------------------------------------------------

/** Tampo abaulado do reservatório horizontal: profundidade em relação ao diâmetro. */
export const TANK_HEAD_DEPTH_RATIO = 0.12;
/** Espessura de chapa usada só no desenho quando o usuário não informa a espessura. */
export const TANK_DISPLAY_THICKNESS = 0.006;
/** Taça: diâmetro da coluna em relação ao da taça (lido das imagens do catálogo). */
const GOBLET_COLUMN_RATIO = 0.5;
const GOBLET_COLUMN_MIN = 0.6;
/** Taça: altura da transição cônica em relação ao diâmetro da taça. */
const GOBLET_CONE_RATIO = 0.2;
/** Fundo cônico em relação à altura dos pés (o vértice não toca o piso). */
const CONE_TO_SUPPORT_RATIO = 0.8;
const AUSTRALIAN_SUPPORT = 0.35;
const SKID_HEIGHT = 0.15;
const GUARDRAIL_HEIGHT = 1.1;
const NOZZLE_LENGTH = 0.15;

const frustumVolume = (height: number, r1: number, r2: number): number =>
  (Math.PI * height * (r1 * r1 + r1 * r2 + r2 * r2)) / 3;

// ---------------------------------------------------------------------------
// Cotas características
// ---------------------------------------------------------------------------

export interface TankLayout {
  readonly type: TankType;
  /** Raio do corpo (m). */
  readonly radius: number;
  /** Cota do topo do costado acima da base (altura total, sem o guarda-corpo). */
  readonly top: number;
  /** Cota mais baixa em que há costado para receber um bocal. */
  readonly shellBottom: number;
  /** Cota do fundo do volume de água. */
  readonly waterBottom: number;
  /** Altura dos pés/longarina (0 quando apoiado diretamente). */
  readonly support: number;
  /** Taça: raio e altura da coluna; altura da transição. Fundo cônico: altura do cone. */
  readonly columnRadius: number;
  readonly columnHeight: number;
  readonly coneHeight: number;
  /** Horizontal: comprimento total e profundidade de cada tampo. */
  readonly length: number;
  readonly headDepth: number;
}

/** Cotas características derivadas dos parâmetros (nunca persistidas). */
export function tankLayout(tank: Tank): TankLayout {
  const type = tankTypeOf(tank);
  const radius = tank.diameter / 2;
  const support = tank.supportHeight ?? 0;
  const cone = tank.coneHeight ?? 0;
  const base = {
    type,
    radius,
    top: tank.height,
    shellBottom: 0,
    waterBottom: 0,
    support: 0,
    columnRadius: 0,
    columnHeight: 0,
    coneHeight: 0,
    length: 0,
    headDepth: 0,
  };
  switch (type) {
    case 'gobletWet':
    case 'gobletDry': {
      const columnHeight = tank.columnHeight ?? 0;
      return {
        ...base,
        columnRadius: (tank.columnDiameter ?? tank.diameter) / 2,
        columnHeight,
        coneHeight: cone,
        waterBottom: type === 'gobletDry' ? columnHeight : 0,
      };
    }
    case 'verticalConeLegs':
      return {
        ...base,
        support,
        coneHeight: cone,
        shellBottom: support,
        waterBottom: support - cone,
      };
    case 'australian':
      return {
        ...base,
        support,
        coneHeight: cone,
        top: support + tank.height,
        shellBottom: support,
        waterBottom: support - cone,
      };
    case 'horizontal':
      return {
        ...base,
        support,
        top: support + tank.diameter,
        shellBottom: support,
        waterBottom: support,
        length: tank.length ?? 0,
        headDepth: tank.diameter * TANK_HEAD_DEPTH_RATIO,
      };
    default:
      return base;
  }
}

/** Raio externo do corpo de um reservatório vertical na cota `z`. */
export function tankRadiusAt(layout: TankLayout, z: number): number {
  if (layout.type === 'gobletWet' || layout.type === 'gobletDry') {
    const { columnHeight, coneHeight, columnRadius, radius } = layout;
    if (z <= columnHeight) return columnRadius;
    if (z >= columnHeight + coneHeight) return radius;
    return columnRadius + ((radius - columnRadius) * (z - columnHeight)) / coneHeight;
  }
  return layout.radius;
}

/**
 * Distância do eixo vertical central à superfície do reservatório, na cota `z` e na
 * direção `azimuth` (é onde nasce um bocal).
 */
export function tankSurfaceReach(tank: Tank, z: number, azimuth: number): number {
  const layout = tankLayout(tank);
  if (layout.type !== 'horizontal') return tankRadiusAt(layout, z);
  const dz = z - (layout.support + layout.radius);
  const halfWidth = Math.sqrt(Math.max(layout.radius ** 2 - dz ** 2, 0));
  const c = Math.abs(Math.cos(azimuth));
  const s = Math.abs(Math.sin(azimuth));
  const alongAxis = c > 1e-9 ? layout.length / 2 / c : Infinity;
  const across = s > 1e-9 ? halfWidth / s : Infinity;
  return Math.min(alongAxis, across);
}

/**
 * Volume geométrico (m³) pelas dimensões externas, sem descontar chapas nem borda livre.
 * Serve para conferir a capacidade nominal — não a substitui.
 */
export function tankGeometricVolume(tank: Tank): number {
  const l = tankLayout(tank);
  const area = Math.PI * l.radius ** 2;
  switch (l.type) {
    case 'gobletWet':
    case 'gobletDry': {
      const bowl = area * Math.max(l.top - l.columnHeight - l.coneHeight, 0);
      const cone = frustumVolume(l.coneHeight, l.columnRadius, l.radius);
      const column = l.type === 'gobletWet' ? Math.PI * l.columnRadius ** 2 * l.columnHeight : 0;
      return bowl + cone + column;
    }
    case 'verticalConeLegs':
    case 'australian':
      return area * (l.top - l.support) + (area * l.coneHeight) / 3;
    case 'horizontal':
      // Corpo cilíndrico mais dois tampos semielipsoidais.
      return area * (l.length - 2 * l.headDepth) + 2 * ((2 / 3) * area * l.headDepth);
    default:
      return area * l.top;
  }
}

/**
 * Reservatório equivalente para o EPANET: cota do fundo do volume de água (acima da base),
 * nível máximo acima desse fundo e diâmetro. `approximate` indica que a seção não é
 * constante e o diâmetro é o do cilindro de mesmo volume e mesma altura.
 */
export function tankHydraulics(tank: Tank): {
  bottom: number;
  maxLevel: number;
  diameter: number;
  approximate: boolean;
} {
  const l = tankLayout(tank);
  const bottom = Math.max(l.waterBottom, 0);
  const waterTop = Math.min(tank.maxWaterLevel ?? l.top, l.top);
  const maxLevel = Math.max(waterTop - bottom, 0);
  const prismatic =
    l.type === 'generic' ||
    l.type === 'tubular' ||
    l.type === 'verticalGround' ||
    l.type === 'fieldErected';
  if (prismatic || maxLevel <= 0) {
    return { bottom, maxLevel, diameter: tank.diameter, approximate: false };
  }
  const full = Math.max(l.top - bottom, 1e-9);
  const diameter = Math.sqrt((4 * tankGeometricVolume(tank)) / (Math.PI * full));
  return { bottom, maxLevel, diameter, approximate: true };
}

// ---------------------------------------------------------------------------
// Bocais (portas)
// ---------------------------------------------------------------------------

export interface TankNozzlePort {
  readonly id: string;
  readonly label: string;
  readonly role: TankNozzleRole;
  readonly position: Vec3;
  readonly direction: Vec3;
  readonly spec: PipeSpec;
  /** Altura acima da base e direção em planta (rad). */
  readonly height: number;
  readonly azimuth: number;
}

/** Bocais do reservatório no referencial local: saída `a` (+X), entrada `b` (−X) e extras. */
export function tankNozzlePorts(tank: Tank): TankNozzlePort[] {
  const make = (
    id: string,
    label: string,
    role: TankNozzleRole,
    height: number,
    azimuth: number,
    spec: PipeSpec,
  ): TankNozzlePort => {
    const reach = tankSurfaceReach(tank, height, azimuth) + tank.nozzleLength;
    // Em 0 e π o seno/cosseno exatos evitam resíduos de ponto flutuante nas portas.
    const cos = azimuth === 0 ? 1 : azimuth === Math.PI ? -1 : Math.cos(azimuth);
    const sin = azimuth === 0 || azimuth === Math.PI ? 0 : Math.sin(azimuth);
    return {
      id,
      label,
      role,
      position: vec3(cos * reach, sin * reach, height),
      direction: vec3(cos, sin, 0),
      spec,
      height,
      azimuth,
    };
  };
  const counts = new Map<TankNozzleRole, number>();
  return [
    make('a', 'Saída', 'outlet', tank.outletHeight, 0, tank.spec),
    make('b', 'Entrada', 'inlet', tank.inletHeight, Math.PI, tank.spec),
    ...(tank.nozzles ?? []).map((nozzle) => {
      const n = (counts.get(nozzle.role) ?? 0) + 1;
      counts.set(nozzle.role, n);
      const base = TANK_NOZZLE_ROLE_LABELS[nozzle.role];
      // Entrada e saída adicionais são numeradas a partir de 2 (a 1ª é a porta `a`/`b`).
      const number = nozzle.role === 'inlet' || nozzle.role === 'outlet' ? n + 1 : n;
      const label = number > 1 ? `${base} ${number}` : base;
      return make(nozzle.id, label, nozzle.role, nozzle.height, nozzle.azimuth, nozzle.spec);
    }),
  ];
}

// ---------------------------------------------------------------------------
// Verificação dos parâmetros
// ---------------------------------------------------------------------------

/** Devolve a mensagem do primeiro problema dos parâmetros, ou `null` se forem coerentes. */
export function tankProblem(tank: Tank): string | null {
  const type = tankTypeOf(tank);
  const l = tankLayout(tank);
  if (type === 'gobletWet' || type === 'gobletDry') {
    if (!tank.columnHeight || !tank.columnDiameter || !tank.coneHeight) {
      return 'Reservatório tipo taça exige altura e diâmetro da coluna e altura da transição cônica.';
    }
    if (tank.columnDiameter >= tank.diameter) {
      return 'O diâmetro da coluna deve ser menor que o diâmetro da taça.';
    }
    if (tank.columnHeight + tank.coneHeight >= tank.height) {
      return 'A coluna e a transição cônica devem caber abaixo da altura total, deixando altura para a taça.';
    }
  }
  if (type === 'verticalConeLegs' || type === 'australian') {
    if (!tank.supportHeight || !tank.coneHeight) {
      return 'Reservatório de fundo cônico exige a altura dos pés e a altura do cone.';
    }
    if (tank.coneHeight > tank.supportHeight) {
      return 'O fundo cônico não pode ser mais alto que os pés de apoio.';
    }
    if (type === 'verticalConeLegs' && tank.supportHeight >= tank.height) {
      return 'A altura dos pés deve ser menor que a altura total.';
    }
  }
  if (type === 'horizontal') {
    if (!tank.length || tank.supportHeight === undefined || !tank.supportType) {
      return 'Reservatório horizontal exige comprimento, tipo e altura do apoio.';
    }
    if (tank.length <= 2 * l.headDepth + 1e-9) {
      return 'O comprimento do reservatório horizontal deve ser maior que os dois tampos.';
    }
    if (Math.abs(tank.height - (tank.supportHeight + tank.diameter)) > 1e-6) {
      return 'No reservatório horizontal, a altura total é a soma do apoio com o diâmetro.';
    }
  }
  const ids = new Set<string>(['a', 'b']);
  for (const nozzle of tank.nozzles ?? []) {
    if (ids.has(nozzle.id)) return 'Há bocais com identificador repetido.';
    ids.add(nozzle.id);
  }
  const heights = [
    tank.outletHeight,
    tank.inletHeight,
    ...(tank.nozzles ?? []).map((n) => n.height),
  ];
  if (heights.some((h) => h < l.shellBottom - 1e-9 || h > l.top + 1e-9)) {
    return type === 'generic'
      ? 'Os bocais devem ficar dentro da altura do reservatório.'
      : `Os bocais devem ficar no costado, entre ${l.shellBottom.toLocaleString('pt-BR')} m e ${l.top.toLocaleString('pt-BR')} m acima da base.`;
  }
  if (tank.maxWaterLevel !== undefined && tank.maxWaterLevel > l.top + 1e-9) {
    return 'O nível máximo de água não pode ficar acima do topo do reservatório.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Famílias de catálogo
// ---------------------------------------------------------------------------

export const tankVariantLabel = (variant: TankVariant): string => {
  const fmt = (v: number): string => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const column =
    variant.columnHeight === undefined ? '' : ` · coluna ${fmt(variant.columnHeight)} m`;
  return `${variant.capacityL.toLocaleString('pt-BR')}${variant.mark ?? ''} L · ${fmt(variant.height)} m · Ø ${fmt(variant.diameter)} m${column}`;
};

/** Parâmetros de reservatório prontos para a operação de inserção ou de troca de modelo. */
export type TankParameters = Pick<
  Tank,
  | 'diameter'
  | 'height'
  | 'outletHeight'
  | 'inletHeight'
  | 'nozzleLength'
  | 'tankType'
  | 'variantId'
  | 'nominalCapacity'
  | 'columnHeight'
  | 'columnDiameter'
  | 'coneHeight'
  | 'supportHeight'
  | 'supportType'
  | 'length'
  | 'accessories'
> & { familyId: string | null; manufacturing: Manufacturing };

/** Dimensões personalizadas (o usuário responde por elas). */
export interface TankCustomDimensions {
  /** Capacidade nominal (litros). */
  capacityL?: number;
  diameter?: number;
  height?: number;
  columnHeight?: number;
  length?: number;
  supportType?: TankSupportType;
}

export type TankSelection = { variantId: string } | { custom: TankCustomDimensions };

interface ShapeInput {
  type: TankType;
  diameter: number;
  height: number;
  capacity?: number;
  columnHeight?: number;
  supportType?: TankSupportType;
  catalogSupportHeight?: number;
}

/**
 * Parâmetros de forma que os catálogos não tabulam, ESTIMADOS para a representação a partir
 * das dimensões principais. Devolve só os que se aplicam ao tipo.
 */
export function estimateTankShape(input: ShapeInput): {
  columnDiameter?: number;
  columnHeight?: number;
  coneHeight?: number;
  supportHeight?: number;
} {
  const { type, diameter, height } = input;
  switch (type) {
    case 'gobletWet':
    case 'gobletDry': {
      const columnDiameter = Math.min(
        Math.max(diameter * GOBLET_COLUMN_RATIO, GOBLET_COLUMN_MIN),
        diameter * 0.85,
      );
      const coneHeight = diameter * GOBLET_CONE_RATIO;
      if (type === 'gobletDry') return { columnDiameter, coneHeight };
      // Com água na coluna o catálogo não informa a altura da coluna: adota-se a que
      // reproduz a capacidade nominal com o diâmetro de coluna estimado.
      const R = diameter / 2;
      const r = columnDiameter / 2;
      const fallback = height * 0.55;
      let columnHeight = fallback;
      if (input.capacity !== undefined) {
        const cone = frustumVolume(coneHeight, r, R);
        const columnArea = Math.PI * r * r;
        const bowlArea = Math.PI * R * R;
        // capacidade = bowlArea·x + cone + columnArea·(altura − cone − x)
        const x =
          (input.capacity - cone - columnArea * (height - coneHeight)) / (bowlArea - columnArea);
        const solved = height - coneHeight - x;
        if (Number.isFinite(solved) && x >= 0.3 && solved >= 1) columnHeight = solved;
      }
      return { columnDiameter, coneHeight, columnHeight: Math.round(columnHeight * 100) / 100 };
    }
    case 'verticalConeLegs': {
      const supportHeight = input.catalogSupportHeight ?? 0.5;
      return { supportHeight, coneHeight: supportHeight * CONE_TO_SUPPORT_RATIO };
    }
    case 'australian':
      return {
        supportHeight: AUSTRALIAN_SUPPORT,
        coneHeight: AUSTRALIAN_SUPPORT * CONE_TO_SUPPORT_RATIO,
      };
    case 'horizontal':
      return {
        supportHeight:
          input.supportType === 'legs' ? (input.catalogSupportHeight ?? 0.5) : SKID_HEIGHT,
      };
    default:
      return {};
  }
}

/** Acessórios representados por padrão, conforme as imagens do catálogo de cada forma. */
export function defaultTankAccessories(type: TankType, top: number): TankAccessories {
  const base = { ladderAzimuth: Math.PI / 2, guardrailHeight: GUARDRAIL_HEIGHT };
  switch (type) {
    case 'australian':
      return { ...base, ladder: false, cage: false, guardrail: false, manhole: false };
    case 'horizontal':
      return { ...base, ladder: true, cage: false, guardrail: false, manhole: true };
    case 'verticalGround':
    case 'verticalConeLegs':
      // A gaiola só aparece nas escadas altas (nas imagens, os modelos baixos não a têm).
      return { ...base, ladder: true, cage: top > 3.5, guardrail: true, manhole: true };
    default:
      return { ...base, ladder: true, cage: true, guardrail: true, manhole: true };
  }
}

/** Alturas iniciais dos bocais de saída e de entrada (configuráveis pelo usuário). */
function defaultNozzleHeights(tank: Tank): { outletHeight: number; inletHeight: number } {
  const l = tankLayout(tank);
  const span = l.top - l.shellBottom;
  switch (l.type) {
    case 'gobletWet':
    case 'gobletDry':
      // As tubulações chegam e saem pela base da coluna.
      return { outletHeight: 0.3, inletHeight: 0.3 };
    case 'horizontal':
      return {
        outletHeight: l.shellBottom + tank.diameter * 0.2,
        inletHeight: l.shellBottom + tank.diameter * 0.8,
      };
    default:
      return {
        outletHeight: l.shellBottom + Math.min(0.2, span / 2),
        inletHeight: Math.max(l.top - 0.3, l.shellBottom + span / 2),
      };
  }
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/** Diâmetro do australiano que reproduz a capacidade com a altura do costado (cilindro). */
export const australianDiameter = (capacity: number, wallHeight: number): number =>
  round3(Math.sqrt((4 * capacity) / (Math.PI * wallHeight)));

/**
 * Monta os parâmetros de um reservatório da família: a partir de um modelo comercial
 * (dimensões do catálogo) ou de dimensões personalizadas, mantendo a forma da família.
 */
export function tankParametersFromFamily(
  family: TankFamily,
  selection: TankSelection,
): Result<TankParameters> {
  const type = family.tankType;
  let variant: TankVariant | undefined;
  let dims: Required<Pick<TankCustomDimensions, 'diameter' | 'height'>> & TankCustomDimensions;
  if ('variantId' in selection) {
    variant = family.variants.find((v) => v.id === selection.variantId);
    if (!variant) {
      return fail('TANK_VARIANT_NOT_FOUND', 'Modelo comercial inexistente nesta família.');
    }
    dims = {
      capacityL: variant.capacityL,
      diameter: variant.diameter,
      height: variant.height,
      ...(variant.columnHeight !== undefined ? { columnHeight: variant.columnHeight } : {}),
    };
  } else {
    const custom = selection.custom;
    const defaults = family.customDefaults;
    const capacityL = custom.capacityL ?? defaults.capacityL;
    const height = custom.height ?? defaults.height;
    const diameter =
      custom.diameter ??
      (type === 'australian' && custom.capacityL !== undefined
        ? australianDiameter(capacityL / 1000, height)
        : defaults.diameter);
    dims = {
      ...custom,
      capacityL,
      diameter,
      height,
    };
    // Taça de coluna seca fora da tabela: parte da coluna do primeiro modelo da família
    // (ou de metade da altura), a ajustar pelo usuário.
    if (type === 'gobletDry' && dims.columnHeight === undefined) {
      dims.columnHeight = family.variants[0]?.columnHeight ?? height / 2;
    }
    const length = custom.length ?? defaults.length;
    if (type === 'horizontal' && length !== undefined) dims.length = length;
  }
  const numbers = [dims.capacityL, dims.diameter, dims.height, dims.columnHeight, dims.length];
  if (numbers.some((v) => v !== undefined && !(Number.isFinite(v) && v > 0))) {
    return fail('INVALID_VALUE', 'Dimensões do reservatório inválidas.');
  }

  const capacity = dims.capacityL === undefined ? undefined : dims.capacityL / 1000;
  const supportType: TankSupportType | undefined =
    type === 'horizontal' ? (dims.supportType ?? 'skid') : undefined;
  const shape = estimateTankShape({
    type,
    diameter: dims.diameter,
    height: dims.height,
    ...(capacity !== undefined ? { capacity } : {}),
    ...(supportType ? { supportType } : {}),
    ...(family.catalogSupportHeight !== undefined
      ? { catalogSupportHeight: family.catalogSupportHeight }
      : {}),
  });
  const columnHeight = dims.columnHeight ?? shape.columnHeight;
  const height = type === 'horizontal' ? (shape.supportHeight ?? 0) + dims.diameter : dims.height;

  const parameters: TankParameters = {
    familyId: family.id,
    manufacturing: {
      manufacturer: family.manufacturer,
      model: variant
        ? `${family.name} ${variant.capacityL.toLocaleString('pt-BR')} L`
        : `${family.name} (dimensões personalizadas)`,
    },
    tankType: type,
    ...(variant ? { variantId: variant.id } : {}),
    ...(capacity !== undefined ? { nominalCapacity: capacity } : {}),
    diameter: dims.diameter,
    height,
    ...(columnHeight !== undefined ? { columnHeight } : {}),
    ...(shape.columnDiameter !== undefined ? { columnDiameter: shape.columnDiameter } : {}),
    ...(shape.coneHeight !== undefined ? { coneHeight: shape.coneHeight } : {}),
    ...(shape.supportHeight !== undefined ? { supportHeight: shape.supportHeight } : {}),
    ...(supportType ? { supportType } : {}),
    ...(dims.length !== undefined ? { length: dims.length } : {}),
    outletHeight: 0,
    inletHeight: 0,
    nozzleLength: NOZZLE_LENGTH,
  };
  const probe = { ...parameters } as unknown as Tank;
  const complete: TankParameters = {
    ...parameters,
    ...defaultNozzleHeights(probe),
    accessories: defaultTankAccessories(type, tankLayout(probe).top),
  };
  const problem = tankProblem({ ...complete } as unknown as Tank);
  if (problem) return fail('INVALID_VALUE', problem);
  return ok(complete);
}

// ---------------------------------------------------------------------------
// Origem de cada parâmetro
// ---------------------------------------------------------------------------

/**
 * Origem de um parâmetro:
 *  - `catalog`: confere com o valor impresso no catálogo da família;
 *  - `derived`: calculado a partir de valores de catálogo;
 *  - `estimated`: proporção de representação, não tabulada pelo fabricante;
 *  - `user`: informado ou alterado pelo usuário.
 */
export type TankParameterOrigin = 'catalog' | 'derived' | 'estimated' | 'user';

export const TANK_ORIGIN_LABELS: Record<TankParameterOrigin, string> = {
  catalog: 'catálogo',
  derived: 'derivado do catálogo',
  estimated: 'estimado (representação)',
  user: 'definido pelo usuário',
};

export type TankOriginKey =
  | 'nominalCapacity'
  | 'diameter'
  | 'height'
  | 'columnHeight'
  | 'columnDiameter'
  | 'coneHeight'
  | 'supportHeight'
  | 'length'
  | 'shellThickness'
  | 'compartments'
  | 'maxWaterLevel'
  | 'nozzles'
  | 'accessories';

const same = (a: number | undefined, b: number | undefined): boolean =>
  a !== undefined && b !== undefined && Math.abs(a - b) < 1e-6;

/**
 * Classifica a origem de cada parâmetro aplicável, comparando o elemento com a família de
 * catálogo. É derivada (nunca persistida): editar um valor muda a classificação.
 */
export function tankParameterOrigins(
  tank: Tank,
  family?: TankFamily,
): Partial<Record<TankOriginKey, TankParameterOrigin>> {
  const type = tankTypeOf(tank);
  // Numa família personalizada a tabela é do usuário: nada nela é dado de fabricante.
  const printed = family?.origin === 'builtin' ? family : undefined;
  const variant =
    printed && tank.familyId === printed.id
      ? printed.variants.find((v) => v.id === tank.variantId)
      : undefined;
  const inFamily = family !== undefined && tank.familyId === family.id;
  const estimate = estimateTankShape({
    type,
    diameter: tank.diameter,
    height: tank.height,
    ...(tank.nominalCapacity !== undefined ? { capacity: tank.nominalCapacity } : {}),
    ...(tank.supportType ? { supportType: tank.supportType } : {}),
    ...(family?.catalogSupportHeight !== undefined
      ? { catalogSupportHeight: family.catalogSupportHeight }
      : {}),
  });
  const fromVariant = (value: number | undefined, printed: number | undefined) =>
    variant && same(value, printed) ? 'catalog' : 'user';
  const estimated = (value: number | undefined, guess: number | undefined) =>
    inFamily && same(value, guess) ? 'estimated' : 'user';

  const origins: Partial<Record<TankOriginKey, TankParameterOrigin>> = {
    diameter: fromVariant(tank.diameter, variant?.diameter),
    height: fromVariant(tank.height, variant?.height),
    nozzles: 'user',
  };
  if (tank.nominalCapacity !== undefined) {
    origins.nominalCapacity = fromVariant(
      tank.nominalCapacity,
      variant ? variant.capacityL / 1000 : undefined,
    );
  }
  if (type === 'gobletWet' || type === 'gobletDry') {
    origins.columnHeight =
      variant?.columnHeight !== undefined
        ? fromVariant(tank.columnHeight, variant.columnHeight)
        : estimated(tank.columnHeight, estimate.columnHeight);
    origins.columnDiameter = estimated(tank.columnDiameter, estimate.columnDiameter);
    origins.coneHeight = estimated(tank.coneHeight, estimate.coneHeight);
  }
  if (type === 'verticalConeLegs' || type === 'australian') {
    origins.coneHeight = estimated(tank.coneHeight, estimate.coneHeight);
  }
  if (type === 'verticalConeLegs' || type === 'australian' || type === 'horizontal') {
    const support = printed?.catalogSupportHeight;
    const usesPrinted = type === 'verticalConeLegs' || tank.supportType === 'legs';
    origins.supportHeight =
      inFamily && usesPrinted && same(tank.supportHeight, support)
        ? 'catalog'
        : estimated(tank.supportHeight, estimate.supportHeight);
  }
  if (type === 'australian' && inFamily) {
    if (printed?.catalogHeights?.some((h) => same(h, tank.height))) origins.height = 'catalog';
    if (
      tank.nominalCapacity !== undefined &&
      same(tank.diameter, australianDiameter(tank.nominalCapacity, tank.height))
    ) {
      origins.diameter = 'derived';
    }
  }
  if (type === 'horizontal') {
    origins.length = 'user';
    // A altura total do horizontal é a soma do apoio com o diâmetro.
    origins.height = 'derived';
  }
  if (type !== 'generic') {
    origins.shellThickness = tank.shellThickness === undefined ? 'estimated' : 'user';
    origins.compartments = 'user';
    origins.accessories = 'estimated';
    if (tank.maxWaterLevel !== undefined) origins.maxWaterLevel = 'user';
  }
  return origins;
}

/** Tipo de fundo e de instalação, para a documentação e as propriedades IFC. */
export function tankBottomType(type: TankType): string {
  switch (type) {
    case 'gobletWet':
    case 'gobletDry':
      return 'Transição cônica sobre coluna';
    case 'verticalConeLegs':
    case 'australian':
      return 'Cônico';
    case 'horizontal':
      return 'Tampos abaulados';
    default:
      return 'Plano';
  }
}

export function tankInstallationType(tank: Pick<Tank, 'tankType' | 'supportType'>): string {
  switch (tankTypeOf(tank)) {
    case 'gobletWet':
    case 'gobletDry':
      return 'Elevado sobre coluna';
    case 'verticalConeLegs':
    case 'australian':
      return 'Elevado sobre pés de apoio';
    case 'horizontal':
      return tank.supportType === 'legs'
        ? 'Horizontal sobre pés de apoio'
        : 'Horizontal sobre longarina';
    case 'fieldErected':
      return 'Apoiado, montado na obra';
    default:
      return 'Apoiado';
  }
}
