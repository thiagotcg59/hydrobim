import type { VrSessionQuality } from './vrSession';

/**
 * Orçamento de desempenho da realidade virtual. A referência é o Meta Quest 2 (processador e
 * placa de vídeo de celular): a meta inicial é manter 72 Hz. As escolhas afetam só a imagem —
 * resolução de renderização, foveação e sombreamento —, nunca a geometria nem os dados do modelo.
 *
 * Os limites abaixo são pontos de partida conservadores, não medições: devem ser revistos com o
 * que o menu da sessão informar no headset (quadros por segundo e triângulos).
 */

/** Taxa de quadros buscada (Hz). */
export const VR_TARGET_FPS = 72;
/** Abaixo disto, a sessão seguinte abre com resolução menor. */
export const VR_LOW_FPS = 65;
/** Triângulos a partir dos quais a cena é considerada pesada para o Quest 2. */
export const VR_HEAVY_TRIANGLES = 350_000;

export interface VrSceneLoad {
  readonly triangles: number;
}

/**
 * Qualidade de uma sessão: resolução nativa e foveação máxima para cenas leves; resolução
 * reduzida quando a cena é pesada ou quando a sessão anterior não sustentou a taxa de quadros.
 */
export function sessionQuality(load: VrSceneLoad, previousFps: number | null): VrSessionQuality {
  const heavy = load.triangles > VR_HEAVY_TRIANGLES;
  const slow = previousFps !== null && previousFps < VR_LOW_FPS;
  const framebufferScale = heavy && slow ? 0.7 : heavy || slow ? 0.85 : 1;
  return { framebufferScale, foveation: 1, targetFrameRate: VR_TARGET_FPS };
}

/** Cenas pesadas trocam o sombreamento físico por um mais barato (difuso por vértice). */
export const isHeavyScene = (load: VrSceneLoad): boolean => load.triangles > VR_HEAVY_TRIANGLES;

/** Média móvel dos quadros por segundo, a partir do intervalo entre quadros. */
export class FrameMeter {
  private elapsed = 0;
  private frames = 0;
  private value: number | null = null;

  /** Registra um quadro; devolve a média quando um novo intervalo de medição se completa. */
  tick(delta: number, window = 1): number | null {
    if (!(delta > 0) || !Number.isFinite(delta)) return null;
    this.elapsed += delta;
    this.frames += 1;
    if (this.elapsed < window) return null;
    this.value = this.frames / this.elapsed;
    this.elapsed = 0;
    this.frames = 0;
    return this.value;
  }

  get fps(): number | null {
    return this.value;
  }

  reset(): void {
    this.elapsed = 0;
    this.frames = 0;
    this.value = null;
  }
}
