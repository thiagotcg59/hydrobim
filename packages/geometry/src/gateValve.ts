import { vec3, type Vec3 } from '@hydrobim/core';
import type { MeshPart } from './elements';
import { box } from './loft';
import { coated, seal, trim, turned } from './primitives';
import { skin, type Ring } from './skin';

/**
 * Válvula de gaveta com cunha de borracha e castelo retangular (linha EURO 20), versão de
 * haste nua. Complementa o corpo passante e as extremidades (flanges ou bolsas), gerados
 * pelo chamador.
 *
 * Do catálogo: face a face (`length`), altura do eixo ao topo da haste (`top`) e as
 * dimensões do castelo — `bonnetLength` (K, ao longo do eixo do tubo) e `width` (K1,
 * transversal).
 *
 * As demais proporções foram medidas na fotografia de referência e nos cortes do catálogo e
 * escaladas pela altura — são REPRESENTAÇÃO, não cotas tabuladas: altura em que o castelo
 * atinge a seção K × K1, concordância com o corpo, preme-gaxeta, diâmetro da haste, quadrado
 * de manobra e plaqueta. A nervura frontal, as orelhas de içamento (DN 200 em diante), as
 * marcações de fundição e os parafusos internos não são modelados.
 */
export interface GateValveInput {
  /** Diâmetro externo do tubo (m). */
  readonly pipeDiameter: number;
  /** Face a face ou distância entre os fundos das bolsas (m). */
  readonly length: number;
  /** Do eixo ao topo da haste (m). */
  readonly top: number;
  /** Castelo: dimensão transversal ao eixo do tubo, K1 (m). */
  readonly width: number;
  /** Castelo: dimensão ao longo do eixo do tubo, K (m). */
  readonly bonnetLength: number;
  /** Raio externo da extremidade (flange ou bolsa); 0 quando não representada (m). */
  readonly endRadius: number;
  /** Espessura do flange de extremidade (m); 0 em bolsas e pontas. */
  readonly flangeThickness: number;
}

const SEGMENTS = 64;
/** Expoente da superelipse: seção retangular de cantos arredondados. */
const SQUARENESS = 5;

/** Seção retangular de cantos arredondados no plano z, centrada no eixo da haste. */
function section(z: number, halfX: number, halfY: number): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i < SEGMENTS; i += 1) {
    const angle = (i / SEGMENTS) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    points.push(
      vec3(
        halfX * Math.sign(cos) * Math.abs(cos) ** (2 / SQUARENESS),
        halfY * Math.sign(sin) * Math.abs(sin) ** (2 / SQUARENESS),
        z,
      ),
    );
  }
  return points;
}

export function gateValveParts(input: GateValveInput): MeshPart[] {
  const { pipeDiameter: d, length, top, endRadius, flangeThickness } = input;
  const halfX = input.bonnetLength / 2;
  const halfY = input.width / 2;

  // O castelo pode ser mais comprido que o face a face (corpo curto): nesse caso só atinge
  // a seção K × K1 acima das extremidades, para não atravessar flanges ou bolsas.
  const room = length / 2 - flangeThickness;
  const overhang = halfX > room - d * 0.02;
  const neckX = Math.max(Math.min(halfX * 0.6, room - d * 0.04), d * 0.2);
  const neckY = Math.min(halfY, d * 0.72);
  const base = d * 0.5;
  const flareStart = overhang ? Math.max(endRadius, d * 0.62) : d * 0.62;
  const boxBottom = Math.max(top * 0.34, flareStart + top * 0.04);
  const boxTop = Math.max(top * 0.64, boxBottom + top * 0.12);
  const crown = boxTop + top * 0.025;

  const collar = Math.min(input.bonnetLength, input.width) * 0.3;
  const cap = collar * 0.72;
  const stem = collar * 0.3;
  const collarTop = crown + (top - crown) * 0.36;
  const capTop = crown + (top - crown) * 0.62;
  const square = (top - capTop) * 0.4;

  const ring = (z: number, x: number, y: number, crease = false): Ring => ({
    points: section(z, x, y),
    crease,
  });
  const tower: Ring[] = [
    // Fecha por baixo na parede do corpo passante, acima do furo: a passagem fica livre.
    ring(base, 0, 0),
    ring(base, neckX, neckY, true),
    ring(flareStart, neckX, neckY),
    ring(boxBottom, halfX, halfY, true),
    ring(boxTop, halfX, halfY, true),
    // Tampa levemente inclinada em direção ao preme-gaxeta.
    ring(crown, Math.max(collar, halfX * 0.55), Math.max(collar, halfY * 0.55), true),
    ring(crown, 0, 0),
  ];

  const plate = Math.min(input.bonnetLength * 0.36, input.width * 0.3);
  const plateZ = boxBottom + (boxTop - boxBottom) * 0.62;
  const plateHalf = plate * 0.3;

  return [
    coated(skin(tower)),
    // Preme-gaxeta: colar oitavado e tampa.
    coated(
      turned(
        vec3(0, 0, 0),
        vec3(0, 0, 1),
        [
          [crown - top * 0.01, collar],
          [collarTop, collar],
        ],
        8,
      ),
    ),
    seal(
      turned(vec3(0, 0, 0), vec3(0, 0, 1), [
        [collarTop, cap * 1.08],
        [collarTop + (capTop - collarTop) * 0.1, cap * 1.08],
      ]),
    ),
    coated(
      turned(vec3(0, 0, 0), vec3(0, 0, 1), [
        [collarTop, cap],
        [capTop - (capTop - collarTop) * 0.2, cap],
        [capTop, cap * 0.7],
      ]),
    ),
    // Haste nua e quadrado de manobra, com o topo exatamente na cota de catálogo.
    trim(
      turned(
        vec3(0, 0, 0),
        vec3(0, 0, 1),
        [
          [capTop, stem],
          [top - square, stem],
        ],
        24,
      ),
    ),
    trim(
      turned(
        vec3(0, 0, 0),
        vec3(0, 0, 1),
        [
          [top - square, stem * 0.95],
          [top, stem * 0.95],
        ],
        4,
      ),
    ),
    // Plaqueta de identificação na face do castelo.
    trim(
      box(
        vec3(-plate / 2, -halfY - 0.0015, plateZ - plateHalf),
        vec3(plate / 2, -halfY + 0.002, plateZ + plateHalf),
      ),
    ),
  ];
}
