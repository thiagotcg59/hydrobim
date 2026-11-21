import { sectionFromPoints, sectionLookOf, type Point2, type Project } from '@hydrobim/core';
import { HIGHLIGHT, INK } from '../plan/planDrawing';
import { useViewStore } from './viewStore';

/**
 * Marcadores dos cortes em planta: a linha de corte, as setas do sentido do olhar e o nome da
 * vista. O clique seleciona o corte (o painel "Vista" mostra a configuração dele) e o duplo
 * clique abre a vista. Servem à planta de trabalho e às plantas salvas: quem chama informa
 * como um ponto do projeto vira ponto do desenho.
 */

const f = (value: number): string => (Math.round(value * 1e4) / 1e4).toString();
const FONT = 'Arial, Helvetica, sans-serif';

interface Mapping {
  /** Ponto do projeto (planta, m) → ponto do SVG. */
  map: (point: Point2) => Point2;
  /** Metros do modelo por pixel de tela. */
  mpp: number;
}

interface ShapeProps extends Mapping {
  a: Point2;
  b: Point2;
  side: 1 | -1;
  depth: number;
  name: string;
  color: string;
  /** Mostra o alcance da vista (retângulo tracejado). */
  extent: boolean;
}

function MarkerShape({ a, b, side, depth, name, color, extent, map, mpp }: ShapeProps) {
  const look = sectionLookOf({ a, b, side });
  const A = map(a);
  const B = map(b);
  // Sentido do olhar no desenho (a vista pode estar girada e o SVG cresce para baixo).
  const tip = map({ x: a.x + look.x, y: a.y + look.y });
  const lx = tip.x - A.x;
  const ly = tip.y - A.y;
  const size = Math.hypot(lx, ly) || 1;
  const ux = lx / size;
  const uy = ly / size;
  const tail = 26 * mpp;
  const head = 8 * mpp;
  const arrow = (p: Point2, key: string) => {
    const ex = p.x + ux * tail;
    const ey = p.y + uy * tail;
    return (
      <g key={key}>
        <line x1={f(p.x)} y1={f(p.y)} x2={f(ex)} y2={f(ey)} stroke={color} strokeWidth={2 * mpp} />
        <polygon
          points={`${f(ex)},${f(ey)} ${f(ex - ux * head - uy * head * 0.45)},${f(ey - uy * head + ux * head * 0.45)} ${f(ex - ux * head + uy * head * 0.45)},${f(ey - uy * head - ux * head * 0.45)}`}
          fill={color}
        />
      </g>
    );
  };
  const far = (p: Point2): Point2 => ({ x: p.x + ux * depth, y: p.y + uy * depth });
  const farA = far(A);
  const farB = far(B);
  return (
    <>
      {extent && (
        <polygon
          data-ui="extent"
          points={`${f(A.x)},${f(A.y)} ${f(B.x)},${f(B.y)} ${f(farB.x)},${f(farB.y)} ${f(farA.x)},${f(farA.y)}`}
          fill={color}
          fillOpacity={0.06}
          stroke={color}
          strokeWidth={mpp}
          strokeDasharray={`${5 * mpp} ${4 * mpp}`}
          pointerEvents="none"
        />
      )}
      <line
        x1={f(A.x)}
        y1={f(A.y)}
        x2={f(B.x)}
        y2={f(B.y)}
        stroke={color}
        strokeWidth={2 * mpp}
        strokeDasharray={`${14 * mpp} ${4 * mpp} ${2 * mpp} ${4 * mpp}`}
      />
      {arrow(A, 'a')}
      {arrow(B, 'b')}
      <text
        x={f(B.x + ux * (tail + 6 * mpp))}
        y={f(B.y + uy * (tail + 6 * mpp))}
        fontSize={12 * mpp}
        fontFamily={FONT}
        fontWeight={600}
        fill={color}
        stroke="#ffffff"
        strokeWidth={3 * mpp}
        paintOrder="stroke"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {name}
      </text>
    </>
  );
}

interface MarkersProps extends Mapping {
  project: Project;
  /** Os marcadores recebem cliques (ferramenta Selecionar). */
  interactive: boolean;
}

export function SectionMarkers({ project, interactive, map, mpp }: MarkersProps) {
  const selected = useViewStore((s) => s.marker);
  const sections = project.views.filter((view) => view.kind === 'section');
  if (sections.length === 0) return null;
  return (
    <g data-layer-views="sections" pointerEvents={interactive ? undefined : 'none'}>
      {sections.map((view) => {
        const active = view.id === selected;
        const A = map(view.a);
        const B = map(view.b);
        return (
          <g
            key={view.id}
            data-view-marker={view.id}
            data-testid="section-marker"
            data-view-name={view.name}
            data-selected={active || undefined}
            style={{ cursor: interactive ? 'pointer' : undefined }}
            // O clique no marcador não chega à planta (que selecionaria o que está por baixo).
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              useViewStore.getState().selectMarker(view.id);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              useViewStore.getState().openView(view.id);
            }}
          >
            <title>{`${view.name}: clique para selecionar, duplo clique para abrir a vista do corte`}</title>
            <MarkerShape
              a={view.a}
              b={view.b}
              side={view.side}
              depth={view.depth}
              name={view.name}
              color={active ? HIGHLIGHT : INK}
              extent={active}
              map={map}
              mpp={mpp}
            />
            <line
              data-ui="hit"
              x1={f(A.x)}
              y1={f(A.y)}
              x2={f(B.x)}
              y2={f(B.y)}
              stroke="transparent"
              strokeWidth={12 * mpp}
              pointerEvents="stroke"
            />
          </g>
        );
      })}
    </g>
  );
}

interface DraftProps extends Mapping {
  /** Pontos já indicados e ponto sob o cursor (coordenadas do projeto, em planta). */
  draft: readonly Point2[];
  cursor: Point2 | null;
}

/** Prévia do corte em criação: a linha e, depois dela, o lado e o alcance pelo cursor. */
export function SectionDraft({ draft, cursor, map, mpp }: DraftProps) {
  const [a, b] = draft;
  if (!a) return null;
  if (!b) {
    const A = map(a);
    const C = cursor ? map(cursor) : null;
    return (
      <g data-ui="section-draft" pointerEvents="none">
        <circle cx={f(A.x)} cy={f(A.y)} r={4 * mpp} fill={HIGHLIGHT} />
        {C && (
          <line
            data-testid="section-draft-line"
            x1={f(A.x)}
            y1={f(A.y)}
            x2={f(C.x)}
            y2={f(C.y)}
            stroke={HIGHLIGHT}
            strokeWidth={2 * mpp}
            strokeDasharray={`${6 * mpp} ${4 * mpp}`}
          />
        )}
      </g>
    );
  }
  const { side, depth } = cursor ? sectionFromPoints(a, b, cursor) : { side: 1 as const, depth: 0 };
  return (
    <g data-ui="section-draft" data-testid="section-draft" pointerEvents="none">
      <MarkerShape
        a={a}
        b={b}
        side={side}
        depth={depth}
        name={
          depth > 0
            ? `profundidade ${depth.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m`
            : ''
        }
        color={HIGHLIGHT}
        extent={depth > 0}
        map={map}
        mpp={mpp}
      />
    </g>
  );
}
