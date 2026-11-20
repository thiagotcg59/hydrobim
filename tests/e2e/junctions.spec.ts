import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ctl } from './ui';

/**
 * Casos de aceite das ligações e derivações, no navegador real, sobre o exemplo
 * `examples/ligacoes-derivacoes` (bomba com bocal livre, tubo à frente desalinhado, coletor
 * flangeado com dois ramais, coletor PBA com um ramal):
 *  A. ligar o bocal da bomba à extremidade do tubo (a bomba fica fixa);
 *  B. prolongar o ramal até o coletor com tê flangeado automático;
 *  C. ramal no lado oposto do tê: conversão em cruzeta, mesmas ligações;
 *  D. o mesmo fluxo em PVC PBA;
 *  E. converter manualmente um tê em cruzeta pelo painel;
 *  F. recusar sem montagem possível (especificações diferentes);
 *  G. desfazer e refazer cada montagem como uma operação.
 */

const EXAMPLE = join(process.cwd(), 'examples', 'ligacoes-derivacoes.hydrobim.json');

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

/** Posição na tela de um ponto do modelo (X, Y), pela janela atual da planta. */
async function screenOf(page: Page, x: number, y: number): Promise<[number, number]> {
  const plan = page.getByTestId('plan-view');
  const box = await page.getByTestId('plan-svg').boundingBox();
  if (!box) throw new Error('Planta sem dimensões.');
  const mpp = Number(await plan.getAttribute('data-mpp'));
  const [cx, cy] = ((await plan.getAttribute('data-center')) ?? '0;0').split(';').map(Number) as [
    number,
    number,
  ];
  return [box.x + box.width / 2 + (x - cx) / mpp, box.y + box.height / 2 - (y - cy) / mpp];
}

async function hoverModel(page: Page, x: number, y: number): Promise<void> {
  const [px, py] = await screenOf(page, x, y);
  await page.mouse.move(px, py);
}

async function clickModel(page: Page, x: number, y: number): Promise<void> {
  const [px, py] = await screenOf(page, x, y);
  await page.mouse.move(px, py);
  await page.mouse.click(px, py);
}

/** Elementos desenhados do tipo (traço real ou símbolo da vista geral Infra). */
const count = (page: Page, kind: string) =>
  page
    .getByTestId('plan-svg')
    .locator(
      `[data-layer="elements"] [data-element-kind="${kind}"], [data-layer-infra="network"] [data-element-kind="${kind}"]`,
    );

/**
 * Aproxima a planta em torno do ponto do modelo (o zoom acompanha o cursor), até `target`
 * metros por pixel: os tubos ficam largos o bastante para o clique sobre o eixo.
 */
async function zoomAt(page: Page, x: number, y: number, target: number): Promise<void> {
  const plan = page.getByTestId('plan-view');
  await hoverModel(page, x, y);
  const mpp = Number(await plan.getAttribute('data-mpp'));
  await page.mouse.wheel(0, Math.log(target / mpp) / 0.0015);
  await expect.poll(async () => Number(await plan.getAttribute('data-mpp'))).toBeCloseTo(target, 2);
}

async function expectSuccess(page: Page): Promise<void> {
  await expect(page.getByTestId('status-message')).toHaveAttribute('data-level', 'success');
}

/** Abre o exemplo e a planta, enquadrando o cenário. */
async function openScenario(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await (await ctl(page, 'action-new')).click();
  await (await ctl(page, 'action-open')).click();
  await page.getByTestId('import-file').setInputFiles(EXAMPLE);
  await expect(page.getByTestId('open-dialog')).toBeHidden();
  await (await ctl(page, 'view-mode-plan')).click();
  await expect(page.getByTestId('plan-view')).toBeVisible();
}

const document = JSON.parse(readFileSync(EXAMPLE, 'utf8')) as {
  elements: { kind: string; name: string; length?: number }[];
};
const pumpLength = document.elements.find((e) => e.kind === 'pump')?.length ?? 1;
const idOf = (name: string): string => {
  const found = (document.elements as { id?: string; name: string }[]).find((e) => e.name === name);
  if (!found?.id) throw new Error(`"${name}" ausente no exemplo.`);
  return found.id;
};

test('B, C e G: ramal flangeado com tê automático e conversão em cruzeta pelo lado oposto', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openScenario(page);
  await zoomAt(page, 6, 0, 0.01);

  // B — Tubulação, Automática: extremidade do ramal norte e, depois, o coletor.
  await (await ctl(page, 'tool-pipe')).click();
  await expect(await ctl(page, 'option-junction-auto')).toHaveAttribute('aria-checked', 'true');
  await clickModel(page, 6, 2);
  await expect(page.getByTestId('plan-anchor')).toBeVisible();
  await hoverModel(page, 7, 0);
  // Prévia: tê proposto e peças (fantasmas) antes do clique.
  await expect(page.getByTestId('plan-preview-junction')).toHaveAttribute('data-kind', 'tee');
  await expect(page.getByTestId('plan-preview-ghost').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/junctions-B-previa-planta.png' });
  await clickModel(page, 7, 0);
  await expectSuccess(page);
  await expect(count(page, 'tee')).toHaveCount(1);
  const teeId = (await count(page, 'tee').first().getAttribute('data-element-id')) ?? '';
  const piece = page
    .getByTestId('plan-svg')
    .locator(`[data-layer="elements"] [data-element-id="${teeId}"]`);
  // O próprio ramal foi prolongado até a derivação (mesmo elemento, sem tubo novo).
  await expect(await ctl(page, 'element-properties')).toHaveAttribute(
    'data-element-id',
    idOf('Ramal norte'),
  );

  // G — desfazer e refazer num passo só.
  await page.keyboard.press('Control+z');
  await expect(count(page, 'tee')).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(count(page, 'tee')).toHaveCount(1);

  // C — ramal sul até o tê: o tê vira cruzeta (mesmo elemento) e recebe a quarta ligação.
  await clickModel(page, 6, -2);
  await hoverModel(page, 6, -0.05);
  await expect(page.getByTestId('plan-preview-junction')).toHaveAttribute('data-kind', 'cross');
  await page.screenshot({ path: 'test-results/junctions-C-previa-cruzeta.png' });
  await clickModel(page, 6, -0.05);
  await expectSuccess(page);
  await expect(page.getByTestId('status-message')).toContainText('convertido em cruzeta');
  await expect(count(page, 'tee')).toHaveCount(0);
  // Mesmo elemento (mesmo id), agora cruzeta; o ramal sul foi prolongado, sem peça nova.
  await expect(piece).toHaveAttribute('data-element-kind', 'cross');
  await expect(await ctl(page, 'element-properties')).toHaveAttribute(
    'data-element-id',
    idOf('Ramal sul'),
  );
  await page.keyboard.press('Control+z');
  await expect(piece).toHaveAttribute('data-element-kind', 'tee');
  await page.keyboard.press('Control+y');
  await expect(piece).toHaveAttribute('data-element-kind', 'cross');

  // Resultado no modelo 3D, enquadrado no conjunto (cruzeta e ramais).
  await page.keyboard.press('Escape');
  await (await ctl(page, 'tool-select')).click();
  await clickModel(page, 6, 0);
  await (await ctl(page, 'view-mode-3d')).click();
  await page.getByTestId('view-iso').click();
  await page.getByTestId('view-fit-selection').click();
  await page.waitForTimeout(800);
  await page
    .getByTestId('viewport-canvas')
    .screenshot({ path: 'test-results/junctions-C-cruzeta-3d.png' });
  expect(errors).toEqual([]);
});

test('A, F e G: alinhar e conectar o bocal da bomba ao tubo, com a bomba fixa', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openScenario(page);
  await (await ctl(page, 'tool-connect')).click();

  // F — ramal PBA × bocal da bomba (ferro dúctil): nenhuma montagem, com o motivo.
  await clickModel(page, 4, -10);
  await expect(await ctl(page, 'connection-from')).toContainText('Ramal PBA');
  await clickModel(page, pumpLength, 10);
  await expect(await ctl(page, 'connection-none')).toContainText('Montagem impossível');
  await expect(await ctl(page, 'connection-none')).toContainText(/especificações diferentes/i);
  await expect(
    page.locator('[data-testid^="connection-option-"][data-action="connect"]'),
  ).toHaveCount(0);
  await expect(page.getByTestId('status-message')).toHaveAttribute('data-level', 'error');
  await (await ctl(page, 'connection-reset')).click();

  // A — extremidade do tubo de recalque e, depois, o bocal de descarga (referência).
  await zoomAt(page, pumpLength + 1.5, 10.2, 0.01);
  const pump = page
    .getByTestId('plan-svg')
    .locator('[data-layer="elements"] [data-element-kind="pump"]');
  const pumpAt = async () =>
    `${await pump.getAttribute('transform')}|${await page.getByTestId('plan-view').getAttribute('data-origin')}`;
  const pumpBefore = await pumpAt();
  await clickModel(page, pumpLength + 3, 10.4);
  await expect(await ctl(page, 'connection-from')).toContainText('Recalque');
  await clickModel(page, pumpLength, 10);
  await expect(await ctl(page, 'connection-to')).toContainText('cota');
  await expect(await ctl(page, 'connection-guides')).toContainText('ΔH 0,400 m');
  // Alternativas: conectar com desvio, alinhar e alinhar + conectar.
  await expect(page.getByTestId('connection-option-align:axis')).toBeVisible();
  await expect(page.getByTestId('connection-option-align:axis+straight')).toBeVisible();
  await expect(page.locator('[data-testid^="connection-option-offset"]').first()).toBeVisible();
  await expect(page.getByTestId('plan-guides')).toBeVisible();
  await page.screenshot({ path: 'test-results/junctions-A-alternativas-planta.png' });

  // Mesma prévia no modelo 3D (fantasmas e guias), sem perder a escolha.
  await (await ctl(page, 'view-mode-3d')).click();
  await page.getByTestId('view-iso').click();
  await page.waitForTimeout(800);
  await expect(page.getByTestId('viewport-guides-text')).toBeVisible();
  await page
    .getByTestId('viewport-canvas')
    .screenshot({ path: 'test-results/junctions-A-previa-3d.png' });
  await (await ctl(page, 'view-mode-plan')).click();

  // Escolhe "alinhar ao eixo + prolongamento": o tubo vai ao eixo do bocal e chega a ele.
  await page.getByTestId('connection-option-align:axis+straight').click();
  await expect(await ctl(page, 'connection-details')).toContainText('equipamento fica fixo');
  await (await ctl(page, 'connection-confirm')).click();
  await expectSuccess(page);
  await expect(page.getByTestId('status-message')).toContainText('Alinhar ao eixo da porta');
  // O painel volta ao início: a montagem foi gravada e a ligação registrada.
  await expect(await ctl(page, 'connection-from')).toContainText('clique uma extremidade livre');
  // A bomba não se moveu.
  expect(await pumpAt()).toBe(pumpBefore);
  // Resultado no modelo 3D, enquadrado no tubo ligado à bomba.
  await (await ctl(page, 'tool-select')).click();
  await clickModel(page, pumpLength + 2, 10);
  await (await ctl(page, 'view-mode-3d')).click();
  await page.getByTestId('view-iso').click();
  await page.getByTestId('view-fit-selection').click();
  await page.waitForTimeout(800);
  await page
    .getByTestId('viewport-canvas')
    .screenshot({ path: 'test-results/junctions-A-resultado-3d.png' });
  await (await ctl(page, 'view-mode-plan')).click();

  // G — uma única operação no histórico.
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('status-message')).not.toHaveAttribute('data-level', 'error');
  await page.keyboard.press('Control+y');
  expect(errors).toEqual([]);
});

test('D, E e G: PVC PBA — tê automático e conversão manual em cruzeta pelo painel', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openScenario(page);
  await zoomAt(page, 4, -11, 0.01);
  await (await ctl(page, 'tool-pipe')).click();
  await clickModel(page, 4, -10);
  await clickModel(page, 5, -12);
  await expectSuccess(page);
  await expect(count(page, 'tee')).toHaveCount(1);

  // E — selecionar o tê e converter pelo painel, com prévia antes de confirmar.
  await page.keyboard.press('Escape');
  await (await ctl(page, 'tool-select')).click();
  await clickModel(page, 4, -12);
  await expect(page.getByTestId('element-properties')).toHaveAttribute('data-element-kind', 'tee');
  const id = await page.getByTestId('prop-id').textContent();
  await (await ctl(page, 'junction-preview')).click();
  await expect(await ctl(page, 'junction-details')).toContainText('Cruzeta');
  // A prévia aparece na planta antes da confirmação; cancelar não altera nada.
  await expect(page.getByTestId('plan-preview-junction')).toHaveAttribute('data-kind', 'cross');
  await (await ctl(page, 'junction-cancel')).click();
  await expect(count(page, 'tee')).toHaveCount(1);
  await (await ctl(page, 'junction-preview')).click();
  await page.screenshot({ path: 'test-results/junctions-E-previa-conversao.png' });
  await (await ctl(page, 'junction-confirm')).click();
  await expectSuccess(page);
  await expect(page.getByTestId('element-properties')).toHaveAttribute(
    'data-element-kind',
    'cross',
  );
  await expect(page.getByTestId('prop-id')).toHaveText(id ?? '');
  const piece = page
    .getByTestId('plan-svg')
    .locator(`[data-layer="elements"] [data-element-id="${id ?? ''}"]`);
  await expect(piece).toHaveAttribute('data-element-kind', 'cross');

  // G
  await page.keyboard.press('Control+z');
  await expect(piece).toHaveAttribute('data-element-kind', 'tee');
  await page.keyboard.press('Control+y');
  await expect(piece).toHaveAttribute('data-element-kind', 'cross');
  expect(errors).toEqual([]);
});
