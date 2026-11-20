import { connectPorts, findConnection, getElement, oppositeRef } from './connectivity';
import { MIN_PIPE_LENGTH } from './dimensions';
import { GENERIC_CATALOG, requiredEndType, type FittingCatalog } from './families';
import { baseFields, putElement, touch } from './internal';
import { dot, sub, QUAT_IDENTITY, ZERO } from './math';
import { deleteElements, placeAtPort } from './operations';
import { getPort, getPorts, pipeLength } from './ports';
import { pumpTypeOf, unlinkPumpVariant } from './pumps';
import { reconcile, setPipeEnd, translateFitting } from './reconcile';
import { fail, ok, type Result } from './result';
import type {
  EndTreatment,
  HydroElement,
  Pipe,
  PipeSpec,
  PortRef,
  Project,
  Reducer,
} from './schema';

/**
 * Alteração de especificação (material/diâmetro) com dois comportamentos:
 *  - `applySpec`: altera o elemento e, opcionalmente, propaga pelo trecho conectado;
 *  - `resizeWithReducers`: altera SOMENTE o elemento e mantém a rede válida inserindo,
 *    ajustando ou removendo reduções junto aos vizinhos.
 */

/**
 * Grupos de portas que compartilham a mesma especificação. Reduções, tês de redução e
 * bombas têm lados independentes; nos demais elementos todas as portas formam um grupo.
 */
function portGroups(element: HydroElement): string[][] {
  switch (element.kind) {
    case 'reducer':
    case 'pump':
      return [['a'], ['b']];
    case 'tee':
      return element.branchSpec ? [['a', 'b'], ['branch']] : [['a', 'b', 'branch']];
    case 'cross':
      // As duas derivações da cruzeta têm sempre o mesmo diâmetro.
      return element.branchSpec
        ? [
            ['a', 'b'],
            ['branch', 'branch2'],
          ]
        : [['a', 'b', 'branch', 'branch2']];
    case 'tank':
      // Entrada e saída compartilham a especificação; cada bocal adicional tem a sua.
      return [['a', 'b'], ...(element.nozzles ?? []).map((nozzle) => [nozzle.id])];
    default:
      return [getPorts(element).map((p) => p.ref.portId)];
  }
}

function groupOf(element: HydroElement, portId: string | null | undefined): string[] {
  const groups = portGroups(element);
  return (
    groups.find((g) => portId !== null && portId !== undefined && g.includes(portId)) ??
    groups[0] ??
    []
  );
}

/** Peça flangeada continua flangeada ao mudar de diâmetro (sem trocar por uma de bolsa). */
const keepFlange = (element: { ends: Readonly<Record<string, EndTreatment>> }) =>
  requiredEndType(...Object.values(element.ends));

/** Aplica a especificação ao lado indicado e recalcula as dimensões pelo catálogo. */
function withSpec(
  element: HydroElement,
  spec: PipeSpec,
  group: readonly string[],
  catalog: FittingCatalog,
): HydroElement {
  switch (element.kind) {
    case 'pipe': {
      // Tubo com flanges: o flange acompanha o novo diâmetro, pela mesma família; sem
      // flange tabulado para ele, a extremidade volta a ser ponta lisa.
      const { ends, ...bare } = element;
      const next: Record<string, NonNullable<typeof ends>[string]> = {};
      for (const [portId, end] of Object.entries(ends ?? {})) {
        const flange =
          end.type === 'flange' && element.familyId
            ? catalog.pipeFlange?.(spec, element.familyId)
            : undefined;
        if (flange) next[portId] = flange;
      }
      return Object.keys(next).length > 0
        ? { ...bare, spec, ends: next }
        : { ...bare, spec, familyId: ends ? null : element.familyId };
    }
    case 'tank':
      return group.includes('a') || !element.nozzles
        ? { ...element, spec }
        : {
            ...element,
            nozzles: element.nozzles.map((nozzle) =>
              group.includes(nozzle.id) ? { ...nozzle, spec } : nozzle,
            ),
          };
    case 'elbow': {
      const dims = catalog.elbow(spec, element.angle, element.familyId, keepFlange(element));
      const { straight: _previous, ...rest } = element;
      return {
        ...rest,
        ...(dims.straight ? { straight: dims.straight } : {}),
        spec,
        familyId: dims.familyId,
        ends: dims.ends,
        bendRadius: dims.bendRadius,
      };
    }
    case 'tee':
    case 'cross': {
      const branchOnly = !group.includes('a') && group.includes('branch');
      const runSpec = branchOnly ? element.spec : spec;
      const branchSpec = branchOnly ? spec : (element.branchSpec ?? spec);
      const dims = catalog[element.kind](
        runSpec,
        branchSpec,
        element.familyId,
        keepFlange(element),
      );
      const { branchSpec: _previous, ...rest } = element;
      return {
        ...rest,
        spec: runSpec,
        familyId: dims.familyId,
        ends: dims.ends,
        runLength: dims.runLength,
        branchLength: dims.branchLength,
        ...(branchSpec.dn !== runSpec.dn ? { branchSpec } : {}),
      };
    }
    case 'valve': {
      const dims = catalog.valve(spec, element.valveType, element.familyId, keepFlange(element));
      const { height: _h, handwheelDiameter: _d, width: _w, bonnetLength: _b, ...rest } = element;
      return {
        ...rest,
        spec,
        familyId: dims.familyId,
        ends: dims.ends,
        length: dims.length,
        ...(dims.height !== undefined ? { height: dims.height } : {}),
        ...(dims.handwheelDiameter !== undefined
          ? { handwheelDiameter: dims.handwheelDiameter }
          : {}),
        ...(dims.width !== undefined ? { width: dims.width } : {}),
        ...(dims.bonnetLength !== undefined ? { bonnetLength: dims.bonnetLength } : {}),
      };
    }
    case 'reducer': {
      const next = group[0] === 'b' ? { ...element, outletSpec: spec } : { ...element, spec };
      const dims = catalog.reducer(
        next.spec,
        next.outletSpec,
        element.familyId,
        keepFlange(element),
      );
      return { ...next, familyId: dims.familyId, ends: dims.ends, length: dims.length };
    }
    case 'pump': {
      const side = group[0] === 'b' ? 'b' : 'a';
      const next = side === 'b' ? { ...element, dischargeSpec: spec } : { ...element, spec };
      if (pumpTypeOf(element) === 'generic') return next;
      // Bomba de catálogo: o flange acompanha o novo diâmetro, na mesma classe de pressão
      // (sem flange tabulado, a boca fica sem ele), e a bomba deixa de ser a linha da tabela.
      const pressureClass =
        side === 'b' ? element.dischargeFlangeClass : element.suctionFlangeClass;
      const flange = pressureClass ? catalog.flange?.(spec, pressureClass) : undefined;
      const { [side]: _previous, ...others } = next.ends;
      return unlinkPumpVariant({ ...next, ends: flange ? { ...others, [side]: flange } : others });
    }
  }
}

export interface ApplySpecOptions {
  /** Propaga a especificação pelo trecho conectado, parando nas reduções. */
  propagate?: boolean;
  /** Lado do elemento que recebe a especificação (redução, tê de redução, bomba). */
  portId?: string;
  catalog?: FittingCatalog;
}

/**
 * Altera material/diâmetro de um elemento. As dimensões das conexões são recalculadas
 * e os vizinhos reajustados. Com `propagate`, a alteração percorre o trecho conectado
 * até encontrar mudanças de diâmetro (reduções, derivações de tês de redução, bombas).
 */
export function applySpec(
  project: Project,
  elementId: string,
  spec: PipeSpec,
  options: ApplySpecOptions = {},
): Result<Project> {
  if (!getElement(project, elementId)) return fail('ELEMENT_NOT_FOUND', 'Elemento inexistente.');
  const catalog = options.catalog ?? GENERIC_CATALOG;
  let next = project;
  const changed: string[] = [];
  const visited = new Set<string>();
  const queue: { id: string; via: string | null }[] = [
    { id: elementId, via: options.portId ?? null },
  ];

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) continue;
    const element = getElement(next, item.id);
    if (!element) continue;
    const group = groupOf(element, item.via);
    const key = `${item.id}#${group.join(',')}`;
    if (visited.has(key)) continue;
    visited.add(key);
    next = putElement(next, touch(withSpec(element, spec, group, catalog)));
    changed.push(item.id);
    if (!options.propagate) continue;

    for (const portId of group) {
      const connection = findConnection(next, { elementId: item.id, portId });
      if (!connection) continue;
      const other = oppositeRef(connection, { elementId: item.id, portId });
      queue.push({ id: other.elementId, via: other.portId });
    }
  }
  return reconcile(next, [...new Set(changed)]);
}

export interface ResizeResult {
  project: Project;
  /** Reduções inseridas. */
  createdIds: string[];
  /** Reduções removidas por terem se tornado desnecessárias. */
  removedIds: string[];
}

function replaceConnection(
  project: Project,
  connectionId: string,
  links: [PortRef, PortRef][],
): Result<Project> {
  let next: Project = {
    ...project,
    connections: project.connections.filter((c) => c.id !== connectionId),
  };
  for (const [a, b] of links) {
    const connected = connectPorts(next, a, b);
    if (!connected.ok) return connected;
    next = connected.value;
  }
  return ok(next);
}

/** Move a extremidade de um tubo ao longo do eixo, recusando inversão ou comprimento nulo. */
function shortenPipe(pipe: Pipe, portId: string, point: Pipe['start']): Result<Pipe> {
  const moved = setPipeEnd(pipe, portId, point);
  const before = sub(pipe.end, pipe.start);
  const after = sub(moved.end, moved.start);
  if (pipeLength(moved) < MIN_PIPE_LENGTH || dot(before, after) <= 0) {
    return fail('NO_ROOM', `"${pipe.name}" é curto demais para acomodar a redução necessária.`);
  }
  return ok(touch(moved));
}

/**
 * Altera o diâmetro APENAS do elemento indicado, mantendo a rede coerente:
 *  - vizinho de outro diâmetro → insere uma redução entre os dois (o tubo adjacente cede
 *    o comprimento da redução; as demais peças não se movem);
 *  - vizinho que já é uma redução → ajusta o lado dela; se os dois lados ficarem iguais,
 *    a redução é removida e o tubo é prolongado;
 *  - vizinho que passa a ter o mesmo diâmetro → conexão direta.
 * A troca de material não é suportada aqui (exigiria peças de transição).
 */
export function resizeWithReducers(
  project: Project,
  elementId: string,
  spec: PipeSpec,
  options: { portId?: string; catalog?: FittingCatalog } = {},
): Result<ResizeResult> {
  const original = getElement(project, elementId);
  if (!original) return fail('ELEMENT_NOT_FOUND', 'Elemento inexistente.');
  if (original.kind === 'reducer') {
    return fail(
      'NOT_SUPPORTED',
      'Para uma redução, altere o diâmetro aplicando ao trecho conectado.',
    );
  }
  const catalog = options.catalog ?? GENERIC_CATALOG;
  const group = groupOf(original, options.portId);
  const current = getPort(original, group[0] ?? '')?.spec ?? original.spec;
  if (spec.specificationId !== current.specificationId) {
    return fail(
      'SPEC_MISMATCH',
      'A troca de material exige peça de transição: aplique a alteração ao trecho conectado.',
    );
  }
  const createdIds: string[] = [];
  const removedIds: string[] = [];
  if (spec.dn === current.dn) return ok({ project, createdIds, removedIds });

  let next = putElement(project, touch(withSpec(original, spec, group, catalog)));
  const roots = [elementId];

  for (const portId of group) {
    const ref: PortRef = { elementId, portId };
    const connection = findConnection(next, ref);
    if (!connection) continue;
    const element = getElement(next, elementId);
    const myPort = element ? getPort(element, portId) : undefined;
    const otherRef = oppositeRef(connection, ref);
    const other = getElement(next, otherRef.elementId);
    const otherPort = other ? getPort(other, otherRef.portId) : undefined;
    if (!element || !myPort || !other || !otherPort) continue;
    if (otherPort.spec.dn === spec.dn) continue; // compatível: `reconcile` reajusta a posição

    if (other.kind === 'reducer') {
      const farSide = otherRef.portId === 'a' ? 'b' : 'a';
      const farBefore = getPort(other, farSide);
      const resized = withSpec(other, spec, [otherRef.portId], catalog) as Reducer;
      if (!farBefore) continue;

      if (resized.spec.dn === resized.outletSpec.dn) {
        // A redução deixou de ser necessária: remove-a e fecha o intervalo.
        const farConnection = findConnection(next, { elementId: other.id, portId: farSide });
        const farRef = farConnection
          ? oppositeRef(farConnection, { elementId: other.id, portId: farSide })
          : undefined;
        next = deleteElements(next, [other.id]);
        removedIds.push(other.id);
        const farElement = farRef ? getElement(next, farRef.elementId) : undefined;
        if (element.kind === 'pipe') {
          next = putElement(next, touch(setPipeEnd(element, portId, farBefore.position)));
        } else if (farRef && farElement?.kind === 'pipe') {
          next = putElement(next, touch(setPipeEnd(farElement, farRef.portId, myPort.position)));
        } else if (farRef) {
          return fail(
            'NO_PIPE_TO_ADJUST',
            `Não há tubo entre "${element.name}" e "${farElement?.name ?? '?'}" para fechar o intervalo da redução removida.`,
          );
        }
        if (farRef) {
          const joined = connectPorts(next, ref, farRef);
          if (!joined.ok) return joined;
          next = joined.value;
        }
        continue;
      }

      // Ajusta a redução existente mantendo fixa a extremidade oposta.
      const farAfter = getPort(resized, farSide);
      if (!farAfter) continue;
      let placed = translateFitting(resized, sub(farBefore.position, farAfter.position));
      const near = getPort(placed, otherRef.portId);
      if (!near) continue;
      if (element.kind === 'pipe') {
        const shortened = shortenPipe(element, portId, near.position);
        if (!shortened.ok) return shortened;
        next = putElement(next, shortened.value);
      } else {
        // O elemento alterado é a referência: a redução o acompanha e o lado oposto se ajusta.
        placed = translateFitting(placed, sub(myPort.position, near.position));
        roots.push(other.id);
      }
      next = putElement(next, touch(placed));
      continue;
    }

    // Vizinho comum de outro diâmetro: insere uma nova redução.
    const pipeGives = element.kind === 'pipe' ? element : other.kind === 'pipe' ? other : undefined;
    if (!pipeGives) {
      return fail(
        'NO_PIPE_TO_ADJUST',
        `Não há tubo entre "${element.name}" e "${other.name}" para acomodar a redução.`,
      );
    }
    // A porta `a` da redução fica no lado que permanece fixo (âncora).
    const anchor = element.kind === 'pipe' ? otherPort : myPort;
    const moving = element.kind === 'pipe' ? myPort : otherPort;
    const dims = catalog.reducer(anchor.spec, moving.spec);
    const reducer: Reducer = placeAtPort(
      {
        ...baseFields(next, 'reducer', anchor.spec, element.systemId),
        kind: 'reducer',
        placement: { position: ZERO, rotation: QUAT_IDENTITY },
        familyId: dims.familyId,
        ends: dims.ends,
        outletSpec: moving.spec,
        length: dims.length,
      },
      anchor.position,
      anchor.direction,
    );
    const outlet = getPort(reducer, 'b');
    if (!outlet) continue;
    const shortened = shortenPipe(pipeGives, moving.ref.portId, outlet.position);
    if (!shortened.ok) return shortened;
    next = putElement(putElement(next, reducer), shortened.value);
    const linked = replaceConnection(next, connection.id, [
      [anchor.ref, { elementId: reducer.id, portId: 'a' }],
      [{ elementId: reducer.id, portId: 'b' }, moving.ref],
    ]);
    if (!linked.ok) return linked;
    next = linked.value;
    createdIds.push(reducer.id);
  }

  const settled = reconcile(next, roots);
  if (!settled.ok) return settled;
  return ok({ project: settled.value, createdIds, removedIds });
}
