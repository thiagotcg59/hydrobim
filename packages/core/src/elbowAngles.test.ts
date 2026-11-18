import { describe, expect, it } from 'vitest';
import {
  availableElbowAngles,
  constrainDeflection,
  formatAngleList,
  matchElbowAngle,
} from './elbowAngles';
import { createFamilyCatalog } from './families';
import { angleBetween, AXIS_X, distance, sub, vec3 } from './math';
import { addPipe, createProject, drawPipe } from './operations';
import type { FittingFamily } from './schema';
import { testSpec } from './testSupport';
import { degToRad } from './units';
import { validateProject } from './validation';

const spec = testSpec(50);

function elbowFamily(id: string, angleDeg: number, dns: number[]): FittingFamily {
  return {
    id,
    name: `Joelho ${angleDeg}°`,
    kind: 'elbow',
    specificationId: spec.specificationId,
    endType: 'plain',
    angle: degToRad(angleDeg),
    manufacturer: null,
    standard: 'Teste',
    source: 'Família de teste',
    origin: 'builtin',
    sizes: dns.map((dn) => ({ dn, centerToEnd: 0.05 })),
  };
}

const families = [
  elbowFamily('j90', 90, [50, 75]),
  elbowFamily('j45', 45, [50]),
  elbowFamily('j45-b', 45, [50]),
  elbowFamily('j22', 22.5, [75]),
];
const angles = availableElbowAngles(families, spec);

describe('availableElbowAngles', () => {
  it('lista, sem repetição e em ordem, os ângulos com peça para o diâmetro', () => {
    expect(formatAngleList(angles)).toBe('45°, 90°');
    expect(formatAngleList(availableElbowAngles(families, testSpec(75)))).toBe('22,5°, 90°');
  });

  it('devolve lista vazia quando não há família para a especificação ou o diâmetro', () => {
    expect(availableElbowAngles(families, testSpec(50, 'outra'))).toEqual([]);
    expect(availableElbowAngles(families, testSpec(100))).toEqual([]);
  });

  it('reconhece a deflexão dentro da tolerância', () => {
    expect(matchElbowAngle(angles, degToRad(90.2))).toBeCloseTo(degToRad(90));
    expect(matchElbowAngle(angles, degToRad(60))).toBeNull();
  });
});

describe('constrainDeflection', () => {
  const origin = vec3(2, 0, 1);

  it('trava no ângulo de catálogo mais próximo, no plano do ponto pedido', () => {
    const near90 = constrainDeflection(origin, AXIS_X, vec3(2.3, 2, 1), angles);
    expect(angleBetween(AXIS_X, sub(near90, origin))).toBeCloseTo(degToRad(90));
    expect(near90.x).toBeCloseTo(2);
    expect(near90.y).toBeCloseTo(2);
    expect(near90.z).toBeCloseTo(1);

    const near45 = constrainDeflection(origin, AXIS_X, vec3(4, -1.6, 1), angles);
    expect(angleBetween(AXIS_X, sub(near45, origin))).toBeCloseTo(degToRad(45));
    expect(near45.y).toBeLessThan(0);
    expect(near45.z).toBeCloseTo(1);
  });

  it('prolonga em linha reta quando o desvio é pequeno', () => {
    const straight = constrainDeflection(origin, AXIS_X, vec3(5, 0.4, 1), angles);
    expect(straight).toEqual(vec3(5, 0, 1));
  });

  it('arredonda o comprimento ao passo informado', () => {
    const point = constrainDeflection(origin, AXIS_X, vec3(2.1, 1.93, 1), angles, 0.5);
    expect(distance(origin, point)).toBeCloseTo(2);
  });

  it('trava também fora do plano horizontal (prumada)', () => {
    const up = constrainDeflection(origin, AXIS_X, vec3(2.05, 0, 3), angles);
    expect(up.x).toBeCloseTo(2);
    expect(up.z).toBeCloseTo(3);
  });

  it('sem joelho de catálogo, só prolonga em linha reta', () => {
    expect(constrainDeflection(origin, AXIS_X, vec3(3, 1, 1), [])).toEqual(vec3(3, 0, 1));
    expect(constrainDeflection(origin, AXIS_X, vec3(2.4, 3, 1), [])).toEqual(vec3(2.4, 0, 1));
  });

  it('não altera o ponto com direção indefinida', () => {
    expect(constrainDeflection(origin, AXIS_X, origin, angles)).toBe(origin);
    const back = vec3(0, 0, 1);
    expect(constrainDeflection(origin, AXIS_X, back, angles)).toBe(back);
  });
});

describe('drawPipe com ângulos de catálogo', () => {
  const catalog = createFamilyCatalog(families);
  const base = addPipe(createProject('Teste'), { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec });
  if (!base.ok) throw new Error(base.error.message);
  const fromPort = { elementId: base.value.elementId, portId: 'end' };

  it('recusa a deflexão sem peça e informa os ângulos disponíveis', () => {
    const result = drawPipe(base.value.project, {
      fromPort,
      start: vec3(2, 0, 0),
      end: vec3(3, 2, 0),
      spec,
      catalog,
      elbowAngles: angles,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NO_ELBOW_FOR_ANGLE');
    expect(result.error.message).toContain('45°, 90°');
  });

  it('aceita a deflexão de catálogo e o prolongamento reto', () => {
    const turn = drawPipe(base.value.project, {
      fromPort,
      start: vec3(2, 0, 0),
      end: vec3(4, 2, 0),
      spec,
      catalog,
      elbowAngles: angles,
    });
    expect(turn.ok).toBe(true);
    if (!turn.ok) return;
    const elbow = turn.value.project.elements.find((e) => e.kind === 'elbow');
    expect(elbow?.familyId).toBe('j45');
    expect(validateProject(turn.value.project)).toEqual([]);

    const straight = drawPipe(base.value.project, {
      fromPort,
      start: vec3(2, 0, 0),
      end: vec3(5, 0, 0),
      spec,
      elbowAngles: angles,
    });
    expect(straight.ok).toBe(true);
  });

  it('mantém o ângulo livre quando a lista não é informada', () => {
    const result = drawPipe(base.value.project, {
      fromPort,
      start: vec3(2, 0, 0),
      end: vec3(3, 2, 0),
      spec,
      catalog,
    });
    expect(result.ok).toBe(true);
  });
});
