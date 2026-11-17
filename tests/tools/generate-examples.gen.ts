import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serializeProject } from '@hydrobim/core';
import { it } from 'vitest';
import { createDemoProject } from '../../apps/web/src/demo/demoProject';

/**
 * Gerador dos arquivos de `examples/` (executado por `npm run examples:generate`).
 * Usa o executor do Vitest apenas para rodar TypeScript sem dependências adicionais.
 */
it('gera examples/demo-barrilete.hydrobim.json', () => {
  const target = join(import.meta.dirname, '..', '..', 'examples', 'demo-barrilete.hydrobim.json');
  writeFileSync(target, `${serializeProject(createDemoProject())}\n`, 'utf8');
});
