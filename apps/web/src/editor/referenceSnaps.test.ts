import {
  addPipe,
  createProject,
  drawPipe,
  vec3,
  type PipeSpec,
  type Project,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { pickReference } from './referenceSnaps';

const spec: PipeSpec = {
  specificationId: 'test',
  material: 'pvc',
  standard: 'Teste',
  jointType: 'solventWeld',
  pressureClass: null,
  dn: 50,
  sizeLabel: 'DN 50',
  outerDiameter: 0.06,
  wallThickness: 0.003,
  innerDiameter: 0.054,
};

/** Tubo de (0,0) a (4,0) na cota 2,7 e tubo vertical em (6, 3). */
function model(): { project: Project; mainId: string } {
  const main = addPipe(createProject('t'), { start: vec3(0, 0, 2.7), end: vec3(4, 0, 2.7), spec });
  if (!main.ok) throw new Error(main.error.message);
  const riser = addPipe(main.value.project, { start: vec3(6, 3, 0), end: vec3(6, 3, 3), spec });
  if (!riser.ok) throw new Error(riser.error.message);
  return { project: riser.value.project, mainId: main.value.elementId };
}

const { project, mainId } = model();
const base = { tolerance: 0.1, elements: project.elements, anchor: null };

describe('capturas de referência na planta', () => {
  it('extremidade: captura qualquer porta e informa a cota de origem', () => {
    const snap = pickReference({ ...base, point: { x: 4.05, y: 0.03 } });
    expect(snap).toMatchObject({
      kind: 'endpoint',
      point: { x: 4, y: 0 },
      elementId: mainId,
      sourceZ: 2.7,
    });
  });

  it('extremidade conectada também é referência (a conexão não é refeita)', () => {
    const next = drawPipe(project, {
      fromPort: { elementId: mainId, portId: 'end' },
      start: vec3(4, 0, 2.7),
      end: vec3(7, 0, 2.7),
      spec,
    });
    if (!next.ok) throw new Error(next.error.message);
    const connected = next.value.project;
    const before = connected.connections.length;
    const snap = pickReference({ ...base, elements: connected.elements, point: { x: 4, y: 0.02 } });
    expect(snap?.kind).toBe('endpoint');
    expect(snap?.point).toEqual({ x: 4, y: 0 });
    // Função pura de apontamento: o grafo de conexões não muda.
    expect(connected.connections).toHaveLength(before);
  });

  it('ponto médio do tubo', () => {
    const snap = pickReference({ ...base, point: { x: 2.04, y: -0.05 } });
    expect(snap).toMatchObject({ kind: 'midpoint', point: { x: 2, y: 0 }, sourceZ: 2.7 });
  });

  it('perpendicular a partir do ponto de partida, com a linha-guia', () => {
    const snap = pickReference({
      ...base,
      anchor: vec3(1.3, 2, 0.3),
      point: { x: 1.33, y: 0.06 },
    });
    expect(snap?.kind).toBe('perpendicular');
    expect(snap?.point.x).toBeCloseTo(1.3);
    expect(snap?.point.y).toBeCloseTo(0);
    // A referência vem de outra cota: a interface mostra que o ponto foi projetado.
    expect(snap?.sourceZ).toBeCloseTo(2.7);
    expect(snap?.guides).toEqual([{ x: 1.3, y: 2 }]);
  });

  it('sem perpendicular quando o pé cai fora do tubo ou o tubo é vertical', () => {
    expect(
      pickReference({ ...base, anchor: vec3(5.3, 2, 0), point: { x: 5.3, y: 0.02 } })?.kind,
    ).not.toBe('perpendicular');
    // Perto da prumada só há a extremidade (as duas portas coincidem em planta).
    expect(
      pickReference({ ...base, anchor: vec3(1, 1, 0), point: { x: 6.02, y: 3.01 } })?.kind,
    ).toBe('endpoint');
  });

  it('alinhamento com um ponto notável e cruzamento de duas guias', () => {
    const vertical = pickReference({ ...base, point: { x: 4.04, y: 1.7 } });
    expect(vertical).toMatchObject({ kind: 'alignment', point: { x: 4, y: 1.7 } });
    expect(vertical?.guides).toEqual([{ x: 4, y: 0 }]);

    // X da ponta do tubo e Y da prumada: o ponto é o cruzamento das guias.
    const both = pickReference({ ...base, point: { x: 4.03, y: 2.96 } });
    expect(both).toMatchObject({ kind: 'alignment', point: { x: 4, y: 3 }, sourceZ: null });
    expect(both?.guides).toHaveLength(2);
  });

  it('respeita a prioridade e o raio de captura', () => {
    // Sobre a extremidade, vale a extremidade (e não o alinhamento com ela mesma).
    expect(pickReference({ ...base, point: { x: 0.02, y: 0.02 } })?.kind).toBe('endpoint');
    expect(pickReference({ ...base, point: { x: 1.2, y: 1.4 } })).toBeNull();
    // Com o zoom afastado (raio maior em metros), o mesmo cursor captura o alinhamento em Y.
    expect(pickReference({ ...base, tolerance: 1.5, point: { x: 1.2, y: 1.4 } })?.kind).toBe(
      'alignment',
    );
    // Elementos ocultos não entram: quem chama passa só os visíveis.
    expect(pickReference({ ...base, elements: [], point: { x: 4, y: 0 } })).toBeNull();
  });
});
