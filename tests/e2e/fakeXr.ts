/**
 * Dispositivo WebXR simulado para os testes no navegador: um headset em pé, com piso rastreado,
 * e dois controles no mapeamento `xr-standard`. Implementa só a parte da WebXR Device API que
 * o Three.js usa (sessão, espaço de referência, quadros, poses, fontes de entrada e a camada
 * WebGL), desenhando os dois olhos lado a lado no próprio canvas.
 *
 * Serve para exercitar o laço real da sessão — entrada, controles, teletransporte, seleção e
 * saída. NÃO substitui o teste no Meta Quest 2: conforto, legibilidade, rastreamento e taxa de
 * quadros só se medem no aparelho.
 *
 * A função roda dentro da página (`page.addInitScript`): não pode usar nada de fora dela.
 */
export interface FakeXrOptions {
  /** `false`: o dispositivo não oferece `local-floor` (piso estimado). */
  readonly floor?: boolean;
}

export interface FakeXrHandle {
  head: { position: [number, number, number]; yaw: number };
  hands: {
    position: [number, number, number];
    /** Direção do raio: guinada (em torno de +Y) e inclinação (positivo = para cima), rad. */
    yaw: number;
    pitch: number;
    axes: [number, number, number, number];
    buttons: boolean[];
  }[];
  press(hand: number, type?: 'select' | 'squeeze'): void;
  end(): void;
  frames: number;
  sessions: number;
}

export function installFakeXr(options: FakeXrOptions = {}): void {
  const w = window as unknown as Record<string, unknown>;

  const quaternion = (yaw: number, pitch: number): [number, number, number, number] => {
    // Guinada em torno de +Y, depois inclinação em torno do X local.
    const cy = Math.cos(yaw / 2);
    const sy = Math.sin(yaw / 2);
    const cp = Math.cos(pitch / 2);
    const sp = Math.sin(pitch / 2);
    return [cy * sp, sy * cp, -sy * sp, cy * cp];
  };
  const matrixOf = (p: [number, number, number], q: [number, number, number, number]) => {
    const [x, y, z, s] = q;
    return new Float32Array([
      1 - 2 * (y * y + z * z),
      2 * (x * y + z * s),
      2 * (x * z - y * s),
      0,
      2 * (x * y - z * s),
      1 - 2 * (x * x + z * z),
      2 * (y * z + x * s),
      0,
      2 * (x * z + y * s),
      2 * (y * z - x * s),
      1 - 2 * (x * x + y * y),
      0,
      p[0],
      p[1],
      p[2],
      1,
    ]);
  };
  const transformOf = (p: [number, number, number], q: [number, number, number, number]) => ({
    position: { x: p[0], y: p[1], z: p[2], w: 1 },
    orientation: { x: q[0], y: q[1], z: q[2], w: q[3] },
    matrix: matrixOf(p, q),
  });
  const projection = (aspect: number): Float32Array => {
    const f = 1 / Math.tan((90 * Math.PI) / 360);
    const near = 0.05;
    const far = 8000;
    return new Float32Array([
      f / aspect,
      0,
      0,
      0,
      0,
      f,
      0,
      0,
      0,
      0,
      (far + near) / (near - far),
      -1,
      0,
      0,
      (2 * far * near) / (near - far),
      0,
    ]);
  };

  const handle: FakeXrHandle = {
    head: { position: [0, 1.65, 0], yaw: 0 },
    hands: [0, 1].map((index) => ({
      position: [index === 0 ? -0.2 : 0.2, 1.2, -0.3] as [number, number, number],
      yaw: 0,
      pitch: 0,
      axes: [0, 0, 0, 0] as [number, number, number, number],
      buttons: [false, false, false, false, false, false],
    })),
    press: () => undefined,
    end: () => undefined,
    frames: 0,
    sessions: 0,
  };
  w.__fakeXr = handle;

  w.XRInputSourcesChangeEvent = class {
    readonly type: string;
    readonly session: unknown;
    readonly added: unknown;
    readonly removed: unknown;
    constructor(type: string, init: { session: unknown; added: unknown; removed: unknown }) {
      this.type = type;
      this.session = init.session;
      this.added = init.added;
      this.removed = init.removed;
    }
  };
  // Sem `XRWebGLBinding`, o Three.js usa a camada WebGL simples, que é a simulada aqui.
  w.XRWebGLBinding = undefined;
  w.XRWebGLLayer = class {
    framebuffer = null;
    framebufferWidth: number;
    framebufferHeight: number;
    ignoreDepthValues = false;
    fixedFoveation = 0;
    constructor(_session: unknown, gl: WebGL2RenderingContext) {
      this.framebufferWidth = gl.drawingBufferWidth;
      this.framebufferHeight = gl.drawingBufferHeight;
    }
    getViewport(view: { eye: string }) {
      const half = Math.floor(this.framebufferWidth / 2);
      return {
        x: view.eye === 'right' ? half : 0,
        y: 0,
        width: half,
        height: this.framebufferHeight,
      };
    }
  };
  for (const name of ['WebGL2RenderingContext', 'WebGLRenderingContext']) {
    const context = w[name] as { prototype: Record<string, unknown> } | undefined;
    if (context) context.prototype.makeXRCompatible = () => Promise.resolve();
  }

  const createSession = () => {
    const listeners = new Map<string, Set<(event: unknown) => void>>();
    const emit = (type: string, event: Record<string, unknown>): void => {
      for (const listener of listeners.get(type) ?? []) listener({ type, ...event });
    };
    const sources = handle.hands.map((hand, index) => ({
      handedness: index === 0 ? 'left' : 'right',
      targetRayMode: 'tracked-pointer',
      targetRaySpace: { hand: index },
      gripSpace: null,
      hand: null,
      profiles: ['oculus-touch-v3', 'generic-trigger-squeeze-thumbstick'],
      get gamepad() {
        return {
          mapping: 'xr-standard',
          axes: hand.axes,
          buttons: hand.buttons.map((pressed) => ({
            pressed,
            touched: pressed,
            value: pressed ? 1 : 0,
          })),
        };
      },
    }));
    let ended = false;
    let layer: { framebufferWidth: number; framebufferHeight: number } | null = null;
    const frame = {
      session: null as unknown,
      getViewerPose: () => {
        const q = quaternion(handle.head.yaw, 0);
        const transform = transformOf(handle.head.position, q);
        const aspect = layer ? layer.framebufferWidth / 2 / layer.framebufferHeight : 1;
        const view = (eye: string) => ({ eye, transform, projectionMatrix: projection(aspect) });
        return { transform, views: [view('left'), view('right')], emulatedPosition: false };
      },
      getPose: (space: { hand?: number }) => {
        const hand = space.hand === undefined ? undefined : handle.hands[space.hand];
        if (!hand) return null;
        return { transform: transformOf(hand.position, quaternion(hand.yaw, hand.pitch)) };
      },
    };
    const session = {
      visibilityState: 'visible',
      environmentBlendMode: 'opaque',
      enabledFeatures:
        options.floor === false ? ['viewer', 'local'] : ['viewer', 'local', 'local-floor'],
      supportedFrameRates: new Float32Array([72, 90]),
      frameRate: 90,
      inputSources: sources,
      renderState: {
        depthNear: 0.1,
        depthFar: 1000,
        baseLayer: null as unknown,
        layers: undefined,
      },
      updateTargetFrameRate(rate: number) {
        session.frameRate = rate;
        return Promise.resolve();
      },
      updateRenderState(state: Record<string, unknown>) {
        Object.assign(session.renderState, state);
        if (state.baseLayer) layer = state.baseLayer as typeof layer;
      },
      requestReferenceSpace(type: string) {
        if (type === 'local-floor' && options.floor === false) {
          return Promise.reject(new DOMException('sem piso rastreado', 'NotSupportedError'));
        }
        const space = { type, getOffsetReferenceSpace: () => space };
        return Promise.resolve(space);
      },
      requestAnimationFrame(callback: (time: number, frame: unknown) => void) {
        return requestAnimationFrame((time) => {
          if (ended) return;
          handle.frames += 1;
          callback(time, frame);
        });
      },
      cancelAnimationFrame(id: number) {
        cancelAnimationFrame(id);
      },
      addEventListener(type: string, listener: (event: unknown) => void) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)?.add(listener);
      },
      removeEventListener(type: string, listener: (event: unknown) => void) {
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent(event: { type: string }) {
        for (const listener of listeners.get(event.type) ?? []) listener(event);
        return true;
      },
      end() {
        if (ended) return Promise.resolve();
        ended = true;
        emit('end', { session });
        return Promise.resolve();
      },
    };
    frame.session = session;
    handle.press = (hand, type = 'select') => {
      const inputSource = sources[hand];
      if (!inputSource || ended) return;
      emit(`${type}start`, { inputSource, frame });
      emit(type, { inputSource, frame });
      emit(`${type}end`, { inputSource, frame });
    };
    handle.end = () => void session.end();
    handle.sessions += 1;
    // Os controles são anunciados logo após a sessão ser concedida — possivelmente antes de o
    // renderizador começar a ouvi-la, como pode acontecer em um dispositivo real.
    setTimeout(() => emit('inputsourceschange', { session, added: sources, removed: [] }), 0);
    return session;
  };

  Object.defineProperty(navigator, 'xr', {
    configurable: true,
    value: {
      isSessionSupported: (mode: string) => Promise.resolve(mode === 'immersive-vr'),
      requestSession: (mode: string) => {
        // Como no navegador real: sem a ativação de um gesto ainda válida, o pedido é recusado.
        const activation = (navigator as { userActivation?: { isActive: boolean } }).userActivation;
        if (activation && !activation.isActive) {
          return Promise.reject(new DOMException('sem gesto do usuário', 'SecurityError'));
        }
        return mode === 'immersive-vr'
          ? Promise.resolve(createSession())
          : Promise.reject(new DOMException('modo não suportado', 'NotSupportedError'));
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
}
