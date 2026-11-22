import { getArchElement, type Point2, type Project } from '@hydrobim/core';
import { useMemo } from 'react';
import type { SnapResult, SnapSegment } from '../editor/planSnaps';
import { useEditorStore } from '../state/editorStore';
import { formatDecimal } from '../ui/fields';
import {
  changedArchElements,
  contourOutcome,
  gripKey,
  gripOutcome,
  gripPoint,
  sweepAngle,
  transformOutcome,
  type ArchGrip,
} from './archEdit';
import { shapeOf } from './ArchPlanLayer';
import { useArchStore } from './archStore';

/**
 * Edição da arquitetura na planta: alças (extremidades de parede, cantos de telhado, vértices
 * do contorno em edição), prévias das operações em andamento e os indicadores de captura.
 * As prévias são o resultado da MESMA operação que a confirmação grava, desenhado como
 * fantasma — o projeto só muda quando o usuário confirma.
 */

const HIGHLIGHT = '#00a6c0';
const GHOST = '#1c9c5a';
const REFUSED = '#c92a2a';
const GUIDE = '#d9480f';

interface LayerProps {
  origin: Point2;
  /** Metros do modelo por pixel de tela. */
  mpp: number;
}

const textStyle = (mpp: number) =>
  ({
    fontSize: 11 * mpp,
    fontFamily: 'Arial, Helvetica, sans-serif',
    stroke: '#ffffff',
    strokeWidth: 3 * mpp,
    paintOrder: 'stroke',
  }) as const;

// ---------------------------------------------------------------------------
// Alças (recebem o ponteiro)
// ---------------------------------------------------------------------------

/**
 * Alças do elemento selecionado e do contorno em edição. Ficam fora da camada de prévia porque
 * precisam receber o ponteiro: o arrasto é tratado pela planta (`data-arch-grip`).
 */
export function ArchGripLayer({ origin, mpp, enabled }: LayerProps & { enabled: boolean }) {
  const architecture = useEditorStore((s) => s.project.architecture);
  const selection = useArchStore((s) => s.selection);
  const contour = useArchStore((s) => s.contour);
  const dragging = useArchStore((s) => s.grip !== null || s.contourDrag !== null);
  const X = (x: number): number => x - origin.x;
  const Y = (y: number): number => -(y - origin.y);
  const half = 5 * mpp;

  if (contour) {
    const { ring } = contour;
    return (
      <g data-ui="arch-contour-grips" data-testid="arch-contour-grips">
        {!contour.rectangular &&
          ring.map((a, index) => {
            const b = ring[(index + 1) % ring.length];
            if (!b) return null;
            return (
              <circle
                key={`insert-${index}`}
                data-arch-insert={index}
                data-testid="arch-contour-insert"
                cx={X((a.x + b.x) / 2)}
                cy={Y((a.y + b.y) / 2)}
                r={4 * mpp}
                fill="#ffffff"
                stroke={HIGHLIGHT}
                strokeWidth={1.5 * mpp}
                style={{ cursor: 'copy' }}
              >
                <title>Arraste para criar um vértice neste lado</title>
              </circle>
            );
          })}
        {ring.map((p, index) => (
          <rect
            key={`vertex-${index}`}
            data-arch-grip={`contour:${index}`}
            data-testid="arch-contour-vertex"
            data-index={index}
            data-active={contour.active === index}
            x={X(p.x) - half}
            y={Y(p.y) - half}
            width={2 * half}
            height={2 * half}
            fill={contour.active === index ? '#0b7285' : HIGHLIGHT}
            stroke="#ffffff"
            strokeWidth={1.5 * mpp}
            style={{ cursor: 'move' }}
          >
            <title>
              {contour.rectangular
                ? 'Arraste o canto: o contorno continua retangular'
                : 'Arraste o vértice; Del remove o selecionado'}
            </title>
          </rect>
        ))}
      </g>
    );
  }

  if (!enabled || selection.length !== 1 || !selection[0]) return null;
  const element = getArchElement(architecture, selection[0]);
  const grips: { grip: ArchGrip; testId: string; title: string }[] = [];
  if (element?.kind === 'wall') {
    for (const end of ['start', 'end'] as const) {
      grips.push({
        grip: { kind: 'wallEnd', elementId: element.id, end },
        testId: `arch-grip-${end}`,
        title:
          'Arraste a extremidade da parede: as capturas valem e as portas e janelas ficam no lugar',
      });
    }
  }
  if (element?.kind === 'roof') {
    element.boundary.forEach((_, index) => {
      grips.push({
        grip: { kind: 'roofCorner', elementId: element.id, index },
        testId: `arch-grip-corner-${index}`,
        title: 'Arraste o canto do contorno: o canto oposto fica e o retângulo é mantido',
      });
    });
  }
  if (grips.length === 0) return null;
  return (
    <g data-ui="arch-grips" data-testid="arch-grips" opacity={dragging ? 0.4 : 1}>
      {grips.map(({ grip, testId, title }) => {
        const at = gripPoint({ architecture }, grip);
        if (!at) return null;
        return (
          <rect
            key={gripKey(grip)}
            data-arch-grip={gripKey(grip)}
            data-testid={testId}
            x={X(at.x) - half}
            y={Y(at.y) - half}
            width={2 * half}
            height={2 * half}
            fill={HIGHLIGHT}
            stroke="#ffffff"
            strokeWidth={1.5 * mpp}
            style={{ cursor: 'move' }}
          >
            <title>{title}</title>
          </rect>
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Indicadores de captura
// ---------------------------------------------------------------------------

function SnapIndicators({
  snap,
  reference,
  pinned,
  origin,
  mpp,
}: LayerProps & { snap: SnapResult; reference: SnapSegment | null; pinned: boolean }) {
  const X = (x: number): number => x - origin.x;
  const Y = (y: number): number => -(y - origin.y);
  const dash = `${5 * mpp} ${4 * mpp}`;
  const corner = 9 * mpp;
  const shown = snap.segment ?? reference;
  const { rightAngle } = snap;
  return (
    <g
      data-testid="arch-snap"
      data-kind={snap.kind}
      data-count={snap.count}
      data-index={snap.index}
      data-point={`${snap.point.x};${snap.point.y}`}
    >
      {shown && (
        // Aresta de referência realçada (a capturada ou a escolhida para as direções).
        <line
          data-testid="arch-snap-reference"
          data-source={shown.sourceId}
          data-pinned={pinned && shown === reference}
          x1={X(shown.a.x)}
          y1={Y(shown.a.y)}
          x2={X(shown.b.x)}
          y2={Y(shown.b.y)}
          stroke={GUIDE}
          strokeWidth={(pinned && shown === reference ? 3.5 : 2.5) * mpp}
          strokeOpacity={0.75}
        />
      )}
      {snap.guides.map((guide, index) => (
        <line
          key={index}
          data-testid="arch-snap-guide"
          x1={X(guide.from.x)}
          y1={Y(guide.from.y)}
          x2={X(guide.to.x)}
          y2={Y(guide.to.y)}
          stroke={GUIDE}
          strokeWidth={1.2 * mpp}
          strokeDasharray={dash}
        />
      ))}
      {rightAngle && (
        // Símbolo de ângulo reto: o quadrado no vértice, entre os dois lados.
        <path
          data-testid="arch-snap-right-angle"
          d={`M${X(rightAngle.at.x + rightAngle.u.x * corner)} ${Y(rightAngle.at.y + rightAngle.u.y * corner)}L${X(rightAngle.at.x + (rightAngle.u.x + rightAngle.v.x) * corner)} ${Y(rightAngle.at.y + (rightAngle.u.y + rightAngle.v.y) * corner)}L${X(rightAngle.at.x + rightAngle.v.x * corner)} ${Y(rightAngle.at.y + rightAngle.v.y * corner)}`}
          fill="none"
          stroke={GUIDE}
          strokeWidth={1.5 * mpp}
        />
      )}
      {snap.kind !== 'free' && snap.kind !== 'grid' && (
        <rect
          x={X(snap.point.x) - 5 * mpp}
          y={Y(snap.point.y) - 5 * mpp}
          width={10 * mpp}
          height={10 * mpp}
          fill="none"
          stroke={GUIDE}
          strokeWidth={1.5 * mpp}
          transform={
            snap.kind === 'midpoint' || snap.kind === 'intersection'
              ? `rotate(45 ${X(snap.point.x)} ${Y(snap.point.y)})`
              : undefined
          }
        />
      )}
      {(snap.label || snap.count > 1) && (
        <text
          data-testid="arch-snap-label"
          x={X(snap.point.x) + 12 * mpp}
          y={Y(snap.point.y) + 20 * mpp}
          fill={GUIDE}
          {...textStyle(mpp)}
        >
          {snap.label}
          {snap.count > 1 ? `${snap.label ? ' · ' : ''}Tab: ${snap.index + 1}/${snap.count}` : ''}
        </text>
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Prévias
// ---------------------------------------------------------------------------

function Ghosts({ before, after, origin, mpp }: LayerProps & { before: Project; after: Project }) {
  const X = (x: number): number => x - origin.x;
  const Y = (y: number): number => -(y - origin.y);
  const shapes = useMemo(
    () => changedArchElements(before, after).map((element) => shapeOf(after, element)),
    [before, after],
  );
  return (
    <g data-testid="arch-ghosts" data-count={shapes.length}>
      {shapes.map(({ element, rings, quad }) => (
        <g key={element.id} data-testid="arch-ghost" data-arch-kind={element.kind}>
          {[...rings, ...(quad ? [quad] : [])].map((ring, index) => (
            <polygon
              key={index}
              points={ring.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')}
              fill={GHOST}
              fillOpacity={0.18}
              stroke={GHOST}
              strokeWidth={1.6 * mpp}
            />
          ))}
        </g>
      ))}
    </g>
  );
}

/**
 * Prévias e indicadores, sem receber o ponteiro: fantasma do resultado de mover, copiar, girar
 * e espelhar e do arrasto de uma alça; contorno em edição (vermelho quando o núcleo o
 * recusaria); guias, aresta de referência, ângulo reto e rótulo da captura.
 */
export function ArchEditLayer({ origin, mpp }: LayerProps) {
  const project = useEditorStore((s) => s.project);
  const selection = useArchStore((s) => s.selection);
  const transform = useArchStore((s) => s.transform);
  const grip = useArchStore((s) => s.grip);
  const contour = useArchStore((s) => s.contour);
  const cursor = useArchStore((s) => s.cursor);
  const snap = useArchStore((s) => s.snap);
  const reference = useArchStore((s) => s.reference);
  const active = useArchStore((s) => s.tool !== null);
  const X = (x: number): number => x - origin.x;
  const Y = (y: number): number => -(y - origin.y);
  const dash = `${6 * mpp} ${4 * mpp}`;
  const label = textStyle(mpp);

  const transformResult = useMemo(
    () => (transform ? transformOutcome(project, selection, transform, cursor) : null),
    [project, selection, transform, cursor],
  );
  const gripResult = useMemo(
    () => (grip?.point ? gripOutcome(project, grip.grip, grip.point) : null),
    [project, grip],
  );
  const contourResult = useMemo(
    () => (contour ? contourOutcome(project, contour) : null),
    [project, contour],
  );

  const busy = active || transform !== null || grip !== null || contour !== null;
  if (!busy) return null;
  const [first, second] = transform?.points ?? [];
  const turn =
    transform?.kind === 'rotate' && first && second && cursor
      ? sweepAngle(first, second, cursor)
      : null;
  const gripElement = grip ? getArchElement(project.architecture, grip.grip.elementId) : null;
  const dragged =
    grip?.point && gripResult?.ok
      ? getArchElement(gripResult.value.architecture, grip.grip.elementId)
      : null;
  const refusal =
    (transformResult && !transformResult.ok ? transformResult.error.message : null) ??
    (gripResult && !gripResult.ok ? gripResult.error.message : null);

  return (
    <g data-ui="arch-edit">
      {transform && (
        <g
          data-testid="arch-transform"
          data-kind={transform.kind}
          data-points={transform.points.length}
        >
          {transformResult?.ok && (
            <Ghosts
              before={project}
              after={transformResult.value.project}
              origin={origin}
              mpp={mpp}
            />
          )}
          {first && cursor && (
            // Do ponto-base (ou do centro, ou do 1º ponto do eixo) ao cursor.
            <line
              x1={X(first.x)}
              y1={Y(first.y)}
              x2={X(cursor.x)}
              y2={Y(cursor.y)}
              stroke={transform.kind === 'mirror' ? GUIDE : HIGHLIGHT}
              strokeWidth={1.5 * mpp}
              strokeDasharray={dash}
            />
          )}
          {transform.kind === 'rotate' && first && second && (
            <line
              x1={X(first.x)}
              y1={Y(first.y)}
              x2={X(second.x)}
              y2={Y(second.y)}
              stroke={HIGHLIGHT}
              strokeWidth={1.5 * mpp}
            />
          )}
          {transform.points.map((p, index) => (
            <circle key={index} cx={X(p.x)} cy={Y(p.y)} r={3.5 * mpp} fill={HIGHLIGHT} />
          ))}
          {first && cursor && (
            <text
              data-testid="arch-transform-label"
              x={X((first.x + cursor.x) / 2) + 8 * mpp}
              y={Y((first.y + cursor.y) / 2) - 8 * mpp}
              fill={HIGHLIGHT}
              {...label}
            >
              {transform.kind === 'rotate'
                ? turn !== null
                  ? `${formatDecimal((turn * 180) / Math.PI, 1)}°`
                  : ''
                : `${formatDecimal(Math.hypot(cursor.x - first.x, cursor.y - first.y), 3)} m`}
            </text>
          )}
        </g>
      )}
      {grip && gripResult?.ok && (
        <g data-testid="arch-grip-preview">
          <Ghosts before={project} after={gripResult.value} origin={origin} mpp={mpp} />
          {dragged?.kind === 'wall' && (
            <text
              data-testid="arch-grip-length"
              x={X((dragged.start.x + dragged.end.x) / 2) + 8 * mpp}
              y={Y((dragged.start.y + dragged.end.y) / 2) - 8 * mpp}
              fill={GHOST}
              {...label}
            >
              {formatDecimal(
                Math.hypot(dragged.end.x - dragged.start.x, dragged.end.y - dragged.start.y),
                3,
              )}{' '}
              m
            </text>
          )}
        </g>
      )}
      {refusal && cursor && (
        <text
          data-testid="arch-edit-refusal"
          x={X(cursor.x) + 12 * mpp}
          y={Y(cursor.y) - 12 * mpp}
          fill={REFUSED}
          {...label}
        >
          {gripElement ? `${gripElement.name}: ` : ''}
          {refusal}
        </text>
      )}
      {contour && (
        <g data-testid="arch-contour" data-valid={contourResult?.ok ?? false}>
          <polygon
            points={contour.ring.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')}
            fill={contourResult?.ok ? HIGHLIGHT : REFUSED}
            fillOpacity={0.12}
            stroke={contourResult?.ok ? HIGHLIGHT : REFUSED}
            strokeWidth={2 * mpp}
          />
          {contourResult && !contourResult.ok && contour.ring[0] && (
            <text
              data-testid="arch-contour-problem"
              x={X(contour.ring[0].x) + 10 * mpp}
              y={Y(contour.ring[0].y) - 10 * mpp}
              fill={REFUSED}
              {...label}
            >
              {contourResult.error.message}
            </text>
          )}
        </g>
      )}
      {snap && (
        <SnapIndicators
          snap={snap}
          reference={reference?.segment ?? null}
          pinned={reference?.pinned ?? false}
          origin={origin}
          mpp={mpp}
        />
      )}
    </g>
  );
}
