import { getElement } from './connectivity';
import { type FittingCatalog } from './families';
import { newId } from './ids';
import { now, putElement, touch } from './internal';
import { reconcile } from './reconcile';
import { fail, ok, type Result } from './result';
import {
  FittingFamilySchema,
  GeoreferenceSchema,
  type FittingFamily,
  type Georeference,
  type HydraulicSystem,
  type Level,
  type Project,
  type SystemKind,
  type Terrain,
} from './schema';
import { applySpec } from './sizing';

/** Operações sobre dados de projeto: níveis, sistemas, famílias, georreferência e terreno. */

// ---------------------------------------------------------------------------
// Níveis
// ---------------------------------------------------------------------------

export function addLevel(project: Project, name: string, elevation: number): Result<Project> {
  if (!Number.isFinite(elevation)) return fail('INVALID_VALUE', 'Cota inválida.');
  const trimmed = name.trim();
  if (trimmed.length === 0) return fail('INVALID_NAME', 'O nome do nível não pode ser vazio.');
  const level: Level = { id: newId(), name: trimmed, elevation };
  return ok({
    ...project,
    updatedAt: now(),
    levels: [...project.levels, level].sort((a, b) => a.elevation - b.elevation),
  });
}

export function updateLevel(
  project: Project,
  id: string,
  patch: { name?: string; elevation?: number },
): Result<Project> {
  if (!project.levels.some((l) => l.id === id)) return fail('NOT_FOUND', 'Nível inexistente.');
  if (patch.elevation !== undefined && !Number.isFinite(patch.elevation)) {
    return fail('INVALID_VALUE', 'Cota inválida.');
  }
  if (patch.name !== undefined && patch.name.trim().length === 0) {
    return fail('INVALID_NAME', 'O nome do nível não pode ser vazio.');
  }
  return ok({
    ...project,
    updatedAt: now(),
    levels: project.levels
      .map((l) => (l.id === id ? { ...l, ...patch, name: (patch.name ?? l.name).trim() } : l))
      .sort((a, b) => a.elevation - b.elevation),
  });
}

export function removeLevel(project: Project, id: string): Result<Project> {
  if (project.levels.length <= 1) {
    return fail('LAST_LEVEL', 'O projeto precisa de ao menos um nível.');
  }
  return ok({ ...project, updatedAt: now(), levels: project.levels.filter((l) => l.id !== id) });
}

// ---------------------------------------------------------------------------
// Sistemas hidráulicos
// ---------------------------------------------------------------------------

export function addSystem(project: Project, name: string, kind: SystemKind): Result<Project> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return fail('INVALID_NAME', 'O nome do sistema não pode ser vazio.');
  const system: HydraulicSystem = { id: newId(), name: trimmed, kind };
  return ok({ ...project, updatedAt: now(), systems: [...project.systems, system] });
}

export function updateSystem(
  project: Project,
  id: string,
  patch: Partial<Omit<HydraulicSystem, 'id'>>,
): Result<Project> {
  if (!project.systems.some((s) => s.id === id)) return fail('NOT_FOUND', 'Sistema inexistente.');
  if (patch.name !== undefined && patch.name.trim().length === 0) {
    return fail('INVALID_NAME', 'O nome do sistema não pode ser vazio.');
  }
  if (patch.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(patch.color)) {
    return fail('INVALID_VALUE', 'Cor inválida.');
  }
  return ok({
    ...project,
    updatedAt: now(),
    systems: project.systems.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  });
}

export function removeSystem(project: Project, id: string): Result<Project> {
  if (project.systems.length <= 1) {
    return fail('LAST_SYSTEM', 'O projeto precisa de ao menos um sistema hidráulico.');
  }
  if (project.elements.some((e) => e.systemId === id)) {
    return fail('SYSTEM_IN_USE', 'Há elementos neste sistema; mova-os antes de excluí-lo.');
  }
  return ok({ ...project, updatedAt: now(), systems: project.systems.filter((s) => s.id !== id) });
}

export function setElementsSystem(
  project: Project,
  ids: readonly string[],
  systemId: string,
): Result<Project> {
  if (!project.systems.some((s) => s.id === systemId)) {
    return fail('SYSTEM_NOT_FOUND', 'Sistema hidráulico inexistente.');
  }
  let next = project;
  for (const id of ids) {
    const element = getElement(next, id);
    if (!element) return fail('ELEMENT_NOT_FOUND', 'Elemento inexistente.');
    next = putElement(next, touch({ ...element, systemId }));
  }
  return ok(next);
}

// ---------------------------------------------------------------------------
// Famílias
// ---------------------------------------------------------------------------

/** Grava (cria ou substitui) uma família personalizada no projeto. */
export function upsertFamily(project: Project, family: FittingFamily): Result<Project> {
  const parsed = FittingFamilySchema.safeParse({ ...family, origin: 'custom' });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      'INVALID_FAMILY',
      `Família inválida${issue ? ` em "${issue.path.join('.')}"` : ''}: verifique se todas as dimensões são positivas.`,
    );
  }
  const keys = new Set<string>();
  for (const size of parsed.data.sizes) {
    const key = `${size.dn}/${size.dn2 ?? ''}`;
    if (keys.has(key)) {
      return fail('DUPLICATE_SIZE', `A família tem linhas repetidas para o DN ${size.dn}.`);
    }
    keys.add(key);
  }
  return ok({
    ...project,
    updatedAt: now(),
    families: [...project.families.filter((f) => f.id !== family.id), parsed.data],
  });
}

/** Remove a personalização: a família volta ao catálogo embutido (se existir nele). */
export function removeFamily(project: Project, familyId: string): Project {
  return {
    ...project,
    updatedAt: now(),
    families: project.families.filter((f) => f.id !== familyId),
  };
}

/**
 * Reaplica as dimensões do catálogo a todas as peças do projeto vinculadas à família,
 * reajustando os vizinhos. Falha de forma atômica se alguma peça não puder ser ajustada.
 */
export function applyFamilyToInstances(
  project: Project,
  familyId: string,
  catalog: FittingCatalog,
): Result<{ project: Project; updated: number }> {
  let next = project;
  let updated = 0;
  for (const original of project.elements) {
    if (original.familyId !== familyId) continue;
    const element = getElement(next, original.id);
    if (!element) continue;
    // Reaplicar a própria especificação recalcula as dimensões pela família atual.
    const result = applySpec(next, element.id, element.spec, { catalog });
    if (!result.ok) {
      return fail(result.error.code, `"${element.name}": ${result.error.message}`);
    }
    next = result.value;
    updated += 1;
  }
  const settled = reconcile(next, []);
  if (!settled.ok) return settled;
  return ok({ project: settled.value, updated });
}

// ---------------------------------------------------------------------------
// Georreferência e terreno
// ---------------------------------------------------------------------------

export function setGeoreference(
  project: Project,
  georeference: Georeference | null,
): Result<Project> {
  if (georeference !== null && !GeoreferenceSchema.safeParse(georeference).success) {
    return fail(
      'INVALID_GEOREFERENCE',
      'Georreferência inválida: informe o nome do sistema de referência e coordenadas numéricas.',
    );
  }
  return ok({ ...project, updatedAt: now(), georeference });
}

export function setTerrain(project: Project, terrain: Terrain | null): Project {
  return { ...project, updatedAt: now(), terrain };
}
