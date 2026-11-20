import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { ctl, openProjectTab, openTask, type Task } from './ui';

/**
 * Organização da interface: abas de tarefa independentes da vista e do ambiente, menu Arquivo,
 * painéis recolhíveis e redimensionáveis, opções da ferramenta separadas das propriedades,
 * exportações centralizadas, busca de comandos e teclado sem disparos indevidos.
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

async function start(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await (await ctl(page, 'action-new')).click();
  await expect(page.getByTestId('element-count')).toHaveText('0');
}

/** Dois tubos e um joelho, pelas coordenadas. */
async function drawBend(page: Page): Promise<void> {
  await (await ctl(page, 'tool-pipe')).click();
  await addPoint(page, '0', '0', '0');
  await addPoint(page, '2', '0', '0');
  await addPoint(page, '2', '2', '0');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

async function download(page: Page, testId: string): Promise<{ name: string; text: string }> {
  const pending = page.waitForEvent('download');
  await (await ctl(page, testId)).click();
  const file = await pending;
  return { name: file.suggestedFilename(), text: await readFile(await file.path(), 'utf8') };
}

const TASKS: Task[] = ['model', 'document', 'view', 'analysis', 'export', 'manage'];

test('abas de tarefa: não mudam ambiente, vista, modelo nem a operação em andamento', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page);
  await page.getByTestId('action-save').click();
  await expect(page.getByTestId('dirty-indicator')).toHaveText('salvo');

  // Trecho em andamento na planta.
  await page.getByTestId('view-mode-plan').click();
  await (await ctl(page, 'tool-pipe')).click();
  await addPoint(page, '0', '0', '0');
  await addPoint(page, '3', '0', '0');
  await expect(page.getByTestId('status-mode')).toHaveText('Tubulação: aguardando ponto final');
  await expect(page.getByTestId('dirty-indicator')).toHaveText('não salvo');
  await page.getByTestId('action-save').click();
  await expect(page.getByTestId('dirty-indicator')).toHaveText('salvo');

  const app = page.getByTestId('app');
  for (const task of TASKS) {
    await openTask(page, task);
    await expect(page.getByTestId('ribbon')).toHaveAttribute('data-task', task);
    await expect(app).toHaveAttribute('data-view-mode', 'plan');
    await expect(page.getByTestId('status-mode')).toHaveText('Tubulação: aguardando ponto final');
    await expect(page.getByTestId('plan-anchor')).toHaveCount(1);
    await expect(page.getByTestId('environment-mep')).toHaveAttribute('aria-pressed', 'true');
    // Trocar de aba não marca o projeto como alterado.
    await expect(page.getByTestId('dirty-indicator')).toHaveText('salvo');
  }
  // O histórico só tem o trecho: um desfazer o remove.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByTestId('action-undo').click();
  await expect(page.getByTestId('element-count')).toHaveText('0');
  await expect(page.getByTestId('action-undo')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('painel direito separa as opções da ferramenta das propriedades da seleção', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page);
  const panel = page.getByTestId('right-panel');

  // Sem ferramenta de criação: só propriedades, com estado vazio útil.
  await expect(panel).toHaveAttribute('data-tab', 'properties');
  await expect(page.getByTestId('panel-tab-tool')).toBeDisabled();
  await expect(page.getByTestId('properties-empty')).toContainText('Nada selecionado');
  await expect(page.getByTestId('properties-scope')).toHaveText('Sem seleção');

  // Ferramenta ativa: os parâmetros do próximo elemento, identificados como tal.
  await (await ctl(page, 'tool-pipe')).click();
  await expect(panel).toHaveAttribute('data-tab', 'tool');
  await expect(page.getByTestId('tool-options')).toContainText('Próximo elemento');
  await expect(page.getByTestId('panel-tab-tool')).toContainText('Tubulação');
  await addPoint(page, '0', '0', '0');
  await addPoint(page, '2', '0', '0');
  // O trecho criado fica selecionado, mas o painel não sai das opções durante o traçado.
  await expect(panel).toHaveAttribute('data-tab', 'tool');
  await expect(page.getByTestId('panel-tab-properties')).toContainText('1');
  // Os valores digitados continuam nos campos.
  await expect(page.getByTestId('coord-x')).toHaveValue('2');

  // As propriedades do que já existe ficam na outra aba.
  await page.getByTestId('panel-tab-properties').click();
  await expect(page.getByTestId('element-properties')).toHaveAttribute('data-element-kind', 'pipe');
  await expect(page.getByTestId('properties-scope')).toContainText('Seleção única');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveAttribute('data-tab', 'properties');

  // Seções recolhíveis.
  const geometry = page.getByTestId('section-geometry');
  await expect(page.getByTestId('prop-length')).toBeVisible();
  await geometry.locator('.section__toggle').click();
  await expect(geometry).toHaveAttribute('data-collapsed', 'true');
  await expect(page.getByTestId('prop-length')).toHaveCount(0);
  await geometry.locator('.section__toggle').click();
  await expect(page.getByTestId('prop-length')).toHaveValue('2');
  expect(errors).toEqual([]);
});

test('modificar e conectar: disponibilidade pela seleção, com o motivo', async ({ page }) => {
  const errors = trackErrors(page);
  await start(page);
  await drawBend(page);
  await page.keyboard.press('Escape');
  await openTask(page, 'model');

  const move = page.getByTestId('modify-move');
  await expect(move).toBeDisabled();
  await expect(move).toHaveAttribute('title', /Indisponível: Selecione/);
  await expect(page.getByTestId('modify-length')).toBeDisabled();

  // Seleção pelo navegador do projeto.
  const pipes = page.locator('[data-testid="element-item"][data-element-kind="pipe"]');
  await expect(pipes).toHaveCount(2);
  await pipes.first().click();
  await expect(move).toBeEnabled();
  await expect(page.getByTestId('modify-rotate')).toBeDisabled();
  await expect(page.getByTestId('modify-rotate')).toHaveAttribute('title', /Tubos não giram/);

  // "Comprimento" leva ao campo que executa a alteração.
  await page.getByTestId('modify-length').click();
  await expect(page.getByTestId('prop-length')).toBeFocused();
  // O comprimento do tubo desconta o joelho: o valor de partida é o do modelo.
  const original = await page.getByTestId('prop-length').inputValue();
  expect(original).not.toBe('3');
  await page.getByTestId('prop-length').fill('3');
  await page.getByTestId('prop-length').press('Enter');
  await expect(page.getByTestId('prop-length')).toHaveValue('3');
  await page.getByTestId('action-undo').click();
  await expect(page.getByTestId('prop-length')).toHaveValue(original);
  await page.getByTestId('action-redo').click();
  await expect(page.getByTestId('prop-length')).toHaveValue('3');

  // "Tubo da extremidade" aciona a ferramenta a partir da porta livre.
  await page.getByTestId('connect-pipe').click();
  await expect(page.getByTestId('status-mode')).toHaveText('Tubulação: aguardando ponto final');
  await expect(page.getByTestId('anchor-info')).toContainText('extremidade livre');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Excluir, pelo botão; e duas peças selecionadas habilitam o fechamento assistido.
  await pipes.first().click();
  await pipes.nth(1).click({ modifiers: ['Control'] });
  await expect(page.getByTestId('properties-scope')).toContainText('Seleção múltipla');
  await expect(page.getByTestId('connect-close')).toBeEnabled();
  await expect(page.getByTestId('modify-length')).toBeDisabled();
  await page.getByTestId('modify-delete').click();
  await expect(pipes).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('painéis e faixa: recolher, redimensionar, restaurar e lembrar a preferência', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page);
  const view = page.getByTestId('workspace-view');
  const initial = await view.boundingBox();
  if (!initial) throw new Error('Área de desenho sem dimensões.');

  // Recolher a faixa e os painéis amplia a área de desenho.
  await page.getByTestId('ribbon-collapse').click();
  await expect(page.getByTestId('ribbon-body')).toHaveCount(0);
  await page.getByTestId('dock-nav-toggle').click();
  await page.getByTestId('dock-panel-toggle').click();
  await expect(page.getByTestId('dock-nav')).toHaveAttribute('data-open', 'false');
  await expect(page.getByTestId('dock-panel')).toHaveAttribute('data-open', 'false');
  const wide = await view.boundingBox();
  if (!wide) throw new Error('Área de desenho sem dimensões.');
  expect(wide.width).toBeGreaterThan(initial.width + 400);
  expect(wide.height).toBeGreaterThan(initial.height + 60);
  // Nada disso altera o projeto.
  await expect(page.getByTestId('action-undo')).toBeDisabled();

  // A preferência vale para a próxima visita.
  await page.reload();
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await expect(page.getByTestId('dock-nav')).toHaveAttribute('data-open', 'false');
  await expect(page.getByTestId('ribbon')).toHaveAttribute('data-collapsed', 'true');

  // Escolher uma aba mostra de novo os comandos; os painéis reabrem pela régua.
  await page.getByTestId('task-view').click();
  await expect(page.getByTestId('ribbon-body')).toBeVisible();
  await page.getByTestId('dock-nav-toggle').click();
  await page.getByTestId('dock-panel-toggle').click();
  await expect(page.getByTestId('project-browser')).toBeVisible();

  // Redimensionar pela borda (arrastando) e pelo teclado.
  const resizer = page.getByTestId('dock-nav-resizer');
  const handle = await resizer.boundingBox();
  if (!handle) throw new Error('Divisor sem dimensões.');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 200);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 90, handle.y + 200, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId('dock-nav')).toHaveAttribute('data-width', '330');
  await page.getByTestId('dock-panel-resizer').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('dock-panel')).toHaveAttribute('data-width', '356');

  // Restaurar layout padrão.
  await (await ctl(page, 'layout-reset')).click();
  await expect(page.getByTestId('dock-nav')).toHaveAttribute('data-width', '240');
  await expect(page.getByTestId('dock-panel')).toHaveAttribute('data-width', '340');
  await expect(page.getByTestId('status-message')).toContainText('Layout padrão restaurado');
  expect(errors).toEqual([]);
});

test('menu Arquivo, busca de comandos e teclado sem disparos indevidos', async ({ page }) => {
  const errors = trackErrors(page);
  await start(page);

  // O menu explica a diferença entre salvar no navegador e baixar o arquivo.
  await page.getByTestId('menu-file').click();
  const menu = page.getByTestId('menu-file-list');
  await expect(menu).toContainText('Salvar no navegador');
  await expect(menu).toContainText('Baixar arquivo .hydrobim.json');
  await expect(menu).toContainText('guarda o projeto só neste navegador');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // Digitar em um campo não troca de ferramenta.
  const name = page.getByTestId('project-name');
  await name.fill('Teste de layout');
  await name.pressSequentially(' TJEB');
  await expect(page.getByTestId('status-mode')).toHaveText('Selecionar: pronto');
  await name.press('Enter');
  await expect(name).toHaveValue('Teste de layout TJEB');

  // Fora dos campos, os atalhos valem.
  await page.getByTestId('workspace-view').click({ position: { x: 40, y: 40 } });
  await page.keyboard.press('t');
  await expect(page.getByTestId('status-mode')).toHaveText('Tubulação: aguardando ponto inicial');
  // Esc com o menu aberto fecha só o menu: a ferramenta continua ativa.
  await page.getByTestId('menu-file').click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('status-mode')).toHaveText('Tubulação: aguardando ponto inicial');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('status-mode')).toHaveText('Selecionar: pronto');

  // Busca de comandos: mesmo registro, com o lugar do comando e o motivo de indisponibilidade.
  await page.keyboard.press('Control+k');
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();
  const input = page.getByTestId('command-palette-input');
  // As teclas digitadas na busca também não são atalhos de ferramenta.
  await input.fill('ifc');
  const ifc = palette.locator('[data-command="export.ifc"]');
  await expect(ifc).toBeDisabled();
  await expect(ifc).toContainText('Indisponível: O projeto ainda não tem elementos.');
  await expect(ifc).toContainText('Exportação › Modelo');
  await input.fill('niveis');
  await expect(palette.locator('[data-command="manage.levels"]')).toContainText(
    'Gerenciar › Projeto',
  );
  await input.press('Enter');
  await expect(palette).toBeHidden();
  await expect(page.getByTestId('project-dialog-title')).toHaveText('Gerenciar projeto');
  await expect(page.getByTestId('tab-levels')).toBeVisible();
  // Configuração e resultados não se misturam no diálogo.
  await expect(page.getByTestId('tab-button-terrain')).toBeVisible();
  await expect(page.getByTestId('tab-button-clashes')).toHaveCount(0);
  await page.getByTestId('project-close').click();
  await expect(page.getByTestId('status-mode')).toHaveText('Selecionar: pronto');

  // Ctrl+S salva mesmo com o foco em um campo.
  await name.click();
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty-indicator')).toHaveText('salvo');

  // Projeto salvo aparece nos recentes do menu Arquivo.
  await page.getByTestId('menu-file').click();
  await expect(page.getByTestId('recent-project').first()).toContainText('Teste de layout TJEB');
  expect(errors).toEqual([]);
});

test('exportação centralizada: planta, modelo e dados pelo novo acesso, de qualquer vista', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page);

  // Sem elementos: saídas indisponíveis, com o motivo.
  await openTask(page, 'export');
  await expect(page.getByTestId('action-export-ifc')).toBeDisabled();
  await expect(page.getByTestId('action-export-ifc')).toHaveAttribute(
    'title',
    /Indisponível: O projeto ainda não tem elementos/,
  );
  await drawBend(page);

  // Conteúdo, opções e requisitos de cada saída.
  await (await ctl(page, 'export-details')).click();
  const details = page.getByTestId('export-dialog');
  await expect(details.getByTestId('export-row')).toHaveCount(7);
  await expect(details.getByTestId('export-kind-Planta')).toContainText('DXF da planta');
  await expect(details.getByTestId('export-kind-Dados')).toContainText('Requisitos IDS');
  await expect(details).toContainText('Requisitos');
  await details.getByTestId('export-close').click();

  // No modelo 3D: o DXF da planta sai sem trocar de vista…
  const app = page.getByTestId('app');
  await expect(app).toHaveAttribute('data-view-mode', '3d');
  const dxf = await download(page, 'plan-export-dxf');
  expect(dxf.name).toMatch(/-planta\.dxf$/);
  expect(dxf.text).toContain('REDE_');
  await expect(app).toHaveAttribute('data-view-mode', '3d');

  // …e o SVG, que é o desenho da vista, abre a planta para gerar o arquivo.
  const svg = await download(page, 'plan-export-svg');
  expect(svg.name).toMatch(/-planta\.svg$/);
  expect(svg.text).toContain('<svg');
  expect(svg.text).toContain('PLANTA BAIXA');
  await expect(app).toHaveAttribute('data-view-mode', 'plan');
  await expect(page.getByTestId('status-message')).toContainText('Planta exportada em SVG');

  // Modelo e dados.
  const ifc = await download(page, 'action-export-ifc');
  expect(ifc.text).toContain('IFC4X3_ADD2');
  expect(ifc.text).toContain('IFCPIPESEGMENT');
  const model = await download(page, 'action-export-dxf');
  expect(model.name).toMatch(/-3d\.dxf$/);
  const csv = await download(page, 'action-export-csv');
  expect(csv.text).toContain('Tubo');
  const inp = await download(page, 'action-export-epanet');
  expect(inp.text).toContain('[PIPES]');
  const ids = await download(page, 'action-export-ids');
  expect(ids.text).toContain('http://standards.buildingsmart.org/IDS');

  // O arquivo nativo fica no menu Arquivo.
  const native = await download(page, 'action-export');
  expect(native.name).toMatch(/\.hydrobim\.json$/);
  expect(JSON.parse(native.text)).toMatchObject({ format: 'hydrobim-project' });

  // Quantitativo em tela, na aba Análise, com as mesmas linhas do CSV.
  const dialog = await openProjectTab(page, 'quantities');
  await expect(page.getByTestId('project-dialog-title')).toHaveText('Análises do modelo');
  await expect(dialog.getByTestId('quantities-row')).toHaveCount(
    csv.text.trim().split('\n').length - 1,
  );
  await expect(dialog.getByTestId('tab-button-levels')).toHaveCount(0);
  await dialog.getByTestId('project-close').click();
  expect(errors).toEqual([]);
});

test('consulta BIM / IFC: suspende a modelagem, mantém a seleção e a retoma ao sair', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page);
  await (await ctl(page, 'tool-pipe')).click();
  await addPoint(page, '0', '0', '0');
  await addPoint(page, '2', '0', '0');
  await expect(page.getByTestId('status-mode')).toHaveText('Tubulação: aguardando ponto final');
  const id = await (await ctl(page, 'prop-id')).textContent();
  await (await ctl(page, 'coord-x')).focus();

  await page.getByTestId('task-bim').click();
  const app = page.getByTestId('app');
  await expect(app).toHaveAttribute('data-view-mode', 'bim');
  await expect(page.getByTestId('bim-mode-badge')).toBeVisible();
  await expect(page.getByTestId('bim-tree')).toBeVisible();
  await expect(page.getByTestId('status-message')).toContainText('suspensa');
  // A seleção acompanha: o painel IFC mostra o mesmo elemento.
  await expect(page.getByTestId('ifc-element')).toHaveAttribute('data-element-id', id ?? '');
  await expect(page.getByTestId('bim-summary')).toContainText('1 elementos');

  // Proteções: os atalhos de modelagem e o Delete não valem na consulta.
  await page.getByTestId('workspace-view').hover();
  await page.keyboard.press('j');
  await expect(app).toHaveAttribute('data-view-mode', 'bim');
  await expect(page.getByTestId('status-message')).toContainText('consulta BIM / IFC não modela');
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('ifc-element-count')).toHaveCount(0);
  await expect(page.getByTestId('bim-item')).toHaveCount(1);

  // Sair por outra aba retoma a vista e o trecho.
  await page.getByTestId('task-model').click();
  await expect(app).toHaveAttribute('data-view-mode', '3d');
  await expect(page.getByTestId('status-mode')).toHaveText('Tubulação: aguardando ponto final');
  await addPoint(page, '2', '2', '0');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('element-count')).toHaveText('3');

  // A troca de vista também encerra a consulta e devolve a aba de tarefa.
  await openTask(page, 'analysis');
  await page.getByTestId('task-bim').click();
  await page.getByTestId('view-mode-plan').click();
  await expect(app).toHaveAttribute('data-view-mode', 'plan');
  await expect(page.getByTestId('ribbon')).toHaveAttribute('data-task', 'analysis');
  expect(errors).toEqual([]);
});

test('navegador do projeto: busca, seleção, níveis e visibilidade dos sistemas', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page);
  await drawBend(page);
  await page.keyboard.press('Escape');
  const items = page.getByTestId('element-item');
  await expect(items).toHaveCount(3);

  await page.getByTestId('nav-search').fill('joelho');
  await expect(items).toHaveCount(1);
  await items.first().click();
  await expect(page.getByTestId('element-properties')).toHaveAttribute(
    'data-element-kind',
    'elbow',
  );
  await page.getByTestId('nav-search').fill('nada disso');
  await expect(page.getByTestId('nav-no-match')).toBeVisible();
  await page.getByTestId('nav-search').fill('');
  await expect(items).toHaveCount(3);

  // Selecionar o sistema inteiro e ocultá-lo nas vistas.
  await page.getByTestId('nav-system-select').click();
  await expect(page.getByTestId('multi-properties')).toHaveAttribute('data-count', '3');
  await page.keyboard.press('Escape');
  await page.getByTestId('view-mode-plan').click();
  const drawn = page.getByTestId('plan-svg').locator('[data-element-kind="pipe"]');
  await expect(drawn).toHaveCount(2);
  await page.getByTestId('nav-system-visibility').click();
  await expect(drawn).toHaveCount(0);
  await page.getByTestId('nav-system-visibility').click();
  await expect(drawn).toHaveCount(2);

  // Vistas pelo navegador e nível como plano de trabalho.
  await page.getByTestId('nav-view-3d').click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-view-mode', '3d');
  await expect(page.getByTestId('nav-level').first()).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test.describe('1366 × 768', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('a faixa cabe em uma linha, sem rolagem da página, e a área de desenho é ampla', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await start(page);
    for (const task of TASKS) {
      await openTask(page, task);
      const body = await page.getByTestId('ribbon-body').boundingBox();
      if (!body) throw new Error('Faixa sem dimensões.');
      expect(body.height, `faixa da aba ${task}`).toBeLessThanOrEqual(90);
      expect(body.width).toBeLessThanOrEqual(1366);
    }
    const overflow = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth - window.innerWidth,
      y: document.documentElement.scrollHeight - window.innerHeight,
    }));
    expect(overflow).toEqual({ x: 0, y: 0 });
    const view = await page.getByTestId('workspace-view').boundingBox();
    if (!view) throw new Error('Área de desenho sem dimensões.');
    expect(view.width).toBeGreaterThanOrEqual(780);
    expect(view.height).toBeGreaterThanOrEqual(540);
    expect(errors).toEqual([]);
  });
});
