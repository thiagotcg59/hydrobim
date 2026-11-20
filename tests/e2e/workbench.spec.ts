import { expect, test, type Page } from '@playwright/test';
import { ctl, openTask } from './ui';

/**
 * Bancada de modelagem na disposição padrão: planta e modelo 3D lado a lado, barra de
 * ferramentas com símbolos e botões com seta, navegador em árvore, barra de referências e
 * barra de status. Os demais testes partem de uma vista por vez (ver playwright.config.ts).
 */

// Navegador sem preferências gravadas: vale a disposição padrão do editor.
test.use({ storageState: { cookies: [], origins: [] } });

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
  await page.keyboard.press('Escape');
}

test('vistas lado a lado: mesmo projeto e mesma seleção, vista ativa, divisor e maximizar', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page);
  await drawBend(page);
  await page.getByTestId('action-save').click();
  await expect(page.getByTestId('dirty-indicator')).toHaveText('salvo');

  const app = page.getByTestId('app');
  const workspace = page.getByTestId('workspace');
  await expect(workspace).toHaveAttribute('data-layout', 'split');
  const plan = page.getByTestId('pane-plan');
  const model = page.getByTestId('pane-3d');
  await expect(plan).toBeVisible();
  await expect(model).toBeVisible();
  await expect(page.getByTestId('viewport-canvas')).toBeVisible();

  // Planta à esquerda, modelo 3D à direita, do mesmo tamanho; cada uma com o seu título.
  const left = await plan.boundingBox();
  const right = await model.boundingBox();
  if (!left || !right) throw new Error('Vistas sem dimensões.');
  expect(left.x).toBeLessThan(right.x);
  expect(Math.abs(left.width - right.width)).toBeLessThan(12);
  await expect(page.getByTestId('view-mode-plan')).toHaveText('Planta MEP');
  await expect(page.getByTestId('view-mode-3d')).toHaveText('Modelo 3D');

  // As duas vistas mostram o mesmo projeto.
  const drawn = page.getByTestId('plan-svg').locator('[data-element-kind="pipe"]');
  await expect(drawn).toHaveCount(2);

  // Selecionar na planta ativa a planta e mostra o elemento nas propriedades.
  await drawn.first().click();
  await expect(app).toHaveAttribute('data-view-mode', 'plan');
  await expect(plan).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('element-properties')).toHaveAttribute('data-element-kind', 'pipe');
  const id = await page.getByTestId('element-properties').getAttribute('data-element-id');

  // Apontar o modelo 3D troca a vista ativa; a seleção e o projeto continuam os mesmos.
  await model.hover();
  await expect(app).toHaveAttribute('data-view-mode', '3d');
  await expect(model).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('element-properties')).toHaveAttribute('data-element-id', id ?? '');
  await expect(
    page.locator(`[data-testid="element-item"][data-element-id="${id}"]`),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(drawn).toHaveCount(2);

  // Os controles de orientação ficam no cabeçalho do modelo 3D.
  await page.getByTestId('view-isometric').click();
  await expect(page.getByTestId('pane-3d-projection')).toHaveText('Isométrica');
  await page.getByTestId('view-iso').click();
  await expect(page.getByTestId('pane-3d-projection')).toHaveText('Perspectiva');

  // Divisor: teclado e arrasto.
  const divider = page.getByTestId('workspace-divider');
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  await divider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '52');
  const handle = await divider.boundingBox();
  if (!handle) throw new Error('Divisor sem dimensões.');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 200);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 120, handle.y + 200, { steps: 4 });
  await page.mouse.up();
  const narrowed = await plan.boundingBox();
  if (!narrowed) throw new Error('Planta sem dimensões.');
  expect(narrowed.width).toBeLessThan(left.width - 60);

  // Maximizar o modelo 3D: a planta sai de cena, as abas de vista aparecem.
  await page.getByTestId('pane-3d-maximize').click();
  await expect(workspace).toHaveAttribute('data-maximized', '3d');
  await expect(plan).toBeHidden();
  await expect(page.getByTestId('view-tabs')).toBeVisible();
  const full = await model.boundingBox();
  if (!full) throw new Error('Modelo 3D sem dimensões.');
  expect(full.width).toBeGreaterThan(right.width * 1.7);
  // Escolher a planta pelas abas troca a vista maximizada.
  await page.getByTestId('view-mode-plan').click();
  await expect(workspace).toHaveAttribute('data-maximized', 'plan');
  await expect(plan).toBeVisible();
  await expect(drawn).toHaveCount(2);
  await page.getByTestId('pane-plan-maximize').click();
  await expect(workspace).toHaveAttribute('data-maximized', '');
  await expect(plan).toBeVisible();
  await expect(model).toBeVisible();

  // Nada disso mexe no projeto: continua salvo, com os mesmos elementos e a mesma seleção.
  await expect(page.getByTestId('dirty-indicator')).toHaveText('salvo');
  await expect(page.getByTestId('element-properties')).toHaveAttribute('data-element-id', id ?? '');

  // Uma vista por vez é uma preferência, lembrada na próxima visita.
  await (await ctl(page, 'view-split')).click();
  await expect(workspace).toHaveAttribute('data-layout', 'single');
  await expect(page.getByTestId('workspace-divider')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await expect(workspace).toHaveAttribute('data-layout', 'single');
  await (await ctl(page, 'view-split')).click();
  await expect(workspace).toHaveAttribute('data-layout', 'split');
  await expect(page.getByTestId('plan-svg').locator('[data-element-kind="pipe"]')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('lado a lado: o traçado começa na planta e continua no modelo 3D', async ({ page }) => {
  const errors = trackErrors(page);
  await start(page);
  await (await ctl(page, 'tool-pipe')).click();

  // Dois cliques na planta criam o primeiro trecho.
  const svg = page.getByTestId('plan-svg');
  const box = await svg.boundingBox();
  if (!box) throw new Error('Planta sem dimensões.');
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 4 });
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await expect(page.getByTestId('status-mode')).toHaveText('Tubulação: aguardando ponto final');
  await expect(svg.locator('[data-element-kind="pipe"]')).toHaveCount(1);

  // Passar para o modelo 3D não encerra a ferramenta nem o trecho em andamento.
  await page.getByTestId('pane-3d').hover();
  await expect(page.getByTestId('app')).toHaveAttribute('data-view-mode', '3d');
  await expect(page.getByTestId('status-mode')).toHaveText('Tubulação: aguardando ponto final');
  await expect(page.getByTestId('anchor-info')).toBeVisible();

  // Esc encerra o trecho e a ferramenta; o tubo aparece nas duas vistas e no navegador.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('status-mode')).toHaveText('Selecionar: pronto');
  await expect(page.locator('[data-testid="element-item"][data-element-kind="pipe"]')).toHaveCount(
    1,
  );
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');
  expect(errors).toEqual([]);
});

test('barra de ferramentas: grupos, símbolos com nome, botões com seta e dicas', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page);
  await openTask(page, 'model');
  for (const group of ['create', 'modify', 'connect', 'measure', 'catalog']) {
    await expect(page.getByTestId(`ribbon-group-${group}`)).toBeVisible();
  }
  // Aba ativa identificada também fora da cor.
  await expect(page.getByTestId('task-model')).toHaveAttribute('aria-selected', 'true');

  // Comandos principais com símbolo e nome; a dica traz nome, atalho e finalidade.
  const pipe = page.getByTestId('tool-pipe');
  await expect(pipe).toHaveText('Tubos');
  await expect(pipe.locator('svg')).toHaveCount(1);
  await expect(pipe).toHaveAttribute('title', /^Tubulação \(T\)\nClique o ponto inicial/);
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('modify-move')).toBeDisabled();
  await expect(page.getByTestId('modify-move')).toHaveAttribute('title', /Indisponível: Selecione/);

  // Conexões: a seta abre os tipos, com finalidade e atalho.
  const fittings = page.getByTestId('ribbon-menu-fittings');
  await expect(fittings).toHaveAttribute('aria-expanded', 'false');
  await fittings.click();
  const list = page.getByTestId('ribbon-menu-fittings-list');
  await expect(list.getByRole('menuitem')).toHaveCount(3);
  await expect(page.getByTestId('tool-elbow')).toContainText('Joelho');
  await expect(page.getByTestId('tool-elbow')).toContainText('J');
  // Esc fecha só a lista.
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(page.getByTestId('status-mode')).toHaveText('Selecionar: pronto');

  await fittings.click();
  await page.getByTestId('tool-tee').click();
  await expect(list).toHaveCount(0);
  await expect(page.getByTestId('status-mode')).toHaveText('Tê: pronto');
  await expect(fittings).toHaveAttribute('data-active-command', 'tool.tee');
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'false');

  // Equipamentos: bomba e reservatório; o atalho continua valendo sem abrir a lista.
  await page.getByTestId('ribbon-menu-equipment').click();
  await expect(page.getByTestId('ribbon-menu-equipment-list').getByRole('menuitem')).toHaveCount(2);
  await page.getByTestId('tool-tank').click();
  await expect(page.getByTestId('status-mode')).toHaveText('Reservatório: pronto');
  await page.getByTestId('workspace-view').hover();
  await page.keyboard.press('b');
  await expect(page.getByTestId('status-mode')).toHaveText('Bomba: pronto');
  await expect(page.getByTestId('ribbon-menu-equipment')).toHaveAttribute(
    'data-active-command',
    'tool.pump',
  );
  await page.keyboard.press('Escape');

  // A busca de comandos sabe onde o comando fica.
  await page.keyboard.press('Control+k');
  await page.getByTestId('command-palette-input').fill('joelho');
  await expect(
    page.getByTestId('command-palette').locator('[data-command="tool.elbow"]'),
  ).toContainText('Modelagem › Criar › Conexões');
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('navegador em árvore: categorias do modelo, recolher, selecionar e referências', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page);
  await drawBend(page);
  const browser = page.getByTestId('project-browser');
  for (const node of ['levels', 'systems', 'equipment', 'tanks', 'references']) {
    await expect(browser.getByTestId(`nav-${node}`)).toBeVisible();
  }

  // Dentro do sistema, os elementos ficam por categoria.
  const system = browser.getByTestId('nav-system').first();
  await expect(system).toContainText('Tubos');
  await expect(system).toContainText('Conexões');
  await expect(system).not.toContainText('Válvulas');
  const items = browser.getByTestId('element-item');
  await expect(items).toHaveCount(3);

  // Recolher e expandir; a busca abre o que estiver recolhido.
  await browser.getByTestId('nav-system-toggle').first().click();
  await expect(items).toHaveCount(0);
  await page.getByTestId('nav-search').fill('joelho');
  await expect(items).toHaveCount(1);
  await page.getByTestId('nav-search').fill('');
  await browser.getByTestId('nav-system-name').first().click();
  await expect(items).toHaveCount(3);
  await browser.getByTestId('nav-systems-toggle').click();
  await expect(browser.getByTestId('nav-system')).toHaveCount(0);
  await browser.getByTestId('nav-systems-toggle').click();

  // Seleção destacada e refletida nas propriedades, com o símbolo e o nome do elemento.
  await items.first().click();
  await expect(items.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('properties-type')).toHaveText('Tubo');
  await expect(page.getByTestId('properties-title')).toHaveText(
    (await items.first().locator('.tree__label').textContent()) ?? '',
  );

  // Equipamentos e reservatórios têm os seus nós; um reservatório criado aparece no dele.
  await (await ctl(page, 'tool-tank')).click();
  await addPoint(page, '6', '6', '0');
  await page.keyboard.press('Escape');
  await expect(browser.getByTestId('nav-tanks').getByTestId('element-item')).toHaveCount(1);
  await expect(browser.getByTestId('nav-system').getByTestId('element-item')).toHaveCount(3);

  // Referências levam à configuração do local.
  await expect(browser.getByTestId('nav-reference-terrain')).toContainText('sem superfície');
  await browser.getByTestId('nav-reference-georeference').click();
  await expect(page.getByTestId('project-dialog')).toBeVisible();
  await expect(page.getByTestId('tab-georeference')).toBeVisible();
  await page.getByTestId('project-close').click();

  // Vistas, no pé do navegador.
  await browser.getByTestId('nav-view-plan').click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-view-mode', 'plan');
  expect(errors).toEqual([]);
});

test('referências e barra de status: grade, captura, coordenadas, unidades e mensagens', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await start(page);
  const grid = page.getByTestId('status-grid');
  await expect(page.getByTestId('reference-bar')).toContainText('Referências');
  await expect(grid).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('reference-grid-step').selectOption('0.5');
  await expect(grid).toContainText('0,50 m');
  await grid.click();
  await expect(grid).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('reference-grid-step')).toBeDisabled();
  await grid.click();
  // Ligar e desligar a grade é preferência de desenho: não entra no histórico.
  await expect(page.getByTestId('action-undo')).toBeDisabled();

  // A instrução acompanha a ferramenta; a barra de status traz o estado.
  await (await ctl(page, 'tool-pipe')).click();
  await expect(page.getByTestId('status-instruction')).toContainText('Clique o ponto inicial');
  await expect(page.getByTestId('status-mode')).toHaveText('Tubulação: aguardando ponto inicial');
  await expect(page.getByTestId('status-elevation')).toContainText('Cota de desenho');
  await expect(page.getByTestId('status-restriction')).toBeVisible();
  await expect(page.getByTestId('status-units')).toContainText('Unidades: m');

  // O cursor sobre a planta mostra as coordenadas e o que foi capturado.
  const svg = page.getByTestId('plan-svg');
  const box = await svg.boundingBox();
  if (!box) throw new Error('Planta sem dimensões.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 10);
  await expect(page.getByTestId('status-coords')).toContainText('X ');
  await expect(page.getByTestId('status-coords')).not.toContainText('—');
  await expect(page.getByTestId('status-snap')).not.toHaveText('—');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('status-mode')).toHaveText('Selecionar: pronto');
  expect(errors).toEqual([]);
});

for (const size of [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
]) {
  test.describe(`${size.width} × ${size.height}`, () => {
    test.use({ viewport: size });

    test('regiões legíveis, sem rolagem da página, com painéis abertos e recolhidos', async ({
      page,
    }) => {
      const errors = trackErrors(page);
      await start(page);
      await drawBend(page);
      const overflow = (): Promise<{ x: number; y: number }> =>
        page.evaluate(() => ({
          x: document.documentElement.scrollWidth - window.innerWidth,
          y: document.documentElement.scrollHeight - window.innerHeight,
        }));
      expect(await overflow()).toEqual({ x: 0, y: 0 });

      // A barra de ferramentas ocupa uma linha de comandos em todas as abas.
      for (const task of ['model', 'document', 'view', 'analysis', 'export', 'manage'] as const) {
        await openTask(page, task);
        const body = await page.getByTestId('ribbon-body').boundingBox();
        if (!body) throw new Error('Barra de ferramentas sem dimensões.');
        expect(body.height, `barra da aba ${task}`).toBeLessThanOrEqual(64);
      }
      await openTask(page, 'model');

      // O desenho ocupa a maior parte da tela; cada vista tem largura útil.
      const view = await page.getByTestId('workspace-view').boundingBox();
      const plan = await page.getByTestId('pane-plan').boundingBox();
      const model = await page.getByTestId('pane-3d').boundingBox();
      if (!view || !plan || !model) throw new Error('Área de desenho sem dimensões.');
      expect(view.width).toBeGreaterThanOrEqual(size.width - 240 - 340 - 2);
      expect(view.height).toBeGreaterThanOrEqual(size.height * 0.7);
      expect(plan.width).toBeGreaterThanOrEqual(380);
      expect(model.width).toBeGreaterThanOrEqual(380);

      // Nada cortado nos cabeçalhos das vistas nem no cabeçalho da aplicação.
      for (const id of ['pane-plan-maximize', 'pane-3d-maximize', 'view-ortho', 'action-redo']) {
        const control = await page.getByTestId(id).boundingBox();
        if (!control) throw new Error(`Controle ${id} sem dimensões.`);
        expect(control.x + control.width, id).toBeLessThanOrEqual(size.width);
        expect(control.width, id).toBeGreaterThanOrEqual(24);
      }
      const environment = await page.getByTestId('environment-infra').boundingBox();
      const save = await page.getByTestId('action-save').boundingBox();
      if (!environment || !save) throw new Error('Cabeçalho sem dimensões.');
      expect(environment.x + environment.width).toBeLessThanOrEqual(save.x);

      // Painéis redimensionados e recolhidos: o desenho ganha o espaço, sem rolagem.
      await page.getByTestId('dock-nav-resizer').focus();
      await page.keyboard.press('ArrowRight');
      await page.getByTestId('dock-panel-resizer').focus();
      await page.keyboard.press('ArrowLeft');
      expect(await overflow()).toEqual({ x: 0, y: 0 });
      await page.getByTestId('dock-nav-toggle').click();
      await page.getByTestId('dock-panel-toggle').click();
      const wide = await page.getByTestId('workspace-view').boundingBox();
      if (!wide) throw new Error('Área de desenho sem dimensões.');
      expect(wide.width).toBeGreaterThanOrEqual(size.width - 60);
      expect(await overflow()).toEqual({ x: 0, y: 0 });
      await expect(page.getByTestId('plan-svg').locator('[data-element-kind="pipe"]')).toHaveCount(
        2,
      );
      expect(errors).toEqual([]);
    });
  });
}
