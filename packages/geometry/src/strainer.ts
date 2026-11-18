import { add, scale, vec3, type Vec3 } from '@hydrobim/core';
import type { MeshPart } from './elements';
import { loft } from './loft';
import { seal, trim, turned, upFor } from './primitives';
import type { MeshData } from './sweep';

/**
 * Filtro Y flangeado: luva do corpo entre os flanges, bojo oblíquo do elemento filtrante,
 * flange do bojo, junta, tampa aparafusada e bujão de limpeza. Complementa o furo passante
 * e os discos dos flanges, gerados pelo chamador.
 *
 * Do catálogo: face a face (`length`), distância do eixo ao ponto mais baixo do bojo
 * (`depth`) e, pelo chamador, os flanges (diâmetro, espessura e furação).
 *
 * As demais proporções foram medidas no desenho dimensional e na fotografia do fabricante
 * (Spirax Sarco CI, TI-D245-01) e escaladas pelo diâmetro do tubo — são REPRESENTAÇÃO, não
 * cotas tabuladas: inclinação de 45° do bojo para jusante, diâmetros do corpo, do bojo e
 * da tampa, espessuras, quantidade e tamanho dos parafusos e o bujão. A tela não é
 * detalhada: dentro da passagem, o volume do bojo ocupa o lugar do elemento filtrante. A
 * nervura entre o bojo e o corpo e as marcações de fundição não são modeladas.
 */
export interface StrainerInput {
  /** Diâmetro externo do tubo (m). */
  readonly pipeDiameter: number;
  /** Face a face (m). */
  readonly length: number;
  /** Do eixo ao ponto mais baixo do bojo, incluídos parafusos e bujão (m). */
  readonly depth: number;
  /** Espessura do flange de extremidade (m); 0 quando não representado. */
  readonly flangeThickness: number;
  /** Maior raio que o cubo atrás do flange pode ter sem cobrir os furos (m). */
  readonly hubLimit?: number;
}

const COS = Math.SQRT1_2;
const SIN = Math.SQRT1_2;
/** Eixo do bojo (para baixo e para jusante) e direção radial contida no plano XZ. */
const U = vec3(COS, 0, -SIN);
const V = vec3(SIN, 0, COS);
const Y = vec3(0, 1, 0);
const X = vec3(1, 0, 0);

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Corpo fundido com a pintura do fabricante. */
const iron = (mesh: MeshData): MeshPart => ({ role: 'castIron', mesh });

export function strainerParts(input: StrainerInput): MeshPart[] {
  const { pipeDiameter: d, length, depth, flangeThickness } = input;
  const half = length / 2;

  const bowl = d * 0.62;
  const cover = bowl * 1.5;
  const plate = clamp(d * 0.14, 0.008, 0.04);
  const gasket = plate * 0.12;
  const hex = clamp(cover * 0.075, 0.005, 0.022);
  const head = hex * 1.3;
  const boltCircle = cover - hex * 1.7;
  const plug = bowl * 0.42;
  const boss = plate * 0.45;
  const plugLength = plug * 0.9;

  // Face externa da tampa, medida ao longo do eixo do bojo: a parte mais baixa do conjunto
  // (borda da tampa, cabeças dos parafusos ou bujão) fica exatamente na cota de catálogo.
  const neckStart = bowl * 0.7;
  const reach = Math.max(
    Math.min(
      (depth - cover * COS) / SIN,
      (depth - (boltCircle + hex) * COS) / SIN - head,
      (depth - plug * COS) / SIN - boss - plugLength,
    ),
    neckStart + 2 * plate + gasket + bowl * 0.2,
  );
  const neck = reach - 2 * plate - gasket;

  // Ponto do eixo do tubo em que nasce o bojo: junto ao flange de montante, sem que a
  // tampa avance sobre o flange de jusante.
  const low = -half + flangeThickness + bowl * 0.35;
  const high = half - flangeThickness - (reach * COS + cover * SIN + head * COS);
  const origin = vec3(clamp(length * 0.1 - reach * COS, low, Math.max(low, high)), 0, 0);

  const along = (t: number, radius = 0, angle = 0): Vec3 =>
    add(
      add(origin, scale(U, t)),
      add(scale(V, radius * Math.cos(angle)), scale(Y, radius * Math.sin(angle))),
    );

  const parts: MeshPart[] = [];

  // Luva do corpo entre os flanges, com o cubo atrás de cada flange.
  const hub = Math.max(Math.min(d * 0.7, input.hubLimit ?? d * 0.7), d * 0.52);
  const run = Math.min(d * 0.58, hub);
  const inset = flangeThickness * 0.5;
  const hubLength = Math.min(d * 0.16, length * 0.08);
  const taper = (hub - run) * 1.2;
  // Casca aberta (sem tampas): as pontas ficam dentro dos discos dos flanges e a passagem
  // continua livre — o furo é o do corpo passante, gerado pelo chamador.
  const sleeve: [number, number, boolean][] = [
    [inset, hub, true],
    [flangeThickness + hubLength, hub, true],
    [flangeThickness + hubLength + taper, run, false],
    [length - flangeThickness - hubLength - taper, run, false],
    [length - flangeThickness - hubLength, hub, true],
    [length - inset, hub, true],
  ];
  parts.push(
    iron(
      loft(
        sleeve.map(([x, radius, crease]) => ({
          center: vec3(-half + x, 0, 0),
          tangent: X,
          radius,
          crease,
        })),
        { up: upFor(X), radialSegments: 48 },
      ),
    ),
  );

  // Bojo oblíquo e flange do bojo.
  parts.push(
    iron(
      turned(
        origin,
        U,
        [
          [0, bowl * 0.4],
          [neckStart, bowl],
          [neck - plate * 0.9, bowl],
          [neck, bowl * 1.14],
          [neck, cover],
          [neck + plate, cover],
        ],
        48,
      ),
    ),
    seal(
      turned(
        origin,
        U,
        [
          [neck + plate, cover * 0.97],
          [neck + plate + gasket, cover * 0.97],
        ],
        48,
      ),
    ),
    // Tampa (flange cego) com o ressalto do bujão.
    iron(
      turned(
        origin,
        U,
        [
          [reach - plate, cover],
          [reach, cover],
          [reach, plug * 1.3],
          [reach + boss, plug * 1.3],
        ],
        48,
      ),
    ),
    // Bujão de limpeza sextavado.
    iron(
      turned(
        origin,
        U,
        [
          [reach + boss, plug],
          [reach + boss + plugLength, plug],
        ],
        6,
      ),
    ),
  );

  // Parafusos da tampa: cabeça sobre a tampa, porca sob o flange do bojo e ponta da rosca.
  const bolts = cover < 0.08 ? 6 : cover < 0.16 ? 8 : cover < 0.3 ? 12 : 16;
  for (let i = 0; i < bolts; i += 1) {
    // Um parafuso fica no ponto mais baixo da tampa (é ele que define a cota de catálogo).
    const center = along(0, boltCircle, Math.PI + (i / bolts) * Math.PI * 2);
    parts.push(
      trim(
        turned(
          center,
          U,
          [
            [reach, hex],
            [reach + head, hex],
          ],
          6,
        ),
      ),
      trim(
        turned(
          center,
          U,
          [
            [neck - head * 1.5, hex * 0.5],
            [neck - head, hex * 0.5],
            [neck - head, hex],
            [neck, hex],
          ],
          6,
        ),
      ),
    );
  }

  return parts;
}
