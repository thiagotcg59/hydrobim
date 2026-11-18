import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Modelagem pela planta baixa: traçar tubos na elevação do eixo, travar as mudanças de
 * direção nos joelhos de catálogo, criar a prumada alterando a elevação e inserir conexões
 * em porta livre e em linha — com o mesmo resultado de domínio do viewport 3D.
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
  const field = page.getByTestId(testId);
  await field.fill(value);
  await field.press('Enter');
}

interface ExportedElement {
  kind: string;
  angle?: number;
  familyId?: string | null;
  start?: { x: number; y: number; z: number };
  end?: { x: number; y: number; z: number };
  placement?: { position: { x: number; y: number; z: number } };
}

test('planta baixa: terminar o trecho sobre um tubo insere o tê automático', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await page.getByTestId('action-new').click();
  await page.getByTestId('view-mode-plan').click();
  await page.getByTestId('tool-pipe').click();

  const svg = page.getByTestId('plan-svg');
  const box = await svg.boundingBox();
  if (!box) throw new Error('Planta sem dimensões.');
  const at = (x: number, y: number): [number, number] => [
    box.x + box.width / 2 + x * 100,
    box.y + box.height / 2 - y * 100,
  ];
  const drawn = svg.locator('[data-element-id]');

  // Tubo principal e, depois, um trecho que termina sobre ele.
  await page.mouse.click(...at(-1, 1));
  await page.mouse.click(...at(2, 1));
  await expect(drawn).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.mouse.click(...at(0.5, -0.5));
  await expect(page.getByTestId('plan-anchor')).toHaveCount(1);
  // Clique sobre o tubo, fora da perpendicular: o tê vai para o pé da perpendicular.
  await page.mouse.click(...at(0.8, 1));
  await expect(page.getByTestId('status-message')).toContainText('tê automático');
  await expect(svg.locator('[data-element-kind="tee"]')).toHaveCount(1);
  await expect(svg.locator('[data-element-kind="pipe"]')).toHaveCount(3);
  await expect(page.getByTestId('plan-anchor')).toHaveCount(0);
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');

  // Começar sobre o tubo: o tê entra no ponto clicado e o trecho sai na perpendicular.
  await page.mouse.click(...at(1.5, 1));
  await expect(page.getByTestId('plan-anchor')).toHaveCount(1);
  await expect(svg.locator('[data-element-kind="tee"]')).toHaveCount(1);
  await page.mouse.click(...at(1.8, 0.2));
  await expect(page.getByTestId('status-message')).toContainText('derivado');
  await expect(svg.locator('[data-element-kind="tee"]')).toHaveCount(2);
  await expect(svg.locator('[data-element-kind="pipe"]')).toHaveCount(5);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');

  const download = page.waitForEvent('download');
  await page.getByTestId('action-export').click();
  const exported = JSON.parse(await readFile(await (await download).path(), 'utf8')) as {
    elements: ExportedElement[];
    connections: unknown[];
  };
  const tee = exported.elements.find((e) => e.kind === 'tee');
  expect(tee?.placement?.position.x).toBeCloseTo(0.5);
  expect(tee?.placement?.position.y).toBeCloseTo(1);
  const second = exported.elements.filter((e) => e.kind === 'tee')[1];
  expect(second?.placement?.position.x).toBeCloseTo(1.5);
  expect(second?.placement?.position.y).toBeCloseTo(1);
  // Cada tê liga os dois trechos do tubo dividido e o trecho derivado.
  expect(exported.connections).toHaveLength(6);
  expect(errors).toEqual([]);
});

test('planta baixa: traçar, travar ângulos, criar prumada e inserir conexões', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await page.getByTestId('action-new').click();
  await expect(page.getByTestId('element-count')).toHaveText('0');

  // As ferramentas de modelagem permanecem na planta.
  await page.getByTestId('view-mode-plan').click();
  await expect(page.getByTestId('plan-view')).toBeVisible();
  await page.getByTestId('tool-pipe').click();
  await expect(page.getByTestId('plan-view')).toBeVisible();
  await expect(page.getByTestId('view-mode-plan')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('tool-options')).toBeVisible();

  // Planta vazia: origem no centro da vista, 100 px por metro.
  const svg = page.getByTestId('plan-svg');
  const box = await svg.boundingBox();
  if (!box) throw new Error('Planta sem dimensões.');
  const at = (x: number, y: number): [number, number] => [
    box.x + box.width / 2 + x * 100,
    box.y + box.height / 2 - y * 100,
  ];
  // Os pontos usados ficam fora do painel de opções (à esquerda) e da barra (no alto).
  expect(at(-1, 0)[0]).toBeGreaterThan(box.x + 320);
  expect(at(0, 1.7)[1]).toBeGreaterThan(box.y + 70);
  // Elementos desenhados na planta (o contador do painel some quando há seleção).
  const drawn = svg.locator('[data-element-id]');

  // Elevação do eixo: 2,50 m acima do nível.
  await setField(page, 'option-pipe-elevation', '2,5');
  await expect(page.getByTestId('pipe-elevation-info')).toContainText('Z 2,50 m');
  await expect(page.getByTestId('option-catalog-angles')).toContainText('90°');

  await page.mouse.click(...at(-1, 0));
  await expect(page.getByTestId('plan-anchor')).toHaveCount(1);
  await page.mouse.click(...at(1, 0));
  await expect(drawn).toHaveCount(1);

  // Clique fora de esquadro: a prévia e o trecho travam em 90°.
  await page.mouse.move(...at(1.12, 1));
  await expect(page.getByTestId('plan-pipe-preview')).toHaveCount(1);
  await expect(page.getByTestId('plan-pipe-preview-label')).toContainText('90°');
  await page.mouse.click(...at(1.12, 1));
  await expect(drawn).toHaveCount(3);

  // Próximo de 45°: trava no joelho de 45°.
  await page.mouse.move(...at(1.6, 1.65));
  await expect(page.getByTestId('plan-pipe-preview-label')).toContainText('45°');
  await page.mouse.click(...at(1.6, 1.65));
  await expect(drawn).toHaveCount(5);

  // Alterar a elevação durante o traçado cria a prumada (joelho + tubo vertical).
  await setField(page, 'option-pipe-elevation', '3,5');
  await expect(drawn).toHaveCount(7);
  await expect(page.getByTestId('pipe-elevation-info')).toContainText('Z 3,50 m');
  await expect(page.getByTestId('status-message')).toHaveAttribute('data-level', 'success');

  // O traçado continua em planta, na nova elevação.
  await page.mouse.click(...at(2.6, 1.64));
  await expect(drawn).toHaveCount(9);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('plan-anchor')).toHaveCount(0);

  // Primeiro tubo: o horizontal mais baixo na tela.
  const firstPipe = async (): Promise<Locator> => {
    let best: Locator | null = null;
    let bottom = -Infinity;
    for (const pipe of await svg.locator('[data-element-kind="pipe"]').all()) {
      const b = await pipe.boundingBox();
      if (b && b.width > b.height * 3 && b.y > bottom) {
        bottom = b.y;
        best = pipe;
      }
    }
    if (!best) throw new Error('Tubo horizontal não encontrado na planta.');
    return best;
  };

  // Válvula e tê em linha, por clique sobre o tubo.
  await page.getByTestId('tool-valve').click();
  await expect(page.getByTestId('plan-view')).toBeVisible();
  await (await firstPipe()).click();
  await expect(drawn).toHaveCount(11);
  await expect(svg.locator('[data-element-kind="valve"]')).toHaveCount(1);

  await page.getByTestId('tool-tee').click();
  await (await firstPipe()).click();
  await expect(drawn).toHaveCount(13);
  await expect(svg.locator('[data-element-kind="tee"]')).toHaveCount(1);

  // Joelho na extremidade livre inicial; ângulo sem peça de catálogo é recusado.
  await page.getByTestId('tool-elbow').click();
  await setField(page, 'option-elbow-angle', '30');
  await page.mouse.move(...at(-1, 0.02));
  await expect(page.getByTestId('plan-port-info')).toContainText('Z 2,50 m');
  await page.mouse.click(...at(-1, 0.02));
  await expect(page.getByTestId('status-message')).toContainText('Não há joelho de 30°');
  await expect(drawn).toHaveCount(13);
  await page.getByTestId('option-elbow-chip-90').click();
  await page.mouse.click(...at(-1, 0.02));
  await expect(drawn).toHaveCount(14);

  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');

  // O modelo exportado confirma cotas e ângulos.
  const download = page.waitForEvent('download');
  await page.getByTestId('action-export').click();
  const exported = JSON.parse(await readFile(await (await download).path(), 'utf8')) as {
    elements: ExportedElement[];
    connections: unknown[];
  };
  const pipes = exported.elements.filter((e) => e.kind === 'pipe');
  const elbows = exported.elements.filter((e) => e.kind === 'elbow');
  expect(pipes).toHaveLength(7);
  expect(elbows).toHaveLength(5);
  const degrees = elbows.map((e) => Math.round(((e.angle ?? 0) * 180) / Math.PI)).sort();
  expect(degrees).toEqual([45, 90, 90, 90, 90]);
  expect(elbows.every((e) => typeof e.familyId === 'string')).toBe(true);
  // Uma prumada de 2,50 m a 3,50 m; os demais trechos são horizontais.
  const vertical = pipes.filter((p) => Math.abs((p.end?.z ?? 0) - (p.start?.z ?? 0)) > 0.5);
  expect(vertical).toHaveLength(1);
  const levels = pipes
    .filter((p) => !vertical.includes(p))
    .map((p) => [p.start?.z, p.end?.z])
    .flat()
    .map((z) => Math.round((z ?? 0) * 100) / 100);
  expect(new Set(levels)).toEqual(new Set([2.5, 3.5]));
  const valve = exported.elements.find((e) => e.kind === 'valve');
  expect(valve?.placement?.position.z).toBeCloseTo(2.5);
  expect(exported.connections).toHaveLength(13);

  // O modelo 3D mostra o mesmo resultado.
  await page.getByTestId('view-mode-3d').click();
  await expect(page.getByTestId('viewport-canvas')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('element-count')).toHaveText('14');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');

  expect(errors).toEqual([]);
});

test('planta baixa: extremidades sobrepostas, escolha com Tab e trava ao editar joelho', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('[data-testid="app"][data-ready="true"]')).toBeVisible();
  await page.getByTestId('action-new').click();
  await expect(page.getByTestId('element-count')).toHaveText('0');

  // Dois tubos no mesmo traçado em planta, nas cotas 0 e 3 m.
  const addPoint = async (x: string, y: string, z: string): Promise<void> => {
    await setField(page, 'coord-x', x);
    await setField(page, 'coord-y', y);
    await setField(page, 'coord-z', z);
    await page.getByTestId('coord-add').click();
  };
  await page.getByTestId('tool-pipe').click();
  await addPoint('0', '0', '0');
  await addPoint('2', '0', '0');
  await page.keyboard.press('Escape');
  await addPoint('0', '0', '3');
  await addPoint('2', '0', '3');
  await page.keyboard.press('Escape');

  await page.getByTestId('view-mode-plan').click();
  await page.getByTestId('tool-pipe').click();
  await setField(page, 'option-pipe-elevation', '0');
  const svg = page.getByTestId('plan-svg');
  await expect(svg.locator('[data-element-kind="pipe"]')).toHaveCount(2);
  const box = await svg.locator('[data-element-kind="pipe"]').first().boundingBox();
  if (!box) throw new Error('Tubo sem dimensões na planta.');
  const end: [number, number] = [box.x + box.width - 1, box.y + box.height / 2];

  // A captura prefere a cota mais próxima da elevação e informa o empilhamento.
  await page.mouse.move(end[0] - 3, end[1]);
  await page.mouse.move(...end);
  const info = page.getByTestId('plan-port-info');
  await expect(info).toHaveAttribute('data-stacked', '2');
  await expect(info).toContainText('Z 0,00 m');

  // Tab alterna para a extremidade de cima; o trecho parte dela e herda a elevação.
  await page.keyboard.press('Tab');
  await expect(info).toContainText('Z 3,00 m');
  await page.mouse.click(...end);
  await expect(page.getByTestId('plan-anchor')).toHaveCount(1);
  await expect(page.getByTestId('pipe-elevation-info')).toContainText('Z 3,00 m');
  await page.mouse.click(end[0], end[1] - 150);
  await expect(svg.locator('[data-element-kind="elbow"]')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // Editar o ângulo do joelho para um valor sem peça de catálogo é recusado, e o campo
  // volta a mostrar o ângulo vigente.
  await page.getByTestId('tool-select').click();
  await svg.locator('[data-element-kind="elbow"]').click();
  await setField(page, 'prop-angle', '60');
  await expect(page.getByTestId('status-message')).toContainText('Não há joelho de 60°');
  await expect(page.getByTestId('prop-angle')).toHaveValue('90');
  await expect(page.getByTestId('validation-toggle')).toHaveAttribute('data-errors', '0');

  expect(errors).toEqual([]);
});
