import { defineConfig } from 'vitest/config';

/** Configuração usada apenas por `npm run examples:generate`. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/tools/**/*.gen.ts'],
  },
});
