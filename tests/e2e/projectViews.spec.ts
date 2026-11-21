import { expect, test, type Locator, type Page } from '@playwright/test';
import { ctl, openTask } from './ui';

/**
 * Vistas de projeto: navegador de vistas (criar, nomear, duplicar, organizar, abrir, excluir),
 * planta por nível com faixa de corte, corte definido em planta com marcador, elevação, vista
 * 3D com câmera salva e caixa de corte, região de recorte, detalhes 2D com captura e entrada
 * numérica, sincronização com o modelo, desfazer/refazer e persistência.
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

/** Campo do painel "Vista" (abre a aba antes). */
async function viewField(page: Page, testId: string): Promise<Locator> {
  const panel = page.getByTestId('right-panel');
  if ((await panel.getAttribute('data-tab')) !== 'view') {
    await page.getByTestId('panel-tab-view').click();
  }
  return page.getByTestId(testId);
}

async function setViewField(page: Page, testId: string, value: string): Promise<void> {
  const field = await viewField(page, testId);
  await field.fill(value);
  await field.press('Enter');
}

/** Ponto da tela correspondente a um ponto da vista 2D aberta (coordenadas da vista, m). */
async function viewPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const view = page.getByTestId('doc-view');
  const mpp = Number(await view.getAttribute('data-mpp'));
  const [cx, cy] = ((await view.getAttribute('data-center')) ?? '0;0').split(';').map(Number);
  const box = await page.getByTestId('doc-view-svg').boundingBox();
  if (!box) throw new Error('vista 2D não está na tela');
  return {
    x: box.x + box.width / 2 + (x - (cx ?? 0)) / mpp,
    y: box.y + box.height / 2 - (y - (cy ?? 0)) / mpp,
  };
}

async function clickView(page: Page, x: number, y: number): Promise<void> {
  const point = await viewPoint(page, x, y);
  await page.mouse.move(point.x, point.y);
  await page.mouse.click(point.x, point.y);
}

/** Afasta a vista 2D (roda do mouse no centro), para trabalhar em volta do modelo. */
async function zoomOut(page: Page): Promise<void> {
  const box = await page.getByTestId('doc-view-svg').boundingBox();
  if (!box) throw new Error('vista 2D não está na tela');
  const before = await page.getByTestId('doc-view').getAttribute('data-mpp');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 600);
  await expect(page.getByTestId('doc-view')).not.toHaveAttribute('data-mpp', before ?? '');
}

/** Volta à ferramenta Selecionar (encerra o desenho 2D em andamento). */
async function selectTool(page: Page): Promise<void> {
  await (await ctl(page, 'tool-select')).click();
  await expect(page.getByTestId('doc-view')).toHaveAttribute('data-view-tool', 'select');
}

/** Digita na entrada numérica da ferramenta de desenho. */
async function enter(page: Page, text: string): Promise<void> {
  const field = page.getByTestId('view-entry');
  await field.fill(text);
  await field.press('Enter');
}

const details = (page: Page, kind?: string): Locator =>
  page.locator(
    `[data-testid="doc-view-svg"] [data-layer="details"] [data-detail-kind${kind ? `="${kind}"` : ''}]`,
  );

const viewItems = (page: Page): Locator => page.getByTestId('view-item');
const viewNames = (page: Page): Promise<(string | null)[]> =>
  viewItems(page).evaluateAll((items) => items.map((item) => item.getAttribute('data-view-name')));

async function pickElevation(page: Page, direction: string): Promise<void> {
  await openTask(page, 'view');
  await page.getByTestId('ribbon-menu-elevations').click();
  await page.getByTestId(`views-elevation-${direction}`).click();
}

/** Rede de teste: 4 m em X, 3 m em Y e uma prumada de 2,5 m. */
async function buildNetwork(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await (await ctl(page, 'action-new')).click();
  await expect(page.getByTestId('element-count')).toHaveText('0');
  await (await ctl(page, 'tool-pipe')).click();
  await addPoint(page, '0', '0', '0');
  await addPoint(page, '4', '0', '0');
  await addPoint(page, '4', '3', '0');
  await addPoint(page, '4', '3', '2.5');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('nav-summary')).toContainText('5 elementos');
}

test('vistas salvas: planta por nível, corte pelo marcador, elevação e navegador', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await buildNetwork(page);

  // Planta do nível: abre na área da planta e entra no navegador.
  await openTask(page, 'view');
  await page.getByTestId('views-new-plan').click();
  const view = page.getByTestId('doc-view');
  await expect(view).toHaveAttribute('data-view-kind', 'plan');
  await expect(view).toHaveAttribute('data-elements', '5');
  await expect(page.getByTestId('doc-view-title')).toContainText('Planta — Térreo');
  await expect(page.getByTestId('doc-view-title')).toContainText('faixa −0,30 a +3,00');
  await expect(viewItems(page)).toHaveCount(1);
  await expect(page.getByTestId('open-view-2d')).toHaveAttribute(
    'data-view-name',
    'Planta — Térreo',
  );
  await expect(page.getByTestId('right-panel')).toHaveAttribute('data-tab', 'view');
  await page.screenshot({ path: 'test-results/vistas-01-planta.png' });

  // Faixa de corte configurável: com o corte acima de 9 m e 1 m de profundidade, nada do
  // modelo fica na faixa; de volta ao padrão, tudo reaparece. O modelo não muda.
  await setViewField(page, 'view-cut-height', '10');
  await setViewField(page, 'view-depth', '1');
  await expect(view).toHaveAttribute('data-elements', '0');
  await expect(page.getByTestId('doc-view-empty')).toBeVisible();
  await expect(page.getByTestId('nav-summary')).toContainText('5 elementos');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(view).toHaveAttribute('data-elements', '5');
  // Corte a 1 m: a prumada (até 2,5 m) é cortada, mas continua na planta.
  await setViewField(page, 'view-cut-height', '1');
  await expect(view).toHaveAttribute('data-elements', '5');
  await expect(page.getByTestId('doc-view-title')).toContainText('+1,00');

  // Escala e estilo próprios da vista.
  await (await viewField(page, 'view-scale')).selectOption('25');
  await expect(view).toHaveAttribute('data-scale', '25');
  await (await viewField(page, 'view-theme')).selectOption('mono');
  await expect(view).toHaveAttribute('data-theme', 'mono');

  // Corte definido na planta: linha por dois pontos e, depois, o lado e a profundidade.
  await zoomOut(page);
  await openTask(page, 'view');
  await page.getByTestId('views-new-section').click();
  await expect(view).toHaveAttribute('data-view-tool', 'section');
  await clickView(page, -1, -1);
  await clickView(page, 5, -1);
  await expect(page.getByTestId('section-draft')).toBeVisible();
  await clickView(page, 2, 4);
  const marker = page.getByTestId('section-marker');
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveAttribute('data-view-name', 'Corte 1');
  await expect(marker).toHaveAttribute('data-selected', 'true');
  await expect(viewItems(page)).toHaveCount(2);
  // O marcador selecionado mostra a configuração do corte, sem abrir a vista.
  await expect(page.getByTestId('view-panel')).toHaveAttribute('data-view-kind', 'section');
  await expect(await viewField(page, 'view-depth')).toHaveValue('5');
  await page.screenshot({ path: 'test-results/vistas-02-marcador-de-corte.png' });

  // O duplo clique no marcador abre a vista do corte.
  const onLine = await viewPoint(page, 2, -1);
  await page.mouse.dblclick(onLine.x, onLine.y);
  await expect(view).toHaveAttribute('data-view-kind', 'section');
  await expect(page.getByTestId('doc-view-title')).toContainText('Corte 1');
  // A linha vai de x = −1 a x = 5 e olha para +Y: o trecho em X, o joelho, o trecho em Y (de
  // topo) e a prumada estão no alcance de 5 m.
  await expect(view).toHaveAttribute('data-elements', '5');
  await expect(page.getByTestId('doc-view-level').first()).toContainText('Térreo +0,00');
  await page.screenshot({ path: 'test-results/vistas-03-corte.png' });

  // Alcance de 1,5 m (até y = 0,5): ficam o trecho em X, o joelho e o começo do trecho em Y,
  // cortado no limite; a prumada e o joelho dela, a 4 m da linha, saem da vista.
  await setViewField(page, 'view-depth', '1,5');
  await expect(view).toHaveAttribute('data-elements', '3');
  // Inverter o sentido: o observador passa a olhar para −Y, onde não há rede.
  await (await viewField(page, 'view-section-flip')).click();
  await expect(view).toHaveAttribute('data-elements', '0');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(view).toHaveAttribute('data-elements', '5');

  // Elevação sul e leste.
  await pickElevation(page, 'south');
  await expect(view).toHaveAttribute('data-view-kind', 'elevation');
  await expect(page.getByTestId('doc-view-title')).toContainText('Elevação Sul');
  await expect(view).toHaveAttribute('data-elements', '5');
  await page.screenshot({ path: 'test-results/vistas-04-elevacao.png' });
  await (await viewField(page, 'view-direction')).selectOption('east');
  await expect(page.getByTestId('doc-view-title')).toContainText('fachada leste');

  // Navegador: renomear, duplicar, reordenar, abrir e excluir.
  const plan = viewItems(page).filter({ hasText: 'Planta — Térreo' });
  await plan.hover();
  await plan.getByTestId('view-rename').click();
  await page.getByTestId('view-rename-input').fill('Planta baixa — hidráulica');
  await page.getByTestId('view-rename-input').press('Enter');
  expect(await viewNames(page)).toEqual(['Planta baixa — hidráulica', 'Corte 1', 'Elevação Sul']);
  const renamed = viewItems(page).filter({ hasText: 'Planta baixa — hidráulica' });
  await renamed.hover();
  await renamed.getByTestId('view-duplicate').click();
  expect(await viewNames(page)).toEqual([
    'Planta baixa — hidráulica',
    'Planta baixa — hidráulica — cópia',
    'Corte 1',
    'Elevação Sul',
  ]);
  const copy = viewItems(page).filter({ hasText: 'cópia' });
  await copy.hover();
  await copy.getByTestId('view-up').click();
  expect((await viewNames(page))[0]).toBe('Planta baixa — hidráulica — cópia');
  // Abrir pelo navegador: a cópia traz a escala e o tema da original.
  await copy.getByTestId('view-open').click();
  await expect(view).toHaveAttribute('data-view-kind', 'plan');
  await expect(view).toHaveAttribute('data-scale', '25');
  await expect(view).toHaveAttribute('data-theme', 'mono');
  // Excluir a vista aberta volta à planta de trabalho; o modelo continua igual.
  await copy.hover();
  await copy.getByTestId('view-delete').click();
  await expect(viewItems(page)).toHaveCount(3);
  await expect(page.getByTestId('plan-view')).toBeVisible();
  await expect(page.getByTestId('nav-summary')).toContainText('5 elementos');
  // O marcador do corte também aparece na planta de trabalho.
  await expect(page.getByTestId('plan-svg').getByTestId('section-marker')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(viewItems(page)).toHaveCount(4);

  expect(errors).toEqual([]);
});

test('detalhes 2D: desenhar com captura e valores, editar, mover, copiar, excluir e recortar', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await buildNetwork(page);
  await openTask(page, 'view');
  await page.getByTestId('views-new-plan').click();
  const view = page.getByTestId('doc-view');
  await expect(view).toHaveAttribute('data-elements', '5');
  await zoomOut(page);

  // Sem vista salva aberta os detalhes ficam indisponíveis; com ela, as ferramentas valem.
  await openTask(page, 'document');
  await expect(page.getByTestId('detail-line')).toBeEnabled();

  // Linha: primeiro ponto capturado na extremidade do tubo (0;0) e o segundo por valores.
  await page.getByTestId('detail-line').click();
  await expect(page.getByTestId('doc-view-hint')).toContainText('primeiro ponto');
  await clickView(page, 0.03, 0.04);
  await enter(page, '@0;-1');
  await expect(details(page, 'line')).toHaveCount(1);
  // A linha seguinte parte do último ponto: distância e ângulo.
  await enter(page, '2<0');
  await expect(details(page, 'line')).toHaveCount(2);
  // Esc sai do campo, encerra a sequência de linhas e, por fim, a ferramenta.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(view).toHaveAttribute('data-view-tool', 'select');
  await openTask(page, 'document');

  // Retângulo por um canto e as medidas; círculo por centro e raio digitado.
  await page.getByTestId('ribbon-menu-detail-shapes').click();
  await page.getByTestId('detail-rect').click();
  await enter(page, '1;1');
  await enter(page, '@1,5;0,8');
  await expect(details(page, 'rect')).toHaveCount(1);
  await page.getByTestId('ribbon-menu-detail-shapes').click();
  await page.getByTestId('detail-circle').click();
  await clickView(page, 2, -2);
  await enter(page, '0,4');
  await expect(details(page, 'circle')).toHaveCount(1);
  const circle = details(page, 'circle').locator('circle:not([data-ui])');
  await expect(circle).toHaveAttribute('r', '0.4');

  // Polilinha por cliques, fechada com C.
  await page.getByTestId('ribbon-menu-detail-shapes').click();
  await page.getByTestId('detail-polyline').click();
  await clickView(page, -1, 1);
  await clickView(page, -0.5, 2);
  await clickView(page, 0, 1);
  await page.keyboard.press('c');
  await expect(details(page, 'polyline')).toHaveCount(1);
  await expect(details(page, 'polyline').locator('polygon:not([data-ui])')).toHaveCount(1);

  // Texto: o conteúdo é editado no painel.
  await page.getByTestId('detail-text').click();
  await clickView(page, 1, 2.5);
  await expect(details(page, 'text')).toHaveCount(1);
  await expect(page.getByTestId('view-panel')).toHaveAttribute('data-mode', 'details');
  const content = page.getByTestId('detail-text-content');
  await expect(content).toBeFocused();
  await content.fill('DETALHE DO BARRILETE');
  await content.press('Control+Enter');
  await expect(details(page, 'text')).toContainText('DETALHE DO BARRILETE');

  // Cota entre as extremidades do tubo (capturadas), com o afastamento digitado.
  await openTask(page, 'document');
  await page.getByTestId('detail-dimension').click();
  // Extremidade livre do tubo e origem do joelho (o vértice do traçado).
  await clickView(page, 0.02, 0.03);
  await clickView(page, 4.004, -0.004);
  const side = await viewPoint(page, 2, 1);
  await page.mouse.move(side.x, side.y);
  await enter(page, '0,6');
  await expect(details(page, 'dimension')).toHaveCount(1);
  // O valor cotado é derivado dos pontos capturados: 4,00 m.
  await expect(details(page, 'dimension')).toContainText('4,00');
  await selectTool(page);
  await expect(details(page)).toHaveCount(7);
  // Detalhes pertencem à vista: nenhum elemento novo no modelo.
  await expect(page.getByTestId('nav-summary')).toContainText('5 elementos');
  await page.screenshot({ path: 'test-results/vistas-05-detalhes.png' });

  // Selecionar o círculo e editar pelo painel.
  const edge = await viewPoint(page, 2.4, -2);
  await page.mouse.click(edge.x, edge.y);
  await expect(details(page, 'circle')).toHaveAttribute('data-selected', 'true');
  await setViewField(page, 'detail-radius', '0,6');
  await expect(circle).toHaveAttribute('r', '0.6');
  // Mover por valores e copiar: a cópia fica selecionada.
  await setViewField(page, 'detail-dx', '1');
  await page.getByTestId('detail-move').click();
  await expect(await viewField(page, 'detail-center-x')).toHaveValue('3');
  await page.getByTestId('detail-copy').click();
  await expect(details(page, 'circle')).toHaveCount(2);
  await expect(await viewField(page, 'detail-center-x')).toHaveValue('4');
  // Arrastar na vista também move (o centro vai à captura mais próxima).
  // Pelo contorno (o quadrante de cima); a alça do raio fica no quadrante da direita.
  const from = await viewPoint(page, 4, -1.4);
  const to = await viewPoint(page, 4, -2.4);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await expect(await viewField(page, 'detail-center-y')).toHaveValue('-3');
  // Excluir com Del; desfazer e refazer.
  await page.keyboard.press('Delete');
  await expect(details(page, 'circle')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(details(page, 'circle')).toHaveCount(2);
  await page.keyboard.press('Control+y');
  await expect(details(page, 'circle')).toHaveCount(1);

  // Região de recorte: liga pelo comando, ajusta por valor e pela alça.
  await openTask(page, 'document');
  await page.getByTestId('views-crop').click();
  await expect(view).toHaveAttribute('data-crop', 'on');
  await expect(page.getByTestId('doc-view-crop')).toBeVisible();
  await setViewField(page, 'view-crop-max-x', '2');
  await expect(await viewField(page, 'view-crop-max-x')).toHaveValue('2');
  const grip = await page.getByTestId('crop-grip-1-0').boundingBox();
  if (!grip) throw new Error('alça do recorte ausente');
  const target = await viewPoint(page, 3, 0);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, grip.y + grip.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(await viewField(page, 'view-crop-max-x')).toHaveValue('3');
  await page.screenshot({ path: 'test-results/vistas-06-recorte.png' });

  // Os detalhes são desta vista: outra planta do mesmo nível começa sem eles.
  await openTask(page, 'view');
  await page.getByTestId('views-new-plan').click();
  await expect(page.getByTestId('doc-view-title')).toContainText('Planta — Térreo (2)');
  await expect(view).toHaveAttribute('data-details', '0');
  await expect(view).toHaveAttribute('data-crop', 'off');

  expect(errors).toEqual([]);
});

test('vista 3D com câmera salva e caixa de corte; sincronização e persistência', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await buildNetwork(page);

  // Vista 3D: salva a câmera isométrica atual.
  await openTask(page, 'view');
  await page.getByTestId('ribbon-view-isometric').click();
  await page.getByTestId('views-new-3d').click();
  await expect(page.getByTestId('open-view-3d')).toHaveAttribute('data-view-name', 'Vista 3D 1');
  await expect(page.getByTestId('view-panel')).toHaveAttribute('data-view-kind', '3d');
  await expect(page.getByTestId('view-camera')).toContainText('isométrica');

  // Caixa de corte: alças nas faces e valores X, Y e Z.
  await page.getByTestId('views-section-box').click();
  await expect(page.getByTestId('views-section-box')).toHaveAttribute('aria-pressed', 'true');
  const grip = page.getByTestId('section-box-grip-x-max');
  await expect(grip).toBeVisible();
  await expect(page.getByTestId('section-box-grip-z-min')).toBeVisible();
  const canvas = page.getByTestId('viewport-canvas');
  const whole = await canvas.screenshot();
  await page.screenshot({ path: 'test-results/vistas-07-caixa-de-corte.png' });
  // Por valor: a caixa passa a terminar em X = 2 e o desenho muda (metade da rede some).
  await setViewField(page, 'section-box-max-x', '2');
  await expect(await viewField(page, 'section-box-max-x')).toHaveValue('2');
  await expect.poll(async () => Buffer.compare(whole, await canvas.screenshot()) !== 0).toBe(true);
  await page.screenshot({ path: 'test-results/vistas-08-caixa-ajustada.png' });
  // Pela alça: arrastar a face X máxima muda o valor (um passo no histórico).
  const box = await grip.boundingBox();
  if (!box) throw new Error('alça da caixa ausente');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  const dragged = Number(
    (await (await viewField(page, 'section-box-max-x')).inputValue()).replace(',', '.'),
  );
  expect(dragged).not.toBe(2);
  await page.keyboard.press('Control+z');
  await expect(await viewField(page, 'section-box-max-x')).toHaveValue('2');
  // A caixa só controla a visualização: o modelo tem os mesmos cinco elementos.
  await expect(page.getByTestId('nav-summary')).toContainText('5 elementos');

  // Câmera salva: muda-se a vista, e "Aplicar" volta à câmera guardada.
  await page.getByTestId('ribbon-view-top').click();
  const top = await canvas.screenshot();
  await (await viewField(page, 'view-apply-camera')).click();
  await expect.poll(async () => Buffer.compare(top, await canvas.screenshot()) !== 0).toBe(true);

  // Planta e elevação do mesmo modelo.
  await openTask(page, 'view');
  await page.getByTestId('views-new-plan').click();
  const view = page.getByTestId('doc-view');
  await expect(view).toHaveAttribute('data-elements', '5');
  const pipe = page.locator(
    '[data-testid="doc-view-svg"] [data-element-kind="pipe"][data-selected="true"]',
  );
  // Selecionar na vista salva seleciona o elemento do modelo (propriedades à direita).
  const onPipe = await viewPoint(page, 2, 0);
  await page.mouse.click(onPipe.x, onPipe.y);
  await expect(pipe).toHaveCount(1);
  await expect(page.getByTestId('right-panel')).toHaveAttribute('data-tab', 'properties');
  const before = await pipe.boundingBox();
  // Alteração de engenharia: o comprimento do tubo passa de 4 m para 2,5 m.
  await setField(page, 'prop-length', '2.5');
  await expect
    .poll(async () => ((await pipe.boundingBox())?.width ?? 0) < (before?.width ?? 0) * 0.8)
    .toBe(true);
  // A elevação sul mostra o mesmo tubo já encurtado.
  await pickElevation(page, 'south');
  await expect(view).toHaveAttribute('data-view-kind', 'elevation');
  const inElevation = await pipe.boundingBox();
  const mpp = Number(await view.getAttribute('data-mpp'));
  expect((inElevation?.width ?? 0) * mpp).toBeGreaterThan(2.3);
  expect((inElevation?.width ?? 0) * mpp).toBeLessThan(2.7);

  // Um detalhe e o enquadramento salvo, para conferir a persistência.
  await openTask(page, 'document');
  await page.getByTestId('detail-line').click();
  await enter(page, '0;3');
  await enter(page, '@2;0');
  await expect(view).toHaveAttribute('data-details', '1');
  await selectTool(page);
  await openTask(page, 'view');
  await page.getByTestId('views-save-frame').click();
  const center = await view.getAttribute('data-center');
  /** Altura visível da vista (m): é o que o enquadramento salvo conserva. */
  const visibleHeight = async (): Promise<number> => {
    const box = await page.getByTestId('doc-view-svg').boundingBox();
    return Number(await view.getAttribute('data-mpp')) * (box?.height ?? 0);
  };
  const savedHeight = await visibleHeight();

  // Salvar e recarregar a página: vistas, detalhes, caixa e enquadramento voltam.
  await (await ctl(page, 'file-save')).click();
  await page.reload();
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  expect(await viewNames(page)).toEqual(['Planta — Térreo', 'Elevação Sul', 'Vista 3D 1']);
  await viewItems(page).filter({ hasText: 'Elevação Sul' }).getByTestId('view-open').click();
  await expect(view).toHaveAttribute('data-view-kind', 'elevation');
  await expect(view).toHaveAttribute('data-details', '1');
  await expect(view).toHaveAttribute('data-center', center ?? '');
  expect(await visibleHeight()).toBeCloseTo(savedHeight, 2);
  await viewItems(page).filter({ hasText: 'Vista 3D 1' }).getByTestId('view-open').click();
  await expect(page.getByTestId('open-view-3d')).toBeVisible();
  await expect(page.getByTestId('section-box-grip-x-max')).toBeVisible();
  await expect(await viewField(page, 'section-box-max-x')).toHaveValue('2');
  await page.screenshot({ path: 'test-results/vistas-09-reaberto.png' });

  expect(errors).toEqual([]);
});

test('vistas lado a lado: planta salva e vista 3D com caixa de corte, o mesmo modelo', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await buildNetwork(page);
  await (await ctl(page, 'view-split')).click();
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-layout', 'split');
  await openTask(page, 'view');
  await page.getByTestId('views-new-plan').click();
  await page.getByTestId('views-section-box').click();
  await expect(page.getByTestId('doc-view')).toBeVisible();
  await expect(page.getByTestId('viewport-canvas')).toBeVisible();
  await expect(page.getByTestId('open-view-2d')).toBeVisible();
  await expect(page.getByTestId('open-view-3d')).toBeVisible();
  await setViewField(page, 'section-box-max-z', '1,2');
  await page.screenshot({ path: 'test-results/vistas-10-lado-a-lado.png' });
  // Fechar as vistas salvas volta à planta de trabalho e ao modelo padrão; elas continuam salvas.
  await page.getByTestId('open-view-2d-close').click();
  await page.getByTestId('open-view-3d-close').click();
  await expect(page.getByTestId('plan-view')).toBeVisible();
  await expect(viewItems(page)).toHaveCount(2);
  expect(errors).toEqual([]);
});
