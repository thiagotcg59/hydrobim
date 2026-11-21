import { expect, test, type Page } from '@playwright/test';
import { ctl } from './ui';

/**
 * Peça na linha: cotas de cada extremidade até o próximo elemento (ligáveis e desligáveis),
 * cota digitada no painel e alça que desliza a peça entre os tubos, na planta e no 3D.
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function lengthOf(page: Page, testId: string): Promise<number> {
  const value = await page.locator(`[data-testid="${testId}"]`).first().getAttribute('data-length');
  return Number(value);
}

test('válvula na linha: cotas até os vizinhos, cota digitada e arrasto pela alça', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await (await ctl(page, 'action-new')).click();
  await page.getByTestId('view-mode-plan').click();
  const svg = page.getByTestId('plan-svg');
  const box = await svg.boundingBox();
  if (!box) throw new Error('Planta sem dimensões.');
  const at = (x: number, y: number): [number, number] => [
    box.x + box.width / 2 + x * 100,
    box.y + box.height / 2 - y * 100,
  ];
  const message = page.getByTestId('status-message');

  // Tubo de 3 m (x de -1 a 2) e válvula em x = 0,5.
  await (await ctl(page, 'tool-pipe')).click();
  await page.mouse.click(...at(-1, 1));
  await page.mouse.click(...at(2, 1));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await (await ctl(page, 'tool-valve')).click();
  await page.mouse.click(...at(0.5, 1));
  await expect(svg.locator('[data-element-kind="valve"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.mouse.click(...at(0.5, 1));

  // Cotas das duas extremidades, até as pontas livres: somadas à válvula dão os 3 m.
  const a = svg.getByTestId('inline-clearance-a');
  const b = svg.getByTestId('inline-clearance-b');
  await expect(a).toHaveCount(1);
  await expect(b).toHaveCount(1);
  const a0 = await lengthOf(page, 'inline-clearance-a');
  const b0 = await lengthOf(page, 'inline-clearance-b');
  expect(a0).toBeGreaterThan(1);
  expect(a0 + b0).toBeLessThan(3);
  await expect(page.getByTestId('section-inline-clearances')).toBeVisible();

  // Cota digitada: a válvula desliza e o outro lado compensa.
  const input = page.getByTestId('inline-clearance-input-a');
  await input.fill('1');
  await input.press('Enter');
  await expect(a).toHaveAttribute('data-length', '1.0000');
  expect(await lengthOf(page, 'inline-clearance-b')).toBeCloseTo(b0 + (a0 - 1), 3);

  // Arrasto pela alça: +0,5 m em X aumenta a cota "a" em 0,5 m; um passo no histórico.
  const grip = await svg.getByTestId('inline-grip').boundingBox();
  if (!grip) throw new Error('Alça sem dimensões.');
  const from: [number, number] = [grip.x + grip.width / 2, grip.y + grip.height / 2];
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(from[0] + 25, from[1] + 10, { steps: 3 });
  await page.mouse.move(from[0] + 50, from[1] + 20, { steps: 3 });
  await page.mouse.up();
  await expect(message).toContainText('reposicionado na linha');
  expect(await lengthOf(page, 'inline-clearance-a')).toBeCloseTo(1.5, 2);
  await page.keyboard.press('Control+z');
  await expect(a).toHaveAttribute('data-length', '1.0000');

  // Desligadas, as cotas somem das vistas; a alça continua.
  await page.getByTestId('inline-clearances-toggle').uncheck();
  await expect(a).toHaveCount(0);
  await expect(svg.getByTestId('inline-grip')).toHaveCount(1);
  await page.getByTestId('inline-clearances-toggle').check();
  await expect(a).toHaveCount(1);

  // No modelo 3D, as mesmas cotas e a alça.
  await page.getByTestId('view-mode-3d').click();
  await expect(page.getByTestId('viewport-inline-clearance-a')).toContainText('1,000 m');
  await expect(page.getByTestId('inline-grip')).toHaveCount(1);

  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');
  expect(errors).toEqual([]);
});
