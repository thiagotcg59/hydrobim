import { MATERIAL_LABELS } from '@hydrobim/catalog';
import {
  ARCH_KIND_LABELS,
  archLevelIdOf,
  archTypeOf,
  archVerticalRange,
  formatMeters,
  getElement,
  pipeLength,
  type Project,
} from '@hydrobim/core';
import { DISCIPLINE_LABELS, VALVE_TYPE_LABELS } from '../ui/labels';

/**
 * Dados mostrados no painel flutuante da realidade virtual. São lidos do próprio elemento do
 * projeto no momento da consulta — não há cópia nem segunda fonte de dados BIM. Só entram os
 * campos que o elemento realmente tem.
 */

export interface VrInfo {
  readonly title: string;
  readonly rows: readonly (readonly [label: string, value: string])[];
}

const KIND_LABELS = {
  pipe: 'Tubo',
  elbow: 'Joelho',
  tee: 'Tê',
  cross: 'Cruzeta',
  reducer: 'Redução',
  valve: 'Válvula',
  pump: 'Bomba',
  tank: 'Reservatório',
} as const;

/** Propriedades de um elemento da rede, pelo `id` dele no projeto. */
export function vrElementInfo(project: Project, elementId: string): VrInfo | null {
  const element = getElement(project, elementId);
  if (!element) return null;
  const rows: [string, string][] = [];
  const category =
    element.kind === 'valve'
      ? `${KIND_LABELS.valve} · ${VALVE_TYPE_LABELS[element.valveType]}`
      : KIND_LABELS[element.kind];
  rows.push(['Categoria', category]);
  rows.push(['Identificação', element.name]);
  rows.push(['Diâmetro', `DN ${element.spec.dn} · ${element.spec.sizeLabel}`]);
  rows.push(['Material', MATERIAL_LABELS[element.spec.material]]);
  if (element.spec.standard) rows.push(['Norma', element.spec.standard]);
  if (element.spec.pressureClass) rows.push(['Classe', element.spec.pressureClass]);
  if (element.kind === 'pipe') {
    rows.push(['Comprimento', formatMeters(pipeLength(element))]);
    rows.push([
      'Cota do eixo',
      Math.abs(element.start.z - element.end.z) < 5e-4
        ? formatMeters(element.start.z)
        : `${formatMeters(element.start.z)} → ${formatMeters(element.end.z)}`,
    ]);
  } else {
    rows.push(['Cota', formatMeters(element.placement.position.z)]);
  }
  const system = project.systems.find((candidate) => candidate.id === element.systemId);
  if (system) rows.push(['Sistema', system.name]);
  if (element.manufacturing.manufacturer) {
    rows.push(['Fabricante', element.manufacturing.manufacturer]);
  }
  return { title: element.name, rows };
}

/** Propriedades de um elemento de arquitetura, pelo `id` dele no projeto. */
export function vrArchInfo(project: Project, elementId: string): VrInfo | null {
  const { architecture, levels } = project;
  const element = architecture.elements.find((candidate) => candidate.id === elementId);
  if (!element) return null;
  const rows: [string, string][] = [
    ['Categoria', `Arquitetura · ${ARCH_KIND_LABELS[element.kind]}`],
    ['Identificação', element.name],
  ];
  const type = archTypeOf(architecture, element);
  if (type) rows.push(['Tipo', type.name]);
  const levelId = archLevelIdOf(architecture, element);
  const level = levels.find((candidate) => candidate.id === levelId);
  if (level) rows.push(['Nível', `${level.name} (${formatMeters(level.elevation, 2)})`]);
  const range = archVerticalRange(project, element);
  if (range) {
    rows.push(['Cotas', `${formatMeters(range.base, 2)} a ${formatMeters(range.top, 2)}`]);
  }
  return { title: element.name, rows };
}

/** Resumo do projeto, para o menu da sessão. */
export function vrProjectInfo(project: Project): VrInfo {
  const rows: [string, string][] = [
    ['Ambiente', DISCIPLINE_LABELS[project.discipline]],
    ['Elementos da rede', String(project.elements.length)],
    ['Sistemas', String(project.systems.length)],
    ['Níveis', String(project.levels.length)],
  ];
  if (project.architecture.elements.length > 0) {
    rows.push(['Elementos de arquitetura', String(project.architecture.elements.length)]);
  }
  rows.push(['Terreno', project.terrain ? 'Superfície gerada' : 'Sem superfície']);
  return { title: project.name, rows };
}
