import { computeBounds, formatMeters, terrainStats, vec3, type Vec3 } from '@hydrobim/core';
import { Grid } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Lock, LockOpen } from 'lucide-react';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackSide,
  Color,
  Mesh,
  PMREMGenerator,
  Raycaster,
  Vector2,
  Vector3,
  type DirectionalLight,
  type Group,
  type Object3D,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { visibleElementsOf } from '../editor/visibility';
import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { useTerrainStore } from '../terrain/terrainStore';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { Elements } from '../viewport/SceneContent';
import { TerrainSurface } from '../viewport/TerrainSurface';
import { isWebGLAvailable } from '../viewport/Viewport';
import {
  adjustSpeed,
  EYE_HEIGHT,
  follow,
  groundAt,
  initialPose,
  LOOK_SENSITIVITY,
  lookDirection,
  pitchToward,
  POINTER_LOCK_KEY,
  stepWalk,
  turn,
  WALK_SPEED,
  walkActionOf,
  type WalkAction,
  type WalkPose,
} from './walkMotion';
import { useWalkStore } from './walkStore';

/**
 * Percurso em primeira pessoa da aba BIM / IFC: o observador anda pelo modelo (W A S D), sobe e
 * desce a vista (E / Q) e, havendo superfície de terreno, caminha sobre ela na cota dela. Um
 * clique em um elemento o seleciona — o painel à direita mostra as suas propriedades IFC.
 *
 * É uma vista de consulta: não modela, não altera o projeto e não entra no histórico. O céu, o
 * sol e as sombras são apresentação; a geometria é a mesma do Modelo 3D.
 */

const CLICK_TOLERANCE_PX = 5;
/** Além desta distância da origem de desenho, a origem é trazida para junto do observador. */
const REBASE_DISTANCE = 1500;
/** Direção de onde vem o sol (unitária, Z para cima): manhã alta, a sudeste. */
const SUN = new Vector3(0.48, -0.36, 0.8).normalize();
const SKY_RADIUS = 5000;
/** Meia largura da região coberta pelo mapa de sombras, em torno do observador (m). */
const SHADOW_RANGE = 60;
const GRID_SECTION = 10;

/** Estado do percurso que muda a cada quadro: fica fora do React. */
interface WalkRuntime {
  pose: WalkPose;
  /** Cota (de desenho) do apoio sob o observador e a cota suavizada dos pés. */
  reference: number;
  feet: number;
  /** Cota real do terreno sob o observador; `null` fora da superfície. */
  groundElevation: number | null;
  /** Origem de desenho: a cena é transladada para que a câmera fique perto de zero. */
  origin: Vec3;
  speed: number;
  readonly keys: Set<WalkAction>;
}

/** Ponto de partida: diante da seleção (ou do modelo, ou no meio do terreno), olhando para ele. */
function startWalk(): WalkRuntime {
  const { project, selection, workPlaneZ } = useEditorStore.getState();
  const { show3d, exaggeration } = useTerrainStore.getState().display;
  const surface = show3d ? project.terrain : null;
  const visible = visibleElementsOf(project);
  const chosen = visible.filter((element) => selection.includes(element.id));
  const bounds = computeBounds(chosen.length > 0 ? chosen : visible);

  let pose = initialPose(bounds);
  let target: Vec3 | null = null;
  let fallback = workPlaneZ;
  if (bounds) {
    target = vec3(
      (bounds.min.x + bounds.max.x) / 2,
      (bounds.min.y + bounds.max.y) / 2,
      (bounds.min.z + bounds.max.z) / 2,
    );
    // Sem terreno sob o observador, o apoio é o plano de trabalho — desde que ele esteja junto
    // do modelo; senão, a cota mais baixa do que se vai ver.
    if (workPlaneZ < bounds.min.z - 5 || workPlaneZ > bounds.max.z + 5) fallback = bounds.min.z;
  } else if (surface) {
    const stats = terrainStats(surface);
    const center = vec3((stats.minX + stats.maxX) / 2, (stats.minY + stats.maxY) / 2, 0);
    // Sem modelo, parte do meio do terreno, olhando um pouco para o chão. O pequeno desvio
    // evita ficar exatamente sobre um ponto do levantamento com o olhar na horizontal: um
    // vértice no plano do olho degenera a projeção dos triângulos que o tocam.
    pose = {
      ...initialPose({ min: center, max: center }),
      x: center.x + 0.37,
      y: center.y + 0.23,
      pitch: -0.05,
    };
  }
  const ground =
    groundAt(surface, pose.x, pose.y, exaggeration) ??
    (target ? groundAt(surface, target.x, target.y, exaggeration) : null);
  const reference = ground?.drawn ?? fallback;
  if (target) {
    const eye = { x: pose.x, y: pose.y, z: reference + pose.eyeHeight };
    pose = { ...pose, pitch: pitchToward(eye, target) };
  }
  return {
    pose,
    reference,
    feet: reference,
    groundElevation: null,
    origin: vec3(pose.x, pose.y, reference),
    speed: WALK_SPEED,
    keys: new Set(),
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

function isTerrainPart(object: Object3D): boolean {
  let current: Object3D | null = object;
  while (current) {
    if (current.userData.terrain === true) return true;
    current = current.parent;
  }
  return false;
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable);

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Céu em degradê (Z para cima) com o disco e o halo do sol. As cores chegam em espaço linear;
// a conversão para a saída é a do renderizador.
const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 horizon;
  uniform vec3 haze;
  uniform vec3 sunColor;
  uniform vec3 sunDirection;
  varying vec3 vDirection;
  void main() {
    vec3 direction = normalize(vDirection);
    float height = direction.z;
    vec3 sky = mix(horizon, zenith, pow(clamp(height, 0.0, 1.0), 0.55));
    // Abaixo do horizonte: bruma que escurece, para a vista não parecer flutuar no céu.
    vec3 color = height >= 0.0 ? sky : mix(horizon, haze, clamp(-height * 4.0, 0.0, 1.0));
    float toSun = max(dot(direction, sunDirection), 0.0);
    color += sunColor * (pow(toSun, 900.0) * 3.0 + pow(toSun, 24.0) * 0.22);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Céu, sol com sombras e ambiente para os metais (sem arquivos nem rede). */
function WalkLighting({
  skyRef,
  sunRef,
}: {
  skyRef: React.RefObject<Mesh | null>;
  sunRef: React.RefObject<DirectionalLight | null>;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  // Os metais só parecem metal com algo para refletir (ver `SceneLighting`).
  useEffect(() => {
    const generator = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = generator.fromScene(room, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.45;
    room.dispose();
    generator.dispose();
    return () => {
      scene.environment = null;
      target.dispose();
    };
  }, [gl, scene]);

  const uniforms = useMemo(
    () => ({
      zenith: { value: new Color('#2f6fd0') },
      horizon: { value: new Color('#c9def2') },
      haze: { value: new Color('#8c979f') },
      sunColor: { value: new Color('#fff1d6') },
      sunDirection: { value: SUN.clone() },
    }),
    [],
  );

  return (
    <>
      <mesh ref={skyRef} frustumCulled={false} renderOrder={-1} raycast={() => null}>
        <sphereGeometry args={[SKY_RADIUS, 32, 16]} />
        <shaderMaterial
          vertexShader={SKY_VERTEX}
          fragmentShader={SKY_FRAGMENT}
          uniforms={uniforms}
          side={BackSide}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </mesh>
      <fog attach="fog" args={['#c9def2', 400, 9000]} />
      {/* A luz do céu vem de cima: com Z para cima, a posição define esse eixo. */}
      <hemisphereLight args={['#dfeaff', '#8d8474', 0.85]} position={[0, 0, 1]} />
      <directionalLight
        ref={sunRef}
        color="#fff3dd"
        intensity={2.4}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
      >
        <orthographicCamera
          attach="shadow-camera"
          args={[-SHADOW_RANGE, SHADOW_RANGE, SHADOW_RANGE, -SHADOW_RANGE, 1, 500]}
        />
      </directionalLight>
    </>
  );
}

function WalkScene() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const terrain = useEditorStore((s) => s.project.terrain);
  const terrainShown = useTerrainStore((s) => s.display.show3d);
  const exaggeration = useTerrainStore((s) => s.display.exaggeration);
  const surface = terrainShown ? terrain : null;

  const contentRef = useRef<Group>(null);
  const elementsRef = useRef<Group>(null);
  const floorRef = useRef<Group>(null);
  const skyRef = useRef<Mesh>(null);
  const sunRef = useRef<DirectionalLight>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const runtime = useRef<WalkRuntime | null>(null);
  runtime.current ??= startWalk();
  /** Cursor em coordenadas normalizadas; `null` fora da vista. Com o mouse travado, vale a mira. */
  const pointer = useRef<Vector2 | null>(null);
  const clocks = useRef({ readout: 0, hover: 0, shadows: 0 });
  const raycaster = useMemo(() => new Raycaster(), []);

  useEffect(() => {
    const canvas = gl.domElement;
    const run = runtime.current;
    if (!run) return;
    let drag: { x: number; y: number; moved: number; button: number } | null = null;
    const isLocked = (): boolean => document.pointerLockElement === canvas;

    const look = (dx: number, dy: number): void => {
      run.pose = turn(run.pose, -dx * LOOK_SENSITIVITY, -dy * LOOK_SENSITIVITY);
    };

    const pick = (ndc: Vector2, additive: boolean): void => {
      const group = elementsRef.current;
      if (!group) return;
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObject(group, true)[0];
      useEditorStore.getState().select(hit ? elementIdOf(hit.object) : null, additive);
    };

    const ndcOf = (event: MouseEvent): Vector2 => {
      const rect = canvas.getBoundingClientRect();
      return new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };

    const toggleLock = (): void => {
      if (isLocked()) {
        document.exitPointerLock();
        return;
      }
      try {
        // Navegadores recusam o travamento sem um gesto do usuário: a vista segue pelo arrasto.
        void Promise.resolve(canvas.requestPointerLock()).catch(() => undefined);
      } catch {
        // Sem suporte a travar o mouse.
      }
    };
    useWalkStore.setState({ toggleLock });

    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTyping(event.target) || useUiStore.getState().dialog !== null) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() === POINTER_LOCK_KEY) {
        if (!event.repeat) toggleLock();
        return;
      }
      const action = walkActionOf(event.key);
      if (!action) return;
      // As setas não rolam a página nem os painéis enquanto giram o olhar.
      if (action !== 'run') event.preventDefault();
      run.keys.add(action);
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      const action = walkActionOf(event.key);
      if (action) run.keys.delete(action);
    };
    // Tecla solta fora da janela não chega aqui: sem isso o observador seguiria andando.
    const release = (): void => run.keys.clear();

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 && event.button !== 2) return;
      drag = { x: event.clientX, y: event.clientY, moved: 0, button: event.button };
      if (!isLocked()) canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (isLocked()) {
        look(event.movementX, event.movementY);
        return;
      }
      if (drag) {
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        drag = {
          ...drag,
          x: event.clientX,
          y: event.clientY,
          moved: drag.moved + Math.abs(dx) + Math.abs(dy),
        };
        look(dx, dy);
        return;
      }
      pointer.current = ndcOf(event);
    };
    const onPointerUp = (event: PointerEvent): void => {
      const started = drag;
      drag = null;
      if (!started || started.button !== 0 || started.moved > CLICK_TOLERANCE_PX) return;
      const additive = event.ctrlKey || event.metaKey;
      pick(isLocked() ? new Vector2(0, 0) : ndcOf(event), additive);
    };
    const onPointerLeave = (): void => {
      pointer.current = null;
    };
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      run.speed = adjustSpeed(run.speed, event.deltaY);
    };
    const onContextMenu = (event: MouseEvent): void => event.preventDefault();
    const onLockChange = (): void => {
      useWalkStore.setState({ locked: isLocked() });
      if (!isLocked()) drag = null;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', release);
    document.addEventListener('pointerlockchange', onLockChange);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    return () => {
      if (isLocked()) document.exitPointerLock();
      useWalkStore.setState({ toggleLock: null, locked: false });
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
      document.removeEventListener('pointerlockchange', onLockChange);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }, [gl, camera, raycaster]);

  useFrame((_, delta) => {
    const run = runtime.current;
    if (!run) return;
    // Quadro atrasado (aba em segundo plano): o passo é limitado para o observador não saltar.
    const dt = Math.min(delta, 0.1);
    run.pose = stepWalk(run.pose, run.keys, dt, run.speed);

    // Fora da superfície (ou sem terreno) vale a última cota de apoio: não há queda.
    const ground = groundAt(surface, run.pose.x, run.pose.y, exaggeration);
    if (ground) run.reference = ground.drawn;
    run.groundElevation = ground?.elevation ?? null;
    run.feet = follow(run.feet, run.reference, dt);

    const { pose } = run;
    if (Math.hypot(pose.x - run.origin.x, pose.y - run.origin.y) > REBASE_DISTANCE) {
      run.origin = vec3(pose.x, pose.y, run.feet);
    }
    const { origin } = run;
    contentRef.current?.position.set(-origin.x, -origin.y, -origin.z);
    camera.position.set(pose.x - origin.x, pose.y - origin.y, run.feet + pose.eyeHeight - origin.z);
    const direction = lookDirection(pose.yaw, pose.pitch);
    camera.up.set(0, 0, 1);
    camera.lookAt(
      camera.position.x + direction.x,
      camera.position.y + direction.y,
      camera.position.z + direction.z,
    );

    skyRef.current?.position.copy(camera.position);
    const sun = sunRef.current;
    if (sun) {
      // As sombras acompanham o observador: o mapa cobre só a vizinhança dele.
      sun.position.copy(camera.position).addScaledVector(SUN, 200);
      sun.target.position.copy(camera.position);
      sun.target.updateMatrixWorld();
    }
    // Sem terreno: a grade e o plano que recebe as sombras ficam na cota de apoio, com as
    // linhas sobre múltiplos fixos das coordenadas do projeto.
    floorRef.current?.position.set(
      Math.round(pose.x / GRID_SECTION) * GRID_SECTION - origin.x,
      Math.round(pose.y / GRID_SECTION) * GRID_SECTION - origin.y,
      run.reference - origin.z,
    );

    const clock = clocks.current;
    clock.readout += delta;
    clock.hover += delta;
    clock.shadows += delta;
    if (clock.shadows > 0.5) {
      clock.shadows = 0;
      // As malhas são recriadas quando um elemento muda; o terreno só recebe sombra.
      contentRef.current?.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.receiveShadow = true;
        object.castShadow = !isTerrainPart(object);
      });
    }
    if (clock.hover > 0.08) {
      clock.hover = 0;
      const locked = document.pointerLockElement === gl.domElement;
      const ndc = locked ? new Vector2(0, 0) : pointer.current;
      const group = elementsRef.current;
      let id: string | null = null;
      if (ndc && group) {
        raycaster.setFromCamera(ndc, camera);
        const hit = raycaster.intersectObject(group, true)[0];
        id = hit ? elementIdOf(hit.object) : null;
      }
      setHoveredId((previous) => (previous === id ? previous : id));
    }
    if (clock.readout > 0.12) {
      clock.readout = 0;
      useWalkStore.setState({
        readout: {
          x: pose.x,
          y: pose.y,
          groundElevation: run.groundElevation,
          referenceElevation: run.reference,
          eyeHeight: pose.eyeHeight,
          speed: run.speed,
        },
      });
    }
  });

  return (
    <>
      <WalkLighting skyRef={skyRef} sunRef={sunRef} />
      <group ref={contentRef}>
        <TerrainSurface />
        <group ref={elementsRef}>
          <Elements hoveredId={hoveredId} />
        </group>
      </group>
      {!surface && (
        <group ref={floorRef}>
          <Grid
            rotation={[Math.PI / 2, 0, 0]}
            args={[400, 400]}
            cellSize={1}
            sectionSize={GRID_SECTION}
            cellColor="#b9c4d0"
            sectionColor="#8d9aaa"
            cellThickness={0.6}
            sectionThickness={1.1}
            fadeDistance={160}
            fadeStrength={1.5}
            followCamera={false}
            side={2}
          />
          <mesh receiveShadow position={[0, 0, 0.002]} raycast={() => null}>
            <planeGeometry args={[400, 400]} />
            <shadowMaterial transparent opacity={0.3} />
          </mesh>
        </group>
      )}
    </>
  );
}

const KEYS: readonly (readonly [string, string])[] = [
  ['W', 'frente'],
  ['S', 'trás'],
  ['A', 'esquerda'],
  ['D', 'direita'],
  ['E', 'sobe a vista'],
  ['Q', 'desce a vista'],
  ['Shift', 'corre'],
];

/** Leitura e instruções sobre a vista. */
function WalkHud() {
  const readout = useWalkStore((s) => s.readout);
  const locked = useWalkStore((s) => s.locked);
  const toggleLock = useWalkStore((s) => s.toggleLock);
  const onTerrain = readout.groundElevation !== null;
  const hasSurface = useEditorStore((s) => s.project.terrain !== null);
  const surfaceShown = useTerrainStore((s) => s.display.show3d);
  const support = formatMeters(readout.referenceElevation, 2);
  return (
    <>
      <div
        className="walk__readout"
        data-testid="walk-hud"
        data-x={readout.x.toFixed(3)}
        data-y={readout.y.toFixed(3)}
        data-eye-height={readout.eyeHeight.toFixed(3)}
        data-on-terrain={onTerrain}
        data-ground={(readout.groundElevation ?? readout.referenceElevation).toFixed(3)}
      >
        <strong>Percurso</strong>
        <span>
          X {formatMeters(readout.x, 2)} · Y {formatMeters(readout.y, 2)}
        </span>
        <span data-testid="walk-ground">
          {onTerrain
            ? `Cota do terreno ${formatMeters(readout.groundElevation ?? 0, 2)}`
            : hasSurface && surfaceShown
              ? `Fora do terreno · apoio na cota ${support}`
              : `Sem terreno · apoio na cota ${support}`}
        </span>
        <span data-testid="walk-eye-height">
          Altura da vista {formatMeters(readout.eyeHeight, 2)}
          {Math.abs(readout.eyeHeight - EYE_HEIGHT) < 0.005 ? ' (em pé)' : ''}
        </span>
        <span>Velocidade {readout.speed.toFixed(1).replace('.', ',')} m/s</span>
      </div>
      <div className="walk__keys" data-testid="walk-keys">
        {KEYS.map(([key, label]) => (
          <span key={key}>
            <kbd>{key}</kbd> {label}
          </span>
        ))}
        <span>Arrastar: olhar</span>
        <span>Roda: velocidade</span>
        <span>Clique: propriedades IFC</span>
        <button
          type="button"
          className={locked ? 'walk__lock is-active' : 'walk__lock'}
          data-testid="walk-lock"
          aria-pressed={locked}
          disabled={!toggleLock}
          title="Trava o mouse na vista (F): o olhar segue o mouse sem arrastar e o clique vale na mira. Esc solta."
          onClick={() => toggleLock?.()}
        >
          {locked ? <Lock size={13} aria-hidden /> : <LockOpen size={13} aria-hidden />}
          <kbd>F</kbd> {locked ? 'mouse travado' : 'travar o mouse'}
        </button>
      </div>
      {locked && <span className="walk__crosshair" data-testid="walk-crosshair" aria-hidden />}
    </>
  );
}

export function WalkView() {
  const webgl = useMemo(isWebGLAvailable, []);
  if (!webgl) {
    return (
      <div className="viewport-fallback" role="alert">
        <strong>WebGL indisponível.</strong>
        <span>O percurso exige um navegador com WebGL habilitado.</span>
      </div>
    );
  }
  return (
    <div className="walk" data-testid="walk-view">
      <ErrorBoundary
        title="Falha ao renderizar o percurso"
        hint="O modelo não foi perdido. Volte ao Modelo 3D ou recarregue a página."
      >
        <Suspense fallback={<div className="viewport-fallback">Carregando o percurso…</div>}>
          <Canvas
            data-testid="walk-canvas"
            shadows
            camera={{ up: [0, 0, 1], fov: 68, near: 0.1, far: 12000 }}
            gl={{ antialias: true, preserveDrawingBuffer: true }}
            dpr={[1, 2]}
          >
            <WalkScene />
          </Canvas>
        </Suspense>
      </ErrorBoundary>
      <WalkHud />
    </div>
  );
}
