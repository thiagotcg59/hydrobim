import {
  addAnnotation,
  addPipe,
  attachFitting,
  createProject,
  createTerrain,
  insertInline,
  vec3,
  type AnnotationInput,
  type PipeSpec,
  type Project,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { exportModelDxf } from './model';
import { chainSegments, mergeCollinear } from './chain';
import { exportPlanDxf, PLAN_LAYERS } from './plan';
import { aciFromHex, DxfDocument, encodeDxf, encodeText, formatNumber, layerName } from './writer';

const spec: PipeSpec = {
  specificationId: 'teste',
  material: 'pvc',
  standard: 'Norma de teste',
  jointType: 'solventWeld',
  pressureClass: null,
  dn: 100,
  sizeLabel: 'DN 100',
  outerDiameter: 0.1,
  wallThickness: 0.005,
  innerDiameter: 0.09,
};

interface Entity {
  type: string;
  layer: string;
  /** Valores por código de grupo, na ordem em que aparecem. */
  codes: Map<number, string[]>;
}

interface Parsed {
  /** Entidades do espaço do modelo. */
  entities: Entity[];
  /** Entidades de cada definição de bloco. */
  blocks: Map<string, Entity[]>;
  /** Cor de cada camada (negativa = desligada). */
  layers: Map<string, number>;
  /** Tipo e espessura de linha (centésimos de mm) de cada camada. */
  layerStyle: Map<string, { linetype: string; lineweight: number }>;
  raw: string[];
}

/** Leitor mínimo: valida a estrutura em pares e devolve entidades, blocos e camadas. */
function parse(dxf: string): Parsed {
  const raw = dxf.split('\n');
  expect(raw.pop()).toBe('');
  expect(raw.length % 2).toBe(0);
  const pairs: [number, string][] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const code = Number(raw[i]);
    if (!Number.isInteger(code)) throw new Error(`código de grupo inválido: ${raw[i]}`);
    pairs.push([code, raw[i + 1] ?? '']);
  }
  expect(pairs.at(-1)).toEqual([0, 'EOF']);

  const entities: Entity[] = [];
  const blocks = new Map<string, Entity[]>();
  const layers = new Map<string, number>();
  const layerStyle = new Map<string, { linetype: string; lineweight: number }>();
  let section = '';
  let table = '';
  let current: Entity | null = null;
  let layerEntry: string | null = null;
  let block: Entity[] | null = null;
  let blockHeader = false;
  pairs.forEach(([code, value], i) => {
    if (code === 0) {
      current = null;
      layerEntry = null;
      blockHeader = false;
      if (value === 'SECTION') section = pairs[i + 1]?.[1] ?? '';
      else if (value === 'TABLE') table = pairs[i + 1]?.[1] ?? '';
      else if (section === 'ENTITIES' && value !== 'ENDSEC' && value !== 'EOF') {
        current = { type: value, layer: '', codes: new Map() };
        entities.push(current);
      } else if (section === 'BLOCKS' && value === 'BLOCK') {
        block = [];
        blockHeader = true;
      } else if (section === 'BLOCKS' && value === 'ENDBLK') block = null;
      else if (section === 'BLOCKS' && value !== 'ENDSEC' && block) {
        current = { type: value, layer: '', codes: new Map() };
        block.push(current);
      } else if (section === 'TABLES' && table === 'LAYER' && value === 'LAYER') layerEntry = '';
      return;
    }
    if (current) {
      if (code === 8) current.layer = value;
      const values = current.codes.get(code);
      if (values) values.push(value);
      else current.codes.set(code, [value]);
    } else if (blockHeader && block) {
      if (code === 2) blocks.set(value, block);
    } else if (layerEntry !== null) {
      if (code === 2) {
        layerEntry = value;
        layerStyle.set(value, { linetype: '', lineweight: Number.NaN });
      }
      const style = layerStyle.get(layerEntry);
      if (code === 62) layers.set(layerEntry, Number(value));
      if (code === 6 && style) style.linetype = value;
      if (code === 370 && style) style.lineweight = Number(value);
    }
  });
  // Toda entidade está em uma camada declarada, e o arquivo é ASCII puro.
  const all = [...entities, ...[...blocks.values()].flat()];
  expect(all.filter((entity) => !layers.has(entity.layer))).toEqual([]);
  // Todo caractere do arquivo tem um byte no Windows-1252 (nenhum vira "?").
  const bytes = encodeDxf(dxf);
  expect(bytes.length).toBe(dxf.length);
  expect(bytes.includes(0x3f)).toBe(dxf.includes('?'));

  // R2000: handles únicos, todos abaixo de $HANDSEED, e toda entidade com o seu.
  if (dxf.includes('$ACADVER\n1\nAC1015')) {
    const handles: number[] = [];
    let seed = 0;
    let dimStyle = false;
    pairs.forEach(([code, value], i) => {
      if (code === 0) dimStyle = value === 'DIMSTYLE';
      if (pairs[i - 1]?.[1] === '$HANDSEED') seed = Number.parseInt(value, 16);
      else if ((code === 5 && !dimStyle) || code === 105) handles.push(Number.parseInt(value, 16));
    });
    expect(new Set(handles).size).toBe(handles.length);
    expect(Math.max(...handles)).toBeLessThan(seed);
    expect(all.filter((entity) => !entity.codes.has(5))).toEqual([]);
  }
  return { entities, blocks, layers, layerStyle, raw };
}

/**
 * Segmentos (x1, y1, x2, y2) de linhas e polilinhas. Com `blocks`, as referências de bloco
 * são resolvidas para coordenadas do desenho (posição e rotação da inserção).
 */
function segmentsOf(
  entities: Entity[],
  blocks?: Map<string, Entity[]>,
): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const e of entities) {
    if (e.type === 'LINE') out.push([num(e, 10), num(e, 20), num(e, 11), num(e, 21)]);
    if (e.type === 'INSERT' && blocks) {
      const angle = (num(e, 50) * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const place = (x: number, y: number): [number, number] => [
        num(e, 10) + x * cos - y * sin,
        num(e, 20) + x * sin + y * cos,
      ];
      for (const [x1, y1, x2, y2] of segmentsOf(blocks.get(e.codes.get(2)?.[0] ?? '') ?? [])) {
        out.push([...place(x1, y1), ...place(x2, y2)]);
      }
    }
    if (e.type !== 'LWPOLYLINE') continue;
    const xs = (e.codes.get(10) ?? []).map(Number);
    const ys = (e.codes.get(20) ?? []).map(Number);
    expect(xs).toHaveLength(num(e, 90));
    const last = num(e, 70) === 1 ? xs.length : xs.length - 1;
    for (let i = 0; i < last; i += 1) {
      const j = (i + 1) % xs.length;
      out.push([xs[i] ?? 0, ys[i] ?? 0, xs[j] ?? 0, ys[j] ?? 0]);
    }
  }
  return out;
}

const num = (entity: Entity, code: number, index = 0): number =>
  Number(entity.codes.get(code)?.[index]);

function must<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function annotate(project: Project, input: AnnotationInput): Project {
  return must(addAnnotation(project, input)).project;
}

/** Tubo ao longo de X na cota 0 e outro ao longo de Y, cruzando por cima (cota 1). */
function crossing(): { project: Project; low: string; high: string } {
  const first = must(
    addPipe(createProject('Estação — teste', 'mep'), {
      start: vec3(0, 0, 0),
      end: vec3(4, 0, 0),
      spec,
    }),
  );
  const second = must(addPipe(first.project, { start: vec3(2, -1, 1), end: vec3(2, 1, 1), spec }));
  return { project: second.project, low: first.elementId, high: second.elementId };
}

describe('escritor DXF', () => {
  it('formata números sem notação científica e textos em ASCII', () => {
    expect(formatNumber(1e-7)).toBe('0');
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(12.5)).toBe('12.5');
    expect(formatNumber(1234567.123456)).toBe('1234567.123456');
    expect(() => formatNumber(Number.NaN)).toThrow();
    expect(encodeText('CASA DE MÁQUINAS — Ø')).toBe('CASA DE MÁQUINAS — Ø');
    expect(layerName('Água fria / recalque')).toBe('AGUA_FRIA_RECALQUE');
    // Fora do Windows-1252 o caractere vira a sequência Unicode do DXF.
    expect(encodeText('θ = 45° ^')).toBe('\\U+03B8 = 45° ^ ');
    expect([...encodeDxf('Á—€z')]).toEqual([0xc1, 0x97, 0x80, 0x7a]);
  });

  it('aproxima cores do sistema por cores ACI', () => {
    expect(aciFromHex('#ff0000')).toBe(1);
    expect(aciFromHex('#0000ff')).toBe(5);
    expect(aciFromHex('#ffffff')).toBe(7);
    expect(aciFromHex('#101010')).toBe(7);
    const aci = aciFromHex('#3e8fff');
    expect(aci).toBeGreaterThanOrEqual(10);
    expect(aci).toBeLessThan(250);
  });

  it('não repete nomes de camada e divide malhas acima do limite do formato', () => {
    const doc = new DxfDocument();
    const a = doc.addLayer('Água', 1);
    const b = doc.addLayer('Agua', 2);
    expect(a).not.toBe(b);
    // 40 000 triângulos independentes: 120 000 vértices.
    const vertices: number[] = [];
    const faces: number[] = [];
    for (let i = 0; i < 40000; i += 1) {
      vertices.push(i, 0, 0, i + 1, 0, 0, i, 1, 0);
      faces.push(i * 3, i * 3 + 1, i * 3 + 2);
    }
    doc.polyface(a, vertices, faces);
    const { entities } = parse(doc.toString());
    const meshes = entities.filter((e) => e.type === 'POLYLINE');
    expect(meshes.length).toBeGreaterThan(1);
    let total = 0;
    for (const mesh of meshes) {
      expect(num(mesh, 71)).toBeLessThanOrEqual(32767);
      total += num(mesh, 72);
    }
    expect(total).toBe(40000);
  });
});

describe('chainSegments', () => {
  it('une segmentos em polilinhas, fecha anéis e elimina vértices de trechos retos', () => {
    // Retângulo com um lado dividido em dois e um segmento solto.
    const chains = chainSegments([
      0, 0, 1, 0, 1, 0, 2, 0, 2, 0, 2, 1, 2, 1, 0, 1, 0, 1, 0, 0, 5, 5, 6, 5,
    ]);
    expect(chains).toHaveLength(2);
    const ring = chains.find((chain) => chain.closed);
    expect(ring?.points).toHaveLength(8);
    expect(chains.find((chain) => !chain.closed)?.points).toEqual([5, 5, 6, 5]);
  });

  it('funde segmentos colineares sobrepostos antes de encadear', () => {
    // A boca de um tubo vista de perfil: quatro pedaços sobre a mesma reta, a partir do eixo.
    expect(
      mergeCollinear([0, 0, 0, 0.05, 0, 0, 0, 0.045, 0, 0, 0, -0.05, 0, 0, 0, -0.045]),
    ).toEqual([0, -0.05, 0, 0.05]);
    // Paralelos afastados e colineares separados continuam distintos.
    expect(mergeCollinear([0, 0, 1, 0, 0, 0.01, 1, 0.01, 2, 0, 3, 0])).toHaveLength(12);
    // Com as bocas fundidas, o contorno do tubo fecha em um retângulo.
    const chains = chainSegments([
      0, 0, 0, 0.05, 0, 0, 0, -0.05, 0, 0.05, 4, 0.05, 0, -0.05, 4, -0.05, 4, 0, 4, 0.05, 4, 0, 4,
      -0.05,
    ]);
    expect(chains).toHaveLength(1);
    expect(chains[0]?.closed).toBe(true);
    expect(chains[0]?.points).toHaveLength(8);
  });

  it('interrompe as polilinhas nas bifurcações', () => {
    // Um "Y": três segmentos, em direções diferentes, saindo do mesmo ponto.
    const chains = chainSegments([0, 0, 1, 0, 1, 0, 2, 1, 1, 0, 2, -1]);
    expect(chains).toHaveLength(3);
    for (const chain of chains) expect(chain.closed).toBe(false);
  });
});

describe('exportPlanDxf', () => {
  it('gera um R2000 em metros com as camadas da rede, cores, tipos e espessuras', () => {
    const { project } = crossing();
    const { entities, blocks, layers, layerStyle, raw } = parse(exportPlanDxf(project));
    const file = raw.join('\n');
    expect(file).toContain('$ACADVER\n1\nAC1015');
    expect(file).toContain('$DWGCODEPAGE\n3\nANSI_1252');
    expect(file).toContain('$INSUNITS\n70\n6');
    for (const table of ['VPORT', 'LTYPE', 'LAYER', 'STYLE', 'APPID', 'DIMSTYLE', 'BLOCK_RECORD']) {
      expect(file).toContain(`0\nTABLE\n2\n${table}\n`);
    }
    expect(file).toContain('2\n*Model_Space\n');
    expect(file).toContain('0\nSECTION\n2\nOBJECTS\n0\nDICTIONARY\n');

    expect([...layers.keys()].sort()).toEqual(['0', ...Object.values(PLAN_LAYERS)].sort());
    // Cores distintas por categoria; nada fica na camada 0 do modelo.
    const colors = Object.values(PLAN_LAYERS).map((name) => Math.abs(layers.get(name) ?? 0));
    expect(new Set(colors).size).toBeGreaterThanOrEqual(9);
    expect(entities.filter((e) => e.layer === '0')).toEqual([]);
    expect(layerStyle.get(PLAN_LAYERS.pipes)).toEqual({ linetype: 'Continuous', lineweight: 25 });
    expect(layerStyle.get(PLAN_LAYERS.dimensions)?.lineweight).toBe(18);
    // Eixos: traço e ponto, em camada desligada (a planta da tela não os mostra).
    expect(layerStyle.get(PLAN_LAYERS.axes)?.linetype).toBe('HB_EIXO');
    expect(layers.get(PLAN_LAYERS.axes)).toBeLessThan(0);
    expect(file).toContain('2\nHB_EIXO\n');
    const axes = entities.filter((e) => e.layer === PLAN_LAYERS.axes);
    expect(axes.map((e) => e.type)).toEqual(['LINE', 'LINE']);
    expect(segmentsOf(axes)).toContainEqual([0, 0, 4, 0]);

    // Cada tubo é uma referência de bloco; o contorno está na definição.
    const pipes = entities.filter((e) => e.layer === PLAN_LAYERS.pipes);
    expect(pipes.map((e) => e.type)).toEqual(['INSERT', 'INSERT']);
    const lines = segmentsOf(pipes, blocks);
    expect(lines.length).toBeGreaterThan(4);
    // A geratriz do tubo baixo está em y = ±0,05 (diâmetro externo de 100 mm).
    const ys = lines.flatMap((line) => [line[1], line[3]]);
    expect(Math.min(...ys)).toBeCloseTo(-1, 3);
    expect(lines.some((line) => Math.abs(line[1] - 0.05) < 1e-4)).toBe(true);
  });

  it('exporta cada trecho de tubo como um bloco próprio, separado nas conexões', () => {
    // Um tubo de 6 m dividido por um tê fora do meio (dois trechos diferentes) e dois tubos
    // soltos iguais entre si, em direções diferentes.
    const pipe = must(
      addPipe(createProject('Trechos', 'infra'), {
        start: vec3(0, 0, 0),
        end: vec3(6, 0, 0),
        spec,
      }),
    );
    const tee = must(
      insertInline(pipe.project, {
        pipeId: pipe.elementId,
        distanceFromStart: 2,
        fitting: { kind: 'tee' },
      }),
    );
    const loose = must(addPipe(tee.project, { start: vec3(10, 1, 0), end: vec3(10, 3, 0), spec }));
    const project = must(
      addPipe(loose.project, { start: vec3(20, 5, 0), end: vec3(22, 5, 0), spec }),
    ).project;

    const { entities, blocks } = parse(exportPlanDxf(project));
    const inserts = entities.filter((e) => e.layer === PLAN_LAYERS.pipes);
    const pipes = project.elements.filter((e) => e.kind === 'pipe');
    expect(pipes).toHaveLength(4);
    // Um objeto por trecho, e nada solto na camada dos tubos.
    expect(inserts.map((e) => e.type)).toEqual(['INSERT', 'INSERT', 'INSERT', 'INSERT']);
    for (const insert of inserts) expect(insert.codes.get(2)?.[0]).toMatch(/^HB_TUBO_\d+$/);
    // Trechos iguais (mesmo tubo, mesmo comprimento) usam o mesmo bloco, a 0° e a 90°.
    const names = inserts.map((e) => e.codes.get(2)?.[0] ?? '');
    expect(new Set(names).size).toBe(3);
    const shared = inserts.filter((e) => names.filter((n) => n === e.codes.get(2)?.[0]).length > 1);
    expect(shared.map((e) => num(e, 50)).sort((p, q) => p - q)).toEqual([0, 90]);

    // A definição é o contorno do trecho em uma única polilinha, sem linhas soltas nem
    // repetidas. No tubo solto é um retângulo fechado de 4 vértices; junto a uma conexão, a
    // ponta encoberta por ela pode ficar aberta, como na tela.
    for (const name of new Set(names)) {
      const definition = blocks.get(name) ?? [];
      expect(definition.map((e) => e.type)).toEqual(['LWPOLYLINE']);
      expect(definition[0] && num(definition[0], 90)).toBe(4);
    }
    const free = blocks.get(shared[0]?.codes.get(2)?.[0] ?? '') ?? [];
    expect(free[0] && num(free[0], 70)).toBe(1);
    // Cada inserção fica no início do seu trecho e o contorno vai até o fim dele.
    for (const element of pipes) {
      if (element.kind !== 'pipe') continue;
      const insert = inserts.find(
        (e) =>
          Math.abs(num(e, 10) - element.start.x) < 1e-6 &&
          Math.abs(num(e, 20) - element.start.y) < 1e-6,
      );
      if (!insert) throw new Error('inserção ausente');
      const lines = segmentsOf([insert], blocks);
      const xs = lines.flatMap((line) => [line[0], line[2]]);
      const ys = lines.flatMap((line) => [line[1], line[3]]);
      const radius = spec.outerDiameter / 2;
      const along = element.end.y === element.start.y;
      expect(Math.min(...xs)).toBeCloseTo(
        Math.min(element.start.x, element.end.x) - (along ? 0 : radius),
        5,
      );
      expect(Math.max(...xs)).toBeCloseTo(
        Math.max(element.start.x, element.end.x) + (along ? 0 : radius),
        5,
      );
      expect(Math.min(...ys)).toBeCloseTo(
        Math.min(element.start.y, element.end.y) - (along ? radius : 0),
        5,
      );
      expect(Math.max(...ys)).toBeCloseTo(
        Math.max(element.start.y, element.end.y) + (along ? radius : 0),
        5,
      );
    }
    // Entre os dois trechos da linha fica o tê, também um bloco.
    expect(entities.filter((e) => e.layer === PLAN_LAYERS.fittings).map((e) => e.type)).toEqual([
      'INSERT',
    ]);
  });

  it('esconde o trecho do tubo baixo coberto pelo tubo que passa por cima', () => {
    const { project } = crossing();
    const { entities, blocks } = parse(exportPlanDxf(project));
    const spans = segmentsOf(
      entities.filter((e) => e.layer === PLAN_LAYERS.pipes),
      blocks,
    )
      .filter((line) => Math.abs(line[1] - 0.05) < 1e-4 && Math.abs(line[3] - 0.05) < 1e-4)
      .map((line) => [Math.min(line[0], line[2]), Math.max(line[0], line[2])] as const)
      .sort((p, q) => p[0] - q[0]);
    // Nenhum trecho visível dentro da faixa coberta (x entre 1,95 e 2,05)…
    for (const [from, to] of spans) expect(to <= 1.95 + 1e-3 || from >= 2.05 - 1e-3).toBe(true);
    // …e o restante da geratriz continua lá, de 0 a 4 m.
    const length = spans.reduce((sum, [from, to]) => sum + to - from, 0);
    expect(length).toBeCloseTo(3.9, 2);
    expect(spans[0]?.[0]).toBeCloseTo(0, 3);
    expect(spans.at(-1)?.[1]).toBeCloseTo(4, 3);
  });

  it('exporta as cotas como DIMENSION, com o traçado da tela no bloco da cota', () => {
    const { project: base } = crossing();
    let project: Project = { ...base, drawingScale: 50 };
    project = annotate(project, {
      kind: 'dimension',
      a: { x: 0, y: 0 },
      b: { x: 4, y: 0 },
      mode: 'horizontal',
      offset: -0.5,
    });
    project = annotate(project, {
      kind: 'dimension',
      a: { x: 0, y: 0 },
      b: { x: 3, y: 4 },
      mode: 'aligned',
      offset: 1,
    });
    const { entities, blocks, raw } = parse(exportPlanDxf(project));
    const [horizontal, aligned] = entities.filter((e) => e.type === 'DIMENSION');
    if (!horizontal || !aligned) throw new Error('cotas ausentes');
    expect(horizontal.layer).toBe(PLAN_LAYERS.dimensions);
    expect(horizontal.codes.get(3)).toEqual(['HB_COTA']);
    // Linear a 0°, com os pontos cotados e a linha de cota 0,5 m abaixo.
    expect(num(horizontal, 70)).toBe(32);
    expect(num(horizontal, 50)).toBe(0);
    expect([num(horizontal, 13), num(horizontal, 23)]).toEqual([0, 0]);
    expect([num(horizontal, 14), num(horizontal, 24)]).toEqual([4, 0]);
    expect([num(horizontal, 10), num(horizontal, 20)]).toEqual([4, -0.5]);
    expect(num(horizontal, 42)).toBe(4);
    // Sem texto fixo: o CAD escreve o valor medido e o atualiza ao editar a cota.
    expect(horizontal.codes.has(1)).toBe(false);
    // Texto centrado na linha de cota, acima dela.
    expect(num(horizontal, 11)).toBeCloseTo(2, 6);
    expect(num(horizontal, 21)).toBeGreaterThan(-0.5);
    expect(num(horizontal, 21)).toBeLessThan(-0.3);

    // Alinhada: tipo 1, sem ângulo; mede 5 m.
    expect(num(aligned, 70)).toBe(33);
    expect(aligned.codes.has(50)).toBe(false);
    expect(num(aligned, 42)).toBeCloseTo(5, 9);

    // Bloco anônimo da cota: linha de cota, duas linhas de chamada, dois traços e o texto,
    // na camada 0 e com a cor da cota (ByBlock).
    const block = blocks.get(horizontal.codes.get(2)?.[0] ?? '');
    expect(block?.filter((e) => e.type === 'LINE')).toHaveLength(5);
    const label = block?.find((e) => e.type === 'TEXT');
    expect(label?.codes.get(1)).toEqual(['4,00']);
    expect(label && num(label, 72)).toBe(1);
    expect(label && num(label, 11)).toBeCloseTo(2, 6);
    for (const entity of block ?? []) {
      expect(entity.layer).toBe('0');
      expect(num(entity, 62)).toBe(0);
    }

    // Estilo da cota: traço oblíquo, duas casas, vírgula e texto de 2,5 mm em 1:50.
    const file = raw.join('\n');
    const from = file.indexOf('2\nHB_COTA\n');
    const style = file.slice(from, file.indexOf('0\nENDTAB', from));
    expect(style).toContain(`\n140\n${0.125 * 0.72}\n`);
    expect(style).toContain('\n271\n2\n');
    expect(style).toContain('\n278\n44\n');
    expect(style).toMatch(/\n142\n0\.0318\d*\n/);
  });

  it('fixa o texto da cota quando ele difere do valor medido pelo CAD', () => {
    const { project: base } = crossing();
    const project = annotate(base, {
      kind: 'dimension',
      a: { x: 0, y: 0 },
      b: { x: 1234.5, y: 0 },
      mode: 'horizontal',
      offset: 1,
    });
    const { entities } = parse(exportPlanDxf(project));
    const dimension = entities.find((e) => e.type === 'DIMENSION');
    expect(dimension?.codes.get(1)).toEqual(['1.234,50']);
  });

  it('exporta textos, chamadas e etiquetas nas camadas próprias, com o tamanho da escala', () => {
    const { project: base, low } = crossing();
    let project: Project = { ...base, drawingScale: 50 };
    project = annotate(project, {
      kind: 'text',
      position: { x: 1, y: 2 },
      text: 'CASA DE MÁQUINAS\nNÍVEL 1',
      rotation: Math.PI / 6,
    });
    project = annotate(project, {
      kind: 'text',
      position: { x: 3, y: 1.5 },
      text: 'RECALQUE',
      rotation: 0,
      leader: { x: 3, y: 0 },
    });
    project = annotate(project, { kind: 'tag', elementId: low, position: { x: 1, y: 0.3 } });

    const { entities } = parse(exportPlanDxf(project));
    const texts = entities.filter((e) => e.type === 'TEXT');
    const content = (layer: string): string[] =>
      texts.filter((e) => e.layer === layer).map((e) => e.codes.get(1)?.[0] ?? '');

    // Texto de papel de 2,5 mm em 1:50 = corpo de 0,125 m; maiúsculas a 72 %.
    for (const text of texts) expect(num(text, 40)).toBeCloseTo(0.125 * 0.72, 6);

    expect(content(PLAN_LAYERS.texts)).toEqual(['CASA DE MÁQUINAS', 'NÍVEL 1', 'RECALQUE']);
    const rotated = texts.find((e) => e.codes.get(1)?.[0] === 'NÍVEL 1');
    expect(rotated && num(rotated, 50)).toBeCloseTo(30, 6);
    // Chamada: linha e seta preenchida.
    const leader = entities.filter((e) => e.layer === PLAN_LAYERS.texts);
    expect(leader.filter((e) => e.type === 'SOLID')).toHaveLength(1);
    expect(leader.filter((e) => e.type === 'LINE')).toHaveLength(1);
    // Etiqueta de tubo (designação e extensão), paralela ao trecho e centrada.
    expect(content(PLAN_LAYERS.diameters)).toEqual(['DN 100 — 4,00 m']);
    const tag = texts.find((e) => e.layer === PLAN_LAYERS.diameters);
    expect(tag && num(tag, 72)).toBe(1);
    expect(tag && num(tag, 11)).toBeCloseTo(1, 6);
    expect(content(PLAN_LAYERS.caption)).toEqual(['ESTAÇÃO — TESTE — PLANTA BAIXA — ESC. 1:50']);
    // Ainda não há cotas de nível no projeto: a camada existe, vazia.
    expect(entities.filter((e) => e.layer === PLAN_LAYERS.levels)).toEqual([]);
  });

  it('insere conexões e registros como blocos, reaproveitando projeções iguais', () => {
    // Dois tubos em direções diferentes, cada um com um registro na ponta, e um tê em linha.
    const along = must(
      addPipe(createProject('Blocos', 'infra'), {
        start: vec3(0, 0, 0),
        end: vec3(4, 0, 0),
        spec,
      }),
    );
    const across = must(
      addPipe(along.project, { start: vec3(10, 0, 0), end: vec3(10, 3, 0), spec }),
    );
    const first = must(
      attachFitting(across.project, {
        target: { elementId: along.elementId, portId: 'end' },
        fitting: { kind: 'valve' },
      }),
    );
    const second = must(
      attachFitting(first.project, {
        target: { elementId: across.elementId, portId: 'end' },
        fitting: { kind: 'valve' },
      }),
    );
    const tee = must(
      insertInline(second.project, {
        pipeId: along.elementId,
        distanceFromStart: 2,
        fitting: { kind: 'tee' },
      }),
    );
    const project = annotate(tee.project, {
      kind: 'tag',
      elementId: first.elementId,
      position: { x: 5, y: 1 },
    });

    const { entities, blocks } = parse(exportPlanDxf(project));
    const inserts = entities.filter((e) => e.type === 'INSERT');
    const valves = inserts.filter((e) => e.layer === PLAN_LAYERS.valves);
    expect(valves).toHaveLength(2);
    expect(inserts.filter((e) => e.layer === PLAN_LAYERS.fittings)).toHaveLength(1);
    // Os dois registros são iguais: um só bloco, inserido a 0° e a 90°.
    expect(new Set(valves.map((e) => e.codes.get(2)?.[0])).size).toBe(1);
    expect(valves.map((e) => num(e, 50)).sort((p, q) => p - q)).toEqual([0, 90]);
    const name = valves[0]?.codes.get(2)?.[0] ?? '';
    expect(name).toMatch(/^HB_REGISTRO_\d+$/);
    const definition = blocks.get(name) ?? [];
    expect(definition.length).toBeGreaterThan(0);
    for (const entity of definition) expect(entity.layer).toBe('0');
    // O bloco está em coordenadas locais: cabe em torno da origem.
    for (const line of segmentsOf(definition)) {
      for (const value of line) expect(Math.abs(value)).toBeLessThan(1);
    }
    // Inserção na posição do elemento (coordenadas do projeto).
    const valve = project.elements.find((e) => e.id === first.elementId);
    if (!valve || valve.kind !== 'valve') throw new Error('registro ausente');
    const placed = valves.find((e) => num(e, 50) === 0);
    expect(placed && num(placed, 10)).toBeCloseTo(valve.placement.position.x, 6);
    expect(placed && num(placed, 20)).toBeCloseTo(valve.placement.position.y, 6);
    // Etiqueta de componente: identificação com linha de chamada.
    const identification = entities.filter((e) => e.layer === PLAN_LAYERS.identifications);
    expect(identification.map((e) => e.type).sort()).toEqual(['CIRCLE', 'LINE', 'TEXT']);
  });

  it('não desenha elementos de sistemas ocultos', () => {
    const { project } = crossing();
    const hidden: Project = {
      ...project,
      systems: project.systems.map((s) => ({ ...s, visible: false })),
    };
    const { entities } = parse(exportPlanDxf(hidden));
    expect(entities).toEqual([]);
  });

  it('gera a mesma planta em R12, sem handles nem LWPOLYLINE', () => {
    const { project: base } = crossing();
    const project = annotate(base, {
      kind: 'dimension',
      a: { x: 0, y: 0 },
      b: { x: 4, y: 0 },
      mode: 'horizontal',
      offset: -0.5,
    });
    const { entities, blocks, layers, raw } = parse(exportPlanDxf(project, { version: 'R12' }));
    const file = raw.join('\n');
    expect(file).toContain('$ACADVER\n1\nAC1009');
    expect(file).not.toContain('AcDb');
    expect(file).not.toContain('LWPOLYLINE');
    expect(layers.has(PLAN_LAYERS.pipes)).toBe(true);
    // Os tubos são blocos; no R12 o contorno é uma POLYLINE clássica.
    const pipe = entities.find((e) => e.type === 'INSERT' && e.layer === PLAN_LAYERS.pipes);
    expect(blocks.get(pipe?.codes.get(2)?.[0] ?? '')?.some((e) => e.type === 'POLYLINE')).toBe(
      true,
    );
    const dimension = entities.find((e) => e.type === 'DIMENSION');
    // O R12 não tem casas decimais nem separador no estilo: o texto vai fixo.
    expect(dimension?.codes.get(1)).toEqual(['4,00']);
    expect(blocks.get('*D1')?.some((e) => e.type === 'TEXT')).toBe(true);
  });
});

describe('exportModelDxf', () => {
  it('exporta cada parte como malha poliface em coordenadas do projeto', () => {
    const { project } = crossing();
    const { entities } = parse(exportModelDxf(project));
    const meshes = entities.filter((e) => e.type === 'POLYLINE');
    expect(meshes.length).toBeGreaterThanOrEqual(2);
    for (const mesh of meshes) expect(num(mesh, 70)).toBe(64);

    const vertices = entities.filter((e) => e.type === 'VERTEX' && num(e, 70) === 192);
    const faces = entities.filter((e) => e.type === 'VERTEX' && num(e, 70) === 128);
    expect(meshes.reduce((sum, m) => sum + num(m, 71), 0)).toBe(vertices.length);
    expect(meshes.reduce((sum, m) => sum + num(m, 72), 0)).toBe(faces.length);
    expect(entities.filter((e) => e.type === 'SEQEND')).toHaveLength(meshes.length);

    // Envoltória: tubo baixo de x = 0 a 4 (raio 0,05) e tubo alto na cota 1.
    const xs = vertices.map((v) => num(v, 10));
    const zs = vertices.map((v) => num(v, 30));
    expect(Math.min(...xs)).toBeCloseTo(0, 4);
    expect(Math.max(...xs)).toBeCloseTo(4, 4);
    expect(Math.min(...zs)).toBeCloseTo(-0.05, 4);
    expect(Math.max(...zs)).toBeCloseTo(1.05, 4);

    // Índices das faces dentro da malha; há arestas ocultas (diagonais das faces planas).
    let hiddenEdges = 0;
    for (const face of faces) {
      for (const code of [71, 72, 73]) {
        const index = num(face, code);
        expect(Math.abs(index)).toBeGreaterThanOrEqual(1);
        if (index < 0) hiddenEdges += 1;
      }
    }
    expect(hiddenEdges).toBeGreaterThan(0);
    expect(hiddenEdges).toBeLessThan(faces.length * 3);
  });

  it('desliga as camadas de sistemas ocultos e inclui o terreno', () => {
    const { project } = crossing();
    const terrain = must(
      createTerrain('Terreno', [vec3(0, 0, 0), vec3(5, 0, 0), vec3(0, 5, 1), vec3(5, 5, 1)]),
    );
    const { entities, layers } = parse(
      exportModelDxf({
        ...project,
        terrain,
        systems: project.systems.map((s) => ({ ...s, visible: false })),
      }),
    );
    const system = [...layers.entries()].find(([name]) => name !== '0' && name !== 'HB-TERRENO');
    expect(system?.[1]).toBeLessThan(0);
    expect(layers.get('HB-TERRENO')).toBeGreaterThan(0);
    expect(entities.some((e) => e.type === 'POLYLINE' && e.layer === 'HB-TERRENO')).toBe(true);
    // Mesmo ocultos, os elementos são exportados.
    expect(entities.filter((e) => e.type === 'POLYLINE').length).toBeGreaterThanOrEqual(3);
  });
});
