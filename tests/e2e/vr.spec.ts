import { expect, test, type Page } from '@playwright/test';
import { installFakeXr, type FakeXrHandle } from './fakeXr';
import { ctl, openTask } from './ui';

/**
 * Realidade virtual (WebXR) no navegador real. Dois grupos:
 *
 * - navegador sem suporte: o comando informa a incompatibilidade e o editor segue normal;
 * - sessão com um dispositivo SIMULADO (`fakeXr.ts`): entrada, laço de quadros, controles,
 *   teletransporte, seleção, menu e saída.
 *
 * Nenhum destes testes roda em um headset: a validação física no Meta Quest 2 é manual e está
 * descrita em `docs/WEBXR.md`.
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function openEditor(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
}

const view = (page: Page) => page.getByTestId('vr-view');

async function reading(page: Page): Promise<{ x: number; y: number; z: number }> {
  const [x, y, z] = await Promise.all(
    ['x', 'y', 'z'].map((axis) => view(page).getAttribute(`data-${axis}`)),
  );
  return { x: Number(x), y: Number(y), z: Number(z) };
}

/** Altera o dispositivo simulado dentro da página. */
async function device(page: Page, change: (xr: FakeXrHandle) => void): Promise<void> {
  await page.evaluate((source) => {
    const xr = (window as unknown as { __fakeXr: FakeXrHandle }).__fakeXr;
    // A função viaja como texto: é reconstruída e aplicada ao dispositivo da página.
    (new Function(`return (${source})`)() as (xr: FakeXrHandle) => void)(xr);
  }, change.toString());
}

test('sem dispositivo de VR: informa a incompatibilidade e o editor continua normal', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'xr', {
      configurable: true,
      value: { isSessionSupported: () => Promise.resolve(false) },
    });
  });
  await openEditor(page);
  const count = await page.getByTestId('element-count').textContent();

  await openTask(page, 'view');
  await expect(page.getByTestId('view-vr')).toBeEnabled();
  await page.getByTestId('view-vr').click();

  await expect(view(page)).toBeVisible();
  await expect(view(page)).toHaveAttribute('data-support', 'unsupported');
  await expect(view(page)).toHaveAttribute('data-phase', 'idle');
  await expect(page.getByTestId('vr-message')).toContainText('Nenhum dispositivo');
  await expect(page.getByTestId('vr-enter')).toBeDisabled();
  // A cena é preparada mesmo assim: a prévia do ponto de partida aparece no monitor.
  await expect(page.getByTestId('vr-canvas')).toBeVisible();
  await expect(page.getByTestId('vr-stats')).toHaveAttribute('data-elements', /^[1-9]\d*$/);
  // O quadro de ajuda sobre a prévia pode ser ocultado e mostrado de novo.
  await page.getByTestId('vr-help-close').click();
  await expect(page.getByTestId('vr-help')).toHaveCount(0);
  await page.getByTestId('vr-help-toggle').click();
  await expect(page.getByTestId('vr-help')).toBeVisible();
  // Um só renderizador: o Modelo 3D convencional fica desmontado enquanto a vista está aberta.
  await expect(page.getByTestId('viewport-canvas')).toHaveCount(0);

  await page.getByTestId('vr-close').click();
  await expect(view(page)).toHaveCount(0);
  await expect(page.getByTestId('viewport-canvas')).toBeVisible();
  await expect(page.getByTestId('element-count')).toHaveText(count ?? '');
  // A modelagem segue disponível.
  await expect(await ctl(page, 'tool-pipe')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('navegador sem WebXR: mensagem clara, sem erro', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'xr', { configurable: true, value: undefined });
  });
  await openEditor(page);
  await openTask(page, 'view');
  await page.getByTestId('view-vr').click();
  await expect(page.getByTestId('vr-message')).toContainText('WebXR');
  await expect(page.getByTestId('vr-enter')).toBeDisabled();
  await page.getByTestId('vr-close').click();
  await expect(page.getByTestId('viewport-canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('sessão simulada: entrar, teletransportar, girar, selecionar, abrir o menu e sair', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.addInitScript(installFakeXr);
  await openEditor(page);
  const count = await page.getByTestId('element-count').textContent();

  // O clique no comando já pede a sessão (um gesto do usuário).
  await openTask(page, 'view');
  await page.getByTestId('view-vr').click();
  await expect(view(page)).toHaveAttribute('data-phase', 'presenting');
  await expect(page.getByTestId('vr-status')).toContainText('Sessão imersiva em andamento');
  await expect(page.getByTestId('vr-end-session')).toBeVisible();

  // O laço de quadros é o da sessão.
  const framesBefore = await page.evaluate(
    () => (window as unknown as { __fakeXr: FakeXrHandle }).__fakeXr.frames,
  );
  await page.waitForTimeout(500);
  const framesAfter = await page.evaluate(
    () => (window as unknown as { __fakeXr: FakeXrHandle }).__fakeXr.frames,
  );
  expect(framesAfter).toBeGreaterThan(framesBefore + 3);
  await expect(view(page)).toHaveAttribute('data-x', /\d/);
  const start = await reading(page);

  // Teletransporte: direcional para a frente mira (o usuário não sai do lugar); soltar confirma.
  await device(page, (xr) => {
    const hand = xr.hands[1];
    if (!hand) return;
    hand.pitch = -0.15;
    hand.axes = [0, 0, 0, -1];
  });
  await expect(view(page)).toHaveAttribute('data-aim', 'valid');
  const aiming = await reading(page);
  expect(Math.hypot(aiming.x - start.x, aiming.y - start.y)).toBeLessThan(0.01);
  await device(page, (xr) => {
    const hand = xr.hands[1];
    if (hand) hand.axes = [0, 0, 0, 0];
  });
  await page.waitForTimeout(500);
  const moved = await reading(page);
  // O usuário parte olhando para o norte: o destino fica adiante, em +Y, na mesma cota.
  expect(moved.y).toBeGreaterThan(start.y + 1);
  expect(Math.abs(moved.x - start.x)).toBeLessThan(0.5);
  expect(moved.z).toBeCloseTo(start.z, 2);

  // Giro por etapas (direcional direito): não tira o usuário do lugar.
  await device(page, (xr) => {
    const hand = xr.hands[1];
    if (hand) hand.axes = [0, 0, 1, 0];
  });
  await page.waitForTimeout(300);
  await device(page, (xr) => {
    const hand = xr.hands[1];
    if (hand) hand.axes = [0, 0, 0, 0];
  });
  await page.waitForTimeout(400);
  const turned = await reading(page);
  expect(Math.hypot(turned.x - moved.x, turned.y - moved.y)).toBeLessThan(0.01);
  // Volta a olhar para o norte (11 giros de 30° completam a volta).
  for (let i = 0; i < 11; i += 1) {
    await device(page, (xr) => {
      const hand = xr.hands[1];
      if (hand) hand.axes = [0, 0, 1, 0];
    });
    await page.waitForTimeout(80);
    await device(page, (xr) => {
      const hand = xr.hands[1];
      if (hand) hand.axes = [0, 0, 0, 0];
    });
    await page.waitForTimeout(80);
  }

  // Seleção: varre o raio do controle até apontar para um elemento e aperta o gatilho.
  let selected = '';
  let hovered = '';
  search: for (const pitch of [0, 0.1, -0.1, 0.2, 0.3, -0.2, 0.45, 0.6]) {
    for (const yaw of [0, 0.15, -0.15, 0.3, -0.3, 0.5, -0.5, 0.8, -0.8]) {
      await page.evaluate(
        ([p, y]) => {
          const xr = (window as unknown as { __fakeXr: FakeXrHandle }).__fakeXr;
          const hand = xr.hands[1];
          if (!hand) return;
          hand.pitch = p ?? 0;
          hand.yaw = y ?? 0;
        },
        [pitch, yaw],
      );
      await page.waitForTimeout(120);
      hovered = (await view(page).getAttribute('data-hovered')) ?? '';
      if (!hovered) continue;
      await device(page, (xr) => xr.press(1));
      await page.waitForTimeout(120);
      selected = (await view(page).getAttribute('data-selected')) ?? '';
      if (selected) break search;
    }
  }
  // Mirar já identifica o elemento (rótulo com o nome); o gatilho abre as propriedades dele.
  expect(hovered).not.toBe('');
  expect(selected).toBe(hovered);
  await expect(view(page)).toHaveAttribute('data-hovered', '');

  // Caminhada contínua: o direcional esquerdo anda na direção do olhar (norte), sem saltos.
  const beforeWalk = await reading(page);
  await device(page, (xr) => {
    const hand = xr.hands[0];
    if (hand) hand.axes = [0, 0, 0, -1];
  });
  await page.waitForTimeout(700);
  const walking = await reading(page);
  await device(page, (xr) => {
    const hand = xr.hands[0];
    if (hand) hand.axes = [0, 0, 0, 0];
  });
  await page.waitForTimeout(400);
  const walked = await reading(page);
  expect(walking.y).toBeGreaterThan(beforeWalk.y + 0.2);
  expect(walked.y).toBeGreaterThan(walking.y - 0.01);
  // A 2 m/s, menos de dois segundos de direcional não passam de 4 m.
  expect(walked.y - beforeWalk.y).toBeLessThan(4);
  expect(Math.abs(walked.x - beforeWalk.x)).toBeLessThan(0.05);
  expect(walked.z).toBeCloseTo(beforeWalk.z, 2);
  // Para o lado: o direcional esquerdo desloca para leste, sem girar.
  await device(page, (xr) => {
    const hand = xr.hands[0];
    if (hand) hand.axes = [0, 0, 1, 0];
  });
  await page.waitForTimeout(500);
  await device(page, (xr) => {
    const hand = xr.hands[0];
    if (hand) hand.axes = [0, 0, 0, 0];
  });
  await page.waitForTimeout(400);
  const strafed = await reading(page);
  expect(strafed.x).toBeGreaterThan(walked.x + 0.2);
  expect(Math.abs(strafed.y - walked.y)).toBeLessThan(0.05);

  // Menu: botão de face do controle esquerdo.
  await device(page, (xr) => {
    const hand = xr.hands[0];
    if (hand) hand.buttons[4] = true;
  });
  await page.waitForTimeout(150);
  await device(page, (xr) => {
    const hand = xr.hands[0];
    if (hand) hand.buttons[4] = false;
  });
  await expect(view(page)).toHaveAttribute('data-menu', 'open');

  // Saída pelo dispositivo (botão do sistema): a vista volta à prévia, sem travar.
  await device(page, (xr) => xr.end());
  await expect(view(page)).toHaveAttribute('data-phase', 'idle');
  await expect(page.getByTestId('vr-enter')).toBeEnabled();
  await expect(view(page)).toHaveAttribute('data-menu', 'closed');

  // Nova sessão pelo botão da vista e saída pelo botão "Encerrar a sessão".
  await page.getByTestId('vr-enter').click();
  await expect(view(page)).toHaveAttribute('data-phase', 'presenting');
  expect(
    await page.evaluate(() => (window as unknown as { __fakeXr: FakeXrHandle }).__fakeXr.sessions),
  ).toBe(2);
  await page.getByTestId('vr-end-session').click();
  await expect(view(page)).toHaveAttribute('data-phase', 'idle');

  // De volta ao editor: o viewport convencional reabre e o elemento consultado é o do modelo.
  await page.getByTestId('vr-close').click();
  await expect(page.getByTestId('viewport-canvas')).toBeVisible();
  await expect(await ctl(page, 'element-properties')).toBeVisible();
  // Nada foi alterado no projeto: sem seleção, o painel volta a mostrar a mesma contagem.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('element-count')).toHaveText(count ?? '');
  expect(errors).toEqual([]);
});

test('dispositivo sem piso rastreado: a sessão abre com o piso estimado', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(installFakeXr, { floor: false });
  await openEditor(page);
  await openTask(page, 'view');
  await page.getByTestId('view-vr').click();
  await expect(view(page)).toHaveAttribute('data-phase', 'presenting');
  await expect(page.getByTestId('vr-status')).toContainText('piso estimado');
  await page.getByTestId('vr-close').click();
  await expect(page.getByTestId('viewport-canvas')).toBeVisible();
  expect(errors).toEqual([]);
});
