import type { Vec3, ViewCategory } from '@hydrobim/core';
import { create } from 'zustand';
import type { VrModelStats } from './vrModel';
import {
  detectVrSupport,
  requestVrSession,
  sessionErrorMessage,
  type AttachedSession,
  type VrSupport,
  type XrSessionLike,
  type XrSystemLike,
} from './vrSession';

/**
 * Sessão de realidade virtual do editor. É estado de interface: não entra no projeto, no
 * histórico nem nas preferências gravadas. A vista de VR (`VRView`) registra aqui como ligar
 * uma sessão ao seu renderizador; o comando "Entrar em VR" pede a sessão e a entrega a ela.
 */

export type VrPhase = 'idle' | 'requesting' | 'presenting' | 'error';

/** Liga a sessão ao renderizador da vista de VR. */
export type VrAttach = (session: XrSessionLike) => Promise<AttachedSession>;

interface VrState {
  /** Vista de VR aberta no lugar da área de desenho. */
  open: boolean;
  /** `null` enquanto o navegador ainda não foi consultado. */
  support: VrSupport | null;
  phase: VrPhase;
  /** Problema a mostrar ao usuário (incompatibilidade, recusa da sessão). */
  message: string | null;
  session: XrSessionLike | null;
  /** Sessão concedida à espera de a vista de VR terminar de montar a cena. */
  pending: XrSessionLike | null;
  attach: VrAttach | null;
  floor: AttachedSession['floor'] | null;
  /** Quadros por segundo medidos na sessão em andamento e a média da última sessão. */
  fps: number | null;
  lastFps: number | null;
  stats: VrModelStats | null;
  /** Categorias ocultas só na realidade virtual. */
  hiddenCategories: readonly ViewCategory[];
  /** Leitura da vista: ponto do projeto sob o usuário, elemento consultado e menu aberto. */
  position: Vec3 | null;
  selected: string | null;
  menuOpen: boolean;
  /** Mira do teletransporte: destino aceito, recusado (sem piso ou íngreme) ou com obstáculo. */
  aim: 'valid' | 'invalid' | 'blocked' | null;
}

const INITIAL: VrState = {
  open: false,
  support: null,
  phase: 'idle',
  message: null,
  session: null,
  pending: null,
  attach: null,
  floor: null,
  fps: null,
  lastFps: null,
  stats: null,
  hiddenCategories: [],
  position: null,
  selected: null,
  menuOpen: false,
  aim: null,
};

export const useVrStore = create<VrState>()(() => INITIAL);

/** Volta ao estado inicial (testes). */
export const resetVrStore = (): void => useVrStore.setState(INITIAL);

export interface VrEnvironment {
  readonly xr?: XrSystemLike | null;
  readonly isSecureContext?: boolean;
}

/** O navegador em que o editor está rodando. */
export function browserVrEnvironment(): VrEnvironment {
  const nav = (globalThis as { navigator?: { xr?: XrSystemLike } }).navigator;
  return {
    xr: nav?.xr ?? null,
    isSecureContext: (globalThis as { isSecureContext?: boolean }).isSecureContext,
  };
}

/** Consulta o suporte do navegador e guarda o resultado. */
export async function checkVrSupport(
  env: VrEnvironment = browserVrEnvironment(),
): Promise<VrSupport> {
  const support = await detectVrSupport(env);
  useVrStore.setState({ support });
  return support;
}

async function bind(session: XrSessionLike, attach: VrAttach): Promise<void> {
  try {
    const { floor } = await attach(session);
    useVrStore.setState({ phase: 'presenting', session, pending: null, floor, message: null });
  } catch (error) {
    useVrStore.setState({
      phase: 'error',
      pending: null,
      message: sessionErrorMessage(error),
    });
    void session.end().catch(() => undefined);
  }
}

/**
 * Entra na realidade virtual. Tem de ser chamada a partir de um clique: os navegadores só
 * concedem a sessão imersiva em resposta a um gesto do usuário. Navegador incompatível ou
 * pedido recusado deixam a mensagem em `message` e o editor segue funcionando.
 */
export async function enterVr(env: VrEnvironment = browserVrEnvironment()): Promise<void> {
  const { phase } = useVrStore.getState();
  if (phase === 'requesting' || phase === 'presenting') return;
  useVrStore.setState({ phase: 'requesting', message: null });
  const support = await checkVrSupport(env);
  if (support.state === 'unsupported' || !env.xr) {
    useVrStore.setState({
      phase: 'idle',
      message: support.state === 'unsupported' ? support.message : null,
    });
    return;
  }
  let session: XrSessionLike;
  try {
    session = await requestVrSession(env.xr);
  } catch (error) {
    useVrStore.setState({ phase: 'error', message: sessionErrorMessage(error) });
    return;
  }
  session.addEventListener(
    'end',
    () => {
      const state = useVrStore.getState();
      if (state.session !== session && state.pending !== session) return;
      useVrStore.setState({
        // Uma falha ao ligar a sessão continua à mostra depois que ela termina.
        phase: state.phase === 'error' ? 'error' : 'idle',
        session: null,
        pending: null,
        floor: null,
        fps: null,
        lastFps: state.fps ?? state.lastFps,
      });
    },
    { once: true },
  );
  const { attach, open } = useVrStore.getState();
  if (!open) {
    // A vista foi fechada enquanto o navegador pedia a permissão.
    void session.end().catch(() => undefined);
    useVrStore.setState({ phase: 'idle' });
    return;
  }
  if (attach) await bind(session, attach);
  else useVrStore.setState({ pending: session });
}

/** Encerra a sessão imersiva; a vista de VR continua aberta, com a prévia no monitor. */
export async function exitVr(): Promise<void> {
  const { session, pending } = useVrStore.getState();
  const current = session ?? pending;
  if (!current) return;
  try {
    await current.end();
  } catch {
    // A sessão já tinha terminado (o usuário saiu pelo botão do headset).
  }
}

/**
 * A vista de VR registra como ligar uma sessão ao seu renderizador. Devolve a função que
 * desfaz o registro e encerra a sessão em andamento (desmontagem da vista).
 */
export function registerVrRenderer(attach: VrAttach): () => void {
  useVrStore.setState({ attach });
  const { pending } = useVrStore.getState();
  if (pending) void bind(pending, attach);
  return () => {
    if (useVrStore.getState().attach === attach) useVrStore.setState({ attach: null });
    void exitVr();
  };
}

/** Abre a vista de VR no lugar da área de desenho. */
export function openVr(): void {
  useVrStore.setState({ open: true, message: null });
}

/** Encerra a sessão, se houver, e volta ao editor. */
export async function closeVr(): Promise<void> {
  await exitVr();
  useVrStore.setState({
    open: false,
    phase: 'idle',
    message: null,
    stats: null,
    position: null,
    selected: null,
    menuOpen: false,
    aim: null,
  });
}

export function toggleVrCategory(category: ViewCategory): void {
  const { hiddenCategories } = useVrStore.getState();
  useVrStore.setState({
    hiddenCategories: hiddenCategories.includes(category)
      ? hiddenCategories.filter((hidden) => hidden !== category)
      : [...hiddenCategories, category],
  });
}
