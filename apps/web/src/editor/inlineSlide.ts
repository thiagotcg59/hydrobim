import {
  cross,
  dot,
  inlineClearancesOf,
  length,
  MIN_PIPE_LENGTH,
  normalize,
  sub,
  vec3,
  type InlineClearance,
  type Project,
  type Vec3,
} from '@hydrobim/core';

/**
 * Arrastar uma peça ao longo da linha (válvula, tê, cruzeta, redução...): funções puras que
 * traduzem o ponto do cursor sobre o eixo da peça na cota pedida ao núcleo
 * (`setInlineClearance`). Sem Three.js nem DOM.
 */

/** Cota de referência do arrasto: a primeira editável (reta e com tubo), na ordem das portas. */
export function referenceClearance(project: Project, elementId: string): InlineClearance | null {
  return (
    inlineClearancesOf(project, elementId).find((c) => c.straight && c.pipeIds.length > 0) ?? null
  );
}

export interface InlineSlideTarget {
  readonly portId: string;
  /** Cota pedida para a extremidade `portId` (m). */
  readonly value: number;
}

/**
 * Cota que corresponde a levar o ponto agarrado `grab` até `point` (ambos sobre o eixo da
 * peça), no projeto do início do arrasto. Com `step` > 0 a cota cai em múltiplos do passo —
 * o que o projetista quer ler na cota, não a coordenada da peça. Limitada ao espaço da linha
 * quando a extremidade oposta também é editável. `null` = a peça não tem cota editável.
 */
export function inlineSlideTarget(
  base: Project,
  elementId: string,
  grab: Vec3,
  point: Vec3,
  step: number,
): InlineSlideTarget | null {
  const reference = referenceClearance(base, elementId);
  if (!reference) return null;
  // A porta aponta para fora da peça, rumo ao vizinho: andar nesse sentido encurta a cota.
  const outward = normalize(sub(reference.to, reference.from));
  const direction = length(outward) > 0 ? outward : null;
  if (!direction) return null;
  let value = reference.length - dot(sub(point, grab), direction);
  if (step > 0) value = Math.round(value / step) * step;
  const opposite = inlineClearancesOf(base, elementId).find(
    (c) =>
      c.portId !== reference.portId &&
      c.straight &&
      c.pipeIds.length > 0 &&
      dot(normalize(sub(c.to, c.from)), direction) < -0.999,
  );
  const max = opposite
    ? reference.length + opposite.length - MIN_PIPE_LENGTH
    : Number.POSITIVE_INFINITY;
  value = Math.min(max, Math.max(MIN_PIPE_LENGTH, value));
  return { portId: reference.portId, value };
}

/**
 * Lado em que a cota é desenhada, perpendicular ao trecho: acima (+Z) num trecho horizontal;
 * num trecho vertical, para o lado horizontal mais próximo de +X.
 */
export function dimensionSide(from: Vec3, to: Vec3): Vec3 {
  const along = normalize(sub(to, from));
  if (Math.abs(along.z) < 0.9) {
    // Componente de +Z perpendicular ao trecho.
    const up = sub(vec3(0, 0, 1), vec3(along.x * along.z, along.y * along.z, along.z * along.z));
    return normalize(up);
  }
  return normalize(cross(along, vec3(0, 1, 0)));
}
