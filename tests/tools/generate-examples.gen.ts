import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TANK_FAMILIES } from '@hydrobim/catalog';
import { serializeProject } from '@hydrobim/core';
import { exportIfc } from '@hydrobim/ifc';
import { it } from 'vitest';
import { createDemoProject } from '../../apps/web/src/demo/demoProject';
import { createTankDemoProject } from '../../apps/web/src/demo/tankDemo';

/**
 * Gerador dos arquivos de `examples/` (executado por `npm run examples:generate`).
 * Usa o executor do Vitest apenas para rodar TypeScript sem dependências adicionais.
 *
 * O JSON e o IFC são gravados na mesma execução, a partir do MESMO projeto, para que os
 * identificadores coincidam (os testes do backend comparam os dois arquivos).
 */
it('gera examples/demo-barrilete (.hydrobim.json e .ifc)', () => {
  const directory = join(import.meta.dirname, '..', '..', 'examples');
  const project = createDemoProject();
  writeFileSync(
    join(directory, 'demo-barrilete.hydrobim.json'),
    `${serializeProject(project)}\n`,
    'utf8',
  );
  writeFileSync(
    join(directory, 'demo-barrilete.ifc'),
    // Data fixa no cabeçalho: o arquivo só muda quando o projeto muda.
    exportIfc(project, { timestamp: new Date('2026-01-01T00:00:00Z') }),
    'utf8',
  );
});

it('gera examples/reservatorios-tramec (.hydrobim.json e .ifc)', () => {
  const directory = join(import.meta.dirname, '..', '..', 'examples');
  const project = createTankDemoProject();
  writeFileSync(
    join(directory, 'reservatorios-tramec.hydrobim.json'),
    `${serializeProject(project)}\n`,
    'utf8',
  );
  writeFileSync(
    join(directory, 'reservatorios-tramec.ifc'),
    exportIfc(project, {
      timestamp: new Date('2026-01-01T00:00:00Z'),
      tankFamilies: TANK_FAMILIES,
    }),
    'utf8',
  );
});
