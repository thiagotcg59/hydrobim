import {
  closestPointsBetweenLines,
  distance,
  formatMeters,
  getElement,
  isPortFree,
  lerp,
  sub,
  vec3,
} from '@hydrobim/core';
import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { Raycaster, Vector2 } from 'three';
import { toCanonical } from '../editor/renderOrigin';
import { useEditorStore } from '../state/editorStore';

const ENDS = ['start', 'end'] as const;

/**
 * Alças das extremidades do tubo selecionado: arrastar uma delas estica ou encolhe o tubo ao
 * longo do eixo. A alça só traduz o cursor em um ponto do eixo; a regra é da store e do núcleo.
 */
export function PipeGrips() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const project = useEditorStore((s) => s.project);
  const selection = useEditorStore((s) => s.selection);
  const tool = useEditorStore((s) => s.tool);
  const viewMode = useEditorStore((s) => s.viewMode);
  const stretch = useEditorStore((s) => s.stretch);
  /** Encerra o arrasto em andamento (também ao desmontar o viewport). */
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const selected =
    selection.length === 1 && selection[0] ? getElement(project, selection[0]) : null;
  if (tool !== 'select' || viewMode !== '3d' || selected?.kind !== 'pipe') return null;
  const pipe = selected;

  const begin = (which: 'start' | 'end', event: ReactPointerEvent<HTMLDivElement>): void => {
    // O clique na alça não chega aos controles de órbita nem à janela de seleção.
    event.stopPropagation();
    if (event.button !== 0) return;
    event.preventDefault();
    const store = useEditorStore.getState();
    store.beginStretch(pipe.id, which);
    const fixed = which === 'end' ? pipe.start : pipe.end;
    const axis = sub(which === 'end' ? pipe.end : pipe.start, fixed);
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
      // Ponto do eixo do tubo mais próximo do raio do cursor (indefinido olhando ao longo do eixo).
      const closest = closestPointsBetweenLines(
        fixed,
        axis,
        // O raio sai da câmera em coordenadas de desenho; o tubo está nas do projeto.
        toCanonical(vec3(origin.x, origin.y, origin.z), useEditorStore.getState().renderOrigin),
        vec3(direction.x, direction.y, direction.z),
      );
      if (closest) useEditorStore.getState().stretchTo(closest.p1);
    };
    const finish = (apply: boolean): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      stop.current = null;
      useEditorStore.getState().endStretch(apply);
    };
    function onUp(): void {
      finish(true);
    }
    function onCancel(): void {
      finish(false);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    stop.current = onCancel;
  };

  return (
    <>
      {ENDS.map((which) => {
        const point = pipe[which];
        return (
          <Html key={which} position={[point.x, point.y, point.z]} center zIndexRange={[40, 0]}>
            <div
              className={stretch?.which === which ? 'pipe-grip pipe-grip--active' : 'pipe-grip'}
              data-testid={`pipe-grip-${which}`}
              title="Arraste para esticar ou encolher o tubo ao longo do eixo"
              onPointerDown={(event) => begin(which, event)}
              // A alça cobre a extremidade: o botão direito sobre ela abre o mesmo menu.
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const ref = { elementId: pipe.id, portId: which };
                useEditorStore.getState().openContextMenu({
                  x: event.clientX,
                  y: event.clientY,
                  elementId: pipe.id,
                  port: isPortFree(project, ref) ? ref : null,
                });
              }}
            />
          </Html>
        );
      })}
      {stretch?.pipeId === pipe.id && (
        <Html
          position={(() => {
            const middle = lerp(pipe.start, pipe.end, 0.5);
            return [middle.x, middle.y, middle.z] as [number, number, number];
          })()}
          center
          pointerEvents="none"
          style={{ pointerEvents: 'none' }}
        >
          <span className="viewport-label" data-testid="pipe-stretch-label">
            {formatMeters(distance(pipe.start, pipe.end), 3)}
          </span>
        </Html>
      )}
    </>
  );
}
