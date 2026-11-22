import {
  add,
  layersThickness,
  rotate,
  vec3,
  type ArchElement,
  type ArchLayer,
  type ArchType,
  type LayeredArchType,
  type Level,
  type Project,
  type Wall,
  type WallType,
} from '@hydrobim/core';
import { buildArchGeometry, mapMesh, type MeshPart } from '@hydrobim/geometry';
import { lazy, Suspense, useId, useMemo } from 'react';
import { INK, PAPER } from '../plan/planDrawing';
import { ArchViewElement, hatchFill, HatchDefs } from '../views/ArchShapes';
import { buildArchViewEntry, type ArchProjection, type ArchViewEntry } from '../views/archView';

/**
 * Prévias de um tipo arquitetônico. O tipo é posto em um projeto mínimo em memória — um nível,
 * o tipo e uma ocorrência (porta e janela, em uma parede hospedeira genérica) — e a malha vem
 * de `buildArchGeometry`, a mesma do modelo. Nada disso entra no projeto do usuário.
 *
 * Ilustrativos (não são dados do tipo): o comprimento e a altura da parede, o contorno da laje
 * e a parede hospedeira das esquadrias.
 */

// O canvas 3D só é carregado quando uma prévia é de fato exibida.
const FamilyPreview = lazy(() =>
  import('../viewport/FamilyPreview').then((module) => ({ default: module.FamilyPreview })),
);

export interface ArchPreviewModel {
  readonly project: Pick<Project, 'levels' | 'architecture'>;
  /** Ocorrência do tipo em prévia. */
  readonly element: ArchElement;
  /** Parede hospedeira ilustrativa (portas e janelas). */
  readonly host: Wall | null;
}

const LEVEL: Level = { id: 'previa-nivel', name: 'Prévia', elevation: 0 };
const META = { createdAt: '', updatedAt: '', revision: 0 };
const HOST_TYPE_ID = 'previa-tipo-hospedeira';

/** Dimensões ilustrativas da prévia (m): não são dados do tipo. */
export const PREVIEW_SIZES = {
  wallLength: 2,
  wallHeight: 2.6,
  floorSide: 2,
  hostThickness: 0.15,
  /** Parede livre de cada lado do vão e acima dele. */
  hostMargin: 0.6,
  hostHeadroom: 0.4,
  /** Telhado: contorno, inclinação (30 %) e beiral da prévia. */
  roofLength: 4,
  roofSpan: 3,
  roofSlope: Math.atan(0.3),
  roofOverhang: 0.3,
} as const;

const hostType: WallType = {
  id: HOST_TYPE_ID,
  category: 'wall',
  name: 'Parede hospedeira (ilustrativa)',
  familyId: null,
  generic: true,
  source: null,
  manufacturing: {},
  classifications: [],
  ifcPredefinedType: 'NOTDEFINED',
  ifc: {},
  layers: [
    {
      id: 'previa-camada',
      material: 'Parede hospedeira (ilustrativa)',
      thickness: PREVIEW_SIZES.hostThickness,
      function: 'other',
      hatch: 'none',
    },
  ],
};

function wallOf(typeId: string, length: number, height: number): Wall {
  return {
    id: 'previa-parede',
    kind: 'wall',
    name: 'Parede da prévia',
    typeId,
    levelId: LEVEL.id,
    start: { x: 0, y: 0 },
    end: { x: length, y: 0 },
    locationLine: 'center',
    baseOffset: 0,
    height,
    properties: {},
    meta: META,
  };
}

/**
 * Projeto mínimo para a prévia de um tipo: nível, tipo e uma ocorrência. `null` quando o tipo
 * ainda não tem dimensões válidas (rascunho em edição).
 */
export function buildArchPreviewModel(type: ArchType): ArchPreviewModel | null {
  const positive = (value: number): boolean => Number.isFinite(value) && value > 0;
  if (type.category === 'wall' || type.category === 'slab' || type.category === 'flooring') {
    if (type.layers.length === 0 || !type.layers.every((layer) => positive(layer.thickness))) {
      return null;
    }
    if (type.category === 'wall') {
      const wall = wallOf(type.id, PREVIEW_SIZES.wallLength, PREVIEW_SIZES.wallHeight);
      return {
        project: { levels: [LEVEL], architecture: { types: [type], elements: [wall] } },
        element: wall,
        host: null,
      };
    }
    const side = PREVIEW_SIZES.floorSide;
    const floor: ArchElement = {
      id: 'previa-piso',
      kind: type.category,
      name: 'Piso da prévia',
      typeId: type.id,
      levelId: LEVEL.id,
      boundary: [
        { x: 0, y: 0 },
        { x: side, y: 0 },
        { x: side, y: side },
        { x: 0, y: side },
      ],
      openings: [],
      offset: 0,
      properties: {},
      meta: META,
    };
    return {
      project: { levels: [LEVEL], architecture: { types: [type], elements: [floor] } },
      element: floor,
      host: null,
    };
  }
  if (type.category === 'roof') {
    if (type.layers.length === 0 || !type.layers.every((layer) => positive(layer.thickness))) {
      return null;
    }
    const { roofLength, roofSpan } = PREVIEW_SIZES;
    const roof: ArchElement = {
      id: 'previa-telhado',
      kind: 'roof',
      name: 'Telhado da prévia',
      typeId: type.id,
      levelId: LEVEL.id,
      boundary: [
        { x: 0, y: 0 },
        { x: roofLength, y: 0 },
        { x: roofLength, y: roofSpan },
        { x: 0, y: roofSpan },
      ],
      eaveEdge: 0,
      offset: 0,
      slope: PREVIEW_SIZES.roofSlope,
      overhang: PREVIEW_SIZES.roofOverhang,
      properties: {},
      meta: META,
    };
    return {
      project: { levels: [LEVEL], architecture: { types: [type], elements: [roof] } },
      element: roof,
      host: null,
    };
  }
  if (!positive(type.width) || !positive(type.height) || !positive(type.frameWidth)) return null;
  const sill = type.category === 'window' ? Math.max(0, type.sillHeight) : 0;
  const length = type.width + 2 * PREVIEW_SIZES.hostMargin;
  const host = wallOf(HOST_TYPE_ID, length, sill + type.height + PREVIEW_SIZES.hostHeadroom);
  const hosted: ArchElement = {
    id: 'previa-esquadria',
    kind: type.category,
    name: 'Esquadria da prévia',
    typeId: type.id,
    hostId: host.id,
    offset: length / 2,
    sillHeight: sill,
    hand: 'left',
    facing: 1,
    properties: {},
    meta: META,
  };
  return {
    project: {
      levels: [LEVEL],
      architecture: { types: [hostType, type], elements: [host, hosted] },
    },
    element: hosted,
    host,
  };
}

/** Malhas da prévia em um único referencial (o do projeto mínimo), com os papéis das partes. */
export function archPreviewParts(model: ArchPreviewModel): MeshPart[] {
  const parts: MeshPart[] = [];
  for (const element of [...(model.host ? [model.host] : []), model.element]) {
    const geometry = buildArchGeometry(model.project, element);
    if (!geometry) continue;
    const { position, rotation } = geometry.transform;
    for (const part of geometry.parts) {
      parts.push({
        role: part.role,
        mesh: mapMesh(
          part.mesh,
          (p) => add(rotate(rotation, p), position),
          (d) => rotate(rotation, d),
        ),
      });
    }
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Prévia 3D
// ---------------------------------------------------------------------------

export function ArchPreview3D({ type }: { type: ArchType }) {
  const parts = useMemo(() => {
    const model = buildArchPreviewModel(type);
    return model ? archPreviewParts(model) : [];
  }, [type]);
  if (parts.length === 0) {
    return (
      <p className="muted" data-testid="arch-preview-3d-empty">
        Informe dimensões válidas para ver o modelo 3D.
      </p>
    );
  }
  return (
    <div data-testid="arch-preview-3d" data-parts={parts.length} style={{ height: '100%' }}>
      <Suspense fallback={<p className="muted">Carregando o modelo 3D…</p>}>
        <FamilyPreview parts={parts} />
      </Suspense>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prévia 2D
// ---------------------------------------------------------------------------

/** Milímetro de papel em metros da prévia (escala 1:25). */
const UNIT = 0.025;
const X = vec3(1, 0, 0);
const Y = vec3(0, 1, 0);
const Z = vec3(0, 0, 1);

/** Planta esquemática: corte horizontal a `cut` metros da base. */
function planProjection(cut: number): ArchProjection {
  const clip = [
    { point: vec3(0, 0, cut), normal: vec3(0, 0, -1) },
    { point: vec3(0, 0, -1), normal: Z },
  ];
  return {
    key: `previa-planta|${cut}`,
    kind: 'plan',
    frame: { origin: vec3(0, 0, 0), u: X, v: Y, w: Z },
    clip,
    cut: clip[0] ?? null,
    band: { bottom: -1, cut, top: 100 },
    span: null,
  };
}

/** Elevação da parede vista de frente (olhar para +Y), sem corte. */
const ELEVATION: ArchProjection = {
  key: 'previa-elevacao',
  kind: 'elevation',
  frame: { origin: vec3(0, 0, 0), u: X, v: Z, w: vec3(0, -1, 0) },
  clip: [],
  cut: null,
  band: null,
  span: null,
};

/**
 * Desenhos 2D de uma esquadria: a porta em planta (parede cortada, folha e arco) e a janela
 * em elevação (marco, montantes e vidro), na ordem de desenho.
 */
export function archPreviewEntries(model: ArchPreviewModel): ArchViewEntry[] {
  const { element, host, project } = model;
  if (!host || (element.kind !== 'door' && element.kind !== 'window')) return [];
  const type = project.architecture.types.find((entry) => entry.id === element.typeId);
  if (!type || (type.category !== 'door' && type.category !== 'window')) return [];
  // A porta é cortada a meia altura da folha, onde o plano sempre a atravessa.
  const projection = element.kind === 'door' ? planProjection(type.height / 2) : ELEVATION;
  const entries: ArchViewEntry[] = [];
  for (const item of [host, element]) {
    const entry = buildArchViewEntry(project, item, buildArchGeometry(project, item), projection);
    if (entry) entries.push(entry);
  }
  return entries;
}

export interface LayerBand {
  readonly layer: ArchLayer;
  /** Posição e espessura da camada na composição (m), em escala. */
  readonly from: number;
  readonly thickness: number;
}

/** Camadas empilhadas na ordem do tipo, em escala: cada faixa começa onde a anterior termina. */
export function layerBands(layers: readonly ArchLayer[]): LayerBand[] {
  let from = 0;
  return layers.map((layer) => {
    const band = { layer, from, thickness: layer.thickness };
    from += layer.thickness;
    return band;
  });
}

const f = (value: number): string => (Math.round(value * 1e5) / 1e5).toString();

function LayersSection({ type, base }: { type: LayeredArchType; base: string }) {
  const bands = layerBands(type.layers);
  const total = layersThickness(type);
  // Trecho desenhado: largura de quatro espessuras (mínimo de 30 cm), para a seção ser legível.
  const width = Math.max(4 * total, 0.3);
  const unit = total / 40;
  const margin = total * 0.25;
  return (
    <svg
      data-testid="arch-preview-2d"
      data-preview="layers"
      viewBox={`${f(-margin)} ${f(-margin)} ${f(width + 2 * margin)} ${f(total + 2 * margin)}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Seção esquemática das camadas do tipo, em escala"
    >
      <defs>
        <HatchDefs base={base} unit={unit} />
      </defs>
      {bands.map((band, index) => {
        const fill = hatchFill(band.layer.hatch, base);
        return (
          <g key={band.layer.id} data-testid="arch-preview-layer" data-hatch={band.layer.hatch}>
            <rect x={0} y={band.from} width={width} height={band.thickness} fill="#ffffff" />
            {fill && <rect x={0} y={band.from} width={width} height={band.thickness} fill={fill} />}
            {index > 0 && (
              <line
                x1={0}
                y1={band.from}
                x2={width}
                y2={band.from}
                stroke={INK}
                strokeWidth={PAPER.thin * unit}
              />
            )}
          </g>
        );
      })}
      <rect
        x={0}
        y={0}
        width={width}
        height={total}
        fill="none"
        stroke={INK}
        strokeWidth={PAPER.outline * unit * 2}
      />
    </svg>
  );
}

function EntriesDrawing({
  entries,
  base,
  preview,
}: {
  entries: readonly ArchViewEntry[];
  base: string;
  preview: 'door-plan' | 'window-elevation';
}) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entry of entries) {
    minX = Math.min(minX, entry.bounds.min.x);
    minY = Math.min(minY, entry.bounds.min.y);
    maxX = Math.max(maxX, entry.bounds.max.x);
    maxY = Math.max(maxY, entry.bounds.max.y);
  }
  if (!Number.isFinite(minX)) return null;
  const margin = 0.15;
  return (
    <svg
      data-testid="arch-preview-2d"
      data-preview={preview}
      viewBox={`${f(minX - margin)} ${f(-maxY - margin)} ${f(maxX - minX + 2 * margin)} ${f(maxY - minY + 2 * margin)}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={
        preview === 'door-plan'
          ? 'Porta em planta, com a folha aberta e o arco de abertura'
          : 'Janela em elevação, com marco, folhas e vidro'
      }
    >
      <defs>
        <HatchDefs base={base} unit={UNIT} />
      </defs>
      {entries.map((entry) => (
        <ArchViewElement
          key={entry.element.id}
          entry={entry}
          selected={false}
          monochrome={false}
          unit={UNIT}
          hatchBase={base}
        />
      ))}
    </svg>
  );
}

const FUNCTION_NOTE: Record<ArchType['category'], string> = {
  wall: 'Seção da parede em escala: camadas da face esquerda (em cima) para a direita, com a hachura de cada uma. O comprimento desenhado é ilustrativo.',
  slab: 'Seção da laje em escala: camadas de cima para baixo, com a hachura de cada uma. A extensão desenhada é ilustrativa.',
  flooring:
    'Seção do revestimento em escala: camadas de cima para baixo, com a hachura de cada uma. A extensão desenhada é ilustrativa.',
  roof: 'Seção das camadas em escala, de cima (telha) para baixo; a espessura é medida perpendicularmente à água. No modelo 3D, o contorno, a inclinação (30 %) e o beiral são ilustrativos — pertencem a cada ocorrência.',
  door: 'Porta em planta: folha aberta e arco de abertura. A parede hospedeira e a representação são ilustrativas.',
  window:
    'Janela em elevação: marco, folhas e vidro. A parede hospedeira e a representação são ilustrativas.',
};

/** Legenda da prévia 2D: o que é do tipo e o que é só ilustração. */
export const archPreviewNote = (type: ArchType): string => FUNCTION_NOTE[type.category];

export function ArchPreview2D({ type }: { type: ArchType }) {
  const base = `previa-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const model = useMemo(() => buildArchPreviewModel(type), [type]);
  const entries = useMemo(() => (model ? archPreviewEntries(model) : []), [model]);
  if (!model) {
    return (
      <p className="muted" data-testid="arch-preview-2d-empty">
        Informe dimensões válidas para ver a prévia.
      </p>
    );
  }
  if (type.category === 'door' || type.category === 'window') {
    return (
      <EntriesDrawing
        entries={entries}
        base={base}
        preview={type.category === 'door' ? 'door-plan' : 'window-elevation'}
      />
    );
  }
  return <LayersSection type={type} base={base} />;
}
