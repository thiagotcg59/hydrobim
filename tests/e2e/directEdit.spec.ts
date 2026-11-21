import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { ctl } from './ui';

/**
 * Edição direta do traçado nas duas vistas: alças que esticam ou encolhem o tubo selecionado,
 * setas do teclado que deslizam peças ao longo da linha e o menu do botão direito, junto a
 * uma extremidade, que aciona a ferramenta Tubo a partir dela.
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function setField(page: Page, testId: string, value: string): Promise<void> {
  const field = await ctl(page, testId);
  await field.fill(value);
  await field.press('Enter');
}

async function addPoint(page: Page, x: string, y: string, z: string): Promise<void> {
  await setField(page, 'coord-x', x);
  await setField(page, 'coord-y', y);
  await setField(page, 'coord-z', z);
  await (await ctl(page, 'coord-add')).click();
}

async function start(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await (await ctl(page, 'action-new')).click();
  await expect(page.getByTestId('element-count')).toHaveText('0');
}

async function centerOf(page: Page, testId: string): Promise<[number, number]> {
  const box = await (await ctl(page, testId)).boundingBox();
  if (!box) throw new Error(`"${testId}" sem dimensões.`);
  return [box.x + box.width / 2, box.y + box.height / 2];
}

interface ExportedElement {
  kind: string;
  start?: { x: number; y: number; z: number };
  end?: { x: number; y: number; z: number };
}

test('planta: alça estica o tubo, setas deslizam a válvula e o botão direito cria tubo', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page);
  await page.getByTestId('view-mode-plan').click();
  await (await ctl(page, 'tool-pipe')).click();
  const svg = page.getByTestId('plan-svg');
  const box = await svg.boundingBox();
  if (!box) throw new Error('Planta sem dimensões.');
  const at = (x: number, y: number): [number, number] => [
    box.x + box.width / 2 + x * 100,
    box.y + box.height / 2 - y * 100,
  ];
  const message = page.getByTestId('status-message');

  // Tubo de 3 m (x de -1 a 2). As alças só aparecem em Selecionar, com o tubo selecionado.
  await page.mouse.click(...at(-1, 1));
  await page.mouse.click(...at(2, 1));
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pipe-grip-end')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(await ctl(page, 'tool-select')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(...at(0.5, 1));
  await expect(page.getByTestId('pipe-grip-start')).toHaveCount(1);
  await expect(page.getByTestId('pipe-grip-end')).toHaveCount(1);

  // Arrastar a alça final para x = 3 (fora do eixo): o tubo estica só ao longo do eixo.
  // A alça fica recuada para dentro do tubo, sem cobrir a conexão vizinha.
  const endGrip = await centerOf(page, 'pipe-grip-end');
  expect(endGrip[0]).toBeLessThan(at(2, 1)[0]);
  expect(endGrip[0]).toBeGreaterThan(at(1.8, 1)[0]);
  await page.mouse.move(...endGrip);
  await page.mouse.down();
  await page.mouse.move(...at(2.4, 1.1), { steps: 4 });
  await expect(page.getByTestId('pipe-stretch-label')).toHaveCount(1);
  await page.mouse.move(...at(3, 1.3), { steps: 4 });
  await page.mouse.up();
  await expect(message).toContainText('Comprimento de');
  await expect(message).toContainText('4,000 m');
  await expect(page.getByTestId('pipe-stretch-label')).toHaveCount(0);

  // Encolher pela alça inicial e desfazer: um único passo de histórico.
  await page.mouse.move(...(await centerOf(page, 'pipe-grip-start')));
  await page.mouse.down();
  await page.mouse.move(...at(-0.5, 1), { steps: 4 });
  await page.mouse.up();
  await expect(message).toContainText('3,500 m');
  await page.keyboard.press('Control+z');
  await page.mouse.click(...at(0.5, 1));

  // Válvula em linha em x = 0,5; as setas a deslizam ao longo do tubo.
  await (await ctl(page, 'tool-valve')).click();
  await page.mouse.click(...at(0.5, 1));
  await expect(svg.locator('[data-element-kind="valve"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.mouse.click(...at(0.5, 1));
  await page.keyboard.press('ArrowRight');
  await expect(message).toContainText('deslocado 0,100 m ao longo da linha');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(message).toContainText('deslocado 1,000 m ao longo da linha');
  // Sem espaço para mais 10 passos de 1 m: recusado, nada muda.
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(message).toContainText('Não há espaço');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');

  // Botão direito junto à extremidade livre: "Criar tubo" aciona a ferramenta a partir dela.
  await page.keyboard.press('Escape');
  await page.mouse.click(...at(3.05, 1.05), { button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await expect(page.getByTestId('context-create-pipe')).toBeEnabled();
  await expect(page.getByTestId('context-create-pipe-hint')).toContainText('A partir de Tubo');
  await page.getByTestId('context-create-pipe').click();
  await expect(page.getByTestId('context-menu')).toHaveCount(0);
  await expect(await ctl(page, 'tool-pipe')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('plan-anchor')).toHaveCount(1);
  await page.mouse.click(...at(4, 1));
  await expect(message).toHaveText('Tubo criado.');
  await expect(svg.locator('[data-element-kind="pipe"]')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Junto a uma emenda já conectada o menu aparece sem ação; longe de tudo, não aparece.
  await page.mouse.click(...at(3, 1), { button: 'right' });
  await expect(page.getByTestId('context-create-pipe')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('context-menu')).toHaveCount(0);
  await page.mouse.click(...at(0, -1), { button: 'right' });
  await expect(page.getByTestId('context-menu')).toHaveCount(0);
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');

  const download = page.waitForEvent('download');
  await (await ctl(page, 'action-export')).click();
  const exported = JSON.parse(await readFile(await (await download).path(), 'utf8')) as {
    elements: ExportedElement[];
    connections: unknown[];
  };
  const pipes = exported.elements
    .filter((e) => e.kind === 'pipe')
    .sort((a, b) => (a.start?.x ?? 0) - (b.start?.x ?? 0));
  expect(pipes).toHaveLength(3);
  // A linha continua de x = -1 a 3 (mais o trecho novo até 4); a válvula foi de 0,5 a -0,3.
  expect(pipes[0]?.start?.x).toBeCloseTo(-1);
  expect(((pipes[0]?.end?.x ?? 0) + (pipes[1]?.start?.x ?? 0)) / 2).toBeCloseTo(-0.3);
  expect(pipes[1]?.end?.x).toBeCloseTo(3);
  expect(pipes[2]?.end?.x).toBeCloseTo(4);
  expect(exported.connections).toHaveLength(3);
  expect(errors).toEqual([]);
});

test('modelo 3D: alça, setas e botão direito na extremidade do tubo', async ({ page }) => {
  const errors = trackErrors(page);
  await start(page);
  await (await ctl(page, 'tool-pipe')).click();
  await addPoint(page, '0', '0', '0');
  await addPoint(page, '2', '0', '0');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(await ctl(page, 'tool-select')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('view-ortho').click();
  await page.getByTestId('view-top').click();
  const box = await page.getByTestId('viewport-canvas').boundingBox();
  if (!box) throw new Error('Viewport sem dimensões.');
  // Vista de topo enquadrada no tubo: X do modelo para a direita, centro em x = 1.
  const middle: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];
  const message = page.getByTestId('status-message');

  // Selecionar o tubo mostra as alças nas extremidades.
  await page.mouse.click(...middle);
  await expect(page.getByTestId('pipe-grip-end')).toBeVisible();
  const grip = await centerOf(page, 'pipe-grip-end');
  const origin = await centerOf(page, 'pipe-grip-start');
  // Escala da tela (px por metro) medida pelas próprias alças: o tubo tem 2 m.
  const zoom = (grip[0] - origin[0]) / 2;
  expect(zoom).toBeGreaterThan(50);
  expect(grip[1]).toBeCloseTo(origin[1], 0);

  // Arrastar a alça final meio metro para dentro: o tubo encolhe para 1,5 m.
  await page.mouse.move(...grip);
  await page.mouse.down();
  await page.mouse.move(grip[0] - 0.25 * zoom, grip[1] + 12, { steps: 4 });
  await expect(page.getByTestId('pipe-stretch-label')).toBeVisible();
  await page.mouse.move(grip[0] - 0.5 * zoom, grip[1] + 20, { steps: 4 });
  await page.mouse.up();
  await expect(message).toContainText('1,500 m');

  // Seta para a direita: o tubo desliza um passo de grade no sentido +X.
  await page.keyboard.press('ArrowRight');
  await expect(message).toContainText('deslocado 0,100 m ao longo da linha');
  const moved = await centerOf(page, 'pipe-grip-end');
  expect(Math.abs(moved[0] - (grip[0] - 0.4 * zoom))).toBeLessThan(3);

  // Botão direito sobre a alça abre o menu; Esc fecha sem perder a seleção.
  await page.mouse.click(...moved, { button: 'right' });
  await expect(page.getByTestId('context-create-pipe')).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('context-menu')).toHaveCount(0);
  await expect(page.getByTestId('pipe-grip-end')).toBeVisible();

  // Sem seleção, o botão direito junto à extremidade (no canvas) oferece "Criar tubo".
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pipe-grip-end')).toHaveCount(0);
  await page.mouse.click(moved[0] + 6, moved[1] + 6, { button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await page.getByTestId('context-create-pipe').click();
  await expect(await ctl(page, 'tool-pipe')).toHaveAttribute('aria-pressed', 'true');
  await expect(await ctl(page, 'anchor-info')).toContainText('extremidade livre');
  await addPoint(page, '3', '0', '0');
  await expect(message).toHaveText('Tubo criado.');
  // Sem seleção, o painel mostra o resumo do projeto: dois tubos.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('element-count')).toHaveText('2');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');
  expect(errors).toEqual([]);
});

test('botão direito › Mover: ponto-base, prévia e destino, na planta e no 3D', async ({ page }) => {
  const errors = trackErrors(page);
  await start(page);
  await page.getByTestId('view-mode-plan').click();
  await (await ctl(page, 'tool-pipe')).click();
  const svg = page.getByTestId('plan-svg');
  const box = await svg.boundingBox();
  if (!box) throw new Error('Planta sem dimensões.');
  const at = (x: number, y: number): [number, number] => [
    box.x + box.width / 2 + x * 100,
    box.y + box.height / 2 - y * 100,
  ];
  const message = page.getByTestId('status-message');

  // Tubo solto de 3 m, de (-1; 1) a (2; 1), selecionado.
  await page.mouse.click(...at(-1, 1));
  await page.mouse.click(...at(2, 1));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.mouse.click(...at(0.5, 1));

  // Botão direito sobre o corpo do tubo (longe das extremidades): "Mover".
  await page.mouse.click(...at(0.5, 1), { button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await expect(page.getByTestId('context-create-pipe')).toBeDisabled();
  await expect(page.getByTestId('context-move-hint')).toContainText('Tubo');
  await page.getByTestId('context-move').click();
  await expect(page.getByTestId('context-menu')).toHaveCount(0);
  const panel = page.getByTestId('move-panel');
  await expect(panel).toHaveAttribute('data-step', 'from');

  // Ponto-base na extremidade inicial; a prévia acompanha o cursor sem alterar o modelo.
  await page.mouse.move(...at(-1, 1));
  await page.mouse.click(...at(-1, 1));
  await expect(panel).toHaveAttribute('data-step', 'to');
  await page.mouse.move(...at(0, -1), { steps: 3 });
  await expect(page.getByTestId('plan-preview-ghost').first()).toBeVisible();
  // O tubo original segue no lugar; o deslocado é só o fantasma da prévia.
  await expect(
    svg.locator('[data-element-kind="pipe"]:not([data-testid="plan-preview"] *)'),
  ).toHaveCount(1);

  // Destino: um único passo de histórico, de volta a Selecionar.
  await page.mouse.click(...at(0, -1));
  await expect(message).toContainText('movido: ΔX 1,000 m, ΔY -2,000 m, ΔZ 0,000 m');
  await expect(await ctl(page, 'tool-select')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('plan-preview-ghost')).toHaveCount(0);
  await page.keyboard.press('Control+z');

  const download = page.waitForEvent('download');
  await (await ctl(page, 'action-export')).click();
  const exported = JSON.parse(await readFile(await (await download).path(), 'utf8')) as {
    elements: ExportedElement[];
  };
  expect(exported.elements[0]?.start?.x).toBeCloseTo(-1);
  expect(exported.elements[0]?.start?.y).toBeCloseTo(1);

  // No modelo 3D, o botão direito sobre o tubo também oferece "Mover".
  await page.keyboard.press('Escape');
  await page.getByTestId('view-mode-3d').click();
  await page.getByTestId('view-ortho').click();
  await page.getByTestId('view-top').click();
  const canvas = await page.getByTestId('viewport-canvas').boundingBox();
  if (!canvas) throw new Error('Viewport sem dimensões.');
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2, {
    button: 'right',
  });
  await page.getByTestId('context-move').click();
  await expect(page.getByTestId('move-panel')).toHaveAttribute('data-step', 'from');
  // Esc volta ao ponto-base; o segundo encerra sem alterar o modelo.
  await page.keyboard.press('Escape');
  await expect(await ctl(page, 'tool-select')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');
  expect(errors).toEqual([]);
});

test('botão direito › Girar: a rede ligada gira junto, pelo cursor ou pelo ângulo', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page);
  await page.getByTestId('view-mode-plan').click();
  await (await ctl(page, 'tool-pipe')).click();
  const svg = page.getByTestId('plan-svg');
  const box = await svg.boundingBox();
  if (!box) throw new Error('Planta sem dimensões.');
  const at = (x: number, y: number): [number, number] => [
    box.x + box.width / 2 + x * 100,
    box.y + box.height / 2 - y * 100,
  ];
  const message = page.getByTestId('status-message');

  // Trecho em L: tubo, joelho e tubo, todos ligados.
  await page.mouse.click(...at(0, 0));
  await page.mouse.click(...at(3, 0));
  await page.mouse.click(...at(3, 2));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Botão direito sobre o primeiro tubo › Girar.
  await page.mouse.click(...at(1.5, 0), { button: 'right' });
  await expect(page.getByTestId('context-rotate')).toBeVisible();
  await page.getByTestId('context-rotate').click();
  const panel = page.getByTestId('rotate-panel');
  // Como no Revit, o centro já vem no meio da seleção; aqui escolhemos outro.
  await expect(panel).toHaveAttribute('data-step', 'reference');
  await expect(await ctl(page, 'rotate-with-connected')).toBeChecked();
  await page.getByTestId('rotate-pick-center').click();
  await expect(panel).toHaveAttribute('data-step', 'center');

  // Centro na extremidade livre, raio inicial a leste e final ao norte: +90°, com a prévia.
  await page.mouse.move(...at(0, 0));
  await page.mouse.click(...at(0, 0));
  await expect(panel).toHaveAttribute('data-step', 'reference');
  await page.mouse.move(...at(1, 0), { steps: 3 });
  await page.mouse.click(...at(1, 0));
  await expect(panel).toHaveAttribute('data-step', 'angle');
  await page.mouse.move(...at(0, 2), { steps: 3 });
  await expect(page.getByTestId('rotate-step')).toContainText('giro: 90°');
  await expect(page.getByTestId('plan-preview-ghost')).toHaveCount(3);
  await page.mouse.click(...at(0, 2));
  await expect(message).toContainText('3 elementos girados 90°');
  await expect(await ctl(page, 'tool-select')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');

  // Ângulo digitado, com o centro na origem do elemento: -90° desfaz o giro.
  await page.mouse.click(...at(0, 1.5), { button: 'right' });
  await page.getByTestId('context-rotate').click();
  await page.getByTestId('rotate-center-origin').click();
  await page.getByTestId('rotate-chip--90').click();
  await page.getByTestId('rotate-apply').click();
  await expect(message).toContainText('girados -90°');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');

  // Um passo de histórico por giro.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  const download = page.waitForEvent('download');
  await (await ctl(page, 'action-export')).click();
  const exported = JSON.parse(await readFile(await (await download).path(), 'utf8')) as {
    elements: ExportedElement[];
    connections: unknown[];
  };
  const first = exported.elements.find((e) => e.kind === 'pipe');
  expect(first?.start?.x).toBeCloseTo(0);
  expect(first?.start?.y).toBeCloseTo(0);
  expect(exported.connections).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('planta: janela e cruzamento selecionam; Espaço gira a seleção 90°', async ({ page }) => {
  const errors = trackErrors(page);
  await start(page);
  await page.getByTestId('view-mode-plan').click();
  await (await ctl(page, 'tool-pipe')).click();
  const svg = page.getByTestId('plan-svg');
  const box = await svg.boundingBox();
  if (!box) throw new Error('Planta sem dimensões.');
  const at = (x: number, y: number): [number, number] => [
    box.x + box.width / 2 + x * 100,
    box.y + box.height / 2 - y * 100,
  ];
  await page.mouse.click(...at(0, 0));
  await page.mouse.click(...at(3, 0));
  await page.mouse.click(...at(3, 2));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const selected = page.locator('[data-testid="plan-svg"] [data-element-id][data-selected]');

  // Da esquerda para a direita: janela contida, os três elementos do L.
  await page.mouse.move(...at(-0.5, -0.5));
  await page.mouse.down();
  await page.mouse.move(...at(3.5, 2.5), { steps: 6 });
  await expect(page.getByTestId('plan-selection-window')).toHaveAttribute('data-mode', 'contain');
  await page.mouse.up();
  await expect(page.getByTestId('plan-selection-window')).toHaveCount(0);
  await expect(selected).toHaveCount(3);

  // Da direita para a esquerda, só cortando o primeiro tubo: cruzamento.
  await page.mouse.move(...at(1.4, 0.4));
  await page.mouse.down();
  await page.mouse.move(...at(1.2, -0.4), { steps: 6 });
  await expect(page.getByTestId('plan-selection-window')).toHaveAttribute('data-mode', 'cross');
  await page.mouse.up();
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveAttribute('data-element-kind', 'pipe');

  // Espaço: 90° em torno do centro da seleção, com a rede ligada.
  await page.mouse.move(...at(-2, -2));
  await page.keyboard.press(' ');
  await expect(page.getByTestId('status-message')).toContainText('girados 90°');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');
  expect(errors).toEqual([]);
});

test('Opções de projeto: precisão de 5 cm e 1° no traçado, ajustável e lembrada', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page);
  const status = page.getByTestId('status-precision');
  await expect(status).toContainText('5 cm · 1°');
  await status.click();
  const dialog = page.getByTestId('project-options-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('precision-length-10').click();
  await page.getByTestId('precision-angle-5').click();
  await expect(status).toContainText('10 cm · 5°');
  await page.getByTestId('precision-enabled').uncheck();
  await expect(status).toContainText('Precisão desligada');
  await page.getByTestId('precision-reset').click();
  await expect(status).toContainText('5 cm · 1°');
  await page.getByTestId('project-options-close').click();
  await expect(dialog).toBeHidden();

  // Traçado na planta: o trecho sai com comprimento múltiplo de 5 cm.
  await page.getByTestId('view-mode-plan').click();
  await (await ctl(page, 'tool-pipe')).click();
  const box = await page.getByTestId('plan-svg').boundingBox();
  if (!box) throw new Error('Planta sem dimensões.');
  const at = (x: number, y: number): [number, number] => [
    box.x + box.width / 2 + x * 100,
    box.y + box.height / 2 - y * 100,
  ];
  await page.mouse.click(...at(0, 0));
  await page.mouse.move(...at(2.03, 0.004), { steps: 4 });
  await expect(page.getByTestId('status-snap')).toBeVisible();
  await page.mouse.click(...at(2.03, 0.004));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const download = page.waitForEvent('download');
  await (await ctl(page, 'action-export')).click();
  const exported = JSON.parse(await readFile(await (await download).path(), 'utf8')) as {
    elements: ExportedElement[];
  };
  const pipe = exported.elements.find((e) => e.kind === 'pipe');
  const length = Math.hypot(
    (pipe?.end?.x ?? 0) - (pipe?.start?.x ?? 0),
    (pipe?.end?.y ?? 0) - (pipe?.start?.y ?? 0),
  );
  expect(Math.abs(length * 20 - Math.round(length * 20))).toBeLessThan(1e-6);
  expect(pipe?.end?.y ?? 1).toBeCloseTo(0, 6);
  expect(errors).toEqual([]);
});
