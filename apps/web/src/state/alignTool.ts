import {
  alignElements,
  alignmentAngle,
  copyAlignedElements,
  vec3,
  type AlignPoints,
  type Project,
  type Result,
  type Vec3,
} from '@hydrobim/core';

/**
 * Alinhar por pontos, como o ALIGN do AutoCAD: o usuário indica o ponto de origem 1 (no
 * elemento) e o destino dele, depois o ponto de origem 2 e o destino; o conjunto é levado da
 * origem 1 ao destino 1 e gira, em planta, até a direção origem 1 → 2 coincidir com destino
 * 1 → 2. Sem escala e sem tombar (giro só no eixo vertical). `withConnected`: a rede ligada vai
 * junto (padrão — num giro, os tubos de fora não se ajustam). `copy`: alinha uma cópia.
 */
export interface AlignState {
  readonly ids: readonly string[];
  readonly source1: Vec3 | null;
  readonly target1: Vec3 | null;
  readonly source2: Vec3 | null;
  readonly withConnected: boolean;
  readonly copy: boolean;
}

export type AlignStep = 'source1' | 'target1' | 'source2' | 'target2';

export function alignStepOf(align: AlignState): AlignStep {
  if (!align.source1) return 'source1';
  if (!align.target1) return 'target1';
  if (!align.source2) return 'source2';
  return 'target2';
}

export const ALIGN_STEP_LABELS: Record<AlignStep, string> = {
  source1: '1º ponto de origem',
  target1: '1º ponto de destino',
  source2: '2º ponto de origem',
  target2: '2º ponto de destino',
};

/**
 * Destino do primeiro ponto. Sobre uma porta ou em trecho vertical, o ponto capturado vale
 * inteiro; nos demais casos (plano de trabalho, grade, planta) a cota da origem se mantém —
 * como no Mover, a cota só muda de propósito, nunca pela cota do plano.
 */
export function alignTargetOf(source: Vec3, point: Vec3, snap: string | null): Vec3 {
  return snap === 'port' || snap === 'vertical' ? point : vec3(point.x, point.y, source.z);
}

/** Pares já indicados, com o destino 2 pelo cursor (ou nenhum, para só deslocar). */
export function alignPointsOf(align: AlignState, target2: Vec3 | null): AlignPoints | null {
  if (!align.source1 || !align.target1) return null;
  return {
    source1: align.source1,
    target1: align.target1,
    source2: align.source2,
    target2: align.source2 ? target2 : null,
  };
}

/**
 * Resultado do alinhamento dos elementos `ids` — o mesmo para a prévia e para a confirmação.
 * `null` enquanto o primeiro par não estiver completo.
 */
export function planAlign(
  project: Project,
  align: AlignState,
  ids: readonly string[],
  target2: Vec3 | null,
): Result<Project> | null {
  const points = alignPointsOf(align, target2);
  if (!points) return null;
  if (!align.copy) return alignElements(project, ids, points);
  const copied = copyAlignedElements(project, ids, points);
  return copied.ok ? { ok: true, value: copied.value.project } : copied;
}

/** Linha auxiliar desenhada pelas vistas: de cada ponto de origem ao seu destino. */
export interface AlignGuide {
  readonly from: Vec3;
  readonly to: Vec3;
  readonly label: string;
}

/** Linhas auxiliares do alinhamento em andamento (o trecho em curso segue o cursor). */
export function alignGuidesOf(align: AlignState, cursor: Vec3 | null): AlignGuide[] {
  const guides: AlignGuide[] = [];
  const { source1, target1, source2 } = align;
  if (source1) {
    const to = target1 ?? cursor;
    if (to) guides.push({ from: source1, to, label: '1' });
  }
  if (source2) {
    if (cursor) guides.push({ from: source2, to: cursor, label: '2' });
  }
  return guides;
}

/** Giro (radianos) que o destino 2 pelo cursor produziria; `null` se indefinido. */
export function alignAngleOf(align: AlignState, target2: Vec3 | null): number | null {
  const points = alignPointsOf(align, target2);
  return points ? alignmentAngle(points) : null;
}
