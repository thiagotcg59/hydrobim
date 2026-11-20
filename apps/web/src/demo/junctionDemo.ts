import {
  BUILTIN_FAMILIES,
  FLANGED_PIPE_FAMILIES,
  flangedPipeFamiliesFor,
  flangeForClass,
  pipeFlangeEnd,
  PUMP_FAMILIES,
  resolvePipeSpec,
  resolvePumpPlacement,
} from '@hydrobim/catalog';
import {
  addPipe,
  createFamilyCatalog,
  createProject,
  drawPipeToJunction,
  drawPipeToPipe,
  placeEquipment,
  renameElement,
  setPipeEnds,
  vec3,
  type PipeSpec,
  type Project,
  type Result,
  type Vec3,
} from '@hydrobim/core';

/**
 * Cenário de ligações e derivações (`examples/ligacoes-derivacoes`): equipamentos com bocais
 * livres, tubos próximos e ramais que precisam alcançar um coletor. Serve de ponto de partida
 * para "Alinhar e conectar", para a derivação com tê/cruzeta e para os testes de aceite.
 *
 *  - Bomba de catálogo (HIGRA) com a descarga livre e, à frente dela, um tubo horizontal
 *    desalinhado 0,40 m (caso A).
 *  - Coletor de ferro dúctil DN 150 com flanges PN 10 e dois ramais flangeados, um de cada
 *    lado, que ainda não chegam a ele (casos B e C).
 *  - Coletor PBA DN 75 com um ramal livre (caso D) e, ao lado, uma derivação PBA já montada
 *    com cruzeta: o tê recebeu o ramal oposto e foi convertido (cobre a cruzeta no IFC e no
 *    backend).
 */

const DUCTILE = 'ferro-ductil-nbr7675-k9';
const PBA = 'pvc-pba-nbr5647-cl15';

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`Exemplo de ligações inválido: ${result.error.message}`);
  return result.value;
}

function spec(id: string, dn: number): PipeSpec {
  const resolved = resolvePipeSpec(id, dn);
  if (!resolved) throw new Error(`DN ${dn} ausente em ${id}.`);
  return resolved;
}

const catalog = createFamilyCatalog(
  BUILTIN_FAMILIES,
  {},
  {
    pipeFlange: pipeFlangeEnd,
    flange: flangeForClass,
    flangedPipeFamilies: (id) => flangedPipeFamiliesFor(id).map((family) => family.id),
  },
);

const PN10 = FLANGED_PIPE_FAMILIES.find((family) => family.pressureClass === 'PN 10')?.id ?? '';

function pipe(
  project: Project,
  start: Vec3,
  end: Vec3,
  s: PipeSpec,
  name: string,
  flanges?: { start?: boolean; end?: boolean },
): { project: Project; id: string } {
  const created = must(addPipe(project, { start, end, spec: s, name }));
  if (!flanges) return { project: created.project, id: created.elementId };
  const flange = pipeFlangeEnd(s, PN10);
  if (!flange) throw new Error('Flange PN 10 ausente.');
  return {
    project: must(
      setPipeEnds(created.project, created.elementId, {
        start: flanges.start ? flange : null,
        end: flanges.end ? flange : null,
        familyId: PN10,
      }),
    ),
    id: created.elementId,
  };
}

export function createJunctionDemoProject(): Project {
  let project = createProject('Ligações e derivações', 'infra');

  // Caso A: bomba de catálogo com a descarga livre e um tubo à frente, desalinhado 0,40 m.
  const family = PUMP_FAMILIES[0];
  const variant = family?.variants.find((v) => v.suction.dn === v.discharge.dn);
  if (!family || !variant) throw new Error('Bomba de bocas iguais ausente no catálogo.');
  const mouth = spec(DUCTILE, variant.discharge.dn);
  const placement = must(resolvePumpPlacement(family, { variantId: variant.id }, mouth));
  const pump = must(
    placeEquipment(project, {
      spec: placement.spec,
      fitting: placement.fitting,
      position: vec3(0, 10, 0),
    }),
  );
  project = must(renameElement(pump.project, pump.elementId, 'Bomba de recalque'));
  const length =
    project.elements.find((e) => e.id === pump.elementId)?.kind === 'pump'
      ? (project.elements.find((e) => e.id === pump.elementId) as { length: number }).length
      : 1;
  project = pipe(
    project,
    vec3(length + 7, 10.4, 0),
    vec3(length + 3, 10.4, 0),
    mouth,
    'Recalque',
  ).project;

  // Casos B e C: coletor flangeado e dois ramais flangeados que ainda não chegam a ele.
  const ductile = spec(DUCTILE, 150);
  project = pipe(project, vec3(0, 0, 0), vec3(12, 0, 0), ductile, 'Coletor FoFo', {
    start: true,
    end: true,
  }).project;
  project = pipe(project, vec3(6, 5, 0), vec3(6, 2, 0), ductile, 'Ramal norte', {
    end: true,
  }).project;
  project = pipe(project, vec3(6, -5, 0), vec3(6, -2, 0), ductile, 'Ramal sul', {
    end: true,
  }).project;

  // Caso D: coletor PBA com um ramal livre.
  const pba = spec(PBA, 75);
  project = pipe(project, vec3(0, -12, 0), vec3(8, -12, 0), pba, 'Coletor PBA').project;
  project = pipe(project, vec3(4, -8, 0), vec3(4, -10, 0), pba, 'Ramal PBA').project;

  // Derivação PBA já montada: o ramal do lado oposto converteu o tê em cruzeta.
  const line = pipe(project, vec3(0, -20, 0), vec3(8, -20, 0), pba, 'Linha PBA');
  const first = pipe(line.project, vec3(4, -17, 0), vec3(4, -18.5, 0), pba, 'Derivação PBA 1');
  const teed = must(
    drawPipeToPipe(first.project, {
      fromPort: { elementId: first.id, portId: 'end' },
      start: vec3(4, -18.5, 0),
      spec: pba,
      targetPipeId: line.id,
      catalog,
    }),
  );
  const tee = teed.project.elements.find((e) => e.kind === 'tee');
  if (!tee) throw new Error('Tê PBA ausente.');
  const second = pipe(teed.project, vec3(4, -23, 0), vec3(4, -21.5, 0), pba, 'Derivação PBA 2');
  project = must(
    drawPipeToJunction(second.project, {
      fromPort: { elementId: second.id, portId: 'end' },
      start: vec3(4, -21.5, 0),
      spec: pba,
      junctionId: tee.id,
      catalog,
    }),
  ).project;
  return project;
}
