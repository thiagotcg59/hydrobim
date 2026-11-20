import { connectedPortRef, getElement, portKey } from './connectivity';
import { pipeRunOf } from './pipeRun';
import { getPorts, pipeLength } from './ports';
import type { Vec3 } from './math';
import type { HydroElement, Material, PortRef, Project } from './schema';
import { tankHydraulics } from './tanks';

/**
 * Exportação da rede para o formato INP do EPANET 2.x.
 *
 * Correspondência adotada:
 *  - cada tubulação contínua (tubos ligados direto, sem peça entre eles) vira UM trecho
 *    [PIPES], com a soma dos comprimentos e o diâmetro INTERNO; as mudanças de direção
 *    absorvidas pela junta ou pela curvatura do tubo viram [VERTICES] do traçado, não nós;
 *  - joelhos, tês e reduções são nós (as perdas localizadas não são atribuídas);
 *  - válvulas em linha viram trechos curtos [PIPES] (retenção com estado CV);
 *  - reservatórios viram [TANKS]; bombas viram [PUMPS] quando têm ponto nominal;
 *  - ventosas não são representadas.
 *
 * Coeficientes de rugosidade (Hazen-Williams) são valores usuais de referência por
 * material e DEVEM ser revistos pelo projetista. Demandas são exportadas como zero.
 */

export interface EpanetExport {
  inp: string;
  /** Pendências que o usuário precisa resolver para simular. */
  warnings: string[];
}

/** Coeficiente C de Hazen-Williams de referência por material (tubos novos). */
const HAZEN_WILLIAMS: Record<Material, number> = {
  pvc: 150,
  hdpe: 150,
  ductileIron: 130,
  carbonSteel: 120,
};

class UnionFind {
  private readonly parent = new Map<string, string>();
  find(key: string): string {
    let root = this.parent.get(key) ?? key;
    if (root !== key) {
      root = this.find(root);
      this.parent.set(key, root);
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const pad = (value: string | number, width = 16): string => String(value).padEnd(width);
const num = (value: number, digits = 3): string => value.toFixed(digits);

interface ContinuousRun {
  /** Tubos da tubulação, em ordem de percurso. */
  readonly ids: readonly string[];
  /** Portas das duas extremidades (os nós do trecho). */
  readonly from: PortRef;
  readonly to: PortRef;
  readonly length: number;
  /** Pontos de união entre tubos consecutivos, na ordem de `from` para `to`. */
  readonly vertices: readonly Vec3[];
  readonly name: string;
}

/**
 * Tubulação contínua que contém o tubo, quando tem mais de um trecho. `null` para tubo
 * isolado e para anel fechado só de tubos (as duas extremidades cairiam no mesmo nó, o que
 * o EPANET não aceita): nesses casos cada tubo é exportado separadamente.
 */
function continuousRun(project: Project, pipeId: string): ContinuousRun | null {
  const ids = pipeRunOf(project, pipeId);
  if (ids.length < 2) return null;
  const pipesOf = ids.map((id) => getElement(project, id));
  const vertices: Vec3[] = [];
  let from: PortRef | null = null;
  let to: PortRef | null = null;
  let length = 0;
  for (let i = 0; i < pipesOf.length; i += 1) {
    const pipe = pipesOf[i];
    if (pipe?.kind !== 'pipe') return null;
    length += pipeLength(pipe);
    const next = pipesOf[i + 1];
    // Extremidade deste tubo que está ligada ao seguinte.
    const exit = next
      ? (['start', 'end'] as const).find(
          (portId) =>
            connectedPortRef(project, { elementId: pipe.id, portId })?.elementId === next.id,
        )
      : undefined;
    if (next && !exit) return null;
    if (i === 0) from = { elementId: pipe.id, portId: exit === 'start' ? 'end' : 'start' };
    if (exit) vertices.push(exit === 'start' ? pipe.start : pipe.end);
    if (!next) {
      const previous = pipesOf[i - 1];
      const entry = (['start', 'end'] as const).find(
        (portId) =>
          connectedPortRef(project, { elementId: pipe.id, portId })?.elementId === previous?.id,
      );
      to = { elementId: pipe.id, portId: entry === 'end' ? 'start' : 'end' };
    }
  }
  const first = pipesOf[0];
  if (!from || !to || !first) return null;
  // Anel fechado: a última extremidade volta à primeira.
  const closing = connectedPortRef(project, to);
  if (closing && closing.elementId === from.elementId && closing.portId === from.portId)
    return null;
  return { ids, from, to, length, vertices, name: first.name };
}
export function exportEpanet(project: Project): EpanetExport {
  const warnings: string[] = [];
  const sets = new UnionFind();
  const position = new Map<string, { x: number; y: number; z: number }>();

  for (const element of project.elements) {
    const ports = getPorts(element);
    for (const port of ports) position.set(portKey(port.ref), port.position);
    // Elementos sem comprimento hidráulico: todas as portas formam um único nó.
    const collapses =
      element.kind === 'elbow' ||
      element.kind === 'tee' ||
      element.kind === 'cross' ||
      element.kind === 'reducer' ||
      element.kind === 'tank';
    const first = ports[0];
    if (collapses && first) {
      for (const port of ports) sets.union(portKey(first.ref), portKey(port.ref));
    }
  }
  for (const connection of project.connections) {
    sets.union(portKey(connection.a), portKey(connection.b));
  }

  // Numeração estável dos nós, na ordem dos elementos.
  const nodeIds = new Map<string, string>();
  const nodeOf = (elementId: string, portId: string): string => {
    const root = sets.find(portKey({ elementId, portId }));
    let id = nodeIds.get(root);
    if (!id) {
      id = `N${nodeIds.size + 1}`;
      nodeIds.set(root, id);
    }
    return id;
  };

  const tankNodes = new Map<string, HydroElement & { kind: 'tank' }>();
  const pipes: string[] = [];
  const pumps: string[] = [];
  const curves: string[] = [];
  const vertices: string[] = [];
  /** Tubos já exportados como parte de uma tubulação contínua. */
  const merged = new Set<string>();
  let mergedRuns = 0;
  let linkCount = 0;
  const link = (): string => `L${(linkCount += 1)}`;

  for (const element of project.elements) {
    const c = HAZEN_WILLIAMS[element.spec.material];
    const diameter = num(element.spec.innerDiameter * 1000, 1);
    switch (element.kind) {
      case 'pipe': {
        if (merged.has(element.id)) break;
        const run = continuousRun(project, element.id);
        if (!run) {
          pipes.push(
            `${pad(link())}${pad(nodeOf(element.id, 'start'))}${pad(nodeOf(element.id, 'end'))}${pad(num(pipeLength(element)))}${pad(diameter)}${pad(c)}${pad(0)}Open    ; ${element.name}`,
          );
          break;
        }
        // Tubulação contínua: um trecho só, do primeiro ao último tubo; os pontos de união
        // entre os tubos são vértices do desenho, sem nó hidráulico.
        for (const id of run.ids) merged.add(id);
        mergedRuns += 1;
        const id = link();
        pipes.push(
          `${pad(id)}${pad(nodeOf(run.from.elementId, run.from.portId))}${pad(nodeOf(run.to.elementId, run.to.portId))}${pad(num(run.length))}${pad(diameter)}${pad(c)}${pad(0)}Open    ; ${run.name} (${run.ids.length} trechos sem peça)`,
        );
        for (const point of run.vertices) {
          vertices.push(`${pad(id)}${pad(num(point.x))}${pad(num(point.y))}`);
        }
        break;
      }
      case 'valve':
        if (element.valveType === 'airRelease') {
          nodeOf(element.id, 'a');
          warnings.push(`"${element.name}" (ventosa) não é representada no EPANET.`);
        } else {
          if (element.valveType === 'pressureReducing') {
            warnings.push(
              `"${element.name}" (redutora de pressão) foi exportada como trecho aberto; defina a válvula PRV e a pressão de ajuste no EPANET.`,
            );
          }
          if (element.valveType === 'flowMeter') {
            warnings.push(
              `"${element.name}" (medidor de vazão) foi exportado como trecho aberto; a perda de carga do medidor não é representada.`,
            );
          }
          if (element.valveType === 'strainer') {
            warnings.push(
              `"${element.name}" (filtro Y) foi exportado como trecho aberto; a perda de carga do elemento filtrante não é representada.`,
            );
          }
          pipes.push(
            `${pad(link())}${pad(nodeOf(element.id, 'a'))}${pad(nodeOf(element.id, 'b'))}${pad(num(element.length))}${pad(diameter)}${pad(c)}${pad(0)}${element.valveType === 'check' ? 'CV  ' : 'Open'}    ; ${element.name} (válvula)`,
          );
        }
        break;
      case 'pump': {
        const from = nodeOf(element.id, 'a');
        const to = nodeOf(element.id, 'b');
        if (element.ratedFlow && element.ratedHead) {
          const curve = `C${curves.length + 1}`;
          curves.push(
            `${pad(curve)}${pad(num(element.ratedFlow * 1000, 3))}${pad(num(element.ratedHead, 2))}; ${element.name} (ponto nominal)`,
          );
          pumps.push(`${pad(link())}${pad(from)}${pad(to)}HEAD ${curve}    ; ${element.name}`);
        } else {
          warnings.push(
            `"${element.name}" não tem vazão e altura manométrica nominais; a bomba não foi exportada.`,
          );
        }
        break;
      }
      case 'tank':
        tankNodes.set(nodeOf(element.id, 'a'), element);
        break;
      default:
        // Joelhos, tês e reduções: apenas garantem a existência do nó.
        for (const port of getPorts(element)) nodeOf(element.id, port.ref.portId);
    }
  }

  // Coordenadas e cota de cada nó (primeira porta do conjunto).
  const nodePosition = new Map<string, { x: number; y: number; z: number }>();
  for (const [key, point] of position) {
    const id = nodeIds.get(sets.find(key));
    if (id && !nodePosition.has(id)) nodePosition.set(id, point);
  }

  const junctions: string[] = [];
  const tanks: string[] = [];
  const coordinates: string[] = [];
  for (const id of nodeIds.values()) {
    const point = nodePosition.get(id) ?? { x: 0, y: 0, z: 0 };
    coordinates.push(`${pad(id)}${pad(num(point.x))}${pad(num(point.y))}`);
    const tank = tankNodes.get(id);
    if (tank) {
      // Reservatórios elevados ou de seção variável viram o cilindro equivalente.
      const water = tankHydraulics(tank);
      const base = tank.placement.position.z + water.bottom;
      if (water.approximate) {
        warnings.push(
          `"${tank.name}" não tem seção constante: foi exportado como cilindro equivalente (mesmo volume e mesma altura de água); revise a curva de volume no EPANET.`,
        );
      }
      tanks.push(
        `${pad(id)}${pad(num(base))}${pad(num(water.maxLevel / 2))}${pad(num(0))}${pad(num(water.maxLevel))}${pad(num(water.diameter))}${pad(0)}; ${tank.name}`,
      );
    } else {
      junctions.push(`${pad(id)}${pad(num(point.z))}${pad(0)}`);
    }
  }

  if (tanks.length === 0) {
    warnings.push(
      'A rede não possui reservatório: o EPANET exige ao menos um nó de carga fixa (reservatório ou tanque).',
    );
  }
  if (pipes.length === 0) warnings.push('A rede não possui tubos.');
  if (mergedRuns > 0) {
    warnings.push(
      `${mergedRuns} tubulação(ões) com trechos ligados sem peça foram exportadas como trecho único, com as mudanças de direção em [VERTICES]: o EPANET só calcula pressão nos nós, de modo que pontos altos ou baixos no meio do trecho não são verificados.`,
    );
  }
  warnings.push(
    'Demandas nodais exportadas como zero e rugosidades com valores de referência: revise antes de simular.',
  );

  const section = (name: string, header: string, lines: string[]): string =>
    [`[${name}]`, `;${header}`, ...lines, ''].join('\n');

  const inp = [
    '[TITLE]',
    `${project.name}`,
    'Exportado pelo HydroBIM',
    '',
    section('JUNCTIONS', 'ID              Elev            Demand', junctions),
    section('RESERVOIRS', 'ID              Head', []),
    section(
      'TANKS',
      'ID              Elevation       InitLevel       MinLevel        MaxLevel        Diameter        MinVol',
      tanks,
    ),
    section(
      'PIPES',
      'ID              Node1           Node2           Length          Diameter        Roughness       MinorLoss       Status',
      pipes,
    ),
    section('PUMPS', 'ID              Node1           Node2           Parameters', pumps),
    section(
      'VALVES',
      'ID              Node1           Node2           Diameter        Type            Setting',
      [],
    ),
    section('CURVES', 'ID              X-Value         Y-Value', curves),
    '[OPTIONS]',
    'Units              LPS',
    'Headloss           H-W',
    '',
    section('COORDINATES', 'Node            X-Coord         Y-Coord', coordinates),
    section('VERTICES', 'Link            X-Coord         Y-Coord', vertices),
    '[END]',
    '',
  ].join('\n');

  return { inp, warnings };
}
