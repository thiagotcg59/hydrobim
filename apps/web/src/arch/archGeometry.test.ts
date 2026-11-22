import { addLevel, createProject, type Wall } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { createBuildingDemoProject } from '../demo/buildingDemo';
import {
  activeTypeIdOf,
  archOnLevel,
  archSnapSegments,
  closestOnSegment,
  hostedCarriedBy,
  hostedPlacementAt,
  planCenterOf,
  wallAt,
  workLevelIdOf,
} from './archGeometry';

const project = createBuildingDemoProject();
const { architecture } = project;
const walls = architecture.elements.filter((e): e is Wall => e.kind === 'wall');
const typeOf = (category: string): string =>
  architecture.types.find((type) => type.category === category)?.id ?? '';

describe('captura de pontos da arquitetura', () => {
  it('arestas de referência: eixo e faces das paredes, contornos, só do nível pedido', () => {
    const [ground] = project.levels;
    const all = archSnapSegments(architecture, { levelId: null });
    const onGround = archSnapSegments(architecture, { levelId: ground?.id ?? '' });
    // Cada parede dá o eixo e as faces do contorno (com os encontros resolvidos).
    const south = walls[0];
    const axis = all.find((segment) => segment.sourceId === south?.id && segment.role === 'axis');
    expect(axis?.a).toEqual(south?.start);
    expect(axis?.b).toEqual(south?.end);
    expect(all.some((segment) => segment.sourceId === south?.id && segment.role === 'face')).toBe(
      true,
    );
    expect(all.some((segment) => segment.role === 'edge')).toBe(true);
    // O filtro de nível só deixa os elementos daquele nível.
    for (const segment of onGround) {
      const element = architecture.elements.find((item) => item.id === segment.sourceId);
      expect(element && archOnLevel(architecture, element, ground?.id ?? '')).toBe(true);
    }
    expect(archSnapSegments(architecture, { levelId: 'outro-nivel' })).toEqual([]);
    // O elemento em edição não captura a si mesmo.
    const without = archSnapSegments(architecture, { levelId: null, exclude: [south?.id ?? ''] });
    expect(without.some((segment) => segment.sourceId === south?.id)).toBe(false);
    expect(without.length).toBeLessThan(all.length);
    // O resultado é guardado enquanto a arquitetura não muda.
    expect(archSnapSegments(architecture, { levelId: null })).toBe(all);
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
  it('ponto do segmento mais próximo do cursor', () => {
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
