import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ctl, openTask } from './ui';

/**
 * Importação de modelos IFC no navegador real: leitura no Web Worker (web-ifc em
 * WebAssembly), prévia, escolha de objetos, posicionamento com prévia nas vistas, navegador,
 * propriedades, edição com desfazer/refazer, vistas 2D e salvar/reabrir depois de limpar o
 * armazenamento do navegador. Os arquivos são os de `tests/fixtures/ifc-import`, conferidos
 * contra o IfcOpenShell em `tests/integration/ifcImport.test.ts`.
 */

// O Playwright roda da raiz do repositório.
const FIXTURES = resolve(process.cwd(), 'tests/fixtures/ifc-import');
const fixture = (name: string): string => resolve(FIXTURES, name);

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function start(page: Page, options: { empty?: boolean } = {}): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  if (options.empty) {
    await (await ctl(page, 'action-new')).click();
    await expect(page.getByTestId('element-count')).toHaveText('0');
  }
}

/** Arquivo › Importar IFC, até a prévia (ou o erro). */
async function chooseFile(
  page: Page,
  file: string | { name: string; mimeType: string; buffer: Buffer },
): Promise<Locator> {
  await (await ctl(page, 'action-import-ifc')).click();
  const dialog = page.getByTestId('ifc-import-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('ifc-import-file').setInputFiles(file);
  return dialog;
}

async function openPreview(page: Page, name: string): Promise<Locator> {
  const dialog = await chooseFile(page, fixture(name));
  await expect(dialog).toHaveAttribute('data-step', 'preview', { timeout: 30_000 });
  return dialog;
}

const number = async (page: Page, testId: string, value: string): Promise<void> => {
  const field = page.getByTestId(testId);
  await field.fill(value);
  await field.press('Enter');
};

const property = (page: Page, key: string): Locator =>
  page.locator(`[data-testid="ifc-import-property"][data-property="${key}"]`);

const drawn = (page: Page, view: 'plan-svg' | 'doc-view-svg'): Locator =>
  page.getByTestId(view).locator('[data-layer="ifc-models"] > [data-ifc-id]');

async function selectByName(page: Page, name: string): Promise<Locator> {
  await page.getByTestId('nav-search').fill(name);
  const item = page.getByTestId('ifc-item').first();
  await expect(item).toBeVisible();
  await item.click();
  return item;
}

test('importa o modelo completo, consulta, edita, desfaz e reabre depois de limpar o navegador', async ({
  page,
}) => {
  // Fluxo de aceite longo (leitura, 3D, vistas, gravação e reabertura).
  test.setTimeout(240_000);
  const errors = trackErrors(page);
  await start(page, { empty: true });

  // --- Prévia: esquema, unidades, pavimentos, categorias, quantidade e relatório ---------
  const dialog = await openPreview(page, 'predio-ifc4-mm.ifc');
  await expect(page.getByTestId('ifc-import-schema')).toHaveText('IFC4');
  await expect(page.getByTestId('ifc-import-units')).toContainText('MILLIMETRE (mm)');
  await expect(page.getByTestId('ifc-import-length-unit')).toContainText('0,001 m');
  await expect(page.getByTestId('ifc-import-storeys')).toContainText('Térreo');
  await expect(page.getByTestId('ifc-import-storeys')).toContainText('Pavimento 1 (3 m)');
  await expect(page.getByTestId('ifc-import-count')).toContainText('11');
  await expect(page.getByTestId('ifc-import-georeference')).toContainText('EPSG:31982');
  await expect(page.getByTestId('ifc-import-preview')).toBeVisible();
  const report = page.getByTestId('ifc-import-report');
  for (const code of ['NO_GEOMETRY', 'UNSUPPORTED_REPRESENTATION', 'OPENINGS', 'PORTS']) {
    await expect(report.locator(`li[data-code="${code}"]`)).toBeVisible();
  }
  await expect(report.locator('li[data-code="NO_GEOMETRY"]')).toContainText('nada é desenhado');
  await expect(
    page.locator('[data-testid="ifc-import-category"][data-entity="IfcColumn"]'),
  ).toBeChecked();
  await expect(page.getByTestId('ifc-import-selected')).toContainText('11 de 11');
  // A porta sem geometria está na árvore, marcada — não foi descartada.
  await expect(page.locator('[data-testid="ifc-import-object"][data-geometry="none"]')).toHaveCount(
    1,
  );

  // --- Posicionamento: deslocamento informado, com a prévia nas vistas --------------------
  await page.getByTestId('ifc-import-next').click();
  await expect(dialog).toBeHidden();
  const placement = page.getByTestId('ifc-placement');
  await expect(placement).toBeVisible();
  await expect(page.getByTestId('ifc-mode-original')).toBeChecked();
  await expect(page.getByTestId('ifc-placement-min')).toContainText('103,363 m');
  // Nada entrou no projeto ainda.
  await expect(page.getByTestId('action-undo')).toBeDisabled();
  await page.getByTestId('view-mode-plan').click();
  const ghost = page.getByTestId('plan-svg').locator('[data-layer="ifc-ghost"] [data-ifc-ghost]');
  await expect(ghost).toHaveCount(9);
  await page.getByTestId('ifc-mode-offset').check();
  await number(page, 'ifc-offset-x', '-100');
  await number(page, 'ifc-offset-y', '-50');
  await number(page, 'ifc-offset-z', '-10');
  await expect(page.getByTestId('ifc-placement-min')).toContainText('3,363 m; 1,863 m; 0,000 m');
  await page.getByTestId('ifc-placement-confirm').click();
  await expect(placement).toBeHidden();
  await expect(page.getByTestId('status-message')).toHaveAttribute('data-level', 'success');
  await expect(page.getByTestId('status-message')).toContainText('11 objeto(s)');
  await expect(page.getByTestId('nav-ifc-count')).toHaveText('11');
  await expect(page.getByTestId('nav-ifc-model')).toHaveAttribute('data-status', 'ready');

  // --- Modelo no painel e nas vistas -------------------------------------------------------
  const modelPanel = page.getByTestId('ifc-model-properties');
  await expect(modelPanel).toBeVisible();
  await expect(page.getByTestId('ifc-model-schema')).toHaveText('IFC4');
  await expect(page.getByTestId('ifc-model-objects')).toHaveText('11');
  await expect(page.getByTestId('ifc-model-transform')).toContainText('ΔX -100,000 m');
  await expect(drawn(page, 'plan-svg')).toHaveCount(9);
  await expect(page.getByTestId('plan-svg').locator('[data-layer="ifc-ghost"]')).toHaveCount(0);

  await page.getByTestId('view-mode-3d').click();
  const canvas = page.getByTestId('viewport-canvas');
  await expect(canvas).toBeVisible();
  await page
    .getByTestId('view-fit')
    .click()
    .catch(() => undefined);
  await page.waitForTimeout(600);
  const shown = await canvas.screenshot();
  await page.getByTestId('ifc-model-visibility').click();
  await page.waitForTimeout(400);
  const hidden = await canvas.screenshot();
  expect(shown.equals(hidden), 'o modelo importado aparece no Modelo 3D').toBe(false);
  await page.getByTestId('action-undo').click();
  await page.waitForTimeout(400);

  // Transparência ajustável (dado do projeto, com desfazer).
  await page.getByTestId('ifc-model-opacity').fill('40');
  await expect(page.getByTestId('ifc-model-opacity-value')).toHaveText('40%');
  await page.waitForTimeout(300);
  expect((await canvas.screenshot()).equals(shown), 'a transparência muda o desenho').toBe(false);

  // --- Objeto: identidade, propriedades, materiais, classificação ---------------------------
  await page.getByTestId('view-mode-plan').click();
  const wall = await selectByName(page, 'Parede A');
  const globalId = (await wall.getAttribute('data-global-id')) ?? '';
  expect(globalId).toHaveLength(22);
  const panel = page.getByTestId('ifc-properties');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('properties-title')).toHaveText('Parede A');
  await expect(property(page, 'GlobalId')).toContainText(globalId);
  await expect(property(page, 'Entity')).toContainText('IfcWall');
  await expect(property(page, 'PredefinedType')).toContainText('SOLIDWALL');
  await expect(property(page, 'Type')).toContainText('Parede de alvenaria 20 cm');
  await expect(property(page, 'Storey')).toContainText('Térreo');
  await expect(property(page, 'Description')).toContainText('Parede externa com vão de porta');
  const occurrence = page.getByTestId('ifc-group-occurrence-Pset_WallCommon');
  await expect(occurrence.locator('[data-property="Pset_WallCommon.FireRating"]')).toContainText(
    'EI 120',
  );
  await expect(occurrence.locator('[data-property="Pset_WallCommon.Reference"]')).toContainText(
    'PAR-01',
  );
  await expect(occurrence.locator('[data-property="Pset_WallCommon.IsExternal"]')).toHaveAttribute(
    'data-nature',
    'occurrence',
  );
  // A mesma propriedade no tipo fica separada, com outro valor.
  const typeSet = page.getByTestId('ifc-group-type-Pset_WallCommon');
  await expect(typeSet.locator('[data-property="Pset_WallCommon.Reference"]')).toContainText(
    'TIPO-20',
  );
  await expect(typeSet.locator('[data-property="Pset_WallCommon.Reference"]')).toHaveAttribute(
    'data-nature',
    'type',
  );
  // Unidade e tipo de valor do arquivo preservados; valor ausente fica "não informado".
  await expect(property(page, 'Construtora_Dados.Altura')).toContainText('2.800 mm');
  await expect(property(page, 'Construtora_Dados.Altura')).toContainText('IfcLengthMeasure');
  await expect(property(page, 'Construtora_Dados.Fornecedor')).toHaveAttribute(
    'data-nature',
    'pending',
  );
  await expect(property(page, 'Qto_WallBaseQuantities.GrossSideArea')).toContainText('11,2 m²');
  await expect(property(page, 'Material.1')).toContainText('Bloco cerâmico · 160 mm');
  await expect(property(page, 'Classification.0')).toContainText('3E 04 10');
  await expect(property(page, 'BoundsSize')).toHaveAttribute('data-nature', 'calculated');
  // O objeto selecionado fica realçado na planta.
  await expect(page.getByTestId('plan-svg').locator('[data-ifc-id][data-selected]')).toHaveCount(1);

  // Busca por classe e por GlobalId.
  await page.getByTestId('nav-search').fill('IfcColumn');
  await expect(page.getByTestId('ifc-item')).toHaveCount(3);
  await page.getByTestId('nav-search').fill(globalId);
  await expect(page.getByTestId('ifc-item')).toHaveCount(1);

  // --- Ocultar, isolar, mostrar ----------------------------------------------------------
  await page.getByTestId('ifc-isolate').click();
  await expect(drawn(page, 'plan-svg')).toHaveCount(1);
  await page.getByTestId('nav-search').fill('');
  await page.getByTestId('ifc-show-all').click();
  await expect(drawn(page, 'plan-svg')).toHaveCount(9);
  await page.getByTestId('ifc-hide').click();
  await expect(drawn(page, 'plan-svg')).toHaveCount(8);
  await page.getByTestId('ifc-show-all').click();

  // --- Mover, copiar e remover componentes, com desfazer e refazer -----------------------
  await selectByName(page, 'Parede A');
  await number(page, 'ifc-move-dy', '4');
  await page.getByTestId('ifc-copy-apply').click();
  await expect(page.getByTestId('nav-ifc-count')).toHaveText('12');
  await expect(page.locator('[data-testid="ifc-item"][data-copy]')).toHaveCount(1);
  const copy = page.getByTestId('ifc-properties');
  await expect(copy).toHaveAttribute('data-state', 'ready');
  // A cópia tem identidade interna própria e o GlobalId de origem.
  await expect(property(page, 'GlobalId')).toContainText(globalId);
  await expect(property(page, 'InternalId')).toContainText('cópia');
  await expect(property(page, 'ObjectTransform')).toContainText('ΔY 4,000 m');
  await page.getByTestId('ifc-remove').click();
  await expect(page.getByTestId('nav-ifc-count')).toHaveText('11');
  await page.getByTestId('action-undo').click();
  await expect(page.getByTestId('nav-ifc-count')).toHaveText('12');
  await page.getByTestId('action-undo').click();
  await expect(page.getByTestId('nav-ifc-count')).toHaveText('11');
  await page.getByTestId('action-redo').click();
  await expect(page.getByTestId('nav-ifc-count')).toHaveText('12');

  // Mover e girar o modelo inteiro.
  await page.getByTestId('nav-search').fill('');
  await page.getByTestId('nav-ifc-model-row').click();
  await number(page, 'ifc-move-dx', '5');
  await number(page, 'ifc-move-dy', '0');
  await page.getByTestId('ifc-move-apply').click();
  await expect(page.getByTestId('ifc-model-transform')).toContainText('ΔX -95,000 m');
  await number(page, 'ifc-rotate-angle', '90');
  await page.getByTestId('ifc-rotate-apply').click();
  await expect(page.getByTestId('ifc-model-transform')).toContainText('giro 90°');
  await page.getByTestId('action-undo').click();
  await expect(page.getByTestId('ifc-model-transform')).toContainText('giro 0°');

  // --- Vistas salvas: planta cortada e elevação ---------------------------------------------
  await openTask(page, 'view');
  await page.getByTestId('views-new-plan').click();
  await expect(page.getByTestId('doc-view')).toHaveAttribute('data-view-kind', 'plan');
  // O plano de corte (1,20 m) atravessa paredes e pilares: há contorno de seção.
  await expect(drawn(page, 'doc-view-svg').first()).toBeVisible();
  expect(await drawn(page, 'doc-view-svg').count()).toBeGreaterThanOrEqual(6);
  await openTask(page, 'view');
  await page.getByTestId('ribbon-menu-elevations').click();
  await page.getByTestId('views-elevation-north').click();
  await expect(page.getByTestId('doc-view')).toHaveAttribute('data-view-kind', 'elevation');
  expect(await drawn(page, 'doc-view-svg').count()).toBeGreaterThanOrEqual(9);

  // --- Exportações avisam que não levam os importados; o arquivo do projeto leva tudo ------
  await (await ctl(page, 'export-details')).click();
  await expect(page.getByTestId('export-ifc-note')).toContainText('não entram');
  await page.getByTestId('export-close').click();
  const downloadPromise = page.waitForEvent('download');
  await (await ctl(page, 'action-export')).click();
  const filePath = await (await downloadPromise).path();
  const saved = JSON.parse(await readFile(filePath, 'utf8'));
  // Os modelos importados entraram no esquema 19; versões posteriores os mantêm.
  expect(saved.schemaVersion).toBeGreaterThanOrEqual(19);
  expect(saved.ifcModels).toHaveLength(1);
  expect(saved.ifcModels[0].objects).toHaveLength(12);
  expect(
    saved.ifcModels[0].objects.filter((object: { copy: boolean }) => object.copy),
  ).toHaveLength(1);
  expect(saved.ifcModels[0].source.fileName).toBe('predio-ifc4-mm.ifc');
  expect(saved.ifcModels[0].source.data.length).toBeGreaterThan(500);
  expect(saved.ifcModels[0].placement.translation.x).toBeCloseTo(-95, 9);
  expect(saved.ifcModels[0].opacity).toBeCloseTo(0.4, 9);

  // --- Limpa o armazenamento do navegador e reabre pelo arquivo ------------------------------
  await page.evaluate(async () => {
    localStorage.clear();
    localStorage.setItem('hydrobim.layout.v1', JSON.stringify({ workspaceLayout: 'single' }));
    for (const database of await indexedDB.databases()) {
      if (database.name) indexedDB.deleteDatabase(database.name);
    }
    for (const key of await caches.keys()) await caches.delete(key);
  });
  await page.reload();
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await expect(page.getByTestId('nav-ifc-count')).toHaveText('0');
  await (await ctl(page, 'action-open')).click();
  await page.getByTestId('import-file').setInputFiles(filePath);
  await expect(page.getByTestId('nav-ifc-count')).toHaveText('12');
  await expect(page.getByTestId('nav-ifc-model')).toHaveAttribute('data-status', 'ready', {
    timeout: 30_000,
  });
  await page.getByTestId('view-mode-plan').click();
  await expect(drawn(page, 'plan-svg')).toHaveCount(10);
  await selectByName(page, 'Laje do pavimento 1');
  await expect(page.getByTestId('ifc-properties')).toHaveAttribute('data-state', 'ready');
  await expect(property(page, 'PredefinedType')).toContainText('FLOOR');
  await expect(property(page, 'Material.0')).toContainText('Concreto C30');
  await expect(property(page, 'ModelTransform')).toContainText('ΔX -95,000 m');

  expect(errors).toEqual([]);
});

test('importa só os objetos escolhidos por categoria e busca, por ponto-base, sem tocar a rede', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page);
  // Projeto de demonstração: a rede existente deve ficar como estava.
  const elementsBefore = await page.getByTestId('element-count').textContent();
  expect(Number(elementsBefore)).toBeGreaterThan(0);

  await openPreview(page, 'predio-ifc2x3-m.ifc');
  await expect(page.getByTestId('ifc-import-schema')).toHaveText('IFC2X3');
  await expect(page.getByTestId('ifc-import-length-unit')).toContainText('METRE: 1 unidade = 1 m');
  await expect(page.getByTestId('ifc-import-units')).toContainText('DEGREE (°)');
  await page.getByTestId('ifc-import-none').click();
  await expect(page.getByTestId('ifc-import-selected')).toContainText('0 de 11');
  await expect(page.getByTestId('ifc-import-next')).toBeDisabled();
  await page.locator('[data-testid="ifc-import-category"][data-entity="IfcWall"]').check();
  await expect(page.getByTestId('ifc-import-selected')).toContainText('2 de 11');
  await page.getByTestId('ifc-import-search').fill('Pilar');
  await expect(page.getByTestId('ifc-import-object')).toHaveCount(3);
  await page.getByTestId('ifc-import-all').click();
  await page.getByTestId('ifc-import-search').fill('');
  await expect(page.getByTestId('ifc-import-selected')).toContainText('5 de 11');
  // Pela árvore: desmarca um pilar.
  await page.getByTestId('ifc-import-search').fill('Pilar P3');
  await page.getByTestId('ifc-import-object').uncheck();
  await page.getByTestId('ifc-import-search').fill('');
  await expect(page.getByTestId('ifc-import-selected')).toContainText('4 de 11');

  await page.getByTestId('ifc-import-next').click();
  await page.getByTestId('view-mode-plan').click();
  await page.getByTestId('ifc-mode-basePoint').check();
  // O ponto-base começa no canto da envoltória: sem destino informado, nada se move.
  await expect(page.getByTestId('ifc-placement-translation')).toContainText(
    '0,000 m; 0,000 m; 0,000 m',
  );
  // Indicar o destino na planta: o clique vai para o campo pedido.
  await page.getByTestId('ifc-pick-target').click();
  await expect(page.getByTestId('ifc-picking')).toBeVisible();
  const box = (await page.getByTestId('plan-svg').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6);
  await expect(page.getByTestId('ifc-picking')).toBeHidden();
  await expect(page.getByTestId('ifc-placement-translation')).not.toContainText(
    '0,000 m; 0,000 m; 0,000 m',
  );
  // Valores exatos pelo painel.
  await number(page, 'ifc-target-x', '2');
  await number(page, 'ifc-target-y', '3');
  await number(page, 'ifc-target-z', '0');
  await expect(page.getByTestId('ifc-placement-min')).toContainText('2,000 m; 3,000 m; 0,000 m');
  await page.getByTestId('ifc-placement-confirm').click();
  await expect(page.getByTestId('nav-ifc-count')).toHaveText('4');
  await expect(page.getByTestId('ifc-model-schema')).toHaveText('IFC2X3');

  // A rede continua igual, e os importados não viraram elementos dela.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('element-count')).toHaveText(elementsBefore ?? '');

  // Inserção repetida do mesmo arquivo: outro modelo, identidades novas.
  await openPreview(page, 'predio-ifc2x3-m.ifc');
  await page.getByTestId('ifc-import-next').click();
  await page.getByTestId('ifc-placement-confirm').click();
  await expect(page.getByTestId('nav-ifc-model')).toHaveCount(2);
  await expect(page.getByTestId('nav-ifc-count')).toHaveText('15');
  const ids = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="nav-ifc-model"]')).map((node) =>
      node.getAttribute('data-model-id'),
    ),
  );
  expect(new Set(ids).size).toBe(2);
  expect(errors).toEqual([]);
});

test('cancelar não altera o projeto e arquivos inválidos são recusados com o motivo', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page, { empty: true });

  // Cancelar na prévia.
  const dialog = await openPreview(page, 'predio-ifc4x3-m.ifc');
  await expect(page.getByTestId('ifc-import-schema')).toHaveText('IFC4X3_ADD2');
  // Coordenadas grandes preservadas (sem recentralizar).
  await expect(page.getByTestId('ifc-import-bounds')).toContainText('X 350003.363');
  await page.getByTestId('ifc-import-cancel').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('nav-ifc-count')).toHaveText('0');
  await expect(page.getByTestId('action-undo')).toBeDisabled();

  // Cancelar no posicionamento.
  await openPreview(page, 'predio-ifc4x3-m.ifc');
  await page.getByTestId('ifc-import-next').click();
  await expect(page.getByTestId('ifc-placement')).toBeVisible();
  await page.getByTestId('ifc-placement-cancel').click();
  await expect(page.getByTestId('ifc-placement')).toBeHidden();
  await expect(page.getByTestId('nav-ifc-count')).toHaveText('0');
  await expect(page.getByTestId('action-undo')).toBeDisabled();

  // Arquivo que não é IFC.
  const invalid = await chooseFile(page, {
    name: 'planilha.ifc',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('isto não é um arquivo IFC'),
  });
  await expect(invalid).toHaveAttribute('data-step', 'error');
  await expect(page.getByTestId('ifc-import-error')).toContainText('ISO-10303-21');
  // Esquema preliminar: identificado e recusado.
  await page.getByTestId('ifc-import-file').setInputFiles({
    name: 'preliminar.ifc',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(
      "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\nFILE_NAME('x','',(''),(''),'','','');\nFILE_SCHEMA(('IFC4X1'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n",
    ),
  });
  await expect(page.getByTestId('ifc-import-error')).toContainText('IFC4X1');
  await expect(page.getByTestId('ifc-import-error')).toContainText('IFC2X3, IFC4, IFC4X3_ADD2');
  await page.getByTestId('ifc-import-cancel').click();
  await expect(page.getByTestId('nav-ifc-count')).toHaveText('0');

  // Coordenadas grandes: o modelo entra onde o arquivo o coloca e é desenhado nas vistas.
  await openPreview(page, 'predio-ifc4x3-m.ifc');
  await page.getByTestId('ifc-import-next').click();
  await expect(page.getByTestId('ifc-placement-min')).toContainText('350.003,363 m');
  await page.getByTestId('ifc-placement-confirm').click();
  await expect(page.getByTestId('nav-ifc-count')).toHaveText('11');
  await page.getByTestId('view-mode-plan').click();
  await expect(drawn(page, 'plan-svg')).toHaveCount(9);
  await page.getByTestId('view-mode-3d').click();
  await expect(page.getByTestId('viewport-canvas')).toBeVisible();
  await page.waitForTimeout(500);

  // Os comandos também estão na aba BIM / IFC.
  await expect(await ctl(page, 'bim-import-ifc')).toBeVisible();
  expect(errors).toEqual([]);
});
