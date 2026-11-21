import {
  closestPointOnLine,
  constrainDeflection,
  degToRad,
  distance,
  terrainRayHit,
  terrainStats,
  vec3,
  type Vec3,
} from '@hydrobim/core';
import { useThree } from '@react-three/fiber';
import { useEffect, type RefObject } from 'react';
import {
  Matrix4,
  Mesh,
  MOUSE,
  Raycaster,
  Vector2,
  type Group,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
} from 'three';
import { ndcRectFromPixels, verticesInsideRect } from '../editor/boxSelection';
import { arrowPreferences, contextTargetOf, CONTEXT_PX, nudgeStep } from '../editor/directEdit';
import { toCanonical } from '../editor/renderOrigin';
import {
  pickPoint,
  pickPort,
  type PickGround,
  type PickResult,
  type PixelScale,
  type Ray,
} from '../editor/picking';
import { shiftPick } from '../editor/polarLock';
import { lengthStepOf, precisePipePoint } from '../editor/precision';
import { precision } from '../state/precisionStore';
import { cursorElementOf } from '../state/viewPreview';
import { visibleFreePortsOf } from '../editor/visibility';
import {
  deflectionConstraintOf,
  drawElevationOf,
  equipmentGroundElevation,
  pipeSnapOf,
  useEditorStore,
} from '../state/editorStore';
import { getActiveClipPlanes } from '../views/clipContext';
import { pointGridStepOf } from '../state/alignTool';
import { useTerrainStore } from '../terrain/terrainStore';

const CLICK_TOLERANCE_PX = 5;

/**
 * Captura sobre o terreno para as ferramentas de equipamento: o raio é testado contra a
 * superfície como ela está DESENHADA (o exagero vertical escala as cotas a partir da menor
 * delas), e a cota do ponto é a de assentamento — a do terreno real, nunca a exagerada.
 */
function groundOf(state: Parameters<typeof equipmentGroundElevation>[0]): PickGround | null {
  const { terrain } = state.project;
  if (!terrain || (state.tool !== 'pump' && state.tool !== 'tank')) return null;
  if (!state.toolOptions.terrainPlacement.enabled) return null;
  const exaggeration = useTerrainStore.getState().display.exaggeration;
  const base = terrainStats(terrain).minZ;
  return {
    hit: (ray) => {
      const origin = vec3(ray.origin.x, ray.origin.y, base + (ray.origin.z - base) / exaggeration);
      const direction = vec3(ray.direction.x, ray.direction.y, ray.direction.z / exaggeration);
      return terrainRayHit(terrain, origin, direction);
    },
    elevationAt: (x, y) => equipmentGroundElevation(state, x, y),
  };
}

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
    let rightDown: { x: number; y: number } | null = null;
    let boxOverlay: HTMLDivElement | null = null;
    const viewProjection = new Matrix4();
    const mvp = new Matrix4();
    let frame = 0;
    let lastEvent: PointerEvent | null = null;
    /** Escolha manual entre portas sob o cursor (tecla Tab). */
    let cycle = 0;
    let stacked = 1;

    /** Tamanho do pixel no modelo, para que a captura tenha o mesmo raio na tela em qualquer zoom. */
    const pixelScale = (): PixelScale => {
      const height = canvas.clientHeight || 1;
      if ('isOrthographicCamera' in camera) {
        const ortho = camera as OrthographicCamera;
        return { constant: (ortho.top - ortho.bottom) / ortho.zoom / height, perDistance: 0 };
      }
      const fov = degToRad((camera as PerspectiveCamera).fov);
      return { constant: 0, perDistance: (2 * Math.tan(fov / 2)) / height };
    };

    /** Raio do cursor no modelo e o elemento que ele atinge. */
    const cast = (
      event: MouseEvent,
    ): { ray: Ray; hit: { elementId: string; point: Vec3 } | null } => {
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const { origin, direction } = raycaster.ray;
      // A cena é desenhada em relação à origem de renderização: o raio e o ponto atingido
      // voltam às coordenadas do projeto antes de chegar às regras de captura.
      const drawOrigin = useEditorStore.getState().renderOrigin;
      const ray: Ray = {
        origin: toCanonical(vec3(origin.x, origin.y, origin.z), drawOrigin),
        direction: vec3(direction.x, direction.y, direction.z),
      };

      const group = elementsRef.current;
      // Com a caixa de corte, o primeiro ponto atingido que ela não esconde.
      const clip = getActiveClipPlanes();
      const hits = group ? raycaster.intersectObject(group, true) : [];
      const intersection = clip
        ? hits.find((entry) => clip.every((plane) => plane.distanceToPoint(entry.point) >= 0))
        : hits[0];
      const elementId = intersection ? elementIdOf(intersection.object) : null;
      const hit =
        intersection && elementId
          ? {
              elementId,
              point: toCanonical(
                vec3(intersection.point.x, intersection.point.y, intersection.point.z),
                drawOrigin,
              ),
            }
          : null;
      return { ray, hit };
    };

    const resolve = (
      event: PointerEvent,
    ): { pick: PickResult | null; hit: { elementId: string; point: Vec3 } | null } => {
      const { ray, hit } = cast(event);
      const state = useEditorStore.getState();

      const usesPoints = state.tool !== 'select';
      const settings = precision();
      // Com o trecho em andamento, o passo de comprimento da precisão substitui o da grade.
      const drawing = state.tool === 'pipe' && state.anchor !== null;
      const gridStep = drawing ? lengthStepOf(state, settings) : pointGridStepOf(state);
      // Shift no traçado de tubo: trava de 45°/90° no plano ou trecho vertical, o que estiver
      // mais perto do cursor. Nas demais ferramentas, Shift continua sendo a vertical.
      const polar = event.shiftKey && state.tool === 'pipe' && state.anchor !== null;
      const picked = usesPoints
        ? pickPoint({
            ray,
            // Na medição não há conexão: as portas servem apenas como pontos notáveis.
            // Sistemas ocultos não são desenhados nem capturados.
            freePorts: visibleFreePortsOf(state.project),
            pixelScale: pixelScale(),
            cycle,
            workPlaneZ: drawElevationOf(state),
            gridStep,
            anchor:
              state.tool === 'pipe' && state.anchor
                ? { point: state.anchor.point, lockAxis: state.anchor.lockAxis }
                : null,
            vertical: event.shiftKey && !polar,
            ground: groundOf(state),
          })
        : null;
      if (polar) {
        const up = pickPoint({
          ray,
          freePorts: visibleFreePortsOf(state.project),
          pixelScale: pixelScale(),
          cycle,
          workPlaneZ: drawElevationOf(state),
          gridStep,
          anchor: state.anchor
            ? { point: state.anchor.point, lockAxis: state.anchor.lockAxis }
            : null,
          vertical: true,
          ground: groundOf(state),
        });
        return { pick: shiftPick(state, ray, picked, up), hit };
      }
      // Saindo da extremidade de um tubo, a direção trava nos ângulos dos joelhos de catálogo.
      const constraint = deflectionConstraintOf(state);
      // Junto a um tubo existente, o cursor mostra onde o tê automático ficará.
      const onPipe = picked?.port ? null : pipeSnapOf(state, hit, picked?.point ?? null);
      if (onPipe) return { pick: { point: onPipe, snap: 'pipe', port: null, stacked: 1 }, hit };
      const pick: PickResult | null =
        picked && constraint && !picked.port
          ? {
              point: constrainDeflection(
                constraint.origin,
                constraint.axis,
                picked.point,
                constraint.angles,
                gridStep,
                constraint.jointLimit,
              ),
              snap: 'angle',
              port: null,
              stacked: 1,
            }
          : picked;
      // Precisão de modelagem: em ponto livre do plano, direção e comprimento andam pelos
      // passos, medidos sobre o ponto exato do cursor (sem a grade).
      if (drawing && settings.enabled && pick && (pick.snap === 'grid' || pick.snap === 'plane')) {
        const exact = pickPoint({
          ray,
          freePorts: [],
          pixelScale: pixelScale(),
          cycle,
          workPlaneZ: drawElevationOf(state),
          gridStep: 0,
          anchor: state.anchor
            ? { point: state.anchor.point, lockAxis: state.anchor.lockAxis }
            : null,
          vertical: false,
          ground: groundOf(state),
        });
        const precise = exact ? precisePipePoint(state, exact.point, settings) : null;
        if (precise)
          return { pick: { point: precise, snap: 'angle', port: null, stacked: 1 }, hit };
      }
      return { pick, hit };
    };

    const hover = (event: PointerEvent): void => {
      let { pick, hit } = resolve(event);
      // Fora de um empilhamento de portas, a escolha manual é esquecida.
      if (cycle !== 0 && (pick?.stacked ?? 1) <= 1) {
        cycle = 0;
        ({ pick, hit } = resolve(event));
      }
      stacked = pick?.stacked ?? 1;
      const state = useEditorStore.getState();
      onHover(hit?.elementId ?? null);
      state.setCursor(
        pick
          ? {
              point: pick.point,
              snap: pick.snap,
              port: pick.port?.ref ?? null,
              elementId: cursorElementOf(
                state.project,
                state.tool,
                pick.port?.ref.elementId ?? null,
                pick.snap,
                hit?.elementId ?? null,
              ),
              stacked: pick.stacked,
            }
          : null,
      );
    };

    const onPointerMove = (event: PointerEvent): void => {
      lastEvent = event;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!lastEvent || lastEvent.buttons !== 0) return;
        hover(lastEvent);
      });
    };

    /** Setas: deslizam a seleção ao longo da linha, no sentido em que a seta aponta na tela. */
    const nudge = (event: KeyboardEvent): void => {
      const state = useEditorStore.getState();
      if (state.tool !== 'select' || state.viewMode !== '3d' || state.selection.length === 0) {
        return;
      }
      if (event.altKey) return;
      camera.updateMatrixWorld();
      const m = camera.matrixWorld.elements;
      const column = (i: number): Vec3 => vec3(m[i] ?? 0, m[i + 1] ?? 0, m[i + 2] ?? 0);
      // Colunas da matriz da câmera: direita, cima e o eixo que aponta para o observador.
      const preferences = arrowPreferences(event.key, column(0), column(4), column(8));
      if (!preferences) return;
      event.preventDefault();
      state.nudgeSelection(preferences, nudgeStep(state.gridStep, event));
    };

    /**
     * Botão direito sem arrasto (o arrasto desloca a câmera): junto a uma extremidade de tubo
     * ou a uma conexão, abre o menu com "Criar tubo".
     */
    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
      const start = rightDown;
      rightDown = null;
      const state = useEditorStore.getState();
      if (state.viewMode !== '3d') return;
      if (
        start &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_TOLERANCE_PX
      ) {
        return;
      }
      const { ray, hit } = cast(event);
      const scale = pixelScale();
      const target = contextTargetOf(
        state.project,
        hit?.elementId ?? null,
        (ports) => pickPort(ray, ports, scale, 0, CONTEXT_PX)?.port ?? null,
        (port) =>
          distance(
            closestPointOnLine(ray.origin, ray.direction, port.position).point,
            port.position,
          ),
      );
      if (target) state.openContextMenu({ x: event.clientX, y: event.clientY, ...target });
      else state.closeContextMenu();
    };

    // Tab alterna entre as portas sob o cursor (como na planta); fora disso, o Tab é do navegador.
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.key.startsWith('Arrow')) {
        nudge(event);
        return;
      }
      if (event.key !== 'Tab' || stacked <= 1 || !lastEvent) return;
      event.preventDefault();
      cycle += event.shiftKey ? -1 : 1;
      hover(lastEvent);
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
      if (event.button === 2) rightDown = { x: event.clientX, y: event.clientY };
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
      stacked = 1;
      cycle = 0;
      onHover(null);
      useEditorStore.getState().setCursor(null);
    };

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      stopBox();
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [gl, camera, getThree, elementsRef, onHover]);

  return null;
}
