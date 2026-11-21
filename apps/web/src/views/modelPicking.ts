import {
  dot,
  fail,
  fromViewPoint,
  getFreePorts,
  ok,
  sub,
  vec3,
  viewClipPlanesOf,
  viewDepthOf,
  viewElementsOf,
  viewFrameOf,
  toViewPoint,
  type Pipe,
  type Point2,
  type Project,
  type ProjectView2d,
  type Result,
  type Vec3,
  type ViewFrame,
} from '@hydrobim/core';
import {
  pickPlanPoint,
  planPipeHit,
  type DeflectionConstraint,
  type PlanPick,
  type PlanPickContext,
} from '../editor/planPicking';

/** Coordenadas locais preservam a profundidade, que uma projeção 2D sozinha perde. */
const localPoint = (frame: ViewFrame, point: Vec3): Vec3 => {
  const projected = toViewPoint(frame, point);
  return vec3(projected.x, projected.y, viewDepthOf(frame, point));
};

const localDirection = (frame: ViewFrame, direction: Vec3): Vec3 =>
  vec3(dot(direction, frame.u), dot(direction, frame.v), dot(direction, frame.w));

/**
 * Na planta a profundidade é a cota do desenho. Nas vistas verticais, uma referência real
 * fixa o afastamento do plano da vista; sem referência, desenha-se no próprio plano dela.
 */
export function viewModelDepth(view: ProjectView2d, drawZ: number, reference: Vec3 | null): number {
  return view.kind === 'plan' ? drawZ : reference ? viewDepthOf(viewFrameOf(view), reference) : 0;
}

/** Portas além do corte ou do recorte não podem ser capturadas através da vista. */
export function viewPointVisible(
  project: Pick<Project, 'levels'>,
  view: ProjectView2d,
  point: Vec3,
): boolean {
  if (
    !viewClipPlanesOf(project, view).every(
      (plane) => dot(sub(point, plane.point), plane.normal) >= -1e-9,
    )
  ) {
    return false;
  }
  if (!view.crop?.enabled) return true;
  const projected = toViewPoint(viewFrameOf(view), point);
  return (
    projected.x >= view.crop.min.x - 1e-9 &&
    projected.x <= view.crop.max.x + 1e-9 &&
    projected.y >= view.crop.min.y - 1e-9 &&
    projected.y <= view.crop.max.y + 1e-9
  );
}

export interface ViewModelPickContext {
  readonly point: Point2;
  readonly view: ProjectView2d;
  readonly project: Project;
  readonly drawZ: number;
  /** Profundidade herdada de seleção, ponto-base ou outra referência da operação. */
  readonly reference: Vec3 | null;
  readonly anchor: PlanPickContext['anchor'];
  readonly constraint: DeflectionConstraint | null;
  readonly gridStep: number;
  readonly tolerance: number;
  readonly cycle?: number;
}

/**
 * A captura é resolvida no referencial ortonormal da vista, com as mesmas regras da planta.
 * O resultado sempre volta ao projeto: o clique e a prévia recebem portas e pontos reais.
 */
export function pickViewModelPoint(context: ViewModelPickContext): Result<PlanPick> {
  const { project, view, anchor, constraint } = context;
  const frame = viewFrameOf(view);
  const shown = new Set(viewElementsOf(project, view).map((element) => element.id));
  // O grafo completo decide se a porta está livre, mesmo que o outro elemento esteja oculto.
  const freePorts = getFreePorts(project).filter(
    (port) => shown.has(port.ref.elementId) && viewPointVisible(project, view, port.position),
  );
  const transformedPorts = freePorts.map((port) => ({
    ...port,
    position: localPoint(frame, port.position),
    direction: localDirection(frame, port.direction),
  }));
  const picked = pickPlanPoint({
    point: context.point,
    tolerance: context.tolerance,
    freePorts: transformedPorts,
    drawZ: viewModelDepth(view, context.drawZ, context.reference),
    gridStep: context.gridStep,
    anchor: anchor
      ? {
          point: localPoint(frame, anchor.point),
          lockAxis: anchor.lockAxis ? localDirection(frame, anchor.lockAxis) : null,
        }
      : null,
    constraint: constraint
      ? {
          ...constraint,
          origin: localPoint(frame, constraint.origin),
          axis: localDirection(frame, constraint.axis),
        }
      : null,
    ...(context.cycle === undefined ? {} : { cycle: context.cycle }),
  });
  if (!picked.ok) {
    return fail(
      'AXIS_PERPENDICULAR_TO_VIEW',
      'A saída desta conexão aponta para fora do plano da vista: indique o trecho por coordenadas ou use uma vista em que o eixo seja visível.',
    );
  }
  const local = picked.value;
  const port = local.port
    ? (freePorts.find(
        (candidate) =>
          candidate.ref.elementId === local.port?.ref.elementId &&
          candidate.ref.portId === local.port?.ref.portId,
      ) ?? null)
    : null;
  return ok({
    ...local,
    point: port?.position ?? fromViewPoint(frame, local.point, local.point.z),
    port,
  });
}

/** Ponto do eixo real indicado na vista; um tubo perpendicular à tela não tem posição legível. */
export function viewPipeHit(pipe: Pipe, point: Point2, frame: ViewFrame): Result<Vec3> {
  const picked = planPipeHit(
    { ...pipe, start: localPoint(frame, pipe.start), end: localPoint(frame, pipe.end) },
    point,
  );
  if (!picked.ok) {
    return fail(
      'PIPE_PERPENDICULAR_TO_VIEW',
      `"${pipe.name}" é perpendicular a esta vista: indique a posição em outra vista ou no modelo 3D.`,
    );
  }
  return ok(fromViewPoint(frame, picked.value, picked.value.z));
}
