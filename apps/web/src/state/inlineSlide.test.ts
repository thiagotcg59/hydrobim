import { resolvePipeSpec } from '@hydrobim/catalog';
import {
  addPipe,
  createProject,
  drawPipe,
  inlineClearancesOf,
  insertInline,
  validateProject,
  vec3,
  type Project,
  type Result,
} from '@hydrobim/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from './editorStore';

const state = () => useEditorStore.getState();

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const resolved = resolvePipeSpec('ferro-ductil-nbr7675-k9', 80);
if (!resolved) throw new Error('especificação ausente');
const spec = resolved;

/** Tubo de 4 m em X, joelho na ponta final e válvula a 1,5 m do início. */
function scenario(): { project: Project; valve: string } {
  const base = unwrap(
    addPipe(createProject('Teste'), { start: vec3(0, 0, 0), end: vec3(4, 0, 0), spec }),
  );
  const bent = unwrap(
    drawPipe(base.project, {
      fromPort: { elementId: base.elementId, portId: 'end' },
      start: vec3(4, 0, 0),
      end: vec3(4, 2, 0),
      spec,
    }),
  );
  const inserted = unwrap(
    insertInline(bent.project, {
      pipeId: base.elementId,
      distanceFromStart: 1.5,
      fitting: { kind: 'valve' },
    }),
  );
  return { project: inserted.project, valve: inserted.elementId };
}

const clearanceA = (valve: string): number =>
  inlineClearancesOf(state().project, valve).find((c) => c.portId === 'a')?.length ?? Number.NaN;

let valve = '';
beforeEach(() => {
  const built = scenario();
  valve = built.valve;
  state().loadProject(built.project);
  state().setSnapToGrid(true);
  state().setGridStep(0.1);
  state().select(valve);
});

describe('arrastar peça entre os tubos', () => {
  it('prévia ao vivo, cota no passo da grade e um único passo no histórico', () => {
    const history = state().past.length;
    const grab = vec3(1.5, 0, 0);
    state().beginInlineSlide(valve, grab);
    state().inlineSlideTo(vec3(1.9, 0, 0));
    state().inlineSlideTo(vec3(2.33, 0, 0));
    expect(state().past.length).toBe(history);
    state().endInlineSlide(true);
    expect(state().inlineSlide).toBeNull();
    expect(state().past.length).toBe(history + 1);
    expect((clearanceA(valve) * 10) % 1).toBeCloseTo(0, 6);
    expect(validateProject(state().project).filter((i) => i.severity === 'error')).toEqual([]);
    state().undo();
    expect(state().past.length).toBe(history);
  });

  it('cancelar restaura o projeto do início', () => {
    const before = state().project;
    state().beginInlineSlide(valve, vec3(1.5, 0, 0));
    state().inlineSlideTo(vec3(2.5, 0, 0));
    expect(state().project).not.toBe(before);
    state().cancelInteraction();
    expect(state().inlineSlide).toBeNull();
    expect(state().project).toBe(before);
  });

  it('cota digitada no painel posiciona a peça; recusa sem espaço', () => {
    state().setInlineClearanceOf(valve, 'a', 1.2);
    expect(clearanceA(valve)).toBeCloseTo(1.2, 9);
    expect(state().message?.level).toBe('success');
    const before = state().project;
    state().setInlineClearanceOf(valve, 'a', 30);
    expect(state().project).toBe(before);
    expect(state().message?.level).toBe('error');
  });
});
