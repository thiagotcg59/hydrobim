/**
 * Sessão WebXR imersiva: detecção de compatibilidade, pedido da sessão e ligação ao
 * renderizador. Sem dependência do React nem do Three.js — o renderizador entra pela parte da
 * interface de `WebGLRenderer.xr` que é usada aqui, o que permite testar com objetos simulados.
 */

/** Parte de `navigator.xr` usada pelo editor. */
export interface XrSystemLike {
  isSessionSupported(mode: 'immersive-vr'): Promise<boolean>;
  requestSession(
    mode: 'immersive-vr',
    options?: { optionalFeatures?: string[] },
  ): Promise<XrSessionLike>;
}

/** Parte de `XRSession` usada pelo editor. */
export interface XrSessionLike {
  requestReferenceSpace(type: 'local-floor' | 'local'): Promise<unknown>;
  end(): Promise<void>;
  addEventListener(type: 'end', listener: () => void, options?: { once?: boolean }): void;
  readonly supportedFrameRates?: ArrayLike<number> | null;
  updateTargetFrameRate?: (rate: number) => Promise<void>;
  readonly inputSources?: Iterable<unknown>;
  dispatchEvent?: (event: never) => boolean;
}

/** Parte de `WebGLRenderer.xr` usada pelo editor. */
export interface XrManagerLike {
  enabled: boolean;
  readonly isPresenting: boolean;
  setReferenceSpaceType(type: 'local-floor' | 'local'): void;
  setFramebufferScaleFactor(factor: number): void;
  setFoveation(level: number): void;
  setSession(session: never): Promise<void>;
}

export type VrSupport =
  | { readonly state: 'supported' }
  | {
      readonly state: 'unsupported';
      readonly reason: 'insecure' | 'no-webxr' | 'no-vr' | 'error';
      /** Mensagem pronta para o usuário. */
      readonly message: string;
    };

export const VR_MESSAGES = {
  insecure:
    'A realidade virtual exige uma página segura (HTTPS). Abra o HydroBIM pelo endereço https://.',
  'no-webxr':
    'Este navegador não oferece WebXR. Use o navegador do Meta Quest (ou outro compatível com WebXR); o editor segue disponível no viewport convencional.',
  'no-vr':
    'Nenhum dispositivo de realidade virtual disponível neste navegador. No computador, o editor segue no viewport convencional; no Meta Quest, abra esta página no navegador do headset.',
  error: 'Não foi possível consultar o suporte a realidade virtual neste navegador.',
} as const;

const unsupported = (reason: keyof typeof VR_MESSAGES): VrSupport => ({
  state: 'unsupported',
  reason,
  message: VR_MESSAGES[reason],
});

/** Verifica se o navegador pode abrir uma sessão `immersive-vr`. Nunca lança. */
export async function detectVrSupport(env: {
  readonly xr?: XrSystemLike | null;
  readonly isSecureContext?: boolean;
}): Promise<VrSupport> {
  if (env.isSecureContext === false) return unsupported('insecure');
  if (!env.xr || typeof env.xr.isSessionSupported !== 'function') return unsupported('no-webxr');
  try {
    return (await env.xr.isSessionSupported('immersive-vr'))
      ? { state: 'supported' }
      : unsupported('no-vr');
  } catch {
    // Política de permissões ou navegador que recusa a consulta.
    return unsupported('error');
  }
}

/**
 * Pede a sessão imersiva. Tem de ser chamada a partir de um gesto do usuário (clique). O piso
 * rastreado é opcional: sem ele a sessão ainda abre, com a altura do piso estimada.
 */
export function requestVrSession(xr: XrSystemLike): Promise<XrSessionLike> {
  return xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
}

/** Mensagem para a recusa do pedido de sessão. */
export function sessionErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'SecurityError') {
    return 'O navegador recusou a sessão de realidade virtual: ela só pode ser iniciada por um clique em "Entrar em VR" e com a permissão concedida.';
  }
  if (name === 'NotSupportedError') return VR_MESSAGES['no-vr'];
  if (name === 'InvalidStateError') {
    return 'Já existe uma sessão de realidade virtual em andamento neste navegador.';
  }
  const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
  return `Não foi possível iniciar a sessão de realidade virtual${detail}.`;
}

export interface VrSessionQuality {
  /** Fator da resolução de renderização em relação à nativa do visor. */
  readonly framebufferScale: number;
  /** Renderização foveada fixa: 0 (desligada) a 1 (máxima). */
  readonly foveation: number;
  /** Taxa de quadros pedida ao dispositivo, quando ele permite escolher (Hz). */
  readonly targetFrameRate: number;
}

/** Altura dos olhos assumida quando o dispositivo não informa o piso (m). */
export const ESTIMATED_EYE_HEIGHT = 1.6;

export interface AttachedSession {
  /** `tracked`: piso físico rastreado (`local-floor`). `estimated`: altura dos olhos assumida. */
  readonly floor: 'tracked' | 'estimated';
}

/**
 * Controles que o dispositivo anunciou antes de o renderizador começar a ouvir a sessão. A
 * sessão é pedida no clique, e a cena pode levar alguns instantes para ficar pronta: nesse
 * intervalo o evento `inputsourceschange` já pode ter passado, e o Three.js só conhece os
 * controles por ele. O evento é reenviado com os controles presentes (ligar duas vezes o mesmo
 * controle não tem efeito).
 */
function announceInputSources(session: XrSessionLike): void {
  const added = session.inputSources ? Array.from(session.inputSources) : [];
  const EventClass = (
    globalThis as {
      XRInputSourcesChangeEvent?: new (type: string, init: Record<string, unknown>) => unknown;
    }
  ).XRInputSourcesChangeEvent;
  if (added.length === 0 || !EventClass || !session.dispatchEvent) return;
  try {
    session.dispatchEvent(
      new EventClass('inputsourceschange', { session, added, removed: [] }) as never,
    );
  } catch {
    // Navegador que não permite construir o evento: os controles entram no próximo anúncio.
  }
}

/**
 * Liga a sessão ao renderizador existente. A partir daí o laço de renderização é o da WebXR
 * (`renderer.xr.setAnimationLoop`, acionado pelo React Three Fiber ao detectar a sessão).
 */
export async function attachVrSession(
  manager: XrManagerLike,
  session: XrSessionLike,
  quality: VrSessionQuality,
): Promise<AttachedSession> {
  let floor: AttachedSession['floor'] = 'tracked';
  try {
    await session.requestReferenceSpace('local-floor');
  } catch {
    // Dispositivo sem piso rastreado: a origem fica na cabeça e a altura é estimada.
    floor = 'estimated';
  }
  manager.enabled = true;
  manager.setReferenceSpaceType(floor === 'tracked' ? 'local-floor' : 'local');
  // A resolução só pode ser definida antes de a sessão começar.
  manager.setFramebufferScaleFactor(quality.framebufferScale);
  await manager.setSession(session as never);
  manager.setFoveation(quality.foveation);
  announceInputSources(session);
  const rates = session.supportedFrameRates;
  if (rates && session.updateTargetFrameRate) {
    const offered = Array.from(rates);
    if (offered.includes(quality.targetFrameRate)) {
      // Recusar a taxa não impede a sessão: vale a padrão do dispositivo.
      void session.updateTargetFrameRate(quality.targetFrameRate).catch(() => undefined);
    }
  }
  return { floor };
}
