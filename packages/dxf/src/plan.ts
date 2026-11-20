import {
  dimensionGeometry,
  formatDimension,
  getElement,
  rotate,
  tagAnchor,
  tagText,
  vec3,
  type Annotation,
  type ElementKind,
  type HydroElement,
  type Point2,
  type Project,
} from '@hydrobim/core';
import {
  buildElementGeometry,
  occludedPlanLines,
  planOutline,
  type PlanOutline,
} from '@hydrobim/geometry';
import { chainSegments, mergeCollinear } from './chain';
import { DxfDocument, type DxfVersion, type TextAlign } from './writer';

/** Dimensões de papel (mm) dos elementos de anotação; convertidas pela escala do desenho. */
export interface PlanPaper {
  /** Altura nominal do texto (corpo da fonte). */
  readonly text: number;
  /** Espessura do traço dos elementos da rede. */
  readonly outline: number;
  /** Espessura do traço das anotações. */
  readonly thin: number;
  readonly tick: number;
  readonly extensionGap: number;
  readonly overshoot: number;
  readonly textGap: number;
  readonly arrow: number;
}

export const DEFAULT_PLAN_PAPER: PlanPaper = {
  text: 2.5,
  outline: 0.25,
  thin: 0.18,
  tick: 1.8,
  extensionGap: 1,
  overshoot: 1.5,
  textGap: 0.8,
  arrow: 2.6,
};

export interface PlanDxfOptions {
  /** Dimensões de papel; por padrão, as mesmas da planta na tela. */
  readonly paper?: Partial<PlanPaper>;
  /** Projeção de um elemento (permite reaproveitar o cache da interface). */
  readonly outline?: (element: HydroElement) => PlanOutline;
  /**
   * Versão do arquivo. `R2000` (padrão) tem espessura de linha por camada, `LWPOLYLINE` e
   * o estilo de cota completo; `R12` é a alternativa para leitores antigos, sem espessuras.
   */
  readonly version?: DxfVersion;
}

/**
 * Camadas da planta, por categoria. Cores, tipos e espessuras de linha são uma convenção
 * deste exportador (não vêm de norma) e podem ser alteradas livremente no CAD.
 */
export const PLAN_LAYERS = {
  pipes: 'REDE_TUBULACOES',
  fittings: 'REDE_CONEXOES',
  valves: 'REDE_REGISTROS',
  accessories: 'REDE_ACESSORIOS',
  axes: 'REDE_EIXOS',
  texts: 'REDE_TEXTOS',
  diameters: 'REDE_DIAMETROS',
  dimensions: 'REDE_COTAS',
  levels: 'REDE_COTAS_ALTIMETRICAS',
  identifications: 'REDE_IDENTIFICACOES',
  caption: 'REDE_LEGENDA',
} as const;

type ElementLayer = 'pipes' | 'fittings' | 'valves' | 'accessories';

/** Categoria de cada tipo de elemento; bombas e reservatórios são acessórios da rede. */
const ELEMENT_LAYER: Record<ElementKind, ElementLayer> = {
  pipe: 'pipes',
  elbow: 'fittings',
  tee: 'fittings',
  reducer: 'fittings',
  valve: 'valves',
  pump: 'accessories',
  tank: 'accessories',
};

/** Prefixo do nome do bloco de cada tipo de componente. */
const BLOCK_LABEL: Record<ElementKind, string> = {
  pipe: 'HB_TUBO',
  elbow: 'HB_CURVA',
  tee: 'HB_TE',
  reducer: 'HB_REDUCAO',
  valve: 'HB_REGISTRO',
  pump: 'HB_BOMBA',
  tank: 'HB_RESERVATORIO',
};

const AXIS_LINETYPE = 'HB_EIXO';
const DIMENSION_STYLE = 'HB_COTA';

/**
 * A altura do texto no DXF é a das maiúsculas; a da planta é o corpo da fonte. Esta razão
 * (Arial) faz o texto do DXF ocupar o mesmo espaço que ocupa na tela.
 */
const CAP_HEIGHT = 0.72;
/** Entrelinha, em corpos de fonte. */
const LINE_SPACING = 1.2;
/** Distância (corpos de fonte) entre o ponto de referência e a linha de base do texto. */
const BASELINE_RISE = 0.15;
/** Resolução (m) da comparação entre projeções para reaproveitar um bloco. */
const BLOCK_GRID = 1e-4;

function readableAngle(angle: number): number {
  let a = angle;
  if (a > Math.PI / 2 + 1e-9) a -= Math.PI;
  if (a <= -Math.PI / 2 + 1e-9) a += Math.PI;
  return a;
}

/**
 * Planta baixa em DXF: a mesma projeção da tela (contornos e arestas visíveis, com os
 * elementos mais altos escondendo os mais baixos) e as anotações do projeto — cotas,
 * textos, chamadas e etiquetas —, organizadas em camadas por categoria (`PLAN_LAYERS`).
 *
 * O desenho sai em verdadeira grandeza, em metros e nas coordenadas do projeto; textos,
 * traços e setas têm o tamanho de papel multiplicado pela escala do desenho, de modo que a
 * plotagem em 1:escala reproduz a prancha. Elementos de sistemas ocultos não são desenhados,
 * como na tela.
 *
 *  - Cada elemento da rede é uma referência de bloco (`INSERT`) na sua posição e rotação:
 *    um por trecho de tubo — de uma conexão ou acessório ao seguinte, como no modelo — e um
 *    por conexão, registro ou equipamento. Elementos com a mesma projeção usam o mesmo
 *    bloco. Assim cada trecho é selecionado e movido como um objeto em qualquer programa.
 *  - O eixo de cada tubo vai em `REDE_EIXOS` (camada desligada, porque a planta da tela não
 *    mostra eixos).
 *  - Cotas: entidades `DIMENSION` com estilo próprio, editáveis no CAD.
 *  - `REDE_COTAS_ALTIMETRICAS` é criada vazia: o projeto ainda não tem cotas de nível.
 */
export function exportPlanDxf(project: Project, options: PlanDxfOptions = {}): string {
  const paper = { ...DEFAULT_PLAN_PAPER, ...options.paper };
  const outlineOf = options.outline ?? ((e: HydroElement) => planOutline(buildElementGeometry(e)));
  /** Milímetro de papel em metros do modelo. */
  const unit = project.drawingScale / 1000;
  const body = paper.text * unit;

  const doc = new DxfDocument(options.version ?? 'R2000');
  // Tipos de linha definidos em milímetros de papel: valem para a escala do desenho.
  doc.linetypeScale = unit;
  const axisLinetype = doc.addLinetype(AXIS_LINETYPE, 'Eixo ____ _ ____ _', [12, -2, 2, -2]);
  const network = { lineweight: paper.outline };
  const note = { lineweight: paper.thin };
  const layers = {
    pipes: doc.addLayer(PLAN_LAYERS.pipes, 4, network),
    fittings: doc.addLayer(PLAN_LAYERS.fittings, 3, network),
    valves: doc.addLayer(PLAN_LAYERS.valves, 1, network),
    accessories: doc.addLayer(PLAN_LAYERS.accessories, 6, network),
    axes: doc.addLayer(PLAN_LAYERS.axes, 8, {
      off: true,
      linetype: axisLinetype,
      lineweight: 0.13,
    }),
    texts: doc.addLayer(PLAN_LAYERS.texts, 7, note),
    diameters: doc.addLayer(PLAN_LAYERS.diameters, 2, note),
    dimensions: doc.addLayer(PLAN_LAYERS.dimensions, 30, note),
    levels: doc.addLayer(PLAN_LAYERS.levels, 140, note),
    identifications: doc.addLayer(PLAN_LAYERS.identifications, 50, note),
    caption: doc.addLayer(PLAN_LAYERS.caption, 7, note),
  };
  const tick = (paper.tick * unit) / 2 / Math.SQRT2;
  const dimensionStyle = doc.addDimStyle({
    name: DIMENSION_STYLE,
    textHeight: body * CAP_HEIGHT,
    tick,
    extensionOffset: paper.extensionGap * unit,
    extensionBeyond: paper.overshoot * unit,
    lineBeyond: paper.extensionGap * unit,
    textGap: paper.textGap * unit + BASELINE_RISE * body,
    arrow: paper.arrow * unit,
    decimals: 2,
  });

  /** Desenha segmentos soltos como linhas e polilinhas encadeadas. */
  const strokes = (layer: string, lines: ArrayLike<number>): void => {
    for (const { points, closed } of chainSegments(lines)) {
      if (points.length === 4) {
        doc.line(layer, points[0] ?? 0, points[1] ?? 0, points[2] ?? 0, points[3] ?? 0);
      } else doc.polyline(layer, points, closed);
    }
  };

  const hidden = new Set(project.systems.filter((s) => s.visible === false).map((s) => s.id));
  // Ordem do pintor, como na tela: os elementos mais altos por último.
  const drawn = project.elements
    .filter((element) => !hidden.has(element.systemId))
    .map((element) => ({ element, outline: outlineOf(element) }))
    .sort((a, b) => a.outline.maxZ - b.outline.maxZ);
  const visible = occludedPlanLines(drawn.map((entry) => entry.outline));
  const blocks = new Map<string, string>();
  const blockCount = new Map<string, number>();
  drawn.forEach(({ element }, index) => {
    const layer = layers[ELEMENT_LAYER[element.kind]];
    const lines = visible[index] ?? new Float64Array(0);
    // Referencial do elemento em planta: origem e direção do eixo X. Nos tubos, o início e
    // a direção do trecho; nos demais, a posição e o eixo local X.
    let position: { x: number; y: number };
    let axis: { x: number; y: number };
    if (element.kind === 'pipe') {
      const { start, end } = element;
      position = start;
      axis = { x: end.x - start.x, y: end.y - start.y };
      // Tubo vertical: o eixo é um ponto em planta.
      if (Math.hypot(axis.x, axis.y) > 1e-6) doc.line(layers.axes, start.x, start.y, end.x, end.y);
    } else {
      position = element.placement.position;
      axis = rotate(element.placement.rotation, vec3(1, 0, 0));
    }
    if (lines.length < 4) return;

    // Projeção no referencial do elemento: elementos iguais, na mesma atitude, resultam no
    // mesmo desenho e usam o mesmo bloco.
    const yaw = Math.hypot(axis.x, axis.y) > 1e-6 ? Math.atan2(axis.y, axis.x) : 0;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const local = new Float64Array(lines.length);
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const dx = (lines[i] ?? 0) - position.x;
      const dy = (lines[i + 1] ?? 0) - position.y;
      local[i] = dx * cos + dy * sin;
      local[i + 1] = dy * cos - dx * sin;
    }
    // A comparação é feita depois de fundir os segmentos colineares: a mesma peça em outra
    // posição pode ter as arestas da malha divididas de outro modo, com o mesmo desenho.
    const merged = mergeCollinear(local);
    const signature: string[] = [];
    for (let i = 0; i + 3 < merged.length; i += 4) {
      const p = `${Math.round((merged[i] ?? 0) / BLOCK_GRID)},${Math.round((merged[i + 1] ?? 0) / BLOCK_GRID)}`;
      const q = `${Math.round((merged[i + 2] ?? 0) / BLOCK_GRID)},${Math.round((merged[i + 3] ?? 0) / BLOCK_GRID)}`;
      signature.push(p < q ? `${p};${q}` : `${q};${p}`);
    }
    const label = BLOCK_LABEL[element.kind];
    const key = `${label}|${signature.sort().join('|')}`;
    let name = blocks.get(key);
    if (name === undefined) {
      const number = (blockCount.get(label) ?? 0) + 1;
      blockCount.set(label, number);
      // Entidades na camada 0: assumem a camada, a cor e a espessura de cada inserção.
      name = doc.block(`${label}_${number}`, () => strokes('0', merged));
      blocks.set(key, name);
    }
    doc.insert(layer, name, position.x, position.y, yaw);
  });

  const segment = (layer: string, p: Point2, q: Point2): void =>
    doc.line(layer, p.x, p.y, q.x, q.y);

  const text = (
    layer: string,
    at: Point2,
    angle: number,
    content: string,
    align: TextAlign,
    vAlign: 'bottom' | 'middle',
    shift = 0,
  ): void => {
    const lines = content.split('\n');
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Linha de base da primeira linha, em corpos de fonte abaixo do ponto (como na tela).
    const first =
      vAlign === 'middle'
        ? 0.35 - ((lines.length - 1) * LINE_SPACING) / 2
        : -BASELINE_RISE - (lines.length - 1) * LINE_SPACING;
    lines.forEach((line, i) => {
      const down = (first + i * LINE_SPACING) * body;
      doc.text(layer, {
        x: at.x + cos * shift + sin * down,
        y: at.y + sin * shift - cos * down,
        height: body * CAP_HEIGHT,
        rotation: angle,
        align,
        text: line,
      });
    });
  };

  const sideText = (
    layer: string,
    at: Point2,
    from: Point2,
    content: string,
    angle: number,
  ): void => {
    const right = at.x >= from.x;
    text(layer, at, angle, content, right ? 'left' : 'right', 'middle', (right ? 1 : -1) * unit);
  };

  const arrow = (layer: string, tip: Point2, from: Point2): void => {
    const dx = tip.x - from.x;
    const dy = tip.y - from.y;
    const size = Math.hypot(dx, dy);
    if (size < 1e-9) return;
    const ux = dx / size;
    const uy = dy / size;
    const length = Math.min(paper.arrow * unit, size);
    const half = length * 0.18;
    const bx = tip.x - ux * length;
    const by = tip.y - uy * length;
    doc.solid(layer, [
      [tip.x, tip.y],
      [bx - uy * half, by + ux * half],
      [bx + uy * half, by - ux * half],
    ]);
  };

  const draw = (annotation: Annotation): void => {
    if (annotation.kind === 'dimension') {
      const g = dimensionGeometry(annotation);
      if (!g) return;
      const { direction: d, normal: n } = g;
      const angle = readableAngle(Math.atan2(d.y, d.x));
      const gap = paper.textGap * unit;
      const up = { x: -Math.sin(angle), y: Math.cos(angle) };
      const middle = { x: (g.start.x + g.end.x) / 2, y: (g.start.y + g.end.y) / 2 };
      const value = formatDimension(g.value);
      // Centro do texto: acima da linha de cota, a folga mais meia altura das maiúsculas.
      const rise = gap + (BASELINE_RISE + CAP_HEIGHT / 2) * body;

      /** Traçado da cota, idêntico ao da tela; vai para o bloco da entidade DIMENSION. */
      const outline = (): void => {
        const extension = (from: Point2, to: Point2): void => {
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const size = Math.hypot(dx, dy);
          if (size < 1e-9) return;
          const ux = dx / size;
          const uy = dy / size;
          const offset = Math.min(paper.extensionGap * unit, size / 2);
          const over = paper.overshoot * unit;
          segment(
            '0',
            { x: from.x + ux * offset, y: from.y + uy * offset },
            { x: to.x + ux * over, y: to.y + uy * over },
          );
        };
        extension(annotation.a, g.start);
        extension(annotation.b, g.end);
        const over = paper.extensionGap * unit;
        segment(
          '0',
          { x: g.start.x - d.x * over, y: g.start.y - d.y * over },
          { x: g.end.x + d.x * over, y: g.end.y + d.y * over },
        );
        // Traço oblíquo a 45° em cada extremo da linha de cota.
        for (const p of [g.start, g.end]) {
          segment(
            '0',
            { x: p.x - (d.x + n.x) * tick, y: p.y - (d.y + n.y) * tick },
            { x: p.x + (d.x + n.x) * tick, y: p.y + (d.y + n.y) * tick },
          );
        }
        text(
          '0',
          { x: middle.x + up.x * gap, y: middle.y + up.y * gap },
          angle,
          value,
          'center',
          'bottom',
        );
      };

      // O CAD escreve o valor medido com duas casas e vírgula (estilo HB_COTA). Só quando o
      // texto da planta difere disso (separador de milhar) ele é fixado na entidade.
      const measured = g.value.toFixed(2).replace('.', ',');
      doc.dimension(
        layers.dimensions,
        {
          a: [annotation.a.x, annotation.a.y],
          b: [annotation.b.x, annotation.b.y],
          linePoint: [g.end.x, g.end.y],
          textMid: [middle.x + up.x * rise, middle.y + up.y * rise],
          ...(annotation.mode === 'aligned'
            ? {}
            : { angle: annotation.mode === 'horizontal' ? 0 : Math.PI / 2 }),
          // O R12 não tem as variáveis de casas decimais e separador: o texto fica fixo.
          text: doc.version === 'R2000' && value === measured ? '' : value,
          measurement: g.value,
          style: dimensionStyle,
        },
        outline,
      );
      return;
    }

    if (annotation.kind === 'text') {
      if (annotation.leader) {
        segment(layers.texts, annotation.leader, annotation.position);
        arrow(layers.texts, annotation.leader, annotation.position);
        sideText(
          layers.texts,
          annotation.position,
          annotation.leader,
          annotation.text,
          annotation.rotation,
        );
      } else {
        text(
          layers.texts,
          annotation.position,
          annotation.rotation,
          annotation.text,
          'left',
          'middle',
        );
      }
      return;
    }

    const element = getElement(project, annotation.elementId);
    if (!element) return;
    const content = tagText(element);
    const dx = element.kind === 'pipe' ? element.end.x - element.start.x : 0;
    const dy = element.kind === 'pipe' ? element.end.y - element.start.y : 0;
    // Etiquetas de tubos trazem a designação (DN) e a extensão do trecho; as demais
    // identificam o componente.
    const layer = element.kind === 'pipe' ? layers.diameters : layers.identifications;
    if (element.kind === 'pipe' && Math.hypot(dx, dy) > 1e-6) {
      // Tubos: texto paralelo ao trecho, como nas plantas de instalações.
      const angle = readableAngle(Math.atan2(dy, dx));
      text(layer, annotation.position, angle, content, 'center', 'bottom');
    } else {
      const anchor = tagAnchor(element);
      segment(layer, anchor, annotation.position);
      doc.circle(layer, anchor.x, anchor.y, 0.5 * unit);
      sideText(layer, annotation.position, anchor, content, 0);
    }
  };
  for (const annotation of project.annotations) draw(annotation);

  // Legenda sob o desenho: identifica o projeto e a escala para a qual as anotações valem.
  const extents = doc.extents;
  if (extents) {
    text(
      layers.caption,
      { x: extents.min[0], y: extents.min[1] - 8 * unit },
      0,
      `${project.name.toUpperCase()} — PLANTA BAIXA — ESC. 1:${project.drawingScale}`,
      'left',
      'bottom',
    );
  }
  return doc.toString();
}
