import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IfcAPI } from 'web-ifc';
import { exportIfc } from '@hydrobim/ifc';
import { parseProject } from '@hydrobim/core';
import {
  IfcReadError,
  packIfcSource,
  sniffIfc,
  unpackIfcSource,
  type IfcObjectSummary,
} from '@hydrobim/ifc-import';
import { openIfcSession, type IfcReadResult, type IfcSession } from '@hydrobim/ifc-import/reader';

/**
 * Conferência independente da importação: os arquivos de `tests/fixtures/ifc-import` foram
 * escritos pelo IfcOpenShell (`services/api/scripts/make_ifc_import_fixtures.py`), que também
 * gravou, em `*.expected.json`, a caixa envolvente, o volume, o pavimento, o tipo, os
 * materiais e as propriedades que ELE lê de cada produto. Aqui o leitor do editor (web-ifc)
 * abre os mesmos arquivos e os resultados são comparados.
 */

const FIXTURES = resolve(__dirname, '../fixtures/ifc-import');
const EXAMPLES = resolve(__dirname, '../../examples');

interface ExpectedProduct {
  entity: string;
  name: string | null;
  bbox: [[number, number, number], [number, number, number]] | null;
  volume: number | null;
  container?: string | null;
  type?: string | null;
  typeEntity?: string | null;
  predefinedType?: string | null;
  materials?: string[];
  psets?: Record<string, Record<string, unknown>>;
  typePsets?: Record<string, Record<string, unknown>>;
  quantities?: Record<string, Record<string, unknown>>;
}
interface Expected {
  schema: string;
  products: Record<string, ExpectedProduct>;
}

const bytesOf = (path: string): Uint8Array => new Uint8Array(readFileSync(path));
const expectedOf = (name: string): Expected =>
  JSON.parse(readFileSync(resolve(FIXTURES, `${name}.expected.json`), 'utf8')) as Expected;

let api: IfcAPI;
const sessions: IfcSession[] = [];

beforeAll(async () => {
  api = new IfcAPI();
  await api.Init();
});
afterAll(() => {
  for (const session of sessions) session.close();
});

function open(path: string): { session: IfcSession; result: IfcReadResult } {
  const session = openIfcSession(api, bytesOf(path));
  sessions.push(session);
  return { session, result: session.read() };
}

/** Volume da malha do objeto no referencial do arquivo (teorema da divergência). */
function meshVolume(result: IfcReadResult, expressId: number): number {
  const geometries = new Map(result.meshes.geometries.map((g) => [g.id, g]));
  const mesh = result.meshes.objects.find((object) => object.expressId === expressId);
  let six = 0;
  for (const part of mesh?.parts ?? []) {
    const g = geometries.get(part.geometryId)!;
    const m = part.matrix;
    const at = (i: number): [number, number, number] => {
      const x = g.positions[i * 3]!;
      const y = g.positions[i * 3 + 1]!;
      const z = g.positions[i * 3 + 2]!;
      return [
        m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
        m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
        m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
      ];
    };
    // Em torno do primeiro vértice: evita perder precisão com coordenadas grandes.
    const o = at(g.indices[0]!);
    for (let t = 0; t < g.indices.length; t += 3) {
      const [a, b, c] = [at(g.indices[t]!), at(g.indices[t + 1]!), at(g.indices[t + 2]!)].map(
        (p) => [p[0] - o[0], p[1] - o[1], p[2] - o[2]] as const,
      ) as [readonly number[], readonly number[], readonly number[]];
      six +=
        a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) -
        a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) +
        a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!);
    }
  }
  return Math.abs(six) / 6;
}

const VARIANTS = [
  { name: 'predio-ifc2x3-m', schema: 'IFC2X3', family: 'IFC2X3', unit: 'METRE', scale: 1 },
  { name: 'predio-ifc4-mm', schema: 'IFC4', family: 'IFC4', unit: 'MILLIMETRE', scale: 0.001 },
  { name: 'predio-ifc4x3-m', schema: 'IFC4X3_ADD2', family: 'IFC4X3', unit: 'METRE', scale: 1 },
  { name: 'predio-ifc4-pe', schema: 'IFC4', family: 'IFC4', unit: 'FOOT', scale: 0.3048 },
] as const;

describe.each(VARIANTS)('importação de $name ($schema, $unit)', (variant) => {
  let session: IfcSession;
  let result: IfcReadResult;
  let expected: Expected;
  const byGuid = new Map<string, IfcObjectSummary>();

  beforeAll(() => {
    ({ session, result } = open(resolve(FIXTURES, `${variant.name}.ifc`)));
    expected = expectedOf(variant.name);
    for (const object of result.summary.objects) byGuid.set(object.globalId, object);
  });

  it('identifica esquema e unidades', () => {
    const { summary } = result;
    expect(summary.header.schema).toBe(variant.schema);
    expect(summary.header.family).toBe(variant.family);
    expect(summary.lengthUnit.label).toBe(variant.unit);
    expect(summary.lengthUnit.scale).toBeCloseTo(variant.scale, 12);
    expect(summary.projectName).toBe('Prédio de teste da importação');
    expect(summary.productCount).toBe(Object.keys(expected.products).length);
  });

  it('posiciona e escala cada objeto como o IfcOpenShell (hierarquia, giros e instâncias)', () => {
    let compared = 0;
    for (const [guid, product] of Object.entries(expected.products)) {
      if (!product.bbox) continue;
      const object = byGuid.get(guid);
      expect(object, `${product.name} deveria ter sido lido`).toBeDefined();
      expect(object!.geometry, product.name ?? guid).toBe('ok');
      const bounds = object!.bounds!;
      const flat = [...product.bbox[0], ...product.bbox[1]];
      // Tubo: o círculo é facetado de modo diferente pelos dois leitores (poucos milímetros).
      const tolerance = product.entity.includes('Segment') ? 0.003 : 0.0005;
      for (let axis = 0; axis < 6; axis += 1) {
        expect(
          Math.abs(bounds[axis]! - flat[axis]!),
          `${product.name}: eixo ${axis} (${bounds[axis]} × ${flat[axis]})`,
        ).toBeLessThan(tolerance);
      }
      if (product.volume && !product.entity.includes('Segment')) {
        expect(meshVolume(result, object!.expressId)).toBeCloseTo(product.volume, 3);
      }
      compared += 1;
    }
    expect(compared).toBeGreaterThanOrEqual(8);
  });

  it('monta a estrutura espacial com os pavimentos e as cotas em metros', () => {
    const site = result.summary.spatial.children[0]!;
    expect(site.entity).toBe('IfcSite');
    const building = site.children[0]!;
    expect(building.name).toBe('Bloco A');
    expect(building.children.map((storey) => [storey.name, storey.elevation])).toEqual([
      ['Térreo', 0],
      ['Pavimento 1', expect.closeTo(3, 9)],
    ]);
    for (const product of Object.values(expected.products)) {
      if (product.container === undefined) continue;
      const object = result.summary.objects.find((o) => o.name === product.name);
      if (!object) continue;
      expect(object.storeyName, product.name ?? '').toBe(product.container);
      expect(object.typeName, product.name ?? '').toBe(product.type ?? null);
    }
  });

  it('relata o que não tem geometria, sem descartar nem substituir por caixas', () => {
    const { summary, meshes } = result;
    const door = summary.objects.find((o) => o.name === 'Porta P1')!;
    const axis = summary.objects.find((o) => o.name === 'Eixo de referência')!;
    expect(door.geometry).toBe('none');
    expect(axis.geometry).toBe('unsupported');
    expect(axis.representations).toEqual(['Axis · Curve3D']);
    for (const object of [door, axis]) {
      expect(object.bounds).toBeNull();
      expect(meshes.objects.some((m) => m.expressId === object.expressId)).toBe(false);
    }
    const codes = summary.report.map((item) => item.code);
    expect(codes).toEqual(
      expect.arrayContaining(['NO_GEOMETRY', 'UNSUPPORTED_REPRESENTATION', 'OPENINGS', 'PORTS']),
    );
    expect(summary.report.find((i) => i.code === 'NO_GEOMETRY')!.expressIds).toEqual([
      door.expressId,
    ]);
    // Vãos e portas não viram objetos; todo o resto dos produtos está contabilizado.
    expect(summary.objects.some((o) => o.entity === 'IfcOpeningElement')).toBe(false);
    expect(summary.objects.some((o) => o.entity === 'IfcDistributionPort')).toBe(false);
    const structure = 4; // terreno, edifício e dois pavimentos, sem geometria própria
    expect(summary.objects.length + structure + 2).toBe(summary.productCount);
  });

  it('compartilha a geometria das instâncias (IfcMappedItem)', () => {
    const columns = result.summary.objects.filter((o) => o.entity === 'IfcColumn');
    expect(columns).toHaveLength(3);
    const ids = columns.map(
      (column) =>
        result.meshes.objects.find((m) => m.expressId === column.expressId)!.parts[0]!.geometryId,
    );
    expect(new Set(ids).size).toBe(1);
  });

  it('lê propriedades, quantidades, materiais e classificação como a fonte', () => {
    const wall = result.summary.objects.find((o) => o.name === 'Parede A')!;
    const reference = Object.values(expected.products).find((p) => p.name === 'Parede A')!;
    const props = session.properties(wall.expressId)!;
    expect(props.globalId).toBe(wall.globalId);
    expect(props.description).toBe('Parede externa com vão de porta');
    expect(props.objectType).toBe('Alvenaria');
    expect(props.tag).toBe('PA-001');
    expect(props.storeyName).toBe('Térreo');
    expect(props.type).toMatchObject({
      entity: reference.typeEntity,
      name: 'Parede de alvenaria 20 cm',
    });
    expect(props.predefinedType).toBe(reference.predefinedType ?? null);

    // Conjuntos de propriedades da ocorrência: mesmos nomes e valores do IfcOpenShell.
    for (const [setName, values] of Object.entries(reference.psets ?? {})) {
      const group = props.groups.find((g) => g.name === setName && g.scope === 'occurrence');
      expect(group, setName).toBeDefined();
      for (const [name, value] of Object.entries(values)) {
        const entry = group!.properties.find((p) => p.name === name)!;
        expect(entry, `${setName}.${name}`).toBeDefined();
        if (Array.isArray(value)) expect(entry.values).toEqual(value);
        else if (typeof value === 'object' && value !== null) {
          const bounded = value as { UpperBoundValue: number; LowerBoundValue: number };
          expect([entry.lower, entry.upper]).toEqual([
            bounded.LowerBoundValue,
            bounded.UpperBoundValue,
          ]);
        } else if (typeof value === 'number') expect(entry.value).toBeCloseTo(value, 6);
        else expect(entry.value).toBe(value);
      }
    }
    // Tipo de valor e unidade preservados; valor não informado continua não informado.
    const data = props.groups.find((g) => g.name === 'Construtora_Dados')!;
    const height = data.properties.find((p) => p.name === 'Altura')!;
    expect(height.valueType).toBe('IfcLengthMeasure');
    expect(height.value).toBeCloseTo(2.8 / variant.scale, 6);
    expect(height.unitSource).toBe('file');
    expect(height.unit).toBe(result.summary.lengthUnit.symbol);
    expect(data.properties.find((p) => p.name === 'Lote')).toMatchObject({
      value: 7,
      valueType: 'IfcInteger',
      unit: null,
    });
    expect(data.properties.find((p) => p.name === 'Fornecedor')).toMatchObject({ value: null });
    expect(
      props.groups
        .find((g) => g.name === 'Pset_WallCommon' && g.scope === 'occurrence')!
        .properties.find((p) => p.name === 'IsExternal'),
    ).toMatchObject({ value: true, valueType: 'IfcBoolean' });

    // Propriedades do tipo ficam separadas das da ocorrência (mesmo conjunto, valores diferentes).
    const typeSet = props.groups.find((g) => g.name === 'Pset_WallCommon' && g.scope === 'type')!;
    expect(typeSet.properties.map((p) => [p.name, p.value])).toEqual(
      Object.entries(reference.typePsets!.Pset_WallCommon!),
    );

    // Quantidades, na unidade do arquivo.
    const [qtoName, qto] = Object.entries(reference.quantities ?? {})[0]!;
    const quantities = props.groups.find((g) => g.name === qtoName)!;
    expect(quantities.kind).toBe('quantities');
    for (const [name, value] of Object.entries(qto)) {
      const entry = quantities.properties.find((p) => p.name === name)!;
      expect(entry.value as number, name).toBeCloseTo(value as number, 6);
    }
    expect(quantities.properties.find((p) => p.name === 'Length')!.unit).toBe(
      result.summary.lengthUnit.symbol,
    );
    expect(quantities.properties.find((p) => p.name === 'GrossSideArea')!.unit).toBe('m²');

    expect(props.materials.map((m) => m.name)).toEqual(reference.materials);
    expect(props.materials[1]).toMatchObject({
      role: 'layer',
      setName: 'Alvenaria 20 cm',
      scope: 'occurrence',
    });
    expect(props.materials[1]!.thickness).toBeCloseTo(0.16 / variant.scale, 6);
    expect(props.classifications).toEqual([
      {
        system: 'NBR 15965',
        edition: '2022',
        identification: '3E 04 10',
        name: 'Paredes de vedação',
        location: null,
        scope: 'occurrence',
      },
    ]);

    // Material herdado do tipo é identificado como tal.
    const column = result.summary.objects.find((o) => o.name === 'Pilar P1')!;
    expect(session.properties(column.expressId)!.materials).toEqual([
      expect.objectContaining({ name: 'Concreto C30', scope: 'type' }),
    ]);
    // Porta IFC do tubo: só contagem informativa.
    const pipe = result.summary.objects.find((o) => o.name === 'Tubo de água fria')!;
    expect(session.properties(pipe.expressId)!.portCount).toBe(1);
  });

  it('devolve a cor declarada no arquivo', () => {
    const wall = result.summary.objects.find((o) => o.name === 'Parede A')!;
    const part = result.meshes.objects.find((m) => m.expressId === wall.expressId)!.parts[0]!;
    expect(part.color[0]).toBeCloseTo(0.8, 2);
    expect(part.color[1]).toBeCloseTo(0.4, 2);
    expect(part.color[2]).toBeCloseTo(0.2, 2);
  });
});

describe('georreferência, unidades de ângulo e coordenadas grandes', () => {
  it('lê a georreferência declarada sem aplicá-la', () => {
    const { result } = open(resolve(FIXTURES, 'predio-ifc4-mm.ifc'));
    expect(result.summary.georeference).toMatchObject({
      crsName: 'EPSG:31982',
      mapZone: '22S',
      eastings: 333000,
      northings: 7394000,
      orthogonalHeight: 760,
      scale: 0.001,
    });
    expect(result.summary.report.some((item) => item.code === 'GEOREFERENCE')).toBe(true);
    // As coordenadas continuam as locais do arquivo (terreno em 100; 50; 10).
    expect(result.summary.bounds![0]).toBeGreaterThan(100);
    expect(result.summary.bounds![0]).toBeLessThan(112);
    const plain = open(resolve(FIXTURES, 'predio-ifc2x3-m.ifc')).result;
    expect(plain.summary.georeference).toBeNull();
    expect(plain.summary.units.find((u) => u.type === 'PLANEANGLEUNIT')).toMatchObject({
      label: 'DEGREE',
      symbol: '°',
    });
  });

  it('não recentraliza: coordenadas de centenas de quilômetros chegam em dupla precisão', () => {
    const { result } = open(resolve(FIXTURES, 'predio-ifc4x3-m.ifc'));
    const bounds = result.summary.bounds!;
    expect(bounds[0]).toBeGreaterThan(350000);
    expect(bounds[1]).toBeGreaterThan(7400000);
    // A geometria fica perto da própria origem; a posição grande vai na matriz (dupla precisão).
    const wall = result.summary.objects.find((o) => o.name === 'Parede A')!;
    const part = result.meshes.objects.find((m) => m.expressId === wall.expressId)!.parts[0]!;
    expect(Math.abs(part.matrix[13]!)).toBeGreaterThan(7.4e6);
    const geometry = result.meshes.geometries.find((g) => g.id === part.geometryId)!;
    expect(Math.max(...geometry.positions.map(Math.abs))).toBeLessThan(100);
  });
});

describe('arquivos exportados pelo próprio HydroBIM (IFC4X3_ADD2)', () => {
  it('reabre o exemplo da edificação com as mesmas entidades e identidades', () => {
    const json = readFileSync(resolve(EXAMPLES, 'edificacao-simples.hydrobim.json'), 'utf8');
    const project = parseProject(json);
    if (!project.ok) throw new Error(project.error.message);
    const { result } = open(resolve(EXAMPLES, 'edificacao-simples.ifc'));
    expect(result.summary.header.schema).toBe('IFC4X3_ADD2');
    const walls = result.summary.objects.filter((o) => o.entity === 'IfcWall');
    expect(walls).toHaveLength(
      project.value.architecture.elements.filter((e) => e.kind === 'wall').length,
    );
    expect(walls.every((wall) => wall.geometry === 'ok')).toBe(true);
    // O texto exportado agora é o mesmo esquema que o leitor aceita.
    expect(sniffIfc(new TextEncoder().encode(exportIfc(project.value))).ok).toBe(true);
  });
});

describe('arquivos inválidos e recursos não suportados', () => {
  const code = (bytes: Uint8Array): string => {
    try {
      openIfcSession(api, bytes).close();
      return '';
    } catch (error) {
      return error instanceof IfcReadError ? error.code : `inesperado: ${String(error)}`;
    }
  };
  const text = (value: string): Uint8Array => new TextEncoder().encode(value);
  const step = (schema: string): string =>
    `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\nFILE_NAME('x','',(''),(''),'','','');\nFILE_SCHEMA(('${schema}'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n`;

  it('recusa com o motivo, em português', () => {
    expect(code(new Uint8Array())).toBe('IFC_EMPTY');
    expect(code(text('isto não é um IFC'))).toBe('IFC_NOT_STEP');
    expect(code(text('<?xml version="1.0"?><ifcXML/>'))).toBe('IFC_XML_UNSUPPORTED');
    expect(code(new Uint8Array([0x50, 0x4b, 3, 4]))).toBe('IFC_ZIP_UNSUPPORTED');
    expect(code(text('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;'))).toBe('IFC_NO_SCHEMA');
    for (const schema of ['IFC4X1', 'IFC4X3_RC2', 'IFC2X2_FINAL', 'IFC4X3']) {
      expect(code(text(step(schema))), schema).toBe('IFC_SCHEMA_UNSUPPORTED');
    }
    const sniffed = sniffIfc(text(step('IFC4X1')));
    expect(sniffed.ok ? '' : sniffed.error.message).toContain('IFC2X3, IFC4, IFC4X3_ADD2');
  });

  it('abre um arquivo válido e vazio sem objetos', () => {
    const session = openIfcSession(api, text(step('IFC4')));
    const { summary, meshes } = session.read();
    session.close();
    expect(summary.objects).toEqual([]);
    expect(meshes.objects).toEqual([]);
    expect(summary.bounds).toBeNull();
  });

  it('interrompe a leitura quando cancelada, sem resultado parcial', () => {
    const session = openIfcSession(api, bytesOf(resolve(FIXTURES, 'predio-ifc4-mm.ifc')));
    let thrown: unknown = null;
    try {
      session.read({ isCancelled: () => true });
    } catch (error) {
      thrown = error;
    }
    session.close();
    expect(thrown).toBeInstanceOf(IfcReadError);
    expect((thrown as IfcReadError).code).toBe('IFC_CANCELLED');
    expect(session.properties(1)).toBeNull();
  });
});

describe('arquivo-fonte no projeto', () => {
  it('guarda o arquivo íntegro e o recupera byte a byte', async () => {
    const bytes = bytesOf(resolve(FIXTURES, 'predio-ifc4-mm.ifc'));
    const source = await packIfcSource('predio-ifc4-mm.ifc', bytes);
    expect(source.byteLength).toBe(bytes.byteLength);
    expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(source.data.length).toBeLessThan(bytes.byteLength);
    const unpacked = await unpackIfcSource(source);
    expect(unpacked.ok && Buffer.from(unpacked.value).equals(Buffer.from(bytes))).toBe(true);

    const missing = await unpackIfcSource({ ...source, data: '' });
    expect(missing.ok ? '' : missing.error.code).toBe('IFC_SOURCE_MISSING');
    const tampered = await unpackIfcSource({ ...source, sha256: 'f'.repeat(64) });
    expect(tampered.ok ? '' : tampered.error.code).toBe('IFC_SOURCE_CORRUPT');
    const broken = await unpackIfcSource({ ...source, data: 'AAAA' });
    expect(broken.ok ? '' : broken.error.code).toBe('IFC_SOURCE_CORRUPT');
  });
});
