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
import type { EndTreatment, HydroElement, PipeSpec, Placement, PortRef } from './schema';
import { tankNozzlePorts } from './tanks';

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
  /** Acabamento da extremidade (bolsa, flange); `null` = ponta lisa. */
  readonly end: EndTreatment | null;
}

interface LocalPort {
  id: string;
  label: string;
  role: PortRole;
  position: Vec3;
  direction: Vec3;
  spec: PipeSpec;
}

const MINUS_X = vec3(-1, 0, 0);
const PLUS_X = vec3(1, 0, 0);

export function pipeLength(pipe: { start: Vec3; end: Vec3 }): number {
  return distance(pipe.start, pipe.end);
}

/**
 * Referencial local do elemento.
 * - Tubo: origem no ponto inicial, eixo X ao longo do tubo.
 * - Demais elementos: `placement` armazenado.
 */
export function getElementFrame(element: HydroElement): Placement {
  if (element.kind !== 'pipe') return element.placement;
  const dir = tryNormalize(sub(element.end, element.start));
  return {
    position: element.start,
    rotation: dir ? frameFromDirection(dir) : QUAT_IDENTITY,
  };
}

const port = (
  id: string,
  label: string,
  role: PortRole,
  position: Vec3,
  direction: Vec3,
  spec: PipeSpec,
): LocalPort => ({ id, label, role, position, direction, spec });

/**
 * Portas no referencial local. Convenção das conexões em linha: a porta `a` fica em −X
 * (direção −X) e o eixo X local segue o sentido de quem entra pela porta `a`.
 */
function getLocalPorts(element: HydroElement): LocalPort[] {
  const spec = element.spec;
  switch (element.kind) {
    case 'pipe':
      return [
        port('start', 'Início', 'end', ZERO, MINUS_X, spec),
        port('end', 'Fim', 'end', vec3(pipeLength(element), 0, 0), PLUS_X, spec),
      ];
    case 'elbow': {
      const leg = elbowLegLength(element.angle, element.bendRadius);
      const out = vec3(Math.cos(element.angle), Math.sin(element.angle), 0);
      return [
        port('a', 'Porta A', 'end', vec3(-leg, 0, 0), MINUS_X, spec),
        port('b', 'Porta B', 'end', vec3(out.x * leg, out.y * leg, 0), out, spec),
      ];
    }
    case 'tee': {
      const half = element.runLength / 2;
      return [
        port('a', 'Passagem A', 'run', vec3(-half, 0, 0), MINUS_X, spec),
        port('b', 'Passagem B', 'run', vec3(half, 0, 0), PLUS_X, spec),
        port(
          'branch',
          'Derivação',
          'branch',
          vec3(0, element.branchLength, 0),
          vec3(0, 1, 0),
          element.branchSpec ?? spec,
        ),
      ];
    }
    case 'reducer': {
      const half = element.length / 2;
      return [
        port('a', 'Porta A', 'end', vec3(-half, 0, 0), MINUS_X, spec),
        port('b', 'Porta B', 'end', vec3(half, 0, 0), PLUS_X, element.outletSpec),
      ];
    }
    case 'valve': {
      // Ventosa: uma única porta; o corpo se estende ao longo de +X a partir dela.
      if (element.valveType === 'airRelease') {
        return [port('a', 'Entrada', 'end', ZERO, MINUS_X, spec)];
      }
      const half = element.length / 2;
      return [
        port('a', 'Porta A', 'end', vec3(-half, 0, 0), MINUS_X, spec),
        port('b', 'Porta B', 'end', vec3(half, 0, 0), PLUS_X, spec),
      ];
    }
    case 'pump':
      return [
        port('a', 'Sucção', 'end', ZERO, MINUS_X, spec),
        port(
          'b',
          'Recalque',
          'end',
          vec3(element.dischargeOffset, 0, element.dischargeHeight),
          vec3(0, 0, 1),
          element.dischargeSpec,
        ),
      ];
    case 'tank':
      return tankNozzlePorts(element).map((nozzle) =>
        port(nozzle.id, nozzle.label, 'end', nozzle.position, nozzle.direction, nozzle.spec),
      );
  }
}

/** Portas do elemento, com posição e direção nos referenciais local e global. */
export function getPorts(element: HydroElement): Port[] {
  const frame = getElementFrame(element);
  const ends = element.ends;
  return getLocalPorts(element).map((p) => ({
    ref: { elementId: element.id, portId: p.id },
    label: p.label,
    role: p.role,
    localPosition: p.position,
    localDirection: p.direction,
    position: add(frame.position, rotate(frame.rotation, p.position)),
    direction: rotate(frame.rotation, p.direction),
    spec: p.spec,
    end: ends?.[p.id] ?? null,
  }));
}

export function getPort(element: HydroElement, portId: string): Port | undefined {
  return getPorts(element).find((p) => p.ref.portId === portId);
}

export const samePortRef = (a: PortRef, b: PortRef): boolean =>
  a.elementId === b.elementId && a.portId === b.portId;
