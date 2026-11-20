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
