import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_FAMILIES, FLANGED_PIPE_FAMILIES, TANK_FAMILIES } from '@hydrobim/catalog';
import { mergeFamilies, serializeProject, type Project } from '@hydrobim/core';
import { exportIfc } from '@hydrobim/ifc';
import { it } from 'vitest';
import { createBuildingDemoProject } from '../../apps/web/src/demo/buildingDemo';
import { createDemoProject } from '../../apps/web/src/demo/demoProject';
import { createEarthworkDemoProject } from '../../apps/web/src/demo/earthworkDemo';
import { createJunctionDemoProject } from '../../apps/web/src/demo/junctionDemo';
import { createTankDemoProject } from '../../apps/web/src/demo/tankDemo';

/** Famílias do catálogo e do projeto: alimentam os tipos IFC (fabricante, fonte, modelo). */
const ifcOptions = (project: Project) => ({
  // Data fixa no cabeçalho: o arquivo só muda quando o projeto muda.
  timestamp: new Date('2026-01-01T00:00:00Z'),
  families: [...mergeFamilies(BUILTIN_FAMILIES, project.families), ...FLANGED_PIPE_FAMILIES],
  tankFamilies: [...TANK_FAMILIES, ...project.tankFamilies],
});

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
    exportIfc(project, ifcOptions(project)),
    'utf8',
  );
});

it('gera examples/ligacoes-derivacoes (.hydrobim.json e .ifc)', () => {
  const directory = join(import.meta.dirname, '..', '..', 'examples');
  const project = createJunctionDemoProject();
  writeFileSync(
    join(directory, 'ligacoes-derivacoes.hydrobim.json'),
    `${serializeProject(project)}\n`,
    'utf8',
  );
  writeFileSync(
    join(directory, 'ligacoes-derivacoes.ifc'),
    exportIfc(project, ifcOptions(project)),
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
    exportIfc(project, ifcOptions(project)),
    'utf8',
  );
});

it('gera examples/terraplenagem-platos (.hydrobim.json e .ifc)', () => {
  const directory = join(import.meta.dirname, '..', '..', 'examples');
  const project = createEarthworkDemoProject();
  writeFileSync(
    join(directory, 'terraplenagem-platos.hydrobim.json'),
    `${serializeProject(project)}\n`,
    'utf8',
  );
  writeFileSync(
    join(directory, 'terraplenagem-platos.ifc'),
    exportIfc(project, ifcOptions(project)),
    'utf8',
  );
});

it('gera examples/edificacao-simples (.hydrobim.json e .ifc)', () => {
  const directory = join(import.meta.dirname, '..', '..', 'examples');
  const project = createBuildingDemoProject();
  writeFileSync(
    join(directory, 'edificacao-simples.hydrobim.json'),
    `${serializeProject(project)}\n`,
    'utf8',
  );
  writeFileSync(
    join(directory, 'edificacao-simples.ifc'),
    exportIfc(project, ifcOptions(project)),
    'utf8',
  );
});
