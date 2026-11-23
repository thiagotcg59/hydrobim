import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { ctl } from './ui';

/**
 * Planta baixa (documentação técnica): projeção do modelo, cotas, textos, chamadas,
 * etiquetas, escala do desenho, exportação em SVG e DXF (planta e 3D) e persistência no projeto.
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

const annotations = (page: Page, kind: string) =>
  page.locator(
    `[data-testid="plan-svg"] [data-layer="annotations"] [data-annotation-kind="${kind}"]`,
  );

test('planta baixa: cotar, anotar, etiquetar, exportar e reabrir', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await (await ctl(page, 'action-new')).click();
  await expect(page.getByTestId('element-count')).toHaveText('0');

  // Rede em "L": 3 m ao longo de X e 4 m ao longo de Y, com joelho automático.
  await (await ctl(page, 'tool-pipe')).click();
  await addPoint(page, '0', '0', '0');
  await addPoint(page, '3', '0', '0');
  await addPoint(page, '3', '4', '0');
  await page.keyboard.press('Escape');

  // A ferramenta de cota abre a planta baixa.
  await (await ctl(page, 'tool-dimension')).click();
  await expect(page.getByTestId('plan-view')).toBeVisible();
  await expect(page.getByTestId('view-mode-plan')).toHaveAttribute('aria-pressed', 'true');
  const svg = page.getByTestId('plan-svg');
  await expect(svg.locator('[data-element-kind="pipe"]')).toHaveCount(2);
  await expect(svg.locator('[data-element-kind="elbow"]')).toHaveCount(1);

  // Tubo horizontal: o mais largo na tela.
  let horizontal = { x: 0, y: 0, width: 0, height: 0 };
  let vertical = horizontal;
  for (const pipe of await svg.locator('[data-element-kind="pipe"]').all()) {
    const box = await pipe.boundingBox();
    if (!box) continue;
    if (box.width > box.height) horizontal = box;
    else vertical = box;
  }
  expect(horizontal.width).toBeGreaterThan(50);
  expect(vertical.height).toBeGreaterThan(50);
  const midY = horizontal.y + horizontal.height / 2;

  // Cota horizontal entre a extremidade livre e o vértice (captura nos pontos notáveis).
  await (await ctl(page, 'plan-dimension-mode')).selectOption('horizontal');
  await page.mouse.click(horizontal.x + 3, midY);
  await page.mouse.click(vertical.x + vertical.width / 2, vertical.y + 3);
  await page.mouse.click(horizontal.x + horizontal.width / 2, midY + 70);
  await expect(annotations(page, 'dimension')).toHaveCount(1);
  await expect(page.getByTestId('annotation-dimension-value')).toContainText('3,00 m');
  await expect(annotations(page, 'dimension').locator('text')).toHaveText('3,00');

  // Trocar o tipo para alinhada: mede a hipotenusa (5 m).
  await page.getByTestId('annotation-dimension-mode').selectOption('aligned');
  await expect(page.getByTestId('annotation-dimension-value')).toContainText('5,00 m');
  await page.getByTestId('action-undo').click();
  await expect(annotations(page, 'dimension').locator('text')).toHaveText('3,00');

  // Etiqueta do tubo vertical: designação e comprimento derivados do elemento.
  await (await ctl(page, 'tool-tag')).click();
  await page.mouse.click(vertical.x + vertical.width / 2, vertical.y + vertical.height / 2);
  await page.mouse.click(vertical.x + 60, vertical.y + vertical.height / 2);
  await expect(annotations(page, 'tag')).toHaveCount(1);
  await expect(page.getByTestId('annotation-tag-text')).toContainText(' m');

  // Chamada: ponto indicado, posição do texto e conteúdo.
  await (await ctl(page, 'tool-leader')).click();
  await page.mouse.click(horizontal.x + horizontal.width / 2, midY);
  await page.mouse.click(horizontal.x + horizontal.width / 2 - 80, midY - 90);
  await expect(page.getByTestId('annotation-text')).toBeFocused();
  await page.getByTestId('annotation-text').fill('RECALQUE');
  await page.getByTestId('annotation-text').press('Enter');
  await expect(annotations(page, 'text').locator('text')).toHaveText('RECALQUE');
  await expect(annotations(page, 'text').locator('polygon')).toHaveCount(1);

  // Texto vazio é recusado e o conteúdo anterior permanece.
  await page.getByTestId('annotation-text').fill('  ');
  await page.getByTestId('annotation-text').press('Enter');
  await expect(page.getByTestId('status-message')).toHaveAttribute('data-level', 'error');
  await expect(annotations(page, 'text').locator('text')).toHaveText('RECALQUE');

  // Texto livre, depois excluído pela tecla Delete.
  await (await ctl(page, 'tool-text')).click();
  await page.mouse.click(horizontal.x + 40, midY - 200);
  await page.getByTestId('annotation-text').fill('CASA DE MÁQUINAS');
  await page.getByTestId('annotation-text').press('Enter');
  await expect(annotations(page, 'text')).toHaveCount(2);
  await (await ctl(page, 'tool-select')).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('annotation-inspector')).toHaveCount(0);
  await svg.getByText('CASA DE MÁQUINAS').click();
  await expect(page.getByTestId('annotation-inspector')).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(annotations(page, 'text')).toHaveCount(1);

  // Escala do desenho.
  await (await ctl(page, 'plan-scale')).selectOption('25');
  await expect(await ctl(page, 'plan-scale')).toHaveValue('25');

  // Linhas finas (padrão): traço de 1 px na tela, sem alterar as espessuras de papel do desenho.
  // Desligadas, a planta mostra as espessuras de plotagem.
  const outlinePath = svg.locator('[data-element-kind="pipe"] path[fill="none"]').first();
  const paperWidth = await outlinePath.getAttribute('stroke-width');
  const strokeWidth = () => outlinePath.evaluate((node) => getComputedStyle(node).strokeWidth);
  await expect(await ctl(page, 'plan-thin-lines')).toHaveAttribute('aria-pressed', 'true');
  await (await ctl(page, 'plan-thin-lines')).click();
  await expect(await ctl(page, 'plan-thin-lines')).toHaveAttribute('aria-pressed', 'false');
  expect(await strokeWidth()).not.toBe('1px');
  await (await ctl(page, 'plan-thin-lines')).click();
  expect(await strokeWidth()).toBe('1px');
  expect(await outlinePath.evaluate((node) => getComputedStyle(node).vectorEffect)).toBe(
    'non-scaling-stroke',
  );
  expect(await outlinePath.getAttribute('stroke-width')).toBe(paperWidth);

  // Tema colorido: as cores do modelo 3D (tubo de PVC marrom).
  const fillPath = svg.locator('[data-element-kind="pipe"] path').first();
  expect(await fillPath.getAttribute('fill')).toBe('#6e4a36');
  expect(await fillPath.getAttribute('data-role')).toBe('body');

  // Tema preto e branco: preenchimento branco, traço preto.
  await (await ctl(page, 'plan-theme')).selectOption('mono');
  await expect(page.getByTestId('plan-view')).toHaveAttribute('data-theme', 'mono');
  for (const path of await svg.locator('[data-layer="elements"] path:first-child').all()) {
    expect(await path.getAttribute('fill')).toBe('#ffffff');
  }
  expect(await outlinePath.getAttribute('stroke')).toBe('#111111');

  // Exportação em SVG: tamanho físico, legenda com a escala e sem auxiliares de tela.
  const svgDownload = page.waitForEvent('download');
  await (await ctl(page, 'plan-export-svg')).click();
  const svgFile = await (await svgDownload).path();
  const svgText = await readFile(svgFile, 'utf8');
  expect(svgText).toContain('<svg');
  expect(svgText).toMatch(/width="[\d.]+mm"/);
  expect(svgText).toContain('PLANTA BAIXA — ESC. 1:25');
  expect(svgText).toContain('RECALQUE');
  expect(svgText).toContain('3,00');
  expect(svgText).not.toContain('data-ui');
  // O tema acompanha a exportação; as linhas finas, não (espessuras de papel preservadas).
  expect(svgText).not.toContain('#6e4a36');
  expect(svgText).toContain(`stroke-width="${paperWidth}"`);
  expect(svgText).not.toContain('vector-effect');

  // Exportação em DXF da planta (R2000): metros, camadas por categoria, cota como DIMENSION,
  // joelho como bloco e textos em Windows-1252.
  const onLayer = (type: string, layer: string): RegExp =>
    new RegExp(`\\n${type}\\n5\\n[0-9A-F]+\\n330\\n[0-9A-F]+\\n100\\nAcDbEntity\\n8\\n${layer}\\n`);
  const planDxfDownload = await Promise.all([
    page.waitForEvent('download'),
    (await ctl(page, 'plan-export-dxf')).click(),
  ]).then(([download]) => download);
  expect(planDxfDownload.suggestedFilename()).toMatch(/-planta\.dxf$/);
  const planDxf = await readFile(await planDxfDownload.path(), 'latin1');
  expect(planDxf).toContain('$INSUNITS\n70\n6\n');
  expect(planDxf).toContain('$ACADVER\n1\nAC1015\n');
  // Cada trecho de tubo é um bloco próprio (dois trechos, separados pelo joelho).
  expect(planDxf).toMatch(onLayer('INSERT', 'REDE_TUBULACOES'));
  expect(planDxf.match(/\n2\nHB_TUBO_\d+\n70\n0\n/g)?.length).toBe(2);
  expect(planDxf).toMatch(onLayer('INSERT', 'REDE_CONEXOES'));
  expect(planDxf).toMatch(onLayer('DIMENSION', 'REDE_COTAS'));
  expect(planDxf).toMatch(onLayer('TEXT', 'REDE_DIAMETROS'));
  expect(planDxf).toMatch(onLayer('SOLID', 'REDE_TEXTOS'));
  expect(planDxf).toContain('\n2\nREDE_COTAS_ALTIMETRICAS\n');
  expect(planDxf).toContain('\n1\n3,00\n');
  expect(planDxf).toContain('\n1\nRECALQUE\n');
  expect(planDxf).toContain('PLANTA BAIXA \x97 ESC. 1:25');
  expect(planDxf.endsWith('0\nEOF\n')).toBe(true);
  await expect(page.getByTestId('status-message')).toContainText('Planta exportada em DXF');

  // Exportação em DXF do modelo 3D: uma malha poliface por parte de cada elemento.
  const modelDxfDownload = await Promise.all([
    page.waitForEvent('download'),
    (await ctl(page, 'action-export-dxf')).click(),
  ]).then(([download]) => download);
  expect(modelDxfDownload.suggestedFilename()).toMatch(/-3d\.dxf$/);
  const modelDxf = await readFile(await modelDxfDownload.path(), 'latin1');
  expect(modelDxf.match(/\nPOLYLINE\n/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  expect(modelDxf).toContain('\n70\n64\n');
  expect(modelDxf).not.toContain('\nTEXT\n');

  // As anotações fazem parte do projeto exportado.
  const jsonDownload = page.waitForEvent('download');
  await (await ctl(page, 'action-export')).click();
  const exported = JSON.parse(await readFile(await (await jsonDownload).path(), 'utf8')) as {
    schemaVersion: number;
    drawingScale: number;
    annotations: { kind: string }[];
  };
  expect(exported.schemaVersion).toBe(20);
  expect(exported.drawingScale).toBe(25);
  expect(exported.annotations.map((a) => a.kind).sort()).toEqual(['dimension', 'tag', 'text']);

  // Selecionar a cota pelo texto e excluí-la.
  await annotations(page, 'dimension').locator('text').click();
  await expect(page.getByTestId('annotation-dimension-value')).toBeVisible();
  await page.getByTestId('annotation-delete').click();
  await expect(annotations(page, 'dimension')).toHaveCount(0);

  // Excluir o tubo etiquetado remove a etiqueta; o modelo 3D continua disponível.
  await page.mouse.click(vertical.x + vertical.width / 2, vertical.y + vertical.height / 2);
  await page.keyboard.press('Delete');
  await expect(annotations(page, 'tag')).toHaveCount(0);
  await page.getByTestId('view-mode-3d').click();
  await expect(page.getByTestId('viewport-canvas')).toBeVisible();
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');

  expect(errors).toEqual([]);
});
