import { add, scale, vec3, type Vec3 } from '@hydrobim/core';
import type { MeshPart } from './elements';
import { box } from './loft';
import { accent, ball, coated, cylinder, trim, turned } from './primitives';

/**
 * Válvula de controle pilotada com corpo em "Y" (redutora de pressão): atuador de
 * diafragma oblíquo e circuito de controle. Complementa o corpo passante e os flanges,
 * gerados pelo chamador.
 *
 * Do catálogo: comprimento face a face, altura do eixo ao topo (`top`) e largura máxima,
 * adotada como diâmetro dos flanges do atuador (`cover`).
 *
 * As proporções abaixo foram medidas no desenho dimensional do fabricante (BERMAD, 700
 * SIGMA EN) e escaladas pelas cotas de catálogo — são REPRESENTAÇÃO, não cotas tabuladas:
 * inclinação do atuador (~24° para jusante), posição do centro da tampa, tampa abaulada
 * rasa com bujão central, quantidade e tamanho dos parafusos. O circuito de controle
 * (piloto, registros e tubos) não tem dimensões no catálogo; segue o arranjo típico e
 * pode ultrapassar a altura `top`, que se refere à válvula básica.
 */

export interface PilotValveInput {
  /** Diâmetro externo do tubo (m). */
  readonly pipeDiameter: number;
  /** Face a face (m). */
  readonly length: number;
  /** Altura do eixo ao topo da válvula básica (m). */
  readonly top: number;
  /** Raio dos flanges do atuador (m). */
  readonly cover: number;
  /** Espessura do flange de extremidade (m); 0 quando não representado. */
  readonly flangeThickness: number;
}

const TILT = (24 * Math.PI) / 180;
const Y = vec3(0, 1, 0);
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Tubo fino por uma poligonal, com esferas nos vértices para fechar os cotovelos. */
function tubing(points: readonly Vec3[], radius: number): MeshPart[] {
  const parts: MeshPart[] = [];
  points.forEach((point, i) => {
    const next = points[i + 1];
    if (i > 0 && next) parts.push(trim(ball(point, radius)));
    if (next) parts.push(trim(cylinder(point, next, radius, 0, 10)));
  });
  return parts;
}

/** Conexão sextavada (niple/porca) centrada em `at`, ao longo de `axis`. */
function hexFitting(at: Vec3, axis: Vec3, radius: number, length: number): MeshPart {
  return trim(
    turned(
      add(at, scale(axis, -length / 2)),
      axis,
      [
        [0, radius],
        [length, radius],
      ],
      6,
    ),
  );
}

/** Registro de esfera miniatura na linha vertical de tomada, com alavanca. */
function cock(at: Vec3, tube: number): MeshPart[] {
  const r = tube * 2.3;
  return [
    trim(cylinder(vec3(at.x, at.y, at.z - r * 1.3), vec3(at.x, at.y, at.z + r * 1.3), r, 0, 16)),
    hexFitting(vec3(at.x, at.y, at.z - r * 1.7), vec3(0, 0, 1), r * 0.9, r * 0.9),
    hexFitting(vec3(at.x, at.y, at.z + r * 1.7), vec3(0, 0, 1), r * 0.9, r * 0.9),
    trim(cylinder(at, vec3(at.x, at.y - r * 1.6, at.z), tube * 0.8, 0, 10)),
    accent(
      box(
        vec3(at.x - r * 0.5, at.y - r * 1.9, at.z - r * 0.4),
        vec3(at.x + r * 3.2, at.y - r * 1.5, at.z + r * 0.4),
      ),
    ),
  ];
}

export function pilotValveParts(input: PilotValveInput): MeshPart[] {
  const { pipeDiameter: d, length, top, cover, flangeThickness } = input;
  const sin = Math.sin(TILT);
  const cos = Math.cos(TILT);
  /** Eixo do atuador (para cima e para jusante) e direção radial contida no plano XZ. */
  const u = vec3(sin, 0, cos);
  const v = vec3(cos, 0, -sin);

  const plate = clamp(cover * 0.09, 0.006, 0.03);
  const hex = clamp(cover * 0.055, 0.004, 0.02);
  const head = hex * 1.2;
  const plug = cover * 0.13;

  // Plano superior do flange da tampa: a borda mais alta (com as cabeças dos parafusos)
  // chega à altura de catálogo e a mais avançada fica aquém do flange de jusante.
  const coverZ = Math.max(top - cover * sin - head * cos, plate * 3);
  const coverX = Math.min(length * 0.11, length / 2 - flangeThickness - cover * cos - plate * 0.5);
  const reach = coverZ / cos;
  /** Ponto em que o eixo do atuador cruza o eixo do tubo (a montante do centro). */
  const base = vec3(coverX - coverZ * (sin / cos), 0, 0);
  // O bujão central da tampa também toca a altura de catálogo.
  const dome = Math.max((top - coverZ - plug * sin) / cos, plate);

  const along = (t: number, radial = 0, angle = 0): Vec3 =>
    add(
      add(base, scale(u, t)),
      add(scale(v, radial * Math.cos(angle)), scale(Y, radial * Math.sin(angle))),
    );

  const parts: MeshPart[] = [];

  // Pescoço oblíquo do corpo, flange do corpo e flange da tampa.
  const neck = Math.max(reach - 2 * plate, plate);
  parts.push(
    coated(
      turned(
        base,
        u,
        [
          [0, d * 0.6],
          [neck * 0.45, d * 0.6],
          [neck, Math.max(cover * 0.78, d * 0.6)],
          [neck, cover * 0.97],
          [neck + plate * 0.92, cover * 0.97],
          [neck + plate * 0.92, cover * 0.93],
          [neck + plate, cover * 0.93],
          [neck + plate, cover],
          [reach, cover],
        ],
        56,
      ),
    ),
  );

  // Tampa abaulada rasa (perfil elíptico), ressalto central e bujão.
  const crown = dome * 0.62;
  // O ressalto central fica abaixo da altura de catálogo mesmo na borda mais alta.
  const hub = Math.min(cover * 0.3, plug + ((dome * 0.16 * cos) / sin) * 0.9);
  const profile: [number, number, boolean][] = [];
  const STEPS = 10;
  for (let i = 0; i <= STEPS; i += 1) {
    const phi = (i / STEPS) * (Math.PI / 2);
    // Suave ao longo da calota; aresta viva só na base e no encontro com o ressalto.
    profile.push([
      reach + crown * Math.sin(phi),
      hub + (cover * 0.8 - hub) * Math.cos(phi),
      i > 0 && i < STEPS,
    ]);
  }
  parts.push(
    coated(
      turned(
        base,
        u,
        [...profile, [reach + dome * 0.84, hub], [reach + dome * 0.84, plug], [reach + dome, plug]],
        56,
      ),
    ),
  );

  // Parafusos dos flanges do atuador: cabeça sobre a tampa e porca sob o flange do corpo.
  const bolts = cover < 0.09 ? 8 : cover < 0.16 ? 10 : cover < 0.3 ? 12 : 16;
  const circle = cover * 0.97 - hex * 1.25;
  for (let i = 0; i < bolts; i += 1) {
    const angle = ((i + 0.5) / bolts) * Math.PI * 2;
    parts.push(
      trim(
        turned(
          along(0, circle, angle),
          u,
          [
            [neck - head, hex],
            [neck, hex],
          ],
          6,
        ),
      ),
      trim(
        turned(
          along(0, circle, angle),
          u,
          [
            [reach, hex],
            [reach + head, hex],
          ],
          6,
        ),
      ),
    );
  }

  // --- Circuito de controle (arranjo típico; sem dimensões no catálogo) ---
  const tube = clamp(cover * 0.03, 0.004, 0.008);
  const block = clamp(cover * 0.45, 0.045, 0.09);
  const side = -(cover + tube * 3);
  const bodyRadius = d * 0.5;
  const tapUp = -length * 0.3;
  const tapDown = length * 0.3;
  // Linha principal na altura da tomada da câmara de controle, na tampa.
  const port = along(reach + crown * 0.5, cover * 0.55, -Math.PI / 2);
  const level = port.z;
  const pilot = vec3(tapDown, side, level);

  // Tomada de montante → registro → linha principal → piloto.
  parts.push(
    hexFitting(vec3(tapUp, -bodyRadius, 0), Y, tube * 1.9, tube * 3),
    ...tubing(
      [
        vec3(tapUp, -bodyRadius, 0),
        vec3(tapUp, side, 0),
        vec3(tapUp, side, level),
        vec3(pilot.x - block / 2, side, level),
      ],
      tube,
    ),
    ...cock(vec3(tapUp, side, level * 0.45), tube),
  );
  // Derivação para a câmara de controle do atuador.
  parts.push(
    hexFitting(vec3(port.x, side, level), vec3(1, 0, 0), tube * 1.9, tube * 3.4),
    ...tubing([vec3(port.x, side, level), port], tube),
    hexFitting(port, Y, tube * 1.9, tube * 3),
  );
  // Piloto → tomada de jusante.
  parts.push(
    ...tubing(
      [
        vec3(pilot.x, side, level - block / 2),
        vec3(pilot.x, side, 0),
        vec3(pilot.x, -bodyRadius, 0),
      ],
      tube,
    ),
    hexFitting(vec3(tapDown, -bodyRadius, 0), Y, tube * 1.9, tube * 3),
    ...cock(vec3(pilot.x, side, level * 0.4), tube),
  );

  // Piloto: corpo, campânula da mola, tampa e parafuso de ajuste.
  const half = block / 2;
  parts.push(
    trim(
      box(
        vec3(pilot.x - half, side - half, level - half),
        vec3(pilot.x + half, side + half, level + half),
      ),
    ),
    trim(
      turned(vec3(pilot.x, side, level + half), vec3(0, 0, 1), [
        [0, block * 0.62],
        [block * 0.16, block * 0.62],
        [block * 0.16, block * 0.4],
        [block * 1.9, block * 0.34],
        [block * 1.9, block * 0.22],
        [block * 2.15, block * 0.22],
        [block * 2.15, block * 0.07],
        [block * 2.6, block * 0.07],
      ]),
    ),
    hexFitting(vec3(pilot.x - half, side, level), vec3(1, 0, 0), tube * 1.9, tube * 3),
    hexFitting(vec3(pilot.x, side, level - half), vec3(0, 0, 1), tube * 1.9, tube * 3),
  );

  return parts;
}
