import { expect, test, type Page } from '@playwright/test';
import { ctl } from './ui';

/**
 * Deflexão na junta: tubos de junta elástica mudam de direção sem peça até o limite que o
 * fabricante admite para o material e o diâmetro; acima dele, o traçado exige joelho.
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

test('ferro dúctil deflete até 5° na junta; PVC soldável não deflete', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await (await ctl(page, 'action-new')).click();
  await expect(page.getByTestId('element-count')).toHaveText('0');
  await (await ctl(page, 'tool-pipe')).click();

  // Junta elástica de ferro dúctil DN 150: o painel informa o limite e a fonte.
  await (await ctl(page, 'active-specification')).selectOption('ferro-ductil-nbr7675-k9');
  await (await ctl(page, 'active-dn')).selectOption('150');
  const info = await ctl(page, 'option-joint-deflection');
  await expect(info).toHaveAttribute('data-degrees', '5');
  await expect(info).toContainText('até 5° de deflexão por junta');
  await expect(info).toHaveAttribute('title', /Saint-Gobain Canalização.*p\. 14/);

  // 0,30 m de desvio em 6 m (2,86°): um tubo, sem joelho.
  await addPoint(page, '0', '0', '0');
  await addPoint(page, '6', '0', '0');
  await addPoint(page, '12', '0,3', '0');
  await expect(page.getByTestId('status-message')).toHaveText(
    'Tubo criado com deflexão de 2,86° na junta (admitida: 5°).',
  );

  // A entrada por valores oferece a deflexão máxima da junta.
  await expect(await ctl(page, 'segment-deflection-joint')).toHaveText(
    '5° (máx. na junta, sem peça)',
  );

  // Acima do limite e sem joelho desse ângulo: recusado, com o que a junta admite.
  await addPoint(page, '18', '1,5', '0');
  await expect(page.getByTestId('status-message')).toContainText(
    'Sem peça, a junta admite deflexão de até 5°',
  );
  // A contagem aparece com a seleção vazia: encerra o trecho, a ferramenta e a seleção.
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('Escape');
  await expect(page.getByTestId('element-count')).toHaveText('2');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');

  // PVC soldável: junta rígida, a mesma deflexão pequena é recusada.
  await (await ctl(page, 'tool-pipe')).click();
  await (await ctl(page, 'active-specification')).selectOption('pvc-soldavel-nbr5648');
  await expect(await ctl(page, 'option-joint-deflection')).toContainText('Junta rígida');
  await addPoint(page, '0', '5', '0');
  await addPoint(page, '3', '5', '0');
  await addPoint(page, '6', '5,15', '0');
  await expect(page.getByTestId('status-message')).toContainText('Não há joelho de');
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('Escape');
  await expect(page.getByTestId('element-count')).toHaveText('3');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');
  expect(errors).toEqual([]);
});
