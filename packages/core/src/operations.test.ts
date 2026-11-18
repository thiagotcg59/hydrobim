import { describe, expect, it } from 'vitest';
import {
  arePortsAligned,
  connectPorts,
  connectedComponent,
  disconnect,
  findConnection,
  getElement,
  getFreePorts,
  resolvePort,
} from './connectivity';
import { defaultBendRadius, elbowLegLength } from './dimensions';
import { angleBetween, distance, vec3 } from './math';
import {
  addPipe,
  attachFitting,
  createProject,
  deleteElements,
  drawPipe,
  drawPipeFromPipe,
  drawPipeToPipe,
  elementElevation,
  insertInline,
  placeEquipment,
  rollFitting,
  setElementElevation,
  setPipeEndpoint,
  setPipeLength,
  translateElements,
  updateFitting,
} from './operations';
import { getPort, pipeLength } from './ports';
import { applySpec } from './sizing';
import type { Result } from './result';
import type { Pipe, Project } from './schema';
import { testSpec } from './testSupport';
import { degToRad } from './units';
import { validateProject } from './validation';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

const spec50 = testSpec(50);

function pipeOf(project: Project, id: string): Pipe {
  const element = getElement(project, id);
  if (!element || element.kind !== 'pipe') throw new Error('não é tubo');
  return element;
}

/** Todas as conexões do projeto devem estar geometricamente acopladas. */
function expectCoupled(project: Project): void {
  for (const c of project.connections) {
    const a = resolvePort(project, c.a);
    const b = resolvePort(project, c.b);
    expect(a && b && arePortsAligned(a, b)).toBe(true);
  }
  expect(validateProject(project).filter((i) => i.severity === 'error')).toEqual([]);
}

describe('tubos', () => {
  it('cria um tubo com identificador persistente e comprimento geométrico', () => {
    const p0 = createProject('Teste');
    const { project, elementId } = unwrap(
      addPipe(p0, { start: vec3(0, 0, 0), end: vec3(3, 4, 12), spec: spec50 }),
    );
    const pipe = pipeOf(project, elementId);
    expect(pipe.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(pipeLength(pipe)).toBeCloseTo(13);
    expect(pipe.name).toBe('Tubo 1');
    expect(p0.elements).toHaveLength(0); // imutabilidade
  });

  it('recusa tubos sem comprimento ou com coordenadas inválidas', () => {
    const p0 = createProject('Teste');
    expect(addPipe(p0, { start: vec3(1, 1, 1), end: vec3(1, 1, 1), spec: spec50 }).ok).toBe(false);
    expect(addPipe(p0, { start: vec3(0, 0, 0), end: vec3(NaN, 0, 0), spec: spec50 }).ok).toBe(
      false,
    );
  });

  it('conecta automaticamente tubos colineares de mesma especificação', () => {
    let project = createProject('Teste');
    project = unwrap(
      addPipe(project, { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec: spec50 }),
    ).project;
    project = unwrap(
      addPipe(project, { start: vec3(2, 0, 0), end: vec3(5, 0, 0), spec: spec50 }),
    ).project;
    expect(project.connections).toHaveLength(1);
    expect(getFreePorts(project)).toHaveLength(2);
  });

  it('não conecta diâmetros diferentes e sinaliza a pendência', () => {
    let project = createProject('Teste');
    project = unwrap(
      addPipe(project, { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec: spec50 }),
    ).project;
    project = unwrap(
      addPipe(project, { start: vec3(2, 0, 0), end: vec3(5, 0, 0), spec: testSpec(100) }),
    ).project;
    expect(project.connections).toHaveLength(0);
    expect(validateProject(project).map((i) => i.code)).toContain('COINCIDENT_UNCONNECTED');
  });

  it('altera o comprimento movendo a extremidade livre', () => {
    let project = createProject('Teste');
    const a = unwrap(addPipe(project, { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec: spec50 }));
    project = unwrap(setPipeLength(a.project, a.elementId, 3.5));
    expect(pipeOf(project, a.elementId).end).toEqual(vec3(3.5, 0, 0));
  });
});

describe('desenho a partir de portas', () => {
  it('insere joelho automático com o ângulo exato ao mudar de direção', () => {
    let project = createProject('Teste');
    const a = unwrap(addPipe(project, { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec: spec50 }));
    const drawn = unwrap(
      drawPipe(a.project, {
        fromPort: { elementId: a.elementId, portId: 'end' },
        start: vec3(0, 0, 0),
        end: vec3(2, 0, 3),
        spec: testSpec(100), // ignorada: herda a especificação da porta
      }),
    );
    project = drawn.project;
    expect(drawn.createdIds).toHaveLength(2);
    const elbow = project.elements.find((e) => e.kind === 'elbow');
    expect(elbow?.kind === 'elbow' && elbow.angle).toBeCloseTo(Math.PI / 2);
    const leg = elbowLegLength(Math.PI / 2, defaultBendRadius(spec50));
    expect(pipeOf(project, a.elementId).end.x).toBeCloseTo(2 - leg);
    const riser = pipeOf(project, drawn.elementId);
    expect(riser.spec.dn).toBe(50);
    expect(riser.start.z).toBeCloseTo(leg);
    expect(riser.end).toEqual(vec3(2, 0, 3));
    expect(project.connections).toHaveLength(2);
    expectCoupled(project);
  });

  it('desenha uma rede com três tubos em orientações distintas, toda conectada', () => {
    let project = createProject('Teste');
    const a = unwrap(addPipe(project, { start: vec3(0, 0, 0), end: vec3(3, 0, 0), spec: spec50 }));
    const b = unwrap(
      drawPipe(a.project, {
        fromPort: { elementId: a.elementId, portId: 'end' },
        start: vec3(0, 0, 0),
        end: vec3(3, 2.5, 0),
        spec: spec50,
      }),
    );
    const c = unwrap(
      drawPipe(b.project, {
        fromPort: { elementId: b.elementId, portId: 'end' },
        start: vec3(0, 0, 0),
        end: vec3(4, 3.5, 2),
        spec: spec50,
      }),
    );
    project = c.project;
    expect(project.elements.filter((e) => e.kind === 'pipe')).toHaveLength(3);
    expect(project.elements.filter((e) => e.kind === 'elbow')).toHaveLength(2);
    expect(connectedComponent(project, a.elementId)).toHaveLength(5);
    expectCoupled(project);
  });

  it('continua em linha reta sem joelho', () => {
    const p0 = createProject('Teste');
    const a = unwrap(addPipe(p0, { start: vec3(0, 0, 0), end: vec3(1, 1, 1), spec: spec50 }));
    const b = unwrap(
      drawPipe(a.project, {
        fromPort: { elementId: a.elementId, portId: 'end' },
        start: vec3(0, 0, 0),
        end: vec3(2, 2, 2),
        spec: spec50,
      }),
    );
    expect(b.project.elements).toHaveLength(2);
    expect(b.project.connections).toHaveLength(1);
  });

  it('recusa deflexões muito fechadas e saídas fora do eixo de conexões', () => {
    const p0 = createProject('Teste');
    const a = unwrap(addPipe(p0, { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec: spec50 }));
    const sharp = drawPipe(a.project, {
      fromPort: { elementId: a.elementId, portId: 'end' },
      start: vec3(0, 0, 0),
      end: vec3(0, 0.2, 0),
      spec: spec50,
    });
    expect(sharp.ok ? '' : sharp.error.code).toBe('ANGLE_TOO_SHARP');

    const valve = unwrap(
      attachFitting(a.project, {
        target: { elementId: a.elementId, portId: 'end' },
        fitting: { kind: 'valve' },
      }),
    );
    const offAxis = drawPipe(valve.project, {
      fromPort: { elementId: valve.elementId, portId: 'b' },
      start: vec3(0, 0, 0),
      end: vec3(5, 5, 0),
      spec: spec50,
    });
    expect(offAxis.ok ? '' : offAxis.error.code).toBe('OFF_AXIS');
  });
});

describe('conexões', () => {
  it('acopla um joelho a uma extremidade livre em qualquer orientação', () => {
    for (const end of [vec3(2, 0, 0), vec3(0, 0, 3), vec3(0, 0, -3), vec3(1, -2, 0.5)]) {
      const p0 = createProject('Teste');
      const a = unwrap(addPipe(p0, { start: vec3(0, 0, 0), end, spec: spec50 }));
      const elbow = unwrap(
        attachFitting(a.project, {
          target: { elementId: a.elementId, portId: 'end' },
          fitting: { kind: 'elbow', angle: degToRad(45) },
        }),
      );
      expect(elbow.project.connections).toHaveLength(1);
      expectCoupled(elbow.project);
      const el = getElement(elbow.project, elbow.elementId)!;
      const portA = getPort(el, 'a')!;
      const portB = getPort(el, 'b')!;
      // A saída desvia exatamente 45° do sentido de entrada.
      expect(
        angleBetween(portB.direction, {
          x: -portA.direction.x,
          y: -portA.direction.y,
          z: -portA.direction.z,
        }),
      ).toBeCloseTo(degToRad(45));
    }
  });

  it('gira o joelho em torno do eixo da porta conectada', () => {
    const p0 = createProject('Teste');
    const a = unwrap(addPipe(p0, { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec: spec50 }));
    const elbow = unwrap(
      attachFitting(a.project, {
        target: { elementId: a.elementId, portId: 'end' },
        fitting: { kind: 'elbow' },
      }),
    );
    // Orientação padrão: curva no plano horizontal.
    const before = getPort(getElement(elbow.project, elbow.elementId)!, 'b')!;
    expect(Math.abs(before.direction.z)).toBeLessThan(1e-9);
    const rolled = unwrap(rollFitting(elbow.project, elbow.elementId, 'a', Math.PI / 2));
    const after = getPort(getElement(rolled, elbow.elementId)!, 'b')!;
    expect(Math.abs(after.direction.z)).toBeCloseTo(1);
    expectCoupled(rolled);
  });

  it('recusa girar quando outra porta conectada sairia do lugar', () => {
    const p0 = createProject('Teste');
    const a = unwrap(addPipe(p0, { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec: spec50 }));
    const b = unwrap(
      drawPipe(a.project, {
        fromPort: { elementId: a.elementId, portId: 'end' },
        start: vec3(0, 0, 0),
        end: vec3(2, 2, 0),
        spec: spec50,
      }),
    );
    const elbowId = b.createdIds[0]!;
    const result = rollFitting(b.project, elbowId, 'a', Math.PI / 2);
    expect(result.ok ? '' : result.error.code).toBe('COUPLING_BROKEN');
  });

  it('insere tê em linha dividindo o tubo e preservando a conexão a jusante', () => {
    let project = createProject('Teste');
    const a = unwrap(addPipe(project, { start: vec3(0, 0, 0), end: vec3(4, 0, 0), spec: spec50 }));
    const b = unwrap(
      addPipe(a.project, { start: vec3(4, 0, 0), end: vec3(6, 0, 0), spec: spec50 }),
    );
    const tee = unwrap(
      insertInline(b.project, {
        pipeId: a.elementId,
        distanceFromStart: 1.5,
        fitting: { kind: 'tee' },
      }),
    );
    project = tee.project;
    expect(project.elements).toHaveLength(4);
    expect(project.connections).toHaveLength(3);
    const first = pipeOf(project, a.elementId);
    const teeEl = getElement(project, tee.elementId)!;
    expect(teeEl.kind).toBe('tee');
    expect(distance(first.end, getPort(teeEl, 'a')!.position)).toBeLessThan(1e-9);
    // O segundo trecho herdou a conexão com o tubo b.
    const secondId = tee.createdIds[1]!;
    const link = findConnection(project, { elementId: secondId, portId: 'end' });
    expect(link && [link.a.elementId, link.b.elementId]).toContain(b.elementId);
    // Derivação livre e perpendicular à passagem.
    const branch = getPort(teeEl, 'branch')!;
    expect(angleBetween(branch.direction, vec3(1, 0, 0))).toBeCloseTo(Math.PI / 2);
    expect(getFreePorts(project).map((p) => p.ref.portId)).toContain('branch');
    expectCoupled(project);

    // O tê em linha pode girar em torno da passagem.
    const rolled = unwrap(rollFitting(project, tee.elementId, 'a', Math.PI / 2));
    expectCoupled(rolled);
  });

  it('termina o tubo sobre outro com tê automático na perpendicular', () => {
    const p0 = createProject('Teste');
    const main = unwrap(addPipe(p0, { start: vec3(0, 0, 1), end: vec3(4, 0, 1), spec: spec50 }));
    const next = unwrap(
      addPipe(main.project, { start: vec3(4, 0, 1), end: vec3(6, 0, 1), spec: spec50 }),
    );
    // Ponto de partida livre, em outra cota: a derivação aponta para ele (tê girado).
    const drawn = unwrap(
      drawPipeToPipe(next.project, {
        start: vec3(1.5, 2, 2),
        targetPipeId: main.elementId,
        spec: testSpec(25),
      }),
    );
    const project = drawn.project;
    expect(project.elements.map((e) => e.kind).sort()).toEqual([
      'pipe',
      'pipe',
      'pipe',
      'pipe',
      'tee',
    ]);
    const tee = project.elements.find((e) => e.kind === 'tee')!;
    expect(tee.kind === 'tee' && tee.branchSpec?.dn).toBe(25);
    const run = getPort(tee, 'a')!;
    const branch = getPort(tee, 'branch')!;
    // Centro do tê no pé da perpendicular; derivação voltada para o ponto de partida.
    expect(distance(run.position, vec3(1.5, 0, 1))).toBeCloseTo(
      distance(run.position, getPort(tee, 'b')!.position) / 2,
    );
    expect(angleBetween(branch.direction, vec3(0, 2, 1))).toBeLessThan(1e-9);
    const pipe = pipeOf(project, drawn.elementId);
    expect(pipe.start).toEqual(vec3(1.5, 2, 2));
    expect(distance(pipe.end, branch.position)).toBeLessThan(1e-9);
    expect(pipe.spec.dn).toBe(25);
    expect(pipe.systemId).toBe(pipeOf(project, main.elementId).systemId);
    // Nenhuma porta fica solta sobre o tubo: só as três pontas da rede.
    expect(getFreePorts(project)).toHaveLength(3);
    expect(connectedComponent(project, drawn.elementId)).toHaveLength(5);
    // O tubo original mantém o id e a conexão a jusante passa ao segundo trecho.
    expect(pipeOf(project, main.elementId).start).toEqual(vec3(0, 0, 1));
    expectCoupled(project);
    expect(validateProject(project)).toEqual([]);
    // O projeto recebido não é alterado.
    expect(next.project.elements).toHaveLength(2);
  });

  it('liga a extremidade de um tubo a outro com joelho e tê automáticos', () => {
    const p0 = createProject('Teste');
    const main = unwrap(addPipe(p0, { start: vec3(0, 2, 0), end: vec3(6, 2, 0), spec: spec50 }));
    const stub = unwrap(
      addPipe(main.project, { start: vec3(0, 0, 0), end: vec3(3, 0, 0), spec: spec50 }),
    );
    const drawn = unwrap(
      drawPipeToPipe(stub.project, {
        fromPort: { elementId: stub.elementId, portId: 'end' },
        start: vec3(3, 0, 0),
        targetPipeId: main.elementId,
        spec: testSpec(25),
        elbowAngles: [degToRad(90)],
      }),
    );
    const kinds = drawn.project.elements.map((e) => e.kind).sort();
    expect(kinds).toEqual(['elbow', 'pipe', 'pipe', 'pipe', 'pipe', 'tee']);
    // O trecho herda a especificação da porta de origem: tê sem redução.
    const tee = drawn.project.elements.find((e) => e.kind === 'tee')!;
    expect(tee.kind === 'tee' && tee.branchSpec).toBeUndefined();
    expect(getFreePorts(drawn.project)).toHaveLength(3);
    expectCoupled(drawn.project);
    expect(validateProject(drawn.project)).toEqual([]);
  });

  it('parte de um ponto sobre um tubo com tê automático voltado para o ponto final', () => {
    const p0 = createProject('Teste');
    const main = unwrap(addPipe(p0, { start: vec3(0, 0, 1), end: vec3(4, 0, 1), spec: spec50 }));
    const drawn = unwrap(
      drawPipeFromPipe(main.project, {
        sourcePipeId: main.elementId,
        distanceFromStart: 1.5,
        // A componente ao longo do tubo (0,8 m) é descartada: a derivação sai a 90°.
        end: vec3(2.3, 0, 3),
        spec: testSpec(25),
      }),
    );
    const project = drawn.project;
    const tee = project.elements.find((e) => e.kind === 'tee')!;
    expect(tee.kind === 'tee' && tee.branchSpec?.dn).toBe(25);
    const branch = getPort(tee, 'branch')!;
    expect(angleBetween(branch.direction, vec3(0, 0, 1))).toBeLessThan(1e-9);
    const pipe = pipeOf(project, drawn.elementId);
    expect(distance(pipe.start, branch.position)).toBeLessThan(1e-9);
    expect(distance(pipe.end, vec3(1.5, 0, 3))).toBeLessThan(1e-9);
    expect(pipe.spec.dn).toBe(25);
    expect(pipeOf(project, main.elementId).start).toEqual(vec3(0, 0, 1));
    expect(getFreePorts(project)).toHaveLength(3);
    expect(connectedComponent(project, drawn.elementId)).toHaveLength(4);
    expectCoupled(project);
    expect(validateProject(project)).toEqual([]);
    expect(main.project.elements).toHaveLength(1);
  });

  it('liga dois tubos com um tê em cada um e recusa quando não são perpendiculares ao trecho', () => {
    const p0 = createProject('Teste');
    const a = unwrap(addPipe(p0, { start: vec3(0, 0, 0), end: vec3(4, 0, 0), spec: spec50 }));
    const b = unwrap(
      addPipe(a.project, { start: vec3(0, 2, 0), end: vec3(4, 2, 0), spec: spec50 }),
    );
    const skew = unwrap(
      addPipe(b.project, { start: vec3(0, -1, 0), end: vec3(4, -3, 0), spec: spec50 }),
    );
    const linked = unwrap(
      drawPipeFromPipe(skew.project, {
        sourcePipeId: a.elementId,
        distanceFromStart: 2,
        end: vec3(2, 2, 0),
        targetPipeId: b.elementId,
        spec: spec50,
      }),
    );
    expect(linked.project.elements.filter((e) => e.kind === 'tee')).toHaveLength(2);
    expect(connectedComponent(linked.project, linked.elementId)).toHaveLength(7);
    expectCoupled(linked.project);
    expect(validateProject(linked.project)).toEqual([]);

    const code = (input: Partial<Parameters<typeof drawPipeFromPipe>[1]>): string => {
      const result = drawPipeFromPipe(skew.project, {
        sourcePipeId: a.elementId,
        distanceFromStart: 2,
        end: vec3(2, 2, 0),
        spec: spec50,
        ...input,
      });
      return result.ok ? '' : result.error.code;
    };
    // O tubo inclinado não é perpendicular à derivação que sai de `a`.
    expect(code({ end: vec3(2, -2, 0), targetPipeId: skew.elementId })).toBe('OFF_AXIS');
    expect(code({ targetPipeId: a.elementId })).toBe('SAME_PIPE');
    expect(code({ end: vec3(3, 0, 0) })).toBe('PIPE_TOO_SHORT');
    expect(code({ end: vec3(2, 0.02, 0) })).toBe('NO_ROOM');
    expect(code({ distanceFromStart: 0.01 })).toBe('NO_ROOM');
    expect(code({ spec: testSpec(75) })).toBe('INVALID_BRANCH');
    expect(code({ sourcePipeId: 'inexistente' })).toBe('NOT_A_PIPE');
  });

  it('recusa a ligação a outro tubo sem perpendicular, sem espaço ou incompatível', () => {
    const p0 = createProject('Teste');
    const main = unwrap(addPipe(p0, { start: vec3(0, 0, 0), end: vec3(4, 0, 0), spec: spec50 }));
    const code = (start: ReturnType<typeof vec3>, spec = spec50): string => {
      const result = drawPipeToPipe(main.project, { start, targetPipeId: main.elementId, spec });
      return result.ok ? '' : result.error.code;
    };
    expect(code(vec3(5, 2, 0))).toBe('NO_PERPENDICULAR');
    expect(code(vec3(2, 0, 0))).toBe('PIPE_TOO_SHORT');
    expect(code(vec3(2, 0.02, 0))).toBe('NO_ROOM');
    expect(code(vec3(0.01, 2, 0))).toBe('NO_ROOM');
    expect(code(vec3(2, 2, 0), testSpec(75))).toBe('INVALID_BRANCH');
    expect(code(vec3(2, 2, 0), testSpec(50, 'outra-norma'))).toBe('SPEC_MISMATCH');
    const same = drawPipeToPipe(main.project, {
      fromPort: { elementId: main.elementId, portId: 'end' },
      start: vec3(4, 0, 0),
      targetPipeId: main.elementId,
      spec: spec50,
    });
    expect(same.ok ? '' : same.error.code).toBe('SAME_PIPE');
    const missing = drawPipeToPipe(main.project, {
      start: vec3(2, 2, 0),
      targetPipeId: 'inexistente',
      spec: spec50,
    });
    expect(missing.ok ? '' : missing.error.code).toBe('NOT_A_PIPE');
  });

  it('insere válvula em linha em tubo inclinado e recusa posição sem espaço', () => {
    const p0 = createProject('Teste');
    const a = unwrap(addPipe(p0, { start: vec3(0, 0, 0), end: vec3(1, 1, 1), spec: spec50 }));
    const valve = unwrap(
      insertInline(a.project, {
        pipeId: a.elementId,
        distanceFromStart: 0.8,
        fitting: { kind: 'valve', valveType: 'ball' },
      }),
    );
    expectCoupled(valve.project);
    const noRoom = insertInline(a.project, {
      pipeId: a.elementId,
      distanceFromStart: 0.01,
      fitting: { kind: 'valve' },
    });
    expect(noRoom.ok ? '' : noRoom.error.code).toBe('NO_ROOM');
  });

  it('acopla redução e permite continuar com o novo diâmetro', () => {
    const p0 = createProject('Teste');
    const a = unwrap(addPipe(p0, { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec: spec50 }));
    const reducer = unwrap(
      attachFitting(a.project, {
        target: { elementId: a.elementId, portId: 'end' },
        fitting: { kind: 'reducer', outletSpec: testSpec(25) },
      }),
    );
    const out = getPort(getElement(reducer.project, reducer.elementId)!, 'b')!;
    const next = unwrap(
      drawPipe(reducer.project, {
        fromPort: out.ref,
        start: vec3(0, 0, 0),
        end: vec3(5, 0, 0),
        spec: spec50,
      }),
    );
    expect(pipeOf(next.project, next.elementId).spec.dn).toBe(25);
    expectCoupled(next.project);
    expect(
      attachFitting(a.project, {
        target: { elementId: a.elementId, portId: 'end' },
        fitting: { kind: 'reducer', outletSpec: spec50 },
      }).ok,
    ).toBe(false);
  });

  it('altera parâmetros da conexão reajustando tubos vizinhos', () => {
    const p0 = createProject('Teste');
    const a = unwrap(addPipe(p0, { start: vec3(0, 0, 0), end: vec3(4, 0, 0), spec: spec50 }));
    const valve = unwrap(
      insertInline(a.project, {
        pipeId: a.elementId,
        distanceFromStart: 2,
        fitting: { kind: 'valve' },
      }),
    );
    const longer = unwrap(updateFitting(valve.project, valve.elementId, { length: 0.6 }));
    expect(pipeOf(longer, a.elementId).end.x).toBeCloseTo(1.7);
    expectCoupled(longer);
    expect(updateFitting(valve.project, valve.elementId, { length: -1 }).ok).toBe(false);
  });
});

describe('conectividade', () => {
  it('recusa conexões duplicadas, consigo mesmo e incompatíveis', () => {
    let project = createProject('Teste');
    const a = unwrap(addPipe(project, { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec: spec50 }));
    const b = unwrap(
      addPipe(a.project, { start: vec3(2, 0, 0), end: vec3(4, 0, 0), spec: spec50 }),
    );
    project = b.project;
    const refA = { elementId: a.elementId, portId: 'end' };
    const refB = { elementId: b.elementId, portId: 'start' };
    const again = connectPorts(project, refA, refB);
    expect(again.ok ? '' : again.error.code).toBe('PORT_OCCUPIED');
    const self = connectPorts(project, refA, { elementId: a.elementId, portId: 'start' });
    expect(self.ok ? '' : self.error.code).toBe('SAME_ELEMENT');
    const far = connectPorts(
      project,
      { elementId: a.elementId, portId: 'start' },
      { elementId: b.elementId, portId: 'end' },
    );
    expect(far.ok ? '' : far.error.code).toBe('POSITION_MISMATCH');

    const connection = project.connections[0]!;
    const open = unwrap(disconnect(project, connection.id));
    expect(getFreePorts(open)).toHaveLength(4);
    expect(unwrap(connectPorts(open, refA, refB)).connections).toHaveLength(1);
  });

  it('exclui elementos removendo suas conexões', () => {
    const p0 = createProject('Teste');
    const a = unwrap(addPipe(p0, { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec: spec50 }));
    const b = unwrap(
      addPipe(a.project, { start: vec3(2, 0, 0), end: vec3(4, 0, 0), spec: spec50 }),
    );
    const after = deleteElements(b.project, [a.elementId]);
    expect(after.elements).toHaveLength(1);
    expect(after.connections).toHaveLength(0);
  });

  it('bloqueia a edição de extremidades conectadas', () => {
    const p0 = createProject('Teste');
    const a = unwrap(addPipe(p0, { start: vec3(0, 0, 0), end: vec3(2, 0, 0), spec: spec50 }));
    const b = unwrap(
      addPipe(a.project, { start: vec3(2, 0, 0), end: vec3(4, 0, 0), spec: spec50 }),
    );
    const locked = setPipeEndpoint(b.project, a.elementId, 'end', vec3(2, 1, 0));
    expect(locked.ok ? '' : locked.error.code).toBe('PORT_OCCUPIED');
    // Mover a extremidade livre para fora do eixo romperia a conexão existente.
    const skewed = setPipeEndpoint(b.project, a.elementId, 'start', vec3(0, 1, 0));
    expect(skewed.ok ? '' : skewed.error.code).toBe('COUPLING_BROKEN');
    // Ao longo do eixo é permitido.
    expect(setPipeEndpoint(b.project, a.elementId, 'start', vec3(-3, 0, 0)).ok).toBe(true);
  });
});

describe('alteração de especificação', () => {
  function network(): { project: Project; a: string; b: string; elbow: string } {
    const p0 = createProject('Teste');
    const a = unwrap(addPipe(p0, { start: vec3(0, 0, 0), end: vec3(3, 0, 0), spec: spec50 }));
    const b = unwrap(
      drawPipe(a.project, {
        fromPort: { elementId: a.elementId, portId: 'end' },
        start: vec3(0, 0, 0),
        end: vec3(3, 3, 0),
        spec: spec50,
      }),
    );
    return { project: b.project, a: a.elementId, b: b.elementId, elbow: b.createdIds[0]! };
  }

  it('propaga o diâmetro pelo trecho e reajusta joelhos e tubos', () => {
    const n = network();
    const project = unwrap(applySpec(n.project, n.a, testSpec(100), { propagate: true }));
    expect(project.elements.every((e) => e.spec.dn === 100)).toBe(true);
    const elbow = getElement(project, n.elbow);
    expect(elbow?.kind === 'elbow' && elbow.bendRadius).toBeCloseTo(
      defaultBendRadius(testSpec(100)),
    );
    const leg = elbowLegLength(Math.PI / 2, defaultBendRadius(testSpec(100)));
    expect(pipeOf(project, n.a).end.x).toBeCloseTo(3 - leg);
    expect(pipeOf(project, n.b).start.y).toBeCloseTo(leg);
    expectCoupled(project);
  });

  it('sem propagação, sinaliza a incompatibilidade em vez de escondê-la', () => {
    const n = network();
    const project = unwrap(applySpec(n.project, n.a, testSpec(100)));
    expect(pipeOf(project, n.a).spec.dn).toBe(100);
    expect(validateProject(project).map((i) => i.code)).toContain('DN_MISMATCH');
  });

  it('a propagação para nas reduções, atualizando só a extremidade alcançada', () => {
    const n = network();
    const reducer = unwrap(
      attachFitting(n.project, {
        target: { elementId: n.b, portId: 'end' },
        fitting: { kind: 'reducer', outletSpec: testSpec(25) },
      }),
    );
    const tail = unwrap(
      drawPipe(reducer.project, {
        fromPort: { elementId: reducer.elementId, portId: 'b' },
        start: vec3(0, 0, 0),
        end: vec3(3, 6, 0),
        spec: spec50,
      }),
    );
    const project = unwrap(applySpec(tail.project, n.a, testSpec(80), { propagate: true }));
    const red = getElement(project, reducer.elementId);
    expect(red?.kind === 'reducer' && [red.spec.dn, red.outletSpec.dn]).toEqual([80, 25]);
    expect(pipeOf(project, tail.elementId).spec.dn).toBe(25);
    expectCoupled(project);
  });

  it('falha de forma atômica quando o novo diâmetro não cabe', () => {
    const p0 = createProject('Teste');
    const a = unwrap(addPipe(p0, { start: vec3(0, 0, 0), end: vec3(0.2, 0, 0), spec: spec50 }));
    const b = unwrap(
      drawPipe(a.project, {
        fromPort: { elementId: a.elementId, portId: 'end' },
        start: vec3(0, 0, 0),
        end: vec3(0.2, 1, 0),
        spec: spec50,
      }),
    );
    const result = applySpec(b.project, a.elementId, testSpec(300), { propagate: true });
    expect(result.ok).toBe(false);
  });
});

describe('translação', () => {
  it('move uma válvula ao longo do eixo esticando os tubos vizinhos', () => {
    const p0 = createProject('Teste');
    const a = unwrap(addPipe(p0, { start: vec3(0, 0, 0), end: vec3(4, 0, 0), spec: spec50 }));
    const valve = unwrap(
      insertInline(a.project, {
        pipeId: a.elementId,
        distanceFromStart: 2,
        fitting: { kind: 'valve' },
      }),
    );
    const moved = unwrap(translateElements(valve.project, [valve.elementId], vec3(0.5, 0, 0)));
    expectCoupled(moved);
    const sideways = translateElements(valve.project, [valve.elementId], vec3(0, 0.5, 0));
    expect(sideways.ok).toBe(false);
  });
});

describe('elevação', () => {
  /** Dois tubos em L com joelho, uma prumada e um tubo solto, todos na cota 0. */
  function network() {
    const p0 = createProject('Teste');
    const a = unwrap(addPipe(p0, { start: vec3(0, 0, 0), end: vec3(3, 0, 0), spec: spec50 }));
    const b = unwrap(
      drawPipe(a.project, {
        fromPort: { elementId: a.elementId, portId: 'end' },
        start: vec3(3, 0, 0),
        end: vec3(3, 2, 0),
        spec: spec50,
      }),
    );
    const riser = unwrap(
      drawPipe(b.project, {
        fromPort: { elementId: b.elementId, portId: 'end' },
        start: vec3(3, 2, 0),
        end: vec3(3, 2, 2.5),
        spec: spec50,
      }),
    );
    const loose = unwrap(
      addPipe(riser.project, { start: vec3(10, 0, 0), end: vec3(12, 0, 0), spec: spec50 }),
    );
    return {
      project: loose.project,
      a: a.elementId,
      riser: riser.elementId,
      loose: loose.elementId,
    };
  }

  it('eleva o tubo e todos os elementos conectados, sem deformar a rede', () => {
    const n = network();
    const raised = unwrap(setElementElevation(n.project, n.a, 1.2));
    expectCoupled(raised);
    expect(raised.connections).toEqual(n.project.connections);
    const connected = new Set(connectedComponent(n.project, n.a));
    expect(connected.size).toBe(5);
    for (const before of n.project.elements) {
      const after = getElement(raised, before.id);
      if (!after) throw new Error('elemento perdido');
      const expected = connected.has(before.id) ? 1.2 : 0;
      expect(elementElevation(after) - elementElevation(before)).toBeCloseTo(expected);
    }
    // A prumada sobe inteira: mantém o comprimento.
    expect(pipeLength(pipeOf(raised, n.riser))).toBeCloseTo(pipeLength(pipeOf(n.project, n.riser)));
    expect(pipeOf(raised, n.riser).end.z).toBeCloseTo(3.7);
    expect(pipeOf(raised, n.loose).start.z).toBe(0);
    expect(pipeOf(n.project, n.a).start.z).toBe(0); // imutabilidade
  });

  it('partindo de uma conexão, também move os elementos conectados', () => {
    const n = network();
    const elbow = n.project.elements.find((e) => e.kind === 'elbow');
    if (!elbow) throw new Error('sem joelho');
    const lowered = unwrap(setElementElevation(n.project, elbow.id, -0.5));
    expectCoupled(lowered);
    expect(pipeOf(lowered, n.a).start.z).toBeCloseTo(-0.5);
    expect(pipeOf(lowered, n.a).end.z).toBeCloseTo(-0.5);
    const after = getElement(lowered, elbow.id);
    expect(after && elementElevation(after)).toBeCloseTo(-0.5);
  });

  it('elemento isolado muda só a própria elevação', () => {
    const n = network();
    const moved = unwrap(setElementElevation(n.project, n.loose, 2));
    expect(pipeOf(moved, n.loose).start).toEqual(vec3(10, 0, 2));
    expect(pipeOf(moved, n.loose).end).toEqual(vec3(12, 0, 2));
    expect(pipeOf(moved, n.a).start.z).toBe(0);
    expectCoupled(moved);
  });

  it('equipamento muda só a própria elevação', () => {
    const n = network();
    const pump = unwrap(
      placeEquipment(n.project, {
        fitting: { kind: 'pump' },
        position: vec3(20, 0, 0),
        spec: spec50,
      }),
    );
    const moved = unwrap(setElementElevation(pump.project, pump.elementId, 0.3));
    const after = getElement(moved, pump.elementId);
    expect(after && elementElevation(after)).toBeCloseTo(0.3);
    expect(pipeOf(moved, n.a).start.z).toBe(0);
    expectCoupled(moved);
  });

  it('recusa elevação inválida ou elemento inexistente e ignora valor igual', () => {
    const n = network();
    const invalid = setElementElevation(n.project, n.a, Number.NaN);
    expect(!invalid.ok && invalid.error.code).toBe('INVALID_VALUE');
    const missing = setElementElevation(n.project, 'nao-existe', 1);
    expect(!missing.ok && missing.error.code).toBe('ELEMENT_NOT_FOUND');
    expect(unwrap(setElementElevation(n.project, n.a, 0))).toBe(n.project);
  });
});
