import { expect, test, type Page } from '@playwright/test';
import { ctl } from './ui';

/**
 * Mudança de direção sem peça: até o limite que o fabricante admite para o material e o
 * diâmetro — deflexão da junta elástica ou curvatura a frio do tubo; acima dele, joelho.
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

test('ferro dúctil deflete na junta, PEAD curva a frio e PVC soldável não muda de direção sem peça', async ({
  page,
}) => {
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

  // Sem peça entre eles, os dois trechos são selecionados como um tubo só.
  await page.getByTestId('element-item').first().click();
  await expect(page.getByTestId('properties-title')).toHaveText('Tubo · 2 trechos');
  const run = page.getByTestId('pipe-run-properties');
  await expect(run).toHaveAttribute('data-count', '2');
  await expect(page.getByTestId('pipe-run-length')).toHaveText('12,01 m');
  await expect(page.getByTestId('pipe-run-turns')).toContainText('maior desvio 2,86°');
  // Um trecho isolado é aberto pela lista do painel.
  await page.getByTestId('pipe-run-segment-1').click();
  await expect(page.getByTestId('properties-scope')).toContainText('Seleção única');
  await page.keyboard.press('Escape');
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

  // PEAD: a junta não deflete, mas o tubo curva a frio (raio de 30 × DE = 3,30 m em DE 110).
  await (await ctl(page, 'tool-pipe')).click();
  await (await ctl(page, 'active-specification')).selectOption('pead-pe100-sdr11');
  await (await ctl(page, 'active-dn')).selectOption('110');
  const bend = await ctl(page, 'option-joint-deflection');
  await expect(bend).toHaveAttribute('data-kind', 'bend');
  await expect(bend).toContainText('raio mínimo de 3,30 m');
  await expect(bend).toHaveAttribute('title', /Corr Plastik.*p\. 24/);
  await addPoint(page, '0', '10', '0');
  await addPoint(page, '3', '10', '0');
  // Trecho de 1,02 m com 11,31° de desvio: cabe em 1,02 / 3,30 rad = 17,7°.
  await addPoint(page, '4', '10,2', '0');
  await expect(page.getByTestId('status-message')).toContainText(
    'Tubo criado com curvatura a frio de 11,31° no vértice',
  );
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('Escape');
  await expect(page.getByTestId('element-count')).toHaveText('5');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');
  expect(errors).toEqual([]);
});
