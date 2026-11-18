import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Aba BIM / IFC no navegador real: classificação IFC, tipos, conjuntos de propriedades,
 * quantidades, portas, validação, edição persistente e exportação IFC/IDS coerentes com o
 * que o painel mostra.
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function openBim(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await page.getByTestId('view-mode-bim').click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-view-mode', 'bim');
  await expect(page.getByTestId('bim-tree')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
}

const itemsOf = (page: Page, entity: string): Locator =>
  page.locator(`[data-testid="bim-item"][data-entity="${entity}"]`);
const property = (page: Page, key: string): Locator =>
  page.locator(`[data-testid="ifc-property"][data-property="${key}"]`);

async function setValue(page: Page, key: string, value: string): Promise<void> {
  const field = page.getByTestId(`ifc-edit-${key}`);
  await field.fill(value);
  await field.press('Enter');
}

async function download(page: Page, testId: string): Promise<string> {
  const pending = page.waitForEvent('download');
  await page.getByTestId(testId).click();
  const path = await (await pending).path();
  return readFile(path, 'utf8');
}

const PRESSURE = 'Pset_PipeSegmentTypeCommon.WorkingPressure';
const MAKER = 'Pset_ManufacturerTypeInformation.Manufacturer';
const ROUGHNESS = 'Pset_PipeSegmentOccurrence.InteriorRoughnessCoefficient';
const STATUS = 'Pset_PipeSegmentTypeCommon.Status';

test('aba BIM / IFC: consulta, edição, validação, exportação e persistência', async ({ page }) => {
  const errors = trackErrors(page);
  await openBim(page);

  // Visão do modelo: todos os elementos classificados, sem erros de esquema.
  const total = Number(await page.getByTestId('ifc-element-count').textContent());
  expect(total).toBeGreaterThan(5);
  await expect(page.getByTestId('bim-item')).toHaveCount(total);
  await expect(page.getByTestId('ifc-count-invalid')).toHaveText('0');
  await expect(
    page.locator('[data-testid="ifc-issues-schema"] [data-testid="ifc-issue"]'),
  ).toHaveCount(0);
  const entities = await page
    .getByTestId('ifc-entity-chip')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-entity')));
  expect(entities).toEqual(
    expect.arrayContaining(['IfcPipeSegment', 'IfcPipeFitting', 'IfcValve']),
  );
  expect(entities).not.toContain('IfcBuildingElementProxy');
  // A árvore segue sistema › entidade › tipo › ocorrência.
  await expect(page.locator('[data-testid="bim-node"][data-node-level="system"]')).not.toHaveCount(
    0,
  );
  await expect(
    page.locator('[data-testid="bim-node"][data-node-label="IfcPipeSegment"]'),
  ).not.toHaveCount(0);

  // Seleção pela árvore: identificação, tipo, conjuntos, quantidades e portas.
  const pipe = itemsOf(page, 'IfcPipeSegment').first();
  const pipeId = (await pipe.getAttribute('data-element-id')) ?? '';
  await pipe.locator('.bim-tree__label').click();
  await expect(page.getByTestId('ifc-element')).toHaveAttribute('data-element-id', pipeId);
  await expect(pipe).toHaveClass(/is-active/);
  await expect(page.getByTestId('ifc-entity')).toHaveText('IfcPipeSegment');
  await expect(page.getByTestId('ifc-predefined-type')).toHaveText('RIGIDSEGMENT');
  await expect(page.getByTestId('ifc-global-id')).toHaveText(/^[0-3][0-9A-Za-z_$]{21}$/);
  await expect(page.getByTestId('ifc-tag')).toHaveText(pipeId);
  await expect(page.getByTestId('ifc-type-entity')).toHaveText('IfcPipeSegmentType');
  await expect(
    page.locator(
      '[data-testid="ifc-set"][data-set-name="Pset_PipeSegmentTypeCommon"][data-scope="type"]',
    ),
  ).toBeVisible();
  await expect(
    page.locator('[data-testid="ifc-set"][data-set-name="Qto_PipeSegmentBaseQuantities"]'),
  ).toBeVisible();
  await expect(property(page, 'Qto_PipeSegmentBaseQuantities.Length')).toHaveAttribute(
    'data-origin',
    'geometry',
  );
  await expect(property(page, 'Pset_PipeSegmentTypeCommon.OuterDiameter')).toHaveAttribute(
    'data-origin',
    'catalog',
  );
  await expect(page.getByTestId('ifc-port')).toHaveCount(2);

  // Informação desconhecida não é inventada: fica pendente e o elemento, com pendências.
  await expect(property(page, PRESSURE)).toHaveAttribute('data-pending', 'true');
  await expect(property(page, MAKER)).toHaveAttribute('data-pending', 'true');
  await expect(page.getByTestId('ifc-conformity')).toHaveAttribute('data-status', 'pending');
  await expect(page.locator('[data-testid="ifc-issue"][data-code="REQUIRED_MISSING"]')).toHaveCount(
    2,
  );

  // Valor inválido é recusado pelo domínio, com mensagem, e nada muda.
  await setValue(page, ROUGHNESS, '-1');
  await expect(page.getByTestId('status-message')).toHaveAttribute('data-level', 'error');
  await expect(property(page, ROUGHNESS)).toHaveAttribute('data-origin', 'pending');

  // Edição: valores de tipo e de ocorrência, enumeração e descrição.
  await setValue(page, PRESSURE, '0,6');
  await expect(property(page, PRESSURE)).toHaveAttribute('data-origin', 'user');
  await expect(property(page, PRESSURE)).toHaveAttribute('data-pending', 'false');
  await setValue(page, MAKER, 'Fabricante de teste');
  await setValue(page, ROUGHNESS, '0,1');
  await expect(property(page, ROUGHNESS)).toHaveAttribute('data-origin', 'user');
  await page.getByTestId(`ifc-edit-${STATUS}`).selectOption('NEW');
  await expect(property(page, STATUS)).toHaveAttribute('data-origin', 'user');
  const description = page.getByTestId('ifc-description');
  await description.fill('Trecho de teste');
  await description.press('Enter');
  await expect(page.getByTestId('ifc-conformity')).toHaveAttribute('data-status', 'conforming');
  await expect(pipe).toHaveAttribute('data-conformity', 'conforming');

  // O valor do tipo vale para as demais ocorrências do mesmo tipo.
  const members = Number(await page.getByTestId('ifc-type-members').textContent());
  await page.getByTestId('ifc-back').click();
  await expect(page.getByTestId('ifc-count-conforming')).toHaveText(String(members));

  // Portas: a conexão leva ao elemento conectado.
  await pipe.locator('.bim-tree__label').click();
  const connected = page.getByTestId('ifc-port-connected').first();
  await connected.click();
  await expect(page.getByTestId('ifc-element')).not.toHaveAttribute('data-element-id', pipeId);

  // Isolar, ocultar e exibir; filtro pela classificação IFC.
  await pipe.getByTestId('bim-isolate').click();
  await expect(page.locator('[data-testid="bim-item"].is-hidden')).toHaveCount(total - 1);
  await pipe.getByTestId('bim-toggle-visibility').click();
  await expect(page.locator('[data-testid="bim-item"].is-hidden')).toHaveCount(total);
  await page.getByTestId('bim-show-all').click();
  await expect(page.locator('[data-testid="bim-item"].is-hidden')).toHaveCount(0);
  const valves = await itemsOf(page, 'IfcValve').count();
  await page.getByTestId('bim-class-filter').selectOption('IfcValve');
  await expect(page.getByTestId('bim-item')).toHaveCount(valves);
  await page.getByTestId('bim-search').fill('texto que não existe');
  await expect(page.getByTestId('bim-tree-empty')).toBeVisible();
  await page.getByTestId('bim-search').fill('');
  await page.getByTestId('bim-show-all').click();
  await expect(page.getByTestId('bim-item')).toHaveCount(total);

  // Biblioteca: todas as famílias com entidade IFC específica.
  await page.getByTestId('ifc-back').click();
  await page.getByTestId('bim-library').click();
  const library = page.getByTestId('ifc-library-dialog');
  await expect(library).toBeVisible();
  expect(await library.getByTestId('ifc-library-row').count()).toBeGreaterThan(40);
  await expect(library.locator('[data-entity="IfcBuildingElementProxy"]')).toHaveCount(0);
  await expect(library.locator('[data-entity="IfcTank"]').first()).toBeVisible();
  await library.getByRole('button', { name: 'Fechar' }).click();
  await expect(library).not.toBeVisible();

  // Exportação: o arquivo grava o que o painel mostra.
  const ifc = await download(page, 'bim-export-ifc');
  expect(ifc).toContain("FILE_SCHEMA(('IFC4X3_ADD2'));");
  expect(ifc).toContain('IFCPIPESEGMENTTYPE(');
  expect(ifc).toContain("'WorkingPressure',$,IFCPRESSUREMEASURE(600000.)");
  expect(ifc).toContain("'Manufacturer',$,IFCLABEL('Fabricante de teste')");
  expect(ifc).toContain("'InteriorRoughnessCoefficient',$,IFCPOSITIVELENGTHMEASURE(0.0001)");
  expect(ifc).toContain("IFCPROPERTYENUMERATEDVALUE('Status',$,(IFCLABEL('NEW'))");
  expect(ifc).toContain("'Trecho de teste'");
  expect(ifc).toContain("'Qto_PipeSegmentBaseQuantities'");
  const ids = await download(page, 'bim-export-ids');
  expect(ids).toContain('<ids xmlns="http://standards.buildingsmart.org/IDS"');
  expect(ids).toContain('<simpleValue>WorkingPressure</simpleValue>');

  // Persistência: salvar, recarregar e reencontrar os valores na mesma ocorrência.
  await page.getByTestId('action-save').click();
  await expect(page.getByTestId('dirty-indicator')).toHaveText('salvo');
  await page.reload();
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await page.getByTestId('view-mode-bim').click();
  await page
    .locator(`[data-testid="bim-item"][data-element-id="${pipeId}"] .bim-tree__label`)
    .click();
  await expect(page.getByTestId(`ifc-edit-${PRESSURE}`)).toHaveValue('0,6');
  await expect(page.getByTestId(`ifc-edit-${MAKER}`)).toHaveValue('Fabricante de teste');
  await expect(page.getByTestId(`ifc-edit-${ROUGHNESS}`)).toHaveValue('0,1');
  await expect(page.getByTestId(`ifc-edit-${STATUS}`)).toHaveValue('NEW');
  await expect(page.getByTestId('ifc-description')).toHaveValue('Trecho de teste');

  // Limpar devolve o campo a pendente.
  await page.getByTestId(`ifc-clear-${PRESSURE}`).click();
  await expect(property(page, PRESSURE)).toHaveAttribute('data-pending', 'true');

  // A modelagem continua intacta ao voltar para o modelo 3D.
  await page.getByTestId('view-mode-3d').click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-view-mode', '3d');
  await expect(page.getByTestId('bim-tree')).toHaveCount(0);
  await expect(page.getByTestId('element-properties')).toBeVisible();
  expect(errors).toEqual([]);
});
