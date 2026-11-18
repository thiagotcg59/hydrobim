import {
  angleBetween,
  createProject,
  degToRad,
  getFreePorts,
  radToDeg,
  sub,
  validateProject,
  vec3,
  type Pipe,
} from '@hydrobim/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { pickPlanPoint, planPipeHit } from '../editor/planPicking';
import {
  deflectionConstraintOf,
  drawElevationOf,
  elbowAnglesOf,
  pipeJunctionOf,
  pipeSnapOf,
  useEditorStore,
} from './editorStore';

const state = () => useEditorStore.getState();
const kinds = () => state().project.elements.map((e) => e.kind);
const count = (kind: string) => kinds().filter((k) => k === kind).length;

/** Clique na planta: resolve o ponto como a vista faz e entrega à store. */
function planClick(x: number, y: number): void {
  const s = state();
  const pick = pickPlanPoint({
    point: { x, y },
    tolerance: 0.05,
    freePorts: getFreePorts(s.project),
    drawZ: drawElevationOf(s),
    gridStep: s.snapToGrid ? s.gridStep : 0,
    anchor: s.tool === 'pipe' && s.anchor ? s.anchor : null,
    constraint: deflectionConstraintOf(s),
  });
  if (!pick.ok) throw new Error(pick.error.message);
  s.handleViewportClick({ point: pick.value.point, port: pick.value.port?.ref ?? null, hit: null });
}

beforeEach(() => {
  state().loadProject(createProject('Teste', 'mep'));
  state().setToolOptions({ sizeMode: 'reducers', families: {}, lockElbowAngles: true });
  state().setViewMode('plan');
});

describe('modelagem pela planta baixa', () => {
  it('mantém a planta aberta ao escolher uma ferramenta de modelagem', () => {
    state().setTool('pipe');
    expect(state().viewMode).toBe('plan');
    state().setTool('valve');
    expect(state().viewMode).toBe('plan');
    state().setViewMode('3d');
    state().setTool('dimension');
    expect(state().viewMode).toBe('plan');
  });

  it('traça na elevação do eixo e trava a deflexão nos joelhos de catálogo', () => {
    state().setTool('pipe');
    state().setPipeElevation(2.6);
    planClick(0, 0);
    planClick(3, 0);
    const angles = elbowAnglesOf(state().project, state().activeSpec).map((a) =>
      Math.round(radToDeg(a)),
    );
    expect(angles).toContain(90);
    expect(angles).toContain(45);

    // Clique fora de esquadro: a direção trava em 90°.
    planClick(3.2, 2.1);
    // Clique próximo de 45°.
    planClick(4.4, 3.6);
    planClick(4.5, 4.9);

    const pipes = state().project.elements.filter((e): e is Pipe => e.kind === 'pipe');
    expect(pipes).toHaveLength(4);
    for (const pipe of pipes) {
      expect(pipe.start.z).toBeCloseTo(2.6);
      expect(pipe.end.z).toBeCloseTo(2.6);
    }
    const elbows = state().project.elements.filter((e) => e.kind === 'elbow');
    expect(elbows).toHaveLength(3);
    for (const elbow of elbows) {
      expect(elbow.familyId).not.toBeNull();
      expect(angles).toContain(Math.round(radToDeg(elbow.angle)));
    }
    expect(Math.round(radToDeg(elbows[1]?.angle ?? 0))).toBe(45);
    expect(validateProject(state().project)).toEqual([]);
  });

  it('recusa por coordenadas uma deflexão sem joelho de catálogo e aceita destravado', () => {
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(3, 0, 0));
    state().commitPoint(vec3(4, 3, 0));
    expect(count('pipe')).toBe(1);
    expect(state().message?.level).toBe('error');
    expect(state().message?.text).toContain('Ângulos disponíveis');

    state().setToolOptions({ lockElbowAngles: false });
    state().commitPoint(vec3(4, 3, 0));
    expect(count('pipe')).toBe(2);
    expect(count('elbow')).toBe(1);
  });

  it('cria a prumada ao alterar a elevação durante o traçado', () => {
    state().setTool('pipe');
    planClick(0, 0);
    planClick(3, 0);
    expect(state().pipeElevation).toBe(0);

    state().setPipeElevation(1.5);
    expect(state().pipeElevation).toBe(1.5);
    const riser = state()
      .project.elements.filter((e): e is Pipe => e.kind === 'pipe')
      .at(-1);
    expect(riser?.end).toEqual(vec3(3, 0, 1.5));
    expect(angleBetween(sub(riser!.end, riser!.start), vec3(0, 0, 1))).toBeLessThan(1e-9);
    expect(count('elbow')).toBe(1);

    // O traçado continua, em planta, na nova elevação.
    planClick(3, 2);
    const last = state()
      .project.elements.filter((e): e is Pipe => e.kind === 'pipe')
      .at(-1);
    expect(last?.end.z).toBeCloseTo(1.5);
    expect(last?.start.z).toBeCloseTo(1.5);
    expect(count('pipe')).toBe(3);
    expect(count('elbow')).toBe(2);
    expect(validateProject(state().project)).toEqual([]);
  });

  it('herda a elevação da extremidade capturada', () => {
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 3));
    state().commitPoint(vec3(2, 0, 3));
    state().cancelInteraction();
    state().setPipeElevation(0);

    planClick(2, 0.01); // extremidade livre, na cota 3
    expect(state().anchor?.port?.portId).toBe('end');
    expect(state().pipeElevation).toBe(3);
    planClick(2, 2);
    const last = state()
      .project.elements.filter((e): e is Pipe => e.kind === 'pipe')
      .at(-1);
    expect(last?.end).toEqual(vec3(2, 2, 3));
  });

  it('mantém a elevação quando a prumada não pode ser criada', () => {
    state().setTool('pipe');
    planClick(0, 0);
    planClick(3, 0);
    state().setTool('elbow');
    const end = getFreePorts(state().project).find((p) => p.ref.portId === 'end')!;
    state().handleViewportClick({ point: end.position, port: end.ref, hit: null });
    expect(count('elbow')).toBe(1);

    // Saída horizontal do joelho: a prumada exigiria outra peça.
    state().setTool('pipe');
    const outlet = getFreePorts(state().project).find((p) => p.ref.portId === 'b')!;
    state().handleViewportClick({ point: outlet.position, port: outlet.ref, hit: null });
    expect(state().anchor?.lockAxis).not.toBeNull();
    const before = state().project;
    state().setPipeElevation(2);
    expect(state().project).toBe(before);
    expect(state().pipeElevation).toBe(0);
    expect(state().message?.level).toBe('error');
  });

  it('insere válvula e tê em linha pela projeção do clique no eixo do tubo', () => {
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 1));
    state().commitPoint(vec3(4, 0, 1));
    const pipe = state().project.elements[0] as Pipe;

    state().setTool('valve');
    const onAxis = planPipeHit(pipe, { x: 1.5, y: 0.02 });
    expect(onAxis.ok).toBe(true);
    if (!onAxis.ok) return;
    state().handleViewportClick({
      point: vec3(1.5, 0, 1),
      port: null,
      hit: { elementId: pipe.id, point: onAxis.value },
    });
    expect(count('valve')).toBe(1);
    expect(count('pipe')).toBe(2);
    const valve = state().project.elements.find((e) => e.kind === 'valve');
    expect(valve?.kind === 'valve' && valve.placement.position.z).toBeCloseTo(1);
    expect(validateProject(state().project)).toEqual([]);
  });

  it('termina o trecho sobre um tubo existente com tê automático, sem tubo solto', () => {
    state().setTool('pipe');
    state().commitPoint(vec3(0, 2, 1));
    state().commitPoint(vec3(4, 2, 1));
    state().cancelInteraction();
    const main = state().project.elements[0] as Pipe;

    // Sem trecho em andamento não há término a capturar.
    expect(pipeJunctionOf(state(), main.id)).toBeNull();
    state().commitPoint(vec3(1.5, 0, 1));
    // A prévia captura o pé da perpendicular sobre o tubo, não o ponto clicado.
    expect(pipeJunctionOf(state(), main.id)).toEqual(vec3(1.5, 2, 1));
    state().handleViewportClick({
      point: vec3(1.5, 2, 1),
      port: null,
      hit: { elementId: main.id, point: vec3(1.7, 2, 1) },
    });

    expect(state().message?.level).toBe('success');
    expect(count('tee')).toBe(1);
    expect(count('pipe')).toBe(3);
    expect(state().anchor).toBeNull();
    // Só restam as três pontas da rede: nenhuma extremidade solta sobre o tubo.
    expect(getFreePorts(state().project)).toHaveLength(3);
    expect(validateProject(state().project)).toEqual([]);

    // Desfazer remove o tê e devolve o tubo inteiro.
    state().undo();
    expect(count('tee')).toBe(0);
    expect(count('pipe')).toBe(1);
  });

  it('recusa terminar sobre um tubo sem perpendicular e mantém o trecho em andamento', () => {
    state().setTool('pipe');
    state().commitPoint(vec3(0, 2, 0));
    state().commitPoint(vec3(4, 2, 0));
    state().cancelInteraction();
    const main = state().project.elements[0] as Pipe;
    state().commitPoint(vec3(6, 0, 0));
    const before = state().project;
    state().handleViewportClick({
      point: vec3(6, 2, 0),
      port: null,
      hit: { elementId: main.id, point: vec3(3.9, 2, 0) },
    });
    expect(state().project).toBe(before);
    expect(state().message?.level).toBe('error');
    expect(state().anchor).not.toBeNull();
  });

  it('começa o trecho sobre um tubo existente com tê automático no ponto clicado', () => {
    state().setTool('pipe');
    state().commitPoint(vec3(0, 2, 1));
    state().commitPoint(vec3(4, 2, 1));
    state().cancelInteraction();
    const main = state().project.elements[0] as Pipe;

    // Primeiro clique sobre o tubo: âncora no eixo, ajustada à grade; nada é criado ainda.
    const hit = { elementId: main.id, point: vec3(1.52, 2.01, 1) };
    expect(pipeSnapOf(state(), hit, null)).toEqual(vec3(1.5, 2, 1));
    state().handleViewportClick({ point: vec3(1.5, 2, 1), port: null, hit });
    expect(state().anchor?.pipeId).toBe(main.id);
    expect(state().anchor?.point.x).toBeCloseTo(1.5);
    expect(count('pipe')).toBe(1);

    // A prévia e o trecho ficam na perpendicular ao tubo que passa pelo ponto clicado.
    const preview = pipeSnapOf(state(), null, vec3(2.3, 0, 1));
    expect(preview?.x).toBeCloseTo(1.5);
    expect(preview?.y).toBeCloseTo(0);
    state().handleViewportClick({ point: vec3(2.3, 0, 1), port: null, hit: null });

    expect(state().message?.level).toBe('success');
    expect(count('tee')).toBe(1);
    expect(count('pipe')).toBe(3);
    const branch = state().project.elements.find((e) => e.id === state().selection[0]) as Pipe;
    expect(branch.start.x).toBeCloseTo(1.5);
    expect(branch.end.x).toBeCloseTo(1.5);
    expect(branch.end.y).toBeCloseTo(0);
    // A polilinha continua da ponta livre do novo trecho.
    expect(state().anchor?.port?.elementId).toBe(branch.id);
    expect(state().anchor?.pipeId).toBeNull();
    expect(getFreePorts(state().project)).toHaveLength(3);
    expect(validateProject(state().project)).toEqual([]);
  });

  it('liga dois tubos paralelos com um tê automático em cada um', () => {
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(4, 0, 0));
    state().cancelInteraction();
    state().commitPoint(vec3(0, 2, 0));
    state().commitPoint(vec3(4, 2, 0));
    state().cancelInteraction();
    const [lower, upper] = state().project.elements as Pipe[];

    state().handleViewportClick({
      point: vec3(2, 0, 0),
      port: null,
      hit: { elementId: lower!.id, point: vec3(2, 0, 0) },
    });
    state().handleViewportClick({
      point: vec3(2, 2, 0),
      port: null,
      hit: { elementId: upper!.id, point: vec3(2.4, 2, 0) },
    });
    expect(state().message?.level).toBe('success');
    expect(count('tee')).toBe(2);
    expect(count('pipe')).toBe(5);
    expect(state().anchor).toBeNull();
    // Só as quatro pontas dos dois tubos originais permanecem livres.
    expect(getFreePorts(state().project)).toHaveLength(4);
    expect(validateProject(state().project)).toEqual([]);
  });

  it('aplica a trava ao editar o ângulo de um joelho existente', () => {
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(3, 0, 0));
    state().setTool('elbow');
    const end = getFreePorts(state().project).find((p) => p.ref.portId === 'end')!;
    state().handleViewportClick({ point: end.position, port: end.ref, hit: null });
    const elbow = state().project.elements.find((e) => e.kind === 'elbow')!;

    state().changeFitting(elbow.id, { angle: degToRad(60) });
    expect(state().message?.level).toBe('error');
    expect(state().message?.text).toContain('Não há joelho de 60°');
    expect(state().project.elements.find((e) => e.id === elbow.id)).toBe(elbow);

    state().changeFitting(elbow.id, { angle: degToRad(45) });
    const edited = state().project.elements.find((e) => e.id === elbow.id);
    expect(edited?.kind === 'elbow' && radToDeg(edited.angle)).toBeCloseTo(45);

    state().setToolOptions({ lockElbowAngles: false });
    state().changeFitting(elbow.id, { angle: degToRad(60) });
    const free = state().project.elements.find((e) => e.id === elbow.id);
    expect(free?.kind === 'elbow' && radToDeg(free.angle)).toBeCloseTo(60);
    expect(validateProject(state().project)).toEqual([]);
  });

  it('recusa peças genéricas: sem joelho de catálogo o traçado só prolonga em linha reta', () => {
    // PEAD não tem conexões de catálogo.
    state().setActiveSpec('pead-pe100-sdr11', 50);
    expect(state().activeSpec.specificationId).toBe('pead-pe100-sdr11');
    expect(elbowAnglesOf(state().project, state().activeSpec)).toEqual([]);
    state().setTool('pipe');
    planClick(0, 0);
    planClick(3, 0);

    // Clique de lado: o ponto é levado ao prolongamento do tubo.
    planClick(4, 2);
    const pipes = state().project.elements.filter((e): e is Pipe => e.kind === 'pipe');
    expect(pipes).toHaveLength(2);
    expect(pipes[1]?.end).toEqual(vec3(4, 0, 0));
    expect(count('elbow')).toBe(0);

    // Por coordenadas, a mudança de direção é recusada.
    const before = state().project;
    state().commitPoint(vec3(4, 3, 0));
    expect(state().project).toBe(before);
    expect(state().message?.text).toContain('Não há joelho de catálogo');

    // Joelho avulso também.
    state().setTool('elbow');
    const end = getFreePorts(state().project).find((p) => p.position.x > 3.9)!;
    state().handleViewportClick({ point: end.position, port: end.ref, hit: null });
    expect(state().project).toBe(before);
    expect(state().message?.level).toBe('error');

    // Desligando a política, a peça genérica volta a ser aceita.
    state().setToolOptions({ lockElbowAngles: false });
    state().handleViewportClick({ point: end.position, port: end.ref, hit: null });
    expect(count('elbow')).toBe(1);
    expect(state().project.elements.find((e) => e.kind === 'elbow')?.familyId).toBeNull();
  });

  it('PVC PBA: muda de direção a 90° com a curva ponta e bolsa de catálogo', () => {
    state().setActiveSpec('pvc-pba-nbr5647-cl12', 50);
    expect(elbowAnglesOf(state().project, state().activeSpec).map((a) => radToDeg(a))).toEqual([
      11.25, 22.5, 45, 90,
    ]);
    state().setTool('pipe');
    planClick(0, 0);
    planClick(3, 0);
    // Clique fora do esquadro: a deflexão é levada aos 90° da curva de catálogo.
    planClick(3.05, 3);

    const elbow = state().project.elements.find((e) => e.kind === 'elbow');
    expect(elbow?.kind === 'elbow' && radToDeg(elbow.angle)).toBeCloseTo(90, 6);
    expect(elbow?.familyId).toBe('wavin-curva-90-pba@pvc-pba-nbr5647-cl12');
    const pipes = state().project.elements.filter((e): e is Pipe => e.kind === 'pipe');
    expect(pipes).toHaveLength(2);
    // Bolsa de um lado, ponta do outro: os tubos são aparados a distâncias diferentes.
    expect(pipes[0]?.end.x).toBeCloseTo(3 - 0.152, 3);
    expect(pipes[1]?.start.x).toBeCloseTo(3, 9);
    expect(pipes[1]?.start.y).toBeGreaterThan(0.2);
    expect(
      radToDeg(
        angleBetween(sub(pipes[0]!.end, pipes[0]!.start), sub(pipes[1]!.end, pipes[1]!.start)),
      ),
    ).toBeCloseTo(90, 6);
    expect(validateProject(state().project)).toEqual([]);

    // A curva de 45° também existe; 60° não.
    planClick(6, 6);
    expect(count('elbow')).toBe(2);
    const before = state().project;
    state().commitPoint(vec3(20, 7, 0));
    expect(state().project).toBe(before);
    expect(validateProject(state().project)).toEqual([]);
  });

  it('não deixa alterar as dimensões de uma conexão de catálogo', () => {
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(3, 0, 0));
    state().commitPoint(vec3(3, 3, 0));
    const elbow = state().project.elements.find((e) => e.kind === 'elbow')!;
    expect(elbow.familyId).not.toBeNull();
    const before = state().project;
    state().changeFitting(elbow.id, { bendRadius: 0.2 });
    expect(state().project).toBe(before);
    expect(state().message?.text).toContain('deixaria de corresponder à peça de catálogo');
  });

  it('insere válvula do tipo disponível no catálogo da especificação do tubo', () => {
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(4, 0, 0));
    const pipe = state().project.elements[0]!;
    state().insertFittingInline('valve', pipe.id, 2);
    const valve = state().project.elements.find((e) => e.kind === 'valve');
    expect(valve?.familyId).not.toBeNull();
    expect(validateProject(state().project)).toEqual([]);
  });

  it('recusa joelho avulso em ângulo sem peça de catálogo', () => {
    state().setTool('pipe');
    state().commitPoint(vec3(0, 0, 0));
    state().commitPoint(vec3(3, 0, 0));
    state().setTool('elbow');
    state().setToolOptions({ elbowAngleDeg: 30 });
    const end = getFreePorts(state().project).find((p) => p.ref.portId === 'end')!;
    state().handleViewportClick({ point: end.position, port: end.ref, hit: null });
    expect(count('elbow')).toBe(0);
    expect(state().message?.text).toContain('Não há joelho de 30°');

    state().setToolOptions({ elbowAngleDeg: 45 });
    state().handleViewportClick({ point: end.position, port: end.ref, hit: null });
    expect(count('elbow')).toBe(1);
    expect(degToRad(45)).toBeCloseTo(
      state().project.elements.find((e) => e.kind === 'elbow')?.angle ?? 0,
    );
  });
});
