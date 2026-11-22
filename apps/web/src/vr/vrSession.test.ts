import { beforeEach, describe, expect, it } from 'vitest';
import { sessionQuality } from './vrPerformance';
import {
  attachVrSession,
  detectVrSupport,
  requestVrSession,
  sessionErrorMessage,
  type XrManagerLike,
  type XrSessionLike,
  type XrSystemLike,
} from './vrSession';
import {
  checkVrSupport,
  closeVr,
  enterVr,
  exitVr,
  openVr,
  registerVrRenderer,
  resetVrStore,
  toggleVrCategory,
  useVrStore,
} from './vrStore';

/** Sessão WebXR simulada: registra o que foi pedido e dispara `end` ao ser encerrada. */
function fakeSession(options: { floor?: boolean; rates?: number[] } = {}) {
  const listeners: (() => void)[] = [];
  const calls: string[] = [];
  const session: XrSessionLike & { calls: string[]; ended: boolean; finish(): void } = {
    calls,
    ended: false,
    requestReferenceSpace: (type) => {
      calls.push(`space:${type}`);
      return type === 'local-floor' && options.floor === false
        ? Promise.reject(new DOMException('sem piso', 'NotSupportedError'))
        : Promise.resolve({});
    },
    end: () => {
      session.finish();
      return Promise.resolve();
    },
    addEventListener: (_type, listener) => {
      listeners.push(listener);
    },
    supportedFrameRates: options.rates ?? null,
    updateTargetFrameRate: (rate) => {
      calls.push(`rate:${rate}`);
      return Promise.resolve();
    },
    finish() {
      if (session.ended) return;
      session.ended = true;
      for (const listener of listeners.splice(0)) listener();
    },
  };
  return session;
}

function fakeManager() {
  const calls: string[] = [];
  const manager: XrManagerLike & { calls: string[] } = {
    calls,
    enabled: false,
    isPresenting: false,
    setReferenceSpaceType: (type) => void calls.push(`type:${type}`),
    setFramebufferScaleFactor: (factor) => void calls.push(`scale:${factor}`),
    setFoveation: (level) => void calls.push(`foveation:${level}`),
    setSession: () => {
      calls.push('session');
      return Promise.resolve();
    },
  };
  return manager;
}

function fakeXr(options: { supported?: boolean; session?: XrSessionLike; deny?: Error } = {}) {
  const requests: unknown[] = [];
  const xr: XrSystemLike & { requests: unknown[] } = {
    requests,
    isSessionSupported: () => Promise.resolve(options.supported ?? true),
    requestSession: (mode, init) => {
      requests.push({ mode, init });
      if (options.deny) return Promise.reject(options.deny);
      return Promise.resolve(options.session ?? fakeSession());
    },
  };
  return xr;
}

const QUALITY = sessionQuality({ triangles: 1000 }, null);

describe('detecção de compatibilidade', () => {
  it('navegador com WebXR e dispositivo de VR: compatível', async () => {
    expect(await detectVrSupport({ xr: fakeXr(), isSecureContext: true })).toEqual({
      state: 'supported',
    });
  });

  it('sem `navigator.xr`: incompatível, com a mensagem para o usuário', async () => {
    const support = await detectVrSupport({ xr: null, isSecureContext: true });
    expect(support).toMatchObject({ state: 'unsupported', reason: 'no-webxr' });
    expect(support.state === 'unsupported' && support.message).toContain('WebXR');
  });

  it('WebXR presente, mas sem modo imersivo de VR (computador sem headset)', async () => {
    const support = await detectVrSupport({ xr: fakeXr({ supported: false }) });
    expect(support).toMatchObject({ state: 'unsupported', reason: 'no-vr' });
  });

  it('página sem HTTPS: informa o motivo', async () => {
    const support = await detectVrSupport({ xr: fakeXr(), isSecureContext: false });
    expect(support).toMatchObject({ state: 'unsupported', reason: 'insecure' });
  });

  it('consulta recusada pelo navegador não lança', async () => {
    const xr = fakeXr();
    xr.isSessionSupported = () => Promise.reject(new Error('bloqueado'));
    expect(await detectVrSupport({ xr })).toMatchObject({ state: 'unsupported', reason: 'error' });
  });
});

describe('sessão imersiva', () => {
  it('pede `immersive-vr` com o piso rastreado como recurso opcional', async () => {
    const xr = fakeXr();
    await requestVrSession(xr);
    expect(xr.requests).toEqual([
      { mode: 'immersive-vr', init: { optionalFeatures: ['local-floor', 'bounded-floor'] } },
    ]);
  });

  it('liga a sessão ao renderizador: habilita o XR, piso rastreado, resolução antes da sessão', async () => {
    const manager = fakeManager();
    const session = fakeSession({ rates: [72, 90] });
    const attached = await attachVrSession(manager, session, QUALITY);
    expect(attached.floor).toBe('tracked');
    expect(manager.enabled).toBe(true);
    expect(manager.calls).toEqual(['type:local-floor', 'scale:1', 'session', 'foveation:1']);
    expect(session.calls).toContain('rate:72');
  });

  it('sem `local-floor`, usa `local` e marca o piso como estimado', async () => {
    const manager = fakeManager();
    const attached = await attachVrSession(manager, fakeSession({ floor: false }), QUALITY);
    expect(attached.floor).toBe('estimated');
    expect(manager.calls[0]).toBe('type:local');
  });

  it('não pede taxa de quadros que o dispositivo não oferece', async () => {
    const session = fakeSession({ rates: [60, 90] });
    await attachVrSession(fakeManager(), session, QUALITY);
    expect(session.calls.some((call) => call.startsWith('rate:'))).toBe(false);
  });

  it('explica a recusa do navegador', () => {
    expect(sessionErrorMessage(new DOMException('x', 'SecurityError'))).toContain('clique');
    expect(sessionErrorMessage(new DOMException('x', 'NotSupportedError'))).toContain('Nenhum');
    expect(sessionErrorMessage(new Error('falhou'))).toContain('falhou');
  });
});

describe('entrada e saída pela store', () => {
  beforeEach(() => {
    resetVrStore();
    openVr();
  });

  it('navegador incompatível: mensagem clara e o editor segue (nenhuma sessão é pedida)', async () => {
    const xr = fakeXr({ supported: false });
    await enterVr({ xr, isSecureContext: true });
    const state = useVrStore.getState();
    expect(state.phase).toBe('idle');
    expect(state.message).toContain('Nenhum dispositivo');
    expect(xr.requests).toHaveLength(0);
  });

  it('sem WebXR: `checkVrSupport` guarda o motivo', async () => {
    await checkVrSupport({ xr: null });
    expect(useVrStore.getState().support).toMatchObject({ reason: 'no-webxr' });
  });

  it('entra, apresenta e volta ao estado inicial quando a sessão termina', async () => {
    const manager = fakeManager();
    const session = fakeSession();
    const unregister = registerVrRenderer((s) => attachVrSession(manager, s, QUALITY));
    await enterVr({ xr: fakeXr({ session }), isSecureContext: true });
    expect(useVrStore.getState()).toMatchObject({ phase: 'presenting', floor: 'tracked' });
    expect(useVrStore.getState().session).toBe(session);

    useVrStore.setState({ fps: 71 });
    await exitVr();
    expect(session.ended).toBe(true);
    expect(useVrStore.getState()).toMatchObject({
      phase: 'idle',
      session: null,
      floor: null,
      fps: null,
      lastFps: 71,
    });
    unregister();
  });

  it('a sessão encerrada pelo headset (botão do sistema) também limpa o estado', async () => {
    const session = fakeSession();
    registerVrRenderer((s) => attachVrSession(fakeManager(), s, QUALITY));
    await enterVr({ xr: fakeXr({ session }) });
    session.finish();
    expect(useVrStore.getState()).toMatchObject({ phase: 'idle', session: null });
  });

  it('sessão concedida antes de a cena estar pronta fica à espera do renderizador', async () => {
    const manager = fakeManager();
    const session = fakeSession();
    await enterVr({ xr: fakeXr({ session }) });
    expect(useVrStore.getState()).toMatchObject({ phase: 'requesting', pending: session });
    registerVrRenderer((s) => attachVrSession(manager, s, QUALITY));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useVrStore.getState()).toMatchObject({ phase: 'presenting', pending: null });
    expect(manager.calls).toContain('session');
  });

  it('não pede duas sessões ao mesmo tempo', async () => {
    const xr = fakeXr();
    registerVrRenderer((s) => attachVrSession(fakeManager(), s, QUALITY));
    await Promise.all([enterVr({ xr }), enterVr({ xr })]);
    await enterVr({ xr });
    expect(xr.requests).toHaveLength(1);
  });

  it('pedido recusado: fase de erro, com a mensagem, sem sessão', async () => {
    await enterVr({ xr: fakeXr({ deny: new DOMException('negado', 'SecurityError') }) });
    const state = useVrStore.getState();
    expect(state.phase).toBe('error');
    expect(state.message).toContain('recusou');
    expect(state.session).toBeNull();
  });

  it('falha ao ligar a sessão ao renderizador: a sessão é encerrada e o erro fica à mostra', async () => {
    const session = fakeSession();
    registerVrRenderer(() => Promise.reject(new Error('contexto perdido')));
    await enterVr({ xr: fakeXr({ session }) });
    expect(session.ended).toBe(true);
    expect(useVrStore.getState()).toMatchObject({ phase: 'error', session: null });
    expect(useVrStore.getState().message).toContain('contexto perdido');
  });

  it('limpeza: desmontar a vista desfaz o registro e encerra a sessão', async () => {
    const session = fakeSession();
    const unregister = registerVrRenderer((s) => attachVrSession(fakeManager(), s, QUALITY));
    await enterVr({ xr: fakeXr({ session }) });
    unregister();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.ended).toBe(true);
    expect(useVrStore.getState()).toMatchObject({ attach: null, session: null, phase: 'idle' });
  });

  it('"Voltar ao editor" encerra a sessão e fecha a vista', async () => {
    const session = fakeSession();
    registerVrRenderer((s) => attachVrSession(fakeManager(), s, QUALITY));
    await enterVr({ xr: fakeXr({ session }) });
    await closeVr();
    expect(session.ended).toBe(true);
    expect(useVrStore.getState()).toMatchObject({ open: false, phase: 'idle', session: null });
  });

  it('vista fechada enquanto o navegador pedia a permissão: a sessão concedida é encerrada', async () => {
    const session = fakeSession();
    const xr = fakeXr({ session });
    const entering = enterVr({ xr });
    useVrStore.setState({ open: false });
    await entering;
    expect(session.ended).toBe(true);
    expect(useVrStore.getState().phase).toBe('idle');
  });

  it('categorias ocultas só na realidade virtual', () => {
    toggleVrCategory('valves');
    toggleVrCategory('pipes');
    expect(useVrStore.getState().hiddenCategories).toEqual(['valves', 'pipes']);
    toggleVrCategory('valves');
    expect(useVrStore.getState().hiddenCategories).toEqual(['pipes']);
  });
});
