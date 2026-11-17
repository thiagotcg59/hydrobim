import { MIN_PIPE_LENGTH } from './dimensions';
import { quatNormalize } from './math';
import { pipeLength } from './ports';
import { fail, ok, type Result } from './result';
import { PROJECT_FORMAT, ProjectSchema, SCHEMA_VERSION, type Project } from './schema';

/**
 * Migrações de esquema: `MIGRATIONS[n]` converte um documento da versão `n` para `n + 1`.
 * Ao alterar o esquema, incremente `SCHEMA_VERSION` e registre a migração aqui.
 */
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 → v2: famílias, níveis, georreferência, terreno e acabamento de extremidades.
  1: (doc) => ({
    ...doc,
    schemaVersion: 2,
    levels: [{ id: 'nivel-0', name: 'Térreo', elevation: 0 }],
    families: [],
    georeference: null,
    terrain: null,
    elements: Array.isArray(doc.elements)
      ? doc.elements.map((element: unknown) => {
          if (typeof element !== 'object' || element === null) return element;
          const e = element as Record<string, unknown>;
          return e.kind === 'pipe' ? { familyId: null, ...e } : { familyId: null, ends: {}, ...e };
        })
      : doc.elements,
  }),
  // v2 → v3: novo tipo de válvula (`pressureReducing`) e largura opcional de válvulas.
  // Documentos v2 já são válidos no esquema v3.
  2: (doc) => ({ ...doc, schemaVersion: 3 }),
};

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

/** Valida um documento já desserializado e devolve um projeto íntegro. */
export function parseProjectDocument(input: unknown): Result<Project> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail('INVALID_DOCUMENT', 'O arquivo não contém um projeto HydroBIM.');
  }
  let doc = input as Record<string, unknown>;
  if (doc.format !== PROJECT_FORMAT) {
    return fail('INVALID_FORMAT', 'O arquivo não é um projeto HydroBIM.');
  }
  const version = doc.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return fail('INVALID_VERSION', 'Versão de esquema do projeto ausente ou inválida.');
  }
  if (version > SCHEMA_VERSION) {
    return fail(
      'NEWER_VERSION',
      `O projeto foi salvo em uma versão mais recente do HydroBIM (esquema ${version}).`,
    );
  }
  for (let v = version; v < SCHEMA_VERSION; v += 1) {
    const migrate = MIGRATIONS[v];
    if (!migrate) return fail('NO_MIGRATION', `Não há migração a partir do esquema ${v}.`);
    doc = migrate(doc);
  }

  const parsed = ProjectSchema.safeParse(doc);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first ? first.path.join('.') : '';
    return fail(
      'SCHEMA_ERROR',
      `Projeto inválido${where ? ` em "${where}"` : ''}: ${first?.message ?? 'erro de esquema'}.`,
    );
  }

  const project = parsed.data;
  const ids = new Set<string>();
  for (const element of project.elements) {
    if (ids.has(element.id)) {
      return fail('DUPLICATE_ID', `Projeto inválido: identificador duplicado (${element.id}).`);
    }
    ids.add(element.id);
    if (element.kind === 'pipe' && pipeLength(element) < MIN_PIPE_LENGTH) {
      return fail('PIPE_TOO_SHORT', `Projeto inválido: "${element.name}" não tem comprimento.`);
    }
  }
  for (const connection of project.connections) {
    if (!ids.has(connection.a.elementId) || !ids.has(connection.b.elementId)) {
      return fail(
        'DANGLING_CONNECTION',
        'Projeto inválido: há conexões que referenciam elementos inexistentes.',
      );
    }
  }

  return ok({
    ...project,
    elements: project.elements.map((e) =>
      e.kind === 'pipe'
        ? e
        : { ...e, placement: { ...e.placement, rotation: quatNormalize(e.placement.rotation) } },
    ),
  });
}

export function parseProject(json: string): Result<Project> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return fail('INVALID_JSON', 'O arquivo não é um JSON válido.');
  }
  return parseProjectDocument(raw);
}
