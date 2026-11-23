import { expect, test, type Page } from '@playwright/test';
import { ctl, openProjectTab } from './ui';

/**
 * Superfície do terreno no MEP: à mostra na planta e no modelo 3D (as duas opcionais), preenchida
 * na planta como no 3D, e selecionável como elemento, com parâmetros e dados IFC. A exibição é
 * opção da sessão: não altera o projeto nem o histórico.
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function screenOf(page: Page, x: number, y: number): Promise<[number, number]> {
  const plan = page.getByTestId('plan-view');
  const box = await page.getByTestId('plan-svg').boundingBox();
  if (!box) throw new Error('Planta sem dimensões.');
  const mpp = Number(await plan.getAttribute('data-mpp'));
  const [cx, cy] = ((await plan.getAttribute('data-center')) ?? '0;0').split(';').map(Number) as [
    number,
    number,
  ];
  return [box.x + box.width / 2 + (x - cx) / mpp, box.y + box.height / 2 - (y - cy) / mpp];
}

async function zoomTo(page: Page, target: number): Promise<void> {
  const plan = page.getByTestId('plan-view');
  const box = await page.getByTestId('plan-svg').boundingBox();
  if (!box) throw new Error('Planta sem dimensões.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const mpp = Number(await plan.getAttribute('data-mpp'));
  await page.mouse.wheel(0, Math.log(target / mpp) / 0.0015);
  await expect.poll(async () => Number(await plan.getAttribute('data-mpp'))).toBeCloseTo(target, 2);
}

async function clickModel(page: Page, x: number, y: number): Promise<void> {
  const [px, py] = await screenOf(page, x, y);
  await page.mouse.click(px, py);
}

test('superfície do terreno na planta e no 3D do MEP: preenchida, opcional e selecionável', async ({
  page,
}) => {
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

  // Planta do MEP: a superfície aparece preenchida, com as cores do modelo 3D.
  await page.getByTestId('view-mode-plan').click();
  await expect(page.getByTestId('infra-terrain')).toHaveCount(1);
  const fill = page.getByTestId('terrain-plan-fill');
  await expect(fill).toHaveAttribute('data-fill', 'elevation');
  await expect(page.getByTestId('terrain-plan-colors')).toHaveAttribute(
    'href',
    /^data:image\/png;base64,/,
  );
  await (await ctl(page, 'terrain-color-mode')).selectOption('slope');
  await expect(fill).toHaveAttribute('data-fill', 'slope');
  // Mapa sem georreferência: a superfície segue com a cor, e o motivo é dito na planta.
  await (await ctl(page, 'terrain-color-mode')).selectOption('map:osm-standard');
  await expect(fill).toHaveAttribute('data-fill', 'slope');
  await expect(page.getByTestId('terrain-plan-notice')).toHaveAttribute('data-state', 'blocked');
  await expect(page.getByTestId('terrain-plan-map')).toHaveCount(0);
  await (await ctl(page, 'terrain-color-mode')).selectOption('elevation');
  await expect(page.getByTestId('terrain-plan-notice')).toHaveCount(0);
  // Sem o preenchimento ficam o limite e as curvas; sem a superfície, nada.
  const planFill = await ctl(page, 'terrain-plan-fill-toggle');
  await expect(planFill).toBeChecked();
  await planFill.uncheck();
  await expect(fill).toHaveCount(0);
  await expect(page.getByTestId('infra-terrain')).toHaveCount(1);
  await planFill.check();
  await expect(fill).toHaveCount(1);
  const plan = await ctl(page, 'terrain-visible-plan');
  await expect(plan).toBeChecked();
  await plan.uncheck();
  await expect(page.getByTestId('infra-terrain')).toHaveCount(0);
  await expect(fill).toHaveCount(0);
  await plan.check();
  await expect(page.getByTestId('infra-terrain')).toHaveCount(1);

  // A superfície é um elemento: o clique sobre ela a seleciona e mostra os parâmetros e o IFC.
  await zoomTo(page, 0.05);
  await clickModel(page, 2, 2);
  await expect(page.getByTestId('properties-type')).toHaveText('Superfície topográfica');
  await expect(page.getByTestId('terrain-surface-selected')).toHaveCount(1);
  await expect(page.getByTestId('terrain-prop-area')).toHaveText('250,0 m²');
  await expect(page.getByTestId('terrain-ifc-entity')).toHaveText('IfcGeographicElement');
  await expect(page.getByTestId('terrain-ifc-predefined')).toHaveText('TERRAIN');
  await expect(page.getByTestId('terrain-ifc-guid')).toHaveText(/^[0-9A-Za-z_$]{22}$/);
  await expect(page.getByTestId('terrain-ifc-MinElevation')).toHaveText('1,5 m');
  await expect(page.getByTestId('terrain-ifc-ProjectedArea')).toHaveText('250 m²');
  // O que o levantamento não declara fica sem valor até o usuário informar.
  await expect(page.getByTestId('terrain-ifc-VerticalAccuracy')).toHaveText('não informado');
  const accuracy = page.getByTestId('terrain-prop-accuracy');
  await accuracy.fill('0,05');
  await accuracy.press('Enter');
  await expect(page.getByTestId('terrain-ifc-VerticalAccuracy')).toHaveText('0,05 m');
  const name = page.getByTestId('terrain-prop-name');
  await name.fill('Terreno do lote');
  await name.press('Enter');
  await expect(page.getByTestId('properties-title')).toHaveText('Terreno do lote');
  // Clique fora da superfície: nada fica selecionado.
  await clickModel(page, -12, 0);
  await expect(page.getByTestId('terrain-surface-selected')).toHaveCount(0);
  await expect(page.getByTestId('properties-type')).not.toHaveText('Superfície topográfica');

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

  // No 3D o clique sobre a superfície também a seleciona.
  const canvas = await page.locator('canvas').first().boundingBox();
  if (!canvas) throw new Error('Modelo 3D sem dimensões.');
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await expect(page.getByTestId('properties-type')).toHaveText('Superfície topográfica');
  await expect(page.getByTestId('properties-title')).toHaveText('Terreno do lote');

  // Opção de exibição: o desfazer não a alcança (o último passo do histórico é o terreno).
  await expect(page.getByTestId('action-undo')).toBeEnabled();

  expect(errors).toEqual([]);
});
