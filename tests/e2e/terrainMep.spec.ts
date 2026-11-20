import { expect, test, type Page } from '@playwright/test';
import { ctl, openProjectTab } from './ui';

/**
 * Visibilidade da superfície do terreno no MEP: opcional na planta (desligada por padrão) e no
 * modelo 3D (ligada por padrão). É opção de exibição: não altera o projeto nem o histórico.
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

test('superfície do terreno opcional na planta e no 3D do MEP', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await (await ctl(page, 'action-new')).click();
  await expect(page.getByTestId('element-count')).toHaveText('0');

  await openProjectTab(page, 'terrain');
  const dialog = page.getByTestId('project-dialog');
  await dialog.getByTestId('terrain-file').setInputFiles({
    name: 'levantamento.xyz',
    mimeType: 'text/plain',
    buffer: Buffer.from('-5 -5 1.5\n20 -5 1.8\n-5 5 1.6\n20 5 2.0\n8 0 1.9\n'),
  });
  await expect(dialog.getByTestId('terrain-points')).toHaveText('5');
  await dialog.getByTestId('project-close').click();

  // Planta do MEP: superfície oculta até o usuário pedir.
  await page.getByTestId('view-mode-plan').click();
  await expect(page.getByTestId('infra-terrain')).toHaveCount(0);
  const plan = await ctl(page, 'terrain-visible-plan');
  await expect(plan).not.toBeChecked();
  await plan.check();
  await expect(page.getByTestId('infra-terrain')).toHaveCount(1);
  await plan.uncheck();
  await expect(page.getByTestId('infra-terrain')).toHaveCount(0);

  // Modelo 3D: visível por padrão; desligar e religar não gera erros.
  await page.getByTestId('view-mode-3d').click();
  await expect(page.locator('canvas')).toBeVisible();
  const model = await ctl(page, 'terrain-visible-3d');
  await expect(model).toBeChecked();
  await model.uncheck();
  await page.waitForTimeout(300);
  await model.check();
  await page.waitForTimeout(300);
  await expect(model).toBeChecked();

  // Opção de exibição: o desfazer não a alcança (o último passo do histórico é o terreno).
  await expect(page.getByTestId('action-undo')).toBeEnabled();

  expect(errors).toEqual([]);
});
