import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ctl, openTask } from './ui';

/**
 * Arquitetura nas vistas de projeto, catálogo de famílias arquitetônicas e quantitativo, sobre
 * a demonstração "Edificação simples": planta com paredes cortadas e hachuradas, símbolo de
 * porta, janela alta em projeção e rótulos de ambientes; corte vertical; plano de corte da
 * arquitetura; visibilidade por categoria; exportação SVG com os padrões de hachura; criação,
 * edição (com as ocorrências afetadas), recusa, duplicação e exclusão de tipos; CSV.
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function openBuilding(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await (await ctl(page, 'action-open')).click();
  await page.getByTestId('open-demo-building').click();
  await expect(page.getByTestId('view-item')).toHaveCount(1);
}

const viewItem = (page: Page, name: string): Locator =>
  page.locator(`[data-testid="view-item"][data-view-name="${name}"]`);

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

async function zoomOut(page: Page): Promise<void> {
  const box = await page.getByTestId('doc-view-svg').boundingBox();
  if (!box) throw new Error('vista 2D não está na tela');
  const before = await page.getByTestId('doc-view').getAttribute('data-mpp');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 600);
  await expect(page.getByTestId('doc-view')).not.toHaveAttribute('data-mpp', before ?? '');
}

async function commit(field: Locator, value: string): Promise<void> {
  await field.fill(value);
  await field.press('Enter');
}

test('arquitetura nas vistas: planta cortada, corte, plano de corte e categorias', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openBuilding(page);

  // Planta salva da demonstração.
  await viewItem(page, 'Planta — Térreo').click();
  const view = page.getByTestId('doc-view');
  const svg = page.getByTestId('doc-view-svg');
  await expect(view).toHaveAttribute('data-view-kind', 'plan');
  // Doze elementos do térreo e o telhado, que fica acima do plano de corte: só em projeção.
  await expect(view).toHaveAttribute('data-arch-elements', '13');
  await expect(svg.locator('[data-arch-kind="roof"][data-layer="Projeção_2"]')).toHaveCount(1);
  // Cinco paredes, duas portas e as duas janelas de peitoril 1,10 m são cortadas a 1,20 m.
  await expect(view).toHaveAttribute('data-arch-cut', '9');
  await expect(view).toHaveAttribute('data-elements', '3');

  // Paredes cortadas com a hachura do material (padrão do SVG) e traço forte.
  const cutWalls = svg.locator('[data-arch-kind="wall"][data-cut]');
  await expect(cutWalls).toHaveCount(5);
  const hatched = svg.locator(
    '[data-arch-kind="wall"] [data-layer="Hachura"] path[data-hatch="diagonal"]',
  );
  await expect(hatched).toHaveCount(4);
  expect(await hatched.first().getAttribute('fill')).toMatch(/^url\(#hachura-.*-diagonal\)$/);
  expect(await hatched.first().getAttribute('fill-rule')).toBe('evenodd');
  await expect(svg.locator('defs pattern[data-hatch="diagonal"]')).toHaveCount(1);
  await expect(svg.locator('[data-arch-kind="wall"] path[data-stroke="cut"]')).toHaveCount(5);
  // Sem `IsExternal` informada, a parede não é dada como externa nem interna.
  await expect(svg.locator('[data-arch-kind="wall"][data-layer="Parede"]')).toHaveCount(5);
  await expect(svg.locator('[data-layer="Parede_Externa"]')).toHaveCount(0);

  // Portas: folha aberta e arco; janelas cortadas: marco e vidro; a alta, em projeção.
  await expect(svg.locator('[data-arch-kind="door"] [data-symbol="door-swing"] path')).toHaveCount(
    2,
  );
  await expect(svg.locator('[data-arch-kind="window"][data-cut]')).toHaveCount(2);
  await expect(svg.locator('[data-arch-kind="window"] [data-layer="Vidro"]')).toHaveCount(2);
  await expect(svg.locator('[data-arch-kind="window"][data-layer="Projeção_2"]')).toHaveCount(1);
  await expect(svg.locator('[data-layer="Esquadrias"]')).toHaveCount(4);

  // Ambientes: número, nome e área.
  const labels = page.getByTestId('space-label');
  await expect(labels).toHaveCount(2);
  await expect(labels.first()).toContainText('01 Sala');
  await expect(labels.first()).toContainText('14,75 m²');
  await expect(labels.nth(1)).toContainText('02 Banheiro');
  await page.screenshot({ path: 'test-results/arquitetura-01-planta.png' });

  // Clique em uma parede: seleção da arquitetura (sessão), realçada na vista.
  await clickView(page, 1.9, 0);
  await expect(svg.locator('[data-arch-kind="wall"][data-selected]')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // Exportação SVG da vista: leva as camadas e os padrões de hachura.
  const download = page.waitForEvent('download');
  await (await ctl(page, 'plan-export-svg')).click();
  const file = await (await download).path();
  const exported = await readFile(file, 'utf8');
  expect(exported).toContain('<pattern');
  expect(exported).toContain('data-layer="Hachura"');
  expect(exported).toContain('data-layer="Parede"');
  expect(exported).toContain('data-layer="Projeção_2"');
  expect(exported).toContain('14,75 m²');

  // Plano de corte da arquitetura: abaixo do peitoril, as janelas deixam de ser cortadas.
  await expect(await viewField(page, 'view-arch-cut-height')).toHaveValue('1,2');
  await setViewField(page, 'view-arch-cut-height', '0,9');
  await expect(svg.locator('[data-arch-kind="window"][data-cut]')).toHaveCount(0);
  await expect(svg.locator('[data-arch-kind="window"][data-layer="Projeção_2"]')).toHaveCount(3);
  await expect(cutWalls).toHaveCount(5);
  // A rede continua inteira: o corte da arquitetura não a atinge.
  await expect(view).toHaveAttribute('data-elements', '3');
  // Valor inválido é recusado pelo núcleo: o campo volta ao vigente.
  await setViewField(page, 'view-arch-cut-height', '0');
  await expect(await viewField(page, 'view-arch-cut-height')).toHaveValue('0,9');
  await page.keyboard.press('Control+z');
  await expect(svg.locator('[data-arch-kind="window"][data-cut]')).toHaveCount(2);

  // Visibilidade por categoria, só nesta vista.
  await (await viewField(page, 'view-category-walls')).uncheck();
  await expect(svg.locator('[data-arch-kind="wall"]')).toHaveCount(0);
  await expect(svg.locator('[data-arch-kind="door"]')).toHaveCount(2);
  await (await viewField(page, 'view-category-spaces')).uncheck();
  await expect(labels).toHaveCount(0);
  await (await viewField(page, 'view-category-walls')).check();
  await (await viewField(page, 'view-category-spaces')).check();
  await expect(cutWalls).toHaveCount(5);

  // Corte vertical pela sala e pelo banheiro: linha em y = 2, olhando para +Y.
  await zoomOut(page);
  await openTask(page, 'view');
  await page.getByTestId('views-new-section').click();
  await expect(view).toHaveAttribute('data-view-tool', 'section');
  await clickView(page, -1, 2);
  await clickView(page, 7, 2);
  await clickView(page, 3, 5);
  await expect(page.getByTestId('section-marker')).toHaveCount(1);
  await viewItem(page, 'Corte 1').click();
  await expect(view).toHaveAttribute('data-view-kind', 'section');
  // A linha atravessa as paredes oeste e leste e a divisória; a laje também é seccionada.
  await expect(svg.locator('[data-arch-kind="wall"][data-cut]')).toHaveCount(3);
  await expect(svg.locator('[data-arch-kind="slab"][data-cut]')).toHaveCount(1);
  await expect(
    svg.locator('[data-arch-kind="slab"] [data-layer="Hachura"] path[data-hatch="dotted"]'),
  ).toHaveCount(1);
  await expect(svg.locator('[data-symbol="door-swing"]')).toHaveCount(0);
  await expect(labels).toHaveCount(0);
  await page.screenshot({ path: 'test-results/arquitetura-02-corte.png' });

  expect(errors).toEqual([]);
});

test('catálogo de arquitetura: buscar, filtrar, criar, editar, recusar, duplicar e excluir', async ({
  page,
}) => {
  // Fluxo longo (criar, editar, recusar, duplicar, excluir) com o canvas 3D da prévia.
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  await openBuilding(page);
  await openTask(page, 'model');
  await page.getByTestId('arch-catalog').click();
  const dialog = page.getByTestId('arch-catalog-dialog');
  await expect(dialog).toBeVisible();
  const families = dialog.getByTestId('arch-family-item');
  const types = dialog.getByTestId('arch-type-item');
  await expect(families).toHaveCount(23);
  await expect(types).toHaveCount(9);

  // Busca e filtro por categoria.
  await dialog.getByTestId('arch-catalog-search').fill('drywall');
  await expect(families).toHaveCount(1);
  await expect(types).toHaveCount(1);
  await dialog.getByTestId('arch-catalog-search').fill('');
  await dialog.getByTestId('arch-catalog-filter-door').click();
  await expect(families).toHaveCount(9);
  await expect(types).toHaveCount(2);

  // Família: selo de genérica, o que não é dado de catálogo e o enquadramento IFC.
  await dialog.locator('[data-family-id="arq-porta-pivotante"]').click();
  const family = dialog.getByTestId('arch-family-detail');
  await expect(family.getByTestId('arch-family-generic')).toHaveText(
    'Modelo genérico parametrizável',
  );
  await expect(family.getByTestId('arch-family-notes')).toContainText('não medidas de catálogo');
  await expect(family.getByTestId('arch-family-ifc')).toContainText('IfcDoorType');
  await expect(family.getByTestId('arch-create-notice')).toContainText(
    'valores iniciais de edição',
  );
  // Prévias 2D (porta em planta) e 3D (malha real).
  await expect(family.getByTestId('arch-preview-2d')).toHaveAttribute('data-preview', 'door-plan');
  await expect(
    family.locator('[data-testid="arch-preview-2d"] [data-symbol="door-swing"]'),
  ).toHaveCount(1);
  // O canvas 3D é carregado sob demanda: a primeira exibição espera o módulo.
  await expect(family.getByTestId('family-preview-canvas')).toBeVisible({ timeout: 30_000 });
  await expect(family.getByTestId('arch-preview-note')).toContainText('ilustrativas');

  // Criar tipo a partir da família, com nome e largura próprios.
  await commit(family.getByTestId('arch-type-name'), 'Pivotante 110 × 210');
  await commit(family.getByTestId('arch-type-width'), '1,1');
  await family.getByTestId('arch-create-type').click();
  const editor = dialog.getByTestId('arch-type-editor');
  await expect(editor).toBeVisible();
  await expect(dialog.getByTestId('arch-crumbs')).toContainText('Pivotante 110 × 210');
  await expect(dialog.getByTestId('arch-type-usage')).toHaveText('nenhuma ocorrência');
  await expect(types).toHaveCount(3);
  await page.screenshot({ path: 'test-results/arquitetura-03-catalogo.png' });

  // Propriedade IFC do tipo: pendente por padrão; informada; limpa volta a pendente.
  const fire = editor.locator('[data-testid="arch-ifc-row"][data-key$=".FireRating"]');
  await expect(fire).toHaveAttribute('data-origin', 'pending');
  await commit(fire.locator('input'), 'valor de teste');
  await expect(fire).toHaveAttribute('data-origin', 'user');
  await fire.locator('button').click();
  await expect(fire).toHaveAttribute('data-origin', 'pending');

  // Produto comercial sem fonte: o núcleo recusa.
  await editor.getByTestId('arch-type-generic').uncheck();
  await editor.getByTestId('arch-type-save').click();
  await expect(editor.getByTestId('arch-type-error')).toContainText('informe a fonte');
  await editor.getByTestId('arch-type-discard').click();
  await expect(editor).toHaveAttribute('data-dirty', 'false');

  // Editar a largura de um tipo em uso: aviso com as ocorrências afetadas antes de gravar.
  await types.filter({ hasText: 'Porta de giro 80 × 210' }).click();
  await expect(dialog.getByTestId('arch-type-usage')).toHaveText('1 ocorrência');
  await commit(editor.getByTestId('arch-type-width'), '0,9');
  await expect(editor).toHaveAttribute('data-dirty', 'true');
  await editor.getByTestId('arch-type-save').click();
  const affected = editor.getByTestId('arch-type-affected');
  await expect(affected.getByTestId('arch-type-affected-count')).toContainText('1 ocorrência');
  await expect(affected.getByTestId('arch-type-affected-name')).toHaveText(['Porta 1']);
  // Cancelar não altera nada.
  await affected.getByTestId('arch-type-cancel').click();
  await expect(types.filter({ hasText: 'Porta de giro 80 × 210' })).toContainText('0,80 × 2,10 m');
  await editor.getByTestId('arch-type-save').click();
  await affected.getByTestId('arch-type-confirm').click();
  await expect(editor).toHaveAttribute('data-dirty', 'false');
  await expect(types.filter({ hasText: 'Porta de giro 80 × 210' })).toContainText('0,90 × 2,10 m');

  // Alteração impossível (porta mais larga que o trecho livre da parede): recusada inteira.
  await commit(editor.getByTestId('arch-type-width'), '9');
  await editor.getByTestId('arch-type-save').click();
  await expect(editor.getByTestId('arch-type-error')).toContainText('Nada foi alterado');
  await expect(affected).toHaveCount(0);
  await expect(types.filter({ hasText: 'Porta de giro 80 × 210' })).toContainText('0,90 × 2,10 m');
  await editor.getByTestId('arch-type-discard').click();

  // Excluir um tipo em uso é recusado, com o motivo.
  await editor.getByTestId('arch-type-delete').click();
  await expect(editor.getByTestId('arch-type-error')).toContainText('usado por 1 elemento');
  await expect(types).toHaveCount(3);

  // Duplicar cria um tipo independente, sem ocorrências; esse pode ser excluído.
  await editor.getByTestId('arch-type-duplicate').click();
  await expect(types).toHaveCount(4);
  await expect(dialog.getByTestId('arch-crumbs')).toContainText('cópia');
  await expect(dialog.getByTestId('arch-type-usage')).toHaveText('nenhuma ocorrência');
  await editor.getByTestId('arch-type-delete').click();
  await expect(types).toHaveCount(3);
  await expect(dialog.getByTestId('arch-catalog-empty')).toBeVisible();

  // Tipo em camadas: seção com as hachuras do tipo; "Usar este tipo" fecha o catálogo.
  await dialog.getByTestId('arch-catalog-filter-wall').click();
  await types.filter({ hasText: 'Alvenaria cerâmica 18 cm' }).click();
  await expect(editor.getByTestId('arch-preview-2d')).toHaveAttribute('data-preview', 'layers');
  await expect(editor.getByTestId('arch-preview-layer')).toHaveCount(3);
  await expect(editor.getByTestId('arch-layer-row')).toHaveCount(3);
  await expect(editor.getByTestId('arch-type-predefined')).toHaveValue('SOLIDWALL');
  await editor.getByTestId('arch-type-use').click();
  await expect(dialog).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('catálogo de portas Pormade: escolher medida e acabamento e criar o tipo', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openBuilding(page);
  await openTask(page, 'model');
  await page.getByTestId('arch-catalog').click();
  const dialog = page.getByTestId('arch-catalog-dialog');
  const families = dialog.getByTestId('arch-family-item');
  const types = dialog.getByTestId('arch-type-item');

  // A busca alcança o fabricante e a linha.
  await dialog.getByTestId('arch-catalog-search').fill('pormade');
  await expect(families).toHaveCount(5);
  await dialog.getByTestId('arch-catalog-search').fill('frizzatta');
  await expect(families).toHaveCount(4);

  // Família de produto: selo de fabricante, fonte com as páginas e o que é esquemático.
  await dialog.locator('[data-family-id="arq-porta-pormade-frizzatta-fri-004"]').click();
  const family = dialog.getByTestId('arch-family-detail');
  await expect(family.getByTestId('arch-family-product')).toHaveText('Produto de fabricante');
  await expect(family.getByTestId('arch-family-source')).toContainText('p. 7 e 26');
  await expect(family.getByTestId('arch-family-notes')).toContainText(
    'posição deles é esquemática',
  );
  // As dimensões não são digitadas: não há campos de largura nem de nome.
  await expect(family.getByTestId('arch-type-width')).toHaveCount(0);
  await expect(family.getByTestId('arch-product-notice')).toBeVisible();

  // Padrão da família: 80 × 210 em verniz; a prévia é a elevação com os quatro frisos.
  await expect(family.getByTestId('arch-product-size')).toHaveValue('80');
  await expect(family.getByTestId('arch-product-opening')).toHaveText('88 × 215 cm');
  await expect(family.getByTestId('arch-preview-2d')).toHaveAttribute(
    'data-preview',
    'door-elevation',
  );
  await expect(family.getByTestId('arch-preview-frieze')).toHaveCount(4);
  await expect(family.getByTestId('arch-preview-note')).toContainText('esquemática');
  await expect(family.getByTestId('family-preview-canvas')).toBeVisible({ timeout: 30_000 });

  // Branco: o catálogo não informa o núcleo, e a escolha fica bloqueada.
  await family.getByTestId('arch-product-finish').selectOption('branco');
  await expect(family.getByTestId('arch-product-core')).toBeDisabled();
  // Verniz, 90 cm, núcleo sólido.
  await family.getByTestId('arch-product-finish').selectOption('verniz');
  await family.getByTestId('arch-product-size').selectOption('90');
  await family.getByTestId('arch-product-core').selectOption('Sólido');
  await expect(family.getByTestId('arch-product-opening')).toHaveText('98 × 215 cm');
  await expect(family.getByTestId('arch-product-name')).toHaveText(
    'Pormade Frizzatta FRI 004 — 90 × 210 cm — Verniz — núcleo sólido',
  );
  await page.screenshot({ path: 'test-results/arquitetura-04-catalogo-pormade.png' });

  await family.getByTestId('arch-create-type').click();
  const editor = dialog.getByTestId('arch-type-editor');
  await expect(editor).toBeVisible();
  await expect(types).toHaveCount(1);
  await expect(dialog.getByTestId('arch-type-product-badge')).toBeVisible();
  await expect(editor.getByTestId('arch-type-width')).toHaveValue('0,98');
  await expect(editor.getByTestId('arch-type-manufacturer')).toHaveValue('Pormade');
  await expect(editor.getByTestId('arch-type-model')).toHaveValue('Frizzatta FRI 004');
  await expect(editor.getByTestId('arch-type-source')).toHaveValue(/Catálogo de Produtos/);
  await expect(editor.getByTestId('arch-door-leaf')).toContainText('4 friso(s) de 16 mm');

  // Propriedades IFC do tipo: acabamento e núcleo vindos da escolha; frisos derivados.
  const row = (key: string): Locator =>
    editor.locator(`[data-testid="arch-ifc-row"][data-key="${key}"]`);
  await expect(row('HydroBIM_Esquadria.Finish').locator('input')).toHaveValue('Verniz');
  await expect(row('HydroBIM_Esquadria.Core').locator('input')).toHaveValue('Sólido');
  await expect(row('HydroBIM_Esquadria.FriezeCount')).toContainText('4');
  await expect(row('Pset_DoorCommon.FireRating')).toHaveAttribute('data-origin', 'pending');

  // Criar de novo a mesma escolha é recusado pelo núcleo (nome já usado).
  await dialog.getByTestId('arch-crumb-family').click();
  await family.getByTestId('arch-product-size').selectOption('90');
  await family.getByTestId('arch-product-core').selectOption('Sólido');
  await family.getByTestId('arch-create-type').click();
  await expect(family.getByTestId('arch-create-error')).toContainText('Já existe um tipo');
  await expect(types).toHaveCount(1);

  expect(errors).toEqual([]);
});

test('quantitativo de arquitetura: linhas, ambientes pendentes e CSV', async ({ page }) => {
  const errors = trackErrors(page);
  await openBuilding(page);
  await openTask(page, 'model');
  await page.getByTestId('arch-quantities').click();
  const dialog = page.getByTestId('arch-quantities-dialog');
  await expect(dialog).toBeVisible();

  // Um tipo por linha: 2 de parede, laje, revestimento, 2 de porta, 2 de janela e o telhado.
  const rows = dialog.getByTestId('arch-quantities-row');
  await expect(rows).toHaveCount(9);
  // Telhado: área inclinada e projeção horizontal em colunas separadas (7,18 × 5,18 m).
  const roofRow = rows.filter({ hasText: 'Telhados' });
  await expect(roofRow.getByTestId('arch-quantities-projected')).toHaveText('37,19');
  await expect(rows.first()).toContainText('Paredes');
  await expect(rows.first()).toContainText('Alvenaria cerâmica 18 cm');
  // Nenhum tipo da demonstração é classificado.
  await expect(dialog.getByTestId('arch-quantities-nbr')).toHaveText(Array(9).fill('NC'));
  await expect(dialog.getByTestId('arch-quantities-note')).toContainText('uma única vez');

  // Ambientes: a sala tem pé-direito; o do banheiro não foi informado (pendente).
  const spaces = dialog.getByTestId('arch-spaces-row');
  await expect(spaces).toHaveCount(2);
  await expect(spaces.first()).toContainText('Sala');
  await expect(spaces.first()).toContainText('14,75');
  await expect(spaces.nth(1)).toHaveAttribute('data-pending', 'true');
  await expect(dialog.getByTestId('arch-space-pending')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/arquitetura-04-quantitativo.png' });

  const download = page.waitForEvent('download');
  await dialog.getByTestId('arch-quantities-csv').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/-quantitativo-arquitetura\.csv$/);
  const csv = await readFile(await file.path(), 'utf8');
  expect(csv).toContain('"Pavimento";"Categoria";"Tipo"');
  expect(csv).toContain('"Alvenaria cerâmica 18 cm"');
  expect(csv).toContain('"NC"');
  expect(csv).toContain('"Banheiro"');

  await dialog.getByTestId('arch-quantities-close').click();
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});
