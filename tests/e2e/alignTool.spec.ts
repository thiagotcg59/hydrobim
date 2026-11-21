import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { ctl } from './ui';

/**
 * Alinhar por pontos (como o ALIGN do AutoCAD): origem 1 → destino 1 e origem 2 → destino 2,
 * com a prévia antes do último clique; só com o primeiro par, o conjunto é apenas deslocado.
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

interface ExportedElement {
  kind: string;
  start?: { x: number; y: number; z: number };
  end?: { x: number; y: number; z: number };
}

async function exported(page: Page): Promise<{ elements: ExportedElement[] }> {
  const download = page.waitForEvent('download');
  await (await ctl(page, 'action-export')).click();
  return JSON.parse(await readFile(await (await download).path(), 'utf8')) as {
    elements: ExportedElement[];
  };
}

test('planta: alinhar a rede por dois pares de pontos, com prévia e linhas auxiliares', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await (await ctl(page, 'action-new')).click();
  await page.getByTestId('view-mode-plan').click();
  await (await ctl(page, 'tool-pipe')).click();
  const svg = page.getByTestId('plan-svg');
  const box = await svg.boundingBox();
  if (!box) throw new Error('Planta sem dimensões.');
  const at = (x: number, y: number): [number, number] => [
    box.x + box.width / 2 + x * 100,
    box.y + box.height / 2 - y * 100,
  ];
  const message = page.getByTestId('status-message');

  // Trecho em L: tubo, joelho e tubo, todos ligados.
  await page.mouse.click(...at(0, 0));
  await page.mouse.click(...at(3, 0));
  await page.mouse.click(...at(3, 2));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Botão direito sobre o primeiro tubo › Alinhar.
  await page.mouse.click(...at(1.5, 0), { button: 'right' });
  await page.getByTestId('context-align').click();
  const panel = page.getByTestId('align-panel');
  await expect(panel).toHaveAttribute('data-step', 'source1');
  await expect(await ctl(page, 'align-with-connected')).toBeChecked();

  // Origem 1 na extremidade livre (0, 0) → destino 1 em (−2, −2).
  await page.mouse.move(...at(0, 0));
  await page.mouse.click(...at(0, 0));
  await expect(panel).toHaveAttribute('data-step', 'target1');
  await page.mouse.move(...at(-2, -2), { steps: 3 });
  await expect(page.getByTestId('plan-align-guide')).toHaveCount(1);
  await expect(page.getByTestId('plan-preview-ghost')).toHaveCount(3);
  await page.mouse.click(...at(-2, -2));
  await expect(panel).toHaveAttribute('data-step', 'source2');

  // Origem 2 no eixo do tubo (direção leste) → destino 2 ao norte do destino 1: giro de +90°.
  await page.mouse.move(...at(2, 0));
  await page.mouse.click(...at(2, 0));
  await expect(panel).toHaveAttribute('data-step', 'target2');
  await page.mouse.move(...at(-2, 1), { steps: 3 });
  await expect(page.getByTestId('align-step')).toContainText('giro: 90°');
  await expect(page.getByTestId('plan-align-guide')).toHaveCount(2);
  await expect(page.getByTestId('plan-preview-ghost')).toHaveCount(3);
  await page.mouse.click(...at(-2, 1));
  await expect(message).toContainText('alinhados');
  await expect(await ctl(page, 'tool-select')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');

  const after = (await exported(page)).elements.filter((e) => e.kind === 'pipe');
  const first = after[0];
  expect(first?.start?.x).toBeCloseTo(-2);
  expect(first?.start?.y).toBeCloseTo(-2);
  expect(first?.end?.x).toBeCloseTo(-2);
  expect(first?.end?.y ?? 0).toBeGreaterThan(-2);

  // Só com o primeiro par: desloca. Esc na etapa seguinte volta uma etapa.
  await page.mouse.click(...at(-2, -1), { button: 'right' });
  await page.getByTestId('context-align').click();
  await page.mouse.click(...at(-2, -2));
  await page.keyboard.press('Escape');
  await expect(panel).toHaveAttribute('data-step', 'source1');
  await page.mouse.click(...at(-2, -2));
  await page.mouse.click(...at(-1, -2));
  await page.getByTestId('align-apply-first').click();
  await expect(message).toContainText('alinhados');
  const moved = (await exported(page)).elements.filter((e) => e.kind === 'pipe');
  expect(moved[0]?.start?.x).toBeCloseTo(-1);
  expect(moved[0]?.start?.y).toBeCloseTo(-2);

  // "Ponto livre": o destino fica onde se clica, fora dos nós da grade.
  await page.mouse.click(...at(-1, -1), { button: 'right' });
  await page.getByTestId('context-align').click();
  await expect(page.getByTestId('align-snap-note')).toContainText('grade');
  await (await ctl(page, 'align-free-point')).check();
  await page.mouse.click(...at(-1, -2));
  await page.mouse.click(...at(-0.65, -1.35));
  await page.getByTestId('align-apply-first').click();
  await expect(message).toContainText('alinhados');
  const free = (await exported(page)).elements.filter((e) => e.kind === 'pipe');
  // Com a grade (0,10 m), cairia em −0,60/−0,70 e −1,30/−1,40.
  expect(Math.abs((free[0]?.start?.x ?? 0) + 0.65)).toBeLessThan(0.02);
  expect(Math.abs((free[0]?.start?.y ?? 0) + 1.35)).toBeLessThan(0.02);
  await page.keyboard.press('Control+z');

  // Um passo de histórico por alinhamento.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  const original = (await exported(page)).elements.filter((e) => e.kind === 'pipe');
  expect(original[0]?.start?.x).toBeCloseTo(0);
  expect(original[0]?.start?.y).toBeCloseTo(0);
  expect(errors).toEqual([]);
});
