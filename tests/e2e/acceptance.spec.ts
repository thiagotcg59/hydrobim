import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ctl } from './ui';

/**
 * Critérios de aceite da Fase 1, exercitados no navegador real:
 * abrir, desenhar tubos em três orientações, selecionar, editar, inserir joelho/tê/
 * válvula/redução, salvar, recarregar e reabrir sem perda.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
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

async function newEmptyProject(page: Page): Promise<void> {
  page.once('dialog', (dialog) => void dialog.accept());
  await (await ctl(page, 'action-new')).click();
  await expect(page.getByTestId('element-count')).toHaveText('0');
}

async function showProject(page: Page): Promise<void> {
  const back = await ctl(page, 'back-to-project');
  if (await back.isVisible()) await back.click();
  await expect(page.getByTestId('section-project')).toBeVisible();
}

const items = (page: Page, kind: string): Locator =>
  page.locator(`[data-testid="element-item"][data-element-kind="${kind}"]`);

async function elementIds(page: Page): Promise<string[]> {
  await showProject(page);
  const ids = await page
    .getByTestId('element-item')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-element-id') ?? ''));
  return ids.sort();
}

const selectedKind = (page: Page): Promise<Locator> => ctl(page, 'element-properties');

async function expectNoError(page: Page): Promise<void> {
  await expect(page.getByTestId('status-message')).not.toHaveAttribute('data-level', 'error');
}

test('fluxo completo de modelagem, edição, salvamento e reabertura', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);

  // Sem projeto salvo, a demonstração é carregada e renderizada.
  await expect(page.getByTestId('element-count')).not.toHaveText('0');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');
  await page.screenshot({ path: 'test-results/01-demo.png' });

  await newEmptyProject(page);
  await setField(page, 'project-name', 'Rede de teste E2E');

  // Três tubos em orientações distintas (X, Y e vertical), conectados por joelhos.
  await (await ctl(page, 'tool-pipe')).click();
  await addPoint(page, '0', '0', '0');
  await addPoint(page, '3', '0', '0');
  await addPoint(page, '3', '2', '0');
  await addPoint(page, '3', '2', '2,5');
  await expectNoError(page);
  await page.keyboard.press('Escape');
  await (await ctl(page, 'tool-select')).click();

  await showProject(page);
  await expect(items(page, 'pipe')).toHaveCount(3);
  await expect(items(page, 'elbow')).toHaveCount(2);
  await expect(page.getByTestId('connection-count')).toHaveText('4');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');

  // Seleção e propriedades reais.
  await items(page, 'pipe').first().click();
  await expect(await selectedKind(page)).toHaveAttribute('data-element-kind', 'pipe');
  await expect(await ctl(page, 'prop-id')).toHaveText(UUID);
  await expect(await ctl(page, 'prop-outer-diameter')).toHaveText('32 mm');
  const length = Number((await (await ctl(page, 'prop-length')).inputValue()).replace(',', '.'));
  expect(length).toBeGreaterThan(2.9);
  expect(length).toBeLessThan(3);

  // Alterar o diâmetro atualiza dados e geometria renderizada.
  await page.getByTestId('view-iso').click();
  const canvas = page.locator('canvas');
  const before = await canvas.screenshot();
  await page.getByTestId('size-mode-propagate').check();
  await (await ctl(page, 'prop-dn')).selectOption('100');
  await expect(await ctl(page, 'prop-outer-diameter')).toHaveText('110 mm');
  await expectNoError(page);
  await expect.poll(async () => Buffer.compare(before, await canvas.screenshot()) !== 0).toBe(true);
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');

  // Alterar o material (especificação) também é refletido.
  await (await ctl(page, 'prop-specification')).selectOption('aco-carbono-b3610-sch40');
  await expect(await ctl(page, 'prop-outer-diameter')).toHaveText('114,3 mm');
  await expectNoError(page);

  // Válvula em linha.
  await setField(page, 'inline-distance', '1,2');
  await (await ctl(page, 'inline-add-valve')).click();
  await expect(await selectedKind(page)).toHaveAttribute('data-element-kind', 'valve');
  await expectNoError(page);

  // Tê em linha no trecho vertical (último tubo da lista).
  await showProject(page);
  await items(page, 'pipe').nth(2).click();
  await (await ctl(page, 'inline-add-tee')).click();
  await expect(await selectedKind(page)).toHaveAttribute('data-element-kind', 'tee');
  await expectNoError(page);

  // Joelho na derivação livre do tê, girado em torno da porta.
  await (await ctl(page, 'port-branch-add-elbow')).click();
  await expect(await selectedKind(page)).toHaveAttribute('data-element-kind', 'elbow');
  await (await ctl(page, 'prop-roll-plus')).click();
  await expectNoError(page);

  // Redução na extremidade livre do joelho.
  await (await ctl(page, 'port-b-add-reducer')).click();
  await expect(await selectedKind(page)).toHaveAttribute('data-element-kind', 'reducer');
  await expectNoError(page);

  await page.getByTestId('view-fit').click();
  await page.screenshot({ path: 'test-results/02-rede.png' });

  const idsBefore = await elementIds(page);
  expect(idsBefore.length).toBe(11);
  for (const id of idsBefore) expect(id).toMatch(UUID);
  const connectionsBefore = await page.getByTestId('connection-count').textContent();
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');

  // Salvar e reabrir após recarregar a página.
  await expect(page.getByTestId('dirty-indicator')).toHaveText('não salvo');
  await page.getByTestId('action-save').click();
  await expect(page.getByTestId('dirty-indicator')).toHaveText('salvo');
  await page.reload();
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await expect(page.getByTestId('project-name')).toHaveValue('Rede de teste E2E');
  expect(await elementIds(page)).toEqual(idsBefore);
  await expect(page.getByTestId('connection-count')).toHaveText(connectionsBefore ?? '');

  // Exportar JSON, iniciar projeto vazio e reimportar o arquivo.
  const downloadPromise = page.waitForEvent('download');
  await (await ctl(page, 'action-export')).click();
  const download = await downloadPromise;
  const filePath = await download.path();
  const exported = JSON.parse(await readFile(filePath, 'utf8')) as {
    format: string;
    schemaVersion: number;
    elements: unknown[];
  };
  expect(exported.format).toBe('hydrobim-project');
  expect(exported.schemaVersion).toBe(13);
  expect(exported.elements).toHaveLength(11);

  await (await ctl(page, 'action-new')).click();
  await expect(page.getByTestId('element-count')).toHaveText('0');
  await (await ctl(page, 'action-open')).click();
  await expect(page.getByTestId('stored-project')).toHaveCount(1);
  await page.getByTestId('import-file').setInputFiles(filePath);
  await expect(page.getByTestId('open-dialog')).toBeHidden();
  expect(await elementIds(page)).toEqual(idsBefore);

  // Desfazer/refazer e exclusão.
  await items(page, 'valve').first().click();
  await (await ctl(page, 'action-delete')).click();
  await expect(page.getByTestId('element-count')).toHaveText('10');
  await page.getByTestId('action-undo').click();
  await expect(page.getByTestId('element-count')).toHaveText('11');
  await page.getByTestId('action-redo').click();
  await expect(page.getByTestId('element-count')).toHaveText('10');

  expect(errors).toEqual([]);
});

test('interação direta no viewport: desenhar e selecionar com o mouse', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await newEmptyProject(page);

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas sem dimensões');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Desenha um tubo com dois cliques sobre o plano de trabalho.
  await (await ctl(page, 'tool-pipe')).click();
  await page.mouse.move(cx + 60, cy + 40);
  await expect(page.getByTestId('status-coords')).toContainText('X ');
  await page.mouse.click(cx + 60, cy + 40);
  await expect(page.getByTestId('status-mode')).toContainText('ponto final');
  await page.mouse.move(cx + 260, cy + 120);
  await page.screenshot({ path: 'test-results/03-desenho.png' });
  await page.mouse.click(cx + 260, cy + 120);
  await expectNoError(page);
  await page.keyboard.press('Escape');
  await (await ctl(page, 'tool-select')).click();
  await showProject(page);
  await expect(items(page, 'pipe')).toHaveCount(1);

  // Enquadra em planta: o tubo fica no centro do viewport e pode ser selecionado.
  await page.getByTestId('view-top').click();
  await page.mouse.click(cx + 300, cy - 250); // área vazia: sem seleção
  await expect(page.getByTestId('section-project')).toBeVisible();
  await page.mouse.click(cx, cy);
  await expect(await selectedKind(page)).toHaveAttribute('data-element-kind', 'pipe');

  // Janela de seleção sobre área vazia: limpa a seleção.
  await page.mouse.move(cx + 280, cy - 260);
  await page.mouse.down();
  await page.mouse.move(cx + 330, cy - 230, { steps: 4 });
  await expect(page.getByTestId('selection-box')).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId('selection-box')).toHaveCount(0);
  await expect(page.getByTestId('section-project')).toBeVisible();

  // Janela em volta do tubo: seleciona o que está inteiramente dentro dela.
  const reach = (Math.min(box.width, box.height) / 2) * 0.95;
  await page.mouse.move(cx - reach, cy - reach);
  await page.mouse.down();
  await page.mouse.move(cx + reach, cy + reach, { steps: 6 });
  await page.mouse.up();
  await expect(await selectedKind(page)).toHaveAttribute('data-element-kind', 'pipe');

  // Órbita (Alt + arrasto) não altera a seleção nem gera erros.
  await page.keyboard.down('Alt');
  await page.mouse.move(cx + 100, cy + 100);
  await page.mouse.down();
  await page.mouse.move(cx + 220, cy + 30, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(page.getByTestId('selection-box')).toHaveCount(0);
  await expect(await selectedKind(page)).toHaveAttribute('data-element-kind', 'pipe');

  expect(errors).toEqual([]);
});

test('arquivo inválido é recusado com mensagem clara', async ({ page }) => {
  await openApp(page);
  const before = await elementIds(page);
  await (await ctl(page, 'action-open')).click();
  await page.getByTestId('import-file').setInputFiles({
    name: 'invalido.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"outra-coisa"}'),
  });
  await expect(page.getByTestId('status-message')).toHaveAttribute('data-level', 'error');
  await expect(page.getByTestId('status-message')).toContainText('não é um projeto HydroBIM');
  await page.keyboard.press('Escape');
  expect(await elementIds(page)).toEqual(before);
});
