import { expect, test, type Page } from '@playwright/test';
import { ctl, openTask } from './ui';

/**
 * Edição do terreno e terraplenagem na Planta Infra, no navegador real: a superfície como
 * elemento (propriedades, pontos, limite, original preservada), platôs paramétricos com
 * taludes, comparação corte/aterro e quadro de volumes conferido com o resultado analítico.
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) {
      errors.push(`console: ${message.text()}`);
    }
  });
  return errors;
}

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

async function zoomTo(page: Page, target: number): Promise<void> {
  const plan = page.getByTestId('plan-view');
  const box = await page.getByTestId('plan-svg').boundingBox();
  if (!box) throw new Error('Planta sem dimensões.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const mpp = Number(await plan.getAttribute('data-mpp'));
  await page.mouse.wheel(0, Math.log(target / mpp) / 0.0015);
  await expect
    .poll(async () => Number(await plan.getAttribute('data-mpp')))
    .toBeCloseTo(target, target < 1 ? 2 : 1);
}

async function clickModel(page: Page, x: number, y: number): Promise<void> {
  const [px, py] = await screenOf(page, x, y);
  await page.mouse.click(px, py);
}

async function drawRing(page: Page, points: [number, number][]): Promise<void> {
  for (const [x, y] of points) await clickModel(page, x, y);
  await expect(page.getByTestId('terrain-draft')).toHaveAttribute(
    'data-points',
    String(points.length),
  );
  const first = points[0] as [number, number];
  await clickModel(page, first[0], first[1]);
}

async function setNumber(page: Page, testId: string, value: string): Promise<void> {
  const field = page.getByTestId(testId);
  await field.fill(value);
  await field.press('Enter');
}

/** Número em pt-BR ("1.058,80") lido de um controle. */
async function numberOf(page: Page, testId: string): Promise<number> {
  const text = (await page.getByTestId(testId).first().textContent()) ?? '';
  return Number(
    text
      .replace(/[^\d,.-]/g, '')
      .replace(/\./g, '')
      .replace(',', '.'),
  );
}

/** Ambiente Infra com um terreno plano (cota 10 m) de 100 m × 100 m, em malha de 10 m. */
async function startWithFlatTerrain(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await (await ctl(page, 'action-new')).click();
  await expect(page.getByTestId('element-count')).toHaveText('0');
  await page.getByTestId('environment-infra').click();
  await page.getByTestId('view-mode-plan').click();
  await expect(page.getByTestId('plan-view')).toHaveAttribute('data-environment', 'infra');
  await openTask(page, 'model');
  await page.getByTestId('terrain-cmd-panel').click();
  await page.getByTestId('terrain-tab-survey').click();
  const lines: string[] = [];
  for (let y = 0; y <= 100; y += 10) {
    for (let x = 0; x <= 100; x += 10) lines.push(`${x} ${y} 10`);
  }
  await page.getByTestId('terrain-survey-points').setInputFiles({
    name: 'plano.xyz',
    mimeType: 'text/plain',
    buffer: Buffer.from(lines.join('\n')),
  });
  await page.getByTestId('terrain-generate').click();
  await expect(page.getByTestId('terrain-result')).toBeVisible();
  await page.getByTestId('terrain-panel-close').click();
  await page.getByTestId('view-fit').click();
  await zoomTo(page, 0.5);
}

test('platô paramétrico: taludes, corte/aterro e volumes conferidos com o cálculo analítico', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await startWithFlatTerrain(page);

  // As quatro ferramentas estão na faixa, no grupo de terraplenagem.
  for (const id of ['edit', 'platform', 'cutfill', 'volumes']) {
    await expect(page.getByTestId(`terrain-cmd-${id}`)).toBeEnabled();
  }
  await page.getByTestId('terrain-cmd-platform').click();
  await expect(page.getByTestId('earthwork-panel')).toBeVisible();
  await expect(page.getByTestId('earthwork-tab-platforms')).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Sem cota de implantação o perímetro não é aceito: nada é presumido.
  await page.getByTestId('earthwork-platform-draw').click();
  await expect(page.getByTestId('plan-view')).toHaveAttribute('data-terrain-mode', 'platform');
  await drawRing(page, [
    [40, 40],
    [60, 40],
    [60, 60],
    [40, 60],
  ]);
  await expect(page.getByTestId('status-message')).toContainText('Informe a cota de implantação');
  await expect(page.getByTestId('earthwork-platform-item')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Aterro de 2 m com talude 1,5H:1V sobre terreno plano.
  await setNumber(page, 'earthwork-platform-elevation', '12');
  await setNumber(page, 'earthwork-platform-fill', '1,5');
  await page.getByTestId('earthwork-platform-draw').click();
  await drawRing(page, [
    [40, 40],
    [60, 40],
    [60, 60],
    [40, 60],
  ]);
  await expect(page.getByTestId('status-message')).toContainText('"Platô 1" criado');
  await expect(page.getByTestId('earthwork-platform-item')).toHaveCount(1);
  await expect(page.getByTestId('earthwork-outline')).toHaveCount(1);
  await expect(page.getByTestId('earthwork-daylight')).toHaveCount(1);
  // O platô é um item do navegador e mostra as propriedades no painel existente.
  await expect(page.getByTestId('nav-platform')).toHaveCount(1);
  await expect(page.getByTestId('properties-type')).toHaveText('Platô');
  await expect(page.getByTestId('properties-title')).toHaveText('Platô 1');

  // Volumes: a²h + 4·a·r·h/2 + cone (r = 3 m) = 800 + 240 + 6π ≈ 1.058,85 m³ de aterro.
  await page.getByTestId('earthwork-tab-volumes').click();
  const expectedFill = 800 + 240 + 6 * Math.PI;
  expect(Math.abs((await numberOf(page, 'earthwork-q-fill-total')) - expectedFill)).toBeLessThan(
    0.2,
  );
  expect(await numberOf(page, 'earthwork-q-cut-total')).toBe(0);
  // Sem os parâmetros do material, o balanço fica pendente.
  await expect(page.getByTestId('earthwork-settings-missing')).toBeVisible();
  await expect(page.getByTestId('earthwork-q-borrow-total')).toHaveText('—');
  await setNumber(page, 'earthwork-swell', '25');
  await setNumber(page, 'earthwork-factor', '0,9');
  await setNumber(page, 'earthwork-reuse', '100');
  await expect(page.getByTestId('earthwork-settings-missing')).toHaveCount(0);
  // Não há corte: todo o aterro vem de empréstimo.
  const fill = await numberOf(page, 'earthwork-q-fill-total');
  expect(await numberOf(page, 'earthwork-q-borrow-total')).toBeCloseTo(fill, 1);
  expect(await numberOf(page, 'earthwork-q-borrowInSitu-total')).toBeCloseTo(fill / 0.9, 0);

  // Paramétrico: mudar a cota para 7 m transforma o platô em corte de 3 m (talude 1:1).
  await page.getByTestId('earthwork-tab-platforms').click();
  await setNumber(page, 'earthwork-platform-edit-elevation', '7');
  await expect(page.getByTestId('status-message')).toContainText('Platô alterado');
  await page.getByTestId('earthwork-tab-volumes').click();
  const expectedCut = 1200 + 360 + 9 * Math.PI;
  const cut = await numberOf(page, 'earthwork-q-cut-total');
  expect(Math.abs(cut - expectedCut)).toBeLessThan(0.2);
  expect(await numberOf(page, 'earthwork-q-fill-total')).toBe(0);
  // V solto = V corte × 1,25; sem aterro, tudo é excedente.
  expect(await numberOf(page, 'earthwork-q-loose-total')).toBeCloseTo(cut * 1.25, 0);
  expect(await numberOf(page, 'earthwork-q-surplus-total')).toBeCloseTo(cut, 0);

  // Corte/Aterro: natural, projetado e comparação, com legenda.
  await page.getByTestId('earthwork-tab-cutfill').click();
  const surface = page.getByTestId('infra-terrain');
  await expect(surface).toHaveAttribute('data-surface-view', 'compare');
  await expect(page.getByTestId('earthwork-legend').first()).toContainText('corte');
  await expect(page.getByTestId('earthwork-region-cut')).toHaveAttribute('d', /M/);
  await expect(page.getByTestId('earthwork-region-fill')).toHaveAttribute('d', '');
  const designTriangles = Number(await surface.getAttribute('data-triangles'));
  await page.getByTestId('earthwork-view-natural').click();
  await expect(surface).toHaveAttribute('data-surface-view', 'natural');
  await expect(surface).toHaveAttribute('data-triangles', '200');
  expect(designTriangles).toBeGreaterThan(200);
  await expect(page.getByTestId('earthwork-regions')).toHaveCount(0);
  await page.getByTestId('earthwork-view-compare').click();

  // No 3D: o terreno projetado com os sólidos de corte e a legenda.
  await page.getByTestId('view-mode-3d').click();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByTestId('earthwork-3d-notice')).toHaveAttribute('data-view', 'compare');
  await page.waitForTimeout(600);
  if (process.env.HB_SHOTS) {
    await page.getByTestId('view-fit').click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${process.env.HB_SHOTS}/terraplenagem-3d.png` });
  }

  // Desfazer volta o platô ao aterro; remover o platô devolve o terreno natural.
  await page.getByTestId('view-mode-plan').click();
  await page.getByTestId('terrain-cmd-platform').click();
  await page.getByTestId('earthwork-platform-remove').click();
  await expect(page.getByTestId('earthwork-platform-item')).toHaveCount(0);
  await expect(page.getByTestId('nav-platform')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('superfície como elemento: propriedades, pontos, limite e original preservada', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await startWithFlatTerrain(page);

  await page.getByTestId('terrain-cmd-edit').click();
  await expect(page.getByTestId('earthwork-tab-edit')).toHaveAttribute('aria-selected', 'true');
  // A superfície fica selecionada e as propriedades aparecem no painel existente.
  await expect(page.getByTestId('properties-type')).toHaveText('Superfície topográfica');
  await expect(page.getByTestId('terrain-prop-area')).toHaveText('1,00 ha');
  await expect(page.getByTestId('terrain-prop-min')).toContainText('10,000');
  await expect(page.getByTestId('terrain-prop-crs')).toContainText('coordenadas locais');
  await expect(page.getByTestId('terrain-prop-state')).toHaveText('como importada');
  await expect(page.getByTestId('earthwork-surface-counts')).toHaveText('121 · 200');
  const tag = page.getByTestId('terrain-prop-tag');
  await tag.fill('TN-01');
  await tag.press('Enter');
  await expect(page.getByTestId('status-message')).toContainText('Propriedades do terreno');
  await expect(page.getByTestId('nav-terrain-surface')).toBeVisible();

  // Novo ponto: posição na planta, cota confirmada no painel.
  await page.getByTestId('earthwork-point-add').click();
  await expect(page.getByTestId('earthwork-points')).toHaveAttribute('data-count', '121');
  await clickModel(page, 55, 55);
  await expect(page.getByTestId('earthwork-pending-point')).toBeVisible();
  await setNumber(page, 'earthwork-point-new-z', '15');
  await page.getByTestId('earthwork-point-add-confirm').click();
  await expect(page.getByTestId('status-message')).toContainText('Ponto acrescentado');
  await expect(page.getByTestId('earthwork-surface-counts')).toContainText('122 ·');
  await expect(page.getByTestId('terrain-prop-max')).toContainText('15,000');
  await expect(page.getByTestId('terrain-prop-state')).toHaveText('editada (original guardada)');

  // Editar a cota e mover o ponto.
  await page.getByTestId('earthwork-point-edit').click();
  await clickModel(page, 55, 55);
  await expect(page.getByTestId('earthwork-selected-point')).toBeVisible();
  await setNumber(page, 'earthwork-point-z', '12,5');
  await expect(page.getByTestId('status-message')).toContainText('Cota do ponto alterada');
  await expect(page.getByTestId('terrain-prop-max')).toContainText('12,500');
  await setNumber(page, 'earthwork-point-x', '57');
  await expect(page.getByTestId('status-message')).toContainText('Ponto do terreno movido');
  await expect(page.getByTestId('earthwork-point-x')).toHaveValue('57');

  // A superfície original continua disponível para comparação.
  await page.getByTestId('earthwork-tab-cutfill').click();
  await page.getByTestId('earthwork-view-original').click();
  await expect(page.getByTestId('infra-terrain')).toHaveAttribute('data-triangles', '200');
  await page.getByTestId('earthwork-view-design').click();
  await expect(page.getByTestId('infra-terrain')).not.toHaveAttribute('data-triangles', '200');

  // Excluir o ponto e redefinir o limite (cotado pela própria triangulação).
  await page.getByTestId('earthwork-tab-edit').click();
  await page.getByTestId('earthwork-point-remove').click();
  await expect(page.getByTestId('status-message')).toContainText('Ponto excluído');
  await expect(page.getByTestId('earthwork-surface-counts')).toHaveText('121 · 200');
  await page.keyboard.press('Escape');
  // O limite fica à direita do painel, que cobre a borda esquerda da planta.
  await page.getByTestId('earthwork-boundary').click();
  await drawRing(page, [
    [40, 10],
    [90, 10],
    [90, 90],
    [40, 90],
  ]);
  await expect(page.getByTestId('status-message')).toContainText('Limite da superfície redefinido');
  await expect(page.getByTestId('terrain-prop-area')).toHaveText('4.000,0 m²');
  await expect(page.getByTestId('terrain-boundary')).toHaveCount(1);

  // Restaurar a original descarta as edições; Desfazer as recupera.
  await page.getByTestId('earthwork-restore').click();
  await expect(page.getByTestId('terrain-prop-area')).toHaveText('1,00 ha');
  await expect(page.getByTestId('terrain-prop-state')).toHaveText('como importada');
  await expect(page.getByTestId('earthwork-restore')).toBeDisabled();
  await (await ctl(page, 'action-undo')).click();
  await expect(page.getByTestId('terrain-prop-area')).toHaveText('4.000,0 m²');

  expect(errors).toEqual([]);
});
