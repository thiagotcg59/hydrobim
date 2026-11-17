import { newId } from './ids';
import type { ElementKind, HydroElement, PipeSpec, Project } from './schema';

/** Utilitários compartilhados pelas operações de domínio. */

export const now = (): string => new Date().toISOString();

const KIND_LABEL: Record<ElementKind, string> = {
  pipe: 'Tubo',
  elbow: 'Joelho',
  tee: 'Tê',
  reducer: 'Redução',
  valve: 'Válvula',
  pump: 'Bomba',
  tank: 'Reservatório',
};

export const elementKindLabel = (kind: ElementKind): string => KIND_LABEL[kind];

export function nextName(project: Project, kind: ElementKind): string {
  const prefix = `${KIND_LABEL[kind]} `;
  let max = 0;
  for (const e of project.elements) {
    if (e.kind !== kind || !e.name.startsWith(prefix)) continue;
    const n = Number.parseInt(e.name.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${max + 1}`;
}

/** Marca o elemento como alterado (histórico básico). */
export function touch<T extends HydroElement>(element: T): T {
  return {
    ...element,
    meta: { ...element.meta, updatedAt: now(), revision: element.meta.revision + 1 },
  };
}

/** Insere ou substitui um elemento, devolvendo um novo projeto. */
export function putElement(project: Project, element: HydroElement): Project {
  const exists = project.elements.some((e) => e.id === element.id);
  return {
    ...project,
    updatedAt: now(),
    elements: exists
      ? project.elements.map((e) => (e.id === element.id ? element : e))
      : [...project.elements, element],
  };
}

export function baseFields(project: Project, kind: ElementKind, spec: PipeSpec, systemId: string) {
  const timestamp = now();
  return {
    id: newId(),
    name: nextName(project, kind),
    systemId,
    spec,
    familyId: null as string | null,
    properties: {},
    manufacturing: {},
    meta: { createdAt: timestamp, updatedAt: timestamp, revision: 0 },
  };
}
