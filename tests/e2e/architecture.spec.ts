import { expect, test, type Page } from '@playwright/test';

/**
 * Arquitetura no navegador real: demonstração "Edificação simples", troca de ambiente sem
 * perda, parede e porta criadas pela planta, edição pelo painel com o quantitativo
 * acompanhando, recusa de edição impossível, desfazer/refazer e salvar/reabrir.
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

/** Posição na tela de um ponto do modelo, pela janela atual da planta. */
async function planPoint(page: Page, x: number, y: number): Promise<[number, number]> {
  const plan = page.getByTestId('plan-view');
  const box = await page.getByTestId('plan-svg').boundingBox();
  const mpp = Number(await plan.getAttribute('data-mpp'));
  const [cx, cy] = ((await plan.getAttribute('data-center')) ?? '0;0').split(';').map(Number);
  if (!box || !Number.isFinite(mpp) || cx === undefined || cy === undefined) {
    throw new Error('Planta sem dimensões.');
  }
  return [box.x + box.width / 2 + (x - cx) / mpp, box.y + box.height / 2 - (y - cy) / mpp];
}

const GROSS_SIDE = 'arch-value-Qto_WallBaseQuantities.GrossSideArea';

test('arquitetura: demonstração, ambientes, parede e porta pela planta, painel e persistência', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();

  // Demonstração "Edificação simples", ao lado da demonstração da rede.
  await page.getByTestId('menu-file').click();
  await page.getByTestId('action-open').click();
  await page.getByTestId('open-demo-building').click();
  await expect(page.getByTestId('environment-architecture')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('nav-arch-count')).toHaveText('14 de arquitetura');
  await expect(page.getByTestId('nav-summary')).toContainText('3 elementos');
  await expect(page.getByTestId('ribbon-group-arch-create')).toBeVisible();

  await page.getByTestId('view-mode-plan').click();
  await page.getByTestId('view-fit').click();
  const drawn = page.getByTestId('arch-plan-element');
  const network = page.getByTestId('plan-svg').locator('[data-element-id]');
  await expect(drawn).toHaveCount(14);
  await expect(network).toHaveCount(3);
  await expect(page.getByTestId('arch-space-label').first()).toContainText('Sala');
  await expect(page.getByTestId('arch-space-label').first()).toContainText('m²');

  // Arquitetura → MEP → Arquitetura: mesmo projeto, mesmos elementos, nas duas direções.
  const idsBefore = await page
    .getByTestId('arch-item')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-arch-id')).sort());
  expect(idsBefore).toHaveLength(14);
  await page.getByTestId('environment-mep').click();
  await expect(page.getByTestId('ribbon-group-arch-create')).toHaveCount(0);
  await expect(page.getByTestId('tool-pipe')).toBeVisible();
  await expect(drawn).toHaveCount(14);
  await expect(network).toHaveCount(3);
  await page.getByTestId('environment-architecture').click();
  await expect(page.getByTestId('arch-wall')).toBeVisible();
  await expect(drawn).toHaveCount(14);
  expect(
    await page
      .getByTestId('arch-item')
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-arch-id')).sort()),
  ).toEqual(idsBefore);

  // Parede pela planta: primeiro ponto por clique, o trecho pelo comprimento digitado.
  await page.getByTestId('arch-wall').click();
  await expect(page.getByTestId('plan-view')).toHaveAttribute('data-arch-tool', 'wall');
  await expect(page.getByTestId('arch-tool-options')).toBeVisible();
  await page.mouse.click(...(await planPoint(page, 1, 2)));
  await page.mouse.move(...(await planPoint(page, 2.4, 2)));
  await expect(page.getByTestId('arch-draft')).toHaveAttribute('data-points', '1');
  await expect(page.getByTestId('arch-draft-length')).toHaveText('1,4 m');
  await page.keyboard.type('2');
  await expect(page.getByTestId('arch-length-entry')).toBeFocused();
  await expect(page.getByTestId('arch-length-entry')).toHaveValue('2');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('arch-draft')).toHaveAttribute('data-points', '2');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('status-message')).toContainText('1 parede criada');
  await expect(drawn).toHaveCount(15);
  await expect(
    page.locator('[data-testid="arch-plan-element"][data-arch-kind="wall"]'),
  ).toHaveCount(6);

  // Porta na parede nova: a prévia mostra o vão antes do clique.
  await page.getByTestId('arch-door').click();
  await page.mouse.move(...(await planPoint(page, 2.2, 2)));
  await expect(page.getByTestId('arch-hosted-preview')).toHaveAttribute('data-valid', 'true');
  await page.mouse.click(...(await planPoint(page, 2.2, 2)));
  await expect(page.getByTestId('status-message')).toContainText('Porta inserida');
  await expect(
    page.locator('[data-testid="arch-plan-element"][data-arch-kind="door"]'),
  ).toHaveCount(3);
  await expect(drawn).toHaveCount(16);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('plan-view')).toHaveAttribute('data-arch-tool', '');

  // Selecionar a parede na planta e editar a altura: o quantitativo do painel acompanha.
  await page.mouse.click(...(await planPoint(page, 1.2, 2)));
  await expect(page.getByTestId('properties-type')).toHaveText('Parede');
  await expect(page.getByTestId('properties-title')).toHaveText('Parede 6');
  await expect(page.getByTestId('arch-ifc-entity')).toHaveText('IfcWall');
  await expect(page.getByTestId('arch-type-usage')).toContainText('ocorrências');
  await expect(page.getByTestId('arch-group-quantities')).toBeVisible();
  await expect(page.getByTestId(GROSS_SIDE)).toHaveText('5,6 m²');
  const height = page.getByTestId('arch-prop-height');
  await height.fill('3');
  await height.press('Enter');
  await expect(page.getByTestId(GROSS_SIDE)).toHaveText('6 m²');

  // Edição impossível: altura menor que o vão da porta — recusada, nada muda.
  await height.fill('1,5');
  await height.press('Enter');
  await expect(page.getByTestId('status-message')).toHaveAttribute('data-level', 'error');
  await expect(page.getByTestId('status-message')).toContainText('altura da parede');
  await expect(height).toHaveValue('3');
  await expect(page.getByTestId(GROSS_SIDE)).toHaveText('6 m²');

  // Desfazer e refazer.
  await page.getByTestId('action-undo').click();
  await expect(page.getByTestId(GROSS_SIDE)).toHaveText('5,6 m²');
  await expect(height).toHaveValue('2,8');
  await page.getByTestId('action-redo').click();
  await expect(page.getByTestId(GROSS_SIDE)).toHaveText('6 m²');

  // Natureza dos valores: calculada (quantitativo), do tipo e pendente — com o rótulo à vista.
  const quantities = page.getByTestId('arch-group-quantities');
  await expect(
    quantities.locator('[data-testid="arch-property"][data-nature="calculated"]').first(),
  ).toContainText('Calculada');
  const pending = page.locator('[data-testid="arch-property"][data-nature="pending"]');
  expect(await pending.count()).toBeGreaterThan(0);
  await expect(pending.first().getByTestId('arch-nature')).toContainText('Pendente');
  await expect(pending.first().locator('code')).toContainText('.');

  // Salvar no navegador e reabrir: mesmos identificadores e contagens.
  const idsSaved = await page
    .getByTestId('arch-item')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-arch-id')).sort());
  expect(idsSaved).toHaveLength(16);
  await page.getByTestId('action-save').click();
  await expect(page.getByTestId('status-message')).toContainText('salvo no navegador');
  await page.reload();
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await expect(page.getByTestId('nav-arch-count')).toHaveText('16 de arquitetura');
  await expect(page.getByTestId('environment-architecture')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(
    await page
      .getByTestId('arch-item')
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-arch-id')).sort()),
  ).toEqual(idsSaved);

  // A parede reaberta mantém a altura editada; a seleção pelo navegador abre o mesmo painel.
  await page.locator('[data-testid="arch-item"][data-arch-kind="wall"]').last().click();
  await expect(page.getByTestId('properties-title')).toHaveText('Parede 6');
  await expect(page.getByTestId('arch-prop-height')).toHaveValue('3');
  expect(errors).toEqual([]);
});
