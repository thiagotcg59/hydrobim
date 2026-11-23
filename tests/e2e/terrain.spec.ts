import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { ctl, openTask } from './ui';

/**
 * Superfície do terreno na Planta Infra, no navegador real: área desenhada na planta, DEM em
 * ladrilhos (serviço interceptado), GeoTIFF, levantamento com linhas de quebra, curvas de
 * nível, consulta de cota, corte longitudinal, visualização 3D e tratamento de falhas.
 *
 * Os testes não dependem da rede nem consomem o serviço de elevação.
 */

const ELEVATION_HOST = /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\//;
const GEOTIFF = fileURLToPath(
  new URL('../../apps/web/src/terrain/fixtures/dem-utm23s-lzw-f32.tif', import.meta.url),
);

/** Marco zero de São Paulo em SIRGAS 2000 / UTM 23S (o mesmo ponto de controle do Infra). */
const CONTROL = { e: '333287,0215', n: '7394586,0934' };

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    // Falhas de rede simuladas aparecem no console do navegador: não são erros do editor.
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) {
      errors.push(`console: ${message.text()}`);
    }
  });
  return errors;
}

// ----- Ladrilhos de elevação sintéticos (PNG RGB de 256 px, codificação Terrarium) -----

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 255] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** Altitude do relevo de teste em um pixel de um ladrilho (varia de ladrilho para ladrilho). */
const altitudeOf = (x: number, y: number, col: number, row: number): number =>
  760 + ((x * 31 + y * 17) % 20) + col * 0.05 + row * 0.08;

function terrariumTile(x: number, y: number): Buffer {
  const size = 256;
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let row = 0; row < size; row += 1) {
    const base = row * (1 + size * 3);
    for (let col = 0; col < size; col += 1) {
      const value = Math.round((altitudeOf(x, y, col, row) + 32768) * 256);
      raw[base + 1 + col * 3] = (value >> 16) & 255;
      raw[base + 2 + col * 3] = (value >> 8) & 255;
      raw[base + 3 + col * 3] = value & 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8 bits por canal
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

async function serveElevation(page: Page): Promise<{ requests: string[]; fail: boolean }> {
  const state = { requests: [] as string[], fail: false };
  await page.route(ELEVATION_HOST, async (route) => {
    const url = route.request().url();
    state.requests.push(url);
    if (state.fail) {
      await route.fulfill({ status: 503, body: 'indisponível' });
      return;
    }
    const match = /\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url);
    if (!match) {
      await route.fulfill({ status: 404 });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*' },
      body: terrariumTile(Number(match[2]), Number(match[3])),
    });
  });
  return state;
}

// ----- Navegação -----

async function startInfra(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await (await ctl(page, 'action-new')).click();
  await expect(page.getByTestId('element-count')).toHaveText('0');
  await page.getByTestId('environment-infra').click();
  await expect(page.getByTestId('environment-infra')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('view-mode-plan').click();
  await expect(page.getByTestId('plan-view')).toHaveAttribute('data-environment', 'infra');
}

async function setField(page: Page, testId: string, value: string): Promise<void> {
  const field = await ctl(page, testId);
  await field.fill(value);
  await field.press('Enter');
}

async function georeference(page: Page): Promise<void> {
  await (await ctl(page, 'infra-georef')).click();
  await page.getByTestId('geo-picker-form').click();
  const dialog = page.getByTestId('project-dialog');
  await setField(page, 'geo-epsg', '31983');
  await setField(page, 'geo-e', CONTROL.e);
  await setField(page, 'geo-n', CONTROL.n);
  await setField(page, 'geo-h', '760');
  await setField(page, 'geo-vertical', 'Imbituba');
  await expect(dialog.getByTestId('geo-validation')).toHaveAttribute('data-state', 'ready');
  await dialog.getByTestId('geo-save').click();
  await dialog.getByTestId('project-close').click();
}

/** Posição na tela de um ponto do modelo (coordenadas locais), pela janela atual da planta. */
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

/** Ajusta a ampliação da planta para `target` metros por pixel, em torno do centro. */
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

/** Desenha um anel (contorno ou furo) clicando os vértices e fechando no primeiro. */
async function drawRing(page: Page, points: [number, number][]): Promise<void> {
  for (const [x, y] of points) await clickModel(page, x, y);
  await expect(page.getByTestId('terrain-draft')).toHaveAttribute(
    'data-points',
    String(points.length),
  );
  const first = points[0] as [number, number];
  await clickModel(page, first[0], first[1]);
}

async function openTerrainPanel(page: Page): Promise<void> {
  await openTask(page, 'model');
  if (!(await page.getByTestId('terrain-panel').isVisible())) {
    await page.getByTestId('terrain-cmd-panel').click();
  }
  await expect(page.getByTestId('terrain-panel')).toBeVisible();
}

test('DEM em ladrilhos: área desenhada, falha tratada, superfície com procedência e curvas de nível', async ({
  page,
}) => {
  const errors = trackErrors(page);
  const service = await serveElevation(page);
  await startInfra(page);
  await openTerrainPanel(page);

  // Sem georreferência não há como saber onde a área fica: a busca é recusada com o motivo.
  await zoomTo(page, 1);
  await page.getByTestId('terrain-area-draw').click();
  await expect(page.getByTestId('plan-view')).toHaveAttribute('data-terrain-mode', 'area');
  // O painel ocupa a esquerda da planta: a área é desenhada à direita dele.
  await drawRing(page, [
    [20, -150],
    [330, -160],
    [350, 140],
    [40, 160],
  ]);
  await expect(page.getByTestId('terrain-area')).toHaveAttribute('data-vertices', '4');
  await expect(page.getByTestId('terrain-area-info')).toContainText('4 vértices');
  await expect(page.getByTestId('terrain-needs-georeference')).toBeVisible();
  await expect(page.getByTestId('terrain-generate')).toBeDisabled();
  expect(service.requests).toHaveLength(0);

  await georeference(page);
  await openTerrainPanel(page);
  // A área em edição continua onde foi desenhada.
  await expect(page.getByTestId('terrain-area')).toHaveAttribute('data-vertices', '4');

  // Resolução: o padrão não passa da resolução nominal da fonte; o nível mais fino é avisado.
  const zoom = page.getByTestId('terrain-zoom');
  await expect(zoom).toHaveValue('12');
  await expect(page.getByTestId('terrain-resolution-note')).toHaveAttribute(
    'data-oversampled',
    'false',
  );
  await zoom.selectOption('15');
  await expect(page.getByTestId('terrain-resolution-note')).toHaveAttribute(
    'data-oversampled',
    'true',
  );
  await expect(page.getByTestId('terrain-resolution-note')).toContainText('nenhum detalhe real');
  await expect(page.getByTestId('terrain-provider-notes')).toContainText(
    'não declara referência altimétrica',
  );

  // Serviço fora do ar: mensagem de erro, nenhuma superfície criada.
  service.fail = true;
  await page.getByTestId('terrain-generate').click();
  await expect(page.getByTestId('terrain-error')).toContainText('HTTP 503');
  await expect(page.getByTestId('terrain-surface-section')).toHaveCount(0);
  await expect(page.getByTestId('infra-terrain')).toHaveCount(0);

  // Serviço de volta: a superfície é gerada, com andamento e resultado.
  service.fail = false;
  const before = service.requests.length;
  await page.getByTestId('terrain-generate').click();
  await expect(page.getByTestId('terrain-result')).toBeVisible();
  const requested = service.requests.length - before;
  expect(requested).toBeGreaterThan(0);
  expect(requested).toBeLessThanOrEqual(36);

  // Procedência: nada do que a fonte não declara aparece preenchido.
  await expect(page.getByTestId('terrain-source-provider')).toContainText('DEM — Terrain Tiles');
  await expect(page.getByTestId('terrain-source-crs')).toHaveText('EPSG:3857');
  await expect(page.getByTestId('terrain-source-vertical')).toContainText('não declarada');
  await expect(page.getByTestId('terrain-source-accuracy')).toContainText('não declarada');
  await expect(page.getByTestId('terrain-source-resolution')).toContainText(/^4,\d m$/);
  const warnings = page.getByTestId('terrain-warnings');
  await expect(warnings).toContainText('sem conversão para Imbituba');
  await expect(warnings).toContainText('Resolução do raster não é exatidão');
  await expect(warnings).toContainText('sobreamostrados');

  // Malha dentro da área, com cotas locais (altitude − 760 m da origem).
  const mesh = (await page.getByTestId('terrain-surface-mesh').textContent()) ?? '';
  const vertices = Number(/^([\d.]+) vértices/.exec(mesh)?.[1]?.replace(/\./g, ''));
  expect(vertices).toBeGreaterThan(1000);
  expect(vertices).toBeLessThanOrEqual(25000);
  const range = (await page.getByTestId('terrain-surface-range').textContent()) ?? '';
  const [low, high] = [...range.matchAll(/-?\d+,\d+/g)].map((m) => Number(m[0].replace(',', '.')));
  expect(low).toBeGreaterThanOrEqual(0);
  expect(high).toBeLessThanOrEqual(53);
  expect((high ?? 0) - (low ?? 0)).toBeGreaterThan(1);

  // Planta: limite, curvas de nível e leitura de cota sob o cursor.
  await expect(page.getByTestId('terrain-boundary')).toHaveCount(1);
  const contours = page.getByTestId('terrain-contours');
  expect(Number(await contours.getAttribute('data-count'))).toBeGreaterThan(2);
  const inside = await screenOf(page, 180, 0);
  await page.mouse.move(inside[0], inside[1]);
  const readout = page.getByTestId('infra-cursor-terrain');
  await expect(readout).toContainText('decliv.');
  const elevation = Number(await readout.getAttribute('data-elevation'));
  expect(elevation).toBeGreaterThanOrEqual(low ?? 0);
  expect(elevation).toBeLessThanOrEqual(high ?? 0);
  // Fora da área não há cota: nada é extrapolado.
  const outside = await screenOf(page, 420, 0);
  await page.mouse.move(outside[0], outside[1]);
  await expect(readout).toHaveText('Terreno: sem dado');

  // Gerar de novo usa o cache da sessão: nenhum pedido novo ao serviço.
  const cached = service.requests.length;
  await page.getByTestId('terrain-generate').click();
  await expect(page.getByTestId('terrain-warnings')).toContainText('cache desta sessão');
  expect(service.requests.length).toBe(cached);

  // Visualização: intervalo das curvas, triangulação e escala vertical (1:1 por padrão).
  const interval = await ctl(page, 'terrain-contour-interval');
  await interval.selectOption('1');
  await expect(contours).toHaveAttribute('data-interval', '1');
  // Suavização: só o desenho muda (mais pontos na curva); o número de curvas é o mesmo.
  const countBefore = await contours.getAttribute('data-count');
  const lengthBefore = (await contours.locator('path').first().getAttribute('d'))?.length ?? 0;
  await (await ctl(page, 'terrain-contour-smoothing')).check();
  await expect(contours).toHaveAttribute('data-smoothed', 'true');
  expect(await contours.getAttribute('data-count')).toBe(countBefore);
  expect((await contours.locator('path').first().getAttribute('d'))?.length ?? 0).toBeGreaterThan(
    lengthBefore * 2,
  );
  await (await ctl(page, 'terrain-contour-smoothing')).uncheck();
  await (await ctl(page, 'terrain-contours-toggle')).uncheck();
  await expect(page.getByTestId('terrain-contours')).toHaveCount(0);
  await (await ctl(page, 'terrain-contours-toggle')).check();
  await (await ctl(page, 'terrain-triangulation-toggle')).click();
  await expect(page.getByTestId('terrain-triangulation')).toBeVisible();
  await expect(await ctl(page, 'terrain-exaggeration')).toHaveValue('1');
  await expect(await ctl(page, 'terrain-natural')).toHaveAttribute('aria-pressed', 'true');
  await (await ctl(page, 'terrain-exaggeration')).selectOption('5');
  await expect(page.getByTestId('terrain-exaggeration-warning')).toContainText('5×');
  await (await ctl(page, 'terrain-natural')).click();
  await expect(page.getByTestId('terrain-exaggeration-warning')).toHaveCount(0);
  await (await ctl(page, 'terrain-color-mode')).selectOption('slope');

  // Modelo 3D: a superfície é desenhada sem erros; a planta retoma como estava.
  await page.getByTestId('view-mode-3d').click();
  await expect(page.locator('[data-testid="app"]')).toHaveAttribute('data-view-mode', '3d');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(600);

  // Mapa de ruas estendido sobre o relevo: só os ladrilhos da área, com a atribuição visível.
  const streets: string[] = [];
  await page.route(/^https:\/\/tile\.openstreetmap\.org\//, async (route) => {
    streets.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*' },
      body: terrariumTile(1, 2),
    });
  });
  await expect(page.getByTestId('terrain-drape')).toHaveCount(0);
  await (await ctl(page, 'terrain-color-mode')).selectOption('map:osm-standard');
  const drape = page.getByTestId('terrain-drape');
  await expect(drape).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('terrain-drape-attribution')).toContainText('OpenStreetMap');
  await expect(page.getByTestId('terrain-drape-attribution')).toContainText(
    'as cotas são as da superfície',
  );
  expect(streets.length).toBeGreaterThan(0);
  expect(streets.length).toBeLessThanOrEqual(36);
  await page.waitForTimeout(400);
  // Na planta, o mesmo mapa preenche a superfície (recortado pelo contorno), com a atribuição.
  await page.getByTestId('view-mode-plan').click();
  await expect(page.getByTestId('terrain-plan-fill')).toHaveAttribute('data-fill', 'map');
  await expect(page.getByTestId('terrain-plan-map')).toHaveAttribute('data-state', 'ready');
  expect(
    await page.locator('[data-testid="terrain-plan-map"] image[data-tile]').count(),
  ).toBeGreaterThan(0);
  await expect(page.getByTestId('terrain-plan-attribution')).toContainText('OpenStreetMap');
  await expect(page.getByTestId('terrain-plan-notice')).toHaveAttribute('data-state', 'ready');
  await page.getByTestId('view-mode-3d').click();
  // Voltar à cor por altitude tira a imagem e a atribuição.
  await (await ctl(page, 'terrain-color-mode')).selectOption('elevation');
  await expect(drape).toHaveCount(0);
  await page.getByTestId('view-mode-plan').click();
  await expect(page.getByTestId('infra-terrain')).toBeVisible();
  await expect(page.getByTestId('terrain-plan-fill')).toHaveAttribute('data-fill', 'elevation');
  await expect(page.getByTestId('terrain-plan-notice')).toHaveCount(0);

  // A superfície é dado do projeto: desfazer a remove e refazer a devolve.
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('infra-terrain')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('infra-terrain')).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(page.getByTestId('infra-terrain')).toHaveCount(1);

  expect(errors).toEqual([]);
});

test('levantamento com linhas de quebra substitui a superfície; consulta de cota e corte longitudinal', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await startInfra(page);
  await openTerrainPanel(page);
  await page.getByTestId('terrain-tab-survey').click();

  // Plano inclinado z = 100 + 0,02 x + 0,01 y em malha de 10 m, com uma crista 5 m acima dele.
  const plane = (x: number, y: number): number => 100 + 0.02 * x + 0.01 * y;
  const lines: string[] = ['# X Y Z'];
  for (let y = 0; y <= 100; y += 10) {
    for (let x = 0; x <= 100; x += 10) lines.push(`${x} ${y} ${plane(x, y).toFixed(3)}`);
  }
  await page.getByTestId('terrain-survey-points').setInputFiles({
    name: 'levantamento.xyz',
    mimeType: 'text/plain',
    buffer: Buffer.from(lines.join('\n')),
  });
  await expect(page.getByTestId('terrain-survey-points-info')).toContainText('121');
  await page.getByTestId('terrain-survey-breaklines').setInputFiles({
    name: 'crista.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      `# crista\n15 55 ${(plane(15, 55) + 5).toFixed(3)}\n85 55 ${(plane(85, 55) + 5).toFixed(3)}\n`,
    ),
  });
  await expect(page.getByTestId('terrain-survey-breaklines-info')).toContainText('1 (crista.txt)');
  await page.getByTestId('terrain-survey-accuracy').fill('0,05');
  await page.getByTestId('terrain-generate').click();
  await expect(page.getByTestId('terrain-result')).toBeVisible();

  // 121 pontos da malha + 2 da linha de quebra; a exatidão é a informada pelo responsável.
  await expect(page.getByTestId('terrain-surface-mesh')).toContainText('123 vértices');
  await expect(page.getByTestId('terrain-surface-breaklines')).toHaveText('1');
  await expect(page.getByTestId('terrain-source-provider')).toContainText(
    'Levantamento — Pontos XYZ e linhas de quebra',
  );
  await expect(page.getByTestId('terrain-source-accuracy')).toHaveText('0,05 m');
  await expect(page.getByTestId('terrain-source-resolution')).toContainText('não se aplica');
  await expect(page.getByTestId('terrain-surface-range')).toHaveText('100,00 a 107,25 m');
  await expect(page.getByTestId('terrain-breakline')).toHaveCount(1);

  // Enquadrar leva a planta à superfície.
  await page.getByTestId('terrain-panel-close').click();
  await page.getByTestId('view-fit').click();
  await zoomTo(page, 0.4);

  // Consulta de cota: sobre a crista vale a cota da linha de quebra.
  await openTask(page, 'model');
  await page.getByTestId('terrain-cmd-query').click();
  await expect(page.getByTestId('plan-view')).toHaveAttribute('data-terrain-mode', 'query');
  await clickModel(page, 50, 55);
  await expect(page.getByTestId('terrain-query-marker')).toContainText('106,55 m');
  await clickModel(page, 150, 55);
  await expect(page.getByTestId('terrain-query-marker')).toContainText('sem dado de terreno');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('plan-view')).toHaveAttribute('data-terrain-mode', '');

  // Corte longitudinal de (10; 20) a (90; 80): 100 m em planta, cruzando a crista.
  await page.getByTestId('terrain-cmd-profile').click();
  await clickModel(page, 10, 20);
  await clickModel(page, 90, 80);
  await page.keyboard.press('Enter');
  const profile = page.getByTestId('terrain-profile');
  await expect(profile).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('terrain-profile-line')).toBeVisible();
  // A captura do clique tem a resolução de um pixel (0,4 m): tolerância de 1 m no comprimento.
  const length = Number(
    /([\d.,]+) m/
      .exec((await page.getByTestId('terrain-profile-length').textContent()) ?? '')?.[1]
      ?.replace('.', '')
      .replace(',', '.'),
  );
  expect(Math.abs(length - 100)).toBeLessThan(1);
  // Mínima no início (≈ 100,40 m) e máxima sobre a crista (≈ 106,68 m).
  const elevations = [
    ...((await page.getByTestId('terrain-profile-range').textContent()) ?? '').matchAll(/\d+,\d+/g),
  ].map((m) => Number(m[0].replace(',', '.')));
  expect(Math.abs((elevations[0] ?? 0) - 100.4)).toBeLessThan(0.05);
  expect(Math.abs((elevations[1] ?? 0) - 106.68)).toBeLessThan(0.05);

  // Escala real 1:1, sem exagero vertical, e exportação das estacas.
  const chart = page.getByTestId('terrain-profile-chart');
  expect(Number(await chart.getAttribute('data-vertical-factor'))).toBeGreaterThan(1);
  await page.getByTestId('terrain-profile-scale').selectOption('1');
  await expect(chart).toHaveAttribute('data-vertical-factor', '1.0000');
  await expect(page.getByTestId('terrain-profile-note')).toContainText('Escala real 1:1');
  const pending = page.waitForEvent('download');
  await page.getByTestId('terrain-profile-csv').click();
  const csv = await readFile(await (await pending).path(), 'utf8');
  expect(csv.split('\n')[0]).toBe('distancia_m;x_m;y_m;cota_m');
  expect(csv.trim().split('\n').length).toBeGreaterThan(10);
  await page.getByTestId('terrain-profile-close').click();
  await expect(profile).toHaveCount(0);

  // Recorte pela área, com furo: nenhuma cota fora do contorno nem dentro do furo.
  await openTerrainPanel(page);
  await page.getByTestId('terrain-panel-close').click();
  await page.getByTestId('terrain-cmd-area').click();
  await expect(page.getByTestId('terrain-panel')).toBeVisible();
  await page.getByTestId('terrain-panel-close').click();
  await drawRing(page, [
    [12, 12],
    [88, 12],
    [88, 88],
    [12, 88],
  ]);
  await openTerrainPanel(page);
  await page.getByTestId('terrain-hole-draw').click();
  await page.getByTestId('terrain-panel-close').click();
  await drawRing(page, [
    [60, 20],
    [80, 20],
    [80, 40],
    [60, 40],
  ]);
  await expect(page.getByTestId('terrain-area')).toHaveAttribute('data-holes', '1');
  await openTerrainPanel(page);
  await page.getByTestId('terrain-tab-survey').click();
  await page.getByTestId('terrain-survey-clip').check();
  await page.getByTestId('terrain-generate').click();
  await expect(page.getByTestId('terrain-result')).toBeVisible();
  await expect(page.getByTestId('terrain-boundary')).toHaveCount(2);
  await page.getByTestId('terrain-panel-close').click();
  const readout = page.getByTestId('infra-cursor-terrain');
  for (const [x, y, expected] of [
    [70, 30, null],
    [5, 50, null],
    [30, 70, plane(30, 70)],
  ] as const) {
    const [px, py] = await screenOf(page, x, y);
    await page.mouse.move(px, py);
    if (expected === null) await expect(readout).toHaveText('Terreno: sem dado');
    else {
      await expect(readout).toContainText('Terreno');
      const value = Number(await readout.getAttribute('data-elevation'));
      // O ponto sob o cursor tem a resolução de um pixel (0,4 m × 2 % de declividade).
      expect(Math.abs(value - expected)).toBeLessThan(0.02);
    }
  }

  expect(errors).toEqual([]);
});

test('GeoTIFF: raster posicionado pelo sistema declarado no arquivo, com a procedência gravada', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await startInfra(page);
  await georeference(page);
  // O raster de teste cobre E 333000–333320 e N 7394760–7395000 (SIRGAS 2000 / UTM 23S).
  await setField(page, 'infra-goto', '333160; 7394880');
  await zoomTo(page, 0.5);
  await openTerrainPanel(page);
  await page.getByTestId('terrain-tab-geotiff').click();
  await page.getByTestId('terrain-geotiff-file').setInputFiles(GEOTIFF);
  await expect(page.getByTestId('terrain-geotiff-crs')).toHaveText('EPSG:31983');
  await expect(page.getByTestId('terrain-geotiff-vertical')).toHaveText('EPSG:5781');
  await expect(page.getByTestId('terrain-geotiff-info')).toContainText('64 × 48 células');

  // Área de 120 m × 100 m em torno do centro do raster (local = E/N − origem do projeto).
  const [cx, cy] = [333160 - 333287.0215, 7394880 - 7394586.0934];
  await page.getByTestId('terrain-area-draw').click();
  await drawRing(page, [
    [cx + 10, cy - 50],
    [cx + 130, cy - 50],
    [cx + 130, cy + 50],
    [cx + 10, cy + 50],
  ]);
  await expect(page.getByTestId('terrain-stride')).toHaveValue('1');
  await page.getByTestId('terrain-generate').click();
  await expect(page.getByTestId('terrain-result')).toBeVisible();

  await expect(page.getByTestId('terrain-source-provider')).toContainText('DEM — GeoTIFF');
  await expect(page.getByTestId('terrain-source-crs')).toHaveText('EPSG:31983');
  await expect(page.getByTestId('terrain-source-vertical')).toHaveText('EPSG:5781');
  await expect(page.getByTestId('terrain-source-resolution')).toHaveText('5,0 m');
  await expect(page.getByTestId('terrain-source-accuracy')).toContainText('não declarada');
  await expect(page.getByTestId('terrain-warnings')).toContainText(
    'diferente da do projeto (Imbituba)',
  );
  // 120 m × 100 m a cada 5 m: 24 × 20 nós, mais o contorno adensado.
  const mesh = (await page.getByTestId('terrain-surface-mesh').textContent()) ?? '';
  const vertices = Number(/^([\d.]+) vértices/.exec(mesh)?.[1]?.replace(/\./g, ''));
  expect(vertices).toBeGreaterThan(450);
  expect(vertices).toBeLessThan(620);

  // Em um nó do raster a cota é a do arquivo (menos os 760 m da origem), sem interpolação:
  // coluna 40, linha 20 → centro da célula em E 333202,5 e N 7394897,5.
  const value = 700 + 0.5 * 40 + 0.25 * 20 + (((40 * 7919) ^ (20 * 104729)) % 1000) / 100;
  await page.getByTestId('terrain-panel-close').click();
  await openTask(page, 'model');
  await page.getByTestId('terrain-cmd-query').click();
  await zoomTo(page, 0.02);
  await setField(page, 'infra-goto', '333202,5; 7394897,5');
  await openTask(page, 'model');
  await clickModel(page, 333202.5 - 333287.0215, 7394897.5 - 7394586.0934);
  const label = (await page.getByTestId('terrain-query-marker').textContent()) ?? '';
  const measured = Number(/(-?[\d.,]+) m/.exec(label)?.[1]?.replace('.', '').replace(',', '.'));
  // Um pixel de tela (2 cm) sobre triângulos com até ~2 m/m de declividade: 5 cm de folga.
  expect(Math.abs(measured - (value - 760))).toBeLessThan(0.05);

  expect(errors).toEqual([]);
});

test('rede assentada pelo recobrimento: o eixo acompanha o terreno e a superfície é translúcida', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await startInfra(page);
  await openTerrainPanel(page);
  await page.getByTestId('terrain-tab-survey').click();
  // Plano inclinado z = 100 + 0,02 x + 0,01 y em malha de 10 m.
  const plane = (x: number, y: number): number => 100 + 0.02 * x + 0.01 * y;
  const lines: string[] = [];
  for (let y = 0; y <= 100; y += 10) {
    for (let x = 0; x <= 100; x += 10) lines.push(`${x} ${y} ${plane(x, y).toFixed(3)}`);
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
  await zoomTo(page, 0.4);

  // Ferramenta Tubulação com o assentamento por recobrimento de 1,20 m.
  await (await ctl(page, 'tool-pipe')).click();
  const toggle = await ctl(page, 'option-terrain-cover');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  const cover = await ctl(page, 'option-terrain-cover-value');
  await cover.fill('1,2');
  await cover.press('Enter');
  await expect(page.getByTestId('option-terrain-cover-note')).toContainText('terreno − 1,20 m');

  // Fora da superfície não há cota: o ponto é recusado, nada é criado.
  await clickModel(page, 130, 50);
  await expect(page.getByTestId('status-message')).toContainText('fora da superfície');
  await expect(page.locator('[data-testid="plan-svg"] [data-element-kind="pipe"]')).toHaveCount(0);

  // Dois pontos sobre o plano: tubo reto, recobrimento constante de 1,20 m no trecho todo.
  await clickModel(page, 20, 30);
  await clickModel(page, 80, 60);
  const status = page.getByTestId('status-message');
  await expect(status).toContainText('recobrimento de 1,20 m a 1,20 m');
  await expect(status).toHaveAttribute('data-level', 'success');
  await page.keyboard.press('Escape');
  await (await ctl(page, 'tool-select')).click();
  await expect(page.locator('[data-testid="plan-svg"] [data-element-kind="pipe"]')).toHaveCount(1);

  // Cotas do eixo nas pontas: terreno (100,70 e 102,20 m) − 1,20 m − meio diâmetro externo
  // (0,08 m no tubo padrão do ambiente Infra).
  await (await ctl(page, 'infra-layers')).click();
  await (await ctl(page, 'infra-label-elevations')).check();
  await expect(page.getByTestId('infra-label').first()).toContainText('eixo 99,42 m → 100,92 m');
  await (await ctl(page, 'infra-layers')).click();

  // Transparência da superfície no 3D: a rede enterrada fica visível através dela.
  const opacity = await ctl(page, 'terrain-opacity');
  await expect(page.getByTestId('terrain-opacity-value')).toHaveText('40 %');
  await opacity.fill('70');
  await expect(page.getByTestId('terrain-opacity-value')).toHaveText('70 %');
  // Sem seleção: abrir o 3D com um tubo selecionado emite um aviso do React que vem das
  // alças do tubo (comportamento anterior a este recurso, registrado em docs/INFRA.md).
  await clickModel(page, 95, 5);
  await page.getByTestId('view-mode-3d').click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(800);
  if (process.env.HB_SHOTS) {
    await page.getByTestId('view-fit').click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${process.env.HB_SHOTS}/terreno-recobrimento-3d.png` });
  }

  expect(errors).toEqual([]);
});

test('reservatório assentado sobre o terreno no ponto clicado, com a elevação editável', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await startInfra(page);
  await openTerrainPanel(page);
  await page.getByTestId('terrain-tab-survey').click();
  // Plano inclinado z = 100 + 0,02 x + 0,01 y em malha de 10 m.
  const lines: string[] = [];
  for (let y = 0; y <= 100; y += 10) {
    for (let x = 0; x <= 100; x += 10)
      lines.push(`${x} ${y} ${(100 + 0.02 * x + 0.01 * y).toFixed(3)}`);
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
  await zoomTo(page, 0.4);

  // A opção vem ligada quando o projeto tem superfície.
  await (await ctl(page, 'tool-tank')).click();
  await expect(await ctl(page, 'option-terrain-placement')).toBeChecked();
  await expect(page.getByTestId('option-terrain-placement-note')).toContainText(
    'Base do reservatório = terreno no ponto clicado',
  );

  // Terreno em (40, 30): 100 + 0,80 + 0,30 = 101,10 m.
  await clickModel(page, 40, 30);
  await expect(page.getByTestId('status-message')).toContainText(
    'sobre o terreno, na cota 101,100 m',
  );
  await (await ctl(page, 'tool-select')).click();
  await expect(await ctl(page, 'element-properties')).toHaveAttribute('data-element-kind', 'tank');
  await expect(await ctl(page, 'prop-elevation')).toHaveValue('101,1');
  await expect(await ctl(page, 'prop-ground-elevation')).toHaveText('101,100 m');
  await expect(await ctl(page, 'prop-seat-on-terrain')).toBeDisabled();

  // A elevação continua editável; "Assentar no terreno" devolve a base à superfície.
  await setField(page, 'prop-elevation', '103');
  await expect(await ctl(page, 'prop-elevation')).toHaveValue('103');
  await (await ctl(page, 'prop-seat-on-terrain')).click();
  await expect(await ctl(page, 'prop-elevation')).toHaveValue('101,1');

  expect(errors).toEqual([]);
});
