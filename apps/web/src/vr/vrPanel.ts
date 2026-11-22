/**
 * Painéis da realidade virtual (menu e propriedades): texto e botões desenhados em um canvas 2D
 * e aplicados como textura a um plano na cena. O layout e o teste de acerto são funções puras;
 * só `drawPanel` toca o canvas.
 *
 * Tamanhos pensados para o headset: com o painel de 0,62 m de largura a cerca de 1,1 m dos
 * olhos, a linha de texto (44 px em 1024) subtende mais de 1,3° — legível no Quest 2 — e os
 * botões têm mais de 6 cm de altura, alvos fáceis para o raio do controle.
 */

export const PANEL_WIDTH_PX = 1024;
/** Largura do painel na cena (m). */
export const PANEL_WIDTH_M = 0.62;

const PADDING = 36;
const TITLE_HEIGHT = 92;
const ROW_HEIGHT = 62;
const BUTTON_HEIGHT = 104;
const GAP = 14;

export interface PanelButton {
  readonly id: string;
  readonly label: string;
  /** Opção ligada (alternadores). */
  readonly active?: boolean;
  /** Ocupa a largura toda; os demais vão dois por linha. */
  readonly wide?: boolean;
  /** Ação de saída ou destrutiva: cor de alerta. */
  readonly danger?: boolean;
}

export interface PanelSpec {
  readonly title: string;
  readonly rows?: readonly (readonly [label: string, value: string])[];
  /** Texto corrido abaixo das linhas (instruções, avisos). */
  readonly note?: string;
  readonly buttons?: readonly PanelButton[];
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type PanelItem =
  | { readonly kind: 'title'; readonly rect: Rect; readonly text: string }
  | { readonly kind: 'row'; readonly rect: Rect; readonly label: string; readonly value: string }
  | { readonly kind: 'note'; readonly rect: Rect; readonly lines: readonly string[] }
  | { readonly kind: 'button'; readonly rect: Rect; readonly button: PanelButton };

export interface PanelLayout {
  readonly width: number;
  readonly height: number;
  readonly items: readonly PanelItem[];
}

/** Quebra o texto em linhas de até `limit` caracteres, sem cortar palavras. */
export function wrapText(text: string, limit: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > limit) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** Posição de cada parte do painel, em pixels do canvas (origem no canto superior esquerdo). */
export function layoutPanel(spec: PanelSpec, width = PANEL_WIDTH_PX): PanelLayout {
  const items: PanelItem[] = [];
  const inner = width - 2 * PADDING;
  let y = PADDING;
  items.push({
    kind: 'title',
    rect: { x: PADDING, y, width: inner, height: TITLE_HEIGHT },
    text: spec.title,
  });
  y += TITLE_HEIGHT + GAP;
  for (const [label, value] of spec.rows ?? []) {
    items.push({
      kind: 'row',
      rect: { x: PADDING, y, width: inner, height: ROW_HEIGHT },
      label,
      value,
    });
    y += ROW_HEIGHT;
  }
  if (spec.rows?.length) y += GAP;
  if (spec.note) {
    const lines = wrapText(spec.note, 46);
    const height = lines.length * 50 + 12;
    items.push({ kind: 'note', rect: { x: PADDING, y, width: inner, height }, lines });
    y += height + GAP;
  }
  const half = (inner - GAP) / 2;
  let column = 0;
  for (const button of spec.buttons ?? []) {
    if (button.wide) {
      if (column === 1) {
        y += BUTTON_HEIGHT + GAP;
        column = 0;
      }
      items.push({
        kind: 'button',
        rect: { x: PADDING, y, width: inner, height: BUTTON_HEIGHT },
        button,
      });
      y += BUTTON_HEIGHT + GAP;
      continue;
    }
    items.push({
      kind: 'button',
      rect: { x: PADDING + column * (half + GAP), y, width: half, height: BUTTON_HEIGHT },
      button,
    });
    if (column === 1) y += BUTTON_HEIGHT + GAP;
    column = 1 - column;
  }
  if (column === 1) y += BUTTON_HEIGHT + GAP;
  return { width, height: Math.ceil(y - GAP + PADDING), items };
}

/**
 * Botão sob o ponto (u, v) da textura — u da esquerda para a direita, v de baixo para cima,
 * como as coordenadas de textura do plano. `null` fora de qualquer botão.
 */
export function hitPanel(layout: PanelLayout, u: number, v: number): PanelButton | null {
  const x = u * layout.width;
  const y = (1 - v) * layout.height;
  for (const item of layout.items) {
    if (item.kind !== 'button') continue;
    const { rect } = item;
    if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
      return item.button;
    }
  }
  return null;
}

/** Altura do painel na cena (m), mantendo a proporção do canvas. */
export const panelHeightM = (layout: PanelLayout): number =>
  (PANEL_WIDTH_M * layout.height) / layout.width;

const FONT = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Trunca o texto com reticências para caber na largura. */
function fit(context: CanvasRenderingContext2D, text: string, width: number): string {
  if (context.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && context.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** Desenha o painel no canvas (alto contraste: claro sobre azul-marinho). */
export function drawPanel(
  canvas: HTMLCanvasElement,
  layout: PanelLayout,
  hoveredId: string | null,
): void {
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.fillStyle = '#0d1b2e';
  context.fillRect(0, 0, layout.width, layout.height);
  context.strokeStyle = '#4fb6d6';
  context.lineWidth = 6;
  context.strokeRect(3, 3, layout.width - 6, layout.height - 6);
  context.textBaseline = 'middle';

  for (const item of layout.items) {
    const { rect } = item;
    const middle = rect.y + rect.height / 2;
    if (item.kind === 'title') {
      context.font = `600 56px ${FONT}`;
      context.fillStyle = '#ffffff';
      context.textAlign = 'left';
      context.fillText(fit(context, item.text, rect.width), rect.x, middle);
      context.fillStyle = '#4fb6d6';
      context.fillRect(rect.x, rect.y + rect.height - 4, rect.width, 4);
    } else if (item.kind === 'row') {
      context.font = `400 40px ${FONT}`;
      context.fillStyle = '#9fc4dc';
      context.textAlign = 'left';
      context.fillText(fit(context, item.label, rect.width * 0.38), rect.x, middle);
      context.font = `600 44px ${FONT}`;
      context.fillStyle = '#ffffff';
      context.textAlign = 'right';
      context.fillText(fit(context, item.value, rect.width * 0.6), rect.x + rect.width, middle);
    } else if (item.kind === 'note') {
      context.font = `400 40px ${FONT}`;
      context.fillStyle = '#d6e4ef';
      context.textAlign = 'left';
      item.lines.forEach((line, index) => {
        context.fillText(line, rect.x, rect.y + 28 + index * 50);
      });
    } else {
      const { button } = item;
      const hovered = button.id === hoveredId;
      context.fillStyle = button.danger
        ? hovered
          ? '#d9534a'
          : '#a83a33'
        : button.active
          ? hovered
            ? '#2aa6c8'
            : '#1b86a6'
          : hovered
            ? '#3a5375'
            : '#24364f';
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
      context.strokeStyle = hovered ? '#ffffff' : '#5d7da3';
      context.lineWidth = hovered ? 6 : 3;
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
      context.font = `600 42px ${FONT}`;
      context.fillStyle = '#ffffff';
      context.textAlign = 'center';
      // O estado ligado tem um sinal além da cor.
      const label =
        button.active === undefined ? button.label : `${button.active ? '☑' : '☐'} ${button.label}`;
      context.fillText(fit(context, label, rect.width - 28), rect.x + rect.width / 2, middle);
    }
  }
}
