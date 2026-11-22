import {
  copyArchElements,
  fail,
  getArchElement,
  mirrorArchElements,
  moveArchElements,
  moveRectangleCorner,
  moveWallEndpoint,
  rotateArchElements,
  updateArchElement,
  type ArchElement,
  type Point2,
  type Project,
  type Result,
} from '@hydrobim/core';

/**
 * Edição interativa da arquitetura na planta, como funções puras: cada prévia é o RESULTADO da
 * mesma operação de `@hydrobim/core` que a confirmação grava, calculado a partir do projeto
 * como está — nada é aplicado enquanto o usuário não confirma. Aqui só se traduzem os pontos
 * indicados (ponto-base, destino, centro, raios, eixo) nos parâmetros de cada operação.
 */

export const ARCH_TRANSFORMS = ['move', 'copy', 'rotate', 'mirror'] as const;
export type ArchTransformKind = (typeof ARCH_TRANSFORMS)[number];

export const ARCH_TRANSFORM_LABELS: Record<ArchTransformKind, string> = {
  move: 'Mover',
  copy: 'Copiar',
  rotate: 'Girar',
  mirror: 'Espelhar',
};

/** Pontos que cada operação pede, na ordem; o último é o que confirma. */
export const ARCH_TRANSFORM_STEPS: Record<ArchTransformKind, readonly string[]> = {
  move: ['clique o ponto-base', 'clique o destino'],
  copy: ['clique o ponto-base', 'clique o destino da cópia'],
  rotate: ['clique o centro do giro', 'clique o raio inicial', 'clique o raio final'],
  mirror: ['clique o 1º ponto do eixo de espelho', 'clique o 2º ponto do eixo'],
};

export interface ArchTransform {
  readonly kind: ArchTransformKind;
  /** Pontos de referência já indicados. */
  readonly points: readonly Point2[];
  /** Girar e espelhar: mantém os originais e transforma uma cópia. */
  readonly copy: boolean;
}

/** Ângulo (rad, anti-horário) do raio `center`→`from` ao raio `center`→`to`. */
export function sweepAngle(center: Point2, from: Point2, to: Point2): number | null {
  const a = { x: from.x - center.x, y: from.y - center.y };
  const b = { x: to.x - center.x, y: to.y - center.y };
  if (Math.hypot(a.x, a.y) < 1e-9 || Math.hypot(b.x, b.y) < 1e-9) return null;
  return Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
}

export interface TransformOutcome {
  readonly project: Project;
  /** Elementos resultantes (os movidos ou as cópias). */
  readonly elementIds: string[];
}

/**
 * Resultado da operação com os pontos já indicados mais `next` (o cursor, na prévia, ou o
 * clique que confirma). `null` enquanto faltam pontos; `Result` com o motivo quando o núcleo
 * recusa. `angle` substitui os raios do girar por um valor digitado (rad).
 */
export function transformOutcome(
  project: Project,
  ids: readonly string[],
  transform: ArchTransform,
  next: Point2 | null,
  angle?: number,
): Result<TransformOutcome> | null {
  const points = next ? [...transform.points, next] : [...transform.points];
  const [first, second, third] = points;
  switch (transform.kind) {
    case 'move': {
      if (!first || !second) return null;
      const moved = moveArchElements(project, ids, {
        x: second.x - first.x,
        y: second.y - first.y,
      });
      return moved.ok ? { ok: true, value: { project: moved.value, elementIds: [...ids] } } : moved;
    }
    case 'copy': {
      if (!first || !second) return null;
      return copyArchElements(project, ids, { x: second.x - first.x, y: second.y - first.y });
    }
    case 'rotate': {
      if (!first) return null;
      const turn =
        angle ?? (second && third ? (sweepAngle(first, second, third) ?? undefined) : undefined);
      if (turn === undefined) {
        return angle === undefined && second && third
          ? fail('ROTATION_UNDEFINED', 'Os raios do giro precisam sair do centro.')
          : null;
      }
      return rotateArchElements(project, ids, first, turn, transform.copy);
    }
    case 'mirror': {
      if (!first || !second) return null;
      return mirrorArchElements(project, ids, first, second, transform.copy);
    }
  }
}

/** Elementos que a operação criou ou alterou (para desenhar a prévia como fantasma). */
export function changedArchElements(before: Project, after: Project): ArchElement[] {
  if (before.architecture === after.architecture) return [];
  const previous = new Map(before.architecture.elements.map((element) => [element.id, element]));
  return after.architecture.elements.filter((element) => previous.get(element.id) !== element);
}

// ---------------------------------------------------------------------------
// Alças
// ---------------------------------------------------------------------------

/** Alça arrastada na planta: extremidade de parede ou canto de contorno retangular. */
export type ArchGrip =
  | { readonly kind: 'wallEnd'; readonly elementId: string; readonly end: 'start' | 'end' }
  | { readonly kind: 'roofCorner'; readonly elementId: string; readonly index: number };

/** Identificador da alça no desenho (`data-arch-grip`) e a leitura dele. */
export const gripKey = (grip: ArchGrip): string =>
  grip.kind === 'wallEnd'
    ? `wall:${grip.elementId}:${grip.end}`
    : `roof:${grip.elementId}:${grip.index}`;

export function parseGripKey(key: string | null): ArchGrip | null {
  if (!key) return null;
  const [kind, elementId, rest] = key.split(':');
  if (!elementId || rest === undefined) return null;
  if (kind === 'wall' && (rest === 'start' || rest === 'end')) {
    return { kind: 'wallEnd', elementId, end: rest };
  }
  const index = Number(rest);
  if (kind === 'roof' && Number.isInteger(index) && index >= 0 && index < 4) {
    return { kind: 'roofCorner', elementId, index };
  }
  return null;
}

/** Posição da alça no modelo; `null` se o elemento não existe mais. */
export function gripPoint(project: Pick<Project, 'architecture'>, grip: ArchGrip): Point2 | null {
  const element = getArchElement(project.architecture, grip.elementId);
  if (grip.kind === 'wallEnd') return element?.kind === 'wall' ? element[grip.end] : null;
  return element?.kind === 'roof' ? (element.boundary[grip.index] ?? null) : null;
}

/**
 * Pontos que orientam a captura enquanto a alça é arrastada: `anchor` é o ponto que fica
 * (a outra extremidade da parede, o canto oposto do telhado) e `previous` dá a direção
 * original, para que "paralela" mantenha o alinhamento e "perpendicular" o esquadro.
 */
export function gripSnapFrame(
  project: Pick<Project, 'architecture'>,
  grip: ArchGrip,
): { anchor: Point2; previous: Point2 | null } | null {
  const element = getArchElement(project.architecture, grip.elementId);
  if (grip.kind === 'wallEnd' && element?.kind === 'wall') {
    const fixed = grip.end === 'start' ? element.end : element.start;
    return { anchor: fixed, previous: element[grip.end] };
  }
  if (grip.kind === 'roofCorner' && element?.kind === 'roof') {
    const opposite = element.boundary[(grip.index + 2) % 4];
    return opposite ? { anchor: opposite, previous: null } : null;
  }
  return null;
}

/**
 * Projeto com a alça levada a `point`. Parede: `moveWallEndpoint` (as portas e janelas ficam
 * onde estão; se uma deixar de caber, a operação é recusada). Telhado: o canto oposto fica e o
 * contorno continua retangular.
 */
export function gripOutcome(project: Project, grip: ArchGrip, point: Point2): Result<Project> {
  if (grip.kind === 'wallEnd') return moveWallEndpoint(project, grip.elementId, grip.end, point);
  const element = getArchElement(project.architecture, grip.elementId);
  if (element?.kind !== 'roof') return fail('ARCH_ELEMENT_NOT_FOUND', 'Elemento inexistente.');
  const boundary = moveRectangleCorner(element.boundary, grip.index, point);
  if (!boundary) return fail('ROOF_BOUNDARY_INVALID', 'O contorno do telhado ficaria sem área.');
  return updateArchElement(project, element.id, { boundary });
}

// ---------------------------------------------------------------------------
// Editar contorno
// ---------------------------------------------------------------------------

/**
 * Contorno em edição (laje, piso, ambiente ou telhado): um rascunho fora do projeto. Só
 * "Concluir" o grava — de uma vez, pela operação do núcleo, que o recusa se for inválido.
 */
export interface ArchContour {
  readonly elementId: string;
  /** Telhado: o contorno continua retangular (não ganha nem perde vértices). */
  readonly rectangular: boolean;
  readonly ring: readonly Point2[];
  /** Vértice selecionado (Del o remove). */
  readonly active: number | null;
}

/** Elementos com contorno editável. */
export function contourOf(element: ArchElement | undefined): ArchContour | null {
  if (!element) return null;
  if (
    element.kind !== 'slab' &&
    element.kind !== 'flooring' &&
    element.kind !== 'space' &&
    element.kind !== 'roof'
  ) {
    return null;
  }
  return {
    elementId: element.id,
    rectangular: element.kind === 'roof',
    ring: element.boundary.map((p) => ({ x: p.x, y: p.y })),
    active: null,
  };
}

/** Leva o vértice `index` a `point`; no contorno retangular, os vizinhos acompanham. */
export function moveContourVertex(contour: ArchContour, index: number, point: Point2): ArchContour {
  if (contour.rectangular) {
    const ring = moveRectangleCorner(contour.ring, index, point);
    return ring ? { ...contour, ring, active: index } : contour;
  }
  return {
    ...contour,
    ring: contour.ring.map((p, i) => (i === index ? { x: point.x, y: point.y } : p)),
    active: index,
  };
}

/** Insere um vértice no meio do lado que sai do vértice `edge` (não em contorno retangular). */
export function insertContourVertex(contour: ArchContour, edge: number): ArchContour {
  if (contour.rectangular) return contour;
  const a = contour.ring[edge];
  const b = contour.ring[(edge + 1) % contour.ring.length];
  if (!a || !b) return contour;
  const ring = [...contour.ring];
  ring.splice(edge + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  return { ...contour, ring, active: edge + 1 };
}

/** Remove o vértice `index`; o contorno mantém ao menos três (e o retangular, os quatro). */
export function removeContourVertex(contour: ArchContour, index: number): ArchContour {
  if (contour.rectangular || contour.ring.length <= 3) return contour;
  return { ...contour, ring: contour.ring.filter((_, i) => i !== index), active: null };
}

/** O rascunho difere do contorno gravado? */
export function contourDirty(
  project: Pick<Project, 'architecture'>,
  contour: ArchContour,
): boolean {
  const element = getArchElement(project.architecture, contour.elementId);
  if (!element || !('boundary' in element)) return false;
  return (
    element.boundary.length !== contour.ring.length ||
    element.boundary.some((p, i) => {
      const q = contour.ring[i];
      return !q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-9;
    })
  );
}

/**
 * Projeto com o contorno editado gravado. É a mesma chamada da confirmação: a prévia usa o
 * resultado só para dizer se o contorno é válido (e por quê não, quando não é).
 */
export function contourOutcome(project: Project, contour: ArchContour): Result<Project> {
  return updateArchElement(project, contour.elementId, {
    boundary: contour.ring.map((p) => ({ x: p.x, y: p.y })),
  });
}
