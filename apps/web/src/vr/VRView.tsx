import {
  findIfcObject,
  VIEW_CATEGORIES,
  viewCategoryOf,
  type Project,
  type Vec3,
  type ViewCategory,
} from '@hydrobim/core';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ArrowLeft, CircleHelp, LogOut, RectangleGoggles, X } from 'lucide-react';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Raycaster,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type Group,
  type Intersection,
  type Object3D,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { NO_RENDER_ORIGIN, nextRenderOrigin } from '../editor/renderOrigin';
import { useEditorStore } from '../state/editorStore';
import { shownTerrain, useEarthworkStore } from '../terrain/earthworkStore';
import { useTerrainStore } from '../terrain/terrainStore';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { IfcModels } from '../ifc/IfcScene';
import { ifcBoundsOf, ifcSourceOf, useIfcStore } from '../ifc/ifcStore';
import { ArchElements } from '../viewport/ArchMeshes';
import { TerrainSurface } from '../viewport/TerrainSurface';
import { isWebGLAvailable } from '../viewport/Viewport';
import {
  feetOf,
  headingOf,
  placeAt,
  projectToXr,
  snapTurn,
  teleportPlacement,
  walkPlacement,
  xrToProject,
  type VrHead,
} from './vrCoordinates';
import { vrArchInfo, vrElementInfo, vrIfcInfo, vrProjectInfo, type VrInfo } from './vrInfo';
import { follow } from '../walk/walkMotion';
import {
  IDLE_HAND,
  moveVector,
  readPad,
  SNAP_TURN_ANGLE,
  stepHand,
  VR_WALK_SPEED,
  type HandState,
} from './vrInput';
import { buildVrModel } from './vrModel';
import {
  drawPanel,
  hitPanel,
  layoutPanel,
  PANEL_WIDTH_M,
  panelHeightM,
  type PanelButton,
  type PanelLayout,
  type PanelSpec,
} from './vrPanel';
import { FrameMeter, sessionQuality, VR_HEAVY_TRIANGLES } from './vrPerformance';
import { attachVrSession, ESTIMATED_EYE_HEIGHT, type XrManagerLike } from './vrSession';
import {
  checkVrSupport,
  closeVr,
  enterVr,
  exitVr,
  registerVrRenderer,
  toggleVrCategory,
  useVrStore,
} from './vrStore';
import {
  findTeleportTarget,
  supportAt,
  teleportArc,
  vrStartOf,
  walkSurfacesOf,
  type TeleportTarget,
} from './vrWalkable';

/**
 * Vista de realidade virtual (WebXR). Ocupa a área de desenho enquanto está aberta — o Modelo
 * 3D convencional é desmontado, de modo que há um só renderizador em uso — e mostra no monitor
 * uma prévia do ponto de partida. Com a sessão imersiva iniciada, o mesmo renderizador passa a
 * desenhar no headset, pelo laço de renderização da WebXR.
 *
 * É um modo de inspeção em leitura: teletransporte, giro por etapas, seleção com o raio do
 * controle e painel de propriedades. Nada aqui altera o projeto.
 */

const CATEGORY_LABELS: Record<ViewCategory, string> = {
  pipes: 'Tubos',
  fittings: 'Conexões',
  valves: 'Válvulas',
  equipment: 'Bombas',
  tanks: 'Reservatórios',
  walls: 'Paredes',
  floors: 'Pisos e lajes',
  doors: 'Portas',
  windows: 'Janelas',
  spaces: 'Ambientes',
  roofs: 'Telhados',
  ifcModels: 'Modelos IFC importados',
};

/** Altura da câmera da prévia no monitor (m): uma pessoa em pé. */
const PREVIEW_EYE = 1.6;
const PREVIEW_HEAD: VrHead = { x: 0, z: 0, forward: { x: 0, z: -1 } };
const LASER_REACH = 300;
const ARC_POINTS = 41;
const VALID_COLOR = '#35d07f';
const INVALID_COLOR = '#ff5a4f';
const LASER_COLOR = '#7fd8ef';

type VrSelection = { readonly kind: 'element' | 'arch' | 'ifc'; readonly id: string };

/** Dados do que foi apontado ou selecionado, lidos do projeto (e, no IFC importado, do arquivo). */
function infoOf(project: Project, selection: VrSelection): VrInfo | null {
  if (selection.kind === 'element') return vrElementInfo(project, selection.id);
  if (selection.kind === 'arch') return vrArchInfo(project, selection.id);
  const found = findIfcObject(project, selection.id);
  const source = found ? ifcSourceOf(found.model.source.sha256) : null;
  return vrIfcInfo(
    project,
    selection.id,
    (found && source?.objects.get(found.object.expressId)) ?? null,
  );
}

/** Painel flutuante: um plano com a textura desenhada em canvas. */
interface PanelObject {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  layout: PanelLayout | null;
  hovered: string | null;
  setSpec(spec: PanelSpec | null): void;
  setHovered(id: string | null): void;
  dispose(): void;
}

function createPanel(): PanelObject {
  const canvas = document.createElement('canvas');
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const material = new MeshBasicMaterial({ map: texture, toneMapped: false, side: DoubleSide });
  const mesh = new Mesh(new PlaneGeometry(1, 1), material);
  mesh.visible = false;
  mesh.renderOrder = 10;
  let spec: PanelSpec | null = null;
  let size = '';
  const panel: PanelObject = {
    mesh,
    layout: null,
    hovered: null,
    setSpec(next) {
      spec = next;
      if (!next) {
        panel.layout = null;
        mesh.visible = false;
        return;
      }
      const layout = layoutPanel(next);
      panel.layout = layout;
      // A textura já enviada tem tamanho fixo: mudou a altura, é recriada no próximo quadro.
      const nextSize = `${layout.width}x${layout.height}`;
      if (nextSize !== size) texture.dispose();
      size = nextSize;
      drawPanel(canvas, layout, panel.hovered);
      texture.needsUpdate = true;
      mesh.scale.set(PANEL_WIDTH_M, panelHeightM(layout), 1);
    },
    setHovered(id) {
      if (id === panel.hovered) return;
      panel.hovered = id;
      if (spec && panel.layout) {
        drawPanel(canvas, panel.layout, id);
        texture.needsUpdate = true;
      }
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
  return panel;
}

/** Raio, arco de teletransporte e ponteiro de um controle. */
interface HandRig {
  readonly controller: Object3D;
  readonly laser: Line<BufferGeometry, LineBasicMaterial>;
  readonly arc: Line<BufferGeometry, LineBasicMaterial>;
  readonly dot: Mesh<SphereGeometry, MeshBasicMaterial>;
  state: HandState;
  /** Gatilhos pressionados desde o último quadro. */
  selects: number;
  squeezes: number;
  dispose(): void;
}

function elementUnder(object: Object3D | null, key: 'archId' | 'ifcObjectId'): string | null {
  let current = object;
  while (current) {
    const id: unknown = current.userData[key];
    if (typeof id === 'string') return id;
    current = current.parent;
  }
  return null;
}

/** Fundo, luz do céu e ambiente para os metais (sem arquivos nem rede; sem sombras). */
function VrLighting() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const generator = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = generator.fromScene(room, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.5;
    room.dispose();
    generator.dispose();
    return () => {
      scene.environment = null;
      target.dispose();
    };
  }, [gl, scene]);
  return (
    <>
      <color attach="background" args={['#cfe0ef']} />
      {/* A WebXR usa Y para cima: a luz do céu vem de +Y. */}
      <hemisphereLight args={['#eaf2ff', '#8d8474', 0.9]} />
      <directionalLight position={[6, 12, 5]} intensity={1.6} />
    </>
  );
}

function VrScene() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const project = useEditorStore((s) => s.project);
  const surfaceView = useEarthworkStore((s) => s.view);
  const terrainShown = useTerrainStore((s) => s.display.show3d);
  const exaggeration = useTerrainStore((s) => s.display.exaggeration);
  const hiddenList = useVrStore((s) => s.hiddenCategories);
  const hidden = useMemo(() => new Set(hiddenList), [hiddenList]);
  const fps = useVrStore((s) => s.fps);

  const [menuOpen, setMenuOpen] = useState(false);
  const [projectInfo, setProjectInfo] = useState(false);
  /** Caminhada contínua pelo direcional esquerdo (o teletransporte continua na mão direita). */
  const [smoothMove, setSmoothMove] = useState(true);
  const [selection, setSelection] = useState<VrSelection | null>(null);
  /** Nível escolhido para o piso virtual; `null` = a cota de apoio do ponto de partida. */
  const [levelIndex, setLevelIndex] = useState<number | null>(null);

  const terrain = useMemo(
    () => (terrainShown ? shownTerrain(project, surfaceView) : null),
    [project, surfaceView, terrainShown],
  );
  // Modelos IFC importados à mostra: entram no ponto de partida e no "Recentrar". A envoltória
  // depende do arquivo-fonte, que carrega depois do projeto (a revisão muda quando ele chega).
  const ifcRevision = useIfcStore((s) => s.revision);
  const ifcBounds = useMemo(() => {
    const bounds = hidden.has('ifcModels')
      ? null
      : ifcBoundsOf(project, null, { visibleOnly: true });
    return bounds
      ? {
          min: { x: bounds[0], y: bounds[1], z: bounds[2] },
          max: { x: bounds[3], y: bounds[4], z: bounds[5] },
        }
      : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, hidden, ifcRevision]);
  const start = useMemo(
    () =>
      vrStartOf(project, {
        terrain,
        exaggeration,
        workPlaneZ: useEditorStore.getState().workPlaneZ,
        hiddenCategories: hidden,
        referenceBounds: ifcBounds,
      }),
    [project, terrain, exaggeration, hidden, ifcBounds],
  );
  const level = levelIndex === null ? undefined : project.levels[levelIndex];
  const virtualElevation = level?.elevation ?? start.virtualElevation;
  const surfaces = useMemo(
    () =>
      walkSurfacesOf(project, {
        terrain,
        exaggeration,
        hiddenCategories: hidden,
        virtualElevation,
      }),
    [project, terrain, exaggeration, hidden, virtualElevation],
  );
  const virtualFloor = surfaces[0]?.kind === 'virtual';

  // Origem local da cena: as posições chegam à placa de vídeo relativas a ela (precisão simples).
  const [origin, setOrigin] = useState<Vec3>(() => nextRenderOrigin(NO_RENDER_ORIGIN, start.feet));
  const model = useMemo(
    () => buildVrModel(project, { origin, cheapShadingAbove: VR_HEAVY_TRIANGLES }),
    [project, origin],
  );
  useEffect(() => () => model.dispose(), [model]);
  useEffect(() => model.setHiddenCategories(hidden), [model, hidden]);
  useEffect(
    () => model.highlight(selection?.kind === 'element' ? selection.id : null),
    [model, selection],
  );
  useEffect(() => {
    useVrStore.setState({ stats: model.stats });
  }, [model]);
  useEffect(() => {
    useVrStore.setState({ selected: selection?.id ?? null, menuOpen });
  }, [selection, menuOpen]);

  // Categorias com elementos no projeto: só elas aparecem no menu.
  const categories = useMemo(() => {
    const present = new Set<ViewCategory>(project.elements.map(viewCategoryOf));
    for (const element of project.architecture.elements) {
      if (element.kind === 'wall') present.add('walls');
      else if (element.kind === 'slab' || element.kind === 'flooring') present.add('floors');
      else if (element.kind === 'roof') present.add('roofs');
      else if (element.kind === 'door') present.add('doors');
      else if (element.kind === 'window') present.add('windows');
    }
    if (project.ifcModels.length > 0) present.add('ifcModels');
    return VIEW_CATEGORIES.filter((category) => present.has(category));
  }, [project]);

  const menuSpec = useMemo<PanelSpec | null>(() => {
    if (!menuOpen) return null;
    const info = projectInfo ? vrProjectInfo(project) : null;
    const rows = info ? [...info.rows] : [];
    if (info) {
      rows.push(['Triângulos', model.stats.triangles.toLocaleString('pt-BR')]);
      rows.push(['Chamadas de desenho', String(model.stats.batches)]);
      rows.push(['Quadros por segundo', fps === null ? 'medindo…' : String(Math.round(fps))]);
    }
    const buttons: PanelButton[] = [
      { id: 'home', label: 'Ponto inicial' },
      { id: 'recenter', label: 'Recentrar' },
      ...categories.map((category) => ({
        id: `category:${category}`,
        label: CATEGORY_LABELS[category],
        active: !hidden.has(category),
      })),
    ];
    if (project.terrain) buttons.push({ id: 'terrain', label: 'Terreno', active: terrainShown });
    if (virtualFloor && project.levels.length > 0) {
      buttons.push({
        id: 'level',
        label: `Piso virtual: ${level ? level.name : 'apoio do modelo'}`,
        wide: true,
      });
    }
    buttons.push({
      id: 'walk',
      label: 'Andar pelo direcional esquerdo',
      active: smoothMove,
      wide: true,
    });
    buttons.push({ id: 'info', label: 'Informações do projeto', active: projectInfo, wide: true });
    buttons.push({ id: 'exit', label: 'Sair do VR', wide: true, danger: true });
    return {
      title: info ? info.title : 'HydroBIM · menu',
      rows,
      note: info
        ? undefined
        : 'Esquerdo: andar. Direito: para a frente teletransporta, para os lados gira 30°. Gatilho: selecionar.',
      buttons,
    };
  }, [
    menuOpen,
    projectInfo,
    smoothMove,
    project,
    model,
    fps,
    categories,
    hidden,
    terrainShown,
    virtualFloor,
    level,
  ]);

  const infoSpec = useMemo<PanelSpec | null>(() => {
    if (!selection) return null;
    const info = infoOf(project, selection);
    if (!info) return null;
    return {
      title: info.title,
      rows: info.rows,
      buttons: [{ id: 'close-info', label: 'Fechar', wide: true }],
    };
  }, [project, selection]);

  const panels = useMemo(() => {
    const hover = createPanel();
    // O rótulo do elemento apontado fica sempre à vista e não é alvo do raio.
    hover.mesh.material.depthTest = false;
    hover.mesh.renderOrder = 12;
    hover.mesh.raycast = () => undefined;
    return { menu: createPanel(), info: createPanel(), hover };
  }, []);
  useEffect(
    () => () => {
      panels.menu.dispose();
      panels.info.dispose();
      panels.hover.dispose();
    },
    [panels],
  );
  useEffect(() => panels.menu.setSpec(menuSpec), [panels, menuSpec]);
  useEffect(() => panels.info.setSpec(infoSpec), [panels, infoSpec]);

  // Marcador do destino do teletransporte.
  const marker = useMemo(() => {
    const mesh = new Mesh(
      new RingGeometry(0.22, 0.3, 32),
      new MeshBasicMaterial({ color: VALID_COLOR, side: DoubleSide, depthTest: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 9;
    mesh.visible = false;
    return mesh;
  }, []);
  useEffect(
    () => () => {
      marker.geometry.dispose();
      marker.material.dispose();
    },
    [marker],
  );

  // Controles: o raio de cada um, o arco de teletransporte e o ponteiro.
  const hands = useMemo<HandRig[]>(
    () =>
      [0, 1].map((index) => {
        const controller = gl.xr.getController(index);
        const laser = new Line(
          new BufferGeometry().setFromPoints([new Vector3(0, 0, 0), new Vector3(0, 0, -1)]),
          new LineBasicMaterial({ color: LASER_COLOR }),
        );
        const grip = new Mesh(
          new BoxGeometry(0.03, 0.03, 0.1),
          new MeshBasicMaterial({ color: '#27384f' }),
        );
        grip.position.z = 0.05;
        const arcGeometry = new BufferGeometry();
        arcGeometry.setAttribute(
          'position',
          new BufferAttribute(new Float32Array(ARC_POINTS * 3), 3),
        );
        const arc = new Line(arcGeometry, new LineBasicMaterial({ color: VALID_COLOR }));
        arc.frustumCulled = false;
        arc.visible = false;
        const dot = new Mesh(
          new SphereGeometry(0.012, 12, 8),
          new MeshBasicMaterial({ color: '#ffffff', depthTest: false }),
        );
        dot.renderOrder = 11;
        dot.visible = false;
        controller.add(laser, grip);
        const hand: HandRig = {
          controller,
          laser,
          arc,
          dot,
          state: IDLE_HAND,
          selects: 0,
          squeezes: 0,
          dispose() {
            controller.remove(laser, grip);
            laser.geometry.dispose();
            laser.material.dispose();
            grip.geometry.dispose();
            grip.material.dispose();
            arc.geometry.dispose();
            arc.material.dispose();
            dot.geometry.dispose();
            dot.material.dispose();
          },
        };
        return hand;
      }),
    [gl],
  );
  useEffect(() => {
    const cleanups = hands.map((hand) => {
      const { controller } = hand;
      const onConnected = (event: { data?: unknown }): void => {
        controller.userData.source = event.data ?? null;
      };
      const onDisconnected = (): void => {
        controller.userData.source = null;
        hand.state = IDLE_HAND;
      };
      const onSelect = (): void => {
        hand.selects += 1;
      };
      const onSqueeze = (): void => {
        hand.squeezes += 1;
      };
      // Os eventos dos controles não fazem parte do mapa de eventos de `Object3D`.
      const target = controller as unknown as {
        addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
        removeEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
      };
      target.addEventListener('connected', onConnected);
      target.addEventListener('disconnected', onDisconnected);
      target.addEventListener('select', onSelect);
      target.addEventListener('squeeze', onSqueeze);
      scene.add(controller, hand.arc, hand.dot);
      return () => {
        target.removeEventListener('connected', onConnected);
        target.removeEventListener('disconnected', onDisconnected);
        target.removeEventListener('select', onSelect);
        target.removeEventListener('squeeze', onSqueeze);
        scene.remove(controller, hand.arc, hand.dot);
        hand.dispose();
      };
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [hands, scene]);

  // A sessão concedida pelo comando é ligada a este renderizador; desmontar a vista a encerra.
  const statsRef = useRef(model.stats);
  statsRef.current = model.stats;
  useEffect(
    () =>
      registerVrRenderer((session) =>
        attachVrSession(
          gl.xr as unknown as XrManagerLike,
          session,
          sessionQuality(statsRef.current, useVrStore.getState().lastFps),
        ),
      ),
    [gl],
  );

  const yawRef = useRef<Group>(null);
  const shiftRef = useRef<Group>(null);
  const archRef = useRef<Group>(null);
  const ifcRef = useRef<Group>(null);
  const gridRef = useRef<Group>(null);
  const runtime = useRef({
    placement: placeAt(start.feet, start.heading, PREVIEW_HEAD, 0),
    presenting: false,
    needsStart: true,
    headPosition: new Vector3(0, PREVIEW_EYE, 0),
    look: { yaw: 0, pitch: 0 },
    teleport: null as { hand: number; target: TeleportTarget; blocked: boolean } | null,
    meter: new FrameMeter(),
    readout: 1,
    hoverKey: null as string | null,
  });
  // Valores lidos dentro do laço de quadros, sempre os da renderização mais recente.
  const live = useRef({
    start,
    surfaces,
    model,
    origin,
    selection,
    virtualElevation,
    project,
    smoothMove,
  });
  live.current = {
    start,
    surfaces,
    model,
    origin,
    selection,
    virtualElevation,
    project,
    smoothMove,
  };

  // Piso virtual trocado de nível: o usuário vai para a nova cota, no mesmo ponto em planta.
  useEffect(() => {
    if (!virtualFloor) return;
    const run = runtime.current;
    run.placement = {
      ...run.placement,
      anchor: { ...run.placement.anchor, z: virtualElevation },
    };
  }, [virtualFloor, virtualElevation]);

  // Prévia no monitor: arrastar gira o olhar. Na sessão imersiva quem manda é o headset.
  useEffect(() => {
    const canvas = gl.domElement;
    let last: { x: number; y: number } | null = null;
    const onDown = (event: PointerEvent): void => {
      last = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent): void => {
      if (!last) return;
      const { look } = runtime.current;
      look.yaw -= (event.clientX - last.x) * 0.004;
      look.pitch = Math.min(1.4, Math.max(-1.4, look.pitch - (event.clientY - last.y) * 0.004));
      last = { x: event.clientX, y: event.clientY };
    };
    const onUp = (): void => {
      last = null;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, [gl]);

  const tools = useMemo(
    () => ({
      raycaster: new Raycaster(),
      origin: new Vector3(),
      direction: new Vector3(),
      forward: new Vector3(),
      quaternion: new Quaternion(),
      segment: new Vector3(),
      hoverPoint: new Vector3(),
    }),
    [],
  );

  /** Põe um painel diante do usuário, voltado para ele. */
  const placePanel = (panel: PanelObject, direction: Vector3, distance: number): void => {
    const { headPosition } = runtime.current;
    const flat = tools.segment.set(direction.x, 0, direction.z);
    if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1);
    flat.normalize();
    panel.mesh.position.copy(headPosition).addScaledVector(flat, distance);
    panel.mesh.position.y = headPosition.y - 0.12;
    panel.mesh.lookAt(headPosition.x, panel.mesh.position.y, headPosition.z);
    panel.mesh.visible = true;
  };

  const runButton = (id: string, head: VrHead): void => {
    const run = runtime.current;
    const { start: home } = live.current;
    if (id === 'home') {
      run.placement = placeAt(home.feet, home.heading, head, run.placement.floorY);
    } else if (id === 'recenter') {
      const feet = feetOf(run.placement, head);
      const heading = home.focus
        ? Math.atan2(home.focus.y - feet.y, home.focus.x - feet.x)
        : headingOf(run.placement, head);
      run.placement = placeAt(feet, heading, head, run.placement.floorY);
    } else if (id.startsWith('category:')) {
      toggleVrCategory(id.slice('category:'.length) as ViewCategory);
    } else if (id === 'terrain') {
      const terrainStore = useTerrainStore.getState();
      terrainStore.setDisplay({ show3d: !terrainStore.display.show3d });
    } else if (id === 'level') {
      const count = useEditorStore.getState().project.levels.length;
      setLevelIndex((current) =>
        current === null ? 0 : current + 1 >= count ? null : current + 1,
      );
    } else if (id === 'walk') {
      setSmoothMove((on) => !on);
    } else if (id === 'info') {
      setProjectInfo((shown) => !shown);
    } else if (id === 'close-info') {
      setSelection(null);
      useEditorStore.getState().select(null);
      useIfcStore.getState().select(null);
    } else if (id === 'exit') {
      void exitVr();
    }
  };

  useFrame((_, delta, frame) => {
    const run = runtime.current;
    const { raycaster } = tools;
    const presenting = gl.xr.isPresenting;
    if (presenting !== run.presenting) {
      run.presenting = presenting;
      run.needsStart = true;
      run.meter.reset();
      if (!presenting) {
        // De volta ao monitor: a projeção da câmera, trocada pela do headset, é refeita.
        camera.updateProjectionMatrix();
        run.teleport = null;
        marker.visible = false;
        for (const hand of hands) {
          hand.arc.visible = false;
          hand.dot.visible = false;
          hand.state = IDLE_HAND;
        }
        setMenuOpen(false);
        panels.hover.setSpec(null);
        run.hoverKey = null;
      }
    }

    let head = PREVIEW_HEAD;
    if (presenting) {
      const space = gl.xr.getReferenceSpace();
      const pose = frame && space ? frame.getViewerPose(space) : null;
      // Rastreamento perdido: o quadro mantém a cena como estava.
      if (!pose) return;
      const { position, orientation } = pose.transform;
      tools.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
      tools.forward.set(0, 0, -1).applyQuaternion(tools.quaternion);
      run.headPosition.set(position.x, position.y, position.z);
      head = { x: position.x, z: position.z, forward: { x: tools.forward.x, z: tools.forward.z } };
    } else {
      run.headPosition.set(0, PREVIEW_EYE, 0);
      camera.position.set(0, PREVIEW_EYE, 0);
      camera.rotation.set(run.look.pitch, run.look.yaw, 0, 'YXZ');
    }

    if (run.needsStart) {
      // Sem piso rastreado, a origem do espaço fica na cabeça: o piso é posto abaixo dela.
      const estimated = presenting && useVrStore.getState().floor === 'estimated';
      const { start: home } = live.current;
      run.placement = placeAt(home.feet, home.heading, head, estimated ? -ESTIMATED_EYE_HEIGHT : 0);
      run.needsStart = false;
    }

    if (presenting) {
      const { surfaces: walkable, model: current } = live.current;
      const pickTargets: Object3D[] = [current.root];
      if (archRef.current) pickTargets.push(archRef.current);
      if (ifcRef.current) pickTargets.push(ifcRef.current);
      const panelMeshes = [panels.menu.mesh, panels.info.mesh].filter((mesh) => mesh.visible);
      let menuHover: string | null = null;
      let infoHover: string | null = null;
      let aimingHand: number | null = null;
      let hovering = null as { pick: VrSelection; distance: number } | null;

      hands.forEach((hand, index) => {
        const { controller } = hand;
        const source = controller.userData.source as
          { gamepad?: Parameters<typeof readPad>[0]; handedness?: string } | null | undefined;
        if (!source || !controller.visible) {
          hand.arc.visible = false;
          hand.dot.visible = false;
          hand.selects = 0;
          hand.squeezes = 0;
          return;
        }
        const pad = readPad(source.gamepad);
        // Mão esquerda anda; a direita teletransporta e gira (como nos jogos do Quest).
        const mode = live.current.smoothMove && source.handedness === 'left' ? 'move' : 'steer';
        const step = pad ? stepHand(hand.state, pad, mode) : { state: hand.state, actions: [] };
        hand.state = step.state;
        if (pad && mode === 'move') {
          const move = moveVector(pad);
          if (move.ahead !== 0 || move.right !== 0) {
            const pace = VR_WALK_SPEED * Math.min(delta, 0.1);
            run.placement = walkPlacement(
              run.placement,
              head,
              move.ahead * pace,
              move.right * pace,
            );
          }
        }
        const actions = [...step.actions];
        // O aperto lateral também abre o menu (controles sem botões de face).
        if (hand.squeezes > 0) actions.push('menu');
        hand.squeezes = 0;

        // O controle é filho direto da cena: a posição local dele já é a do espaço de referência.
        tools.origin.copy(controller.position);
        tools.direction.set(0, 0, -1).applyQuaternion(controller.quaternion);

        for (const action of actions) {
          if (action === 'turnLeft' || action === 'turnRight') {
            run.placement = snapTurn(
              run.placement,
              head,
              action === 'turnRight' ? SNAP_TURN_ANGLE : -SNAP_TURN_ANGLE,
            );
          } else if (action === 'menu') {
            const opening = !panels.menu.mesh.visible;
            setMenuOpen(opening);
            if (opening) placePanel(panels.menu, tools.forward, 1.05);
            else panels.menu.mesh.visible = false;
          } else if (action === 'teleport') {
            const aimed = run.teleport;
            if (
              aimed?.hand === index &&
              aimed.target.valid &&
              !aimed.blocked &&
              aimed.target.point
            ) {
              run.placement = teleportPlacement(run.placement, aimed.target.point, head);
              // Longe da origem local, a cena é refeita em torno do novo ponto.
              const next = nextRenderOrigin(live.current.origin, run.placement.anchor);
              if (next !== live.current.origin) setOrigin(next);
            }
            run.teleport = null;
          } else if (action === 'cancelTeleport') {
            run.teleport = null;
          }
        }

        if (hand.state.aiming) {
          aimingHand = index;
          hand.laser.visible = false;
          hand.dot.visible = false;
          const arc = teleportArc(
            { x: tools.origin.x, y: tools.origin.y, z: tools.origin.z },
            { x: tools.direction.x, y: tools.direction.y, z: tools.direction.z },
          );
          const { placement } = run;
          const target = findTeleportTarget(
            arc.map((point) => xrToProject(placement, point)),
            walkable,
          );
          // Obstáculo: um elemento do modelo no caminho do arco, antes do ponto de chegada.
          let blocked = false;
          const last = target.point ? target.segment : arc.length - 2;
          for (let i = 0; i <= last && !blocked; i += 2) {
            const a = arc[i];
            const b = arc[Math.min(i + 2, last + 1)];
            if (!a || !b) continue;
            tools.segment.set(b.x - a.x, b.y - a.y, b.z - a.z);
            const length = tools.segment.length();
            if (length < 1e-6) continue;
            raycaster.set(tools.origin.set(a.x, a.y, a.z), tools.segment.divideScalar(length));
            raycaster.far = length;
            blocked = raycaster.intersectObjects(pickTargets, true).length > 0;
          }
          run.teleport = { hand: index, target, blocked };
          const ok = target.valid && !blocked;
          const positions = hand.arc.geometry.getAttribute('position') as BufferAttribute;
          const landing = target.point ? projectToXr(placement, target.point) : null;
          for (let i = 0; i < ARC_POINTS; i += 1) {
            const point = landing && i > target.segment ? landing : (arc[i] ?? landing);
            if (point) positions.setXYZ(i, point.x, point.y, point.z);
          }
          positions.needsUpdate = true;
          hand.arc.material.color.set(ok ? VALID_COLOR : INVALID_COLOR);
          hand.arc.visible = true;
          marker.visible = landing !== null;
          if (landing) {
            marker.position.set(landing.x, landing.y + 0.02, landing.z);
            marker.material.color.set(ok ? VALID_COLOR : INVALID_COLOR);
          }
          hand.selects = 0;
          return;
        }

        hand.arc.visible = false;
        hand.laser.visible = true;
        raycaster.set(tools.origin, tools.direction);
        raycaster.far = LASER_REACH;
        let reach = 4;
        let button: PanelButton | null = null;
        let picked: VrSelection | null = null;
        let hit: Intersection | undefined = raycaster.intersectObjects(panelMeshes, false)[0];
        if (hit) {
          const panel = hit.object === panels.menu.mesh ? panels.menu : panels.info;
          if (hit.uv && panel.layout) button = hitPanel(panel.layout, hit.uv.x, hit.uv.y);
          if (button && panel === panels.menu) menuHover = button.id;
          if (button && panel === panels.info) infoHover = button.id;
        } else {
          hit = raycaster.intersectObjects(pickTargets, true)[0];
          if (hit) {
            const elementId = current.elementIdOf(hit);
            const archId = elementId ? null : elementUnder(hit.object, 'archId');
            const ifcId = elementId || archId ? null : elementUnder(hit.object, 'ifcObjectId');
            if (elementId) picked = { kind: 'element', id: elementId };
            else if (archId) picked = { kind: 'arch', id: archId };
            else if (ifcId) picked = { kind: 'ifc', id: ifcId };
          }
        }
        if (hit) {
          reach = hit.distance;
          hand.dot.position.copy(hit.point);
        }
        if (picked && hit && !hovering) {
          hovering = { pick: picked, distance: hit.distance };
          tools.hoverPoint.copy(hit.point);
        }
        hand.dot.visible = hit !== undefined;
        hand.laser.scale.z = reach;

        if (hand.selects > 0) {
          hand.selects = 0;
          if (button) runButton(button.id, head);
          else if (picked) {
            setSelection(picked);
            // O mesmo objeto fica selecionado no editor (realce e painel de propriedades).
            if (picked.kind === 'element') useEditorStore.getState().select(picked.id);
            else if (picked.kind === 'ifc') useIfcStore.getState().select(picked.id);
            placePanel(panels.info, tools.direction, 0.9);
          } else if (!hit && live.current.selection) {
            setSelection(null);
            useEditorStore.getState().select(null);
            useIfcStore.getState().select(null);
          }
        }
      });

      if (aimingHand === null) marker.visible = false;
      const aimed = run.teleport;
      const aim =
        aimingHand === null || !aimed
          ? null
          : aimed.blocked
            ? 'blocked'
            : aimed.target.valid
              ? 'valid'
              : 'invalid';
      if (aim !== useVrStore.getState().aim) useVrStore.setState({ aim });
      panels.menu.setHovered(menuHover);
      panels.info.setHovered(infoHover);

      // Rótulo do elemento sob o raio: nome e categoria, antes do clique. O que já está com o
      // painel de propriedades aberto não repete o rótulo.
      const shown = live.current.selection;
      const label =
        hovering && !(shown?.kind === hovering.pick.kind && shown.id === hovering.pick.id)
          ? hovering
          : null;
      const labelKey = label ? `${label.pick.kind}:${label.pick.id}` : null;
      if (labelKey !== run.hoverKey) {
        run.hoverKey = labelKey;
        const info = label ? infoOf(live.current.project, label.pick) : null;
        panels.hover.setSpec(
          info
            ? {
                title: info.title,
                rows: info.rows.filter(([name]) => name === 'Categoria' || name === 'Diâmetro'),
                note: 'Gatilho: ver as propriedades',
              }
            : null,
        );
        useVrStore.setState({ hovered: label?.pick.id ?? null });
      }
      if (label && panels.hover.layout) {
        // O rótulo cresce com a distância: ocupa sempre cerca de 25° do campo de visão, com o
        // nome a mais de 1° de altura — legível junto de peças próximas ou afastadas.
        const size = Math.min(10, Math.max(0.5, label.distance / 1.4));
        const height = panelHeightM(panels.hover.layout) * size;
        panels.hover.mesh.scale.set(PANEL_WIDTH_M * size, height, 1);
        panels.hover.mesh.position.copy(tools.hoverPoint);
        panels.hover.mesh.position.y += height / 2 + 0.08 * size;
        panels.hover.mesh.lookAt(run.headPosition);
        panels.hover.mesh.visible = true;
      }

      // Apoio: andando pelo direcional ou fisicamente, os pés acompanham o piso sob o usuário
      // (com um degrau de até 0,6 m). Fora de qualquer piso vale a última cota.
      const feet = feetOf(run.placement, head);
      const support = supportAt(walkable, feet.x, feet.y, feet.z + 0.3);
      if (support !== null && Math.abs(support - feet.z) > 1e-4) {
        const { anchor } = run.placement;
        run.placement = {
          ...run.placement,
          anchor: { ...anchor, z: follow(anchor.z, support, Math.min(delta, 0.1)) },
        };
      }
      // Caminhando para longe da origem local, a cena é refeita em torno do usuário.
      const rebased = nextRenderOrigin(live.current.origin, run.placement.anchor);
      if (rebased !== live.current.origin) setOrigin(rebased);

      const measured = run.meter.tick(delta);
      if (measured !== null) useVrStore.setState({ fps: measured });
    }

    // A cena é posta em volta do usuário: giro, eixo vertical e âncora, nessa ordem.
    const { placement } = run;
    run.readout += delta;
    if (run.readout > 0.2) {
      run.readout = 0;
      useVrStore.setState({ position: feetOf(placement, head) });
    }
    const yaw = yawRef.current;
    if (yaw) {
      yaw.rotation.y = placement.yaw;
      yaw.position.y = placement.floorY;
    }
    shiftRef.current?.position.set(-placement.anchor.x, -placement.anchor.y, -placement.anchor.z);
    // A grade do piso virtual acompanha o usuário, com as linhas em múltiplos fixos de 10 m.
    gridRef.current?.position.set(
      Math.round(placement.anchor.x / 10) * 10,
      Math.round(placement.anchor.y / 10) * 10,
      live.current.virtualElevation,
    );
  });

  return (
    <>
      <VrLighting />
      <group ref={yawRef}>
        {/* Z para cima (projeto) → Y para cima (WebXR): (X, Y, Z) → (X, Z, −Y). */}
        <group rotation={[-Math.PI / 2, 0, 0]}>
          <group ref={shiftRef}>
            <group position={[origin.x, origin.y, origin.z]}>
              <primitive object={model.root} />
            </group>
            <TerrainSurface />
            <group ref={archRef}>
              <ArchElements hiddenCategories={hidden} />
            </group>
            {/* Modelos IFC importados: as malhas lidas do arquivo, como no Modelo 3D. */}
            <group ref={ifcRef}>
              <IfcModels hiddenCategories={hidden} />
            </group>
            {virtualFloor && (
              <group ref={gridRef}>
                <gridHelper
                  args={[200, 200, '#7d8ea3', '#aab8c8']}
                  rotation={[Math.PI / 2, 0, 0]}
                  raycast={() => null}
                />
              </group>
            )}
          </group>
        </group>
      </group>
      <primitive object={panels.menu.mesh} />
      <primitive object={panels.info.mesh} />
      <primitive object={panels.hover.mesh} />
      <primitive object={marker} />
    </>
  );
}

const CONTROLS: readonly (readonly [string, string])[] = [
  ['Andar com o headset', 'o modelo fica parado: caminhe pela sala'],
  ['Direcional esquerdo', 'anda na direção do olhar (pode ser desligado no menu)'],
  ['Direcional direito para a frente', 'mira o teletransporte; soltar confirma'],
  ['Direcional direito para os lados', 'gira 30°'],
  ['Apontar para um elemento', 'mostra o nome e a categoria'],
  ['Gatilho', 'seleciona o elemento apontado ou aciona um botão'],
  ['A / B / X / Y ou aperto lateral', 'abre e fecha o menu'],
];

export function VRView() {
  const webgl = useMemo(isWebGLAvailable, []);
  const support = useVrStore((s) => s.support);
  const phase = useVrStore((s) => s.phase);
  const message = useVrStore((s) => s.message);
  const floor = useVrStore((s) => s.floor);
  const stats = useVrStore((s) => s.stats);
  const fps = useVrStore((s) => s.fps);
  const lastFps = useVrStore((s) => s.lastFps);
  const position = useVrStore((s) => s.position);
  const selected = useVrStore((s) => s.selected);
  const hovered = useVrStore((s) => s.hovered);
  const menuOpen = useVrStore((s) => s.menuOpen);
  const aim = useVrStore((s) => s.aim);
  /** Quadro de ajuda sobre a prévia: só existe no monitor (o headset mostra apenas a cena). */
  const [helpOpen, setHelpOpen] = useState(true);

  useEffect(() => {
    void checkVrSupport();
  }, []);

  const presenting = phase === 'presenting';
  const unsupported = support?.state === 'unsupported';
  const status = presenting
    ? `Sessão imersiva em andamento${floor === 'estimated' ? ' · piso estimado (o dispositivo não informou o piso)' : ''}`
    : phase === 'requesting'
      ? 'Iniciando a sessão…'
      : support === null
        ? 'Verificando a compatibilidade do navegador…'
        : unsupported
          ? 'Realidade virtual indisponível neste navegador'
          : 'Pronto: coloque o headset e escolha "Entrar em VR"';
  const notice = message ?? (unsupported ? support.message : null);

  return (
    <div
      className="vr"
      data-testid="vr-view"
      data-phase={phase}
      data-support={support?.state ?? 'unknown'}
      data-x={position?.x.toFixed(3)}
      data-y={position?.y.toFixed(3)}
      data-z={position?.z.toFixed(3)}
      data-selected={selected ?? ''}
      data-hovered={hovered ?? ''}
      data-menu={menuOpen ? 'open' : 'closed'}
      data-aim={aim ?? ''}
    >
      <header className="vr__bar">
        <strong className="vr__title">
          <RectangleGoggles size={16} aria-hidden /> Realidade virtual
        </strong>
        <span className="vr__status" data-testid="vr-status">
          {status}
        </span>
        {presenting ? (
          <button
            type="button"
            className="vr__button"
            data-testid="vr-end-session"
            onClick={() => void exitVr()}
          >
            <LogOut size={15} aria-hidden /> Encerrar a sessão
          </button>
        ) : (
          <button
            type="button"
            className="vr__button vr__button--primary"
            data-testid="vr-enter"
            disabled={!webgl || unsupported || phase === 'requesting'}
            title={
              unsupported
                ? support.message
                : 'Inicia a sessão imersiva no headset (exige um navegador com WebXR)'
            }
            onClick={() => void enterVr()}
          >
            <RectangleGoggles size={15} aria-hidden /> Entrar em VR
          </button>
        )}
        <button
          type="button"
          className={helpOpen ? 'vr__button is-active' : 'vr__button'}
          data-testid="vr-help-toggle"
          aria-pressed={helpOpen}
          title="Mostra ou oculta o quadro com os controles e os números da cena"
          onClick={() => setHelpOpen((open) => !open)}
        >
          <CircleHelp size={15} aria-hidden /> Ajuda
        </button>
        <button
          type="button"
          className="vr__button"
          data-testid="vr-close"
          title="Encerra a sessão, se houver, e volta à área de desenho"
          onClick={() => void closeVr()}
        >
          <ArrowLeft size={15} aria-hidden /> Voltar ao editor
        </button>
      </header>
      <div className="vr__stage">
        {webgl ? (
          <ErrorBoundary
            title="Falha ao preparar a cena de realidade virtual"
            hint="O modelo não foi perdido. Volte ao editor ou recarregue a página."
          >
            <Suspense fallback={<div className="viewport-fallback">Preparando a cena…</div>}>
              <Canvas
                data-testid="vr-canvas"
                // `rotation` informada: a câmera não é apontada para a origem ao ser criada.
                camera={{
                  position: [0, PREVIEW_EYE, 0],
                  rotation: [0, 0, 0],
                  fov: 70,
                  near: 0.05,
                  far: 8000,
                }}
                gl={{ antialias: true }}
                dpr={[1, 1.5]}
              >
                <VrScene />
              </Canvas>
            </Suspense>
          </ErrorBoundary>
        ) : (
          <div className="viewport-fallback" role="alert">
            <strong>WebGL indisponível.</strong>
            <span>A realidade virtual exige um navegador com WebGL habilitado.</span>
          </div>
        )}
        {notice && (
          <div className="vr__notice" role="alert" data-testid="vr-message">
            {notice}
          </div>
        )}
        {helpOpen ? (
          <aside className="vr__help" data-testid="vr-help">
            <button
              type="button"
              className="vr__help-close"
              data-testid="vr-help-close"
              aria-label="Ocultar a ajuda"
              title="Ocultar a ajuda (o botão Ajuda, na barra, mostra de novo)"
              onClick={() => setHelpOpen(false)}
            >
              <X size={14} aria-hidden />
            </button>
            <strong>{presenting ? 'Espelho da sessão' : 'Prévia do ponto de partida'}</strong>
            <span>
              {presenting ? '' : 'Arraste para olhar em volta. '}Escala real: 1 m do modelo = 1 m.
            </span>
            {CONTROLS.map(([control, action]) => (
              <span key={control}>
                <b>{control}</b>: {action}
              </span>
            ))}
            {stats && (
              <span
                data-testid="vr-stats"
                data-elements={stats.elements}
                data-batches={stats.batches}
              >
                {stats.elements} elementos · {stats.triangles.toLocaleString('pt-BR')} triângulos ·{' '}
                {stats.batches} chamadas de desenho
              </span>
            )}
            {(fps ?? lastFps) !== null && (
              <span data-testid="vr-fps">
                {presenting ? 'Agora' : 'Última sessão'}: {Math.round(fps ?? lastFps ?? 0)}{' '}
                quadros/s
              </span>
            )}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
