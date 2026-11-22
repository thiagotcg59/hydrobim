import {
  getArchType,
  setArchElementIfcValue,
  updateView,
  vec3,
  viewArchElementsOf,
  type ArchElement,
  type PlanProjectView,
  type Project,
  type ViewFrame,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { createBuildingDemoProject } from '../demo/buildingDemo';
import {
  ARCH_LAYERS,
  archBoundsOf,
  archLayerOf,
  archNotablePoints,
  archProjectionOf,
  archSnapPoints,
  archViewEntryOf,
  formatSpaceArea,
  sectionHatchOf,
  spaceLabelsOf,
  swingToView,
  WALL_EXTERNAL_KEY,
  type ArchViewEntry,
} from './archView';

const demo = createBuildingDemoProject();

function planOf(project: Project): PlanProjectView {
  const view = project.views.find((entry) => entry.kind === 'plan');
  if (!view || view.kind !== 'plan') throw new Error('a demonstração não tem planta');
  return view;
}

function entriesOf(project: Project, view = planOf(project)): ArchViewEntry[] {
  const projection = archProjectionOf(project, view);
  return viewArchElementsOf(project, view).flatMap((element) => {
    const entry = archViewEntryOf(project, element, projection);
    return entry ? [entry] : [];
  });
}

const typeNamed = (project: Project, name: string) => {
  const type = project.architecture.types.find((entry) => entry.name === name);
  if (!type) throw new Error(`tipo ausente: ${name}`);
  return type;
};

const windowsOf = (project: Project, typeName: string): ArchElement[] => {
  const type = typeNamed(project, typeName);
  return project.architecture.elements.filter(
    (element) => element.kind === 'window' && element.typeId === type.id,
  );
};

describe('hachura da seção', () => {
  it('usa a camada estrutural do tipo', () => {
    expect(sectionHatchOf(typeNamed(demo, 'Alvenaria cerâmica 18 cm'))).toBe('diagonal');
    expect(sectionHatchOf(typeNamed(demo, 'Laje maciça 12 cm'))).toBe('dotted');
    // Drywall: a estrutura de montantes não tem hachura, embora haja outras camadas.
    expect(sectionHatchOf(typeNamed(demo, 'Drywall 9,5 cm'))).toBe('none');
  });

  it('sem camada estrutural, usa a mais espessa', () => {
    const wall = typeNamed(demo, 'Alvenaria cerâmica 18 cm');
    if (wall.category !== 'wall') throw new Error('tipo inesperado');
    const layers = wall.layers.map((layer, index) => ({
      ...layer,
      function: 'other' as const,
      hatch: index === 1 ? ('crossed' as const) : ('solid' as const),
    }));
    expect(sectionHatchOf({ ...wall, layers })).toBe('crossed');
  });

  it('revestimentos de piso e esquadrias não são hachurados', () => {
    expect(sectionHatchOf(typeNamed(demo, 'Porcelanato sobre contrapiso'))).toBe('none');
    expect(sectionHatchOf(typeNamed(demo, 'Porta de giro 80 × 210'))).toBe('none');
    expect(sectionHatchOf(undefined)).toBe('none');
  });
});

describe('camada do elemento', () => {
  const wall = demo.architecture.elements.find((element) => element.kind === 'wall');
  if (!wall) throw new Error('sem parede');

  it('não presume parede externa nem interna', () => {
    expect(archLayerOf(wall)).toBe(ARCH_LAYERS.wall);
  });

  it('segue Pset_WallCommon.IsExternal quando informada', () => {
    const external = setArchElementIfcValue(demo, wall.id, WALL_EXTERNAL_KEY, true);
    const internal = setArchElementIfcValue(demo, wall.id, WALL_EXTERNAL_KEY, false);
    if (!external.ok || !internal.ok) throw new Error('valor IFC recusado');
    const find = (project: Project) =>
      project.architecture.elements.find((element) => element.id === wall.id) ?? wall;
    expect(archLayerOf(find(external.value))).toBe('Parede_Externa');
    expect(archLayerOf(find(internal.value))).toBe('Parede_Interna');
  });

  it('esquadrias, pisos e ambientes', () => {
    const of = (kind: ArchElement['kind']) => {
      const element = demo.architecture.elements.find((entry) => entry.kind === kind);
      if (!element) throw new Error(`sem ${kind}`);
      return archLayerOf(element);
    };
    expect(of('door')).toBe('Esquadrias');
    expect(of('window')).toBe('Esquadrias');
    expect(of('slab')).toBe(ARCH_LAYERS.floor);
    expect(of('space')).toBe(ARCH_LAYERS.spaces);
  });
});

describe('planta da edificação de demonstração', () => {
  const entries = entriesOf(demo);
  const byKind = (kind: ArchElement['kind']) =>
    entries.filter((entry) => entry.element.kind === kind);

  it('corta as paredes e projeta lajes e pisos', () => {
    const walls = byKind('wall');
    expect(walls).toHaveLength(5);
    for (const wall of walls) {
      expect(wall.cut.length).toBeGreaterThan(0);
      expect(wall.cut[0]?.path).toMatch(/^M.*Z$/);
      expect(wall.projected).not.toBeNull();
    }
    for (const floor of [...byKind('slab'), ...byKind('flooring')]) {
      expect(floor.cut).toHaveLength(0);
      expect(floor.projected).not.toBeNull();
      expect(floor.above).toBeNull();
    }
  });

  it('desenha as portas cortadas com folha aberta e sem a folha fechada', () => {
    const doors = byKind('door');
    expect(doors).toHaveLength(2);
    for (const door of doors) {
      expect(door.swings.length).toBeGreaterThan(0);
      expect(door.cut.some((part) => part.role === 'frame')).toBe(true);
      expect(door.cut.some((part) => part.role === 'joinery')).toBe(false);
    }
    // Giro: folha e arco; correr: só a folha recolhida.
    const arcs = doors.map((door) => door.swings.filter((swing) => swing.arc !== null).length);
    expect(arcs.sort()).toEqual([0, 1]);
  });

  it('corta a janela de peitoril 1,10 m e projeta, tracejada, a de peitoril 1,60 m', () => {
    const cut = new Set(windowsOf(demo, 'Janela de correr 120 × 100').map((w) => w.id));
    const high = new Set(windowsOf(demo, 'Maxim-ar 80 × 60').map((w) => w.id));
    for (const entry of byKind('window')) {
      if (cut.has(entry.element.id)) {
        expect(entry.cut.map((part) => part.role).sort()).toEqual(['frame', 'glass']);
        expect(entry.above).toBeNull();
      }
      if (high.has(entry.element.id)) {
        expect(entry.cut).toHaveLength(0);
        expect(entry.projected).toBeNull();
        expect(entry.above).not.toBeNull();
      }
    }
    expect(cut.size).toBe(2);
    expect(high.size).toBe(1);
  });

  it('baixar o plano de corte da arquitetura deixa de cortar as janelas', () => {
    const view = planOf(demo);
    const lowered = updateView(demo, view.id, { archCutHeight: 0.9 });
    if (!lowered.ok) throw new Error(lowered.error.message);
    const after = entriesOf(lowered.value);
    const windows = after.filter((entry) => entry.element.kind === 'window');
    expect(windows).toHaveLength(3);
    for (const window of windows) {
      expect(window.cut).toHaveLength(0);
      expect(window.above).not.toBeNull();
    }
    expect(
      after.filter((entry) => entry.element.kind === 'wall' && entry.cut.length > 0),
    ).toHaveLength(5);
  });

  it('a seção fica acima da parte projetada na ordem de desenho', () => {
    const wall = byKind('wall')[0];
    const slab = byKind('slab')[0];
    expect(wall?.depth).toBeCloseTo(1.2, 6);
    expect(slab?.depth).toBeCloseTo(0, 6);
  });

  it('guarda o desenho enquanto a arquitetura é a mesma', () => {
    const view = planOf(demo);
    const projection = archProjectionOf(demo, view);
    const wall = demo.architecture.elements[0];
    if (!wall) throw new Error('sem elementos');
    const first = archViewEntryOf(demo, wall, projection);
    expect(archViewEntryOf(demo, wall, archProjectionOf(demo, view))).toBe(first);
    // Outro objeto de arquitetura (qualquer alteração): tudo é refeito.
    const changed = { ...demo, architecture: { ...demo.architecture } };
    expect(archViewEntryOf(changed, wall, projection)).not.toBe(first);
  });

  it('ocultar a categoria tira as paredes da vista', () => {
    const view = planOf(demo);
    const hidden = updateView(demo, view.id, {
      visibility: { ...view.visibility, hiddenCategories: ['walls'] },
    });
    if (!hidden.ok) throw new Error(hidden.error.message);
    expect(entriesOf(hidden.value).some((entry) => entry.element.kind === 'wall')).toBe(false);
  });
});

describe('corte e elevação', () => {
  const view = {
    ...planOf(demo),
    kind: 'section' as const,
    a: { x: -1, y: 2 },
    b: { x: 7, y: 2 },
    side: 1 as const,
    depth: 3,
  };

  it('o corte vertical secciona as paredes que a linha atravessa', () => {
    const projection = archProjectionOf(demo, view);
    expect(projection.span).toEqual({ from: 0, to: 8 });
    const entries = demo.architecture.elements.flatMap((element) => {
      const entry = archViewEntryOf(demo, element, projection);
      return entry ? [entry] : [];
    });
    const cutWalls = entries.filter(
      (entry) => entry.element.kind === 'wall' && entry.cut.length > 0,
    );
    // Linha em y = 2: atravessa as paredes oeste e leste e a divisória.
    expect(cutWalls).toHaveLength(3);
    expect(entries.some((entry) => entry.element.kind === 'slab' && entry.cut.length > 0)).toBe(
      true,
    );
    expect(entries.every((entry) => entry.swings.length === 0 && entry.above === null)).toBe(true);
    expect(spaceLabelsOf(demo, demo.architecture.elements, projection)).toHaveLength(0);
  });

  it('a elevação não corta nada', () => {
    const elevation = { ...view, kind: 'elevation' as const, direction: 'south' as const };
    const projection = archProjectionOf(demo, elevation);
    expect(projection.cut).toBeNull();
    const entries = demo.architecture.elements.flatMap((element) => {
      const entry = archViewEntryOf(demo, element, projection);
      return entry ? [entry] : [];
    });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.cut.length === 0)).toBe(true);
  });

  it('o telhado aparece cortado no corte transversal e projetado na elevação', () => {
    const roof = demo.architecture.elements.find((element) => element.kind === 'roof');
    if (!roof) throw new Error('a demonstração não tem telhado');
    expect(archLayerOf(roof)).toBe(ARCH_LAYERS.roof);
    // Corte em x = 3, atravessando as duas águas (a cumeeira corre ao longo de X).
    const across = { ...view, a: { x: 3, y: -2 }, b: { x: 3, y: 6 }, depth: 5 };
    const cut = archViewEntryOf(demo, roof, archProjectionOf(demo, across));
    expect(cut?.cut.length).toBeGreaterThan(0);
    expect(cut?.cut[0]?.role).toBe('roof');
    // Topo da cumeeira: 2,80 + (4,18 ÷ 2) × 30 % + espessura na vertical.
    const vertical = 0.12 / Math.cos(Math.atan(0.3));
    expect(cut?.bounds.max.y).toBeCloseTo(2.8 + 2.09 * 0.3 + vertical, 6);
    // Borda do beiral, 0,50 m para fora: 15 cm abaixo da cota de referência.
    expect(cut?.bounds.min.y).toBeCloseTo(2.8 - 0.15, 6);
    const elevation = { ...view, kind: 'elevation' as const, direction: 'south' as const };
    const seen = archViewEntryOf(demo, roof, archProjectionOf(demo, elevation));
    expect(seen?.projected).not.toBeNull();
    expect(seen?.cut).toHaveLength(0);
    // Na planta do térreo o telhado está inteiro acima do plano de corte: dentro da faixa da
    // vista aparece só em projeção (tracejado), sem seção; acima dela, não é desenhado.
    const plan = archProjectionOf(demo, planOf(demo));
    const above = archViewEntryOf(demo, roof, plan);
    if ((plan.band?.top ?? 0) > 2.8 - 0.15) {
      expect(above?.above).not.toBeNull();
      expect(above?.cut).toHaveLength(0);
      expect(above?.projected).toBeNull();
    } else expect(above).toBeNull();
    // Os cantos do contorno, dos beirais e as pontas da cumeeira são pontos de captura.
    expect(archNotablePoints(demo.architecture, roof)).toHaveLength(10);
  });
});

describe('símbolo da porta na vista', () => {
  it('acompanha o giro da planta sem mudar o raio nem o sentido', () => {
    const swing = {
      leaf: [
        { x: 1, y: 0 },
        { x: 1, y: 0.8 },
      ] as const,
      arc: { center: { x: 1, y: 0 }, radius: 0.8, from: 0, to: Math.PI / 2 },
    };
    const turned: ViewFrame = {
      origin: vec3(0, 0, 0),
      u: vec3(0, 1, 0),
      v: vec3(-1, 0, 0),
      w: vec3(0, 0, 1),
    };
    const shown = swingToView(swing, turned);
    // Projeto (1; 0) → vista (0; −1); (1; 0,8) → (0,8; −1).
    expect(shown.leaf[0].x).toBeCloseTo(0, 9);
    expect(shown.leaf[0].y).toBeCloseTo(-1, 9);
    expect(shown.leaf[1].x).toBeCloseTo(0.8, 9);
    expect(shown.leaf[1].y).toBeCloseTo(-1, 9);
    expect(shown.arc?.radius).toBe(0.8);
    expect(shown.arc?.large).toBe(false);
    const { from, to } = shown.arc ?? { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } };
    const center = shown.leaf[0];
    expect(Math.hypot(from.x - center.x, from.y - center.y)).toBeCloseTo(0.8, 9);
    expect(Math.hypot(to.x - center.x, to.y - center.y)).toBeCloseTo(0.8, 9);
    // Anti-horário de `from` a `to` em torno do centro.
    const turn = (from.x - center.x) * (to.y - center.y) - (from.y - center.y) * (to.x - center.x);
    expect(turn).toBeGreaterThan(0);
  });

  it('porta de correr não tem arco', () => {
    const shown = swingToView(
      {
        leaf: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      },
      { origin: vec3(0, 0, 0), u: vec3(1, 0, 0), v: vec3(0, 1, 0), w: vec3(0, 0, 1) },
    );
    expect(shown.arc).toBeNull();
  });
});

describe('ambientes e captura', () => {
  const view = planOf(demo);
  const projection = archProjectionOf(demo, view);
  const elements = viewArchElementsOf(demo, view);

  it('rotula os ambientes com número, nome e área de duas casas', () => {
    const labels = spaceLabelsOf(demo, elements, projection);
    expect(labels.map((label) => label.lines[0])).toEqual(['01 Sala', '02 Banheiro']);
    expect(labels[0]?.lines[1]).toBe(formatSpaceArea(3.8625 * 3.82));
    expect(labels[0]?.lines[1]).toBe('14,75 m²');
    expect(labels[0]?.center.x).toBeCloseTo((0.09 + 3.9525) / 2, 6);
    expect(labels[0]?.center.y).toBeCloseTo(2, 6);
    expect(labels[0]?.ring).toHaveLength(4);
  });

  it('enxerga extremidades e cantos de paredes, vãos e pisos', () => {
    const points = archSnapPoints(demo, elements, projection);
    const has = (x: number, y: number): boolean =>
      points.some((p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6);
    // Extremidade da linha de referência e canto externo da envoltória (parede de 18 cm).
    expect(has(0, 0)).toBe(true);
    expect(has(-0.09, -0.09)).toBe(true);
    // Cantos do vão da porta (centro a 1,20 m, 0,80 m de largura) nas duas faces.
    expect(has(0.8, -0.09)).toBe(true);
    expect(has(1.6, 0.09)).toBe(true);
    // Canto da abertura do shaft na laje.
    expect(has(5.3, 3.3)).toBe(true);
  });

  it('vãos têm quatro cantos; ambientes, o contorno', () => {
    const door = demo.architecture.elements.find((element) => element.kind === 'door');
    const space = demo.architecture.elements.find((element) => element.kind === 'space');
    if (!door || !space) throw new Error('demonstração incompleta');
    expect(archNotablePoints(demo.architecture, door)).toHaveLength(4);
    expect(archNotablePoints(demo.architecture, space)).toHaveLength(4);
  });

  it('em corte, só captura o que os planos da vista deixam à mostra', () => {
    const section = {
      ...view,
      kind: 'section' as const,
      a: { x: -1, y: 2 },
      b: { x: 7, y: 2 },
      side: 1 as const,
      depth: 0.5,
    };
    const points = archSnapPoints(
      demo,
      demo.architecture.elements,
      archProjectionOf(demo, section),
    );
    expect(points.length).toBeGreaterThan(0);
    // Olhando para +Y a partir de y = 2 com 0,5 m de alcance: nada da parede sul (y ≈ 0).
    const all = archSnapPoints(
      demo,
      demo.architecture.elements,
      archProjectionOf(demo, { ...section, depth: 10 }),
    );
    expect(all.length).toBeGreaterThan(points.length);
  });

  it('a envoltória cobre a edificação', () => {
    const bounds = archBoundsOf(entriesOf(demo), spaceLabelsOf(demo, elements, projection));
    expect(bounds?.min.x).toBeLessThanOrEqual(-0.09 + 1e-6);
    expect(bounds?.max.x).toBeGreaterThanOrEqual(6.09 - 1e-6);
    expect(archBoundsOf([], [])).toBeNull();
  });

  it('o tipo de demonstração existe (referência dos testes)', () => {
    const wall = demo.architecture.elements.find((element) => element.kind === 'wall');
    expect(
      wall && wall.kind === 'wall' && getArchType(demo.architecture, wall.typeId),
    ).toBeTruthy();
  });
});
