import { expect, test, type Page } from '@playwright/test';
import { ctl } from './ui';

/**
 * Bombas anfíbias de catálogo (HIGRA) no navegador real: aba Bombas do Catálogo, inserção de
 * uma linha da tabela, cotas com as letras do dimensional nas Propriedades e outro modelo
 * com as cotas preenchidas pelo usuário.
 */

const SINGLE_60 = 'higra-anfibia-estagio-unico-60hz';
const R1_260 = `${SINGLE_60}/r1-260-160l`;

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

async function placeAt(page: Page, x: string): Promise<void> {
  await setField(page, 'coord-x', x);
  await setField(page, 'coord-y', '0');
  await setField(page, 'coord-z', '0');
  await (await ctl(page, 'coord-add')).click();
  await expect(page.getByTestId('status-message')).not.toHaveAttribute('data-level', 'error');
}

test('insere uma bomba anfíbia do catálogo e preenche as cotas de outro modelo', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await (await ctl(page, 'action-new')).click();
  await expect(page.getByTestId('element-count')).toHaveText('0');
  await page.getByTestId('environment-infra').click();

  // Catálogo → Bombas: quatro famílias (tabelas 16 a 19), cinco linhas em cada uma.
  await (await ctl(page, 'action-families')).click();
  await page.getByTestId('families-tab-pumps').click();
  await expect(page.getByTestId('pump-family-item')).toHaveCount(4);
  await page.locator(`[data-testid="pump-family-item"][data-family-id="${SINGLE_60}"]`).click();
  await expect(page.getByTestId('pump-row')).toHaveCount(5);
  await expect(page.getByTestId('pump-library-source')).toContainText('Tabela 16, p. 42');
  // As colunas levam as letras do dimensional do fabricante.
  const header = page.getByTestId('pump-table').locator('thead');
  for (const letter of ['C', 'D', 'E', 'F', 'G', 'ØH', 'I', 'J']) {
    await expect(header.getByText(letter, { exact: false }).first()).toBeVisible();
  }
  // Linha R1-260: 266 / 581 / 151 / 998 / 340 / 27 / 283 / 543.
  await page.locator(`[data-testid="pump-row"][data-variant-id="${R1_260}"]`).click();
  const preview = page.getByTestId('pump-preview');
  await expect(preview).toHaveAttribute('data-variant-id', R1_260);
  await expect(preview).toHaveAttribute('data-state', 'model');
  await expect(page.getByTestId('pump-preview-extent')).toContainText('F 998 mm');
  await page.getByTestId('pump-library-use').click();

  // A ferramenta Bomba abre com a família e a linha escolhidas.
  await expect(await ctl(page, 'option-pump-family')).toHaveValue(SINGLE_60);
  await expect(await ctl(page, 'option-pump-variant')).toHaveValue(R1_260);
  await expect(await ctl(page, 'option-pump-ports')).toContainText('DN 200 PN 40');
  await placeAt(page, '0');
  await (await ctl(page, 'tool-select')).click();

  // Propriedades: família, linha da tabela e as cotas com as letras do catálogo (mm).
  await expect(await ctl(page, 'element-properties')).toHaveAttribute('data-element-kind', 'pump');
  await expect(await ctl(page, 'prop-pump-family')).toHaveAttribute('data-family-id', SINGLE_60);
  await expect(await ctl(page, 'prop-pump-variant')).toHaveAttribute('data-variant-id', R1_260);
  await expect(await ctl(page, 'prop-pump-class-a')).toHaveValue('PN 40');
  for (const [field, value] of [
    ['footOffset', '266'],
    ['footSpan', '581'],
    ['rearLength', '151'],
    ['length', '998'],
    ['footWidth', '340'],
    ['footHoleDiameter', '27'],
    ['axisHeight', '283'],
    ['totalHeight', '543'],
  ] as const) {
    await expect(await ctl(page, `prop-pump-${field}`)).toHaveValue(value);
  }

  // Alterar uma cota mantém a família e desfaz o vínculo com a linha da tabela.
  await setField(page, 'prop-pump-length', '1100');
  await expect(await ctl(page, 'prop-pump-length')).toHaveValue('1100');
  await expect(await ctl(page, 'prop-pump-variant')).toHaveAttribute('data-variant-id', '');
  await expect(await ctl(page, 'prop-pump-family')).toHaveAttribute('data-family-id', SINGLE_60);
  // Cota incoerente (I maior que J) é recusada e o campo volta ao valor vigente.
  await setField(page, 'prop-pump-axisHeight', '900');
  await expect(page.getByTestId('status-message')).toHaveAttribute('data-level', 'error');
  await expect(await ctl(page, 'prop-pump-axisHeight')).toHaveValue('283');
  // Outra classe de flange na descarga, pela tabela única.
  await (await ctl(page, 'prop-pump-class-b')).selectOption('PN 16');
  await expect(await ctl(page, 'prop-pump-class-b')).toHaveValue('PN 16');

  // Outro modelo: cotas preenchidas na ferramenta, com as mesmas letras.
  await (await ctl(page, 'tool-pump')).click();
  await (await ctl(page, 'option-pump-variant')).selectOption('custom');
  await expect(await ctl(page, 'option-pump-custom-note')).toBeVisible();
  await setField(page, 'option-pump-length', '1244');
  await setField(page, 'option-pump-footOffset', '385');
  await setField(page, 'option-pump-footSpan', '573');
  await setField(page, 'option-pump-rearLength', '286');
  await setField(page, 'option-pump-axisHeight', '335');
  await setField(page, 'option-pump-totalHeight', '635');
  await placeAt(page, '5');
  await (await ctl(page, 'tool-select')).click();
  await expect(await ctl(page, 'prop-pump-variant')).toHaveAttribute('data-variant-id', '');
  await expect(await ctl(page, 'prop-pump-length')).toHaveValue('1244');
  await expect(await ctl(page, 'prop-pump-footSpan')).toHaveValue('573');
  await (await ctl(page, 'back-to-project')).click();
  await expect(page.getByTestId('element-count')).toHaveText('2');

  expect(errors).toEqual([]);
});

test('duplica a família de bombas como personalizável, edita, aplica e exclui', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await (await ctl(page, 'action-new')).click();
  await page.getByTestId('environment-infra').click();

  const openPumps = async (): Promise<void> => {
    await (await ctl(page, 'action-families')).click();
    await page.getByTestId('families-tab-pumps').click();
  };
  const custom = page.locator('[data-testid="pump-family-item"][data-origin="custom"]');

  // Família de catálogo: somente leitura; a cópia aparece na lista, com a tabela editável.
  await openPumps();
  await page.locator(`[data-testid="pump-family-item"][data-family-id="${SINGLE_60}"]`).click();
  await expect(page.getByTestId('pump-cell-1-length')).toHaveCount(0);
  await page.getByTestId('pump-library-duplicate').click();
  await expect(custom).toHaveCount(1);
  await expect(custom).toHaveClass(/is-active/);
  await expect(page.getByTestId('pump-library-custom-note')).toBeVisible();
  await expect(page.getByTestId('pump-library-source')).toContainText('Personalizada');
  await expect(page.getByTestId('pump-cell-1-length')).toHaveValue('998');
  const familyId = (await custom.getAttribute('data-family-id')) ?? '';
  expect(familyId.startsWith('custom-pump-')).toBe(true);

  // Insere a linha R1-260 da família personalizada.
  await page.getByTestId('pump-row').nth(1).click();
  await page.getByTestId('pump-library-use').click();
  await expect(await ctl(page, 'option-pump-family')).toHaveValue(familyId);
  await placeAt(page, '0');
  await (await ctl(page, 'tool-select')).click();
  await expect(await ctl(page, 'prop-pump-family')).toHaveAttribute('data-family-id', familyId);
  await expect(await ctl(page, 'prop-pump-length')).toHaveValue('998');
  await expect(await ctl(page, 'prop-pump-note')).toContainText('família personalizada');

  // Edita a cota F e o nome, salva aplicando às bombas do projeto.
  await openPumps();
  await custom.click();
  const nameField = page.getByTestId('pump-family-name');
  await nameField.fill('Anfíbia da obra');
  const cell = page.getByTestId('pump-cell-1-length');
  await cell.fill('1100');
  await cell.press('Enter');
  // Cota incoerente (C + D maiores que F) é recusada ao salvar, e nada muda.
  const offset = page.getByTestId('pump-cell-1-footOffset');
  await offset.fill('900');
  await offset.press('Enter');
  await page.getByTestId('pump-family-save').click();
  await expect(page.getByTestId('status-message')).toHaveAttribute('data-level', 'error');
  await expect(page.getByTestId('status-message')).toContainText('Linha 2');
  await offset.fill('266');
  await offset.press('Enter');
  await expect(page.getByTestId('pump-family-apply')).toBeChecked();
  await page.getByTestId('pump-family-save').click();
  await expect(page.getByTestId('status-message')).toContainText('aplicada a 1 bomba(s)');
  await expect(custom).toContainText('Anfíbia da obra');
  await page.getByTestId('families-close').click();

  // A bomba inserida acompanhou a tabela e continua ligada à linha.
  await expect(await ctl(page, 'prop-pump-length')).toHaveValue('1100');
  await expect(await ctl(page, 'prop-pump-variant')).not.toHaveAttribute('data-variant-id', '');

  // Excluir a família: a bomba mantém forma e cotas, sem vínculo.
  await openPumps();
  await custom.click();
  await page.getByTestId('pump-family-delete').click();
  await expect(custom).toHaveCount(0);
  await page.getByTestId('families-close').click();
  await expect(await ctl(page, 'prop-pump-family')).toHaveAttribute('data-family-id', '');
  await expect(await ctl(page, 'prop-pump-length')).toHaveValue('1100');

  expect(errors).toEqual([]);
});

test('acrescenta uma linha nova de bomba a partir da família do catálogo', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await (await ctl(page, 'action-new')).click();
  await page.getByTestId('environment-infra').click();
  await (await ctl(page, 'action-families')).click();
  await page.getByTestId('families-tab-pumps').click();
  await page.locator(`[data-testid="pump-family-item"][data-family-id="${SINGLE_60}"]`).click();

  // Na família do catálogo, "Nova linha" cria a cópia personalizável e já traz a linha 6.
  await expect(page.getByTestId('pump-row-add')).toContainText('cópia personalizável');
  await page.getByTestId('pump-row-add').click();
  const custom = page.locator('[data-testid="pump-family-item"][data-origin="custom"]');
  await expect(custom).toHaveCount(1);
  await expect(page.getByTestId('pump-row')).toHaveCount(6);
  await expect(page.getByTestId('pump-cell-5-models')).toHaveValue('Novo modelo');

  // Preenche a linha nova com as cotas de outro modelo do catálogo (R1-360, 60 Hz).
  const fill = async (testId: string, value: string): Promise<void> => {
    const cell = page.getByTestId(testId);
    await cell.fill(value);
    await cell.press('Enter');
  };
  await fill('pump-cell-5-models', 'R1-360/50B, R1-360/150B');
  await fill('pump-cell-5-frame', '225S');
  await fill('pump-cell-5-suction-dn', '200');
  await page.getByTestId('pump-cell-5-suction-class').selectOption('PN 40');
  await fill('pump-cell-5-discharge-dn', '200');
  await page.getByTestId('pump-cell-5-discharge-class').selectOption('PN 40');
  for (const [key, value] of [
    ['footOffset', '385'],
    ['footSpan', '573'],
    ['rearLength', '286'],
    ['length', '1244'],
    ['footWidth', '380'],
    ['footHoleDiameter', '30'],
    ['axisHeight', '335'],
    ['totalHeight', '635'],
  ] as const) {
    await fill(`pump-cell-5-${key}`, value);
  }
  await fill('pump-cell-5-weight', '750');
  await page.getByTestId('pump-family-save').click();
  await expect(page.getByTestId('status-message')).toContainText('salva');
  await expect(page.getByTestId('pump-preview')).toHaveAttribute('data-state', 'model');
  await expect(page.getByTestId('pump-preview-extent')).toContainText('F 1244 mm');

  // A linha nova é inserida pela ferramenta Bomba.
  await page.getByTestId('pump-library-use').click();
  await expect(await ctl(page, 'option-pump-variant')).toContainText('R1-360/50B a R1-360/150B');
  await placeAt(page, '0');
  await (await ctl(page, 'tool-select')).click();
  await expect(await ctl(page, 'prop-pump-length')).toHaveValue('1244');
  await expect(await ctl(page, 'prop-pump-variant')).toContainText('R1-360/50B a R1-360/150B');

  expect(errors).toEqual([]);
});
