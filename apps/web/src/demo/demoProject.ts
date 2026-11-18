import { resolvePipeSpec } from '@hydrobim/catalog';
import {
  addPipe,
  attachFitting,
  createProject,
  drawPipe,
  insertInline,
  vec3,
  type PipeSpec,
  type Project,
  type Result,
} from '@hydrobim/core';

function must<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`Projeto de demonstração inválido: ${result.error.message}`);
  }
  return result.value;
}

function spec(dn: number): PipeSpec {
  const resolved = resolvePipeSpec('pvc-soldavel-nbr5648', dn);
  if (!resolved) throw new Error(`Diâmetro DN ${dn} ausente no catálogo.`);
  return resolved;
}

/**
 * Projeto de demonstração: pequeno barrilete de água fria em PVC soldável, construído
 * com as mesmas operações disponíveis ao usuário (tubos em três orientações, joelhos
 * automáticos, tê e válvulas em linha, redução).
 */
export function createDemoProject(): Project {
  const dn50 = spec(50);
  const dn25 = spec(25);
  const start = vec3(0, 0, 0);

  let project = createProject('Barrilete de água fria — demonstração', 'mep');
  const main = must(addPipe(project, { start: vec3(0, 0, 1), end: vec3(4, 0, 1), spec: dn50 }));
  const side = must(
    drawPipe(main.project, {
      fromPort: { elementId: main.elementId, portId: 'end' },
      start,
      end: vec3(4, 3, 1),
      spec: dn50,
    }),
  );
  const riser = must(
    drawPipe(side.project, {
      fromPort: { elementId: side.elementId, portId: 'end' },
      start,
      end: vec3(4, 3, 3.5),
      spec: dn50,
    }),
  );
  const tee = must(
    insertInline(riser.project, {
      pipeId: main.elementId,
      distanceFromStart: 1.5,
      fitting: { kind: 'tee' },
    }),
  );
  const branch = must(
    drawPipe(tee.project, {
      fromPort: { elementId: tee.elementId, portId: 'branch' },
      start,
      end: vec3(1.5, 2.5, 1),
      spec: dn50,
    }),
  );
  const gate = must(
    insertInline(branch.project, {
      pipeId: branch.elementId,
      distanceFromStart: 0.8,
      fitting: { kind: 'valve', valveType: 'gate' },
    }),
  );
  const branchTail = gate.createdIds[1];
  const mainTail = tee.createdIds[1];
  if (!branchTail || !mainTail) throw new Error('Projeto de demonstração inválido.');
  const reducer = must(
    attachFitting(gate.project, {
      target: { elementId: branchTail, portId: 'end' },
      fitting: { kind: 'reducer', outletSpec: dn25 },
    }),
  );
  const tail = must(
    drawPipe(reducer.project, {
      fromPort: { elementId: reducer.elementId, portId: 'b' },
      start,
      end: vec3(1.5, 4, 1),
      spec: dn25,
    }),
  );
  const ball = must(
    insertInline(tail.project, {
      pipeId: mainTail,
      distanceFromStart: 1,
      fitting: { kind: 'valve', valveType: 'ball' },
    }),
  );
  project = ball.project;
  return project;
}
