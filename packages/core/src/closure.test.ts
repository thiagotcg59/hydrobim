import { describe, expect, it } from 'vitest';
import { closePorts, closureCandidates } from './closure';
import { disconnect, findConnection, getFreePorts } from './connectivity';
import { addPipe, attachFitting, createProject } from './operations';
import type { HydroElement, Pipe, PortRef, Project } from './schema';
import { vec3, type Vec3 } from './math';
import { testSpec } from './testSupport';
import { degToRad, radToDeg } from './units';
import { validateProject } from './validation';

const spec = testSpec(50);

function pipe(
  project: Project,
  start: Vec3,
  end: Vec3,
  s = spec,
): { project: Project; id: string } {
  const created = addPipe(project, { start, end, spec: s });
  if (!created.ok) throw new Error(created.error.message);
  return { project: created.value.project, id: created.value.elementId };
}

const ref = (elementId: string, portId: string): PortRef => ({ elementId, portId });
const kinds = (elements: readonly HydroElement[], kind: string): HydroElement[] =>
  elements.filter((e) => e.kind === kind);

/** Dois tubos soltos: A ao longo de +X a partir da origem e B conforme os pontos dados. */
function two(bStart: Vec3, bEnd: Vec3): { project: Project; a: PortRef; b: PortRef; aId: string } {
  const first = pipe(createProject('t'), vec3(0, 0, 0), vec3(1, 0, 0));
  const second = pipe(first.project, bStart, bEnd);
  return {
    project: second.project,
    a: ref(first.id, 'end'),
    b: ref(second.id, 'start'),
    aId: first.id,
  };
}

describe('closePorts', () => {
  it('eixos colineares e opostos: prolonga o tubo de partida até a outra extremidade', () => {
    const { project, a, b } = two(vec3(3, 0, 0), vec3(4, 0, 0));
    const closed = closePorts(project, { a, b });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.value.kind).toBe('straight');
    expect(closed.value.summary).toMatch(/^prolongamento de "Tubo 1" em 2,000 m$/);
    const after = closed.value.project;
    // Sem tubo intermediário (nem junta a mais): o próprio tubo chega à outra extremidade.
    expect(kinds(after.elements, 'pipe')).toHaveLength(2);
    expect(after.connections).toHaveLength(1);
    expect(findConnection(after, a)).toBeDefined();
    expect(findConnection(after, b)).toBeDefined();
    expect(validateProject(after)).toEqual([]);
    // O projeto recebido não é alterado.
    expect(project.elements).toHaveLength(2);
    expect(project.connections).toHaveLength(0);
  });

  it('eixos que se cruzam: prolonga o tubo e fecha com um joelho no cruzamento', () => {
    const { project, a, b, aId } = two(vec3(3, 2, 0), vec3(3, 4, 0));
    const closed = closePorts(project, { a, b, elbowAngles: [degToRad(45), degToRad(90)] });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.value.kind).toBe('elbow');
    expect(radToDeg(closed.value.angle ?? 0)).toBeCloseTo(90);
    expect(closed.value.summary).toMatch(/^1 joelho de 90° e 1 tubo e prolongamento de "Tubo 1"/);
    const after = closed.value.project;
    const elbow = kinds(after.elements, 'elbow')[0];
    if (elbow?.kind !== 'elbow') throw new Error('sem joelho');
    expect(elbow.placement.position.x).toBeCloseTo(3, 9);
    expect(elbow.placement.position.y).toBeCloseTo(0, 9);
    // O tubo de partida mantém o identificador e é prolongado até o joelho.
    const extended = after.elements.find((e) => e.id === aId) as Pipe;
    expect(extended.start).toEqual(vec3(0, 0, 0));
    expect(extended.end.x).toBeGreaterThan(2.8);
    expect(extended.end.x).toBeLessThan(3);
    expect(getFreePorts(after)).toHaveLength(2);
    expect(validateProject(after)).toEqual([]);
  });

  it('recusa o cruzamento em ângulo sem joelho de catálogo', () => {
    const { project, a, b } = two(vec3(3, 2, 0), vec3(3, 4, 0));
    const closed = closePorts(project, { a, b, elbowAngles: [degToRad(45)] });
    expect(closed.ok).toBe(false);
    if (closed.ok) return;
    expect(closed.error.code).toBe('NO_ELBOW_FOR_ANGLE');
    expect(closed.error.message).toContain('Ângulos disponíveis: 45°');
  });

  it('eixos paralelos desalinhados: uma solução por ângulo de joelho que cabe', () => {
    const { project, a, b } = two(vec3(5, 1, 0), vec3(6, 1, 0));
    const options = closureCandidates(project, { a, b });
    expect(options.ok).toBe(true);
    if (!options.ok) return;
    expect(options.value.map((c) => Math.round(radToDeg(c.angle ?? 0)))).toEqual([90, 45]);
    for (const closure of options.value) {
      expect(closure.kind).toBe('offset');
      const elbows = kinds(closure.project.elements, 'elbow');
      expect(elbows).toHaveLength(2);
      for (const elbow of elbows) {
        expect(elbow.kind === 'elbow' && elbow.angle).toBeCloseTo(closure.angle ?? 0);
      }
      expect(getFreePorts(closure.project)).toHaveLength(2);
      expect(validateProject(closure.project)).toEqual([]);
    }
    expect(options.value[1]?.summary).toMatch(/^2 joelhos de 45° e 2 tubos/);

    // Com o catálogo restrito, só os ângulos existentes; o pedido fora dele é recusado.
    const only45 = closureCandidates(project, { a, b, elbowAngles: [degToRad(45)] });
    expect(only45.ok && only45.value.map((c) => Math.round(radToDeg(c.angle ?? 0)))).toEqual([45]);
    const refused = closePorts(project, {
      a,
      b,
      elbowAngles: [degToRad(45)],
      offsetAngle: degToRad(90),
    });
    expect(!refused.ok && refused.error.code).toBe('NO_ELBOW_FOR_ANGLE');
  });

  it('recusa o desvio quando o espaço entre as extremidades não comporta as peças', () => {
    // 5 cm ao longo do eixo para vencer 1 m de desvio.
    const { project, a, b } = two(vec3(1.05, 1, 0), vec3(2, 1, 0));
    const closed = closePorts(project, { a, b });
    expect(closed.ok).toBe(false);
    const only45 = closePorts(project, { a, b, elbowAngles: [degToRad(45)] });
    expect(!only45.ok && only45.error.code).toBe('NO_ROOM');
    expect(!only45.ok && only45.error.message).toContain('consome');
  });

  it('explica as geometrias sem solução', () => {
    const sameWay = two(vec3(4, 1, 0), vec3(3, 1, 0));
    const r1 = closePorts(sameWay.project, { a: sameWay.a, b: sameWay.b });
    expect(!r1.ok && r1.error.code).toBe('SAME_DIRECTION');

    const skew = two(vec3(3, 2, 0.5), vec3(3, 4, 0.5));
    const r2 = closePorts(skew.project, { a: skew.a, b: skew.b });
    expect(!r2.ok && r2.error.code).toBe('SKEW_AXES');
    expect(!r2.ok && r2.error.message).toContain('0,500 m');

    // O cruzamento dos eixos fica atrás da extremidade de A.
    const behind = two(vec3(0.5, 2, 0), vec3(0.5, 4, 0));
    const r3 = closePorts(behind.project, { a: behind.a, b: behind.b });
    expect(!r3.ok && r3.error.code).toBe('CROSSING_BEHIND');

    // Opostas, mas de costas uma para a outra.
    const backToBack = two(vec3(-3, 0, 0), vec3(-2, 0, 0));
    const r4 = closePorts(backToBack.project, { a: backToBack.a, b: backToBack.b });
    expect(!r4.ok && r4.error.code).toBe('NO_ROOM');
  });

  it('não presume compatibilidade: diâmetro, especificação e porta ocupada', () => {
    const first = pipe(createProject('t'), vec3(0, 0, 0), vec3(1, 0, 0));
    const other = pipe(first.project, vec3(3, 0, 0), vec3(4, 0, 0), testSpec(75));
    const dn = closePorts(other.project, { a: ref(first.id, 'end'), b: ref(other.id, 'start') });
    expect(!dn.ok && dn.error.code).toBe('DN_MISMATCH');

    const foreign = pipe(first.project, vec3(3, 0, 0), vec3(4, 0, 0), testSpec(50, 'outra'));
    const mismatch = closePorts(foreign.project, {
      a: ref(first.id, 'end'),
      b: ref(foreign.id, 'start'),
    });
    expect(!mismatch.ok && mismatch.error.code).toBe('SPEC_MISMATCH');

    const { project, a, b } = two(vec3(3, 0, 0), vec3(4, 0, 0));
    const closed = closePorts(project, { a, b });
    if (!closed.ok) throw new Error(closed.error.message);
    const again = closePorts(closed.value.project, { a, b });
    expect(!again.ok && again.error.code).toBe('PORT_OCCUPIED');
    const self = closePorts(project, { a, b: ref(a.elementId, 'start') });
    expect(!self.ok && self.error.code).toBe('SAME_ELEMENT');
  });

  it('extremidades já encostadas: só registra a conexão', () => {
    const first = pipe(createProject('t'), vec3(0, 0, 0), vec3(1, 0, 0));
    const second = pipe(first.project, vec3(1, 0, 0), vec3(2, 0, 0));
    const link = second.project.connections[0];
    if (!link) throw new Error('os tubos deveriam ter sido conectados');
    const open = disconnect(second.project, link.id);
    if (!open.ok) throw new Error(open.error.message);
    const closed = closePorts(open.value, { a: ref(first.id, 'end'), b: ref(second.id, 'start') });
    expect(closed.ok && closed.value.kind).toBe('coincident');
    expect(closed.ok && closed.value.project.connections).toHaveLength(1);
    expect(closed.ok && closed.value.createdIds).toEqual([]);
  });

  it('parte também da porta de uma conexão, com o trecho reto antes do joelho', () => {
    const first = pipe(createProject('t'), vec3(0, 0, 0), vec3(1, 0, 0));
    const withElbow = attachFitting(first.project, {
      target: ref(first.id, 'end'),
      fitting: { kind: 'elbow', angle: degToRad(90) },
    });
    if (!withElbow.ok) throw new Error(withElbow.error.message);
    const outlet = getFreePorts(withElbow.value.project).find(
      (p) => p.ref.elementId === withElbow.value.elementId,
    );
    if (!outlet) throw new Error('joelho sem saída livre');
    // Tubo de frente para a saída do joelho, 2 m adiante.
    const far = {
      x: outlet.position.x + outlet.direction.x * 3,
      y: outlet.position.y + outlet.direction.y * 3,
      z: outlet.position.z + outlet.direction.z * 3,
    };
    const near = {
      x: outlet.position.x + outlet.direction.x * 2,
      y: outlet.position.y + outlet.direction.y * 2,
      z: outlet.position.z + outlet.direction.z * 2,
    };
    const target = pipe(withElbow.value.project, near, far);
    const closed = closePorts(target.project, { a: outlet.ref, b: ref(target.id, 'start') });
    expect(closed.ok && closed.value.kind).toBe('straight');
    expect(closed.ok && validateProject(closed.value.project)).toEqual([]);
    expect(closed.ok && getFreePorts(closed.value.project)).toHaveLength(2);
  });
});
