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
