import {
  add,
  elbowLegLength,
  getElementFrame,
  getPorts,
  pipeLength,
  scale,
  vec3,
  type EndTreatment,
  type HydroElement,
  type PipeSpec,
  type Placement,
  type Port,
  type Vec3,
} from '@hydrobim/core';
import { sweepTube, type MeshData, type Station } from './sweep';

/**
 * Geometria paramétrica dos elementos, gerada no referencial LOCAL de cada elemento
 * (o mesmo referencial das portas). A transformação para o referencial global é
 * devolvida separadamente, preservando a precisão em coordenadas grandes.
 *
 * As dimensões principais (centro a face, comprimento, profundidade e diâmetro de
 * bolsas, diâmetro e espessura de flanges, altura de válvulas) vêm dos parâmetros do
 * elemento — preenchidos a partir das famílias de catálogo. O contorno externo do corpo
 * entre essas dimensões é uma representação simplificada.
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
const Z = vec3(0, 0, 1);
const ORIGIN = vec3(0, 0, 0);

const station = (center: Vec3, tangent: Vec3, outer: number, inner: number): Station => ({
  center,
  tangent,
  outerRadius: outer,
  innerRadius: inner,
});

/** Vetor de referência não paralelo a `direction`, para orientar as seções. */
const upFor = (direction: Vec3): Vec3 =>
  Math.abs(direction.z) > 0.9 * Math.hypot(direction.x, direction.y, direction.z) ? X : Z;

const body = (mesh: MeshData): MeshPart => ({ role: 'body', mesh });
const accent = (mesh: MeshData): MeshPart => ({ role: 'accent', mesh });

/** Cilindro (oco ou maciço) entre dois pontos. */
function cylinder(from: Vec3, to: Vec3, outer: number, inner = 0, segments = 32): MeshData {
  const direction = vec3(to.x - from.x, to.y - from.y, to.z - from.z);
  return sweepTube([station(from, direction, outer, inner), station(to, direction, outer, inner)], {
    up: upFor(direction),
    radialSegments: segments,
  });
}

/** Raio externo do corpo junto a uma porta: a bolsa envolve o tubo. */
function bodyRadius(spec: PipeSpec, end: EndTreatment | null): number {
  return end?.type === 'socket' ? end.outerDiameter / 2 : spec.outerDiameter / 2;
}

/**
 * Estações que prolongam o corpo além da porta para formar a bolsa (o furo passa a ter
 * o diâmetro externo do tubo). Devolvidas na ordem porta → extremidade da bolsa.
 */
function socketStations(
  port: Pick<Port, 'localPosition' | 'localDirection' | 'spec' | 'end'>,
): Station[] {
  const end = port.end;
  if (end?.type !== 'socket' || end.length <= 0) return [];
  const outer = end.outerDiameter / 2;
  const bore = port.spec.outerDiameter / 2;
  const tip = add(port.localPosition, scale(port.localDirection, end.length));
  return [
    station(port.localPosition, port.localDirection, outer, bore),
    station(tip, port.localDirection, outer, bore),
  ];
}

/** Disco do flange, da face (porta) para dentro da peça. */
function flangeParts(
  port: Pick<Port, 'localPosition' | 'localDirection' | 'spec' | 'end'>,
): MeshPart[] {
  const end = port.end;
  if (end?.type !== 'flange' || end.length <= 0) return [];
  const back = add(port.localPosition, scale(port.localDirection, -end.length));
  return [
    body(
      cylinder(back, port.localPosition, end.outerDiameter / 2, port.spec.innerDiameter / 2, 40),
    ),
  ];
}

/**
 * Trecho reto do corpo, de um ponto interno até a porta, incluindo bolsa ou flange.
 * Com `capStart = false` o início fica aberto (uso em derivações que nascem no eixo).
 */
function leg(from: Vec3, port: Port, capStart = true): MeshPart[] {
  const outer = bodyRadius(port.spec, port.end);
  const inner = port.spec.innerDiameter / 2;
  const stations = [
    station(from, port.localDirection, outer, inner),
    station(port.localPosition, port.localDirection, outer, inner),
    ...socketStations(port),
  ];
  return [
    body(sweepTube(stations, { up: upFor(port.localDirection), capStart })),
    ...flangeParts(port),
  ];
}

/** Esfera (fecha o canto de joelhos compactos). */
function sphere(center: Vec3, radius: number): MeshData {
  const rings = 12;
  const stations: Station[] = [];
  for (let i = 0; i <= rings; i += 1) {
    const phi = (Math.PI * i) / rings;
    stations.push(
      station(
        vec3(center.x, center.y, center.z - radius * Math.cos(phi)),
        Z,
        Math.max(radius * Math.sin(phi), radius * 1e-3),
        0,
      ),
    );
  }
  return sweepTube(stations, { up: X, radialSegments: 24, capStart: false, capEnd: false });
}

function reversed(stations: Station[]): Station[] {
  return stations.map((s) => ({ ...s, tangent: scale(s.tangent, -1) })).reverse();
}

function elbowParts(element: Extract<HydroElement, { kind: 'elbow' }>, ports: Port[]): MeshPart[] {
  const [a, b] = ports;
  if (!a || !b) return [];
  const outer = Math.max(bodyRadius(a.spec, a.end), bodyRadius(b.spec, b.end));
  const inner = element.spec.innerDiameter / 2;
  const { angle, bendRadius } = element;
  const flanges = [...flangeParts(a), ...flangeParts(b)];

  // Raio de curvatura menor que o raio do corpo: joelho compacto (pernas retas + canto).
  if (bendRadius < outer * 1.05) {
    return [...leg(ORIGIN, a, false), ...leg(ORIGIN, b, false), body(sphere(ORIGIN, outer))];
  }

  const legLength = elbowLegLength(angle, bendRadius);
  const steps = Math.max(6, Math.ceil((angle / (Math.PI / 2)) * 16));
  const arc: Station[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const phi = (angle * i) / steps;
    arc.push(
      station(
        vec3(-legLength + bendRadius * Math.sin(phi), bendRadius - bendRadius * Math.cos(phi), 0),
        vec3(Math.cos(phi), Math.sin(phi), 0),
        outer,
        inner,
      ),
    );
  }
  // Bolsa da porta A antes do arco (percorrida de fora para dentro) e da porta B depois.
  const stations = [...reversed(socketStations(a)), ...arc, ...socketStations(b)];
  return [body(sweepTube(stations, { up: Z })), ...flanges];
}

function valveParts(element: Extract<HydroElement, { kind: 'valve' }>, ports: Port[]): MeshPart[] {
  const d = element.spec.outerDiameter;
  const [a, b] = ports;
  if (!a) return [];

  if (element.valveType === 'airRelease') {
    // Ventosa: corpo cilíndrico sobre o flange de entrada, com tampa mais estreita.
    const length = element.length;
    const radius = Math.max(d * 0.9, (a.end?.outerDiameter ?? 0) * 0.42);
    return [
      ...flangeParts(a),
      body(cylinder(ORIGIN, vec3(length * 0.2, 0, 0), d / 2, element.spec.innerDiameter / 2)),
      body(cylinder(vec3(length * 0.2, 0, 0), vec3(length * 0.8, 0, 0), radius)),
      accent(cylinder(vec3(length * 0.8, 0, 0), vec3(length, 0, 0), radius * 0.6)),
    ];
  }
  if (!b) return [];

  const half = element.length / 2;
  const top = element.height ?? d * 2.25;
  const wheel = (element.handwheelDiameter ?? d * 1.8) / 2;
  const core = Math.min(half * 0.55, d * 1.2);
  const parts: MeshPart[] = [
    ...leg(ORIGIN, a, false),
    ...leg(ORIGIN, b, false),
    // Corpo central maciço, mais largo que o tubo.
    body(cylinder(vec3(-core, 0, 0), vec3(core, 0, 0), d * 0.8)),
  ];
  if (element.valveType === 'check') {
    // Retenção: apenas a tampa de inspeção, sem acionamento.
    parts.push(body(cylinder(ORIGIN, vec3(0, 0, Math.min(top * 0.5, d * 1.2)), d * 0.5, 0, 24)));
    return parts;
  }
  parts.push(body(cylinder(ORIGIN, vec3(0, 0, top * 0.66), d * 0.35, 0, 24)));
  parts.push(accent(cylinder(vec3(0, 0, top * 0.66), vec3(0, 0, top), d * 0.12, 0, 16)));
  if (element.valveType === 'gate' || element.valveType === 'globe') {
    parts.push(accent(cylinder(vec3(0, 0, top - d * 0.12), vec3(0, 0, top), wheel, 0, 32)));
  } else {
    // Esfera/borboleta: alavanca.
    parts.push(
      accent(
        cylinder(vec3(-d * 0.2, 0, top), vec3(Math.max(wheel * 2, d * 2), 0, top), d * 0.14, 0, 16),
      ),
    );
  }
  return parts;
}

function localParts(element: HydroElement): MeshPart[] {
  // Portas no referencial local (usa-se apenas `localPosition`/`localDirection`).
  const ports = getPorts(element);
  const outer = element.spec.outerDiameter / 2;
  const inner = element.spec.innerDiameter / 2;

  switch (element.kind) {
    case 'pipe':
      return [body(cylinder(ORIGIN, vec3(pipeLength(element), 0, 0), outer, inner))];

    case 'elbow':
      return elbowParts(element, ports);

    case 'tee': {
      const [a, b, branch] = ports;
      if (!a || !b || !branch) return [];
      const runOuter = bodyRadius(a.spec, a.end);
      const run = sweepTube(
        [
          ...reversed(socketStations(a)),
          station(a.localPosition, X, runOuter, inner),
          station(b.localPosition, X, runOuter, inner),
          ...socketStations(b),
        ],
        { up: Z },
      );
      return [body(run), ...flangeParts(a), ...flangeParts(b), ...leg(ORIGIN, branch, false)];
    }

    case 'reducer': {
      const [a, b] = ports;
      if (!a || !b) return [];
      const half = element.length / 2;
      const neck = element.length * 0.15;
      const outerA = bodyRadius(a.spec, a.end);
      const outerB = bodyRadius(b.spec, b.end);
      const innerB = b.spec.innerDiameter / 2;
      const stations = [
        ...reversed(socketStations(a)),
        station(vec3(-half, 0, 0), X, outerA, inner),
        station(vec3(-half + neck, 0, 0), X, outerA, inner),
        station(vec3(half - neck, 0, 0), X, outerB, innerB),
        station(vec3(half, 0, 0), X, outerB, innerB),
        ...socketStations(b),
      ];
      return [body(sweepTube(stations, { up: Z })), ...flangeParts(a), ...flangeParts(b)];
    }

    case 'valve':
      return valveParts(element, ports);

    case 'pump': {
      const [suction, discharge] = ports;
      if (!suction || !discharge) return [];
      const length = element.length;
      const volute = Math.max(element.dischargeHeight * 0.72, outer * 1.6);
      const x = element.dischargeOffset;
      return [
        ...flangeParts(suction),
        ...flangeParts(discharge),
        // Bocal de sucção (axial) e de recalque (vertical).
        body(cylinder(ORIGIN, vec3(x * 0.7, 0, 0), outer, inner)),
        body(
          cylinder(
            vec3(x, 0, 0),
            discharge.localPosition,
            discharge.spec.outerDiameter / 2,
            discharge.spec.innerDiameter / 2,
          ),
        ),
        // Voluta, mancal e motor (formas genéricas).
        body(cylinder(vec3(x * 0.55, 0, 0), vec3(x * 1.45, 0, 0), volute, 0, 40)),
        body(cylinder(vec3(x * 1.45, 0, 0), vec3(length * 0.5, 0, 0), volute * 0.35, 0, 24)),
        accent(cylinder(vec3(length * 0.5, 0, 0), vec3(length, 0, 0), volute * 0.62, 0, 32)),
      ];
    }

    case 'tank': {
      const radius = element.diameter / 2;
      const [outlet, inlet] = ports;
      const parts: MeshPart[] = [body(cylinder(ORIGIN, vec3(0, 0, element.height), radius, 0, 64))];
      for (const nozzle of [outlet, inlet]) {
        if (!nozzle) continue;
        const sign = nozzle.localDirection.x >= 0 ? 1 : -1;
        const from = vec3(sign * radius * 0.98, 0, nozzle.localPosition.z);
        parts.push(...leg(from, nozzle));
      }
      return parts;
    }
  }
}

/** Geometria completa do elemento: partes no referencial local + transformação global. */
export function buildElementGeometry(element: HydroElement): ElementGeometry {
  return { transform: getElementFrame(element), parts: localParts(element) };
}
