import {
  computeBounds,
  createTerrain,
  pipeLength,
  validateProject,
  vec3,
  type Pipe,
  type Project,
} from '@hydrobim/core';
import { buildElementGeometry } from '@hydrobim/geometry';
import { Box3, Quaternion, Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createBuildingDemoProject } from '../demo/buildingDemo';
import { createDemoProject } from '../demo/demoProject';
import { createEarthworkDemoProject } from '../demo/earthworkDemo';
import { createJunctionDemoProject } from '../demo/junctionDemo';
import { createReservationDemoProject } from '../demo/reservationDemo';
import { createTankDemoProject } from '../demo/tankDemo';
import { visibleElementsOf } from '../editor/visibility';
import { projectToXr, xrToProject, type VrPlacement } from './vrCoordinates';
import { vrArchInfo, vrElementInfo, vrProjectInfo } from './vrInfo';
import {
  IDLE_HAND,
  moveVector,
  readPad,
  stepHand,
  type HandAction,
  type PadState,
} from './vrInput';
import { buildVrModel } from './vrModel';
import { hitPanel, layoutPanel, panelHeightM, wrapText, type PanelSpec } from './vrPanel';
import { FrameMeter, sessionQuality, VR_HEAVY_TRIANGLES } from './vrPerformance';
import {
  findTeleportTarget,
  MAX_WALK_SLOPE,
  slopeAt,
  supportAt,
  teleportArc,
  vrStartOf,
  walkSurfacesOf,
} from './vrWalkable';

const ORIGIN = vec3(0, 0, 0);

const DEMOS: readonly (readonly [string, () => Project])[] = [
  ['barrilete', createDemoProject],
  ['edificação simples', createBuildingDemoProject],
  ['terraplenagem', createEarthworkDemoProject],
  ['ligações e derivações', createJunctionDemoProject],
  ['reservatórios', createTankDemoProject],
  ['centro de reservação', createReservationDemoProject],
];

describe('cena da rede para a realidade virtual', () => {
  it.each(DEMOS)('monta o projeto de demonstração "%s" sem alterá-lo', (_name, create) => {
    const project = create();
    const before = JSON.stringify(project);
    const model = buildVrModel(project, { origin: ORIGIN });
    expect(model.stats.elements).toBe(visibleElementsOf(project).length);
    if (model.stats.elements > 0) {
      expect(model.stats.triangles).toBeGreaterThan(0);
      expect(model.stats.instances).toBeGreaterThanOrEqual(model.stats.elements);
    }
    expect(JSON.stringify(project)).toBe(before);
    expect(validateProject(project).filter((issue) => issue.severity === 'error')).toEqual(
      validateProject(create()).filter((issue) => issue.severity === 'error'),
    );
    model.dispose();
  });

  it('reduz as chamadas de desenho: poucos lotes para a rede inteira', () => {
    const project = createDemoProject();
    const model = buildVrModel(project, { origin: ORIGIN });
    // Um lote por acabamento (rugosidade, metalicidade), não um por elemento.
    expect(model.stats.batches).toBeLessThan(model.stats.elements);
    expect(model.stats.batches).toBeLessThanOrEqual(12);
    expect(model.root.children).toHaveLength(model.stats.batches);
    // Malhas idênticas são guardadas uma só vez.
    expect(model.stats.geometries).toBeLessThanOrEqual(model.stats.instances);
    model.dispose();
  });

  it('preserva a identidade: o raio sobre cada elemento devolve o `id` dele no projeto', () => {
    const project = createDemoProject();
    const model = buildVrModel(project, { origin: ORIGIN });
    model.root.updateMatrixWorld(true);
    const raycaster = new Raycaster();
    const center = new Vector3();
    let checked = 0;
    for (const element of visibleElementsOf(project)) {
      const { transform, parts } = buildElementGeometry(element);
      const first = parts[0]?.mesh.positions;
      if (!first) continue;
      // Um vértice da malha do próprio elemento, no referencial do projeto.
      const vertex = new Vector3(first[0], first[1], first[2])
        .applyQuaternion({
          x: transform.rotation.x,
          y: transform.rotation.y,
          z: transform.rotation.z,
          w: transform.rotation.w,
        } as never)
        .add(new Vector3(transform.position.x, transform.position.y, transform.position.z));
      const bounds = computeBounds([element]);
      if (!bounds) continue;
      center.set(
        (bounds.min.x + bounds.max.x) / 2,
        (bounds.min.y + bounds.max.y) / 2,
        (bounds.min.z + bounds.max.z) / 2,
      );
      // De fora para dentro, passando pelo vértice: o elemento está entre os atingidos.
      const direction = center.clone().sub(vertex);
      if (direction.lengthSq() < 1e-12) continue;
      direction.normalize();
      raycaster.set(vertex.clone().addScaledVector(direction, -0.5), direction);
      const ids = raycaster.intersectObject(model.root, true).map((hit) => model.elementIdOf(hit));
      expect(ids).toContain(element.id);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(5);
    model.dispose();
  });

  it('mantém a escala 1:1 e as posições: a envoltória da cena é a do modelo', () => {
    const project = createDemoProject();
    // Envoltória dos vértices de todas as malhas, em coordenadas do projeto.
    const expected = new Box3();
    const vertex = new Vector3();
    const rotation = new Quaternion();
    for (const element of visibleElementsOf(project)) {
      const { transform, parts } = buildElementGeometry(element);
      rotation.set(
        transform.rotation.x,
        transform.rotation.y,
        transform.rotation.z,
        transform.rotation.w,
      );
      for (const part of parts) {
        const { positions } = part.mesh;
        for (let i = 0; i < positions.length; i += 3) {
          vertex
            .set(positions[i] ?? 0, positions[i + 1] ?? 0, positions[i + 2] ?? 0)
            .applyQuaternion(rotation);
          vertex.x += transform.position.x;
          vertex.y += transform.position.y;
          vertex.z += transform.position.z;
          expected.expandByPoint(vertex);
        }
      }
    }
    const origin = vec3(3, -2, 1);
    const model = buildVrModel(project, { origin });
    model.root.updateMatrixWorld(true);
    const box = new Box3();
    for (const child of model.root.children) {
      const batch = child as unknown as { boundingBox: Box3 | null };
      if (batch.boundingBox) box.union(batch.boundingBox);
    }
    // Mesmas dimensões (sem escala) e mesmas posições, a menos da origem local.
    const shift = new Vector3(origin.x, origin.y, origin.z);
    expect(box.min.clone().add(shift).distanceTo(expected.min)).toBeLessThan(1e-3);
    expect(box.max.clone().add(shift).distanceTo(expected.max)).toBeLessThan(1e-3);
    model.dispose();
  });

  it('um tubo mantém o comprimento e a orientação ao passar para o espaço da sessão', () => {
    const project = createDemoProject();
    const pipe = project.elements.find((element): element is Pipe => element.kind === 'pipe');
    expect(pipe).toBeDefined();
    if (!pipe) return;
    const placement: VrPlacement = { anchor: pipe.start, yaw: 0.9, floorY: 0 };
    const a = projectToXr(placement, pipe.start);
    const b = projectToXr(placement, pipe.end);
    expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)).toBeCloseTo(pipeLength(pipe), 9);
    // O desnível do tubo vira diferença de altura (Y), com o mesmo sinal.
    expect(b.y - a.y).toBeCloseTo(pipe.end.z - pipe.start.z, 9);
    const back = xrToProject(placement, b);
    expect(back.x).toBeCloseTo(pipe.end.x, 9);
    expect(back.y).toBeCloseTo(pipe.end.y, 9);
  });

  it('origem local: coordenadas UTM chegam à cena como números pequenos', () => {
    const project = createDemoProject();
    const shift = vec3(512_000, 7_456_000, 800);
    const moved: Project = {
      ...project,
      elements: project.elements.map((element) =>
        element.kind === 'pipe'
          ? {
              ...element,
              start: vec3(
                element.start.x + shift.x,
                element.start.y + shift.y,
                element.start.z + shift.z,
              ),
              end: vec3(element.end.x + shift.x, element.end.y + shift.y, element.end.z + shift.z),
            }
          : {
              ...element,
              placement: {
                ...element.placement,
                position: vec3(
                  element.placement.position.x + shift.x,
                  element.placement.position.y + shift.y,
                  element.placement.position.z + shift.z,
                ),
              },
            },
      ),
    };
    const near = buildVrModel(project, { origin: ORIGIN });
    const far = buildVrModel(moved, { origin: shift });
    const boxOf = (model: typeof near): Box3 => {
      const box = new Box3();
      for (const child of model.root.children) {
        const batch = child as unknown as { boundingBox: Box3 | null };
        if (batch.boundingBox) box.union(batch.boundingBox);
      }
      return box;
    };
    const a = boxOf(near);
    const b = boxOf(far);
    expect(b.min.distanceTo(a.min)).toBeLessThan(1e-3);
    expect(b.max.distanceTo(a.max)).toBeLessThan(1e-3);
    expect(b.max.length()).toBeLessThan(1000);
    near.dispose();
    far.dispose();
  });

  it('categoria oculta deixa de ser desenhada e de responder ao raio', () => {
    const project = createDemoProject();
    const pipe = project.elements.find((element): element is Pipe => element.kind === 'pipe');
    if (!pipe) throw new Error('demonstração sem tubos');
    const model = buildVrModel(project, { origin: ORIGIN });
    model.root.updateMatrixWorld(true);
    const middle = new Vector3(
      (pipe.start.x + pipe.end.x) / 2,
      (pipe.start.y + pipe.end.y) / 2,
      (pipe.start.z + pipe.end.z) / 2,
    );
    const axis = new Vector3(
      pipe.end.x - pipe.start.x,
      pipe.end.y - pipe.start.y,
      pipe.end.z - pipe.start.z,
    ).normalize();
    // Um raio perpendicular ao eixo, vindo de fora, atravessa a parede do tubo.
    const side = new Vector3(0, 0, 1).cross(axis);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const raycaster = new Raycaster(middle.clone().addScaledVector(side, 2), side.clone().negate());
    const hitIds = (): (string | null)[] =>
      raycaster.intersectObject(model.root, true).map((hit) => model.elementIdOf(hit));
    expect(hitIds()).toContain(pipe.id);
    model.setHiddenCategories(new Set(['pipes']));
    expect(hitIds()).not.toContain(pipe.id);
    model.setHiddenCategories(new Set());
    expect(hitIds()).toContain(pipe.id);
    model.dispose();
  });

  it('destaque do elemento selecionado não muda os lotes nem vira alvo do raio', () => {
    const project = createDemoProject();
    const element = project.elements[0];
    if (!element) throw new Error('demonstração vazia');
    const model = buildVrModel(project, { origin: ORIGIN });
    const batches = model.root.children.length;
    model.highlight(element.id);
    expect(model.root.children).toHaveLength(batches + 1);
    model.highlight('inexistente');
    expect(model.root.children).toHaveLength(batches);
    model.dispose();
  });

  it('limpeza: `dispose` esvazia a cena e libera os lotes', () => {
    const project = createDemoProject();
    const model = buildVrModel(project, { origin: ORIGIN });
    const element = project.elements[0];
    if (element) model.highlight(element.id);
    let disposed = 0;
    for (const child of model.root.children) {
      child.addEventListener('dispose' as never, () => {
        disposed += 1;
      });
    }
    model.dispose();
    expect(model.root.children).toHaveLength(0);
    expect(disposed).toBe(model.stats.batches);
  });

  it('sistema oculto no projeto fica fora da cena', () => {
    const project = createDemoProject();
    const system = project.systems[0];
    if (!system) throw new Error('demonstração sem sistemas');
    const hidden: Project = {
      ...project,
      systems: project.systems.map((s) => (s.id === system.id ? { ...s, visible: false } : s)),
    };
    const model = buildVrModel(hidden, { origin: ORIGIN });
    expect(model.stats.elements).toBe(
      project.elements.filter((element) => element.systemId !== system.id).length,
    );
    model.dispose();
  });

  it('cena pesada usa sombreamento barato; a geometria é a mesma', () => {
    const project = createDemoProject();
    const full = buildVrModel(project, { origin: ORIGIN });
    const cheap = buildVrModel(project, { origin: ORIGIN, cheapShadingAbove: 0 });
    expect(cheap.stats).toEqual(full.stats);
    const material = (cheap.root.children[0] as unknown as { material: { type: string } }).material;
    expect(material.type).toBe('MeshLambertMaterial');
    full.dispose();
    cheap.dispose();
  });
});

describe('propriedades mostradas no painel', () => {
  it('vêm do próprio elemento: categoria, identificação, diâmetro, material, comprimento, sistema', () => {
    const project = createDemoProject();
    const pipe = project.elements.find((element): element is Pipe => element.kind === 'pipe');
    if (!pipe) throw new Error('demonstração sem tubos');
    const info = vrElementInfo(project, pipe.id);
    expect(info?.title).toBe(pipe.name);
    const rows = new Map(info?.rows);
    expect(rows.get('Categoria')).toBe('Tubo');
    expect(rows.get('Identificação')).toBe(pipe.name);
    expect(rows.get('Diâmetro')).toContain(`DN ${pipe.spec.dn}`);
    expect(rows.get('Comprimento')).toContain(pipeLength(pipe).toFixed(3).replace('.', ','));
    expect(rows.get('Sistema')).toBe(project.systems.find((s) => s.id === pipe.systemId)?.name);
    expect(rows.has('Material')).toBe(true);
  });

  it('só mostra os campos que o elemento tem', () => {
    const project = createDemoProject();
    const fitting = project.elements.find((element) => element.kind !== 'pipe');
    if (!fitting) throw new Error('demonstração sem conexões');
    const rows = new Map(vrElementInfo(project, fitting.id)?.rows);
    expect(rows.has('Comprimento')).toBe(false);
    expect(rows.has('Cota')).toBe(true);
    expect(vrElementInfo(project, 'inexistente')).toBeNull();
  });

  it('arquitetura: categoria, tipo e nível do elemento', () => {
    const project = createBuildingDemoProject();
    const wall = project.architecture.elements.find((element) => element.kind === 'wall');
    if (!wall) throw new Error('demonstração sem paredes');
    const rows = new Map(vrArchInfo(project, wall.id)?.rows);
    expect(rows.get('Categoria')).toBe('Arquitetura · Parede');
    expect(rows.has('Nível')).toBe(true);
    expect(vrProjectInfo(project).title).toBe(project.name);
  });
});

describe('superfícies caminháveis e teletransporte', () => {
  const built = createTerrain('Rampa', [
    vec3(0, 0, 100),
    vec3(100, 0, 110),
    vec3(100, 100, 110),
    vec3(0, 100, 100),
  ]);
  if (!built.ok) throw new Error(built.error.message);
  const ramp = built.value;
  const empty = createDemoProject();

  it('projeto sem terreno nem pisos recebe um piso virtual, fora do modelo', () => {
    const surfaces = walkSurfacesOf(empty, { terrain: null, virtualElevation: 2.5 });
    expect(surfaces.map((surface) => surface.kind)).toEqual(['virtual']);
    expect(supportAt(surfaces, 1234, -987)).toBe(2.5);
    expect(empty.architecture.elements).toHaveLength(
      createDemoProject().architecture.elements.length,
    );
  });

  it('com terreno, só o terreno é caminhável (não há piso virtual)', () => {
    const surfaces = walkSurfacesOf(empty, { terrain: ramp, virtualElevation: 0 });
    expect(surfaces.map((surface) => surface.kind)).toEqual(['terrain']);
    expect(supportAt(surfaces, 50, 50)).toBeCloseTo(105);
    expect(supportAt(surfaces, 500, 500)).toBeNull();
  });

  it('lajes e pisos da arquitetura são caminháveis; o topo de outras peças, não', () => {
    const building = createBuildingDemoProject();
    const surfaces = walkSurfacesOf(building, { terrain: null, virtualElevation: 0 });
    expect(surfaces.length).toBeGreaterThan(0);
    expect(surfaces.every((surface) => surface.kind === 'floor')).toBe(true);
    const floorIds = new Set(
      building.architecture.elements
        .filter((element) => element.kind === 'slab' || element.kind === 'flooring')
        .map((element) => element.id),
    );
    expect(surfaces.every((surface) => floorIds.has(surface.id))).toBe(true);
    // Pisos ocultos deixam de ser alvo; sem nenhum, entra o piso virtual.
    const hidden = walkSurfacesOf(building, {
      terrain: null,
      virtualElevation: 0,
      hiddenCategories: new Set(['floors']),
    });
    expect(hidden.map((surface) => surface.kind)).toEqual(['virtual']);
  });

  it('o arco chega ao piso virtual descendo sobre ele', () => {
    const surfaces = walkSurfacesOf(empty, { terrain: null, virtualElevation: 0 });
    // Arco em coordenadas do projeto: sai de 1,2 m de altura, para o norte.
    const arc = teleportArc(vec3(0, 1.2, 0), vec3(0, 0.5, -0.866)).map((p) =>
      xrToProject({ anchor: vec3(0, 0, 0), yaw: 0, floorY: 0 }, p),
    );
    const target = findTeleportTarget(arc, surfaces);
    expect(target.valid).toBe(true);
    expect(target.point?.z).toBeCloseTo(0, 6);
    expect(target.point?.y).toBeGreaterThan(3);
    expect(Math.abs(target.point?.x ?? 1)).toBeLessThan(1e-9);
  });

  it('recusa quando o arco não encontra superfície', () => {
    const surfaces = walkSurfacesOf(empty, { terrain: ramp, virtualElevation: 0 });
    // Longe do terreno: nada sob o arco.
    const arc = [vec3(500, 500, 120), vec3(505, 500, 110), vec3(510, 500, 90)];
    expect(findTeleportTarget(arc, surfaces)).toMatchObject({
      valid: false,
      point: null,
      reason: 'none',
    });
  });

  it('não atravessa o piso por baixo', () => {
    const surfaces = walkSurfacesOf(empty, { terrain: null, virtualElevation: 3 });
    const arc = [vec3(0, 0, 1), vec3(0, 1, 2), vec3(0, 2, 4), vec3(0, 3, 5)];
    expect(findTeleportTarget(arc, surfaces).point).toBeNull();
  });

  it('pousa na cota do terreno e recusa talude íngreme', () => {
    const gentle = walkSurfacesOf(empty, { terrain: ramp, virtualElevation: 0 });
    const arc = [vec3(50, 50, 108), vec3(51, 50, 106), vec3(52, 50, 104), vec3(53, 50, 102)];
    const target = findTeleportTarget(arc, gentle);
    expect(target.valid).toBe(true);
    expect(target.point?.z).toBeCloseTo(100 + (target.point?.x ?? 0) / 10, 2);
    const [surface] = gentle;
    if (!surface) throw new Error('sem superfície');
    expect(slopeAt(surface, 50, 50)).toBeCloseTo(Math.atan(0.1), 3);
    expect(slopeAt(surface, 50, 50)).toBeLessThan(MAX_WALK_SLOPE);

    // Com o desenho exagerado 10×, a mesma rampa passa de 35°.
    const steep = walkSurfacesOf(empty, { terrain: ramp, exaggeration: 10, virtualElevation: 0 });
    const high = [vec3(50, 50, 160), vec3(51, 50, 150), vec3(52, 50, 140)];
    expect(findTeleportTarget(high, steep)).toMatchObject({ valid: false, reason: 'steep' });
  });

  it('ponto de partida: ao sul do modelo, olhando para o norte, apoiado', () => {
    const start = vrStartOf(empty, { terrain: null, workPlaneZ: 0 });
    const bounds = computeBounds(empty.elements);
    if (!bounds) throw new Error('demonstração vazia');
    expect(start.feet.y).toBeLessThan(bounds.min.y);
    expect(start.heading).toBeCloseTo(Math.PI / 2);
    expect(start.focus).not.toBeNull();

    const terrainProject = createEarthworkDemoProject();
    const onTerrain = vrStartOf(terrainProject, {
      terrain: terrainProject.terrain,
      workPlaneZ: 0,
    });
    expect(Number.isFinite(onTerrain.feet.z)).toBe(true);
  });
});

describe('controles', () => {
  const pad = (x: number, y: number, menu = false): PadState => ({ x, y, menu });
  const run = (...states: PadState[]): HandAction[] => {
    let state = IDLE_HAND;
    const actions: HandAction[] = [];
    for (const next of states) {
      const step = stepHand(state, next);
      state = step.state;
      actions.push(...step.actions);
    }
    return actions;
  };

  it('lê o direcional no mapeamento xr-standard', () => {
    const gamepad = {
      axes: [0, 0, 0.5, -0.8],
      buttons: [false, false, false, false, true].map((pressed) => ({ pressed })),
    };
    expect(readPad(gamepad)).toEqual({ x: 0.5, y: -0.8, menu: true });
    expect(readPad(null)).toBeNull();
  });

  it('direcional para a frente mira; soltar confirma o teletransporte', () => {
    expect(run(pad(0, -0.9), pad(0, -0.9))).toEqual([]);
    expect(run(pad(0, -0.9), pad(0, 0))).toEqual(['teleport']);
    expect(run(pad(0, -0.9), pad(0, 0.9))).toEqual(['cancelTeleport']);
  });

  it('giro por etapas: um por toque, sem repetição enquanto o direcional fica de lado', () => {
    expect(run(pad(0.9, 0), pad(0.9, 0), pad(0.9, 0))).toEqual(['turnRight']);
    expect(run(pad(-0.9, 0), pad(0, 0), pad(-0.9, 0))).toEqual(['turnLeft', 'turnLeft']);
  });

  it('não gira enquanto mira nem logo depois de soltar com o direcional de lado', () => {
    expect(run(pad(0, -0.9), pad(0.9, -0.5), pad(0.2, 0))).toEqual(['teleport']);
  });

  it('mão de caminhada: o direcional anda, não mira nem gira', () => {
    const moving = (...states: PadState[]): HandAction[] => {
      let state = IDLE_HAND;
      const actions: HandAction[] = [];
      for (const next of states) {
        const step = stepHand(state, next, 'move');
        state = step.state;
        actions.push(...step.actions);
        expect(state.aiming).toBe(false);
      }
      return actions;
    };
    expect(moving(pad(0, -1), pad(0, 0), pad(1, 0), pad(0, 0))).toEqual([]);
    expect(moving(pad(0, -1, true), pad(0, -1, true))).toEqual(['menu']);
  });

  it('caminhada: folga central, proporcional à inclinação, nunca acima de 1', () => {
    expect(moveVector(pad(0.05, -0.1))).toEqual({ ahead: 0, right: 0 });
    expect(moveVector(pad(0, -1))).toEqual({ ahead: 1, right: 0 });
    expect(moveVector(pad(1, 0))).toEqual({ ahead: 0, right: 1 });
    const half = moveVector(pad(0, -0.575));
    expect(half.ahead).toBeCloseTo(0.5);
    const corner = moveVector(pad(1, -1));
    expect(Math.hypot(corner.ahead, corner.right)).toBeCloseTo(1);
  });

  it('botão de face abre o menu uma vez por toque', () => {
    expect(run(pad(0, 0, true), pad(0, 0, true), pad(0, 0), pad(0, 0, true))).toEqual([
      'menu',
      'menu',
    ]);
  });
});

describe('painéis', () => {
  const spec: PanelSpec = {
    title: 'Menu',
    rows: [['Material', 'PVC']],
    buttons: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
      { id: 'exit', label: 'Sair', wide: true },
    ],
  };

  it('dispõe os botões em duas colunas, com os largos em linha própria, sem sobreposição', () => {
    const layout = layoutPanel(spec);
    const buttons = layout.items.filter((item) => item.kind === 'button');
    expect(buttons).toHaveLength(4);
    const [a, b, c, exit] = buttons.map((item) => item.rect);
    if (!a || !b || !c || !exit) throw new Error('layout incompleto');
    expect(a.y).toBe(b.y);
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
    expect(c.y).toBeGreaterThanOrEqual(a.y + a.height);
    expect(exit.y).toBeGreaterThanOrEqual(c.y + c.height);
    expect(exit.y + exit.height).toBeLessThanOrEqual(layout.height);
    expect(panelHeightM(layout)).toBeGreaterThan(0.2);
  });

  it('acerta o botão sob o raio, com v medido de baixo para cima', () => {
    const layout = layoutPanel(spec);
    for (const item of layout.items) {
      if (item.kind !== 'button') continue;
      const u = (item.rect.x + item.rect.width / 2) / layout.width;
      const v = 1 - (item.rect.y + item.rect.height / 2) / layout.height;
      expect(hitPanel(layout, u, v)?.id).toBe(item.button.id);
    }
    expect(hitPanel(layout, 0.5, 0.99)).toBeNull();
  });

  it('quebra o texto sem cortar palavras', () => {
    expect(wrapText('um dois três quatro', 8)).toEqual(['um dois', 'três', 'quatro']);
  });
});

describe('desempenho', () => {
  it('cena leve: resolução nativa, foveação máxima, 72 Hz', () => {
    expect(sessionQuality({ triangles: 10_000 }, null)).toEqual({
      framebufferScale: 1,
      foveation: 1,
      targetFrameRate: 72,
    });
  });

  it('reduz a resolução quando a cena é pesada ou a sessão anterior foi lenta', () => {
    const heavy = { triangles: VR_HEAVY_TRIANGLES + 1 };
    expect(sessionQuality(heavy, null).framebufferScale).toBe(0.85);
    expect(sessionQuality({ triangles: 10 }, 50).framebufferScale).toBe(0.85);
    expect(sessionQuality(heavy, 50).framebufferScale).toBe(0.7);
    expect(sessionQuality(heavy, 72).framebufferScale).toBe(0.85);
  });

  it('mede os quadros por segundo em janelas de um segundo', () => {
    const meter = new FrameMeter();
    let last: number | null = null;
    for (let i = 0; i < 71; i += 1) last = meter.tick(1 / 72) ?? last;
    expect(last).toBeNull();
    last = meter.tick(1 / 72) ?? meter.tick(1 / 72);
    expect(last).toBeCloseTo(72, 0);
    expect(meter.tick(Number.NaN)).toBeNull();
  });
});
