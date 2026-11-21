import { archTypeFromFamily, getArchFamily, resolvePipeSpec } from '@hydrobim/catalog';
import {
  addArchType,
  addFloor,
  addFloorOpening,
  addHosted,
  addLevel,
  addPipe,
  addSpace,
  addView,
  addWalls,
  createProject,
  drawPipe,
  vec3,
  type Point2,
  type Project,
  type Result,
} from '@hydrobim/core';

function must<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`Edificação de demonstração inválida: ${result.error.message}`);
  }
  return result.value;
}

const p = (x: number, y: number): Point2 => ({ x, y });

/**
 * Edificação simples de demonstração, construída com as operações disponíveis ao usuário:
 * quatro paredes externas e uma divisória (encontros em L e em T), portas e janelas
 * hospedadas, laje e revestimento de piso com a abertura de um shaft, dois ambientes e uma
 * prumada de água fria que sobe pelo shaft e alimenta um ramal — arquitetura e instalação no
 * mesmo projeto, nos mesmos níveis e coordenadas.
 *
 * Os tipos vêm das famílias genéricas do catálogo arquitetônico, com os valores iniciais
 * delas: são modelos genéricos, sem produto comercial nem dado de desempenho.
 */
export function createBuildingDemoProject(): Project {
  let project = createProject('Edificação simples — arquitetura e água fria', 'architecture');
  const levelId = project.levels[0]?.id ?? '';
  project = must(addLevel(project, 'Cobertura', 2.8));

  const typeOf = (
    familyId: string,
    name: string,
    overrides: Record<string, unknown> = {},
  ): string => {
    const family = getArchFamily(familyId);
    if (!family) throw new Error(`Família ausente no catálogo: ${familyId}.`);
    const added = must(addArchType(project, archTypeFromFamily(family, name, overrides)));
    project = added.project;
    return added.typeId;
  };
  const externalWall = typeOf('arq-parede-alvenaria-ceramica', 'Alvenaria cerâmica 18 cm');
  const partition = typeOf('arq-parede-drywall', 'Drywall 9,5 cm');
  const slabType = typeOf('arq-laje-concreto', 'Laje maciça 12 cm');
  const flooringType = typeOf('arq-piso-ceramica-porcelanato', 'Porcelanato sobre contrapiso');
  const doorType = typeOf('arq-porta-giro-1', 'Porta de giro 80 × 210');
  const slidingDoor = typeOf('arq-porta-correr', 'Porta de correr 90 × 210');
  const windowType = typeOf('arq-janela-correr', 'Janela de correr 120 × 100');
  const bathWindow = typeOf('arq-janela-maxim-ar', 'Maxim-ar 80 × 60', { sillHeight: 1.6 });

  // Envoltória de 6 × 4 m (eixos) e uma divisória em T a 4 m, formando sala e banheiro.
  const shell = must(
    addWalls(project, {
      typeId: externalWall,
      levelId,
      points: [p(0, 0), p(6, 0), p(6, 4), p(0, 4)],
      height: 2.8,
      closed: true,
    }),
  );
  project = shell.project;
  const [south, east, north] = shell.elementIds as [string, string, string, string];
  const divider = must(
    addWalls(project, { typeId: partition, levelId, points: [p(4, 0), p(4, 4)], height: 2.8 }),
  );
  project = divider.project;

  const hosted = (
    kind: 'door' | 'window',
    typeId: string,
    hostId: string,
    at: number,
    extra: { hand?: 'left' | 'right'; facing?: 1 | -1 } = {},
  ): void => {
    project = must(addHosted(project, { kind, typeId, hostId, at, ...extra })).project;
  };
  hosted('door', doorType, south, 1.2, { facing: 1 });
  hosted('window', windowType, south, 2.8);
  hosted('window', windowType, north, 4.0);
  hosted('window', bathWindow, east, 2.0);
  hosted('door', slidingDoor, divider.elementIds[0] ?? '', 2.6, { hand: 'right' });

  // Laje e revestimento com a abertura do shaft (0,40 × 0,40 m) junto ao canto do banheiro.
  const outline = [p(0, 0), p(6, 0), p(6, 4), p(0, 4)];
  const shaft = [p(5.3, 3.3), p(5.7, 3.3), p(5.7, 3.7), p(5.3, 3.7)];
  const slab = must(
    addFloor(project, { kind: 'slab', typeId: slabType, levelId, boundary: outline }),
  );
  project = must(addFloorOpening(slab.project, slab.elementIds[0] ?? '', shaft)).project;
  const finish = must(
    addFloor(project, {
      kind: 'flooring',
      typeId: flooringType,
      levelId,
      boundary: [p(0.09, 0.09), p(5.91, 0.09), p(5.91, 3.91), p(0.09, 3.91)],
    }),
  );
  project = must(addFloorOpening(finish.project, finish.elementIds[0] ?? '', shaft)).project;

  // Ambientes pelas faces internas; o pé-direito da sala é informado, o do banheiro fica
  // pendente (sem valor presumido).
  project = must(
    addSpace(project, {
      levelId,
      name: 'Sala',
      number: '01',
      boundary: [p(0.09, 0.09), p(3.9525, 0.09), p(3.9525, 3.91), p(0.09, 3.91)],
      height: 2.6,
    }),
  ).project;
  project = must(
    addSpace(project, {
      levelId,
      name: 'Banheiro',
      number: '02',
      boundary: [p(4.0475, 0.09), p(5.91, 0.09), p(5.91, 3.91), p(4.0475, 3.91)],
    }),
  ).project;

  // Instalação hidráulica: prumada de água fria pelo shaft e ramal a 0,60 m do piso.
  const spec = resolvePipeSpec('pvc-soldavel-nbr5648', 25);
  if (!spec) throw new Error('Diâmetro DN 25 ausente no catálogo.');
  const riser = must(
    addPipe(project, { start: vec3(5.5, 3.5, -0.5), end: vec3(5.5, 3.5, 0.6), spec }),
  );
  const branch = must(
    drawPipe(riser.project, {
      fromPort: { elementId: riser.elementId, portId: 'end' },
      start: vec3(0, 0, 0),
      end: vec3(5.5, 1.5, 0.6),
      spec,
    }),
  );
  project = branch.project;

  project = must(addView(project, { kind: 'plan', levelId, name: 'Planta — Térreo' })).project;
  return project;
}
