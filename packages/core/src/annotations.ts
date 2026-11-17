import { getElement } from './connectivity';
import { newId } from './ids';
import { now } from './internal';
import { getPorts, pipeLength } from './ports';
import { fail, ok, type Result } from './result';
import {
  AnnotationSchema,
  type Annotation,
  type DimensionAnnotation,
  type DimensionMode,
  type HydroElement,
  type Point2,
  type Project,
  type TagAnnotation,
  type TextAnnotation,
} from './schema';

/**
 * Anotações da planta baixa (cotas, textos, chamadas e etiquetas).
 *
 * As anotações vivem no plano XY do projeto, em metros. O que elas exibem — valor da cota,
 * conteúdo da etiqueta, traçado das linhas — é sempre derivado, nunca persistido.
 */

/** Menor distância cotável (m): abaixo disso os dois pontos coincidem em planta. */
export const MIN_DIMENSION = 1e-4;

/** Escalas usuais de desenho (denominador). */
export const DRAWING_SCALES = [10, 20, 25, 50, 75, 100, 200, 250, 500, 1000, 2000] as const;

export type AnnotationInput =
  Omit<DimensionAnnotation, 'id'> | Omit<TextAnnotation, 'id'> | Omit<TagAnnotation, 'id'>;

export type AnnotationPatch = {
  a?: Point2;
  b?: Point2;
  offset?: number;
  mode?: DimensionMode;
  position?: Point2;
  text?: string;
  rotation?: number;
  /** `null` remove a linha de chamada. */
  leader?: Point2 | null;
};

export const point2 = (x: number, y: number): Point2 => ({ x, y });

export function getAnnotation(project: Project, id: string): Annotation | undefined {
  return project.annotations.find((a) => a.id === id);
}

/** Direção cotada (unitária) e normal (direção do afastamento da linha de cota). */
function dimensionAxes(
  dimension: Pick<DimensionAnnotation, 'a' | 'b' | 'mode'>,
): { direction: Point2; normal: Point2 } | null {
  let direction: Point2;
  if (dimension.mode === 'horizontal') direction = point2(1, 0);
  else if (dimension.mode === 'vertical') direction = point2(0, 1);
  else {
    const dx = dimension.b.x - dimension.a.x;
    const dy = dimension.b.y - dimension.a.y;
    const size = Math.hypot(dx, dy);
    if (size < MIN_DIMENSION) return null;
    direction = point2(dx / size, dy / size);
  }
  return { direction, normal: point2(-direction.y, direction.x) };
}

export interface DimensionGeometry {
  /** Valor cotado (m), sempre positivo. */
  readonly value: number;
  /** Extremos da linha de cota, correspondentes aos pontos `a` e `b`. */
  readonly start: Point2;
  readonly end: Point2;
  /** Direção da linha de cota (de `start` para `end`) e normal de afastamento. */
  readonly direction: Point2;
  readonly normal: Point2;
}

/** Traçado derivado de uma cota; `null` quando os pontos coincidem na direção cotada. */
export function dimensionGeometry(
  dimension: Pick<DimensionAnnotation, 'a' | 'b' | 'mode' | 'offset'>,
): DimensionGeometry | null {
  const axes = dimensionAxes(dimension);
  if (!axes) return null;
  const { direction, normal } = axes;
  const along =
    (dimension.b.x - dimension.a.x) * direction.x + (dimension.b.y - dimension.a.y) * direction.y;
  if (Math.abs(along) < MIN_DIMENSION) return null;
  const start = point2(
    dimension.a.x + normal.x * dimension.offset,
    dimension.a.y + normal.y * dimension.offset,
  );
  const end = point2(start.x + direction.x * along, start.y + direction.y * along);
  const sign = along < 0 ? -1 : 1;
  return {
    value: Math.abs(along),
    start,
    end,
    direction: point2(direction.x * sign, direction.y * sign),
    normal,
  };
}

/** Afastamento que faz a linha de cota passar pelo ponto informado. */
export function dimensionOffsetAt(
  dimension: Pick<DimensionAnnotation, 'a' | 'b' | 'mode'>,
  point: Point2,
): number {
  const axes = dimensionAxes(dimension);
  if (!axes) return 0;
  return (point.x - dimension.a.x) * axes.normal.x + (point.y - dimension.a.y) * axes.normal.y;
}

/** Texto de uma cota: metros com duas casas decimais (padrão de plantas de instalações). */
export function formatDimension(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Conteúdo de uma etiqueta. Tubos: designação comercial e comprimento real (3D) do trecho;
 * demais elementos: nome e designação. O DN nunca é apresentado como diâmetro.
 */
export function tagText(element: HydroElement): string {
  if (element.kind === 'pipe') {
    return `${element.spec.sizeLabel} — ${formatDimension(pipeLength(element))} m`;
  }
  if (element.kind === 'tank') return element.name;
  return `${element.name} — ${element.spec.sizeLabel}`;
}

/** Ponto do elemento ao qual a etiqueta se refere, em planta. */
export function tagAnchor(element: HydroElement): Point2 {
  if (element.kind === 'pipe') {
    return point2((element.start.x + element.end.x) / 2, (element.start.y + element.end.y) / 2);
  }
  return point2(element.placement.position.x, element.placement.position.y);
}

/** Pontos notáveis da planta para captura: portas, extremos de tubos e origens das peças. */
export function planSnapPoints(project: Project): Point2[] {
  const points: Point2[] = [];
  for (const element of project.elements) {
    for (const port of getPorts(element)) points.push(point2(port.position.x, port.position.y));
    if (element.kind !== 'pipe') {
      points.push(point2(element.placement.position.x, element.placement.position.y));
    }
  }
  return points;
}

function check(project: Project, annotation: Annotation): Result<Annotation> {
  const parsed = AnnotationSchema.safeParse(annotation);
  if (!parsed.success) {
    if (annotation.kind === 'text' && annotation.text.trim().length === 0) {
      return fail('EMPTY_TEXT', 'O texto da anotação não pode ser vazio.');
    }
    return fail('INVALID_ANNOTATION', 'Anotação inválida: verifique as coordenadas informadas.');
  }
  const value = parsed.data;
  if (value.kind === 'dimension' && !dimensionGeometry(value)) {
    return fail(
      'DIMENSION_ZERO',
      'Os dois pontos da cota coincidem na direção cotada; escolha pontos distintos.',
    );
  }
  if (value.kind === 'text' && value.text.trim().length === 0) {
    return fail('EMPTY_TEXT', 'O texto da anotação não pode ser vazio.');
  }
  if (value.kind === 'tag' && !getElement(project, value.elementId)) {
    return fail('ELEMENT_NOT_FOUND', 'A etiqueta precisa referenciar um elemento existente.');
  }
  return ok(value);
}

export function addAnnotation(
  project: Project,
  input: AnnotationInput,
): Result<{ project: Project; annotationId: string }> {
  const checked = check(project, { ...input, id: newId() } as Annotation);
  if (!checked.ok) return checked;
  return ok({
    project: { ...project, updatedAt: now(), annotations: [...project.annotations, checked.value] },
    annotationId: checked.value.id,
  });
}

export function updateAnnotation(
  project: Project,
  id: string,
  patch: AnnotationPatch,
): Result<Project> {
  const current = getAnnotation(project, id);
  if (!current) return fail('ANNOTATION_NOT_FOUND', 'Anotação inexistente.');

  let next: Annotation;
  if (current.kind === 'dimension') {
    next = {
      ...current,
      a: patch.a ?? current.a,
      b: patch.b ?? current.b,
      offset: patch.offset ?? current.offset,
      mode: patch.mode ?? current.mode,
    };
  } else if (current.kind === 'text') {
    const { leader: _leader, ...rest } = current;
    const leader = patch.leader === undefined ? current.leader : patch.leader;
    next = {
      ...rest,
      position: patch.position ?? current.position,
      text: patch.text ?? current.text,
      rotation: patch.rotation ?? current.rotation,
      ...(leader ? { leader } : {}),
    };
  } else {
    next = { ...current, position: patch.position ?? current.position };
  }

  const checked = check(project, next);
  if (!checked.ok) return checked;
  return ok({
    ...project,
    updatedAt: now(),
    annotations: project.annotations.map((a) => (a.id === id ? checked.value : a)),
  });
}

export function deleteAnnotations(project: Project, ids: readonly string[]): Project {
  const remove = new Set(ids);
  if (!project.annotations.some((a) => remove.has(a.id))) return project;
  return {
    ...project,
    updatedAt: now(),
    annotations: project.annotations.filter((a) => !remove.has(a.id)),
  };
}

export function setDrawingScale(project: Project, scale: number): Result<Project> {
  if (!Number.isFinite(scale) || scale <= 0) {
    return fail('INVALID_SCALE', 'Escala inválida: informe um denominador positivo (ex.: 50).');
  }
  if (scale === project.drawingScale) return ok(project);
  return ok({ ...project, updatedAt: now(), drawingScale: scale });
}
