import {
  closestPointsBetweenLines,
  formatMeters,
  MIN_VIEW_EXTENT,
  vec3,
  type SectionBox,
  type Vec3,
} from '@hydrobim/core';
import { Html, Line } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Raycaster, Vector2 } from 'three';
import { toCanonical } from '../editor/renderOrigin';
import { useEditorStore } from '../state/editorStore';
import { useViewStore } from './viewStore';

/**
 * Caixa de corte da vista 3D aberta: as arestas da caixa e uma alça no meio de cada face.
 * Arrastar a alça move a face ao longo do seu eixo, com prévia ao vivo e um único passo no
 * histórico ao soltar. A caixa só controla o que a vista desenha — nenhum elemento é cortado.
 */

type Axis = 'x' | 'y' | 'z';
type Face = { axis: Axis; side: 'min' | 'max' };

const FACES: readonly Face[] = [
  { axis: 'x', side: 'min' },
  { axis: 'x', side: 'max' },
  { axis: 'y', side: 'min' },
  { axis: 'y', side: 'max' },
  { axis: 'z', side: 'min' },
  { axis: 'z', side: 'max' },
];
const AXIS_VECTOR: Record<Axis, Vec3> = { x: vec3(1, 0, 0), y: vec3(0, 1, 0), z: vec3(0, 0, 1) };
const BOX_COLOR = '#2f6fde';

const tuple = (v: Vec3): [number, number, number] => [v.x, v.y, v.z];

/** As doze arestas da caixa, como pares de pontos. */
function edgesOf({ min, max }: SectionBox): [number, number, number][] {
  const corner = (i: number): [number, number, number] => [
    i & 1 ? max.x : min.x,
    i & 2 ? max.y : min.y,
    i & 4 ? max.z : min.z,
  ];
  const pairs: [number, number][] = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  return pairs.flatMap(([a, b]) => [corner(a), corner(b)]);
}

const faceCenter = (box: SectionBox, face: Face): Vec3 => {
  const center = vec3(
    (box.min.x + box.max.x) / 2,
    (box.min.y + box.max.y) / 2,
    (box.min.z + box.max.z) / 2,
  );
  return { ...center, [face.axis]: box[face.side][face.axis] };
};

/** A caixa com a face levada a `value`, sem deixá-la cruzar a face oposta. */
export function moveBoxFace(box: SectionBox, face: Face, value: number): SectionBox {
  const limited =
    face.side === 'min'
      ? Math.min(value, box.max[face.axis] - MIN_VIEW_EXTENT)
      : Math.max(value, box.min[face.axis] + MIN_VIEW_EXTENT);
  return { ...box, [face.side]: { ...box[face.side], [face.axis]: limited } };
}

interface Props {
  viewId: string;
  box: SectionBox;
  /** Prévia do arrasto, mostrada pela cena (inclusive nos planos de corte). */
  onPreview: (box: SectionBox | null) => void;
}

export function SectionBox3D({ viewId, box, onPreview }: Props) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const gridStep = useEditorStore((s) => s.gridStep);
  const snapToGrid = useEditorStore((s) => s.snapToGrid);
  const [active, setActive] = useState<string | null>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  // As alças (Html) entram um quadro depois da cena, como as demais alças do viewport.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const begin = (face: Face, event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    if (event.button !== 0) return;
    event.preventDefault();
    const start = box;
    const anchor = faceCenter(start, face);
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    let current = start;
    setActive(`${face.axis}-${face.side}`);

    const onMove = (move: PointerEvent): void => {
      const rect = gl.domElement.getBoundingClientRect();
      pointer.set(
        ((move.clientX - rect.left) / rect.width) * 2 - 1,
        -((move.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const { origin, direction } = raycaster.ray;
      // Ponto do eixo da face mais próximo do raio do cursor (indefinido olhando ao longo dele).
      const closest = closestPointsBetweenLines(
        anchor,
        AXIS_VECTOR[face.axis],
        toCanonical(vec3(origin.x, origin.y, origin.z), useEditorStore.getState().renderOrigin),
        vec3(direction.x, direction.y, direction.z),
      );
      if (!closest) return;
      const raw = closest.p1[face.axis];
      const value = snapToGrid && gridStep > 0 ? Math.round(raw / gridStep) * gridStep : raw;
      current = moveBoxFace(start, face, value);
      onPreview(current);
    };
    const finish = (apply: boolean): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      stop.current = null;
      setActive(null);
      onPreview(null);
      if (apply && current !== start) {
        useViewStore.getState().change(viewId, { sectionBox: current });
      }
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
      <Line points={edgesOf(box)} segments color={BOX_COLOR} lineWidth={1.5} />
      {ready &&
        FACES.map((face) => {
          const key = `${face.axis}-${face.side}`;
          return (
            <Html key={key} position={tuple(faceCenter(box, face))} center zIndexRange={[40, 0]}>
              <div
                className={active === key ? 'section-grip section-grip--active' : 'section-grip'}
                data-testid={`section-box-grip-${key}`}
                data-axis={face.axis}
                title={`Arraste para mover a face ${face.axis.toUpperCase()} ${face.side === 'min' ? 'mínima' : 'máxima'} da caixa de corte (${formatMeters(box[face.side][face.axis], 2)})`}
                onPointerDown={(event) => begin(face, event)}
              >
                {face.axis.toUpperCase()}
              </div>
            </Html>
          );
        })}
    </>
  );
}
