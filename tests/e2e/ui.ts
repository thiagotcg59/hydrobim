import type { Locator, Page } from '@playwright/test';

/**
 * Navegação da interface para os testes: cada controle fica em uma aba de tarefa da faixa de
 * comandos, no menu Arquivo ou em uma aba do painel direito. `ctl` abre o lugar certo e devolve
 * o controle — os testes continuam verificando o resultado real de cada ação.
 */

export type Task = 'model' | 'document' | 'view' | 'analysis' | 'bim' | 'export' | 'manage';

const MENU = new Set(['action-new', 'action-open', 'action-export', 'file-save']);

const TASK_RULES: readonly (readonly [RegExp, Task])[] = [
  [/^tool-(dimension|text|leader|tag)$/, 'document'],
  [/^(plan-scale|plan-dimension-mode|infra-scale|doc-.*)$/, 'document'],
  [
    /^(tool-(select|pipe|elbow|tee|reducer|valve|pump|tank|measure|connect)|action-families)$/,
    'model',
  ],
  [/^(modify-|connect-)/, 'model'],
  [
    /^(plan-theme|plan-thin-lines|custom-source-toggle|ribbon-view-.*|view-split|layout-(nav|panel))$/,
    'view',
  ],
  [
    /^infra-(basemap(-visible|-opacity)?|layers|layer-.*|label-(names|lengths|elevations))$/,
    'view',
  ],
  [/^infra-(goto|goto-go|georef)$/, 'view'],
  [
    /^terrain-(color-mode|contours-toggle|contour-interval|contour-smoothing|triangulation-toggle|exaggeration|natural|opacity|visible-plan|visible-3d)$/,
    'view',
  ],
  [/^terrain-cmd-/, 'model'],
  [/^analysis-/, 'analysis'],
  [/^(action-export-.+|plan-export-(svg|dxf)|export-details)$/, 'export'],
  [/^(manage-.*|layout-(ribbon|reset))$/, 'manage'],
];

/** Comandos reunidos em um botão com seta da faixa: a lista é aberta antes de usá-los. */
const RIBBON_MENUS: readonly (readonly [RegExp, string])[] = [
  [/^tool-(elbow|tee|reducer)$/, 'fittings'],
  [/^tool-(pump|tank)$/, 'equipment'],
];

const PANEL_RULES: readonly (readonly [RegExp, 'properties' | 'tool'])[] = [
  [
    /^(prop-|move-|copy-|port-|inline-|section-|close-|junction-|bim-(key|value|add)|size-mode|action-delete|back-to-project|element-properties|multi-properties|properties-)/,
    'properties',
  ],
  [
    /^(coord-|option-|segment-|active-|anchor-info|tool-options|connection-|junction-options|pipe-ends-options|tank-options|coordinate-entry|capture-options|pipe-elevation-info)/,
    'tool',
  ],
];

/** Abre a aba de tarefa da faixa de comandos (não muda a vista nem a ferramenta). */
export async function openTask(page: Page, task: Task): Promise<void> {
  const ribbon = page.getByTestId('ribbon');
  if ((await ribbon.getAttribute('data-task')) !== task) {
    await page.getByTestId(`task-${task}`).click();
  }
}

/** Abre a aba do painel direito, quando ela existe e está disponível. */
export async function openPanelTab(page: Page, tab: 'properties' | 'tool'): Promise<void> {
  const panel = page.getByTestId('right-panel');
  if ((await panel.count()) === 0) return;
  if ((await panel.getAttribute('data-tab')) === tab) return;
  const button = page.getByTestId(`panel-tab-${tab}`);
  if (await button.isEnabled()) await button.click();
}

/** Controle da interface, com a aba, o menu ou o painel que o contém já abertos. */
export async function ctl(page: Page, testId: string): Promise<Locator> {
  if (MENU.has(testId)) {
    if (!(await page.getByTestId('menu-file-list').isVisible())) {
      await page.getByTestId('menu-file').click();
    }
    return page.getByTestId(testId);
  }
  const task = TASK_RULES.find(([pattern]) => pattern.test(testId))?.[1];
  if (task) await openTask(page, task);
  const menu = RIBBON_MENUS.find(([pattern]) => pattern.test(testId))?.[1];
  if (menu && !(await page.getByTestId(`ribbon-menu-${menu}-list`).isVisible())) {
    await page.getByTestId(`ribbon-menu-${menu}`).click();
  }
  const tab = PANEL_RULES.find(([pattern]) => pattern.test(testId))?.[1];
  if (tab) await openPanelTab(page, tab);
  return page.getByTestId(testId);
}

const MANAGE_TABS = new Set(['levels', 'systems', 'georeference', 'terrain']);

/**
 * Abre o diálogo de projeto na aba pedida: configuração pela aba Gerenciar, resultados pela
 * aba Análise. Fecha antes o diálogo que estiver aberto no outro grupo.
 */
export async function openProjectTab(page: Page, tab: string): Promise<Locator> {
  const dialog = page.getByTestId('project-dialog');
  const button = dialog.getByTestId(`tab-button-${tab}`);
  if (await button.isVisible()) {
    await button.click();
    return dialog;
  }
  if (await dialog.isVisible()) await dialog.getByTestId('project-close').click();
  const manage = MANAGE_TABS.has(tab);
  await openTask(page, manage ? 'manage' : 'analysis');
  await page.getByTestId(`${manage ? 'manage' : 'analysis'}-${tab}`).click();
  return dialog;
}
