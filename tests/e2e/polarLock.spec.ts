import { expect, test, type Page } from '@playwright/test';
import { ctl } from './ui';

/**
 * Trava de ângulo com Shift no traçado de tubos: o primeiro trecho fica nos eixos do projeto
 * e os seguintes a 0°, 45° ou 90° do tubo de partida.
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

test('planta: Shift trava o primeiro trecho nos eixos e os seguintes a 45° e 90°', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await (await ctl(page, 'action-new')).click();
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

  // Primeiro trecho: cursor 0,35 m fora do eixo X; com Shift o tubo sai horizontal.
  await page.mouse.click(...at(-2, 0));
  await page.keyboard.down('Shift');
  await page.mouse.move(...at(0, 0.3));
  await page.mouse.move(...at(0, 0.35));
  await page.mouse.click(...at(0, 0.35));
  await expect(message).toHaveText('Tubo criado.');

  // Segundo trecho: cursor a ~38° do tubo; com Shift entra o joelho de 45° de catálogo.
  await page.mouse.move(...at(1, 0.7));
  await page.mouse.click(...at(1, 0.8));
  await expect(message).toHaveText('Tubo criado com joelho automático.');
  await page.keyboard.up('Shift');
  await expect(svg.locator('[data-element-kind="elbow"]')).toHaveCount(1);
  await expect(svg.locator('[data-element-kind="pipe"]')).toHaveCount(2);

  // O primeiro tubo ficou sobre o eixo X: o painel mostra o início em X = -2 e nenhuma
  // coordenada com o desvio de 0,35 m que o cursor indicava.
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('Escape');
  await page.locator('[data-testid="element-item"][data-element-kind="pipe"]').first().click();
  const panel = page.getByTestId('properties-panel');
  await expect(panel).toContainText('-2,00');
  await expect(panel).not.toContainText('0,35');
  // O joelho criado é o de 45°, peça de catálogo.
  await page.locator('[data-testid="element-item"][data-element-kind="elbow"]').first().click();
  await expect(panel).toContainText('45');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');
  expect(errors).toEqual([]);
});
