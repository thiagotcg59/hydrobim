import { describe, expect, it } from 'vitest';
import { addPipe, createProject, drawPipe } from './operations';
import { isPipeRun, pipeRunOf, pipeRunSummary } from './pipeRun';
import type { PipeSpec, Project } from './schema';
import { vec3, type Vec3 } from './math';
import { testSpec } from './testSupport';
import { degToRad, radToDeg } from './units';

const elastic: PipeSpec = {
  ...testSpec(150, 'junta-elastica'),
  jointType: 'socketSpigot',
  jointDeflection: degToRad(5),
};

/** Polilinha desenhada ponto a ponto a partir da extremidade do trecho anterior. */
function polyline(points: readonly Vec3[]): { project: Project; ids: string[] } {
  const [first, second, ...rest] = points;
  if (!first || !second) throw new Error('faltam pontos');
  const created = addPipe(createProject('t', 'infra'), {
    start: first,
    end: second,
    spec: elastic,
  });
  if (!created.ok) throw new Error(created.error.message);
  let project = created.value.project;
  const ids = [created.value.elementId];
  let from = second;
  for (const point of rest) {
    const last = ids.at(-1);
    if (!last) break;
    const drawn = drawPipe(project, {
      fromPort: { elementId: last, portId: 'end' },
      start: from,
      end: point,
      spec: elastic,
    });
    if (!drawn.ok) throw new Error(drawn.error.message);
    project = drawn.value.project;
    ids.push(...drawn.value.createdIds);
    from = point;
  }
  return { project, ids };
}

const at = (origin: Vec3, degrees: number, length = 6): Vec3 =>
  vec3(
    origin.x + length * Math.cos(degToRad(degrees)),
    origin.y + length * Math.sin(degToRad(degrees)),
    origin.z,
  );

describe('tubulação contínua', () => {
  it('trechos ligados só pela deflexão formam uma tubulação, em ordem de percurso', () => {
    const p1 = vec3(6, 0, 0);
    const p2 = at(p1, 3);
    const p3 = at(p2, 6);
    const { project, ids } = polyline([vec3(0, 0, 0), p1, p2, p3]);
    expect(ids).toHaveLength(3);
    // De qualquer trecho se chega à mesma tubulação, na mesma ordem.
    for (const id of ids) expect(pipeRunOf(project, id)).toEqual(ids);
    expect(isPipeRun(project, ids)).toBe(true);
    expect(isPipeRun(project, [...ids].reverse())).toBe(true);
    expect(isPipeRun(project, ids.slice(0, 2))).toBe(false);

    const summary = pipeRunSummary(project, ids);
    expect(summary?.length).toBeCloseTo(18);
    expect(summary?.deflections.map((d) => Math.round(radToDeg(d) * 100) / 100)).toEqual([3, 3]);
    expect(radToDeg(summary?.maxDeflection ?? 0)).toBeCloseTo(3);
  });

  it('joelho, tê ou outro acessório interrompe a tubulação', () => {
    // 45°: acima do que a junta admite, o traçado insere um joelho.
    const p1 = vec3(6, 0, 0);
    const { project } = polyline([vec3(0, 0, 0), p1, at(p1, 45)]);
    const pipes = project.elements.filter((e) => e.kind === 'pipe');
    expect(project.elements.some((e) => e.kind === 'elbow')).toBe(true);
    expect(pipes).toHaveLength(2);
    for (const pipe of pipes) expect(pipeRunOf(project, pipe.id)).toEqual([pipe.id]);
    expect(
      isPipeRun(
        project,
        pipes.map((p) => p.id),
      ),
    ).toBe(false);
  });

  it('tubo isolado é a própria tubulação; outros elementos não formam tubulação', () => {
    const { project, ids } = polyline([vec3(0, 0, 0), vec3(6, 0, 0)]);
    const [pipeId] = ids;
    if (!pipeId) throw new Error('sem tubo');
    expect(pipeRunOf(project, pipeId)).toEqual([pipeId]);
    expect(isPipeRun(project, [pipeId])).toBe(false);
    // Uma conexão não é tubulação.
    const bent = polyline([vec3(0, 0, 0), vec3(6, 0, 0), at(vec3(6, 0, 0), 45)]).project;
    const elbow = bent.elements.find((e) => e.kind === 'elbow');
    if (!elbow) throw new Error('sem joelho');
    expect(pipeRunOf(bent, elbow.id)).toEqual([]);
    expect(pipeRunSummary(bent, [elbow.id])).toBeNull();
    expect(pipeRunOf(project, 'inexistente')).toEqual([]);
  });
});
