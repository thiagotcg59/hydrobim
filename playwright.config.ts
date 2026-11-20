import { defineConfig, devices } from '@playwright/test';

const PORT = 5183;
const ORIGIN = `http://127.0.0.1:${PORT}`;

/**
 * Os fluxos de aceite foram escritos para uma vista por vez: partem dessa disposição (uma
 * preferência de interface, gravada no navegador). A disposição padrão do editor — planta e
 * modelo 3D lado a lado — tem os seus próprios testes em `tests/e2e/workbench.spec.ts`.
 */
const SINGLE_VIEW = {
  cookies: [],
  origins: [
    {
      origin: ORIGIN,
      localStorage: [
        { name: 'hydrobim.layout.v1', value: JSON.stringify({ workspaceLayout: 'single' }) },
      ],
    },
  ],
};

export default defineConfig({
  testDir: 'tests/e2e',
  // No CI o WebGL é por software (SwiftShader, sem GPU): os fluxos longos de
  // aceite levam ~30 s localmente e passam de 60 s lá.
  timeout: process.env.CI ? 180_000 : 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: ORIGIN,
    storageState: SINGLE_VIEW,
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        // WebGL por software, para ambientes sem GPU (CI).
        launchOptions: { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
      },
    },
  ],
  webServer: {
    command: `npm run dev --workspace @hydrobim/web -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: ORIGIN,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
