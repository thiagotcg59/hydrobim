import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { ctl } from './ui';

/**
 * Tela compacta e toque, na tela interna de um dobrável aberto (Galaxy Z Fold 7, ≈ 884 px de
 * largura em CSS): faixa em uma linha, painéis flutuantes, nada saindo da tela, e na planta
 * toque, arrasto, pinça e toque longo com eventos de toque reais (protocolo do Chrome).
 */

test.use({
  viewport: { width: 884, height: 980 },
  deviceScaleFactor: 2.2,
  isMobile: true,
  hasTouch: true,
});

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

type Touch = { x: number; y: number; id: number };

async function touch(
  cdp: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  points: Touch[],
): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p) => ({
      x: p.x,
      y: p.y,
      id: p.id,
      radiusX: 4,
      radiusY: 4,
      force: 1,
    })),
  });
}

async function tap(cdp: CDPSession, x: number, y: number): Promise<void> {
  await touch(cdp, 'touchStart', [{ x, y, id: 1 }]);
  await touch(cdp, 'touchEnd', []);
}

test('dobrável aberto: faixa em uma linha, painéis flutuantes e nada fora da tela', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto('/');
  const app = page.locator('[data-testid="app"][data-ready="true"]');
  await expect(app).toBeVisible();
  await expect(app).toHaveAttribute('data-compact', 'true');

  // A área de desenho começa com toda a largura: painéis recolhidos, uma vista por vez.
  await expect(page.getByTestId('dock-nav')).toHaveAttribute('data-open', 'false');
  await expect(page.getByTestId('dock-panel')).toHaveAttribute('data-open', 'false');
  const workspace = await page.locator('.workspace').boundingBox();
  expect(workspace?.width).toBeGreaterThan(884 - 2 * 28 - 4);

  // Faixa: uma linha só, rolável; a página não rola na horizontal.
  const body = page.getByTestId('ribbon-body');
  const bodyBox = await body.boundingBox();
  expect(bodyBox?.height).toBeLessThanOrEqual(56);
  expect(await body.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - window.innerWidth,
    topbar: (() => {
      const bar = document.querySelector('.topbar');
      return bar ? bar.scrollWidth - bar.clientWidth : 0;
    })(),
  }));
  expect(overflow).toEqual({ page: 0, topbar: 0 });
  // Alvos de toque: comandos com pelo menos 40 px de altura.
  const pipe = await (await ctl(page, 'tool-pipe')).boundingBox();
  expect(pipe?.height).toBeGreaterThanOrEqual(40);

  // A lista de um botão com seta abre inteira na tela, mesmo com a faixa rolável.
  await page.getByTestId('ribbon-menu-fittings').click();
  const list = page.getByTestId('ribbon-menu-fittings-list');
  await expect(list).toBeVisible();
  const listBox = await list.boundingBox();
  expect(listBox && listBox.x >= 0 && listBox.x + listBox.width <= 884).toBe(true);
  expect(listBox && listBox.y >= (bodyBox?.y ?? 0) + (bodyBox?.height ?? 0)).toBe(true);
  await page.keyboard.press('Escape');

  // Navegador e propriedades flutuam sobre a área de desenho, um por vez.
  await page.getByTestId('dock-nav-toggle').click();
  const nav = page.getByTestId('dock-nav');
  await expect(nav).toHaveAttribute('data-overlay', 'true');
  const navBox = await nav.boundingBox();
  expect(navBox?.width).toBeLessThan(884 - 56);
  expect((await page.locator('.workspace').boundingBox())?.width).toBeGreaterThan(884 - 60);
  await page.getByTestId('dock-panel-toggle').click();
  await expect(page.getByTestId('dock-panel')).toHaveAttribute('data-open', 'true');
  await expect(nav).toHaveAttribute('data-open', 'false');
  await page.getByTestId('dock-panel-toggle').click();
  await expect(page.getByTestId('dock-panel')).toHaveAttribute('data-open', 'false');

  expect(errors).toEqual([]);
});

test('planta ao toque: tocar desenha, um dedo desloca, pinça amplia e toque longo abre o menu', async ({
  page,
}) => {
  const errors = trackErrors(page);
  const cdp = await page.context().newCDPSession(page);
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await (await ctl(page, 'action-new')).click();
  await page.getByTestId('view-mode-plan').click();
  const plan = page.getByTestId('plan-view');
  const svg = page.getByTestId('plan-svg');
  const pipes = svg.locator('[data-element-kind="pipe"]');
  await expect(pipes).toHaveCount(0);
  const box = await svg.boundingBox();
  if (!box) throw new Error('Planta sem dimensões.');
  const mpp = async (): Promise<number> => Number(await plan.getAttribute('data-mpp'));
  const center = async (): Promise<[number, number]> =>
    ((await plan.getAttribute('data-center')) ?? '0;0').split(';').map(Number) as [number, number];
  const at = async (x: number, y: number): Promise<[number, number]> => {
    const [cx, cy] = await center();
    const m = await mpp();
    return [box.x + box.width / 2 + (x - cx) / m, box.y + box.height / 2 - (y - cy) / m];
  };

  // Dois toques com a ferramenta Tubo: um tubo de 2 m.
  await (await ctl(page, 'tool-pipe')).click();
  await tap(cdp, ...(await at(-1, 1)));
  await tap(cdp, ...(await at(1, 1)));
  await expect(page.getByTestId('status-message')).toHaveText('Tubo criado.');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(pipes).toHaveCount(1);

  // Um dedo, em Selecionar, desloca a vista (não abre janela de seleção).
  const [cx0] = await center();
  const [sx, sy] = await at(0, -2);
  await touch(cdp, 'touchStart', [{ x: sx, y: sy, id: 1 }]);
  for (let i = 1; i <= 5; i += 1) await touch(cdp, 'touchMove', [{ x: sx + i * 20, y: sy, id: 1 }]);
  await touch(cdp, 'touchEnd', []);
  const scale = await mpp();
  expect((await center())[0]).toBeCloseTo(cx0 - 100 * scale, 6);
  await expect(pipes).toHaveCount(1);

  // Pinça: afastar os dedos de 100 para 200 px dobra a ampliação, sem criar nem selecionar.
  const mx = box.x + box.width / 2;
  const my = box.y + box.height / 2 + 120;
  await touch(cdp, 'touchStart', [{ x: mx - 50, y: my, id: 1 }]);
  await touch(cdp, 'touchStart', [
    { x: mx - 50, y: my, id: 1 },
    { x: mx + 50, y: my, id: 2 },
  ]);
  for (let i = 1; i <= 5; i += 1) {
    await touch(cdp, 'touchMove', [
      { x: mx - 50 - i * 10, y: my, id: 1 },
      { x: mx + 50 + i * 10, y: my, id: 2 },
    ]);
  }
  await touch(cdp, 'touchEnd', [{ x: mx + 100, y: my, id: 2 }]);
  await touch(cdp, 'touchEnd', []);
  expect(await mpp()).toBeCloseTo(scale / 2, 6);
  await expect(pipes).toHaveCount(1);
  await expect(page.getByTestId('context-menu')).toHaveCount(0);

  // Toque longo junto à extremidade livre = botão direito: o menu com "Criar tubo".
  const [ex, ey] = await at(1, 1);
  await touch(cdp, 'touchStart', [{ x: ex + 3, y: ey + 3, id: 1 }]);
  await page.waitForTimeout(800);
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await touch(cdp, 'touchEnd', []);
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await expect(page.getByTestId('context-create-pipe')).toBeEnabled();
  await expect(pipes).toHaveCount(1);

  expect(errors).toEqual([]);
});
