import { vec3 } from '@hydrobim/core';
import type { MeshPart } from './elements';
import { coated, cylinder, trim, turned } from './primitives';

/**
 * Medidor de vazão eletromagnético flangeado (macromedidor): carcaça cilíndrica das bobinas
 * entre os flanges, pescoço e cabeçote (caixa de ligação da montagem remota). Complementa o
 * carretel passante e os discos dos flanges, gerados pelo chamador.
 *
 * Do catálogo: face a face (`length`), altura do eixo ao topo do cabeçote (`top`) e, pelo
 * chamador, os flanges.
 *
 * O restante é REPRESENTAÇÃO, não cota tabulada: diâmetro e comprimento da carcaça (medidos
 * no desenho dimensional do catálogo Sanecom, p. 4: ~0,82 do diâmetro do flange e ~0,57 do
 * face a face) e a caixa de ligação, cujo tamanho parte das cotas fixas que o desenho dá ao
 * cabeçote (pescoço de 53 mm, corpo de Ø98 mm). Cabos, prensa-cabos, eletrodos, placa de
 * identificação e revestimento interno não são modelados.
 */
export interface FlowMeterInput {
  /** Diâmetro externo do tubo (m). */
  readonly pipeDiameter: number;
  /** Diâmetro interno do tubo (m): a carcaça não obstrui a passagem. */
  readonly boreDiameter: number;
  /** Face a face (m). */
  readonly length: number;
  /** Do eixo ao topo do cabeçote (m). */
  readonly top: number;
  /** Diâmetro externo do flange (m); 0 quando não representado. */
  readonly flangeDiameter: number;
  /** Espessura do flange de extremidade (m); 0 quando não representado. */
  readonly flangeThickness: number;
}

/** Cotas fixas do cabeçote no desenho do fabricante (m). */
const NECK_RADIUS = 0.053 / 2;
const BOX_RADIUS = 0.098 / 2;
const Z = vec3(0, 0, 1);

/** Raio da carcaça das bobinas (m): fica aquém do círculo de furação do flange. */
function flowMeterHousingRadius(pipeDiameter: number, flangeDiameter: number): number {
  return Math.max(flangeDiameter * 0.41, pipeDiameter * 0.75);
}

export function flowMeterParts(input: FlowMeterInput): MeshPart[] {
  const { pipeDiameter: d, length, flangeThickness } = input;
  const housing = flowMeterHousingRadius(d, input.flangeDiameter);
  // A carcaça deixa livre o trecho atrás de cada flange (acesso aos parafusos).
  const half = Math.max(
    Math.min(length * 0.285, length / 2 - flangeThickness - length * 0.08),
    length * 0.15,
  );

  // O cabeçote nunca fica embutido na carcaça, mesmo sem altura de catálogo.
  const top = Math.max(input.top, housing * 1.25);
  const rise = top - housing;
  const neck = Math.min(NECK_RADIUS, housing * 0.3);
  const box = Math.min(BOX_RADIUS, housing * 0.6, rise * 0.9);
  const boxHeight = Math.min(rise * 0.62, box * 2.2);
  const boxBase = top - boxHeight;
  const lid = boxHeight * 0.3;

  return [
    coated(cylinder(vec3(-half, 0, 0), vec3(half, 0, 0), housing, input.boreDiameter / 2, 56)),
    // Pescoço: nasce dentro da carcaça e entra na base da caixa.
    coated(cylinder(vec3(0, 0, housing * 0.9), vec3(0, 0, boxBase + lid * 0.2), neck, 0, 24)),
    // Caixa de ligação com a tampa roscada no topo.
    trim(
      turned(
        vec3(0, 0, boxBase),
        Z,
        [
          [0, box * 0.82],
          [boxHeight - lid, box * 0.82],
          [boxHeight - lid, box],
          [boxHeight, box],
        ],
        32,
      ),
    ),
  ];
}
