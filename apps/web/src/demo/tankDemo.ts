import { getTankFamily, resolvePipeSpec } from '@hydrobim/catalog';
import {
  addTankNozzle,
  createProject,
  drawPipe,
  getElement,
  getPorts,
  placeEquipment,
  tankParametersFromFamily,
  updateTankSettings,
  vec3,
  type PipeSpec,
  type Project,
  type Result,
  type TankSelection,
} from '@hydrobim/core';

function must<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`Exemplo de reservatórios inválido: ${result.error.message}`);
  }
  return result.value;
}

function spec(dn: number): PipeSpec {
  const resolved = resolvePipeSpec('ferro-ductil-nbr7675-k9', dn);
  if (!resolved) throw new Error(`Diâmetro DN ${dn} ausente no catálogo.`);
  return resolved;
}

/** Uma ocorrência de cada família TRAMEC: [família, modelo comercial ou personalizado, X]. */
const LINEUP: readonly (readonly [string, TankSelection, number])[] = [
  ['tramec-taca-com-agua', { variantId: 'tramec-taca-com-agua/10000-705-191' }, 0],
  ['tramec-taca-sem-agua', { variantId: 'tramec-taca-sem-agua/10000-830-191-480' }, 6],
  ['tramec-tubular-alto', { variantId: 'tramec-tubular-alto/20000-1020-159' }, 12],
  ['tramec-australiano', { custom: { capacityL: 50000, height: 1.72 } }, 21],
  ['tramec-vertical-apoiado', { variantId: 'tramec-vertical-apoiado/15000-400-223' }, 30],
  ['tramec-vertical-fundo-conico', { variantId: 'tramec-vertical-fundo-conico/15000-450-223' }, 36],
  ['tramec-vertical-in-loco', { custom: {} }, 46],
  ['tramec-cilindrico-horizontal', { custom: {} }, 57],
];

/**
 * Exemplo com as oito famílias de reservatórios metálicos TRAMEC, construído com as mesmas
 * operações disponíveis ao usuário. A taça sem água na coluna recebe extravasor, descarga e
 * um trecho de tubo na saída; o horizontal tem espessura de chapa e duas células informadas.
 */
export function createTankDemoProject(): Project {
  const dn100 = spec(100);
  const dn80 = spec(80);
  let project = createProject('Reservatórios metálicos TRAMEC — demonstração', 'infra');
  const ids: string[] = [];
  for (const [familyId, selection, x] of LINEUP) {
    const family = getTankFamily(familyId);
    if (!family) throw new Error(`Família ausente no catálogo: ${familyId}`);
    const parameters = must(tankParametersFromFamily(family, selection));
    const placed = must(
      placeEquipment(project, {
        spec: dn100,
        fitting: { kind: 'tank', parameters },
        position: vec3(x, 0, 0),
      }),
    );
    project = placed.project;
    ids.push(placed.elementId);
  }

  const goblet = ids[1] ?? '';
  project = must(
    addTankNozzle(project, goblet, {
      role: 'overflow',
      height: 7.9,
      azimuth: -Math.PI / 2,
      spec: dn100,
    }),
  ).project;
  project = must(
    addTankNozzle(project, goblet, {
      role: 'drain',
      height: 5.4,
      azimuth: -Math.PI / 2,
      spec: dn80,
    }),
  ).project;
  const tank = getElement(project, goblet);
  const outlet = tank ? getPorts(tank).find((port) => port.ref.portId === 'a') : undefined;
  if (!outlet) throw new Error('Reservatório sem bocal de saída.');
  project = must(
    drawPipe(project, {
      fromPort: outlet.ref,
      start: outlet.position,
      end: vec3(outlet.position.x + 2, outlet.position.y, outlet.position.z),
      spec: dn100,
    }),
  ).project;

  return must(
    updateTankSettings(project, ids[7] ?? '', { shellThickness: 0.00635, compartments: 2 }),
  );
}
