import { describe, expect, it } from 'vitest';
import { vec3 } from './math';
import { addPipe, createProject, setPipeLength } from './operations';
import { addLevel, removeLevel } from './projectOps';
import { SCHEMA_VERSION, type Project, type ProjectView2d } from './schema';
import { parseProject, parseProjectDocument, serializeProject } from './serialization';
import { testSpec } from './testSupport';
import { validateProject } from './validation';
import {
  addView,
  addViewDetail,
  copyViewDetails,
  defaultSectionBox,
  deleteView,
  deleteViewDetails,
  duplicateView,
  fromViewPoint,
  getView,
  isView2d,
  moveView,
  moveViewDetails,
  planRangeOf,
  renameView,
  sectionFromPoints,
  toViewPoint,
  updateView,
  updateViewDetail,
  viewClipPlanesOf,
  viewDepthOf,
  viewElementsOf,
  viewFrameOf,
  type DetailInput,
} from './views';

function base(): { project: Project; pipeId: string } {
  const created = addPipe(createProject('Vistas'), {
    start: vec3(0, 0, 1),
    end: vec3(4, 0, 1),
    spec: testSpec(50),
  });
  if (!created.ok) throw new Error(created.error.message);
  return { project: created.value.project, pipeId: created.value.elementId };
}

const levelOf = (project: Project): string => project.levels[0]?.id ?? '';

function withPlan(project: Project): { project: Project; viewId: string } {
  const added = addView(project, { kind: 'plan', levelId: levelOf(project) });
  if (!added.ok) throw new Error(added.error.message);
  return added.value;
}

function view2d(project: Project, id: string): ProjectView2d {
  const view = getView(project, id);
  if (!view || !isView2d(view)) throw new Error('vista 2D esperada');
  return view;
}

describe('vistas de projeto', () => {
  it('cria planta, corte, elevação e vista 3D com nomes próprios, sem alterar o modelo', () => {
    const { project } = base();
    const plan = withPlan(project);
    const section = addView(plan.project, {
      kind: 'section',
      a: { x: 0, y: -1 },
      b: { x: 4, y: -1 },
      side: 1,
      depth: 3,
    });
    expect(section.ok).toBe(true);
    if (!section.ok) return;
    const elevation = addView(section.value.project, { kind: 'elevation', direction: 'south' });
    expect(elevation.ok).toBe(true);
    if (!elevation.ok) return;
    const model = addView(elevation.value.project, { kind: '3d' });
    expect(model.ok).toBe(true);
    if (!model.ok) return;
    const result = model.value.project;
    expect(result.views.map((view) => view.name)).toEqual([
      'Planta — Térreo',
      'Corte 1',
      'Elevação Sul',
      'Vista 3D 1',
    ]);
    // Vistas só controlam a visualização: elementos e conexões são os mesmos objetos.
    expect(result.elements).toBe(project.elements);
    expect(result.connections).toBe(project.connections);
    expect(project.views).toHaveLength(0);
    expect(validateProject(result)).toEqual([]);
  });

  it('recusa nome vazio, nome repetido, nível inexistente e corte sem linha ou sem alcance', () => {
    const { project } = withPlan(base().project);
    const id = project.views[0]?.id ?? '';
    const empty = renameView(project, id, '   ');
    expect(!empty.ok && empty.error.code).toBe('INVALID_VIEW_NAME');
    const again = addView(project, {
      kind: 'plan',
      levelId: levelOf(project),
      name: 'planta — térreo',
    });
    expect(!again.ok && again.error.code).toBe('VIEW_NAME_TAKEN');
    const level = addView(project, { kind: 'plan', levelId: 'nao-existe' });
    expect(!level.ok && level.error.code).toBe('LEVEL_NOT_FOUND');
    const point = { x: 1, y: 1 };
    const short = addView(project, { kind: 'section', a: point, b: point, side: 1, depth: 2 });
    expect(!short.ok && short.error.code).toBe('SECTION_TOO_SHORT');
    const flat = addView(project, {
      kind: 'section',
      a: point,
      b: { x: 5, y: 1 },
      side: 1,
      depth: 0,
    });
    expect(!flat.ok && flat.error.code).toBe('SECTION_NO_DEPTH');
  });

  it('altera a configuração de cada vista de forma independente e recusa campo de outro tipo', () => {
    const first = withPlan(base().project);
    const second = addView(first.project, { kind: 'elevation', direction: 'east' });
    if (!second.ok) throw new Error(second.error.message);
    const changed = updateView(second.value.project, first.viewId, {
      scale: 25,
      rotation: Math.PI / 2,
      cutHeight: 1.5,
      depth: 2,
      style: { theme: 'mono', thinLines: false },
      visibility: { hiddenSystemIds: [], hiddenCategories: ['valves'], details: false },
      crop: { enabled: true, min: { x: -1, y: -1 }, max: { x: 5, y: 2 } },
      frame: { center: { x: 2, y: 0 }, height: 6 },
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    const plan = view2d(changed.value, first.viewId);
    expect(plan.scale).toBe(25);
    expect(plan.style.theme).toBe('mono');
    expect(plan.crop?.enabled).toBe(true);
    const other = view2d(changed.value, second.value.viewId);
    expect(other.scale).toBe(50);
    expect(other.style.theme).toBe('color');
    expect(other.crop).toBeNull();

    const wrong = updateView(changed.value, second.value.viewId, { cutHeight: 2 });
    expect(!wrong.ok && wrong.error.code).toBe('INVALID_VIEW_PATCH');
    const crop = updateView(changed.value, first.viewId, {
      crop: { enabled: true, min: { x: 0, y: 0 }, max: { x: 0, y: 3 } },
    });
    expect(!crop.ok && crop.error.code).toBe('INVALID_CROP');
  });

  it('duplica com os detalhes, reordena dentro do tipo e exclui', () => {
    const plan = withPlan(base().project);
    const line = addViewDetail(plan.project, plan.viewId, {
      kind: 'line',
      a: { x: 0, y: 0 },
      b: { x: 1, y: 0 },
    });
    if (!line.ok) throw new Error(line.error.message);
    const elevation = addView(line.value.project, { kind: 'elevation', direction: 'north' });
    if (!elevation.ok) throw new Error(elevation.error.message);
    const copy = duplicateView(elevation.value.project, plan.viewId);
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    const names = (project: Project): string[] => project.views.map((view) => view.name);
    expect(names(copy.value.project)).toEqual([
      'Planta — Térreo',
      'Planta — Térreo — cópia',
      'Elevação Norte',
    ]);
    const original = view2d(copy.value.project, plan.viewId);
    const duplicate = view2d(copy.value.project, copy.value.viewId);
    expect(duplicate.details).toHaveLength(1);
    expect(duplicate.details[0]?.id).not.toBe(original.details[0]?.id);

    const up = moveView(copy.value.project, copy.value.viewId, -1);
    expect(up.ok && names(up.value)).toEqual([
      'Planta — Térreo — cópia',
      'Planta — Térreo',
      'Elevação Norte',
    ]);
    // No extremo do grupo nada muda (a elevação não troca de lugar com as plantas).
    const edge = moveView(copy.value.project, plan.viewId, -1);
    expect(edge.ok && edge.value).toBe(copy.value.project);

    const removed = deleteView(copy.value.project, plan.viewId);
    expect(removed.ok && names(removed.value)).toEqual([
      'Planta — Térreo — cópia',
      'Elevação Norte',
    ]);
    const missing = deleteView(copy.value.project, 'nada');
    expect(!missing.ok && missing.error.code).toBe('VIEW_NOT_FOUND');
  });

  it('a planta segue a cota do nível e o nível em uso não pode ser excluído', () => {
    const levels = addLevel(base().project, '1º pavimento', 3);
    if (!levels.ok) throw new Error(levels.error.message);
    const upper = levels.value.levels.find((level) => level.elevation === 3);
    const plan = addView(levels.value, { kind: 'plan', levelId: upper?.id ?? '' });
    if (!plan.ok) throw new Error(plan.error.message);
    const view = getView(plan.value.project, plan.value.viewId);
    if (view?.kind !== 'plan') throw new Error('planta esperada');
    // Sem nível acima: pé-direito adotado de 3 m, faixa até 30 cm abaixo do nível.
    expect(planRangeOf(plan.value.project, view)).toEqual({ top: 6, bottom: 2.7 });
    const ground = addView(plan.value.project, {
      kind: 'plan',
      levelId: levelOf(plan.value.project),
    });
    if (!ground.ok) throw new Error(ground.error.message);
    const lower = getView(ground.value.project, ground.value.viewId);
    if (lower?.kind !== 'plan') throw new Error('planta esperada');
    expect(planRangeOf(ground.value.project, lower).top).toBe(3);

    const removed = removeLevel(ground.value.project, upper?.id ?? '');
    expect(!removed.ok && removed.error.code).toBe('LEVEL_IN_USE');
  });
});

describe('referencial e faixa de corte', () => {
  it('planta girada, corte e elevação levam o ponto do modelo à vista e de volta', () => {
    const { project } = withPlan(base().project);
    const plan = view2d(project, project.views[0]?.id ?? '');
    const turned = viewFrameOf({ ...plan, kind: 'plan', rotation: Math.PI / 2 } as ProjectView2d);
    const p = toViewPoint(turned, vec3(0, 2, 5));
    expect(p.x).toBeCloseTo(2);
    expect(p.y).toBeCloseTo(0);

    const section = addView(project, {
      kind: 'section',
      a: { x: 4, y: 1 },
      b: { x: 0, y: 1 },
      side: -1,
      depth: 2,
    });
    if (!section.ok) throw new Error(section.error.message);
    const view = view2d(section.value.project, section.value.viewId);
    const frame = viewFrameOf(view);
    // a→b aponta para −X; lado −1 = à direita de quem caminha: olha para +Y (norte).
    expect(frame.w).toEqual(vec3(-0, -1, -0));
    expect(frame.origin).toEqual(vec3(0, 1, 0));
    const point = vec3(3, 2.5, 1.2);
    const projected = toViewPoint(frame, point);
    expect(projected).toEqual({ x: 3, y: 1.2 });
    expect(viewDepthOf(frame, point)).toBeCloseTo(-1.5);
    const back = fromViewPoint(frame, projected, viewDepthOf(frame, point));
    expect(back.x).toBeCloseTo(3);
    expect(back.y).toBeCloseTo(2.5);
    expect(back.z).toBeCloseTo(1.2);

    // Quatro planos: a linha, o alcance e as duas pontas.
    const planes = viewClipPlanesOf(section.value.project, view);
    const inside = (q: ReturnType<typeof vec3>): boolean =>
      planes.every(
        (plane) =>
          (q.x - plane.point.x) * plane.normal.x +
            (q.y - plane.point.y) * plane.normal.y +
            (q.z - plane.point.z) * plane.normal.z >=
          0,
      );
    expect(inside(vec3(2, 2, 9))).toBe(true);
    expect(inside(vec3(2, 0.5, 0))).toBe(false); // atrás da linha
    expect(inside(vec3(2, 3.5, 0))).toBe(false); // além do alcance
    expect(inside(vec3(5, 2, 0))).toBe(false); // além da ponta
  });

  it('lado e alcance do corte vêm do terceiro ponto', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(sectionFromPoints(a, b, { x: 3, y: 2.5 })).toEqual({ side: 1, depth: 2.5 });
    expect(sectionFromPoints(a, b, { x: 3, y: -4 })).toEqual({ side: -1, depth: 4 });
  });

  it('a visibilidade da vista soma-se à do sistema e não vale para as outras', () => {
    const { project, pipeId } = base();
    const plan = withPlan(project);
    const other = addView(plan.project, { kind: '3d' });
    if (!other.ok) throw new Error(other.error.message);
    const hidden = updateView(other.value.project, plan.viewId, {
      visibility: { hiddenSystemIds: [], hiddenCategories: ['pipes'], details: true },
    });
    if (!hidden.ok) throw new Error(hidden.error.message);
    const first = getView(hidden.value, plan.viewId);
    const second = getView(hidden.value, other.value.viewId);
    if (!first || !second) throw new Error('vistas esperadas');
    expect(viewElementsOf(hidden.value, first)).toHaveLength(0);
    expect(viewElementsOf(hidden.value, second).map((e) => e.id)).toEqual([pipeId]);
  });

  it('a caixa de corte inicial envolve o modelo e recusa extensão nula', () => {
    const { project } = base();
    const box = defaultSectionBox(project);
    expect(box.min.x).toBeLessThan(0);
    expect(box.max.x).toBeGreaterThan(4);
    const view = addView(project, { kind: '3d', sectionBox: box });
    if (!view.ok) throw new Error(view.error.message);
    const flat = updateView(view.value.project, view.value.viewId, {
      sectionBox: { enabled: true, min: vec3(0, 0, 0), max: vec3(1, 1, 0) },
    });
    expect(!flat.ok && flat.error.code).toBe('INVALID_SECTION_BOX');
  });
});

describe('detalhes 2D da vista', () => {
  it('cria, edita, move, copia e exclui sem criar elemento nem alterar outra vista', () => {
    const { project } = base();
    const plan = withPlan(project);
    const second = addView(plan.project, { kind: 'elevation', direction: 'south' });
    if (!second.ok) throw new Error(second.error.message);
    let current = second.value.project;
    const ids: string[] = [];
    const inputs: DetailInput[] = [
      { kind: 'line', a: { x: 0, y: 0 }, b: { x: 2, y: 0 } },
      {
        kind: 'polyline',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 2, y: 0 },
        ],
        closed: true,
      },
      { kind: 'rect', a: { x: 0, y: 0 }, b: { x: 2, y: 1 } },
      { kind: 'circle', center: { x: 1, y: 1 }, radius: 0.5 },
      { kind: 'text', position: { x: 0, y: 2 }, text: 'DETALHE 1', rotation: 0 },
      { kind: 'dimension', a: { x: 0, y: 0 }, b: { x: 2, y: 0 }, offset: 0.5, mode: 'aligned' },
    ];
    for (const input of inputs) {
      const added = addViewDetail(current, plan.viewId, input);
      expect(added.ok).toBe(true);
      if (!added.ok) return;
      current = added.value.project;
      ids.push(added.value.detailId);
    }
    expect(view2d(current, plan.viewId).details.map((d) => d.kind)).toEqual([
      'line',
      'polyline',
      'rect',
      'circle',
      'text',
      'dimension',
    ]);
    // Detalhes não são tubulação: o modelo e a outra vista ficam como estavam.
    expect(current.elements).toBe(project.elements);
    expect(view2d(current, second.value.viewId).details).toHaveLength(0);
    expect(validateProject(current)).toEqual([]);

    const edited = updateViewDetail(current, plan.viewId, ids[3] ?? '', { radius: 0.75 });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const circle = view2d(edited.value, plan.viewId).details[3];
    expect(circle?.kind === 'circle' && circle.radius).toBe(0.75);
    const wrong = updateViewDetail(current, plan.viewId, ids[0] ?? '', { radius: 1 });
    expect(!wrong.ok && wrong.error.code).toBe('INVALID_DETAIL_PATCH');

    const moved = moveViewDetails(edited.value, plan.viewId, [ids[0] ?? ''], { x: 1, y: 2 });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const line = view2d(moved.value, plan.viewId).details[0];
    expect(line?.kind === 'line' && line.a).toEqual({ x: 1, y: 2 });

    const copied = copyViewDetails(moved.value, plan.viewId, [ids[2] ?? ''], { x: 5, y: 0 });
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    const details = view2d(copied.value.project, plan.viewId).details;
    expect(details).toHaveLength(7);
    const copy = details[6];
    expect(copy?.kind === 'rect' && copy.a).toEqual({ x: 5, y: 0 });
    expect(copy?.id).toBe(copied.value.detailIds[0]);

    const removed = deleteViewDetails(copied.value.project, plan.viewId, [
      ids[0] ?? '',
      ids[1] ?? '',
    ]);
    expect(removed.ok && view2d(removed.value, plan.viewId).details).toHaveLength(5);
  });

  it('recusa detalhe degenerado, texto vazio e detalhe em vista 3D', () => {
    const { project } = base();
    const plan = withPlan(project);
    const p = { x: 1, y: 1 };
    const line = addViewDetail(plan.project, plan.viewId, { kind: 'line', a: p, b: p });
    expect(!line.ok && line.error.code).toBe('DETAIL_ZERO');
    const circle = addViewDetail(plan.project, plan.viewId, {
      kind: 'circle',
      center: p,
      radius: 0,
    });
    expect(!circle.ok && circle.error.code).toBe('CIRCLE_NO_RADIUS');
    const text = addViewDetail(plan.project, plan.viewId, {
      kind: 'text',
      position: p,
      text: '  ',
      rotation: 0,
    });
    expect(!text.ok && text.error.code).toBe('EMPTY_TEXT');
    const model = addView(plan.project, { kind: '3d' });
    if (!model.ok) throw new Error(model.error.message);
    const on3d = addViewDetail(model.value.project, model.value.viewId, {
      kind: 'line',
      a: p,
      b: { x: 2, y: 2 },
    });
    expect(!on3d.ok && on3d.error.code).toBe('VIEW_NOT_2D');
  });
});

describe('persistência das vistas', () => {
  it('salva e reabre vistas, câmera, caixa de corte, recorte e detalhes sem perda', () => {
    const { project } = base();
    const plan = withPlan(project);
    const detail = addViewDetail(plan.project, plan.viewId, {
      kind: 'circle',
      center: { x: 1, y: 2 },
      radius: 0.4,
    });
    if (!detail.ok) throw new Error(detail.error.message);
    const cropped = updateView(detail.value.project, plan.viewId, {
      crop: { enabled: true, min: { x: -1, y: -1 }, max: { x: 5, y: 3 } },
    });
    if (!cropped.ok) throw new Error(cropped.error.message);
    const model = addView(cropped.value, {
      kind: '3d',
      camera: {
        target: vec3(2, 0, 1),
        direction: vec3(1, -1, 1),
        halfHeight: 4,
        projection: 'orthographic',
      },
      sectionBox: { enabled: true, min: vec3(-1, -1, 0), max: vec3(5, 1, 2) },
    });
    if (!model.ok) throw new Error(model.error.message);
    const reopened = parseProject(serializeProject(model.value.project));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.value.views).toEqual(model.value.project.views);
    expect(reopened.value.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('migra um documento v14 (sem vistas) e recusa planta de nível inexistente', () => {
    const { project } = base();
    const { views: _views, ...rest } = JSON.parse(serializeProject(project)) as Record<
      string,
      unknown
    >;
    const migrated = parseProjectDocument({ ...rest, schemaVersion: 14 });
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.views).toEqual([]);
    expect(migrated.value.schemaVersion).toBe(SCHEMA_VERSION);

    const plan = withPlan(project);
    const document = JSON.parse(serializeProject(plan.project)) as { views: { levelId: string }[] };
    const first = document.views[0];
    if (first) first.levelId = 'apagado';
    const dangling = parseProjectDocument(document);
    expect(!dangling.ok && dangling.error.code).toBe('DANGLING_VIEW_LEVEL');
  });
});

describe('sincronização com o modelo', () => {
  it('uma alteração de engenharia não toca nas vistas, que passam a mostrar o elemento novo', () => {
    const { project, pipeId } = base();
    const plan = withPlan(project);
    const view = getView(plan.project, plan.viewId);
    if (!view) throw new Error('vista esperada');
    const longer = setPipeLength(plan.project, pipeId, 6);
    expect(longer.ok).toBe(true);
    if (!longer.ok) return;
    // A vista é o mesmo objeto; o que ela mostra é derivado do modelo alterado.
    expect(getView(longer.value, plan.viewId)).toBe(view);
    const shown = viewElementsOf(longer.value, view)[0];
    expect(shown?.kind === 'pipe' && shown.end.x).toBeCloseTo(6);
  });
});
