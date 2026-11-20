import { expect, test, type Page } from '@playwright/test';
import { ctl } from './ui';

/**
 * Continuidade entre a planta e o modelo 3D (ferramenta, trecho em andamento e ponto de
 * interesse preservados) e comandos de vista: isométrica ortográfica por quadrante,
 * perspectiva como comando separado e enquadramento da seleção.
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function start(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await (await ctl(page, 'action-new')).click();
  await expect(page.getByTestId('element-count')).toHaveText('0');
}

const viewBoxOf = async (page: Page): Promise<number[]> =>
  ((await page.getByTestId('plan-svg').getAttribute('viewBox')) ?? '').split(' ').map(Number);

test('trocar de vista mantém a ferramenta, o trecho em andamento e o ponto de interesse', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page);
  await page.getByTestId('view-mode-plan').click();
  await (await ctl(page, 'tool-pipe')).click();
  const svg = page.getByTestId('plan-svg');
  const box = await svg.boundingBox();
  if (!box) throw new Error('Planta sem dimensões.');
  const center: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];

  await page.mouse.click(center[0] - 100, center[1]);
  await page.mouse.click(center[0] + 200, center[1]);
  await expect(page.getByTestId('plan-anchor')).toHaveCount(1);
  // Aproxima sobre a ponta do trecho e desloca a vista.
  await page.mouse.move(center[0] + 200, center[1]);
  await page.mouse.wheel(0, -400);
  await page.mouse.move(center[0], center[1] + 60);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(center[0] - 80, center[1] + 20, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  const before = await viewBoxOf(page);

  // No modelo 3D a ferramenta e o trecho continuam ativos.
  await page.getByTestId('view-mode-3d').click();
  await expect(page.getByTestId('viewport-canvas')).toBeVisible();
  await expect(await ctl(page, 'tool-pipe')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('status-mode')).toContainText('aguardando ponto final');
  await expect(await ctl(page, 'anchor-info')).toContainText('extremidade livre');

  // De volta à planta: mesmo trecho em andamento, mesmo centro e mesma ampliação.
  await page.getByTestId('view-mode-plan').click();
  await expect(page.getByTestId('plan-anchor')).toHaveCount(1);
  await expect(await ctl(page, 'tool-pipe')).toHaveAttribute('aria-pressed', 'true');
  const after = await viewBoxOf(page);
  expect(after).toHaveLength(4);
  for (let i = 0; i < 4; i += 1) {
    expect(after[i]).toBeCloseTo(before[i] ?? Number.NaN, 3);
  }

  // O trecho começado antes da troca termina normalmente.
  await page.mouse.click(center[0], center[1] - 150);
  await expect(svg.locator('[data-element-kind="pipe"]')).toHaveCount(2);
  await expect(svg.locator('[data-element-kind="elbow"]')).toHaveCount(1);
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');
  expect(errors).toEqual([]);
});

test('isométrica ortográfica por quadrante, perspectiva separada e enquadrar seleção', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page);
  const iso = page.getByTestId('view-isometric');
  const ortho = page.getByTestId('view-ortho');
  await expect(iso).toHaveAttribute('data-quadrant', 'none');
  await expect(page.getByTestId('view-fit-selection')).toBeDisabled();

  await iso.click();
  await expect(iso).toHaveAttribute('data-quadrant', 'isoSE');
  await expect(ortho).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('status-message')).toContainText('sudeste');
  await iso.click();
  await expect(iso).toHaveAttribute('data-quadrant', 'isoSW');

  // Perspectiva é outro comando: desliga a ortográfica e a isométrica deixa de estar ativa.
  await page.getByTestId('view-iso').click();
  await expect(ortho).toHaveAttribute('aria-pressed', 'false');
  await expect(iso).toHaveAttribute('data-quadrant', 'none');

  // Com um elemento selecionado, o enquadramento da seleção fica disponível.
  await (await ctl(page, 'tool-pipe')).click();
  for (const x of ['0', '2']) {
    const field = await ctl(page, 'coord-x');
    await field.fill(x);
    await field.press('Enter');
    await (await ctl(page, 'coord-add')).click();
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('view-fit-selection')).toBeEnabled();
  await iso.click();
  await page.getByTestId('view-fit-selection').click();
  await expect(iso).toHaveAttribute('data-quadrant', 'none');
  await expect(ortho).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('com algo selecionado, o giro e o zoom da vista são focados na seleção', async ({ page }) => {
  const errors = trackErrors(page);
  await start(page);
  // Dois tubos em L (com o joelho): a seleção por janela pega os três elementos.
  await (await ctl(page, 'tool-pipe')).click();
  for (const [x, y] of [
    ['0', '0'],
    ['2', '0'],
    ['2', '2'],
  ] as const) {
    for (const [id, value] of [
      ['coord-x', x],
      ['coord-y', y],
    ] as const) {
      const field = await ctl(page, id);
      await field.fill(value);
      await field.press('Enter');
    }
    await (await ctl(page, 'coord-add')).click();
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  const canvas = page.getByTestId('viewport-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Viewport sem dimensões.');
  const center: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];
  const reach = (Math.min(box.width, box.height) / 2) * 0.95;
  const selectAll = async (): Promise<void> => {
    await page.mouse.move(center[0] - reach, center[1] - reach);
    await page.mouse.down();
    await page.mouse.move(center[0] + reach, center[1] + reach, { steps: 6 });
    await page.mouse.up();
  };
  const drag = async (button: 'middle' | 'right', dx: number): Promise<void> => {
    await page.mouse.move(center[0], center[1] + 120);
    await page.mouse.down({ button });
    await page.mouse.move(center[0] + dx, center[1] + 120, { steps: 6 });
    await page.mouse.up({ button });
  };
  /** Centro observado, lido pela planta (que retoma o ponto de interesse do modelo 3D). */
  const focusCenter = async (): Promise<[number, number]> => {
    await page.getByTestId('view-mode-plan').click();
    // A planta abre na vista inicial e só depois assume o ponto de interesse; na volta, os
    // controles de órbita levam alguns quadros para existir. Não há sinal no DOM para esperar.
    await page.waitForTimeout(400);
    const [x = 0, y = 0, w = 0, h = 0] = await viewBoxOf(page);
    await page.getByTestId('view-mode-3d').click();
    await expect(canvas).toBeVisible();
    await page.waitForTimeout(400);
    return [x + w / 2, y + h / 2];
  };
  const gap = (a: [number, number], b: [number, number]): number =>
    Math.hypot(a[0] - b[0], a[1] - b[1]);

  await page.getByTestId('view-fit').click();
  await selectAll();
  await expect(page.getByTestId('view-fit-selection')).toBeEnabled();

  // Tira a seleção do centro da tela: o alvo dos controles deixa de coincidir com ela.
  await drag('right', 160);
  const panned = await focusCenter();

  // Com seleção, o giro é em torno dela: o centro da tela percorre um arco no modelo.
  await drag('middle', 180);
  const orbited = await focusCenter();
  expect(gap(panned, orbited)).toBeGreaterThan(0.05);

  // Com seleção, o zoom aproxima em direção a ela: o centro da tela anda para a seleção.
  const wheel = async (): Promise<void> => {
    await page.mouse.move(center[0], center[1]);
    await page.mouse.wheel(0, -300);
    await page.mouse.wheel(0, -300);
  };
  await wheel();
  const zoomed = await focusCenter();
  expect(gap(orbited, zoomed)).toBeGreaterThan(0.01);

  // Sem seleção, o giro e o zoom voltam a ser em relação ao centro da tela, que não sai do lugar.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('view-fit-selection')).toBeDisabled();
  await drag('middle', 180);
  await wheel();
  const free = await focusCenter();
  expect(gap(zoomed, free)).toBeLessThan(1e-3);
  expect(errors).toEqual([]);
});
