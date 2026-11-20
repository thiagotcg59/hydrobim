import {
  addPipe,
  createFamilyCatalog,
  createProject,
  insertInline,
  validateProject,
  vec3,
} from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import { flangedPipeFamiliesFor, flangeEnd, pipeFlangeEnd } from '../flanges';
import { BUILTIN_FAMILIES, resolvePipeSpec } from '../index';

const mm = (m: number | undefined): number => Math.round((m ?? NaN) * 1e5) / 100;
const ID = 'sanecom-eletromagnetico@ferro-ductil-nbr7675-k9';

describe('macromedidor eletromagnético SANECOM (catálogo, p. 4)', () => {
  const family = BUILTIN_FAMILIES.find((f) => f.id === ID);
  if (!family) throw new Error('família ausente');

  it('transcreve H (face a face) e deriva a altura do eixo ao topo (L − D/2)', () => {
    expect(family.kind).toBe('valve');
    expect(family.valveType).toBe('flowMeter');
    expect(family.endType).toBe('flange');
    expect(family.manufacturer).toBe('Sanecom');
    expect(family.source).toContain('p. 4');
    // [DN, H, L − D/2]; DN 1000 sem altura (L impresso com erro).
    expect(family.sizes.map((s) => [s.dn, mm(s.length), mm(s.height)])).toEqual([
      [50, 200, 237.5],
      [65, 200, 242.5],
      [80, 200, 250],
      [100, 250, 260],
      [125, 250, 280],
      [150, 300, 292.5],
      [200, 350, 325],
      [250, 400, 347.5],
      [300, 500, 372.5],
      [350, 500, 377.5],
      [400, 600, 402.5],
      [450, 600, 427.5],
      [500, 600, 455],
      [600, 600, 510],
      [700, 700, 587.5],
      [800, 800, 632.5],
      [900, 900, 687.5],
      [1000, 1000, NaN],
    ]);
    expect(family.sizes.find((s) => s.dn === 1000)?.height).toBeUndefined();
  });

  it('usa o flange PN 10 da tabela única em todos os diâmetros', () => {
    for (const size of family.sizes) {
      if (size.dn === 65 || size.dn === 125) {
        // A tabela única não traz esses DN: nenhum flange é inventado.
        expect(size.end, `DN ${size.dn}`).toBeUndefined();
        continue;
      }
      const expected = flangeEnd('PN 10', size.dn);
      if (!expected) throw new Error(`DN ${size.dn} sem flange`);
      expect({ type: 'flange', ...size.end }, `DN ${size.dn}`).toEqual(expected);
    }
    // DN 200: 8 furos (PN 10), como as demais peças de ferro dúctil — não os 12 da PN 16.
    expect(family.sizes.find((s) => s.dn === 200)?.end?.boltCount).toBe(8);
    // O topo do cabeçote fica acima do flange em todos os diâmetros.
    for (const size of family.sizes) {
      if (size.height !== undefined && size.end) {
        expect(size.height, `DN ${size.dn}`).toBeGreaterThan(size.end.outerDiameter / 2);
      }
    }
  });

  it('é inserido em linha no ferro fundido dúctil, sem pendências de validação', () => {
    const spec = resolvePipeSpec('ferro-ductil-nbr7675-k9', 150);
    if (!spec) throw new Error('especificação ausente');
    // Com as famílias de tubos com flanges: as faces do corte recebem o flange PN 10.
    const catalog = createFamilyCatalog(
      BUILTIN_FAMILIES,
      {},
      {
        pipeFlange: pipeFlangeEnd,
        flangedPipeFamilies: (id) => flangedPipeFamiliesFor(id).map((f) => f.id),
      },
    );
    // Sem elas, um flange encostaria na ponta lisa do corte: a inserção é recusada.
    const bare = createFamilyCatalog(BUILTIN_FAMILIES);
    const pipe = addPipe(createProject('Macromedição'), {
      start: vec3(0, 0, 0),
      end: vec3(4, 0, 0),
      spec,
    });
    if (!pipe.ok) throw new Error(pipe.error.message);
    const inserted = insertInline(pipe.value.project, {
      pipeId: pipe.value.elementId,
      distanceFromStart: 2,
      fitting: { kind: 'valve', valveType: 'flowMeter' },
      catalog,
    });
    if (!inserted.ok) throw new Error(inserted.error.message);
    const refused = insertInline(pipe.value.project, {
      pipeId: pipe.value.elementId,
      distanceFromStart: 2,
      fitting: { kind: 'valve', valveType: 'flowMeter' },
      catalog: bare,
    });
    expect(refused.ok ? 'ok' : refused.error.code).toBe('NO_PIPE_FLANGE');
    const pipes = inserted.value.project.elements.filter((e) => e.kind === 'pipe');
    expect(pipes.map((p) => (p.kind === 'pipe' ? Object.keys(p.ends ?? {}) : []))).toEqual([
      ['end'],
      ['start'],
    ]);
    const meter = inserted.value.project.elements.find((e) => e.kind === 'valve');
    if (meter?.kind !== 'valve') throw new Error('medidor ausente');
    expect(meter.name).toBe('Medidor de vazão 1');
    expect(meter.familyId).toBe(ID);
    expect(meter.length).toBeCloseTo(0.3);
    expect(meter.height).toBeCloseTo(0.2925);
    expect(meter.ends.a).toEqual(flangeEnd('PN 10', 150));
    expect(meter.ends.b).toEqual(meter.ends.a);
    expect(validateProject(inserted.value.project).filter((i) => i.severity === 'error')).toEqual(
      [],
    );
    // No aço-carbono não há família de medidor: dimensão genérica, identificada como tal.
    const steel = resolvePipeSpec('aco-carbono-b3610-sch40', 100);
    if (!steel) throw new Error('especificação ausente');
    expect(catalog.valve(steel, 'flowMeter').familyId).toBeNull();
  });
});
