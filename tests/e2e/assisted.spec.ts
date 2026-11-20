import { expect, test, type Page } from '@playwright/test';
import { ctl, openProjectTab } from './ui';

/**
 * Traçado assistido: entrada do trecho por valores (comprimento, ângulo, projeção e
 * declividade) com a prévia real da montagem antes de confirmar, subir até o pavimento
 * vizinho e fechamento entre as extremidades livres de dois elementos.
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

test('planta: trecho por valores com prévia da montagem, recusa antecipada e declividade', async ({
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
  const preview = await ctl(page, 'segment-preview');

  // Sem trecho em andamento a entrada por valores não aparece.
  await expect(await ctl(page, 'segment-entry')).toHaveCount(0);
  await page.mouse.click(...at(0, 0));
  await page.mouse.click(...at(2, 0));
  await expect(await ctl(page, 'segment-entry')).toBeVisible();

  // Aponta o lado da curva e digita comprimento e ângulo: a prévia lista as peças.
  await page.mouse.move(...at(2.4, 0.8));
  await (await ctl(page, 'segment-deflection')).selectOption('90');
  await (await ctl(page, 'segment-length')).fill('2,4');
  await expect(preview).toHaveAttribute('data-level', 'ok');
  await expect(preview).toContainText('2,40 m · 90°');
  await expect(preview).toContainText('Cria 1 joelho e 1 tubo');
  await expect(preview).toContainText('ajusta Tubo 1 2,00 m');
  // A prévia não altera o modelo.
  await expect(svg.locator('[data-element-id]')).toHaveCount(1);

  // Trecho curto demais para o joelho: recusado antes de confirmar.
  await (await ctl(page, 'segment-length')).fill('0,005');
  await expect(preview).toHaveAttribute('data-level', 'error');
  await expect(preview).toContainText('curto demais');
  await expect(await ctl(page, 'segment-apply')).toBeDisabled();
  await (await ctl(page, 'segment-length')).press('Enter');
  await expect(svg.locator('[data-element-id]')).toHaveCount(1);

  // Enter confirma o trecho válido; a tecla digitada no campo não troca de ferramenta.
  await (await ctl(page, 'segment-length')).fill('2,4');
  await (await ctl(page, 'segment-length')).press('Enter');
  await expect(page.getByTestId('status-message')).toHaveText('Tubo criado com joelho automático.');
  await expect(svg.locator('[data-element-kind="elbow"]')).toHaveCount(1);
  await expect(svg.locator('[data-element-kind="pipe"]')).toHaveCount(2);
  await expect(await ctl(page, 'tool-pipe')).toHaveAttribute('aria-pressed', 'true');
  // Os campos são limpos para o trecho seguinte.
  await expect(await ctl(page, 'segment-length')).toHaveValue('');

  // Declividade a partir de um ponto livre: 1 % em 3 m de projeção desce 3 cm.
  await page.keyboard.press('Escape');
  await page.mouse.click(...at(-1, -1.5));
  await page.mouse.move(...at(0, -1.5));
  await (await ctl(page, 'segment-horizontal')).fill('3');
  await (await ctl(page, 'segment-slope')).fill('-1');
  await expect(preview).toContainText('proj. 3,00 m');
  await expect(preview).toContainText('ΔZ -0,03 m');
  await expect(preview).toContainText('Cria 1 tubo');
  await (await ctl(page, 'segment-apply')).click();
  await expect(page.getByTestId('status-message')).toHaveText('Tubo criado.');
  await expect(svg.locator('[data-element-kind="pipe"]')).toHaveCount(3);

  // Entradas conflitantes são explicadas no próprio painel.
  await (await ctl(page, 'segment-length')).fill('2');
  await (await ctl(page, 'segment-dz')).fill('0,5');
  await (await ctl(page, 'segment-slope')).fill('1');
  await expect(preview).toContainText('Informe o desnível de uma só forma');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');
  expect(errors).toEqual([]);
});

test('subir até o pavimento vizinho cria a prumada com joelhos de catálogo', async ({ page }) => {
  const errors = trackErrors(page);
  await start(page);
  // Segundo pavimento a 3 m.
  await openProjectTab(page, 'levels');
  const dialog = page.getByTestId('project-dialog');
  await setField(page, 'level-name', '1º pavimento');
  await setField(page, 'level-elevation', '3');
  await dialog.getByTestId('level-add').click();
  await expect(dialog.getByTestId('level-row')).toHaveCount(2);
  await page.getByTestId('project-close').click();

  await page.getByTestId('view-mode-plan').click();
  await (await ctl(page, 'tool-pipe')).click();
  await setField(page, 'option-pipe-elevation', '0,3');
  const svg = page.getByTestId('plan-svg');
  const box = await svg.boundingBox();
  if (!box) throw new Error('Planta sem dimensões.');
  const at = (x: number, y: number): [number, number] => [
    box.x + box.width / 2 + x * 100,
    box.y + box.height / 2 - y * 100,
  ];
  await page.mouse.click(...at(0, 0));
  await page.mouse.click(...at(2, 0));

  // No térreo só há para onde subir; o botão informa o destino e a prévia.
  await expect(await ctl(page, 'segment-riser-down')).toHaveCount(0);
  const up = await ctl(page, 'segment-riser-up');
  await expect(up).toContainText('1º pavimento');
  await expect(up).toContainText('Z 3,30 m');
  await expect(up).toHaveAttribute('title', /Cria 1 joelho e 1 tubo/);
  await up.click();

  await expect(page.getByTestId('status-message')).toHaveText('Tubo criado com joelho automático.');
  await expect(svg.locator('[data-element-kind="elbow"]')).toHaveCount(1);
  // O nível de trabalho acompanha a prumada e a altura sobre o piso é mantida.
  await expect(await ctl(page, 'pipe-elevation-info')).toContainText('Z 3,30 m');
  await expect(await ctl(page, 'option-work-z')).toHaveValue('3');
  await expect(await ctl(page, 'option-pipe-elevation')).toHaveValue('0,3');
  // Agora é possível descer de volta.
  await expect(await ctl(page, 'segment-riser-down')).toContainText('Térreo');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');
  expect(errors).toEqual([]);
});

test('ligar extremidades: soluções com peças de catálogo e recusa explicada', async ({ page }) => {
  const errors = trackErrors(page);
  await start(page);
  // Dois tubos paralelos, desalinhados 1 m, de frente um para o outro.
  await (await ctl(page, 'tool-pipe')).click();
  await addPoint(page, '0', '0', '0');
  await addPoint(page, '1', '0', '0');
  await page.keyboard.press('Escape');
  await addPoint(page, '5', '1', '0');
  await addPoint(page, '6', '1', '0');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByTestId('view-top').click();

  // Janela de seleção em torno dos dois tubos.
  const box = await page.getByTestId('viewport-canvas').boundingBox();
  if (!box) throw new Error('Viewport sem dimensões.');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const reach = (Math.min(box.width, box.height) / 2) * 0.95;
  await page.mouse.move(cx - reach, cy - reach);
  await page.mouse.down();
  await page.mouse.move(cx + reach, cy + reach, { steps: 6 });
  await page.mouse.up();
  await expect(await ctl(page, 'multi-properties')).toHaveAttribute('data-count', '2');

  const section = page.getByTestId('section-close');
  await expect(section).toBeVisible();
  const offset45 = section.locator('[data-kind="offset"]', { hasText: 'Desvio 45°' });
  await expect(offset45).toContainText('2 joelhos de 45° e 2 tubos');
  await expect(section.locator('[data-kind="offset"]', { hasText: 'Desvio 90°' })).toHaveCount(1);
  await offset45.click();

  await expect(page.getByTestId('status-message')).toHaveText(
    'Extremidades ligadas: 2 joelhos de 45° e 2 tubos.',
  );
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('element-count')).toHaveText('6');
  // Um passo de desfazer remove toda a ligação.
  await page.getByTestId('action-undo').click();
  await expect(page.getByTestId('element-count')).toHaveText('2');
  expect(errors).toEqual([]);
});
