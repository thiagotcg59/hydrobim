import {
  add,
  angleBetween,
  dot,
  fail,
  formatMeters,
  ok,
  scale,
  sub,
  tryNormalize,
  vec3,
  type Result,
  type Vec3,
} from '@hydrobim/core';

/**
 * Entrada dinâmica do trecho em criação: converte o que o usuário digita (comprimento,
 * ângulo, deslocamentos relativos, cota final, declividade) no ponto final do trecho. É só
 * geometria de apontamento — o ponto resultante segue para a mesma operação de traçado do
 * clique, que aplica as regras de catálogo e de montagem. Unidades SI: metros e radianos.
 */

export interface SegmentEntry {
  /** Comprimento real do trecho (m). */
  readonly length?: number;
  /** Projeção horizontal do trecho (m). */
  readonly horizontal?: number;
  /** Deflexão em relação à direção de partida (rad), no lado indicado pelo cursor. */
  readonly deflection?: number;
  /** Deslocamentos relativos ao ponto de partida (m). */
  readonly dx?: number;
  readonly dy?: number;
  readonly dz?: number;
  /** Cota Z do ponto final (m). */
  readonly finalZ?: number;
  /** Declividade (m/m): desnível por metro de projeção horizontal; positiva sobe. */
  readonly slope?: number;
}

export interface SegmentEntryContext {
  /** Ponto de partida do trecho. */
  readonly anchor: Vec3;
  /** Direção da porta de partida, quando o trecho sai de uma extremidade. */
  readonly axis: Vec3 | null;
  /** Ponto indicado pelo cursor: define a direção quando ela não é digitada. */
  readonly cursor: Vec3 | null;
}

const defined = (value: number | undefined): value is number => value !== undefined;
const invalid = (label: string): Result<never> =>
  fail('INVALID_ENTRY', `${label}: informe um número válido.`);

/** Direção horizontal unitária de `v`; `null` quando `v` é vertical ou nulo. */
function horizontalDirection(v: Vec3): Vec3 | null {
  return tryNormalize(vec3(v.x, v.y, 0));
}

/**
 * Direção de saída: a do cursor ou, com deflexão digitada, a direção de partida girada desse
 * ângulo para o lado em que o cursor está.
 */
function resolveDirection(
  context: SegmentEntryContext,
  deflection: number | undefined,
): Result<Vec3> {
  const { anchor, axis, cursor } = context;
  const toward = cursor ? tryNormalize(sub(cursor, anchor)) : null;
  if (!defined(deflection)) {
    const direction = toward ?? (axis ? tryNormalize(axis) : null);
    return direction
      ? ok(direction)
      : fail('NO_DIRECTION', 'Indique a direção com o cursor ou informe os deslocamentos ΔX e ΔY.');
  }
  const base = axis ? tryNormalize(axis) : null;
  if (!base) {
    return fail(
      'NO_REFERENCE_AXIS',
      'O ângulo é medido a partir da direção de uma extremidade: comece o trecho em uma extremidade livre.',
    );
  }
  if (Math.abs(deflection) < 1e-9) return ok(base);
  // Lado do giro: componente do cursor perpendicular à direção de partida.
  const side = toward ? tryNormalize(sub(toward, scale(base, dot(toward, base)))) : null;
  if (!side) {
    return fail(
      'NO_DIRECTION',
      'Aponte o cursor para o lado em que o trecho deve virar antes de confirmar o ângulo.',
    );
  }
  const angle = Math.abs(deflection);
  return ok(add(scale(base, Math.cos(angle)), scale(side, Math.sin(angle))));
}

/**
 * Ponto final do trecho para os valores digitados. Combinações aceitas:
 *  - deslocamentos relativos (ΔX, ΔY, ΔZ): o ponto é a soma direta;
 *  - comprimento real ou projeção horizontal, na direção do cursor ou da deflexão digitada;
 *  - desnível por ΔZ, cota final ou declividade (com a projeção horizontal).
 * Sem nenhum valor que defina o tamanho, a operação é recusada (o clique continua valendo).
 */
export function resolveSegmentEntry(
  context: SegmentEntryContext,
  entry: SegmentEntry,
): Result<Vec3> {
  for (const [label, value] of [
    ['Comprimento', entry.length],
    ['Projeção', entry.horizontal],
    ['Ângulo', entry.deflection],
    ['ΔX', entry.dx],
    ['ΔY', entry.dy],
    ['ΔZ', entry.dz],
    ['Cota final', entry.finalZ],
    ['Declividade', entry.slope],
  ] as const) {
    if (defined(value) && !Number.isFinite(value)) return invalid(label);
  }
  if (defined(entry.length) && entry.length <= 0) {
    return fail('INVALID_ENTRY', 'O comprimento deve ser maior que zero.');
  }
  if (defined(entry.horizontal) && entry.horizontal < 0) {
    return fail('INVALID_ENTRY', 'A projeção horizontal não pode ser negativa.');
  }
  const { anchor } = context;
  const verticals = [entry.dz, entry.finalZ, entry.slope].filter(defined).length;
  if (verticals > 1) {
    return fail(
      'CONFLICTING_ENTRY',
      'Informe o desnível de uma só forma: ΔZ, cota final ou declividade.',
    );
  }

  // Deslocamentos relativos: definem o ponto por si sós.
  if (defined(entry.dx) || defined(entry.dy)) {
    if (defined(entry.length) || defined(entry.horizontal) || defined(entry.deflection)) {
      return fail(
        'CONFLICTING_ENTRY',
        'Use os deslocamentos ΔX/ΔY ou o comprimento com ângulo, não os dois.',
      );
    }
    const dx = entry.dx ?? 0;
    const dy = entry.dy ?? 0;
    const run = Math.hypot(dx, dy);
    const rise = defined(entry.finalZ)
      ? entry.finalZ - anchor.z
      : defined(entry.slope)
        ? run * entry.slope
        : (entry.dz ?? 0);
    return ok(vec3(anchor.x + dx, anchor.y + dy, anchor.z + rise));
  }

  const rise = defined(entry.finalZ) ? entry.finalZ - anchor.z : entry.dz;

  // Só o desnível: prumada no ponto de partida.
  if (!defined(entry.length) && !defined(entry.horizontal)) {
    if (defined(entry.slope)) {
      return fail(
        'INCOMPLETE_ENTRY',
        'A declividade precisa do comprimento ou da projeção horizontal do trecho.',
      );
    }
    if (!defined(rise)) {
      return fail('INCOMPLETE_ENTRY', 'Informe o comprimento, os deslocamentos ou a cota final.');
    }
    if (defined(entry.deflection)) {
      return fail('INCOMPLETE_ENTRY', 'Informe o comprimento do trecho para usar o ângulo.');
    }
    return ok(vec3(anchor.x, anchor.y, anchor.z + rise));
  }

  const direction = resolveDirection(context, entry.deflection);
  if (!direction.ok) return direction;

  // Sem desnível digitado, o comprimento segue a direção apontada (inclusive inclinada).
  if (!defined(rise) && !defined(entry.slope)) {
    if (defined(entry.length)) return ok(add(anchor, scale(direction.value, entry.length)));
    const flat = horizontalDirection(direction.value);
    if (!flat) {
      return fail('NO_DIRECTION', 'A projeção horizontal exige uma direção que não seja vertical.');
    }
    const horizontal = entry.horizontal ?? 0;
    const tilt = direction.value.z / Math.hypot(direction.value.x, direction.value.y);
    return ok(add(anchor, add(scale(flat, horizontal), vec3(0, 0, horizontal * tilt))));
  }

  const flat = horizontalDirection(direction.value);
  if (!flat) {
    return fail(
      'NO_DIRECTION',
      'Para combinar comprimento e desnível, aponte uma direção horizontal com o cursor.',
    );
  }
  let horizontal: number;
  let dz: number;
  if (defined(entry.slope)) {
    // Comprimento real L com declividade i: projeção = L / √(1 + i²).
    horizontal = entry.horizontal ?? (entry.length ?? 0) / Math.hypot(1, entry.slope);
    dz = horizontal * entry.slope;
  } else {
    dz = rise ?? 0;
    if (defined(entry.horizontal)) horizontal = entry.horizontal;
    else {
      const length = entry.length ?? 0;
      if (length < Math.abs(dz)) {
        return fail(
          'LENGTH_SHORTER_THAN_RISE',
          `O comprimento (${formatMeters(length, 3)}) é menor que o desnível (${formatMeters(Math.abs(dz), 3)}).`,
        );
      }
      horizontal = Math.sqrt(length * length - dz * dz);
    }
  }
  return ok(add(anchor, add(scale(flat, horizontal), vec3(0, 0, dz))));
}

/** Deflexão (rad) entre a direção de partida e o ponto, para preencher o campo de ângulo. */
export function deflectionTo(context: SegmentEntryContext, point: Vec3): number | null {
  const base = context.axis ? tryNormalize(context.axis) : null;
  const toward = tryNormalize(sub(point, context.anchor));
  return base && toward ? angleBetween(base, toward) : null;
}

export interface RiserTarget {
  /** Cota Z do eixo ao fim da prumada (m). */
  readonly z: number;
  /** Elevação do eixo acima do nível de destino (m). */
  readonly elevation: number;
  readonly levelId: string;
  readonly levelName: string;
}

/**
 * Destinos de "subir" e "descer" em instalações prediais: o eixo vai para a mesma altura
 * acima do piso (`pipeElevation`) no pavimento seguinte ou anterior. Com um único nível, ou
 * no primeiro/último, não há destino naquele sentido (`null`) e a cota é digitada.
 */
export function riserTargets(
  levels: readonly { id: string; name: string; elevation: number }[],
  currentZ: number,
  pipeElevation: number,
): { up: RiserTarget | null; down: RiserTarget | null } {
  const EPS = 1e-6;
  const targets = levels
    .map((level) => ({
      z: level.elevation + pipeElevation,
      elevation: pipeElevation,
      levelId: level.id,
      levelName: level.name,
    }))
    .sort((a, b) => a.z - b.z);
  return {
    up: targets.find((target) => target.z > currentZ + EPS) ?? null,
    down: [...targets].reverse().find((target) => target.z < currentZ - EPS) ?? null,
  };
}
