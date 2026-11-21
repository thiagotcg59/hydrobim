import { QUAT_IDENTITY, rotate, vec3, type Vec3 } from '@hydrobim/core';
import type { ElementGeometry, MeshPart } from './elements';
import { planOutline, type PlanOutline } from './plan';

/**
 * Projeção de um elemento em uma vista ortogonal qualquer (planta girada, corte, elevação),
 * com a geometria cortada pelos planos da vista.
 *
 * A malha paramétrica é levada ao referencial da vista — direita (`u`), para cima (`v`) e para
 * o observador (`w`) — e entregue à mesma projeção com linhas ocultas da planta
 * (`planOutline`): nela, "para cima" passa a ser "para o observador". Nada é desenhado à mão.
 */
export interface OutlineFrame {
  readonly origin: Vec3;
  readonly u: Vec3;
  readonly v: Vec3;
  readonly w: Vec3;
}

/** Semiespaço de corte: fica o que satisfaz (p − point)·normal ≥ 0. */
export interface OutlineClipPlane {
  readonly point: Vec3;
  readonly normal: Vec3;
}

type P3 = readonly [number, number, number];

/** Recorta um polígono convexo pelo semiespaço n·p ≥ d (Sutherland–Hodgman). */
function clipPolygon(polygon: P3[], n: P3, d: number): P3[] {
  const result: P3[] = [];
  const side = (p: P3): number => p[0] * n[0] + p[1] * n[1] + p[2] * n[2] - d;
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    if (!current || !next) continue;
    const a = side(current);
    const b = side(next);
    if (a >= 0) result.push(current);
    if (a >= 0 !== b >= 0) {
      // O ponto de corte é calculado sempre do vértice de dentro para o de fora: os dois
      // triângulos vizinhos da aresta chegam ao mesmo número e continuam soldados.
      const [inside, outside, si, so] = a >= 0 ? [current, next, a, b] : [next, current, b, a];
      const t = si / (si - so);
      result.push([
        inside[0] + (outside[0] - inside[0]) * t,
        inside[1] + (outside[1] - inside[1]) * t,
        inside[2] + (outside[2] - inside[2]) * t,
      ]);
    }
  }
  return result;
}

/**
 * Contorno do elemento na vista; `null` quando os planos de corte não deixam nada dele. As
 * coordenadas do resultado são as da vista (m), e `maxZ` é a posição mais próxima do
 * observador (ordem de desenho). As bordas abertas pelo corte saem como linhas visíveis.
 */
export function viewOutline(
  geometry: ElementGeometry,
  frame: OutlineFrame,
  clip: readonly OutlineClipPlane[] = [],
): PlanOutline | null {
  const { position, rotation } = geometry.transform;
  // Tudo é calculado em relação à posição do elemento: números pequenos, mesmo em redes
  // georreferenciadas, para que a malha (precisão simples) não perca os milímetros.
  const planes = clip.map((plane) => {
    const n: P3 = [plane.normal.x, plane.normal.y, plane.normal.z];
    const d =
      (plane.point.x - position.x) * n[0] +
      (plane.point.y - position.y) * n[1] +
      (plane.point.z - position.z) * n[2];
    return { n, d };
  });
  const axes: P3[] = [
    [frame.u.x, frame.u.y, frame.u.z],
    [frame.v.x, frame.v.y, frame.v.z],
    [frame.w.x, frame.w.y, frame.w.z],
  ];
  const project = (p: P3, axis: P3 | undefined): number =>
    axis ? p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2] : 0;

  const parts: MeshPart[] = [];
  for (const part of geometry.parts) {
    const { positions, indices } = part.mesh;
    const points: P3[] = [];
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const p = rotate(
        rotation,
        vec3(positions[i] ?? 0, positions[i + 1] ?? 0, positions[i + 2] ?? 0),
      );
      points.push([p.x, p.y, p.z]);
    }
    // Sem corte que atinja a parte, os índices originais são mantidos (vértices soldados).
    const distances = planes.map(({ n, d }) =>
      points.map((p) => p[0] * n[0] + p[1] * n[1] + p[2] * n[2] - d),
    );
    if (distances.some((list) => list.every((value) => value < 0))) continue;
    const cutting = planes.filter((_, i) => distances[i]?.some((value) => value < 0));

    const outPositions: number[] = [];
    const outIndices: number[] = [];
    const push = (p: P3): number => {
      outPositions.push(project(p, axes[0]), project(p, axes[1]), project(p, axes[2]));
      return outPositions.length / 3 - 1;
    };
    if (cutting.length === 0) {
      for (const p of points) push(p);
      for (const index of indices) outIndices.push(index);
    } else {
      for (let t = 0; t + 2 < indices.length; t += 3) {
        const a = points[indices[t] ?? 0];
        const b = points[indices[t + 1] ?? 0];
        const c = points[indices[t + 2] ?? 0];
        if (!a || !b || !c) continue;
        let polygon: P3[] = [a, b, c];
        for (const { n, d } of cutting) {
          polygon = clipPolygon(polygon, n, d);
          if (polygon.length < 3) break;
        }
        if (polygon.length < 3) continue;
        const first = push(polygon[0] as P3);
        let previous = push(polygon[1] as P3);
        for (let k = 2; k < polygon.length; k += 1) {
          const current = push(polygon[k] as P3);
          outIndices.push(first, previous, current);
          previous = current;
        }
      }
    }
    if (outIndices.length === 0) continue;
    parts.push({
      role: part.role,
      mesh: {
        positions: new Float32Array(outPositions),
        normals: new Float32Array(outPositions.length),
        indices: new Uint32Array(outIndices),
      },
    });
  }
  if (parts.length === 0) return null;

  const offset: P3 = [
    position.x - frame.origin.x,
    position.y - frame.origin.y,
    position.z - frame.origin.z,
  ];
  return planOutline({
    transform: {
      position: vec3(project(offset, axes[0]), project(offset, axes[1]), project(offset, axes[2])),
      rotation: QUAT_IDENTITY,
    },
    parts,
  });
}
