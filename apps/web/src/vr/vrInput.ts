/**
 * Leitura dos controles (Meta Quest Touch e outros com o mapeamento `xr-standard`): transforma
 * o estado do direcional e dos botões, lido a cada quadro, em ações discretas. Funções puras.
 *
 * - Direcional para a frente: mira o teletransporte; soltar confirma.
 * - Direcional para os lados: giro por etapas, um por toque (não há locomoção contínua).
 * - Botões A/B (direita) ou X/Y (esquerda): abrem e fecham o menu.
 * O gatilho (seleção) e o aperto chegam como eventos da sessão, não por aqui.
 */

/** Giro por etapa (rad): 30°. */
export const SNAP_TURN_ANGLE = Math.PI / 6;
/** O direcional aciona além deste desvio e rearma abaixo do outro. */
export const STICK_ON = 0.6;
export const STICK_OFF = 0.3;

export interface PadState {
  /** Direcional: x positivo = direita; y negativo = para a frente. */
  readonly x: number;
  readonly y: number;
  /** Algum botão de face (A, B, X ou Y) pressionado. */
  readonly menu: boolean;
}

export interface HandState {
  readonly aiming: boolean;
  readonly turned: boolean;
  readonly menuDown: boolean;
}

export const IDLE_HAND: HandState = { aiming: false, turned: false, menuDown: false };

export type HandAction = 'teleport' | 'cancelTeleport' | 'turnLeft' | 'turnRight' | 'menu';

/** Estado do controle no mapeamento `xr-standard`; `null` sem gamepad. */
export function readPad(
  gamepad:
    | {
        readonly axes: ArrayLike<number>;
        readonly buttons: ArrayLike<{ readonly pressed: boolean }>;
      }
    | null
    | undefined,
): PadState | null {
  if (!gamepad) return null;
  const { axes, buttons } = gamepad;
  // Eixos 2 e 3: direcional analógico. Controles só com superfície de toque usam 0 e 1.
  const stick = axes.length >= 4;
  const x = (stick ? axes[2] : axes[0]) ?? 0;
  const y = (stick ? axes[3] : axes[1]) ?? 0;
  const menu = buttons[4]?.pressed === true || buttons[5]?.pressed === true;
  return { x, y, menu };
}

/** Avança o estado de uma mão e devolve as ações disparadas neste quadro. */
export function stepHand(
  previous: HandState,
  pad: PadState,
): { state: HandState; actions: HandAction[] } {
  const actions: HandAction[] = [];
  const forward = -pad.y;
  const side = Math.abs(pad.x);

  let { aiming } = previous;
  if (!aiming && forward > STICK_ON && forward > side) aiming = true;
  else if (aiming && Math.hypot(pad.x, pad.y) < STICK_OFF) {
    aiming = false;
    actions.push('teleport');
  } else if (aiming && pad.y > STICK_ON) {
    // Puxar o direcional para trás desiste do teletransporte.
    aiming = false;
    actions.push('cancelTeleport');
  }

  let { turned } = previous;
  if (aiming) turned = side > STICK_OFF;
  else if (!turned && side > STICK_ON && side > Math.abs(pad.y)) {
    turned = true;
    actions.push(pad.x > 0 ? 'turnRight' : 'turnLeft');
  } else if (turned && side < STICK_OFF) turned = false;

  if (pad.menu && !previous.menuDown) actions.push('menu');
  return { state: { aiming, turned, menuDown: pad.menu }, actions };
}
