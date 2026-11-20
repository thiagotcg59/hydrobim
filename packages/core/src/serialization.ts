import { MIN_PIPE_LENGTH } from './dimensions';
import { quatNormalize } from './math';
import { pipeLength } from './ports';
import { fail, ok, type Result } from './result';
import {
  defaultInfraSettings,
  PROJECT_FORMAT,
  ProjectSchema,
  SCHEMA_VERSION,
  surveySource,
  type Project,
} from './schema';

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
  // v3 → v4: anotações da planta baixa e escala do desenho.
  3: (doc) => ({ ...doc, schemaVersion: 4, annotations: [], drawingScale: 50 }),
  // v4 → v5: tipo `strainer` (filtro Y) e furação opcional dos flanges.
  // Documentos v4 já são válidos no esquema v5.
  4: (doc) => ({ ...doc, schemaVersion: 5 }),
  // v5 → v6: forma construtiva, modelo comercial, bocais adicionais e acessórios dos
  // reservatórios (todos opcionais). Documentos v5 já são válidos no esquema v6.
  5: (doc) => ({ ...doc, schemaVersion: 6 }),
  // v6 → v7: ressalto dos flanges e acabamento das extremidades dos tubos (tubos com
  // flanges), ambos opcionais. Documentos v6 já são válidos no esquema v7.
  6: (doc) => ({ ...doc, schemaVersion: 7 }),
  // v7 → v8: famílias de reservatórios personalizadas no projeto.
  7: (doc) => ({ tankFamilies: [], ...doc, schemaVersion: 8 }),
  // v8 → v9: valores IFC informados pelo usuário, por tipo (`ifcTypes`) e por ocorrência
  // (`ifc`, opcional em cada elemento).
  8: (doc) => ({ ifcTypes: {}, ...doc, schemaVersion: 9 }),
  // v9 → v10: trechos retos do joelho (`straight`) e, nas famílias, `centerToEnd2` e
  // `bendRadius` (curvas ponta e bolsa); em válvulas e famílias, `bonnetLength` (castelo
  // retangular das gavetas). Todos opcionais: documentos v9 já são válidos.
  9: (doc) => ({ ...doc, schemaVersion: 10 }),
  // v10 → v11: configuração do ambiente Infra (`infra`) e referência altimétrica da
  // georreferência (`verticalDatum`, não informada). A escala que um projeto Infra usava na
  // planta passa a ser a escala da Planta Infra; nada geográfico é presumido. O tipo
  // `flowMeter` (medidor de vazão) entrou neste mesmo esquema, ainda não publicado: é só um
  // valor novo de `valveType` e não exige migração. O mesmo vale para `jointDeflection`,
  // `coldBendRadius` e `coldBendSpan` na especificação (mudança de direção sem peça):
  // opcionais, e ausentes = junta rígida e tubo que não é curvado.
  10: (doc) => ({
    infra: defaultInfraSettings(
      doc.discipline === 'infra' && typeof doc.drawingScale === 'number' && doc.drawingScale > 0
        ? doc.drawingScale
        : undefined,
    ),
    ...doc,
    schemaVersion: 11,
    georeference:
      typeof doc.georeference === 'object' && doc.georeference !== null
        ? { verticalDatum: null, ...doc.georeference }
        : doc.georeference,
  }),
  // v11 → v12: a superfície do terreno passa a registrar o limite (contorno e furos), as
  // linhas de quebra e a procedência dos dados. Um terreno antigo é um levantamento por pontos
  // sem limite informado (envoltória convexa); datum, exatidão e data continuam não informados.
  11: (doc) => ({
    ...doc,
    schemaVersion: 12,
    terrain:
      typeof doc.terrain === 'object' && doc.terrain !== null
        ? {
            boundary: null,
            breaklines: [],
            source: surveySource(null, null),
            ...doc.terrain,
          }
        : doc.terrain,
  }),
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
