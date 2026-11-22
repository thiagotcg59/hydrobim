import {
  BUILTIN_FAMILIES,
  flangedPipeFamiliesFor,
  flangeForClass,
  getPumpFamily,
  getTankFamily,
  pipeFlangeEnd,
  resolvePipeSpec,
  resolvePumpPlacement,
} from '@hydrobim/catalog';
import {
  addPipe,
  addSystem,
  addTankNozzle,
  attachFitting,
  createFamilyCatalog,
  distance,
  dot,
  drawPipe,
  createProject,
  endMismatch,
  getElement,
  getFreePorts,
  getPort,
  insertInline,
  placeEquipment,
  renameElement,
  setElementsSystem,
  tankParametersFromFamily,
  updateFitting,
  updateSystem,
  vec3,
  type EndTreatment,
  type InsertInlineInput,
  type PipeEndsInput,
  type PipeSpec,
  type Port,
  type Project,
  type Result,
  type TankNozzleRole,
  type Vec3,
} from '@hydrobim/core';

/**
 * Centro de reservação (`examples/centro-reservacao`), no ambiente MEP, montado com as mesmas
 * operações disponíveis ao usuário e só com peças de catálogo:
 *
 *  1. Poço profundo: bomba anfíbia HIGRA de múltiplos estágios na vertical, tubo edutor em
 *     barras flangeadas de 6 m e cavalete (ventosa, retenção, macromedidor, descarga de
 *     limpeza e registro de bloqueio).
 *  2. Reservatório apoiado TRAMEC de 50.000 L, alimentado por cima.
 *  3. Estação elevatória: duas bombas HIGRA em paralelo (1 + 1 reserva), cada uma com registro
 *     na sucção e retenção + registro no recalque, entre o barrilete de sucção e o de recalque.
 *  4. Reservatório elevado TRAMEC tipo taça de 20.000 L (coluna seca de 6,00 m) e a saída para
 *     a distribuição, com registro e macromedidor.
 *  5. Extravasor e descarga de fundo (com registro) nos dois reservatórios.
 *
 * Tubulação: ferro fundido dúctil K9 com flanges; curvas e tês PAM, válvulas e ventosa AVK,
 * macromedidores SANECOM.
 *
 * O que NÃO está modelado, por não existir no domínio: a perfuração e o revestimento do poço,
 * a laje de proteção, as bases de concreto e a casa de bombas. A cota de instalação da bomba
 * do poço é do exemplo — depende do nível dinâmico, que só o teste de bombeamento informa.
 */

const DUCTILE = 'ferro-ductil-nbr7675-k9';
const at = (id: string): string => `${id}@${DUCTILE}`;
const GATE = at('avk-gaveta-curta-en558-s14');
const CHECK = at('avk-retencao-portinhola-en558-s48');
const AIR = at('avk-ventosa-701');
const METER = at('sanecom-eletromagnetico');

/** Cota do eixo das linhas junto ao piso (m): a dos bocais da base da coluna da taça. */
const Z_LINE = 0.3;
/** Cota do eixo do cavalete do poço (m). */
const Z_WELLHEAD = 0.8;
/** Barra de tubo flangeado do edutor (m) e quantidade de barras. */
const RISER_BAR = 6;
const RISER_BARS = 8;

const X_GROUND_TANK = 12;
const X_ELEVATED_TANK = 26;
/** Afastamento entre os eixos das duas bombas da elevatória (m). */
const PUMP_SPACING = 1.5;

function must<T>(result: Result<T>): T {
  if (!result.ok)
    throw new Error(`Exemplo do centro de reservação inválido: ${result.error.message}`);
  return result.value;
}

function spec(dn: number): PipeSpec {
  const resolved = resolvePipeSpec(DUCTILE, dn);
  if (!resolved) throw new Error(`DN ${dn} ausente em ${DUCTILE}.`);
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

/**
 * Flange de tubo (família de tubos com flanges, da menor classe para a maior) que casa com
 * todos os flanges em `mates`. Nada é presumido: sem família que case, o exemplo falha.
 */
function pipeFlange(
  s: PipeSpec,
  mates: readonly (EndTreatment | null)[],
): { end: EndTreatment; familyId: string } {
  for (const family of flangedPipeFamiliesFor(s.specificationId)) {
    const end = pipeFlangeEnd(s, family.id);
    if (!end) continue;
    if (mates.every((mate) => mate?.type !== 'flange' || endMismatch(end, mate) === null)) {
      return { end, familyId: family.id };
    }
  }
  throw new Error(`Sem tubo com flanges compatível em ${s.sizeLabel}.`);
}

type InlineFitting = InsertInlineInput['fitting'];

export function createReservationDemoProject(): Project {
  const dn80 = spec(80);
  const dn100 = spec(100);
  let project = createProject('Centro de reservação — poço, elevatória e reservatórios', 'mep');

  const apply = <T extends { project: Project }>(result: Result<T>): T => {
    const value = must(result);
    project = value.project;
    return value;
  };
  const rename = (id: string, name: string): void => {
    project = must(renameElement(project, id, name));
  };
  const portOf = (elementId: string, portId: string): Port => {
    const element = getElement(project, elementId);
    const port = element ? getPort(element, portId) : undefined;
    if (!port) throw new Error(`Porta ${portId} ausente.`);
    return port;
  };
  /** Acabamento da porta livre que está em `point` (`null` = nenhuma, ou ponta lisa). */
  const mateAt = (point: Vec3): EndTreatment | null =>
    getFreePorts(project).find((port) => distance(port.position, point) < 1e-6)?.end ?? null;
  const pipeEnds = (
    s: PipeSpec,
    flangedStart: boolean,
    flangedEnd: boolean,
    mates: readonly (EndTreatment | null)[],
  ): PipeEndsInput | undefined => {
    if (!flangedStart && !flangedEnd) return undefined;
    const flange = pipeFlange(s, mates);
    return {
      start: flangedStart ? flange.end : null,
      end: flangedEnd ? flange.end : null,
      familyId: flange.familyId,
    };
  };

  /** Tubo reto; as extremidades coincidentes com portas livres são ligadas. */
  const pipe = (
    name: string,
    start: Vec3,
    end: Vec3,
    s: PipeSpec,
    flangedStart = true,
    flangedEnd = true,
  ): string => {
    const ends = pipeEnds(s, flangedStart, flangedEnd, [mateAt(start), mateAt(end)]);
    return apply(addPipe(project, { start, end, spec: s, name, ...(ends ? { ends } : {}) }))
      .elementId;
  };

  /** Muda de direção a partir do fim de um tubo: a curva flangeada entra no vértice. */
  const turn = (name: string, fromPipeId: string, end: Vec3, flangedEnd = true): string => {
    const from = portOf(fromPipeId, 'end');
    const ends = pipeEnds(from.spec, true, flangedEnd, [from.end, mateAt(end)]);
    return apply(
      drawPipe(project, {
        fromPort: from.ref,
        start: from.position,
        end,
        spec: from.spec,
        name,
        catalog,
        ...(ends ? { ends } : {}),
      }),
    ).elementId;
  };

  /**
   * Peça em linha no ponto `point` do tubo; `branchToward` orienta a derivação do tê. Devolve
   * a peça e o trecho de tubo depois dela.
   */
  const inline = (
    pipeId: string,
    point: Vec3,
    fitting: InlineFitting,
    name: string,
    branchToward?: Vec3,
  ): { id: string; tail: string } => {
    const host = getElement(project, pipeId);
    if (host?.kind !== 'pipe') throw new Error(`"${name}": tubo ausente.`);
    const distanceFromStart = distance(host.start, point);
    for (const roll of branchToward ? [0, Math.PI / 2, Math.PI, -Math.PI / 2] : [0]) {
      const inserted = must(
        insertInline(project, { pipeId, distanceFromStart, fitting, roll, catalog }),
      );
      if (branchToward) {
        const piece = getElement(inserted.project, inserted.elementId);
        const branch = piece ? getPort(piece, 'branch') : undefined;
        if (!branch || dot(branch.direction, branchToward) < 0.999) continue;
      }
      const tail = inserted.createdIds[1];
      if (!tail) throw new Error(`"${name}": trecho posterior ausente.`);
      project = must(renameElement(inserted.project, inserted.elementId, name));
      return { id: inserted.elementId, tail };
    }
    throw new Error(`"${name}": derivação sem a orientação pedida.`);
  };

  const gate = (pipeId: string, point: Vec3, name: string): { id: string; tail: string } =>
    inline(pipeId, point, { kind: 'valve', valveType: 'gate', familyId: GATE }, name);
  const check = (pipeId: string, point: Vec3, name: string): { id: string; tail: string } =>
    inline(pipeId, point, { kind: 'valve', valveType: 'check', familyId: CHECK }, name);
  const meter = (pipeId: string, point: Vec3, name: string): { id: string; tail: string } =>
    inline(pipeId, point, { kind: 'valve', valveType: 'flowMeter', familyId: METER }, name);

  /** Bomba HIGRA de catálogo acoplada pela sucção ao flange do fim de um tubo. */
  const pump = (pipeId: string, familyId: string, variantId: string, name: string): string => {
    const family = getPumpFamily(familyId);
    if (!family) throw new Error(`Família de bombas ausente: ${familyId}.`);
    const placement = must(resolvePumpPlacement(family, { variantId }, dn80));
    const id = apply(
      attachFitting(project, {
        target: { elementId: pipeId, portId: 'end' },
        fitting: placement.fitting,
        catalog,
      }),
    ).elementId;
    rename(id, name);
    return id;
  };

  const tank = (familyId: string, variantId: string, x: number, name: string): string => {
    const family = getTankFamily(familyId);
    if (!family) throw new Error(`Família de reservatórios ausente: ${familyId}.`);
    const parameters = must(tankParametersFromFamily(family, { variantId }));
    const id = apply(
      placeEquipment(project, {
        spec: dn80,
        fitting: { kind: 'tank', parameters },
        position: vec3(x, 0, 0),
      }),
    ).elementId;
    rename(id, name);
    return id;
  };

  const nozzle = (tankId: string, role: TankNozzleRole, height: number, s: PipeSpec): Port =>
    portOf(
      tankId,
      apply(addTankNozzle(project, tankId, { role, height, azimuth: -Math.PI / 2, spec: s }))
        .portId,
    );

  /** Elementos criados por `build` passam ao sistema `systemId`. */
  const inSystem = (systemId: string, build: () => void): void => {
    const before = new Set(project.elements.map((element) => element.id));
    build();
    const created = project.elements.filter((element) => !before.has(element.id));
    project = must(
      setElementsSystem(
        project,
        created.map((element) => element.id),
        systemId,
      ),
    );
  };
  const system = (name: string, kind: 'waterSupply' | 'other'): string => {
    project = must(addSystem(project, name, kind));
    const created = project.systems.at(-1);
    if (!created) throw new Error('Sistema não criado.');
    return created.id;
  };

  const adduction = project.systems[0]?.id ?? '';
  project = must(updateSystem(project, adduction, { name: 'Adução do poço', kind: 'waterSupply' }));
  const boosting = system('Recalque', 'waterSupply');
  const distribution = system('Distribuição', 'waterSupply');
  const drainage = system('Extravasão e descarga', 'other');

  let groundTank = '';
  let elevatedTank = '';

  // -------------------------------------------------------------------------
  // 1. Poço profundo, cavalete e adutora até o reservatório apoiado
  // -------------------------------------------------------------------------
  inSystem(adduction, () => {
    groundTank = tank(
      'tramec-vertical-apoiado',
      'tramec-vertical-apoiado/50000-600-320',
      X_GROUND_TANK,
      'Reservatório apoiado 50 m³',
    );
    // A saída sobe à cota do eixo das bombas; a posição dos bocais é do usuário, não do catálogo.
    project = must(updateFitting(project, groundTank, { outletHeight: Z_LINE }));

    const wellFamily = 'higra-anfibia-multiplos-estagios-60hz';
    const wellVariant = getPumpFamily(wellFamily)?.variants.find((v) => v.suction.dn === 80);
    if (!wellVariant) throw new Error('Bomba DN 80 de múltiplos estágios ausente no catálogo.');
    // O edutor tem barras inteiras: a cota da bomba decorre delas e do comprimento F da bomba.
    const dischargeZ = Z_WELLHEAD - RISER_BARS * RISER_BAR;
    const suctionZ = dischargeZ - wellVariant.dimensions.length;
    const intake = pipe(
      'Tubo de sucção do poço',
      vec3(0, 0, suctionZ - 0.6),
      vec3(0, 0, suctionZ),
      dn80,
      false,
      true,
    );
    pump(intake, wellFamily, wellVariant.id, 'Bomba do poço');
    let bar = '';
    for (let i = 0; i < RISER_BARS; i += 1) {
      const z = dischargeZ + i * RISER_BAR;
      bar = pipe(`Tubo edutor ${i + 1}`, vec3(0, 0, z), vec3(0, 0, z + RISER_BAR), dn80);
    }

    const inlet = portOf(groundTank, 'b');
    const riserX = inlet.position.x - 0.6;
    const z = Z_WELLHEAD;
    let line = turn('Cavalete do poço', bar, vec3(riserX, 0, z));
    const vent = inline(line, vec3(0.9, 0, z), { kind: 'tee' }, 'Tê da ventosa', vec3(0, 0, 1));
    const air = apply(
      attachFitting(project, {
        target: { elementId: vent.id, portId: 'branch' },
        fitting: { kind: 'valve', valveType: 'airRelease', familyId: AIR },
        catalog,
      }),
    ).elementId;
    rename(air, 'Ventosa do cavalete');
    line = check(vent.tail, vec3(1.7, 0, z), 'Válvula de retenção do poço').tail;
    line = meter(line, vec3(2.7, 0, z), 'Macromedidor do poço').tail;
    const flush = inline(line, vec3(3.6, 0, z), { kind: 'tee' }, 'Tê de descarga', vec3(0, -1, 0));
    const flushPort = portOf(flush.id, 'branch');
    const flushLine = pipe(
      'Descarga de limpeza do poço',
      flushPort.position,
      vec3(3.6, -1.6, z),
      dn80,
      true,
      false,
    );
    gate(flushLine, vec3(3.6, -0.7, z), 'Registro da descarga do poço');
    line = gate(flush.tail, vec3(4.5, 0, z), 'Registro do cavalete').tail;

    const rise = turn('Subida ao reservatório apoiado', line, vec3(riserX, 0, inlet.position.z));
    turn('Entrada do reservatório apoiado', rise, inlet.position, false);
  });

  // -------------------------------------------------------------------------
  // 2. Estação elevatória (duas bombas em paralelo) e recalque ao reservatório elevado
  // -------------------------------------------------------------------------
  inSystem(boosting, () => {
    elevatedTank = tank(
      'tramec-taca-sem-agua',
      'tramec-taca-sem-agua/20000-1020-255-600',
      X_ELEVATED_TANK,
      'Reservatório elevado 20 m³',
    );
    const boosterFamily = 'higra-anfibia-estagio-unico-60hz';
    const boosterVariant = getPumpFamily(boosterFamily)?.variants.find((v) => v.suction.dn === 80);
    if (!boosterVariant) throw new Error('Bomba DN 80 de estágio único ausente no catálogo.');

    const z = Z_LINE;
    const y2 = -PUMP_SPACING;
    const outlet = portOf(groundTank, 'a');
    const inlet = portOf(elevatedTank, 'b');
    const xSuctionTee = 15.6;
    const xPump = 17;
    const xDischargeTee = xPump + boosterVariant.dimensions.length + 2.3;

    // Barrilete de sucção e bomba 1, no eixo dos reservatórios.
    let line = pipe('Sucção da elevatória', outlet.position, vec3(xPump, 0, z), dn80, false, true);
    line = gate(line, vec3(14.6, 0, z), 'Registro geral da sucção').tail;
    const suctionTee = inline(
      line,
      vec3(xSuctionTee, 0, z),
      { kind: 'tee' },
      'Tê do barrilete de sucção',
      vec3(0, -1, 0),
    );
    line = gate(suctionTee.tail, vec3(16.4, 0, z), 'Registro de sucção da bomba 1').tail;
    const pump1 = pump(line, boosterFamily, boosterVariant.id, 'Bomba de recalque 1');
    const xOut = portOf(pump1, 'b').position.x;

    line = pipe('Recalque', portOf(pump1, 'b').position, inlet.position, dn80, true, false);
    line = check(line, vec3(xOut + 0.7, 0, z), 'Válvula de retenção da bomba 1').tail;
    line = gate(line, vec3(xOut + 1.4, 0, z), 'Registro de recalque da bomba 1').tail;
    const dischargeTee = inline(
      line,
      vec3(xDischargeTee, 0, z),
      { kind: 'tee' },
      'Tê do barrilete de recalque',
      vec3(0, -1, 0),
    );

    // Bomba 2 (reserva), em paralelo.
    const branch = pipe(
      'Ramal de sucção da bomba 2',
      portOf(suctionTee.id, 'branch').position,
      vec3(xSuctionTee, y2, z),
      dn80,
    );
    line = turn('Sucção da bomba 2', branch, vec3(xPump, y2, z));
    line = gate(line, vec3(16.4, y2, z), 'Registro de sucção da bomba 2').tail;
    const pump2 = pump(line, boosterFamily, boosterVariant.id, 'Bomba de recalque 2');
    line = pipe(
      'Recalque da bomba 2',
      portOf(pump2, 'b').position,
      vec3(xDischargeTee, y2, z),
      dn80,
    );
    line = check(line, vec3(xOut + 0.7, y2, z), 'Válvula de retenção da bomba 2').tail;
    line = gate(line, vec3(xOut + 1.4, y2, z), 'Registro de recalque da bomba 2').tail;
    turn('Ramal de recalque da bomba 2', line, portOf(dischargeTee.id, 'branch').position);
  });

  // -------------------------------------------------------------------------
  // 3. Saída do reservatório elevado para a distribuição
  // -------------------------------------------------------------------------
  inSystem(distribution, () => {
    const outlet = portOf(elevatedTank, 'a');
    const { x } = outlet.position;
    let line = pipe(
      'Saída para a distribuição',
      outlet.position,
      vec3(x + 5, 0, Z_LINE),
      dn80,
      false,
      true,
    );
    line = gate(line, vec3(x + 1, 0, Z_LINE), 'Registro da distribuição').tail;
    meter(line, vec3(x + 2.8, 0, Z_LINE), 'Macromedidor da distribuição');
  });

  // -------------------------------------------------------------------------
  // 4. Extravasores e descargas de fundo
  // -------------------------------------------------------------------------
  inSystem(drainage, () => {
    // Apoiado: extravasor no alto do costado, descendo junto ao reservatório.
    const overflow = nozzle(groundTank, 'overflow', 5.5, dn100);
    const down = vec3(overflow.position.x, overflow.position.y - 0.6, overflow.position.z);
    const stub = pipe('Extravasor do apoiado', overflow.position, down, dn100, false, true);
    turn('Descida do extravasor do apoiado', stub, vec3(down.x, down.y, 0.5), false);
    const drain = nozzle(groundTank, 'drain', 0.15, dn80);
    const drainEnd = vec3(drain.position.x, drain.position.y - 1.8, drain.position.z);
    const drainLine = pipe('Descarga do apoiado', drain.position, drainEnd, dn80, false, false);
    gate(
      drainLine,
      vec3(drain.position.x, drain.position.y - 1.2, drain.position.z),
      'Registro da descarga do apoiado',
    );

    // Elevado: coluna seca — extravasor e descarga saem pela base da coluna, como as demais
    // tubulações (os trechos internos à coluna não são modelados).
    const high = nozzle(elevatedTank, 'overflow', 0.8, dn100);
    pipe(
      'Extravasor do elevado',
      high.position,
      vec3(high.position.x, high.position.y - 1, high.position.z),
      dn100,
      false,
      false,
    );
    const low = nozzle(elevatedTank, 'drain', Z_LINE, dn80);
    const lowLine = pipe(
      'Descarga do elevado',
      low.position,
      vec3(low.position.x, low.position.y - 1.9, low.position.z),
      dn80,
      false,
      false,
    );
    gate(
      lowLine,
      vec3(low.position.x, low.position.y - 1.4, low.position.z),
      'Registro da descarga do elevado',
    );
  });

  return project;
}
