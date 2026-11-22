import { create } from 'zustand';
import {
  ALL_SNAPS_ON,
  SNAP_TOGGLES,
  type SnapSettings,
  type SnapToggle,
} from '../editor/planSnaps';

/**
 * Capturas de desenho ligadas (barra de referências) e o filtro de nível da planta de trabalho
 * da arquitetura. São auxílios de desenho, como a grade e a precisão: não alteram o projeto,
 * não entram no histórico e ficam guardados neste navegador.
 */
export interface SnapPreferences {
  readonly snaps: SnapSettings;
  /**
   * Planta de trabalho: desenhar, selecionar e capturar só a arquitetura do nível do plano de
   * trabalho. Desligado, todos os níveis ficam sobrepostos (e todos são capturados).
   */
  readonly activeLevelOnly: boolean;
}

export const DEFAULT_SNAP_PREFERENCES: SnapPreferences = {
  snaps: ALL_SNAPS_ON,
  activeLevelOnly: true,
};

const STORAGE_KEY = 'hydrobim.snaps';

/** Normaliza preferências lidas; o que faltar ou for inválido volta ao padrão. */
export function sanitizeSnapPreferences(raw: unknown): SnapPreferences {
  const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const stored =
    typeof value.snaps === 'object' && value.snaps !== null
      ? (value.snaps as Record<string, unknown>)
      : {};
  const snaps = Object.fromEntries(
    SNAP_TOGGLES.map((key) => [
      key,
      typeof stored[key] === 'boolean' ? stored[key] : ALL_SNAPS_ON[key],
    ]),
  ) as Record<SnapToggle, boolean>;
  return {
    snaps,
    activeLevelOnly:
      typeof value.activeLevelOnly === 'boolean'
        ? value.activeLevelOnly
        : DEFAULT_SNAP_PREFERENCES.activeLevelOnly,
  };
}

function read(): SnapPreferences {
  try {
    const text = globalThis.localStorage?.getItem(STORAGE_KEY);
    return text ? sanitizeSnapPreferences(JSON.parse(text)) : DEFAULT_SNAP_PREFERENCES;
  } catch {
    return DEFAULT_SNAP_PREFERENCES;
  }
}

function write(preferences: SnapPreferences): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Sem armazenamento local (modo privado, cota): a preferência vale só nesta sessão.
  }
}

interface SnapState extends SnapPreferences {
  setSnap: (toggle: SnapToggle, on: boolean) => void;
  setActiveLevelOnly: (on: boolean) => void;
  resetSnaps: () => void;
}

export const useSnapStore = create<SnapState>()((set, get) => ({
  ...read(),
  setSnap: (toggle, on) => {
    const next = {
      snaps: { ...get().snaps, [toggle]: on },
      activeLevelOnly: get().activeLevelOnly,
    };
    write(next);
    set(next);
  },
  setActiveLevelOnly: (activeLevelOnly) => {
    const next = { snaps: get().snaps, activeLevelOnly };
    write(next);
    set(next);
  },
  resetSnaps: () => {
    write(DEFAULT_SNAP_PREFERENCES);
    set(DEFAULT_SNAP_PREFERENCES);
  },
}));

/** Preferências atuais (fora de componentes React). */
export const snapPreferences = (): SnapPreferences => useSnapStore.getState();
