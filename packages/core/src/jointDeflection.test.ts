import { describe, expect, it } from 'vitest';
import { closePorts, closureCandidates } from './closure';
import {
  alignmentTolerance,
  checkPortCompatibility,
  findConnection,
  jointDeflectionLimit,
  resolvePort,
} from './connectivity';
import { ANGLE_TOLERANCE } from './dimensions';
import { constrainDeflection, straightSnapOf } from './elbowAngles';
import { angleBetween, sub, vec3, type Vec3 } from './math';
import { addPipe, createProject, drawPipe, setPipeEndpoint } from './operations';
import type { EndTreatment, PipeSpec, PortRef, Project } from './schema';
import { parseProject, serializeProject } from './serialization';
import { testSpec } from './testSupport';
import { degToRad } from './units';
import { validateProject } from './validation';

/** Especificação de junta elástica que admite 5° por junta (como dado de catálogo). */
const elastic: PipeSpec = {
  ...testSpec(150, 'junta-elastica'),
  jointType: 'socketSpigot',
  jointDeflection: degToRad(5),
};
/** Mesma especificação sem o dado: junta rígida. */
const rigid: PipeSpec = { ...testSpec(150, 'junta-rigida') };

const ref = (elementId: string, portId: string): PortRef => ({ elementId, portId });
const flange: EndTreatment = { type: 'flange', length: 0.02, outerDiameter: 0.285 };

/** Ponto a `length` da origem, com deflexão `degrees` no plano XY em relação a +X. */
const at = (origin: Vec3, degrees: number, length = 6): Vec3 =>
  vec3(
    origin.x + length * Math.cos(degToRad(degrees)),
    origin.y + length * Math.sin(degToRad(degrees)),
    origin.z,
  );

function firstPipe(spec: PipeSpec): { project: Project; end: PortRef; id: string } {
  const created = addPipe(createProject('t', 'infra'), {
    start: vec3(0, 0, 0),
    end: vec3(6, 0, 0),
    spec,
  });
  if (!created.ok) throw new Error(created.error.message);
  return {
    project: created.value.project,
    end: ref(created.value.elementId, 'end'),
    id: created.value.elementId,
  };
}

describe('limite de deflexão da junta', () => {
  it('vem da especificação; sem o dado ou com flange a junta é rígida', () => {
    const side = (spec: PipeSpec, end: EndTreatment | null = null) => ({ spec, end });
    expect(jointDeflectionLimit(side(elastic), side(elastic))).toBeCloseTo(degToRad(5));
    expect(jointDeflectionLimit(side(elastic), side(rigid))).toBe(0);
    expect(jointDeflectionLimit(side(elastic, flange), side(elastic))).toBe(0);
    // Vale o menor dos dois lados.
    const tighter = { ...elastic, jointDeflection: degToRad(3) };
    expect(jointDeflectionLimit(side(elastic), side(tighter))).toBeCloseTo(degToRad(3));
    // Junta rígida mantém a tolerância geométrica de sempre.
    expect(alignmentTolerance(side(rigid), side(rigid))).toBe(ANGLE_TOLERANCE);
  });
});

describe('drawPipe com deflexão na junta', () => {
  it('dentro do limite: um tubo conectado direto, sem joelho', () => {
    const { project, end } = firstPipe(elastic);
    const drawn = drawPipe(project, {
      fromPort: end,
      start: vec3(6, 0, 0),
      end: at(vec3(6, 0, 0), 3),
      spec: elastic,
      // Mesmo com a trava de ângulos de catálogo, a junta dispensa a peça.
      elbowAngles: [degToRad(11.25), degToRad(22.5), degToRad(45), degToRad(90)],
    });
    expect(drawn.ok).toBe(true);
    if (!drawn.ok) return;
    expect(drawn.value.createdIds).toHaveLength(1);
    const after = drawn.value.project;
    expect(after.elements.map((e) => e.kind)).toEqual(['pipe', 'pipe']);
    expect(findConnection(after, end)).toBeDefined();
    expect(validateProject(after)).toEqual([]);
    // O tubo de origem não foi aparado: não há joelho a acomodar.
    const host = resolvePort(after, end);
    expect(host?.position).toEqual(vec3(6, 0, 0));
    // O projeto recebido não é alterado.
    expect(project.elements).toHaveLength(1);
  });

  it('no limite exato a junta ainda aceita', () => {
    const { project, end } = firstPipe(elastic);
    const drawn = drawPipe(project, {
      fromPort: end,
      start: vec3(6, 0, 0),
      end: at(vec3(6, 0, 0), 5),
      spec: elastic,
      elbowAngles: [degToRad(45)],
    });
    expect(drawn.ok && drawn.value.createdIds).toHaveLength(1);
  });

  it('acima do limite: exige joelho de catálogo e informa o que a junta admite', () => {
    const { project, end } = firstPipe(elastic);
    const refused = drawPipe(project, {
      fromPort: end,
      start: vec3(6, 0, 0),
      end: at(vec3(6, 0, 0), 7),
      spec: elastic,
      elbowAngles: [degToRad(11.25), degToRad(45)],
    });
    expect(!refused.ok && refused.error.code).toBe('NO_ELBOW_FOR_ANGLE');
    expect(!refused.ok && refused.error.message).toContain('a junta admite deflexão de até 5°');
    // Com ângulo de catálogo, o joelho continua sendo criado.
    const elbow = drawPipe(project, {
      fromPort: end,
      start: vec3(6, 0, 0),
      end: at(vec3(6, 0, 0), 45),
      spec: elastic,
      elbowAngles: [degToRad(11.25), degToRad(45)],
    });
    expect(elbow.ok && elbow.value.createdIds).toHaveLength(2);
  });

  it('junta rígida: a mesma deflexão é recusada', () => {
    const { project, end } = firstPipe(rigid);
    const refused = drawPipe(project, {
      fromPort: end,
      start: vec3(6, 0, 0),
      end: at(vec3(6, 0, 0), 3),
      spec: rigid,
      elbowAngles: [degToRad(45)],
    });
    expect(!refused.ok && refused.error.code).toBe('NO_ELBOW_FOR_ANGLE');
    expect(!refused.ok && refused.error.message).not.toContain('a junta admite');
  });

  it('tubo novo com flange na partida não deflete', () => {
    const { project, end } = firstPipe(elastic);
    const refused = drawPipe(project, {
      fromPort: end,
      start: vec3(6, 0, 0),
      end: at(vec3(6, 0, 0), 3),
      spec: elastic,
      elbowAngles: [degToRad(45)],
      ends: { familyId: 'tubo-flangeado', start: flange, end: null },
    });
    expect(!refused.ok && refused.error.code).toBe('NO_ELBOW_FOR_ANGLE');
  });
});

describe('acoplamento e validação com deflexão', () => {
  function deflected(degrees: number): { project: Project; second: string; joint: PortRef } {
    const { project, end } = firstPipe(elastic);
    const drawn = drawPipe(project, {
      fromPort: end,
      start: vec3(6, 0, 0),
      end: at(vec3(6, 0, 0), degrees),
      spec: elastic,
    });
    if (!drawn.ok) throw new Error(drawn.error.message);
    return { project: drawn.value.project, second: drawn.value.elementId, joint: end };
  }

  it('mover a extremidade livre mantém a junta enquanto a deflexão couber', () => {
    const { project, second, joint } = deflected(2);
    const within = setPipeEndpoint(project, second, 'end', at(vec3(6, 0, 0), 4.5));
    expect(within.ok).toBe(true);
    if (!within.ok) return;
    expect(findConnection(within.value, joint)).toBeDefined();
    expect(validateProject(within.value)).toEqual([]);

    const beyond = setPipeEndpoint(project, second, 'end', at(vec3(6, 0, 0), 8));
    expect(!beyond.ok && beyond.error.code).toBe('COUPLING_BROKEN');
  });

  it('deflexão acima do limite da especificação é erro de validação', () => {
    const { project } = deflected(4);
    // O mesmo projeto com um limite menor na especificação (ex.: dado de catálogo revisto).
    const tighter: Project = {
      ...project,
      elements: project.elements.map((e) => ({
        ...e,
        spec: { ...e.spec, jointDeflection: degToRad(3) },
      })),
    };
    const issues = validateProject(tighter);
    expect(issues.map((i) => i.code)).toEqual(['DIRECTION_MISMATCH']);
    expect(issues[0]?.message).toContain('deflexão de 4°');
    expect(issues[0]?.message).toContain('a junta admite até 3°');
  });

  it('a compatibilidade entre portas usa o limite da junta', () => {
    const { project, second, joint } = deflected(4);
    const a = resolvePort(project, joint);
    const b = resolvePort(project, ref(second, 'start'));
    if (!a || !b) throw new Error('sem portas');
    expect(checkPortCompatibility(a, b)).toEqual([]);
    const stiff = { ...b, spec: rigid };
    expect(checkPortCompatibility(a, stiff).map((i) => i.code)).toContain('DIRECTION_MISMATCH');
  });

  it('o limite acompanha o projeto ao salvar e reabrir', () => {
    const { project } = deflected(4);
    const reopened = parseProject(serializeProject(project));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.value.elements[0]?.spec.jointDeflection).toBeCloseTo(degToRad(5));
    expect(validateProject(reopened.value)).toEqual([]);
  });
});

describe('trava de ângulo do cursor com deflexão na junta', () => {
  const origin = vec3(6, 0, 0);
  const axis = vec3(1, 0, 0);
  const angles = [degToRad(11.25), degToRad(22.5), degToRad(45), degToRad(90)];
  const limit = degToRad(5);
  const deflectionOf = (point: Vec3): number => angleBetween(axis, sub(point, origin));

  it('perto do eixo o trecho continua reto', () => {
    expect(straightSnapOf(limit)).toBeCloseTo(degToRad(1));
    expect(straightSnapOf(degToRad(1))).toBeCloseTo(degToRad(0.5));
    const point = constrainDeflection(origin, axis, at(origin, 0.6), angles, 0, limit);
    expect(deflectionOf(point)).toBeCloseTo(0);
  });

  it('dentro do cone da junta o ponto pedido é mantido', () => {
    const target = at(origin, 3.2);
    expect(constrainDeflection(origin, axis, target, angles, 0, limit)).toBe(target);
  });

  it('acima do limite vale o mais próximo entre o limite e os ângulos de catálogo', () => {
    const nearLimit = constrainDeflection(origin, axis, at(origin, 6), angles, 0, limit);
    expect(deflectionOf(nearLimit)).toBeCloseTo(limit);
    const nearElbow = constrainDeflection(origin, axis, at(origin, 10), angles, 0, limit);
    expect(deflectionOf(nearElbow)).toBeCloseTo(degToRad(11.25));
  });

  it('junta rígida: comportamento anterior (reto ou ângulo de catálogo)', () => {
    const point = constrainDeflection(origin, axis, at(origin, 3.2), angles);
    expect(deflectionOf(point)).toBeCloseTo(0);
  });
});

describe('fechamento com deflexão nas juntas', () => {
  function facing(spec: PipeSpec, offset: number): { project: Project; a: PortRef; b: PortRef } {
    const first = addPipe(createProject('t', 'infra'), {
      start: vec3(0, 0, 0),
      end: vec3(6, 0, 0),
      spec,
    });
    if (!first.ok) throw new Error(first.error.message);
    const second = addPipe(first.value.project, {
      start: vec3(12, offset, 0),
      end: vec3(18, offset, 0),
      spec,
    });
    if (!second.ok) throw new Error(second.error.message);
    return {
      project: second.value.project,
      a: ref(first.value.elementId, 'end'),
      b: ref(second.value.elementId, 'start'),
    };
  }

  it('desalinhamento pequeno: um tubo direto, com a deflexão informada', () => {
    // 0,30 m em 6 m: 2,86° em cada junta.
    const { project, a, b } = facing(elastic, 0.3);
    const closed = closePorts(project, { a, b, elbowAngles: [degToRad(45), degToRad(90)] });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.value.kind).toBe('deflected');
    expect(closed.value.createdIds).toHaveLength(1);
    expect(closed.value.summary).toBe(
      '1 tubo com deflexão de 2,86° e 2,86° nas juntas (admitida: 5°)',
    );
    const after = closed.value.project;
    expect(after.elements.every((e) => e.kind === 'pipe')).toBe(true);
    expect(findConnection(after, a)).toBeDefined();
    expect(findConnection(after, b)).toBeDefined();
    expect(validateProject(after)).toEqual([]);
    // A solução com joelhos continua disponível, depois da que dispensa peça.
    const all = closureCandidates(project, { a, b, elbowAngles: [degToRad(45), degToRad(90)] });
    const listed = all.ok ? all.value.map((c) => c.kind) : [];
    expect(listed[0]).toBe('deflected');
    expect(listed.length).toBeGreaterThan(1);
    expect(listed.slice(1).every((kind) => kind === 'offset')).toBe(true);
    const chosen = closePorts(project, { a, b, offsetAngle: degToRad(45) });
    expect(chosen.ok && chosen.value.kind).toBe('offset');
  });

  it('desalinhamento além do que a junta admite: só a solução com joelhos', () => {
    const { project, a, b } = facing(elastic, 1);
    const all = closureCandidates(project, { a, b });
    expect(all.ok && all.value.every((c) => c.kind === 'offset')).toBe(true);
  });

  it('junta rígida não fecha por deflexão', () => {
    const { project, a, b } = facing(rigid, 0.3);
    const all = closureCandidates(project, { a, b });
    expect(all.ok && all.value.some((c) => c.kind === 'deflected')).toBe(false);
  });
});
