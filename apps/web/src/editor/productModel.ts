import {
  PBA_INJECTED_SOCKET_DEPTH_MM,
  PBA_JERI_MM,
  PBA_PIPE_MM,
  PBA_SADDLE_OUTLET_MM,
  pbaBendGeometryMm,
  type ProductFamily,
  type ProductSize,
} from '@hydrobim/catalog';
import { degToRad, mmToM, vec3, type Vec3 } from '@hydrobim/core';
import {
  buildPbaParts,
  mapMesh,
  teeIsBuildable,
  type JeSocket,
  type MeshPart,
  type PbaShape,
} from '@hydrobim/geometry';

export type ProductModel =
  | { ok: true; shape: PbaShape; parts: MeshPart[]; note: string | null }
  | { ok: false; reason: string };

export interface ProductModelOptions {
  /** Tubos: gera a barra inteira (6 m) em vez da vista encurtada. */
  fullLength?: boolean;
}

const unavailable = (reason: string): ProductModel => ({ ok: false, reason });

/**
 * Converte uma linha da tabela do fabricante (mm, letras do desenho) nos parâmetros do
 * gerador 3D (m). Os valores que não são da tabela — parede das conexões, raio das curvas,
 * saída do colar — vêm das tabelas auxiliares do catálogo, onde a origem está declarada.
 */
export function productShape(
  family: ProductFamily,
  size: ProductSize,
  options: ProductModelOptions = {},
): PbaShape | string {
  const dims = size.dims;
  const mm = (key: string): number => mmToM(dims[key] ?? NaN);
  const pipe = PBA_PIPE_MM[size.dn];
  const branchPipe = PBA_PIPE_MM[size.dn2 ?? size.dn];
  const socket = (suffix = ''): JeSocket => ({
    outerDiameter: mm(`A${suffix}`),
    boreDiameter: mm(`B${suffix}`),
    depth: mm(`C${suffix}`),
  });
  /** Parede e furo adotados para as conexões: os do tubo classe 20 de mesmo DN. */
  const wallOf = (p: typeof pipe): number => mmToM(p?.wall[20] ?? NaN);
  const boreOf = (p: typeof pipe): number =>
    mmToM((p?.outerDiameter ?? NaN) - 2 * (p?.wall[20] ?? NaN));

  switch (family.shape) {
    case 'pipe': {
      const jeri = PBA_JERI_MM[size.dn];
      const total = mm('L');
      // Vista encurtada: bolsa, um trecho do corpo e a ponta, como no desenho com quebra.
      const length = options.fullLength ? total : Math.min(total, mm('C') + 4 * mm('D'));
      return {
        type: 'pipe',
        outerDiameter: mm('D'),
        wall: mm('e'),
        length,
        socket: socket(),
        ...(jeri
          ? {
              seal: {
                outerDiameter: mmToM(jeri.D),
                frontDiameter: mmToM(jeri.C),
                height: mmToM(jeri.A),
                thickness: mmToM(jeri.B),
              },
            }
          : {}),
      };
    }
    case 'bend': {
      const geometry =
        family.angleDeg === undefined ? undefined : pbaBendGeometryMm(family.angleDeg, size.dn);
      if (!geometry || family.angleDeg === undefined) {
        return 'Não há cotas suficientes para derivar o raio desta curva.';
      }
      return {
        type: 'bend',
        angle: degToRad(family.angleDeg),
        outerDiameter: mm('D'),
        wall: wallOf(pipe),
        socket: socket(),
        lead: mmToM(geometry.lead),
        bendRadius: mmToM(geometry.bendRadius),
        tail: mm('F'),
      };
    }
    case 'tee':
    case 'cross': {
      const reducing = size.dn2 !== undefined && size.dn2 !== size.dn;
      const branchSocket = reducing ? socket('1') : socket();
      const cross = family.shape === 'cross';
      return {
        type: 'tee',
        socket: socket(),
        wall: wallOf(pipe),
        bore: boreOf(pipe),
        length: mm('L'),
        branch: {
          socket: branchSocket,
          bore: boreOf(branchPipe),
          wall: wallOf(branchPipe),
          // Tê: L1 parte da geratriz inferior da passagem. Cruzeta: L1 (ou L) de boca a boca.
          reach: cross ? mmToM(dims.L1 ?? dims.L ?? NaN) / 2 : mm('L1') - mm('A') / 2,
        },
        branches: cross ? 2 : 1,
      };
    }
    case 'cap':
      return {
        type: 'cap',
        socket: socket(),
        wall: wallOf(pipe),
        bore: boreOf(pipe),
        length: mm('L'),
      };
    case 'slipCoupling':
      return {
        type: 'slipCoupling',
        socket: {
          outerDiameter: mm('A'),
          boreDiameter: mm('B'),
          depth: mmToM(PBA_INJECTED_SOCKET_DEPTH_MM[size.dn] ?? NaN),
        },
        wall: wallOf(pipe),
        length: mm('L'),
      };
    case 'transitionCoupling':
      return {
        type: 'transitionCoupling',
        socket: socket(),
        wall: wallOf(pipe),
        bore: boreOf(pipe),
        plainSocket: { boreDiameter: mm('D'), depth: mm('F') },
        length: mm('L'),
      };
    case 'reducer':
      // `dn` é o lado maior (ponta); a bolsa tabulada é a do lado menor (`dn2`).
      return {
        type: 'reducer',
        socket: socket(),
        wall: wallOf(branchPipe),
        bore: boreOf(branchPipe),
        spigot: { outerDiameter: mm('D'), length: mm('F'), wall: wallOf(pipe) },
        length: mm('L'),
      };
    case 'adapter':
      return {
        type: 'adapter',
        socket: socket(),
        wall: wallOf(pipe),
        bodyDiameter: mmToM(pipe?.outerDiameter ?? NaN),
        spigot: { outerDiameter: mm('D'), length: mm('F') },
        length: mm('L'),
      };
    case 'saddle': {
      const outlet = size.thread ? PBA_SADDLE_OUTLET_MM[size.thread] : undefined;
      if (!pipe || !outlet) {
        return 'Nesta linha, as colunas L e D da tabela não correspondem às cotas do desenho (acompanham a rosca, não o tubo). Sem cotas confiáveis, o modelo não é gerado.';
      }
      const l1 = dims.L1 ?? NaN;
      const d = dims.D ?? NaN;
      return {
        type: 'saddle',
        pipeDiameter: mmToM(d),
        width: mm('L'),
        height: mmToM(l1),
        boss: { diameter: mmToM(outlet.bossDiameter), bore: mmToM(outlet.bore) },
        band: {
          thickness: mmToM((l1 - d - outlet.threadLength) / 2),
          length: mmToM(Math.max(outlet.bossDiameter * 1.25, d * 0.5)),
        },
      };
    }
    case 'jeriSeal':
      return {
        type: 'jeriSeal',
        outerDiameter: mm('D'),
        frontDiameter: mm('C'),
        height: mm('A'),
        thickness: mm('B'),
      };
    case 'oRing':
      return { type: 'oRing', outerDiameter: mm('A'), cord: mm('E') };
  }
}

const allFinite = (value: unknown): boolean =>
  typeof value === 'number'
    ? Number.isFinite(value) && value >= 0
    : typeof value === 'object' && value !== null
      ? Object.values(value).every(allFinite)
      : true;

/** Modelo 3D de uma linha da biblioteca de produtos, ou o motivo de não haver modelo. */
export function buildProductModel(
  family: ProductFamily,
  size: ProductSize,
  options: ProductModelOptions = {},
): ProductModel {
  const shape = productShape(family, size, options);
  if (typeof shape === 'string') return unavailable(shape);
  if (!allFinite(shape)) return unavailable('A tabela não traz todas as cotas desta linha.');
  if (shape.type === 'tee' && !teeIsBuildable(shape)) {
    return unavailable('As cotas da tabela não permitem montar a derivação desta linha.');
  }
  try {
    const shortened = shape.type === 'pipe' && !options.fullLength;
    const built = buildPbaParts(shape);
    // Tês e cruzetas nascem com a derivação em +Y (convenção das portas); na biblioteca são
    // apresentados com a derivação para cima, como nos desenhos do fabricante.
    const upright = (v: Vec3): Vec3 => vec3(v.x, -v.z, v.y);
    const parts =
      shape.type === 'tee'
        ? built.map((part) => ({ ...part, mesh: mapMesh(part.mesh, upright, upright) }))
        : built;
    return {
      ok: true,
      shape,
      parts,
      note: shortened
        ? `Vista encurtada: o comprimento total do tubo é ${size.dims.L ?? '—'} mm.`
        : null,
    };
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : 'Falha ao gerar o modelo.');
  }
}

export interface ModelExtent {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** Envoltória (m) das partes de um modelo, no referencial da peça. */
export function modelExtent(parts: readonly MeshPart[]): ModelExtent {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const p = part.mesh.positions;
    for (let i = 0; i < p.length; i += 1) {
      const axis = (i % 3) as 0 | 1 | 2;
      const value = p[i] ?? 0;
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return { min, max };
}
