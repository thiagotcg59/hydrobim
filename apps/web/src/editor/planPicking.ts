import {
  add,
  constrainDeflection,
  fail,
  ok,
  scale,
  sub,
  vec3,
  type Pipe,
  type Point2,
  type Port,
  type Result,
  type Vec3,
} from '@hydrobim/core';
import type { SnapKind } from './picking';

/**
 * Resolução do clique na planta baixa em ponto 3D, porta e posição sobre um tubo. A planta
 * só informa X e Y: a cota Z vem da elevação de desenho, da âncora ou da porta capturada.
 * Funções puras (sem React nem DOM), equivalentes às de `picking.ts` para o viewport 3D.
 */

/** Trava de ângulo do trecho em criação: saída da extremidade de um tubo. */
export interface DeflectionConstraint {
  readonly origin: Vec3;
  /** Direção da porta de onde o trecho parte. */
  readonly axis: Vec3;
  /** Deflexões (rad) com joelho de catálogo. */
  readonly angles: readonly number[];
  /** Deflexão (rad) que a junta admite sem peça; ausente ou 0 = junta rígida. */
  readonly jointLimit?: number;
}

export interface PlanPickContext {
  /** Ponto do cursor em planta (m). */
  readonly point: Point2;
  /** Raio de captura em planta (m), proporcional ao zoom. */
  readonly tolerance: number;
  /** Portas livres de elementos visíveis. */
  readonly freePorts: readonly Port[];
  /** Cota Z (m) dos pontos livres: nível + elevação do eixo. */
  readonly drawZ: number;
  /** Passo do snap de grade (m); 0 desativa. */
  readonly gridStep: number;
  readonly anchor: { readonly point: Vec3; readonly lockAxis: Vec3 | null } | null;
  readonly constraint: DeflectionConstraint | null;
  /** Escolha manual entre portas sobrepostas: avança N posições a partir da preferida. */
  readonly cycle?: number;
}

export interface PlanPick {
  readonly point: Vec3;
  readonly snap: SnapKind;
  readonly port: Port | null;
  /** Portas livres sobrepostas em planta no ponto capturado (1 = sem ambiguidade). */
  readonly stacked: number;
}

/** Componente horizontal mínima (por unidade de comprimento) para um eixo ser legível em planta. */
const MIN_HORIZONTAL = 0.02;

const snapValue = (value: number, step: number): number =>
  step > 0 ? Math.round(value / step) * step : value;

/**
 * Porta livre sob o cursor. Portas sobrepostas em planta (prumadas, tubos em cotas
 * diferentes no mesmo X/Y) são desempatadas pela cota mais próxima de `referenceZ`; a
 * quantidade sobreposta é devolvida para que a interface informe qual foi capturada.
 * `cycle` percorre as sobrepostas a partir da preferida (escolha manual do usuário).
 */
export function pickPlanPort(
  point: Point2,
  ports: readonly Port[],
  tolerance: number,
  referenceZ: number,
  cycle = 0,
): { port: Port; stacked: number } | null {
  const gap = (port: Port): number =>
    Math.hypot(port.position.x - point.x, port.position.y - point.y);
  const near = ports.filter((port) => gap(port) <= tolerance);
  if (near.length === 0) return null;
  const closest = Math.min(...near.map(gap));
  // "Mesmo ponto em planta": dentro de uma fração do raio de captura a partir da mais próxima.
  const stack = near.filter((port) => gap(port) <= closest + tolerance * 0.25);
  const height = (port: Port): number => Math.abs(port.position.z - referenceZ);
  const ordered = [...stack].sort((a, b) => height(a) - height(b) || gap(a) - gap(b));
  const port = ordered[((cycle % ordered.length) + ordered.length) % ordered.length];
  return port ? { port, stacked: stack.length } : null;
}

/** Ponto 3D indicado pelo cursor na planta, para as ferramentas de modelagem. */
export function pickPlanPoint(context: PlanPickContext): Result<PlanPick> {
  const { point, anchor, gridStep } = context;
  const referenceZ = anchor?.point.z ?? context.drawZ;

  const captured = pickPlanPort(
    point,
    context.freePorts,
    context.tolerance,
    referenceZ,
    context.cycle,
  );
  if (captured) {
    return ok({
      point: captured.port.position,
      snap: 'port',
      port: captured.port,
      stacked: captured.stacked,
    });
  }

  if (anchor?.lockAxis) {
    const axis = anchor.lockAxis;
    const horizontal = Math.hypot(axis.x, axis.y);
    const norm = Math.hypot(axis.x, axis.y, axis.z);
    if (norm < 1e-9 || horizontal / norm < MIN_HORIZONTAL) {
      return fail(
        'VERTICAL_AXIS_IN_PLAN',
        'A saída desta conexão é vertical: o trecho não pode ser indicado por um clique em planta. Informe a nova elevação do eixo para criar a prumada.',
      );
    }
    // Parâmetro ao longo do eixo 3D cuja projeção em planta é a mais próxima do cursor.
    const along =
      ((point.x - anchor.point.x) * axis.x + (point.y - anchor.point.y) * axis.y) /
      (horizontal * horizontal);
    const t = Math.max(0, snapValue(along * norm, gridStep));
    return ok({
      point: add(anchor.point, scale(axis, t / norm)),
      snap: 'axis',
      port: null,
      stacked: 1,
    });
  }

  if (context.constraint && anchor) {
    const { origin, axis, angles, jointLimit } = context.constraint;
    return ok({
      point: constrainDeflection(
        origin,
        axis,
        vec3(point.x, point.y, anchor.point.z),
        angles,
        gridStep,
        jointLimit,
      ),
      snap: 'angle',
      port: null,
      stacked: 1,
    });
  }

  return ok({
    point: vec3(snapValue(point.x, gridStep), snapValue(point.y, gridStep), referenceZ),
    snap: gridStep > 0 ? 'grid' : 'plane',
    port: null,
    stacked: 1,
  });
}

/**
 * Ponto sobre o eixo 3D do tubo correspondente ao clique em planta (inserção em linha).
 * Em tubo vertical a projeção degenera em um ponto e a posição ao longo do eixo é indefinida.
 */
export function planPipeHit(pipe: Pipe, point: Point2): Result<Vec3> {
  const axis = sub(pipe.end, pipe.start);
  const horizontal = Math.hypot(axis.x, axis.y);
  const norm = Math.hypot(axis.x, axis.y, axis.z);
  if (norm < 1e-9 || horizontal / norm < MIN_HORIZONTAL) {
    return fail(
      'PIPE_VERTICAL_IN_PLAN',
      `"${pipe.name}" é vertical: a posição ao longo do tubo não pode ser indicada em planta. Faça a inserção no modelo 3D.`,
    );
  }
  const t =
    ((point.x - pipe.start.x) * axis.x + (point.y - pipe.start.y) * axis.y) /
    (horizontal * horizontal);
  return ok(add(pipe.start, scale(axis, Math.min(1, Math.max(0, t)))));
}
