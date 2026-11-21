import {
  add,
  closestPointsBetweenLines,
  formatMeters,
  getElement,
  getPorts,
  inlineAxisOf,
  inlineClearancesOf,
  lerp,
  scale,
  vec3,
  type InlineClearance,
  type Vec3,
} from '@hydrobim/core';
import { Html, Line } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Raycaster, Vector2 } from 'three';
import { dimensionSide, referenceClearance } from '../editor/inlineSlide';
import { toCanonical } from '../editor/renderOrigin';
import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';

const COLOR = '#00a6c0';
const tuple = (p: Vec3): [number, number, number] => [p.x, p.y, p.z];

/** Afastamento (m) da linha de cota em relação ao eixo: além do raio da peça. */
function offsetOf(radius: number): number {
  return radius + 0.2;
}

/** Cota de uma extremidade: linhas de chamada, linha de cota e o comprimento. */
function ClearanceDimension({
  clearance,
  radius,
  labels,
}: {
  clearance: InlineClearance;
  radius: number;
  labels: boolean;
}) {
  if (clearance.pipeIds.length === 0) return null;
  const side = scale(dimensionSide(clearance.from, clearance.to), offsetOf(radius));
  const a = add(clearance.from, side);
  const b = add(clearance.to, side);
  const foot = scale(side, radius / offsetOf(radius));
  return (
    <>
      <Line
        points={[tuple(add(clearance.from, foot)), tuple(a)]}
        color={COLOR}
        lineWidth={1}
        depthTest={false}
      />
      <Line
        points={[tuple(add(clearance.to, foot)), tuple(b)]}
        color={COLOR}
        lineWidth={1}
        depthTest={false}
      />
      <Line points={[tuple(a), tuple(b)]} color={COLOR} lineWidth={1.5} depthTest={false} />
      {labels && (
        <Html position={tuple(lerp(a, b, 0.5))} center pointerEvents="none">
          <span
            className="viewport-label"
            data-testid={`viewport-inline-clearance-${clearance.portId}`}
            data-length={clearance.length.toFixed(4)}
          >
            {formatMeters(clearance.length, 3)}
            {clearance.straight ? '' : ' (percurso)'}
          </span>
        </Html>
      )}
    </>
  );
}

/**
 * Peças na linha no modelo 3D: cotas de cada extremidade até o próximo elemento e alça para
 * deslizar a peça entre os tubos (a alça só traduz o cursor em um ponto do eixo da peça).
 */
export function InlineGrips() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const project = useEditorStore((s) => s.project);
  const selection = useEditorStore((s) => s.selection);
  const tool = useEditorStore((s) => s.tool);
  const viewMode = useEditorStore((s) => s.viewMode);
  const sliding = useEditorStore((s) => s.inlineSlide?.elementId ?? null);
  const shown = useUiStore((s) => s.inlineClearances);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  // Html cria uma raiz React própria: entra um quadro depois da montagem (ver PipeGrips).
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (viewMode !== '3d') return null;
  const ids = selection.filter((id) => {
    const element = getElement(project, id);
    return element !== undefined && element.kind !== 'pipe';
  });
  if (ids.length === 0) return null;
  const single = selection.length === 1 ? getElement(project, ids[0] ?? '') : undefined;
  const axis = single ? inlineAxisOf(project, single.id) : null;
  const grippable =
    ready &&
    tool === 'select' &&
    single !== undefined &&
    single.kind !== 'pipe' &&
    axis !== null &&
    referenceClearance(project, single.id) !== null;

  const begin = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    if (event.button !== 0 || !single || single.kind === 'pipe' || !axis) return;
    event.preventDefault();
    const grab = single.placement.position;
    useEditorStore.getState().beginInlineSlide(single.id, grab);
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const onMove = (move: PointerEvent): void => {
      const rect = gl.domElement.getBoundingClientRect();
      pointer.set(
        ((move.clientX - rect.left) / rect.width) * 2 - 1,
        -((move.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const { origin, direction } = raycaster.ray;
      const closest = closestPointsBetweenLines(
        grab,
        axis,
        toCanonical(vec3(origin.x, origin.y, origin.z), useEditorStore.getState().renderOrigin),
        vec3(direction.x, direction.y, direction.z),
      );
      if (closest) useEditorStore.getState().inlineSlideTo(closest.p1);
    };
    const finish = (apply: boolean): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      stop.current = null;
      useEditorStore.getState().endInlineSlide(apply);
    };
    function onUp(): void {
      finish(true);
    }
    function onCancel(): void {
      finish(false);
    }
    function onKey(key: KeyboardEvent): void {
      if (key.key === 'Escape') finish(false);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    stop.current = onCancel;
  };

  return (
    <>
      {(shown || sliding) &&
        ids.map((id) => {
          const element = getElement(project, id);
          if (!element || element.kind === 'pipe') return null;
          // Raio da maior boca da peça: a cota passa por fora dela.
          const radius = Math.max(0.05, ...getPorts(element).map((p) => p.spec.outerDiameter / 2));
          return inlineClearancesOf(project, id).map((clearance) => (
            <ClearanceDimension
              key={`${id}-${clearance.portId}`}
              clearance={clearance}
              radius={radius}
              labels={ready}
            />
          ));
        })}
      {grippable && single && (
        <Html position={tuple(single.placement.position)} center zIndexRange={[40, 0]}>
          <div
            className={sliding ? 'inline-grip inline-grip--active' : 'inline-grip'}
            data-testid="inline-grip"
            title="Arraste para deslizar a peça entre os tubos (Esc cancela)"
            onPointerDown={begin}
          />
        </Html>
      )}
    </>
  );
}
