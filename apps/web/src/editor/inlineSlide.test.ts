import {
  addPipe,
  createProject,
  inlineClearancesOf,
  insertInline,
  vec3,
  type Project,
  type Result,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { dimensionSide, inlineSlideTarget, referenceClearance } from './inlineSlide';
import { resolvePipeSpec } from '@hydrobim/catalog';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const resolved = resolvePipeSpec('ferro-ductil-nbr7675-k9', 80);
if (!resolved) throw new Error('especificação ausente');
const spec = resolved;

/** Tubo de 4 m em X com uma válvula a 1,5 m do início. */
function line(): { project: Project; valve: string } {
  const base = unwrap(
    addPipe(createProject('Teste'), { start: vec3(0, 0, 0), end: vec3(4, 0, 0), spec }),
  );
  const inserted = unwrap(
    insertInline(base.project, {
      pipeId: base.elementId,
      distanceFromStart: 1.5,
      fitting: { kind: 'valve' },
    }),
  );
  return { project: inserted.project, valve: inserted.elementId };
}

describe('arrastar peça ao longo da linha', () => {
  it('converte o deslocamento do cursor na cota da primeira extremidade', () => {
    const { project, valve } = line();
    const reference = referenceClearance(project, valve);
    expect(reference?.portId).toBe('a');
    const a0 = reference?.length ?? 0;
    const grab = vec3(1.5, 0, 0);
    // A porta "a" aponta para −X: levar a peça +0,3 m em X aumenta a cota em 0,3 m.
    const target = inlineSlideTarget(project, valve, grab, vec3(1.8, 0, 0), 0);
    expect(target?.portId).toBe('a');
    expect(target?.value).toBeCloseTo(a0 + 0.3, 9);
  });

  it('arredonda a cota ao passo da grade e a limita ao espaço da linha', () => {
    const { project, valve } = line();
    const grab = vec3(1.5, 0, 0);
    const snapped = inlineSlideTarget(project, valve, grab, vec3(1.83, 0, 0), 0.1);
    expect(((snapped?.value ?? 0) * 10) % 1).toBeCloseTo(0, 6);
    const [a, b] = inlineClearancesOf(project, valve);
    const far = inlineSlideTarget(project, valve, grab, vec3(50, 0, 0), 0);
    expect(far?.value).toBeLessThan((a?.length ?? 0) + (b?.length ?? 0));
    const back = inlineSlideTarget(project, valve, grab, vec3(-50, 0, 0), 0);
    expect(back?.value).toBeGreaterThan(0);
  });

  it('desenha a cota acima de trecho horizontal e ao lado de trecho vertical', () => {
    expect(dimensionSide(vec3(0, 0, 0), vec3(3, 0, 0))).toEqual(vec3(0, 0, 1));
    const side = dimensionSide(vec3(0, 0, 0), vec3(0, 0, 2));
    expect(Math.abs(side.x)).toBeCloseTo(1, 9);
    expect(side.z).toBeCloseTo(0, 9);
  });
});
