import { degToRad } from '@hydrobim/core';
import { create } from 'zustand';

/**
 * Precisão da modelagem (Opções de projeto): passos que o cursor respeita ao traçar tubos,
 * esticar comprimentos e girar. São auxílios de desenho, como a grade: não alteram o projeto
 * e ficam guardados neste navegador. Valores digitados nos campos continuam exatos.
 */
export interface PrecisionSettings {
  /** Aplica os passos ao traçado, ao esticar e ao girar. */
  readonly enabled: boolean;
  /** Passo de comprimento (m): trechos e alongamentos andam de tanto em tanto. */
  readonly lengthStep: number;
  /** Passo angular (rad): direção do trecho e ângulo do girar. */
  readonly angleStep: number;
}

export const DEFAULT_PRECISION: PrecisionSettings = {
  enabled: true,
  lengthStep: 0.05,
  angleStep: degToRad(1),
};

/** Limites aceitos: de 1 mm a 10 m e de 0,1° a 90°. */
export const LENGTH_STEP_RANGE = { min: 0.001, max: 10 } as const;
export const ANGLE_STEP_RANGE = { min: degToRad(0.1), max: degToRad(90) } as const;

const STORAGE_KEY = 'hydrobim.precision';

const clamp = (value: number, range: { min: number; max: number }): number =>
  Math.min(range.max, Math.max(range.min, value));

/** Normaliza preferências lidas ou digitadas; valores inválidos voltam ao padrão. */
export function sanitizePrecision(raw: unknown): PrecisionSettings {
  const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const number = (key: string, fallback: number, range: { min: number; max: number }): number => {
    const candidate = value[key];
    return typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0
      ? clamp(candidate, range)
      : fallback;
  };
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_PRECISION.enabled,
    lengthStep: number('lengthStep', DEFAULT_PRECISION.lengthStep, LENGTH_STEP_RANGE),
    angleStep: number('angleStep', DEFAULT_PRECISION.angleStep, ANGLE_STEP_RANGE),
  };
}

function readPrecision(): PrecisionSettings {
  try {
    const text = globalThis.localStorage?.getItem(STORAGE_KEY);
    return text ? sanitizePrecision(JSON.parse(text)) : DEFAULT_PRECISION;
  } catch {
    return DEFAULT_PRECISION;
  }
}

function writePrecision(settings: PrecisionSettings): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Sem armazenamento local (modo privado, cota): a preferência vale só nesta sessão.
  }
}

interface PrecisionState extends PrecisionSettings {
  setPrecision: (patch: Partial<PrecisionSettings>) => void;
  resetPrecision: () => void;
}

export const usePrecisionStore = create<PrecisionState>()((set, get) => ({
  ...readPrecision(),
  setPrecision: (patch) => {
    const { enabled, lengthStep, angleStep } = get();
    const next = sanitizePrecision({ enabled, lengthStep, angleStep, ...patch });
    writePrecision(next);
    set(next);
  },
  resetPrecision: () => {
    writePrecision(DEFAULT_PRECISION);
    set(DEFAULT_PRECISION);
  },
}));

/** Preferências atuais (fora de componentes React). */
export const precision = (): PrecisionSettings => usePrecisionStore.getState();
