import { expect, test, type Page } from '@playwright/test';
import { ctl, openProjectTab } from './ui';

/**
 * Percurso em primeira pessoa da aba BIM / IFC no navegador real: W A S D andam, E e Q mudam a
 * altura da vista, o observador caminha sobre a superfície do terreno na cota dela e o clique
 * em um elemento mostra as suas propriedades IFC.
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

const hud = (page: Page) => page.getByTestId('walk-hud');

async function reading(page: Page, name: 'x' | 'y' | 'eye-height' | 'ground'): Promise<number> {
  return Number(await hud(page).getAttribute(`data-${name}`));
}

/** Mantém a tecla pressionada e devolve a leitura quando ela parar de mudar. */
async function hold(page: Page, key: string, ms = 500): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  // A leitura sobre a vista é atualizada algumas vezes por segundo.
  await page.waitForTimeout(350);
}

async function openWalk(page: Page): Promise<void> {
  await page.getByTestId('task-bim').click();
  await page.getByTestId('bim-walk').click();
  await expect(page.getByTestId('walk-view')).toBeVisible();
  await expect(page.getByTestId('walk-canvas')).toBeVisible();
  await expect(page.getByTestId('view-mode-walk')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(400);
}

test('percurso: W A S D, E e Q, e as propriedades IFC do elemento clicado', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  const count = await page.getByTestId('element-count').textContent();
  await openWalk(page);

  // A consulta continua aberta: árvore e painel IFC ao lado do percurso.
  await expect(page.getByTestId('app')).toHaveAttribute('data-view-mode', 'bim');
  await expect(page.getByTestId('bim-tree')).toBeVisible();
  await expect(page.getByTestId('ifc-panel')).toBeVisible();
  await expect(page.getByTestId('status-instruction')).toContainText('W A S D');
  await expect(page.getByTestId('walk-eye-height')).toContainText('1,70');

  // O observador parte olhando para o norte: W avança em +Y, S volta.
  const start = { x: await reading(page, 'x'), y: await reading(page, 'y') };
  await hold(page, 'w');
  const ahead = await reading(page, 'y');
  expect(ahead).toBeGreaterThan(start.y + 0.5);
  expect(await reading(page, 'x')).toBeCloseTo(start.x, 1);
  await hold(page, 's', 250);
  expect(await reading(page, 'y')).toBeLessThan(ahead - 0.2);

  // D anda para a direita (leste) e A para a esquerda.
  await hold(page, 'd');
  const right = await reading(page, 'x');
  expect(right).toBeGreaterThan(start.x + 0.5);
  await hold(page, 'a', 250);
  expect(await reading(page, 'x')).toBeLessThan(right - 0.2);

  // E sobe a vista e Q desce, sem deslocar o observador em planta.
  const before = { x: await reading(page, 'x'), y: await reading(page, 'y') };
  await hold(page, 'e');
  const raised = await reading(page, 'eye-height');
  expect(raised).toBeGreaterThan(1.7 + 0.5);
  await hold(page, 'q', 250);
  expect(await reading(page, 'eye-height')).toBeLessThan(raised - 0.2);
  expect(await reading(page, 'x')).toBeCloseTo(before.x, 2);
  expect(await reading(page, 'y')).toBeCloseTo(before.y, 2);

  // As teclas do percurso não acionam ferramentas (E = Tê, Q = Reservatório, S = Selecionar).
  await expect(page.getByTestId('status-mode')).toContainText('Selecionar');
  await expect(page.getByTestId('ifc-element-count')).toHaveText(count ?? '');

  // Volta ao ponto de partida da vista e clica à frente até acertar um elemento.
  await page.getByTestId('view-mode-3d').click();
  await expect(page.getByTestId('walk-view')).toHaveCount(0);
  await expect(page.getByTestId('app')).toHaveAttribute('data-view-mode', 'bim');
  await page.getByTestId('view-mode-walk').click();
  await expect(page.getByTestId('walk-view')).toBeVisible();
  await page.waitForTimeout(600);
  const box = await page.getByTestId('walk-canvas').boundingBox();
  if (!box) throw new Error('vista do percurso sem dimensões');
  const element = page.getByTestId('ifc-element');
  // O barrilete tem um trecho horizontal à frente do observador: uma varredura vertical, em
  // passos menores que o diâmetro do tubo na tela, acaba por atingi-lo.
  for (let y = box.height * 0.6; y < box.height * 0.95; y += 3) {
    await page.mouse.click(box.x + box.width * 0.45, box.y + y);
    await page.waitForTimeout(40);
    if ((await element.count()) > 0) break;
  }
  await expect(element).toBeVisible();
  await expect(page.getByTestId('ifc-entity')).toHaveText(/^Ifc/);
  await expect(page.getByTestId('ifc-global-id')).toHaveText(/\S{22}/);
  await expect(page.getByTestId('ifc-section-psets')).toBeVisible();

  // Arrastar gira o olhar sem selecionar nem andar.
  const selected = await element.getAttribute('data-element-id');
  const at = { x: await reading(page, 'x'), y: await reading(page, 'y') };
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 20, { steps: 6 });
  await page.mouse.up();
  await expect(element).toHaveAttribute('data-element-id', selected ?? '');
  expect(await reading(page, 'x')).toBeCloseTo(at.x, 2);
  // Depois de girar ~23° para a direita, W já não anda só para o norte.
  await hold(page, 'w');
  expect(await reading(page, 'x')).toBeGreaterThan(at.x + 0.2);

  // Sair da consulta encerra o percurso; nada foi alterado no projeto.
  await page.getByTestId('task-model').click();
  await expect(page.getByTestId('walk-view')).toHaveCount(0);
  await expect(page.getByTestId('app')).not.toHaveAttribute('data-view-mode', 'bim');
  await expect(page.getByTestId('action-undo')).toBeDisabled();

  expect(errors).toEqual([]);
});

test('percurso sobre a superfície do terreno, na cota dela', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await (await ctl(page, 'action-new')).click();
  await expect(page.getByTestId('element-count')).toHaveText('0');

  // Sem elementos nem terreno não há o que percorrer: o comando explica o motivo.
  await page.getByTestId('task-bim').click();
  await expect(page.getByTestId('bim-walk')).toBeDisabled();
  await expect(page.getByTestId('bim-walk')).toHaveAttribute('title', /superfície de terreno/);

  // Rampa: a cota sobe 1 m a cada 10 m para o leste (100 m em x = 0, 110 m em x = 100).
  const dialog = await openProjectTab(page, 'terrain');
  await dialog.getByTestId('terrain-file').setInputFiles({
    name: 'rampa.xyz',
    mimeType: 'text/plain',
    buffer: Buffer.from('0 0 100\n100 0 110\n100 100 110\n0 100 100\n50 50 105\n'),
  });
  await expect(dialog.getByTestId('terrain-points')).toHaveText('5');
  await dialog.getByTestId('project-close').click();

  await openWalk(page);
  await expect(hud(page)).toHaveAttribute('data-on-terrain', 'true');
  const x0 = await reading(page, 'x');
  // Parte do meio da superfície (com um pequeno desvio, para não ficar sobre um vértice).
  expect(Math.abs(x0 - 50)).toBeLessThan(1);
  expect(await reading(page, 'ground')).toBeCloseTo(100 + x0 / 10, 1);
  await expect(page.getByTestId('walk-ground')).toContainText('Cota do terreno');

  // Andando para o leste, o observador sobe com a rampa e continua em pé sobre ela.
  await hold(page, 'd', 900);
  const x1 = await reading(page, 'x');
  expect(x1).toBeGreaterThan(x0 + 1.5);
  expect(await reading(page, 'ground')).toBeCloseTo(100 + x1 / 10, 1);
  expect(await reading(page, 'eye-height')).toBeCloseTo(1.7, 2);

  // Para o oeste, desce.
  await hold(page, 'a', 1500);
  const x2 = await reading(page, 'x');
  expect(x2).toBeLessThan(x0 - 0.5);
  expect(await reading(page, 'ground')).toBeCloseTo(100 + x2 / 10, 1);

  // E e Q mudam só a altura da vista sobre o terreno.
  await hold(page, 'e', 400);
  expect(await reading(page, 'eye-height')).toBeGreaterThan(2.2);
  expect(await reading(page, 'ground')).toBeCloseTo(100 + x2 / 10, 1);

  expect(errors).toEqual([]);
});
