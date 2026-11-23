import {
  alignArchElement,
  hostedPoint,
  offsetAlongWall,
  splitWall,
  trimWallsToCorner,
  trimWallToWall,
  type Point2,
  type Project,
  type Result,
} from '@hydrobim/core';
import type { SnapSegment } from '../editor/planSnaps';
import { archSnapSegments, closestOnSegment, wallAt } from './archGeometry';

/**
 * Ferramentas de modificação que atuam sobre o que é INDICADO na planta (paredes e arestas), e
 * não sobre a seleção: aparar/estender para canto, aparar/estender até uma parede, alinhar e
 * dividir parede. Como em `archEdit.ts`, são funções puras: traduzem os cliques nos parâmetros
 * das operações de `@hydrobim/core`, e a prévia é o resultado da mesma chamada que a
 * confirmação grava. As regras (qual extremidade anda, o que acompanha, o que é recusado) são
 * do núcleo.
 */

export const ARCH_MODIFIES = ['trimCorner', 'trimExtend', 'align', 'split'] as const;
export type ArchModifyKind = (typeof ARCH_MODIFIES)[number];

export const ARCH_MODIFY_LABELS: Record<ArchModifyKind, string> = {
  trimCorner: 'Aparar/estender para canto',
  trimExtend: 'Aparar/estender até parede',
  align: 'Alinhar',
  split: 'Dividir parede',
};

/** O que cada ferramenta pede, na ordem; o último clique confirma. */
export const ARCH_MODIFY_STEPS: Record<ArchModifyKind, readonly string[]> = {
  trimCorner: [
    'clique a 1ª parede, no lado que deve ficar',
    'clique a 2ª parede, no lado que deve ficar',
  ],
  trimExtend: [
    'clique a parede-limite (não é alterada)',
    'clique a parede a aparar ou estender, no lado que deve ficar',
  ],
  align: [
    'clique a aresta de referência (face ou eixo de parede, lado de contorno)',
    'clique a aresta do elemento a alinhar, paralela à referência',
  ],
  split: ['clique o ponto de divisão sobre a parede'],
};

export const ARCH_MODIFY_HINTS: Record<ArchModifyKind, string> = {
  trimCorner:
    'Aparar/estender para canto: clique as duas paredes, cada uma no lado que deve ficar. As duas vão ao encontro das linhas de referência — a que passa é aparada, a que não chega é estendida — e o canto em bisel é resolvido. A prévia em verde é o resultado; a ferramenta continua ativa; Esc volta um clique e, sem cliques, encerra.',
  trimExtend:
    'Aparar/estender até parede: clique a parede-limite e depois a parede a aparar ou estender, no lado que deve ficar. Só a segunda muda; se a extremidade cair no corpo da parede-limite, o encontro em T é resolvido. Esc volta um clique e, sem cliques, encerra.',
  align:
    'Alinhar: clique a aresta de referência e depois a aresta (paralela a ela) do elemento a alinhar; Tab alterna entre arestas sobrepostas. O elemento se desloca na perpendicular até a aresta ficar sobre a referência; a parede leva os encontros com as vizinhas, e a aresta de topo de uma parede só estende ou apara a extremidade. Nada é girado. Esc volta um clique e, sem cliques, encerra.',
  split:
    'Dividir parede: clique o ponto de divisão sobre a parede (as capturas valem: meio, interseção, extremidade de outra parede). A parede original fica com o trecho do início; as portas e janelas passam para o trecho em que estão. Esc encerra.',
};

/** O que foi indicado por um clique: o elemento, o ponto e, no alinhar, a aresta. */
export interface ArchPick {
  readonly elementId: string;
  readonly name: string;
  readonly point: Point2;
  readonly segment: SnapSegment | null;
  /** Arestas sobrepostas sob o cursor (alinhar) e qual delas está indicada: Tab alterna. */
  readonly count: number;
  readonly index: number;
}

/**
 * Arestas dentro do raio, da mais próxima para a mais distante. Entre arestas coincidentes
 * (o lado de uma laje sobre o eixo de uma parede, por exemplo) a da parede vem primeiro.
 */
function edgesNear(
  point: Point2,
  segments: readonly SnapSegment[],
  tolerance: number,
): SnapSegment[] {
  const ofWall = (segment: SnapSegment): number =>
    segment.role === 'axis' || segment.role === 'face' ? 0 : 1;
  return segments
    .map((segment) => {
      const foot = closestOnSegment(point, segment.a, segment.b);
      return { segment, gap: Math.hypot(foot.x - point.x, foot.y - point.y) };
    })
    .filter((item) => item.gap <= tolerance)
    .sort((a, b) =>
      Math.abs(a.gap - b.gap) > 1e-6 ? a.gap - b.gap : ofWall(a.segment) - ofWall(b.segment),
    )
    .map((item) => item.segment);
}

export interface ArchModify {
  readonly kind: ArchModifyKind;
  /** Cliques já confirmados. */
  readonly picks: readonly ArchPick[];
}

/**
 * O que o cursor indica agora, para a ferramenta e o passo em andamento; `null` quando não há
 * parede (ou aresta) dentro do raio `tolerance` (m). `levelId` limita ao nível do plano de
 * trabalho (`null` = todos). No dividir, o ponto é o pé da perpendicular sobre a linha de
 * referência da parede. No alinhar, `cycle` escolhe entre as arestas sobrepostas (Tab).
 */
export function modifyPickAt(
  project: Pick<Project, 'architecture'>,
  modify: ArchModify,
  point: Point2,
  tolerance: number,
  levelId: string | null,
  cycle = 0,
): ArchPick | null {
  const { architecture } = project;
  if (modify.kind === 'align') {
    // A aresta a alinhar é de outro elemento que não o da referência.
    const reference = modify.picks[0];
    const edges = edgesNear(
      point,
      archSnapSegments(architecture, {
        levelId,
        exclude: reference ? [reference.elementId] : [],
      }),
      tolerance,
    );
    const count = edges.length;
    const index = count > 0 ? ((cycle % count) + count) % count : 0;
    const segment = edges[index];
    return segment
      ? { elementId: segment.sourceId, name: segment.sourceName, point, segment, count, index }
      : null;
  }
  const wall = wallAt(architecture, point, tolerance, levelId);
  if (!wall) return null;
  return {
    elementId: wall.id,
    name: wall.name,
    point: modify.kind === 'split' ? hostedPoint(wall, offsetAlongWall(wall, point)) : point,
    segment: null,
    count: 1,
    index: 0,
  };
}

export interface ModifyOutcome {
  readonly project: Project;
  /** Mensagem da confirmação, pronta para o usuário. */
  readonly message: string;
}

/**
 * Resultado da ferramenta com os cliques já feitos mais `next` (o que o cursor indica, na
 * prévia, ou o clique que confirma). `null` enquanto faltam cliques; `Result` com o motivo
 * quando o núcleo recusa.
 */
export function modifyOutcome(
  project: Project,
  modify: ArchModify,
  next: ArchPick | null,
): Result<ModifyOutcome> | null {
  const picks = next ? [...modify.picks, next] : [...modify.picks];
  const [first, second] = picks;
  const done = (result: Result<Project>, message: string): Result<ModifyOutcome> =>
    result.ok ? { ok: true, value: { project: result.value, message } } : result;
  switch (modify.kind) {
    case 'trimCorner':
      if (!first || !second) return null;
      return done(
        trimWallsToCorner(
          project,
          { wallId: first.elementId, point: first.point },
          { wallId: second.elementId, point: second.point },
        ),
        `"${first.name}" e "${second.name}" levadas ao canto.`,
      );
    case 'trimExtend':
      if (!first || !second) return null;
      return done(
        trimWallToWall(project, first.elementId, {
          wallId: second.elementId,
          point: second.point,
        }),
        `"${second.name}" levada até "${first.name}".`,
      );
    case 'align':
      if (!first?.segment || !second?.segment) return null;
      return done(
        alignArchElement(project, second.elementId, first.segment, second.segment),
        `"${second.name}" alinhada com "${first.name}".`,
      );
    case 'split': {
      if (!first) return null;
      const split = splitWall(project, first.elementId, first.point);
      return split.ok
        ? {
            ok: true,
            value: {
              project: split.value.project,
              message: `"${first.name}" dividida em duas paredes; portas e janelas ficaram no trecho em que estão.`,
            },
          }
        : split;
    }
  }
}

/**
 * Por que a ferramenta não pode ser usada agora (mensagem pronta) ou `null` se pode: faltam
 * paredes para aparar ou dividir, ou elementos com arestas para alinhar.
 */
export function archModifyBlocker(
  project: Pick<Project, 'architecture'>,
  kind: ArchModifyKind,
): string | null {
  const { elements } = project.architecture;
  const walls = elements.filter((element) => element.kind === 'wall').length;
  if (kind === 'split') return walls >= 1 ? null : 'O projeto ainda não tem paredes.';
  if (kind === 'align') {
    const edged = elements.filter(
      (element) => element.kind !== 'door' && element.kind !== 'window',
    ).length;
    return edged >= 2
      ? null
      : 'Alinhar precisa de dois elementos: o da aresta de referência e o que será alinhado.';
  }
  return walls >= 2 ? null : 'O projeto precisa de ao menos duas paredes.';
}
