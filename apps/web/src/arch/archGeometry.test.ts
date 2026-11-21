import { addLevel, createProject, type Wall } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { createBuildingDemoProject } from '../demo/buildingDemo';
import {
  activeTypeIdOf,
  closestOnSegment,
  hostedCarriedBy,
  hostedPlacementAt,
  parseLength,
  planCenterOf,
  pointAtLength,
  snapArchPoint,
  wallAt,
  workLevelIdOf,
} from './archGeometry';

const project = createBuildingDemoProject();
const { architecture } = project;
const walls = architecture.elements.filter((e): e is Wall => e.kind === 'wall');
const typeOf = (category: string): string =>
  architecture.types.find((type) => type.category === category)?.id ?? '';

describe('captura de pontos da arquitetura', () => {
  it('prefere extremidades, depois faces e eixo, depois a grade', () => {
    const options = { tolerance: 0.1, gridStep: 0.5 };
    expect(snapArchPoint(architecture, { x: 0.03, y: -0.02 }, options)).toEqual({
      point: { x: 0, y: 0 },
      kind: 'endpoint',
    });
    // Parede sul (eixo em y = 0, 18 cm): a face externa fica em y = −0,09.
    const face = snapArchPoint(architecture, { x: 2.33, y: -0.11 }, options);
    expect(face.kind).toBe('face');
    expect(face.point.x).toBeCloseTo(2.33);
    expect(face.point.y).toBeCloseTo(-0.09);
    expect(snapArchPoint(architecture, { x: 2.2, y: 1.8 }, options)).toEqual({
      point: { x: 2, y: 2 },
      kind: 'grid',
    });
    expect(
      snapArchPoint(architecture, { x: 2.2, y: 1.8 }, { tolerance: 0.1, gridStep: 0 }).kind,
    ).toBe('free');
  });

  it('acha a parede sob o ponto ou a mais próxima dentro da tolerância', () => {
    expect(wallAt(architecture, { x: 3, y: 0.05 }, 0.01)?.id).toBe(walls[0]?.id);
    expect(wallAt(architecture, { x: 3, y: 0.15 }, 0.1)?.id).toBe(walls[0]?.id);
    expect(wallAt(architecture, { x: 3, y: 2 }, 0.1)).toBeNull();
  });

  it('posição de porta: no passo da grade, com o cabimento conferido pelo núcleo', () => {
    const fits = hostedPlacementAt(
      project,
      'door',
      typeOf('door'),
      { x: 4.83, y: 0.02 },
      {
        tolerance: 0.1,
        gridStep: 0.1,
      },
    );
    expect(fits?.wall.id).toBe(walls[0]?.id);
    expect(fits?.offset).toBeCloseTo(4.8);
    expect(fits?.problem).toBeNull();
    // Sobre a porta existente (a 1,20 m): sobrepõe.
    const overlap = hostedPlacementAt(
      project,
      'door',
      typeOf('door'),
      { x: 1.3, y: 0 },
      {
        tolerance: 0.1,
        gridStep: 0,
      },
    );
    expect(overlap?.problem).toContain('sobrepõe');
    expect(
      hostedPlacementAt(
        project,
        'door',
        typeOf('door'),
        { x: 3, y: 2 },
        { tolerance: 0.1, gridStep: 0 },
      ),
    ).toBeNull();
    // Tipo de outra categoria não serve.
    expect(
      hostedPlacementAt(
        project,
        'door',
        typeOf('window'),
        { x: 4.8, y: 0 },
        { tolerance: 0.1, gridStep: 0 },
      ),
    ).toBeNull();
  });
});

describe('entrada numérica e contexto', () => {
  it('interpreta o comprimento e o aplica na direção do cursor', () => {
    expect(parseLength('2,5')).toBe(2.5);
    expect(parseLength(' 3.25 ')).toBe(3.25);
    expect(parseLength('0')).toBeNull();
    expect(parseLength('-1')).toBeNull();
    expect(parseLength('1;2')).toBeNull();
    expect(parseLength('')).toBeNull();
    expect(pointAtLength({ x: 1, y: 1 }, { x: 1, y: 9 }, 2)).toEqual({ x: 1, y: 3 });
    expect(pointAtLength({ x: 1, y: 1 }, { x: 1, y: 1 }, 2)).toBeNull();
    expect(closestOnSegment({ x: 5, y: 1 }, { x: 0, y: 0 }, { x: 2, y: 0 })).toEqual({
      x: 2,
      y: 0,
    });
  });

  it('nível do plano de trabalho e tipo ativo', () => {
    const [ground, roof] = project.levels;
    expect(workLevelIdOf(project, 0)).toBe(ground?.id);
    expect(workLevelIdOf(project, 2.8)).toBe(roof?.id);
    expect(workLevelIdOf(project, 1.2)).toBe(ground?.id);
    const empty = createProject('Vazio', 'architecture');
    expect(workLevelIdOf({ levels: [] }, 0)).toBeNull();
    const more = addLevel(empty, 'Subsolo', -3);
    expect(more.ok && workLevelIdOf(more.value, -3)).toBeTruthy();

    const wallTypes = architecture.types.filter((type) => type.category === 'wall');
    expect(activeTypeIdOf(project, {}, 'wall')).toBe(wallTypes[0]?.id);
    expect(activeTypeIdOf(project, { wall: wallTypes[1]?.id ?? '' }, 'wall')).toBe(
      wallTypes[1]?.id,
    );
    expect(activeTypeIdOf(project, { wall: 'removido' }, 'wall')).toBe(wallTypes[0]?.id);
    expect(activeTypeIdOf(empty, {}, 'wall')).toBeNull();
  });

  it('centro da seleção e esquadrias levadas pela exclusão de paredes', () => {
    const south = walls[0];
    if (!south) throw new Error('parede ausente');
    const center = planCenterOf(architecture, [south.id]);
    expect(center?.x).toBeCloseTo(3);
    expect(planCenterOf(architecture, ['inexistente'])).toBeNull();
    expect(hostedCarriedBy(architecture, [south.id])).toBe(2);
    const door = architecture.elements.find((e) => e.kind === 'door');
    expect(hostedCarriedBy(architecture, [south.id, door?.id ?? ''])).toBe(1);
  });
});
