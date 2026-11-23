import { describe, expect, it } from 'vitest';
import {
  addIfcModel,
  applyIfcTransform,
  attachIfcSources,
  composeIfcTransforms,
  copyIfcObjects,
  findIfcObject,
  IFC_IDENTITY,
  ifcAlignTransform,
  ifcMoveTransform,
  ifcObjectTransform,
  ifcRotateTransform,
  ifcTransformMatrix,
  invertIfcTransform,
  removeIfcModels,
  removeIfcObjects,
  setIfcModelDisplay,
  stripIfcSources,
  transformIfcModels,
  transformIfcObjects,
  type AddIfcModelInput,
} from './ifcModels';
import { createProject } from './operations';
import { IFC_IMPORT_LIMITS, SCHEMA_VERSION, type Project } from './schema';
import { parseProject, serializeProject } from './serialization';
import { validateProject } from './validation';

const SHA = 'a'.repeat(64);

const input = (overrides: Partial<AddIfcModelInput> = {}): AddIfcModelInput => ({
  name: 'predio.ifc',
  source: {
    fileName: 'predio.ifc',
    byteLength: 1234,
    sha256: SHA,
    encoding: 'gzip-base64',
    data: 'H4sIAAAA',
  },
  schema: 'IFC4',
  lengthUnit: 'MILLIMETRE',
  unitScale: 0.001,
  importedAt: '2026-11-22T12:00:00.000Z',
  placementMode: 'original',
  placement: IFC_IDENTITY,
  objects: [
    { expressId: 61, globalId: 'GUID-PAREDE-A' },
    { expressId: 131, globalId: 'GUID-PAREDE-B' },
    { expressId: 145, globalId: 'GUID-LAJE' },
  ],
  ...overrides,
});

function withModel(project: Project = createProject('IFC')): { project: Project; modelId: string } {
  const added = addIfcModel(project, input());
  if (!added.ok) throw new Error(added.error.message);
  return added.value;
}

const close = (a: { x: number; y: number; z: number }, b: [number, number, number]): void => {
  expect(a.x).toBeCloseTo(b[0], 9);
  expect(a.y).toBeCloseTo(b[1], 9);
  expect(a.z).toBeCloseTo(b[2], 9);
};

describe('transformações rígidas em planta', () => {
  it('compõe, inverte e gira em torno de um pivô', () => {
    const turn = ifcRotateTransform({ x: 2, y: 1, z: 5 }, Math.PI / 2);
    // O pivô fica no lugar; um ponto a +1 em X vai para +1 em Y.
    close(applyIfcTransform(turn, { x: 2, y: 1, z: 5 }), [2, 1, 5]);
    close(applyIfcTransform(turn, { x: 3, y: 1, z: 0 }), [2, 2, 0]);

    const move = ifcMoveTransform({ x: 10, y: -4, z: 3 });
    const both = composeIfcTransforms(move, turn);
    close(applyIfcTransform(both, { x: 3, y: 1, z: 0 }), [12, -2, 3]);
    const back = composeIfcTransforms(invertIfcTransform(both), both);
    close(applyIfcTransform(back, { x: 7, y: 8, z: 9 }), [7, 8, 9]);
  });

  it('alinha por dois pares de pontos sem escala', () => {
    const aligned = ifcAlignTransform(
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 10, z: 2 },
      { x: 4, y: 0, z: 0 },
      { x: 10, y: 99, z: 0 },
    );
    expect(aligned.ok).toBe(true);
    if (!aligned.ok) return;
    close(applyIfcTransform(aligned.value, { x: 0, y: 0, z: 0 }), [10, 10, 2]);
    // O segundo ponto vai para a direção do destino 2 (+Y), mantendo os 4 m de distância.
    close(applyIfcTransform(aligned.value, { x: 4, y: 0, z: 0 }), [10, 14, 2]);
    expect(aligned.value.rotation).toBeCloseTo(Math.PI / 2, 12);

    const degenerate = ifcAlignTransform(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 0, z: 3 },
      { x: 5, y: 5, z: 0 },
    );
    expect(degenerate.ok ? '' : degenerate.error.code).toBe('IFC_ALIGN_DEGENERATE');
  });

  it('gera a matriz em ordem de colunas', () => {
    const matrix = ifcTransformMatrix({ translation: { x: 1, y: 2, z: 3 }, rotation: Math.PI / 2 });
    expect(matrix.slice(12, 15)).toEqual([1, 2, 3]);
    expect(matrix[0]).toBeCloseTo(0, 12);
    expect(matrix[1]).toBeCloseTo(1, 12);
    expect(matrix[4]).toBeCloseTo(-1, 12);
  });
});

describe('modelos IFC importados', () => {
  it('insere o modelo com identidades novas e mantém o projeto sem pendências', () => {
    const empty = createProject('IFC');
    const { project, modelId } = withModel(empty);
    expect(empty.ifcModels).toEqual([]);
    const model = project.ifcModels[0]!;
    expect(model.id).toBe(modelId);
    expect(model.objects.map((o) => o.globalId)).toEqual([
      'GUID-PAREDE-A',
      'GUID-PAREDE-B',
      'GUID-LAJE',
    ]);
    expect(model.objects.every((o) => !o.copy && o.transform === null)).toBe(true);
    // Objetos importados são referência: não criam elementos, portas nem conexões.
    expect(project.elements).toEqual([]);
    expect(project.connections).toEqual([]);
    expect(validateProject(project)).toEqual([]);
  });

  it('a inserção repetida do mesmo arquivo não colide identidades', () => {
    const first = withModel();
    const second = withModel(first.project);
    const ids = second.project.ifcModels.flatMap((m) => [m.id, ...m.objects.map((o) => o.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(second.project.ifcModels).toHaveLength(2);
    expect(second.project.ifcModels[0]!.source.sha256).toBe(
      second.project.ifcModels[1]!.source.sha256,
    );
  });

  it('recusa seleção vazia, repetida, grande demais e posicionamento inválido', () => {
    const project = createProject('IFC');
    const code = (overrides: Partial<AddIfcModelInput>): string => {
      const result = addIfcModel(project, input(overrides));
      return result.ok ? '' : result.error.code;
    };
    expect(code({ objects: [] })).toBe('IFC_NO_OBJECTS');
    expect(
      code({
        objects: [
          { expressId: 5, globalId: 'A' },
          { expressId: 5, globalId: 'A' },
        ],
      }),
    ).toBe('IFC_DUPLICATE_OBJECT');
    expect(
      code({
        objects: Array.from({ length: IFC_IMPORT_LIMITS.maxObjects + 1 }, (_, index) => ({
          expressId: index + 1,
          globalId: `G${index}`,
        })),
      }),
    ).toBe('IFC_TOO_MANY_OBJECTS');
    expect(code({ placement: { translation: { x: Number.NaN, y: 0, z: 0 }, rotation: 0 } })).toBe(
      'IFC_INVALID_TRANSFORM',
    );
    expect(
      code({ source: { ...input().source, byteLength: IFC_IMPORT_LIMITS.maxFileBytes + 1 } }),
    ).toBe('IFC_FILE_TOO_LARGE');
  });

  it('move e gira o modelo inteiro sem tocar os objetos', () => {
    const { project, modelId } = withModel();
    const moved = transformIfcModels(project, [modelId], ifcMoveTransform({ x: 5, y: 0, z: 1 }));
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const turned = transformIfcModels(
      moved.value,
      [modelId],
      ifcRotateTransform({ x: 5, y: 0, z: 0 }, Math.PI / 2),
    );
    expect(turned.ok).toBe(true);
    if (!turned.ok) return;
    const model = turned.value.ifcModels[0]!;
    // Um ponto do arquivo em (1, 0, 0): vai a (6, 0, 1) e gira 90° em torno de (5, 0).
    close(applyIfcTransform(model.placement, { x: 1, y: 0, z: 0 }), [5, 1, 1]);
    expect(model.objects).toBe(project.ifcModels[0]!.objects);
    expect(project.ifcModels[0]!.placement).toEqual(IFC_IDENTITY);
    expect(transformIfcModels(project, ['nao-existe'], IFC_IDENTITY).ok).toBe(false);
  });

  it('move um componente no referencial do projeto mesmo com o modelo girado', () => {
    const base = withModel();
    const turned = transformIfcModels(
      base.project,
      [base.modelId],
      composeIfcTransforms(
        ifcMoveTransform({ x: 100, y: 50, z: 0 }),
        ifcRotateTransform({ x: 0, y: 0, z: 0 }, Math.PI / 2),
      ),
    );
    if (!turned.ok) throw new Error('falhou');
    const target = turned.value.ifcModels[0]!.objects[0]!;
    const point = { x: 2, y: 0, z: 0 };
    const before = applyIfcTransform(ifcObjectTransform(turned.value.ifcModels[0]!, target), point);
    const moved = transformIfcObjects(
      turned.value,
      [target.id],
      ifcMoveTransform({ x: 3, y: 0, z: 0 }),
    );
    if (!moved.ok) throw new Error('falhou');
    const ref = findIfcObject(moved.value, target.id)!;
    const after = applyIfcTransform(ifcObjectTransform(ref.model, ref.object), point);
    close(after, [before.x + 3, before.y, before.z]);
    // Os outros objetos ficam onde estavam, e a identidade do componente não muda.
    expect(ref.model.objects[1]).toBe(turned.value.ifcModels[0]!.objects[1]);
    expect(ref.object.id).toBe(target.id);

    // Mover o modelo depois leva junto o componente já deslocado.
    const carried = transformIfcModels(
      moved.value,
      [base.modelId],
      ifcMoveTransform({ x: 0, y: 0, z: 7 }),
    );
    if (!carried.ok) throw new Error('falhou');
    const carriedRef = findIfcObject(carried.value, target.id)!;
    close(applyIfcTransform(ifcObjectTransform(carriedRef.model, carriedRef.object), point), [
      after.x,
      after.y,
      after.z + 7,
    ]);
  });

  it('copia componentes com identidades internas novas e a mesma origem', () => {
    const { project } = withModel();
    const source = project.ifcModels[0]!.objects[0]!;
    const copied = copyIfcObjects(project, [source.id], ifcMoveTransform({ x: 0, y: 4, z: 0 }));
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    const model = copied.value.project.ifcModels[0]!;
    expect(model.objects).toHaveLength(4);
    const copy = model.objects.find((o) => o.id === copied.value.copyIds[0])!;
    expect(copy.copy).toBe(true);
    expect(copy.id).not.toBe(source.id);
    expect(copy.globalId).toBe(source.globalId);
    expect(copy.expressId).toBe(source.expressId);
    close(applyIfcTransform(ifcObjectTransform(model, copy), { x: 0, y: 0, z: 0 }), [0, 4, 0]);
    // O original não se mexe.
    expect(model.objects[0]).toBe(source);
    // Copiar a cópia dá uma terceira identidade.
    const again = copyIfcObjects(copied.value.project, [copy.id], IFC_IDENTITY);
    expect(again.ok && again.value.copyIds[0]).not.toBe(copy.id);
  });

  it('remove objetos e, sem objetos, o modelo', () => {
    const { project, modelId } = withModel();
    const [a, b, c] = project.ifcModels[0]!.objects;
    const one = removeIfcObjects(project, [a!.id]);
    expect(one.ok && one.value.ifcModels[0]!.objects.map((o) => o.id)).toEqual([b!.id, c!.id]);
    const all = removeIfcObjects(project, [a!.id, b!.id, c!.id]);
    expect(all.ok && all.value.ifcModels).toEqual([]);
    expect(removeIfcObjects(project, ['x']).ok).toBe(false);
    const removed = removeIfcModels(project, [modelId]);
    expect(removed.ok && removed.value.ifcModels).toEqual([]);
    expect(removeIfcModels(project, ['x']).ok).toBe(false);
  });

  it('ajusta nome, visibilidade e opacidade', () => {
    const { project, modelId } = withModel();
    const shown = setIfcModelDisplay(project, modelId, { opacity: 0.4, visible: false });
    expect(shown.ok && shown.value.ifcModels[0]).toMatchObject({ opacity: 0.4, visible: false });
    const same = setIfcModelDisplay(project, modelId, { opacity: 1 });
    expect(same.ok && same.value).toBe(project);
    const invalid = setIfcModelDisplay(project, modelId, { opacity: 0 });
    expect(invalid.ok ? '' : invalid.error.code).toBe('IFC_INVALID_OPACITY');
    const unnamed = setIfcModelDisplay(project, modelId, { name: '  ' });
    expect(unnamed.ok ? '' : unnamed.error.code).toBe('IFC_INVALID_NAME');
  });
});

describe('persistência dos modelos importados', () => {
  it('grava e reabre fonte, objetos incluídos e transformações', () => {
    const { project, modelId } = withModel();
    const target = project.ifcModels[0]!.objects[1]!;
    const moved = transformIfcObjects(project, [target.id], ifcMoveTransform({ x: 1, y: 2, z: 3 }));
    if (!moved.ok) throw new Error('falhou');
    const placed = transformIfcModels(
      moved.value,
      [modelId],
      ifcRotateTransform({ x: 0, y: 0, z: 0 }, 0.5),
    );
    if (!placed.ok) throw new Error('falhou');
    const reopened = parseProject(serializeProject(placed.value));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.value.ifcModels).toEqual(placed.value.ifcModels);
    expect(reopened.value.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('migra um documento v18 sem modelos e recusa identidades repetidas', () => {
    const { ifcModels: _ifcModels, ...legacy } = createProject('Antigo');
    const migrated = parseProject(JSON.stringify({ ...legacy, schemaVersion: 18 }));
    expect(migrated.ok && migrated.value.ifcModels).toEqual([]);

    const { project } = withModel();
    const model = project.ifcModels[0]!;
    const clash = {
      ...project,
      ifcModels: [{ ...model, objects: [model.objects[0]!, model.objects[0]!] }],
    };
    const parsed = parseProject(JSON.stringify(clash));
    expect(parsed.ok ? '' : parsed.error.code).toBe('DUPLICATE_ID');
  });

  it('separa e reembute as fontes pelo sha256', () => {
    const { project } = withModel();
    const stripped = stripIfcSources(project);
    expect(stripped.ifcModels[0]!.source).toMatchObject({
      data: '',
      sha256: SHA,
      byteLength: 1234,
    });
    expect(stripIfcSources(stripped)).toBe(stripped);
    expect(parseProject(serializeProject(stripped)).ok).toBe(true);
    const attached = attachIfcSources(stripped, new Map([[SHA, 'H4sIAAAA']]));
    expect(attached.ifcModels).toEqual(project.ifcModels);
    expect(attachIfcSources(stripped, new Map())).toBe(stripped);
  });
});
