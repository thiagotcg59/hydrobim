import { describe, expect, it } from 'vitest';
import {
  buildPbaParts,
  countOpenEdges,
  type MeshData,
  type MeshPart,
  type PbaShape,
} from './index';

const mm = (value: number): number => value / 1000;

function expectValidMesh(mesh: MeshData): void {
  const vertexCount = mesh.positions.length / 3;
  expect(vertexCount).toBeGreaterThan(0);
  expect(mesh.indices.length).toBeGreaterThan(0);
  expect(mesh.normals.length).toBe(mesh.positions.length);
  expect(mesh.indices.length % 3).toBe(0);
  expect(mesh.positions.every(Number.isFinite)).toBe(true);
  expect(mesh.indices.every((i) => i < vertexCount)).toBe(true);
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const len = Math.hypot(mesh.normals[i]!, mesh.normals[i + 1]!, mesh.normals[i + 2]!);
    expect(len).toBeCloseTo(1, 5);
  }
}

function extent(parts: readonly MeshPart[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    part.mesh.positions.forEach((value, i) => {
      min[i % 3] = Math.min(min[i % 3]!, value);
      max[i % 3] = Math.max(max[i % 3]!, value);
    });
  }
  return { min, max };
}

/** Volume com sinal (teorema da divergência): positivo quando as normais saem do sólido. */
function signedVolume(mesh: MeshData): number {
  const p = mesh.positions;
  let volume = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t]! * 3, mesh.indices[t + 1]! * 3, mesh.indices[t + 2]! * 3];
    volume +=
      p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) +
      p[a + 1]! * (p[b + 2]! * p[c]! - p[b]! * p[c + 2]!) +
      p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!);
  }
  return volume / 6;
}

/** As normais dos vértices acompanham a orientação das faces (sem faces invertidas). */
function expectNormalsFollowFaces(mesh: MeshData): void {
  const p = mesh.positions;
  const n = mesh.normals;
  let against = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t]! * 3, mesh.indices[t + 1]! * 3, mesh.indices[t + 2]! * 3];
    const u = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!];
    const v = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
    const face = [
      u[1]! * v[2]! - u[2]! * v[1]!,
      u[2]! * v[0]! - u[0]! * v[2]!,
      u[0]! * v[1]! - u[1]! * v[0]!,
    ];
    const sum = [
      n[a]! + n[b]! + n[c]!,
      n[a + 1]! + n[b + 1]! + n[c + 1]!,
      n[a + 2]! + n[b + 2]! + n[c + 2]!,
    ];
    if (face[0]! * sum[0]! + face[1]! * sum[1]! + face[2]! * sum[2]! < 0) against += 1;
  }
  expect(against).toBe(0);
}

// Cotas do catálogo Amanco Wavin (FT Linha PBA, jan/2025), DN50 salvo indicação.
const SOCKET = { outerDiameter: mm(82.9), boreDiameter: mm(60.5), depth: mm(60.5) };
const SOCKET_75 = { outerDiameter: mm(116.7), boreDiameter: mm(85.5), depth: mm(71) };
const WALL = mm(4.3);
const BORE = mm(51.4);

const SHAPES: Record<string, PbaShape> = {
  tubo: {
    type: 'pipe',
    outerDiameter: mm(60),
    wall: mm(2.7),
    length: mm(6110),
    socket: { outerDiameter: mm(78.2), boreDiameter: mm(60.4), depth: mm(85) },
  },
  'curva 90°': {
    type: 'bend',
    angle: Math.PI / 2,
    outerDiameter: mm(60),
    wall: WALL,
    socket: { outerDiameter: mm(81), boreDiameter: mm(60.5), depth: mm(70) },
    lead: mm(47.5),
    bendRadius: mm(104.5),
    tail: mm(122.2),
  },
  'curva 11°15′': {
    type: 'bend',
    angle: (11.25 * Math.PI) / 180,
    outerDiameter: mm(60),
    wall: WALL,
    socket: { outerDiameter: mm(81), boreDiameter: mm(60.5), depth: mm(70) },
    lead: mm(50.9),
    bendRadius: mm(104.5),
    tail: mm(122.2),
  },
  tê: {
    type: 'tee',
    socket: SOCKET,
    wall: WALL,
    bore: BORE,
    length: mm(198),
    branch: { socket: SOCKET, bore: BORE, reach: mm(140.5 - 82.9 / 2) },
    branches: 1,
  },
  'tê de redução 75×50': {
    type: 'tee',
    socket: SOCKET_75,
    wall: mm(6.1),
    bore: mm(72.8),
    length: mm(248),
    branch: { socket: SOCKET, bore: BORE, wall: WALL, reach: mm(171.4 - 116.7 / 2) },
    branches: 1,
  },
  cruzeta: {
    type: 'tee',
    socket: SOCKET,
    wall: WALL,
    bore: BORE,
    length: mm(198),
    branch: { socket: SOCKET, bore: BORE, reach: mm(99) },
    branches: 2,
  },
  'cruzeta de redução 75×50': {
    type: 'tee',
    socket: SOCKET_75,
    wall: mm(6.1),
    bore: mm(72.8),
    length: mm(248),
    branch: { socket: SOCKET, bore: BORE, wall: WALL, reach: mm(113) },
    branches: 2,
  },
  cap: { type: 'cap', socket: SOCKET, wall: WALL, bore: BORE, length: mm(77.4) },
  'luva de correr': { type: 'slipCoupling', socket: SOCKET, wall: WALL, length: mm(142) },
  'luva simples': {
    type: 'transitionCoupling',
    socket: SOCKET,
    wall: WALL,
    bore: BORE,
    plainSocket: { boreDiameter: mm(60), depth: mm(63.5) },
    length: mm(147.6),
  },
  'redução 75×50': {
    type: 'reducer',
    socket: SOCKET,
    wall: WALL,
    bore: BORE,
    spigot: { outerDiameter: mm(85), length: mm(81), wall: mm(6.1) },
    length: mm(166.5),
  },
  adaptador: {
    type: 'adapter',
    socket: { outerDiameter: mm(83), boreDiameter: mm(60.5), depth: mm(70) },
    wall: WALL,
    bodyDiameter: mm(60),
    spigot: { outerDiameter: mm(66), length: mm(102.5) },
    length: mm(206.4),
  },
  'anel JERI': {
    type: 'jeriSeal',
    outerDiameter: mm(81.7),
    frontDiameter: mm(67.3),
    height: mm(18.6),
    thickness: mm(10.9),
  },
  "anel O'Ring": { type: 'oRing', outerDiameter: mm(79), cord: mm(9.2) },
};

describe('produtos PBA', () => {
  it.each(Object.entries(SHAPES))(
    '%s: malha válida, fechada e com as normais para fora',
    (_name, shape) => {
      const parts = buildPbaParts(shape);
      expect(parts.length).toBeGreaterThan(0);
      for (const part of parts) {
        expectValidMesh(part.mesh);
        expect(countOpenEdges(part.mesh)).toBe(0);
        expect(signedVolume(part.mesh)).toBeGreaterThan(0);
        expectNormalsFollowFaces(part.mesh);
      }
    },
  );

  it('tubo: comprimento total, bolsa e espessura da tabela', () => {
    const { min, max } = extent(buildPbaParts(SHAPES.tubo!));
    expect(max[0]! - min[0]!).toBeCloseTo(6.11, 5);
    expect(max[1]).toBeCloseTo(mm(78.2 / 2), 6);
    // Volume de material próximo ao de um tubo liso de mesmo comprimento (bolsa à parte).
    const volume = signedVolume(buildPbaParts(SHAPES.tubo!)[0]!.mesh);
    const plain = Math.PI * (0.03 ** 2 - 0.0273 ** 2) * 6.11;
    expect(volume / plain).toBeGreaterThan(0.98);
    expect(volume / plain).toBeLessThan(1.1);
  });

  it('tubo com anel montado: o anel fica dentro da bolsa', () => {
    const parts = buildPbaParts({
      ...(SHAPES.tubo as Extract<PbaShape, { type: 'pipe' }>),
      seal: {
        outerDiameter: mm(81.7),
        frontDiameter: mm(67.3),
        height: mm(18.6),
        thickness: mm(10.9),
      },
    });
    expect(parts.map((p) => p.role)).toEqual(['body', 'seal']);
    const ring = extent([parts[1]!]);
    expect(ring.min[0]).toBeGreaterThan(6.11 - 0.085);
    expect(ring.max[0]).toBeLessThan(6.11);
    expect(ring.max[1]).toBeLessThan(mm(78.2 / 2));
    expect(countOpenEdges(parts[1]!.mesh)).toBe(0);
  });

  it('curva de 90°: a projeção no eixo da bolsa é a cota L do catálogo', () => {
    const { min, max } = extent(buildPbaParts(SHAPES['curva 90°']!));
    // L = C + trecho reto + R + D/2 = 70 + 47,5 + 104,5 + 30 = 252 mm.
    expect(max[0]! - min[0]!).toBeCloseTo(mm(252), 5);
    expect(min[0]).toBeCloseTo(mm(-70), 6);
    // A ponta desce R + F a partir do eixo da bolsa.
    expect(-min[2]!).toBeCloseTo(mm(104.5 + 122.2), 5);
    expect(max[1]).toBeCloseTo(mm(81 / 2), 6);
  });

  it('tê: comprimento L, altura L1 e bolsas com o Ø A', () => {
    const { min, max } = extent(buildPbaParts(SHAPES['tê']!));
    expect(max[0]! - min[0]!).toBeCloseTo(mm(198), 6);
    expect(max[1]! - min[1]!).toBeCloseTo(mm(140.5), 6);
    expect(max[2]).toBeCloseTo(mm(82.9 / 2), 6);
  });

  it('tê de redução e cruzetas: cotas totais do catálogo', () => {
    const reducing = extent(buildPbaParts(SHAPES['tê de redução 75×50']!));
    expect(reducing.max[0]! - reducing.min[0]!).toBeCloseTo(mm(248), 6);
    expect(reducing.max[1]! - reducing.min[1]!).toBeCloseTo(mm(171.4), 6);
    const cross = extent(buildPbaParts(SHAPES.cruzeta!));
    expect(cross.max[0]! - cross.min[0]!).toBeCloseTo(mm(198), 6);
    expect(cross.max[1]! - cross.min[1]!).toBeCloseTo(mm(198), 6);
    const reducingCross = extent(buildPbaParts(SHAPES['cruzeta de redução 75×50']!));
    expect(reducingCross.max[1]! - reducingCross.min[1]!).toBeCloseTo(mm(226), 6);
  });

  it('o furo da derivação atravessa a parede da passagem (interior oco)', () => {
    const mesh = buildPbaParts(SHAPES['tê']!)[0]!.mesh;
    // No eixo da derivação não há parede: nenhum vértice a menos do raio do furo.
    let closest = Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      if (mesh.positions[i + 1]! < 0.001) continue;
      closest = Math.min(closest, Math.hypot(mesh.positions[i]!, mesh.positions[i + 2]!));
    }
    expect(closest).toBeCloseTo(BORE / 2, 6);
  });

  it('cap, luvas, redução e adaptador: comprimento total e diâmetros da tabela', () => {
    const length = (name: string): number => {
      const { min, max } = extent(buildPbaParts(SHAPES[name]!));
      return max[0]! - min[0]!;
    };
    expect(length('cap')).toBeCloseTo(mm(77.4), 6);
    expect(length('luva de correr')).toBeCloseTo(mm(142), 6);
    expect(length('luva simples')).toBeCloseTo(mm(147.6), 6);
    expect(length('redução 75×50')).toBeCloseTo(mm(166.5), 6);
    expect(length('adaptador')).toBeCloseTo(mm(206.4), 6);
    // Na redução, o maior raio é o da ponta (Ø 85); no adaptador, o da bolsa (Ø 83).
    expect(extent(buildPbaParts(SHAPES['redução 75×50']!)).max[1]).toBeCloseTo(mm(42.5), 6);
    expect(extent(buildPbaParts(SHAPES.adaptador!)).max[1]).toBeCloseTo(mm(41.5), 6);
  });

  it('anéis: diâmetros e alturas da tabela', () => {
    const jeri = extent(buildPbaParts(SHAPES['anel JERI']!));
    expect(jeri.max[0]! - jeri.min[0]!).toBeCloseTo(mm(81.7), 6);
    expect(jeri.max[2]! - jeri.min[2]!).toBeCloseTo(mm(18.6), 6);
    const oring = extent(buildPbaParts(SHAPES["anel O'Ring"]!));
    expect(oring.max[0]! - oring.min[0]!).toBeCloseTo(mm(79), 6);
    expect(oring.max[2]! - oring.min[2]!).toBeCloseTo(mm(9.2), 6);
  });

  it('colar de tomada: altura e largura totais; furo de tomada aberto para o tubo', () => {
    const parts = buildPbaParts({
      type: 'saddle',
      pipeDiameter: mm(60),
      width: mm(90.7),
      height: mm(87.1),
      boss: { diameter: mm(30), bore: mm(20.955) },
      band: { thickness: mm(4.65), length: mm(37.5) },
    });
    for (const part of parts) {
      expectValidMesh(part.mesh);
      expectNormalsFollowFaces(part.mesh);
    }
    const { min, max } = extent(parts);
    expect(max[2]! - min[2]!).toBeCloseTo(mm(87.1), 6);
    expect(max[1]! - min[1]!).toBeCloseTo(mm(90.7), 6);
    expect(max[0]! - min[0]!).toBeCloseTo(mm(37.5), 6);
    // Abraçadeira com furo e saída: superfície única, sem arestas abertas.
    expect(countOpenEdges(parts[0]!.mesh)).toBe(0);
  });
});
