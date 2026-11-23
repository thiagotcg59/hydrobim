import { newId } from './ids';
import type { Vec3 } from './math';
import { fail, ok, type DomainError, type Result } from './result';
import {
  IFC_IMPORT_LIMITS,
  IfcImportedModelSchema,
  type IfcImportedModel,
  type IfcImportedObject,
  type IfcTransform,
  type Project,
} from './schema';

/**
 * Modelos IFC importados: operações puras sobre `project.ifcModels`.
 *
 * Os objetos importados são referência para a modelagem. Nenhuma operação daqui cria
 * conexão hidráulica, porta ou elemento paramétrico, e nenhuma altera o arquivo-fonte: o que
 * muda são só as transformações e a lista de objetos incluídos.
 *
 * Posição de um objeto no projeto: `placement do modelo ∘ transform do objeto ∘ ponto do
 * arquivo` (o arquivo já em metros e Z para cima).
 */

// --- Álgebra das transformações rígidas em planta -----------------------------------------

export const IFC_IDENTITY: IfcTransform = { translation: { x: 0, y: 0, z: 0 }, rotation: 0 };

const rotateZ = (v: Vec3, angle: number): Vec3 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: c * v.x - s * v.y, y: s * v.x + c * v.y, z: v.z };
};

/** Mantém o ângulo em (−π, π], para que giros sucessivos não acumulem voltas. */
const wrapAngle = (angle: number): number => {
  const turn = 2 * Math.PI;
  const wrapped = angle - turn * Math.round(angle / turn);
  return Math.abs(wrapped) < 1e-15 ? 0 : wrapped;
};

export function applyIfcTransform(transform: IfcTransform, point: Vec3): Vec3 {
  const r = rotateZ(point, transform.rotation);
  return {
    x: r.x + transform.translation.x,
    y: r.y + transform.translation.y,
    z: r.z + transform.translation.z,
  };
}

/** `a ∘ b`: aplica `b` e depois `a`. */
export function composeIfcTransforms(a: IfcTransform, b: IfcTransform): IfcTransform {
  return {
    translation: applyIfcTransform(a, b.translation),
    rotation: wrapAngle(a.rotation + b.rotation),
  };
}

export function invertIfcTransform(transform: IfcTransform): IfcTransform {
  const t = rotateZ(transform.translation, -transform.rotation);
  return { translation: { x: -t.x, y: -t.y, z: -t.z }, rotation: wrapAngle(-transform.rotation) };
}

export const ifcMoveTransform = (delta: Vec3): IfcTransform => ({
  translation: { x: delta.x, y: delta.y, z: delta.z },
  rotation: 0,
});

/** Giro de `angle` radianos em torno do eixo vertical que passa por `pivot`. */
export function ifcRotateTransform(pivot: Vec3, angle: number): IfcTransform {
  const moved = rotateZ(pivot, angle);
  return {
    translation: { x: pivot.x - moved.x, y: pivot.y - moved.y, z: 0 },
    rotation: wrapAngle(angle),
  };
}

/**
 * Leva `source1` a `target1` e gira em planta até a direção `source1 → source2` apontar para
 * `target2` (como o alinhar por pontos da rede: eixo vertical, sem escala). Sem o segundo
 * par, só desloca.
 */
export function ifcAlignTransform(
  source1: Vec3,
  target1: Vec3,
  source2?: Vec3 | null,
  target2?: Vec3 | null,
): Result<IfcTransform> {
  let angle = 0;
  if (source2 && target2) {
    const from = { x: source2.x - source1.x, y: source2.y - source1.y };
    const to = { x: target2.x - target1.x, y: target2.y - target1.y };
    if (Math.hypot(from.x, from.y) < 1e-6 || Math.hypot(to.x, to.y) < 1e-6) {
      return fail(
        'IFC_ALIGN_DEGENERATE',
        'Os dois pontos de cada par precisam estar afastados em planta para definir o giro.',
      );
    }
    angle = Math.atan2(to.y, to.x) - Math.atan2(from.y, from.x);
  }
  const rotation = ifcRotateTransform(source1, angle);
  const move = ifcMoveTransform({
    x: target1.x - source1.x,
    y: target1.y - source1.y,
    z: target1.z - source1.z,
  });
  return ok(composeIfcTransforms(move, rotation));
}

/** Matriz 4×4 em ordem de colunas (a de `THREE.Matrix4.fromArray`). */
export function ifcTransformMatrix(transform: IfcTransform): number[] {
  const c = Math.cos(transform.rotation);
  const s = Math.sin(transform.rotation);
  const t = transform.translation;
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, t.x, t.y, t.z, 1];
}

const finiteTransform = (transform: IfcTransform): boolean =>
  [
    transform.rotation,
    transform.translation.x,
    transform.translation.y,
    transform.translation.z,
  ].every(Number.isFinite);

const isIdentity = (transform: IfcTransform): boolean =>
  transform.rotation === 0 &&
  transform.translation.x === 0 &&
  transform.translation.y === 0 &&
  transform.translation.z === 0;

// --- Consultas -------------------------------------------------------------------------------

/** Transformação completa do objeto: do referencial do arquivo para o do projeto. */
export function ifcObjectTransform(
  model: IfcImportedModel,
  object: IfcImportedObject,
): IfcTransform {
  return object.transform
    ? composeIfcTransforms(model.placement, object.transform)
    : model.placement;
}

export interface IfcObjectRef {
  readonly model: IfcImportedModel;
  readonly object: IfcImportedObject;
}

export function findIfcObject(project: Project, objectId: string): IfcObjectRef | null {
  for (const model of project.ifcModels) {
    const object = model.objects.find((candidate) => candidate.id === objectId);
    if (object) return { model, object };
  }
  return null;
}

export const findIfcModel = (project: Project, modelId: string): IfcImportedModel | null =>
  project.ifcModels.find((model) => model.id === modelId) ?? null;

/** Identificadores já usados no projeto (rede, arquitetura e modelos importados). */
function usedIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const element of project.elements) ids.add(element.id);
  for (const element of project.architecture.elements) ids.add(element.id);
  for (const model of project.ifcModels) {
    ids.add(model.id);
    for (const object of model.objects) ids.add(object.id);
  }
  return ids;
}

/** Usado ao abrir um projeto: identidades únicas e limites respeitados. */
export function ifcModelsIntegrityProblem(
  project: Project,
  otherIds: ReadonlySet<string>,
): DomainError | null {
  const seen = new Set<string>();
  const claim = (id: string): boolean => {
    if (seen.has(id) || otherIds.has(id)) return false;
    seen.add(id);
    return true;
  };
  for (const model of project.ifcModels) {
    if (!claim(model.id)) {
      return { code: 'DUPLICATE_ID', message: `identificador duplicado (${model.id}).` };
    }
    if (model.objects.length > IFC_IMPORT_LIMITS.maxObjects) {
      return {
        code: 'IFC_TOO_MANY_OBJECTS',
        message: `o modelo IFC "${model.name}" excede ${IFC_IMPORT_LIMITS.maxObjects} objetos.`,
      };
    }
    for (const object of model.objects) {
      if (!claim(object.id)) {
        return { code: 'DUPLICATE_ID', message: `identificador duplicado (${object.id}).` };
      }
    }
  }
  return null;
}

// --- Operações ------------------------------------------------------------------------------

export interface IfcModelObjectInput {
  readonly expressId: number;
  readonly globalId: string;
}

export interface AddIfcModelInput {
  readonly name: string;
  readonly source: IfcImportedModel['source'];
  readonly schema: string;
  readonly lengthUnit: string;
  readonly unitScale: number;
  readonly importedAt: string;
  readonly placementMode: IfcImportedModel['placementMode'];
  readonly placement: IfcTransform;
  readonly objects: readonly IfcModelObjectInput[];
}

/**
 * Insere um modelo importado. Cada inserção cria um modelo novo, com identidades novas para
 * o modelo e para cada objeto — importar o mesmo arquivo duas vezes dá dois modelos
 * independentes. Tudo ou nada.
 */
export function addIfcModel(
  project: Project,
  input: AddIfcModelInput,
): Result<{ project: Project; modelId: string }> {
  if (input.objects.length === 0) {
    return fail('IFC_NO_OBJECTS', 'Nenhum objeto foi escolhido para importar.');
  }
  if (input.objects.length > IFC_IMPORT_LIMITS.maxObjects) {
    return fail(
      'IFC_TOO_MANY_OBJECTS',
      `A importação está limitada a ${IFC_IMPORT_LIMITS.maxObjects.toLocaleString('pt-BR')} objetos por modelo (foram escolhidos ${input.objects.length.toLocaleString('pt-BR')}). Reduza a seleção.`,
    );
  }
  if (input.source.byteLength > IFC_IMPORT_LIMITS.maxFileBytes) {
    return fail(
      'IFC_FILE_TOO_LARGE',
      `O arquivo excede o limite de ${Math.round(IFC_IMPORT_LIMITS.maxFileBytes / 1024 / 1024)} MB da importação.`,
    );
  }
  if (!finiteTransform(input.placement)) {
    return fail('IFC_INVALID_TRANSFORM', 'O posicionamento informado não é válido.');
  }
  const seen = new Set<number>();
  for (const object of input.objects) {
    if (seen.has(object.expressId)) {
      return fail('IFC_DUPLICATE_OBJECT', 'A seleção traz o mesmo objeto mais de uma vez.');
    }
    seen.add(object.expressId);
  }
  const model: IfcImportedModel = {
    id: newId(),
    name: input.name.trim() || input.source.fileName,
    source: input.source,
    schema: input.schema,
    lengthUnit: input.lengthUnit,
    unitScale: input.unitScale,
    importedAt: input.importedAt,
    placementMode: input.placementMode,
    placement: input.placement,
    visible: true,
    opacity: 1,
    objects: input.objects.map((object) => ({
      id: newId(),
      expressId: object.expressId,
      globalId: object.globalId,
      transform: null,
      copy: false,
    })),
  };
  const parsed = IfcImportedModelSchema.safeParse(model);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      'IFC_INVALID_MODEL',
      `Modelo IFC inválido${issue ? ` em "${issue.path.join('.')}"` : ''}.`,
    );
  }
  return ok({
    project: { ...project, ifcModels: [...project.ifcModels, parsed.data] },
    modelId: model.id,
  });
}

export function removeIfcModels(project: Project, modelIds: readonly string[]): Result<Project> {
  const targets = new Set(modelIds);
  const kept = project.ifcModels.filter((model) => !targets.has(model.id));
  if (kept.length === project.ifcModels.length) {
    return fail('IFC_MODEL_NOT_FOUND', 'Modelo IFC não encontrado no projeto.');
  }
  return ok({ ...project, ifcModels: kept });
}

/** Remove objetos; um modelo que fica sem objetos sai do projeto. */
export function removeIfcObjects(project: Project, objectIds: readonly string[]): Result<Project> {
  const targets = new Set(objectIds);
  let removed = 0;
  const models: IfcImportedModel[] = [];
  for (const model of project.ifcModels) {
    const objects = model.objects.filter((object) => !targets.has(object.id));
    removed += model.objects.length - objects.length;
    if (objects.length === model.objects.length) models.push(model);
    else if (objects.length > 0) models.push({ ...model, objects });
  }
  if (removed === 0) return fail('IFC_OBJECT_NOT_FOUND', 'Objeto importado não encontrado.');
  return ok({ ...project, ifcModels: models });
}

/** Aplica uma transformação do projeto (mover, girar) a modelos inteiros. */
export function transformIfcModels(
  project: Project,
  modelIds: readonly string[],
  transform: IfcTransform,
): Result<Project> {
  if (!finiteTransform(transform)) {
    return fail('IFC_INVALID_TRANSFORM', 'O deslocamento ou o giro informado não é válido.');
  }
  const targets = new Set(modelIds);
  if (!project.ifcModels.some((model) => targets.has(model.id))) {
    return fail('IFC_MODEL_NOT_FOUND', 'Modelo IFC não encontrado no projeto.');
  }
  if (isIdentity(transform)) return ok(project);
  return ok({
    ...project,
    ifcModels: project.ifcModels.map((model) =>
      targets.has(model.id)
        ? { ...model, placement: composeIfcTransforms(transform, model.placement) }
        : model,
    ),
  });
}

/**
 * Transformação própria de um objeto que resulta em aplicar `world` (no referencial do
 * projeto) à posição atual dele: `P⁻¹ ∘ W ∘ P ∘ T`.
 */
function movedObjectTransform(
  model: IfcImportedModel,
  object: IfcImportedObject,
  world: IfcTransform,
): IfcTransform {
  const local = composeIfcTransforms(
    invertIfcTransform(model.placement),
    composeIfcTransforms(world, model.placement),
  );
  return object.transform ? composeIfcTransforms(local, object.transform) : local;
}

/** Aplica uma transformação do projeto a componentes; o restante do modelo fica no lugar. */
export function transformIfcObjects(
  project: Project,
  objectIds: readonly string[],
  transform: IfcTransform,
): Result<Project> {
  if (!finiteTransform(transform)) {
    return fail('IFC_INVALID_TRANSFORM', 'O deslocamento ou o giro informado não é válido.');
  }
  const targets = new Set(objectIds);
  let found = 0;
  const models = project.ifcModels.map((model) => {
    if (!model.objects.some((object) => targets.has(object.id))) return model;
    return {
      ...model,
      objects: model.objects.map((object) => {
        if (!targets.has(object.id)) return object;
        found += 1;
        return { ...object, transform: movedObjectTransform(model, object, transform) };
      }),
    };
  });
  if (found === 0) return fail('IFC_OBJECT_NOT_FOUND', 'Objeto importado não encontrado.');
  if (isIdentity(transform)) return ok(project);
  return ok({ ...project, ifcModels: models });
}

/**
 * Copia componentes, aplicando `transform` às cópias. Cada cópia recebe uma identidade
 * interna nova; o `GlobalId` e a entidade de origem continuam os do arquivo.
 */
export function copyIfcObjects(
  project: Project,
  objectIds: readonly string[],
  transform: IfcTransform,
): Result<{ project: Project; copyIds: string[] }> {
  if (!finiteTransform(transform)) {
    return fail('IFC_INVALID_TRANSFORM', 'O deslocamento ou o giro informado não é válido.');
  }
  const targets = new Set(objectIds);
  const used = usedIds(project);
  const copyIds: string[] = [];
  const models: IfcImportedModel[] = [];
  for (const model of project.ifcModels) {
    const copies: IfcImportedObject[] = [];
    for (const object of model.objects) {
      if (!targets.has(object.id)) continue;
      let id = newId();
      while (used.has(id)) id = newId();
      used.add(id);
      copyIds.push(id);
      copies.push({
        ...object,
        id,
        copy: true,
        transform: movedObjectTransform(model, object, transform),
      });
    }
    if (copies.length === 0) {
      models.push(model);
      continue;
    }
    if (model.objects.length + copies.length > IFC_IMPORT_LIMITS.maxObjects) {
      return fail(
        'IFC_TOO_MANY_OBJECTS',
        `O modelo "${model.name}" passaria de ${IFC_IMPORT_LIMITS.maxObjects.toLocaleString('pt-BR')} objetos.`,
      );
    }
    models.push({ ...model, objects: [...model.objects, ...copies] });
  }
  if (copyIds.length === 0) return fail('IFC_OBJECT_NOT_FOUND', 'Objeto importado não encontrado.');
  return ok({ project: { ...project, ifcModels: models }, copyIds });
}

export interface IfcModelDisplayPatch {
  readonly name?: string;
  readonly visible?: boolean;
  readonly opacity?: number;
}

/** Nome, visibilidade e opacidade de exibição de um modelo importado. */
export function setIfcModelDisplay(
  project: Project,
  modelId: string,
  patch: IfcModelDisplayPatch,
): Result<Project> {
  const model = findIfcModel(project, modelId);
  if (!model) return fail('IFC_MODEL_NOT_FOUND', 'Modelo IFC não encontrado no projeto.');
  if (patch.name !== undefined && patch.name.trim().length === 0) {
    return fail('IFC_INVALID_NAME', 'O nome do modelo não pode ficar vazio.');
  }
  if (
    patch.opacity !== undefined &&
    !(Number.isFinite(patch.opacity) && patch.opacity >= 0.05 && patch.opacity <= 1)
  ) {
    return fail('IFC_INVALID_OPACITY', 'A opacidade deve ficar entre 5% e 100%.');
  }
  const next: IfcImportedModel = {
    ...model,
    name: patch.name !== undefined ? patch.name.trim() : model.name,
    visible: patch.visible ?? model.visible,
    opacity: patch.opacity ?? model.opacity,
  };
  if (
    next.name === model.name &&
    next.visible === model.visible &&
    next.opacity === model.opacity
  ) {
    return ok(project);
  }
  return ok({
    ...project,
    ifcModels: project.ifcModels.map((candidate) => (candidate.id === modelId ? next : candidate)),
  });
}

/**
 * Projeto sem os arquivos-fonte embutidos (`data` vazio), para armazenamentos que os guardam
 * à parte. `sha256` continua identificando cada fonte.
 */
export function stripIfcSources(project: Project): Project {
  if (project.ifcModels.every((model) => model.source.data === '')) return project;
  return {
    ...project,
    ifcModels: project.ifcModels.map((model) =>
      model.source.data === '' ? model : { ...model, source: { ...model.source, data: '' } },
    ),
  };
}

/** Reembute as fontes disponíveis em `sources` (por `sha256`) nos modelos que estão sem. */
export function attachIfcSources(project: Project, sources: ReadonlyMap<string, string>): Project {
  let changed = false;
  const ifcModels = project.ifcModels.map((model) => {
    if (model.source.data !== '') return model;
    const data = sources.get(model.source.sha256);
    if (!data) return model;
    changed = true;
    return { ...model, source: { ...model.source, data } };
  });
  return changed ? { ...project, ifcModels } : project;
}
