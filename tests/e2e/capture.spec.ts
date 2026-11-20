import { expect, test, type Page } from '@playwright/test';
import { ctl } from './ui';

/**
 * Captura de pontos nas duas vistas: raio constante na tela em qualquer zoom e projeção,
 * identificação do que foi capturado, alternância de portas sobrepostas também no 3D e
 * distinção entre referência geométrica e conexão (cruzamento em planta não conecta).
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

test('planta: tubo em outra cota é referência — cruzar ou clicar sobre ele não conecta', async ({
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

  // Tubo na cota 0 e, depois, um traçado 1 m acima que termina com o cursor sobre ele.
  await page.mouse.click(...at(-1, 1));
  await page.mouse.click(...at(2, 1));
  await page.keyboard.press('Escape');
  await setField(page, 'option-pipe-elevation', '1');
  await page.mouse.click(...at(0.5, -0.5));
  await page.mouse.move(...at(0.5, 0.9));
  await page.mouse.move(...at(0.5, 1));
  await expect(page.getByTestId('plan-snap-info')).toContainText('cruzamento sem conexão');
  await expect(page.getByTestId('plan-snap-info')).toContainText('1,00 m abaixo');
  await expect(page.getByTestId('status-snap')).toContainText('cruzamento sem conexão');
  await page.mouse.click(...at(0.5, 1));

  await expect(page.getByTestId('status-message')).toHaveText('Tubo criado.');
  await expect(svg.locator('[data-element-kind="tee"]')).toHaveCount(0);
  await expect(svg.locator('[data-element-kind="pipe"]')).toHaveCount(2);
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');

  // Na mesma cota, o tê automático continua valendo e é anunciado antes do clique.
  await page.keyboard.press('Escape');
  await setField(page, 'option-pipe-elevation', '0');
  await page.mouse.click(...at(1.5, -0.5));
  await page.mouse.move(...at(1.5, 0.9));
  await page.mouse.move(...at(1.5, 1));
  await expect(page.getByTestId('plan-snap-info')).toContainText('Tê automático no tubo');
  await page.mouse.click(...at(1.5, 1));
  await expect(svg.locator('[data-element-kind="tee"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('3D ortográfico: a porta só captura perto do cursor e Tab alterna as sobrepostas', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page);
  // Dois tubos sobrepostos em planta, nas cotas 0 e 3 m.
  await (await ctl(page, 'tool-pipe')).click();
  await addPoint(page, '0', '0', '0');
  await addPoint(page, '1', '0', '0');
  await page.keyboard.press('Escape');
  await addPoint(page, '0', '0', '3');
  await addPoint(page, '1', '0', '3');
  await page.keyboard.press('Escape');

  await page.getByTestId('view-ortho').click();
  await page.getByTestId('view-top').click();
  await (await ctl(page, 'tool-pipe')).click();
  const box = await page.getByTestId('viewport-canvas').boundingBox();
  if (!box) throw new Error('Viewport sem dimensões.');
  // Vista de topo enquadrada: X do modelo para a direita; a escala vem do raio enquadrado.
  const radius = Math.hypot(1, 3) / 2;
  const zoom = Math.min(box.width, box.height) / (2 * radius * 1.2);
  const end: [number, number] = [box.x + box.width / 2 + 0.5 * zoom, box.y + box.height / 2];
  const snap = page.getByTestId('status-snap');

  // A 60 px da porta nada é capturado (antes a porta capturava a tela inteira).
  await page.mouse.move(end[0], end[1] - 80);
  await page.mouse.move(end[0], end[1] - 60);
  await expect(snap).not.toContainText('Extremidade livre');
  await expect(page.getByTestId('viewport-snap-label')).toHaveCount(0);

  // Sobre a porta: captura, identifica o elemento e a cota e informa o empilhamento.
  await page.mouse.move(end[0] + 2, end[1]);
  await page.mouse.move(...end);
  const label = page.getByTestId('viewport-snap-label');
  await expect(label).toContainText('Extremidade livre');
  await expect(label).toContainText('2 sobrepostas — Tab alterna');
  await expect(label).toContainText('Z 3,00 m');
  await page.keyboard.press('Tab');
  await expect(label).toContainText('Z 0,00 m');
  await page.keyboard.press('Tab');
  await expect(label).toContainText('Z 3,00 m');
  expect(errors).toEqual([]);
});
