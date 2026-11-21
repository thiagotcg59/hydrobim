import { create } from 'zustand';
import { EYE_HEIGHT, WALK_SPEED } from './walkMotion';

/**
 * Leitura do percurso mostrada sobre a vista (posição, cota do apoio, altura da vista). É
 * estado de sessão da vista: não entra no projeto, no histórico nem nas preferências.
 */
export interface WalkReadout {
  readonly x: number;
  readonly y: number;
  /** Cota real do terreno sob o observador; `null` fora da superfície (ou sem terreno). */
  readonly groundElevation: number | null;
  /** Cota de apoio em uso quando não há terreno sob o observador. */
  readonly referenceElevation: number;
  readonly eyeHeight: number;
  readonly speed: number;
}

interface WalkState {
  readout: WalkReadout;
  /** Mouse travado na vista (olhar sem arrastar; o clique vale na mira). */
  locked: boolean;
  /** Trava ou solta o mouse; `null` enquanto a vista não está montada. */
  toggleLock: (() => void) | null;
}

export const useWalkStore = create<WalkState>()(() => ({
  readout: {
    x: 0,
    y: 0,
    groundElevation: null,
    referenceElevation: 0,
    eyeHeight: EYE_HEIGHT,
    speed: WALK_SPEED,
  },
  locked: false,
  toggleLock: null,
}));
