import { expect, test, type Page } from '@playwright/test';
import { ctl } from './ui';

/**
 * Modelagem arquitetônica de precisão no navegador real, sobre a demonstração "Edificação
 * simples": capturas na planta (perpendicular a uma parede oblíqua, conferida numericamente no
 * projeto gravado; estabilidade com a ampliação; Tab; nível ativo), alças de parede que
 * preservam as portas hospedadas, mover e copiar por pontos com prévia, edição de contorno
 * com Concluir e Cancelar, e telhados de uma e de duas águas com os quantitativos.
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

/** Posição na tela de um ponto do modelo, pela janela atual da planta. */
async function planPoint(page: Page, x: number, y: number): Promise<[number, number]> {
  const plan = page.getByTestId('plan-view');
  const box = await page.getByTestId('plan-svg').boundingBox();
  const mpp = Number(await plan.getAttribute('data-mpp'));
  const [cx, cy] = ((await plan.getAttribute('data-center')) ?? '0;0').split(';').map(Number);
  if (!box || !Number.isFinite(mpp) || cx === undefined || cy === undefined) {
    throw new Error('Planta sem dimensões.');
  }
  return [box.x + box.width / 2 + (x - cx) / mpp, box.y + box.height / 2 - (y - cy) / mpp];
}

/** Abre a demonstração na planta de trabalho e afasta a vista para haver área livre. */
async function openDemo(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await (await ctl(page, 'action-open')).click();
  await page.getByTestId('open-demo-building').click();
  await expect(page.getByTestId('environment-architecture')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByTestId('view-mode-plan').click();
  await page.getByTestId('view-fit').click();
  await zoom(page, 700);
}

/**
 * Roda do mouse (positivo afasta) sobre o meio da planta ou sobre o ponto do modelo `at`, que
 * então continua sob o cursor.
 */
async function zoom(page: Page, delta: number, at?: { x: number; y: number }): Promise<void> {
  const plan = page.getByTestId('plan-view');
  const before = await plan.getAttribute('data-mpp');
  const box = await page.getByTestId('plan-svg').boundingBox();
  if (!box) throw new Error('Planta sem dimensões.');
  if (at) await page.mouse.move(...(await planPoint(page, at.x, at.y)));
  else await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, delta);
  await expect(plan).not.toHaveAttribute('data-mpp', before ?? '');
}

interface SavedWall {
  kind: string;
  name: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
}

/** Projeto como foi gravado no navegador (números com a precisão do modelo). */
async function savedElements(page: Page): Promise<SavedWall[]> {
  await page.getByTestId('action-save').click();
  await expect(page.getByTestId('status-message')).toContainText('salvo no navegador');
  return page.evaluate(() => {
    const id = localStorage.getItem('hydrobim:projects:last');
    const raw = id ? localStorage.getItem(`hydrobim:project:${id}`) : null;
    const project = raw ? (JSON.parse(raw) as { architecture: { elements: SavedWall[] } }) : null;
    return project ? project.architecture.elements : [];
  });
}

const RAD = Math.PI / 180;

test('capturas: perpendicular a uma parede a 23°, estável com a ampliação, com Tab e nível ativo', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openDemo(page);
  const plan = page.getByTestId('plan-view');
  const snap = page.getByTestId('arch-snap');

  // Controles das capturas na barra de referências: cada uma se liga e desliga pelo menu.
  await expect(page.getByTestId('snap-menu')).toHaveAttribute('data-on', '8');
  await page.getByTestId('snap-menu').click();
  await expect(page.getByTestId('snap-toggles')).toBeVisible();
  const perpendicularToggle = page.getByTestId('snap-toggle-perpendicular');
  await expect(perpendicularToggle).toBeChecked();
  await perpendicularToggle.uncheck();
  await expect(page.getByTestId('snap-menu')).toHaveAttribute('data-on', '7');
  await perpendicularToggle.check();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('snap-toggles')).toHaveCount(0);
  await expect(page.getByTestId('snap-menu')).toHaveAttribute('data-on', '8');

  // Nível ativo: o telhado da demonstração está no nível da cobertura e não é desenhado nem
  // capturado na planta do térreo; com todos os níveis sobrepostos, passa a ser.
  const roofInPlan = page.locator('[data-testid="arch-plan-element"][data-arch-kind="roof"]');
  await expect(page.getByTestId('arch-level-filter')).toHaveAttribute('aria-pressed', 'true');
  await expect(roofInPlan).toHaveCount(0);
  await page.getByTestId('arch-wall').click();
  await expect(plan).toHaveAttribute('data-arch-tool', 'wall');
  // Canto do beiral do telhado (0,59 m para fora das paredes).
  await page.mouse.move(...(await planPoint(page, -0.57, -0.6)));
  await expect(snap).not.toHaveAttribute('data-kind', 'endpoint');
  await page.getByTestId('arch-level-filter').click();
  await expect(roofInPlan).toHaveCount(1);
  await page.mouse.move(...(await planPoint(page, -0.58, -0.6)));
  await expect(snap).toHaveAttribute('data-kind', 'endpoint');
  await page.getByTestId('arch-level-filter').click();
  await expect(roofInPlan).toHaveCount(0);

  // Referências sobrepostas no canto da edificação (eixo e faces): Tab alterna entre elas.
  await page.mouse.move(...(await planPoint(page, 0.04, 0.03)));
  await expect(snap).toHaveAttribute('data-kind', 'endpoint');
  const overlapped = Number(await snap.getAttribute('data-count'));
  expect(overlapped).toBeGreaterThan(1);
  const firstPoint = await snap.getAttribute('data-point');
  await page.keyboard.press('Tab');
  await expect(snap).toHaveAttribute('data-index', '1');
  await expect(page.getByTestId('arch-snap-label')).toContainText(`Tab: 2/${overlapped}`);
  expect(await snap.getAttribute('data-point')).not.toBe(firstPoint);

  // Parede a 23°: primeiro ponto por clique, o trecho por entrada polar exata.
  await page.mouse.click(...(await planPoint(page, 8, -1)));
  await expect(page.getByTestId('arch-draft')).toHaveAttribute('data-points', '1');
  await page.keyboard.type('5<23');
  await expect(page.getByTestId('arch-length-entry')).toHaveValue('5<23');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('arch-draft')).toHaveAttribute('data-points', '2');

  // Cursor sobre a perpendicular, a 3 m: guia tracejada, símbolo de ângulo reto e o rótulo.
  const end = { x: 8 + 5 * Math.cos(23 * RAD), y: -1 + 5 * Math.sin(23 * RAD) };
  const normal = { x: -Math.sin(23 * RAD), y: Math.cos(23 * RAD) };
  const target = { x: end.x + normal.x * 3, y: end.y + normal.y * 3 };
  /** Cursor a `pixels` da perpendicular (na direção da parede anterior), nesta ampliação. */
  const offBy = async (pixels: number): Promise<[number, number]> => {
    const [sx, sy] = await planPoint(page, target.x, target.y);
    return [sx + pixels * Math.cos(23 * RAD), sy - pixels * Math.sin(23 * RAD)];
  };
  for (const delta of [0, -350, 500]) {
    // Em três ampliações: 6 px fora da perpendicular captura; 18 px, não.
    if (delta !== 0) await zoom(page, delta, target);
    await page.mouse.move(...(await offBy(18)));
    await expect(snap).not.toHaveAttribute('data-kind', 'perpendicularPrevious');
    await page.mouse.move(...(await offBy(6)));
    await expect(snap).toHaveAttribute('data-kind', 'perpendicularPrevious');
  }
  await expect(page.getByTestId('arch-snap-label')).toContainText(
    'Perpendicular ao trecho anterior · 90°',
  );
  await expect(page.getByTestId('arch-snap-right-angle')).toBeVisible();
  await expect(page.getByTestId('arch-snap-guide').first()).toBeVisible();
  await expect(page.getByTestId('arch-draft-angle')).toContainText('90° do trecho anterior');

  // Shift com o cursor parado: a trava de ângulo substitui a captura; ao soltar, ela volta.
  await page.keyboard.down('Shift');
  await expect(snap).toHaveAttribute('data-kind', 'polar');
  await page.keyboard.up('Shift');
  await expect(snap).toHaveAttribute('data-kind', 'perpendicularPrevious');

  // A confirmação usa o ponto da prévia.
  const previewed = await snap.getAttribute('data-point');
  await page.mouse.click(...(await offBy(6)));
  await expect(page.getByTestId('arch-draft')).toHaveAttribute('data-points', '3');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('status-message')).toContainText('2 paredes criadas');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Conferência numérica no projeto gravado: 23° e 90° exatos, sem depender da tela.
  const walls = (await savedElements(page)).filter((element) => element.kind === 'wall');
  const [first, second] = walls.slice(-2);
  if (!first || !second) throw new Error('Paredes não gravadas.');
  const u = { x: first.end.x - first.start.x, y: first.end.y - first.start.y };
  const v = { x: second.end.x - second.start.x, y: second.end.y - second.start.y };
  const between = Math.atan2(Math.abs(u.x * v.y - u.y * v.x), u.x * v.x + u.y * v.y);
  expect(Math.abs(between - Math.PI / 2)).toBeLessThan(1e-9);
  expect(Math.abs(Math.atan2(u.y, u.x) - 23 * RAD)).toBeLessThan(1e-9);
  expect(Math.hypot(u.x, u.y)).toBeCloseTo(5, 9);
  expect(`${second.end.x};${second.end.y}`).toBe(previewed);

  expect(errors).toEqual([]);
});

test('paredes: alça da extremidade preserva a porta hospedada; mover e copiar por pontos', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openDemo(page);
  const status = page.getByTestId('status-message');
  const drawn = page.getByTestId('arch-plan-element');
  await expect(drawn).toHaveCount(14);

  // Parede sul (de (0,0) a (6,0)), com uma porta a 1,20 m e uma janela a 2,80 m do início.
  await page.mouse.click(...(await planPoint(page, 5, 0)));
  await expect(page.getByTestId('properties-title')).toHaveText('Parede 1');
  await expect(page.getByTestId('arch-prop-start-x')).toHaveValue('0');
  await expect(page.getByTestId('arch-grip-start')).toBeVisible();
  await expect(page.getByTestId('arch-grip-end')).toBeVisible();

  // Arrasta o início para (−1, 0): prévia em fantasma, um passo, hospedagens no lugar.
  await page.mouse.move(...(await planPoint(page, 0, 0)));
  await page.mouse.down();
  await page.mouse.move(...(await planPoint(page, -0.5, 0.02)), { steps: 4 });
  await page.mouse.move(...(await planPoint(page, -1, 0.02)), { steps: 4 });
  await expect(page.getByTestId('arch-grip-preview')).toBeVisible();
  await expect(page.getByTestId('arch-grip-length')).toHaveText('7 m');
  // Antes de soltar, o modelo não mudou.
  await expect(page.getByTestId('arch-prop-start-x')).toHaveValue('0');
  await page.mouse.up();
  await expect(status).toContainText('portas e janelas hospedadas ficaram no lugar');
  await expect(page.getByTestId('arch-prop-start-x')).toHaveValue('-1');
  await expect(page.getByTestId('arch-prop-start-y')).toHaveValue('0');
  // A porta continua em x = 1,20: a distância ao início passou de 1,20 para 2,20.
  await page.locator('[data-testid="arch-item"][data-arch-kind="door"]').first().click();
  await expect(page.getByTestId('arch-prop-position')).toHaveValue('2,2');
  await page.getByTestId('action-undo').click();
  await expect(page.getByTestId('arch-prop-position')).toHaveValue('1,2');

  // Encurtar a parede além da porta é recusado por inteiro.
  await page.mouse.click(...(await planPoint(page, 5, 0)));
  await expect(page.getByTestId('properties-title')).toHaveText('Parede 1');
  await page.mouse.move(...(await planPoint(page, 0, 0)));
  await page.mouse.down();
  await page.mouse.move(...(await planPoint(page, 0.8, 0)), { steps: 4 });
  await page.mouse.move(...(await planPoint(page, 1.5, 0)), { steps: 4 });
  await expect(page.getByTestId('arch-edit-refusal')).toBeVisible();
  await page.mouse.up();
  await expect(status).toHaveAttribute('data-level', 'error');
  await expect(page.getByTestId('arch-prop-start-x')).toHaveValue('0');

  // Copiar por pontos: ponto-base, prévia em fantasma e destino; a parede leva os vãos.
  await page.getByTestId('arch-copy').click();
  await expect(page.getByTestId('plan-view')).toHaveAttribute('data-arch-mode', 'transform');
  await expect(page.getByTestId('arch-mode-panel')).toBeVisible();
  await page.mouse.click(...(await planPoint(page, 0, 0)));
  await page.mouse.move(...(await planPoint(page, 0, -3)));
  await expect(page.getByTestId('arch-ghost')).toHaveCount(3);
  await expect(page.getByTestId('arch-transform-label')).toHaveText('3 m');
  await expect(drawn).toHaveCount(14);
  await page.mouse.click(...(await planPoint(page, 0, -3)));
  await expect(status).toContainText('3 elementos copiados');
  await expect(drawn).toHaveCount(17);

  // Mover cancelado com Esc: ponto-base indicado, prévia à mostra, nada gravado.
  await page.getByTestId('arch-move').click();
  await page.mouse.click(...(await planPoint(page, 0, -3)));
  await page.mouse.move(...(await planPoint(page, 2, -5)));
  await expect(page.getByTestId('arch-ghost').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('plan-view')).toHaveAttribute('data-arch-mode', '');
  await page.getByTestId('action-undo').click();
  // O único passo a desfazer era a cópia: o mover cancelado não entrou no histórico.
  await expect(drawn).toHaveCount(14);

  expect(errors).toEqual([]);
});

test('telhados: duas águas e uma água, parâmetros, contorno, quantitativos e persistência', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openDemo(page);
  const status = page.getByTestId('status-message');
  const roofs = page.locator('[data-testid="arch-plan-element"][data-arch-kind="roof"]');
  const projected = page.getByTestId('arch-prop-roof-projected-area');
  const sloped = page.getByTestId('arch-prop-roof-slope-area');

  // Duas águas (o tipo da demonstração): lado do beiral, depois a largura.
  await page.getByTestId('arch-roof').click();
  await expect(page.getByTestId('plan-view')).toHaveAttribute('data-arch-tool', 'roof');
  await expect(page.getByTestId('arch-option-roof-slope-percent')).toHaveValue('30');
  await expect(page.getByTestId('arch-option-roof-note')).toContainText('face inferior');
  await page.mouse.click(...(await planPoint(page, 8, 0)));
  await page.mouse.click(...(await planPoint(page, 14, 0)));
  await page.mouse.move(...(await planPoint(page, 13, 4)));
  await expect(page.getByTestId('arch-roof-draft')).toBeVisible();
  await expect(page.getByTestId('arch-draft-width')).toContainText('4 m');
  await page.mouse.click(...(await planPoint(page, 13, 4)));
  await expect(status).toContainText('Telhado criado');
  await expect(roofs).toHaveCount(1);
  await expect(page.getByTestId('arch-roof-ridge')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // Propriedades: tipologia, inclinação em % e em graus, áreas inclinada e projetada.
  await expect(page.getByTestId('properties-type')).toHaveText('Telhado');
  await expect(page.getByTestId('arch-prop-roof-shape')).toHaveText('Duas águas');
  await expect(page.getByTestId('arch-ifc-entity')).toHaveText('IfcRoof');
  await expect(projected).toHaveText('35 m²');
  await expect(sloped).toHaveText('36,54 m²');
  const percent = page.getByTestId('arch-prop-roof-slope-percent');
  const degrees = page.getByTestId('arch-prop-roof-slope-degrees');
  await percent.fill('100');
  await percent.press('Enter');
  await expect(degrees).toHaveValue('45');
  await expect(projected).toHaveText('35 m²');
  await expect(sloped).toHaveText('49,5 m²');
  await degrees.fill('30');
  await degrees.press('Enter');
  await expect(percent).toHaveValue('57,735');
  await expect(sloped).toHaveText('40,41 m²');
  // Inclinação inválida: recusada, com o motivo, sem alterar o valor.
  await percent.fill('0');
  await percent.press('Enter');
  await expect(status).toHaveAttribute('data-level', 'error');
  await expect(percent).toHaveValue('57,735');
  const overhang = page.getByTestId('arch-prop-roof-overhang');
  await overhang.fill('1');
  await overhang.press('Enter');
  await expect(projected).toHaveText('48 m²');
  // Girar a cumeeira não muda as áreas, só a direção das águas.
  await page.getByTestId('arch-prop-roof-turn').click();
  await expect(page.getByTestId('arch-prop-roof-eave')).toHaveValue('1');
  await expect(projected).toHaveText('48 m²');

  // Editar contorno: arrastar o canto, Cancelar não grava; Concluir grava em um passo.
  await page.getByTestId('arch-prop-edit-contour').click();
  await expect(page.getByTestId('arch-contour-bar')).toBeVisible();
  await expect(page.getByTestId('arch-contour-vertex')).toHaveCount(4);
  const dragCorner = async (): Promise<void> => {
    await page.mouse.move(...(await planPoint(page, 14, 4)));
    await page.mouse.down();
    await page.mouse.move(...(await planPoint(page, 15, 4.5)), { steps: 4 });
    await page.mouse.move(...(await planPoint(page, 16, 5)), { steps: 4 });
    await page.mouse.up();
  };
  await dragCorner();
  await expect(page.getByTestId('arch-contour')).toHaveAttribute('data-valid', 'true');
  await page.getByTestId('arch-contour-cancel').click();
  await expect(status).toContainText('cancelada');
  await expect(projected).toHaveText('48 m²');
  await page.getByTestId('arch-prop-edit-contour').click();
  await dragCorner();
  await page.getByTestId('arch-contour-finish').click();
  await expect(status).toContainText('Contorno de');
  // Contorno de 8 × 5 m com beiral de 1 m: 10 × 7 m em projeção.
  await expect(projected).toHaveText('70 m²');
  await page.getByTestId('action-undo').click();
  await expect(projected).toHaveText('48 m²');
  await page.getByTestId('action-redo').click();
  await expect(projected).toHaveText('70 m²');

  // Uma água: tipo novo pelo catálogo (família genérica identificada), usado na ferramenta.
  await page.getByTestId('arch-catalog').click();
  await page.getByTestId('arch-catalog-filter-roof').click();
  await page
    .locator('[data-testid="arch-family-item"]', { hasText: 'Telhado de uma água' })
    .click();
  await expect(page.getByTestId('arch-family-generic')).toBeVisible();
  await expect(page.getByTestId('arch-family-ifc')).toContainText('SHED_ROOF');
  await page.getByTestId('arch-create-type').click();
  await page.getByTestId('arch-type-use').click();
  await expect(page.getByTestId('plan-view')).toHaveAttribute('data-arch-tool', 'roof');
  await page.mouse.click(...(await planPoint(page, 8, 7)));
  await page.mouse.click(...(await planPoint(page, 14, 7)));
  await page.mouse.click(...(await planPoint(page, 14, 9)));
  await expect(status).toContainText('Telhado criado');
  await page.keyboard.press('Escape');
  await expect(roofs).toHaveCount(2);
  await expect(page.getByTestId('arch-prop-roof-shape')).toHaveText('Uma água');
  // Só o de duas águas tem cumeeira.
  await expect(page.getByTestId('arch-roof-ridge')).toHaveCount(1);

  // Quantitativo: área inclinada e projeção horizontal em colunas separadas.
  await page.getByTestId('arch-quantities').click();
  const dialog = page.getByTestId('arch-quantities-dialog');
  const roofRows = dialog.getByTestId('arch-quantities-row').filter({ hasText: 'Telhados' });
  await expect(roofRows).toHaveCount(3);
  await expect(
    dialog.getByRole('columnheader', { name: 'Projeção horizontal (m²)' }),
  ).toBeVisible();
  await dialog.getByTestId('arch-quantities-close').click();

  // Modelo 3D: os telhados têm malha (sem erros de console).
  await page.getByTestId('view-mode-3d').click();
  await expect(page.getByTestId('viewport-canvas')).toBeVisible();
  await page.getByTestId('view-mode-plan').click();

  // Salvar e reabrir: mesmos identificadores e parâmetros.
  const roofItems = page.locator('[data-testid="arch-item"][data-arch-kind="roof"]');
  const ids = await roofItems.evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-arch-id')).sort(),
  );
  expect(ids).toHaveLength(3);
  await page.getByTestId('action-save').click();
  await expect(status).toContainText('salvo no navegador');
  await page.reload();
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  expect(
    await roofItems.evaluateAll((items) =>
      items.map((item) => item.getAttribute('data-arch-id')).sort(),
    ),
  ).toEqual(ids);
  await roofItems.nth(1).click();
  await expect(page.getByTestId('properties-type')).toHaveText('Telhado');

  expect(errors).toEqual([]);
});

test('paredes: aparar para canto, alinhar levando o canto e dividir, com prévia e desfazer', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openDemo(page);
  const plan = page.getByTestId('plan-view');
  const status = page.getByTestId('status-message');
  const drawn = page.getByTestId('arch-plan-element');
  const modify = page.getByTestId('arch-modify');
  await expect(drawn).toHaveCount(14);

  // Três paredes soltas, fora da edificação: referência (x = 8), vertical (x = 9) e horizontal
  // (y = 3), estas duas afastadas uma da outra como em um canto por fechar.
  await page.getByTestId('arch-wall').click();
  // O início é o ponto clicado; o trecho é digitado (@ΔX;ΔY), para a direção ser exata.
  for (const [x, y, entry] of [
    [8, -2, '@0;1'],
    [9, 0, '@0;2.5'],
    [10, 3, '@2;0'],
  ] as const) {
    await page.mouse.click(...(await planPoint(page, x, y)));
    await expect(page.getByTestId('arch-draft')).toHaveAttribute('data-points', '1');
    await page.keyboard.type(entry);
    await page.keyboard.press('Enter');
    // O traçado continua em rascunho; o botão direito oferece "Criar a parede".
    await expect(page.getByTestId('arch-draft')).toHaveAttribute('data-points', '2');
    await page.mouse.click(...(await planPoint(page, x + 0.5, y + 0.5)), { button: 'right' });
    await expect(page.getByTestId('arch-draft-menu')).toBeVisible();
    await expect(page.getByTestId('arch-draft-create')).toContainText('Criar a parede');
    await page.getByTestId('arch-draft-create').click();
    await expect(page.getByTestId('arch-draft-menu')).toHaveCount(0);
    await expect(status).toContainText('1 parede criada');
    // A ferramenta continua ativa, sem rascunho pendente, para a parede seguinte.
    await expect(plan).toHaveAttribute('data-arch-tool', 'wall');
    await page.mouse.move(...(await planPoint(page, x + 0.5, y + 0.5)));
    await expect(page.getByTestId('arch-draft')).toHaveAttribute('data-points', '0');
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(plan).toHaveAttribute('data-arch-tool', '');
  await expect(drawn).toHaveCount(17);

  // Com um ponto só, "Criar a parede" fica desabilitado, com o motivo; Esc fecha só o menu.
  await page.getByTestId('arch-wall').click();
  await page.mouse.click(...(await planPoint(page, 8, -4)));
  await expect(page.getByTestId('arch-draft')).toHaveAttribute('data-points', '1');
  await page.mouse.click(...(await planPoint(page, 9, -3.5)), { button: 'right' });
  await expect(page.getByTestId('arch-draft-create')).toBeDisabled();
  await expect(page.getByTestId('arch-draft-create-hint')).toContainText('Faltam pontos');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('arch-draft-menu')).toHaveCount(0);
  await expect(page.getByTestId('arch-draft')).toHaveAttribute('data-points', '1');
  // O duplo clique no último ponto também conclui, sem criar um trecho a mais.
  await page.mouse.dblclick(...(await planPoint(page, 10, -4)));
  await expect(status).toContainText('1 parede criada');
  await expect(drawn).toHaveCount(18);
  await expect(page.getByTestId('arch-draft')).toHaveAttribute('data-points', '0');
  await page.keyboard.press('Escape');
  await expect(plan).toHaveAttribute('data-arch-tool', '');
  await page.getByTestId('action-undo').click();
  await expect(drawn).toHaveCount(17);
  const lastWalls = async (count: number): Promise<SavedWall[]> =>
    (await savedElements(page)).filter((element) => element.kind === 'wall').slice(-count);
  const [reference, vertical0, horizontal0] = await lastWalls(3);
  if (!reference || !vertical0 || !horizontal0) throw new Error('Paredes não gravadas.');

  // Aparar/estender para canto: dois cliques, com a prévia do resultado antes do segundo.
  await page.getByTestId('arch-trim-corner').click();
  await expect(plan).toHaveAttribute('data-arch-mode', 'modify');
  await expect(page.getByTestId('arch-mode-panel')).toBeVisible();
  await expect(page.getByTestId('arch-modify-steps').locator('li')).toHaveCount(2);
  await page.mouse.move(...(await planPoint(page, 9, 1)));
  await expect(page.getByTestId('arch-modify-pick')).toHaveCount(1);
  await page.mouse.click(...(await planPoint(page, 9, 1)));
  await expect(modify).toHaveAttribute('data-picks', '1');
  await page.mouse.move(...(await planPoint(page, 11, 3)));
  await expect(modify).toHaveAttribute('data-valid', 'true');
  await expect(page.getByTestId('arch-ghost')).toHaveCount(2);
  await page.mouse.click(...(await planPoint(page, 11, 3)));
  await expect(status).toContainText('levadas ao canto');
  // A ferramenta continua ativa, sem cliques pendentes.
  await expect(modify).toHaveAttribute('data-picks', '0');

  const [vertical, horizontal] = await lastWalls(2);
  if (!vertical || !horizontal) throw new Error('Paredes não gravadas.');
  // O canto é o cruzamento das duas linhas de referência; as outras extremidades ficaram.
  expect(vertical.start).toEqual(vertical0.start);
  expect(vertical.end.x).toBeCloseTo(vertical0.start.x, 9);
  expect(vertical.end.y).toBeCloseTo(horizontal0.start.y, 9);
  expect(horizontal.start).toEqual(vertical.end);
  expect(horizontal.end).toEqual(horizontal0.end);

  // Paralelas: a prévia mostra a recusa junto ao cursor e o clique não grava.
  await page.mouse.click(...(await planPoint(page, 9, 1)));
  await page.mouse.move(...(await planPoint(page, 8, -1.5)));
  await expect(modify).toHaveAttribute('data-valid', 'false');
  await expect(page.getByTestId('arch-edit-refusal')).toContainText('paralelas');
  await page.mouse.click(...(await planPoint(page, 8, -1.5)));
  await expect(status).toHaveAttribute('data-level', 'error');

  // Alinhar: o eixo da parede de referência e o eixo da vertical — o canto vai junto.
  await page.getByTestId('arch-align').click();
  await expect(modify).toHaveAttribute('data-kind', 'align');
  await page.mouse.click(...(await planPoint(page, 8, -1.5)));
  await expect(modify).toHaveAttribute('data-picks', '1');
  await page.mouse.move(...(await planPoint(page, 9, 1.5)));
  await expect(page.getByTestId('arch-ghost')).toHaveCount(2);
  await page.mouse.click(...(await planPoint(page, 9, 1.5)));
  await expect(status).toContainText('alinhada');

  // Dividir: um clique sobre a parede horizontal.
  await page.getByTestId('arch-split').click();
  await expect(modify).toHaveAttribute('data-kind', 'split');
  await page.mouse.click(...(await planPoint(page, 10, 3)));
  await expect(status).toContainText('dividida em duas paredes');
  await expect(drawn).toHaveCount(18);
  await page.keyboard.press('Escape');
  await expect(plan).toHaveAttribute('data-arch-mode', '');

  const [moved, head, tail] = await lastWalls(3);
  if (!moved || !head || !tail) throw new Error('Paredes não gravadas.');
  // A vertical foi para a linha da referência e o canto acompanhou o alinhamento.
  expect(moved.start.x).toBeCloseTo(reference.start.x, 9);
  expect(moved.end.x).toBeCloseTo(reference.start.x, 9);
  expect(moved.end.y).toBeCloseTo(horizontal0.start.y, 9);
  expect(head.start).toEqual(moved.end);
  // A divisão ficou sobre a linha da parede: os dois trechos se tocam e o fim não mudou.
  expect(head.end.y).toBeCloseTo(horizontal0.start.y, 9);
  expect(tail.start).toEqual(head.end);
  expect(tail.end).toEqual(horizontal0.end);

  // Cada operação foi um passo: três desfazer devolvem as paredes como foram desenhadas.
  for (let i = 0; i < 3; i += 1) await page.getByTestId('action-undo').click();
  await expect(drawn).toHaveCount(17);
  expect(await lastWalls(3)).toEqual([reference, vertical0, horizontal0]);

  expect(errors).toEqual([]);
});
