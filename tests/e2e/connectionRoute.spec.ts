import { readFile } from 'node:fs/promises';
import { resolvePipeSpec } from '@hydrobim/catalog';
import {
  addPipe,
  attachFitting,
  connectedComponent,
  createProject,
  getElement,
  ProjectSchema,
  serializeProject,
  validateProject,
  vec3,
  type Project,
  type Result,
} from '@hydrobim/core';
import { expect, test, type Page } from '@playwright/test';
import { ctl } from './ui';

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** Pontas DN 150 à mesma cota, com 11 mm entre os eixos por uma pequena declividade. */
function scenario() {
  const spec = resolvePipeSpec('ferro-ductil-nbr7675-k9', 150);
  if (!spec) throw new Error('Especificação DN 150 ausente.');
  const from = must(
    addPipe(createProject('Ligação entre eixos reversos'), {
      start: vec3(-3, 0, 665.153),
      end: vec3(0, 0, 665.153),
      spec,
      name: 'Trecho do reservatório',
    }),
  );
  const tank = must(
    attachFitting(from.project, {
      target: { elementId: from.elementId, portId: 'start' },
      fitting: { kind: 'tank', diameter: 2, height: 2 },
    }),
  );
  const to = must(
    addPipe(tank.project, {
      start: vec3(4, 10.2, 665.153 + (0.011 * 3) / 7.2),
      end: vec3(4, 7.2, 665.153),
      spec,
      name: 'Trecho de referência',
    }),
  );
  return {
    project: to.project,
    fromId: from.elementId,
    toId: to.elementId,
    tankId: tank.elementId,
  };
}

async function clickModel(page: Page, x: number, y: number): Promise<void> {
  const plan = page.getByTestId('plan-view');
  const box = await page.getByTestId('plan-svg').boundingBox();
  if (!box) throw new Error('Planta sem dimensões.');
  const mpp = Number(await plan.getAttribute('data-mpp'));
  const [cx = 0, cy = 0] = ((await plan.getAttribute('data-center')) ?? '0;0')
    .split(';')
    .map(Number);
  await page.mouse.click(
    box.x + box.width / 2 + (x - cx) / mpp,
    box.y + box.height / 2 - (y - cy) / mpp,
  );
}

async function exported(page: Page): Promise<Project> {
  const pending = page.waitForEvent('download');
  await (await ctl(page, 'action-export')).click();
  return ProjectSchema.parse(JSON.parse(await readFile(await (await pending).path(), 'utf8')));
}

test('percurso entre eixos reversos: prévia nas duas vistas, reservatório fixo e desfazer/refazer', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const setup = scenario();
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await (await ctl(page, 'action-open')).click();
  await page.getByTestId('import-file').setInputFiles({
    name: 'eixos-reversos.hydrobim.json',
    mimeType: 'application/json',
    buffer: Buffer.from(serializeProject(setup.project)),
  });
  await expect(page.getByTestId('open-dialog')).toBeHidden();
  await (await ctl(page, 'view-mode-plan')).click();
  await (await ctl(page, 'tool-connect')).click();
  await clickModel(page, 0, 0);
  await expect(await ctl(page, 'connection-from')).toContainText('Trecho do reservatório');
  await clickModel(page, 4, 7.2);
  await expect(await ctl(page, 'connection-to')).toContainText('Trecho de referência');
  await expect(page.getByTestId('connection-from')).toContainText('665,153 m');
  await expect(page.getByTestId('connection-to')).toContainText('665,153 m');
  await expect(page.getByTestId('connection-guides')).toContainText('entre eixos 0,011 m');
  await expect(page.getByTestId('connection-route-hint')).toBeVisible();
  await expect(page.getByTestId('connection-none')).toBeHidden();

  const option = page.getByTestId('connection-option-route:orthogonal');
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.getByTestId('connection-details')).toContainText('equipamento fica fixo');
  await expect(page.getByTestId('plan-preview-ghost').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/connection-route-previa-planta.png' });
  const before = await exported(page);
  expect(before.elements).toEqual(setup.project.elements);
  expect(before.connections).toEqual(setup.project.connections);

  await (await ctl(page, 'view-mode-3d')).click();
  await page.getByTestId('view-iso').click();
  await expect(page.getByTestId('viewport-guides-text')).toContainText('entre eixos 0,011 m');
  await page
    .getByTestId('viewport-canvas')
    .screenshot({ path: 'test-results/connection-route-previa-3d.png' });
  await (await ctl(page, 'view-mode-plan')).click();
  await (await ctl(page, 'connection-confirm')).click();
  await expect(page.getByTestId('status-message')).toHaveAttribute('data-level', 'success');
  await expect(page.getByTestId('plan-preview-ghost')).toHaveCount(0);
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');
  const after = await exported(page);
  expect(after.elements.length).toBeGreaterThan(before.elements.length);
  for (const original of before.elements) expect(getElement(after, original.id)).toEqual(original);
  expect(connectedComponent(after, setup.tankId)).toContain(setup.toId);
  expect(validateProject(after).filter((issue) => issue.severity === 'error')).toEqual([]);

  await page.keyboard.press('Control+z');
  const undone = await exported(page);
  expect(undone.elements).toEqual(before.elements);
  expect(undone.connections).toEqual(before.connections);
  await page.keyboard.press('Control+y');
  const redone = await exported(page);
  expect(redone.elements).toEqual(after.elements);
  expect(redone.connections).toEqual(after.connections);
  expect(errors).toEqual([]);
});
