import { rotate, vec3 } from '@hydrobim/core';
import type { ElementGeometry, PartRole } from './elements';
import type { OutlineClipPlane, OutlineFrame } from './viewOutline';

/**
 * Seção de um elemento por um plano de corte: os contornos fechados em que o plano atravessa
 * a malha, nas coordenadas da vista. É o que permite desenhar o elemento CORTADO (traço forte
 * e hachura do material), em planta — plano horizontal — ou em corte — plano vertical.
 *
 * As malhas da arquitetura são fechadas, de modo que cada parte produz anéis fechados; anéis
 * internos (vãos) são furos, e o preenchimento par-ímpar os respeita sem classificá-los.
 */
export interface SectionLoops {
  readonly role: PartRole;
  /** Um anel por entrada: x1, y1, x2, y2… (coordenadas da vista, m), sem repetir o primeiro. */
  readonly loops: readonly Float64Array[];
}

const KEY = 1e-6;

export function sectionLoops(
  geometry: ElementGeometry,
  frame: OutlineFrame,
  plane: OutlineClipPlane,
): SectionLoops[] {
  const { position, rotation } = geometry.transform;
  const n = plane.normal;
  // Distância ao plano, calculada em relação à posição do elemento (números pequenos).
  const d0 =
    (plane.point.x - position.x) * n.x +
    (plane.point.y - position.y) * n.y +
    (plane.point.z - position.z) * n.z;
  const offset = vec3(
    position.x - frame.origin.x,
    position.y - frame.origin.y,
    position.z - frame.origin.z,
  );
  const result: SectionLoops[] = [];

  for (const part of geometry.parts) {
    const { positions, indices } = part.mesh;
    const points: { x: number; y: number; z: number; d: number }[] = [];
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const p = rotate(
        rotation,
        vec3(positions[i] ?? 0, positions[i + 1] ?? 0, positions[i + 2] ?? 0),
      );
      points.push({ ...p, d: p.x * n.x + p.y * n.y + p.z * n.z - d0 });
    }
    // Segmentos orientados (o interior fica sempre do mesmo lado), indexados pela origem.
    const next = new Map<string, { x: number; y: number; key: string }[]>();
    const starts: { x: number; y: number; key: string }[] = [];
    const view = (p: {
      x: number;
      y: number;
      z: number;
    }): { x: number; y: number; key: string } => {
      const q = { x: p.x + offset.x, y: p.y + offset.y, z: p.z + offset.z };
      const x = q.x * frame.u.x + q.y * frame.u.y + q.z * frame.u.z;
      const y = q.x * frame.v.x + q.y * frame.v.y + q.z * frame.v.z;
      return { x, y, key: `${Math.round(x / KEY)},${Math.round(y / KEY)}` };
    };
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const tri = [
        points[indices[t] ?? 0],
        points[indices[t + 1] ?? 0],
        points[indices[t + 2] ?? 0],
      ];
      const cuts: { x: number; y: number; z: number }[] = [];
      let entering = -1;
      for (let k = 0; k < 3; k += 1) {
        const a = tri[k];
        const b = tri[(k + 1) % 3];
        if (!a || !b) continue;
        // Vértice sobre o plano conta como do lado positivo: cada aresta cruza no máximo uma vez.
        const sa = a.d >= 0;
        const sb = b.d >= 0;
        if (sa === sb) continue;
        const s = a.d / (a.d - b.d);
        if (!sa && sb) entering = cuts.length;
        cuts.push({ x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s, z: a.z + (b.z - a.z) * s });
      }
      if (cuts.length !== 2 || entering < 0) continue;
      const from = view(cuts[entering] as { x: number; y: number; z: number });
      const to = view(cuts[1 - entering] as { x: number; y: number; z: number });
      if (from.key === to.key) continue;
      const list = next.get(from.key);
      const entry = { ...to };
      if (list) list.push(entry);
      else next.set(from.key, [entry]);
      starts.push(from);
    }

    const loops: Float64Array[] = [];
    for (const start of starts) {
      const first = next.get(start.key);
      if (!first || first.length === 0) continue;
      const ring: number[] = [start.x, start.y];
      let cursor = first.pop() as { x: number; y: number; key: string };
      let guard = starts.length + 2;
      while (cursor.key !== start.key && guard > 0) {
        guard -= 1;
        ring.push(cursor.x, cursor.y);
        const following = next.get(cursor.key);
        if (!following || following.length === 0) break;
        cursor = following.pop() as { x: number; y: number; key: string };
      }
      // Só anéis que fecham: uma malha aberta não tem seção definida.
      if (cursor.key === start.key && ring.length >= 6) loops.push(new Float64Array(ring));
    }
    if (loops.length > 0) result.push({ role: part.role, loops });
  }
  return result;
}

/** Área (com sinal) de um anel de `sectionLoops`. */
export function loopArea(loop: ArrayLike<number>): number {
  let sum = 0;
  const count = loop.length / 2;
  for (let i = 0; i < count; i += 1) {
    const j = (i + 1) % count;
    sum +=
      (loop[i * 2] ?? 0) * (loop[j * 2 + 1] ?? 0) - (loop[j * 2] ?? 0) * (loop[i * 2 + 1] ?? 0);
  }
  return sum / 2;
}
