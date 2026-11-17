import {
  elbowLegLength,
  getElementFrame,
  pipeLength,
  vec3,
  type HydroElement,
  type Placement,
  type Vec3,
} from '@hydrobim/core';
import { sweepTube, type MeshData, type Station } from './sweep';

/**
 * Geometria paramétrica dos elementos, gerada no referencial LOCAL de cada elemento
 * (o mesmo referencial das portas). A transformação para o referencial global é
 * devolvida separadamente, preservando a precisão em coordenadas grandes.
 *
 * As formas de conexões e válvulas são representações simplificadas e genéricas;
 * não reproduzem a geometria de produtos comerciais.
 */

export type PartRole = 'body' | 'accent';

export interface MeshPart {
  readonly role: PartRole;
  readonly mesh: MeshData;
}

export interface ElementGeometry {
  readonly transform: Placement;
  readonly parts: readonly MeshPart[];
}

const X = vec3(1, 0, 0);
const Y = vec3(0, 1, 0);
const Z = vec3(0, 0, 1);

const station = (center: Vec3, tangent: Vec3, outer: number, inner: number): Station => ({
  center,
  tangent,
  outerRadius: outer,
  innerRadius: inner,
});

/** Segmento reto ao longo de X. */
function straightX(x0: number, x1: number, outer: number, inner: number): MeshData {
  return sweepTube(
    [station(vec3(x0, 0, 0), X, outer, inner), station(vec3(x1, 0, 0), X, outer, inner)],
    {
      up: Z,
    },
  );
}

/** Cilindro maciço ao longo de Z (hastes, castelos e volantes de válvulas). */
function solidZ(z0: number, z1: number, radius: number): MeshData {
  return sweepTube([station(vec3(0, 0, z0), Z, radius, 0), station(vec3(0, 0, z1), Z, radius, 0)], {
    up: X,
    radialSegments: 24,
  });
}

function elbowMesh(angle: number, bendRadius: number, outer: number, inner: number): MeshData {
  const leg = elbowLegLength(angle, bendRadius);
  const steps = Math.max(6, Math.ceil((angle / (Math.PI / 2)) * 16));
  const stations: Station[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const phi = (angle * i) / steps;
    stations.push(
      station(
        vec3(-leg + bendRadius * Math.sin(phi), bendRadius - bendRadius * Math.cos(phi), 0),
        vec3(Math.cos(phi), Math.sin(phi), 0),
        outer,
        inner,
      ),
    );
  }
  return sweepTube(stations, { up: Z });
}

function localParts(element: HydroElement): MeshPart[] {
  const outer = element.spec.outerDiameter / 2;
  const inner = element.spec.innerDiameter / 2;
  const body = (mesh: MeshData): MeshPart => ({ role: 'body', mesh });
  const accent = (mesh: MeshData): MeshPart => ({ role: 'accent', mesh });

  switch (element.kind) {
    case 'pipe':
      return [body(straightX(0, pipeLength(element), outer, inner))];

    case 'elbow':
      return [body(elbowMesh(element.angle, element.bendRadius, outer, inner))];

    case 'tee': {
      const half = element.runLength / 2;
      const branch = sweepTube(
        [
          station(vec3(0, 0, 0), Y, outer, inner),
          station(vec3(0, element.branchLength, 0), Y, outer, inner),
        ],
        { up: Z, capStart: false },
      );
      return [body(straightX(-half, half, outer, inner)), body(branch)];
    }

    case 'reducer': {
      const half = element.length / 2;
      const neck = element.length * 0.15;
      const outerB = element.outletSpec.outerDiameter / 2;
      const innerB = element.outletSpec.innerDiameter / 2;
      return [
        body(
          sweepTube(
            [
              station(vec3(-half, 0, 0), X, outer, inner),
              station(vec3(-half + neck, 0, 0), X, outer, inner),
              station(vec3(half - neck, 0, 0), X, outerB, innerB),
              station(vec3(half, 0, 0), X, outerB, innerB),
            ],
            { up: Z },
          ),
        ),
      ];
    }

    case 'valve': {
      const half = element.length / 2;
      const d = element.spec.outerDiameter;
      const parts: MeshPart[] = [
        body(straightX(-half, half, outer, inner)),
        // Corpo central maciço, mais largo que o tubo.
        body(straightX(-half * 0.55, half * 0.55, d * 0.8, 0)),
      ];
      if (element.valveType === 'check') {
        // Retenção: apenas a tampa de inspeção, sem acionamento.
        parts.push(body(solidZ(0, d * 1.1, d * 0.45)));
        return parts;
      }
      parts.push(body(solidZ(0, d * 1.5, d * 0.35)));
      parts.push(accent(solidZ(d * 1.5, d * 2.1, d * 0.12)));
      if (element.valveType === 'gate' || element.valveType === 'globe') {
        parts.push(accent(solidZ(d * 2.1, d * 2.25, d * 0.9)));
      } else {
        // Esfera/borboleta: alavanca.
        parts.push(
          accent(
            sweepTube(
              [
                station(vec3(-d * 0.2, 0, d * 2.1), X, d * 0.14, 0),
                station(vec3(d * 2, 0, d * 2.1), X, d * 0.14, 0),
              ],
              { up: Z, radialSegments: 16 },
            ),
          ),
        );
      }
      return parts;
    }
  }
}

/** Geometria completa do elemento: partes no referencial local + transformação global. */
export function buildElementGeometry(element: HydroElement): ElementGeometry {
  return { transform: getElementFrame(element), parts: localParts(element) };
}
