import {
  add,
  elbowLegLength,
  getElementFrame,
  getPorts,
  pipeLength,
  scale,
  sub,
  vec3,
  type EndTreatment,
  type HydroElement,
  type Placement,
  type Port,
  type Vec3,
} from '@hydrobim/core';
import { box, loft, type ProfilePoint } from './loft';
import { sweepTube, type MeshData, type Station } from './sweep';

/**
 * Geometria paramétrica dos elementos, gerada no referencial LOCAL de cada elemento
 * (o mesmo referencial das portas). A transformação para o referencial global é
 * devolvida separadamente, preservando a precisão em coordenadas grandes.
 *
 * O que vem do catálogo (parâmetros do elemento): posição das portas (centro ao fundo da
 * bolsa / à face do flange), raio de curvatura, profundidade e diâmetro externo das
 * bolsas, diâmetro e espessura dos flanges, comprimento, altura e volante das válvulas,
 * diâmetros externo e interno do tubo.
 *
 * O que é REPRESENTAÇÃO (não tabulado nos catálogos usados): espessura de parede do corpo
 * das conexões (adota-se o diâmetro externo do tubo), concordância entre corpo e bolsa,
 * cubo dos flanges, bojo, castelo e acionamento das válvulas. Furação de flanges, anéis
 * de vedação e nervuras não são modelados.
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
  const direction = sub(to, from);
  return sweepTube([station(from, direction, outer, inner), station(to, direction, outer, inner)], {
    up: upFor(direction),
    radialSegments: segments,
  });
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Linha de centro de um trecho da peça, parametrizada pelo comprimento `s`. */
interface Path {
  readonly length: number;
  readonly up: Vec3;
  /** Valores de `s` em que a trajetória precisa de anéis intermediários (curvas). */
  readonly samples: readonly number[];
  at(s: number): { center: Vec3; tangent: Vec3 };
}

function linePath(from: Vec3, to: Vec3): Path {
  const delta = sub(to, from);
  const length = Math.hypot(delta.x, delta.y, delta.z);
  const tangent = scale(delta, 1 / length);
  return {
    length,
    up: upFor(tangent),
    samples: [],
    at: (s) => ({ center: add(from, scale(tangent, s)), tangent }),
  };
}

/**
 * Linha de centro do joelho: arco de raio `bendRadius` tangente às duas portas, com
 * prolongamentos retos além delas (onde ficam as bolsas).
 */
function elbowPath(angle: number, bendRadius: number): Path {
  const leg = elbowLegLength(angle, bendRadius);
  const length = bendRadius * angle;
  const steps = Math.max(8, Math.ceil((angle / (Math.PI / 2)) * 24));
  const out = vec3(Math.cos(angle), Math.sin(angle), 0);
  const portB = scale(out, leg);
  return {
    length,
    up: Z,
    samples: Array.from({ length: steps + 1 }, (_, i) => (length * i) / steps),
    at: (s) => {
      if (s <= 0) return { center: vec3(-leg + s, 0, 0), tangent: X };
      if (s >= length) return { center: add(portB, scale(out, s - length)), tangent: out };
      const phi = s / bendRadius;
      return {
        center: vec3(-leg + bendRadius * Math.sin(phi), bendRadius - bendRadius * Math.cos(phi), 0),
        tangent: vec3(Math.cos(phi), Math.sin(phi), 0),
      };
    },
  };
}

/** Extremidade de um conduto: acabamento de catálogo e raio externo do tubo que chega. */
interface ConduitEnd {
  readonly treatment: EndTreatment | null;
  readonly pipeRadius: number;
}

const endOf = (port: Port): ConduitEnd => ({
  treatment: port.end ?? null,
  pipeRadius: port.spec.outerDiameter / 2,
});

interface ConduitOptions {
  readonly path: Path;
  /** `null`: início aberto (o trecho nasce dentro de outro corpo, como uma derivação). */
  readonly start: ConduitEnd | null;
  readonly end: ConduitEnd;
  /** Raio externo do corpo e raio do furo, no início e no fim (variação linear). */
  readonly bodyStart: number;
  readonly bodyEnd: number;
  readonly boreStart: number;
  readonly boreEnd: number;
  /** Bojo (corpo de válvula): alargamento suave em torno de `center`. */
  readonly bulge?: { center: number; half: number; radius: number };
}

/** Geometria de uma das extremidades, já resolvida em relação ao corpo. */
interface ResolvedEnd {
  readonly socket: { depth: number; radius: number; bore: number } | null;
  /** Raio externo junto à porta (bolsa ou cubo do flange) e comprimento da concordância. */
  readonly radius: number;
  readonly taper: number;
  /** Trecho junto à porta em que o raio é mantido (espessura do flange). */
  readonly hold: number;
}

function resolveEnd(end: ConduitEnd | null, bodyRadius: number, available: number): ResolvedEnd {
  const treatment = end?.treatment;
  if (!end || !treatment || treatment.length <= 0) {
    return { socket: null, radius: bodyRadius, taper: 0, hold: 0 };
  }
  if (treatment.type === 'socket') {
    const radius = Math.max(treatment.outerDiameter / 2, bodyRadius);
    return {
      socket: { depth: treatment.length, radius, bore: end.pipeRadius },
      radius,
      // Concordância a ~35° entre a bolsa e o corpo, limitada à metade do trecho.
      taper: Math.min((radius - bodyRadius) * 1.5, available),
      hold: 0,
    };
  }
  if (treatment.type === 'flange') {
    // Cubo do flange: reforço cônico atrás do disco (proporção genérica).
    const hub = Math.min(bodyRadius + treatment.length * 0.5, treatment.outerDiameter / 2);
    const hold = Math.min(treatment.length, available);
    return {
      socket: null,
      radius: hub,
      taper: Math.min(treatment.length, available - hold),
      hold,
    };
  }
  return { socket: null, radius: bodyRadius, taper: 0, hold: 0 };
}

/**
 * Corpo oco ao longo de uma trajetória: parede externa (com bolsas, concordâncias e
 * bojo), faces das extremidades e furo interno com batente no fundo das bolsas.
 */
function conduit(options: ConduitOptions): MeshData {
  const { path, bodyStart, bodyEnd, boreStart, boreEnd, bulge } = options;
  const total = path.length;
  const startEnd = resolveEnd(options.start, bodyStart, total / 2);
  const finishEnd = resolveEnd(options.end, bodyEnd, total / 2);

  const bodyAt = (s: number): number => lerp(bodyStart, bodyEnd, clamp01(s / total));
  const boreAt = (s: number): number => lerp(boreStart, boreEnd, clamp01(s / total));
  const blend = (end: ResolvedEnd, base: number, distance: number): number => {
    if (end.radius <= base) return 0;
    if (distance <= end.hold) return end.radius - base;
    if (end.taper <= 0) return 0;
    return (end.radius - base) * smooth(1 - (distance - end.hold) / end.taper);
  };
  const outerAt = (s: number): number => {
    const base = bodyAt(s);
    let extra = Math.max(
      options.start ? blend(startEnd, bodyStart, s) : 0,
      blend(finishEnd, bodyEnd, total - s),
    );
    if (bulge && bulge.radius > base) {
      extra = Math.max(
        extra,
        (bulge.radius - base) * smooth(1 - Math.abs(s - bulge.center) / bulge.half),
      );
    }
    return base + extra;
  };

  const raw: number[] = [0, total, ...path.samples];
  const STEPS = 8;
  for (let k = 0; k <= STEPS; k += 1) {
    const t = k / STEPS;
    raw.push(startEnd.hold + startEnd.taper * t, total - finishEnd.hold - finishEnd.taper * t);
    if (bulge) raw.push(bulge.center - bulge.half * t, bulge.center + bulge.half * t);
  }
  const tolerance = total * 1e-6;
  const samples = raw
    .filter((s) => s >= 0 && s <= total)
    .sort((a, b) => a - b)
    .filter((s, i, all) => i === 0 || s - (all[i - 1] as number) > tolerance);

  const points: ProfilePoint[] = [];
  const push = (s: number, radius: number, crease = false): void => {
    points.push({ ...path.at(s), radius, crease });
  };

  // Parede externa, do início para o fim.
  if (startEnd.socket) push(-startEnd.socket.depth, startEnd.socket.radius);
  samples.forEach((s, i) => {
    const last = i === samples.length - 1;
    push(s, outerAt(s), last && !finishEnd.socket);
  });
  // Extremidade final: borda da bolsa, furo da bolsa e batente.
  if (finishEnd.socket) {
    const { depth, radius, bore } = finishEnd.socket;
    push(total + depth, radius, true);
    push(total + depth, bore, true);
    push(total, bore, true);
  }
  // Furo, de volta ao início.
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    const s = samples[i] as number;
    push(s, boreAt(s), i === samples.length - 1 || i === 0);
  }
  // Extremidade inicial (omitida quando o início é aberto).
  if (options.start) {
    if (startEnd.socket) {
      const { depth, radius, bore } = startEnd.socket;
      push(0, bore, true);
      push(-depth, bore, true);
      push(-depth, radius);
    } else {
      push(0, outerAt(0));
    }
  }
  return loft(points, { up: path.up });
}

/** Sólido de revolução com arestas vivas: lista de [distância ao longo do eixo, raio]. */
function turned(
  origin: Vec3,
  axis: Vec3,
  profile: readonly (readonly [number, number])[],
  segments = 32,
): MeshData {
  const first = profile[0];
  const last = profile[profile.length - 1];
  if (!first || !last) throw new Error('Perfil vazio.');
  const point = (h: number, radius: number): ProfilePoint => ({
    center: add(origin, scale(axis, h)),
    tangent: axis,
    radius,
    crease: true,
  });
  return loft([point(first[0], 0), ...profile.map(([h, r]) => point(h, r)), point(last[0], 0)], {
    up: upFor(axis),
    radialSegments: segments,
  });
}

/** Disco do flange, da face (porta) para dentro da peça. */
function flangeParts(port: Port): MeshPart[] {
  const end = port.end;
  if (end?.type !== 'flange' || end.length <= 0) return [];
  const back = add(port.localPosition, scale(port.localDirection, -end.length));
  return [
    body(
      cylinder(back, port.localPosition, end.outerDiameter / 2, port.spec.innerDiameter / 2, 48),
    ),
  ];
}

/** Bocal reto que nasce dentro de outro corpo e termina na porta. */
function stub(from: Vec3, port: Port): MeshPart[] {
  const outer = port.spec.outerDiameter / 2;
  const inner = port.spec.innerDiameter / 2;
  return [
    body(
      conduit({
        path: linePath(from, port.localPosition),
        start: null,
        end: endOf(port),
        bodyStart: outer,
        bodyEnd: outer,
        boreStart: inner,
        boreEnd: inner,
      }),
    ),
    ...flangeParts(port),
  ];
}

/** Toro horizontal (aro do volante). */
function torus(center: Vec3, majorRadius: number, tubeRadius: number): MeshData {
  const steps = 40;
  const points: ProfilePoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const phi = (i / steps) * Math.PI * 2;
    points.push({
      center: add(center, vec3(majorRadius * Math.cos(phi), majorRadius * Math.sin(phi), 0)),
      tangent: vec3(-Math.sin(phi), Math.cos(phi), 0),
      radius: tubeRadius,
    });
  }
  return loft(points, { up: Z, radialSegments: 12 });
}

/** Volante: aro, dois raios cruzados e cubo, com o topo exatamente na cota `top`. */
function handwheel(top: number, radius: number, d: number): MeshPart[] {
  const tube = Math.max(radius * 0.07, d * 0.03);
  const z = top - tube;
  const reach = radius - tube;
  return [
    accent(torus(vec3(0, 0, z), reach, tube)),
    accent(cylinder(vec3(-reach, 0, z), vec3(reach, 0, z), tube * 0.7, 0, 12)),
    accent(cylinder(vec3(0, -reach, z), vec3(0, reach, z), tube * 0.7, 0, 12)),
    accent(cylinder(vec3(0, 0, top - tube * 2.4), vec3(0, 0, top), tube * 2, 0, 20)),
  ];
}

function valveParts(element: Extract<HydroElement, { kind: 'valve' }>, ports: Port[]): MeshPart[] {
  const d = element.spec.outerDiameter;
  const [a, b] = ports;
  if (!a) return [];

  if (element.valveType === 'airRelease') {
    // Ventosa: pescoço sobre o flange de entrada, corpo cilíndrico e tampa.
    const length = element.length;
    const radius = Math.max(d * 0.9, (a.end?.outerDiameter ?? 0) * 0.42);
    return [
      ...flangeParts(a),
      body(cylinder(ORIGIN, vec3(length * 0.2, 0, 0), d / 2, element.spec.innerDiameter / 2)),
      body(
        turned(ORIGIN, X, [
          [length * 0.2, radius * 0.8],
          [length * 0.26, radius],
          [length * 0.8, radius],
          [length * 0.8, radius * 1.08],
          [length * 0.86, radius * 1.08],
        ]),
      ),
      accent(
        turned(ORIGIN, X, [
          [length * 0.86, radius * 0.6],
          [length * 0.96, radius * 0.6],
          [length, radius * 0.35],
        ]),
      ),
    ];
  }
  if (!b) return [];

  const length = element.length;
  const outer = d / 2;
  const inner = element.spec.innerDiameter / 2;
  const top = element.height ?? d * 2.25;
  const wheel = (element.handwheelDiameter ?? d * 1.8) / 2;
  const socketRadius = a.end?.type === 'socket' ? a.end.outerDiameter / 2 : 0;

  const leverThickness = Math.max(d * 0.1, top * 0.06);

  // Bojo do corpo: proporção genérica. No registro soldável o diâmetro de bolsa tabulado
  // é o das porcas das extremidades; o corpo central fica abaixo da alavanca.
  const bulge = ((): ConduitOptions['bulge'] => {
    switch (element.valveType) {
      case 'ball':
        return socketRadius > 0
          ? {
              center: length / 2,
              half: length / 2,
              radius: Math.min(socketRadius, Math.max(inner * 1.3, top - leverThickness * 1.6)),
            }
          : { center: length / 2, half: Math.min(length * 0.45, d * 1.1), radius: d * 0.8 };
      case 'butterfly':
        return { center: length / 2, half: length / 2, radius: d * 0.62 };
      default:
        return { center: length / 2, half: Math.min(length * 0.4, d * 1.2), radius: d * 0.75 };
    }
  })();

  const parts: MeshPart[] = [
    body(
      conduit({
        path: linePath(a.localPosition, b.localPosition),
        start: endOf(a),
        end: endOf(b),
        bodyStart: outer,
        bodyEnd: outer,
        boreStart: inner,
        boreEnd: inner,
        bulge,
      }),
    ),
    ...flangeParts(a),
    ...flangeParts(b),
  ];

  switch (element.valveType) {
    case 'check': {
      // Retenção: tampa de inspeção aparafusada, sem acionamento.
      const cover = Math.min(top * 0.5, d * 1.2);
      parts.push(
        body(
          turned(ORIGIN, Z, [
            [0, d * 0.5],
            [cover - d * 0.1, d * 0.5],
            [cover - d * 0.1, d * 0.62],
            [cover, d * 0.62],
          ]),
        ),
      );
      return parts;
    }
    case 'gate':
    case 'globe': {
      // Castelo: pescoço, flange do castelo, tampa cônica, preme-gaxeta e haste.
      const neck = top * 0.38;
      const plate = Math.min(top * 0.05, d * 0.25);
      parts.push(
        body(
          turned(ORIGIN, Z, [
            [0, d * 0.5],
            [neck, d * 0.5],
            [neck, d * 0.72],
            [neck + plate, d * 0.72],
            [neck + plate, d * 0.44],
            [top * 0.68, d * 0.22],
            [top * 0.76, d * 0.22],
          ]),
        ),
        accent(cylinder(vec3(0, 0, top * 0.76), vec3(0, 0, top), d * 0.08, 0, 16)),
        ...handwheel(top, wheel, d),
      );
      return parts;
    }
    case 'butterfly': {
      const plate = top * 0.74;
      parts.push(
        body(
          turned(ORIGIN, Z, [
            [0, d * 0.2],
            [plate, d * 0.2],
            [plate, d * 0.34],
            [plate + top * 0.06, d * 0.34],
          ]),
        ),
      );
      break;
    }
    default:
      parts.push(body(cylinder(ORIGIN, vec3(0, 0, top * 0.8), d * 0.2, 0, 24)));
  }

  // Esfera/borboleta: haste e alavanca de 1/4 de volta (posição aberta, ao longo do
  // eixo), com o topo na altura de catálogo e o comprimento total de catálogo.
  const reach = Math.max(wheel, d);
  parts.push(
    accent(cylinder(vec3(0, 0, top * 0.5), vec3(0, 0, top - leverThickness), d * 0.12, 0, 16)),
    accent(box(vec3(-reach, -d * 0.16, top - leverThickness), vec3(reach, d * 0.16, top))),
  );
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

    case 'elbow': {
      const [a, b] = ports;
      if (!a || !b) return [];
      return [
        body(
          conduit({
            path: elbowPath(element.angle, element.bendRadius),
            start: endOf(a),
            end: endOf(b),
            bodyStart: outer,
            bodyEnd: outer,
            boreStart: inner,
            boreEnd: inner,
          }),
        ),
        ...flangeParts(a),
        ...flangeParts(b),
      ];
    }

    case 'tee': {
      const [a, b, branch] = ports;
      if (!a || !b || !branch) return [];
      return [
        body(
          conduit({
            path: linePath(a.localPosition, b.localPosition),
            start: endOf(a),
            end: endOf(b),
            bodyStart: outer,
            bodyEnd: outer,
            boreStart: inner,
            boreEnd: inner,
          }),
        ),
        ...flangeParts(a),
        ...flangeParts(b),
        ...stub(ORIGIN, branch),
      ];
    }

    case 'reducer': {
      const [a, b] = ports;
      if (!a || !b) return [];
      return [
        body(
          conduit({
            path: linePath(a.localPosition, b.localPosition),
            start: endOf(a),
            end: endOf(b),
            bodyStart: outer,
            bodyEnd: b.spec.outerDiameter / 2,
            boreStart: inner,
            boreEnd: b.spec.innerDiameter / 2,
          }),
        ),
        ...flangeParts(a),
        ...flangeParts(b),
      ];
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
        parts.push(...stub(from, nozzle));
      }
      return parts;
    }
  }
}

/** Geometria completa do elemento: partes no referencial local + transformação global. */
export function buildElementGeometry(element: HydroElement): ElementGeometry {
  const geometry = { transform: getElementFrame(element), parts: localParts(element) };
  return geometry;
}
