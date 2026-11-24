import { archTypeFromFamily, getArchFamily, listArchFamilies } from '@hydrobim/catalog';
import { archIntegrityProblem, type ArchType } from '@hydrobim/core';
import { describe, expect, it } from 'vitest';
import {
  archPreviewEntries,
  archPreviewNote,
  archPreviewParts,
  buildArchPreviewModel,
  layerBands,
  PREVIEW_SIZES,
} from './archPreview';

function typeOf(familyId: string, overrides: Record<string, unknown> = {}): ArchType {
  const family = getArchFamily(familyId);
  if (!family) throw new Error(`família ausente: ${familyId}`);
  return { ...archTypeFromFamily(family, family.name, overrides), id: 'tipo-previa' } as ArchType;
}

describe('projeto mínimo da prévia', () => {
  it('é íntegro para todas as famílias do catálogo', () => {
    for (const family of listArchFamilies()) {
      const model = buildArchPreviewModel(typeOf(family.id));
      expect(model, family.id).not.toBeNull();
      if (!model) continue;
      expect(archIntegrityProblem(model.project), family.id).toBeNull();
      expect(archPreviewParts(model).length, family.id).toBeGreaterThan(0);
    }
  });

  it('parede: uma ocorrência, sem hospedeira', () => {
    const model = buildArchPreviewModel(typeOf('arq-parede-alvenaria-ceramica'));
    expect(model?.host).toBeNull();
    expect(model?.element.kind).toBe('wall');
    expect(model?.project.architecture.elements).toHaveLength(1);
    expect(archPreviewParts(model ?? never()).map((part) => part.role)).toEqual(['wall']);
  });

  it('porta: parede hospedeira ilustrativa com folga em volta do vão', () => {
    const type = typeOf('arq-porta-giro-1');
    const model = buildArchPreviewModel(type) ?? never();
    if (type.category !== 'door' || !model.host) throw new Error('modelo inesperado');
    expect(model.element.kind).toBe('door');
    expect(model.host.end.x).toBeCloseTo(type.width + 2 * PREVIEW_SIZES.hostMargin, 9);
    expect(model.host.height).toBeCloseTo(type.height + PREVIEW_SIZES.hostHeadroom, 9);
    expect(archPreviewParts(model).map((part) => part.role)).toEqual(['wall', 'frame', 'joinery']);
  });

  it('janela: o peitoril do tipo posiciona o vão', () => {
    const model = buildArchPreviewModel(typeOf('arq-janela-correr', { sillHeight: 0.9 }));
    const element = model?.element;
    expect(element?.kind === 'window' && element.sillHeight).toBe(0.9);
    expect(archPreviewParts(model ?? never()).map((part) => part.role)).toEqual([
      'wall',
      'frame',
      'glass',
    ]);
  });

  it('rascunho com dimensão inválida não gera prévia', () => {
    expect(buildArchPreviewModel(typeOf('arq-porta-giro-1', { width: 0 }))).toBeNull();
    expect(buildArchPreviewModel(typeOf('arq-laje-concreto', { layers: [] }))).toBeNull();
  });

  it('as malhas ficam no referencial do projeto mínimo', () => {
    const model = buildArchPreviewModel(typeOf('arq-janela-fixa')) ?? never();
    const glass = archPreviewParts(model).find((part) => part.role === 'glass');
    const xs = Array.from(glass?.mesh.positions ?? []).filter((_, index) => index % 3 === 0);
    const zs = Array.from(glass?.mesh.positions ?? []).filter((_, index) => index % 3 === 2);
    // Vão de 1,00 m centrado em uma parede de 2,20 m, com peitoril de 1,10 m.
    expect(Math.min(...xs)).toBeGreaterThan(0.6);
    expect(Math.max(...xs)).toBeLessThan(1.6);
    expect(Math.min(...zs)).toBeGreaterThan(1.1);
  });
});

describe('desenhos 2D', () => {
  it('porta em planta: parede cortada, marco e folha aberta com arco', () => {
    const model = buildArchPreviewModel(typeOf('arq-porta-giro-1')) ?? never();
    const [wall, door] = archPreviewEntries(model);
    expect(wall?.cut.length).toBeGreaterThan(0);
    expect(door?.swings).toHaveLength(1);
    expect(door?.swings[0]?.arc?.radius).toBeCloseTo(0.8 - 2 * 0.05, 9);
  });

  it('janela em elevação: projetada, sem corte', () => {
    const model = buildArchPreviewModel(typeOf('arq-janela-correr')) ?? never();
    const entries = archPreviewEntries(model);
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.cut.length === 0 && entry.projected !== null)).toBe(true);
  });

  it('tipos em camadas não usam o desenho de esquadria', () => {
    const model = buildArchPreviewModel(typeOf('arq-laje-concreto')) ?? never();
    expect(archPreviewEntries(model)).toHaveLength(0);
  });

  it('camadas empilhadas em escala', () => {
    const type = typeOf('arq-parede-alvenaria-ceramica');
    if (type.category !== 'wall') throw new Error('tipo inesperado');
    const bands = layerBands(type.layers);
    expect(bands.map((band) => band.from)).toEqual([0, 0.02, 0.16]);
    expect(bands.map((band) => band.thickness)).toEqual([0.02, 0.14, 0.02]);
    expect(bands[1]?.layer.hatch).toBe('diagonal');
  });

  it('porta com frisos: a legenda é a da elevação e declara a posição esquemática', () => {
    const type = typeOf('arq-porta-pormade-frizzatta-fri-002');
    expect(type.category === 'door' && type.leaf?.friezes).toHaveLength(6);
    expect(archPreviewNote(type)).toMatch(/elevação.*frisos.*esquemática/);
    const model = buildArchPreviewModel(type) ?? never();
    expect(archPreviewParts(model).map((part) => part.role)).toEqual([
      'wall',
      'frame',
      'joinery',
      'frieze',
    ]);
    // Em planta os frisos não aparecem: a folha fechada dá lugar ao símbolo de abertura.
    const [, door] = archPreviewEntries(model);
    expect(door?.swings).toHaveLength(1);
  });

  it('a legenda diz o que é ilustrativo', () => {
    expect(archPreviewNote(typeOf('arq-porta-giro-1'))).toMatch(/hospedeira.*ilustrativas/);
    expect(archPreviewNote(typeOf('arq-parede-drywall'))).toMatch(/ilustrativo/);
  });
});

function never(): never {
  throw new Error('prévia ausente');
}
