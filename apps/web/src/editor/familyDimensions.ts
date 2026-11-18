import {
  add,
  AXIS_X,
  AXIS_Y,
  AXIS_Z,
  cross,
  distance,
  getPorts,
  length,
  negate,
  rotate,
  scale,
  tryNormalize,
  vec3,
  ZERO,
  type Fitting,
  type Vec3,
} from '@hydrobim/core';

/**
 * Cota de catálogo mostrada sobre o modelo 3D de uma família: liga cada coluna da tabela
 * dimensional ao trecho da peça que ela mede.
 */
export interface CatalogDimension {
  /** Coluna da tabela da família (`length`, `height`, `end.outerDiameter`…). */
  readonly key: string;
  readonly label: string;
  /** Valor medido (m): a distância entre `a` e `b`. */
  readonly value: number;
  readonly a: Vec3;
  readonly b: Vec3;
  /** Deslocamento dos pontos medidos até a linha de cota. */
  readonly offset: Vec3;
}

/**
 * Cotas consideradas na geração da peça, nas posições em que a geometria as usa
 * (`ports.ts` e `packages/geometry`). Só entram dimensões presentes no elemento: valores
 * ausentes no catálogo (proporções genéricas) não são cotados.
 */
export function catalogDimensions(element: Fitting): CatalogDimension[] {
  if (element.kind === 'pump' || element.kind === 'tank') return [];
  const ports = getPorts(element);
  const od = element.spec.outerDiameter;
  const height = element.kind === 'valve' ? (element.height ?? 0) : 0;
  const size = Math.max(od * 2, height, ...ports.map((p) => length(p.localPosition) * 2));
  const margin = size * 0.2;
  const reach = Math.max(od / 2, ...ports.map((p) => (p.end?.outerDiameter ?? 0) / 2));

  const local: CatalogDimension[] = [];
  const push = (
    key: string,
    label: string,
    a: Vec3,
    b: Vec3,
    direction: Vec3,
    gap: number,
  ): void => {
    const value = distance(a, b);
    if (value < 1e-9) return;
    local.push({ key, label, value, a, b, offset: scale(direction, gap) });
  };

  /** Extremidade (bolsa ou flange) de uma porta: diâmetro externo e profundidade/espessura. */
  const endOf = (portId: string, prefix: 'end' | 'end2'): void => {
    const port = ports.find((p) => p.ref.portId === portId);
    const end = port?.end;
    if (!port || !end || end.type === 'plain') return;
    const flange = end.type === 'flange';
    const name = `${flange ? 'Flange' : 'Bolsa'}${prefix === 'end2' ? ' 2' : ''}`;
    const out = port.localDirection;
    const side = tryNormalize(cross(out, AXIS_Z)) ?? AXIS_X;
    const up = tryNormalize(cross(side, out)) ?? AXIS_Z;
    const radius = end.outerDiameter / 2;
    push(
      `${prefix}.outerDiameter`,
      `${name}: Ø ext.`,
      add(port.localPosition, scale(side, -radius)),
      add(port.localPosition, scale(side, radius)),
      out,
      margin * 0.7 + (flange ? 0 : end.length),
    );
    // A porta fica na face do flange (espessura para dentro) ou no fundo da bolsa
    // (profundidade para fora, sobre o tubo).
    const base = add(port.localPosition, scale(up, radius));
    push(
      `${prefix}.length`,
      `${name}: ${flange ? 'espessura' : 'profundidade'}`,
      base,
      add(base, scale(out, flange ? -end.length : end.length)),
      up,
      margin * 0.5,
    );
  };

  const a = ports.find((p) => p.ref.portId === 'a');
  const b = ports.find((p) => p.ref.portId === 'b');
  const below = negate(AXIS_Z);
  const front = negate(AXIS_Y);

  switch (element.kind) {
    case 'elbow':
      // Do vértice teórico (origem local) à porta.
      if (a) push('centerToEnd', 'Centro à porta', ZERO, a.localPosition, front, reach + margin);
      endOf('a', 'end');
      break;
    case 'tee': {
      const branch = ports.find((p) => p.ref.portId === 'branch');
      if (a) push('centerToEnd', 'Centro à passagem', ZERO, a.localPosition, front, reach + margin);
      if (branch && b) {
        push(
          'centerToBranch',
          'Centro à deriv.',
          ZERO,
          branch.localPosition,
          AXIS_X,
          length(b.localPosition) + margin,
        );
      }
      endOf('a', 'end');
      // No tê de passagem igual, a derivação usa a mesma coluna da passagem: não se repete.
      if (element.branchSpec && element.branchSpec.dn !== element.spec.dn) endOf('branch', 'end2');
      break;
    }
    case 'reducer':
      if (a && b) {
        push('length', 'Comprimento', a.localPosition, b.localPosition, below, reach + margin);
      }
      endOf('a', 'end');
      endOf('b', 'end2');
      break;
    case 'valve': {
      if (element.valveType === 'airRelease') {
        // Ventosa: a "face a face" é a altura acima da porta de entrada, ao longo de +X.
        push(
          'length',
          'Altura acima da porta',
          ZERO,
          vec3(element.length, 0, 0),
          below,
          reach + margin,
        );
        endOf('a', 'end');
        break;
      }
      const half = element.length / 2;
      if (a && b) {
        push('length', 'Face a face', a.localPosition, b.localPosition, below, reach + margin);
      }
      const top = element.height;
      if (top !== undefined) {
        // No filtro Y a cota vai do eixo ao ponto mais baixo do bojo (para baixo).
        if (element.valveType === 'strainer') {
          push('height', 'Eixo ao fundo do bojo', ZERO, vec3(0, 0, -top), AXIS_X, half + margin);
        } else {
          push('height', 'Altura', ZERO, vec3(0, 0, top), AXIS_X, half + margin);
        }
      }
      const wheel = element.handwheelDiameter;
      const type = element.valveType;
      if (
        wheel !== undefined &&
        top !== undefined &&
        (type === 'gate' || type === 'globe' || type === 'ball' || type === 'butterfly')
      ) {
        push(
          'handwheelDiameter',
          type === 'gate' || type === 'globe' ? 'Volante' : 'Alavanca',
          vec3(-wheel / 2, 0, top),
          vec3(wheel / 2, 0, top),
          AXIS_Z,
          margin * 0.6,
        );
      }
      if (element.width !== undefined && top !== undefined && type === 'pressureReducing') {
        push(
          'width',
          'Largura',
          vec3(0, -element.width / 2, top),
          vec3(0, element.width / 2, top),
          AXIS_Z,
          margin * 0.6,
        );
      }
      endOf('a', 'end');
      break;
    }
  }

  const { position, rotation } = element.placement;
  return local.map((d) => ({
    ...d,
    a: add(position, rotate(rotation, d.a)),
    b: add(position, rotate(rotation, d.b)),
    offset: rotate(rotation, d.offset),
  }));
}
