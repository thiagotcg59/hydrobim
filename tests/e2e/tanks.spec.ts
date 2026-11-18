import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Reservatórios metálicos de catálogo (TRAMEC) no navegador real: escolha da família e do
 * modelo comercial, origem de cada parâmetro, dimensões personalizadas, acessórios, bocais
 * e exportação IFC (IfcTank/IfcTankType e Pset do fabricante).
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function openEmptyProject(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await page.getByTestId('action-new').click();
  await expect(page.getByTestId('element-count')).toHaveText('0');
}

async function setField(page: Page, testId: string, value: string): Promise<void> {
  const field = page.getByTestId(testId);
  await field.fill(value);
  await field.press('Enter');
}

async function expectNoError(page: Page): Promise<void> {
  await expect(page.getByTestId('status-message')).not.toHaveAttribute('data-level', 'error');
}

const origin = (page: Page, name: string) => page.getByTestId(`tank-origin-${name}`);

test('insere um reservatório de catálogo, personaliza e exporta em IFC', async ({ page }) => {
  const errors = trackErrors(page);
  await openEmptyProject(page);
  await setField(page, 'project-name', 'Reservatório E2E');
  await page.getByTestId('environment-infra').click();

  // Família e modelo comercial: linha "10.000 / 8,30 / 1,91 / 4,80" da p. 4 do catálogo.
  await page.getByTestId('tool-tank').click();
  await page.getByTestId('option-tank-family').selectOption('tramec-taca-sem-agua');
  await expect(page.getByTestId('option-tank-variant').locator('option')).toHaveCount(35);
  await page
    .getByTestId('option-tank-variant')
    .selectOption('tramec-taca-sem-agua/10000-830-191-480');
  await expect(page.getByTestId('option-tank-source')).toContainText('p. 4');
  await setField(page, 'coord-x', '0');
  await setField(page, 'coord-y', '0');
  await setField(page, 'coord-z', '0');
  await page.getByTestId('coord-add').click();
  await expectNoError(page);
  await page.getByTestId('tool-select').click();

  // As dimensões do catálogo foram carregadas e estão identificadas como tal.
  await expect(page.getByTestId('element-properties')).toHaveAttribute('data-element-kind', 'tank');
  await expect(page.getByTestId('prop-tank-family')).toHaveValue('tramec-taca-sem-agua');
  await expect(page.getByTestId('prop-tank-variant')).toHaveValue(
    'tramec-taca-sem-agua/10000-830-191-480',
  );
  await expect(page.getByTestId('prop-tank-capacity')).toHaveValue('10000');
  await expect(page.getByTestId('prop-tank-diameter')).toHaveValue('1,91');
  await expect(page.getByTestId('prop-tank-height')).toHaveValue('8,3');
  await expect(page.getByTestId('prop-tank-columnHeight')).toHaveValue('4,8');
  for (const name of ['nominalCapacity', 'diameter', 'height', 'columnHeight']) {
    await expect(origin(page, name)).toHaveAttribute('data-origin', 'catalog');
  }
  // O que o catálogo não tabula aparece como estimativa de representação.
  for (const name of ['columnDiameter', 'coneHeight', 'shellThickness', 'accessories']) {
    await expect(origin(page, name)).toHaveAttribute('data-origin', 'estimated');
  }
  await expect(page.getByTestId('prop-tank-source')).toContainText('TRAMEC');
  await page.screenshot({ path: 'test-results/tanks-01-taca.png' });

  // Outro modelo comercial da mesma família: as dimensões acompanham a tabela.
  await page
    .getByTestId('prop-tank-variant')
    .selectOption('tramec-taca-sem-agua/20000-1020-255-600');
  await expectNoError(page);
  await expect(page.getByTestId('prop-tank-diameter')).toHaveValue('2,55');
  await expect(page.getByTestId('prop-tank-height')).toHaveValue('10,2');
  await expect(page.getByTestId('prop-tank-columnHeight')).toHaveValue('6');
  await expect(page.getByTestId('prop-tank-top')).toHaveText(/10,2/);

  // Dimensão personalizada: mantém a família, desfaz o vínculo com o modelo comercial.
  await setField(page, 'prop-tank-height', '11');
  await expectNoError(page);
  await expect(page.getByTestId('prop-tank-variant')).toHaveValue('custom');
  await expect(page.getByTestId('prop-tank-family')).toHaveValue('tramec-taca-sem-agua');
  await expect(origin(page, 'height')).toHaveAttribute('data-origin', 'user');
  await expect(origin(page, 'diameter')).toHaveAttribute('data-origin', 'user');

  // Combinação impossível é recusada com mensagem, sem alterar o modelo.
  await setField(page, 'prop-tank-columnHeight', '12');
  await expect(page.getByTestId('status-message')).toHaveAttribute('data-level', 'error');
  await expect(page.getByTestId('prop-tank-columnHeight')).toHaveValue('6');

  // Espessura informada pelo usuário, acessórios e um extravasor.
  await setField(page, 'prop-tank-thickness', '6,35');
  await expect(origin(page, 'shellThickness')).toHaveAttribute('data-origin', 'user');
  await page.getByTestId('prop-tank-cage').uncheck();
  await expect(page.getByTestId('prop-tank-cage')).not.toBeChecked();
  await page.getByTestId('prop-tank-add-overflow').click();
  await expect(page.getByTestId('prop-tank-nozzle-row')).toHaveCount(1);
  await expect(page.getByTestId('prop-roll-port').locator('option')).toHaveText([
    'Saída',
    'Entrada',
    'Extravasor',
  ]);

  const pending = page.waitForEvent('download');
  await page.getByTestId('action-export-ifc').click();
  const file = await pending;
  const ifc = await readFile(await file.path(), 'utf8');
  expect(ifc.match(/=IFCTANK\(/g)).toHaveLength(1);
  expect(ifc.match(/=IFCTANKTYPE\(/g)).toHaveLength(1);
  expect(ifc).toContain("'Pset_TRAMEC_Reservatorio'");
  expect(ifc).toContain("'ShellThickness',$,IFCPOSITIVELENGTHMEASURE(0.00635)");
  expect(ifc).toContain("'TotalHeight',$,IFCPOSITIVELENGTHMEASURE(11.)");
  expect(ifc.match(/=IFCDISTRIBUTIONPORT\(/g)).toHaveLength(3);
  expect(ifc).toContain('.SINK.,.PIPE.');

  // Remoção do bocal e desfazer.
  await page.getByTestId('prop-tank-nozzle-remove').click();
  await expect(page.getByTestId('prop-tank-nozzle-row')).toHaveCount(0);
  await page.getByTestId('action-undo').click();
  await expect(page.getByTestId('prop-tank-nozzle-row')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('famílias sem tabela no catálogo pedem as dimensões ao usuário', async ({ page }) => {
  const errors = trackErrors(page);
  await openEmptyProject(page);
  await page.getByTestId('environment-infra').click();
  await page.getByTestId('tool-tank').click();

  // Australiano: só a faixa de capacidade e as duas alturas constam do catálogo.
  await page.getByTestId('option-tank-family').selectOption('tramec-australiano');
  await expect(page.getByTestId('option-tank-variant')).toHaveCount(0);
  await expect(page.getByTestId('option-tank-no-table')).toContainText('4.300 a 540.000 L');
  await setField(page, 'option-tank-capacity', '50000');
  await page.getByTestId('option-tank-wall').selectOption('1.72');
  await expect(page.getByTestId('option-tank-derived')).toContainText('6,084');
  await page.getByTestId('coord-add').click();
  await expectNoError(page);
  await page.getByTestId('tool-select').click();
  await expect(page.getByTestId('prop-tank-diameter')).toHaveValue('6,084');
  await expect(origin(page, 'diameter')).toHaveAttribute('data-origin', 'derived');
  await expect(origin(page, 'height')).toHaveAttribute('data-origin', 'catalog');
  await expect(origin(page, 'nominalCapacity')).toHaveAttribute('data-origin', 'user');
  await expect(page.getByTestId('prop-tank-no-table')).toBeVisible();

  // Horizontal: troca do apoio de longarina para pés de 0,50 m (valor do catálogo).
  await page.getByTestId('tool-tank').click();
  await page.getByTestId('option-tank-family').selectOption('tramec-cilindrico-horizontal');
  await setField(page, 'coord-x', '12');
  await page.getByTestId('coord-add').click();
  await expectNoError(page);
  await page.getByTestId('tool-select').click();
  await expect(page.getByTestId('prop-tank-supportHeight')).toHaveValue('0,15');
  await page.getByTestId('prop-tank-support').selectOption('legs');
  await expectNoError(page);
  await expect(page.getByTestId('prop-tank-supportHeight')).toHaveValue('0,5');
  await expect(origin(page, 'supportHeight')).toHaveAttribute('data-origin', 'catalog');
  await expect(page.getByTestId('prop-tank-height')).toBeDisabled();
  await expect(page.getByTestId('prop-tank-height')).toHaveValue('2,41');
  expect(errors).toEqual([]);
});

test('o exemplo com as oito famílias abre e é desenhado sem erros', async ({ page }) => {
  const errors = trackErrors(page);
  await openEmptyProject(page);
  await page.getByTestId('action-open').click();
  await page
    .getByTestId('import-file')
    .setInputFiles(join(process.cwd(), 'examples', 'reservatorios-tramec.hydrobim.json'));
  await expect(page.getByTestId('open-dialog')).toBeHidden();
  await expect(page.getByTestId('element-count')).toHaveText('9');
  await expect(page.getByTestId('generic-count')).toHaveText('0');
  await page.getByTestId('view-iso').click();
  await page.getByTestId('view-fit').click();
  await page.waitForTimeout(800);
  await page
    .getByTestId('viewport-canvas')
    .screenshot({ path: 'test-results/tanks-02-familias.png' });
  expect(errors).toEqual([]);
});

test('catálogo: reservatórios com tabela e modelo 3D, e famílias de todas as especificações', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openEmptyProject(page);
  await expect(page.getByTestId('action-families')).toHaveText(/Catálogo/);
  await page.getByTestId('action-families').click();
  const dialog = page.getByTestId('families-dialog');
  await expect(dialog.getByRole('heading', { name: 'Catálogo' })).toBeVisible();

  // Aba Reservatórios: as oito famílias, com a tabela do fabricante e o modelo de cada linha.
  await dialog.getByTestId('families-tab-tanks').click();
  await expect(dialog.getByTestId('tank-family-item')).toHaveCount(8);
  await dialog.locator('[data-family-id="tramec-taca-sem-agua"]').click();
  await expect(dialog.getByTestId('tank-row')).toHaveCount(34);
  await expect(dialog.getByTestId('tank-library-source')).toContainText('p. 4');
  await expect(dialog.getByTestId('tank-preview')).toHaveAttribute('data-state', 'model');
  await dialog.locator('[data-variant-id="tramec-taca-sem-agua/10000-830-191-480"]').click();
  await expect(dialog.getByTestId('tank-preview-extent')).toContainText('8,30 m');
  await expect(dialog.getByTestId('tank-preview').locator('canvas')).toBeVisible();
  await page.screenshot({ path: 'test-results/tanks-03-catalogo.png' });

  // Família sem tabela: o catálogo diz isso, e o modelo usa dimensões iniciais.
  await dialog.locator('[data-family-id="tramec-australiano"]').click();
  await expect(dialog.getByTestId('tank-row')).toHaveCount(0);
  await expect(dialog.getByTestId('tank-library-no-table')).toContainText('4.300 a 540.000 L');
  await expect(dialog.getByTestId('tank-preview')).toHaveAttribute('data-state', 'model');

  // "Inserir no modelo" leva a família e o modelo para a ferramenta Reservatório.
  await dialog.locator('[data-family-id="tramec-tubular-alto"]').click();
  await dialog.locator('[data-variant-id="tramec-tubular-alto/20000-1020-159"]').click();
  await dialog.getByTestId('tank-library-use').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('option-tank-family')).toHaveValue('tramec-tubular-alto');
  await expect(page.getByTestId('option-tank-variant')).toHaveValue(
    'tramec-tubular-alto/20000-1020-159',
  );
  await page.getByTestId('coord-add').click();
  await expectNoError(page);
  // O elemento inserido fica selecionado, com o modelo comercial escolhido no catálogo.
  await expect(page.getByTestId('element-properties')).toHaveAttribute('data-element-kind', 'tank');
  await expect(page.getByTestId('prop-tank-variant')).toHaveValue(
    'tramec-tubular-alto/20000-1020-159',
  );

  // Aba Conexões: famílias de todas as especificações e tipos em uma só lista.
  await page.getByTestId('action-families').click();
  await dialog.getByTestId('families-tab-fittings').click();
  const single = await dialog.getByTestId('family-item').count();
  await dialog.getByTestId('families-specification').selectOption('all');
  expect(await dialog.getByTestId('family-item').count()).toBeGreaterThan(single);
  await expect(
    dialog.getByTestId('family-item').filter({ hasText: 'BERMAD 720' }).first(),
  ).toBeVisible();
  await dialog.getByTestId('families-close').click();
  expect(errors).toEqual([]);
});

test('catálogo: duplicar uma família de reservatórios e editar a tabela da cópia', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openEmptyProject(page);
  await page.getByTestId('environment-infra').click();
  await page.getByTestId('action-families').click();
  const dialog = page.getByTestId('families-dialog');
  await dialog.getByTestId('families-tab-tanks').click();

  // A família do fabricante é somente leitura.
  await dialog.locator('[data-family-id="tramec-taca-sem-agua"]').click();
  await expect(dialog.getByTestId('tank-row')).toHaveCount(34);
  await expect(dialog.locator('[data-testid^="tank-cell-"]')).toHaveCount(0);
  await expect(dialog.getByTestId('tank-family-save')).toHaveCount(0);

  // A cópia entra no projeto com a mesma tabela, agora editável.
  await dialog.getByTestId('tank-library-duplicate').click();
  await expect(dialog.getByTestId('tank-family-item')).toHaveCount(9);
  const custom = dialog.locator('[data-testid="tank-family-item"][data-origin="custom"]');
  await expect(custom).toHaveCount(1);
  await expect(custom).toHaveClass(/is-active/);
  await expect(dialog.getByTestId('tank-family-name')).toHaveValue(
    'Reservatório tipo taça sem água na coluna (personalizado)',
  );
  await expect(dialog.getByTestId('tank-row')).toHaveCount(34);
  await expect(dialog.getByTestId('tank-library-source')).toContainText('Personalizada');
  await expect(dialog.getByTestId('tank-library-source')).toContainText('p. 4');
  await expect(dialog.getByTestId('tank-cell-10-height')).toHaveValue('8,3');

  // Editar a linha de 10.000 L: o modelo 3D acompanha antes mesmo de salvar.
  const commit = async (testId: string, value: string) => {
    const cell = dialog.getByTestId(testId);
    await cell.fill(value);
    await cell.press('Enter');
  };
  await dialog.getByTestId('tank-family-name').fill('Taça da obra');
  await commit('tank-cell-10-height', '9');
  await commit('tank-cell-10-columnHeight', '5,5');
  await expect(dialog.getByTestId('tank-preview-extent')).toContainText('9,00 m');
  await expect(dialog.getByTestId('tank-preview')).toHaveAttribute('data-state', 'model');

  // Linha incoerente (coluna mais alta que o reservatório) é recusada ao salvar.
  await commit('tank-cell-10-columnHeight', '12');
  await dialog.getByTestId('tank-family-save').click();
  await expect(page.getByTestId('status-message')).toHaveAttribute('data-level', 'error');
  await expect(page.getByTestId('status-message')).toContainText('Linha 11');
  await commit('tank-cell-10-columnHeight', '5,5');
  await dialog.getByTestId('tank-family-save').click();
  await expectNoError(page);
  await expect(dialog.getByTestId('tank-family-save')).toBeDisabled();
  await expect(custom).toContainText('Taça da obra');

  // Inserir um reservatório da família personalizada.
  await dialog.getByTestId('tank-library-use').click();
  await expect(dialog).toBeHidden();
  await page.getByTestId('coord-add').click();
  await expectNoError(page);
  await page.getByTestId('tool-select').click();
  await expect(page.getByTestId('prop-tank-height')).toHaveValue('9');
  await expect(page.getByTestId('prop-tank-columnHeight')).toHaveValue('5,5');
  // As dimensões da tabela personalizada são do usuário, não do fabricante.
  await expect(origin(page, 'height')).toHaveAttribute('data-origin', 'user');
  await expect(origin(page, 'diameter')).toHaveAttribute('data-origin', 'user');
  await expect(page.getByTestId('prop-tank-source')).toContainText('personalizada');

  // Alterar a tabela reaplica as dimensões ao reservatório já inserido.
  await page.getByTestId('action-families').click();
  await dialog.getByTestId('families-tab-tanks').click();
  await custom.click();
  await expect(dialog.getByTestId('tank-family-apply')).toBeChecked();
  await commit('tank-cell-10-diameter', '2,2');
  await dialog.getByTestId('tank-family-save').click();
  await expectNoError(page);
  await dialog.getByTestId('families-close').click();
  await expect(page.getByTestId('prop-tank-diameter')).toHaveValue('2,2');
  await expect(page.getByTestId('prop-tank-height')).toHaveValue('9');

  // O catálogo do fabricante continua intacto.
  await page.getByTestId('action-families').click();
  await dialog.getByTestId('families-tab-tanks').click();
  await dialog.locator('[data-family-id="tramec-taca-sem-agua"]').click();
  await dialog.locator('[data-variant-id="tramec-taca-sem-agua/10000-830-191-480"]').click();
  await expect(dialog.getByTestId('tank-preview-extent')).toContainText('8,30 m');
  await page.screenshot({ path: 'test-results/tanks-04-personalizada.png' });
  await dialog.getByTestId('families-close').click();
  expect(errors).toEqual([]);
});
