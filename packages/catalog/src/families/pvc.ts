import type { FittingFamily } from '@hydrobim/core';
import { pbaBendPortsMm } from '../products/wavinPba';
import { family, forSpecifications, type EndMm, type SizeMm } from './builders';

/**
 * Conexões de PVC para água fria — dimensões transcritas de catálogos de fabricantes.
 *
 * AVISO: são dimensões de FABRICANTE (não normativas) e variam entre marcas em até
 * alguns milímetros. Onde o catálogo não tabula um valor, ele foi derivado de outros
 * valores do mesmo catálogo, e a derivação está indicada no campo `source`.
 *
 * Convenção do HydroBIM para bolsas soldáveis: a porta fica no FUNDO da bolsa (onde a
 * ponta do tubo encosta); `end = [profundidade da bolsa, diâmetro externo da bolsa]`.
 */

const SOLDAVEL = 'pvc-soldavel-nbr5648';
const KRONA =
  'Krona — Catálogo Técnico Linha Soldável (https://www.krona.com.br/wp-content/uploads/2024/01/Catalogo-Tecnico-Linha-Soldavel-Novembro-final.pdf)';

/** DN de referência de cada diâmetro externo (DE) da série soldável. */
const DN: Record<number, number> = {
  20: 15,
  25: 20,
  32: 25,
  40: 32,
  50: 40,
  60: 50,
  75: 65,
  85: 75,
  110: 100,
};
const dn = (de: number): number => {
  const value = DN[de];
  if (value === undefined) throw new Error(`DE ${de} fora da série soldável.`);
  return value;
};

/** Bolsa por DE: [profundidade B, diâmetro externo A] — tabela do Tê soldável Krona, p. 6. */
const SOCKET: Record<number, EndMm> = {
  20: [16.5, 28],
  25: [19.5, 34],
  32: [22.8, 42],
  40: [26.6, 51.6],
  50: [31.6, 60.6],
  60: [36.5, 74],
  75: [45, 92],
  85: [50, 103],
  110: [63, 130],
};
const socketOd = (de: number): number => SOCKET[de]?.[1] ?? de * 1.2;

// [DE, A (Ø ext. bolsa), B (profundidade), Z (centro ao fundo da bolsa)]
const JOELHO_90 = [
  [20, 28, 16.5, 11.4],
  [25, 33.8, 19, 14.4],
  [32, 42, 22.8, 18],
  [40, 51.6, 26.8, 22.3],
  [50, 60.6, 31, 27.9],
  [60, 74, 36.5, 32.9],
  [75, 92, 45, 42],
  [85, 103, 50, 49],
  [110, 130, 63, 63],
] as const;

const JOELHO_45 = [
  [20, 28, 16.1, 5.1],
  [25, 33.8, 19, 6.5],
  [32, 42, 22.1, 6.9],
  [40, 51.6, 26.8, 9.1],
  [50, 63, 31.1, 10.7],
  [60, 74, 37, 17.3],
  [75, 92, 44, 17.5],
  [85, 103, 49, 19.5],
  [110, 128, 61.5, 24.5],
] as const;

const TE = [
  [20, 28, 16.5, 11.4],
  [25, 34, 19.5, 14.4],
  [32, 42, 22.8, 17.7],
  [40, 51.6, 26.6, 22.4],
  [50, 60.6, 31.6, 27],
  [60, 74, 36.5, 32.9],
  [75, 92, 45, 44],
  [85, 103, 50, 49],
  [110, 130, 63, 61],
] as const;

// [DE passagem, DE derivação, A, B1, B2, Z1 (centro ao fundo da bolsa da passagem), Z2 (eixo ao fundo da bolsa da derivação)]
const TE_REDUCAO = [
  [25, 20, 33.8, 18, 16, 12, 13.9],
  [32, 25, 42, 22, 18, 14, 17.4],
  [40, 25, 51.6, 26, 18, 14.7, 22],
  [40, 32, 51.6, 26, 22, 19.7, 23.4],
  [50, 25, 63, 31, 18, 13.3, 27],
  [50, 32, 63, 31, 22, 19.2, 28.2],
  [50, 40, 63, 31, 26, 22.8, 27.8],
  [60, 25, 74, 36, 18, 16.6, 34.5],
  [75, 50, 92, 43, 31, 28, 42],
  [75, 60, 92, 43, 36, 34.3, 42.5],
  [85, 60, 103, 48, 36, 34.7, 47],
  [110, 60, 130, 61, 36, 38.5, 64],
  [110, 75, 130, 61, 43, 43.5, 62.5],
] as const;

// [DE maior, DE menor, A, B1, B2, Z (distância entre os fundos das bolsas)]
const LUVA_REDUCAO = [
  [25, 20, 33.8, 18.6, 16.1, 1.7],
  [32, 25, 42, 23.3, 19, 3.3],
  [40, 32, 51.6, 26.5, 22.5, 8.1],
  [50, 25, 63, 31.5, 19, 16.8],
  [60, 50, 74, 36.5, 31.5, 10],
  [75, 60, 92, 44, 36.5, 13.3],
  [110, 75, 128, 61.5, 44, 23],
] as const;

// [DE maior (ponta), DE menor (bolsa), B (profundidade da bolsa menor), C (comprimento total)]
const BUCHA_LONGA = [
  [32, 20, 16, 44],
  [40, 20, 16, 52],
  [40, 25, 18, 51],
  [50, 20, 16, 60],
  [50, 25, 18, 61],
  [50, 32, 22, 60.5],
  [60, 25, 18, 72],
  [60, 32, 22, 69],
  [60, 40, 26, 70.5],
  [60, 50, 31, 73],
  [75, 50, 31, 85.7],
  [85, 60, 36, 100.8],
  [110, 60, 36, 127.3],
  [110, 75, 43, 127],
] as const;

// Registro de esfera VS soldável (Tigre): [DE, L (bolsa), E1 (Ø corpo/porca), Z (entre fundos), B (altura total), C (alavanca)]
const REGISTRO_VS = [
  [20, 16, 50, 42, 56, 76],
  [25, 18.5, 61, 50.9, 64, 80],
  [32, 22, 68, 55.5, 70, 90],
  [40, 26, 83, 66.6, 74, 110],
  [50, 31, 96, 76.2, 96.5, 140],
  [60, 36, 115, 93.1, 107, 170],
] as const;

const soldavel: FittingFamily[] = [
  family({
    id: 'krona-joelho-90-soldavel',
    name: 'Joelho 90° soldável',
    kind: 'elbow',
    specificationId: SOLDAVEL,
    endType: 'socket',
    angleDeg: 90,
    manufacturer: 'Krona',
    standard: 'ABNT NBR 5648',
    source: `${KRONA}, p. 9 — Z (centro ao fundo da bolsa), B (profundidade), A (Ø externo da bolsa).`,
    sizes: JOELHO_90.map(([de, a, b, z]) => ({ dn: dn(de), centerToEnd: z, end: [b, a] })),
  }),
  family({
    id: 'krona-joelho-45-soldavel',
    name: 'Joelho 45° soldável',
    kind: 'elbow',
    specificationId: SOLDAVEL,
    endType: 'socket',
    angleDeg: 45,
    manufacturer: 'Krona',
    standard: 'ABNT NBR 5648',
    source: `${KRONA}, p. 9 — Z, B e A como no joelho de 90°.`,
    sizes: JOELHO_45.map(([de, a, b, z]) => ({ dn: dn(de), centerToEnd: z, end: [b, a] })),
  }),
  family({
    id: 'krona-te-soldavel',
    name: 'Tê soldável',
    kind: 'tee',
    specificationId: SOLDAVEL,
    endType: 'socket',
    manufacturer: 'Krona',
    standard: 'ABNT NBR 5648',
    source: `${KRONA}, p. 6 — Z (centro ao fundo da bolsa), igual na passagem e na derivação.`,
    sizes: TE.map(([de, a, b, z]) => ({
      dn: dn(de),
      centerToEnd: z,
      centerToBranch: z,
      end: [b, a],
    })),
  }),
  family({
    id: 'krona-te-reducao-soldavel',
    name: 'Tê de redução soldável',
    kind: 'tee',
    specificationId: SOLDAVEL,
    endType: 'socket',
    manufacturer: 'Krona',
    standard: 'ABNT NBR 5648',
    source: `${KRONA}, p. 5 — Z1/Z2 e B1/B2. O Ø externo da bolsa da derivação não é tabulado: adotado o da tabela do tê (p. 6) para o mesmo DE.`,
    sizes: TE_REDUCAO.map(([de, de2, a, b1, b2, z1, z2]) => ({
      dn: dn(de),
      dn2: dn(de2),
      centerToEnd: z1,
      centerToBranch: z2,
      end: [b1, a],
      end2: [b2, socketOd(de2)],
    })),
  }),
  family({
    id: 'krona-luva-reducao-soldavel',
    name: 'Luva de redução soldável',
    kind: 'reducer',
    specificationId: SOLDAVEL,
    endType: 'socket',
    manufacturer: 'Krona',
    standard: 'ABNT NBR 5648',
    source: `${KRONA}, p. 6 — Z (distância entre os fundos das bolsas), B1/B2. Ø externo da bolsa menor: tabela do tê (p. 6).`,
    sizes: LUVA_REDUCAO.map(([de, de2, a, b1, b2, z]) => ({
      dn: dn(de),
      dn2: dn(de2),
      length: z,
      end: [b1, a],
      end2: [b2, socketOd(de2)],
    })),
  }),
  family({
    id: 'krona-bucha-reducao-longa-soldavel',
    name: 'Bucha de redução longa soldável',
    kind: 'reducer',
    specificationId: SOLDAVEL,
    endType: 'socket',
    manufacturer: 'Krona',
    standard: 'ABNT NBR 5648',
    source: `${KRONA}, p. 8 — comprimento entre portas = C − B (comprimento total menos a bolsa menor). O lado maior é ponta (encaixa na bolsa de outra conexão). Ø externo da bolsa menor: tabela do tê (p. 6).`,
    sizes: BUCHA_LONGA.map(([de, de2, b, c]) => ({
      dn: dn(de),
      dn2: dn(de2),
      length: c - b,
      end2: [b, socketOd(de2)],
    })),
  }),
  family({
    id: 'tigre-registro-esfera-vs-soldavel',
    name: 'Registro de esfera VS soldável',
    kind: 'valve',
    valveType: 'ball',
    specificationId: SOLDAVEL,
    endType: 'socket',
    manufacturer: 'Tigre',
    standard: 'ABNT NBR 5648',
    source:
      'Tigre — FT Registros de Esfera 2025 (https://tigresite.s3.amazonaws.com/2025/08/FT_Registros-de-Esfera-2025.pdf), p. 6 — Z (entre fundos das bolsas), L (bolsa), E1 (Ø do corpo), C (alavanca). Altura do eixo ao topo derivada: B − E1/2.',
    sizes: REGISTRO_VS.map(([de, l, e1, z, b, c]) => ({
      dn: dn(de),
      length: z,
      height: b - e1 / 2,
      handwheelDiameter: c,
      end: [l, e1],
    })),
  }),
];

/** Especificações de tubo PBA atendidas pelas mesmas conexões de junta elástica. */
const PBA = ['pvc-pba-nbr5647-cl12', 'pvc-pba-nbr5647-cl15', 'pvc-pba-nbr5647-cl20'] as const;
const WAVIN_PBA =
  'Amanco Wavin — FT Linha PBA, FTC000088, jan/2025 (https://mediahub.wavin.com/m/89a6b27bb1db716/original/FT-Linha-PBA.pdf)';

/** Bolsa de junta elástica por DN: [profundidade C, diâmetro externo A]. */
const PBA_SOCKET: Record<number, EndMm> = { 50: [60.5, 82.9], 75: [71, 116.7], 100: [76, 144.9] };
const pbaSocket = (size: number): EndMm => PBA_SOCKET[size] ?? [60, size * 1.5];

/**
 * Curva PBA ponta e bolsa (conformada). Porta `a` = fundo da bolsa; porta `b` = extremidade
 * da ponta, que entra na bolsa do tubo seguinte.
 */
const pbaBend = (angleDeg: number, label: string, pages: string, note = ''): FittingFamily[] =>
  forSpecifications(PBA, {
    id: `wavin-curva-${String(angleDeg).replace('.', '-')}-pba`,
    name: `Curva ${label} PBA ponta e bolsa`,
    kind: 'elbow',
    endType: 'socket',
    angleDeg,
    manufacturer: 'Amanco Wavin',
    standard: 'ABNT NBR 5647',
    source: `${WAVIN_PBA}, p. ${pages} — cotas C, D, F e L tabuladas. Raio de curvatura e trecho reto após a bolsa NÃO são tabulados: derivados das cotas L das curvas de 45° e 90°, supondo o mesmo raio nas duas (docs/CATALOGS.md); o vértice às portas decorre dessa hipótese — confirmar com o fabricante.${note}`,
    sizes: [50, 75, 100].flatMap((size): SizeMm[] => {
      const ports = pbaBendPortsMm(angleDeg, size);
      return ports
        ? [
            {
              dn: size,
              centerToEnd: ports.toSocket,
              centerToEnd2: ports.toSpigot,
              bendRadius: ports.bendRadius,
              end: ports.socket,
            },
          ]
        : [];
    }),
  });

const PBA_SAME_TABLE =
  ' As tabelas das curvas de 11°15′ e 22°30′ são impressas idênticas no catálogo (provável repetição).';

const pba: FittingFamily[] = [
  ...pbaBend(90, '90°', '22'),
  ...pbaBend(45, '45°', '21–22'),
  ...pbaBend(22.5, '22°30′', '21', PBA_SAME_TABLE),
  ...pbaBend(11.25, '11°15′', '20–21', PBA_SAME_TABLE),
  ...forSpecifications(PBA, {
    id: 'wavin-te-pba',
    name: 'Tê PBA junta elástica',
    kind: 'tee',
    endType: 'socket',
    manufacturer: 'Amanco Wavin',
    standard: 'ABNT NBR 5647',
    source: `${WAVIN_PBA}, p. 25 — centro à porta derivado: L/2 − C (passagem) e L1 − A/2 − C (derivação); as duas derivações coincidem a menos de 0,1 mm.`,
    // DN: [L (comprimento total), L1 (altura total)]
    sizes: (
      [
        [50, 198, 140.5],
        [75, 248, 182.3],
        [100, 288, 216.5],
      ] as const
    ).map(([size, l, l1]) => {
      const [depth, od] = pbaSocket(size);
      return {
        dn: size,
        centerToEnd: l / 2 - depth,
        centerToBranch: l1 - od / 2 - depth,
        end: [depth, od] as EndMm,
      };
    }),
  }),
  ...forSpecifications(PBA, {
    id: 'wavin-te-reducao-pba',
    name: 'Tê de redução PBA junta elástica',
    kind: 'tee',
    endType: 'socket',
    manufacturer: 'Amanco Wavin',
    standard: 'ABNT NBR 5647',
    source: `${WAVIN_PBA}, p. 25 — centro à porta derivado: L/2 − C (passagem) e L1 − A/2 − C1 (derivação).`,
    // [DN passagem, DN derivação, L, L1]
    sizes: (
      [
        [75, 50, 248, 171.4],
        [100, 50, 288, 197],
        [100, 75, 288, 208],
      ] as const
    ).map(([size, branch, l, l1]) => {
      const run = pbaSocket(size);
      const out = pbaSocket(branch);
      return {
        dn: size,
        dn2: branch,
        centerToEnd: l / 2 - run[0],
        centerToBranch: l1 - run[1] / 2 - out[0],
        end: run,
        end2: out,
      };
    }),
  }),
  ...forSpecifications(PBA, {
    id: 'wavin-cruzeta-pba',
    name: 'Cruzeta PBA junta elástica',
    kind: 'cross',
    endType: 'socket',
    manufacturer: 'Amanco Wavin',
    standard: 'ABNT NBR 5647',
    source: `${WAVIN_PBA}, p. 18 — centro à porta derivado: L/2 − C. A tabela traz uma única cota L (de boca a boca), adotada para a passagem e para as derivações (peça simétrica no desenho).`,
    // DN: L (comprimento total, de boca a boca)
    sizes: (
      [
        [50, 198],
        [75, 248],
        [100, 288],
      ] as const
    ).map(([size, l]) => {
      const [depth, od] = pbaSocket(size);
      return {
        dn: size,
        centerToEnd: l / 2 - depth,
        centerToBranch: l / 2 - depth,
        end: [depth, od] as EndMm,
      };
    }),
  }),
  ...forSpecifications(PBA, {
    id: 'wavin-cruzeta-reducao-pba',
    name: 'Cruzeta de redução PBA junta elástica',
    kind: 'cross',
    endType: 'socket',
    manufacturer: 'Amanco Wavin',
    standard: 'ABNT NBR 5647',
    source: `${WAVIN_PBA}, p. 20 — centro à porta derivado: L/2 − C (passagem) e L1/2 − C1 (derivações; L1 = comprimento total das derivações, de boca a boca).`,
    // [DN passagem, DN derivações, L, L1]
    sizes: ([[75, 50, 248, 226]] as const).map(([size, branch, l, l1]) => {
      const run = pbaSocket(size);
      const out = pbaSocket(branch);
      return {
        dn: size,
        dn2: branch,
        centerToEnd: l / 2 - run[0],
        centerToBranch: l1 / 2 - out[0],
        end: run,
        end2: out,
      };
    }),
  }),
  ...forSpecifications(PBA, {
    id: 'wavin-reducao-pba',
    name: 'Redução PBA ponta e bolsa',
    kind: 'reducer',
    endType: 'socket',
    manufacturer: 'Amanco Wavin',
    standard: 'ABNT NBR 5647',
    source: `${WAVIN_PBA}, p. 24 — comprimento entre portas = L − C (total menos a bolsa menor). O lado maior é ponta.`,
    // [DN maior, DN menor, L (comprimento total)]
    sizes: (
      [
        [75, 50, 166.5],
        [100, 50, 192],
        [100, 75, 190],
      ] as const
    ).map(([size, small, l]) => {
      const out = pbaSocket(small);
      return { dn: size, dn2: small, length: l - out[0], end2: out };
    }),
  }),
];

export const PVC_FAMILIES: FittingFamily[] = [...soldavel, ...pba];
