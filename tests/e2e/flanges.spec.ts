import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Flanges do catálogo (PN 10/16/25/40) e tubos de ferro fundido dúctil com flanges:
 * tabelas e modelos 3D na seção Catálogo, traçado com extremidades flangeadas, edição das
 * extremidades e do comprimento no painel de propriedades e gravação no arquivo.
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
  const field = page.getByTestId(testId);
  await field.fill(value);
  await field.press('Enter');
}

async function addPoint(page: Page, x: string, y: string, z: string): Promise<void> {
  await setField(page, 'coord-x', x);
  await setField(page, 'coord-y', y);
  await setField(page, 'coord-z', z);
  await page.getByTestId('coord-add').click();
}

const items = (page: Page, kind: string): Locator =>
  page.locator(`[data-testid="element-item"][data-element-kind="${kind}"]`);

test('flanges do catálogo e tubo de ferro fundido com flanges', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await page.getByTestId('action-new').click();
  await expect(page.getByTestId('element-count')).toHaveText('0');

  // Catálogo → Flanges: quatro classes de flange e quatro famílias de tubos.
  await page.getByTestId('action-families').click();
  const dialog = page.getByTestId('families-dialog');
  await dialog.getByTestId('families-tab-flanges').click();
  const library = dialog.getByTestId('flange-library');
  await expect(library.getByTestId('flange-family-item')).toHaveCount(8);
  const preview = library.getByTestId('flange-preview');

  // PN 10: 17 diâmetros, com a linha do catálogo e o modelo 3D do flange.
  await library.locator('[data-family-id="flange-pn10"]').click();
  await expect(library.getByTestId('flange-row')).toHaveCount(17);
  await expect(library.getByTestId('flange-library-source')).toContainText('p. 246');
  const row150 = library.locator('[data-testid="flange-row"][data-dn="150"]');
  await row150.click();
  await expect(row150).toContainText('285');
  await expect(row150).toContainText('8 × M20');
  await expect(preview).toHaveAttribute('data-state', 'model');
  await expect(library.getByTestId('family-preview-canvas').locator('canvas')).toBeVisible();
  await preview.screenshot({ path: test.info().outputPath('flange-pn10-dn150.png') });
  // DN 50 não tem tubo de ferro dúctil no catálogo embutido: o furo não é inventado.
  await library.locator('[data-testid="flange-row"][data-dn="50"]').click();
  await expect(preview).toHaveAttribute('data-state', 'empty');
  await expect(library.getByTestId('flange-preview-message')).toContainText('furo');
  // PN 40 vai só até DN 600.
  await library.locator('[data-family-id="flange-pn40"]').click();
  await expect(library.getByTestId('flange-row')).toHaveCount(12);

  // Tubo com flanges PN 16, DN 150, flange e ponta, levado para a ferramenta Tubo.
  await library.locator('[data-family-id="tubo-fofo-flanges-pn16"]').click();
  await expect(library.getByTestId('flange-row')).toHaveCount(10);
  await library.locator('[data-testid="flange-row"][data-dn="150"]').click();
  await library.getByTestId('flanged-pipe-configuration').selectOption('flangePlain');
  await expect(preview).toHaveAttribute('data-state', 'model');
  await preview.screenshot({ path: test.info().outputPath('tubo-flange-ponta-dn150.png') });
  await library.getByTestId('flange-library-use').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('option-pipe-ends')).toHaveValue('flangePlain');
  await expect(page.getByTestId('option-pipe-flange')).toHaveValue('tubo-fofo-flanges-pn16');

  // Traçado com comprimento definido pelo usuário (1,5 m entre as portas).
  await addPoint(page, '0', '0', '0');
  await addPoint(page, '1,5', '0', '0');
  await expect(page.getByTestId('status-message')).not.toHaveAttribute('data-level', 'error');
  await page.keyboard.press('Escape');
  await page.getByTestId('tool-select').click();
  const back = page.getByTestId('back-to-project');
  if (await back.isVisible()) await back.click();
  await expect(items(page, 'pipe')).toHaveCount(1);
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');

  // Propriedades: extremidades, flange de catálogo e portas.
  await items(page, 'pipe').first().click();
  await expect(page.getByTestId('prop-pipe-ends')).toHaveValue('flangePlain');
  await expect(page.getByTestId('prop-pipe-flange-info')).toContainText('Ø 285 mm');
  await expect(page.getByTestId('prop-pipe-flange-info')).toContainText('8 furos');
  await expect(page.getByTestId('port-start')).toContainText('flange Ø 285 mm');
  await expect(page.getByTestId('port-end')).not.toContainText('flange');
  await expect(page.getByTestId('prop-length')).toHaveValue('1,5');

  // Flange e flange, PN 40, comprimento personalizado de 0,8 m.
  await page.getByTestId('prop-pipe-ends').selectOption('flangeFlange');
  await expect(page.getByTestId('port-end')).toContainText('flange Ø 285 mm');
  await page.getByTestId('prop-pipe-flange').selectOption('tubo-fofo-flanges-pn40');
  await expect(page.getByTestId('prop-pipe-flange-info')).toContainText('Ø 300 mm');
  await setField(page, 'prop-length', '0,8');
  await expect(page.getByTestId('prop-length')).toHaveValue('0,8');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');

  // O arquivo grava as extremidades e a família do tubo (esquema v7).
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('action-export').click();
  const exported = JSON.parse(await readFile(await (await downloadPromise).path(), 'utf8')) as {
    schemaVersion: number;
    elements: {
      kind: string;
      familyId: string | null;
      ends?: Record<string, { type: string; outerDiameter: number; boltCount?: number }>;
    }[];
  };
  expect(exported.schemaVersion).toBe(8);
  const [pipe] = exported.elements;
  expect(pipe?.familyId).toBe('tubo-fofo-flanges-pn40');
  expect(Object.keys(pipe?.ends ?? {}).sort()).toEqual(['end', 'start']);
  expect(pipe?.ends?.start).toMatchObject({ type: 'flange', outerDiameter: 0.3, boltCount: 8 });

  // Ponta e ponta: volta a ser um tubo liso, sem família.
  await page.getByTestId('prop-pipe-ends').selectOption('plainPlain');
  await expect(page.getByTestId('port-start')).not.toContainText('flange');
  await expect(page.getByTestId('prop-pipe-flange')).toHaveCount(0);

  expect(errors).toEqual([]);
});
