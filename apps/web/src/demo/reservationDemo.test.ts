import {
  connectedComponent,
  endMismatch,
  getElement,
  getPort,
  resolvePort,
  validateProject,
  type HydroElement,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { createReservationDemoProject } from './reservationDemo';

const project = createReservationDemoProject();
const byName = (name: string): HydroElement => {
  const element = project.elements.find((e) => e.name === name);
  if (!element) throw new Error(`Elemento ausente: ${name}`);
  return element;
};
const count = (test: (element: HydroElement) => boolean): number =>
  project.elements.filter(test).length;
const valves = (type: string): number => count((e) => e.kind === 'valve' && e.valveType === type);

describe('exemplo do centro de reservação', () => {
  it('é um projeto MEP sem pendências de validação', () => {
    expect(project.discipline).toBe('mep');
    expect(validateProject(project)).toEqual([]);
  });

  it('tem poço, elevatória, reservatórios e válvulas', () => {
    expect(count((e) => e.kind === 'pump')).toBe(3);
    expect(count((e) => e.kind === 'tank')).toBe(2);
    expect(valves('gate')).toBe(10);
    expect(valves('check')).toBe(3);
    expect(valves('flowMeter')).toBe(2);
    expect(valves('airRelease')).toBe(1);
    expect(count((e) => e.kind === 'tee')).toBe(4);
  });

  it('usa só peças de catálogo', () => {
    for (const element of project.elements) {
      if (element.kind === 'pipe') continue;
      expect(element.familyId, `${element.name}: peça genérica`).toBeTruthy();
      if (element.kind === 'pump' || element.kind === 'tank') {
        expect(element.variantId, `${element.name}: sem modelo de catálogo`).toBeTruthy();
      }
    }
    expect(byName('Bomba do poço').manufacturing.manufacturer).toBe('HIGRA');
    expect(byName('Reservatório elevado 20 m³')).toMatchObject({ tankType: 'gobletDry' });
    expect(byName('Reservatório apoiado 50 m³')).toMatchObject({ tankType: 'verticalGround' });
  });

  it('liga flange só a flange de mesma furação, e ponta a ponta', () => {
    expect(project.connections.length).toBeGreaterThan(0);
    for (const connection of project.connections) {
      const a = resolvePort(project, connection.a);
      const b = resolvePort(project, connection.b);
      const names = `${getElement(project, connection.a.elementId)?.name} ↔ ${getElement(project, connection.b.elementId)?.name}`;
      expect(endMismatch(a?.end ?? null, b?.end ?? null), names).toBeNull();
    }
  });

  it('a bomba do poço fica na vertical, com a descarga para cima, no fundo do edutor', () => {
    const pump = byName('Bomba do poço');
    const discharge = getPort(pump, 'b');
    expect(discharge?.direction.z).toBeCloseTo(1, 9);
    expect(discharge?.position.z).toBeCloseTo(0.8 - 48, 9);
    expect(count((e) => e.name.startsWith('Tubo edutor'))).toBe(8);
  });

  it('a água segue do poço à distribuição por uma rede contínua', () => {
    const network = new Set(connectedComponent(project, byName('Bomba do poço').id));
    for (const name of [
      'Reservatório apoiado 50 m³',
      'Bomba de recalque 1',
      'Bomba de recalque 2',
      'Reservatório elevado 20 m³',
      'Macromedidor da distribuição',
      'Registro da descarga do apoiado',
      'Registro da descarga do elevado',
    ]) {
      expect(network.has(byName(name).id), name).toBe(true);
    }
    expect(network.size).toBe(project.elements.length);
  });

  it('as duas bombas da elevatória ficam em paralelo, entre os barriletes', () => {
    for (const n of [1, 2]) {
      const pump = byName(`Bomba de recalque ${n}`);
      for (const portId of ['a', 'b']) {
        expect(
          project.connections.some((c) =>
            [c.a, c.b].some((r) => r.elementId === pump.id && r.portId === portId),
          ),
          `bomba ${n}, boca ${portId}`,
        ).toBe(true);
      }
    }
    const [p1, p2] = [byName('Bomba de recalque 1'), byName('Bomba de recalque 2')];
    if (p1.kind === 'pipe' || p2.kind === 'pipe') throw new Error('Bombas ausentes.');
    expect(p1.placement.position.y - p2.placement.position.y).toBeCloseTo(1.5, 9);
  });
});
