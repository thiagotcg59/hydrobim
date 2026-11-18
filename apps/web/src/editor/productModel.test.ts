import { BUILTIN_FAMILIES, PRODUCT_FAMILIES, resolvePipeSpec } from '@hydrobim/catalog';
import {
  addPipe,
  attachFitting,
  createFamilyCatalog,
  createProject,
  getPorts,
  insertInline,
  vec3,
} from '@hydrobim/core';
import { buildElementGeometry, countOpenEdges } from '@hydrobim/geometry';
import { describe, expect, it } from 'vitest';
import { buildProductModel, modelExtent } from './productModel';

const cases = PRODUCT_FAMILIES.flatMap((family) =>
  family.sizes.map((size) => [`${family.name} ${size.label}`, family, size] as const),
);

/** Dimensões da envoltória do modelo, em mm, nos eixos X, Y e Z. */
function spans(parts: Parameters<typeof modelExtent>[0]): [number, number, number] {
  const { min, max } = modelExtent(parts);
  return [0, 1, 2].map((k) => (max[k]! - min[k]!) * 1000) as [number, number, number];
}

describe('modelos 3D da biblioteca de produtos', () => {
  it.each(cases)('%s: o modelo reproduz as cotas da tabela', (_name, family, size) => {
    const model = buildProductModel(family, size, { fullLength: true });
    if (family.shape === 'saddle' && size.dn < 50) {
      // Linhas com colunas incoerentes no catálogo: sem modelo, com o motivo informado.
      expect(model.ok).toBe(false);
      if (!model.ok) expect(model.reason).toContain('não correspondem');
      return;
    }
    expect(model.ok, model.ok ? '' : model.reason).toBe(true);
    if (!model.ok) return;
    for (const part of model.parts) {
      expect(part.mesh.positions.every(Number.isFinite)).toBe(true);
      expect(part.mesh.indices.length).toBeGreaterThan(0);
      // Tudo é sólido fechado, exceto as abas do colar (caixas de faces independentes).
      if (family.shape !== 'saddle') expect(countOpenEdges(part.mesh)).toBe(0);
    }
    const [x, y, z] = spans(model.parts);
    const d = size.dims;
    switch (family.shape) {
      case 'pipe':
        expect(x).toBeCloseTo(d.L!, 2);
        expect(y).toBeCloseTo(d.A!, 3);
        break;
      case 'bend':
        // L: projeção no eixo da bolsa, da boca ao ponto mais afastado da ponta.
        expect(x).toBeCloseTo(d.L!, 3);
        expect(y).toBeCloseTo(d.A!, 3);
        break;
      case 'tee':
        // Na biblioteca, a derivação é apresentada para cima (+Z).
        expect(x).toBeCloseTo(d.L!, 3);
        expect(z).toBeCloseTo(d.L1!, 3);
        expect(y).toBeCloseTo(d.A!, 3);
        break;
      case 'cross':
        expect(x).toBeCloseTo(d.L!, 3);
        expect(z).toBeCloseTo(d.L1 ?? d.L!, 3);
        expect(y).toBeCloseTo(d.A!, 3);
        break;
      case 'cap':
      case 'slipCoupling':
      case 'transitionCoupling':
      case 'adapter':
        expect(x).toBeCloseTo(d.L!, 3);
        expect(y).toBeCloseTo(d.A!, 3);
        break;
      case 'reducer':
        expect(x).toBeCloseTo(d.L!, 3);
        expect(y).toBeCloseTo(Math.max(d.A!, d.D!), 3);
        break;
      case 'saddle':
        expect(z).toBeCloseTo(d.L1!, 3);
        expect(y).toBeCloseTo(d.L!, 3);
        break;
      case 'jeriSeal':
        expect(x).toBeCloseTo(d.D!, 3);
        expect(z).toBeCloseTo(d.A!, 3);
        break;
      case 'oRing':
        expect(x).toBeCloseTo(d.A!, 3);
        expect(z).toBeCloseTo(d.E!, 3);
        break;
    }
  });

  it('tubo: a vista encurtada mantém a bolsa e informa o comprimento real', () => {
    const family = PRODUCT_FAMILIES.find((f) => f.id === 'wavin-pba-tubo-cl15')!;
    const model = buildProductModel(family, family.sizes[0]!);
    expect(model.ok).toBe(true);
    if (!model.ok) return;
    expect(model.note).toContain('6110');
    expect(spans(model.parts)[0]).toBeCloseTo(85 + 4 * 60, 3);
    expect(model.parts.map((p) => p.role)).toEqual(['body', 'seal']);
  });
});

describe('conexões PBA inseridas na rede', () => {
  const spec = resolvePipeSpec('pvc-pba-nbr5647-cl12', 75)!;
  const small = resolvePipeSpec('pvc-pba-nbr5647-cl12', 50)!;
  const catalog = createFamilyCatalog(BUILTIN_FAMILIES);

  function network() {
    const pipe = addPipe(createProject('pba', 'infra'), {
      start: vec3(0, 0, 0),
      end: vec3(6, 0, 0),
      spec,
    });
    if (!pipe.ok) throw new Error(pipe.error.message);
    const tee = insertInline(pipe.value.project, {
      pipeId: pipe.value.elementId,
      distanceFromStart: 3,
      fitting: { kind: 'tee', branchSpec: small },
      catalog,
    });
    if (!tee.ok) throw new Error(tee.error.message);
    const end = tee.value.project.elements.filter((e) => e.kind === 'pipe').at(-1)!;
    const reducer = attachFitting(tee.value.project, {
      target: { elementId: end.id, portId: 'end' },
      fitting: { kind: 'reducer', outletSpec: small },
      catalog,
    });
    if (!reducer.ok) throw new Error(reducer.error.message);
    return reducer.value.project.elements;
  }

  it('tê de redução e redução usam o perfil de bolsa do fabricante, em sólido fechado', () => {
    const elements = network();
    const tee = elements.find((e) => e.kind === 'tee')!;
    const reducer = elements.find((e) => e.kind === 'reducer')!;
    expect(tee.familyId).toContain('wavin-te-reducao-pba');
    expect(reducer.familyId).toContain('wavin-reducao-pba');

    for (const element of [tee, reducer]) {
      const { parts } = buildElementGeometry(element);
      expect(parts).toHaveLength(1);
      expect(countOpenEdges(parts[0]!.mesh)).toBe(0);
      // Cada bolsa avança além da porta pela profundidade C e atinge o Ø externo A.
      const positions = parts[0]!.mesh.positions;
      for (const port of getPorts(element)) {
        let reach = 0;
        let radius = 0;
        for (let i = 0; i < positions.length; i += 3) {
          const rel = [0, 1, 2].map(
            (k) =>
              positions[i + k]! -
              [port.localPosition.x, port.localPosition.y, port.localPosition.z][k]!,
          );
          const dir = [port.localDirection.x, port.localDirection.y, port.localDirection.z];
          const along = rel[0]! * dir[0]! + rel[1]! * dir[1]! + rel[2]! * dir[2]!;
          if (along < 1e-6) continue;
          const r = Math.hypot(
            rel[0]! - along * dir[0]!,
            rel[1]! - along * dir[1]!,
            rel[2]! - along * dir[2]!,
          );
          // Só a região em torno do eixo da porta (as bolsas vizinhas ficam de fora).
          if (r > spec.outerDiameter) continue;
          reach = Math.max(reach, along);
          radius = Math.max(radius, r);
        }
        if (port.end) {
          expect(reach).toBeCloseTo(port.end.length, 6);
          expect(radius).toBeCloseTo(port.end.outerDiameter / 2, 6);
        } else {
          // Ponta lisa (lado maior da redução): nada além da porta.
          expect(reach).toBe(0);
        }
      }
    }
  });
});
