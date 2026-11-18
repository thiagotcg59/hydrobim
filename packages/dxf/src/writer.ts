/**
 * Escritor DXF ASCII em duas versões:
 *
 *  - **R12 (AC1009)**: o subconjunto lido por praticamente todo CAD, sem estrutura de objetos.
 *    É o formato do modelo 3D (malhas poliface).
 *  - **R2000 (AC1015)**: exige handles, registros de bloco e dicionários (escritos aqui) e, em
 *    troca, oferece espessura de linha por camada, `LWPOLYLINE` e estilos de cota completos.
 *    É o formato da planta baixa.
 *
 * Nenhuma das duas tem UTF-8 (só a partir do R2007): o arquivo é gravado em Windows-1252
 * (`encodeDxf`) e só os caracteres fora dessa página saem como `\U+XXXX`.
 *
 * Unidades do desenho: metros (as mesmas do modelo), declaradas em `$INSUNITS`.
 */

export type DxfVersion = 'R12' | 'R2000';

/** Cor do AutoCAD (ACI), 1 a 255. 7 = preto/branco conforme o fundo. */
export type Aci = number;

export interface DxfLayerOptions {
  /** Camada desligada na abertura (o conteúdo é exportado, mas não aparece). */
  readonly off?: boolean;
  /** Tipo de linha registrado com `addLinetype`; por padrão, contínuo. */
  readonly linetype?: string;
  /** Espessura de plotagem (mm). Só existe no R2000; no R12 é ignorada. */
  readonly lineweight?: number;
}

export interface DxfLayer extends DxfLayerOptions {
  readonly name: string;
  readonly color: Aci;
}

/** Estilo de cota: dimensões em unidades do desenho (o `DIMSCALE` fica em 1). */
export interface DxfDimStyle {
  readonly name: string;
  /** Altura do texto (maiúsculas). */
  readonly textHeight: number;
  /** Meio lado do traço oblíquo a 45° (`DIMTSZ`); o traço mede 2·√2 vezes este valor. */
  readonly tick: number;
  /** Folga entre o ponto cotado e o início da linha de chamada (`DIMEXO`). */
  readonly extensionOffset: number;
  /** Quanto a linha de chamada passa da linha de cota (`DIMEXE`). */
  readonly extensionBeyond: number;
  /** Quanto a linha de cota passa dos traços (`DIMDLE`). */
  readonly lineBeyond: number;
  /** Distância entre a linha de cota e o texto (`DIMGAP`). */
  readonly textGap: number;
  /** Tamanho da seta, usado pelo CAD em cotas sem traço oblíquo (`DIMASZ`). */
  readonly arrow: number;
  /** Casas decimais do valor (`DIMDEC`); o separador decimal é a vírgula. */
  readonly decimals: number;
}

export interface DxfDimension {
  /** Origens das linhas de chamada (os pontos cotados). */
  readonly a: readonly [number, number];
  readonly b: readonly [number, number];
  /** Ponto da linha de cota no pé da segunda linha de chamada. */
  readonly linePoint: readonly [number, number];
  /** Centro do texto. */
  readonly textMid: readonly [number, number];
  /** Ângulo da linha de cota (rad) nas cotas horizontais e verticais; ausente = alinhada. */
  readonly angle?: number;
  /** Texto fixo; vazio = o CAD escreve o valor medido conforme o estilo. */
  readonly text: string;
  /** Valor medido (m). */
  readonly measurement: number;
  /** Estilo registrado com `addDimStyle`. */
  readonly style: string;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface DxfText {
  /** Ponto da linha de base (esquerda, centro ou direita, conforme `align`). */
  readonly x: number;
  readonly y: number;
  /** Altura das maiúsculas, em unidades do desenho. */
  readonly height: number;
  /** Rotação anti-horária (rad). */
  readonly rotation: number;
  readonly align: TextAlign;
  /** Uma única linha de texto. */
  readonly text: string;
}

/** O formato limita os índices de uma malha poliface a inteiros de 16 bits. */
const POLYFACE_LIMIT = 32000;

const TEXT_STYLE = 'HYDROBIM';
/** Largura média de um caractere, em alturas de maiúscula (Arial); só para a envoltória. */
const TEXT_ASPECT = 0.85;

/** Número em notação decimal (o DXF não aceita `1e-7` em todos os leitores). */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('DXF: coordenada não finita.');
  const text = value.toFixed(6).replace(/\.?0+$/, '');
  return text === '-0' || text === '' ? '0' : text;
}

/** Caracteres do Windows-1252 entre 0x80 e 0x9F (o restante coincide com o Latin-1). */
const CP1252_HIGH = new Map<number, number>(
  [
    0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
    0x0152, 0, 0x017d, 0, 0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122,
    0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
  ].flatMap((code, i): [number, number][] => (code === 0 ? [] : [[code, 0x80 + i]])),
);

/** Byte do caractere no Windows-1252, ou `undefined` quando ele não existe nessa página. */
function cp1252(code: number): number | undefined {
  if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) return code;
  return CP1252_HIGH.get(code);
}

/**
 * Texto de uma entidade: os caracteres do Windows-1252 (todo o português) ficam como estão;
 * os demais saem como `\U+XXXX`. `^` é o prefixo de controle do DXF.
 */
export function encodeText(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 32;
    if (char === '^') out += '^ ';
    else if (code < 32 || code === 127) out += ' ';
    else if (cp1252(code) !== undefined) out += char;
    else if (code <= 0xffff) out += `\\U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
    else out += '?';
  }
  return out;
}

/**
 * Bytes do arquivo DXF. O R12 não tem UTF-8: o arquivo é gravado na página Windows-1252,
 * declarada em `$DWGCODEPAGE`, que todo CAD lê com os acentos corretos.
 */
export function encodeDxf(dxf: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(dxf.length);
  for (let i = 0; i < dxf.length; i += 1) bytes[i] = cp1252(dxf.charCodeAt(i)) ?? 0x3f;
  return bytes;
}

/** Nome de camada válido no R12: maiúsculas sem acento, dígitos, `-`, `_` e `$`. */
export function layerName(name: string): string {
  const clean = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9$_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (clean.length > 0 ? clean : 'CAMADA').slice(0, 31);
}

const ACI_BASIC: readonly (readonly [Aci, number, number, number])[] = [
  [1, 255, 0, 0],
  [2, 255, 255, 0],
  [3, 0, 255, 0],
  [4, 0, 255, 255],
  [5, 0, 0, 255],
  [6, 255, 0, 255],
  [8, 128, 128, 128],
  [9, 192, 192, 192],
];

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** Paleta ACI 10–249: 24 matizes × 5 intensidades × 2 saturações (aproximação usual). */
const ACI_PALETTE: readonly (readonly [Aci, number, number, number])[] = (() => {
  const palette = [...ACI_BASIC];
  const values = [1, 0.8, 0.6, 0.5, 0.3];
  for (let index = 10; index < 250; index += 1) {
    const hue = (Math.floor(index / 10) - 1) * 15;
    const digit = index % 10;
    const value = values[Math.floor(digit / 2)] ?? 1;
    const [r, g, b] = hsvToRgb(hue, digit % 2 === 0 ? 1 : 0.5, value);
    palette.push([index, r, g, b]);
  }
  return palette;
})();

/** Cor ACI mais próxima de `#rrggbb`. Tons quase brancos ou pretos viram 7 (cor do fundo). */
export function aciFromHex(hex: string): Aci {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  if (![r, g, b].every(Number.isFinite)) return 7;
  if (Math.max(r, g, b) < 40 || Math.min(r, g, b) > 225) return 7;
  let best: Aci = 7;
  let bestDistance = Infinity;
  for (const [index, pr, pg, pb] of ACI_PALETTE) {
    const distance = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

/** Espessuras de linha aceitas pelo formato (centésimos de milímetro). */
const LINEWEIGHTS = [
  0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200,
  211,
] as const;

/** Código 370 da espessura (mm) mais próxima; −3 = espessura padrão do CAD. */
function lineweightCode(mm: number | undefined): number {
  if (mm === undefined) return -3;
  let best = 0;
  for (const value of LINEWEIGHTS) {
    if (Math.abs(value - mm * 100) < Math.abs(best - mm * 100)) best = value;
  }
  return best;
}

/** Nome de bloco válido no R12 (as mesmas regras dos nomes de camada). */
export const blockName = layerName;

interface Linetype {
  readonly name: string;
  readonly description: string;
  /** Traços (positivos), espaços (negativos) e pontos (zero), em unidades do desenho. */
  readonly pattern: readonly number[];
}

type Box = [number, number, number, number, number, number];
const emptyBox = (): Box => [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];

interface Block {
  readonly name: string;
  readonly anonymous: boolean;
  /** Handle do registro do bloco (R2000): dono das entidades do bloco. */
  readonly record: string;
  readonly entities: string[];
  readonly box: Box;
}

/** Destino das entidades: o espaço do modelo ou a definição de um bloco. */
interface Target {
  readonly entities: string[];
  readonly box: Box;
  readonly owner: string;
  /** Entidades com cor "pelo bloco": assumem a cor da referência (blocos de cota). */
  readonly byBlock: boolean;
}

export class DxfDocument {
  readonly version: DxfVersion;
  /** Fator global dos tipos de linha (`$LTSCALE`). */
  linetypeScale = 1;

  private readonly modern: boolean;
  private readonly layers = new Map<string, DxfLayer>();
  private readonly linetypes = new Map<string, Linetype>();
  private readonly dimStyles = new Map<string, DxfDimStyle>();
  private readonly blocks = new Map<string, Block>();
  private readonly model: Target;
  private readonly paperSpaceRecord: string;
  private readonly textStyleHandle: string;
  private target: Target;
  private nextHandle = 0x20;
  private dimensions = 0;
  private count = 0;

  constructor(version: DxfVersion = 'R12') {
    this.version = version;
    this.modern = version === 'R2000';
    this.model = { entities: [], box: emptyBox(), owner: this.handle(), byBlock: false };
    this.paperSpaceRecord = this.handle();
    this.textStyleHandle = this.handle();
    this.target = this.model;
  }

  /** Número de entidades escritas (no modelo e dentro dos blocos). */
  get entityCount(): number {
    return this.count;
  }

  /** Envoltória de tudo o que foi desenhado no modelo; `null` com o desenho vazio. */
  get extents(): { min: [number, number, number]; max: [number, number, number] } | null {
    const [x0, y0, z0, x1, y1, z1] = this.model.box;
    return Number.isFinite(x0) ? { min: [x0, y0, z0], max: [x1, y1, z1] } : null;
  }

  private handle(): string {
    const value = this.nextHandle.toString(16).toUpperCase();
    this.nextHandle += 1;
    return value;
  }

  /**
   * Registra uma camada e devolve o nome efetivamente usado (saneado e sem colisão com
   * outra camada de nome original diferente).
   */
  addLayer(name: string, color: Aci, options: DxfLayerOptions = {}): string {
    if (options.linetype !== undefined && !this.linetypes.has(options.linetype)) {
      throw new Error(`DXF: tipo de linha não registrado: ${options.linetype}.`);
    }
    const base = layerName(name);
    let unique = base;
    for (let n = 2; this.layers.has(unique); n += 1) {
      const suffix = `_${n}`;
      unique = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    }
    this.layers.set(unique, { ...options, name: unique, color });
    return unique;
  }

  /**
   * Registra um tipo de linha. `pattern`: traços (valores positivos), espaços (negativos) e
   * pontos (zero), em unidades do desenho antes de `linetypeScale`.
   */
  addLinetype(name: string, description: string, pattern: readonly number[]): string {
    const unique = layerName(name);
    this.linetypes.set(unique, { name: unique, description: encodeText(description), pattern });
    return unique;
  }

  addDimStyle(style: DxfDimStyle): string {
    const name = layerName(style.name);
    this.dimStyles.set(name, { ...style, name });
    return name;
  }

  private include(x: number, y: number, z: number): void {
    const { box } = this.target;
    if (x < box[0]) box[0] = x;
    if (y < box[1]) box[1] = y;
    if (z < box[2]) box[2] = z;
    if (x > box[3]) box[3] = x;
    if (y > box[4]) box[4] = y;
    if (z > box[5]) box[5] = z;
  }

  private coords(first: number, x: number, y: number, z: number): string {
    return `${first}\n${formatNumber(x)}\n${first + 10}\n${formatNumber(y)}\n${first + 20}\n${formatNumber(z)}\n`;
  }

  private point(first: number, x: number, y: number, z: number): string {
    this.include(x, y, z);
    return this.coords(first, x, y, z);
  }

  /** Cabeçalho de um registro gráfico; no R2000 leva handle, dono e marcadores de subclasse. */
  private record(type: string, layer: string, subclasses: readonly string[], color?: Aci): string {
    if (layer !== '0' && !this.layers.has(layer)) {
      throw new Error(`DXF: camada não registrada: ${layer}.`);
    }
    const shade = color ?? (this.target.byBlock ? 0 : undefined);
    return (
      `0\n${type}\n` +
      (this.modern ? `5\n${this.handle()}\n330\n${this.target.owner}\n100\nAcDbEntity\n` : '') +
      `8\n${layer}\n` +
      (shade === undefined ? '' : `62\n${shade}\n`) +
      (this.modern ? subclasses.map((name) => `100\n${name}\n`).join('') : '')
    );
  }

  private begin(type: string, layer: string, subclass: string, color?: Aci): string {
    this.count += 1;
    return this.record(type, layer, [subclass], color);
  }

  line(layer: string, x1: number, y1: number, x2: number, y2: number, z1 = 0, z2 = 0): void {
    this.target.entities.push(
      this.begin('LINE', layer, 'AcDbLine') +
        this.point(10, x1, y1, z1) +
        this.point(11, x2, y2, z2),
    );
  }

  /**
   * Polilinha plana (`points`: x, y por vértice). No R2000 é uma `LWPOLYLINE`; no R12, que
   * não tem essa entidade, uma `POLYLINE` 2D equivalente.
   */
  polyline(layer: string, points: ArrayLike<number>, closed = false): void {
    const total = Math.floor(points.length / 2);
    if (total < 2) return;
    for (let i = 0; i < total; i += 1) this.include(points[i * 2] ?? 0, points[i * 2 + 1] ?? 0, 0);
    const flag = closed ? 1 : 0;
    if (this.modern) {
      let out = `${this.begin('LWPOLYLINE', layer, 'AcDbPolyline')}90\n${total}\n70\n${flag}\n43\n0\n`;
      for (let i = 0; i < total; i += 1) {
        out += `10\n${formatNumber(points[i * 2] ?? 0)}\n20\n${formatNumber(points[i * 2 + 1] ?? 0)}\n`;
      }
      this.target.entities.push(out);
      return;
    }
    let out = `${this.begin('POLYLINE', layer, 'AcDb2dPolyline')}66\n1\n10\n0\n20\n0\n30\n0\n70\n${flag}\n`;
    for (let i = 0; i < total; i += 1) {
      out += `0\nVERTEX\n8\n${layer}\n${this.coords(10, points[i * 2] ?? 0, points[i * 2 + 1] ?? 0, 0)}`;
    }
    this.target.entities.push(`${out}0\nSEQEND\n8\n${layer}\n`);
  }

  circle(layer: string, x: number, y: number, radius: number): void {
    this.include(x - radius, y - radius, 0);
    this.include(x + radius, y + radius, 0);
    this.target.entities.push(
      `${this.begin('CIRCLE', layer, 'AcDbCircle')}${this.point(10, x, y, 0)}40\n${formatNumber(radius)}\n`,
    );
  }

  /** Triângulo preenchido (pontas de seta). */
  solid(layer: string, points: readonly [number, number][]): void {
    const [a, b, c] = points;
    if (!a || !b || !c) return;
    this.target.entities.push(
      this.begin('SOLID', layer, 'AcDbTrace') +
        this.point(10, a[0], a[1], 0) +
        this.point(11, b[0], b[1], 0) +
        this.point(12, c[0], c[1], 0) +
        this.point(13, c[0], c[1], 0),
    );
  }

  text(layer: string, text: DxfText): void {
    const content = encodeText(text.text);
    if (content.trim().length === 0) return;
    const justify = text.align === 'left' ? 0 : text.align === 'center' ? 1 : 2;
    const rotation = formatNumber((text.rotation * 180) / Math.PI);
    // Envoltória aproximada do texto (largura média de um caractere Arial), para que o
    // enquadramento inicial e `$EXTMIN`/`$EXTMAX` não cortem os textos das bordas.
    const width = text.text.length * text.height * TEXT_ASPECT;
    const from = (-justify * width) / 2;
    const cos = Math.cos(text.rotation);
    const sin = Math.sin(text.rotation);
    for (const [along, up] of [
      [from, 0],
      [from + width, 0],
      [from, text.height],
      [from + width, text.height],
    ] as const) {
      this.include(text.x + along * cos - up * sin, text.y + along * sin + up * cos, 0);
    }
    this.target.entities.push(
      this.begin('TEXT', layer, 'AcDbText') +
        this.point(10, text.x, text.y, 0) +
        `40\n${formatNumber(text.height)}\n1\n${content}\n50\n${rotation}\n7\n${TEXT_STYLE}\n` +
        // Com justificação, o ponto de alinhamento (11) é o que posiciona o texto.
        (justify === 0 ? '' : `72\n${justify}\n${this.point(11, text.x, text.y, 0)}`) +
        // O R2000 exige o segundo marcador de subclasse (onde fica o alinhamento vertical).
        (this.modern ? '100\nAcDbText\n' : ''),
    );
  }

  /**
   * Define um bloco: tudo o que `draw` desenhar vai para a definição, em coordenadas
   * relativas ao ponto de inserção. As entidades devem ficar na camada `0`, para assumirem
   * a camada de cada referência (`insert`). Devolve o nome efetivamente usado.
   */
  block(name: string, draw: () => void): string {
    return this.define(blockName(name), false, draw);
  }

  private define(name: string, anonymous: boolean, draw: () => void): string {
    if (this.target !== this.model) throw new Error('DXF: blocos não podem ser aninhados.');
    let unique = name;
    for (let n = 2; this.blocks.has(unique); n += 1) unique = `${name.slice(0, 27)}_${n}`;
    const block: Block = {
      name: unique,
      anonymous,
      record: this.handle(),
      entities: [],
      box: emptyBox(),
    };
    this.blocks.set(unique, block);
    this.target = {
      entities: block.entities,
      box: block.box,
      owner: block.record,
      byBlock: anonymous,
    };
    try {
      draw();
    } finally {
      this.target = this.model;
    }
    return unique;
  }

  /** Referência a um bloco, com rotação anti-horária (rad) em torno do ponto de inserção. */
  insert(layer: string, name: string, x: number, y: number, rotation = 0): void {
    const block = this.blocks.get(name);
    if (!block) throw new Error(`DXF: bloco não definido: ${name}.`);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const [x0, y0, , x1, y1] = block.box;
    if (Number.isFinite(x0)) {
      for (const [bx, by] of [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ] as const) {
        this.include(x + bx * cos - by * sin, y + bx * sin + by * cos, 0);
      }
    }
    this.target.entities.push(
      `${this.begin('INSERT', layer, 'AcDbBlockReference')}2\n${name}\n${this.coords(10, x, y, 0)}` +
        `50\n${formatNumber((rotation * 180) / Math.PI)}\n`,
    );
  }

  /**
   * Cota linear como entidade `DIMENSION`. `draw` desenha o traçado da cota (na camada `0`),
   * que vai para o bloco anônimo exigido pelo formato: é o que o CAD exibe ao abrir o
   * arquivo. Ao editar a cota, o CAD a redesenha a partir dos pontos e do estilo.
   */
  dimension(layer: string, dimension: DxfDimension, draw: () => void): void {
    if (!this.dimStyles.has(dimension.style)) {
      throw new Error(`DXF: estilo de cota não registrado: ${dimension.style}.`);
    }
    this.dimensions += 1;
    const name = this.define(`*D${this.dimensions}`, true, draw);
    const { a, b, linePoint, textMid, angle } = dimension;
    // 32 = o bloco pertence só a esta cota; tipo 0 = linear com ângulo, 1 = alinhada.
    const type = 32 + (angle === undefined ? 1 : 0);
    const text = encodeText(dimension.text);
    const label = text.length > 0 ? `1\n${text}\n` : '';
    const rotation = angle === undefined ? '' : `50\n${formatNumber((angle * 180) / Math.PI)}\n`;
    const head =
      this.begin('DIMENSION', layer, 'AcDbDimension') +
      `2\n${name}\n` +
      this.point(10, linePoint[0], linePoint[1], 0) +
      this.point(11, textMid[0], textMid[1], 0);
    const origins = this.point(13, a[0], a[1], 0) + this.point(14, b[0], b[1], 0);
    this.target.entities.push(
      this.modern
        ? // 71 = 5: texto ancorado pelo centro.
          `${head}70\n${type}\n71\n5\n42\n${formatNumber(dimension.measurement)}\n${label}3\n${dimension.style}\n` +
            `100\nAcDbAlignedDimension\n${origins}${rotation}` +
            (angle === undefined ? '' : '100\nAcDbRotatedDimension\n')
        : `${head}3\n${dimension.style}\n70\n${type}\n${label}${origins}${rotation}`,
    );
  }

  /**
   * Malha poliface. `vertices`: x, y, z por vértice. `faces`: três índices (base 0) por
   * triângulo; `hiddenEdges[i]` oculta a aresta que parte do i-ésimo índice (diagonais de
   * faces planas, para que o aramado mostre os quadriláteros e não a triangulação).
   */
  polyface(
    layer: string,
    vertices: ArrayLike<number>,
    faces: ArrayLike<number>,
    hiddenEdges?: ArrayLike<boolean | number>,
    color?: Aci,
  ): void {
    let remap = new Map<number, number>();
    let vertexRecords: string[] = [];
    let faceRecords: string[] = [];
    const flush = (): void => {
      if (faceRecords.length === 0) return;
      this.target.entities.push(
        `${this.begin('POLYLINE', layer, 'AcDbPolyFaceMesh', color)}66\n1\n10\n0\n20\n0\n30\n0\n70\n64\n` +
          `71\n${vertexRecords.length}\n72\n${faceRecords.length}\n` +
          vertexRecords.join('') +
          faceRecords.join('') +
          this.record('SEQEND', layer, []),
      );
      remap = new Map();
      vertexRecords = [];
      faceRecords = [];
    };
    for (let f = 0; f + 2 < faces.length; f += 3) {
      if (vertexRecords.length + 3 > POLYFACE_LIMIT || faceRecords.length >= POLYFACE_LIMIT) {
        flush();
      }
      let record = `${this.record('VERTEX', layer, ['AcDbFaceRecord'])}10\n0\n20\n0\n30\n0\n70\n128\n`;
      for (let k = 0; k < 3; k += 1) {
        const source = faces[f + k] ?? 0;
        let index = remap.get(source);
        if (index === undefined) {
          index = vertexRecords.length + 1;
          remap.set(source, index);
          vertexRecords.push(
            this.record('VERTEX', layer, ['AcDbVertex', 'AcDbPolyFaceMeshVertex']) +
              this.point(
                10,
                vertices[source * 3] ?? 0,
                vertices[source * 3 + 1] ?? 0,
                vertices[source * 3 + 2] ?? 0,
              ) +
              '70\n192\n',
          );
        }
        record += `${71 + k}\n${hiddenEdges?.[f + k] ? -index : index}\n`;
      }
      faceRecords.push(record);
    }
    flush();
  }

  /** Tabela de símbolos; no R2000 a tabela e cada entrada têm handle e dono. */
  private table(name: string, entries: (entry: Entry) => string[], extra = ''): string {
    const owner = this.modern ? this.handle() : '';
    const entry: Entry = (type, subclass, handle, handleCode = 5) =>
      `0\n${type}\n` +
      (this.modern
        ? `${handleCode}\n${handle ?? this.handle()}\n330\n${owner}\n100\nAcDbSymbolTableRecord\n100\n${subclass}\n`
        : '');
    const rows = entries(entry);
    return (
      `0\nTABLE\n2\n${name}\n` +
      (this.modern ? `5\n${owner}\n330\n0\n100\nAcDbSymbolTable\n` : '') +
      `70\n${rows.length}\n${this.modern ? extra : ''}${rows.join('')}0\nENDTAB\n`
    );
  }

  private blockSection(): string {
    const modern = this.modern;
    const definition = (name: string, record: string, flags: number, body: string, paper = false) =>
      '0\nBLOCK\n' +
      (modern
        ? `5\n${this.handle()}\n330\n${record}\n100\nAcDbEntity\n${paper ? '67\n1\n' : ''}`
        : '') +
      `8\n0\n${modern ? '100\nAcDbBlockBegin\n' : ''}2\n${name}\n70\n${flags}\n10\n0\n20\n0\n30\n0\n3\n${name}\n` +
      (modern ? '1\n\n' : '') +
      body +
      '0\nENDBLK\n' +
      (modern
        ? `5\n${this.handle()}\n330\n${record}\n100\nAcDbEntity\n${paper ? '67\n1\n' : ''}`
        : '') +
      `8\n0\n${modern ? '100\nAcDbBlockEnd\n' : ''}`;
    return (
      '0\nSECTION\n2\nBLOCKS\n' +
      (modern
        ? definition('*Model_Space', this.model.owner, 0, '') +
          definition('*Paper_Space', this.paperSpaceRecord, 0, '', true)
        : '') +
      [...this.blocks.values()]
        .map((b) => definition(b.name, b.record, b.anonymous ? 1 : 0, b.entities.join('')))
        .join('') +
      '0\nENDSEC\n'
    );
  }

  private tables(): string {
    const { modern } = this;
    const extents = this.extents ?? { min: [0, 0, 0], max: [1, 1, 0] };
    const width = Math.max((extents.max[0] ?? 0) - (extents.min[0] ?? 0), 1e-3);
    const height = Math.max((extents.max[1] ?? 0) - (extents.min[1] ?? 0), 1e-3);
    // Janela inicial enquadrando o desenho, com margem (proporção de tela 2:1).
    const viewHeight = Math.max(height, width / 2) * 1.1;
    const vport = this.table('VPORT', (entry) => [
      `${entry('VPORT', 'AcDbViewportTableRecord')}2\n*ACTIVE\n70\n0\n10\n0\n20\n0\n11\n1\n21\n1\n` +
        `12\n${formatNumber(((extents.min[0] ?? 0) + (extents.max[0] ?? 0)) / 2)}\n` +
        `22\n${formatNumber(((extents.min[1] ?? 0) + (extents.max[1] ?? 0)) / 2)}\n` +
        '13\n0\n23\n0\n14\n10\n24\n10\n15\n10\n25\n10\n16\n0\n26\n0\n36\n1\n17\n0\n27\n0\n37\n0\n' +
        `40\n${formatNumber(viewHeight)}\n41\n2\n42\n50\n43\n0\n44\n0\n50\n0\n51\n0\n` +
        '71\n0\n72\n100\n73\n1\n74\n3\n75\n0\n76\n0\n77\n0\n78\n0\n',
    ]);

    const continuous = modern ? 'Continuous' : 'CONTINUOUS';
    const ltype = this.table('LTYPE', (entry) => {
      const row = (name: string, description: string, pattern: readonly number[]): string =>
        `${entry('LTYPE', 'AcDbLinetypeTableRecord')}2\n${name}\n70\n${modern ? 0 : 64}\n3\n${description}\n` +
        `72\n65\n73\n${pattern.length}\n40\n${formatNumber(pattern.reduce((sum, v) => sum + Math.abs(v), 0))}\n` +
        pattern.map((v) => `49\n${formatNumber(v)}\n${modern ? '74\n0\n' : ''}`).join('');
      return [
        ...(modern ? [row('ByBlock', '', []), row('ByLayer', '', [])] : []),
        row(continuous, 'Solid line', []),
        ...[...this.linetypes.values()].map((l) => row(l.name, l.description, l.pattern)),
      ];
    });

    const layers: DxfLayer[] = [{ name: '0', color: 7 }, ...this.layers.values()];
    const layer = this.table('LAYER', (entry) =>
      layers.map(
        (l) =>
          // Cor negativa = camada desligada.
          `${entry('LAYER', 'AcDbLayerTableRecord')}2\n${l.name}\n70\n0\n62\n${l.off ? -l.color : l.color}\n` +
          `6\n${l.linetype ?? continuous}\n${modern ? `370\n${lineweightCode(l.lineweight)}\n` : ''}`,
      ),
    );

    const style = this.table('STYLE', (entry) => {
      const row = (name: string, font: string, handle?: string): string =>
        `${entry('STYLE', 'AcDbTextStyleTableRecord', handle)}2\n${name}\n70\n0\n40\n0\n41\n1\n50\n0\n71\n0\n42\n1\n3\n${font}\n4\n\n`;
      return [
        ...(modern ? [row('Standard', 'txt')] : []),
        row(TEXT_STYLE, 'arial.ttf', this.textStyleHandle),
      ];
    });

    const dimStyle = this.table(
      'DIMSTYLE',
      (entry) => {
        const row = (name: string, s: DxfDimStyle | null): string =>
          `${entry('DIMSTYLE', 'AcDbDimStyleTableRecord', undefined, 105)}2\n${name}\n70\n0\n` +
          (s === null
            ? ''
            : `40\n1\n41\n${formatNumber(s.arrow)}\n42\n${formatNumber(s.extensionOffset)}\n` +
              `44\n${formatNumber(s.extensionBeyond)}\n46\n${formatNumber(s.lineBeyond)}\n` +
              `140\n${formatNumber(s.textHeight)}\n142\n${formatNumber(s.tick)}\n144\n1\n` +
              `147\n${formatNumber(s.textGap)}\n` +
              // Texto alinhado à linha de cota e acima dela; zeros à direita mantidos.
              '73\n0\n74\n0\n77\n1\n78\n0\n172\n1\n' +
              // Decimal, com vírgula (ASCII 44), no estilo de texto do desenho.
              (modern
                ? `271\n${s.decimals}\n277\n2\n278\n44\n340\n${this.textStyleHandle}\n`
                : ''));
        return [
          ...(modern ? [row('Standard', null)] : []),
          ...[...this.dimStyles.values()].map((s) => row(s.name, s)),
        ];
      },
      '100\nAcDbDimStyleTable\n',
    );

    if (!modern) {
      const hasDimStyles = this.dimStyles.size > 0;
      return `0\nSECTION\n2\nTABLES\n${ltype}${layer}${style}${hasDimStyles ? dimStyle : ''}0\nENDSEC\n`;
    }
    const empty = (name: string): string => this.table(name, () => []);
    const appId = this.table('APPID', (entry) => [
      `${entry('APPID', 'AcDbRegAppTableRecord')}2\nACAD\n70\n0\n`,
    ]);
    const blockRecord = this.table('BLOCK_RECORD', (entry) =>
      [
        ['*Model_Space', this.model.owner] as const,
        ['*Paper_Space', this.paperSpaceRecord] as const,
        ...[...this.blocks.values()].map((b) => [b.name, b.record] as const),
      ].map(
        ([name, handle]) => `${entry('BLOCK_RECORD', 'AcDbBlockTableRecord', handle)}2\n${name}\n`,
      ),
    );
    return (
      `0\nSECTION\n2\nTABLES\n${vport}${ltype}${layer}${style}${empty('VIEW')}${empty('UCS')}` +
      `${appId}${dimStyle}${blockRecord}0\nENDSEC\n`
    );
  }

  toString(): string {
    const { modern } = this;
    const tables = this.tables();
    const blocks = this.blockSection();
    let objects = '';
    if (modern) {
      // Dicionário raiz com o dicionário de grupos: o mínimo que o AutoCAD exige.
      const root = this.handle();
      const groups = this.handle();
      objects =
        '0\nSECTION\n2\nOBJECTS\n' +
        `0\nDICTIONARY\n5\n${root}\n330\n0\n100\nAcDbDictionary\n281\n1\n3\nACAD_GROUP\n350\n${groups}\n` +
        `0\nDICTIONARY\n5\n${groups}\n330\n${root}\n100\nAcDbDictionary\n281\n1\n` +
        '0\nENDSEC\n';
    }

    const extents = this.extents ?? { min: [0, 0, 0], max: [0, 0, 0] };
    // O cabeçalho é montado por último: `$HANDSEED` tem de ser maior que todo handle usado.
    const header =
      '0\nSECTION\n2\nHEADER\n' +
      `9\n$ACADVER\n1\n${modern ? 'AC1015' : 'AC1009'}\n` +
      (modern ? `9\n$HANDSEED\n5\n${this.nextHandle.toString(16).toUpperCase()}\n` : '') +
      '9\n$DWGCODEPAGE\n3\nANSI_1252\n' +
      '9\n$INSBASE\n10\n0\n20\n0\n30\n0\n' +
      `9\n$EXTMIN\n10\n${formatNumber(extents.min[0] ?? 0)}\n20\n${formatNumber(extents.min[1] ?? 0)}\n30\n${formatNumber(extents.min[2] ?? 0)}\n` +
      `9\n$EXTMAX\n10\n${formatNumber(extents.max[0] ?? 0)}\n20\n${formatNumber(extents.max[1] ?? 0)}\n30\n${formatNumber(extents.max[2] ?? 0)}\n` +
      (this.linetypeScale === 1 ? '' : `9\n$LTSCALE\n40\n${formatNumber(this.linetypeScale)}\n`) +
      // 6 = metros; desenho métrico (tipos de linha e hachuras do padrão ISO).
      '9\n$INSUNITS\n70\n6\n' +
      (modern ? '9\n$MEASUREMENT\n70\n1\n' : '') +
      '0\nENDSEC\n';

    return (
      header +
      (modern ? '0\nSECTION\n2\nCLASSES\n0\nENDSEC\n' : '') +
      tables +
      blocks +
      '0\nSECTION\n2\nENTITIES\n' +
      this.model.entities.join('') +
      '0\nENDSEC\n' +
      objects +
      '0\nEOF\n'
    );
  }
}

/** Cabeçalho de uma entrada de tabela (`handle` fixo para entradas referenciadas). */
type Entry = (type: string, subclass: string, handle?: string, handleCode?: number) => string;
