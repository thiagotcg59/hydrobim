import { expect, test, type Page } from '@playwright/test';
import { ctl } from './ui';

/**
 * Biblioteca de produtos (linha PBA): tabelas do fabricante e modelo 3D de cada produto na
 * seção de famílias, sem alterar o projeto.
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

test('biblioteca de produtos PBA: tabelas e modelos 3D de todos os produtos', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await (await ctl(page, 'action-new')).click();

  await (await ctl(page, 'action-families')).click();
  const dialog = page.getByTestId('families-dialog');
  await dialog.getByTestId('families-tab-products').click();
  const library = dialog.getByTestId('product-library');
  await expect(library).toBeVisible();
  // 3 tubos, 4 curvas, 4 tês/cruzetas, redução, 2 luvas, cap, adaptador, colar e 2 anéis.
  const items = library.getByTestId('product-item');
  await expect(items).toHaveCount(19);

  const preview = library.getByTestId('product-preview');
  const ids = await items.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-product-id') ?? ''),
  );
  for (const id of ids) {
    await library.locator(`[data-product-id="${id}"]`).click();
    const rows = library.getByTestId('product-row');
    // O colar começa pelas linhas sem modelo (25 a 40): mostra-se a última (DN100 × ¾).
    await rows.last().click();
    await expect(preview).toHaveAttribute('data-state', 'model');
    await expect(preview).toHaveAttribute(
      'data-code',
      (await rows.last().getAttribute('data-code'))!,
    );
    await expect(library.getByTestId('family-preview-canvas').locator('canvas')).toBeVisible();
    await expect(library.getByTestId('product-extent')).toContainText('mm');
    await expect(library.getByTestId('product-network')).not.toBeEmpty();
    // A inserção direta não é simulada: o botão fica desabilitado e identificado.
    await expect(library.getByTestId('product-insert')).toBeDisabled();
    await preview.screenshot({ path: test.info().outputPath(`produto-${id}.png`) });
  }

  // Tubo: vista encurtada por padrão; a barra inteira tem o comprimento L da tabela.
  await library.locator('[data-product-id="wavin-pba-tubo-cl12"]').click();
  await expect(library.getByTestId('product-row')).toHaveCount(3);
  await expect(library.getByTestId('product-extent')).toContainText(': 325 ×');
  await library.getByTestId('product-full-length').check();
  await expect(library.getByTestId('product-extent')).toContainText(': 6110 ×');

  // Colar de tomada: as linhas com colunas incoerentes no catálogo não geram modelo.
  await library.getByTestId('products-category').selectOption('Colares de tomada');
  await expect(items).toHaveCount(1);
  await items.first().click();
  await expect(library.getByTestId('product-row')).toHaveCount(12);
  await library.getByTestId('product-row').first().click();
  await expect(preview).toHaveAttribute('data-state', 'empty');
  await expect(library.getByTestId('product-preview-message')).toContainText('não correspondem');
  await expect(library.getByTestId('product-remarks')).toContainText('40 x ¾');

  // A aba de conexões continua funcionando, agora com as três classes de PBA.
  await dialog.getByTestId('families-tab-fittings').click();
  await expect(library).toHaveCount(0);
  await dialog.getByTestId('families-specification').selectOption('pvc-pba-nbr5647-cl12');
  // Curvas ponta e bolsa (90°, 45°, 22°30′ e 11°15′), tês e redução da ficha PBA.
  const pbaItems = dialog.getByTestId('family-item');
  await expect(pbaItems.filter({ hasText: 'Curva' })).toHaveCount(4);
  await expect(pbaItems.filter({ hasText: 'Tê' })).toHaveCount(2);
  await expect(pbaItems.filter({ hasText: /Redução PBA ponta e bolsa/ })).toHaveCount(1);
  await dialog.getByTestId('family-item').first().click();
  await expect(dialog.getByTestId('family-preview')).toHaveAttribute('data-state', 'model');
  await dialog.getByTestId('family-preview').screenshot({
    path: test.info().outputPath('rede-pba.png'),
  });
  await dialog.getByTestId('families-close').click();
  expect(errors).toEqual([]);
});
