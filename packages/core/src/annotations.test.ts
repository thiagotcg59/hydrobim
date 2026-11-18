import { SCHEMA_VERSION } from './schema';
import { describe, expect, it } from 'vitest';
import {
  addAnnotation,
  deleteAnnotations,
  dimensionGeometry,
  dimensionOffsetAt,
  formatDimension,
  planSnapPoints,
  point2,
  setDrawingScale,
  tagText,
  updateAnnotation,
} from './annotations';
import { vec3 } from './math';
import { addPipe, createProject, deleteElements } from './operations';
import { parseProject, serializeProject } from './serialization';
import { testSpec } from './testSupport';
import { validateProject } from './validation';

function projectWithPipe() {
  const created = addPipe(createProject('Planta'), {
    start: vec3(0, 0, 1),
    end: vec3(3, 4, 1),
    spec: testSpec(50),
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

describe('cotas', () => {
  it('cota alinhada mede a distância em planta e afasta a linha pela normal', () => {
    const g = dimensionGeometry({
      a: point2(0, 0),
      b: point2(3, 4),
      mode: 'aligned',
      offset: 0.5,
    });
    expect(g?.value).toBeCloseTo(5, 9);
    expect(g?.start.x).toBeCloseTo(-0.4, 9);
    expect(g?.start.y).toBeCloseTo(0.3, 9);
    expect(g?.end.x).toBeCloseTo(2.6, 9);
    expect(g?.end.y).toBeCloseTo(4.3, 9);
  });

  it('cotas horizontal e vertical medem ΔX e ΔY', () => {
    const base = { a: point2(1, 1), b: point2(4, -3), offset: 2 };
    const h = dimensionGeometry({ ...base, mode: 'horizontal' });
    expect(h?.value).toBeCloseTo(3, 9);
    expect(h?.start).toEqual({ x: 1, y: 3 });
    expect(h?.end).toEqual({ x: 4, y: 3 });
    const v = dimensionGeometry({ ...base, mode: 'vertical' });
    expect(v?.value).toBeCloseTo(4, 9);
    // B está abaixo de A: a linha de cota corre no sentido −Y.
    expect(v?.direction.y).toBe(-1);
    expect(v?.start).toEqual({ x: -1, y: 1 });
  });

  it('o afastamento calculado faz a linha passar pelo ponto escolhido', () => {
    const dimension = { a: point2(0, 0), b: point2(2, 0), mode: 'aligned' as const };
    expect(dimensionOffsetAt(dimension, point2(1, 0.75))).toBeCloseTo(0.75, 9);
    expect(dimensionOffsetAt(dimension, point2(5, -0.2))).toBeCloseTo(-0.2, 9);
  });

  it('formata em metros com duas casas e vírgula decimal', () => {
    expect(formatDimension(7.754)).toBe('7,75');
    expect(formatDimension(0.3)).toBe('0,30');
  });

  it('recusa cota entre pontos coincidentes na direção cotada', () => {
    const project = createProject('Planta');
    const same = addAnnotation(project, {
      kind: 'dimension',
      a: point2(1, 1),
      b: point2(1, 1),
      offset: 0.3,
      mode: 'aligned',
    });
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.error.code).toBe('DIMENSION_ZERO');
    const flat = addAnnotation(project, {
      kind: 'dimension',
      a: point2(1, 1),
      b: point2(1, 5),
      offset: 0.3,
      mode: 'horizontal',
    });
    expect(flat.ok).toBe(false);
  });
});

describe('anotações do projeto', () => {
  it('cria, altera e exclui sem mutar o projeto recebido', () => {
    const project = createProject('Planta');
    const added = addAnnotation(project, {
      kind: 'text',
      position: point2(1, 2),
      text: 'CASA DE MÁQUINAS',
      rotation: 0,
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(project.annotations).toHaveLength(0);
    const id = added.value.annotationId;

    const edited = updateAnnotation(added.value.project, id, {
      text: 'RECALQUE',
      leader: point2(0, 0),
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.value.annotations[0]).toMatchObject({ text: 'RECALQUE', leader: { x: 0, y: 0 } });
    expect(edited.value.annotations[0]?.id).toBe(id);

    const noLeader = updateAnnotation(edited.value, id, { leader: null });
    expect(noLeader.ok && 'leader' in (noLeader.value.annotations[0] ?? {})).toBe(false);

    const empty = updateAnnotation(edited.value, id, { text: '   ' });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('EMPTY_TEXT');

    expect(deleteAnnotations(edited.value, [id]).annotations).toHaveLength(0);
    expect(updateAnnotation(project, 'x', { text: 'a' }).ok).toBe(false);
  });

  it('etiqueta deriva o conteúdo do elemento e é removida com ele', () => {
    const { project, elementId } = projectWithPipe();
    const pipe = project.elements[0];
    expect(pipe && tagText(pipe)).toBe('DN 50 — 5,00 m');

    const missing = addAnnotation(project, {
      kind: 'tag',
      elementId: 'inexistente',
      position: point2(0, 0),
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('ELEMENT_NOT_FOUND');

    const tagged = addAnnotation(project, { kind: 'tag', elementId, position: point2(1, 2) });
    expect(tagged.ok).toBe(true);
    if (!tagged.ok) return;
    expect(validateProject(tagged.value.project)).toEqual([]);
    expect(deleteElements(tagged.value.project, [elementId]).annotations).toHaveLength(0);

    // Etiqueta órfã (arquivo editado à mão) aparece na validação.
    const orphan = { ...tagged.value.project, elements: [], connections: [] };
    expect(validateProject(orphan).map((i) => i.code)).toContain('DANGLING_ANNOTATION');
  });

  it('pontos de captura incluem as extremidades dos tubos', () => {
    const { project } = projectWithPipe();
    const points = planSnapPoints(project).map((p) => [
      Math.round(p.x * 1e6),
      Math.round(p.y * 1e6),
    ]);
    expect(points).toHaveLength(2);
    expect(points).toContainEqual([0, 0]);
    expect(points).toContainEqual([3e6, 4e6]);
  });

  it('escala do desenho: valida e persiste', () => {
    const project = createProject('Planta');
    expect(project.drawingScale).toBe(50);
    expect(createProject('Rede', 'infra').drawingScale).toBe(500);
    expect(setDrawingScale(project, 0).ok).toBe(false);
    const scaled = setDrawingScale(project, 100);
    expect(scaled.ok && scaled.value.drawingScale).toBe(100);
  });

  it('anotações sobrevivem à serialização e projetos v3 são migrados', () => {
    const { project, elementId } = projectWithPipe();
    const a = addAnnotation(project, {
      kind: 'dimension',
      a: point2(0, 0),
      b: point2(3, 4),
      offset: 0.4,
      mode: 'aligned',
    });
    if (!a.ok) throw new Error(a.error.message);
    const b = addAnnotation(a.value.project, { kind: 'tag', elementId, position: point2(1, 1) });
    if (!b.ok) throw new Error(b.error.message);
    const parsed = parseProject(serializeProject(b.value.project));
    expect(parsed.ok && parsed.value.annotations).toEqual(b.value.project.annotations);

    const { annotations: _a, drawingScale: _s, ...v3 } = project;
    const migrated = parseProject(JSON.stringify({ ...v3, schemaVersion: 3 }));
    expect(migrated.ok).toBe(true);
    if (migrated.ok) {
      expect(migrated.value.schemaVersion).toBe(SCHEMA_VERSION);
      expect(migrated.value.annotations).toEqual([]);
      expect(migrated.value.drawingScale).toBe(50);
    }
  });
});
