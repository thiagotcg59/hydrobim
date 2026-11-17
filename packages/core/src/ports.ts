import { elbowLegLength } from './dimensions';
import {
  add,
  distance,
  frameFromDirection,
  QUAT_IDENTITY,
  rotate,
  sub,
  tryNormalize,
  vec3,
  ZERO,
  type Vec3,
} from './math';
import type { HydroElement, PipeSpec, Placement, PortRef } from './schema';

export type PortRole = 'end' | 'run' | 'branch';

/**
 * Porta de conexão de um elemento. É DERIVADA dos parâmetros do elemento — nunca é
 * persistida — o que impede divergência entre geometria e pontos de conexão.
 * O estado de conexão vive no grafo (`Project.connections`).
 */
export interface Port {
  readonly ref: PortRef;
  readonly label: string;
  readonly role: PortRole;
  /** Posição no referencial local do elemento. */
  readonly localPosition: Vec3;
  /** Direção unitária apontando para fora do elemento, no referencial local. */
  readonly localDirection: Vec3;
  /** Posição no referencial global. */
  readonly position: Vec3;
  /** Direção unitária apontando para fora do elemento, no referencial global. */
  readonly direction: Vec3;
  /** Especificação dimensional exigida do elemento conectado. */
  readonly spec: PipeSpec;
}

interface LocalPort {
  id: string;
  label: string;
  role: PortRole;
  position: Vec3;
  direction: Vec3;
  spec: PipeSpec;
}

export function pipeLength(pipe: { start: Vec3; end: Vec3 }): number {
  return distance(pipe.start, pipe.end);
}

/**
 * Referencial local do elemento.
 * - Tubo: origem no ponto inicial, eixo X ao longo do tubo.
 * - Conexões: `placement` armazenado.
 */
export function getElementFrame(element: HydroElement): Placement {
  if (element.kind !== 'pipe') return element.placement;
  const dir = tryNormalize(sub(element.end, element.start));
  return {
    position: element.start,
    rotation: dir ? frameFromDirection(dir) : QUAT_IDENTITY,
  };
}

/**
 * Portas no referencial local. Convenção comum a todas as conexões: a porta `a` fica
 * em −X (direção −X) e o eixo X local segue o sentido de quem entra pela porta `a`.
 */
function getLocalPorts(element: HydroElement): LocalPort[] {
  const spec = element.spec;
  switch (element.kind) {
    case 'pipe': {
      const len = pipeLength(element);
      return [
        {
          id: 'start',
          label: 'Início',
          role: 'end',
          position: ZERO,
          direction: vec3(-1, 0, 0),
          spec,
        },
        {
          id: 'end',
          label: 'Fim',
          role: 'end',
          position: vec3(len, 0, 0),
          direction: vec3(1, 0, 0),
          spec,
        },
      ];
    }
    case 'elbow': {
      const leg = elbowLegLength(element.angle, element.bendRadius);
      const out = vec3(Math.cos(element.angle), Math.sin(element.angle), 0);
      return [
        {
          id: 'a',
          label: 'Porta A',
          role: 'end',
          position: vec3(-leg, 0, 0),
          direction: vec3(-1, 0, 0),
          spec,
        },
        {
          id: 'b',
          label: 'Porta B',
          role: 'end',
          position: vec3(out.x * leg, out.y * leg, 0),
          direction: out,
          spec,
        },
      ];
    }
    case 'tee': {
      const half = element.runLength / 2;
      return [
        {
          id: 'a',
          label: 'Passagem A',
          role: 'run',
          position: vec3(-half, 0, 0),
          direction: vec3(-1, 0, 0),
          spec,
        },
        {
          id: 'b',
          label: 'Passagem B',
          role: 'run',
          position: vec3(half, 0, 0),
          direction: vec3(1, 0, 0),
          spec,
        },
        {
          id: 'branch',
          label: 'Derivação',
          role: 'branch',
          position: vec3(0, element.branchLength, 0),
          direction: vec3(0, 1, 0),
          spec,
        },
      ];
    }
    case 'reducer': {
      const half = element.length / 2;
      return [
        {
          id: 'a',
          label: 'Porta A',
          role: 'end',
          position: vec3(-half, 0, 0),
          direction: vec3(-1, 0, 0),
          spec,
        },
        {
          id: 'b',
          label: 'Porta B',
          role: 'end',
          position: vec3(half, 0, 0),
          direction: vec3(1, 0, 0),
          spec: element.outletSpec,
        },
      ];
    }
    case 'valve': {
      const half = element.length / 2;
      return [
        {
          id: 'a',
          label: 'Porta A',
          role: 'end',
          position: vec3(-half, 0, 0),
          direction: vec3(-1, 0, 0),
          spec,
        },
        {
          id: 'b',
          label: 'Porta B',
          role: 'end',
          position: vec3(half, 0, 0),
          direction: vec3(1, 0, 0),
          spec,
        },
      ];
    }
  }
}

/** Portas do elemento, com posição e direção nos referenciais local e global. */
export function getPorts(element: HydroElement): Port[] {
  const frame = getElementFrame(element);
  return getLocalPorts(element).map((p) => ({
    ref: { elementId: element.id, portId: p.id },
    label: p.label,
    role: p.role,
    localPosition: p.position,
    localDirection: p.direction,
    position: add(frame.position, rotate(frame.rotation, p.position)),
    direction: rotate(frame.rotation, p.direction),
    spec: p.spec,
  }));
}

export function getPort(element: HydroElement, portId: string): Port | undefined {
  return getPorts(element).find((p) => p.ref.portId === portId);
}

export const samePortRef = (a: PortRef, b: PortRef): boolean =>
  a.elementId === b.elementId && a.portId === b.portId;
