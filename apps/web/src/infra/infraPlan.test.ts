import {
  addPipe,
  createGeoTransform,
  createProject,
  createTerrain,
  findProjectedCrs,
  getElement,
  placeEquipment,
  vec3,
  type Georeference,
  type HydroElement,
  type Project,
} from '@hydrobim/core';
import { defaultPipeSpec } from '@hydrobim/catalog';
import { describe, expect, it } from 'vitest';
import {
  coordinateGrid,
  DETAIL_MIN_PX,
  elevationInfoAt,
  formatElevationInfo,
  infraLayerOf,
  intersects,
  isSimplified,
  labelOf,
  MAX_LABELS,
  parseCoordinatePair,
  placeLabels,
  planBoxOf,
  roundDown125,
  scaleBarFor,
  screenScaleOf,
  type PlanLabel,
} from './infraPlan';

const spec = defaultPipeSpec('infra');

function pipeProject(): { project: Project; pipe: HydroElement } {
  const result = addPipe(createProject('Rede', 'infra'), {
    start: vec3(0, 0, 100),
    end: vec3(120, 0, 100),
    spec,
  });
  if (!result.ok) throw new Error(result.error.message);
  const pipe = getElement(result.value.project, result.value.elementId);
  if (!pipe) throw new Error('Tubo não criado.');
  return { project: result.value.project, pipe };
}

function withTank(project: Project): HydroElement {
  const result = placeEquipment(project, {
    spec,
    fitting: { kind: 'tank' },
    position: vec3(300, 50, 98),
  });
  if (!result.ok) throw new Error(result.error.message);
  const tank = getElement(result.value.project, result.value.elementId);
  if (!tank) throw new Error('Reservatório não criado.');
  return tank;
}

describe('nível de detalhe', () => {
  it('desenha a geometria real quando ela é legível e o símbolo quando não é', () => {
    const { pipe } = pipeProject();
    const od = pipe.spec.outerDiameter;
    // No limite: o diâmetro externo ocupa exatamente DETAIL_MIN_PX pixels.
    expect(isSimplified(pipe, od / DETAIL_MIN_PX / 1.01)).toBe(false);
    expect(isSimplified(pipe, (od / DETAIL_MIN_PX) * 1.01)).toBe(true);
    // Vista de uma adutora inteira (5 m por pixel): eixo simplificado.
    expect(isSimplified(pipe, 5)).toBe(true);
  });

  it('a simplificação não altera o elemento', () => {
    const { pipe } = pipeProject();
    const before = JSON.stringify(pipe);
    isSimplified(pipe, 5);
    planBoxOf(pipe);
    expect(JSON.stringify(pipe)).toBe(before);
  });

  it('classifica as camadas e recorta pela janela', () => {
    const { project, pipe } = pipeProject();
    const tank = withTank(project);
    expect(infraLayerOf(pipe)).toBe('network');
    expect(infraLayerOf(tank)).toBe('equipment');
    const box = planBoxOf(pipe);
    expect(box.minX).toBeLessThan(0);
    expect(box.maxX).toBeGreaterThan(120);
    expect(intersects(box, { minX: 50, minY: -5, maxX: 60, maxY: 5 })).toBe(true);
    expect(intersects(box, { minX: 500, minY: 500, maxX: 600, maxY: 600 })).toBe(false);
  });
});

describe('altimetria', () => {
  it('diferencia eixo, geratrizes, terreno e recobrimento', () => {
    const terrain = createTerrain('Levantamento', [
      vec3(-10, -10, 102),
      vec3(200, -10, 102),
      vec3(200, 10, 102),
      vec3(-10, 10, 102),
    ]);
    if (!terrain.ok) throw new Error(terrain.error.message);
    const info = elevationInfoAt(terrain.value, vec3(50, 0, 100), 0.2);
    expect(info.axis).toBe(100);
    expect(info.crown).toBeCloseTo(100.1, 9);
    expect(info.invert).toBeCloseTo(99.9, 9);
    expect(info.ground).toBeCloseTo(102, 9);
    // Recobrimento até a geratriz superior externa, não até o eixo.
    expect(info.cover).toBeCloseTo(1.9, 9);
    expect(formatElevationInfo(info)).toContain('rec. 1,90 m');
  });

  it('sem terreno, ou fora da cobertura do levantamento, a cota fica desconhecida', () => {
    const none = elevationInfoAt(null, vec3(50, 0, 100), 0.2);
    expect(none.ground).toBeNull();
    expect(none.cover).toBeNull();
    expect(formatElevationInfo(none)).toContain('terreno: sem dado');
    const terrain = createTerrain('Levantamento', [
      vec3(0, 0, 102),
      vec3(10, 0, 102),
      vec3(0, 10, 102),
    ]);
    if (!terrain.ok) throw new Error(terrain.error.message);
    // Ponto fora do TIN: nada é extrapolado.
    const outside = elevationInfoAt(terrain.value, vec3(500, 500, 100), 0.2);
    expect(outside.ground).toBeNull();
    expect(outside.cover).toBeNull();
  });
});

describe('rótulos', () => {
  const none = { names: false, lengths: false, elevations: false };

  it('identifica trechos com nome, comprimento real e cotas do eixo', () => {
    const { pipe } = pipeProject();
    expect(labelOf(pipe, none, null)).toBeNull();
    const label = labelOf(pipe, { names: true, lengths: true, elevations: true }, null);
    expect(label?.text).toBe(`${pipe.name} · 120,00 m · eixo 100,00 m → 100,00 m`);
    // O rótulo fica no meio do trecho.
    expect(label?.x).toBe(60);
    expect(label?.y).toBe(0);
  });

  it('nos nós, informa as cotas e o terreno como desconhecido quando não há levantamento', () => {
    const { project } = pipeProject();
    const tank = withTank(project);
    const label = labelOf(tank, { ...none, elevations: true }, null);
    expect(label?.text).toContain('eixo 98,00 m');
    expect(label?.text).toContain('terreno: sem dado');
  });

  it('descarta rótulos sobrepostos, preferindo os mais importantes', () => {
    const labels: PlanLabel[] = [
      { id: 'a', x: 0, y: 0, text: 'Trecho curto', priority: 5 },
      { id: 'b', x: 1, y: 0.5, text: 'Reservatório R1', priority: 1e6 },
      { id: 'c', x: 500, y: 0, text: 'Trecho distante', priority: 5 },
    ];
    // A 1 m por pixel, "a" e "b" ocupam o mesmo lugar: fica o nó.
    expect(placeLabels(labels, 1).map((l) => l.id)).toEqual(['b', 'c']);
    // Aproximando (1 cm por pixel) há espaço para todos.
    expect(
      placeLabels(labels, 0.01)
        .map((l) => l.id)
        .sort(),
    ).toEqual(['a', 'b', 'c']);
  });

  it('respeita o teto de rótulos por vista', () => {
    const many: PlanLabel[] = Array.from({ length: 2000 }, (_, i) => ({
      id: `t${i}`,
      x: (i % 50) * 400,
      y: Math.floor(i / 50) * 400,
      text: `Trecho ${i}`,
      priority: i,
    }));
    expect(placeLabels(many, 1)).toHaveLength(MAX_LABELS);
  });
});

describe('barra de escala e malha de coordenadas', () => {
  it('usa valores redondos', () => {
    expect(roundDown125(1)).toBe(1);
    expect(roundDown125(4.9)).toBe(2);
    expect(roundDown125(73)).toBe(50);
    expect(roundDown125(0.03)).toBeCloseTo(0.02, 12);
    expect(roundDown125(0)).toBe(0);
    const bar = scaleBarFor(2.5, 140);
    expect(bar.meters).toBe(200);
    expect(bar.pixels).toBe(80);
    expect(bar.label).toBe('200 m');
    expect(scaleBarFor(20).label).toBe('2 km');
  });

  it('distingue o zoom da tela da escala de documentação', () => {
    // 96 px por polegada: 1 px = 0,2646 mm. A 0,2646 m por pixel a tela está em 1:1000.
    expect(screenScaleOf(0.0254 / 96)).toBeCloseTo(1, 9);
    expect(screenScaleOf((0.0254 / 96) * 1000)).toBeCloseTo(1000, 6);
  });

  it('sem georreferência, a malha é a das coordenadas locais', () => {
    const grid = coordinateGrid({ minX: -120, minY: -40, maxX: 380, maxY: 260 }, 1, null);
    expect(grid.step).toBe(100);
    expect(grid.lines.filter((l) => l.axis === 'X').map((l) => l.value)).toEqual([
      -100, 0, 100, 200, 300,
    ]);
    expect(grid.lines.filter((l) => l.axis === 'Y').map((l) => l.value)).toEqual([0, 100, 200]);
  });

  it('com georreferência, as linhas são de E e N constantes, mesmo com a quadrícula girada', () => {
    const geo: Georeference = {
      crsName: 'SIRGAS 2000 / UTM zone 23S',
      epsg: 31983,
      eastings: 333287.0215,
      northings: 7394586.0934,
      orthogonalHeight: 760,
      rotation: 0.4,
      verticalDatum: null,
    };
    const crs = findProjectedCrs(31983);
    if (!crs) throw new Error('CRS de teste não suportado.');
    const transform = createGeoTransform(geo, crs);
    const bounds = { minX: -300, minY: -200, maxX: 300, maxY: 200 };
    const grid = coordinateGrid(bounds, 1, transform);
    expect(grid.lines.length).toBeGreaterThan(4);
    for (const line of grid.lines) {
      const a = transform.localToProjected(line.from);
      const b = transform.localToProjected(line.to);
      const [va, vb] = line.axis === 'E' ? [a.e, b.e] : [a.n, b.n];
      expect(va).toBeCloseTo(line.value, 6);
      expect(vb).toBeCloseTo(line.value, 6);
      expect(line.value % grid.step).toBe(0);
      // Recortada pela janela.
      for (const p of [line.from, line.to]) {
        expect(p.x).toBeGreaterThanOrEqual(bounds.minX - 1e-6);
        expect(p.x).toBeLessThanOrEqual(bounds.maxX + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(bounds.minY - 1e-6);
        expect(p.y).toBeLessThanOrEqual(bounds.maxY + 1e-6);
      }
    }
  });
});

describe('navegação por coordenadas', () => {
  it('interpreta pares com vírgula decimal, milhar e separadores usuais', () => {
    expect(parseCoordinatePair('333287,02; 7394586,09')).toEqual({ a: 333287.02, b: 7394586.09 });
    expect(parseCoordinatePair('333.287,02 ; 7.394.586,09')).toEqual({
      a: 333287.02,
      b: 7394586.09,
    });
    expect(parseCoordinatePair('333287.02 7394586.09')).toEqual({ a: 333287.02, b: 7394586.09 });
    expect(parseCoordinatePair('-12,5; 40')).toEqual({ a: -12.5, b: 40 });
  });

  it('recusa entradas incompletas ou não numéricas', () => {
    expect(parseCoordinatePair('')).toBeNull();
    expect(parseCoordinatePair('333287')).toBeNull();
    expect(parseCoordinatePair('a; b')).toBeNull();
    expect(parseCoordinatePair('1; 2; 3')).toBeNull();
  });
});

/**
 * Cenário de desempenho reproduzível (ver docs/INFRA.md): adutora de 10 km com 2.000 trechos de
 * 5 m. As metas (50 ms e 100 ms) valem para as funções que rodam a cada movimento da vista.
 * O limite de cada teste é cinco vezes a meta: com a máquina ocupada por outros processos o
 * tempo medido oscila, e o teste existe para acusar regressões de ordem de grandeza.
 */
describe('desempenho: rede de 10 km com 2.000 trechos', () => {
  const pipes: HydroElement[] = [];
  let project = createProject('Adutora 10 km', 'infra');
  for (let i = 0; i < 2000; i += 1) {
    const result = addPipe(project, {
      start: vec3(i * 5, Math.sin(i / 40) * 30, 100),
      end: vec3(i * 5 + 4.9, Math.sin((i + 1) / 40) * 30, 100),
      spec,
    });
    if (!result.ok) throw new Error(result.error.message);
    project = result.value.project;
  }
  for (const element of project.elements) pipes.push(element);

  it('recorte da janela e nível de detalhe de toda a rede (meta: 50 ms)', () => {
    const view = { minX: 2000, minY: -400, maxX: 3500, maxY: 400 };
    const started = performance.now();
    const visible = pipes.filter((pipe) => intersects(planBoxOf(pipe), view));
    const simplified = visible.filter((pipe) => isSimplified(pipe, 1)).length;
    const elapsed = performance.now() - started;
    expect(visible.length).toBeGreaterThan(250);
    expect(visible.length).toBeLessThan(350);
    expect(simplified).toBe(visible.length);
    expect(elapsed).toBeLessThan(250);
  });

  it('rótulos de toda a rede, com controle de sobreposição (meta: 100 ms)', () => {
    const started = performance.now();
    const candidates = pipes
      .map((pipe) => labelOf(pipe, { names: true, lengths: true, elevations: false }, null))
      .filter((label): label is PlanLabel => label !== null);
    const placed = placeLabels(candidates, 2);
    const elapsed = performance.now() - started;
    expect(candidates).toHaveLength(2000);
    expect(placed.length).toBeGreaterThan(10);
    expect(placed.length).toBeLessThanOrEqual(MAX_LABELS);
    expect(elapsed).toBeLessThan(500);
  });
});
