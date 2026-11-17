import { getFreePorts, vec3, type Vec3 } from '@hydrobim/core';
import { useThree } from '@react-three/fiber';
import { useEffect, type RefObject } from 'react';
import { Raycaster, Vector2, type Group, type Object3D } from 'three';
import { pickPoint, type PickResult, type Ray } from '../editor/picking';
import { useEditorStore } from '../state/editorStore';

const CLICK_TOLERANCE_PX = 5;

function elementIdOf(object: Object3D | null): string | null {
  let current = object;
  while (current) {
    const id: unknown = current.userData.elementId;
    if (typeof id === 'string') return id;
    current = current.parent;
  }
  return null;
}

interface Props {
  elementsRef: RefObject<Group | null>;
  onHover: (elementId: string | null) => void;
}

/**
 * Traduz eventos de ponteiro do canvas em eventos de domínio (ponto 3D, porta, elemento)
 * e os entrega à store. Não contém regras de modelagem.
 */
export function InteractionController({ elementsRef, onHover }: Props) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    const canvas = gl.domElement;
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    let down: { x: number; y: number } | null = null;
    let frame = 0;
    let lastEvent: PointerEvent | null = null;

    const resolve = (
      event: PointerEvent,
    ): { pick: PickResult | null; hit: { elementId: string; point: Vec3 } | null } => {
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const state = useEditorStore.getState();
      const { origin, direction } = raycaster.ray;
      const ray: Ray = {
        origin: vec3(origin.x, origin.y, origin.z),
        direction: vec3(direction.x, direction.y, direction.z),
      };

      const group = elementsRef.current;
      const intersection = group ? raycaster.intersectObject(group, true)[0] : undefined;
      const elementId = intersection ? elementIdOf(intersection.object) : null;
      const hit =
        intersection && elementId
          ? {
              elementId,
              point: vec3(intersection.point.x, intersection.point.y, intersection.point.z),
            }
          : null;

      const usesPoints = state.tool !== 'select';
      const pick = usesPoints
        ? pickPoint({
            ray,
            // Na medição não há conexão: as portas servem apenas como pontos notáveis.
            freePorts: getFreePorts(state.project),
            workPlaneZ: state.workPlaneZ,
            gridStep: state.snapToGrid ? state.gridStep : 0,
            anchor:
              state.tool === 'pipe' && state.anchor
                ? { point: state.anchor.point, lockAxis: state.anchor.lockAxis }
                : null,
            vertical: event.shiftKey,
          })
        : null;
      return { pick, hit };
    };

    const onPointerMove = (event: PointerEvent): void => {
      lastEvent = event;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!lastEvent || lastEvent.buttons !== 0) return;
        const { pick, hit } = resolve(lastEvent);
        const state = useEditorStore.getState();
        onHover(hit?.elementId ?? null);
        state.setCursor(
          pick ? { point: pick.point, snap: pick.snap, port: pick.port?.ref ?? null } : null,
        );
      });
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button === 0) down = { x: event.clientX, y: event.clientY };
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (event.button !== 0 || !down) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      down = null;
      if (moved > CLICK_TOLERANCE_PX) return; // foi um arrasto de câmera
      const { pick, hit } = resolve(event);
      useEditorStore.getState().handleViewportClick({
        point: pick?.point ?? null,
        port: pick?.port?.ref ?? null,
        hit,
        additive: event.ctrlKey || event.metaKey || event.shiftKey,
      });
    };

    const onPointerLeave = (): void => {
      onHover(null);
      useEditorStore.getState().setCursor(null);
    };

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [gl, camera, elementsRef, onHover]);

  return null;
}
