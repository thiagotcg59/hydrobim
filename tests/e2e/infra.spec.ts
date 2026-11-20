import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { ctl, openProjectTab } from './ui';

/**
 * Ambiente Infra no navegador real: configuração própria, georreferenciamento validado, imagem
 * de satélite posicionada sobre o modelo, planta editável sincronizada com o 3D, coordenadas
 * grandes (origem de renderização), salvar/reabrir e independência do ambiente MEP.
 *
 * O serviço de mapa é interceptado: os testes não dependem da rede nem consomem o serviço.
 */

/** Serviços de ladrilhos das fontes embutidas (satélite e ruas). */
const TILE_HOST = /^https:\/\/(tiles\.maps\.eox\.at|tile\.openstreetmap\.org)\//;
/** PNG de 1 × 1 px, usado como ladrilho de teste. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** Ponto de controle: marco zero de São Paulo em SIRGAS 2000 / UTM 23S (conferido com o PROJ). */
const CONTROL = {
  lon: -46.633309,
  lat: -23.55052,
  e: '333287,0215',
  n: '7394586,0934',
};

function trackErrors(page: Page, ignore: RegExp[] = []): string[] {
  const errors: string[] = [];
  const keep = (text: string): boolean => !ignore.some((pattern) => pattern.test(text));
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && keep(message.text())) {
      errors.push(`console: ${message.text()}`);
    }
  });
  return errors;
}

async function serveTiles(page: Page): Promise<{ requests: string[] }> {
  const requests: string[] = [];
  await page.route(TILE_HOST, async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
  });
  return { requests };
}

async function startInfra(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  // Projeto novo primeiro (o de demonstração não tem alterações a confirmar), depois o ambiente.
  await (await ctl(page, 'action-new')).click();
  await expect(page.getByTestId('element-count')).toHaveText('0');
  await page.getByTestId('environment-infra').click();
  await expect(page.getByTestId('environment-infra')).toHaveAttribute('aria-pressed', 'true');
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

/** Volta o painel lateral ao resumo do projeto (onde fica a contagem de elementos). */
async function showProject(page: Page): Promise<void> {
  const back = await ctl(page, 'back-to-project');
  if (await back.isVisible()) await back.click();
  await expect(page.getByTestId('section-project')).toBeVisible();
}

async function drawPipe(page: Page, from: [string, string, string], to: [string, string, string]) {
  await (await ctl(page, 'tool-pipe')).click();
  await addPoint(page, ...from);
  await addPoint(page, ...to);
  await expect(page.getByTestId('status-message')).not.toHaveAttribute('data-level', 'error');
  await page.keyboard.press('Escape');
  await (await ctl(page, 'tool-select')).click();
  await showProject(page);
}

async function georeference(page: Page): Promise<void> {
  // O estado da georreferência abre o mapa; daqui se chega ao formulário de coordenadas.
  await (await ctl(page, 'infra-georef')).click();
  await page.getByTestId('geo-picker-form').click();
  await expect(page.getByTestId('geo-picker')).toHaveCount(0);
  const dialog = page.getByTestId('project-dialog');
  await expect(dialog.getByTestId('tab-georeference')).toBeVisible();
  await setField(page, 'geo-epsg', '31983');
  // O nome oficial vem do código informado.
  await expect(dialog.getByTestId('geo-crs')).toHaveValue('SIRGAS 2000 / UTM zone 23S');
  await setField(page, 'geo-e', CONTROL.e);
  await setField(page, 'geo-n', CONTROL.n);
  await setField(page, 'geo-h', '760');
  await setField(page, 'geo-vertical', 'Imbituba');
  await expect(dialog.getByTestId('geo-validation')).toHaveAttribute('data-state', 'ready');
  // A origem informada corresponde ao ponto de controle geográfico.
  await expect(dialog.getByTestId('geo-origin-geographic')).toContainText('-23.550520°');
  await expect(dialog.getByTestId('geo-origin-geographic')).toContainText('-46.633309°');
  await dialog.getByTestId('geo-save').click();
  await expect(dialog.getByTestId('geo-state')).toHaveAttribute('data-state', 'ready');
  await dialog.getByTestId('project-close').click();
}

async function download(page: Page, testId: string): Promise<string> {
  const pending = page.waitForEvent('download');
  await (await ctl(page, testId)).click();
  const file = await pending;
  return readFile(await file.path(), 'utf8');
}

/**
 * Distância na tela (px) entre a origem local do modelo — início do tubo — e o lugar onde a
 * imagem do mapa mostra o ponto de controle. A posição do ponto de controle no esquema de
 * ladrilhos é calculada aqui, pelas fórmulas do Web Mercator, sem passar pelo código do editor.
 */
async function controlPointOffset(page: Page): Promise<number> {
  const layer = page.getByTestId('basemap-layer');
  const zoom = Number(await layer.getAttribute('data-zoom'));
  const size = 2 ** zoom;
  const tx = ((CONTROL.lon + 180) / 360) * size;
  const ty = ((1 - Math.asinh(Math.tan((CONTROL.lat * Math.PI) / 180)) / Math.PI) / 2) * size;
  const tile = `${zoom}/${Math.floor(tx)}/${Math.floor(ty)}`;
  await expect(page.locator(`image[data-tile="${tile}"]`)).toHaveCount(1);
  return page.evaluate(
    ({ tile, u, v }) => {
      const image = document.querySelector<SVGImageElement>(`image[data-tile="${tile}"]`);
      const pipe = document.querySelector<SVGLineElement>(
        '[data-testid="plan-svg"] [data-element-kind="pipe"] line',
      );
      const imageMatrix = image?.getScreenCTM();
      const pipeMatrix = pipe?.getScreenCTM();
      if (!image || !pipe || !imageMatrix || !pipeMatrix) return Number.NaN;
      const onMap = new DOMPoint(u, v).matrixTransform(imageMatrix);
      const onModel = new DOMPoint(pipe.x1.baseVal.value, pipe.y1.baseVal.value).matrixTransform(
        pipeMatrix,
      );
      return Math.hypot(onMap.x - onModel.x, onMap.y - onModel.y);
    },
    { tile, u: tx - Math.floor(tx), v: ty - Math.floor(ty) },
  );
}

test('Planta Infra: georreferência validada e satélite posicionado sobre o modelo', async ({
  page,
}) => {
  const errors = trackErrors(page);
  const tiles = await serveTiles(page);
  await startInfra(page);

  // Configuração própria do ambiente.
  await page.getByTestId('view-mode-plan').click();
  await expect(page.getByTestId('view-mode-plan')).toHaveText('Planta Infra');
  await expect(page.getByTestId('view-mode-profile')).toBeVisible();
  const plan = page.getByTestId('plan-view');
  await expect(plan).toHaveAttribute('data-environment', 'infra');
  await expect(await ctl(page, 'infra-scale')).toHaveValue('1000');
  await expect(await ctl(page, 'plan-scale')).toHaveCount(0);

  // Sem georreferência: estado pendente, norte indefinido e nenhuma imagem pedida.
  await expect(await ctl(page, 'infra-georef')).toHaveAttribute('data-state', 'pending');
  await expect(page.getByTestId('infra-north')).toHaveAttribute('data-state', 'undefined');
  await expect(page.getByTestId('infra-crs')).toContainText('georreferenciamento pendente');
  await (await ctl(page, 'infra-basemap')).selectOption('eox-s2cloudless-2016');
  await expect(page.getByTestId('basemap-status')).toHaveAttribute('data-state', 'blocked');
  await expect(page.getByTestId('basemap-layer')).toHaveCount(0);
  expect(tiles.requests).toHaveLength(0);

  // A rede é modelada normalmente, com ou sem mapa.
  await drawPipe(page, ['0', '0', '0'], ['600', '0', '0']);
  await expect(page.getByTestId('element-count')).toHaveText('1');
  await page.getByTestId('view-fit').click();

  await georeference(page);
  await expect(await ctl(page, 'infra-georef')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('infra-north')).toHaveAttribute('data-state', 'grid');
  await expect(page.getByTestId('infra-crs')).toContainText('EPSG:31983');
  await expect(page.getByTestId('infra-crs')).toContainText('Imbituba');

  // Satélite carregado, com fonte, licença, data e resolução visíveis.
  const status = page.getByTestId('basemap-status');
  await expect(status).toHaveAttribute('data-state', 'ready');
  const attribution = page.getByTestId('basemap-attribution');
  await expect(attribution).toContainText('EOX IT Services GmbH');
  await expect(attribution).toContainText('Copernicus Sentinel data 2016');
  await expect(attribution).toContainText('CC BY 4.0');
  await expect(attribution).toContainText('resolução');
  expect(tiles.requests.length).toBeGreaterThan(0);
  expect(tiles.requests.length).toBeLessThanOrEqual(64);

  // Vista geral: o tubo aparece como eixo (símbolo fora de escala), identificado como tal.
  await expect(page.locator('[data-testid="plan-svg"] [data-lod="symbol"]')).toHaveCount(1);
  await expect(page.getByTestId('infra-lod-note')).toBeVisible();

  // O ponto de controle do modelo coincide com o do mapa (tolerância: 1 px de tela).
  expect(await controlPointOffset(page)).toBeLessThan(1);

  // Zoom e deslocamento não desalinham a rede da imagem.
  const svg = page.getByTestId('plan-svg');
  const box = await svg.boundingBox();
  if (!box) throw new Error('Planta sem dimensões.');
  const center: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(center[0] - 120, center[1] + 40);
  await page.mouse.wheel(0, -500);
  await expect(status).toHaveAttribute('data-state', 'ready');
  expect(await controlPointOffset(page)).toBeLessThan(1);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(center[0] + 60, center[1] - 90, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  await page.mouse.wheel(0, 900);
  await expect(status).toHaveAttribute('data-state', 'ready');
  expect(await controlPointOffset(page)).toBeLessThan(1);

  // Coordenadas do cursor nos três referenciais.
  await page.mouse.move(center[0], center[1]);
  await expect(page.getByTestId('infra-cursor-local')).toContainText('X ');
  await expect(page.getByTestId('infra-cursor-projected')).toContainText('E 33');
  await expect(page.getByTestId('infra-cursor-geographic')).toContainText('-23.5');

  // Opacidade, visibilidade e alternância para o fundo técnico.
  await (await ctl(page, 'infra-basemap-visible')).uncheck();
  await expect(page.getByTestId('basemap-layer')).toHaveCount(0);
  await (await ctl(page, 'infra-basemap-visible')).check();
  await expect(page.getByTestId('basemap-layer')).toHaveCount(1);
  await (await ctl(page, 'infra-basemap')).selectOption('');
  await expect(page.getByTestId('basemap-layer')).toHaveCount(0);
  await expect(page.getByTestId('basemap-attribution')).toHaveCount(0);
  await (await ctl(page, 'infra-basemap')).selectOption('eox-s2cloudless-2016');

  // Camadas, rótulos e escala de documentação.
  await (await ctl(page, 'infra-layers')).click();
  await (await ctl(page, 'infra-label-names')).check();
  await (await ctl(page, 'infra-label-lengths')).check();
  await expect(page.getByTestId('infra-label').first()).toContainText('600,00 m');
  await (await ctl(page, 'infra-layer-network')).uncheck();
  await expect(svg.locator('[data-element-kind="pipe"]')).toHaveCount(0);
  await (await ctl(page, 'infra-layer-network')).check();
  await expect(svg.locator('[data-element-kind="pipe"]')).toHaveCount(1);
  await (await ctl(page, 'infra-layers')).click();
  await (await ctl(page, 'infra-scale')).selectOption('2000');
  await expect(page.getByTestId('infra-scale-info')).toContainText('documentação 1:2.000');

  // Navegação por coordenadas do sistema projetado: centraliza no fim do tubo.
  await setField(page, 'infra-goto', '333887,0215; 7394586,0934');
  await expect(plan).toHaveAttribute('data-center', /^600(\.0+\d*)?;/);
  await expect(status).toHaveAttribute('data-state', 'ready');

  // Salvar e reabrir preserva a georreferência, a fonte do mapa e a documentação.
  await page.getByTestId('action-save').click();
  await expect(page.getByTestId('dirty-indicator')).toHaveText('salvo');
  await page.reload();
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await expect(page.getByTestId('element-count')).toHaveText('1');
  await page.getByTestId('view-mode-plan').click();
  await expect(await ctl(page, 'infra-georef')).toHaveAttribute('data-state', 'ready');
  await expect(await ctl(page, 'infra-scale')).toHaveValue('2000');
  await expect(await ctl(page, 'infra-basemap')).toHaveValue('eox-s2cloudless-2016');
  await expect(page.getByTestId('basemap-status')).toHaveAttribute('data-state', 'ready');
  expect(await controlPointOffset(page)).toBeLessThan(1);
  await expect(page.getByTestId('infra-label').first()).toContainText('600,00 m');

  // O arquivo exportado guarda a configuração e a georreferência; o IFC, o referencial.
  const exported = JSON.parse(await download(page, 'action-export')) as {
    georeference: { epsg: number; eastings: number; verticalDatum: string };
    infra: { drawingScale: number; basemap: { sourceId: string } };
  };
  expect(exported.georeference.epsg).toBe(31983);
  expect(exported.georeference.eastings).toBe(333287.0215);
  expect(exported.georeference.verticalDatum).toBe('Imbituba');
  expect(exported.infra.drawingScale).toBe(2000);
  expect(exported.infra.basemap.sourceId).toBe('eox-s2cloudless-2016');
  const ifc = await download(page, 'action-export-ifc');
  expect(ifc).toContain("IFCPROJECTEDCRS('EPSG:31983'");
  expect(ifc).toContain("'SIRGAS 2000','Imbituba','UTM','23S'");
  expect(ifc).toContain('IFCMAPCONVERSION');
  expect(errors).toEqual([]);
});

test('falha do serviço de mapa não impede a edição', async ({ page }) => {
  // O navegador registra no console cada imagem que não carregou: é o comportamento esperado.
  const errors = trackErrors(page, [/Failed to load resource/]);
  let available = false;
  await page.route(TILE_HOST, async (route) => {
    if (available) await route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
    else await route.abort('failed');
  });
  await startInfra(page);
  await page.getByTestId('view-mode-plan').click();
  await drawPipe(page, ['0', '0', '0'], ['600', '0', '0']);
  await page.getByTestId('view-fit').click();
  await georeference(page);
  await (await ctl(page, 'infra-basemap')).selectOption('eox-s2cloudless-2016');

  const status = page.getByTestId('basemap-status');
  await expect(status).toHaveAttribute('data-state', 'unavailable');
  await expect(status).toContainText('A edição continua normalmente');

  // A planta continua editável: novo trecho pela planta, sem pendências de validação.
  await drawPipe(page, ['600', '0', '0'], ['900', '0', '0']);
  await expect(page.getByTestId('element-count')).toHaveText('2');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');
  await expect(page.locator('[data-testid="plan-svg"] [data-element-kind="pipe"]')).toHaveCount(2);

  // O serviço volta: "Tentar novamente" recupera a imagem sem recarregar a página.
  available = true;
  await page.getByTestId('basemap-retry').click();
  await expect(status).toHaveAttribute('data-state', 'ready');
  expect(errors).toEqual([]);
});

test('coordenadas grandes: a origem de renderização não altera o projeto e o 3D acompanha a planta', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await serveTiles(page);
  await startInfra(page);
  await page.getByTestId('view-mode-plan').click();
  const plan = page.getByTestId('plan-view');
  await expect(plan).toHaveAttribute('data-origin', '0;0');

  // Rede modelada diretamente em coordenadas UTM, com milímetros.
  await drawPipe(
    page,
    ['333287,021', '7394586,093', '760,125'],
    ['333887,021', '7394586,093', '760,125'],
  );
  await page.getByTestId('view-fit').click();
  // A vista foi para longe da origem: o desenho passa a ser relativo a um ponto próximo.
  await expect(plan).toHaveAttribute('data-origin', '334000;7395000');
  const svg = page.getByTestId('plan-svg');
  const pipe = svg.locator('[data-element-kind="pipe"]');
  await expect(pipe).toHaveCount(1);

  // O tubo aparece inteiro dentro da vista, com o comprimento certo na tela.
  const span = await page.evaluate(() => {
    const line = document.querySelector<SVGLineElement>(
      '[data-testid="plan-svg"] [data-element-kind="pipe"] line',
    );
    const matrix = line?.getScreenCTM();
    const view = document.querySelector<HTMLElement>('[data-testid="plan-view"]');
    if (!line || !matrix || !view) return null;
    const a = new DOMPoint(line.x1.baseVal.value, line.y1.baseVal.value).matrixTransform(matrix);
    const b = new DOMPoint(line.x2.baseVal.value, line.y2.baseVal.value).matrixTransform(matrix);
    return { pixels: Math.hypot(b.x - a.x, b.y - a.y), mpp: Number(view.dataset.mpp) };
  });
  if (!span) throw new Error('Tubo não desenhado.');
  expect(span.pixels * span.mpp).toBeCloseTo(600, 1);

  // Novo trecho desenhado com o mouse na planta: os pontos saem nas coordenadas do projeto.
  const box = await svg.boundingBox();
  if (!box) throw new Error('Planta sem dimensões.');
  await (await ctl(page, 'tool-pipe')).click();
  await page.mouse.click(box.x + box.width / 2 - 150, box.y + box.height / 2 + 160);
  await page.mouse.click(box.x + box.width / 2 + 150, box.y + box.height / 2 + 160);
  await page.keyboard.press('Escape');
  await (await ctl(page, 'tool-select')).click();
  await showProject(page);
  await expect(page.getByTestId('element-count')).toHaveText('2');
  await expect(pipe).toHaveCount(2);

  // O mesmo modelo no 3D, sem erros de renderização.
  await page.getByTestId('view-mode-3d').click();
  await expect(page.getByTestId('viewport-canvas')).toBeVisible();
  await expect(page.getByTestId('element-count')).toHaveText('2');
  await page.getByTestId('view-fit').click();
  await page.getByTestId('view-mode-plan').click();
  await expect(pipe).toHaveCount(2);
  await expect(plan).toHaveAttribute('data-origin', '334000;7395000');

  // As coordenadas canônicas não foram tocadas pela origem de renderização.
  const exported = JSON.parse(await download(page, 'action-export')) as {
    elements: { start: { x: number; y: number; z: number }; end: { x: number; y: number } }[];
    connections: unknown[];
  };
  const [first, second] = exported.elements;
  expect(first?.start).toEqual({ x: 333287.021, y: 7394586.093, z: 760.125 });
  expect(first?.end.x).toBe(333887.021);
  // O trecho desenhado com o mouse caiu na grade de 1 m, nas coordenadas do projeto.
  expect(second?.start.x).toBeGreaterThan(333000);
  expect(second?.start.x).toBeLessThan(335000);
  expect(Number.isInteger(second?.start.x)).toBe(true);
  expect(Number.isInteger(second?.start.y)).toBe(true);
  expect(second?.start.y).toBe(second?.end.y);
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');
  expect(errors).toEqual([]);
});

test('a configuração Infra não altera o ambiente MEP', async ({ page }) => {
  const errors = trackErrors(page);
  const tiles = await serveTiles(page);
  await startInfra(page);
  await page.getByTestId('view-mode-plan').click();
  await (await ctl(page, 'infra-scale')).selectOption('5000');
  await (await ctl(page, 'infra-basemap')).selectOption('eox-s2cloudless-2016');
  await drawPipe(page, ['0', '0', '0'], ['40', '0', '0']);

  // No MEP a planta é a planta baixa de sempre: sem mapa, sem controles do Infra.
  await page.getByTestId('environment-mep').click();
  const plan = page.getByTestId('plan-view');
  await expect(plan).toHaveAttribute('data-environment', 'mep');
  await expect(page.getByTestId('view-mode-plan')).toHaveText('Planta MEP');
  await expect(page.getByTestId('view-mode-profile')).toHaveCount(0);
  await expect(await ctl(page, 'infra-scale')).toHaveCount(0);
  await expect(await ctl(page, 'infra-georef')).toHaveCount(0);
  await expect(page.getByTestId('infra-north')).toHaveCount(0);
  await expect(page.getByTestId('basemap-layer')).toHaveCount(0);
  // A escala do MEP é a dele, não a do Infra.
  await expect(await ctl(page, 'plan-scale')).toHaveValue('50');
  await (await ctl(page, 'plan-scale')).selectOption('25');
  // Geometria em escala (sem símbolos de vista geral) no MEP.
  await expect(page.locator('[data-testid="plan-svg"] [data-lod="symbol"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="plan-svg"] [data-element-kind="pipe"]')).toHaveCount(1);
  expect(tiles.requests).toHaveLength(0);

  // De volta ao Infra, a configuração dele está intacta.
  await page.getByTestId('environment-infra').click();
  await expect(await ctl(page, 'infra-scale')).toHaveValue('5000');
  await expect(await ctl(page, 'infra-basemap')).toHaveValue('eox-s2cloudless-2016');
  const exported = JSON.parse(await download(page, 'action-export')) as {
    drawingScale: number;
    infra: { drawingScale: number };
  };
  expect(exported.drawingScale).toBe(25);
  expect(exported.infra.drawingScale).toBe(5000);
  expect(errors).toEqual([]);
});

test('georreferência pelo mapa: fuso 21S por padrão, temas de satélite e ruas, modelagem sobre o mapa', async ({
  page,
}) => {
  const errors = trackErrors(page);
  const tiles = await serveTiles(page);
  await startInfra(page);
  await page.getByTestId('view-mode-plan').click();
  await expect(await ctl(page, 'infra-georef')).toHaveAttribute('data-state', 'pending');

  // O georreferenciamento pendente abre o mapa.
  await (await ctl(page, 'infra-georef')).click();
  const picker = page.getByTestId('geo-picker');
  await expect(picker).toBeVisible();
  // Fuso padrão: SIRGAS 2000 / UTM 21S; nada é gravado antes de o usuário escolher um ponto.
  await expect(page.getByTestId('geo-picker-zone')).toHaveValue('21');
  await expect(page.getByTestId('geo-picker-confirm')).toBeDisabled();
  await expect(page.getByTestId('geo-picker-result')).toContainText('Nenhum ponto escolhido');

  // Temas: satélite e ruas, cada um com a sua atribuição.
  const theme = page.getByTestId('geo-picker-theme');
  await expect(theme.locator('option')).toHaveText([
    'Satélite — Sentinel-2 cloudless 2016 (EOX)',
    'Ruas — OpenStreetMap',
  ]);
  await expect(page.getByTestId('geo-picker-attribution')).toContainText('EOX IT Services GmbH');
  await expect
    .poll(() => tiles.requests.some((url) => url.includes('tiles.maps.eox.at')))
    .toBe(true);
  await theme.selectOption('osm-standard');
  await expect(page.getByTestId('geo-picker-attribution')).toContainText('OpenStreetMap');
  await expect
    .poll(() => tiles.requests.some((url) => url.includes('tile.openstreetmap.org')))
    .toBe(true);

  // Fonte própria de alta resolução: o endereço (com a chave do usuário) fica só no navegador.
  const custom: string[] = [];
  await page.route(/^https:\/\/ortofotos\.exemplo\.test\//, async (route) => {
    custom.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
  });
  await page.getByTestId('geo-picker-custom').click();
  await picker
    .getByTestId('custom-source-url')
    .fill('http://ortofotos.exemplo.test/{z}/{x}/{y}.png');
  await picker.getByTestId('custom-source-attribution').fill('© Prefeitura de Exemplo');
  await picker.getByTestId('custom-source-save').click();
  await expect(picker.getByTestId('custom-source-error')).toContainText('https');
  await picker
    .getByTestId('custom-source-url')
    .fill('https://ortofotos.exemplo.test/{z}/{y}/{x}.png?key=CHAVE-DO-USUARIO');
  await picker.getByTestId('custom-source-zoom').fill('20');
  await picker.getByTestId('custom-source-save').click();
  await expect(picker.getByTestId('custom-source-error')).toHaveCount(0);
  await theme.selectOption('custom');
  await expect(page.getByTestId('geo-picker-attribution')).toContainText('© Prefeitura de Exemplo');
  await expect.poll(() => custom.length).toBeGreaterThan(0);
  expect(custom[0]).toContain('key=CHAVE-DO-USUARIO');
  await theme.selectOption('osm-standard');

  // Atalho Esri World Imagery: basta a chave do usuário; o endereço segue a documentação.
  const esri: string[] = [];
  await page.route(/^https:\/\/ibasemaps-api\.arcgis\.com\//, async (route) => {
    esri.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
  });
  await picker.getByTestId('custom-source-esri-apply').click();
  await expect(picker.getByTestId('custom-source-error')).toContainText('chave');
  await picker.getByTestId('custom-source-esri-key').fill('CHAVE-ESRI-DE-TESTE');
  await picker.getByTestId('custom-source-esri-apply').click();
  await expect(picker.getByTestId('custom-source-error')).toHaveCount(0);
  await theme.selectOption('custom');
  await expect(page.getByTestId('geo-picker-attribution')).toContainText('Esri');
  await expect.poll(() => esri.length).toBeGreaterThan(0);
  expect(esri[0]).toMatch(
    /World_Imagery\/MapServer\/tile\/\d+\/\d+\/\d+\?token=CHAVE-ESRI-DE-TESTE$/,
  );
  await theme.selectOption('osm-standard');

  // Navegação: ir para uma coordenada, aproximar com a roda e arrastar.
  const map = page.getByTestId('geo-picker-map');
  await setField(page, 'geo-picker-search', '-15,6; -56,1');
  await expect(map).toHaveAttribute('data-center', '-15.600000;-56.100000');
  const box = await map.boundingBox();
  if (!box) throw new Error('Mapa sem dimensões.');
  const center: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(center[0], center[1]);
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, -100);
  await expect(map).toHaveAttribute('data-zoom', '16');
  // Aproximar no centro não desloca o centro (a menos do meio pixel do cursor, que só existe
  // em posições inteiras quando a altura do mapa é ímpar).
  const [lat, lon] = ((await map.getAttribute('data-center')) ?? '').split(';').map(Number);
  expect(lat).toBeCloseTo(-15.6, 3);
  expect(lon).toBeCloseTo(-56.1, 3);

  // No satélite (10 m por pixel), esta ampliação passa do que a imagem tem: o editor avisa.
  await theme.selectOption('eox-s2cloudless-2016');
  await expect(page.getByTestId('geo-picker-resolution')).toContainText('10 m por pixel');
  await theme.selectOption('osm-standard');
  await expect(page.getByTestId('geo-picker-resolution')).toHaveCount(0);

  // Clique no centro: o ponto escolhido é a coordenada pedida, convertida para o fuso 21S.
  await page.mouse.click(center[0], center[1]);
  await expect(page.getByTestId('geo-picker-marker')).toBeVisible();
  // O clique tem a resolução de um pixel do mapa (cerca de 2 m neste nível).
  await expect(page.getByTestId('geo-picker-geographic')).toContainText(/-15\.(6000|5999)\d\d°/);
  await expect(page.getByTestId('geo-picker-geographic')).toContainText(/-56\.(1000|0999)\d\d°/);
  // E/N de (−56,1°; −15,6°) em EPSG:31981 pelo PROJ 9.8.1: 596.485,065 e 8.275.105,781.
  await expect(page.getByTestId('geo-picker-projected')).toContainText('E 596.48');
  await expect(page.getByTestId('geo-picker-projected')).toContainText('N 8.275.10');

  // Fuso 22S como opção: este ponto não pertence a ele, e o editor não deixa gravar errado.
  await page.getByTestId('geo-picker-zone').selectOption('22');
  await expect(page.getByTestId('geo-picker-warning')).toContainText('pertence ao fuso 21');
  await expect(page.getByTestId('geo-picker-confirm')).toBeDisabled();
  await page.getByTestId('geo-picker-zone').selectOption('21');
  await expect(page.getByTestId('geo-picker-warning')).toHaveCount(0);

  await page.getByTestId('geo-picker-confirm').click();
  await expect(picker).toHaveCount(0);

  // A planta abre georreferenciada, com o mapa de ruas ao fundo, centrada na origem.
  await expect(await ctl(page, 'infra-georef')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('infra-crs')).toContainText('SIRGAS 2000 / UTM zone 21S');
  await expect(page.getByTestId('infra-crs')).toContainText('EPSG:31981');
  await expect(await ctl(page, 'infra-basemap')).toHaveValue('osm-standard');
  await expect(page.getByTestId('plan-view')).toHaveAttribute('data-center', '0;0');
  await expect(page.getByTestId('basemap-status')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('basemap-attribution')).toContainText('OpenStreetMap');

  // Modelagem sobre o mapa, com o mouse.
  const svg = page.getByTestId('plan-svg');
  const plan = await svg.boundingBox();
  if (!plan) throw new Error('Planta sem dimensões.');
  await (await ctl(page, 'tool-pipe')).click();
  await page.mouse.click(plan.x + plan.width / 2 - 160, plan.y + plan.height / 2 + 120);
  await page.mouse.click(plan.x + plan.width / 2 + 160, plan.y + plan.height / 2 + 120);
  await page.keyboard.press('Escape');
  await (await ctl(page, 'tool-select')).click();
  await showProject(page);
  await expect(page.getByTestId('element-count')).toHaveText('1');
  await expect(svg.locator('[data-element-kind="pipe"]')).toHaveCount(1);
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');

  // O projeto guarda o fuso escolhido e a origem do ponto clicado; a altitude não foi inventada.
  const exported = JSON.parse(await download(page, 'action-export')) as {
    georeference: {
      crsName: string;
      epsg: number;
      eastings: number;
      northings: number;
      rotation: number;
      verticalDatum: string | null;
    };
  };
  // A fonte personalizada (e a chave) não vai para o arquivo do projeto.
  expect(JSON.stringify(exported)).not.toContain('CHAVE-DO-USUARIO');
  expect(JSON.stringify(exported)).not.toContain('ortofotos.exemplo.test');
  expect(exported.georeference.crsName).toBe('SIRGAS 2000 / UTM zone 21S');
  expect(exported.georeference.epsg).toBe(31981);
  expect(Math.abs(exported.georeference.eastings - 596485.065)).toBeLessThan(5);
  expect(Math.abs(exported.georeference.northings - 8275105.781)).toBeLessThan(5);
  expect(exported.georeference.rotation).toBe(0);
  expect(exported.georeference.verticalDatum).toBeNull();

  // Reabrir o mapa mostra a origem atual; o formulário continua disponível pelo diálogo.
  await openProjectTab(page, 'georeference');
  await page.getByTestId('geo-open-map').click();
  await expect(page.getByTestId('geo-picker')).toBeVisible();
  await expect(page.getByTestId('geo-picker-zone')).toHaveValue('21');
  await expect(page.getByTestId('geo-picker-map')).toHaveAttribute(
    'data-center',
    /^-15\.(6000|5999)\d\d;-56\.(1000|0999)\d\d$/,
  );
  await page.getByTestId('geo-picker-close').click();
  await expect(page.getByTestId('geo-picker')).toHaveCount(0);
  expect(errors).toEqual([]);
});
