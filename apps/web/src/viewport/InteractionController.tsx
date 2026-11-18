import { constrainDeflection, getFreePorts, vec3, type Vec3 } from '@hydrobim/core';
import { useThree } from '@react-three/fiber';
import { useEffect, type RefObject } from 'react';
import { Matrix4, Mesh, MOUSE, Raycaster, Vector2, type Group, type Object3D } from 'three';
import { ndcRectFromPixels, verticesInsideRect } from '../editor/boxSelection';
import { pickPoint, type PickResult, type Ray } from '../editor/picking';
import {
  deflectionConstraintOf,
  drawElevationOf,
  pipeSnapOf,
  useEditorStore,
} from '../state/editorStore';

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

/** Parte dos controles de órbita ajustada a cada clique. */
interface OrbitButtons {
  mouseButtons: { LEFT?: MOUSE };
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
  const getThree = useThree((s) => s.get);

  useEffect(() => {
    const canvas = gl.domElement;
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    let down: { x: number; y: number; box: boolean } | null = null;
    let boxOverlay: HTMLDivElement | null = null;
    const viewProjection = new Matrix4();
    const mvp = new Matrix4();
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
      const gridStep = state.snapToGrid ? state.gridStep : 0;
      const picked = usesPoints
        ? pickPoint({
            ray,
            // Na medição não há conexão: as portas servem apenas como pontos notáveis.
            freePorts: getFreePorts(state.project),
            workPlaneZ: drawElevationOf(state),
            gridStep,
            anchor:
              state.tool === 'pipe' && state.anchor
                ? { point: state.anchor.point, lockAxis: state.anchor.lockAxis }
                : null,
            vertical: event.shiftKey,
          })
        : null;
      // Saindo da extremidade de um tubo, a direção trava nos ângulos dos joelhos de catálogo.
      const constraint = deflectionConstraintOf(state);
      // Junto a um tubo existente, o cursor mostra onde o tê automático ficará.
      const onPipe = picked?.port ? null : pipeSnapOf(state, hit, picked?.point ?? null);
      if (onPipe) return { pick: { point: onPipe, snap: 'pipe', port: null }, hit };
      const pick: PickResult | null =
        picked && constraint && !picked.port
          ? {
              point: constrainDeflection(
                constraint.origin,
                constraint.axis,
                picked.point,
                constraint.angles,
                gridStep,
              ),
              snap: 'angle',
              port: null,
            }
          : picked;
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

    const isAdditive = (event: PointerEvent): boolean =>
      event.ctrlKey || event.metaKey || event.shiftKey;

    const click = (event: PointerEvent): void => {
      const { pick, hit } = resolve(event);
      useEditorStore.getState().handleViewportClick({
        point: pick?.point ?? null,
        port: pick?.port?.ref ?? null,
        hit,
        additive: isAdditive(event),
      });
    };

    /** Seleção por janela: entram os elementos inteiramente contidos no retângulo. */
    const selectInBox = (start: { x: number; y: number }, event: PointerEvent): void => {
      const group = elementsRef.current;
      if (!group) return;
      const rect = canvas.getBoundingClientRect();
      const ndc = ndcRectFromPixels(
        { x: start.x - rect.left, y: start.y - rect.top },
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        rect.width,
        rect.height,
      );
      camera.updateMatrixWorld();
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const ids: string[] = [];
      for (const child of group.children) {
        const id: unknown = child.userData.elementId;
        if (typeof id !== 'string') continue;
        const meshes: Mesh[] = [];
        child.traverse((object) => {
          if (object instanceof Mesh) meshes.push(object);
        });
        const inside =
          meshes.length > 0 &&
          meshes.every((mesh) => {
            mvp.multiplyMatrices(viewProjection, mesh.matrixWorld);
            return verticesInsideRect(
              mesh.geometry.getAttribute('position').array,
              mvp.elements,
              ndc,
            );
          });
        if (inside) ids.push(id);
      }
      const state = useEditorStore.getState();
      state.selectMany(isAdditive(event) ? [...state.selection, ...ids] : ids);
    };

    const onBoxMove = (event: PointerEvent): void => {
      if (!down) return;
      if (!boxOverlay) {
        const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
        if (moved <= CLICK_TOLERANCE_PX) return;
        boxOverlay = document.createElement('div');
        boxOverlay.className = 'selection-box';
        boxOverlay.dataset.testid = 'selection-box';
        document.body.appendChild(boxOverlay);
        onHover(null);
      }
      boxOverlay.style.left = `${Math.min(down.x, event.clientX)}px`;
      boxOverlay.style.top = `${Math.min(down.y, event.clientY)}px`;
      boxOverlay.style.width = `${Math.abs(event.clientX - down.x)}px`;
      boxOverlay.style.height = `${Math.abs(event.clientY - down.y)}px`;
    };

    const stopBox = (): void => {
      window.removeEventListener('pointermove', onBoxMove);
      window.removeEventListener('pointerup', onBoxEnd);
      window.removeEventListener('pointercancel', onBoxCancel);
      boxOverlay?.remove();
      boxOverlay = null;
    };

    function onBoxEnd(event: PointerEvent): void {
      if (event.button !== 0 || !down) return;
      const start = down;
      const dragged = boxOverlay !== null;
      down = null;
      stopBox();
      if (dragged) selectInBox(start, event);
      else click(event);
    }

    function onBoxCancel(): void {
      down = null;
      stopBox();
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      // Em Selecionar, o arrasto com o botão esquerdo abre a janela de seleção; a órbita fica
      // no botão do meio ou em Alt + arrasto. O canvas recebe o evento antes dos controles de
      // órbita (ligados ao contêiner), então o ajuste vale já para este clique.
      const box =
        useEditorStore.getState().tool === 'select' &&
        !event.altKey &&
        event.pointerType !== 'touch';
      const controls = getThree().controls as unknown as OrbitButtons | null;
      if (controls) controls.mouseButtons.LEFT = box ? undefined : MOUSE.ROTATE;
      down = { x: event.clientX, y: event.clientY, box };
      if (box) {
        // Ouvindo em window, o arrasto continua valendo fora do canvas.
        window.addEventListener('pointermove', onBoxMove);
        window.addEventListener('pointerup', onBoxEnd);
        window.addEventListener('pointercancel', onBoxCancel);
      }
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (event.button !== 0 || !down || down.box) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      down = null;
      if (moved > CLICK_TOLERANCE_PX) return; // foi um arrasto de câmera
      click(event);
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
      stopBox();
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [gl, camera, getThree, elementsRef, onHover]);

  return null;
}
