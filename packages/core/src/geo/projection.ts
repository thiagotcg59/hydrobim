import type { ProjectedCrs } from './crs';

/**
 * Projeção Transversa de Mercator pelas séries de Krüger (ordem n⁴), na formulação de
 * Karney (2011), "Transverse Mercator with an accuracy of a few nanometers", J. Geodesy 85.
 * Dentro de um fuso UTM o erro de truncamento fica abaixo de 1 µm — ver a conferência contra
 * o PROJ em `geo.test.ts`. Longitude e latitude em graus; E e N em metros.
 */

export interface Geographic {
  /** Longitude (graus, leste positivo). */
  readonly lon: number;
  /** Latitude geodésica (graus, norte positivo). */
  readonly lat: number;
}

export interface Projected {
  /** Este (m). */
  readonly e: number;
  /** Norte (m). */
  readonly n: number;
}

const RAD = Math.PI / 180;

interface Series {
  /** Raio retificante vezes o fator de escala (m). */
  readonly radius: number;
  /** Primeira excentricidade. */
  readonly ecc: number;
  readonly alpha: readonly number[];
  readonly beta: readonly number[];
}

const seriesCache = new Map<number, Series>();

function seriesOf(crs: ProjectedCrs): Series {
  const cached = seriesCache.get(crs.epsg);
  if (cached) return cached;
  const f = 1 / crs.ellipsoid.inverseFlattening;
  const n = f / (2 - f);
  const n2 = n * n;
  const n3 = n2 * n;
  const n4 = n3 * n;
  const series: Series = {
    radius: (crs.scaleFactor * crs.ellipsoid.a * (1 + n2 / 4 + n4 / 64)) / (1 + n),
    ecc: Math.sqrt(f * (2 - f)),
    alpha: [
      n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180,
      (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440,
      (61 * n3) / 240 - (103 * n4) / 140,
      (49561 * n4) / 161280,
    ],
    beta: [
      n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360,
      n2 / 48 + n3 / 15 - (437 * n4) / 1440,
      (17 * n3) / 480 - (37 * n4) / 840,
      (4397 * n4) / 161280,
    ],
  };
  seriesCache.set(crs.epsg, series);
  return series;
}

/** Geográficas (no datum do sistema) → projetadas. */
export function geographicToProjected(crs: ProjectedCrs, point: Geographic): Projected {
  const { radius, ecc, alpha } = seriesOf(crs);
  const phi = point.lat * RAD;
  const lambda = (point.lon - crs.centralMeridian) * RAD;
  const sinPhi = Math.sin(phi);
  // Tangente da latitude conforme.
  const t = Math.sinh(Math.atanh(sinPhi) - ecc * Math.atanh(ecc * sinPhi));
  const xiP = Math.atan2(t, Math.cos(lambda));
  const etaP = Math.asinh(Math.sin(lambda) / Math.hypot(t, Math.cos(lambda)));
  let xi = xiP;
  let eta = etaP;
  alpha.forEach((a, index) => {
    const j = 2 * (index + 1);
    xi += a * Math.sin(j * xiP) * Math.cosh(j * etaP);
    eta += a * Math.cos(j * xiP) * Math.sinh(j * etaP);
  });
  return { e: crs.falseEasting + radius * eta, n: crs.falseNorthing + radius * xi };
}

/** Projetadas → geográficas (no datum do sistema). */
export function projectedToGeographic(crs: ProjectedCrs, point: Projected): Geographic {
  const { radius, ecc, beta } = seriesOf(crs);
  const xi = (point.n - crs.falseNorthing) / radius;
  const eta = (point.e - crs.falseEasting) / radius;
  let xiP = xi;
  let etaP = eta;
  beta.forEach((b, index) => {
    const j = 2 * (index + 1);
    xiP -= b * Math.sin(j * xi) * Math.cosh(j * eta);
    etaP -= b * Math.cos(j * xi) * Math.sinh(j * eta);
  });
  const tConformal = Math.sin(xiP) / Math.hypot(Math.sinh(etaP), Math.cos(xiP));
  const lambda = Math.atan2(Math.sinh(etaP), Math.cos(xiP));
  // Da latitude conforme à geodésica, pelo método de Newton (converge em 2 ou 3 passos).
  const e2 = ecc * ecc;
  let tau = tConformal;
  for (let i = 0; i < 8; i += 1) {
    const root = Math.hypot(1, tau);
    const sigma = Math.sinh(ecc * Math.atanh((ecc * tau) / root));
    const current = tau * Math.hypot(1, sigma) - sigma * root;
    const delta =
      ((tConformal - current) / Math.hypot(1, current)) *
      ((1 + (1 - e2) * tau * tau) / ((1 - e2) * root));
    tau += delta;
    if (Math.abs(delta) < 1e-14 * Math.max(1, Math.abs(tau))) break;
  }
  return { lon: crs.centralMeridian + lambda / RAD, lat: Math.atan(tau) / RAD };
}

export interface GridFactors {
  /** Fator de escala da projeção no ponto: distância na quadrícula ÷ distância no elipsoide. */
  readonly scale: number;
  /**
   * Convergência meridiana (rad): ângulo do norte verdadeiro ao norte da quadrícula, positivo
   * no sentido horário (mesma convenção do PROJ). O norte verdadeiro fica a `−convergência`
   * do norte da quadrícula.
   */
  readonly convergence: number;
}

/**
 * Fator de escala e convergência no ponto, por diferença finita sobre o meridiano: informam ao
 * projetista quanto a quadrícula difere do terreno, sem alterar nenhuma medida do modelo.
 */
export function gridFactors(crs: ProjectedCrs, point: Projected): GridFactors {
  const { ecc } = seriesOf(crs);
  const geographic = projectedToGeographic(crs, point);
  const step = 1e-4; // graus (≈ 11 m sobre o meridiano)
  const south = geographicToProjected(crs, { lon: geographic.lon, lat: geographic.lat - step });
  const north = geographicToProjected(crs, { lon: geographic.lon, lat: geographic.lat + step });
  const sinPhi = Math.sin(geographic.lat * RAD);
  const e2 = ecc * ecc;
  // Raio de curvatura do meridiano.
  const meridianRadius = (crs.ellipsoid.a * (1 - e2)) / (1 - e2 * sinPhi * sinPhi) ** 1.5;
  const de = north.e - south.e;
  const dn = north.n - south.n;
  return {
    scale: Math.hypot(de, dn) / (meridianRadius * 2 * step * RAD),
    convergence: -Math.atan2(de, dn),
  };
}
