import { describe, expect, it } from 'vitest';
import { POSITION_TOLERANCE } from '../dimensions';
import type { Georeference } from '../schema';
import { findProjectedCrs } from './crs';
import { geographicToProjected, gridFactors, projectedToGeographic } from './projection';
import {
  createGeoTransform,
  GEO_ROUNDTRIP_TOLERANCE,
  georeferenceStatus,
  localToProjected,
  projectedToLocal,
} from './transform';
import { geographicToTile, tileGroundResolution, tileToGeographic } from './webMercator';

/**
 * Pontos de controle calculados de forma independente com o PROJ 9.8.1 (pyproj 3.8.0):
 * `Transformer.from_crs("EPSG:4326", "EPSG:<código>", always_xy=True)` e
 * `Proj(crs).get_factors(lon, lat)`. `k` é o fator de escala e `convergence`, a convergência
 * meridiana em graus.
 */
const CONTROL = [
  // São Paulo (marco zero), fuso 23S.
  {
    epsg: 31983,
    lon: -46.633309,
    lat: -23.55052,
    e: 333287.02152768255,
    n: 7394586.093402657,
    k: 0.9999433270625877,
    convergence: 0.6527520221126141,
  },
  {
    epsg: 31983,
    lon: -43.5,
    lat: -19.9,
    e: 657020.5637777201,
    n: 7798884.904411863,
    k: 0.999904743559165,
    convergence: -0.5106743324714191,
  },
  // Borda oeste do fuso 23S.
  {
    epsg: 31983,
    lon: -47.9,
    lat: -15.8,
    e: 189303.9156132344,
    n: 8251045.076815761,
    k: 1.0007939912000974,
    convergence: 0.7902493426932405,
  },
  // Porto Alegre, fuso 22S.
  {
    epsg: 31982,
    lon: -51.2,
    lat: -30.03,
    e: 480716.2477013603,
    n: 6677873.553335266,
    k: 0.9996045877683769,
    convergence: 0.10009098561323822,
  },
  // Fortaleza, fuso 24S.
  {
    epsg: 31984,
    lon: -38.5,
    lat: -3.7,
    e: 555522.9892492979,
    n: 9591017.491355302,
    k: 0.9996381590931545,
    convergence: -0.032266986314547684,
  },
  // Recife, fuso 25S.
  {
    epsg: 31985,
    lon: -34.9,
    lat: -8.05,
    e: 290610.0107551748,
    n: 9109688.247115716,
    k: 1.000142639261665,
    convergence: 0.2661682814461186,
  },
  // Manaus, nos dois fusos vizinhos (21S e 20S).
  {
    epsg: 31981,
    lon: -60.02,
    lat: -3.1,
    e: 164282.46077339334,
    n: 9656874.693516232,
    k: 1.0009954296225598,
    convergence: 0.16347204735009035,
  },
  {
    epsg: 31980,
    lon: -60.02,
    lat: -3.1,
    e: 831266.9057543743,
    n: 9656887.307515498,
    k: 1.0009586676897737,
    convergence: -0.1613028506239248,
  },
  // Boa Vista, hemisfério norte (fuso 20N).
  {
    epsg: 31974,
    lon: -60.67,
    lat: 2.82,
    e: 759030.3292944815,
    n: 311956.4873116806,
    k: 1.0004306577071163,
    convergence: 0.11469666759649315,
  },
  // Mesmos pontos em WGS 84 / UTM (elipsoide WGS 84).
  {
    epsg: 32723,
    lon: -46.633309,
    lat: -23.55052,
    e: 333287.0215281195,
    n: 7394586.093323739,
    k: 0.9999433270625685,
    convergence: 0.6527520220962242,
  },
  {
    epsg: 32618,
    lon: -74.0,
    lat: 40.7,
    e: 584482.3522822947,
    n: 4505935.869447077,
    k: 0.9996878486522325,
    convergence: 0.6521369063939626,
  },
  // Sobre o meridiano central e na borda leste do fuso 23S.
  {
    epsg: 31983,
    lon: -45.0,
    lat: -23.0,
    e: 500000.0,
    n: 7456480.236479331,
    k: 0.9996000000340517,
    convergence: 0,
  },
  {
    epsg: 31983,
    lon: -42.0001,
    lat: -22.0,
    e: 809754.7177317683,
    n: 7564133.411250557,
    k: 1.0007857102468547,
    convergence: -1.1246813158842557,
  },
] as const;

function crsOf(epsg: number) {
  const crs = findProjectedCrs(epsg);
  if (!crs) throw new Error(`EPSG:${epsg} deveria ser suportado.`);
  return crs;
}

describe('registro de sistemas de referência', () => {
  it.each([
    [31983, 'SIRGAS 2000 / UTM zone 23S', -45, 10_000_000],
    [31982, 'SIRGAS 2000 / UTM zone 22S', -51, 10_000_000],
    [31977, 'SIRGAS 2000 / UTM zone 17S', -81, 10_000_000],
    [31985, 'SIRGAS 2000 / UTM zone 25S', -33, 10_000_000],
    [31965, 'SIRGAS 2000 / UTM zone 11N', -117, 0],
    [31976, 'SIRGAS 2000 / UTM zone 22N', -51, 0],
    [5396, 'SIRGAS 2000 / UTM zone 26S', -27, 10_000_000],
    [6210, 'SIRGAS 2000 / UTM zone 23N', -45, 0],
    [6211, 'SIRGAS 2000 / UTM zone 24N', -39, 0],
    [32601, 'WGS 84 / UTM zone 1N', -177, 0],
    [32660, 'WGS 84 / UTM zone 60N', 177, 0],
    [32723, 'WGS 84 / UTM zone 23S', -45, 10_000_000],
    [32760, 'WGS 84 / UTM zone 60S', 177, 10_000_000],
  ])('EPSG:%i é "%s" (nome e parâmetros do banco EPSG)', (epsg, name, meridian, falseNorthing) => {
    const crs = crsOf(epsg);
    expect(crs.name).toBe(name);
    expect(crs.centralMeridian).toBe(meridian);
    expect(crs.falseNorthing).toBe(falseNorthing);
    expect(crs.falseEasting).toBe(500_000);
    expect(crs.scaleFactor).toBe(0.9996);
  });

  it.each([29193, 22523, 4674, 4326, 5880, 3857, 31964, 31986, 32661, 0, 1.5])(
    'não presume transformação para o EPSG:%s',
    (epsg) => {
      // SAD69, Córrego Alegre, geográficos, policônica e Web Mercator ficam de fora.
      expect(findProjectedCrs(epsg)).toBeNull();
    },
  );
});

describe('Transversa de Mercator conferida com o PROJ', () => {
  it.each(CONTROL)('EPSG:$epsg em ($lon; $lat): direta, inversa, escala e convergência', (c) => {
    const crs = crsOf(c.epsg);
    const projected = geographicToProjected(crs, c);
    // Um centésimo de milímetro: muito abaixo de qualquer levantamento.
    expect(Math.abs(projected.e - c.e)).toBeLessThan(1e-5);
    expect(Math.abs(projected.n - c.n)).toBeLessThan(1e-5);
    const geographic = projectedToGeographic(crs, { e: c.e, n: c.n });
    // 1e-10 grau ≈ 0,01 mm no terreno.
    expect(Math.abs(geographic.lon - c.lon)).toBeLessThan(1e-10);
    expect(Math.abs(geographic.lat - c.lat)).toBeLessThan(1e-10);
    const factors = gridFactors(crs, { e: c.e, n: c.n });
    expect(Math.abs(factors.scale - c.k)).toBeLessThan(1e-8);
    expect(Math.abs((factors.convergence * 180) / Math.PI - c.convergence)).toBeLessThan(1e-6);
  });
});

const GEO: Georeference = {
  crsName: 'SIRGAS 2000 / UTM zone 23S',
  epsg: 31983,
  eastings: 333287.0215,
  northings: 7394586.0934,
  orthogonalHeight: 760,
  rotation: (17.5 * Math.PI) / 180,
  verticalDatum: 'Imbituba',
};

describe('cadeia local ⇄ projetado ⇄ geográfico', () => {
  it('local → projetado é a conversão do IfcMapConversion (rotação anti-horária do eixo X)', () => {
    const geo = { ...GEO, rotation: Math.PI / 2 };
    // Com o eixo X local apontando para o norte, 10 m em X são 10 m de norte.
    const p = localToProjected(geo, { x: 10, y: 0 });
    expect(p.e).toBeCloseTo(geo.eastings, 9);
    expect(p.n).toBeCloseTo(geo.northings + 10, 9);
    // E 10 m em Y local apontam para oeste.
    const q = localToProjected(geo, { x: 0, y: 10 });
    expect(q.e).toBeCloseTo(geo.eastings - 10, 9);
    expect(q.n).toBeCloseTo(geo.northings, 9);
  });

  it('ida e volta preserva as coordenadas dentro da tolerância, em uma rede de 20 km', () => {
    const transform = createGeoTransform(GEO, crsOf(31983));
    let worst = 0;
    for (let x = -10_000; x <= 10_000; x += 2_500) {
      for (let y = -10_000; y <= 10_000; y += 2_500) {
        const projected = transform.localToProjected({ x, y });
        const viaProjected = transform.projectedToLocal(projected);
        const viaGeographic = transform.geographicToLocal(transform.localToGeographic({ x, y }));
        worst = Math.max(
          worst,
          Math.hypot(viaProjected.x - x, viaProjected.y - y),
          Math.hypot(viaGeographic.x - x, viaGeographic.y - y),
        );
      }
    }
    expect(worst).toBeLessThan(GEO_ROUNDTRIP_TOLERANCE);
    // A tolerância declarada é menor que a de acoplamento das portas.
    expect(GEO_ROUNDTRIP_TOLERANCE).toBeLessThan(POSITION_TOLERANCE);
    // E o erro real fica ordens de grandeza abaixo dela.
    expect(worst).toBeLessThan(1e-6);
  });

  it('a origem local cai no ponto de controle geográfico', () => {
    const transform = createGeoTransform(GEO, crsOf(31983));
    const origin = transform.localToGeographic({ x: 0, y: 0 });
    expect(origin.lon).toBeCloseTo(-46.633309, 7);
    expect(origin.lat).toBeCloseTo(-23.55052, 7);
    expect(transform.localToHeight(2.5)).toBe(762.5);
  });

  it('a translação pura não substitui a projeção: 10 km a leste não são 10 km de longitude plana', () => {
    const transform = createGeoTransform({ ...GEO, rotation: 0 }, crsOf(31983));
    const a = transform.localToGeographic({ x: 0, y: 0 });
    const b = transform.localToGeographic({ x: 10_000, y: 0 });
    // Caminhando para leste na quadrícula, a latitude muda (convergência meridiana ≠ 0).
    expect(Math.abs(b.lat - a.lat)).toBeGreaterThan(1e-4);
    const back = projectedToLocal({ ...GEO, rotation: 0 }, geographicToProjected(crsOf(31983), b));
    expect(back.x).toBeCloseTo(10_000, 6);
    expect(back.y).toBeCloseTo(0, 6);
  });
});

describe('estado do georreferenciamento', () => {
  it('sem dados fica pendente — nada é presumido', () => {
    expect(georeferenceStatus(null).state).toBe('pending');
  });

  it('sem EPSG ou com sistema fora do registro não posiciona o mapa', () => {
    expect(georeferenceStatus({ ...GEO, epsg: null }).state).toBe('unsupported');
    const sad69 = georeferenceStatus({ ...GEO, epsg: 29193, crsName: 'SAD69 / UTM zone 23S' });
    expect(sad69.state).toBe('unsupported');
    expect(sad69.message).toContain('EPSG:29193');
  });

  it('recusa origem fora do domínio do fuso', () => {
    expect(georeferenceStatus({ ...GEO, eastings: 0 }).state).toBe('invalid');
    expect(georeferenceStatus({ ...GEO, eastings: 7_394_586 }).state).toBe('invalid');
    expect(georeferenceStatus({ ...GEO, northings: 0 }).state).toBe('invalid');
    // No hemisfério norte, N pequeno é legítimo.
    expect(georeferenceStatus({ ...GEO, epsg: 31974, northings: 311_956 }).state).toBe('ready');
  });

  it('com sistema suportado e origem coerente fica pronto', () => {
    const status = georeferenceStatus(GEO);
    expect(status.state).toBe('ready');
    if (status.state !== 'ready') return;
    expect(status.crs.epsg).toBe(31983);
    expect(status.crs.datumToMapAccuracy).toBe(1);
  });
});

describe('ladrilhos Web Mercator', () => {
  it('converte para o esquema de ladrilhos e volta', () => {
    // Valores de referência da definição do esquema: (0°, 0°) é o centro do mundo.
    expect(geographicToTile({ lon: 0, lat: 0 }, 1)).toEqual({ x: 1, y: 1 });
    expect(geographicToTile({ lon: -180, lat: 85.0511287798066 }, 3).x).toBe(0);
    expect(geographicToTile({ lon: -180, lat: 85.0511287798066 }, 3).y).toBeCloseTo(0, 9);
    const sp = { lon: -46.633309, lat: -23.55052 };
    const tile = geographicToTile(sp, 15);
    // Ladrilho 15/12139/18590, calculado à mão pelas fórmulas do esquema:
    // x = (lon + 180) / 360 · 2^15 = 12139,3 e y = (1 − asinh(tan lat) / π) / 2 · 2^15 = 18590,7.
    expect(Math.floor(tile.x)).toBe(12139);
    expect(Math.floor(tile.y)).toBe(18590);
    const back = tileToGeographic(tile, 15);
    expect(back.lon).toBeCloseTo(sp.lon, 10);
    expect(back.lat).toBeCloseTo(sp.lat, 10);
  });

  it('informa a resolução no terreno', () => {
    // No equador, nível 0: 40 075 016,686 m ÷ 256 px.
    expect(tileGroundResolution(0, 0)).toBeCloseTo(156543.03392804097, 6);
    expect(tileGroundResolution(-23.55, 14)).toBeCloseTo(8.759, 2);
  });
});
