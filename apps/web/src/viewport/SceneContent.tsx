import {
  angleBetween,
  computeArchBounds,
  computeBounds,
  getView,
  viewCategoryOf,
  type ModelProjectView,
  type SectionBox,
  distance,
  formatMeters,
  lerp,
  resolvePort,
  sub,
  terrainStats,
  vec3,
  type Vec3,
} from '@hydrobim/core';
import { classifyElement } from '@hydrobim/ifc';
import {
  GizmoHelper,
  GizmoViewport,
  Grid,
  Html,
  Line,
  OrbitControls,
  OrthographicCamera,
} from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Group, OrthographicCamera as OrthoImpl, PerspectiveCamera } from 'three';
import { Matrix4, MOUSE, Plane, Quaternion, Vector3 } from 'three';
import { orbitPivotShift, targetAtPivotDepth } from '../editor/orbitPivot';
import { portMarkerRadius } from '../editor/picking';
import { toCanonical, toRender } from '../editor/renderOrigin';
import { formatSegment } from '../editor/segment';
import { describeSnap } from '../editor/snapLabel';
import { visibleElementsOf, visibleFreePortsOf } from '../editor/visibility';
import {
  getViewDirection,
  getViewFocus,
  orthographicZoomFor,
  perspectiveDistanceFor,
  setViewFocus,
  VIEW_DIRECTIONS,
} from '../editor/viewPresets';
import { alignGuidesOf } from '../state/alignTool';
import { drawElevationOf, useEditorStore } from '../state/editorStore';
import { ModelDisplayContext, setActiveClipPlanes, type ModelDisplay } from '../views/clipContext';
import { SectionBox3D } from '../views/SectionBox3D';
import { useViewStore } from '../views/viewStore';
import { ArchElements } from './ArchMeshes';
import { ElementMesh } from './ElementMesh';
import { InlineGrips } from './InlineGrips';
import { InteractionController } from './InteractionController';
import { PipeGrips } from './PipeGrips';
import { PreviewGhosts } from './PreviewGhosts';
import { SceneLighting } from './SceneLighting';
import { TerrainSurface } from './TerrainSurface';

/** Cores de apoio escolhidas para contrastar com o fundo branco. */
const DRAW_COLOR = '#e8590c';
const PORT_COLOR = '#0b93a8';
const MEASURE_COLOR = '#0c8f6f';

const tuple = (v: Vec3): [number, number, number] => [v.x, v.y, v.z];

/** Vista 3D de projeto aberta na área do modelo (a consulta BIM / IFC usa o modelo padrão). */
function useOpenView3d(): ModelProjectView | null {
  const id = useViewStore((s) => s.open3d);
  const project = useEditorStore((s) => s.project);
  const bim = useEditorStore((s) => s.viewMode === 'bim');
  const view = bim ? undefined : getView(project, id);
  return view?.kind === '3d' ? view : null;
}

export function Elements({ hoveredId }: { hoveredId: string | null }) {
  const elements = useEditorStore((s) => s.project.elements);
  const systems = useEditorStore((s) => s.project.systems);
  const bySystem = useMemo(() => new Map(systems.map((s) => [s.id, s])), [systems]);
  const selection = useEditorStore((s) => s.selection);
  // Aba BIM / IFC: ocultar/isolar e filtro pela classe IFC valem só no seu visualizador.
  const bim = useEditorStore((s) => s.viewMode === 'bim');
  const hiddenIds = useEditorStore((s) => s.bimHidden);
  const classFilter = useEditorStore((s) => s.bimClassFilter);
  const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  // Vista 3D aberta: a visibilidade dela soma-se à do projeto (só fora da consulta BIM).
  const view = useOpenView3d();
  const viewHidden = useMemo(
    () =>
      view
        ? {
            systems: new Set(view.visibility.hiddenSystemIds),
            categories: new Set(view.visibility.hiddenCategories),
          }
        : null,
    [view],
  );
  return (
    <>
      {elements
        .filter((element) => bySystem.get(element.systemId)?.visible !== false)
        .filter(
          (element) =>
            !viewHidden ||
            (!viewHidden.systems.has(element.systemId) &&
              !viewHidden.categories.has(viewCategoryOf(element))),
        )
        .filter(
          (element) =>
            !bim ||
            (!hidden.has(element.id) &&
              (classFilter === null || classifyElement(element).entity === classFilter)),
        )
        .map((element) => (
          <ElementMesh
            key={element.id}
            element={element}
            colorOverride={bySystem.get(element.systemId)?.color}
            selected={selection.includes(element.id)}
            hovered={element.id === hoveredId}
          />
        ))}
    </>
  );
}

/** Marcadores dos terminais livres (alvos de conexão) nas ferramentas de modelagem. */
function FreePortMarkers() {
  const project = useEditorStore((s) => s.project);
  const tool = useEditorStore((s) => s.tool);
  const snappedPort = useEditorStore((s) => s.cursor?.port ?? null);
  // Portas de sistemas ocultos não são oferecidas como alvo de conexão.
  const ports = useMemo(() => visibleFreePortsOf(project), [project]);
  if (tool === 'select' || tool === 'measure') return null;
  return (
    <>
      {ports.map((port) => {
        const active =
          snappedPort?.elementId === port.ref.elementId && snappedPort.portId === port.ref.portId;
        const radius = portMarkerRadius(port) * (active ? 1.5 : 1);
        return (
          <mesh key={`${port.ref.elementId}#${port.ref.portId}`} position={tuple(port.position)}>
            <sphereGeometry args={[radius, 16, 12]} />
            <meshBasicMaterial
              color={active ? DRAW_COLOR : PORT_COLOR}
              transparent
              opacity={active ? 0.95 : 0.6}
              depthTest={false}
            />
          </mesh>
        );
      })}
    </>
  );
}

function DrawingOverlay() {
  const anchor = useEditorStore((s) => s.anchor);
  const cursor = useEditorStore((s) => s.cursor);
  const tool = useEditorStore((s) => s.tool);
  const measure = useEditorStore((s) => s.measure);
  const align = useEditorStore((s) => s.align);
  const project = useEditorStore((s) => s.project);
  const showCursor = cursor && tool !== 'select';
  // Partindo de uma porta, a prévia informa a mudança de direção (o joelho necessário).
  const origin = anchor?.port ? resolvePort(project, anchor.port) : undefined;
  // Identifica o que foi capturado quando o ponto vem de um elemento (porta ou tubo).
  const snapLabel =
    showCursor && (cursor.snap === 'port' || cursor.snap === 'pipe')
      ? describeSnap(project, cursor)
      : null;

  const measureEnd = measure.b ?? (measure.a && tool === 'measure' ? cursor?.point : null) ?? null;
  const alignGuides = tool === 'align' && align ? alignGuidesOf(align, cursor?.point ?? null) : [];

  return (
    <>
      {alignGuides.map((guide) => (
        <group key={guide.label}>
          {distance(guide.from, guide.to) > 1e-6 && (
            <Line
              points={[tuple(guide.from), tuple(guide.to)]}
              color={DRAW_COLOR}
              lineWidth={2}
              dashed
              dashSize={0.1}
              gapSize={0.06}
              depthTest={false}
            />
          )}
          <Html position={tuple(guide.from)} pointerEvents="none" style={{ pointerEvents: 'none' }}>
            <span className="viewport-label" data-testid="viewport-align-guide">
              {guide.label}
            </span>
          </Html>
        </group>
      ))}
      {showCursor && (
        <mesh position={tuple(cursor.point)}>
          <sphereGeometry args={[0.025, 12, 8]} />
          <meshBasicMaterial color={DRAW_COLOR} depthTest={false} />
        </mesh>
      )}
      {showCursor && snapLabel && (
        <Html position={tuple(cursor.point)} pointerEvents="none" style={{ pointerEvents: 'none' }}>
          <span className="viewport-label viewport-label--snap" data-testid="viewport-snap-label">
            {snapLabel}
          </span>
        </Html>
      )}
      {tool === 'pipe' && anchor && cursor && distance(anchor.point, cursor.point) > 1e-6 && (
        <>
          <Line
            points={[tuple(anchor.point), tuple(cursor.point)]}
            color={DRAW_COLOR}
            lineWidth={2}
            dashed
            dashSize={0.1}
            gapSize={0.06}
            depthTest={false}
          />
          <Html position={tuple(lerp(anchor.point, cursor.point, 0.5))} center pointerEvents="none">
            <span className="viewport-label" data-testid="viewport-pipe-preview-label">
              {formatSegment(
                anchor.point,
                cursor.point,
                origin ? angleBetween(origin.direction, sub(cursor.point, anchor.point)) : null,
              )}
            </span>
          </Html>
        </>
      )}
      {measure.a && measureEnd && distance(measure.a, measureEnd) > 1e-6 && (
        <>
          <Line
            points={[tuple(measure.a), tuple(measureEnd)]}
            color={MEASURE_COLOR}
            lineWidth={2}
            depthTest={false}
          />
          <Html position={tuple(lerp(measure.a, measureEnd, 0.5))} center pointerEvents="none">
            <span className="viewport-label viewport-label--measure">
              {formatMeters(distance(measure.a, measureEnd))}
            </span>
          </Html>
        </>
      )}
    </>
  );
}

/** Parte dos controles de órbita usada pelo enquadramento. */
interface OrbitLike {
  target: Vector3;
  update: () => void;
  addEventListener: (type: 'change' | 'start' | 'end', listener: () => void) => void;
  removeEventListener: (type: 'change' | 'start' | 'end', listener: () => void) => void;
}

type SceneCamera = PerspectiveCamera | OrthoImpl;

const isOrtho = (camera: SceneCamera): camera is OrthoImpl => 'isOrthographicCamera' in camera;
const fovOf = (camera: PerspectiveCamera): number => (camera.fov * Math.PI) / 180;

/**
 * Último pedido de vista já aplicado. O viewport é desmontado ao abrir a planta: ao voltar,
 * o pedido antigo não pode ser reaplicado (reenquadraria tudo e perderia o ponto de interesse).
 */
let appliedNonce = -1;

/** Posiciona a câmera olhando `center` pela direção dada, mostrando `halfHeight` de altura. */
function placeCamera(
  camera: SceneCamera,
  controls: OrbitLike,
  center: Vector3,
  direction: Vector3,
  halfHeight: number,
  viewportHeight: number,
): void {
  const ortho = isOrtho(camera);
  // A câmera ortográfica fica afastada para não cortar o modelo; o zoom define a ampliação.
  const range = ortho
    ? Math.max(halfHeight * 8, 50)
    : perspectiveDistanceFor(halfHeight, fovOf(camera));
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(direction, range);
  if (ortho) {
    camera.zoom = orthographicZoomFor(halfHeight, viewportHeight);
    camera.near = 0.01;
    camera.far = range * 20;
  } else {
    camera.near = Math.max(range / 1000, 0.005);
    camera.far = Math.max(range * 100, 2000);
  }
  camera.updateProjectionMatrix();
  controls.update();
}

/**
 * Registra o que a câmera está mostrando, para a planta e para a troca de projeção. A câmera
 * vive em coordenadas de desenho; o ponto de interesse é guardado em coordenadas do projeto, e
 * a origem de renderização acompanha-o quando ele se afasta.
 */
function rememberFocus(camera: SceneCamera, controls: OrbitLike): void {
  const offset = camera.position.clone().sub(controls.target);
  const range = offset.length();
  if (range < 1e-9) return;
  const halfHeight = isOrtho(camera)
    ? (camera.top - camera.bottom) / (2 * camera.zoom)
    : range * Math.tan(fovOf(camera) / 2);
  const store = useEditorStore.getState();
  const center = toCanonical(controls.target, store.renderOrigin);
  offset.normalize();
  setViewFocus({ center, halfHeight }, vec3(offset.x, offset.y, offset.z));
  store.rebaseRenderOrigin(center);
}

/**
 * Enquadra o modelo, aplica as vistas predefinidas e mantém o ponto de interesse: ao voltar
 * da planta ou trocar a projeção, a câmera retoma o mesmo centro e a mesma ampliação.
 */
function CameraRig() {
  const viewRequest = useEditorStore((s) => s.viewRequest);
  const camera = useThree((s) => s.camera) as SceneCamera;
  const viewport = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as OrbitLike | null;
  const renderOrigin = useEditorStore((s) => s.renderOrigin);

  // Origem de renderização trocada: a cena foi transladada, e a câmera vai junto — a vista
  // não se move em relação ao modelo.
  const appliedOrigin = useRef(renderOrigin);
  useEffect(() => {
    const previous = appliedOrigin.current;
    appliedOrigin.current = renderOrigin;
    if (!controls || previous === renderOrigin) return;
    const shift = new Vector3(
      previous.x - renderOrigin.x,
      previous.y - renderOrigin.y,
      previous.z - renderOrigin.z,
    );
    camera.position.add(shift);
    controls.target.add(shift);
    controls.update();
  }, [renderOrigin, camera, controls]);

  // Câmera nova (viewport remontado ou projeção trocada): retoma o ponto de interesse.
  useEffect(() => {
    if (!controls) return;
    const focus = getViewFocus();
    const pending = useEditorStore.getState().viewRequest;
    if (focus && (!pending || pending.nonce === appliedNonce)) {
      const kept = getViewDirection();
      const direction = kept
        ? new Vector3(kept.x, kept.y, kept.z)
        : new Vector3(...VIEW_DIRECTIONS.iso).normalize();
      const { x, y, z } = toRender(focus.center, appliedOrigin.current);
      placeCamera(
        camera,
        controls,
        new Vector3(x, y, z),
        direction,
        focus.halfHeight,
        viewport.height,
      );
    }
    // Navegação focada na seleção: com algo selecionado, o giro é em torno do centro da seleção
    // (que fica parado na tela), o zoom aproxima em direção a ela e o pan a acompanha no cursor.
    // Vale só entre `start` e `end` — vistas predefinidas e enquadramentos não passam por aqui.
    let pivot: Vec3 | null = null;
    let dragging = false;
    /** O zoom só é centrado na seleção quando ela está à vista; fora da tela, vale o da câmera. */
    let zoomOnPivot = false;
    const previous = {
      world: new Matrix4(),
      rotation: new Quaternion(),
      target: new Vector3(),
      range: 1,
      zoom: 1,
    };
    const keepPose = (): void => {
      camera.updateMatrixWorld();
      previous.world.copy(camera.matrixWorld);
      previous.rotation.copy(camera.quaternion);
      previous.target.copy(controls.target);
      previous.range = camera.position.distanceTo(controls.target);
      previous.zoom = camera.zoom;
    };
    const pivotInScene = (point: Vec3): Vector3 => {
      const { x, y, z } = toRender(point, appliedOrigin.current);
      return new Vector3(x, y, z);
    };
    const onStart = (): void => {
      const { project, selection } = useEditorStore.getState();
      const chosen =
        selection.length > 0
          ? visibleElementsOf(project).filter((element) => selection.includes(element.id))
          : [];
      const bounds = chosen.length > 0 ? computeBounds(chosen) : null;
      pivot = bounds ? lerp(bounds.min, bounds.max, 0.5) : null;
      dragging = true;
      zoomOnPivot = false;
      if (pivot) {
        camera.updateMatrixWorld();
        const point = pivotInScene(pivot);
        // Alvo na profundidade da seleção: o pan e o zoom passam a ser medidos em relação a ela.
        const forward = camera.getWorldDirection(new Vector3());
        const target = targetAtPivotDepth(camera.position, forward, point);
        if (target) controls.target.copy(target);
        const screen = point.clone().project(camera);
        zoomOnPivot = target !== null && Math.abs(screen.x) <= 1 && Math.abs(screen.y) <= 1;
      }
      keepPose();
    };
    const onEnd = (): void => {
      dragging = false;
    };
    const onChange = (): void => {
      if (dragging && pivot) {
        // No pan o alvo dos controles anda junto com a câmera: nada a compensar.
        const panned = !controls.target.equals(previous.target);
        const rotated = camera.quaternion.angleTo(previous.rotation) > 1e-9;
        if (!panned && (rotated || zoomOnPivot)) {
          camera.updateMatrixWorld();
          const ortho = isOrtho(camera);
          const range = camera.position.distanceTo(controls.target);
          const lateral = ortho
            ? previous.zoom / camera.zoom
            : range / Math.max(previous.range, 1e-9);
          const shift = orbitPivotShift(
            previous.world,
            camera.matrixWorld,
            pivotInScene(pivot),
            lateral,
            ortho ? 1 : lateral,
          );
          camera.position.add(shift);
          controls.target.add(shift);
        }
        keepPose();
      }
      rememberFocus(camera, controls);
    };
    controls.addEventListener('start', onStart);
    controls.addEventListener('end', onEnd);
    controls.addEventListener('change', onChange);
    return () => {
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('end', onEnd);
      controls.removeEventListener('change', onChange);
    };
    // A altura do viewport só importa no momento da troca de câmera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, controls]);

  useEffect(() => {
    if (!viewRequest || !controls || viewRequest.nonce === appliedNonce) return;
    appliedNonce = viewRequest.nonce;
    const { project, selection } = useEditorStore.getState();
    // O enquadramento considera só o que está visível (ou só a seleção, quando pedido).
    const visible = visibleElementsOf(project);
    const chosen = viewRequest.selection
      ? visible.filter((element) => selection.includes(element.id))
      : visible;
    let bounds = computeBounds(chosen.length > 0 ? chosen : visible);
    // Enquadrar o projeto inclui a arquitetura; enquadrar a seleção da rede, não.
    const arch = viewRequest.selection && chosen.length > 0 ? null : computeArchBounds(project);
    if (arch) {
      bounds = bounds
        ? {
            min: vec3(
              Math.min(bounds.min.x, arch.min.x),
              Math.min(bounds.min.y, arch.min.y),
              Math.min(bounds.min.z, arch.min.z),
            ),
            max: vec3(
              Math.max(bounds.max.x, arch.max.x),
              Math.max(bounds.max.y, arch.max.y),
              Math.max(bounds.max.z, arch.max.z),
            ),
          }
        : {
            min: vec3(arch.min.x, arch.min.y, arch.min.z),
            max: vec3(arch.max.x, arch.max.y, arch.max.z),
          };
    }
    // Enquadrar o projeto inclui a superfície do terreno; enquadrar a seleção, não.
    if (project.terrain && !(viewRequest.selection && chosen.length > 0)) {
      const stats = terrainStats(project.terrain);
      const low = vec3(stats.minX, stats.minY, stats.minZ);
      const high = vec3(stats.maxX, stats.maxY, stats.maxZ);
      bounds = bounds
        ? {
            min: vec3(
              Math.min(bounds.min.x, low.x),
              Math.min(bounds.min.y, low.y),
              Math.min(bounds.min.z, low.z),
            ),
            max: vec3(
              Math.max(bounds.max.x, high.x),
              Math.max(bounds.max.y, high.y),
              Math.max(bounds.max.z, high.z),
            ),
          }
        : { min: low, max: high };
    }
    // Centro em coordenadas de desenho (a diferença é feita em precisão dupla).
    const drawOrigin = appliedOrigin.current;
    const center = bounds
      ? new Vector3(
          (bounds.min.x + bounds.max.x) / 2 - drawOrigin.x,
          (bounds.min.y + bounds.max.y) / 2 - drawOrigin.y,
          (bounds.min.z + bounds.max.z) / 2 - drawOrigin.z,
        )
      : new Vector3(-drawOrigin.x, -drawOrigin.y, -drawOrigin.z);
    const size = bounds ? distance(bounds.min, bounds.max) : 10;
    const radius = Math.max(size / 2, 0.5);

    const direction =
      viewRequest.preset === 'fit'
        ? camera.position.clone().sub(controls.target)
        : new Vector3(...VIEW_DIRECTIONS[viewRequest.preset]);
    if (direction.lengthSq() < 1e-9) direction.set(...VIEW_DIRECTIONS.iso);
    direction.normalize();

    // Meia altura que contém a esfera envolvente com folga, nas duas projeções.
    const aspect = Math.min(1, viewport.width / Math.max(viewport.height, 1));
    const halfHeight = isOrtho(camera)
      ? (radius * 1.2) / aspect
      : (radius / Math.sin(fovOf(camera) / 2)) * 1.15 * Math.tan(fovOf(camera) / 2);
    placeCamera(camera, controls, center, direction, halfHeight, viewport.height);
    rememberFocus(camera, controls);
  }, [viewRequest, camera, controls, viewport]);

  return null;
}
/** Último pedido de câmera salva já aplicado (o viewport é remontado ao trocar de vista). */
let appliedCameraNonce = -1;

/** Leva a câmera à posição salva na vista 3D aberta (ou enquadra, se ela ainda não tem câmera). */
function SavedViewCamera() {
  const request = useViewStore((s) => s.cameraRequest);
  const camera = useThree((s) => s.camera) as SceneCamera;
  const controls = useThree((s) => s.controls) as OrbitLike | null;
  const height = useThree((s) => s.size.height);
  useEffect(() => {
    if (!request || !controls || request.nonce === appliedCameraNonce) return;
    const store = useEditorStore.getState();
    const saved = request.camera;
    if (!saved) {
      appliedCameraNonce = request.nonce;
      store.requestView('fit');
      return;
    }
    const direction = new Vector3(saved.direction.x, saved.direction.y, saved.direction.z);
    direction.normalize();
    const orthographic = saved.projection === 'orthographic';
    if (orthographic !== isOrtho(camera)) {
      // Projeção diferente: a câmera é trocada e assume o ponto de interesse salvo; este
      // efeito roda de novo com a câmera nova e conclui o posicionamento.
      setViewFocus(
        { center: saved.target, halfHeight: saved.halfHeight },
        vec3(direction.x, direction.y, direction.z),
      );
      store.setOrthographic(orthographic);
      return;
    }
    appliedCameraNonce = request.nonce;
    const { x, y, z } = toRender(saved.target, store.renderOrigin);
    placeCamera(camera, controls, new Vector3(x, y, z), direction, saved.halfHeight, height);
    rememberFocus(camera, controls);
  }, [request, camera, controls, height]);
  return null;
}

/** Os seis planos da caixa de corte, nas coordenadas da cena (projeto − origem de desenho). */
function boxPlanes(planes: Plane[], box: SectionBox, origin: Vec3): void {
  const set = (index: number, nx: number, ny: number, nz: number, constant: number): void => {
    planes[index]?.normal.set(nx, ny, nz);
    const plane = planes[index];
    if (plane) plane.constant = constant;
  };
  set(0, 1, 0, 0, -(box.min.x - origin.x));
  set(1, -1, 0, 0, box.max.x - origin.x);
  set(2, 0, 1, 0, -(box.min.y - origin.y));
  set(3, 0, -1, 0, box.max.y - origin.y);
  set(4, 0, 0, 1, -(box.min.z - origin.z));
  set(5, 0, 0, -1, box.max.z - origin.z);
}

export function SceneContent() {
  const elementsRef = useRef<Group>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const gridStep = useEditorStore((s) => s.gridStep);
  // A grade acompanha a cota em que os pontos são criados (nível + elevação do eixo).
  const workPlaneZ = useEditorStore(drawElevationOf);
  const orthographic = useEditorStore((s) => s.orthographic);
  // Origem de renderização: todo o conteúdo do modelo é desenhado em relação a ela.
  const origin = useEditorStore((s) => s.renderOrigin);
  // Só o resto da divisão pelo passo da grade é aplicado: mantém as linhas da grade
  // sobre os mesmos pontos do modelo sem levar números grandes ao sombreador.
  const gridOffset = (value: number): number => {
    const section = gridStep * 10;
    return -(((value % section) + section) % section);
  };
  // O botão do meio também orbita: em Selecionar, o esquerdo abre a janela de seleção
  // (o InteractionController alterna LEFT a cada clique).
  const mouseButtons = useMemo(
    () => ({ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.ROTATE, RIGHT: MOUSE.PAN }),
    [],
  );

  // Vista 3D aberta: caixa de corte e estilo gráfico. Os planos são sempre os mesmos objetos,
  // atualizados no lugar — arrastar uma face não refaz os materiais dos elementos.
  const view3d = useOpenView3d();
  const gl = useThree((s) => s.gl);
  const [boxPreview, setBoxPreview] = useState<SectionBox | null>(null);
  const box = boxPreview ?? (view3d?.sectionBox?.enabled ? view3d.sectionBox : null);
  const planes = useMemo(() => Array.from({ length: 6 }, () => new Plane()), []);
  if (box) boxPlanes(planes, box, origin);
  const hiddenCategories = useMemo(
    () => (view3d ? new Set(view3d.visibility.hiddenCategories) : null),
    [view3d],
  );
  const clipped = box !== null;
  const wireframe = view3d?.display === 'wireframe';
  const display = useMemo<ModelDisplay>(
    () => ({ planes: clipped ? planes : null, wireframe }),
    [clipped, planes, wireframe],
  );
  useEffect(() => {
    gl.localClippingEnabled = true;
    setActiveClipPlanes(clipped ? planes : null);
    return () => setActiveClipPlanes(null);
  }, [gl, clipped, planes]);

  return (
    <>
      <SceneLighting />

      <Grid
        position={[gridOffset(origin.x), gridOffset(origin.y), workPlaneZ - origin.z]}
        rotation={[Math.PI / 2, 0, 0]}
        infiniteGrid
        cellSize={gridStep}
        sectionSize={gridStep * 10}
        cellColor="#d5dbe3"
        sectionColor="#aab4c1"
        cellThickness={0.6}
        sectionThickness={1.1}
        fadeDistance={gridStep * 400}
        fadeStrength={1.5}
        followCamera={false}
        side={2}
      />
      <axesHelper args={[1]} position={[-origin.x, -origin.y, workPlaneZ - origin.z]} />

      {orthographic && (
        <OrthographicCamera
          makeDefault
          up={[0, 0, 1]}
          position={[70, -90, 70]}
          zoom={60}
          near={0.01}
          far={5000}
        />
      )}
      {/* Conteúdo do modelo, em coordenadas do projeto, transladado para a origem de desenho. */}
      <group position={[-origin.x, -origin.y, -origin.z]}>
        <ModelDisplayContext.Provider value={display}>
          <TerrainSurface />
          <group ref={elementsRef}>
            <Elements hoveredId={hoveredId} />
            <ArchElements hiddenCategories={hiddenCategories} />
          </group>
        </ModelDisplayContext.Provider>
        {view3d && box && <SectionBox3D viewId={view3d.id} box={box} onPreview={setBoxPreview} />}
        <FreePortMarkers />
        <PipeGrips />
        <InlineGrips />
        <DrawingOverlay />
        <PreviewGhosts />
      </group>

      <OrbitControls
        makeDefault
        enableDamping={false}
        maxPolarAngle={Math.PI}
        // Cada passo da roda aproxima ~10 % (o padrão, 5 %, exige girar demais em redes longas).
        zoomSpeed={2}
        mouseButtons={mouseButtons}
      />
      <CameraRig />
      <SavedViewCamera />
      <InteractionController elementsRef={elementsRef} onHover={setHoveredId} />

      <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
        <GizmoViewport axisColors={['#e5484d', '#46a758', '#3e8fff']} labelColor="#0c1118" />
      </GizmoHelper>
    </>
  );
}
