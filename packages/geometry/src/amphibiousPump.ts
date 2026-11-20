import { vec3, type Vec3 } from '@hydrobim/core';
import type { MeshPart } from './elements';
import { box, loft, type ProfilePoint } from './loft';
import { coated, cylinder, trim, turned } from './primitives';
import type { MeshData } from './sweep';

/**
 * Bomba anfíbia em linha (HIGRA): carcaça cilíndrica do motor entre dois anéis, cone da
 * descarga, bocal da sucção (com os estágios em série, na de múltiplos estágios), tirantes,
 * dois pares de pés e olhais de içamento. Os discos dos flanges são gerados pelo chamador.
 *
 * Referencial: eixo da bomba no X local; flange A (sucção) em x = 0 e flange B (descarga) em
 * x = F; base dos pés em z = −I e topo em z = J − I.
 *
 * Do catálogo (cotas do dimensional): F (`length`), C e D (posição dos pés ao longo do
 * eixo), G (`footWidth`), I e J (base e topo) e, pelo chamador, os flanges.
 *
 * O restante é REPRESENTAÇÃO, lida das Figuras 42 e 43 do manual e escalada por I e J:
 * raio da carcaça e dos anéis, perfil do cone e do bocal, diâmetro e número de estágios
 * desenhados, tirantes, forma dos pés e dos olhais. Furos dos pés (ØH), parafusos, cabo
 * elétrico, placa e o interior da bomba não são modelados; a cota E não entra na geometria.
 */
export interface AmphibiousPumpInput {
  /** Cota F (m). */
  readonly length: number;
  /** Posição dos pares de pés no eixo (m): lado da sucção e lado da descarga. */
  readonly rearFootX: number;
  readonly frontFootX: number;
  /** Cotas Z da base dos pés e do topo, em relação ao eixo (m). */
  readonly baseZ: number;
  readonly topZ: number;
  /** Metade da cota G (m). */
  readonly footHalfWidth: number;
  /** Cota ØH (m): dimensiona a sapata do pé. */
  readonly footHoleDiameter: number;
  readonly stages: number;
  /** Raios externo e interno do tubo e espessura do flange em cada boca (m). */
  readonly suction: { outer: number; inner: number; flange: number };
  readonly discharge: { outer: number; inner: number; flange: number };
}

const X_AXIS = vec3(1, 0, 0);
const MINUS_X = vec3(-1, 0, 0);
const Y_AXIS = vec3(0, 1, 0);
const TIE_RODS = 8;

/** Anel vertical (olhal), no plano XZ. */
function eye(center: Vec3, majorRadius: number, tubeRadius: number): MeshData {
  const steps = 24;
  const points: ProfilePoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const phi = (i / steps) * Math.PI * 2;
    points.push({
      center: vec3(
        center.x + majorRadius * Math.cos(phi),
        center.y,
        center.z + majorRadius * Math.sin(phi),
      ),
      tangent: vec3(-Math.sin(phi), 0, Math.cos(phi)),
      radius: tubeRadius,
    });
  }
  return loft(points, { up: Y_AXIS, radialSegments: 12 });
}

export function amphibiousPumpParts(input: AmphibiousPumpInput): MeshPart[] {
  const { length, rearFootX, frontFootX, baseZ, topZ, suction, discharge } = input;
  const axisHeight = -baseZ;
  const span = frontFootX - rearFootX;

  // Anéis das tampas: ficam aquém da base e do topo; a carcaça fica por dentro dos tirantes.
  const ring = Math.max(
    Math.min(0.8 * axisHeight, 0.8 * topZ),
    Math.max(suction.outer, discharge.outer) * 1.25,
  );
  const rod = Math.max(ring * 0.035, 0.006);
  const casing = ring - 2.6 * rod;
  const ringWidth = Math.min(Math.max(span * 0.035, 0.015), span * 0.2);
  const parts: MeshPart[] = [];

  // Carcaça do motor e anéis.
  parts.push(coated(cylinder(vec3(rearFootX, 0, 0), vec3(frontFootX, 0, 0), casing, 0, 56)));
  for (const x of [rearFootX, frontFootX]) {
    parts.push(
      coated(cylinder(vec3(x - ringWidth / 2, 0, 0), vec3(x + ringWidth / 2, 0, 0), ring, 0, 56)),
    );
  }

  // Tirantes entre os anéis, por fora da carcaça.
  for (let i = 0; i < TIE_RODS; i += 1) {
    const phi = ((i + 0.5) / TIE_RODS) * Math.PI * 2;
    const y = (casing + 1.3 * rod) * Math.cos(phi);
    const z = (casing + 1.3 * rod) * Math.sin(phi);
    parts.push(
      trim(
        cylinder(
          vec3(rearFootX - ringWidth * 0.9, y, z),
          vec3(frontFootX + ringWidth * 0.9, y, z),
          rod,
          0,
          10,
        ),
      ),
    );
  }

  /**
   * Corpo de uma extremidade, da tampa (`from`) até o flange: perfil de revolução maciço e,
   * junto ao flange, um bocal oco — a boca aparece aberta.
   */
  const endBody = (
    from: number,
    direction: 1 | -1,
    available: number,
    mouth: { outer: number; inner: number; flange: number },
    profile: (reach: number, hub: number) => (readonly [number, number, boolean?])[],
  ): void => {
    const reach = available - mouth.flange;
    if (reach <= 0) return;
    const hub = Math.min(mouth.outer * 1.15, casing);
    const neck = Math.min(reach * 0.3, mouth.outer * 1.5);
    const axis = direction === 1 ? X_AXIS : MINUS_X;
    parts.push(coated(turned(vec3(from, 0, 0), axis, profile(reach - neck, hub), 56)));
    parts.push(
      coated(
        cylinder(
          vec3(from + direction * (reach - neck), 0, 0),
          vec3(from + direction * reach, 0, 0),
          hub,
          Math.min(mouth.inner, hub * 0.9),
          40,
        ),
      ),
    );
  };

  // Descarga (B): cone abaulado da carcaça até o bocal.
  endBody(frontFootX, 1, length - frontFootX, discharge, (reach, hub) => [
    [0, casing],
    [reach * 0.3, casing * 0.97 + hub * 0.03, true],
    [reach * 0.75, (casing + hub) / 2, true],
    [reach, hub],
  ]);

  // Sucção (A): tampa abaulada e bocal; com mais de um estágio, o conjunto dos estágios em
  // série ocupa o trecho, com um anel por estágio.
  const stages = Math.max(1, Math.round(input.stages));
  endBody(rearFootX, -1, rearFootX, suction, (reach, hub) => {
    if (stages === 1) {
      return [
        [0, casing],
        [reach * 0.35, casing * 0.9 + hub * 0.1, true],
        [reach * 0.8, hub * 1.1, true],
        [reach, hub],
      ];
    }
    const stack = Math.max(casing * 0.62, hub * 1.15);
    const stackEnd = reach * 0.85;
    const profile: (readonly [number, number, boolean?])[] = [
      [0, casing * 0.8],
      [reach * 0.06, stack],
    ];
    const band = stackEnd / stages;
    for (let i = 0; i < stages; i += 1) {
      const at = reach * 0.06 + (band - (reach * 0.06) / stages) * (i + 0.5);
      const half = band * 0.12;
      profile.push([at - half, stack], [at - half, stack * 1.07], [at + half, stack * 1.07]);
      profile.push([at + half, stack]);
    }
    profile.push([stackEnd, stack], [reach, hub]);
    return profile;
  });

  // Pés: uma chapa transversal sob cada anel e as duas sapatas, na cota G.
  const pad = Math.max(1.6 * input.footHoleDiameter, 0.035);
  const sole = Math.max(axisHeight * 0.06, 0.012);
  const footLength = Math.max(ringWidth * 2.2, pad * 1.6);
  const reachY = input.footHalfWidth + pad;
  for (const x of [rearFootX, frontFootX]) {
    parts.push(
      coated(
        box(vec3(x - ringWidth / 2, -reachY, baseZ), vec3(x + ringWidth / 2, reachY, -ring * 0.45)),
      ),
    );
    for (const side of [-1, 1]) {
      const y = side * input.footHalfWidth;
      parts.push(
        coated(
          box(
            vec3(x - footLength / 2, y - pad, baseZ),
            vec3(x + footLength / 2, y + pad, baseZ + sole),
          ),
        ),
      );
    }
  }

  // Olhais de içamento sobre os anéis: o topo do olhal é a cota J.
  const headroom = topZ - ring;
  if (headroom > 0.005) {
    const tube = headroom * 0.12;
    const major = headroom * 0.455;
    for (const x of [rearFootX, frontFootX]) {
      parts.push(trim(eye(vec3(x, 0, topZ - major - tube), major, tube)));
    }
  }
  return parts;
}
