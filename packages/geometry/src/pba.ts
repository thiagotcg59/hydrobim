import { vec3, type Vec3 } from '@hydrobim/core';
import type { MeshPart } from './elements';
import { box } from './loft';
import { body, seal } from './primitives';
import {
  branchRing,
  circle,
  holedCylinder,
  mapMesh,
  mergeMeshes,
  profileRings,
  saddleAngles,
  saddleRing,
  shell,
  skin,
  straightAxis,
  strip,
  uniformAngles,
  type Axis,
  type BranchSide,
  type ProfileNode,
  type Ring,
} from './skin';
import type { MeshData } from './sweep';

/**
 * Tubos e conexões de PVC com junta elástica (linha PBA), modelados a partir das cotas das
 * tabelas do fabricante. Todas as dimensões chegam em METROS, já resolvidas por quem chama
 * (o pacote de geometria não conhece o catálogo).
 *
 * VEM DAS TABELAS: diâmetro externo (A), diâmetro interno da boca (B) e profundidade (C)
 * das bolsas; diâmetro e comprimento das pontas (D, F); comprimentos totais (L, L1);
 * espessura dos tubos (e); cotas dos anéis.
 *
 * É REPRESENTAÇÃO (não tabulado): a posição e a largura do alojamento do anel dentro da
 * bolsa, os raios de concordância, a espessura de parede das conexões (informada por quem
 * chama, com a origem declarada no catálogo) e os detalhes do colar de tomada.
 */

/** Bolsa de junta elástica: Ø externo sobre o alojamento do anel, Ø da boca e profundidade. */
export interface JeSocket {
  readonly outerDiameter: number;
  readonly boreDiameter: number;
  readonly depth: number;
}

/** Anel JERI (bilabial): Ø externo D, Ø interno frontal C, altura A e espessura máxima B. */
export interface JeriSeal {
  readonly outerDiameter: number;
  readonly frontDiameter: number;
  readonly height: number;
  readonly thickness: number;
}

export type PbaShape =
  /** Tubo ponta e bolsa: `length` é o comprimento total (L), bolsa incluída. */
  | {
      readonly type: 'pipe';
      readonly outerDiameter: number;
      readonly wall: number;
      readonly length: number;
      readonly socket: JeSocket;
      /** Anel montado na bolsa (o tubo é fornecido com o anel JERI). */
      readonly seal?: JeriSeal;
    }
  /** Curva ponta e bolsa conformada: trecho reto `lead` após a bolsa, arco e ponta `tail`. */
  | {
      readonly type: 'bend';
      readonly angle: number;
      readonly outerDiameter: number;
      readonly wall: number;
      readonly socket: JeSocket;
      readonly lead: number;
      readonly bendRadius: number;
      readonly tail: number;
    }
  /** Tê (uma derivação) ou cruzeta (duas, opostas), com bolsas em todas as bocas. */
  | {
      readonly type: 'tee';
      readonly socket: JeSocket;
      readonly wall: number;
      readonly bore: number;
      /** Comprimento total da passagem, de boca a boca (L). */
      readonly length: number;
      readonly branch: {
        readonly socket: JeSocket;
        readonly bore: number;
        /** Do eixo da passagem à boca da derivação. */
        readonly reach: number;
        /** Parede da bolsa da derivação; ausente = a da passagem. */
        readonly wall?: number;
      };
      readonly branches: 1 | 2;
    }
  | {
      readonly type: 'cap';
      readonly socket: JeSocket;
      readonly wall: number;
      readonly bore: number;
      readonly length: number;
    }
  /** Luva de correr: duas bolsas e furo passante, sem batente. */
  | {
      readonly type: 'slipCoupling';
      readonly socket: JeSocket;
      readonly wall: number;
      readonly length: number;
    }
  /** Luva simples: bolsa lisa (soldável) de um lado e bolsa de junta elástica do outro. */
  | {
      readonly type: 'transitionCoupling';
      readonly socket: JeSocket;
      readonly wall: number;
      readonly bore: number;
      readonly plainSocket: { readonly boreDiameter: number; readonly depth: number };
      readonly length: number;
    }
  /** Redução: ponta no diâmetro maior e bolsa no menor. */
  | {
      readonly type: 'reducer';
      readonly socket: JeSocket;
      readonly wall: number;
      readonly bore: number;
      readonly spigot: {
        readonly outerDiameter: number;
        readonly length: number;
        readonly wall: number;
      };
      readonly length: number;
    }
  /** Adaptador conformado: bolsa PBA e ponta com o diâmetro externo de outra linha. */
  | {
      readonly type: 'adapter';
      readonly socket: JeSocket;
      readonly wall: number;
      readonly bodyDiameter: number;
      readonly spigot: { readonly outerDiameter: number; readonly length: number };
      readonly length: number;
    }
  /** Colar de tomada: abraçadeira sobre o tubo com saída roscada. */
  | {
      readonly type: 'saddle';
      readonly pipeDiameter: number;
      /** Largura total entre as abas (perpendicular ao tubo). */
      readonly width: number;
      /** Altura total, da base da abraçadeira ao topo da saída. */
      readonly height: number;
      readonly boss: { readonly diameter: number; readonly bore: number };
      readonly band: { readonly thickness: number; readonly length: number };
    }
  | ({ readonly type: 'jeriSeal' } & JeriSeal)
  | { readonly type: 'oRing'; readonly outerDiameter: number; readonly cord: number };

const SEGMENTS = 48;
const STRAIGHT = 8;
const ANGLES = uniformAngles(SEGMENTS);
const X = vec3(1, 0, 0);
const Y = vec3(0, 1, 0);
const Z = vec3(0, 0, 1);
const ORIGIN = vec3(0, 0, 0);
const X_AXIS = straightAxis(ORIGIN, X, Y);

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Concordância suave entre dois nós (exclui o nó inicial, inclui o final). */
function ramp(s0: number, r0: number, s1: number, r1: number, steps = 5): ProfileNode[] {
  const nodes: ProfileNode[] = [];
  for (let k = 1; k <= steps; k += 1) {
    const t = k / steps;
    nodes.push([s0 + (s1 - s0) * t, r0 + (r1 - r0) * smooth(t)]);
  }
  return nodes;
}

interface SocketProfile {
  /** Nós com `s` crescente do batente (0) à boca (profundidade). */
  readonly outer: ProfileNode[];
  readonly inner: ProfileNode[];
  /** Raio externo do cano da bolsa e raio do fundo do alojamento do anel. */
  readonly barrel: number;
  readonly groove: number;
}

/** Frações da profundidade em que fica o alojamento do anel (representação). */
const GROOVE = { rise: 0.56, top: 0.65, fall: 0.86, lip: 0.9, innerStart: 0.64, innerEnd: 0.88 };

/**
 * Perfil da bolsa de junta elástica. `formed` = bolsa conformada no próprio tubo (parede
 * constante, transição cônica até o corpo); senão, bolsa injetada com batente interno.
 */
function socketProfile(
  socket: JeSocket,
  wall: number,
  bodyOuter: number,
  bodyBore: number,
  formed: boolean,
): SocketProfile {
  const depth = socket.depth;
  const bore = socket.boreDiameter / 2;
  const top = socket.outerDiameter / 2;
  // A parede não pode consumir o ressalto do alojamento do anel.
  const t = Math.min(wall, (top - bore) * 0.45);
  const barrel = bore + t;
  const groove = top - t;
  const chamfer = t * 0.25;
  const taper = formed ? depth * 0.14 : 0;

  const outer: ProfileNode[] = formed
    ? [[0, bodyOuter], ...ramp(0, bodyOuter, taper, barrel, 3)]
    : [[0, barrel]];
  outer.push(
    [depth * GROOVE.rise, barrel],
    ...ramp(depth * GROOVE.rise, barrel, depth * GROOVE.top, top),
    [depth * GROOVE.fall, top],
    ...ramp(depth * GROOVE.fall, top, depth * GROOVE.lip, barrel, 3),
    [depth, barrel, true],
  );

  const inner: ProfileNode[] = formed
    ? [[0, bodyBore], ...ramp(0, bodyBore, taper, bore, 3)]
    : [
        [0, bodyBore, true],
        [0, bore, true],
      ];
  inner.push(
    [depth * GROOVE.innerStart, bore, true],
    [depth * (GROOVE.innerStart + 0.04), groove, true],
    [depth * (GROOVE.innerEnd - 0.03), groove, true],
    [depth * GROOVE.innerEnd, bore, true],
    [depth - chamfer, bore, true],
    [depth, bore + chamfer, true],
  );
  return { outer, inner, barrel, groove };
}

/** Posiciona nós locais (0 = batente) no eixo da peça; devolve-os com `s` crescente. */
function place(nodes: readonly ProfileNode[], origin: number, direction: 1 | -1): ProfileNode[] {
  const mapped = nodes.map(([s, r, crease]): ProfileNode => [origin + direction * s, r, crease]);
  return direction === 1 ? mapped : mapped.reverse();
}

/** Chanfro da ponta: 15°, deixando metade da espessura na extremidade (FT, item 4.3). */
const chamferLength = (wall: number): number => wall / 2 / Math.tan((15 * Math.PI) / 180);

function pipeParts(shape: Extract<PbaShape, { type: 'pipe' }>): MeshPart[] {
  const { wall, length, socket } = shape;
  const outer = shape.outerDiameter / 2;
  const start = length - socket.depth;
  const profile = socketProfile(socket, wall, outer, outer - wall, true);
  const chamfer = Math.min(chamferLength(wall), start * 0.2);
  const parts = [
    body(
      shell(
        X_AXIS,
        [[0, outer - wall / 2], [chamfer, outer, true], ...place(profile.outer, start, 1)],
        [[0, outer - wall], ...place(profile.inner, start, 1)],
        ANGLES,
      ),
    ),
  ];
  if (shape.seal) {
    // Anel montado: ocupa o alojamento; o lábio de vedação chega ao Ø externo da ponta.
    const from = start + socket.depth * (GROOVE.innerStart + 0.045);
    const to = start + socket.depth * (GROOVE.innerEnd - 0.035);
    const lip = Math.min(shape.seal.outerDiameter / 2 - shape.seal.thickness, outer);
    const front = Math.min(shape.seal.frontDiameter / 2, profile.groove * 0.98);
    const back = profile.groove - 1e-4;
    parts.push(
      seal(
        strip(
          X_AXIS,
          [
            [from, back, true],
            [to, back, true],
            [to, Math.max(front, lip), true],
            [from + (to - from) * 0.3, lip, true],
            [from, lip + (back - lip) * 0.45, true],
            [from, back, true],
          ],
          ANGLES,
        ),
      ),
    );
  }
  return parts;
}

function bendParts(shape: Extract<PbaShape, { type: 'bend' }>): MeshPart[] {
  const { angle, wall, socket, lead, bendRadius, tail } = shape;
  const outer = shape.outerDiameter / 2;
  const arc = bendRadius * angle;
  const total = lead + arc + tail;
  const out = vec3(Math.cos(angle), 0, -Math.sin(angle));
  const arcEnd = vec3(lead + bendRadius * Math.sin(angle), 0, -bendRadius * (1 - Math.cos(angle)));
  // Linha de centro no plano XZ: batente da bolsa na origem, ponta para baixo (−Z), como
  // no desenho do fabricante.
  const axis: Axis = {
    up: Y,
    at: (s) => {
      if (s <= lead) return { center: vec3(s, 0, 0), tangent: X };
      if (s >= lead + arc) {
        const beyond = s - lead - arc;
        return {
          center: vec3(arcEnd.x + out.x * beyond, 0, arcEnd.z + out.z * beyond),
          tangent: out,
        };
      }
      const phi = (s - lead) / bendRadius;
      return {
        center: vec3(lead + bendRadius * Math.sin(phi), 0, -bendRadius * (1 - Math.cos(phi))),
        tangent: vec3(Math.cos(phi), 0, -Math.sin(phi)),
      };
    },
  };
  const steps = Math.max(4, Math.ceil(angle / ((5 * Math.PI) / 180)));
  const samples = Array.from({ length: steps + 1 }, (_, i) => lead + (arc * i) / steps);
  const profile = socketProfile(socket, wall, outer, outer - wall, true);
  // Ponta de topo reto, como no desenho do fabricante: a cota L vai até a sua aresta.
  return [
    body(
      shell(
        axis,
        [
          ...place(profile.outer, 0, -1),
          ...samples.map((s): ProfileNode => [s, outer]),
          [total, outer],
        ],
        [
          ...place(profile.inner, 0, -1),
          ...samples.map((s): ProfileNode => [s, outer - wall]),
          [total, outer - wall],
        ],
        ANGLES,
      ),
    ),
  ];
}

/** Menor folga aceita entre a derivação e o batente da bolsa (evita malhas degeneradas). */
const MARGIN = 1e-5;

/** Verifica se a geometria do tê cabe nas cotas informadas. */
export function teeIsBuildable(shape: Extract<PbaShape, { type: 'tee' }>): boolean {
  const run = socketProfile(shape.socket, shape.wall, 0, shape.bore / 2, false);
  const out = socketProfile(
    shape.branch.socket,
    shape.branch.wall ?? shape.wall,
    0,
    shape.branch.bore / 2,
    false,
  );
  const stop = shape.length / 2 - shape.socket.depth;
  const branchStop = shape.branch.reach - shape.branch.socket.depth;
  return (
    out.barrel <= run.barrel + 1e-9 &&
    shape.branch.bore <= shape.bore + 1e-9 &&
    stop > out.barrel + MARGIN &&
    branchStop > run.barrel + MARGIN &&
    shape.bore / 2 < shape.socket.boreDiameter / 2 + 1e-9
  );
}

function teeParts(shape: Extract<PbaShape, { type: 'tee' }>): MeshPart[] {
  if (!teeIsBuildable(shape)) throw new Error('As cotas do tê não permitem gerar a geometria.');
  const bore = shape.bore / 2;
  const branchBore = shape.branch.bore / 2;
  const run = socketProfile(shape.socket, shape.wall, 0, bore, false);
  const out = socketProfile(
    shape.branch.socket,
    shape.branch.wall ?? shape.wall,
    0,
    branchBore,
    false,
  );
  const stop = shape.length / 2 - shape.socket.depth;
  const branchStop = shape.branch.reach - shape.branch.socket.depth;
  // Trecho central (com os furos das derivações): até o meio da folga antes do batente.
  const half = (Math.min(out.barrel, run.barrel) + stop) / 2;
  const sides: BranchSide[] = shape.branches === 2 ? [1, -1] : [1];
  const meshes: MeshData[] = [];

  // Bolsas da passagem: furo de volta até a boca e parede externa até o trecho central.
  meshes.push(
    strip(
      X_AXIS,
      [
        [-half, bore],
        ...place(run.inner, -stop, -1).reverse(),
        ...place(run.outer, -stop, -1),
        [-half, run.barrel],
      ],
      ANGLES,
    ),
    strip(
      X_AXIS,
      [
        [half, run.barrel],
        ...place(run.outer, stop, 1),
        ...place(run.inner, stop, 1).reverse(),
        [half, bore],
      ],
      ANGLES,
    ),
    holedCylinder(
      run.barrel,
      half,
      sides.map((side) => ({ side, radius: out.barrel })),
      false,
      SEGMENTS,
      STRAIGHT,
    ),
    holedCylinder(
      bore,
      half,
      sides.map((side) => ({ side, radius: branchBore })),
      true,
      SEGMENTS,
      STRAIGHT,
    ),
  );

  const angles = saddleAngles(SEGMENTS, STRAIGHT);
  for (const side of sides) {
    const axis = straightAxis(ORIGIN, vec3(0, side, 0), X);
    const rings: Ring[] = [
      { points: saddleRing(side, run.barrel, out.barrel, angles) },
      { points: branchRing(side, run.barrel, out.barrel, angles) },
      ...profileRings(axis, place(out.outer, branchStop, 1), angles),
      ...profileRings(axis, place(out.inner, branchStop, 1).reverse(), angles),
      { points: branchRing(side, bore, branchBore, angles) },
      { points: saddleRing(side, bore, branchBore, angles) },
    ];
    meshes.push(skin(rings));
  }
  return [body(mergeMeshes(meshes))];
}

function capParts(shape: Extract<PbaShape, { type: 'cap' }>): MeshPart[] {
  const { socket, wall, length } = shape;
  const bore = shape.bore / 2;
  const profile = socketProfile(socket, wall, 0, bore, false);
  const stop = socket.depth;
  const chamber = length - stop;
  // Fundo levemente abaulado com canto arredondado (proporções de representação).
  const corner = Math.min(wall * 2, chamber * 0.45, profile.barrel * 0.4);
  const dome = Math.min(profile.barrel * 0.08, chamber * 0.2);
  const flat = profile.barrel - corner;
  const outer: ProfileNode[] = [...place(profile.outer, stop, -1)];
  for (let k = 0; k <= 6; k += 1) {
    const phi = (k / 6) * (Math.PI / 2);
    outer.push([length - dome - corner + corner * Math.sin(phi), flat + corner * Math.cos(phi)]);
  }
  for (let k = 1; k <= 5; k += 1) {
    const r = flat * (1 - k / 5);
    outer.push([length - dome * (r / flat) ** 2, r]);
  }
  const end = Math.max(length - Math.min(wall, chamber * 0.6), stop + chamber * 0.3);
  const fillet = Math.min(wall, (end - stop) * 0.4, bore * 0.4);
  const inner: ProfileNode[] = [...place(profile.inner, stop, -1)];
  for (let k = 0; k <= 4; k += 1) {
    const phi = (k / 4) * (Math.PI / 2);
    inner.push([end - fillet + fillet * Math.sin(phi), bore - fillet + fillet * Math.cos(phi)]);
  }
  inner.push([end, 0]);
  return [body(shell(X_AXIS, outer, inner, ANGLES))];
}

function slipCouplingParts(shape: Extract<PbaShape, { type: 'slipCoupling' }>): MeshPart[] {
  const { socket, wall, length } = shape;
  const bore = socket.boreDiameter / 2;
  // Sem batente: o furo da bolsa segue por todo o comprimento.
  const profile = socketProfile(socket, wall, 0, bore, false);
  const depth = Math.min(socket.depth, length / 2);
  return [
    body(
      shell(
        X_AXIS,
        [...place(profile.outer, depth, -1), ...place(profile.outer, length - depth, 1)],
        [...place(profile.inner, depth, -1), ...place(profile.inner, length - depth, 1)],
        ANGLES,
      ),
    ),
  ];
}

function transitionCouplingParts(
  shape: Extract<PbaShape, { type: 'transitionCoupling' }>,
): MeshPart[] {
  const { socket, wall, length, plainSocket } = shape;
  const bore = shape.bore / 2;
  const profile = socketProfile(socket, wall, 0, bore, false);
  const stop = length - socket.depth;
  const plain = plainSocket.boreDiameter / 2;
  const chamfer = wall * 0.25;
  // Cintura externa sobre o batente central, como no desenho do fabricante (representação).
  const middle = (plainSocket.depth + stop) / 2;
  const gap = Math.max(stop - plainSocket.depth, 0);
  const waist = Math.min(wall * 0.3, gap * 0.25);
  return [
    body(
      shell(
        X_AXIS,
        [
          [0, profile.barrel],
          [middle - gap * 0.35, profile.barrel, true],
          [middle, profile.barrel - waist, true],
          [middle + gap * 0.35, profile.barrel, true],
          ...place(profile.outer, stop, 1),
        ],
        [
          [0, plain + chamfer],
          [chamfer, plain, true],
          [plainSocket.depth, plain, true],
          [plainSocket.depth, bore, true],
          ...place(profile.inner, stop, 1),
        ],
        ANGLES,
      ),
    ),
  ];
}

function reducerParts(shape: Extract<PbaShape, { type: 'reducer' }>): MeshPart[] {
  const { socket, wall, length, spigot } = shape;
  const bore = shape.bore / 2;
  const outer = spigot.outerDiameter / 2;
  const profile = socketProfile(socket, wall, 0, bore, false);
  const stop = length - socket.depth;
  const chamfer = Math.min(chamferLength(spigot.wall), spigot.length * 0.3);
  return [
    body(
      shell(
        X_AXIS,
        [
          [0, outer - spigot.wall / 2],
          [chamfer, outer, true],
          [spigot.length, outer, true],
          // Ombro cônico entre a ponta e o cano da bolsa menor.
          [stop, profile.barrel, true],
          ...place(profile.outer, stop, 1),
        ],
        [
          [0, outer - spigot.wall],
          [spigot.length, outer - spigot.wall, true],
          ...place(profile.inner, stop, 1),
        ],
        ANGLES,
      ),
    ),
  ];
}

function adapterParts(shape: Extract<PbaShape, { type: 'adapter' }>): MeshPart[] {
  const { socket, wall, length, spigot } = shape;
  const bodyOuter = shape.bodyDiameter / 2;
  const outer = spigot.outerDiameter / 2;
  const profile = socketProfile(socket, wall, bodyOuter, bodyOuter - wall, true);
  const stop = socket.depth;
  const spigotStart = length - spigot.length;
  // Pescoço no diâmetro do tubo PBA e alargamento até a ponta (divisão de representação).
  const neck = stop + (spigotStart - stop) * 0.4;
  const chamfer = Math.min(chamferLength(wall), spigot.length * 0.3);
  return [
    body(
      shell(
        X_AXIS,
        [
          ...place(profile.outer, stop, -1),
          [neck, bodyOuter],
          ...ramp(neck, bodyOuter, spigotStart, outer),
          [length - chamfer, outer, true],
          [length, outer - wall / 2],
        ],
        [
          ...place(profile.inner, stop, -1),
          [neck, bodyOuter - wall],
          ...ramp(neck, bodyOuter - wall, spigotStart, outer - wall),
          [length, outer - wall],
        ],
        ANGLES,
      ),
    ),
  ];
}

function saddleParts(shape: Extract<PbaShape, { type: 'saddle' }>): MeshPart[] {
  const pipe = shape.pipeDiameter / 2;
  const band = pipe + shape.band.thickness;
  const half = shape.band.length / 2;
  // A saída nasce sobre a abraçadeira (interseção em sela), sem ultrapassá-la.
  const boss = Math.min(shape.boss.diameter / 2, band * 0.95, half * 0.9);
  // O furo de tomada não pode ser maior que o tubo nem que a parede da saída.
  const hole = Math.min(shape.boss.bore / 2, pipe * 0.75, boss * 0.85);
  const top = shape.height - band;
  const angles = saddleAngles(SEGMENTS, STRAIGHT);
  const ring = (height: number, radius: number): Ring => ({
    points: circle(vec3(0, height, 0), Y, X, radius, angles),
    crease: true,
  });

  const meshes: MeshData[] = [
    holedCylinder(band, half, [{ side: 1, radius: boss }], false, SEGMENTS, STRAIGHT),
    holedCylinder(pipe, half, [{ side: 1, radius: hole }], true, SEGMENTS, STRAIGHT),
    // Faces laterais da abraçadeira.
    strip(
      X_AXIS,
      [
        [-half, pipe, true],
        [-half, band, true],
      ],
      ANGLES,
    ),
    strip(
      X_AXIS,
      [
        [half, band, true],
        [half, pipe, true],
      ],
      ANGLES,
    ),
    // Saída roscada (rosca representada lisa) e furo de tomada até o interior do tubo.
    skin([
      { points: saddleRing(1, band, boss, angles) },
      ring(top, boss),
      ring(top, hole),
      { points: saddleRing(1, pipe, hole, angles) },
    ]),
  ]; // A saída é gerada em +Y; o colar é apresentado com a saída para cima (+Z).
  const upright = (v: Vec3): Vec3 => vec3(v.x, -v.z, v.y);
  const lug = shape.pipeDiameter * 0.36;
  const reach = shape.width / 2;
  const inside = band * 0.9;
  const lugs =
    reach > inside
      ? [
          body(box(vec3(-half, inside, -lug / 2), vec3(half, reach, lug / 2))),
          body(box(vec3(-half, -reach, -lug / 2), vec3(half, -inside, lug / 2))),
        ]
      : [];
  return [body(mapMesh(mergeMeshes(meshes), upright, upright)), ...lugs];
}

function jeriParts(shape: JeriSeal): MeshPart[] {
  const outer = shape.outerDiameter / 2;
  const { height, thickness } = shape;
  const front = shape.frontDiameter / 2;
  const lip = outer - thickness;
  const axis = straightAxis(ORIGIN, Z, X);
  // Seção bilabial: lado espesso (base, z = 0) voltado para o interior da bolsa; lado fino
  // (topo) voltado para a boca. Cotas D, C, A e B da tabela; o recorte entre os lábios é
  // representação.
  return [
    seal(
      strip(
        axis,
        [
          [0, outer - thickness * 0.2, true],
          [height * 0.18, outer, true],
          [height * 0.78, outer, true],
          [height, outer - Math.min(thickness * 0.25, (outer - front) * 0.5), true],
          [height, front, true],
          [height * 0.3, lip, true],
          [height * 0.06, lip + thickness * 0.28, true],
          [height * 0.22, lip + thickness * 0.45, true],
          [0, lip + thickness * 0.6, true],
          [0, outer - thickness * 0.2, true],
        ],
        ANGLES,
      ),
    ),
  ];
}

function oRingParts(shape: Extract<PbaShape, { type: 'oRing' }>): MeshPart[] {
  const cord = shape.cord / 2;
  const major = shape.outerDiameter / 2 - cord;
  const section = uniformAngles(20);
  const rings: Ring[] = [];
  const steps = 64;
  for (let i = 0; i <= steps; i += 1) {
    const phi = (i / steps) * Math.PI * 2;
    rings.push({
      points: circle(
        vec3(major * Math.cos(phi), major * Math.sin(phi), 0),
        vec3(-Math.sin(phi), Math.cos(phi), 0),
        Z,
        cord,
        section,
      ),
    });
  }
  return [seal(skin(rings))];
}

/** Partes (no referencial da peça) de um produto da linha PBA. */
export function buildPbaParts(shape: PbaShape): MeshPart[] {
  switch (shape.type) {
    case 'pipe':
      return pipeParts(shape);
    case 'bend':
      return bendParts(shape);
    case 'tee':
      return teeParts(shape);
    case 'cap':
      return capParts(shape);
    case 'slipCoupling':
      return slipCouplingParts(shape);
    case 'transitionCoupling':
      return transitionCouplingParts(shape);
    case 'reducer':
      return reducerParts(shape);
    case 'adapter':
      return adapterParts(shape);
    case 'saddle':
      return saddleParts(shape);
    case 'jeriSeal':
      return jeriParts(shape);
    case 'oRing':
      return oRingParts(shape);
  }
}
