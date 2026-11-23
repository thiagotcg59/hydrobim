import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addPipe,
  applyIfcTransform,
  ifcObjectTransform,
  parseProject,
  serializeProject,
  validateProject,
  type PipeSpec,
  type Project,
} from '@hydrobim/core';
import { IfcReadError } from '@hydrobim/ifc-import';
import { openIfcSession, type IfcSession } from '@hydrobim/ifc-import/reader';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { IfcAPI } from 'web-ifc';
import {
  LocalStorageProjectRepository,
  MemoryStorage,
} from '../persistence/LocalStorageProjectRepository';
import { MemoryIfcSourceStore, withIfcSources } from '../persistence/ifcSourceStore';
import { useEditorStore } from '../state/editorStore';
import { setIfcHostFactory, type IfcHost } from './ifcHost';
import { ifcPlanVertexNear, ifcSnapSegments } from './ifcPlan';
import {
  fetchIfcProperties,
  ifcBoundsOf,
  ifcSourceOf,
  placementTransform,
  useIfcStore,
} from './ifcStore';

/**
 * Sessão de importação exercitada de ponta a ponta com os arquivos de teste (os mesmos
 * conferidos contra o IfcOpenShell em `tests/integration/ifcImport.test.ts`). No Node não há
 * Web Worker: o leitor roda no mesmo processo, pela mesma função que o worker chama.
 */

const FIXTURES = resolve(__dirname, '../../../../tests/fixtures/ifc-import');
const file = (name: string): { name: string; bytes: Uint8Array } => ({
  name,
  bytes: new Uint8Array(readFileSync(resolve(FIXTURES, name))),
});

const api = new IfcAPI();
const ready = api.Init();
const sessions = new Set<IfcSession>();

function nodeHost(): IfcHost {
  let session: IfcSession | null = null;
  return {
    async open(bytes, onProgress) {
      await ready;
      session = openIfcSession(api, bytes);
      sessions.add(session);
      return session.read({ onProgress });
    },
    async properties(expressId) {
      return session?.properties(expressId) ?? null;
    },
    dispose() {
      session?.close();
      if (session) sessions.delete(session);
      session = null;
    },
  };
}

const editor = () => useEditorStore.getState();
const ifc = () => useIfcStore.getState();

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (condition()) return;
    await new Promise((done) => setTimeout(done, 5));
  }
  throw new Error(`Tempo esgotado: ${label}`);
}

/** Lê o arquivo até a prévia. */
async function preview(name: string): Promise<void> {
  await ifc().beginImport(file(name));
  expect(ifc().wizard?.step, ifc().wizard?.error ?? '').toBe('preview');
}

async function importAll(name: string): Promise<string> {
  await preview(name);
  ifc().startPlacing();
  expect(ifc().confirmImport()).toBe(true);
  return ifc().modelSelection!;
}

const modelOf = (project: Project = editor().project) => project.ifcModels[0]!;

beforeEach(() => {
  setIfcHostFactory(nodeHost);
  ifc().cancelImport();
  editor().newProject('mep');
  useIfcStore.setState({ selection: [], modelSelection: null, hidden: [] });
});

afterAll(() => {
  editor().newProject('mep');
  setIfcHostFactory(null);
});

describe('importação completa e parcial', () => {
  it('lê o arquivo, mostra a prévia e insere o modelo completo em um passo do histórico', async () => {
    const before = editor().project;
    await preview('predio-ifc4-mm.ifc');
    const wizard = ifc().wizard!;
    const source = ifcSourceOf(wizard.sha256!)!;
    expect(source.summary.header.schema).toBe('IFC4');
    expect(wizard.selected.size).toBe(source.summary.objects.length);
    // Até aqui nada entrou no projeto.
    expect(editor().project).toBe(before);

    ifc().startPlacing();
    expect(ifc().confirmImport()).toBe(true);
    const model = modelOf();
    expect(model.objects).toHaveLength(source.summary.objects.length);
    expect(model).toMatchObject({
      schema: 'IFC4',
      lengthUnit: 'MILLIMETRE',
      unitScale: 0.001,
      placementMode: 'original',
    });
    expect(model.source.fileName).toBe('predio-ifc4-mm.ifc');
    expect(model.source.data.length).toBeGreaterThan(100);
    expect(ifc().wizard).toBeNull();
    expect(ifc().modelSelection).toBe(model.id);
    // Um passo no histórico; objetos importados não criam elementos nem conexões.
    expect(editor().past).toHaveLength(1);
    expect(editor().project.elements).toEqual([]);
    expect(editor().project.connections).toEqual([]);
    expect(validateProject(editor().project)).toEqual([]);

    // Escala: o arquivo em milímetros ocupa os mesmos metros que o IfcOpenShell mede.
    const bounds = ifcBoundsOf(editor().project)!;
    expect(bounds[0]).toBeCloseTo(103.363397, 3);
    expect(bounds[5]).toBeCloseTo(13, 3);
  });

  it('importa só os objetos escolhidos', async () => {
    await preview('predio-ifc2x3-m.ifc');
    const source = ifcSourceOf(ifc().wizard!.sha256!)!;
    const walls = source.summary.objects.filter((object) => object.entity === 'IfcWall');
    ifc().setWizardSelected(new Set(walls.map((wall) => wall.expressId)));
    ifc().startPlacing();
    expect(ifc().confirmImport()).toBe(true);
    expect(
      modelOf()
        .objects.map((object) => object.globalId)
        .sort(),
    ).toEqual(walls.map((wall) => wall.globalId).sort());
    // Sem objetos escolhidos o assistente não avança.
    await preview('predio-ifc2x3-m.ifc');
    ifc().setWizardSelected(new Set());
    ifc().startPlacing();
    expect(ifc().wizard?.step).toBe('preview');
    ifc().cancelImport();
  });

  it('a inserção repetida do mesmo arquivo cria modelos e identidades distintos', async () => {
    const first = await importAll('predio-ifc4-mm.ifc');
    const second = await importAll('predio-ifc4-mm.ifc');
    expect(second).not.toBe(first);
    const models = editor().project.ifcModels;
    expect(models).toHaveLength(2);
    const ids = models.flatMap((model) => [model.id, ...model.objects.map((object) => object.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    // O mesmo arquivo é lido uma vez só e serve aos dois modelos.
    expect(models[0]!.source.sha256).toBe(models[1]!.source.sha256);
    expect(Object.keys(ifc().sources)).toHaveLength(0);
    expect(sessions.size).toBe(1);
  });
});

describe('posicionamento: a prévia usa a transformação que a confirmação grava', () => {
  it('ponto-base, deslocamento com giro e alinhamento por referências', async () => {
    await preview('predio-ifc4-mm.ifc');
    ifc().startPlacing();

    // Ponto-base: começa no canto de menores X, Y e Z e nada se move até informar o destino.
    ifc().setPlacementMode('basePoint');
    const base = ifc().wizard!.placement.basePoint;
    expect(base.x).toBeCloseTo(103.363397, 3);
    expect(placementTransform(ifc().wizard!.placement)).toMatchObject({
      ok: true,
      value: { rotation: 0, translation: { x: 0, y: 0, z: 0 } },
    });
    ifc().setPlacement({ target: { x: 10, y: 20, z: 0 } });
    const moved = placementTransform(ifc().wizard!.placement);
    expect(moved.ok && applyIfcTransform(moved.value, base)).toMatchObject({ x: 10, y: 20, z: 0 });

    // Indicar o ponto-base em uma vista não desloca a prévia; indicar o destino, sim.
    ifc().setPicking('base');
    const shown = moved.ok ? applyIfcTransform(moved.value, { x: 105, y: 52, z: 10 }) : base;
    ifc().pickPoint(shown);
    expect(ifc().wizard!.placement.basePoint.x).toBeCloseTo(105, 9);
    expect(ifc().wizard!.picking).toBe('target');
    const same = placementTransform(ifc().wizard!.placement);
    expect(same.ok && moved.ok && same.value.translation.x).toBeCloseTo(
      moved.ok ? moved.value.translation.x : 0,
      9,
    );
    ifc().pickPoint({ x: 0, y: 0, z: 3 });
    expect(ifc().wizard!.picking).toBeNull();
    const picked = placementTransform(ifc().wizard!.placement);
    expect(picked.ok && applyIfcTransform(picked.value, { x: 105, y: 52, z: 10 })).toMatchObject({
      x: expect.closeTo(0, 9),
      y: expect.closeTo(0, 9),
      z: expect.closeTo(3, 9),
    });

    // Alinhamento: incompleto não confirma; com dois pares desloca e gira sem escala.
    ifc().setPlacementMode('aligned');
    expect(placementTransform(ifc().wizard!.placement).ok).toBe(false);
    expect(ifc().confirmImport()).toBe(false);
    expect(editor().project.ifcModels).toEqual([]);
    ifc().setPlacement({
      sources: [
        { x: 100, y: 50, z: 10 },
        { x: 104, y: 50, z: 10 },
      ],
      targets: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 9, z: 0 },
      ],
    });
    const aligned = placementTransform(ifc().wizard!.placement);
    expect(aligned.ok && aligned.value.rotation).toBeCloseTo(Math.PI / 2, 9);

    // Deslocamento e rotação informados; a confirmação grava exatamente a prévia.
    ifc().setPlacementMode('offset');
    ifc().setPlacement({ offset: { x: -100, y: -50, z: -10 }, rotationDeg: 0 });
    const offset = placementTransform(ifc().wizard!.placement);
    expect(ifc().confirmImport()).toBe(true);
    expect(offset.ok && modelOf().placement).toEqual(offset.ok ? offset.value : null);
    expect(modelOf().placementMode).toBe('offset');
    const bounds = ifcBoundsOf(editor().project)!;
    expect(bounds[0]).toBeCloseTo(3.363397, 3);
    expect(bounds[2]).toBeCloseTo(0, 6);
  });
});

describe('cancelamento e arquivos inválidos', () => {
  it('cancelar durante a leitura não altera o projeto nem deixa leitor aberto', async () => {
    let disposed = 0;
    setIfcHostFactory(() => {
      let reject: (error: Error) => void = () => undefined;
      return {
        open: () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
        properties: async () => null,
        dispose: () => {
          disposed += 1;
          reject(new IfcReadError('IFC_CANCELLED', 'Importação cancelada.'));
        },
      };
    });
    const before = editor().project;
    const reading = ifc().beginImport(file('predio-ifc4-mm.ifc'));
    await waitFor(() => Boolean(ifc().wizard?.sha256), 'leitura iniciada');
    expect(ifc().wizard?.step).toBe('reading');
    ifc().cancelImport();
    await reading;
    expect(disposed).toBe(1);
    expect(ifc().wizard).toBeNull();
    expect(ifc().sources).toEqual({});
    expect(editor().project).toBe(before);
    expect(editor().past).toEqual([]);
  });

  it('cancelar depois da prévia ou no posicionamento também não altera nada', async () => {
    const before = editor().project;
    await preview('predio-ifc4-mm.ifc');
    ifc().startPlacing();
    ifc().setPlacementMode('offset');
    ifc().setPlacement({ offset: { x: 5, y: 5, z: 5 } });
    ifc().cancelImport();
    expect(ifc().wizard).toBeNull();
    expect(editor().project).toBe(before);
    // O leitor do arquivo cancelado foi encerrado: a memória foi devolvida.
    expect(sessions.size).toBe(0);
  });

  it('recusa arquivos inválidos e esquemas não suportados com mensagem em português', async () => {
    const before = editor().project;
    await ifc().beginImport({ name: 'nota.ifc', bytes: new TextEncoder().encode('não é IFC') });
    expect(ifc().wizard).toMatchObject({ step: 'error' });
    expect(ifc().wizard!.error).toContain('ISO-10303-21');
    const preliminary = `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\nFILE_NAME('x','',(''),(''),'','','');\nFILE_SCHEMA(('IFC4X3_RC2'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n`;
    await ifc().beginImport({ name: 'rc.ifc', bytes: new TextEncoder().encode(preliminary) });
    expect(ifc().wizard!.error).toContain('IFC4X3_RC2');
    expect(ifc().wizard!.error).toContain('não é suportado');
    const empty = preliminary.replace('IFC4X3_RC2', 'IFC4');
    await ifc().beginImport({ name: 'vazio.ifc', bytes: new TextEncoder().encode(empty) });
    expect(ifc().wizard!.error).toContain('não tem objetos importáveis');
    ifc().cancelImport();
    expect(editor().project).toBe(before);
    expect(sessions.size).toBe(0);
  });
});

describe('edição dos modelos inseridos, com desfazer e refazer', () => {
  it('move, gira, copia, oculta e remove; o histórico volta cada passo', async () => {
    await importAll('predio-ifc2x3-m.ifc');
    const inserted = editor().project;
    const start = ifcBoundsOf(inserted)!;

    // Modelo inteiro.
    expect(ifc().moveSelection({ x: 10, y: 0, z: 2 })).toBe(true);
    expect(ifcBoundsOf(editor().project)![0]).toBeCloseTo(start[0] + 10, 6);
    expect(ifcBoundsOf(editor().project)![2]).toBeCloseTo(start[2] + 2, 6);
    expect(ifc().rotateSelection(90)).toBe(true);
    expect(modelOf().placement.rotation).toBeCloseTo(Math.PI / 2, 9);
    editor().undo();
    editor().undo();
    expect(editor().project).toBe(inserted);
    editor().redo();
    expect(ifcBoundsOf(editor().project)![0]).toBeCloseTo(start[0] + 10, 6);
    editor().undo();

    // Componente: só ele se move; a cópia tem identidade nova e o mesmo GlobalId.
    const wall = modelOf().objects.find(
      (object) =>
        ifcSourceOf(modelOf().source.sha256)!.objects.get(object.expressId)?.name === 'Parede A',
    )!;
    ifc().select(wall.id);
    expect(ifc().modelSelection).toBeNull();
    expect(ifc().moveSelection({ x: 0, y: -3, z: 0 })).toBe(true);
    const movedWall = modelOf().objects.find((object) => object.id === wall.id)!;
    expect(movedWall.transform).not.toBeNull();
    expect(modelOf().objects.filter((object) => object.transform !== null)).toHaveLength(1);
    expect(ifc().copySelection({ x: 0, y: 8, z: 0 })).toBe(true);
    const copyId = ifc().selection[0]!;
    const copy = modelOf().objects.find((object) => object.id === copyId)!;
    expect(copy).toMatchObject({ copy: true, globalId: wall.globalId, expressId: wall.expressId });
    expect(copyId).not.toBe(wall.id);
    const origin = { x: 0, y: 0, z: 0 };
    const wallAt = applyIfcTransform(ifcObjectTransform(modelOf(), movedWall), origin);
    const copyAt = applyIfcTransform(ifcObjectTransform(modelOf(), copy), origin);
    expect(copyAt.y - wallAt.y).toBeCloseTo(8, 9);

    // Ocultar e isolar são da sessão: não mexem no projeto nem no histórico.
    const steps = editor().past.length;
    ifc().isolate([copyId]);
    expect(ifc().hidden).toHaveLength(modelOf().objects.length - 1);
    expect(ifcBoundsOf(editor().project, null, { visibleOnly: true })![4]).toBeLessThan(
      ifcBoundsOf(editor().project)![4] + 1e-9,
    );
    ifc().showAll();
    expect(editor().past).toHaveLength(steps);

    // Remover a cópia e desfazer.
    const count = modelOf().objects.length;
    expect(ifc().removeSelection()).toBe(true);
    expect(modelOf().objects).toHaveLength(count - 1);
    expect(ifc().selection).toEqual([]);
    editor().undo();
    expect(modelOf().objects).toHaveLength(count);

    // Remover o modelo solta a fonte; desfazer a relê a partir do arquivo guardado no projeto.
    const sha = modelOf().source.sha256;
    ifc().selectModel(modelOf().id);
    expect(ifc().removeSelection()).toBe(true);
    expect(editor().project.ifcModels).toEqual([]);
    expect(ifcSourceOf(sha)).toBeNull();
    expect(sessions.size).toBe(0);
    editor().undo();
    expect(editor().project.ifcModels).toHaveLength(1);
    await waitFor(() => ifc().sources[sha]?.status === 'ready', 'fonte relida após desfazer');
    expect(ifcSourceOf(sha)).not.toBeNull();
    expect(ifcBoundsOf(editor().project)).not.toBeNull();
  });

  it('a seleção dos importados é exclusiva com a da rede', async () => {
    await importAll('predio-ifc4-mm.ifc');
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
    const piped = addPipe(editor().project, {
      start: { x: 0, y: 0, z: 0 },
      end: { x: 2, y: 0, z: 0 },
      spec,
    });
    if (!piped.ok) throw new Error(piped.error.message);
    editor().applyOperation({ ok: true, value: piped.value.project });
    const pipeId = editor().project.elements[0]!.id;
    // A rede existente segue íntegra ao lado do modelo importado.
    expect(validateProject(editor().project)).toEqual([]);
    ifc().select(modelOf().objects[0]!.id);
    editor().select(pipeId);
    expect(ifc().selection).toEqual([]);
    ifc().select(modelOf().objects[0]!.id);
    expect(editor().selection).toEqual([]);
  });
});

describe('capturas nos objetos importados', () => {
  it('captura vértices à mostra em planta e ignora os ocultos', async () => {
    await importAll('predio-ifc4-mm.ifc');
    const project = editor().project;
    const model = modelOf();
    const source = ifcSourceOf(model.source.sha256)!;
    const wall = model.objects.find(
      (object) => source.objects.get(object.expressId)?.name === 'Parede B',
    )!;
    const corner = source.objects.get(wall.expressId)!.bounds!;
    // Um vértice real da parede fica a milímetros do canto da envoltória girada.
    const near = ifcPlanVertexNear(project, { x: corner[3], y: corner[1] + 0.05 }, 0.2);
    expect(near).not.toBeNull();
    expect(ifcSnapSegments(project, { x: corner[3], y: corner[1] }, 0.3).length).toBeGreaterThan(0);
    // Longe de qualquer objeto, nada é capturado.
    expect(ifcPlanVertexNear(project, { x: 0, y: 0 }, 0.2)).toBeNull();
    // Oculto ou com o modelo invisível, o objeto deixa de ser referência.
    ifc().setHidden(
      model.objects.map((object) => object.id),
      true,
    );
    expect(ifcPlanVertexNear(project, { x: corner[3], y: corner[1] + 0.05 }, 0.2)).toBeNull();
    ifc().showAll();
    ifc().setModelDisplay(model.id, { visible: false });
    expect(
      ifcPlanVertexNear(editor().project, { x: corner[3], y: corner[1] + 0.05 }, 0.2),
    ).toBeNull();
  });
});

describe('salvar e reabrir', () => {
  it('o arquivo do projeto leva fonte, seleção e transformações; reabrir recupera tudo', async () => {
    await preview('predio-ifc4-mm.ifc');
    const source = ifcSourceOf(ifc().wizard!.sha256!)!;
    const chosen = source.summary.objects.filter((object) => object.entity !== 'IfcSpace');
    ifc().setWizardSelected(new Set(chosen.map((object) => object.expressId)));
    ifc().startPlacing();
    ifc().setPlacementMode('offset');
    ifc().setPlacement({ offset: { x: -100, y: -50, z: 0 }, rotationDeg: 30 });
    expect(ifc().confirmImport()).toBe(true);
    const wall = modelOf().objects.find(
      (object) => source.objects.get(object.expressId)?.name === 'Parede A',
    )!;
    ifc().select(wall.id);
    ifc().moveSelection({ x: 1, y: 0, z: 0 });
    const saved = editor().project;
    const text = serializeProject(saved);

    // "Limpar os caches": outro projeto, nenhuma fonte carregada, nenhum leitor aberto.
    editor().newProject('mep');
    expect(sessions.size).toBe(0);
    expect(ifc().sources).toEqual({});

    const reopened = parseProject(text);
    if (!reopened.ok) throw new Error(reopened.error.message);
    editor().loadProject(reopened.value);
    const model = modelOf();
    expect(model.objects).toEqual(saved.ifcModels[0]!.objects);
    expect(model.placement).toEqual(saved.ifcModels[0]!.placement);
    expect(model.objects).toHaveLength(chosen.length);
    await waitFor(() => ifc().sources[model.source.sha256]?.status === 'ready', 'fonte relida');
    // Malhas e propriedades voltam da fonte guardada no próprio arquivo.
    expect(ifcBoundsOf(editor().project)).toEqual(ifcBoundsOf(saved));
    const properties = await fetchIfcProperties(model, wall.expressId);
    expect(properties).toMatchObject({ name: 'Parede A', tag: 'PA-001', storeyName: 'Térreo' });
    expect(properties!.materials.map((material) => material.name)).toEqual([
      'Argamassa de reboco',
      'Bloco cerâmico',
      'Argamassa de reboco',
    ]);
  });

  it('salvar no navegador guarda a fonte à parte e a devolve ao abrir', async () => {
    await importAll('predio-ifc2x3-m.ifc');
    const project = editor().project;
    const storage = new MemoryStorage();
    const blobs = new MemoryIfcSourceStore();
    const repository = withIfcSources(new LocalStorageProjectRepository(storage), blobs);
    expect((await repository.save(project)).ok).toBe(true);
    // O documento do armazenamento do navegador vai sem a fonte embutida…
    const stored = JSON.parse(storage.getItem(`hydrobim:project:${project.id}`)!) as Project;
    expect(stored.ifcModels[0]!.source.data).toBe('');
    expect(stored.ifcModels[0]!.source.sha256).toBe(project.ifcModels[0]!.source.sha256);
    // …e ela volta ao abrir.
    const loaded = await repository.load(project.id);
    expect(loaded.ok && loaded.value.ifcModels).toEqual(project.ifcModels);

    // Armazenamento das fontes limpo: o projeto abre e o modelo pede o arquivo original.
    const wiped = withIfcSources(
      new LocalStorageProjectRepository(storage),
      new MemoryIfcSourceStore(),
    );
    const partial = await wiped.load(project.id);
    if (!partial.ok) throw new Error(partial.error.message);
    editor().newProject('mep');
    editor().loadProject(partial.value);
    const model = modelOf();
    expect(ifc().sources[model.source.sha256]).toEqual({ status: 'missing' });
    expect(model.objects).toHaveLength(project.ifcModels[0]!.objects.length);
    // Religar exige o MESMO arquivo (SHA-256); com ele, tudo volta.
    ifc().selectModel(model.id);
    expect(await ifc().relinkSource(model.id, file('predio-ifc4-mm.ifc'))).toBe(false);
    expect(await ifc().relinkSource(model.id, file('predio-ifc2x3-m.ifc'))).toBe(true);
    await waitFor(() => ifc().sources[model.source.sha256]?.status === 'ready', 'fonte religada');
    expect(ifcBoundsOf(editor().project)).not.toBeNull();
  });
});
