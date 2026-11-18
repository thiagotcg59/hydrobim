import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Fases 2 a 6 no navegador real: reduções automáticas ao trocar o diâmetro, famílias de
 * catálogo editáveis, equipamentos, exportações (IFC, quantitativo, EPANET) e análises.
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function openEmptyProject(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await page.getByTestId('action-new').click();
  await expect(page.getByTestId('element-count')).toHaveText('0');
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

async function showProject(page: Page): Promise<void> {
  const back = page.getByTestId('back-to-project');
  if (await back.isVisible()) await back.click();
  await expect(page.getByTestId('section-project')).toBeVisible();
}

const items = (page: Page, kind: string): Locator =>
  page.locator(`[data-testid="element-item"][data-element-kind="${kind}"]`);

async function expectNoError(page: Page): Promise<void> {
  await expect(page.getByTestId('status-message')).not.toHaveAttribute('data-level', 'error');
}

async function drawNetwork(page: Page): Promise<void> {
  await page.getByTestId('tool-pipe').click();
  await addPoint(page, '0', '0', '0');
  await addPoint(page, '3', '0', '0');
  await addPoint(page, '3', '3', '0');
  await addPoint(page, '6', '3', '0');
  await expectNoError(page);
  await page.keyboard.press('Escape');
  await page.getByTestId('tool-select').click();
  await showProject(page);
}

async function download(page: Page, testId: string): Promise<{ name: string; text: string }> {
  const pending = page.waitForEvent('download');
  await page.getByTestId(testId).click();
  const file = await pending;
  return { name: file.suggestedFilename(), text: await readFile(await file.path(), 'utf8') };
}

test('trocar o diâmetro altera só o tubo e insere reduções de catálogo', async ({ page }) => {
  const errors = trackErrors(page);
  await openEmptyProject(page);
  await drawNetwork(page);
  await expect(items(page, 'pipe')).toHaveCount(3);
  await expect(items(page, 'elbow')).toHaveCount(2);
  // Joelhos de 90° em PVC soldável vêm do catálogo: nenhuma peça genérica.
  await expect(page.getByTestId('generic-count')).toHaveText('0');

  // Tubo do meio: DE 32 (DN 25) → DE 25 (DN 20).
  await items(page, 'pipe').nth(1).click();
  await expect(page.getByTestId('size-mode-reducers')).toBeChecked();
  await page.getByTestId('prop-dn').selectOption('20');
  await expect(page.getByTestId('prop-outer-diameter')).toHaveText('25 mm');
  await expect(page.getByTestId('status-message')).toContainText('2 redução(ões) inserida(s)');

  await showProject(page);
  await expect(items(page, 'reducer')).toHaveCount(2);
  await expect(items(page, 'pipe')).toHaveCount(3);
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');
  await expect(page.getByTestId('generic-count')).toHaveText('0');
  // Os tubos vizinhos mantiveram o diâmetro.
  await items(page, 'pipe').first().click();
  await expect(page.getByTestId('prop-outer-diameter')).toHaveText('32 mm');
  // A redução inserida é a luva de redução do catálogo.
  await showProject(page);
  await items(page, 'reducer').first().click();
  await expect(page.getByTestId('prop-family')).toHaveAttribute(
    'data-family-id',
    'krona-luva-reducao-soldavel',
  );

  // Voltar ao diâmetro original remove as reduções.
  await showProject(page);
  await items(page, 'pipe').nth(1).click();
  await page.getByTestId('prop-dn').selectOption('25');
  await expect(page.getByTestId('status-message')).toContainText('2 redução(ões) removida(s)');
  await showProject(page);
  await expect(items(page, 'reducer')).toHaveCount(0);
  await expect(page.getByTestId('connection-count')).toHaveText('4');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');
  expect(errors).toEqual([]);
});

test('elevação: alterar a cota de um tubo move os elementos conectados', async ({ page }) => {
  const errors = trackErrors(page);
  await openEmptyProject(page);
  await drawNetwork(page);

  await items(page, 'pipe').first().click();
  await expect(page.getByTestId('prop-elevation')).toHaveValue('0');
  await expect(page.getByTestId('prop-elevation-info')).toContainText('4 elemento(s) conectado(s)');
  await setField(page, 'prop-elevation', '1,5');
  await expect(page.getByTestId('status-message')).toContainText('Elevação alterada');
  await expect(page.getByTestId('prop-start-z')).toHaveValue('1,5');
  await expect(page.getByTestId('prop-length')).toHaveValue('2,982');

  // Os demais elementos da rede acompanharam: último tubo e joelho.
  await showProject(page);
  await items(page, 'pipe').nth(2).click();
  await expect(page.getByTestId('prop-elevation')).toHaveValue('1,5');
  await showProject(page);
  await items(page, 'elbow').first().click();
  await expect(page.getByTestId('prop-elevation')).toHaveValue('1,5');
  await showProject(page);
  await expect(page.getByTestId('connection-count')).toHaveText('4');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');
  expect(errors).toEqual([]);
});

test('famílias: consultar, editar dimensões e aplicar às peças do projeto', async ({ page }) => {
  const errors = trackErrors(page);
  await openEmptyProject(page);
  await drawNetwork(page);

  // Comprimento do primeiro tubo com o joelho de catálogo (Z = 18 mm para DE 32).
  await items(page, 'pipe').first().click();
  await expect(page.getByTestId('prop-length')).toHaveValue('2,982');

  await page.getByTestId('action-families').click();
  const dialog = page.getByTestId('families-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('family-item').first()).toBeVisible();
  await dialog.locator('[data-family-id="krona-joelho-90-soldavel"]').click();
  await expect(dialog.getByTestId('family-row')).toHaveCount(9);
  await expect(dialog.getByTestId('family-apply')).toBeChecked();

  // Ao abrir a família aparece o modelo 3D da primeira linha; clicar em outra o troca.
  const preview = dialog.getByTestId('family-preview');
  await expect(preview).toHaveAttribute('data-state', 'model');
  const rows = dialog.getByTestId('family-row');
  await expect(preview).toHaveAttribute('data-dn', (await rows.first().getAttribute('data-dn'))!);
  await expect(dialog.getByTestId('family-preview-canvas').locator('canvas')).toBeVisible();
  await rows.nth(8).click();
  await expect(preview).toHaveAttribute('data-dn', (await rows.nth(8).getAttribute('data-dn'))!);
  await expect(rows.nth(8)).toHaveClass(/is-preview/);

  // As cotas do catálogo aparecem sobre o modelo, com o valor da linha, e podem ser ocultadas.
  const centerToEnd = dialog.locator(
    '[data-testid="family-dimension"][data-dimension="centerToEnd"]',
  );
  await expect(centerToEnd).toBeVisible();
  const tabulated = await dialog.getByTestId('family-cell-8-centerToEnd').inputValue();
  await expect(centerToEnd).toContainText(`${tabulated} mm`);
  await expect(dialog.getByTestId('family-dimension')).toHaveCount(3);
  await dialog.getByTestId('family-preview-dimensions').uncheck();
  await expect(dialog.getByTestId('family-dimension')).toHaveCount(0);
  await dialog.getByTestId('family-preview-dimensions').check();
  await expect(centerToEnd).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('familia-modelo-3d.png') });

  // Linha do DN 25 (DE 32): centro à porta 18 → 30 mm.
  const cell = dialog.getByTestId('family-cell-2-centerToEnd');
  await expect(cell).toHaveValue('18');
  await cell.fill('30');
  await cell.press('Enter');
  await dialog.getByTestId('family-save').click();
  await expect(page.getByTestId('status-message')).toContainText('aplicada a 2 peça(s)');
  await expect(dialog.getByTestId('family-reset')).toBeVisible();
  await dialog.getByTestId('families-close').click();

  // O tubo foi reajustado ao novo joelho, sem perder o acoplamento.
  await expect(page.getByTestId('prop-length')).toHaveValue('2,97');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');

  // Ferro dúctil tem famílias com bolsas e com flanges.
  await page.getByTestId('action-families').click();
  await dialog.getByTestId('families-specification').selectOption('ferro-ductil-nbr7675-k9');
  await dialog.getByTestId('families-kind').selectOption('valve');
  // 5 famílias AVK + 2 da redutora de pressão BERMAD 720 (SIGMA EN e ES).
  await expect(dialog.getByTestId('family-item')).toHaveCount(7);
  await expect(dialog.getByTestId('family-item').filter({ hasText: 'BERMAD 720' })).toHaveCount(2);
  await dialog.getByTestId('families-close').click();
  expect(errors).toEqual([]);
});

test('equipamentos, exportações IFC/quantitativo/EPANET e análises', async ({ page }) => {
  const errors = trackErrors(page);
  await openEmptyProject(page);
  await setField(page, 'project-name', 'Elevatória E2E');
  await page.getByTestId('environment-infra').click();

  // Reservatório, tubo de saída, válvula de gaveta flangeada em linha.
  await page.getByTestId('tool-tank').click();
  await addPoint(page, '0', '0', '0');
  await expectNoError(page);
  await expect(page.getByTestId('element-properties')).toHaveAttribute('data-element-kind', 'tank');
  await page.getByTestId('tool-pipe').click();
  await addPoint(page, '1,15', '0', '0,2'); // bocal de saída do reservatório
  await addPoint(page, '12', '0', '0,2');
  await expectNoError(page);
  await page.keyboard.press('Escape');
  await page.getByTestId('tool-select').click();
  await showProject(page);
  await expect(page.getByTestId('connection-count')).toHaveText('1');

  await items(page, 'pipe').first().click();
  await setField(page, 'inline-distance', '4');
  await page.getByTestId('inline-add-valve').click();
  await expect(page.getByTestId('element-properties')).toHaveAttribute(
    'data-element-kind',
    'valve',
  );
  await expect(page.getByTestId('prop-family')).toHaveAttribute(
    'data-family-id',
    'avk-gaveta-curta-en558-s14@ferro-ductil-nbr7675-k9',
  );
  // DN 150: face a face 210 mm (EN 558 série 14).
  await expect(page.getByTestId('prop-valve-length')).toHaveValue('210');

  // Tubo independente cruzando a adutora: interferência.
  await page.getByTestId('tool-pipe').click();
  await addPoint(page, '8', '-2', '0,25');
  await addPoint(page, '8', '2', '0,25');
  await page.keyboard.press('Escape');
  await page.getByTestId('tool-select').click();
  await page.screenshot({ path: 'test-results/04-elevatoria.png' });

  // Exportações.
  const ifc = await download(page, 'action-export-ifc');
  expect(ifc.name).toBe('elevatoria-e2e.ifc');
  expect(ifc.text).toContain("FILE_SCHEMA(('IFC4X3_ADD2'))");
  expect(ifc.text.match(/=IFCPIPESEGMENT\(/g)).toHaveLength(3);
  expect(ifc.text.match(/=IFCVALVE\(/g)).toHaveLength(1);
  expect(ifc.text.match(/=IFCTANK\(/g)).toHaveLength(1);
  expect(ifc.text).not.toContain('IFCMAPCONVERSION');

  const csv = await download(page, 'action-export-csv');
  expect(csv.name).toBe('elevatoria-e2e-quantitativo.csv');
  expect(csv.text).toContain('"Válvula de gaveta"');
  expect(csv.text).toContain('Ferro fundido dúctil');

  const inp = await download(page, 'action-export-epanet');
  expect(inp.name).toBe('elevatoria-e2e.inp');
  expect(inp.text).toContain('[TANKS]');
  expect(inp.text).toContain('[PIPES]');

  // Diálogo de projeto: níveis, georreferência, terreno, perfil e interferências.
  await showProject(page);
  await items(page, 'pipe').first().click();
  await page.getByTestId('action-project').click();
  const dialog = page.getByTestId('project-dialog');
  await expect(dialog.getByTestId('level-row')).toHaveCount(1);
  await setField(page, 'level-name', 'Cobertura');
  await setField(page, 'level-elevation', '6');
  await dialog.getByTestId('level-add').click();
  await expect(dialog.getByTestId('level-row')).toHaveCount(2);

  await dialog.getByTestId('tab-button-georeference').click();
  await expect(dialog.getByTestId('geo-state')).toHaveText('Não definida');
  await setField(page, 'geo-crs', 'SIRGAS 2000 / UTM zone 23S');
  await setField(page, 'geo-epsg', '31983');
  await setField(page, 'geo-e', '350000');
  await setField(page, 'geo-n', '7400000');
  await dialog.getByTestId('geo-save').click();
  await expect(dialog.getByTestId('geo-state')).toContainText('SIRGAS 2000');

  await dialog.getByTestId('tab-button-terrain').click();
  await dialog.getByTestId('terrain-file').setInputFiles({
    name: 'levantamento.xyz',
    mimeType: 'text/plain',
    buffer: Buffer.from('-5 -5 1.5\n20 -5 1.8\n-5 5 1.6\n20 5 2.0\n8 0 1.9\n'),
  });
  await expect(dialog.getByTestId('terrain-points')).toHaveText('5');

  await dialog.getByTestId('tab-button-profile').click();
  await expect(dialog.getByTestId('profile-chart')).toBeVisible();
  await expect(dialog.getByTestId('profile-cover')).toContainText('m');
  await expect(dialog.getByTestId('profile-cover')).not.toContainText('Sem terreno');

  await dialog.getByTestId('tab-button-clashes').click();
  await expect(dialog.getByTestId('clash-count')).toHaveText('1');
  await dialog.getByTestId('clash-item').click();
  await page.screenshot({ path: 'test-results/05-perfil-interferencias.png' });
  await dialog.getByTestId('project-close').click();
  await expect(page.getByTestId('multi-properties')).toHaveAttribute('data-count', '2');

  // Com georreferência informada, o IFC passa a trazer o sistema de coordenadas.
  const georeferenced = await download(page, 'action-export-ifc');
  expect(georeferenced.text).toContain('IFCMAPCONVERSION');
  expect(georeferenced.text).toContain('EPSG:31983');

  // Vista ortográfica e desfazer não geram erros.
  await page.getByTestId('view-ortho').click();
  await page.getByTestId('view-top').click();
  await page.screenshot({ path: 'test-results/06-ortografica.png' });
  await page.getByTestId('action-undo').click();
  expect(errors).toEqual([]);
});
