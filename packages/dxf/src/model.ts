import { hasDesignTerrain, projectEarthworks, rotate, vec3, type Project } from '@hydrobim/core';
import { buildElementGeometry, type PartRole } from '@hydrobim/geometry';
import { systemLayers } from './layers';
import { DxfDocument, type Aci } from './writer';

/** Cor própria das partes que não seguem a cor do sistema (acionamento, inox, epóxi). */
const ROLE_COLORS: Partial<Record<PartRole, Aci>> = { accent: 1, trim: 9, coated: 5, castIron: 8 };

const WELD = 1e-5;
/** Faces vizinhas com normais a menos de ~1° são tratadas como uma face plana. */
const COPLANAR_COS = Math.cos((1 * Math.PI) / 180);
const LAYER_TERRAIN = 'HB-TERRENO';
const LAYER_DESIGN_TERRAIN = 'HB-TERRENO-PROJETADO';
const LAYER_CUT = 'HB-TERRAPLENAGEM-CORTE';
const LAYER_FILL = 'HB-TERRAPLENAGEM-ATERRO';

/**
 * Modelo 3D em DXF: cada parte de cada elemento é uma malha poliface, em coordenadas do
 * projeto (metros, Z para cima), na camada do seu sistema. A geometria é a mesma malha
 * paramétrica do viewport e do IFC. Sistemas ocultos são exportados em camadas desligadas;
 * o terreno natural, quando existe, vai para a camada `HB-TERRENO`; com platôs, o terreno
 * projetado vai para `HB-TERRENO-PROJETADO` e os sólidos de corte e de aterro para
 * `HB-TERRAPLENAGEM-CORTE` e `HB-TERRAPLENAGEM-ATERRO`.
 *
 * São superfícies facetadas, não sólidos: servem para coordenação e conferência no CAD, não
 * para operações booleanas nem para extrair diâmetros.
 */
export function exportModelDxf(project: Project): string {
  const doc = new DxfDocument();
  const layers = systemLayers(doc, project, true);

  for (const element of project.elements) {
    const layer = layers.of(element.systemId);
    const { transform, parts } = buildElementGeometry(element);
    for (const part of parts) {
      const { positions, indices } = part.mesh;
      // Solda os vértices duplicados nas quinas para reconhecer as arestas compartilhadas.
      const vertices: number[] = [];
      const welded = new Map<string, number>();
      const remap = new Int32Array(positions.length / 3);
      for (let i = 0; i < remap.length; i += 1) {
        const p = rotate(
          transform.rotation,
          vec3(positions[i * 3] ?? 0, positions[i * 3 + 1] ?? 0, positions[i * 3 + 2] ?? 0),
        );
        const x = p.x + transform.position.x;
        const y = p.y + transform.position.y;
        const z = p.z + transform.position.z;
        const key = `${Math.round(x / WELD)},${Math.round(y / WELD)},${Math.round(z / WELD)}`;
        let index = welded.get(key);
        if (index === undefined) {
          index = vertices.length / 3;
          welded.set(key, index);
          vertices.push(x, y, z);
        }
        remap[i] = index;
      }

      const faces: number[] = [];
      const normals: number[] = [];
      for (let t = 0; t + 2 < indices.length; t += 3) {
        const a = remap[indices[t] ?? 0] ?? 0;
        const b = remap[indices[t + 1] ?? 0] ?? 0;
        const c = remap[indices[t + 2] ?? 0] ?? 0;
        if (a === b || b === c || a === c) continue;
        const ux = (vertices[b * 3] ?? 0) - (vertices[a * 3] ?? 0);
        const uy = (vertices[b * 3 + 1] ?? 0) - (vertices[a * 3 + 1] ?? 0);
        const uz = (vertices[b * 3 + 2] ?? 0) - (vertices[a * 3 + 2] ?? 0);
        const vx = (vertices[c * 3] ?? 0) - (vertices[a * 3] ?? 0);
        const vy = (vertices[c * 3 + 1] ?? 0) - (vertices[a * 3 + 1] ?? 0);
        const vz = (vertices[c * 3 + 2] ?? 0) - (vertices[a * 3 + 2] ?? 0);
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const size = Math.hypot(nx, ny, nz);
        if (size < 1e-14) continue;
        faces.push(a, b, c);
        normals.push(nx / size, ny / size, nz / size);
      }

      // Aresta entre duas faces coplanares = diagonal da triangulação: fica invisível.
      const edges = new Map<string, number[]>();
      const edgeKey = (p: number, q: number): string => (p < q ? `${p}|${q}` : `${q}|${p}`);
      for (let f = 0; f < faces.length; f += 3) {
        for (let k = 0; k < 3; k += 1) {
          const key = edgeKey(faces[f + k] ?? 0, faces[f + ((k + 1) % 3)] ?? 0);
          const list = edges.get(key);
          if (list) list.push(f);
          else edges.set(key, [f]);
        }
      }
      const hiddenEdges = new Uint8Array(faces.length);
      for (let f = 0; f < faces.length; f += 3) {
        for (let k = 0; k < 3; k += 1) {
          const list = edges.get(edgeKey(faces[f + k] ?? 0, faces[f + ((k + 1) % 3)] ?? 0));
          if (list?.length !== 2) continue;
          const [p, q] = list;
          if (p === undefined || q === undefined) continue;
          const cos =
            (normals[p] ?? 0) * (normals[q] ?? 0) +
            (normals[p + 1] ?? 0) * (normals[q + 1] ?? 0) +
            (normals[p + 2] ?? 0) * (normals[q + 2] ?? 0);
          if (cos > COPLANAR_COS) hiddenEdges[f + k] = 1;
        }
      }
      doc.polyface(layer, vertices, faces, hiddenEdges, ROLE_COLORS[part.role]);
    }
  }

  const { terrain } = project;
  if (terrain && terrain.triangles.length >= 3) {
    const layer = doc.addLayer(LAYER_TERRAIN, 3);
    doc.polyface(
      layer,
      terrain.points.flatMap((p) => [p.x, p.y, p.z]),
      terrain.triangles,
    );
  }
  // Terraplenagem: terreno projetado (natural modificado pelos platôs) e os sólidos de corte e
  // de aterro, em camadas próprias. O natural segue em `HB-TERRENO`, como sempre esteve.
  const summary = hasDesignTerrain(project) ? projectEarthworks(project) : null;
  if (summary) {
    const design = summary.design.terrain;
    doc.polyface(
      doc.addLayer(LAYER_DESIGN_TERRAIN, 4),
      design.points.flatMap((p) => [p.x, p.y, p.z]),
      design.triangles,
    );
    const solids = (pick: 'cutSolid' | 'fillSolid', layerName: string, color: Aci): void => {
      let layer: string | null = null;
      for (const entry of summary.platforms) {
        const solid = entry.volumes?.[pick];
        if (!solid || solid.triangles.length < 3) continue;
        layer ??= doc.addLayer(layerName, color);
        doc.polyface(
          layer,
          solid.points.flatMap((p) => [p.x, p.y, p.z]),
          solid.triangles,
        );
      }
    };
    solids('cutSolid', LAYER_CUT, 1);
    solids('fillSolid', LAYER_FILL, 5);
  }
  return doc.toString();
}
