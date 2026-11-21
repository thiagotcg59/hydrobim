import {
  distance,
  elementKindLabel,
  formatMeters,
  getElement,
  type ConnectionGuides,
  type HydroElement,
  type Project,
  type Result,
} from '@hydrobim/core';
import { useMemo } from 'react';
import { diffProjects } from '../editor/operationPreview';
import {
  chosenCandidate,
  moveIdsOf,
  moveTargetOf,
  pipeJunctionOf,
  planMove,
  planRotate,
  rotationSweepOf,
  rotateStepOf,
  useEditorStore,
} from './editorStore';
import { alignStepOf, alignTargetOf, planAlign } from './alignTool';
import { planPipeSegment, planPipeTarget } from './pipePreview';

/**
 * Prévia da operação em andamento, a mesma nas duas vistas: o projeto resultante calculado
 * pela operação de domínio que a confirmação grava (traçado com tê ou cruzeta, "Alinhar e
 * conectar", conversão tê ⇄ cruzeta). As vistas desenham os elementos criados e alterados
 * como fantasmas, o símbolo da peça de derivação e as guias de alinhamento.
 */
export interface ViewPreview {
  /** Elementos criados ou alterados (versão resultante). */
  readonly ghosts: readonly HydroElement[];
  /** Peças de derivação criadas ou convertidas, com o rótulo do símbolo. */
  readonly junctions: readonly { readonly element: HydroElement; readonly label: string }[];
  readonly guides: ConnectionGuides | null;
  /** Recusa da operação (a vista mostra a mensagem junto ao cursor). */
  readonly error: string | null;
}

const EMPTY: ViewPreview = { ghosts: [], junctions: [], guides: null, error: null };

function fromResult(
  base: Project,
  result: Result<Project> | null,
  guides: ConnectionGuides | null = null,
): ViewPreview {
  if (!result) return { ...EMPTY, guides };
  if (!result.ok) return { ...EMPTY, guides, error: result.error.message };
  const diff = diffProjects(base, result.value);
  const ghosts = [...diff.created, ...diff.modified];
  const junctions = ghosts
    .filter((element) => {
      if (element.kind !== 'tee' && element.kind !== 'cross') return false;
      const before = getElement(base, element.id);
      // Só as novas ou as que mudaram de tipo/família (as deslocadas não são novidade).
      return !before || before.kind !== element.kind || before.familyId !== element.familyId;
    })
    .map((element) => ({
      element,
      label: `${elementKindLabel(element.kind)} ${element.spec.sizeLabel}${
        element.familyId === null ? ' (genérica)' : ''
      }`,
    }));
  return { ghosts, junctions, guides, error: null };
}

/** Prévia corrente; `null` quando não há operação a mostrar. */
export function useViewPreview(): ViewPreview | null {
  const project = useEditorStore((s) => s.project);
  const tool = useEditorStore((s) => s.tool);
  const anchor = useEditorStore((s) => s.anchor);
  const cursor = useEditorStore((s) => s.cursor);
  const connect = useEditorStore((s) => s.connect);
  const junctionPreview = useEditorStore((s) => s.junctionPreview);
  const toolOptions = useEditorStore((s) => s.toolOptions);
  const activeSpec = useEditorStore((s) => s.activeSpec);
  const viewMode = useEditorStore((s) => s.viewMode);
  const move = useEditorStore((s) => s.move);
  const rotation = useEditorStore((s) => s.rotate);
  const align = useEditorStore((s) => s.align);

  return useMemo(() => {
    if (junctionPreview && junctionPreview.base === project) {
      return fromResult(
        project,
        junctionPreview.result.ok
          ? { ok: true, value: junctionPreview.result.value.project }
          : junctionPreview.result,
      );
    }
    if (tool === 'connect' && connect.plan && connect.plan.base === project) {
      const plan = connect.plan.result;
      if (!plan.ok) return { ...EMPTY, error: plan.error.message };
      const candidate = chosenCandidate(connect);
      return fromResult(
        project,
        candidate
          ? { ok: true, value: candidate.project }
          : {
              ok: false,
              error: { code: 'NO_SOLUTION', message: plan.value.refusals[0] ?? 'Sem montagem.' },
            },
        plan.value.guides,
      );
    }
    if (tool === 'rotate') {
      if (!rotation?.center || rotation.reference === null || !cursor) return null;
      const angle = rotationSweepOf(
        rotation.center,
        rotation.reference,
        cursor.point,
        rotateStepOf(),
      );
      if (angle === null) return null;
      return fromResult(project, planRotate(project, rotation, angle));
    }
    if (tool === 'align') {
      if (!align?.source1 || !cursor) return null;
      // Antes do 2º par a prévia é só o deslocamento (destino 1 pelo cursor ou já indicado).
      const step = alignStepOf(align);
      const staged =
        step === 'target1'
          ? { ...align, target1: alignTargetOf(align.source1, cursor.point, cursor.snap) }
          : align;
      const target2 = step === 'target2' ? cursor.point : null;
      const result = planAlign(project, staged, moveIdsOf(project, staged), target2);
      return result?.ok && result.value === project ? null : fromResult(project, result);
    }
    if (tool === 'move') {
      if (!move?.from || !cursor) return null;
      const target = moveTargetOf(move.from, cursor.point, cursor.snap);
      return fromResult(project, planMove(project, move, target));
    }
    if (tool !== 'pipe' || !anchor || !cursor) return null;
    const state = { project, anchor, activeSpec, toolOptions, viewMode };
    const target = cursor.elementId ? getElement(project, cursor.elementId) : undefined;
    // Sobre um tubo (no pé da perpendicular), tê ou cruzeta: a ligação que o clique criaria.
    if (
      target &&
      !cursor.port &&
      ((target.kind === 'pipe' && pipeJunctionOf({ ...state, tool }, target.id)) ||
        target.kind === 'tee' ||
        target.kind === 'cross')
    ) {
      return fromResult(project, planPipeTarget(state, target.id));
    }
    if (distance(anchor.point, cursor.point) < 1e-6) return null;
    return fromResult(project, planPipeSegment(state, cursor.point));
  }, [
    project,
    tool,
    anchor,
    cursor,
    connect,
    junctionPreview,
    toolOptions,
    activeSpec,
    viewMode,
    move,
    rotation,
    align,
  ]);
}

/**
 * Elemento a informar no cursor: o dono da porta capturada, o tubo do tê automático ou, na
 * Tubulação, o tê/cruzeta sob o cursor (início ou fim de ramal).
 */
export function cursorElementOf(
  project: Project,
  tool: string,
  portElementId: string | null,
  snap: string,
  hitId: string | null,
): string | null {
  if (portElementId) return portElementId;
  if (snap === 'pipe') return hitId;
  if (tool !== 'pipe' || !hitId) return null;
  const kind = getElement(project, hitId)?.kind;
  return kind === 'tee' || kind === 'cross' ? hitId : null;
}

/** Texto das guias: desvios e distância restante, pela porta de referência. */
export function guidesText(guides: ConnectionGuides): string {
  const parts = [
    `ΔH ${formatMeters(guides.horizontalOffset, 3)}`,
    `ΔV ${formatMeters(guides.verticalOffset, 3)}`,
    `à frente ${formatMeters(guides.ahead, 3)}`,
    `distância ${formatMeters(guides.distance, 3)}`,
  ];
  return parts.join(' · ');
}

export const RELATION_LABELS: Record<ConnectionGuides['relation'], string> = {
  coincident: 'portas encostadas',
  collinear: 'eixos alinhados',
  crossing: 'eixos se encontram',
  parallel: 'eixos paralelos (desvio)',
  skew: 'eixos reversos (não se encontram)',
};
