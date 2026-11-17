import { createProject, getFreePorts, validateProject, vec3 } from '@hydrobim/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoProject } from '../demo/demoProject';
import { familiesOf, selectIsDirty, useEditorStore } from './editorStore';

const state = () => useEditorStore.getState();
const kinds = () => state().project.elements.map((e) => e.kind);

beforeEach(() => {
  state().loadProject(createProject('Teste', 'mep'));
  state().setToolOptions({ sizeMode: 'reducers', families: {} });
});

describe('store do editor', () => {
  it('desenha uma polilinha por coordenadas, com joelhos automáticos', () => {
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 0));
    expect(state().anchor?.point).toEqual(vec3(0, 0, 0));
    state().commitPoint(vec3(3, 0, 0));
    state().commitPoint(vec3(3, 2, 0));
    state().commitPoint(vec3(3, 2, 2.5));
    expect(kinds().filter((k) => k === 'pipe')).toHaveLength(3);
    expect(kinds().filter((k) => k === 'elbow')).toHaveLength(2);
    expect(state().project.connections).toHaveLength(4);
    expect(validateProject(state().project)).toEqual([]);
    expect(state().message?.level).toBe('success');
    // A polilinha continua a partir da última extremidade.
    expect(state().anchor?.port?.portId).toBe('end');
  });

  it('reporta erros de domínio sem alterar o projeto', () => {
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(0, 0, 0));
    expect(state().project.elements).toHaveLength(0);
    expect(state().message?.level).toBe('error');
  });

  it('reconhece uma extremidade livre informada por coordenadas', () => {
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(2, 0, 0));
    state().cancelInteraction();
    state().commitPoint(vec3(0, 0, 0)); // início do tubo existente
    expect(state().anchor?.port?.portId).toBe('start');
    state().commitPoint(vec3(0, -2, 0));
    expect(state().project.connections).toHaveLength(2);
  });

  it('insere conexões por clique em porta e em linha por clique no tubo', () => {
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(4, 0, 0));
    const pipe = state().project.elements[0]!;

    state().setTool('valve');
    state().handleViewportClick({
      point: null,
      port: null,
      hit: { elementId: pipe.id, point: vec3(1.5, 0.01, 0.02) },
    });
    expect(kinds()).toContain('valve');
    expect(state().project.elements).toHaveLength(3);

    state().setTool('elbow');
    const free = getFreePorts(state().project).find((p) => p.ref.portId === 'end')!;
    state().handleViewportClick({ point: free.position, port: free.ref, hit: null });
    expect(kinds()).toContain('elbow');

    state().setTool('reducer');
    state().handleViewportClick({ point: vec3(9, 9, 0), port: null, hit: null });
    expect(kinds()).not.toContain('reducer');
    expect(state().message?.level).toBe('info');
    expect(validateProject(state().project)).toEqual([]);
  });

  it('altera diâmetro e material e propaga pelo trecho', () => {
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(3, 0, 0));
    state().commitPoint(vec3(3, 3, 0));
    const first = state().project.elements[0]!;
    state().setToolOptions({ sizeMode: 'propagate' });
    state().changeSpec(first.id, first.spec.specificationId, 50);
    expect(state().project.elements.every((e) => e.spec.dn === 50)).toBe(true);
    state().changeSpec(first.id, 'pead-pe100-sdr11', 50);
    expect(state().project.elements.every((e) => e.spec.material === 'hdpe')).toBe(true);
    expect(validateProject(state().project)).toEqual([]);
  });

  it('por padrão altera só a peça e insere reduções de catálogo', () => {
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(3, 0, 0));
    state().commitPoint(vec3(3, 3, 0));
    const [first, elbow, second] = state().project.elements;
    // Joelho automático de 90° vem da família de catálogo (PVC soldável).
    expect(elbow?.familyId).toBe('krona-joelho-90-soldavel');
    expect(state().toolOptions.sizeMode).toBe('reducers');

    state().changeSpec(second!.id, second!.spec.specificationId, 20);
    const project = state().project;
    expect(project.elements.find((e) => e.id === second!.id)?.spec.dn).toBe(20);
    expect(project.elements.find((e) => e.id === first!.id)?.spec.dn).toBe(25);
    expect(project.elements.find((e) => e.id === elbow!.id)?.spec.dn).toBe(25);
    const reducers = project.elements.filter((e) => e.kind === 'reducer');
    expect(reducers).toHaveLength(1);
    expect(reducers[0]?.familyId).toBe('krona-luva-reducao-soldavel');
    expect(validateProject(project)).toEqual([]);
    expect(state().message?.text).toContain('1 redução(ões) inserida(s)');

    // Voltar ao diâmetro original remove a redução.
    state().changeSpec(second!.id, second!.spec.specificationId, 25);
    expect(state().project.elements.filter((e) => e.kind === 'reducer')).toHaveLength(0);
    expect(validateProject(state().project)).toEqual([]);
  });

  it('seleção múltipla, cópia e exclusão', () => {
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(3, 0, 0));
    state().commitPoint(vec3(3, 3, 0));
    const ids = state().project.elements.map((e) => e.id);
    state().select(ids[0]!);
    state().select(ids[1]!, true);
    state().select(ids[2]!, true);
    expect(state().selection).toHaveLength(3);
    state().select(ids[1]!, true);
    expect(state().selection).toEqual([ids[0], ids[2]]);
    state().selectMany(ids);
    state().copySelection(vec3(0, 0, 2));
    expect(state().project.elements).toHaveLength(6);
    expect(state().selection).toHaveLength(3);
    state().deleteSelected();
    expect(state().project.elements).toHaveLength(3);
  });

  it('posiciona bomba e reservatório e personaliza uma família', () => {
    state().setTool('pump');
    state().commitPoint(vec3(1, 1, 0.3));
    state().setTool('tank');
    state().commitPoint(vec3(6, 1, 0));
    expect(state().project.elements.map((e) => e.kind)).toEqual(['pump', 'tank']);

    const family = familiesOf(state().project).find((f) => f.id === 'krona-joelho-90-soldavel')!;
    const edited = {
      ...family,
      sizes: family.sizes.map((s) => (s.dn === 25 ? { ...s, centerToEnd: 0.03 } : s)),
    };
    expect(state().saveFamily(edited, true)).toBe(true);
    expect(state().project.families).toHaveLength(1);
    expect(familiesOf(state().project).find((f) => f.id === family.id)?.origin).toBe('custom');
    state().resetFamily(family.id);
    expect(familiesOf(state().project).find((f) => f.id === family.id)?.origin).toBe('builtin');
  });

  it('desfaz, refaz e controla alterações pendentes', () => {
    expect(selectIsDirty(state())).toBe(false);
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(2, 0, 0));
    expect(selectIsDirty(state())).toBe(true);
    state().undo();
    expect(state().project.elements).toHaveLength(0);
    expect(selectIsDirty(state())).toBe(false);
    state().redo();
    expect(state().project.elements).toHaveLength(1);
    state().markSaved();
    expect(selectIsDirty(state())).toBe(false);
    expect(state().persisted).toBe(true);
  });

  it('mede distâncias com dois pontos', () => {
    state().setTool('measure');
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(3, 4, 0));
    expect(state().measure.b).toEqual(vec3(3, 4, 0));
    expect(state().message?.text).toContain('5,000 m');
  });

  it('troca de ambiente ajustando especificação e grade', () => {
    state().setDiscipline('infra');
    expect(state().project.discipline).toBe('infra');
    expect(state().activeSpec.material).toBe('ductileIron');
    expect(state().gridStep).toBe(1);
  });

  it('carrega o projeto de demonstração íntegro', () => {
    const demo = createDemoProject();
    state().loadProject(demo);
    expect(new Set(kinds())).toEqual(new Set(['pipe', 'elbow', 'tee', 'valve', 'reducer']));
    expect(validateProject(demo)).toEqual([]);
    expect(state().viewRequest?.preset).toBe('fit');
  });
});
